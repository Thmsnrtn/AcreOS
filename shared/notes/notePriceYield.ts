/**
 * Note price ↔ yield — pre-purchase pricing (autonomy gap N-4, slice 4).
 *
 * "What do I pay for a 12% yield?" before the note is on the book.
 * `computeYields` (server/routes-notes.ts) answers the yield question only for
 * notes already owned; this is the buyer's side of the same arithmetic.
 *
 * PURE: no I/O, no clock, no database. Every input is carried in the argument
 * (a date-derived month count is computed by the caller, or by
 * `pricingInputFromTapeRow` from dates the caller hands it).
 *
 * CONVENTION — identical to computeYields:
 *   - amounts are integer cents; rates are basis points (`noteRateBps`,
 *     `targetYieldBps`; the latter may be fractional);
 *   - yield is a MONTHLY IRR of the stream [-price, f1, f2, …, fH] converted
 *     to annual by (1 + r_m)^12 − 1. The target is converted back by
 *     (1 + Y)^(1/12) − 1, so price → yield → price round-trips;
 *   - honesty: an input the math cannot use, or an IRR that does not exist,
 *     is a typed REFUSAL — never a clamped, defaulted or guessed number.
 *
 * SCHEDULE MODEL — the note's remaining scheduled cash flows, month 1..H:
 *   interest accrues monthly at noteRate/12 on the outstanding balance, the
 *   buyer receives min(payment, balance + interest) each month, and
 *     - no balloon: H = remaining term; the balance still owed after the last
 *       payment is paid at H (zero for a fully amortizing note; the whole
 *       balance for an interest-only note);
 *     - balloon: H = balloon month; the stated balloon is paid at H together
 *       with that month's regular payment (so a balloon is "the balance left
 *       after payment H"). A balloon larger than that balance is impossible
 *       and refused.
 *   A payment below the monthly interest is modelled as it is written: the
 *   unpaid interest capitalizes (negative amortization), the buyer still
 *   receives only the stated payment, and the grown balance is owed at H.
 *   No prepayments, defaults, late fees or servicing cost are assumed: this is
 *   the yield of the CONTRACT as stated, which is exactly what a seller's tape
 *   states and nothing more.
 *
 * Present value is a direct discount of those flows at the target monthly
 * yield (no iteration). The reverse (yield for a price) solves the IRR by
 * bounded bisection — NPV is strictly decreasing in the rate when every flow
 * after the price is non-negative, so the root is unique and bracketed or the
 * solve refuses.
 */

export interface NoteBalloon {
  /** The lump due at `month`, in cents. */
  amountCents: number;
  /** Payment number (1-based, counted from the pricing date) the balloon falls due with. */
  month: number;
}

export interface NoteCashFlowInput {
  /** Unpaid principal balance today, cents. */
  currentBalanceCents: number;
  /** Note rate, basis points per year (1000 = 10%). */
  noteRateBps: number;
  /** Scheduled P&I per month, cents. */
  paymentAmountCents: number;
  /** Scheduled payments remaining (whole months, ≥ 1). */
  remainingTermMonths: number;
  /** Omit / null for a note with no balloon. */
  balloon?: NoteBalloon | null;
}

export type PriceYieldRefusalCode =
  | "balance_invalid"
  | "rate_invalid"
  | "payment_invalid"
  | "term_invalid"
  | "balloon_invalid"
  | "balloon_month_out_of_range"
  | "balloon_exceeds_balance"
  | "target_yield_invalid"
  | "price_invalid"
  | "no_cash_flow"
  | "yield_not_found";

export interface PriceYieldRefusal {
  ok: false;
  reason: PriceYieldRefusalCode;
  message: string;
}

export interface ScheduledFlows {
  ok: true;
  /** flowsCents[t-1] is the cash received at month t. Unrounded. */
  flowsCents: number[];
  horizonMonths: number;
  /** Sum of every scheduled flow, cents (unrounded). */
  totalCents: number;
}

export type PriceForYieldResult =
  | {
      ok: true;
      priceCents: number;
      /** priceCents / currentBalanceCents — the price as a fraction of UPB. */
      priceToBalance: number;
      horizonMonths: number;
      totalScheduledCents: number;
    }
  | PriceYieldRefusal;

export type YieldForPriceResult =
  | {
      ok: true;
      /** Annualized, decimal (0.12 = 12%): (1 + monthly)^12 − 1. */
      annualYield: number;
      monthlyYield: number;
      horizonMonths: number;
      totalScheduledCents: number;
    }
  | PriceYieldRefusal;

/** Hard ceiling on the schedule length so a bad input cannot spin the loop. */
export const MAX_REMAINING_TERM_MONTHS = 1200;

const refuse = (reason: PriceYieldRefusalCode, message: string): PriceYieldRefusal => ({ ok: false, reason, message });

const isPosInt = (n: unknown): n is number => typeof n === "number" && Number.isInteger(n) && n > 0;

/**
 * The note's scheduled cash flows. Exported so callers (and tests) can see the
 * stream a price or yield is computed from.
 */
export function scheduledCashFlows(input: NoteCashFlowInput): ScheduledFlows | PriceYieldRefusal {
  const { currentBalanceCents, noteRateBps, paymentAmountCents, remainingTermMonths } = input;
  const balloon = input.balloon ?? null;

  if (!Number.isFinite(currentBalanceCents) || currentBalanceCents <= 0) {
    return refuse("balance_invalid", "The unpaid balance must be greater than zero.");
  }
  if (!Number.isFinite(noteRateBps) || noteRateBps < 0) {
    return refuse("rate_invalid", "The note rate must be zero or more.");
  }
  if (!Number.isFinite(paymentAmountCents) || paymentAmountCents <= 0) {
    return refuse("payment_invalid", "The monthly payment must be greater than zero.");
  }
  if (!isPosInt(remainingTermMonths) || remainingTermMonths > MAX_REMAINING_TERM_MONTHS) {
    return refuse("term_invalid", `The remaining term must be a whole number of months from 1 to ${MAX_REMAINING_TERM_MONTHS}.`);
  }
  if (balloon !== null) {
    if (!Number.isFinite(balloon.amountCents) || balloon.amountCents <= 0) {
      return refuse("balloon_invalid", "A balloon amount must be greater than zero (leave the balloon out if there is none).");
    }
    if (!isPosInt(balloon.month) || balloon.month > remainingTermMonths) {
      return refuse("balloon_month_out_of_range", `The balloon must fall due with one of the remaining payments (month 1 to ${remainingTermMonths}).`);
    }
  }

  const horizon = balloon ? balloon.month : remainingTermMonths;
  const monthlyRate = noteRateBps / 10_000 / 12;
  const flows: number[] = [];
  let balance = currentBalanceCents;
  for (let t = 1; t <= horizon; t++) {
    const owed = balance * (1 + monthlyRate);
    const pay = Math.min(paymentAmountCents, owed);
    balance = owed - pay;
    if (balance < 1e-6) balance = 0;
    flows.push(pay);
  }

  if (balloon) {
    // A balloon cannot exceed what is still owed after payment `month`. The
    // seller's stated figure may differ from this schedule by the cents their
    // payment was rounded to, so allow a small tolerance — and only upward
    // slack: a smaller stated balloon is used as stated.
    const tolerance = Math.max(100, currentBalanceCents * 0.001);
    if (balloon.amountCents > balance + tolerance) {
      return refuse(
        "balloon_exceeds_balance",
        "The balloon is larger than the balance still owed after that payment — the balloon, payment, rate or balance on the tape do not agree.",
      );
    }
    flows[horizon - 1] += balloon.amountCents;
  } else {
    flows[horizon - 1] += balance;
  }

  const totalCents = flows.reduce((a, b) => a + b, 0);
  if (!(totalCents > 0)) return refuse("no_cash_flow", "The note has no scheduled cash flow to price.");
  return { ok: true, flowsCents: flows, horizonMonths: horizon, totalCents };
}

/** Annual decimal yield → the equivalent monthly rate. Inverse of the (1+r)^12 − 1 convention. */
export function monthlyFromAnnualYield(annualYield: number): number {
  return Math.pow(1 + annualYield, 1 / 12) - 1;
}

/** Monthly rate → annual decimal yield, the same convention as computeYields. */
export function annualFromMonthlyYield(monthly: number): number {
  return Math.pow(1 + monthly, 12) - 1;
}

/** NPV of flows received at months 1..n, discounted at a monthly rate (cents, unrounded). */
export function presentValueOfFlows(flowsCents: readonly number[], monthlyRate: number): number {
  let pv = 0;
  for (let t = 1; t <= flowsCents.length; t++) {
    const f = flowsCents[t - 1];
    if (f === 0) continue; // a note paid off early: 0 / underflowed-discount would be NaN
    pv += f / Math.pow(1 + monthlyRate, t);
  }
  return pv;
}

/**
 * The purchase price (cents) at which the buyer's annualized yield equals
 * `targetYieldBps`. Refuses a target at or below zero — a hurdle of zero or a
 * loss is not a pricing question this function will answer with a number.
 */
export function priceForTargetYield(input: NoteCashFlowInput, targetYieldBps: number): PriceForYieldResult {
  if (!Number.isFinite(targetYieldBps) || targetYieldBps <= 0) {
    return refuse("target_yield_invalid", "The target yield must be greater than zero.");
  }
  const sched = scheduledCashFlows(input);
  if (!sched.ok) return sched;
  const monthly = monthlyFromAnnualYield(targetYieldBps / 10_000);
  const pv = presentValueOfFlows(sched.flowsCents, monthly);
  const priceCents = Math.round(pv);
  if (!Number.isFinite(pv) || priceCents <= 0) {
    return refuse("price_invalid", "At that target yield the price rounds to nothing.");
  }
  return {
    ok: true,
    priceCents,
    priceToBalance: priceCents / input.currentBalanceCents,
    horizonMonths: sched.horizonMonths,
    totalScheduledCents: sched.totalCents,
  };
}

const IRR_LOW = -0.99; // monthly
const IRR_HIGH = 10; // monthly — far past any real note; beyond it we refuse
const IRR_MAX_ITER = 300;

/**
 * The annualized yield a buyer earns paying `priceCents` for the scheduled
 * flows: IRR of [-price, f1…fH], monthly, annualized by (1+r)^12 − 1. Refuses
 * a price ≤ 0 and an IRR that is not bracketed (no rate in (-99%, 1000%)
 * monthly zeroes the NPV — e.g. a price below the PV floor at the top rate).
 * A price above the total flows still has a root: a deeply negative yield,
 * returned as computed rather than refused.
 */
export function yieldForPrice(input: NoteCashFlowInput, priceCents: number): YieldForPriceResult {
  if (!Number.isFinite(priceCents) || priceCents <= 0) {
    return refuse("price_invalid", "The price must be greater than zero.");
  }
  const sched = scheduledCashFlows(input);
  if (!sched.ok) return sched;

  const npv = (r: number) => presentValueOfFlows(sched.flowsCents, r) - priceCents;
  let lo = IRR_LOW;
  let hi = IRR_HIGH;
  // NPV is strictly decreasing in r: positive at lo, negative at hi, or no root.
  if (!(npv(lo) > 0) || !(npv(hi) < 0)) {
    return refuse("yield_not_found", "No yield could be found for that price — it is outside any rate this note's cash flows can produce.");
  }
  for (let i = 0; i < IRR_MAX_ITER; i++) {
    const mid = (lo + hi) / 2;
    if (npv(mid) > 0) lo = mid;
    else hi = mid;
    if (hi - lo < 1e-14) break;
  }
  const monthly = (lo + hi) / 2;
  if (!Number.isFinite(monthly)) return refuse("yield_not_found", "No yield could be found for that price.");
  return {
    ok: true,
    annualYield: annualFromMonthlyYield(monthly),
    monthlyYield: monthly,
    horizonMonths: sched.horizonMonths,
    totalScheduledCents: sched.totalCents,
  };
}

// ── Tape rows ────────────────────────────────────────────────────────────

/** The tape-row fields pricing reads (a subset of the note-tape PreparedNote). */
export interface TapePricingRow {
  currentBalanceCents: number;
  interestRateBps: number;
  paymentAmountCents: number;
  remainingTermMonths: number | null;
  maturityDate: string; // YYYY-MM-DD
  balloonAmountCents: number | null;
  balloonDate: string | null; // YYYY-MM-DD
}

export type TapePricingInput = { ok: true; input: NoteCashFlowInput } | { ok: false; reason: string };

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Whole calendar months from `from` to `to` (YYYY-MM-DD), the UTC-month difference computeYields uses. Null if either is not a date. */
export function calendarMonthsBetween(from: string, to: string): number | null {
  const a = ISO_DAY.exec(from);
  const b = ISO_DAY.exec(to);
  if (!a || !b) return null;
  return (Number(b[1]) - Number(a[1])) * 12 + (Number(b[2]) - Number(a[2]));
}

/**
 * Build a pricing input from a validated tape row, using only what the tape
 * states. The remaining term is the row's stated remaining term; if it states
 * none, the months from the tape's as-of date to maturity — and with neither,
 * the row is NOT priced (a term is never assumed). A balloon needs its date:
 * it is placed `remaining − months(balloonDate → maturity)` payments in, so
 * it is anchored to maturity and needs no as-of date when the term is stated.
 */
export function pricingInputFromTapeRow(row: TapePricingRow, asOfDate: string | null): TapePricingInput {
  let remaining = row.remainingTermMonths;
  if (remaining === null || remaining === undefined) {
    if (!asOfDate) return { ok: false, reason: "No remaining term on the tape — enter the tape as-of date to price it from the maturity date." };
    const m = calendarMonthsBetween(asOfDate, row.maturityDate);
    if (m === null) return { ok: false, reason: "The as-of date or maturity date is not a calendar date." };
    remaining = m;
  }
  if (!Number.isInteger(remaining) || remaining < 1) return { ok: false, reason: "No payments remain before maturity." };

  let balloon: NoteBalloon | null = null;
  if (row.balloonAmountCents !== null && row.balloonAmountCents !== undefined && row.balloonAmountCents > 0) {
    if (!row.balloonDate) return { ok: false, reason: "The tape states a balloon amount but no balloon date." };
    const fromBalloonToMaturity = calendarMonthsBetween(row.balloonDate, row.maturityDate);
    if (fromBalloonToMaturity === null) return { ok: false, reason: "The balloon date is not a calendar date." };
    balloon = { amountCents: row.balloonAmountCents, month: remaining - fromBalloonToMaturity };
  }
  return {
    ok: true,
    input: {
      currentBalanceCents: row.currentBalanceCents,
      noteRateBps: row.interestRateBps,
      paymentAmountCents: row.paymentAmountCents,
      remainingTermMonths: remaining,
      balloon,
    },
  };
}
