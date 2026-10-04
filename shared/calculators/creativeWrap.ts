/**
 * Creative-finance wrap — the arithmetic behind "do I take this property
 * subject-to (or on seller-carry) and resell it on a wrap-around note?".
 *
 * The investor takes over an existing loan (the UNDERLYING: a mortgage taken
 * subject-to, or the seller's own carry-back note), pays the seller some cash,
 * and resells to an end buyer who puts money down and pays the rest on a new,
 * larger note (the WRAP). The investor keeps paying the underlying out of the
 * buyer's wrap payment, and earns two spreads: the PAYMENT spread every month
 * (wrap payment − underlying payment) and the BALANCE spread when the buyer
 * refinances or pays off (wrap balance − underlying balance).
 *
 * THE MODEL (monthly, from the day the investor takes the property):
 *   outlay (month 0)  = cash to seller + closing costs + repairs before resale
 *                       — this is total_cost and cash_required: what the
 *                       investor spends to take the deal down. The underlying
 *                       balance is debt taken over, not cash paid, so it is not
 *                       in it; ongoing servicing is a monthly cost, not in it.
 *   month 0 cash flow = −outlay + the end buyer's down payment
 *                       (acquisition and resale in the SAME month: a gap spent
 *                       repairing or marketing — underlying payments with no
 *                       wrap income — is not modelled, and would lower profit
 *                       and IRR; the page and the repairs hint say so)
 *   wrap principal    = sale price − the buyer's down payment
 *   monthly rate      = annual rate ÷ 12, for both notes (the convention
 *                       finance.ts and server/services/notePaymentMath.ts use)
 *   wrap payment      = the level payment that retires the wrap principal at
 *                       the wrap rate over the wrap amortization
 *                       (finance.ts monthlyPaymentCents)
 *   underlying payment= the payment on the underlying loan when entered; when
 *                       it is not, the level payment that retires its balance
 *                       at its rate over its remaining months (finance.ts)
 *   each note walks month by month from its starting balance:
 *                         owed    = balance × (1 + monthly rate)
 *                         paid    = the payment, or everything owed if that is
 *                                   less (the note is paid off), or everything
 *                                   owed in the horizon month H (the end buyer
 *                                   refinances or pays off, and the investor
 *                                   retires the underlying out of it)
 *                         balance = owed − paid
 *   months 1..H       = wrap paid − underlying paid − monthly servicing
 *   so month H holds  = the month's payment spread + the balance spread
 *                       (wrap balance − underlying balance after that
 *                       month's payments)
 *   profit            = the sum of every month's cash flow, month 0 included
 *   monthly cash flow = the month-1 payment spread (wrap payment − underlying
 *                       payment − servicing), without any payoff
 *   IRR               = the monthly rate m at which the cash flows' NPV is
 *                       zero, annualised as (1 + m)^12 − 1 (landDeal.ts
 *                       computeIrr) — ONLY when month 0 is a net outlay. When
 *                       the buyer's down payment covers the outlay, none of
 *                       the investor's money is at work and the yield is not a
 *                       number (it is infinite, or undefined); IRR is null and
 *                       the engine adapter says why.
 *   hold              = H
 *
 * WHY A WALK. The underlying payment an operator enters is often not the level
 * payment for the remaining months (an older schedule, escrow-free P&I rounded
 * up), and applying finance.ts remainingBalanceCents to a different payment
 * would misstate the balance the investor must retire. The walk is the same
 * monthly-rate recurrence finance.ts closes in formula form; when the payment
 * IS the level payment, the walk agrees with remainingBalanceCents to the
 * cent's rounding (pinned in tests/unit/creativeWrapEngine.test.ts).
 *
 * THE HORIZON IS REQUIRED. The whole return turns on when the end buyer
 * refinances or pays off — a wrap held to month 36 and one held to month 300
 * are different deals. There is no honest default, so H is never defaulted.
 *
 * NO SIMPLE ANNUALISED RETURN. A simple "profit ÷ money in ÷ years" divides by
 * an outlay the buyer's down payment largely returns on day one, and treats a
 * stream of monthly spreads as if it arrived at the end. It reads far higher
 * or lower than the deal is. IRR is the time-weighted figure; the simple one
 * is deliberately not produced.
 *
 * WHAT IS NOT MODELLED. The result is the result IF the inputs hold: the end
 * buyer pays every month and refinances or pays off at H, and the underlying
 * lender keeps the loan on its schedule (does not call it due under a
 * due-on-sale clause). No default, late payment, insurance, tax escrow or
 * vacancy is modelled. It is ARITHMETIC ONLY — not a compliance or legal
 * determination of whether the wrap may be originated (Dodd-Frank / Reg Z,
 * state seller-financing rules); those live elsewhere in the product.
 * AcreOS does not collect, hold or disburse any of these payments.
 *
 * UNKNOWNS ARE NOT ZEROS. Closing costs, repairs and servicing are optional;
 * when omitted they are excluded, and the engine adapter DECLARES each
 * exclusion. An omitted underlying payment is derived and declared as derived.
 *
 * PURE: integer cents in and out; rates in percentage points (7.5 = 7.5%).
 */
import { monthlyPaymentCents as levelPaymentCents } from "./finance";
import { computeIrr } from "./landDeal";

export const CREATIVE_WRAP_ENGINE_ID = "creative_wrap" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const CREATIVE_WRAP_ENGINE_VERSION = "creative-wrap-1" as const;

/** 40 years: the longest amortisation any vertical calculator accepts. */
const MAX_TERM_MONTHS = 480;

export interface CreativeWrapInputs {
  // ── Acquisition ──
  /** The balance of the loan taken over (subject-to, or the seller's carry note). */
  underlyingBalanceCents: number;
  underlyingRatePct: number;
  /** Whole months left on the underlying loan's amortization. */
  underlyingRemainingMonths: number;
  /** Principal and interest on the underlying. null = not entered: the level payment is derived. */
  underlyingPaymentCents: number | null;
  /** Cash paid to the seller for their equity. */
  cashToSellerCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  /** Repairs before resale. null = not entered (excluded and declared). */
  repairsCents: number | null;
  // ── Resale on the wrap ──
  salePriceCents: number;
  /** Down payment received from the end buyer. */
  buyerDownPaymentCents: number;
  wrapRatePct: number;
  /** Whole months the wrap amortizes over. */
  wrapAmortizationMonths: number;
  /** Monthly servicing the investor pays. null = not entered (excluded and declared). */
  monthlyServicingCents: number | null;
  /** The month the end buyer is assumed to refinance or pay off. Required. */
  horizonMonths: number;
}

export interface CreativeWrapOutputs {
  /** Cash to seller + closing + repairs: the month-0 outlay before the buyer's down payment. */
  outlayCents: number;
  /** Month 0 = −outlay + down payment; month k = that month's net. */
  cashFlowsCents: number[];
  wrapPrincipalCents: number;
  wrapPaymentCents: number;
  /** The underlying payment the walk used. */
  underlyingPaymentCents: number;
  /** True when no underlying payment was entered and the level payment was derived. */
  underlyingPaymentDerived: boolean;
  /** Month-1 payment spread: wrap payment − underlying payment − servicing. */
  monthlySpreadCents: number;
  /** What the end buyer pays in month H to retire the wrap (that month's payment included). */
  wrapPayoffCents: number;
  /** What the investor pays in month H to retire the underlying (that month's payment included). 0 if already paid off. */
  underlyingPayoffCents: number;
  /** The month an entered underlying payment retired the loan before H, else null. */
  underlyingPaidOffMonth: number | null;
  profitCents: number;
  /** Annual, compounded from monthly. null when month 0 is not a net outlay, or the flows have no IRR. */
  irr: number | null;
  /** True when the buyer's down payment covers the whole outlay (month 0 ≥ 0). */
  outlayCoveredByDown: boolean;
  horizonMonths: number;
}

export class CreativeWrapInputError extends Error {}

function isWholeMonthInRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= max;
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export function computeCreativeWrap(i: CreativeWrapInputs): CreativeWrapOutputs {
  if (i.underlyingBalanceCents <= 0) {
    throw new CreativeWrapInputError("Underlying loan balance must be positive");
  }
  if (i.salePriceCents <= 0) throw new CreativeWrapInputError("Sale price must be positive");
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["cashToSellerCents", i.cashToSellerCents],
    ["closingCostsCents", i.closingCostsCents],
    ["repairsCents", i.repairsCents],
    ["monthlyServicingCents", i.monthlyServicingCents],
  ] as const) {
    if (v !== null && v < 0) throw new CreativeWrapInputError(`${k} cannot be negative`);
  }
  if (i.buyerDownPaymentCents < 0) throw new CreativeWrapInputError("Buyer's down payment cannot be negative");
  if (i.buyerDownPaymentCents > i.salePriceCents) {
    throw new CreativeWrapInputError("Buyer's down payment cannot be more than the sale price");
  }
  if (i.underlyingRatePct < 0 || i.underlyingRatePct > 30) {
    throw new CreativeWrapInputError("Underlying loan rate must be between 0% and 30%");
  }
  if (i.wrapRatePct < 0 || i.wrapRatePct > 30) {
    throw new CreativeWrapInputError("Wrap rate must be between 0% and 30%");
  }
  if (!isWholeMonthInRange(i.underlyingRemainingMonths, MAX_TERM_MONTHS)) {
    throw new CreativeWrapInputError(
      `Underlying remaining term must be a whole number of months, 1 to ${MAX_TERM_MONTHS}`,
    );
  }
  if (!isWholeMonthInRange(i.wrapAmortizationMonths, MAX_TERM_MONTHS)) {
    throw new CreativeWrapInputError(`Wrap amortization must be a whole number of months, 1 to ${MAX_TERM_MONTHS}`);
  }
  const maxHorizon = Math.min(i.underlyingRemainingMonths, i.wrapAmortizationMonths);
  if (!isWholeMonthInRange(i.horizonMonths, maxHorizon)) {
    throw new CreativeWrapInputError(
      `Payoff month must be a whole number of months, 1 to ${maxHorizon} (the shorter of the two loans' terms)`,
    );
  }
  if (i.underlyingPaymentCents !== null && i.underlyingPaymentCents <= 0) {
    throw new CreativeWrapInputError(
      "Underlying monthly payment must be positive — leave it empty to derive the level payment",
    );
  }

  const ru = i.underlyingRatePct / 100 / 12;
  const rw = i.wrapRatePct / 100 / 12;

  const underlyingPaymentDerived = i.underlyingPaymentCents === null;
  const underlyingPaymentCents = underlyingPaymentDerived
    ? levelPaymentCents(i.underlyingBalanceCents, i.underlyingRatePct, i.underlyingRemainingMonths / 12)
    : (i.underlyingPaymentCents as number);
  // An entered payment below the interest grows the balance the investor must
  // retire (negative amortisation) — almost always a typo. Interest-only
  // (payment = interest, rounded down) is a real loan shape and is accepted.
  // (rate ÷ 1200 rather than × the monthly rate: 30 ÷ 100 ÷ 12 is not exact in
  // binary floating point, and this comparison is to the cent.)
  const underlyingFirstInterest = Math.floor((i.underlyingBalanceCents * i.underlyingRatePct) / 1200);
  if (underlyingPaymentCents < underlyingFirstInterest) {
    throw new CreativeWrapInputError(
      `Underlying monthly payment is less than the first month's interest (${dollars(underlyingFirstInterest)}), so its balance would grow`,
    );
  }

  const wrapPrincipalCents = i.salePriceCents - i.buyerDownPaymentCents;
  const wrapPaymentCents = levelPaymentCents(wrapPrincipalCents, i.wrapRatePct, i.wrapAmortizationMonths / 12);
  // The level payment always exceeds the interest in exact arithmetic, but at a
  // high rate over a long amortization the excess can be under half a cent, and
  // the payment rounds to the interest itself: the buyer would pay interest
  // only and the wrap balance would never come down. Refuse rather than model
  // a wrap that does not amortize.
  const wrapFirstInterest = (wrapPrincipalCents * i.wrapRatePct) / 1200;
  if (wrapPrincipalCents > 0 && i.wrapRatePct > 0 && wrapPaymentCents <= wrapFirstInterest) {
    throw new CreativeWrapInputError(
      `At this wrap rate and amortization the buyer's payment (${dollars(wrapPaymentCents)}) does not exceed the first month's interest (${dollars(wrapFirstInterest)}), so the wrap balance would never come down. Lower the rate or shorten the amortization`,
    );
  }

  const servicing = i.monthlyServicingCents ?? 0;
  const outlayCents = i.cashToSellerCents + (i.closingCostsCents ?? 0) + (i.repairsCents ?? 0);
  const month0 = i.buyerDownPaymentCents - outlayCents;
  const H = i.horizonMonths;

  const cashFlowsCents: number[] = [month0];
  let wBal = wrapPrincipalCents;
  let uBal = i.underlyingBalanceCents;
  let wrapPayoffCents = 0;
  let underlyingPayoffCents = 0;
  let underlyingPaidOffMonth: number | null = null;
  let monthlySpreadCents = 0;

  for (let m = 1; m <= H; m++) {
    const wOwed = wBal * (1 + rw);
    const uOwed = uBal * (1 + ru);
    let wPaid: number;
    let uPaid: number;
    if (m === H) {
      // The end buyer refinances or pays off; the investor retires the underlying.
      wPaid = Math.round(wOwed);
      uPaid = Math.round(uOwed);
      wrapPayoffCents = wPaid;
      underlyingPayoffCents = uPaid;
      wBal = 0;
      uBal = 0;
    } else {
      if (wrapPaymentCents >= wOwed) {
        wPaid = Math.round(wOwed);
        wBal = 0;
      } else {
        wPaid = wrapPaymentCents;
        wBal = wOwed - wrapPaymentCents;
      }
      if (uBal > 0 && underlyingPaymentCents >= uOwed) {
        uPaid = Math.round(uOwed);
        uBal = 0;
        underlyingPaidOffMonth = m;
      } else {
        uPaid = uBal > 0 ? underlyingPaymentCents : 0;
        uBal = uBal > 0 ? uOwed - underlyingPaymentCents : 0;
      }
    }
    if (m === 1) {
      // The regular month-1 spread, without any payoff — what lands each month.
      const wReg = Math.min(wrapPaymentCents, Math.round(wrapPrincipalCents * (1 + rw)));
      const uReg = Math.min(underlyingPaymentCents, Math.round(i.underlyingBalanceCents * (1 + ru)));
      monthlySpreadCents = wReg - uReg - servicing;
    }
    cashFlowsCents.push(wPaid - uPaid - servicing);
  }

  const profitCents = cashFlowsCents.reduce((s, c) => s + c, 0);
  const outlayCoveredByDown = month0 >= 0;

  return {
    outlayCents,
    cashFlowsCents,
    wrapPrincipalCents,
    wrapPaymentCents,
    underlyingPaymentCents,
    underlyingPaymentDerived,
    monthlySpreadCents,
    wrapPayoffCents,
    underlyingPayoffCents,
    underlyingPaidOffMonth,
    profitCents,
    irr: outlayCoveredByDown ? null : computeIrr(cashFlowsCents),
    outlayCoveredByDown,
    horizonMonths: H,
  };
}
