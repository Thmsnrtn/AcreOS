/**
 * Short-term-rental acquisition / hold — the arithmetic behind "do I buy
 * this nightly-rent property at this price, on MY OWN assumptions?".
 *
 * THE MODEL (annual, year one, stabilised):
 *   booked nights        = 365 × occupancy%
 *   stays per year       = booked nights ÷ average stay (nights)
 *   gross room revenue   = ADR × booked nights
 *   guest fee income     = guest fees per stay × stays per year
 *   effective gross inc. = gross room revenue + guest fee income
 *   operating expense    = platform fee (platformFee% × gross room revenue)
 *                          + cleaning cost per stay × stays per year
 *                          + annual fixed expenses (taxes, insurance,
 *                            utilities, supplies, licences — entered as one
 *                            annual figure by the operator)
 *   NOI                  = effective gross income − operating expense
 *   all-in cost          = price + closing costs
 *   cap rate             = NOI ÷ price
 *   loan                 = price × (1 − down payment%)
 *   debt service         = level monthly payment × 12 (shared finance formula)
 *   cash flow            = NOI − debt service
 *   cash required        = down payment + closing costs
 *   cash-on-cash         = cash flow ÷ cash required
 *   DSCR                 = NOI ÷ debt service (none when bought for cash)
 *
 * OPERATOR-ENTERED ASSUMPTIONS ONLY — NO MARKET DATA, EVER.
 * ---------------------------------------------------------
 * There is no market-ADR or comps source for this engine, and there must
 * never be one silently: the residential-comps data plane is a standing
 * hard-stop (shared/governance/constitution.ts,
 * data.no-residential-comps-pre-trigger), and a "typical ADR for the area"
 * would be fabrication presented as measurement. Every revenue and cost
 * figure below is a number the OPERATOR typed. That is why ADR, occupancy,
 * guest fees, cleaning cost, platform fee, average stay and fixed expenses
 * are all REQUIRED: an absent one is refused, never defaulted. A silent
 * default occupancy is exactly how a short-term rental looks profitable on
 * paper while the operator never believed the number.
 *
 * The one optional block is financing, following the buy-and-hold engine's
 * convention: omit the down payment and the purchase is modelled all cash,
 * and the adapter DECLARES that substitution as an assumption.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const STR_ACQUISITION_ENGINE_ID = "str_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const STR_ACQUISITION_ENGINE_VERSION = "str-acquisition-1" as const;

/** Nights in the underwriting year. A leap year is not modelled. */
const STR_YEAR_NIGHTS = 365 as const;

export interface StrAcquisitionInputs {
  purchasePriceCents: number;
  /** Required — entered explicitly (0 is an operator's answer, absence is not). */
  closingCostsCents: number;
  /** Operator-entered average daily rate, cents per booked night. */
  adrCents: number;
  /** Operator-entered occupancy, percentage points (0–100). */
  occupancyPct: number;
  /** Fees charged to the guest per stay (cleaning fee charged, pet, etc.), cents. */
  guestFeesPerStayCents: number;
  /** What the operator PAYS to clean per turnover, cents per stay. */
  cleaningCostPerStayCents: number;
  /** Platform / channel fee, % of gross room revenue. */
  platformFeePct: number;
  /** Average stay length in nights — derives stays (turnovers) per year. */
  averageStayNights: number;
  /** Taxes, insurance, utilities, supplies, licences — one annual figure, cents. */
  annualFixedExpensesCents: number;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
}

export interface StrAcquisitionOutputs {
  bookedNights: number;
  staysPerYear: number;
  grossRoomRevenueCents: number;
  totalCostCents: number;
  cashRequiredCents: number;
  effectiveGrossIncomeCents: number;
  annualOperatingExpenseCents: number;
  annualNoiCents: number;
  annualDebtServiceCents: number;
  monthlyCashFlowCents: number;
  /** NOI ÷ price, as a ratio. null when the price is 0 (refused earlier). */
  capRate: number | null;
  /** Annual cash flow ÷ cash required. null when no cash is required. */
  cashOnCash: number | null;
  /** NOI ÷ debt service. null when bought for cash. */
  dscr: number | null;
  /** Operating expense ÷ EGI. null when EGI is 0. */
  operatingExpenseRatio: number | null;
  /** Price ÷ gross room revenue. null when there is no room revenue. */
  grossRentMultiplier: number | null;
  financed: boolean;
}

export class StrAcquisitionInputError extends Error {}

export function computeStrAcquisition(i: StrAcquisitionInputs): StrAcquisitionOutputs {
  if (i.purchasePriceCents <= 0) throw new StrAcquisitionInputError("Purchase price must be positive");
  if (i.adrCents <= 0) throw new StrAcquisitionInputError("ADR must be positive — an entered nightly rate is required");
  // A negative cost or fee is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["closingCostsCents", i.closingCostsCents],
    ["guestFeesPerStayCents", i.guestFeesPerStayCents],
    ["cleaningCostPerStayCents", i.cleaningCostPerStayCents],
    ["annualFixedExpensesCents", i.annualFixedExpensesCents],
  ] as const) {
    if (v < 0) throw new StrAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["occupancyPct", i.occupancyPct],
    ["platformFeePct", i.platformFeePct],
  ] as const) {
    if (v < 0 || v > 100) throw new StrAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  if (!(i.averageStayNights > 0)) {
    throw new StrAcquisitionInputError("averageStayNights must be positive — it derives the year's stays and turnovers");
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new StrAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new StrAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new StrAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new StrAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const bookedNights = (STR_YEAR_NIGHTS * i.occupancyPct) / 100;
  const staysPerYear = bookedNights / i.averageStayNights;
  const grossRoomRevenueCents = Math.round(i.adrCents * bookedNights);
  const guestFeeIncomeCents = Math.round(i.guestFeesPerStayCents * staysPerYear);
  const effectiveGrossIncomeCents = grossRoomRevenueCents + guestFeeIncomeCents;

  const platformFeesCents = Math.round((grossRoomRevenueCents * i.platformFeePct) / 100);
  const cleaningCostsCents = Math.round(i.cleaningCostPerStayCents * staysPerYear);
  const annualOperatingExpenseCents =
    platformFeesCents + cleaningCostsCents + i.annualFixedExpensesCents;
  const annualNoiCents = effectiveGrossIncomeCents - annualOperatingExpenseCents;

  const totalCostCents = i.purchasePriceCents + i.closingCostsCents;
  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const cashRequiredCents = downPaymentCents + i.closingCostsCents;

  const loanCents = i.purchasePriceCents - downPaymentCents;
  const annualDebtServiceCents = financed
    ? monthlyPaymentCents(loanCents, i.interestRatePct!, i.amortizationYears!) * 12
    : 0;
  const annualCashFlowCents = annualNoiCents - annualDebtServiceCents;

  return {
    bookedNights,
    staysPerYear,
    grossRoomRevenueCents,
    totalCostCents,
    cashRequiredCents,
    effectiveGrossIncomeCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlowCents / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlowCents / cashRequiredCents : null,
    dscr: annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio:
      effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    grossRentMultiplier: grossRoomRevenueCents > 0 ? i.purchasePriceCents / grossRoomRevenueCents : null,
    financed,
  };
}
