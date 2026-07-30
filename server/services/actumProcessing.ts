/**
 * ACH return-code taxonomy (NACHA R01–R29) and the mapping from a processor's
 * own failure codes onto it. Rail-agnostic; no processor client lives here.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 2026-07-29 — "Be the rail, not the provider" (founder ruling)
 * ─────────────────────────────────────────────────────────────────────────
 * This file used to also contain an Actum Processing HTTP client:
 * `isActumConfigured` / `createActumPaymentProfile` / `chargeActumACH` /
 * `runMonthlyActumPaymentBatch`, driven by a SINGLE platform-wide
 * `ACTUM_MERCHANT_ID`. That shape makes AcreOS the merchant of record for
 * every customer's borrower debits — customer money moving on AcreOS's own
 * merchant account. The ruling forbids exactly that: any customer-managed
 * money movement runs on the CUSTOMER's own connected processor account, or is
 * routed out entirely. Only subscription payments TO AcreOS are payments
 * AcreOS is a party to.
 *
 * The client was already dormant (no credentials anywhere, no merchant
 * account, every entry point refusing after Wave C), and one of its mounted
 * endpoints — `POST /api/actum/create-profile` — accepted RAW bank routing and
 * account numbers into AcreOS's own request path. Both the routes
 * (routes-elite-features.ts) and the client are deleted.
 *
 * What survives is the part that was always genuinely valuable and carries no
 * custody: the NACHA return-code table, its retry classification, and the
 * mapper from a processor's failure code onto it. The live borrower ACH rail
 * is Stripe `us_bank_account` on the LENDER's own Stripe Connect account
 * (`stripeAccount` header) — see server/services/achAutopay.ts and
 * server/services/achMandateSetup.ts — and it classifies returns against this
 * table. Bank details are collected directly into the lender's Stripe account;
 * AcreOS stores last4 only.
 *
 * No environment variables. No network calls. No money moves through here.
 */

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
