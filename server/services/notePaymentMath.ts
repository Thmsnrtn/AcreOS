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
 *
 * Wave C "Money moves" (agent C3) added THE payoff engine here —
 * `computePayoffQuote` — and made every other payoff helper in the repo
 * delegate to it. See the PAYOFF header block below for the day-count
 * convention and the cents↔decimal boundary rules.
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

// ===========================================================================
// PAYOFF — THE ONE ENGINE (Wave C "Money moves", agent C3)
// ---------------------------------------------------------------------------
// Before this, three code paths computed a payoff three different ways:
//
//   1. this module's computePayoffCents        — ledger-derived, /365, floor days
//   2. routes-notes GET /api/notes/:id/payoff  — float per-diem, ROUND days
//      (so a payoff quoted 12 hours out charged a whole extra day of interest)
//   3. routes-borrower GET /api/borrower/payoff-quote — no ledger at all:
//      it GUESSED the last payment date as `nextPaymentDate − 30 days`
//      and did the arithmetic in floating-point dollars with .toFixed(2)
//
// A payoff quote that doesn't match the ledger to the cent is a legal
// problem, not a rounding nit. `computePayoffQuote` below is now the only
// place payoff arithmetic happens; every other exported payoff helper in
// this module delegates to it.
//
// ── DAY-COUNT CONVENTION ───────────────────────────────────────────────────
// ACTUAL/365 FIXED. Explicitly:
//
//   * The accrual period is the HALF-OPEN interval
//     [accrualStartDate, payoffDate) measured in WHOLE UTC DAYS, floored.
//     Interest is paid THROUGH the accrual start date (that posting settled
//     it), so the start date itself does not accrue again, and the payoff
//     date is the day the funds arrive — the borrower is not charged for it.
//     A payoff on the same day as the last posting accrues 0 days, never a
//     negative or a partial day. Fractions of a day are never charged:
//     floor, not round (the pre-Wave-C route rounded, which over-charged).
//
//   * The daily rate is APR / 365 for EVERY year, leap or not (365 "fixed").
//     This matches the convention already used by every prior AcreOS payoff
//     path — see the /365 in financialOSService.calculateNotePayoff and in
//     the old borrower-portal quote — so unifying the engine does not
//     silently re-price a single existing note.
//
//   * Interest is accrued on the CURRENT PRINCIPAL BALANCE for the whole
//     period (simple interest, no compounding within the stub period).
//
//   * accrued = round_half_up(balance × rate × days). Rounding to the cent
//     happens EXACTLY ONCE, on the total, from exact integer arithmetic —
//     never per-day, and never through a binary float. `perDiemInterestCents`
//     is a DISPLAY value (the same formula for days = 1); because rounding is
//     applied once to the total, perDiem × days may legitimately differ from
//     `accruedInterestCents` by a few cents. `accruedInterestCents` is the
//     authoritative number; per-diem is what a closer uses to extend a quote.
//
// ── ARITHMETIC ─────────────────────────────────────────────────────────────
// The core multiplies in BigInt. balance(cents) × rate(hundredths of a bp)
// × days overflows IEEE-754's exact-integer range (2^53) for a large note
// over a long stub period — e.g. $10M × 10% × 10 years is ~3.7e17 — so the
// products are taken as BigInt and divided with an exact half-up rounding
// step. There is no floating-point operation anywhere on the money path.
// ===========================================================================

/** The one day-count convention. Recorded on every persisted quote. */
export const PAYOFF_DAY_COUNT_CONVENTION = "actual/365_fixed" as const;

/**
 * Bumped when the engine's arithmetic changes in a way that could move a
 * quoted number. Stored on every persisted quote so an old quote can be
 * explained by the engine that produced it.
 */
export const PAYOFF_ENGINE_VERSION = "payoff-engine-1" as const;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Denominator of the fixed day count. */
const DAYS_PER_YEAR = 365n;
/** bps → fraction. */
const BPS_PER_UNIT = 10_000n;
/** We carry the rate in HUNDREDTHS of a basis point so 9.875% (987.5 bps) is exact. */
const HUNDREDTHS_PER_BP = 100n;

/**
 * Exact half-up division of two BigInts (ties away from zero). Matches
 * `Math.round` for non-negative inputs — which is all the money path
 * produces — but without float error.
 */
function roundHalfUpDiv(numerator: bigint, denominator: bigint): bigint {
  if (denominator <= 0n) throw new Error("roundHalfUpDiv: denominator must be > 0");
  if (numerator >= 0n) return (2n * numerator + denominator) / (2n * denominator);
  return -((2n * -numerator + denominator) / (2n * denominator));
}

/**
 * Whole days from `from` to `to`, floored, never negative. UTC-based: every
 * date this engine sees is either a `date` column (Postgres `date` → drizzle
 * `YYYY-MM-DD` string → parsed at UTC midnight by `parseIsoDateUtc`) or an
 * explicit UTC-midnight Date, so no timezone can shift a day boundary and
 * change a quoted amount.
 */
export function wholeDaysBetweenUtc(from: Date, to: Date): number {
  const days = Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
  return days > 0 ? days : 0;
}

/**
 * Parse a `YYYY-MM-DD` date (Postgres `date` column, or an ISO timestamp) at
 * UTC midnight. Throws on garbage rather than yielding an Invalid Date that
 * would silently become 0 days of interest.
 */
export function parseIsoDateUtc(value: string | Date): Date {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new Error("parseIsoDateUtc: invalid Date");
    return value;
  }
  const day = String(value).slice(0, 10);
  const parsed = new Date(`${day}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`parseIsoDateUtc: not a valid ISO date: ${String(value)}`);
  }
  return parsed;
}

/** `YYYY-MM-DD` for a UTC instant. */
export function isoDateUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface PayoffQuoteInput {
  /** Live principal balance, integer cents. Never a schedule replay. */
  principalBalanceCents: number;
  /**
   * Annual rate in basis points. MAY be fractional when the source carries
   * more precision than 1 bp (the servicing `notes` table stores the rate as
   * a decimal percent string, so 9.875% arrives as 987.5). Carried
   * internally as an exact integer count of hundredths-of-a-bp.
   */
  annualRateBps: number;
  /**
   * Date interest is paid THROUGH — the payment_date of the most recent
   * ledger posting that included interest, else origination. Derive it with
   * `resolvePayoffAccrualStart`; never guess it from a schedule.
   */
  accrualStartDate: Date;
  /** The date the payoff funds are good — the quote's good-through date. */
  payoffDate: Date;
  /** Unapplied funds already held for this borrower; reduces the payoff. */
  unappliedCreditCents?: number;
  /**
   * Late fees ASSESSED AND STILL OWED. Callers that cannot distinguish
   * assessed-unpaid from already-collected late fees MUST pass 0 (or omit)
   * rather than passing a collected-fees total — adding fees the borrower
   * already paid to a payoff is a double charge.
   */
  lateFeesOutstandingCents?: number;
  /** Org-configured payoff/processing fee, if any. */
  payoffFeeCents?: number;
}

export interface PayoffQuote {
  principalBalanceCents: number;
  annualRateBps: number;
  accrualStartDate: string; // YYYY-MM-DD
  payoffDate: string; // YYYY-MM-DD
  daysAccrued: number;
  dayCountConvention: typeof PAYOFF_DAY_COUNT_CONVENTION;
  /** Display-only: one day's interest at the current balance. See header. */
  perDiemInterestCents: number;
  /** Authoritative accrual for `daysAccrued` days. Rounded once, exactly. */
  accruedInterestCents: number;
  unappliedCreditCents: number;
  lateFeesOutstandingCents: number;
  payoffFeeCents: number;
  /** principal + accrued + lateFeesOutstanding + fee − unapplied, floored at 0. */
  totalPayoffCents: number;
  engineVersion: typeof PAYOFF_ENGINE_VERSION;
}

/**
 * THE payoff engine. Every payoff number AcreOS quotes comes from here.
 */
export function computePayoffQuote(input: PayoffQuoteInput): PayoffQuote {
  const {
    principalBalanceCents,
    annualRateBps,
    accrualStartDate,
    payoffDate,
    unappliedCreditCents = 0,
    lateFeesOutstandingCents = 0,
    payoffFeeCents = 0,
  } = input;

  if (!Number.isInteger(principalBalanceCents) || principalBalanceCents < 0) {
    throw new Error("computePayoffQuote: principalBalanceCents must be a non-negative integer (cents)");
  }
  if (!Number.isFinite(annualRateBps) || annualRateBps < 0) {
    throw new Error("computePayoffQuote: annualRateBps must be finite and >= 0");
  }
  for (const [name, val] of [
    ["unappliedCreditCents", unappliedCreditCents],
    ["lateFeesOutstandingCents", lateFeesOutstandingCents],
    ["payoffFeeCents", payoffFeeCents],
  ] as const) {
    if (!Number.isInteger(val) || val < 0) {
      throw new Error(`computePayoffQuote: ${name} must be a non-negative integer (cents)`);
    }
  }

  const daysAccrued = wholeDaysBetweenUtc(accrualStartDate, payoffDate);

  // Rate as an exact integer count of hundredths-of-a-basis-point.
  const rateHundredthsBp = BigInt(Math.round(annualRateBps * 100));
  const balance = BigInt(principalBalanceCents);
  const denominator = BPS_PER_UNIT * HUNDREDTHS_PER_BP * DAYS_PER_YEAR;

  const accruedInterestCents = Number(
    roundHalfUpDiv(balance * rateHundredthsBp * BigInt(daysAccrued), denominator),
  );
  const perDiemInterestCents = Number(
    roundHalfUpDiv(balance * rateHundredthsBp, denominator),
  );

  const gross =
    principalBalanceCents + accruedInterestCents + lateFeesOutstandingCents + payoffFeeCents;
  const totalPayoffCents = Math.max(0, gross - unappliedCreditCents);

  return {
    principalBalanceCents,
    annualRateBps,
    accrualStartDate: isoDateUtc(accrualStartDate),
    payoffDate: isoDateUtc(payoffDate),
    daysAccrued,
    dayCountConvention: PAYOFF_DAY_COUNT_CONVENTION,
    perDiemInterestCents,
    accruedInterestCents,
    unappliedCreditCents,
    lateFeesOutstandingCents,
    payoffFeeCents,
    totalPayoffCents,
    engineVersion: PAYOFF_ENGINE_VERSION,
  };
}

/**
 * Ledger-derived accrual start: the payment_date of the most recent posting
 * that carried interest (interest is settled THROUGH that date), else the
 * note's origination date when the ledger has no interest-bearing posting.
 *
 * Rows with `interestCents <= 0` are ignored on purpose: a principal-only
 * curtailment or an unapplied deposit settles no interest, so it must not
 * reset the accrual clock, and an NSF reversal (negative interest) is not a
 * settlement at all.
 *
 * This is the ONLY sanctioned way to determine the accrual start. Deriving
 * it from `nextPaymentDate − 30 days`, from a schedule index, or from
 * "today" produces a number the ledger cannot defend.
 */
export function resolvePayoffAccrualStart(
  ledgerRows: Array<{ paymentDate: string | Date; interestCents: number | string | null }>,
  originationDate: string | Date,
): Date {
  let latest: Date | null = null;
  for (const row of ledgerRows) {
    const interest = Number(row.interestCents ?? 0);
    if (!Number.isFinite(interest) || interest <= 0) continue;
    const posted = parseIsoDateUtc(row.paymentDate);
    if (latest === null || posted.getTime() > latest.getTime()) latest = posted;
  }
  return latest ?? parseIsoDateUtc(originationDate);
}

/**
 * Back-compat wrapper kept because `notePaymentCorrectness.test.ts` pins it
 * as the live-ledger payoff helper. It now delegates to the one engine, so
 * the invariant it guards ("payoff = live balance + per-diem since the last
 * posting, /365") is asserted against the real production arithmetic.
 */
export interface ComputePayoffInput {
  currentBalanceCents: number;
  annualRateBps: number;
  lastPostingDate: Date;
  payoffDate: Date;
}

export function computePayoffCents(input: ComputePayoffInput): number {
  return computePayoffQuote({
    principalBalanceCents: input.currentBalanceCents,
    annualRateBps: input.annualRateBps,
    accrualStartDate: input.lastPostingDate,
    payoffDate: input.payoffDate,
  }).totalPayoffCents;
}

// ---------------------------------------------------------------------------
// THE CENTS ↔ DECIMAL BOUNDARY
//
// AcreOS carries TWO note books with two different money representations:
//
//   * `acquired_notes` + `note_payments` (the note-investor book) — integer
//     cents in bigint columns. Native to this engine.
//   * `notes` + `payments` (the seller-finance servicing book, the borrower
//     portal's book) — numeric DECIMAL STRINGS for dollars ("48250.00") and
//     an annual PERCENT string for the rate ("9.875").
//
// The borrower payoff quote reads the DECIMAL book, so a payoff quote for a
// serviced note has to cross the boundary. Everything below is that crossing,
// in one place, converting decimal strings to integer cents WITHOUT going
// through a binary float (parseFloat("0.145") * 100 is 14.499999999999998 —
// a cent lost, silently, on a legal document). Callers convert at the edge
// and stay in cents from there.
// ---------------------------------------------------------------------------

/**
 * Exact decimal-string → integer conversion, scaled by 10^`scale`, with
 * half-up rounding on the first dropped digit. No floating point.
 *
 *   decimalStringToScaledInt("48250.005", 2) === 4825001
 *   decimalStringToScaledInt("0.145", 2)     === 15   (parseFloat gives 14)
 */
export function decimalStringToScaledInt(value: string | number | null | undefined, scale: number): number {
  if (!Number.isInteger(scale) || scale < 0) throw new Error("decimalStringToScaledInt: scale must be a non-negative integer");
  const raw = String(value ?? "0").trim();
  if (raw === "" ) return 0;
  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) {
    throw new Error(`decimalStringToScaledInt: not a decimal number: ${raw}`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const whole = match[2] || "0";
  const frac = match[3] ?? "";
  // Keep `scale` fractional digits, plus one guard digit for half-up rounding.
  const kept = frac.slice(0, scale).padEnd(scale, "0");
  const guard = frac.charAt(scale);
  let scaled = BigInt(whole + kept);
  if (guard !== "" && Number(guard) >= 5) scaled += 1n;
  return Number(sign * scaled);
}

/** Dollars as a decimal string → integer cents, exactly. */
export function decimalDollarsToCents(value: string | number | null | undefined): number {
  return decimalStringToScaledInt(value, 2);
}

/**
 * Annual percent as a decimal string → basis points. May return a fractional
 * bps value (9.875% → 987.5); `computePayoffQuote` carries hundredths of a bp
 * exactly, so no rate precision is lost crossing the boundary.
 */
export function percentStringToBps(value: string | number | null | undefined): number {
  // percent × 10^4 = hundredths-of-a-bp; ÷100 back to (possibly fractional) bps.
  return decimalStringToScaledInt(value, 4) / 100;
}

/**
 * Build engine inputs for a note from the DECIMAL servicing book (`notes`),
 * with the accrual start derived from that book's payment ledger
 * (`payments`) — never from `nextPaymentDate − 30 days`.
 *
 * This is the delegation point for the borrower-portal payoff quote: the
 * portal reads its note + payment rows, calls this, and passes the result to
 * `computePayoffQuote`. The result is identical, to the cent, to what the
 * acquired-note path produces for the same economics — proven in
 * `tests/unit/payoffEngineUnification.test.ts`.
 */
export interface DecimalServicedNoteSource {
  /** notes.currentBalance — dollars as a decimal string. */
  currentBalance: string | number | null | undefined;
  /** notes.interestRate — ANNUAL PERCENT as a decimal string ("9.875"). */
  interestRate: string | number | null | undefined;
  /** notes.startDate — fallback accrual start when nothing has posted yet. */
  startDate: string | Date;
}

export function payoffInputsFromServicedNote(input: {
  note: DecimalServicedNoteSource;
  /** `payments` rows for the note: decimal-string interest amounts. */
  ledgerRows: Array<{ paymentDate: string | Date; interestAmount: string | number | null }>;
  payoffDate: Date;
  unappliedCreditCents?: number;
  lateFeesOutstandingCents?: number;
  payoffFeeCents?: number;
}): PayoffQuoteInput {
  const accrualStartDate = resolvePayoffAccrualStart(
    input.ledgerRows.map((r) => ({
      paymentDate: r.paymentDate,
      interestCents: decimalDollarsToCents(r.interestAmount),
    })),
    input.note.startDate,
  );

  return {
    principalBalanceCents: decimalDollarsToCents(input.note.currentBalance),
    annualRateBps: percentStringToBps(input.note.interestRate),
    accrualStartDate,
    payoffDate: input.payoffDate,
    unappliedCreditCents: input.unappliedCreditCents ?? 0,
    lateFeesOutstandingCents: input.lateFeesOutstandingCents ?? 0,
    payoffFeeCents: input.payoffFeeCents ?? 0,
  };
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
