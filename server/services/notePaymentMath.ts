/**
 * notePaymentMath — integer-cents helpers for borrower payment posting.
 *
 * Workstream B (Collison review). Three bugs were closed by routing all
 * borrower-payment arithmetic through this module:
 *
 *   1. Float drift on principal/interest split. The borrower-portal
 *      writers used JS `number` math + .toFixed(2) and stored decimal
 *      strings. We now do the split in integer cents and only stringify
 *      at the response boundary.
 *
 *   2. lateFee was hard-coded to "0". computeAppliedLateFeeCents reads
 *      the note's configured lateFee + gracePeriodDays and returns the
 *      cents to assess.
 *
 *   3. Payoff diverged from the live ledger because financialOSService
 *      indexed an amortization schedule by paymentsReceived - 1. The
 *      live-ledger replacement (computePayoffCents) uses
 *      currentBalance + per-diem interest since the last posting.
 *
 *   4. The Stripe-session idempotency check was a read-then-write race.
 *      insertPaymentIdempotentCents converts the writer to a single
 *      INSERT … ON CONFLICT (transaction_id) DO NOTHING RETURNING * and
 *      falls back to fetching the existing row on zero rows.
 *
 * All amounts are integer cents. APR is in basis points (e.g. 990 = 9.90%).
 */

// ---------------------------------------------------------------------------
// Principal / interest split — integer cents.
//
// Convention matches the existing borrower-portal code path it replaces:
//   monthly interest = currentBalance * (annualRateBps / 10_000) / 12
// Principal is the residual after interest. If the payment would consume
// more than the current balance (final/payoff payment), principal is
// clamped to the balance and any excess is returned as `residueCents`.
// Callers can treat residue as unapplied / refund / overpay as policy
// dictates.
// ---------------------------------------------------------------------------

export interface SplitPaymentInput {
  paymentAmountCents: number;
  currentBalanceCents: number;
  annualRateBps: number;
}

export interface SplitPaymentResult {
  principalCents: number;
  interestCents: number;
  /**
   * Residue is the amount that exceeded principal + interest (e.g. on a
   * payoff where the borrower paid more than balance + accrued). Always
   * >= 0. principalCents + interestCents + residueCents === paymentAmountCents.
   */
  residueCents: number;
}

export function splitPaymentCents(input: SplitPaymentInput): SplitPaymentResult {
  const { paymentAmountCents, currentBalanceCents, annualRateBps } = input;

  if (paymentAmountCents < 0) {
    throw new Error("paymentAmountCents must be >= 0");
  }
  if (currentBalanceCents < 0) {
    throw new Error("currentBalanceCents must be >= 0");
  }
  if (annualRateBps < 0) {
    throw new Error("annualRateBps must be >= 0");
  }

  // monthly interest accrual: balance * apr / 12, rounded to cent.
  // We round HALF-UP via Math.round on integer cents — no float drift.
  const monthlyRateNumerator = annualRateBps; // bps
  const monthlyRateDenominator = 10_000 * 12; // 1.0 * 12
  const interestCents = Math.round(
    (currentBalanceCents * monthlyRateNumerator) / monthlyRateDenominator,
  );

  // Cap interest at the payment (you can't accrue more interest than
  // the borrower sent).
  const cappedInterestCents = Math.min(interestCents, paymentAmountCents);

  // Principal = payment - interest, clamped to balance.
  const principalRaw = paymentAmountCents - cappedInterestCents;
  const principalCents = Math.max(0, Math.min(principalRaw, currentBalanceCents));

  // Residue = anything left over (payoff overpay).
  const residueCents = paymentAmountCents - cappedInterestCents - principalCents;

  return {
    principalCents,
    interestCents: cappedInterestCents,
    residueCents,
  };
}

// ---------------------------------------------------------------------------
// Late fee — computed inside the same withTransaction as the payment write.
// Returns 0 inside grace, configuredLateFeeCents otherwise.
//
// Boundary: payment posted EXACTLY at dueDate + gracePeriodDays is still
// inside grace (the borrower had the full grace period). Only payments
// strictly LATER than that incur the fee.
// ---------------------------------------------------------------------------

export interface ComputeLateFeeInput {
  dueDate: Date;
  paymentDate: Date;
  gracePeriodDays: number;
  configuredLateFeeCents: number;
}

export function computeAppliedLateFeeCents(input: ComputeLateFeeInput): number {
  const { dueDate, paymentDate, gracePeriodDays, configuredLateFeeCents } = input;

  if (configuredLateFeeCents <= 0) return 0;
  if (gracePeriodDays < 0) return 0;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const daysLate = Math.floor(
    (paymentDate.getTime() - dueDate.getTime()) / MS_PER_DAY,
  );

  if (daysLate <= gracePeriodDays) return 0;
  return configuredLateFeeCents;
}

// ---------------------------------------------------------------------------
// Payoff — live-ledger replacement for the schedule-replay branch in
// financialOSService.calculateNotePayoff.
//
// payoff = currentBalanceCents + per-diem accrued interest since the last
//          payment posting date.
//
// Convention: daily rate = APR / 365 (matches the existing /365 used in
// routes-borrower:/api/borrower/payoff-quote and in
// financialOSService.calculateNotePayoff).
// ---------------------------------------------------------------------------

export interface ComputePayoffInput {
  currentBalanceCents: number;
  annualRateBps: number;
  lastPostingDate: Date;
  payoffDate: Date;
}

export function computePayoffCents(input: ComputePayoffInput): number {
  const { currentBalanceCents, annualRateBps, lastPostingDate, payoffDate } = input;

  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const days = Math.max(
    0,
    Math.floor((payoffDate.getTime() - lastPostingDate.getTime()) / MS_PER_DAY),
  );

  // accrued = balance * apr / 365 * days
  // We compute on integers to avoid float drift, rounding to cent at end.
  const accruedCents = Math.round(
    (currentBalanceCents * annualRateBps * days) / (10_000 * 365),
  );

  return currentBalanceCents + accruedCents;
}

// ---------------------------------------------------------------------------
// Idempotent payment insert — caller provides DB-level primitives so the
// helper stays SQL-agnostic and unit-testable. The contract:
//
//   insertOnConflict(txnId): returns the new row if inserted, or null if
//     the unique-constraint on transactionId already held a row (i.e.
//     PG's ON CONFLICT DO NOTHING RETURNING * yields zero rows).
//
//   fetchExisting(txnId): returns the existing row (called only when
//     insertOnConflict returns null, never during the racing window).
//
// The helper returns { row, created } so callers can log which branch
// fired without re-querying.
// ---------------------------------------------------------------------------

export interface InsertPaymentIdempotentInput<TRow> {
  transactionId: string;
  insertOnConflict: (transactionId: string) => Promise<TRow | null>;
  fetchExisting: (transactionId: string) => Promise<TRow | null>;
}

export interface InsertPaymentIdempotentResult<TRow> {
  row: TRow;
  created: boolean;
}

export async function insertPaymentIdempotentCents<TRow>(
  input: InsertPaymentIdempotentInput<TRow>,
): Promise<InsertPaymentIdempotentResult<TRow>> {
  const inserted = await input.insertOnConflict(input.transactionId);
  if (inserted) {
    return { row: inserted, created: true };
  }
  const existing = await input.fetchExisting(input.transactionId);
  if (!existing) {
    // Shouldn't happen — a conflict means the row exists. If a separate
    // process deleted it between INSERT and SELECT, we surface that
    // explicitly rather than silently returning null.
    throw new Error(
      `insertPaymentIdempotentCents: conflict reported but no existing row found for transactionId=${input.transactionId}`,
    );
  }
  return { row: existing, created: false };
}

// ---------------------------------------------------------------------------
// Ledger entry — shape consumed by tests + by future reconciliation. Not
// a DB row; a plain in-memory entry used to verify invariants in the
// unit tests.
// ---------------------------------------------------------------------------

export interface PaymentLedgerEntry {
  paymentDate: Date;
  principalCents: number;
  interestCents: number;
  unappliedCents: number;
}
