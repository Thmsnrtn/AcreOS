/**
 * Multifamily acquisition — the arithmetic behind "do I buy this apartment
 * building at this price?".
 *
 * A building is underwritten PER UNIT, not as one rent. The operator enters the
 * unit count and the average rent a unit achieves; reserves are budgeted per
 * unit per year, the way a lender sizes them. The older `multifamily_noi`
 * engine answers a different question (what an operated building is earning,
 * from its own ledger, against a valuation). It has no purchase price, no
 * closing or capex, no financing terms and no cash required, so it cannot
 * carry a buy decision. This engine can.
 *
 * THE MODEL (annual, year one, stabilised):
 *   gross scheduled rent    = units × average rent per unit × 12
 *   other income            = other monthly income × 12 (laundry, parking, fees)
 *   gross potential income  = gross scheduled rent + other income
 *   effective gross income  = gross potential income × (1 − vacancy%)
 *                             (vacancy and credit loss apply to the whole line:
 *                             an empty unit pays no parking or laundry either)
 *   management              = EGI × management%
 *   reserves                = reserves per unit per year × units
 *   operating expense       = annual operating expenses (taxes, insurance,
 *                             utilities, payroll, repairs) + management + reserves
 *   NOI                     = EGI − operating expense
 *   all-in cost             = price + closing + immediate capex
 *   cap rate                = NOI ÷ price (the market convention)
 *   loan                    = price × (1 − down payment%)
 *   debt service            = level monthly payment × 12 (finance.ts)
 *   cash flow               = NOI − debt service
 *   cash required           = down payment + closing + immediate capex
 *   cash-on-cash            = annual cash flow ÷ cash required
 *   DSCR                    = NOI ÷ debt service (none when bought for cash)
 *   expense ratio           = operating expense ÷ EGI
 *   gross rent multiplier   = price ÷ gross scheduled rent (unit rents only)
 *   value at market cap     = NOI ÷ market cap rate (only when a market cap rate
 *                             is entered, and only for a positive NOI)
 *
 * UNKNOWNS ARE NOT ZEROS. Other income, closing costs, immediate capex,
 * financing and the market cap rate are optional. When omitted they are
 * excluded (or, for the market cap rate, the value is not computed), and the
 * engine adapter DECLARES each omission as an assumption. Vacancy, operating
 * expenses, management and reserves are REQUIRED: there is no honest default
 * for them, and a silent one is how a building looks profitable on paper.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const MULTIFAMILY_ACQUISITION_ENGINE_ID = "multifamily_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const MULTIFAMILY_ACQUISITION_ENGINE_VERSION = "multifamily-acquisition-1" as const;

export interface MultifamilyAcquisitionInputs {
  /** Rentable units in the building. A whole number, at least 1. */
  unitCount: number;
  /** Average achievable monthly rent per unit. */
  avgMonthlyRentPerUnitCents: number;
  /** Laundry, parking, fees — per month for the whole building. null = not entered. */
  otherMonthlyIncomeCents: number | null;
  vacancyPct: number;
  /** Taxes, insurance, utilities, payroll, repairs — per year, EXCLUDING management and reserves. */
  annualOperatingExpensesCents: number;
  /** Property management, % of effective gross income. */
  managementPct: number;
  /** Replacement reserves, per unit per year. */
  reservesPerUnitPerYearCents: number;
  purchasePriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  /** Immediate capital work at acquisition. null = none budgeted. */
  capexCents: number | null;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
  /** The market's cap rate for comparable buildings. null = not entered: no value at market. */
  marketCapRatePct: number | null;
}

export interface MultifamilyAcquisitionOutputs {
  totalCostCents: number;
  cashRequiredCents: number;
  grossScheduledRentCents: number;
  grossPotentialIncomeCents: number;
  effectiveGrossIncomeCents: number;
  managementCents: number;
  reservesCents: number;
  annualOperatingExpenseCents: number;
  annualNoiCents: number;
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
  /** Price ÷ gross scheduled rent. null when rent is 0. */
  grossRentMultiplier: number | null;
  /**
   * NOI ÷ market cap rate, in cents. null when no market cap rate was entered,
   * or when NOI is negative (an income approach gives no value to a loss).
   */
  stabilizedValueCents: number | null;
  financed: boolean;
}

export class MultifamilyAcquisitionInputError extends Error {}

export function computeMultifamilyAcquisition(i: MultifamilyAcquisitionInputs): MultifamilyAcquisitionOutputs {
  if (!Number.isInteger(i.unitCount) || i.unitCount < 1) {
    throw new MultifamilyAcquisitionInputError("Unit count must be a whole number, at least 1");
  }
  if (i.purchasePriceCents <= 0) throw new MultifamilyAcquisitionInputError("Purchase price must be positive");
  // A negative income or cost is a typo that moves every return; refuse it.
  for (const [k, v] of [
    ["avgMonthlyRentPerUnitCents", i.avgMonthlyRentPerUnitCents],
    ["otherMonthlyIncomeCents", i.otherMonthlyIncomeCents],
    ["annualOperatingExpensesCents", i.annualOperatingExpensesCents],
    ["reservesPerUnitPerYearCents", i.reservesPerUnitPerYearCents],
    ["closingCostsCents", i.closingCostsCents],
    ["capexCents", i.capexCents],
  ] as const) {
    if (v !== null && v < 0) throw new MultifamilyAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["vacancyPct", i.vacancyPct],
    ["managementPct", i.managementPct],
  ] as const) {
    if (v < 0 || v > 100) throw new MultifamilyAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  if (i.marketCapRatePct !== null && (i.marketCapRatePct <= 0 || i.marketCapRatePct > 100)) {
    throw new MultifamilyAcquisitionInputError("Market cap rate must be above 0% and at most 100%");
  }
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new MultifamilyAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  // Loan terms with no down payment are ambiguous: dropping them would model
  // all cash while the operator typed a loan (V1 audit). Ask instead.
  if (i.downPaymentPct === null && (i.interestRatePct !== null || i.amortizationYears !== null)) {
    throw new MultifamilyAcquisitionInputError(
      "Loan terms were entered without a down payment. Enter the down payment, or clear the loan terms for an all-cash purchase",
    );
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new MultifamilyAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new MultifamilyAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new MultifamilyAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const closing = i.closingCostsCents ?? 0;
  const capex = i.capexCents ?? 0;
  const totalCostCents = i.purchasePriceCents + closing + capex;

  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const loanCents = i.purchasePriceCents - downPaymentCents;
  const cashRequiredCents = downPaymentCents + closing + capex;

  const grossScheduledRentCents = i.unitCount * i.avgMonthlyRentPerUnitCents * 12;
  const grossPotentialIncomeCents = grossScheduledRentCents + (i.otherMonthlyIncomeCents ?? 0) * 12;
  const effectiveGrossIncomeCents = Math.round(grossPotentialIncomeCents * (1 - i.vacancyPct / 100));
  const managementCents = Math.round((effectiveGrossIncomeCents * i.managementPct) / 100);
  const reservesCents = i.reservesPerUnitPerYearCents * i.unitCount;
  const annualOperatingExpenseCents = i.annualOperatingExpensesCents + managementCents + reservesCents;
  const annualNoiCents = effectiveGrossIncomeCents - annualOperatingExpenseCents;

  const annualDebtServiceCents = financed
    ? monthlyPaymentCents(loanCents, i.interestRatePct ?? 0, i.amortizationYears ?? 0) * 12
    : 0;
  const annualCashFlow = annualNoiCents - annualDebtServiceCents;

  const stabilizedValueCents =
    i.marketCapRatePct === null || annualNoiCents < 0
      ? null
      : Math.round((annualNoiCents * 100) / i.marketCapRatePct);

  return {
    totalCostCents,
    cashRequiredCents,
    grossScheduledRentCents,
    grossPotentialIncomeCents,
    effectiveGrossIncomeCents,
    managementCents,
    reservesCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlow / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlow / cashRequiredCents : null,
    dscr: financed && annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio: effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    grossRentMultiplier: grossScheduledRentCents > 0 ? i.purchasePriceCents / grossScheduledRentCents : null,
    stabilizedValueCents,
    financed,
  };
}
