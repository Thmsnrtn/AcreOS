/**
 * Commercial acquisition — the arithmetic behind "do I buy this commercial
 * building (office / retail / industrial) at this price?".
 *
 * A commercial building is not a big apartment building. Rent is quoted per
 * square foot, and leases bill tenants back for some or all of the operating
 * costs (expense RECOVERIES: NNN, modified-gross and CAM pass-throughs). So the
 * income line is base rent PLUS recoveries, and a lease file's recoveries are
 * a real number the operator reads off the leases, never a ratio we assume.
 *
 * Conventions reused, not re-derived:
 *   - shared/rental/noi.ts refuses to assume an operating expense for an
 *     unmeasured commercial building (the residential 40%-of-collections rule
 *     is meaningless under a triple-net or gross lease). Same rule here:
 *     operating expenses, management and reserves are REQUIRED inputs.
 *   - shared/rental/perSqft.ts quotes commercial figures per rentable square
 *     foot per year, and refuses a per-sqft figure without a positive area.
 *     Rentable square feet is a REQUIRED whole number here, so the price and
 *     base rent per square foot below always have a real denominator.
 *   - loan arithmetic is shared/calculators/finance.ts (monthlyPaymentCents).
 *   - the older `multifamily_noi` engine values a building already operated,
 *     from its ledger; it has no price, financing or cash required, so it
 *     cannot carry a buy decision. This engine can.
 *
 * THE MODEL (annual, year one, as the inputs describe it):
 *   potential gross income  = in-place annual base rent
 *                             + annual expense recoveries billed to tenants
 *                             + other annual income (parking, signage, antenna)
 *   effective gross income  = potential gross income × (1 − vacancy & credit loss%)
 *                             (applies to the whole line: an empty suite pays no
 *                             base rent and recovers no expenses either)
 *   management              = EGI × management%
 *   operating expense       = annual operating expenses (taxes, insurance, CAM,
 *                             utilities, repairs) + management + annual reserves
 *   NOI                     = EGI − operating expense
 *   total cost              = price + closing + TI/LC and immediate capex
 *   cap rate                = NOI ÷ price (the market convention)
 *   loan                    = price × (1 − down payment%)
 *   debt service            = level monthly payment × 12 (finance.ts)
 *   cash flow               = NOI − debt service
 *   cash required           = down payment + closing + TI/LC and immediate capex
 *   cash-on-cash            = annual cash flow ÷ cash required
 *   DSCR                    = NOI ÷ debt service (none when bought for cash)
 *   expense ratio           = operating expense ÷ EGI
 *   value at market cap     = NOI ÷ market cap rate (only when a market cap rate
 *                             is entered, and only for a POSITIVE NOI)
 *   price per sq ft         = price ÷ rentable square feet
 *   base rent per sq ft     = annual base rent ÷ rentable square feet
 *
 * What it does NOT model: lease-by-lease rollover, rent steps, free rent, or a
 * tenant's credit. It is year one as the operator describes it — the result IF
 * those inputs hold, not a forecast.
 *
 * UNKNOWNS ARE NOT ZEROS. Recoveries, other income, closing costs, TI/LC and
 * immediate capex, financing and the market cap rate are optional. When
 * omitted they are excluded (or, for the market cap rate, the value is not
 * computed), and the engine adapter DECLARES each omission as an assumption.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const COMMERCIAL_ACQUISITION_ENGINE_ID = "commercial_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const COMMERCIAL_ACQUISITION_ENGINE_VERSION = "commercial-acquisition-1" as const;

export interface CommercialAcquisitionInputs {
  /** Rentable square feet in the building. A whole number, at least 1. */
  rentableSqft: number;
  /** In-place annual base rent, all leases, in total (not per square foot). */
  annualBaseRentCents: number;
  /** Annual expense recoveries billed to tenants. null = not entered (none counted, declared). */
  annualRecoveriesCents: number | null;
  /** Parking, signage, antenna and other income, per year. null = not entered. */
  otherAnnualIncomeCents: number | null;
  /** Vacancy and credit loss, % of potential gross income. */
  vacancyPct: number;
  /** Taxes, insurance, CAM, utilities, repairs — per year, EXCLUDING management and reserves. */
  annualOperatingExpensesCents: number;
  /** Property management, % of effective gross income. */
  managementPct: number;
  /** Replacement reserves, per year, for the whole building. */
  annualReservesCents: number;
  /** Tenant improvements, leasing commissions and immediate capex at purchase. null = none budgeted. */
  tiLcCapexCents: number | null;
  purchasePriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
  /** The cap rate comparable buildings trade at. null = not entered: no value at market. */
  marketCapRatePct: number | null;
}

export interface CommercialAcquisitionOutputs {
  totalCostCents: number;
  cashRequiredCents: number;
  potentialGrossIncomeCents: number;
  effectiveGrossIncomeCents: number;
  managementCents: number;
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
  /**
   * NOI ÷ market cap rate, in cents. null when no market cap rate was entered,
   * or when NOI is zero or negative (an income approach gives no value to it).
   */
  stabilizedValueCents: number | null;
  /** Price ÷ rentable square feet, in cents. Not a registered metric; shown from the inputs. */
  pricePerSqftCents: number;
  /** Annual base rent ÷ rentable square feet, in cents. Not a registered metric. */
  baseRentPerSqftCents: number;
  financed: boolean;
}

export class CommercialAcquisitionInputError extends Error {}

export function computeCommercialAcquisition(i: CommercialAcquisitionInputs): CommercialAcquisitionOutputs {
  if (!Number.isInteger(i.rentableSqft) || i.rentableSqft < 1) {
    throw new CommercialAcquisitionInputError("Rentable square feet must be a whole number, at least 1");
  }
  if (i.purchasePriceCents <= 0) throw new CommercialAcquisitionInputError("Purchase price must be positive");
  // A negative income or cost is a typo that moves every return; refuse it.
  for (const [k, v] of [
    ["annualBaseRentCents", i.annualBaseRentCents],
    ["annualRecoveriesCents", i.annualRecoveriesCents],
    ["otherAnnualIncomeCents", i.otherAnnualIncomeCents],
    ["annualOperatingExpensesCents", i.annualOperatingExpensesCents],
    ["annualReservesCents", i.annualReservesCents],
    ["tiLcCapexCents", i.tiLcCapexCents],
    ["closingCostsCents", i.closingCostsCents],
  ] as const) {
    if (v !== null && v < 0) throw new CommercialAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["vacancyPct", i.vacancyPct],
    ["managementPct", i.managementPct],
  ] as const) {
    if (v < 0 || v > 100) throw new CommercialAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  if (i.marketCapRatePct !== null && (i.marketCapRatePct <= 0 || i.marketCapRatePct > 100)) {
    throw new CommercialAcquisitionInputError("Market cap rate must be above 0% and at most 100%");
  }
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new CommercialAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  // Loan terms with no down payment are ambiguous: dropping them would model
  // all cash while the operator typed a loan. Ask instead.
  if (i.downPaymentPct === null && (i.interestRatePct !== null || i.amortizationYears !== null)) {
    throw new CommercialAcquisitionInputError(
      "Loan terms were entered without a down payment. Enter the down payment, or clear the loan terms for an all-cash purchase",
    );
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new CommercialAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new CommercialAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new CommercialAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const closing = i.closingCostsCents ?? 0;
  const tiLcCapex = i.tiLcCapexCents ?? 0;
  const totalCostCents = i.purchasePriceCents + closing + tiLcCapex;

  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const loanCents = i.purchasePriceCents - downPaymentCents;
  const cashRequiredCents = downPaymentCents + closing + tiLcCapex;

  const potentialGrossIncomeCents =
    i.annualBaseRentCents + (i.annualRecoveriesCents ?? 0) + (i.otherAnnualIncomeCents ?? 0);
  const effectiveGrossIncomeCents = Math.round(potentialGrossIncomeCents * (1 - i.vacancyPct / 100));
  const managementCents = Math.round((effectiveGrossIncomeCents * i.managementPct) / 100);
  const annualOperatingExpenseCents = i.annualOperatingExpensesCents + managementCents + i.annualReservesCents;
  const annualNoiCents = effectiveGrossIncomeCents - annualOperatingExpenseCents;

  const annualDebtServiceCents = financed
    ? monthlyPaymentCents(loanCents, i.interestRatePct ?? 0, i.amortizationYears ?? 0) * 12
    : 0;
  const annualCashFlow = annualNoiCents - annualDebtServiceCents;

  const stabilizedValueCents =
    i.marketCapRatePct === null || annualNoiCents <= 0
      ? null
      : Math.round((annualNoiCents * 100) / i.marketCapRatePct);

  return {
    totalCostCents,
    cashRequiredCents,
    potentialGrossIncomeCents,
    effectiveGrossIncomeCents,
    managementCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlow / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlow / cashRequiredCents : null,
    dscr: financed && annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio: effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    stabilizedValueCents,
    pricePerSqftCents: Math.round(i.purchasePriceCents / i.rentableSqft),
    baseRentPerSqftCents: Math.round(i.annualBaseRentCents / i.rentableSqft),
    financed,
  };
}
