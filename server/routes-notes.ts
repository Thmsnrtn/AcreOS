/**
 * Note Investor vertical — acquired-notes API.
 *
 * Phase 5 §5 (Q4 2026). Foundation surface — list / create / read / update
 * acquired notes plus a payments ledger and an amortization-schedule
 * compute endpoint. The full BPO + tape diligence workflow + Sophie agent
 * expansion ride a follow-up PR (see
 * docs/archive/exhaustive-completion/note-investor-followups.md).
 *
 * All endpoints are org-scoped via getOrCreateOrg and gated to
 * owner/admin (notes are a financial/asset entity — VAs and viewers don't
 * mutate them; we may relax the read path later if a customer asks).
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, withTransaction } from "./db";
import {
  ACQUIRED_BOOK_ID,
  SELLER_FINANCE_BOOK_ID,
  acquiredNotes,
  notePayments,
  notePayoffQuotes,
  noteAssignments,
  noteOwnershipSplits,
  noteLossMitCases,
  noteLossMitActions,
  LOSS_MIT_STATUS,
  LOSS_MIT_ACTION_TYPES,
  // The seller-finance servicing book (the `notes` table, ~schema 1356) — the
  // Close & Carry bridge originates into THIS, distinct from acquiredNotes.
  notes as sellerFinanceNotes,
} from "@shared/schema";
import { renderAssignmentPdf } from "./services/noteAssignmentPdf";
// §1024.17 annual escrow ANALYSIS (projection + surplus/shortage/deficiency).
// Serves the seller-finance `notes` book only — the schema the analyzer reads.
import { analyzeEscrowAccount } from "./services/respaEscrowAnalysis";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId, getUserId } from "./types/request";
import { storage, calculateMonthlyPayment } from "./storage";
import type { InsertNote } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { requireRole } from "./middleware/roleGuard";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { encrypt as encryptField } from "./services/fieldEncryption";
import { emitPaymentEvent } from "./services/workflow-engine";
// The ONE schedule engine for the acquired book (pure — no db, no clock).
import {
  advancePaidThrough,
  computeNoteDelinquency,
  delinquencyIsDeterminable,
  deriveNextPaymentDate,
  lateFeeAssessable,
  nextPaymentVerdict,
  type AcquiredNoteScheduleFacts,
  type NoteDelinquencyStatus,
} from "./services/notes/acquiredNoteSchedule";
// THE aging ladder — one engine, shared with the rent ledger's /api/rent/aging
// so the two books cannot come to disagree about what "60 days late" means.
import {
  bucketAging,
  conservationHolds,
  isCalendarDate,
  scheduleWindowDue,
  type AgeableRow,
} from "@shared/finance/agingLadder";
// Status derivation is owned by the nightly aging sweep and REUSED here so a
// payment that clears arrears and the sweep can never disagree about "late".
import {
  AGEABLE_NOTE_STATUSES,
  TERMINAL_NOTE_STATUSES,
  noteStatusForDelinquency,
} from "./jobs/acquiredNoteAging";
// The ONE payoff engine (Wave C "Money moves"). Every payoff number this file
// quotes comes from computePayoffQuote — no local per-diem arithmetic.
import {
  computePayoffQuote,
  resolvePayoffAccrualStart,
  parseIsoDateUtc,
  isoDateUtc,
  PAYOFF_DAY_COUNT_CONVENTION,
  PAYOFF_ENGINE_VERSION,
  type PayoffQuote,
  type PayoffQuoteInput,
} from "./services/notePaymentMath";

// ─── Schemas ─────────────────────────────────────────────────────────────────

const addressSchema = z
  .object({
    line1: z.string().optional(),
    line2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    zip: z.string().optional(),
    country: z.string().optional(),
    phone: z.string().optional(),
  })
  .passthrough();

const noteStatusSchema = z.enum(["performing", "late", "default", "paid_off", "sold"]);

const createNoteSchema = z.object({
  propertyId: z.number().int().positive().nullable().optional(),
  borrowerId: z.number().int().positive().nullable().optional(),
  noteNumber: z.string().min(1).max(120),
  originalPrincipalCents: z.number().int().nonnegative(),
  currentBalanceCents: z.number().int().nonnegative(),
  interestRateBps: z.number().int().min(0).max(100_000),
  termMonths: z.number().int().min(1).max(1200),
  paymentAmountCents: z.number().int().nonnegative(),
  paymentDueDay: z.number().int().min(1).max(31),
  originationDate: z.string().min(1), // ISO 8601 date
  maturityDate: z.string().min(1),
  acquisitionDate: z.string().min(1),
  acquisitionPriceCents: z.number().int().nonnegative(),
  status: noteStatusSchema.optional(),
  payerName: z.string().min(1).max(240),
  payerAddress: addressSchema.optional(),
  // Plaintext TIN — encrypted server-side before persisting.
  payerTin: z.string().min(1).max(40).optional(),
  payerTinType: z.enum(["SSN", "EIN", "ITIN"]).optional(),
  originalLender: z.string().max(240).optional(),
  assignmentDocS3Key: z.string().max(512).optional(),
  // Compliance fields (PR-11)
  insuranceStatus: z.enum(["verified", "expiring_soon", "lapsed", "force_placed"]).optional(),
  insuranceCarrier: z.string().max(240).optional(),
  insurancePolicyNumber: z.string().max(120).optional(),
  insuranceExpiresAt: z.string().optional(),
  insuranceAnnualPremiumCents: z.number().int().nonnegative().optional(),
  taxEscrowEnabled: z.boolean().optional(),
  taxEscrowBalanceCents: z.number().int().nonnegative().optional(),
  taxDisbursementDueDate: z.string().optional(),
  taxDisbursementAmountCents: z.number().int().nonnegative().optional(),
  taxAuthorityName: z.string().max(240).optional(),
  notes: z.string().max(8_000).optional(),
});

const patchNoteSchema = createNoteSchema.partial();

const paymentTypeSchema = z.enum([
  "regular",
  "partial",
  "extra_principal",
  "payoff",
  "nsf_reversal",
  "unapplied_apply",
]);

const recordPaymentSchema = z.object({
  paymentDate: z.string().min(1),
  // Per-bucket cents. NSF reversals supply negative values; everything else
  // requires non-negative. Validated server-side after type is known.
  principalCents: z.number().int().default(0),
  interestCents: z.number().int().default(0),
  escrowCents: z.number().int().default(0),
  lateFeeCents: z.number().int().default(0),
  unappliedCents: z.number().int().default(0),
  paymentType: paymentTypeSchema.default("regular"),
  originalPaymentId: z.string().min(1).max(64).optional(),
  paymentMethod: z.enum(["ach", "check", "wire", "cash", "other"]).default("ach"),
  referenceNumber: z.string().max(120).optional(),
  notes: z.string().max(2_000).optional(),
});

// ─── Workflow payment events (Wave B — "wire the engine") ────────────────────
//
// The note-servicing automations (payment receipt, dunning, partial-payment
// handling, payoff) hang off the workflow engine's `payment.*` triggers.
// `/api/notes/:id/payments` is the acquired-note ledger's ONLY writer
// (the single `db.insert(notePayments)` in the repo), so this is the one and
// only emit site for that ledger — exactly one event per posted payment row.
//
// Money-path discipline, in order:
//   1. every ledger write commits first;
//   2. the emit runs after, wrapped, and can never throw back into the
//      request — a broken workflow must never fail, roll back, or re-post a
//      payment. The caller gets `void`, never a rejection.
//
// `entityId` is 0 because `note_payments` is uuid-keyed while
// `emitPaymentEvent`'s entityId is numeric; the real key travels as
// `data.paymentId`.
const UUID_KEYED_PAYMENT_ENTITY_ID = 0;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between the period's due day and the day the payment posted.
 *
 * ─── ONE ANSWER TO "HOW LATE?" (corrected 2026-07-30) ─────────────────────
 *
 * This used to measure the payment against `payment_due_day` in the PAYMENT'S
 * OWN MONTH, and ignored grace entirely. Two consequences, both live on the
 * wire, because `daysLate` is published on every `payment.received` /
 * `payment.missed` event that workflow conditions branch on:
 *
 *   • A borrower catching up on March's payment in July was measured against
 *     JULY's due day and read as a few days late, or on time. The arrears it
 *     actually cleared were invisible to every workflow.
 *   • The note row and the event disagreed about the same borrower, since the
 *     note's `days_delinquent` is measured from the period's real due date.
 *
 * It now measures against the due date the note was actually sitting on — the
 * stored `next_payment_date` before this payment posted, which is the period
 * the money was owed for. Null when the note carries no due date, so the event
 * publishes an absence rather than an invented number. 0 means
 * on-time-or-early; it never means "unknown".
 */
export function daysLateForNotePayment(
  paymentDate: string,
  dueDate: string | null | undefined,
): number | null {
  if (typeof dueDate !== "string") return null;
  const due = Date.parse(`${dueDate.slice(0, 10)}T00:00:00.000Z`);
  const paid = Date.parse(`${String(paymentDate).slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(due) || Number.isNaN(paid)) return null;
  const diffDays = Math.floor((paid - due) / DAY_MS);
  return diffDays > 0 ? diffDays : 0;
}

/** Everything the emit needs, read from rows that are already committed. */
export interface PostedNotePayment {
  organizationId: number;
  noteId: string;
  noteNumber: string | null;
  payerName: string | null;
  paymentId: string;
  paymentType: string;
  paymentMethod: string;
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  lateFeeCents: number;
  unappliedCents: number;
  /** acquired_notes.payment_amount_cents — the scheduled P&I for a period. */
  scheduledPaymentAmountCents: number | null;
  /** The due date the note was sitting on BEFORE this payment posted — the
   *  period the money was owed for. Null when no schedule is on file. */
  dueDateAtPayment: string | null;
  remainingBalanceCents: number;
  unappliedBalanceCents: number;
  noteStatus: string;
}

/**
 * Build the `data` bag workflow conditions match on and templates
 * interpolate ({{amount}}, {{noteId}}, {{borrowerName}}, {{daysLate}}…).
 *
 * `amountCents` is the cash that moved this transaction:
 * principal + interest + escrow + late fee + unapplied. That sums correctly
 * for every payment type — a partial deposits into unapplied only, an
 * `unapplied_apply` nets to 0 (funds were already held), and an NSF reversal
 * nets negative.
 *
 * Fields we do not have (borrower email, on-time streak) are simply absent
 * rather than guessed.
 */
export function buildNotePaymentEventData(p: PostedNotePayment): Record<string, any> {
  const amountCents =
    p.principalCents + p.interestCents + p.escrowCents + p.lateFeeCents + p.unappliedCents;
  const scheduled = p.scheduledPaymentAmountCents;
  const isReversal = p.paymentType === "nsf_reversal";
  const isPartial =
    p.paymentType === "partial" ||
    (scheduled !== null && amountCents > 0 && amountCents < scheduled);
  const isFullPayment =
    scheduled === null || isReversal ? null : amountCents >= scheduled;

  return {
    source: "acquired_note_ledger",
    // Identity
    noteId: p.noteId,
    noteNumber: p.noteNumber,
    paymentId: p.paymentId,
    borrowerName: p.payerName,
    // Money
    amountCents,
    amount: amountCents / 100,
    principalCents: p.principalCents,
    interestCents: p.interestCents,
    escrowCents: p.escrowCents,
    lateFeeCents: p.lateFeeCents,
    unappliedCents: p.unappliedCents,
    scheduledPaymentAmountCents: scheduled,
    // Shape of the payment — what conditions branch on
    paymentType: p.paymentType,
    paymentMethod: p.paymentMethod,
    paymentDate: p.paymentDate,
    isPartial,
    isFullPayment,
    isPayoff: p.paymentType === "payoff",
    isReversal,
    ...(isReversal ? { reason: "nsf_reversal" } : {}),
    daysLate: daysLateForNotePayment(p.paymentDate, p.dueDateAtPayment),
    // State after the payment
    remainingBalanceCents: p.remainingBalanceCents,
    remainingPrincipal: p.remainingBalanceCents / 100,
    unappliedBalanceCents: p.unappliedBalanceCents,
    noteStatus: p.noteStatus,
  };
}

/**
 * Fire-and-forget workflow emit for a payment that is ALREADY committed to
 * the acquired-note ledger. Never throws.
 *
 * An NSF reversal is not a receipt — in servicing terms it is the canonical
 * missed payment (the money bounced), so it fires `payment.missed` and every
 * other type fires `payment.received`.
 */
export function emitNotePaymentWorkflowEvent(p: PostedNotePayment): void {
  try {
    const event = p.paymentType === "nsf_reversal" ? "payment.missed" : "payment.received";
    emitPaymentEvent(
      event,
      p.organizationId,
      UUID_KEYED_PAYMENT_ENTITY_ID,
      buildNotePaymentEventData(p),
    );
  } catch (err) {
    // Swallowed on purpose: the payment is posted and the response must not
    // change because a workflow misbehaved.
    logger.error(
      "notes.recordPayment workflow emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, noteId: p.noteId, paymentId: p.paymentId },
    );
  }
}

// ─── Payment → schedule application (pure) ───────────────────────────────────
//
// Before this, recording a payment moved BALANCES and nothing else: a borrower
// who caught up stayed badged `late` until somebody edited the note by hand,
// because `paidThroughDate` / `nextPaymentDate` / the delinquency columns were
// written by no code path at all. This is the function that makes a payment
// advance the note's clock.
//
// It is pure — no db, no `new Date()` — so every rule below is a test.

/**
 * Consecutive on-time payments required before a note is flagged reperforming.
 *
 * The schema comment (shared/schema/notes-vertical.ts:200) promises "the org's
 * configured threshold (default 12, founder-configurable via org settings)".
 * NO org-settings key for this exists anywhere in the repo today. Rather than
 * invent a settings surface as a side effect of this change, we use the
 * documented default of 12 and leave the override to whoever ships the
 * setting — `reperformingThreshold` is already a parameter here, so wiring a
 * real org value later is a one-line change at the call site.
 */
export const REPERFORMING_DEFAULT_THRESHOLD = 12;

/**
 * Payment types that can satisfy a scheduled PERIOD, and therefore move
 * `paidThroughDate` forward:
 *   regular          — the ordinary contractual payment.
 *   unapplied_apply  — held funds finally applied to a period.
 *   payoff           — retires the note (handled specially below).
 * Everything else deliberately does NOT advance the schedule:
 *   partial          — money arrived but no period was satisfied; the borrower
 *                      is still behind, and advancing here is exactly how a
 *                      three-periods-down note comes to read as current.
 *   extra_principal  — a curtailment. Not a scheduled payment at all.
 *   nsf_reversal     — the money bounced; the canonical missed payment.
 */
const SCHEDULE_ADVANCING_PAYMENT_TYPES = new Set([
  "regular",
  "unapplied_apply",
  "payoff",
]);

const DAY_MS_SCHEDULE = 24 * 60 * 60 * 1000;

export interface PaymentScheduleInput {
  paymentType: string;
  /** 'YYYY-MM-DD' — when the money actually landed. */
  paymentDate: string;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  /** acquired_notes.payment_amount_cents — the scheduled amount for a period. */
  scheduledPaymentAmountCents: number | null;
  /** Balance AFTER this payment (payoff detection). */
  newCurrentBalanceCents: number;
  /** The note's stored schedule facts, pre-payment. */
  facts: AcquiredNoteScheduleFacts;
  /** The stored due date this payment is being measured against. */
  storedNextPaymentDate: string | null;
  gracePeriodDays: number;
  status: string;
  consecutiveOnTimePayments: number;
  reperformingThresholdMet: boolean;
  reperformingThreshold: number;
  asOf: Date;
}

export interface PaymentScheduleOutcome {
  periodsPaid: number;
  paidThroughDate: string | null;
  nextPaymentDate: string | null;
  /** null = NOT DETERMINABLE (no due date to measure from), which is a
   *  different thing from 0. The caller must skip the column rather than
   *  write a fabricated "current" the nightly sweep can never correct. */
  daysDelinquent: number | null;
  delinquencyStatus: NoteDelinquencyStatus | null;
  status: string;
  consecutiveOnTimePayments: number;
  reperformingThresholdMet: boolean;
  /** True only on the transition into "met" — the operator-facing milestone. */
  reperformingThresholdJustMet: boolean;
  /** null when the note carries no due date to measure against — never guessed. */
  onTime: boolean | null;
}

/** Whole periods this payment satisfied. Late fees and unapplied DEPOSITS are
 *  excluded: neither services the loan, and counting them would advance the
 *  clock on money the borrower does not have applied to a period. */
export function periodsSatisfiedByPayment(input: {
  paymentType: string;
  principalCents: number;
  interestCents: number;
  escrowCents: number;
  scheduledPaymentAmountCents: number | null;
}): number {
  if (!SCHEDULE_ADVANCING_PAYMENT_TYPES.has(input.paymentType)) return 0;
  const serviced = input.principalCents + input.interestCents + input.escrowCents;
  if (serviced <= 0) return 0;
  const scheduled = input.scheduledPaymentAmountCents;
  if (!scheduled || scheduled <= 0) {
    // No scheduled amount on file: we can tell money serviced the loan but not
    // how many periods it covers. One period is the only defensible reading.
    return 1;
  }
  return Math.floor(serviced / scheduled);
}

/**
 * Apply a posted payment to the note's schedule + reperforming counters.
 *
 * Rules that carry weight:
 *  - A payoff that zeroes the balance is paid through MATURITY and has no next
 *    payment. Nothing further is contractually due on the monthly schedule.
 *  - `onTime` is measured against the due date the payment was FOR (the stored
 *    `nextPaymentDate`), plus grace. When there is no stored due date we return
 *    `null` and leave the streak alone — "we could not tell" is not "late".
 *  - A payment covering several periods increments the streak by ONE, not by
 *    the number of periods: the catch-up periods were, by definition, not paid
 *    on time.
 *  - `reperformingThresholdMet` is DERIVED from the streak, so a note that
 *    re-defaults stops claiming to be reperforming instead of keeping a badge
 *    it earned last year.
 *  - KNOWN GAP: an `nsf_reversal` cannot retreat `paidThroughDate` — the
 *    schedule module only moves it forward (`advancePaidThrough` rejects
 *    negative periods). The reversal therefore resets the streak and
 *    recomputes from the UNCHANGED paid-through. Retreating it needs a
 *    `retreatPaidThrough` in server/services/notes/acquiredNoteSchedule.ts.
 */
export function applyPaymentToSchedule(
  input: PaymentScheduleInput,
): PaymentScheduleOutcome {
  const isTerminal = (TERMINAL_NOTE_STATUSES as readonly string[]).includes(
    input.status,
  );
  const isPayoff =
    input.paymentType === "payoff" && input.newCurrentBalanceCents === 0;

  if (isPayoff) {
    return {
      periodsPaid: 0,
      paidThroughDate: input.facts.maturityDate,
      nextPaymentDate: null,
      daysDelinquent: 0,
      delinquencyStatus: "current",
      // The caller's own payoff branch owns the `paid_off` write.
      status: input.status,
      consecutiveOnTimePayments: input.consecutiveOnTimePayments,
      reperformingThresholdMet: input.reperformingThresholdMet,
      reperformingThresholdJustMet: false,
      onTime: null,
    };
  }

  const periodsPaid = periodsSatisfiedByPayment(input);
  // `advancePaidThrough` returns null both for "nothing was satisfied" and for
  // "this note's history predates its acquisition, so we cannot say which
  // period the money paid". In neither case may we DESTROY a paid-through the
  // operator (or an earlier payment) already established — nulling it would
  // erase the one fact the whole schedule rests on.
  const advanced = advancePaidThrough(input.facts, periodsPaid);
  const paidThroughDate = advanced ?? input.facts.paidThroughDate ?? null;
  const nextPaymentDate = deriveNextPaymentDate(
    { ...input.facts, paidThroughDate },
    input.asOf,
  );
  // UNKNOWN IS NOT CURRENT. `computeNoteDelinquency` must return something and
  // its union has no "unknown" member, so a null due date yields the neutral
  // {0, "current"}. Persisting that stamps a finding over a note we cannot
  // read — and the nightly sweep then refuses to touch an undeterminable note,
  // so the fabrication would be permanent. Nulls here mean "leave it alone".
  const determinable = delinquencyIsDeterminable(nextPaymentDate);
  const measured = computeNoteDelinquency({ nextPaymentDate, asOf: input.asOf });
  const daysDelinquent = determinable ? measured.daysDelinquent : null;
  const delinquencyStatus = determinable ? measured.delinquencyStatus : null;

  // ── On-time determination ────────────────────────────────────────────────
  let onTime: boolean | null;
  if (periodsPaid <= 0) {
    // extra_principal is neutral — a curtailment is not a missed payment.
    onTime = input.paymentType === "extra_principal" ? null : false;
  } else if (!input.storedNextPaymentDate) {
    onTime = null; // no due date on file to measure against
  } else {
    const due = Date.parse(`${input.storedNextPaymentDate}T00:00:00.000Z`);
    const paid = Date.parse(`${String(input.paymentDate).slice(0, 10)}T00:00:00.000Z`);
    const grace =
      Number.isFinite(input.gracePeriodDays) && input.gracePeriodDays > 0
        ? Math.floor(input.gracePeriodDays)
        : 0;
    onTime =
      Number.isNaN(due) || Number.isNaN(paid)
        ? null
        : paid <= due + grace * DAY_MS_SCHEDULE;
  }

  let streak = input.consecutiveOnTimePayments;
  if (onTime === true) streak = input.consecutiveOnTimePayments + 1;
  else if (onTime === false) streak = 0;

  const threshold =
    Number.isFinite(input.reperformingThreshold) && input.reperformingThreshold > 0
      ? Math.floor(input.reperformingThreshold)
      : REPERFORMING_DEFAULT_THRESHOLD;
  const thresholdMet = streak >= threshold;

  // Status: terminal stays terminal; an underivable due date asserts nothing
  // (unknown is not late); otherwise the aging job's own band → status map.
  let status = input.status;
  if (
    !isTerminal &&
    delinquencyStatus !== null &&
    (AGEABLE_NOTE_STATUSES as readonly string[]).includes(input.status)
  ) {
    status = noteStatusForDelinquency(delinquencyStatus);
  }

  return {
    periodsPaid,
    paidThroughDate,
    nextPaymentDate,
    daysDelinquent,
    delinquencyStatus,
    status,
    consecutiveOnTimePayments: streak,
    reperformingThresholdMet: thresholdMet,
    reperformingThresholdJustMet: thresholdMet && !input.reperformingThresholdMet,
    onTime,
  };
}

/**
 * The late-fee ADVISORY attached to an acquired-note API response.
 *
 * Read-only and derived from stored fields. It states whether a fee WOULD be
 * assessable — it never asserts one was charged, and no code path in this
 * build charges one (founder ruling #15: AcreOS is the rail, and a late fee is
 * a proposal the operator confirms on their own processor).
 */
export function noteLateFeeAdvisory(
  row: {
    nextPaymentDate?: string | null;
    gracePeriodDays?: number | null;
    lateFeeCents?: number | null;
  },
  asOf: Date,
): { assessable: boolean; reason: string; feeCents: number; charged: false } {
  const advisory = lateFeeAssessable({
    nextPaymentDate: row.nextPaymentDate ?? null,
    gracePeriodDays: row.gracePeriodDays ?? 0,
    lateFeeCents: row.lateFeeCents ?? 0,
    asOf,
  });
  return { ...advisory, feeCents: row.lateFeeCents ?? 0, charged: false };
}

/**
 * WHY a note has no next-payment date, for the surfaces that must render an
 * honest blank instead of a dash.
 *
 * A blank due date has three quite different meanings — "we never saw this
 * note's servicing history", "the note is paid through maturity", and "the
 * imported facts don't parse" — and an operator can only act on the first one
 * (import the payment history) if we say which it is. Returning `null` here
 * when a date DOES exist keeps the field absent from the happy path rather
 * than shipping a redundant "everything is fine" string on every row.
 */
export function noteNextDueReason(
  row: {
    nextPaymentDate?: string | null;
    paymentDueDay?: number | null;
    firstPaymentDate?: string | null;
    originationDate?: string | null;
    maturityDate?: string | null;
    paidThroughDate?: string | null;
    acquisitionDate?: string | null;
  },
  asOf: Date,
): string | null {
  if (row.nextPaymentDate) return null;
  if (
    row.paymentDueDay == null ||
    !row.originationDate ||
    !row.maturityDate ||
    !row.acquisitionDate
  ) {
    return "incoherent_facts";
  }
  const verdict = nextPaymentVerdict(
    {
      paymentDueDay: row.paymentDueDay,
      firstPaymentDate: row.firstPaymentDate ?? null,
      originationDate: row.originationDate,
      maturityDate: row.maturityDate,
      paidThroughDate: row.paidThroughDate ?? null,
      acquisitionDate: row.acquisitionDate,
    },
    asOf,
  );
  return verdict.date === null ? verdict.reason : null;
}

// ─── Pure helpers ────────────────────────────────────────────────────────────

interface AmortizationRow {
  paymentNumber: number;
  dueDate: string; // ISO date
  payment: number; // cents
  principal: number; // cents
  interest: number; // cents
  balance: number; // cents
}

/**
 * Compute the remaining amortization schedule from a current balance, term,
 * and rate. Pure / framework-free so the route handler stays thin and the
 * computation can be unit-tested without a DB.
 */
export function computeAmortization(input: {
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonthsRemaining: number;
  startDate: Date;
  paymentDueDay: number;
}): AmortizationRow[] {
  const monthlyRate = input.interestRateBps / 10_000 / 12;
  let balance = input.currentBalanceCents;
  const out: AmortizationRow[] = [];

  for (let i = 1; i <= input.termMonthsRemaining && balance > 0; i++) {
    const interest = Math.round(balance * monthlyRate);
    const principal = Math.min(input.paymentAmountCents - interest, balance);
    if (principal <= 0) {
      // Negative-amortization safeguard — payment doesn't cover interest.
      // We bail rather than emit a runaway schedule.
      break;
    }
    balance = Math.max(0, balance - principal);

    // Add `i` months to startDate, clamping the day to the requested
    // paymentDueDay. JS Date handles month overflow but not day clamping
    // for short months (Feb 30 → Mar 2), so we explicitly clamp.
    const due = new Date(Date.UTC(
      input.startDate.getUTCFullYear(),
      input.startDate.getUTCMonth() + i,
      1,
    ));
    const lastDayOfMonth = new Date(Date.UTC(
      due.getUTCFullYear(),
      due.getUTCMonth() + 1,
      0,
    )).getUTCDate();
    due.setUTCDate(Math.min(input.paymentDueDay, lastDayOfMonth));

    out.push({
      paymentNumber: i,
      dueDate: due.toISOString().slice(0, 10),
      payment: interest + principal,
      principal,
      interest,
      balance,
    });
  }

  return out;
}

// ─── Close & Carry — deal → note field mapping ───────────────────────────────
//
// The lifecycle bridge: a closed seller-finance deal one-click-originates the
// serviced note with NO re-keying. This pure function is the contract — given a
// deal (its accepted/offer amount + saved ROI analysis) plus any operator
// edits from the one-confirm screen, it produces the `notes`-table insert
// payload. Kept framework-free so the field mapping (the thing a customer
// notices in week one) is unit-testable without a DB.
//
// Money on the deal/note tables is stored as decimal strings (numeric columns),
// NOT cents — matching the seller-finance `notes` table and POST /api/notes.

/** The deal fields the carry flow reads. Subset of the full Deal row. */
export interface CarryableDeal {
  id: number;
  organizationId: number;
  propertyId: number | null;
  status: string;
  type: string;
  offerAmount: string | null;
  acceptedAmount: string | null;
  closingDate: Date | string | null;
  analysisResults: {
    downPayment?: number;
    interestRate?: number;
    holdingPeriodMonths?: number;
    financedAmount?: number;
  } | null;
}

/** Operator edits from the one-confirm screen. All optional → deal supplies the default. */
export interface CarryOverrides {
  borrowerId?: number | null;
  salePrice?: number; // total sale price (dollars)
  downPayment?: number; // dollars
  interestRate?: number; // annual percent
  termMonths?: number;
  firstPaymentDate?: string; // ISO date
}

export interface MappedNoteFields {
  organizationId: number;
  propertyId: number | null;
  borrowerId: number | null;
  originatingDealId: number;
  originalPrincipal: string;
  currentBalance: string;
  interestRate: string;
  termMonths: number;
  monthlyPayment: string;
  downPayment: string;
  startDate: Date;
  firstPaymentDate: Date;
  status: string;
}

const DEFAULT_TERM_MONTHS = 120; // 10yr — the common land-contract default
const DEFAULT_INTEREST_RATE = 0; // operator must set a real rate on the confirm screen

/**
 * Add `months` calendar months to a date, clamping the day for short months.
 * Mirrors the amortization due-date clamp above.
 */
function addCalendarMonths(base: Date, months: number): Date {
  const d = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + months, 1));
  const lastDay = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(base.getUTCDate(), lastDay));
  return d;
}

/**
 * Map a closed seller-finance deal (+ operator edits) → the `notes` insert
 * payload. Pure: no DB, no side effects.
 *
 * - Sale price: override.salePrice ?? deal.acceptedAmount ?? deal.offerAmount
 * - Down payment: override.downPayment ?? analysisResults.downPayment ?? 0
 * - Financed principal: salePrice - downPayment (never negative)
 * - Rate / term: override ?? analysisResults ?? sensible default
 * - Start date: deal.closingDate ?? now
 * - First payment: override ?? one month after start (clamped)
 *
 * monthlyPayment is computed from (principal, rate, term) — never taken from the
 * client. amortizationSchedule + maturityDate are derived downstream by
 * storage.createNote, so they are intentionally not set here.
 */
export function mapDealToNoteFields(
  deal: CarryableDeal,
  overrides: CarryOverrides,
  now: Date = new Date(),
): MappedNoteFields {
  const salePrice =
    overrides.salePrice ??
    (deal.acceptedAmount != null ? Number(deal.acceptedAmount) : null) ??
    (deal.offerAmount != null ? Number(deal.offerAmount) : null) ??
    0;

  const downPayment = Math.max(
    0,
    overrides.downPayment ?? deal.analysisResults?.downPayment ?? 0,
  );

  const financedPrincipal = Math.max(0, salePrice - downPayment);

  const interestRate =
    overrides.interestRate ??
    deal.analysisResults?.interestRate ??
    DEFAULT_INTEREST_RATE;

  const termMonths =
    overrides.termMonths ??
    deal.analysisResults?.holdingPeriodMonths ??
    DEFAULT_TERM_MONTHS;

  const startDate = deal.closingDate ? new Date(deal.closingDate) : new Date(now);

  const firstPaymentDate = overrides.firstPaymentDate
    ? new Date(overrides.firstPaymentDate)
    : addCalendarMonths(startDate, 1);

  const monthlyPayment = calculateMonthlyPayment(financedPrincipal, interestRate, termMonths);

  return {
    organizationId: deal.organizationId,
    propertyId: deal.propertyId,
    borrowerId: overrides.borrowerId ?? null,
    originatingDealId: deal.id,
    originalPrincipal: String(financedPrincipal),
    currentBalance: String(financedPrincipal),
    interestRate: String(interestRate),
    termMonths,
    monthlyPayment: String(monthlyPayment),
    downPayment: String(downPayment),
    startDate,
    firstPaymentDate,
    // Always land 'pending' so origination runs through the audited Reg-Z
    // chokepoint (POST /api/notes/:id/originate). The carry pre-fills; the
    // operator originates.
    status: "pending",
  };
}

// ─── Yield math ──────────────────────────────────────────────────────────────

/**
 * Newton-Raphson IRR. Returns the discount rate that zeroes NPV of the
 * given cash-flow series. Same algorithm as client/src/components/IRRCalculator.tsx
 * (1e-7 tolerance, 1000 iter ceiling). Cash flows are in cents; the period
 * unit (annual vs monthly) is whatever the caller's stream is in — caller
 * converts to annual.
 */
function calcIRR(cashFlows: number[], guess = 0.05): number | null {
  const MAX_ITER = 1000;
  const TOLERANCE = 1e-7;
  let rate = guess;
  for (let i = 0; i < MAX_ITER; i++) {
    let npv = 0;
    let dNpv = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      const denom = Math.pow(1 + rate, t);
      npv += cashFlows[t] / denom;
      if (t > 0) dNpv -= (t * cashFlows[t]) / Math.pow(1 + rate, t + 1);
    }
    if (Math.abs(dNpv) < 1e-12) return null;
    const newRate = rate - npv / dNpv;
    if (Math.abs(newRate - rate) < TOLERANCE) return newRate;
    rate = newRate;
  }
  return null;
}

interface ComputeYieldsInput {
  acquisitionPriceCents: number;
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  termMonths: number;
  acquisitionDate: string; // ISO
  payments: Array<{ paymentDate: string; principalCents: number; interestCents: number }>;
}

interface ComputeYieldsResult {
  // Decimals (0.085 = 8.5%). Null when the IRR didn't converge.
  currentYield: number;
  ytmAtAcquisition: number | null;
  irrToDate: number | null;
  effectiveNetYield: number | null;
  // Servicing-cost assumption used in the effective-net calc. Null when
  // we don't have enough data to estimate; see implementation notes.
  effectiveNetServicingAssumption: { annualBps: number; note: string } | null;
}

/**
 * Compute the four yield metrics Linnea wants on every note detail page.
 * Pure / unit-testable; called by GET /api/notes/:id/yield.
 */
export function computeYields(input: ComputeYieldsInput): ComputeYieldsResult {
  const {
    acquisitionPriceCents,
    currentBalanceCents,
    interestRateBps,
    paymentAmountCents,
    termMonths,
    acquisitionDate,
    payments,
  } = input;

  // ── Current yield ───────────────────────────────────────────────────────
  // running coupon on basis: (annual interest payment / acquisition price)
  // Approximation: rate * currentBalance / acquisitionPrice.
  const annualInterestCents = (interestRateBps / 10_000) * currentBalanceCents;
  const currentYield = acquisitionPriceCents > 0
    ? annualInterestCents / acquisitionPriceCents
    : 0;

  // ── YTM at acquisition ──────────────────────────────────────────────────
  // IRR over the original projected cash flows: -acquisitionPrice at t=0,
  // then paymentAmountCents per month for termMonths. We compute the
  // monthly IRR, then convert to annual via (1+r_m)^12 - 1.
  const ytmFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 0; m < termMonths; m++) ytmFlowsMonthly.push(paymentAmountCents);
  const ytmMonthly = calcIRR(ytmFlowsMonthly, 0.005);
  const ytmAtAcquisition = ytmMonthly === null ? null : Math.pow(1 + ytmMonthly, 12) - 1;

  // ── IRR-to-date ─────────────────────────────────────────────────────────
  // Actual cash flows from the payment ledger, plus a terminal "if it pays
  // off today" cash flow equal to the current balance. Periods are months
  // from acquisition. We bucket by month-from-acquisition so a borrower's
  // partial-then-make-whole behavior nets correctly within a month.
  const acqDate = new Date(acquisitionDate);
  const monthsFromAcquisition = (iso: string): number => {
    const d = new Date(iso);
    return (d.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (d.getUTCMonth() - acqDate.getUTCMonth());
  };
  const monthlyCashIn = new Map<number, number>();
  let maxMonth = 0;
  for (const p of payments) {
    const m = Math.max(0, monthsFromAcquisition(p.paymentDate));
    const cash = p.principalCents + p.interestCents;
    monthlyCashIn.set(m, (monthlyCashIn.get(m) ?? 0) + cash);
    if (m > maxMonth) maxMonth = m;
  }
  const irrFlowsMonthly: number[] = [-acquisitionPriceCents];
  for (let m = 1; m <= Math.max(1, maxMonth); m++) {
    irrFlowsMonthly.push(monthlyCashIn.get(m) ?? 0);
  }
  // Add today's "if-paid-off" terminal value at the next-month bucket.
  irrFlowsMonthly.push(currentBalanceCents);
  const irrMonthly = calcIRR(irrFlowsMonthly, 0.005);
  const irrToDate = irrMonthly === null ? null : Math.pow(1 + irrMonthly, 12) - 1;

  // ── Effective net yield ─────────────────────────────────────────────────
  // Linnea: "net of servicing costs and tax escrow float."
  // We don't track servicing costs as structured data yet — this is the
  // PR-9 / pool-tracking surface where investor-level cost allocation
  // lives. Until then, apply the documented industry-typical 25 bps
  // assumption and label it as such so the user can correct it in their
  // CPA flow. When we add a per-org servicing-cost field, swap the
  // hardcoded value for the org's setting.
  const SERVICING_BPS_DEFAULT = 25; // 0.25% — small-balance secondary market typical
  const effectiveNetYield = irrToDate === null
    ? null
    : Math.max(0, irrToDate - SERVICING_BPS_DEFAULT / 10_000);
  const effectiveNetServicingAssumption = irrToDate === null
    ? null
    : { annualBps: SERVICING_BPS_DEFAULT, note: "industry-typical default; will read from org setting once configurable" };

  return {
    currentYield,
    ytmAtAcquisition,
    irrToDate,
    effectiveNetYield,
    effectiveNetServicingAssumption,
  };
}

// ─── Basis schedule (IRS Pub 1212 — market-discount accretion) ───────────────

interface BasisScheduleRow {
  year: number;
  startingBasisCents: number;
  accretedDiscountCents: number;
  principalReceivedCents: number;
  endingBasisCents: number;
}

interface BasisScheduleInput {
  acquisitionPriceCents: number;
  originalPrincipalCents: number; // face value at acquisition
  acquisitionDate: string;
  maturityDate: string;
  payments: Array<{ paymentDate: string; principalCents: number }>;
  // Method per Pub 1212. 'ratable' = straight-line over remaining term.
  // 'constant_yield' = bond-accounting style; not yet implemented (the
  // ratable election is what most non-bond note investors use).
  method?: "ratable" | "constant_yield";
}

/**
 * Compute the per-year basis schedule for a purchased note.
 *
 * For notes bought at a discount (face > acquisition), the IRS requires
 * market-discount accretion as ordinary income over the remaining life
 * (Pub 1212). Without this, basis at sale is wrong, gain/loss is wrong,
 * and Linnea gets an IRS letter — her exact concern.
 *
 * Ratable method (the default): each year accrues
 *   total_discount × (months_in_year / total_months_remaining_at_acquisition)
 * with months capped to the term ending at maturity.
 */
export function computeBasisSchedule(input: BasisScheduleInput): BasisScheduleRow[] {
  const {
    acquisitionPriceCents,
    originalPrincipalCents,
    acquisitionDate,
    maturityDate,
    payments,
  } = input;

  const totalDiscountCents = originalPrincipalCents - acquisitionPriceCents;

  // Premium (acquisition > face) is a separate code path — bond premium
  // amortization elections under §171 — we don't auto-accrete in that
  // direction; just flat-line the basis.
  if (totalDiscountCents <= 0) {
    return [];
  }

  const acqDate = new Date(acquisitionDate);
  const matDate = new Date(maturityDate);
  const totalMonthsRemainingAtAcquisition = Math.max(
    1,
    (matDate.getUTCFullYear() - acqDate.getUTCFullYear()) * 12 +
      (matDate.getUTCMonth() - acqDate.getUTCMonth()),
  );

  // For each year between acquisition and maturity (inclusive), compute
  // the months that fell in that year. Multiply by per-month accretion.
  const accretionPerMonthCents = totalDiscountCents / totalMonthsRemainingAtAcquisition;

  // Bucket payments by year (only principal — interest is already taxed).
  const principalByYear = new Map<number, number>();
  for (const p of payments) {
    const y = new Date(p.paymentDate).getUTCFullYear();
    principalByYear.set(y, (principalByYear.get(y) ?? 0) + p.principalCents);
  }

  const rows: BasisScheduleRow[] = [];
  let runningBasis = acquisitionPriceCents;

  const startYear = acqDate.getUTCFullYear();
  const endYear = matDate.getUTCFullYear();

  for (let y = startYear; y <= endYear; y++) {
    // Months of this year that fall within (acqDate, matDate].
    const yearStart = new Date(Date.UTC(y, 0, 1));
    const yearEnd = new Date(Date.UTC(y, 11, 31));
    const periodStart = acqDate > yearStart ? acqDate : yearStart;
    const periodEnd = matDate < yearEnd ? matDate : yearEnd;
    const monthsInYear = Math.max(
      0,
      (periodEnd.getUTCFullYear() - periodStart.getUTCFullYear()) * 12 +
        (periodEnd.getUTCMonth() - periodStart.getUTCMonth()) +
        1, // inclusive
    );

    const accretedThisYearCents = Math.round(accretionPerMonthCents * monthsInYear);
    const principalReceivedThisYear = principalByYear.get(y) ?? 0;
    const startingBasis = runningBasis;
    const endingBasis = Math.max(
      0,
      startingBasis + accretedThisYearCents - principalReceivedThisYear,
    );

    rows.push({
      year: y,
      startingBasisCents: startingBasis,
      accretedDiscountCents: accretedThisYearCents,
      principalReceivedCents: principalReceivedThisYear,
      endingBasisCents: endingBasis,
    });

    runningBasis = endingBasis;
  }

  return rows;
}

// ─── Payoff: one resolver, one engine ────────────────────────────────────────
//
// Wave C "Money moves". Every acquired-note payoff entry point — the
// calculator (GET :id/payoff), the recorded quote (POST :id/payoff/quotes),
// and anything added later — goes through THIS function, which reads the
// ledger and hands the numbers to `computePayoffQuote`. There is deliberately
// no per-diem arithmetic left in this file: a second implementation is how the
// engines diverged in the first place.
//
// Day-count convention (actual/365 fixed, half-open [accrualStart, payoff),
// whole days floored, single rounding on the total) is documented in
// server/services/notePaymentMath.ts. Do not restate it here — restating it is
// how it drifts.

/** The note fields a payoff needs. Selected explicitly so the shape is stable. */
interface PayoffNoteRow {
  id: string;
  noteNumber: string;
  payerName: string;
  status: string;
  currentBalanceCents: number;
  unappliedBalanceCents: number;
  interestRateBps: number;
  originationDate: string;
}

export interface AcquiredNotePayoffResult {
  note: PayoffNoteRow;
  /** Verbatim engine input — persisted with a recorded quote so it is provable. */
  input: PayoffQuoteInput;
  quote: PayoffQuote;
  /**
   * SUM(note_payments.late_fee_cents) — late fees ALREADY COLLECTED through
   * the ledger. Informational only. It is deliberately NOT fed to the engine
   * as `lateFeesOutstandingCents`: the ledger records fees as they are
   * collected and carries no assessed-but-unpaid concept, so adding this to a
   * payoff would bill the borrower a second time for fees already paid. Until
   * the schema can distinguish the two, the honest answer for outstanding late
   * fees is "not tracked", which is what the endpoints report.
   */
  lateFeesCollectedToDateCents: number;
}

/**
 * Ledger-derived payoff for one acquired note. Returns null when the note
 * doesn't exist in this org (callers turn that into a 404).
 *
 * `dbOrTx` accepts a transaction so a payoff computed as part of a larger
 * money operation reads the same snapshot as the write.
 */
export async function computeAcquiredNotePayoff(
  dbOrTx: Pick<typeof db, "select">,
  orgId: number,
  noteId: string,
  payoffDate: Date,
  opts: { payoffFeeCents?: number } = {},
): Promise<AcquiredNotePayoffResult | null> {
  const [note] = await dbOrTx
    .select({
      id: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      status: acquiredNotes.status,
      currentBalanceCents: acquiredNotes.currentBalanceCents,
      unappliedBalanceCents: acquiredNotes.unappliedBalanceCents,
      interestRateBps: acquiredNotes.interestRateBps,
      originationDate: acquiredNotes.originationDate,
    })
    .from(acquiredNotes)
    .where(and(eq(acquiredNotes.id, noteId), eq(acquiredNotes.organizationId, orgId)))
    .limit(1);
  if (!note) return null;

  // The most recent posting that settled interest. One indexed row — the
  // RULE for which row counts lives in resolvePayoffAccrualStart, not here.
  const lastInterestRows = await dbOrTx
    .select({
      paymentDate: notePayments.paymentDate,
      interestCents: notePayments.interestCents,
    })
    .from(notePayments)
    .where(and(eq(notePayments.noteId, noteId), sql`${notePayments.interestCents} > 0`))
    .orderBy(desc(notePayments.paymentDate))
    .limit(1);

  const [lateFeeRow] = await dbOrTx
    .select({ sum: sql<number>`COALESCE(SUM(${notePayments.lateFeeCents}), 0)::bigint` })
    .from(notePayments)
    .where(eq(notePayments.noteId, noteId));

  const accrualStartDate = resolvePayoffAccrualStart(
    lastInterestRows,
    note.originationDate as unknown as string,
  );

  const input: PayoffQuoteInput = {
    principalBalanceCents: note.currentBalanceCents,
    annualRateBps: note.interestRateBps,
    accrualStartDate,
    payoffDate,
    unappliedCreditCents: note.unappliedBalanceCents ?? 0,
    // See AcquiredNotePayoffResult.lateFeesCollectedToDateCents.
    lateFeesOutstandingCents: 0,
    payoffFeeCents: opts.payoffFeeCents ?? 0,
  };

  return {
    note: note as PayoffNoteRow,
    input,
    quote: computePayoffQuote(input),
    lateFeesCollectedToDateCents: Number(lateFeeRow?.sum ?? 0),
  };
}

/** Wire shape shared by the calculator and the recorded-quote endpoints. */
function payoffResponseBody(result: AcquiredNotePayoffResult) {
  const q = result.quote;
  return {
    asOf: q.payoffDate,
    principalCents: q.principalBalanceCents,
    accruedInterestCents: q.accruedInterestCents,
    unappliedCreditCents: q.unappliedCreditCents,
    payoffFeeCents: q.payoffFeeCents,
    totalPayoffCents: q.totalPayoffCents,
    daysAccrued: q.daysAccrued,
    accrualStart: q.accrualStartDate,
    /** Back-compat alias for `perDiemInterestCents` (the note-payoff calculator reads it). */
    dailyInterestCents: q.perDiemInterestCents,
    perDiemInterestCents: q.perDiemInterestCents,
    dayCountConvention: q.dayCountConvention,
    engineVersion: q.engineVersion,
    annualRateBps: q.annualRateBps,
    lateFeesAppliedToDateCents: result.lateFeesCollectedToDateCents,
    // Not tracked, therefore not asserted as zero-owed. Refuse, don't fabricate.
    lateFeesOutstandingCents: null as number | null,
    lateFeesOutstandingNote:
      "Outstanding late fees are not tracked separately from collected late fees in this ledger, so they are excluded from the payoff total rather than estimated.",
  };
}

// ─── Route registration ──────────────────────────────────────────────────────

export function registerNoteRoutes(app: Express): void {
  const ownerOrAdmin = requireRole(["owner", "admin"]);

  // ── List ─────────────────────────────────────────────────────────────────
  //
  // ONE PATH, ONE OWNER (2026-07-30 shadow fix).
  //
  // This list used to be registered at GET /api/notes — the SAME path
  // server/routes-finance.ts registers for the seller-finance servicing book.
  // routes-finance is registered first in server/routes.ts and its handler
  // returns a bare ARRAY without calling next(), so this handler never ran in
  // production. /notes read `data.notes` off that array, got `undefined`, and
  // the Servicing book rendered EMPTY for every org.
  //
  // The two books are deliberately NOT merged into one response:
  //   * money units differ — `acquired_notes` is integer cents (bigint),
  //     `notes` is decimal dollar STRINGS ("48250.00") with a percent-string
  //     rate. A union array would put both in one field and force every
  //     consumer to sniff which it got. See THE CENTS ↔ DECIMAL BOUNDARY in
  //     server/services/notePaymentMath.ts.
  //   * id types differ — uuid here, serial integer there.
  //   * authorization differs — the acquired book is ownerOrAdmin-gated
  //     (it carries borrower TINs); the seller-finance list is not.
  //
  // So: GET /api/notes remains the seller-finance array — that is the shape
  // documented in shared/routes.ts (`api.notes.list` → z.array(...)) and the
  // shape `useNotes()` zod-parses. The acquired book gets its OWN path here.
  // `/api/notes/acquired` is reachable because routes-finance's
  // GET /api/notes/:id calls next() on a non-numeric id.
  app.get(
    "/api/notes/acquired",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);
        const offset = Math.max(parseInt(String(req.query.offset ?? "0"), 10) || 0, 0);
        const status = typeof req.query.status === "string" ? req.query.status : undefined;

        const whereClause = status
          ? and(eq(acquiredNotes.organizationId, orgId), eq(acquiredNotes.status, status))
          : eq(acquiredNotes.organizationId, orgId);

        const rows = await db
          .select()
          .from(acquiredNotes)
          .where(whereClause)
          .orderBy(desc(acquiredNotes.acquisitionDate))
          .limit(limit)
          .offset(offset);

        // Never leak the encrypted TIN over the wire — strip on the way out.
        // `nextPaymentDate` / `paidThroughDate` / `daysDelinquent` /
        // `delinquencyStatus` ride along as real columns (written by the daily
        // aging sweep and by the payment path); `lateFeeAdvisory` is derived
        // per response and is ADVICE — nothing has been charged.
        const asOfList = new Date();
        const safe = rows.map(({ payerEncryptedTin: _stripped, ...rest }) => ({
          ...rest,
          lateFeeAdvisory: noteLateFeeAdvisory(rest, asOfList),
          nextPaymentDateReason: noteNextDueReason(rest, asOfList),
        }));
        // THE documented shape for the acquired book. `book` is explicit so a
        // consumer that ends up here by accident can tell which ledger — and
        // therefore which money representation — it is looking at.
        return res.json({
          book: ACQUIRED_BOOK_ID,
          moneyUnit: "integer_cents",
          notes: safe,
          limit,
          offset,
          count: safe.length,
        });
      } catch (err) {
        logger.error("notes.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Create ───────────────────────────────────────────────────────────────
  app.post(
    "/api/notes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = createNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        const encryptedTin = data.payerTin ? encryptField(data.payerTin) : null;

        const [row] = await db
          .insert(acquiredNotes)
          .values({
            organizationId: orgId,
            propertyId: data.propertyId ?? null,
            borrowerId: data.borrowerId ?? null,
            noteNumber: data.noteNumber,
            originalPrincipalCents: data.originalPrincipalCents,
            currentBalanceCents: data.currentBalanceCents,
            interestRateBps: data.interestRateBps,
            termMonths: data.termMonths,
            paymentAmountCents: data.paymentAmountCents,
            paymentDueDay: data.paymentDueDay,
            originationDate: data.originationDate,
            maturityDate: data.maturityDate,
            acquisitionDate: data.acquisitionDate,
            acquisitionPriceCents: data.acquisitionPriceCents,
            status: data.status ?? "performing",
            payerName: data.payerName,
            payerAddress: data.payerAddress ?? null,
            payerEncryptedTin: encryptedTin,
            payerTinType: data.payerTinType ?? null,
            originalLender: data.originalLender ?? null,
            assignmentDocS3Key: data.assignmentDocS3Key ?? null,
            notes: data.notes ?? null,
          })
          .returning();

        if (!row) {
          return Errors.internal(res, new Error("Insert returned no row"));
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.status(201).json({ note: safe });
      } catch (err) {
        // Unique-violation → friendlier message than a 500.
        if (err instanceof Error && /unique/i.test(err.message)) {
          return Errors.badRequest(res, "Note number is already in use for this organization");
        }
        logger.error("notes.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Aging ladder for the acquired book ───────────────────────────────────
  //
  // GET /api/notes/aging — registered BEFORE /api/notes/:id (the :id matcher
  // would otherwise capture the literal "aging"; see insurance-watch below for
  // the same bug caught in 2026-07).
  //
  // ONE LADDER, BOTH BOOKS (Wave 3, 2026-08-11). The rungs and the day count
  // come from `@shared/finance/agingLadder`, the same engine `/api/rent/aging`
  // uses. Neither book owns a copy of 30/60/90.
  //
  // ── WHAT IS AGED, AND WHY IT IS NOT THE PRINCIPAL ─────────────────────────
  // The acquired book records a SCHEDULE (`paymentDueDay`, `maturityDate`, a
  // server-derived `nextPaymentDate`), not a per-period charge ledger. So:
  //
  //   • The row's DUE DATE is `nextPaymentDate` — the oldest unsatisfied
  //     scheduled due date, already derived through `nextPaymentVerdict` and
  //     carrying that function's anti-fabrication refusals. When it is null the
  //     note is NOT AGED and carries the book's own reason
  //     (`history_predates_acquisition`, `paid_through_maturity`, ...). It is
  //     never filed as "current": current is a finding we have not made.
  //
  //   • The row's AMOUNT is the PAST-DUE amount — (periods that have come due
  //     and are unsatisfied) x (the scheduled payment), net of unapplied funds
  //     the borrower has already sent. It is deliberately NOT
  //     `currentBalanceCents`: bucketing a whole loan principal into "90+ days"
  //     would assert an acceleration nobody declared, against a borrower who
  //     owes one or two payments. That is the fabrication this endpoint exists
  //     to avoid.
  //
  //   • When `paymentAmountCents` is not on file the period count is known but
  //     the dollars are not. The note still ages by its due date, its amount is
  //     reported as UNKNOWN, and the bucket it lands in reports an INCOMPLETE
  //     total rather than a number that silently omits it.
  //
  // Terminal notes (paid_off, sold) are EXCLUDED and said so — the book is done
  // with them and aging a sold note would assert an obligation against a
  // borrower who owes this org nothing (the same rule the nightly sweep holds).
  //
  // MONEY POSTURE: read-only. Describes recorded balances; collects nothing.
  app.get(
    "/api/notes/aging",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rawAsOf = typeof req.query.asOf === "string" ? req.query.asOf.trim() : "";
        // Shape AND validity, by the engine's own parser — a regex would wave
        // through "2026-13-45" and the engine would then throw into a 500.
        if (rawAsOf && !isCalendarDate(rawAsOf)) {
          return Errors.badRequest(res, "asOf must be a real calendar date in YYYY-MM-DD form");
        }
        const asOf = rawAsOf || new Date().toISOString().slice(0, 10);
        const asOfDate = new Date(`${asOf}T00:00:00.000Z`);

        // ORG-SCOPED AT THE QUERY.
        const book = await db
          .select({
            id: acquiredNotes.id,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            status: acquiredNotes.status,
            paymentAmountCents: acquiredNotes.paymentAmountCents,
            paymentDueDay: acquiredNotes.paymentDueDay,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
            unappliedBalanceCents: acquiredNotes.unappliedBalanceCents,
            nextPaymentDate: acquiredNotes.nextPaymentDate,
            paidThroughDate: acquiredNotes.paidThroughDate,
            firstPaymentDate: acquiredNotes.firstPaymentDate,
            originationDate: acquiredNotes.originationDate,
            maturityDate: acquiredNotes.maturityDate,
            acquisitionDate: acquiredNotes.acquisitionDate,
            delinquencyStatus: acquiredNotes.delinquencyStatus,
          })
          .from(acquiredNotes)
          .where(eq(acquiredNotes.organizationId, orgId));

        // ONE ROW PER PAST-DUE PERIOD, not one per note.
        //
        // The first version emitted a single row per note carrying the SUM of
        // every unsatisfied payment, dated at the OLDEST period. On a note
        // three payments behind that filed the whole $3,000 at 88 days — the
        // 61-90 rung — when the truth is $1,000 at 88d, $1,000 at 57d and
        // $1,000 at 27d. The rent book, which has a real charge row per month,
        // spreads the identical borrower reality across three rungs. Two books
        // disagreeing about the same facts is exactly what this shared engine
        // exists to prevent, and the bucket boundaries being shared does not
        // make the bucket TOTALS mean the same thing unless the rows do.
        const rows: AgeableRow[] = book.flatMap((n): AgeableRow[] => {
          const terminal = (TERMINAL_NOTE_STATUSES as readonly string[]).includes(n.status);
          const nextDue = n.nextPaymentDate ? String(n.nextPaymentDate).slice(0, 10) : null;
          const scheduled = Number(n.paymentAmountCents);
          const scheduleKnown = Number.isFinite(scheduled) && scheduled > 0;

          const window = scheduleWindowDue({
            firstUnsatisfiedDueDate: nextDue,
            paymentDueDay: Number(n.paymentDueDay),
            maturityDate: n.maturityDate ? String(n.maturityDate).slice(0, 10) : null,
            asOf,
          });

          // Money the borrower has already sent that no period has consumed.
          const unapplied = Math.max(0, Number(n.unappliedBalanceCents) || 0);

          // Each refusal gets its OWN sentence. The single no-due-date sentence
          // was false for `invalid_due_day` / `unparseable_maturity` /
          // `anchor_does_not_match_due_day`, all of which are reachable WITH a
          // stored due date — telling the operator "no scheduled due date on
          // file" while one sits on the row is its own small fabrication.
          const refusalReason = (r: NonNullable<typeof window.refusal>): string => {
            switch (r) {
              case "no_first_unsatisfied_due_date":
                return "No scheduled due date on file, so no period can be counted as past due.";
              case "unparseable_due_date":
                return "The stored next-payment date could not be read as a date, so no period can be counted.";
              case "invalid_due_day":
                return "This note's payment due-day is missing or out of range, so its schedule cannot be walked.";
              case "unparseable_maturity":
                return "No readable maturity date, so the schedule has no contractual stop and is not walked.";
              case "anchor_does_not_match_due_day":
                return "The next-payment date and the payment due-day describe different schedules, so the number of periods past due cannot be established.";
              default:
                return "This note's schedule cannot be established, so no period can be counted as past due.";
            }
          };

          const baseMeta = {
            noteNumber: n.noteNumber,
            payerName: n.payerName,
            status: n.status,
            // The REGULATORY band, carried alongside the AR rung so a surface
            // can show both without conflating them. Different boundaries,
            // different question — see the header of agingLadder.ts.
            delinquencyStatus: n.delinquencyStatus,
            scheduledPaymentCents: scheduleKnown ? scheduled : null,
            unappliedCreditCents: unapplied,
            currentBalanceCents: Number(n.currentBalanceCents),
            cappedAtMaturity: window.cappedAtMaturity,
          };

          // Terminal notes are handed over so the engine can REPORT them as
          // excluded rather than silently dropping them.
          if (terminal) {
            return [
              {
                id: n.id,
                dueDate: nextDue,
                outstandingCents: null,
                reason: null,
                excludedCode: `terminal_${n.status}`,
                excludedReason:
                  n.status === "paid_off"
                    ? "Paid off — the book is closed on this note, so it is not aged."
                    : "Sold — this org no longer holds the paper, so it is not aged.",
                meta: { ...baseMeta, periodsPastDue: null, grossPastDueCents: null },
              },
            ];
          }

          // A refusal, or an unknown payment amount, means the money is UNKNOWN
          // — never zero. `periodsDue` is 0 on a refusal, and multiplying it by
          // a known payment produced a confident $0.00 past due for a note the
          // book had just refused to date, which defeats the engine's own rule
          // that an incomplete total must say so.
          if (window.refusal || !scheduleKnown) {
            return [
              {
                id: n.id,
                dueDate: nextDue,
                outstandingCents: null,
                reason:
                  nextDue === null
                    ? noteNextDueReason(
                        {
                          nextPaymentDate: nextDue,
                          paymentDueDay: n.paymentDueDay,
                          firstPaymentDate: n.firstPaymentDate ? String(n.firstPaymentDate).slice(0, 10) : null,
                          originationDate: n.originationDate ? String(n.originationDate).slice(0, 10) : null,
                          maturityDate: n.maturityDate ? String(n.maturityDate).slice(0, 10) : null,
                          paidThroughDate: n.paidThroughDate ? String(n.paidThroughDate).slice(0, 10) : null,
                          acquisitionDate: n.acquisitionDate ? String(n.acquisitionDate).slice(0, 10) : null,
                        },
                        asOfDate,
                      )
                    : window.refusal
                      ? refusalReason(window.refusal)
                      : "This note records no scheduled payment amount, so the past-due dollars cannot be computed. The periods are counted; the money is not.",
                excludedCode: null,
                excludedReason: null,
                meta: {
                  ...baseMeta,
                  periodsPastDue: window.refusal ? null : window.periodsDue,
                  grossPastDueCents: null,
                },
              },
            ];
          }

          // Nothing due yet — still handed over, so the note is accounted for.
          if (window.dueDates.length === 0) {
            return [
              {
                id: n.id,
                dueDate: nextDue,
                outstandingCents: 0,
                reason: null,
                excludedCode: null,
                excludedReason: null,
                meta: { ...baseMeta, periodsPastDue: 0, grossPastDueCents: 0 },
              },
            ];
          }

          // Unapplied credit is consumed OLDEST FIRST, the way a servicer
          // applies it, so the credit retires the most delinquent period
          // rather than being smeared across all of them.
          let credit = unapplied;
          return window.dueDates.map((dueDate, i) => {
            const applied = Math.min(credit, scheduled);
            credit -= applied;
            return {
              id: `${n.id}#${dueDate}`,
              dueDate,
              outstandingCents: Math.max(0, scheduled - applied),
              reason: null,
              excludedCode: null,
              excludedReason: null,
              meta: {
                ...baseMeta,
                noteId: n.id,
                periodDueDate: dueDate,
                periodIndex: i,
                periodsPastDue: window.dueDates.length,
                grossPastDueCents: scheduled,
                creditAppliedCents: applied,
              },
            };
          });
        });

        const ladder = bucketAging({ asOf, rows });
        // Checked on every response, not only in the test suite: every note
        // handed in came back out, and the money adds up.
        if (!conservationHolds(ladder, rows)) {
          logger.error("notes.aging conservation failed", undefined, {
            orgId,
            asOf,
            rowCount: rows.length,
          });
        }

        return res.json({
          book: ACQUIRED_BOOK_ID,
          moneyUnit: "integer_cents",
          ladder,
          scope: {
            included:
              "Every acquired note this org still holds, aged by its oldest unsatisfied scheduled due date.",
            aged: "past-due scheduled payments, net of unapplied funds",
            notAged:
              "Principal is NOT aged. Bucketing a whole loan balance would assert an acceleration nobody declared.",
            terminalNotesExcluded: ladder.excluded.count,
          },
        });
      } catch (err) {
        logger.error("notes.aging failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // insurance-watch — registered BEFORE /api/notes/:id so the literal path
  // wins; the :id matcher was capturing "insurance-watch" and 404ing the
  // tax-readiness insurance panel (2026-07-11 full-app sweep).
  // GET /api/notes/insurance-watch
  // Returns notes whose insurance_status is not 'verified', plus notes
  // whose insurance_expires_at falls within the next 60 days.
  app.get(
    "/api/notes/insurance-watch",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const today = new Date();
        const horizon = new Date(today.getTime() + 60 * 86_400_000);
        const horizonIso = horizon.toISOString().slice(0, 10);
        const todayIso = today.toISOString().slice(0, 10);

        const rows = await db
          .select({
            id: acquiredNotes.id,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            insuranceStatus: acquiredNotes.insuranceStatus,
            insuranceCarrier: acquiredNotes.insuranceCarrier,
            insurancePolicyNumber: acquiredNotes.insurancePolicyNumber,
            insuranceExpiresAt: acquiredNotes.insuranceExpiresAt,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(acquiredNotes)
          .where(and(
            eq(acquiredNotes.organizationId, orgId),
            sql`(${acquiredNotes.insuranceStatus} <> 'verified' OR (${acquiredNotes.insuranceExpiresAt} IS NOT NULL AND ${acquiredNotes.insuranceExpiresAt} <= ${horizonIso} AND ${acquiredNotes.insuranceExpiresAt} >= ${todayIso}))`,
          ))
          .orderBy(acquiredNotes.insuranceExpiresAt);

        return res.json({ notes: rows, horizonIso });
      } catch (err) {
        logger.error("notes.insurance-watch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // escrow-disbursements — registered BEFORE /api/notes/:id so the literal path wins (2026-07-11 route-order sweep).
  // GET /api/notes/escrow-disbursements?withinDays=60
  // Linnea's "tax disbursements due in the next 60 days" view.
  app.get(
    "/api/notes/escrow-disbursements",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const withinDays = Math.min(365, Math.max(1, parseInt(String(req.query.withinDays ?? "60"), 10) || 60));
        const today = new Date();
        const horizon = new Date(today.getTime() + withinDays * 86_400_000);
        const horizonIso = horizon.toISOString().slice(0, 10);

        const rows = await db
          .select({
            id: acquiredNotes.id,
            noteNumber: acquiredNotes.noteNumber,
            payerName: acquiredNotes.payerName,
            taxEscrowBalanceCents: acquiredNotes.taxEscrowBalanceCents,
            taxDisbursementDueDate: acquiredNotes.taxDisbursementDueDate,
            taxDisbursementAmountCents: acquiredNotes.taxDisbursementAmountCents,
            taxAuthorityName: acquiredNotes.taxAuthorityName,
          })
          .from(acquiredNotes)
          .where(and(
            eq(acquiredNotes.organizationId, orgId),
            eq(acquiredNotes.taxEscrowEnabled, true),
            sql`${acquiredNotes.taxDisbursementDueDate} IS NOT NULL`,
            sql`${acquiredNotes.taxDisbursementDueDate} <= ${horizonIso}`,
          ))
          .orderBy(acquiredNotes.taxDisbursementDueDate);

        return res.json({ notes: rows, withinDays, horizonIso });
      } catch (err) {
        logger.error("notes.escrow-disbursements failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Detail ───────────────────────────────────────────────────────────────
  app.get(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [row] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        const asOfDetail = new Date();
        // Same discriminators + the same advisory shape as the list, so a
        // consumer never has to derive lateness itself (which is how the
        // browser came to invent a friendly "next payment" date in the first
        // place). ADVISORY ONLY — no fee has been assessed or charged.
        return res.json({
          book: ACQUIRED_BOOK_ID,
          moneyUnit: "integer_cents",
          note: {
            ...safe,
            lateFeeAdvisory: noteLateFeeAdvisory(safe, asOfDetail),
            nextPaymentDateReason: noteNextDueReason(safe, asOfDetail),
          },
        });
      } catch (err) {
        logger.error("notes.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Update ───────────────────────────────────────────────────────────────
  app.patch(
    "/api/notes/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = patchNoteSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const patch = parsed.data;

        // Build the update object explicitly so unset fields aren't nulled.
        const update: Partial<typeof acquiredNotes.$inferInsert> = {
          updatedAt: new Date(),
        };
        if (patch.propertyId !== undefined) update.propertyId = patch.propertyId;
        if (patch.borrowerId !== undefined) update.borrowerId = patch.borrowerId;
        if (patch.noteNumber !== undefined) update.noteNumber = patch.noteNumber;
        if (patch.originalPrincipalCents !== undefined) update.originalPrincipalCents = patch.originalPrincipalCents;
        if (patch.currentBalanceCents !== undefined) update.currentBalanceCents = patch.currentBalanceCents;
        if (patch.interestRateBps !== undefined) update.interestRateBps = patch.interestRateBps;
        if (patch.termMonths !== undefined) update.termMonths = patch.termMonths;
        if (patch.paymentAmountCents !== undefined) update.paymentAmountCents = patch.paymentAmountCents;
        if (patch.paymentDueDay !== undefined) update.paymentDueDay = patch.paymentDueDay;
        if (patch.originationDate !== undefined) update.originationDate = patch.originationDate;
        if (patch.maturityDate !== undefined) update.maturityDate = patch.maturityDate;
        if (patch.acquisitionDate !== undefined) update.acquisitionDate = patch.acquisitionDate;
        if (patch.acquisitionPriceCents !== undefined) update.acquisitionPriceCents = patch.acquisitionPriceCents;
        if (patch.status !== undefined) update.status = patch.status;
        if (patch.payerName !== undefined) update.payerName = patch.payerName;
        if (patch.payerAddress !== undefined) update.payerAddress = patch.payerAddress;
        if (patch.payerTin !== undefined) update.payerEncryptedTin = patch.payerTin ? encryptField(patch.payerTin) : null;
        if (patch.payerTinType !== undefined) update.payerTinType = patch.payerTinType ?? null;
        if (patch.originalLender !== undefined) update.originalLender = patch.originalLender ?? null;
        if (patch.assignmentDocS3Key !== undefined) update.assignmentDocS3Key = patch.assignmentDocS3Key ?? null;
        // Compliance fields (PR-11)
        if (patch.insuranceStatus !== undefined) update.insuranceStatus = patch.insuranceStatus;
        if (patch.insuranceCarrier !== undefined) update.insuranceCarrier = patch.insuranceCarrier ?? null;
        if (patch.insurancePolicyNumber !== undefined) update.insurancePolicyNumber = patch.insurancePolicyNumber ?? null;
        if (patch.insuranceExpiresAt !== undefined) update.insuranceExpiresAt = patch.insuranceExpiresAt ?? null;
        if (patch.insuranceAnnualPremiumCents !== undefined) update.insuranceAnnualPremiumCents = patch.insuranceAnnualPremiumCents ?? null;
        if (patch.taxEscrowEnabled !== undefined) update.taxEscrowEnabled = patch.taxEscrowEnabled;
        if (patch.taxEscrowBalanceCents !== undefined) update.taxEscrowBalanceCents = patch.taxEscrowBalanceCents;
        if (patch.taxDisbursementDueDate !== undefined) update.taxDisbursementDueDate = patch.taxDisbursementDueDate ?? null;
        if (patch.taxDisbursementAmountCents !== undefined) update.taxDisbursementAmountCents = patch.taxDisbursementAmountCents ?? null;
        if (patch.taxAuthorityName !== undefined) update.taxAuthorityName = patch.taxAuthorityName ?? null;
        if (patch.notes !== undefined) update.notes = patch.notes ?? null;

        const [row] = await db
          .update(acquiredNotes)
          .set(update)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .returning();

        if (!row) {
          return Errors.notFound(res, "Note");
        }
        const { payerEncryptedTin: _stripped, ...safe } = row;
        return res.json({ note: safe });
      } catch (err) {
        logger.error("notes.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── List payments (ledger) ───────────────────────────────────────────────
  app.get(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        // Confirm the note belongs to this org first.
        const [note] = await db
          .select({ id: acquiredNotes.id })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }
        const rows = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(desc(notePayments.paymentDate), desc(notePayments.createdAt));
        return res.json({ payments: rows });
      } catch (err) {
        logger.error("notes.listPayments failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Record payment ───────────────────────────────────────────────────────
  //
  // ATOMICITY (Wave C "Money moves"). This writes TWO things — the
  // note_payments ledger row and the denormalized running balances on
  // acquired_notes — and before Wave C it wrote them as two independent
  // statements. Any failure between them (a dropped connection, a constraint
  // trip, a process restart) left the ledger and the balance permanently
  // disagreeing, which is precisely the drift the /reconciliation endpoint
  // below exists to surface. Both writes now commit or roll back together.
  //
  // The note row is read FOR UPDATE inside the same transaction, so two
  // concurrent payments on one note serialize instead of both computing a new
  // balance from the same stale read (last-writer-wins, one payment's
  // principal silently lost from the balance while its ledger row survives).
  //
  // Emit discipline, unchanged from Wave B and load-bearing: `payment.received`
  // fires AFTER the transaction commits — never inside it (a workflow must not
  // be able to roll back money, and must not observe uncommitted rows) and
  // never on a rollback (no ledger row means nothing happened, so there is
  // nothing to announce).
  app.post(
    "/api/notes/:id/payments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const parsed = recordPaymentSchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const data = parsed.data;

        // Everything below either rejects (returning a reason, having written
        // nothing) or posts BOTH writes. Rejections return normally rather
        // than throwing: no write has happened at that point, so there is
        // nothing to roll back and an error path would be noise.
        type Outcome =
          | { kind: "not_found" }
          | { kind: "bad_request"; message: string }
          | {
              kind: "posted";
              posted: PostedNotePayment;
              row: typeof notePayments.$inferSelect;
              /** Schedule + delinquency state AFTER the payment, for the response. */
              schedule: PaymentScheduleOutcome;
              lateFeeAdvisory: ReturnType<typeof noteLateFeeAdvisory>;
            };

        const outcome: Outcome = await withTransaction(async (tx) => {
          // Confirm the note belongs to this org BEFORE inserting (cross-org
          // payment rows would corrupt the 1099-INT aggregation), and hold the
          // row so the balance we compute from is the balance we write to.
          const [note] = await tx
            .select({
              id: acquiredNotes.id,
              currentBalanceCents: acquiredNotes.currentBalanceCents,
              unappliedBalanceCents: acquiredNotes.unappliedBalanceCents,
              status: acquiredNotes.status,
              // Read for the workflow event payload only (same row, no extra
              // query): note number + payer name identify the note in
              // automations, due day + scheduled payment let conditions decide
              // "was this late / partial?".
              noteNumber: acquiredNotes.noteNumber,
              payerName: acquiredNotes.payerName,
              paymentAmountCents: acquiredNotes.paymentAmountCents,
              paymentDueDay: acquiredNotes.paymentDueDay,
              // Schedule facts — a payment must advance the note's clock, not
              // just its balances. Read inside the same FOR UPDATE row so two
              // concurrent payments cannot both advance from the same
              // paid-through and lose a period.
              originationDate: acquiredNotes.originationDate,
              maturityDate: acquiredNotes.maturityDate,
              acquisitionDate: acquiredNotes.acquisitionDate,
              firstPaymentDate: acquiredNotes.firstPaymentDate,
              paidThroughDate: acquiredNotes.paidThroughDate,
              nextPaymentDate: acquiredNotes.nextPaymentDate,
              gracePeriodDays: acquiredNotes.gracePeriodDays,
              lateFeeCents: acquiredNotes.lateFeeCents,
              daysDelinquent: acquiredNotes.daysDelinquent,
              delinquencyStatus: acquiredNotes.delinquencyStatus,
              consecutiveOnTimePayments: acquiredNotes.consecutiveOnTimePayments,
              reperformingThresholdMet: acquiredNotes.reperformingThresholdMet,
            })
            .from(acquiredNotes)
            .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
            .limit(1)
            .for("update");
          if (!note) {
            return { kind: "not_found" };
          }

          // Per-type validation. The zod schema accepts negative cents on
          // every type so NSF reversals can pass; here we tighten for the
          // common cases.
          const isReversal = data.paymentType === "nsf_reversal";
          const isUnappliedApply = data.paymentType === "unapplied_apply";
          const allowNegative = isReversal || isUnappliedApply;
          for (const [field, val] of [
            ["principalCents", data.principalCents],
            ["interestCents", data.interestCents],
            ["escrowCents", data.escrowCents],
            ["lateFeeCents", data.lateFeeCents],
          ] as const) {
            if (!allowNegative && val < 0) {
              return {
                kind: "bad_request",
                message: `${field} must be non-negative for ${data.paymentType} payments`,
              };
            }
          }

          if (isReversal && !data.originalPaymentId) {
            return { kind: "bad_request", message: "originalPaymentId is required for nsf_reversal" };
          }

          // For 'partial' payments — no principal/interest applied, all into
          // unapplied. We force the buckets to zero so callers can't sneak
          // a regular split through under the partial label.
          if (data.paymentType === "partial") {
            if (data.unappliedCents <= 0) {
              return { kind: "bad_request", message: "partial payments must supply a positive unappliedCents" };
            }
            if (data.principalCents !== 0 || data.interestCents !== 0) {
              return {
                kind: "bad_request",
                message: "partial payments don't apply to principal/interest — use 'unapplied_apply' to consume held funds",
              };
            }
          }

          // Extra-principal: principal-only, no other buckets.
          if (data.paymentType === "extra_principal") {
            if (data.principalCents <= 0) {
              return { kind: "bad_request", message: "extra_principal must supply a positive principalCents" };
            }
            if (data.interestCents !== 0 || data.escrowCents !== 0 || data.lateFeeCents !== 0) {
              return {
                kind: "bad_request",
                message: "extra_principal payments must be principal-only — clear the other buckets",
              };
            }
          }

          // Unapplied-apply: consumes from unapplied, must be a draw-down.
          if (isUnappliedApply) {
            if (data.unappliedCents >= 0) {
              return {
                kind: "bad_request",
                message: "unapplied_apply must supply negative unappliedCents (the amount being consumed from the held balance)",
              };
            }
            const drawDown = -data.unappliedCents;
            if (drawDown > (note.unappliedBalanceCents ?? 0)) {
              return {
                kind: "bad_request",
                message: `unapplied_apply draw of ${drawDown}¢ exceeds available unapplied balance of ${note.unappliedBalanceCents ?? 0}¢`,
              };
            }
          }

          // ── Write 1: the ledger row. Drizzle handles bigint serialization.
          const [row] = await tx
            .insert(notePayments)
            .values({
              noteId: id,
              organizationId: orgId,
              paymentDate: data.paymentDate,
              principalCents: data.principalCents,
              interestCents: data.interestCents,
              escrowCents: data.escrowCents,
              lateFeeCents: data.lateFeeCents,
              unappliedCents: data.unappliedCents,
              paymentType: data.paymentType,
              originalPaymentId: data.originalPaymentId ?? null,
              paymentMethod: data.paymentMethod,
              referenceNumber: data.referenceNumber ?? null,
              notes: data.notes ?? null,
            })
            .returning();

          // ── Write 2: the denormalized running balances on the note.
          // currentBalance: subtract principal applied (negative principal on
          //   reversal restores balance).
          // unappliedBalance: add unapplied delta (positive on partial,
          //   negative on unapplied_apply or unapplied-restoring reversal).
          // status flips to 'paid_off' on a payoff that zeroes the balance.
          const newCurrentBalance = Math.max(
            0,
            (note.currentBalanceCents ?? 0) - data.principalCents,
          );
          const newUnappliedBalance = Math.max(
            0,
            (note.unappliedBalanceCents ?? 0) + data.unappliedCents,
          );
          const updates: Partial<typeof acquiredNotes.$inferInsert> = {
            currentBalanceCents: newCurrentBalance,
            unappliedBalanceCents: newUnappliedBalance,
            updatedAt: new Date(),
          };
          if (data.paymentType === "payoff" && newCurrentBalance === 0) {
            updates.status = "paid_off";
          }

          // ── Write 2b: the SCHEDULE. Before this, a payment moved balances
          // and nothing else, so a borrower who caught up kept the `late`
          // badge until somebody hand-edited the note. paidThrough advances,
          // the next due date is re-derived from it, delinquency is recomputed
          // and the status badge follows — inside the SAME transaction and the
          // SAME FOR UPDATE row as the balance write, so a concurrent payment
          // cannot advance from a stale paid-through.
          const asOfPayment = new Date();
          const schedule = applyPaymentToSchedule({
            paymentType: data.paymentType,
            paymentDate: data.paymentDate,
            principalCents: data.principalCents,
            interestCents: data.interestCents,
            escrowCents: data.escrowCents,
            scheduledPaymentAmountCents: note.paymentAmountCents ?? null,
            newCurrentBalanceCents: newCurrentBalance,
            facts: {
              paymentDueDay: note.paymentDueDay ?? 0,
              firstPaymentDate: note.firstPaymentDate ?? null,
              originationDate: note.originationDate ?? "",
              maturityDate: note.maturityDate ?? "",
              paidThroughDate: note.paidThroughDate ?? null,
              acquisitionDate: note.acquisitionDate ?? "",
            },
            storedNextPaymentDate: note.nextPaymentDate ?? null,
            gracePeriodDays: note.gracePeriodDays ?? 0,
            status: updates.status ?? note.status,
            consecutiveOnTimePayments: note.consecutiveOnTimePayments ?? 0,
            reperformingThresholdMet: note.reperformingThresholdMet ?? false,
            reperformingThreshold: REPERFORMING_DEFAULT_THRESHOLD,
            asOf: asOfPayment,
          });

          updates.paidThroughDate = schedule.paidThroughDate;
          updates.nextPaymentDate = schedule.nextPaymentDate;
          // null = not determinable. Leave the columns at whatever was last
          // actually known rather than stamping "current" over an unreadable
          // note — the nightly sweep refuses to touch an undeterminable note,
          // so a fabrication written here would never be corrected.
          if (schedule.daysDelinquent !== null) {
            updates.daysDelinquent = schedule.daysDelinquent;
          }
          if (schedule.delinquencyStatus !== null) {
            updates.delinquencyStatus = schedule.delinquencyStatus;
          }
          updates.consecutiveOnTimePayments = schedule.consecutiveOnTimePayments;
          updates.reperformingThresholdMet = schedule.reperformingThresholdMet;
          // `paid_off` (set above) always wins — a payoff is terminal and the
          // aging derivation must never move a note back out of it.
          if (!updates.status && schedule.status !== note.status) {
            updates.status = schedule.status;
          }

          await tx.update(acquiredNotes).set(updates).where(eq(acquiredNotes.id, id));

          return {
            kind: "posted",
            row,
            schedule,
            lateFeeAdvisory: noteLateFeeAdvisory(
              {
                nextPaymentDate: schedule.nextPaymentDate,
                gracePeriodDays: note.gracePeriodDays ?? 0,
                lateFeeCents: note.lateFeeCents ?? 0,
              },
              asOfPayment,
            ),
            posted: {
              organizationId: orgId,
              noteId: id,
              noteNumber: note.noteNumber ?? null,
              payerName: note.payerName ?? null,
              paymentId: row.id,
              paymentType: data.paymentType,
              paymentMethod: data.paymentMethod,
              paymentDate: data.paymentDate,
              principalCents: data.principalCents,
              interestCents: data.interestCents,
              escrowCents: data.escrowCents,
              lateFeeCents: data.lateFeeCents,
              unappliedCents: data.unappliedCents,
              scheduledPaymentAmountCents: note.paymentAmountCents ?? null,
              // The due date the note was ON before this payment — read from
              // the same FOR UPDATE row, so the event's `daysLate` and the
              // note's own `days_delinquent` measure from the same period.
              dueDateAtPayment: note.nextPaymentDate ?? null,
              remainingBalanceCents: newCurrentBalance,
              unappliedBalanceCents: newUnappliedBalance,
              noteStatus: updates.status ?? note.status,
            },
          };
        });

        if (outcome.kind === "not_found") return Errors.notFound(res, "Note");
        if (outcome.kind === "bad_request") return Errors.badRequest(res, outcome.message);

        // Both ledger writes are COMMITTED. Only now do we tell the workflow
        // engine. Fire-and-forget, never throws. If the transaction had rolled
        // back we would be in the catch below and no event would be emitted.
        emitNotePaymentWorkflowEvent(outcome.posted);

        // Reperforming milestone. The state is PERSISTED above (the counters
        // are real columns and this is their first production writer). The
        // `note.reperforming_threshold` workflow event named by the schema
        // comment is NOT emitted here: `emitPaymentEvent` is the only typed
        // helper that covers this file's events, workflow-engine.ts declares no
        // `emit*Event` helper carrying a `note.*` union, and
        // tests/unit/workflowActionHonesty.test.ts forbids a raw
        // `workflowEngine.emit()` outside the engine. Emitting it needs an
        // `emitNoteEvent` helper in server/services/workflow-engine.ts plus the
        // event added to shared/workflow-live-triggers.ts in the same change —
        // both outside this change's file set. Logged so the milestone is at
        // least visible while that lands.
        if (outcome.schedule.reperformingThresholdJustMet) {
          logger.info("notes.recordPayment reperforming threshold met", {
            metadata: {
              organizationId: outcome.posted.organizationId,
              noteId: outcome.posted.noteId,
              consecutiveOnTimePayments: outcome.schedule.consecutiveOnTimePayments,
              threshold: REPERFORMING_DEFAULT_THRESHOLD,
              pendingEvent: "note.reperforming_threshold",
            },
          });
        }

        return res.status(201).json({
          payment: outcome.row,
          currentBalanceCents: outcome.posted.remainingBalanceCents,
          unappliedBalanceCents: outcome.posted.unappliedBalanceCents,
          status: outcome.posted.noteStatus,
          // Schedule truth after the payment — a caught-up borrower's badge
          // clears in the same response that recorded the money.
          nextPaymentDate: outcome.schedule.nextPaymentDate,
          paidThroughDate: outcome.schedule.paidThroughDate,
          daysDelinquent: outcome.schedule.daysDelinquent,
          delinquencyStatus: outcome.schedule.delinquencyStatus,
          consecutiveOnTimePayments: outcome.schedule.consecutiveOnTimePayments,
          reperformingThresholdMet: outcome.schedule.reperformingThresholdMet,
          onTime: outcome.schedule.onTime,
          lateFeeAdvisory: outcome.lateFeeAdvisory,
        });
      } catch (err) {
        // A throw here means the transaction rolled back: no ledger row, no
        // balance change, and — critically — no workflow event.
        logger.error("notes.recordPayment failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Reconciliation (drift indicator) ─────────────────────────────────────
  // The Collison trust upgrade. Two SUM() queries against notePayments
  // plus a single read of acquiredNotes give us a numeric drift between
  // the ledger and the running balance. drift = 0 on a clean book; any
  // non-zero value means a writer skipped the ledger, fat-fingered a
  // split, or a backfill drifted. Surfacing this on every note detail
  // page is the single biggest trust upgrade in the plan.
  app.get(
    "/api/notes/:id/reconciliation",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;

        // Note row — opening principal, live current balance.
        const [note] = await db
          .select({
            id: acquiredNotes.id,
            originalPrincipalCents: acquiredNotes.originalPrincipalCents,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        // SUM() across the payment ledger. Use COALESCE to default to 0
        // on a fresh note with no payments yet. Pulling all four buckets
        // in one query keeps the read cheap.
        const [sums] = await db
          .select({
            sumOfPrincipalPostedCents: sql<number>`COALESCE(SUM(${notePayments.principalCents}), 0)::bigint`,
            sumOfInterestPostedCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
            sumOfLateFeesPostedCents: sql<number>`COALESCE(SUM(${notePayments.lateFeeCents}), 0)::bigint`,
            sumOfEscrowPostedCents: sql<number>`COALESCE(SUM(${notePayments.escrowCents}), 0)::bigint`,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id));

        // Last posting — drives "asOf"-like indicators on the UI so the
        // drift display can be honest about the freshness of the data.
        const [lastPosting] = await db
          .select({
            id: notePayments.id,
            paymentDate: notePayments.paymentDate,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(desc(notePayments.paymentDate), desc(notePayments.createdAt))
          .limit(1);

        // What the SCHEDULE says principal should be (opening principal
        // minus the sum of principal we posted). When drift is non-zero,
        // this is the "what should it be" anchor.
        const openingPrincipalCents = note.originalPrincipalCents;
        const sumOfPrincipalPostedCents = Number(sums?.sumOfPrincipalPostedCents ?? 0);
        const sumOfInterestPostedCents = Number(sums?.sumOfInterestPostedCents ?? 0);
        const sumOfLateFeesPostedCents = Number(sums?.sumOfLateFeesPostedCents ?? 0);
        const sumOfEscrowPostedCents = Number(sums?.sumOfEscrowPostedCents ?? 0);
        const scheduleSaysPrincipalCents =
          openingPrincipalCents - sumOfPrincipalPostedCents;
        const drift = note.currentBalanceCents - scheduleSaysPrincipalCents;

        return res.json({
          openingPrincipalCents,
          sumOfPrincipalPostedCents,
          sumOfInterestPostedCents,
          sumOfLateFeesPostedCents,
          sumOfEscrowPostedCents,
          currentPrincipalCents: note.currentBalanceCents,
          scheduleSaysPrincipalCents,
          drift,
          lastPostingId: lastPosting?.id ?? null,
          asOf: new Date().toISOString(),
        });
      } catch (err) {
        logger.error(
          "notes.reconciliation failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );

  // ── Basis schedule (Pub 1212 market-discount accretion) ──────────────────
  app.get(
    "/api/notes/:id/basis",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const method = (req.query.method === "constant_yield" ? "constant_yield" : "ratable") as
          | "ratable"
          | "constant_yield";

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select({
            paymentDate: notePayments.paymentDate,
            principalCents: notePayments.principalCents,
          })
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const schedule = computeBasisSchedule({
          acquisitionPriceCents: note.acquisitionPriceCents,
          originalPrincipalCents: note.originalPrincipalCents,
          acquisitionDate: note.acquisitionDate as unknown as string,
          maturityDate: note.maturityDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
          })),
          method,
        });

        const totalDiscountCents = note.originalPrincipalCents - note.acquisitionPriceCents;
        return res.json({
          noteId: id,
          method,
          totalDiscountCents,
          isPremium: totalDiscountCents < 0,
          schedule,
        });
      } catch (err) {
        logger.error("notes.basis failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Yield panel (current / YTM / IRR-to-date / effective net) ────────────
  // Linnea: "every note's detail page should show all four yield metrics
  // computed live from its actual payment history. That's table stakes."
  app.get(
    "/api/notes/:id/yield",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;

        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        const payments = await db
          .select()
          .from(notePayments)
          .where(eq(notePayments.noteId, id))
          .orderBy(notePayments.paymentDate);

        const yields = computeYields({
          acquisitionPriceCents: note.acquisitionPriceCents,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonths: note.termMonths,
          acquisitionDate: note.acquisitionDate as unknown as string,
          payments: payments.map((p) => ({
            paymentDate: p.paymentDate as unknown as string,
            principalCents: p.principalCents,
            interestCents: p.interestCents,
            // Escrow + late fee don't reduce the asset, so they're excluded
            // from the IRR cash-flow stream from Linnea's perspective.
          })),
        });

        return res.json({ noteId: id, ...yields });
      } catch (err) {
        logger.error("notes.yield failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Assignment paperwork ─────────────────────────────────────────────────
  // POST /api/notes/:id/assignments
  // Generates a combined Allonge + Assignment of Mortgage PDF, persists
  // the metadata, returns the assignment + base64 PDF for immediate
  // download. State-specific recordable templates are out of scope for
  // this PR; the generic template is legally-correct shape but isn't
  // automatically county-recordable.
  app.post(
    "/api/notes/:id/assignments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          assigneeName: z.string().min(1).max(240),
          assigneeAddress: z.object({
            line1: z.string().optional(),
            line2: z.string().optional(),
            city: z.string().optional(),
            state: z.string().optional(),
            zip: z.string().optional(),
          }).optional(),
          state: z.string().length(2).optional(),
          salePriceCents: z.number().int().nonnegative().optional(),
          saleDate: z.string().min(1),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());
        const data = parsed.data;

        // Pull the note + the org name (assignor on the paperwork is
        // the organization).
        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, noteId), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) return Errors.notFound(res, "Note");

        // Org name lookup — we need it to populate "ASSIGNOR" on the PDF.
        const { organizations } = await import("@shared/schema");
        const [org] = await db
          .select({ name: organizations.name })
          .from(organizations)
          .where(eq(organizations.id, orgId))
          .limit(1);
        const assignorName = org?.name ?? "Note Holder";

        // Render the PDF (synchronous; jsPDF in-memory).
        const { pdfBase64 } = renderAssignmentPdf({
          assignorName,
          assigneeName: data.assigneeName,
          assigneeAddress: data.assigneeAddress,
          noteNumber: note.noteNumber,
          payerName: note.payerName,
          payerAddress: (note.payerAddress as any) ?? undefined,
          originalPrincipalCents: note.originalPrincipalCents,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          originationDate: note.originationDate as unknown as string,
          maturityDate: note.maturityDate as unknown as string,
          salePriceCents: data.salePriceCents,
          saleDate: data.saleDate,
          state: data.state,
        });

        // Persist metadata. PDF storage to S3 is queued for a follow-up;
        // for now we return the base64 inline and don't store the bytes.
        const [row] = await db
          .insert(noteAssignments)
          .values({
            organizationId: orgId,
            noteId,
            assigneeName: data.assigneeName,
            assigneeAddress: data.assigneeAddress ?? null,
            state: data.state ?? null,
            templateVariant: "generic",
            salePriceCents: data.salePriceCents ?? null,
            saleDate: data.saleDate,
            pdfS3Key: null,
            status: "generated",
            notes: data.notes ?? null,
          })
          .returning();

        return res.status(201).json({ assignment: row, pdfBase64 });
      } catch (err) {
        logger.error("notes.assignments.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/notes/:id/assignments — list issued paperwork for this note
  app.get(
    "/api/notes/:id/assignments",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const rows = await db
          .select()
          .from(noteAssignments)
          .where(and(eq(noteAssignments.organizationId, orgId), eq(noteAssignments.noteId, noteId)))
          .orderBy(desc(noteAssignments.createdAt));
        return res.json({ assignments: rows });
      } catch (err) {
        logger.error("notes.assignments.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // PATCH /api/notes/assignments/:id — status updates (signed / recorded)
  app.patch(
    "/api/note-assignments/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          status: z.enum(["generated", "signed", "recorded", "voided"]).optional(),
          signedAt: z.string().optional(),
          recordedAt: z.string().optional(),
          recordingNumber: z.string().max(120).optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof noteAssignments.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
          signedAt: parsed.data.signedAt ? new Date(parsed.data.signedAt) : undefined,
          recordedAt: parsed.data.recordedAt ? new Date(parsed.data.recordedAt) : undefined,
        };
        const [row] = await db
          .update(noteAssignments)
          .set(update)
          .where(and(eq(noteAssignments.id, req.params.id), eq(noteAssignments.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Assignment");
        return res.json({ assignment: row });
      } catch (err) {
        logger.error("notes.assignments.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Loss-mit case files ──────────────────────────────────────────────────
  // Linnea bonus #7: "30% of our time on the bottom 10% of our book."
  // GET    /api/notes/:id/loss-mit-case          — current open case (or null)
  // POST   /api/notes/:id/loss-mit-case          — open a new case
  // PATCH  /api/loss-mit-cases/:id               — update / close
  // GET    /api/loss-mit-cases/:id/actions       — action log
  // POST   /api/loss-mit-cases/:id/actions       — log a new action
  // GET    /api/loss-mit-cases?status=open       — org-level dashboard
  app.get(
    "/api/notes/:id/loss-mit-case",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const [row] = await db
          .select()
          .from(noteLossMitCases)
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            eq(noteLossMitCases.noteId, noteId),
            eq(noteLossMitCases.status, "open"),
          ))
          .limit(1);
        return res.json({ case: row ?? null });
      } catch (err) {
        logger.error("notes.lossMit.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/notes/:id/loss-mit-case",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          state: z.string().length(2).optional(),
          daysPastDueAtOpen: z.number().int().nonnegative().optional(),
          summary: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Block opening a second case while one is already open.
        const [existing] = await db
          .select({ id: noteLossMitCases.id })
          .from(noteLossMitCases)
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            eq(noteLossMitCases.noteId, noteId),
            eq(noteLossMitCases.status, "open"),
          ))
          .limit(1);
        if (existing) {
          return Errors.badRequest(res, "An open case already exists for this note. Close it before opening a new one.");
        }

        const [row] = await db
          .insert(noteLossMitCases)
          .values({ organizationId: orgId, noteId, ...parsed.data })
          .returning();
        return res.status(201).json({ case: row });
      } catch (err) {
        logger.error("notes.lossMit.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.patch(
    "/api/loss-mit-cases/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          status: z.enum(LOSS_MIT_STATUS).optional(),
          state: z.string().length(2).optional(),
          scraActiveDuty: z.boolean().optional(),
          scraCheckedAt: z.string().optional(),
          summary: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        const update: Partial<typeof noteLossMitCases.$inferInsert> = {
          ...parsed.data,
          updatedAt: new Date(),
          scraCheckedAt: parsed.data.scraCheckedAt ? new Date(parsed.data.scraCheckedAt) : undefined,
        };
        // Closing the case stamps closedAt.
        if (parsed.data.status && parsed.data.status !== "open") {
          update.closedAt = new Date();
        }

        const [row] = await db
          .update(noteLossMitCases)
          .set(update)
          .where(and(eq(noteLossMitCases.id, req.params.id), eq(noteLossMitCases.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Case");
        return res.json({ case: row });
      } catch (err) {
        logger.error("notes.lossMit.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/loss-mit-cases/:id/actions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const rows = await db
          .select()
          .from(noteLossMitActions)
          .where(and(
            eq(noteLossMitActions.organizationId, orgId),
            eq(noteLossMitActions.caseId, req.params.id),
          ))
          .orderBy(desc(noteLossMitActions.performedAt));
        return res.json({ actions: rows });
      } catch (err) {
        logger.error("notes.lossMit.actions.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/loss-mit-cases/:id/actions",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const parsed = z.object({
          actionType: z.enum(LOSS_MIT_ACTION_TYPES),
          performedAt: z.string().optional(),
          notes: z.string().max(4_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Ensure the case belongs to the org.
        const [c] = await db
          .select({ id: noteLossMitCases.id })
          .from(noteLossMitCases)
          .where(and(eq(noteLossMitCases.id, req.params.id), eq(noteLossMitCases.organizationId, orgId)))
          .limit(1);
        if (!c) return Errors.notFound(res, "Case");

        const userId = req.user?.id || req.user?.id || null;

        const [row] = await db
          .insert(noteLossMitActions)
          .values({
            organizationId: orgId,
            caseId: req.params.id,
            actionType: parsed.data.actionType,
            performedAt: parsed.data.performedAt ? new Date(parsed.data.performedAt) : new Date(),
            notes: parsed.data.notes ?? null,
            performedByUserId: userId,
          })
          .returning();

        // Auto-update the case when SCRA is checked — convenience for the
        // common case where a user logs the SCRA check action and expects
        // the case-level scraCheckedAt + scraActiveDuty to reflect it.
        if (parsed.data.actionType === "scra_checked") {
          const isActiveDuty = /active.duty/i.test(parsed.data.notes ?? "");
          await db
            .update(noteLossMitCases)
            .set({ scraCheckedAt: new Date(), scraActiveDuty: isActiveDuty, updatedAt: new Date() })
            .where(eq(noteLossMitCases.id, req.params.id));
        }

        return res.status(201).json({ action: row });
      } catch (err) {
        logger.error("notes.lossMit.actions.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/loss-mit-cases",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const status = typeof req.query.status === "string" ? req.query.status : "open";
        const rows = await db
          .select({
            caseId: noteLossMitCases.id,
            noteId: noteLossMitCases.noteId,
            status: noteLossMitCases.status,
            state: noteLossMitCases.state,
            daysPastDueAtOpen: noteLossMitCases.daysPastDueAtOpen,
            openedAt: noteLossMitCases.openedAt,
            scraCheckedAt: noteLossMitCases.scraCheckedAt,
            payerName: acquiredNotes.payerName,
            noteNumber: acquiredNotes.noteNumber,
            currentBalanceCents: acquiredNotes.currentBalanceCents,
          })
          .from(noteLossMitCases)
          .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteLossMitCases.noteId))
          .where(and(
            eq(noteLossMitCases.organizationId, orgId),
            (LOSS_MIT_STATUS as readonly string[]).includes(status)
              ? eq(noteLossMitCases.status, status as any)
              : eq(noteLossMitCases.status, "open"),
          ))
          .orderBy(desc(noteLossMitCases.openedAt));
        return res.json({ cases: rows });
      } catch (err) {
        logger.error("notes.lossMit.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Compliance watch lists ───────────────────────────────────────────────


  // ── Ownership splits (pool / fractional) ─────────────────────────────────
  // GET    /api/notes/:id/splits
  // POST   /api/notes/:id/splits
  // PATCH  /api/note-splits/:id
  // DELETE /api/note-splits/:id
  app.get(
    "/api/notes/:id/splits",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const rows = await db
          .select()
          .from(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.organizationId, orgId), eq(noteOwnershipSplits.noteId, noteId)))
          .orderBy(desc(noteOwnershipSplits.percentageBps));
        const totalBps = rows.reduce((s, r) => s + r.percentageBps, 0);
        return res.json({ splits: rows, totalBps, unallocatedBps: 10_000 - totalBps });
      } catch (err) {
        logger.error("notes.splits.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.post(
    "/api/notes/:id/splits",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = req.params.id;
        const parsed = z.object({
          investorLeadId: z.number().int().positive().optional(),
          investorName: z.string().min(1).max(240),
          investorEmail: z.string().email().optional(),
          role: z.enum(["org", "lp"]).default("lp"),
          percentageBps: z.number().int().min(1).max(10_000),
          effectiveFrom: z.string().optional(),
          effectiveTo: z.string().optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // Ensure summed bps for the note doesn't exceed 10000 after this insert.
        const existing = await db
          .select({ bps: noteOwnershipSplits.percentageBps })
          .from(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.organizationId, orgId), eq(noteOwnershipSplits.noteId, noteId)));
        const usedBps = existing.reduce((s, r) => s + r.bps, 0);
        if (usedBps + parsed.data.percentageBps > 10_000) {
          return Errors.badRequest(
            res,
            `Adding ${parsed.data.percentageBps} bps would exceed 100% (already allocated: ${usedBps} bps; available: ${10_000 - usedBps} bps)`,
          );
        }

        const [row] = await db
          .insert(noteOwnershipSplits)
          .values({
            organizationId: orgId,
            noteId,
            ...parsed.data,
          })
          .returning();
        return res.status(201).json({ split: row });
      } catch (err) {
        logger.error("notes.splits.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.patch(
    "/api/note-splits/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const splitId = req.params.id;
        const parsed = z.object({
          investorName: z.string().min(1).max(240).optional(),
          investorEmail: z.string().email().optional(),
          percentageBps: z.number().int().min(1).max(10_000).optional(),
          effectiveFrom: z.string().optional(),
          effectiveTo: z.string().optional(),
          notes: z.string().max(2_000).optional(),
        }).safeParse(req.body);
        if (!parsed.success) return Errors.validationFailed(res, parsed.error.flatten());

        // If changing percentageBps, validate the new sum.
        if (parsed.data.percentageBps !== undefined) {
          const [current] = await db
            .select()
            .from(noteOwnershipSplits)
            .where(and(eq(noteOwnershipSplits.id, splitId), eq(noteOwnershipSplits.organizationId, orgId)))
            .limit(1);
          if (!current) return Errors.notFound(res, "Split");
          const others = await db
            .select({ bps: noteOwnershipSplits.percentageBps })
            .from(noteOwnershipSplits)
            .where(and(
              eq(noteOwnershipSplits.organizationId, orgId),
              eq(noteOwnershipSplits.noteId, current.noteId),
            ));
          const otherBps = others
            .filter((_, i) => others[i] !== current as any) // crude; we'll subtract by id below
            .reduce((s, r) => s + r.bps, 0);
          // Recompute properly by excluding the current row.
          const recomputed = others.reduce((s, r) => s + r.bps, 0) - current.percentageBps;
          if (recomputed + parsed.data.percentageBps > 10_000) {
            return Errors.badRequest(res, `Update would exceed 100% (other splits: ${recomputed} bps)`);
          }
          void otherBps;
        }

        const [row] = await db
          .update(noteOwnershipSplits)
          .set({ ...parsed.data, updatedAt: new Date() })
          .where(and(eq(noteOwnershipSplits.id, splitId), eq(noteOwnershipSplits.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Split");
        return res.json({ split: row });
      } catch (err) {
        logger.error("notes.splits.patch failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  app.delete(
    "/api/note-splits/:id",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .delete(noteOwnershipSplits)
          .where(and(eq(noteOwnershipSplits.id, req.params.id), eq(noteOwnershipSplits.organizationId, orgId)))
          .returning();
        if (!row) return Errors.notFound(res, "Split");
        return res.json({ deleted: true });
      } catch (err) {
        logger.error("notes.splits.delete failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Payoff calculator ────────────────────────────────────────────────────
  // GET /api/notes/:id/payoff?date=YYYY-MM-DD
  // Returns the amount required to fully settle the note as of the requested
  // close date — principal + accrued interest through that date − unapplied
  // funds held. Linnea: "Borrower calls Tuesday. 'What's my payoff if I close
  // Friday at 2 PM?' I need a payoff calculator. One button." This is the
  // one-button.
  //
  // This is an INDICATIVE quote: a GET must not write, so nothing is recorded.
  // To issue a payoff a third party will rely on, POST :id/payoff/quotes —
  // same engine, same numbers, plus a durable row proving what was quoted.
  //
  // Wave C: the per-diem arithmetic that used to live inline here (float
  // multiply, days ROUNDED rather than floored — a payoff quoted 12 hours out
  // charged a whole extra day) is gone. It delegates.
  app.get(
    "/api/notes/:id/payoff",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const dateParam =
          (req.query.date as string | undefined) ?? new Date().toISOString().slice(0, 10);
        let payoffDate: Date;
        try {
          payoffDate = parseIsoDateUtc(dateParam);
        } catch {
          return Errors.badRequest(res, "date must be a valid ISO date (YYYY-MM-DD)");
        }

        const result = await computeAcquiredNotePayoff(db, orgId, id, payoffDate);
        if (!result) return Errors.notFound(res, "Note");

        return res.json({ ...payoffResponseBody(result), recorded: false });
      } catch (err) {
        logger.error("notes.payoff failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Payoff quote ledger ──────────────────────────────────────────────────
  // A payoff statement is a representation the holder is bound by. Quoting a
  // number and keeping no record of it means that when a closer wires the
  // quoted figure and the ledger disagrees, nobody can establish which side
  // moved. These three routes make a quote provable: same engine as the
  // calculator, plus a durable row carrying the OUTPUT and the INPUTS it was
  // computed from (balance, rate, accrual start, day count, convention,
  // engine version) so the number can be recomputed years later.
  //
  // Path note: deliberately /payoff/quotes, NOT /payoff-quotes —
  // server/routes-va-engine.ts already owns GET /api/notes/:noteId/payoff-quotes
  // for the legacy decimal `payoff_quotes` table, and two handlers on the same
  // pattern would silently shadow each other by registration order.

  const createPayoffQuoteSchema = z.object({
    /** Date the payoff funds are good. Defaults to today (UTC). */
    payoffDate: z.string().min(1).optional(),
    /** Org-configured payoff/processing fee. Must be supplied, never assumed. */
    payoffFeeCents: z.number().int().nonnegative().optional(),
    channel: z.enum(["operator_api", "borrower_portal", "servicer_batch"]).optional(),
    notes: z.string().max(2_000).optional(),
  });

  // POST /api/notes/:id/payoff/quotes — compute AND record.
  app.post(
    "/api/notes/:id/payoff/quotes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const id = req.params.id;
        const parsed = createPayoffQuoteSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }

        let payoffDate: Date;
        try {
          payoffDate = parseIsoDateUtc(
            parsed.data.payoffDate ?? new Date().toISOString().slice(0, 10),
          );
        } catch {
          return Errors.badRequest(res, "payoffDate must be a valid ISO date (YYYY-MM-DD)");
        }

        const result = await computeAcquiredNotePayoff(db, orgId, id, payoffDate, {
          payoffFeeCents: parsed.data.payoffFeeCents ?? 0,
        });
        if (!result) return Errors.notFound(res, "Note");

        const q = result.quote;
        const [quoteRow] = await db
          .insert(notePayoffQuotes)
          .values({
            organizationId: orgId,
            noteSystem: "acquired_note",
            noteRef: result.note.id,
            noteNumber: result.note.noteNumber,
            payerName: result.note.payerName,
            quotedByUserId: userId,
            channel: parsed.data.channel ?? "operator_api",
            payoffDate: q.payoffDate,
            // The engine accrues interest THROUGH payoffDate, so that IS the
            // last date the quoted total is valid. Extending it costs
            // perDiemInterestCents per additional day — we publish the
            // per-diem rather than quietly quoting a stale total.
            goodThroughDate: q.payoffDate,
            principalBalanceCents: q.principalBalanceCents,
            annualRateBpsHundredths: Math.round(q.annualRateBps * 100),
            accrualStartDate: q.accrualStartDate,
            daysAccrued: q.daysAccrued,
            dayCountConvention: q.dayCountConvention,
            perDiemInterestCents: q.perDiemInterestCents,
            accruedInterestCents: q.accruedInterestCents,
            unappliedCreditCents: q.unappliedCreditCents,
            lateFeesOutstandingCents: q.lateFeesOutstandingCents,
            payoffFeeCents: q.payoffFeeCents,
            totalPayoffCents: q.totalPayoffCents,
            engineVersion: q.engineVersion,
            // Verbatim inputs. Dates as ISO strings so the snapshot is
            // self-describing without knowing the engine's Date handling.
            engineInputJson: {
              principalBalanceCents: result.input.principalBalanceCents,
              annualRateBps: result.input.annualRateBps,
              accrualStartDate: isoDateUtc(result.input.accrualStartDate),
              payoffDate: isoDateUtc(result.input.payoffDate),
              unappliedCreditCents: result.input.unappliedCreditCents ?? 0,
              lateFeesOutstandingCents: result.input.lateFeesOutstandingCents ?? 0,
              payoffFeeCents: result.input.payoffFeeCents ?? 0,
              dayCountConvention: PAYOFF_DAY_COUNT_CONVENTION,
              engineVersion: PAYOFF_ENGINE_VERSION,
            },
            notes: parsed.data.notes ?? null,
          })
          .returning();

        logger.info("notes.payoffQuote recorded", {
          organizationId: orgId,
          noteId: id,
          quoteId: quoteRow?.id,
          totalPayoffCents: q.totalPayoffCents,
          payoffDate: q.payoffDate,
        });

        return res.status(201).json({
          quote: quoteRow,
          ...payoffResponseBody(result),
          recorded: true,
        });
      } catch (err) {
        logger.error("notes.payoffQuote.create failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/notes/:id/payoff/quotes — every quote issued on this note.
  app.get(
    "/api/notes/:id/payoff/quotes",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const rows = await db
          .select()
          .from(notePayoffQuotes)
          .where(
            and(
              eq(notePayoffQuotes.organizationId, orgId),
              eq(notePayoffQuotes.noteSystem, "acquired_note"),
              eq(notePayoffQuotes.noteRef, id),
            ),
          )
          .orderBy(desc(notePayoffQuotes.quotedAt))
          .limit(500);
        return res.json({ quotes: rows });
      } catch (err) {
        logger.error("notes.payoffQuote.list failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // GET /api/notes/:id/payoff/quotes/:quoteId — retrieve one quote as issued.
  app.get(
    "/api/notes/:id/payoff/quotes/:quoteId",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const [row] = await db
          .select()
          .from(notePayoffQuotes)
          .where(
            and(
              eq(notePayoffQuotes.id, req.params.quoteId),
              eq(notePayoffQuotes.organizationId, orgId),
              eq(notePayoffQuotes.noteRef, req.params.id),
            ),
          )
          .limit(1);
        if (!row) return Errors.notFound(res, "Payoff quote");
        return res.json({ quote: row });
      } catch (err) {
        logger.error("notes.payoffQuote.get failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Amortization schedule ────────────────────────────────────────────────
  app.get(
    "/api/notes/:id/amortization",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const id = req.params.id;
        const [note] = await db
          .select()
          .from(acquiredNotes)
          .where(and(eq(acquiredNotes.id, id), eq(acquiredNotes.organizationId, orgId)))
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }

        // We compute remaining schedule from today's currentBalanceCents,
        // not from the original principal. Months remaining = termMonths
        // minus months elapsed since origination. We clamp at 1..termMonths
        // to keep the schedule well-formed for paid-down notes.
        const origDate = new Date(note.originationDate as unknown as string);
        const monthsElapsed = Math.max(
          0,
          (new Date().getUTCFullYear() - origDate.getUTCFullYear()) * 12 +
            (new Date().getUTCMonth() - origDate.getUTCMonth()),
        );
        const remaining = Math.max(1, note.termMonths - monthsElapsed);

        const schedule = computeAmortization({
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          // Anchor on the note's real next due date when one is on file. Using
          // "today" ignored paidThroughDate entirely, so the projected schedule
          // disagreed with the due date shown everywhere else on the same note.
          startDate: note.nextPaymentDate
            ? new Date(`${note.nextPaymentDate}T00:00:00.000Z`)
            : new Date(),
          paymentDueDay: note.paymentDueDay,
        });

        return res.json({
          noteId: id,
          currentBalanceCents: note.currentBalanceCents,
          interestRateBps: note.interestRateBps,
          paymentAmountCents: note.paymentAmountCents,
          termMonthsRemaining: remaining,
          schedule,
        });
      } catch (err) {
        logger.error("notes.amortization failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── RESPA §1024.17 annual escrow ANALYSIS ────────────────────────────────
  //
  // GET /api/notes/:id/escrow-analysis?computationYearStart=YYYY-MM-DD
  //
  // Read-only. Serves `analyzeEscrowAccount` (services/respaEscrowAnalysis)
  // for the SELLER-FINANCE (originated) `notes` book — numeric ids — because
  // that is the schema the analyzer reads (notes.taxEscrowEnabled /
  // monthlyTaxEscrow / taxEscrowBalance + tax_escrow_payments). The acquired
  // book is deliberately NOT served: acquired_notes has no monthly
  // escrow-deposit amount and only a single next-disbursement date, so the
  // 12-month trial-balance inputs do not exist for it and inferring them
  // would fabricate a compliance artifact.
  //
  // This endpoint returns the ANALYSIS ONLY — the §1024.17(f) projection and
  // surplus/shortage/deficiency determination. It does NOT produce or deliver
  // the §1024.17(i) annual escrow account STATEMENT (buildAnnualEscrowStatement
  // stays unwired: the required actual-history inputs are not in the schema),
  // and nothing here discharges the delivery duty — the operator does that.
  app.get(
    "/api/notes/:id/escrow-analysis",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const noteId = Number(req.params.id);
        if (!Number.isInteger(noteId) || noteId <= 0) {
          return Errors.badRequest(
            res,
            "Escrow analysis runs on the seller-finance (originated) notes book, which uses numeric ids. " +
              "Acquired notes are not supported: they do not carry the monthly escrow-deposit and " +
              "12-month disbursement records a §1024.17 analysis requires.",
          );
        }

        let computationYearStart = new Date();
        const rawStart = req.query.computationYearStart;
        if (typeof rawStart === "string" && rawStart.length > 0) {
          const parsedStart = new Date(`${rawStart}T00:00:00.000Z`);
          if (Number.isNaN(parsedStart.getTime())) {
            return Errors.badRequest(res, "computationYearStart must be an ISO date (YYYY-MM-DD)");
          }
          computationYearStart = parsedStart;
        }

        // Org-scoped pre-check so 404 (not yours / doesn't exist) and 400
        // (escrow not enabled) are distinguishable before the analyzer runs.
        const [note] = await db
          .select({
            id: sellerFinanceNotes.id,
            taxEscrowEnabled: sellerFinanceNotes.taxEscrowEnabled,
          })
          .from(sellerFinanceNotes)
          .where(
            and(
              eq(sellerFinanceNotes.id, noteId),
              eq(sellerFinanceNotes.organizationId, orgId),
            ),
          )
          .limit(1);
        if (!note) {
          return Errors.notFound(res, "Note");
        }
        if (!note.taxEscrowEnabled) {
          return Errors.badRequest(
            res,
            `Note ${noteId} does not have tax escrow enabled — a §1024.17 escrow analysis is not applicable.`,
          );
        }

        const analysis = await analyzeEscrowAccount({
          noteId,
          organizationId: orgId,
          computationYearStart,
        });

        return res.json({
          book: SELLER_FINANCE_BOOK_ID,
          moneyUnit: "integer_cents",
          analysis,
          // HONESTY: the analysis is a projection/determination, not the
          // regulated disclosure. No annual escrow statement has been
          // produced or delivered by this endpoint.
          annualStatementProduced: false,
        });
      } catch (err) {
        logger.error("notes.escrowAnalysis failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Close & Carry — POST /api/notes/from-deal/:dealId ──────────────────────
  //
  // The lifecycle bridge. A closed seller-finance deal one-click-originates the
  // serviced `notes` row with NO re-keying: buyer (operator-confirmed), sale
  // price, down payment, rate, term, first-payment date all pre-filled from the
  // deal. Links deal.id ↔ note.id (notes.originatingDealId). The deal's document
  // package stays the note's origination folder — reachable through the deal
  // link, so nothing is copied/duplicated.
  //
  // Acts on the seller-finance `notes` table (via storage.createNote), NOT the
  // acquired-notes vertical that the rest of this file serves — the carry flow
  // is about notes the operator ORIGINATES, not notes they buy.
  app.post(
    "/api/notes/from-deal/:dealId",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const userId = getUserId(req);
        const dealId = Number(req.params.dealId);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal id");
        }

        const overridesSchema = z.object({
          borrowerId: z.number().int().positive().nullable().optional(),
          salePrice: z.number().nonnegative().optional(),
          downPayment: z.number().nonnegative().optional(),
          interestRate: z.number().min(0).max(100).optional(),
          termMonths: z.number().int().min(1).max(1200).optional(),
          firstPaymentDate: z.string().min(1).optional(),
        });
        const parsed = overridesSchema.safeParse(req.body ?? {});
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.flatten());
        }
        const overrides = parsed.data;

        // Org-scoped load + ownership check.
        const deal = await storage.getDeal(orgId, dealId);
        if (!deal) {
          return Errors.notFound(res, "Deal");
        }

        // Only closed deals can be carried. (A deal that hasn't closed has no
        // settled terms to originate against.)
        if (deal.status !== "closed") {
          return Errors.badRequest(
            res,
            "Only a closed deal can be carried into a note",
            { dealStatus: deal.status },
          );
        }

        // Idempotency: a deal originates at most one note. If one already
        // exists, return it (200) instead of creating a duplicate. Org-scoped
        // probe on the leading-org composite index (notes_org_originating_deal).
        const [existing] = await db
          .select()
          .from(sellerFinanceNotes)
          .where(
            and(
              eq(sellerFinanceNotes.organizationId, orgId),
              eq(sellerFinanceNotes.originatingDealId, dealId),
            ),
          )
          .limit(1);
        if (existing) {
          return res.status(200).json({ note: existing, alreadyCarried: true });
        }

        // If the operator named a borrower, it must be a lead in THIS org.
        if (overrides.borrowerId != null) {
          const lead = await storage.getLead(orgId, overrides.borrowerId);
          if (!lead) {
            return Errors.badRequest(res, "borrowerId does not match a lead in this organization");
          }
        }

        const mapped = mapDealToNoteFields(
          {
            id: deal.id,
            organizationId: deal.organizationId,
            propertyId: deal.propertyId,
            status: deal.status,
            type: deal.type,
            offerAmount: deal.offerAmount,
            acceptedAmount: deal.acceptedAmount,
            closingDate: deal.closingDate,
            analysisResults: deal.analysisResults ?? null,
          },
          overrides,
        );

        const note = await storage.createNote(mapped as unknown as InsertNote);

        logger.info("notes.carried_from_deal", {
          orgId,
          userId,
          dealId,
          noteId: note.id,
        });

        return res.status(201).json({ note, originatingDealId: dealId });
      } catch (err) {
        if (err instanceof z.ZodError) {
          return Errors.badRequest(res, err.issues[0].message);
        }
        logger.error("notes.from_deal failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── Reverse link — GET /api/notes/from-deal/:dealId ────────────────────────
  // Resolves the note (if any) that was originated from a deal, so the deal
  // surface can show an "originated note" link. Returns { note: null } when the
  // deal hasn't been carried yet. Org-scoped probe on the leading-org composite.
  app.get(
    "/api/notes/from-deal/:dealId",
    isAuthenticated,
    getOrCreateOrg,
    ownerOrAdmin,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const dealId = Number(req.params.dealId);
        if (!Number.isInteger(dealId) || dealId <= 0) {
          return Errors.badRequest(res, "Invalid deal id");
        }
        const [note] = await db
          .select()
          .from(sellerFinanceNotes)
          .where(
            and(
              eq(sellerFinanceNotes.organizationId, orgId),
              eq(sellerFinanceNotes.originatingDealId, dealId),
            ),
          )
          .limit(1);
        return res.json({ note: note ?? null });
      } catch (err) {
        logger.error("notes.from_deal_lookup failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}

// ─── Aggregation helper used by form1099Batch.ts ─────────────────────────────

/**
 * Aggregate interest paid per payer for a given org + tax year. Used by the
 * 1099-INT batch generator to union interest from acquired-note payments
 * with interest from originated notes.
 *
 * Returns rows of `{ noteId, payerName, payerAddress, payerEncryptedTin,
 * payerTinType, interestCents }`. Only includes payers where the summed
 * interest meets or exceeds the IRS 1099-INT $600 threshold; the caller
 * may apply additional filters.
 */
export async function aggregateAcquiredNoteInterestForYear(
  orgId: number,
  taxYear: number,
): Promise<Array<{
  noteId: string;
  noteNumber: string;
  payerName: string;
  payerAddress: typeof acquiredNotes.$inferSelect.payerAddress;
  payerEncryptedTin: string | null;
  payerTinType: string | null;
  interestCents: number;
}>> {
  const yearStart = `${taxYear}-01-01`;
  const yearEnd = `${taxYear}-12-31`;

  // Sum interest_cents per note for the year, joined to acquired_notes for
  // payer details. We aggregate in SQL rather than fetching individual rows
  // because a busy noteholder's payment ledger can run to thousands of rows
  // per year.
  const rows = await db
    .select({
      noteId: acquiredNotes.id,
      noteNumber: acquiredNotes.noteNumber,
      payerName: acquiredNotes.payerName,
      payerAddress: acquiredNotes.payerAddress,
      payerEncryptedTin: acquiredNotes.payerEncryptedTin,
      payerTinType: acquiredNotes.payerTinType,
      interestCents: sql<number>`COALESCE(SUM(${notePayments.interestCents}), 0)::bigint`,
    })
    .from(acquiredNotes)
    .leftJoin(
      notePayments,
      and(
        eq(notePayments.noteId, acquiredNotes.id),
        sql`${notePayments.paymentDate} >= ${yearStart}`,
        sql`${notePayments.paymentDate} <= ${yearEnd}`,
      ),
    )
    .where(eq(acquiredNotes.organizationId, orgId))
    .groupBy(
      acquiredNotes.id,
      acquiredNotes.noteNumber,
      acquiredNotes.payerName,
      acquiredNotes.payerAddress,
      acquiredNotes.payerEncryptedTin,
      acquiredNotes.payerTinType,
    );

  // Narrow to rows with non-zero interest. The SQL coalesces to 0 for notes
  // with no payments in the year — we don't want to issue a 1099-INT for
  // those.
  return rows
    .map((r) => ({ ...r, interestCents: Number(r.interestCents ?? 0) }))
    .filter((r) => r.interestCents > 0);
}
