/**
 * Note acquisition — the arithmetic behind "do I buy this note at price X, and
 * what does it yield if it pays as agreed?".
 *
 * The note investor's core call. The servicing side already has yields for a
 * note it OWNS (server/routes-notes.ts computeYields: yield to maturity at
 * acquisition, IRR to date off the payment ledger). This engine answers the
 * question BEFORE the purchase, from the note's terms and the asking price.
 *
 * THE MODEL (monthly, from the day of purchase):
 *   total cost       = purchase price + closing / due-diligence costs
 *   discount to face = 1 − purchase price ÷ unpaid principal balance (UPB)
 *                      (negative when the note is bought at a premium)
 *   monthly rate     = note rate ÷ 12   (the convention finance.ts and
 *                      server/services/notePaymentMath.ts both use)
 *   payment          = the payment on the note when entered; when it is not,
 *                      the level payment that retires the UPB at the note rate
 *                      over the remaining term (finance.ts monthlyPaymentCents)
 *   the schedule     = month by month from the UPB:
 *                        owed    = balance × (1 + monthly rate)
 *                        collect = the payment, or everything owed if that is
 *                                  less (the note pays off early), or everything
 *                                  owed at the last month (the balloon month
 *                                  when one is given, else the end of the term:
 *                                  the regular payment plus whatever balance is
 *                                  left — a balloon, or the last payment's
 *                                  rounding residue)
 *                        balance = owed − collect
 *   cash flows       = −total cost at month 0, then each month's collection
 *   total collected  = the sum of the collections
 *   profit           = total collected − total cost
 *   IRR              = the monthly rate m at which the cash flows' NPV is zero,
 *                      annualised as (1 + m)^12 − 1 (landDeal.ts computeIrr,
 *                      which does exactly that). Bought at par with no costs,
 *                      it is the note rate compounded monthly.
 *   hold             = the month of the last collection
 *   balloon payoff   = what retires the note at the balloon month (that
 *                      month's regular payment included); none without a
 *                      balloon month, or when the note is paid off before it
 *
 * WHY A WALK AND NOT remainingBalanceCents. finance.ts gives the level payment
 * and the balance under that level payment. A note bought on the secondary
 * market often carries a payment that is NOT the level payment for its
 * remaining term — rounded up, set on an older schedule, interest-only with a
 * balloon. Applying the level-payment balance to a different payment would
 * misstate the balloon, and multiplying a payment by the term would collect
 * more than a note that pays off early can ever pay. The walk is the same
 * monthly-rate recurrence finance.ts closes in formula form; when the payment
 * IS the derived level payment, the walk's balance at any month agrees with
 * remainingBalanceCents to the cent's rounding (pinned in
 * tests/unit/noteAcquisitionEngine.test.ts).
 *
 * "PAYS AS SCHEDULED". No default, late payment, prepayment or servicing cost is
 * modelled beyond the schedule the inputs describe. That is the question being
 * asked, and the yield is the yield IF it pays exactly so — not a ceiling and
 * not a forecast. A default or late payment lowers it. An early payoff RAISES
 * it on a note bought at a discount (the discount comes back sooner) and
 * lowers it on one bought at a premium.
 *
 * UNKNOWNS ARE NOT ZEROS. Closing costs are optional; when omitted they are
 * excluded, and the engine adapter DECLARES the exclusion. An omitted payment
 * is derived and declared as derived. An omitted balloon month means the note
 * runs to the end of its term, and that is declared too.
 *
 * PURE: integer cents in and out; rates in percentage points (9 = 9%).
 */
import { monthlyPaymentCents as levelPaymentCents } from "./finance";
import { computeIrr } from "./landDeal";

export const NOTE_ACQUISITION_ENGINE_ID = "note_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const NOTE_ACQUISITION_ENGINE_VERSION = "note-acquisition-1" as const;

/** 40 years: the longest amortisation any vertical calculator accepts. */
const MAX_NOTE_TERM_MONTHS = 480;

export interface NoteAcquisitionInputs {
  /** Unpaid principal balance today — the note's face. */
  unpaidPrincipalCents: number;
  /** The note rate, percentage points. */
  noteRatePct: number;
  /** Whole months of payments left on the note. */
  remainingTermMonths: number;
  /** The payment on the note. null = not entered: the level payment is derived. */
  monthlyPaymentCents: number | null;
  purchasePriceCents: number;
  /** Title, BPO, collateral file review, legal, servicing set-up. null = not entered (excluded). */
  closingCostsCents: number | null;
  /** The month (counted from purchase) the remaining balance falls due. null = none. */
  balloonMonth: number | null;
}

export interface NoteAcquisitionOutputs {
  totalCostCents: number;
  /** The payment the schedule used. */
  paymentCents: number;
  /** True when no payment was entered and the level payment was derived. */
  paymentDerived: boolean;
  /** Month 0 is −total cost; month k is the k-th collection. */
  cashFlowsCents: number[];
  totalCollectedCents: number;
  profitCents: number;
  /** 1 − price ÷ UPB, as a ratio. Negative when bought at a premium. */
  discountToFace: number;
  /** Annual, compounded from monthly. null when the cash flows have no IRR. */
  irr: number | null;
  /** The month of the last collection. */
  lastMonth: number;
  /** True when the payment retired the balance before the scheduled last month. */
  paidOffEarly: boolean;
  /** The last month's collection. */
  finalCollectionCents: number;
  /**
   * The amount that retires the note at the balloon month, that month's regular
   * payment included. null without a balloon month, or when the note is paid
   * off before it.
   */
  balloonPayoffCents: number | null;
}

export class NoteAcquisitionInputError extends Error {}

function isWholeMonthInRange(n: number, max: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= max;
}

export function computeNoteAcquisition(i: NoteAcquisitionInputs): NoteAcquisitionOutputs {
  if (i.unpaidPrincipalCents <= 0) throw new NoteAcquisitionInputError("Unpaid principal balance must be positive");
  if (i.purchasePriceCents <= 0) throw new NoteAcquisitionInputError("Purchase price must be positive");
  // A negative cost is a typo that flatters every return; refuse it.
  if (i.closingCostsCents !== null && i.closingCostsCents < 0) {
    throw new NoteAcquisitionInputError("closingCostsCents cannot be negative");
  }
  if (i.noteRatePct < 0 || i.noteRatePct > 30) {
    throw new NoteAcquisitionInputError("Note rate must be between 0% and 30%");
  }
  if (!isWholeMonthInRange(i.remainingTermMonths, MAX_NOTE_TERM_MONTHS)) {
    throw new NoteAcquisitionInputError(`Remaining term must be a whole number of months, 1 to ${MAX_NOTE_TERM_MONTHS}`);
  }
  if (i.balloonMonth !== null && !isWholeMonthInRange(i.balloonMonth, i.remainingTermMonths)) {
    throw new NoteAcquisitionInputError("Balloon month must be a whole month within the remaining term");
  }
  if (i.monthlyPaymentCents !== null && i.monthlyPaymentCents <= 0) {
    throw new NoteAcquisitionInputError("Monthly payment must be positive — leave it empty to derive the level payment");
  }

  const r = i.noteRatePct / 100 / 12;
  const paymentDerived = i.monthlyPaymentCents === null;
  const paymentCents = paymentDerived
    ? levelPaymentCents(i.unpaidPrincipalCents, i.noteRatePct, i.remainingTermMonths / 12)
    : (i.monthlyPaymentCents as number);

  // A payment below the interest grows the balance every month (negative
  // amortisation). Interest-only (payment = interest) is a real note shape and
  // is accepted; less than that is almost always a typo, and it would produce
  // a yield on a balloon that dwarfs everything paid along the way.
  const firstInterest = Math.floor(i.unpaidPrincipalCents * r);
  if (paymentCents < firstInterest) {
    throw new NoteAcquisitionInputError(
      `Monthly payment is less than the first month's interest ($${(firstInterest / 100).toFixed(2)}), so the balance would never come down`,
    );
  }

  const totalCostCents = i.purchasePriceCents + (i.closingCostsCents ?? 0);
  const horizon = i.balloonMonth ?? i.remainingTermMonths;

  const cashFlowsCents: number[] = [-totalCostCents];
  let balance = i.unpaidPrincipalCents;
  let lastMonth = 0;
  let paidOffEarly = false;
  let finalCollectionCents = 0;
  for (let m = 1; m <= horizon; m++) {
    const owed = balance * (1 + r);
    if (m === horizon || paymentCents >= owed) {
      finalCollectionCents = Math.round(owed);
      cashFlowsCents.push(finalCollectionCents);
      lastMonth = m;
      paidOffEarly = m < horizon;
      balance = 0;
      break;
    }
    cashFlowsCents.push(paymentCents);
    balance = owed - paymentCents;
  }

  const totalCollectedCents = cashFlowsCents.slice(1).reduce((s, c) => s + c, 0);

  return {
    totalCostCents,
    paymentCents,
    paymentDerived,
    cashFlowsCents,
    totalCollectedCents,
    profitCents: totalCollectedCents - totalCostCents,
    discountToFace: 1 - i.purchasePriceCents / i.unpaidPrincipalCents,
    irr: computeIrr(cashFlowsCents),
    lastMonth,
    paidOffEarly,
    finalCollectionCents,
    balloonPayoffCents: i.balloonMonth !== null && !paidOffEarly ? finalCollectionCents : null,
  };
}
