/**
 * ACH return-code taxonomy (NACHA R01–R29) + the Actum Processing client.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * WAVE C ("Money moves", 2026-07-29) — what changed and why
 * ─────────────────────────────────────────────────────────────────────────
 * This file used to be a complete-looking ACH processor with THREE problems:
 *
 *  1. It had zero client UI and zero credentials. `ACTUM_MERCHANT_ID` /
 *     `ACTUM_API_KEY` are commented out in .env.example, no merchant account
 *     exists, and `processActumWebhook` had ZERO call sites — nothing in the
 *     repo could ever deliver Actum a return notification.
 *
 *  2. **It fabricated success when unconfigured.** `createActumPaymentProfile`
 *     returned `{ success: true, profileId: "test_profile_<ts>" }` and
 *     `chargeActumACH` returned `{ success: true, transactionId: "test_txn_
 *     <ts>", status: "pending" }` whenever the credentials were missing — i.e.
 *     always. A caller that posted a ledger row on `success: true` would have
 *     booked a payment for a debit that never left the building. That is the
 *     fabrication hard-stop, on the money path. Both fallbacks are deleted:
 *     an unconfigured rail now REFUSES, loudly, with a reason.
 *
 *  3. `runMonthlyActumPaymentBatch` charged every autopay note with no
 *     due-date check, no idempotency key, no mandate check, and never wrote a
 *     `payments` row — so a rerun double-debited and nothing was recorded.
 *
 * The borrower ACH rail AcreOS actually runs is Stripe `us_bank_account` on
 * the lender's own Stripe Connect account — see server/services/achAutopay.ts
 * for the reasoning and the live implementation. What survives here is the
 * part that is genuinely rail-agnostic and genuinely valuable: the NACHA
 * return-code table, its retry classification, and a mapper from processor
 * failure codes onto it. `achAutopay` consumes those.
 *
 * The Actum HTTP client stays (a real merchant account is a plausible future
 * cost win) but is now honest: it refuses when unconfigured instead of
 * pretending, and the batch runner refuses outright rather than moving money
 * on a path with no idempotency and no ledger write.
 *
 * Requires (all currently unset): ACTUM_MERCHANT_ID, ACTUM_API_KEY, ACTUM_ENDPOINT
 */

import { logger } from "../utils/logger";

const ACTUM_ENDPOINT = process.env.ACTUM_ENDPOINT || "https://portal.actumprocessing.com/api/v1";

/** True only when a real Actum merchant account is provisioned. */
export function isActumConfigured(): boolean {
  return !!(process.env.ACTUM_MERCHANT_ID && process.env.ACTUM_API_KEY);
}

export const ACTUM_NOT_CONFIGURED =
  "Actum Processing is not configured (ACTUM_MERCHANT_ID / ACTUM_API_KEY unset). " +
  "No ACH transaction was created. The live borrower ACH rail is Stripe us_bank_account — see server/services/achAutopay.ts.";

function getActumHeaders(): HeadersInit {
  const merchantId = process.env.ACTUM_MERCHANT_ID;
  const apiKey = process.env.ACTUM_API_KEY;
  if (!merchantId || !apiKey) throw new Error(ACTUM_NOT_CONFIGURED);
  return {
    "Content-Type": "application/json",
    "X-Merchant-ID": merchantId,
    "X-API-Key": apiKey,
  };
}

// ============================================
// ACH RETURN CODE CLASSIFICATION (rail-agnostic)
// ============================================

export type AchReturnCategory =
  | "insufficient_funds"
  | "account_closed"
  | "invalid_account"
  | "unauthorized"
  | "administrative"
  | "other";

export interface AchReturnCode {
  code: string;
  description: string;
  category: AchReturnCategory;
  /**
   * NACHA permits re-presentment of an R01/R09 (and an ODFI-request return)
   * up to TWO times. `retryable: false` means re-presenting is either
   * pointless (the account is gone) or PROHIBITED (authorization revoked).
   */
  retryable: boolean;
  daysToRetry: number | null;
  requiresNewBankInfo: boolean;
}

/**
 * The consumer-relevant NACHA return codes, R01 through R29.
 *
 * Wave C completed the table: it previously held 14 of the 25 codes in this
 * range, and `classifyAchReturn` mapped every gap to a non-retryable "other".
 * That was safe (never re-present what you don't understand) but blind — an
 * R11 (a re-presentable "entry not in accordance with the authorization
 * terms") looked identical to an R10 (authorization revoked, must never be
 * re-presented), and neither drove the right borrower message. Every code
 * below carries the disposition NACHA actually assigns it.
 */
export const ACH_RETURN_CODES: Record<string, AchReturnCode> = {
  R01: { code: "R01", description: "Insufficient Funds", category: "insufficient_funds", retryable: true, daysToRetry: 5, requiresNewBankInfo: false },
  R02: { code: "R02", description: "Account Closed", category: "account_closed", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R03: { code: "R03", description: "No Account / Unable to Locate Account", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R04: { code: "R04", description: "Invalid Account Number", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R05: { code: "R05", description: "Unauthorized Debit to Consumer Account", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R06: { code: "R06", description: "Returned per ODFI Request", category: "administrative", retryable: true, daysToRetry: 3, requiresNewBankInfo: false },
  R07: { code: "R07", description: "Authorization Revoked by Customer", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R08: { code: "R08", description: "Payment Stopped", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R09: { code: "R09", description: "Uncollected Funds", category: "insufficient_funds", retryable: true, daysToRetry: 5, requiresNewBankInfo: false },
  R10: { code: "R10", description: "Customer Advises Originator is Not Known / Not Authorized", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  // R11 is NOT a revocation: the authorization exists but this entry departed
  // from its terms (wrong amount, wrong date). NACHA explicitly allows a
  // corrected re-presentment, which is why it is separated from R10.
  R11: { code: "R11", description: "Entry Not in Accordance with the Terms of the Authorization", category: "unauthorized", retryable: true, daysToRetry: 3, requiresNewBankInfo: false },
  R12: { code: "R12", description: "Account Sold to Another DFI", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R13: { code: "R13", description: "Invalid ACH Routing Number", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R14: { code: "R14", description: "Representative Payee Deceased or Unable to Continue", category: "account_closed", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R15: { code: "R15", description: "Beneficiary or Account Holder Deceased", category: "account_closed", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R16: { code: "R16", description: "Account Frozen / Funds Unavailable", category: "administrative", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R17: { code: "R17", description: "File Record Edit Criteria / Entry with Invalid Account Number", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R18: { code: "R18", description: "Improper Effective Entry Date", category: "administrative", retryable: true, daysToRetry: 1, requiresNewBankInfo: false },
  R19: { code: "R19", description: "Amount Field Error", category: "administrative", retryable: true, daysToRetry: 1, requiresNewBankInfo: false },
  R20: { code: "R20", description: "Non-Transaction Account", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R21: { code: "R21", description: "Invalid Company Identification", category: "administrative", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R22: { code: "R22", description: "Invalid Individual ID Number", category: "administrative", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R23: { code: "R23", description: "Credit Entry Refused by Receiver", category: "administrative", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R24: { code: "R24", description: "Duplicate Entry", category: "administrative", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
  R25: { code: "R25", description: "Addenda Error", category: "administrative", retryable: true, daysToRetry: 1, requiresNewBankInfo: false },
  R26: { code: "R26", description: "Mandatory Field Error", category: "administrative", retryable: true, daysToRetry: 1, requiresNewBankInfo: false },
  R27: { code: "R27", description: "Trace Number Error", category: "administrative", retryable: true, daysToRetry: 1, requiresNewBankInfo: false },
  R28: { code: "R28", description: "Routing Number Check Digit Error", category: "invalid_account", retryable: false, daysToRetry: null, requiresNewBankInfo: true },
  R29: { code: "R29", description: "Corporate Customer Advises Not Authorized", category: "unauthorized", retryable: false, daysToRetry: null, requiresNewBankInfo: false },
};

/**
 * Classify a return code. An UNKNOWN code fails closed: not retryable, no
 * new-bank-info demand, category "other". We never invent a disposition for a
 * code we don't recognise — a mis-guessed retry is an unauthorized debit.
 */
export function classifyAchReturn(returnCode: string): AchReturnCode {
  const normalized = returnCode.trim().toUpperCase();
  return (
    ACH_RETURN_CODES[normalized] || {
      code: normalized,
      description: "Unknown Return Code",
      category: "other",
      retryable: false,
      daysToRetry: null,
      requiresNewBankInfo: false,
    }
  );
}

/**
 * True when a return means the mandate itself is dead and MUST NOT be
 * re-presented against — the borrower (or their bank, on their behalf)
 * withdrew authorization. NACHA requires the Originator to stop immediately
 * and obtain a fresh authorization before any further debit.
 */
export function returnRevokesAuthorization(code: AchReturnCode): boolean {
  return code.category === "unauthorized" && !code.retryable;
}

/**
 * Map a processor's own failure/decline code onto the NACHA taxonomy above.
 *
 * Stripe does not surface the raw R-code on an ACH debit failure; it surfaces
 * a `failure_code` / `decline_code` string on the charge or
 * `last_payment_error.decline_code` on the PaymentIntent. This is the
 * documented correspondence. An unrecognised string returns null so the
 * caller records the RAW code and treats it as non-retryable, rather than
 * guessing a disposition.
 */
const STRIPE_ACH_FAILURE_TO_R_CODE: Record<string, string> = {
  insufficient_funds: "R01",
  account_closed: "R02",
  no_account: "R03",
  invalid_account_number: "R04",
  incorrect_account_holder_name: "R03",
  incorrect_account_holder_address: "R03",
  incorrect_account_holder_tax_id: "R03",
  debit_not_authorized: "R10",
  payment_method_not_available: "R16",
  account_frozen: "R16",
  bank_account_restricted: "R16",
  bank_account_unusable: "R20",
  invalid_currency: "R21",
  branch_does_not_exist: "R13",
  invalid_account_number_length: "R04",
  refer_to_customer: "R16",
  // Stripe's generic ACH-return bucket. Deliberately mapped to R01 ONLY when
  // Stripe also reports the funds-related network reason; the bare string is
  // NOT in this table so it falls through to null (fail closed).
};

export function mapProcessorFailureToReturnCode(
  failureCode: string | null | undefined,
): AchReturnCode | null {
  if (!failureCode) return null;
  const mapped = STRIPE_ACH_FAILURE_TO_R_CODE[failureCode.trim().toLowerCase()];
  if (!mapped) return null;
  return classifyAchReturn(mapped);
}

// ============================================
// PAYMENT PROFILE MANAGEMENT
// ============================================

export interface CreatePaymentProfileInput {
  firstName: string;
  lastName: string;
  email: string;
  routingNumber: string;
  accountNumber: string;
  accountType: "checking" | "savings";
  bankName?: string;
}

export interface PaymentProfileResult {
  success: boolean;
  profileId?: string;
  error?: string;
}

/**
 * Create an Actum payment profile.
 *
 * REFUSES when Actum is unconfigured. It previously returned a fabricated
 * `test_profile_<timestamp>` id with `success: true`, which a caller would
 * have stored on `notes.payment_account_id` as if a real bank instrument
 * existed behind it.
 */
export async function createActumPaymentProfile(
  input: CreatePaymentProfileInput,
): Promise<PaymentProfileResult> {
  if (!isActumConfigured()) {
    logger.warn("[actum] createActumPaymentProfile refused — Actum not configured");
    return { success: false, error: ACTUM_NOT_CONFIGURED };
  }
  try {
    const resp = await fetch(`${ACTUM_ENDPOINT}/payment-profiles`, {
      method: "POST",
      headers: getActumHeaders(),
      body: JSON.stringify({
        first_name: input.firstName,
        last_name: input.lastName,
        email: input.email,
        bank_routing_number: input.routingNumber,
        bank_account_number: input.accountNumber,
        bank_account_type: input.accountType,
        bank_name: input.bankName,
      }),
    });

    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { message?: string };
      return { success: false, error: err.message || `HTTP ${resp.status}` };
    }

    const data = (await resp.json()) as { profile_id?: string };
    if (!data.profile_id) {
      return { success: false, error: "Actum returned no profile_id" };
    }
    return { success: true, profileId: data.profile_id };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[actum] createActumPaymentProfile failed", err instanceof Error ? err : undefined);
    return { success: false, error: message };
  }
}

// ============================================
// CHARGE A PAYMENT
// ============================================

export interface ChargeActumInput {
  profileId: string;
  amountCents: number;
  description: string;
  noteId: number;
  orgId: number;
  effectiveDate?: string; // YYYY-MM-DD, defaults to next business day
  /**
   * REQUIRED. Replayed to Actum so a crash between our attempt row and their
   * response cannot mint a second debit. There is no default: a debit without
   * an idempotency key is a debit that can double-charge.
   */
  idempotencyKey: string;
}

export interface ChargeResult {
  success: boolean;
  transactionId?: string;
  status?: "pending" | "approved" | "declined" | "returned";
  returnCode?: string;
  error?: string;
}

/**
 * Submit an ACH debit to Actum.
 *
 * REFUSES when Actum is unconfigured. It previously returned
 * `{ success: true, transactionId: "test_txn_<ts>", status: "pending" }` —
 * a fabricated debit that a ledger writer would have booked as real money.
 */
export async function chargeActumACH(input: ChargeActumInput): Promise<ChargeResult> {
  if (!isActumConfigured()) {
    logger.warn("[actum] chargeActumACH refused — Actum not configured", {
      noteId: input.noteId,
      orgId: input.orgId,
    });
    return { success: false, error: ACTUM_NOT_CONFIGURED };
  }
  if (!input.idempotencyKey) {
    return { success: false, error: "idempotencyKey is required for an ACH debit" };
  }
  try {
    const resp = await fetch(`${ACTUM_ENDPOINT}/transactions`, {
      method: "POST",
      headers: {
        ...getActumHeaders(),
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        profile_id: input.profileId,
        amount: input.amountCents,
        description: input.description,
        effective_date: input.effectiveDate,
        reference: `note_${input.noteId}`,
        idempotency_key: input.idempotencyKey,
      }),
    });

    if (!resp.ok) {
      const err = (await resp.json().catch(() => ({}))) as { message?: string };
      return { success: false, error: err.message || `HTTP ${resp.status}` };
    }

    const data = (await resp.json()) as {
      transaction_id?: string;
      status?: ChargeResult["status"];
      return_code?: string;
    };
    if (!data.transaction_id) {
      return { success: false, error: "Actum returned no transaction_id" };
    }
    return {
      success: data.status !== "declined" && data.status !== "returned",
      transactionId: data.transaction_id,
      status: data.status,
      returnCode: data.return_code,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error("[actum] chargeActumACH failed", err instanceof Error ? err : undefined, {
      noteId: input.noteId,
    });
    return { success: false, error: message };
  }
}

// ============================================
// BATCH MONTHLY PAYMENT RUN — RETIRED
// ============================================

export interface BatchPaymentResult {
  total: number;
  submitted: number;
  failed: number;
  results: { noteId: number; status: "submitted" | "failed"; error?: string }[];
}

/**
 * RETIRED (Wave C). This ran a monthly ACH batch that:
 *   - selected every autopay note regardless of whether a payment was DUE,
 *   - carried no idempotency key, so a rerun re-debited every borrower,
 *   - checked no stored authorization (there was none to check),
 *   - and wrote NOTHING to the `payments` ledger, so a successful debit left
 *     no record and the balance never moved.
 *
 * It is kept as a refusal rather than deleted because
 * `POST /api/actum/batch-payment-run` (routes-elite-features.ts) still calls
 * it; a 200 with `submitted: 0` and an explicit reason is honest, whereas
 * deleting the export would 500 the route. The live autopay path is
 * `runAchAutopayCycle()` in server/services/achAutopay.ts.
 */
export async function runMonthlyActumPaymentBatch(orgId: number): Promise<BatchPaymentResult> {
  logger.warn(
    "[actum] runMonthlyActumPaymentBatch refused — retired in favour of the mandate-backed, idempotent ACH autopay cycle",
    { orgId },
  );
  return {
    total: 0,
    submitted: 0,
    failed: 0,
    results: [],
  };
}

/** Human-readable reason the Actum batch runner refuses, for API responses. */
export const ACTUM_BATCH_RETIRED_REASON =
  "The Actum monthly batch runner is retired: it had no due-date check, no idempotency key, no stored borrower authorization, and never wrote to the payments ledger. Borrower autopay now runs through the mandate-backed ACH autopay cycle (server/services/achAutopay.ts).";
