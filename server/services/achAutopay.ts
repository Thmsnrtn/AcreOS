/**
 * Borrower ACH autopay — the engine that makes the portal's autopay toggle real.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS EXISTS (Wave C "Money moves", founder ruling #12(c), 2026-07-29)
 * ═══════════════════════════════════════════════════════════════════════════
 * The borrower portal shipped a Switch labelled "Autopay" that wrote exactly
 * one boolean — `notes.auto_pay_enabled` — and scheduled nothing. The only
 * reader of that flag was `cashFlowForecaster`, which used it to FORECAST
 * money that would never be collected, while the portal told the borrower
 * "Autopay is on — we'll collect this payment automatically." Borrower
 * payments were card-only Stripe Checkout, at ~2.9% on a land payment where
 * ACH costs about a dollar.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * RAIL CHOICE: Stripe `us_bank_account` on the LENDER'S Connect account
 * ═══════════════════════════════════════════════════════════════════════════
 * A complete-looking Actum ACH client already existed
 * (server/services/actumProcessing.ts) with the full R01–R29 return table.
 * It is NOT the rail, for four reasons that come from the repo rather than
 * from which file happened to exist:
 *
 *   1. NO CREDENTIALS ANYWHERE. `ACTUM_MERCHANT_ID` / `ACTUM_API_KEY` appear
 *      only as commented-out slots in `.env.example`. There is no merchant
 *      account, no sandbox, and nothing that could exercise the path.
 *   2. NO INBOUND WIRING. `processActumWebhook` had ZERO call sites — no
 *      route, no job. Return notifications had nowhere to arrive, so NSF
 *      handling was unreachable by construction.
 *   3. IT FABRICATED SUCCESS. Unconfigured (i.e. always), the client returned
 *      `success: true` with `test_profile_<ts>` / `test_txn_<ts>` ids. Any
 *      ledger writer trusting that boolean would book a payment for a debit
 *      that never left the building — the fabrication hard-stop, on the money
 *      path. (Fixed in the same wave; it refuses now.)
 *   4. STRIPE IS ALREADY CREDENTIALED AND WIRED. `STRIPE_SECRET_KEY` is
 *      required by stripeClient with a pinned API version; every mutating
 *      call is already wrapped by the SIMULATION_MODE proxy; Connect
 *      onboarding ALREADY requests the `us_bank_account_ach_payments`
 *      capability (stripeConnect.ts) and `createSetupIntent` ALREADY offers
 *      `us_bank_account`. Stripe also captures and retains the NACHA mandate
 *      itself, so our stored authorization is corroborated by a processor
 *      mandate id rather than being our word alone.
 *
 * Debits run as DIRECT CHARGES on the lender's own connected account
 * (`stripeAccount` header). The platform account is never used to pull a
 * borrower's bank funds — a lender without completed Connect onboarding gets
 * an honest refusal, not a debit routed through platform rails.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * IDEMPOTENCY — three independent layers
 * ═══════════════════════════════════════════════════════════════════════════
 *   L1  DB claim.  `ach_debit_attempts` is UNIQUE on
 *       (note_id, period_key, attempt_number). We INSERT … ON CONFLICT DO
 *       NOTHING *before* touching the processor. The loser of the race never
 *       calls Stripe at all — a duplicate job run, a double-click and two
 *       machines ticking the same minute all collapse here, with zero money
 *       at risk.
 *   L2  Processor key. The claimed row's `idempotency_key`
 *       (`ach:note:<id>:<period>:a<n>`) is replayed as Stripe's
 *       `idempotencyKey`. A crash between our INSERT and Stripe's response,
 *       retried on the next cycle, returns the SAME PaymentIntent instead of
 *       creating a second one.
 *   L3  Ledger key. `payments.transaction_id` is UNIQUE and carries the
 *       PaymentIntent id; the reversal row carries `<pi>:return`. Posting is
 *       INSERT … ON CONFLICT DO NOTHING, so even a reconciliation run that
 *       processes the same settlement twice posts one row and one reversal.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SETTLEMENT, RETURNS AND LEDGER TRUTH
 * ═══════════════════════════════════════════════════════════════════════════
 * ACH is not a card. `submitted` means a file went out, not that money
 * arrived, and a SETTLED debit can still be returned days later. So:
 *   - Nothing posts to the ledger on submission. The ledger row appears only
 *     when the processor reports settlement.
 *   - `reconcileInFlightDebits` polls every non-terminal attempt. Polling —
 *     not a webhook — is the system of record here on purpose: it is
 *     self-healing (a dropped or unverifiable webhook cannot lose a return)
 *     and it needs no changes to the shared Stripe webhook dispatcher. See
 *     "NOT YET REAL" at the bottom for the honest cost of that choice.
 *   - A return AFTER a posted settlement posts a REVERSAL row (negative
 *     amounts, `payment_method: 'ach_return'`) exactly once and restores the
 *     note balance under the same optimistic lock. A return BEFORE settlement
 *     posts nothing — there is nothing to reverse, and inventing a reversal
 *     for a payment that never posted would be its own fabrication.
 *   - `payment.received` is emitted via the existing `emitPaymentEvent`
 *     helper AFTER the posting transaction commits, and only on the branch
 *     that actually created the row (Wave B's pattern).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS DELIBERATELY NOT REAL
 * ═══════════════════════════════════════════════════════════════════════════
 *   - No webhook acceleration. Returns are discovered by the reconciliation
 *     sweep (hourly), not pushed. `POST /api/stripe/connect/webhook` lives in
 *     routes-billing.ts and dispatches through stripeConnect.handleWebhookEvent
 *     — neither file is in this wave's file set, so wiring `charge.failed` /
 *     `payment_intent.payment_failed` through to `applyProcessorState()` is a
 *     follow-up. The poller is complete on its own; the webhook would only
 *     make returns visible sooner.
 *   - Micro-deposit verification timing is Stripe's. A borrower whose bank
 *     needs micro-deposits has a `pending` mandate until they verify; the
 *     portal says so rather than implying autopay is armed.
 */

import { and, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, withTransaction } from "../db";
import { notes, payments } from "@shared/schema";
import {
  achDebitAttempts,
  achMandates,
  type AchDebitAttempt,
  type AchMandate,
} from "@shared/schema/ach-autopay";
import { centsFromDecimal } from "@shared/finance/cents";
import { logger } from "../utils/logger";
import { splitPaymentCents, computeAppliedLateFeeCents } from "./notePaymentMath";
import { addMonths } from "../utils/dateUtils";
import { emitPaymentEvent } from "./workflow-engine";
import { isCategorySimulated } from "../utils/simulationMode";
import {
  // `classifyAchReturn` is deliberately NOT imported: the two helpers below
  // already carry every decision this file makes about a return — which R-code
  // a processor failure maps to, and whether that code revokes authorization.
  // Importing the classifier as well left it unused, which reads like return
  // handling was wired when part of it was not.
  mapProcessorFailureToReturnCode,
  returnRevokesAuthorization,
  type AchReturnCode,
} from "./actumProcessing";

// ───────────────────────────────────────────────────────────────────────────
// Policy constants
// ───────────────────────────────────────────────────────────────────────────

/**
 * NACHA permits at most TWO re-presentments of a returned debit (three
 * presentments total for the same entry). We do not exceed that, ever.
 */
export const MAX_ATTEMPTS_PER_PERIOD = 3;

/**
 * Version stamp for the authorization language. Bumping this string is how a
 * change to the disclosure becomes provable: every mandate stores the text it
 * was shown AND this version, so "which revision did this borrower agree to"
 * is answerable from the row alone.
 */
export const AUTHORIZATION_TEXT_VERSION = "2026-07-29.v1";

/** The rail this engine implements. */
export const ACH_RAIL = "stripe_us_bank_account" as const;

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers
// ───────────────────────────────────────────────────────────────────────────

/**
 * The billing period a debit belongs to: the due date's UTC calendar day.
 *
 * A month key (`YYYY-MM`) would have been enough for today's strictly monthly
 * schedule, but it silently collapses two due dates in one month into one
 * period — so a semi-monthly note would have its second payment refused as a
 * duplicate. The day is unambiguous under both schedules.
 */
export function periodKeyForDueDate(dueDate: Date): string {
  return dueDate.toISOString().slice(0, 10);
}

/** The idempotency key replayed to the processor. Deterministic and total. */
export function idempotencyKeyFor(
  noteId: number,
  periodKey: string,
  attemptNumber: number,
): string {
  return `ach:note:${noteId}:${periodKey}:a${attemptNumber}`;
}

/** The ledger `transaction_id` for a reversal of a given debit. */
export function reversalTransactionId(paymentIntentId: string): string {
  return `${paymentIntentId}:return`;
}

/**
 * What autopay actually collects: the scheduled payment plus the servicing
 * fee plus tax escrow when enabled.
 *
 * Each component rounds at the cents boundary INDEPENDENTLY and then sums
 * exactly (the W3.3 money rule). Float-adding the decimals first can round
 * the total differently than the parts — a one-cent mismatch on a real bank
 * debit, which is exactly the kind of discrepancy an unauthorized-debit claim
 * is built from.
 */
export function scheduledDebitAmountCents(note: {
  monthlyPayment: string | number | null;
  serviceFee: string | number | null;
  taxEscrowEnabled: boolean | null;
  monthlyTaxEscrow: string | number | null;
}): number {
  return (
    centsFromDecimal(note.monthlyPayment) +
    centsFromDecimal(note.serviceFee) +
    (note.taxEscrowEnabled ? centsFromDecimal(note.monthlyTaxEscrow) : 0)
  );
}

export interface AuthorizationTextInput {
  lenderName: string;
  amountCents: number;
  scheduleDescription: string;
  noteReference: string;
}

/**
 * The authorization the borrower reads and agrees to, stored VERBATIM on the
 * mandate. Contains the four things NACHA requires a consumer debit
 * authorization to state plainly: who is debiting, how much, how often, and
 * how to revoke.
 */
export function buildAuthorizationText(input: AuthorizationTextInput): string {
  const dollars = (input.amountCents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
  });
  return [
    `I authorize ${input.lenderName} to electronically debit my bank account (ACH) for payments on ${input.noteReference}.`,
    `Amount: up to ${dollars} per payment. Schedule: ${input.scheduleDescription}.`,
    `If a payment is returned unpaid, I authorize up to two additional attempts to collect that same payment, and I understand a returned-payment fee may apply under my note.`,
    `I may cancel this authorization at any time by turning off autopay in my borrower portal or by contacting ${input.lenderName}. Cancellation takes effect once it is processed; a debit already in transit may still complete.`,
    `I confirm I am an authorized signer on this account and that the account is held at a U.S. financial institution.`,
  ].join("\n\n");
}

// ───────────────────────────────────────────────────────────────────────────
// Eligibility — every reason a debit is refused, as data
// ───────────────────────────────────────────────────────────────────────────

export type AchRefusalReason =
  | "simulated"
  | "autopay_disabled"
  | "note_not_active"
  | "no_due_date"
  | "not_yet_due"
  | "no_mandate"
  | "mandate_not_active"
  | "mandate_wrong_note"
  | "amount_not_positive"
  | "amount_exceeds_mandate"
  | "processor_account_missing"
  | "max_attempts_exhausted"
  | "retry_not_due"
  | "already_attempted";

export interface EligibilityInput {
  note: AutopayNote;
  mandate: AchMandate | null;
  amountCents: number;
  now: Date;
  /** Attempts already recorded for this (note, period). */
  priorAttempts: number;
  /** When the last return scheduled a re-presentment, its due time. */
  nextRetryAt?: Date | null;
}

export type EligibilityResult =
  | { eligible: true }
  | { eligible: false; reason: AchRefusalReason; message: string };

/**
 * Pure gate. Ordered so the cheapest/most-fundamental refusals come first and
 * so the two that protect the BORROWER (no mandate, amount over the
 * authorized ceiling) can never be skipped by an earlier `eligible: true`.
 */
export function evaluateDebitEligibility(input: EligibilityInput): EligibilityResult {
  const { note, mandate, amountCents, now, priorAttempts } = input;

  if (note.status !== "active") {
    return { eligible: false, reason: "note_not_active", message: `Note ${note.id} is ${note.status}, not active.` };
  }
  if (note.autoPayEnabled !== true) {
    return { eligible: false, reason: "autopay_disabled", message: `Autopay is off for note ${note.id}.` };
  }
  if (!note.nextPaymentDate) {
    return { eligible: false, reason: "no_due_date", message: `Note ${note.id} has no scheduled next payment date.` };
  }
  if (note.nextPaymentDate.getTime() > now.getTime()) {
    return { eligible: false, reason: "not_yet_due", message: `Note ${note.id} is not due until ${note.nextPaymentDate.toISOString()}.` };
  }
  // ── Authorization. Never debit without a stored, active mandate. ──────
  if (!mandate) {
    return { eligible: false, reason: "no_mandate", message: `No stored ACH authorization for note ${note.id}. Refusing to debit.` };
  }
  if (mandate.noteId !== note.id) {
    return { eligible: false, reason: "mandate_wrong_note", message: `Mandate ${mandate.id} belongs to note ${mandate.noteId}, not ${note.id}.` };
  }
  if (mandate.status !== "active") {
    return { eligible: false, reason: "mandate_not_active", message: `ACH authorization for note ${note.id} is ${mandate.status}. Refusing to debit.` };
  }
  if (amountCents <= 0) {
    return { eligible: false, reason: "amount_not_positive", message: `Computed debit amount for note ${note.id} is ${amountCents} cents.` };
  }
  if (amountCents > mandate.maxAmountCents) {
    return {
      eligible: false,
      reason: "amount_exceeds_mandate",
      message: `Debit of ${amountCents} cents exceeds the ${mandate.maxAmountCents} cents authorized on mandate ${mandate.id}. Refusing — a new authorization is required.`,
    };
  }
  if (!mandate.processorPaymentMethodId || !mandate.processorCustomerId || !mandate.processorAccountId) {
    return {
      eligible: false,
      reason: "processor_account_missing",
      message: `Mandate ${mandate.id} has no confirmed processor instrument.`,
    };
  }
  if (priorAttempts >= MAX_ATTEMPTS_PER_PERIOD) {
    return {
      eligible: false,
      reason: "max_attempts_exhausted",
      message: `Note ${note.id} has used all ${MAX_ATTEMPTS_PER_PERIOD} permitted presentments for this period.`,
    };
  }
  if (priorAttempts > 0) {
    // A re-presentment. NACHA/ODFI practice waits before re-presenting an
    // NSF; `nextRetryAt` carries that wait. No wait recorded ⇒ do not retry.
    if (!input.nextRetryAt) {
      return { eligible: false, reason: "retry_not_due", message: `Note ${note.id} has a prior attempt with no scheduled re-presentment.` };
    }
    if (input.nextRetryAt.getTime() > now.getTime()) {
      return { eligible: false, reason: "retry_not_due", message: `Re-presentment for note ${note.id} is not due until ${input.nextRetryAt.toISOString()}.` };
    }
  }
  return { eligible: true };
}

// ───────────────────────────────────────────────────────────────────────────
// Return disposition — bounded retry policy, as a pure function
// ───────────────────────────────────────────────────────────────────────────

export interface ReturnDispositionInput {
  returnCode: AchReturnCode;
  attemptNumber: number;
  returnedAt: Date;
}

export interface ReturnDisposition {
  /** Schedule a re-presentment of the SAME period at attemptNumber + 1. */
  retry: boolean;
  nextRetryAt: Date | null;
  /** The authorization is dead — stop and require a fresh one. */
  revokeMandate: boolean;
  /** The bank instrument is unusable — needs new bank info. */
  invalidateInstrument: boolean;
  /** Turn the note's autopay flag off (never silently keep claiming autopay). */
  disableAutopay: boolean;
  reason: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function planReturnDisposition(input: ReturnDispositionInput): ReturnDisposition {
  const { returnCode, attemptNumber, returnedAt } = input;
  const revoked = returnRevokesAuthorization(returnCode);
  const invalid = returnCode.requiresNewBankInfo;

  // A revoked authorization or a dead account is terminal: autopay goes OFF
  // so the portal stops claiming it is armed, and a fresh mandate is required.
  if (revoked || invalid) {
    return {
      retry: false,
      nextRetryAt: null,
      revokeMandate: revoked,
      invalidateInstrument: invalid,
      disableAutopay: true,
      reason: revoked
        ? `${returnCode.code} (${returnCode.description}) withdraws authorization — autopay disabled, a new authorization is required before any further debit.`
        : `${returnCode.code} (${returnCode.description}) means the bank account is unusable — autopay disabled until new bank details are authorized.`,
    };
  }

  const attemptsUsed = attemptNumber;
  if (returnCode.retryable && returnCode.daysToRetry != null && attemptsUsed < MAX_ATTEMPTS_PER_PERIOD) {
    return {
      retry: true,
      nextRetryAt: new Date(returnedAt.getTime() + returnCode.daysToRetry * DAY_MS),
      revokeMandate: false,
      invalidateInstrument: false,
      disableAutopay: false,
      reason: `${returnCode.code} (${returnCode.description}) is re-presentable — attempt ${attemptsUsed + 1} of ${MAX_ATTEMPTS_PER_PERIOD} scheduled in ${returnCode.daysToRetry} day(s).`,
    };
  }

  return {
    retry: false,
    nextRetryAt: null,
    revokeMandate: false,
    invalidateInstrument: false,
    // Attempts exhausted (or a non-retryable administrative return): autopay
    // stays ON — the account is fine and next period's debit is authorized —
    // but this period is now the lender's collections problem.
    disableAutopay: false,
    reason: returnCode.retryable
      ? `${returnCode.code} (${returnCode.description}) — all ${MAX_ATTEMPTS_PER_PERIOD} permitted presentments used for this period. No further automatic attempt.`
      : `${returnCode.code} (${returnCode.description}) is not re-presentable. No further automatic attempt for this period.`,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Ports — the store and the processor, injectable for tests
// ───────────────────────────────────────────────────────────────────────────

export interface AutopayNote {
  id: number;
  organizationId: number;
  borrowerId: number | null;
  status: string;
  autoPayEnabled: boolean | null;
  monthlyPayment: string;
  serviceFee: string | null;
  taxEscrowEnabled: boolean | null;
  monthlyTaxEscrow: string | null;
  currentBalance: string;
  interestRate: string;
  lateFee: string | null;
  gracePeriodDays: number | null;
  nextPaymentDate: Date | null;
}

export interface ClaimAttemptInput {
  organizationId: number;
  noteId: number;
  mandateId: number;
  periodKey: string;
  attemptNumber: number;
  idempotencyKey: string;
  amountCents: number;
  dueDate: Date;
  retryOfAttemptId: number | null;
}

export interface PostSettlementInput {
  note: AutopayNote;
  attempt: AchDebitAttempt;
  paymentIntentId: string;
  settledAt: Date;
}

export interface PostSettlementResult {
  paymentId: number;
  /** false = the ledger row for this PaymentIntent already existed. */
  created: boolean;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  lateFeeCents: number;
  remainingBalanceCents: number;
  dueDate: Date | null;
  paymentDate: Date;
}

export interface PostReversalInput {
  attempt: AchDebitAttempt;
  paymentIntentId: string;
  returnCode: AchReturnCode;
  returnedAt: Date;
}

export interface PostReversalResult {
  reversalPaymentId: number | null;
  /** false = the reversal row already existed (nothing was double-posted). */
  created: boolean;
}

export interface AchAutopayStore {
  /** Active notes with autopay on whose next payment is due on/before `through`. */
  listAutopayDueNotes(through: Date): Promise<AutopayNote[]>;
  getNote(noteId: number): Promise<AutopayNote | null>;
  getActiveMandateForNote(noteId: number): Promise<AchMandate | null>;
  getMandateById(mandateId: number): Promise<AchMandate | null>;
  /** All attempts recorded for (note, period), ascending by attemptNumber. */
  listAttemptsForPeriod(noteId: number, periodKey: string): Promise<AchDebitAttempt[]>;
  /**
   * INSERT … ON CONFLICT (note_id, period_key, attempt_number) DO NOTHING
   * RETURNING *. Returns null when the row already existed — the caller MUST
   * NOT contact the processor. This is idempotency layer 1.
   */
  claimAttempt(input: ClaimAttemptInput): Promise<AchDebitAttempt | null>;
  markAttemptSubmitted(attemptId: number, paymentIntentId: string, submittedAt: Date): Promise<void>;
  markAttemptFailed(attemptId: number, failureReason: string): Promise<void>;
  markAttemptCanceled(attemptId: number, reason: string): Promise<void>;
  /** Attempts in a non-terminal state, for the reconciliation sweep. */
  listInFlightAttempts(limit: number): Promise<AchDebitAttempt[]>;
  /** Attempts already settled+posted, so a late return can find its payment. */
  recordReturn(input: {
    attemptId: number;
    returnCode: AchReturnCode;
    returnedAt: Date;
    disposition: ReturnDisposition;
    reversalPaymentId: number | null;
  }): Promise<void>;
  /** Posts the ledger row + balance move in ONE transaction. Idempotent. */
  postSettlement(input: PostSettlementInput): Promise<PostSettlementResult>;
  /** Posts the reversal + balance restore in ONE transaction. Idempotent. */
  postReversal(input: PostReversalInput): Promise<PostReversalResult>;
  setMandateStatus(mandateId: number, status: "revoked" | "invalid", reason: string, at: Date): Promise<void>;
  setAutopayEnabled(noteId: number, organizationId: number, enabled: boolean): Promise<void>;
  markAttemptSettled(attemptId: number, paymentId: number, settledAt: Date): Promise<void>;
}

export type ProcessorDebitState =
  | { state: "pending" }
  | { state: "succeeded"; chargeId: string | null }
  | { state: "failed"; failureCode: string | null; failureMessage: string | null }
  | { state: "canceled"; failureMessage: string | null }
  | { state: "unknown"; detail: string };

export interface SubmitDebitInput {
  processorAccountId: string;
  processorCustomerId: string;
  processorPaymentMethodId: string;
  amountCents: number;
  /** Replayed as the processor's own idempotency key. Never omitted. */
  idempotencyKey: string;
  description: string;
  statementDescriptor?: string;
  metadata: Record<string, string>;
}

export type SubmitDebitResult =
  | { ok: true; paymentIntentId: string; state: ProcessorDebitState }
  | { ok: false; error: string; failureCode: string | null };

export interface AchProcessor {
  submitDebit(input: SubmitDebitInput): Promise<SubmitDebitResult>;
  getDebitState(input: {
    processorAccountId: string;
    paymentIntentId: string;
  }): Promise<ProcessorDebitState>;
}

/** Fire-and-forget `payment.received` emit, injectable so tests can order it. */
export type PaymentReceivedEmitter = (event: {
  organizationId: number;
  noteId: number;
  paymentId: number;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  lateFeeCents: number;
  scheduledPaymentCents: number | null;
  dueDate: Date | null;
  paymentDate: Date;
  remainingBalanceCents: number;
}) => void;

export interface AchAutopayDeps {
  store: AchAutopayStore;
  processor: AchProcessor;
  emitPaymentReceived: PaymentReceivedEmitter;
  /** True when real money must not move (SIMULATION_MODE / per-category). */
  isSimulated: () => boolean;
  now: () => Date;
}

// ───────────────────────────────────────────────────────────────────────────
// Cycle 1 — submit debits that are due
// ───────────────────────────────────────────────────────────────────────────

export interface DebitOutcome {
  noteId: number;
  periodKey: string;
  attemptNumber: number | null;
  status: "submitted" | "refused" | "error";
  reason?: AchRefusalReason | "processor_error" | "store_error";
  message?: string;
  paymentIntentId?: string;
}

export interface SubmitCycleResult {
  scanned: number;
  submitted: number;
  refused: number;
  errors: number;
  outcomes: DebitOutcome[];
}

/**
 * Submit one debit per eligible (note, period). Every note is independent —
 * a single failure never aborts the cycle, and every non-submission carries a
 * machine-readable reason so "why didn't this borrower get debited" is always
 * answerable.
 */
export async function submitDueDebits(deps: AchAutopayDeps): Promise<SubmitCycleResult> {
  const now = deps.now();
  const result: SubmitCycleResult = { scanned: 0, submitted: 0, refused: 0, errors: 0, outcomes: [] };

  // Global money kill-switch. Checked ONCE, before any read, so a simulated
  // deployment cannot reach the processor by any path through this cycle.
  if (deps.isSimulated()) {
    logger.warn("[achAutopay] submit cycle skipped — SIMULATION_MODE active, no ACH debit will be created");
    return result;
  }

  let dueNotes: AutopayNote[];
  try {
    dueNotes = await deps.store.listAutopayDueNotes(now);
  } catch (err) {
    logger.error("[achAutopay] due-notes read failed; cycle degraded to none", err instanceof Error ? err : undefined);
    result.errors += 1;
    return result;
  }
  result.scanned = dueNotes.length;

  for (const note of dueNotes) {
    let outcome: DebitOutcome;
    try {
      outcome = await submitDebitForNote(deps, note, now);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("[achAutopay] unhandled error submitting debit", err instanceof Error ? err : undefined, {
        noteId: note.id,
      });
      outcome = { noteId: note.id, periodKey: "", attemptNumber: null, status: "error", reason: "store_error", message };
    }
    result.outcomes.push(outcome);
    if (outcome.status === "submitted") result.submitted += 1;
    else if (outcome.status === "refused") result.refused += 1;
    else result.errors += 1;
  }

  return result;
}

/**
 * One note, one period. Exported so the portal's "collect now" path and the
 * job share EXACTLY this sequence — there is no second code path that can
 * move a borrower's money.
 */
export async function submitDebitForNote(
  deps: AchAutopayDeps,
  note: AutopayNote,
  now: Date,
): Promise<DebitOutcome> {
  if (deps.isSimulated()) {
    return { noteId: note.id, periodKey: "", attemptNumber: null, status: "refused", reason: "simulated", message: "SIMULATION_MODE is active — no ACH debit was created." };
  }
  if (!note.nextPaymentDate) {
    return { noteId: note.id, periodKey: "", attemptNumber: null, status: "refused", reason: "no_due_date", message: `Note ${note.id} has no scheduled next payment date.` };
  }

  const dueDate = note.nextPaymentDate;
  const periodKey = periodKeyForDueDate(dueDate);
  const amountCents = scheduledDebitAmountCents(note);
  const mandate = await deps.store.getActiveMandateForNote(note.id);
  const priorAttempts = await deps.store.listAttemptsForPeriod(note.id, periodKey);

  // An already-succeeded or in-flight attempt for this period means the money
  // is handled. This is a fast path, NOT the guard — the unique claim below is.
  const live = priorAttempts.find((a) =>
    a.status === "succeeded" || a.status === "submitted" || a.status === "processing" || a.status === "created",
  );
  if (live) {
    return {
      noteId: note.id,
      periodKey,
      attemptNumber: live.attemptNumber,
      status: "refused",
      reason: "already_attempted",
      message: `Note ${note.id} already has a ${live.status} debit for period ${periodKey}.`,
    };
  }

  const lastAttempt = priorAttempts[priorAttempts.length - 1] ?? null;
  const eligibility = evaluateDebitEligibility({
    note,
    mandate,
    amountCents,
    now,
    priorAttempts: priorAttempts.length,
    nextRetryAt: lastAttempt?.nextRetryAt ?? null,
  });
  if (!eligibility.eligible) {
    logger.info("[achAutopay] debit refused", {
      noteId: note.id,
      periodKey,
      reason: eligibility.reason,
    });
    return { noteId: note.id, periodKey, attemptNumber: null, status: "refused", reason: eligibility.reason, message: eligibility.message };
  }

  // Eligibility guarantees these; narrow for the type-checker without `as`.
  if (!mandate || !mandate.processorAccountId || !mandate.processorCustomerId || !mandate.processorPaymentMethodId) {
    return { noteId: note.id, periodKey, attemptNumber: null, status: "refused", reason: "processor_account_missing", message: `Mandate for note ${note.id} lost its processor instrument between checks.` };
  }

  const attemptNumber = priorAttempts.length + 1;
  const idempotencyKey = idempotencyKeyFor(note.id, periodKey, attemptNumber);

  // ── IDEMPOTENCY LAYER 1 — claim before charging ────────────────────────
  const attempt = await deps.store.claimAttempt({
    organizationId: note.organizationId,
    noteId: note.id,
    mandateId: mandate.id,
    periodKey,
    attemptNumber,
    idempotencyKey,
    amountCents,
    dueDate,
    retryOfAttemptId: lastAttempt?.id ?? null,
  });
  if (!attempt) {
    // Another worker (or an earlier double-click) owns this presentment. We
    // never reach the processor. This is the double-charge guard firing.
    logger.info("[achAutopay] claim lost — another worker owns this presentment", {
      noteId: note.id,
      periodKey,
      attemptNumber,
    });
    return {
      noteId: note.id,
      periodKey,
      attemptNumber,
      status: "refused",
      reason: "already_attempted",
      message: `A debit for note ${note.id} period ${periodKey} attempt ${attemptNumber} already exists.`,
    };
  }

  // ── IDEMPOTENCY LAYER 2 — replay the same key to the processor ─────────
  const submitted = await deps.processor.submitDebit({
    processorAccountId: mandate.processorAccountId,
    processorCustomerId: mandate.processorCustomerId,
    processorPaymentMethodId: mandate.processorPaymentMethodId,
    amountCents,
    idempotencyKey: attempt.idempotencyKey,
    description: `Loan payment — Note #${note.id} (due ${periodKey})`,
    metadata: {
      type: "borrower_ach_autopay",
      noteId: String(note.id),
      organizationId: String(note.organizationId),
      mandateId: String(mandate.id),
      periodKey,
      attemptNumber: String(attemptNumber),
    },
  });

  if (!submitted.ok) {
    await deps.store.markAttemptFailed(attempt.id, submitted.error);
    // A hard decline at submission time still carries a return reason when
    // the processor gave us one — never swallow it.
    const mapped = mapProcessorFailureToReturnCode(submitted.failureCode);
    if (mapped) {
      await applyReturn(deps, attempt, mapped, now, /* paymentIntentId */ null);
    }
    logger.warn("[achAutopay] processor refused the debit", {
      noteId: note.id,
      periodKey,
      attemptNumber,
      failureCode: submitted.failureCode ?? undefined,
    });
    return { noteId: note.id, periodKey, attemptNumber, status: "error", reason: "processor_error", message: submitted.error };
  }

  await deps.store.markAttemptSubmitted(attempt.id, submitted.paymentIntentId, now);

  // ACH does not settle synchronously. If the processor already reports a
  // terminal state (test clocks, instant-verification edge cases), handle it
  // now through the SAME path reconciliation uses — one implementation.
  if (submitted.state.state !== "pending") {
    await applyProcessorState(deps, { ...attempt, processorPaymentIntentId: submitted.paymentIntentId, status: "submitted" }, submitted.state, now);
  }

  logger.info("[achAutopay] ACH debit submitted", {
    noteId: note.id,
    periodKey,
    attemptNumber,
    amountCents,
    paymentIntentId: submitted.paymentIntentId,
  });
  return {
    noteId: note.id,
    periodKey,
    attemptNumber,
    status: "submitted",
    paymentIntentId: submitted.paymentIntentId,
  };
}

// ───────────────────────────────────────────────────────────────────────────
// Cycle 2 — reconcile in-flight debits (settlement + returns)
// ───────────────────────────────────────────────────────────────────────────

export interface ReconcileResult {
  checked: number;
  settled: number;
  returned: number;
  stillPending: number;
  errors: number;
}

/**
 * Poll every non-terminal attempt and drive it to its real state. This is the
 * system of record for settlement AND returns: it is idempotent, it re-runs
 * safely, and a missed notification cannot lose money because the next sweep
 * asks the processor again.
 */
export async function reconcileInFlightDebits(
  deps: AchAutopayDeps,
  limit = 500,
): Promise<ReconcileResult> {
  const now = deps.now();
  const result: ReconcileResult = { checked: 0, settled: 0, returned: 0, stillPending: 0, errors: 0 };

  let inFlight: AchDebitAttempt[];
  try {
    inFlight = await deps.store.listInFlightAttempts(limit);
  } catch (err) {
    logger.error("[achAutopay] in-flight read failed", err instanceof Error ? err : undefined);
    result.errors += 1;
    return result;
  }

  for (const attempt of inFlight) {
    result.checked += 1;
    if (!attempt.processorPaymentIntentId) {
      // Claimed but never submitted — a crash between INSERT and the
      // processor call. Cancel the claim so the next cycle can re-present
      // under a NEW attempt number rather than leaving the period stuck.
      try {
        await deps.store.markAttemptCanceled(
          attempt.id,
          "Claimed but never submitted to the processor (crash between claim and submit). No debit was created.",
        );
      } catch (err) {
        result.errors += 1;
        logger.error("[achAutopay] failed to cancel orphaned claim", err instanceof Error ? err : undefined, { attemptId: attempt.id });
      }
      continue;
    }

    const mandate = await deps.store.getMandateById(attempt.mandateId).catch(() => null);
    const processorAccountId = mandate?.processorAccountId;
    if (!processorAccountId) {
      result.errors += 1;
      logger.error("[achAutopay] cannot reconcile — mandate has no processor account", undefined, {
        attemptId: attempt.id,
        mandateId: attempt.mandateId,
      });
      continue;
    }

    let state: ProcessorDebitState;
    try {
      state = await deps.processor.getDebitState({
        processorAccountId,
        paymentIntentId: attempt.processorPaymentIntentId,
      });
    } catch (err) {
      result.errors += 1;
      logger.error("[achAutopay] processor state poll failed", err instanceof Error ? err : undefined, { attemptId: attempt.id });
      continue;
    }

    try {
      const applied = await applyProcessorState(deps, attempt, state, now);
      if (applied === "settled") result.settled += 1;
      else if (applied === "returned") result.returned += 1;
      else result.stillPending += 1;
    } catch (err) {
      result.errors += 1;
      logger.error("[achAutopay] failed to apply processor state", err instanceof Error ? err : undefined, {
        attemptId: attempt.id,
        state: state.state,
      });
    }
  }

  return result;
}

/**
 * Apply one processor state to one attempt. The SINGLE place a debit becomes
 * a ledger fact — used by both the submit path and the reconciliation sweep,
 * so there is no second way for money to be recorded.
 */
export async function applyProcessorState(
  deps: AchAutopayDeps,
  attempt: AchDebitAttempt,
  state: ProcessorDebitState,
  now: Date,
): Promise<"settled" | "returned" | "pending"> {
  const paymentIntentId = attempt.processorPaymentIntentId;
  if (!paymentIntentId) return "pending";

  if (state.state === "pending") return "pending";

  if (state.state === "unknown") {
    // Never guess. Leave the attempt in flight; the next sweep asks again.
    logger.warn("[achAutopay] processor reported an unrecognised state — leaving attempt in flight", {
      attemptId: attempt.id,
      detail: state.detail,
    });
    return "pending";
  }

  if (state.state === "succeeded") {
    const note = await deps.store.getNote(attempt.noteId);
    if (!note) {
      logger.error("[achAutopay] settled debit references a missing note", undefined, { attemptId: attempt.id, noteId: attempt.noteId });
      return "pending";
    }

    // ── The posting transaction. Idempotent on payments.transaction_id. ──
    const posted = await deps.store.postSettlement({
      note,
      attempt,
      paymentIntentId,
      settledAt: now,
    });

    // COMMITTED. Link the attempt to its ledger row, then emit.
    await deps.store.markAttemptSettled(attempt.id, posted.paymentId, now);

    if (posted.created) {
      // AFTER COMMIT, and only on the branch that actually created the row —
      // so a second reconciliation pass over the same settlement emits
      // nothing. Fire-and-forget: a workflow fault must never unwind banked
      // money.
      deps.emitPaymentReceived({
        organizationId: note.organizationId,
        noteId: note.id,
        paymentId: posted.paymentId,
        amountCents: posted.amountCents,
        principalCents: posted.principalCents,
        interestCents: posted.interestCents,
        lateFeeCents: posted.lateFeeCents,
        scheduledPaymentCents: centsFromDecimal(note.monthlyPayment) || null,
        dueDate: posted.dueDate,
        paymentDate: posted.paymentDate,
        remainingBalanceCents: posted.remainingBalanceCents,
      });
      logger.info("[achAutopay] ACH debit settled and posted", {
        noteId: note.id,
        attemptId: attempt.id,
        paymentId: posted.paymentId,
        amountCents: posted.amountCents,
      });
    }
    return "settled";
  }

  // ── failed / canceled: a return, a decline, or a cancellation ──────────
  const failureCode = state.state === "failed" ? state.failureCode : null;
  const returnCode = mapProcessorFailureToReturnCode(failureCode);

  if (!returnCode) {
    // We do not recognise the code. Record it VERBATIM and treat it as
    // terminal-for-this-period rather than inventing a retry disposition.
    const raw = failureCode ?? (state.state === "canceled" ? "canceled" : "unknown");
    const message = state.state === "failed" ? state.failureMessage : state.failureMessage;
    await deps.store.markAttemptFailed(
      attempt.id,
      `Processor reported failure code "${raw}"${message ? `: ${message}` : ""}. Not a recognised NACHA return code — no automatic re-presentment.`,
    );
    logger.warn("[achAutopay] debit failed with an unmapped processor code", {
      attemptId: attempt.id,
      failureCode: raw,
    });
    return "returned";
  }

  await applyReturn(deps, attempt, returnCode, now, paymentIntentId);
  return "returned";
}

/**
 * Record a return: reversal (only if the debit had already posted), mandate /
 * autopay consequences, and the bounded re-presentment schedule. Never
 * double-posts; never silently swallows.
 */
export async function applyReturn(
  deps: AchAutopayDeps,
  attempt: AchDebitAttempt,
  returnCode: AchReturnCode,
  returnedAt: Date,
  paymentIntentId: string | null,
): Promise<void> {
  const disposition = planReturnDisposition({
    returnCode,
    attemptNumber: attempt.attemptNumber,
    returnedAt,
  });

  // A reversal is posted ONLY when this attempt already produced a ledger
  // row. A return before settlement has nothing to reverse; posting one
  // would invent a payment that never existed.
  let reversalPaymentId: number | null = null;
  if (attempt.paymentId && paymentIntentId) {
    const reversal = await deps.store.postReversal({
      attempt,
      paymentIntentId,
      returnCode,
      returnedAt,
    });
    reversalPaymentId = reversal.reversalPaymentId;
    if (reversal.created) {
      logger.warn("[achAutopay] posted ACH return reversal", {
        attemptId: attempt.id,
        noteId: attempt.noteId,
        paymentId: attempt.paymentId,
        reversalPaymentId,
        returnCode: returnCode.code,
      });
    }
  }

  await deps.store.recordReturn({
    attemptId: attempt.id,
    returnCode,
    returnedAt,
    disposition,
    reversalPaymentId,
  });

  if (disposition.revokeMandate) {
    await deps.store.setMandateStatus(attempt.mandateId, "revoked", disposition.reason, returnedAt);
  } else if (disposition.invalidateInstrument) {
    await deps.store.setMandateStatus(attempt.mandateId, "invalid", disposition.reason, returnedAt);
  }
  if (disposition.disableAutopay) {
    await deps.store.setAutopayEnabled(attempt.noteId, attempt.organizationId, false);
  }

  logger.warn("[achAutopay] ACH return processed", {
    attemptId: attempt.id,
    noteId: attempt.noteId,
    returnCode: returnCode.code,
    category: returnCode.category,
    retryScheduled: disposition.retry,
    nextRetryAt: disposition.nextRetryAt?.toISOString(),
    reason: disposition.reason,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
// Live implementations
// ═══════════════════════════════════════════════════════════════════════════

const AUTOPAY_NOTE_COLUMNS = {
  id: notes.id,
  organizationId: notes.organizationId,
  borrowerId: notes.borrowerId,
  status: notes.status,
  autoPayEnabled: notes.autoPayEnabled,
  monthlyPayment: notes.monthlyPayment,
  serviceFee: notes.serviceFee,
  taxEscrowEnabled: notes.taxEscrowEnabled,
  monthlyTaxEscrow: notes.monthlyTaxEscrow,
  currentBalance: notes.currentBalance,
  interestRate: notes.interestRate,
  lateFee: notes.lateFee,
  gracePeriodDays: notes.gracePeriodDays,
  nextPaymentDate: notes.nextPaymentDate,
} as const;

/** Statuses a reconciliation sweep must revisit. */
const IN_FLIGHT_STATUSES = ["created", "submitted", "processing"];

export const dbAchAutopayStore: AchAutopayStore = {
  async listAutopayDueNotes(through: Date): Promise<AutopayNote[]> {
    return db
      .select(AUTOPAY_NOTE_COLUMNS)
      .from(notes)
      .where(
        and(
          eq(notes.status, "active"),
          eq(notes.autoPayEnabled, true),
          isNull(notes.deletedAt),
          lte(notes.nextPaymentDate, through),
        ),
      );
  },

  async getNote(noteId: number): Promise<AutopayNote | null> {
    const [row] = await db.select(AUTOPAY_NOTE_COLUMNS).from(notes).where(eq(notes.id, noteId));
    return row ?? null;
  },

  async getActiveMandateForNote(noteId: number): Promise<AchMandate | null> {
    const [row] = await db
      .select()
      .from(achMandates)
      .where(and(eq(achMandates.noteId, noteId), eq(achMandates.status, "active")))
      .orderBy(sql`${achMandates.confirmedAt} DESC NULLS LAST`)
      .limit(1);
    return row ?? null;
  },

  async getMandateById(mandateId: number): Promise<AchMandate | null> {
    const [row] = await db.select().from(achMandates).where(eq(achMandates.id, mandateId));
    return row ?? null;
  },

  async listAttemptsForPeriod(noteId: number, periodKey: string): Promise<AchDebitAttempt[]> {
    return db
      .select()
      .from(achDebitAttempts)
      .where(and(eq(achDebitAttempts.noteId, noteId), eq(achDebitAttempts.periodKey, periodKey)))
      .orderBy(achDebitAttempts.attemptNumber);
  },

  async claimAttempt(input: ClaimAttemptInput): Promise<AchDebitAttempt | null> {
    // ON CONFLICT DO NOTHING against the (note, period, attempt) unique index.
    // An empty RETURNING means someone else owns this presentment — we return
    // null and the caller never reaches the processor.
    const inserted = await db
      .insert(achDebitAttempts)
      .values({
        organizationId: input.organizationId,
        noteId: input.noteId,
        mandateId: input.mandateId,
        periodKey: input.periodKey,
        attemptNumber: input.attemptNumber,
        idempotencyKey: input.idempotencyKey,
        amountCents: input.amountCents,
        dueDate: input.dueDate,
        status: "created",
        retryOfAttemptId: input.retryOfAttemptId,
      })
      .onConflictDoNothing()
      .returning();
    return inserted[0] ?? null;
  },

  async markAttemptSubmitted(attemptId: number, paymentIntentId: string, submittedAt: Date): Promise<void> {
    await db
      .update(achDebitAttempts)
      .set({
        status: "submitted",
        processorPaymentIntentId: paymentIntentId,
        submittedAt,
        updatedAt: new Date(),
      })
      .where(eq(achDebitAttempts.id, attemptId));
  },

  async markAttemptFailed(attemptId: number, failureReason: string): Promise<void> {
    await db
      .update(achDebitAttempts)
      .set({ status: "failed", failureReason, updatedAt: new Date() })
      .where(eq(achDebitAttempts.id, attemptId));
  },

  async markAttemptCanceled(attemptId: number, reason: string): Promise<void> {
    await db
      .update(achDebitAttempts)
      .set({ status: "canceled", failureReason: reason, updatedAt: new Date() })
      .where(eq(achDebitAttempts.id, attemptId));
  },

  async listInFlightAttempts(limit: number): Promise<AchDebitAttempt[]> {
    return db
      .select()
      .from(achDebitAttempts)
      .where(inArray(achDebitAttempts.status, IN_FLIGHT_STATUSES))
      .orderBy(achDebitAttempts.id)
      .limit(limit);
  },

  async recordReturn(input): Promise<void> {
    await db
      .update(achDebitAttempts)
      .set({
        status: "returned",
        returnCode: input.returnCode.code,
        returnCategory: input.returnCode.category,
        returnedAt: input.returnedAt,
        failureReason: `ACH Return ${input.returnCode.code}: ${input.returnCode.description} — ${input.disposition.reason}`,
        nextRetryAt: input.disposition.nextRetryAt,
        reversalPaymentId: input.reversalPaymentId,
        updatedAt: new Date(),
      })
      .where(eq(achDebitAttempts.id, input.attemptId));
  },

  async postSettlement(input: PostSettlementInput): Promise<PostSettlementResult> {
    const { note, attempt, paymentIntentId, settledAt } = input;
    const amountCents = attempt.amountCents;
    const currentBalanceCents = centsFromDecimal(note.currentBalance);
    const annualRateBps = Math.round(Number(note.interestRate || 0) * 100);
    const split = splitPaymentCents({ paymentAmountCents: amountCents, currentBalanceCents, annualRateBps });

    const dueDate = attempt.dueDate;
    const lateFeeCents = computeAppliedLateFeeCents({
      dueDate,
      paymentDate: settledAt,
      gracePeriodDays: note.gracePeriodDays ?? 10,
      configuredLateFeeCents: centsFromDecimal(note.lateFee),
    });

    const outcome = await withTransaction(async (tx) => {
      const inserted = await tx
        .insert(payments)
        .values({
          organizationId: note.organizationId,
          noteId: note.id,
          amount: (amountCents / 100).toString(),
          principalAmount: (split.principalCents / 100).toString(),
          interestAmount: (split.interestCents / 100).toString(),
          feeAmount: "0",
          lateFeeAmount: (lateFeeCents / 100).toString(),
          paymentDate: settledAt,
          dueDate,
          paymentMethod: "ach",
          transactionId: paymentIntentId,
          status: "completed",
          processedAt: settledAt,
        })
        .onConflictDoNothing({ target: payments.transactionId })
        .returning();

      if (inserted.length === 0) {
        // Layer 3 firing: this settlement was already posted. Return the
        // existing row and touch NOTHING — no second balance move.
        const [existing] = await tx
          .select()
          .from(payments)
          .where(eq(payments.transactionId, paymentIntentId));
        if (!existing) {
          throw new Error(
            `postSettlement: conflict on transactionId=${paymentIntentId} but no existing payment row found`,
          );
        }
        return {
          paymentId: existing.id,
          created: false,
          remainingBalanceCents: centsFromDecimal(note.currentBalance) - split.principalCents,
        };
      }

      const [row] = inserted;

      // Balance move under the same optimistic lock the card path uses.
      const [locked] = await tx.select().from(notes).where(eq(notes.id, note.id)).for("update");
      let remainingBalanceCents = Math.max(0, currentBalanceCents - split.principalCents);
      if (locked) {
        const lockedBalanceCents = centsFromDecimal(locked.currentBalance);
        remainingBalanceCents = Math.max(0, lockedBalanceCents - split.principalCents);
        const nextDue = locked.nextPaymentDate
          ? addMonths(new Date(locked.nextPaymentDate), 1)
          : addMonths(settledAt, 1);
        const schedule = locked.amortizationSchedule ?? [];
        const nextPending = schedule.find((s) => s.status === "pending");
        const updatedSchedule = nextPending
          ? schedule.map((s) => (s.paymentNumber === nextPending.paymentNumber ? { ...s, status: "paid" } : s))
          : schedule;

        const updated = await tx
          .update(notes)
          .set({
            currentBalance: (remainingBalanceCents / 100).toString(),
            status: remainingBalanceCents <= 0 ? "paid_off" : "active",
            nextPaymentDate: nextDue,
            amortizationSchedule: updatedSchedule,
            version: (locked.version ?? 1) + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(notes.id, note.id), eq(notes.version, locked.version ?? 1)))
          .returning();
        if (updated.length === 0) {
          throw new Error(`Optimistic lock conflict on note ${note.id} — concurrent update detected`);
        }
      }

      return { paymentId: row.id, created: true, remainingBalanceCents };
    });

    return {
      paymentId: outcome.paymentId,
      created: outcome.created,
      amountCents,
      principalCents: split.principalCents,
      interestCents: split.interestCents,
      lateFeeCents,
      remainingBalanceCents: Math.max(0, outcome.remainingBalanceCents),
      dueDate,
      paymentDate: settledAt,
    };
  },

  async postReversal(input: PostReversalInput): Promise<PostReversalResult> {
    const { attempt, paymentIntentId, returnCode, returnedAt } = input;
    const reversalTxnId = reversalTransactionId(paymentIntentId);

    return withTransaction(async (tx) => {
      const [original] = attempt.paymentId
        ? await tx.select().from(payments).where(eq(payments.id, attempt.paymentId))
        : [];
      if (!original) {
        // Nothing posted ⇒ nothing to reverse. Refusing to invent a row.
        return { reversalPaymentId: null, created: false };
      }

      const principalCents = centsFromDecimal(original.principalAmount);
      const interestCents = centsFromDecimal(original.interestAmount);
      const lateFeeCents = centsFromDecimal(original.lateFeeAmount);
      const amountCents = centsFromDecimal(original.amount);

      const inserted = await tx
        .insert(payments)
        .values({
          organizationId: original.organizationId,
          noteId: original.noteId,
          amount: (-amountCents / 100).toString(),
          principalAmount: (-principalCents / 100).toString(),
          interestAmount: (-interestCents / 100).toString(),
          feeAmount: "0",
          lateFeeAmount: (-lateFeeCents / 100).toString(),
          paymentDate: returnedAt,
          dueDate: original.dueDate,
          paymentMethod: "ach_return",
          transactionId: reversalTxnId,
          status: "completed",
          failureReason: `ACH Return ${returnCode.code}: ${returnCode.description}`,
          processedAt: returnedAt,
        })
        .onConflictDoNothing({ target: payments.transactionId })
        .returning();

      if (inserted.length === 0) {
        // Already reversed. Exactly-once holds.
        const [existing] = await tx
          .select()
          .from(payments)
          .where(eq(payments.transactionId, reversalTxnId));
        return { reversalPaymentId: existing?.id ?? null, created: false };
      }

      const [reversal] = inserted;

      // The original row is now historically false as a *received* payment.
      // Mark it failed (with the reason) rather than deleting it — the
      // reversal pair IS the audit trail.
      await tx
        .update(payments)
        .set({
          status: "failed",
          failureReason: `ACH Return ${returnCode.code}: ${returnCode.description}`,
        })
        .where(eq(payments.id, original.id));

      // Restore the principal we had applied, under the optimistic lock.
      const [locked] = await tx.select().from(notes).where(eq(notes.id, original.noteId)).for("update");
      if (locked) {
        const restoredCents = centsFromDecimal(locked.currentBalance) + principalCents;
        const updated = await tx
          .update(notes)
          .set({
            currentBalance: (restoredCents / 100).toString(),
            status: restoredCents > 0 && locked.status === "paid_off" ? "active" : locked.status,
            version: (locked.version ?? 1) + 1,
            updatedAt: new Date(),
          })
          .where(and(eq(notes.id, original.noteId), eq(notes.version, locked.version ?? 1)))
          .returning();
        if (updated.length === 0) {
          throw new Error(`Optimistic lock conflict reversing note ${original.noteId}`);
        }
      }

      return { reversalPaymentId: reversal.id, created: true };
    });
  },

  async setMandateStatus(mandateId: number, status: "revoked" | "invalid", reason: string, at: Date): Promise<void> {
    await db
      .update(achMandates)
      .set({
        status,
        revokedAt: at,
        revokedReason: reason,
        updatedAt: new Date(),
      })
      .where(eq(achMandates.id, mandateId));
  },

  async setAutopayEnabled(noteId: number, organizationId: number, enabled: boolean): Promise<void> {
    await db
      .update(notes)
      .set({ autoPayEnabled: enabled, updatedAt: new Date() })
      .where(and(eq(notes.id, noteId), eq(notes.organizationId, organizationId)));
  },

  async markAttemptSettled(attemptId: number, paymentId: number, settledAt: Date): Promise<void> {
    await db
      .update(achDebitAttempts)
      .set({ status: "succeeded", paymentId, settledAt, updatedAt: new Date() })
      .where(eq(achDebitAttempts.id, attemptId));
  },
};

/**
 * Stripe `us_bank_account` processor. Off-session direct charges on the
 * lender's connected account.
 *
 * `mandate_data` is not sent on the debit: Stripe already holds the mandate
 * captured during the SetupIntent/Checkout setup flow and links it to the
 * saved payment method, so the debit references that mandate rather than
 * re-declaring one.
 */
export const stripeAchProcessor: AchProcessor = {
  async submitDebit(input: SubmitDebitInput): Promise<SubmitDebitResult> {
    try {
      const { getUncachableStripeClient } = await import("../stripeClient");
      const stripe = await getUncachableStripeClient();
      const intent = await stripe.paymentIntents.create(
        {
          amount: input.amountCents,
          currency: "usd",
          customer: input.processorCustomerId,
          payment_method: input.processorPaymentMethodId,
          payment_method_types: ["us_bank_account"],
          confirm: true,
          off_session: true,
          description: input.description,
          statement_descriptor: input.statementDescriptor,
          metadata: input.metadata,
        },
        {
          // IDEMPOTENCY LAYER 2 — the same key on a retry returns the SAME
          // PaymentIntent instead of creating a second debit.
          idempotencyKey: input.idempotencyKey,
          stripeAccount: input.processorAccountId,
        },
      );
      return { ok: true, paymentIntentId: intent.id, state: mapStripeIntentState(intent) };
    } catch (err) {
      const failureCode = extractStripeCode(err);
      return {
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        failureCode,
      };
    }
  },

  async getDebitState(input): Promise<ProcessorDebitState> {
    const { getUncachableStripeClient } = await import("../stripeClient");
    const stripe = await getUncachableStripeClient();
    const intent = await stripe.paymentIntents.retrieve(input.paymentIntentId, undefined, {
      stripeAccount: input.processorAccountId,
    });
    return mapStripeIntentState(intent);
  },
};

/** Minimal shape we read off a Stripe PaymentIntent. Structurally typed. */
interface StripeIntentLike {
  status: string;
  latest_charge?: string | { id: string } | null;
  last_payment_error?: { code?: string | null; decline_code?: string | null; message?: string | null } | null;
}

export function mapStripeIntentState(intent: StripeIntentLike): ProcessorDebitState {
  switch (intent.status) {
    case "succeeded":
      return {
        state: "succeeded",
        chargeId:
          typeof intent.latest_charge === "string"
            ? intent.latest_charge
            : intent.latest_charge?.id ?? null,
      };
    case "processing":
    case "requires_action":
    case "requires_confirmation":
    case "requires_capture":
      return { state: "pending" };
    case "requires_payment_method": {
      // For an off-session ACH debit this is the failure/return terminal.
      const err = intent.last_payment_error;
      return {
        state: "failed",
        failureCode: err?.decline_code ?? err?.code ?? null,
        failureMessage: err?.message ?? null,
      };
    }
    case "canceled":
      return { state: "canceled", failureMessage: intent.last_payment_error?.message ?? null };
    default:
      return { state: "unknown", detail: `Unmapped Stripe PaymentIntent status "${intent.status}"` };
  }
}

function extractStripeCode(err: unknown): string | null {
  if (typeof err !== "object" || err === null) return null;
  const candidate = err as { decline_code?: unknown; code?: unknown };
  if (typeof candidate.decline_code === "string") return candidate.decline_code;
  if (typeof candidate.code === "string") return candidate.code;
  return null;
}

/**
 * The live `payment.received` emitter. Uses the existing `emitPaymentEvent`
 * helper (Wave B) with the same data shape the card path publishes, so a
 * workflow condition written against a portal card payment matches an ACH
 * autopay payment unchanged. Never throws.
 */
export const liveEmitPaymentReceived: PaymentReceivedEmitter = (p) => {
  try {
    const daysLate = p.dueDate
      ? Math.max(0, Math.floor((p.paymentDate.getTime() - p.dueDate.getTime()) / DAY_MS))
      : null;
    emitPaymentEvent("payment.received", p.organizationId, p.paymentId, {
      source: "ach_autopay",
      noteId: p.noteId,
      paymentId: p.paymentId,
      amountCents: p.amountCents,
      amount: p.amountCents / 100,
      principalCents: p.principalCents,
      interestCents: p.interestCents,
      lateFeeCents: p.lateFeeCents,
      scheduledPaymentCents: p.scheduledPaymentCents,
      isFullPayment: p.scheduledPaymentCents === null ? null : p.amountCents >= p.scheduledPaymentCents,
      isPartial: p.scheduledPaymentCents === null ? null : p.amountCents < p.scheduledPaymentCents,
      paymentMethod: "ach",
      paymentDate: p.paymentDate.toISOString(),
      dueDate: p.dueDate ? p.dueDate.toISOString() : null,
      daysLate,
      remainingBalanceCents: p.remainingBalanceCents,
      remainingPrincipal: p.remainingBalanceCents / 100,
      isPaidOff: p.remainingBalanceCents <= 0,
    });
  } catch (err) {
    logger.error(
      "[achAutopay] payment.received emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, noteId: p.noteId, paymentId: p.paymentId },
    );
  }
};

/** The production dependency bundle. */
export function liveAchAutopayDeps(): AchAutopayDeps {
  return {
    store: dbAchAutopayStore,
    processor: stripeAchProcessor,
    emitPaymentReceived: liveEmitPaymentReceived,
    isSimulated: () => isCategorySimulated("stripe"),
    now: () => new Date(),
  };
}

export interface AchAutopayCycleResult {
  submit: SubmitCycleResult;
  reconcile: ReconcileResult;
}

/** One full autopay cycle: submit what's due, then reconcile what's in flight. */
export async function runAchAutopayCycle(
  deps: AchAutopayDeps = liveAchAutopayDeps(),
): Promise<AchAutopayCycleResult> {
  const submit = await submitDueDebits(deps);
  const reconcile = await reconcileInFlightDebits(deps);
  return { submit, reconcile };
}
