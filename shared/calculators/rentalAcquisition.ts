/**
 * Buy-and-hold rental acquisition — the arithmetic behind "do I buy this
 * rental at this price?".
 *
 * The older `rental_returns` engine answered a narrower question. It had a
 * purchase price, rent and one expense line, no vacancy, no management, no
 * reserves, no financing, and no closing or rehab cost. That is fine for a quick
 * screen, but too thin to stake an acquisition on. This engine models what a
 * buy-and-hold investor actually underwrites. It is the reference engine of the
 * vertical program (decision-memos/2026-10-04-vertical-program.md).
 *
 * THE MODEL (annual, year one, stabilised):
 *   gross scheduled rent   = monthly rent × 12
 *   effective gross income = gross × (1 − vacancy%)
 *   operating expense      = fixed monthly costs × 12
 *                            + EGI × (management% + reserves%)
 *   NOI                    = EGI − operating expense
 *   all-in cost            = price + closing + rehab
 *   cap rate               = NOI ÷ price (the market convention)
 *   loan                   = price × (1 − down payment%)
 *   debt service           = level monthly payment × 12
 *   cash flow              = NOI − debt service
 *   cash required          = down payment + closing + rehab
 *   cash-on-cash           = cash flow ÷ cash required
 *   DSCR                   = NOI ÷ debt service (none when bought for cash)
 *
 * UNKNOWNS ARE NOT ZEROS. Closing costs and rehab are optional. When they are
 * omitted they are excluded, and the engine adapter DECLARES each exclusion as
 * an assumption, so a cost nobody entered cannot read as a measured $0. Vacancy,
 * fixed costs, management and reserves are REQUIRED: there is no honest default
 * for them, and a silent one is how a rental looks profitable on paper.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const RENTAL_ACQUISITION_ENGINE_ID = "rental_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const RENTAL_ACQUISITION_ENGINE_VERSION = "rental-acquisition-1" as const;

export interface RentalAcquisitionInputs {
  purchasePriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  rehabCents: number | null;
  monthlyRentCents: number;
  vacancyPct: number;
  /** Taxes, insurance, HOA, utilities the owner pays — per month. */
  monthlyFixedExpensesCents: number;
  /** Property management, % of collected rent. */
  managementPct: number;
  /** Maintenance + capital-expense reserve, % of collected rent. */
  reservesPct: number;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
}

export interface RentalAcquisitionOutputs {
  totalCostCents: number;
  cashRequiredCents: number;
  effectiveGrossIncomeCents: number;
  annualOperatingExpenseCents: number;
  annualNoiCents: number;
  annualDebtServiceCents: number;
  monthlyCashFlowCents: number;
  /** NOI ÷ price, as a ratio. null when the price is 0. */
  capRate: number | null;
  /** Annual cash flow ÷ cash required. null when no cash is required. */
  cashOnCash: number | null;
  /** NOI ÷ debt service. null when bought for cash. */
  dscr: number | null;
  /** Operating expense ÷ EGI. null when EGI is 0. */
  operatingExpenseRatio: number | null;
  /** Price ÷ gross scheduled annual rent. null when rent is 0. */
  grossRentMultiplier: number | null;
  financed: boolean;
}

export class RentalAcquisitionInputError extends Error {}

export function computeRentalAcquisition(i: RentalAcquisitionInputs): RentalAcquisitionOutputs {
  if (i.purchasePriceCents <= 0) throw new RentalAcquisitionInputError("Purchase price must be positive");
  if (i.monthlyRentCents < 0) throw new RentalAcquisitionInputError("Rent cannot be negative");
  // A negative cost is a typo that flatters every return; refuse it.
  for (const [k, v] of [
    ["closingCostsCents", i.closingCostsCents],
    ["rehabCents", i.rehabCents],
    ["monthlyFixedExpensesCents", i.monthlyFixedExpensesCents],
  ] as const) {
    if (v !== null && v < 0) throw new RentalAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["vacancyPct", i.vacancyPct],
    ["managementPct", i.managementPct],
    ["reservesPct", i.reservesPct],
  ] as const) {
    if (v < 0 || v > 100) throw new RentalAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new RentalAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new RentalAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new RentalAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new RentalAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const closing = i.closingCostsCents ?? 0;
  const rehab = i.rehabCents ?? 0;
  const totalCostCents = i.purchasePriceCents + closing + rehab;

  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const loanCents = i.purchasePriceCents - downPaymentCents;
  const cashRequiredCents = downPaymentCents + closing + rehab;

  const grossAnnual = i.monthlyRentCents * 12;
  const effectiveGrossIncomeCents = Math.round(grossAnnual * (1 - i.vacancyPct / 100));
  const variable = Math.round((effectiveGrossIncomeCents * (i.managementPct + i.reservesPct)) / 100);
  const annualOperatingExpenseCents = i.monthlyFixedExpensesCents * 12 + variable;
  const annualNoiCents = effectiveGrossIncomeCents - annualOperatingExpenseCents;

  const annualDebtServiceCents = financed
    ? monthlyPaymentCents(loanCents, i.interestRatePct ?? 0, i.amortizationYears ?? 0) * 12
    : 0;
  const annualCashFlow = annualNoiCents - annualDebtServiceCents;

  return {
    totalCostCents,
    cashRequiredCents,
    effectiveGrossIncomeCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlow / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlow / cashRequiredCents : null,
    dscr: financed && annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio: effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    grossRentMultiplier: grossAnnual > 0 ? i.purchasePriceCents / grossAnnual : null,
    financed,
  };
}
