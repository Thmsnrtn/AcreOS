/**
 * Tax-lien certificate bid — the arithmetic behind "what do I bid on this
 * tax-lien certificate, and what does it return if the owner redeems?".
 *
 * The tax-delinquent surfaces already track certificates after the sale (the
 * redemption clock) and hold an operator-typed max bid per lot (the auction
 * worksheet). Neither answers the bid question: the worksheet's max bid is a
 * number the operator types, with no formula behind it, and the redemption
 * clock (server/services/redemptionClock.ts, computeRedemptionAmount) quotes
 * what a certificate ALREADY BOUGHT is owed on a calendar date, at rates
 * hardcoded per state. This calculator follows that module's `simple_annual`
 * convention (principal × annual rate × years held) but does not wrap it: that
 * function reads its rate from a per-state table, while here every rate is the
 * operator's own input, and shared/ may not import server/ in any case.
 *
 * THE MODEL ("if the owner redeems at month m"):
 *   outlay (month 0)     = face + premium + acquisition costs
 *   interest on face     = face × rate% × m ÷ 12           (SIMPLE interest)
 *   redemption penalty   = face × penalty%                  (once, at redemption)
 *   premium back         = refunded_with_interest: premium + premium × rate% × m ÷ 12
 *                          refunded_no_interest:   premium
 *                          forfeited:              0
 *   received (month m)   = face + interest on face + penalty + premium back
 *   profit               = received − outlay
 *   ROI                  = profit ÷ outlay
 *   annualised (simple)  = ROI × 12 ÷ m                     (as the land engine)
 *   IRR                  = the two-flow timeline [−outlay at 0, +received at m],
 *                          solved by computeIrr (shared/calculators/landDeal.ts)
 *                          and annualised from monthly
 *   hold                 = m
 *
 * `rate` is the rate the certificate actually earns: the statutory rate in a
 * fixed-rate state, or the rate bid at auction in a bid-down state. Interest is
 * modelled SIMPLE because that is the general statutory rule; a state whose
 * rule compounds, steps up, or charges a flat first-period penalty is not
 * modelled exactly here. Acquisition costs (registration and admin fees) are
 * treated as NOT recovered at redemption.
 *
 * NO STATE RATES LIVE HERE. Every rate is an operator input. The per-state
 * reference data (shared/regulatory/taxLienStateRules.ts, the /state-rules
 * page) is for the operator to read, not for this calculator to assume.
 *
 * NOT MODELLED: the deed path. If the owner does not redeem, the investor
 * forecloses and may take the property. That is a different decision with
 * different numbers (legal costs, quiet title, the property's value) and is
 * out of scope here.
 *
 * UNKNOWNS ARE NOT ZEROS. Penalty and acquisition costs are optional. When
 * omitted they are excluded, and the engine adapter DECLARES each exclusion.
 * The premium is REQUIRED: a $0 premium is a real bid, not a default.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { computeIrr } from "./landDeal";

export const TAX_LIEN_BID_ENGINE_ID = "tax_lien_bid" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const TAX_LIEN_BID_ENGINE_VERSION = "tax-lien-bid-1" as const;

/** What happens to the premium bid above face when the owner redeems. States differ. */
export const PREMIUM_TREATMENTS = ["refunded_with_interest", "refunded_no_interest", "forfeited"] as const;
export type PremiumTreatment = (typeof PREMIUM_TREATMENTS)[number];

/** The longest redemption month modelled: 30 years. */
const MAX_REDEMPTION_MONTH = 360;

export interface TaxLienBidInputs {
  /** Taxes, interest and costs owed: what the certificate is written for. */
  faceAmountCents: number;
  /** Amount bid above face. 0 is a real bid. */
  premiumCents: number;
  /** The annual rate the certificate earns, percentage points. */
  interestRatePct: number;
  /** Charged once on redemption, % of face. null = not entered (excluded and declared). */
  penaltyPct: number | null;
  premiumTreatment: PremiumTreatment;
  /** Registration / admin fees paid to buy. null = not entered (excluded and declared). */
  acquisitionCostsCents: number | null;
  /** Whole months from purchase to the owner redeeming. */
  redemptionMonth: number;
}

export interface TaxLienBidOutputs {
  /** Everything paid at month 0. */
  totalCostCents: number;
  interestOnFaceCents: number;
  penaltyCents: number;
  premiumReturnedCents: number;
  /** Everything received at redemption. */
  redemptionReceiptsCents: number;
  profitCents: number;
  roi: number;
  annualizedReturn: number;
  /** Annual IRR, or null when the timeline has no IRR. */
  irr: number | null;
  holdMonths: number;
}

export class TaxLienBidInputError extends Error {}

/** Simple interest on `cents` at `ratePct` a year for `months`, rounded to the cent. */
function simpleInterestCents(cents: number, ratePct: number, months: number): number {
  return Math.round((cents * ratePct * months) / 1200);
}

export function computeTaxLienBid(i: TaxLienBidInputs): TaxLienBidOutputs {
  if (!(i.faceAmountCents > 0)) throw new TaxLienBidInputError("Certificate face amount must be positive");
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["premiumCents", i.premiumCents],
    ["acquisitionCostsCents", i.acquisitionCostsCents],
  ] as const) {
    if (v !== null && v < 0) throw new TaxLienBidInputError(`${k} cannot be negative`);
  }
  if (i.interestRatePct < 0 || i.interestRatePct > 100) {
    throw new TaxLienBidInputError("Interest rate must be between 0% and 100% a year");
  }
  if (i.penaltyPct !== null && (i.penaltyPct < 0 || i.penaltyPct > 100)) {
    throw new TaxLienBidInputError("Redemption penalty must be between 0% and 100% of face");
  }
  if (!(PREMIUM_TREATMENTS as readonly string[]).includes(i.premiumTreatment)) {
    throw new TaxLienBidInputError(`Premium treatment must be one of: ${PREMIUM_TREATMENTS.join(", ")}`);
  }
  if (!Number.isInteger(i.redemptionMonth) || i.redemptionMonth < 1 || i.redemptionMonth > MAX_REDEMPTION_MONTH) {
    throw new TaxLienBidInputError(`Redemption month must be a whole number of months, 1 to ${MAX_REDEMPTION_MONTH}`);
  }

  const m = i.redemptionMonth;
  const costs = i.acquisitionCostsCents ?? 0;
  const totalCostCents = i.faceAmountCents + i.premiumCents + costs;

  const interestOnFaceCents = simpleInterestCents(i.faceAmountCents, i.interestRatePct, m);
  const penaltyCents = Math.round((i.faceAmountCents * (i.penaltyPct ?? 0)) / 100);
  const premiumReturnedCents =
    i.premiumTreatment === "refunded_with_interest"
      ? i.premiumCents + simpleInterestCents(i.premiumCents, i.interestRatePct, m)
      : i.premiumTreatment === "refunded_no_interest"
        ? i.premiumCents
        : 0;

  const redemptionReceiptsCents = i.faceAmountCents + interestOnFaceCents + penaltyCents + premiumReturnedCents;
  const profitCents = redemptionReceiptsCents - totalCostCents;
  const roi = profitCents / totalCostCents;

  // Two flows: everything out at month 0, everything back at month m.
  const flows = new Array<number>(m + 1).fill(0);
  flows[0] = -totalCostCents;
  flows[m] = redemptionReceiptsCents;

  return {
    totalCostCents,
    interestOnFaceCents,
    penaltyCents,
    premiumReturnedCents,
    redemptionReceiptsCents,
    profitCents,
    roi,
    annualizedReturn: (roi * 12) / m,
    irr: computeIrr(flows),
    holdMonths: m,
  };
}
