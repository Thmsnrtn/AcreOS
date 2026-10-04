/**
 * Short-term rental acquisition — the arithmetic behind "do I buy this
 * property to run as a short-term rental at this price?".
 *
 * A short-term rental does not earn monthly rent. It earns a NIGHTLY rate on
 * the nights it is booked, and every booking ends in a turnover the owner pays
 * to clean. So income and the biggest variable cost are both built up from
 * nights and stays, not from a rent roll. Occupancy IS the vacancy line here:
 * the nights that are not booked earn nothing, so no separate vacancy % is
 * applied on top.
 *
 * THE MODEL (annual, year one, stabilised):
 *   booked nights          = nights available per year × occupancy%
 *   turnovers              = booked nights ÷ average stay length (nights)
 *                            (both are EXPECTED counts and are not rounded to
 *                            whole nights or stays; rounding 237.25 nights down
 *                            or up would move income by a fraction of a night)
 *   nightly revenue        = average daily rate (ADR) × booked nights
 *   cleaning-fee income    = cleaning fee charged per stay × turnovers
 *                            (guest-paid; only when the operator enters one)
 *   booking revenue        = nightly revenue + cleaning-fee income
 *                          = effective gross income (EGI)
 *   platform fees          = booking revenue × platform/channel fee%
 *   management             = booking revenue × management%
 *   reserves               = booking revenue × reserves%
 *   cleaning cost          = cleaning cost per turnover (what the OWNER pays
 *                            the cleaner) × turnovers
 *   fixed costs            = fixed monthly costs × 12 (utilities, internet,
 *                            insurance, property taxes, HOA, software)
 *   operating expense      = platform fees + management + reserves
 *                            + cleaning cost + fixed costs
 *   NOI                    = EGI − operating expense
 *   all-in cost            = price + closing + furnishing / setup
 *   cap rate               = NOI ÷ price (the market convention)
 *   loan                   = price × (1 − down payment%)
 *   debt service           = level monthly payment × 12 (finance.ts)
 *   cash flow              = NOI − debt service
 *   cash required          = down payment + closing + furnishing / setup
 *   cash-on-cash           = annual cash flow ÷ cash required
 *   DSCR                   = NOI ÷ debt service (none when bought for cash)
 *   expense ratio          = operating expense ÷ EGI
 *
 * LODGING / OCCUPANCY TAX IS NOT MODELLED. It is charged to the guest and
 * remitted to the taxing authority (often by the booking platform itself), so
 * it passes through the owner and is neither income nor expense here. Enter the
 * ADR and cleaning fee EXCLUDING it.
 *
 * NO MARKET RATE. The ADR and occupancy are the operator's own figures. This
 * engine never looks up a market or "suggested" nightly rate.
 *
 * UNKNOWNS ARE NOT ZEROS. Closing costs, furnishing / setup, the guest-paid
 * cleaning fee and financing are optional. When omitted they are excluded (no
 * cleaning-fee income is counted; an absent down payment is all cash), and the
 * engine adapter DECLARES each omission as an assumption. ADR, occupancy,
 * nights available, average stay, the owner's cleaning cost, platform fees,
 * management, fixed costs and reserves are REQUIRED: there is no honest default
 * for them, and a silent one is how a short-term rental looks profitable on
 * paper.
 *
 * The result is what the property earns IF these inputs hold — not a forecast.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const STR_ACQUISITION_ENGINE_ID = "str_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const STR_ACQUISITION_ENGINE_VERSION = "str-acquisition-1" as const;

export interface StrAcquisitionInputs {
  purchasePriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  /** Furniture, linens, smart locks, photos — getting it ready to book. null = not entered. */
  furnishingCents: number | null;
  /** Average nightly rate the guest pays, excluding lodging tax and cleaning fee. */
  averageDailyRateCents: number;
  /** Share of available nights that are booked. */
  occupancyPct: number;
  /** Nights the property is offered for booking in a year. A whole number, 1–366. */
  nightsAvailablePerYear: number;
  /** Average nights per booking. At least 1. */
  avgStayNights: number;
  /** What the OWNER pays to clean after each stay. */
  cleaningCostPerTurnoverCents: number;
  /** Cleaning fee the GUEST pays per stay (income). null = not entered: none counted. */
  cleaningFeePerStayCents: number | null;
  /** Booking platform / channel fee, % of booking revenue. */
  platformFeePct: number;
  /** Management / co-host fee, % of booking revenue. */
  managementPct: number;
  /** Utilities, internet, insurance, property taxes, HOA, software — per month. */
  monthlyFixedCostsCents: number;
  /** Repairs, replacements and wear reserve, % of booking revenue. */
  reservesPct: number;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
}

export interface StrAcquisitionOutputs {
  /** Expected booked nights per year (not rounded). */
  bookedNights: number;
  /** Expected stays (and so turnovers) per year (not rounded). */
  turnovers: number;
  nightlyRevenueCents: number;
  cleaningFeeIncomeCents: number;
  /** Booking revenue: nightly revenue + guest cleaning fees. */
  effectiveGrossIncomeCents: number;
  platformFeesCents: number;
  managementCents: number;
  reservesCents: number;
  cleaningCostCents: number;
  fixedCostsCents: number;
  annualOperatingExpenseCents: number;
  annualNoiCents: number;
  totalCostCents: number;
  cashRequiredCents: number;
  annualDebtServiceCents: number;
  monthlyCashFlowCents: number;
  /** NOI ÷ price, as a ratio. */
  capRate: number;
  /** Annual cash flow ÷ cash required. null when no cash is required. */
  cashOnCash: number | null;
  /** NOI ÷ debt service. null when bought for cash. */
  dscr: number | null;
  /** Operating expense ÷ EGI. null when EGI is 0. */
  operatingExpenseRatio: number | null;
  financed: boolean;
}

export class StrAcquisitionInputError extends Error {}

export function computeStrAcquisition(i: StrAcquisitionInputs): StrAcquisitionOutputs {
  if (i.purchasePriceCents <= 0) throw new StrAcquisitionInputError("Purchase price must be positive");
  if (!Number.isInteger(i.nightsAvailablePerYear) || i.nightsAvailablePerYear < 1 || i.nightsAvailablePerYear > 366) {
    throw new StrAcquisitionInputError("Nights available must be a whole number of nights, 1 to 366");
  }
  // Every stay is at least one night, so an average below one is a typo — and
  // a tiny average stay would multiply the turnover count without limit.
  if (!Number.isFinite(i.avgStayNights) || i.avgStayNights < 1) {
    throw new StrAcquisitionInputError("Average stay must be at least 1 night");
  }
  // A negative income or cost is a typo that moves every return; refuse it.
  for (const [k, v] of [
    ["averageDailyRateCents", i.averageDailyRateCents],
    ["cleaningCostPerTurnoverCents", i.cleaningCostPerTurnoverCents],
    ["cleaningFeePerStayCents", i.cleaningFeePerStayCents],
    ["monthlyFixedCostsCents", i.monthlyFixedCostsCents],
    ["closingCostsCents", i.closingCostsCents],
    ["furnishingCents", i.furnishingCents],
  ] as const) {
    if (v !== null && v < 0) throw new StrAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["occupancyPct", i.occupancyPct],
    ["platformFeePct", i.platformFeePct],
    ["managementPct", i.managementPct],
    ["reservesPct", i.reservesPct],
  ] as const) {
    if (!(v >= 0 && v <= 100)) throw new StrAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new StrAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  // Loan terms with no down payment are ambiguous: dropping them would model
  // all cash while the operator typed a loan (V1 audit). Ask instead.
  if (i.downPaymentPct === null && (i.interestRatePct !== null || i.amortizationYears !== null)) {
    throw new StrAcquisitionInputError(
      "Loan terms were entered without a down payment. Enter the down payment, or clear the loan terms for an all-cash purchase",
    );
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new StrAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new StrAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new StrAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const closing = i.closingCostsCents ?? 0;
  const furnishing = i.furnishingCents ?? 0;
  const totalCostCents = i.purchasePriceCents + closing + furnishing;

  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const loanCents = i.purchasePriceCents - downPaymentCents;
  const cashRequiredCents = downPaymentCents + closing + furnishing;

  // Multiply before dividing so 360 × 70% is exactly 252, not 251.99999.
  const bookedNights = (i.nightsAvailablePerYear * i.occupancyPct) / 100;
  const turnovers = bookedNights / i.avgStayNights;

  const nightlyRevenueCents = Math.round(i.averageDailyRateCents * bookedNights);
  const cleaningFeeIncomeCents = Math.round((i.cleaningFeePerStayCents ?? 0) * turnovers);
  const effectiveGrossIncomeCents = nightlyRevenueCents + cleaningFeeIncomeCents;

  const platformFeesCents = Math.round((effectiveGrossIncomeCents * i.platformFeePct) / 100);
  const managementCents = Math.round((effectiveGrossIncomeCents * i.managementPct) / 100);
  const reservesCents = Math.round((effectiveGrossIncomeCents * i.reservesPct) / 100);
  const cleaningCostCents = Math.round(i.cleaningCostPerTurnoverCents * turnovers);
  const fixedCostsCents = i.monthlyFixedCostsCents * 12;
  const annualOperatingExpenseCents =
    platformFeesCents + managementCents + reservesCents + cleaningCostCents + fixedCostsCents;
  const annualNoiCents = effectiveGrossIncomeCents - annualOperatingExpenseCents;

  const annualDebtServiceCents = financed
    ? monthlyPaymentCents(loanCents, i.interestRatePct ?? 0, i.amortizationYears ?? 0) * 12
    : 0;
  const annualCashFlow = annualNoiCents - annualDebtServiceCents;

  return {
    bookedNights,
    turnovers,
    nightlyRevenueCents,
    cleaningFeeIncomeCents,
    effectiveGrossIncomeCents,
    platformFeesCents,
    managementCents,
    reservesCents,
    cleaningCostCents,
    fixedCostsCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    totalCostCents,
    cashRequiredCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlow / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlow / cashRequiredCents : null,
    dscr: financed && annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio: effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    financed,
  };
}
