/**
 * Mobile-home park acquisition — the arithmetic behind "do I buy this park at
 * this price?".
 *
 * A park earns LOT rent: the resident owns the home and rents the ground under
 * it. Some parks also own homes and rent them out (park-owned homes, POH).
 * That is a separate, riskier income line: the park carries the home's repairs,
 * turnover and vacancy as well as the lot. So the two are entered separately
 * and never blended into one "rent per space".
 *
 * Occupancy is an INPUT, never assumed. The operator enters the occupied lot
 * count from the rent roll; empty lots earn nothing, so there is no separate
 * vacancy percentage to double-count them. Credit loss covers what occupied
 * lots and homes are billed but do not pay.
 *
 * THE MODEL (annual, year one):
 *   lot income              = occupied lots × monthly lot rent × 12
 *   POH income              = park-owned homes × monthly home rent × 12
 *                             (home rent is ON TOP of the lot rent that home's
 *                             lot already pays, so the lot is not counted twice)
 *   other income            = other monthly income × 12 (laundry, utility
 *                             bill-back)
 *   gross income            = lot income + POH income + other income
 *   effective gross income  = gross income × (1 − credit loss%)
 *   management              = EGI × management%
 *   capex reserve           = reserve per lot per year × TOTAL lots (empty
 *                             pads still have roads, pipes and pedestals)
 *   operating expense       = annual operating expenses (taxes, insurance,
 *                             water/sewer the park pays, repairs, payroll)
 *                             + management + capex reserve
 *   NOI                     = EGI − operating expense
 *   all-in cost             = price + closing + infrastructure capex
 *   cap rate                = NOI ÷ price (the market convention)
 *   loan                    = price × (1 − down payment%)
 *   debt service            = level monthly payment × 12 (finance.ts)
 *   cash flow               = NOI − debt service
 *   cash required           = down payment + closing + infrastructure capex
 *   cash-on-cash            = annual cash flow ÷ cash required
 *   DSCR                    = NOI ÷ debt service (none when bought for cash)
 *   expense ratio           = operating expense ÷ EGI
 *   value at market cap     = NOI ÷ market cap rate (only when a market cap
 *                             rate is entered, and only for a positive NOI)
 *   lot occupancy           = occupied lots ÷ total lots (the operator's own
 *                             two inputs, divided)
 *   price per lot           = price ÷ total lots
 *
 * UNKNOWNS ARE NOT ZEROS. Park-owned homes, other income, closing costs,
 * infrastructure capex, financing and the market cap rate are optional. When
 * omitted they are excluded (or, for the market cap rate, the value is not
 * computed), and the engine adapter DECLARES each omission as an assumption.
 * Occupancy, lot rent, credit loss, operating expenses, management and the
 * capex reserve are REQUIRED: there is no honest default for them, and a
 * silent one is how a park looks profitable on paper.
 *
 * PURE: integer cents in and out; rates in percentage points.
 */
import { monthlyPaymentCents } from "./finance";

export const PARK_ACQUISITION_ENGINE_ID = "park_acquisition" as const;
/** Bump when the arithmetic changes in a way that could move a number. */
export const PARK_ACQUISITION_ENGINE_VERSION = "park-acquisition-1" as const;

export interface ParkAcquisitionInputs {
  /** Lots (pads) in the park, occupied or not. A whole number, at least 1. */
  totalLots: number;
  /** Lots with a paying resident today, from the rent roll. Whole, at most totalLots. */
  occupiedLots: number;
  /** Monthly lot rent per occupied lot. */
  monthlyLotRentCents: number;
  /** Homes the park owns and rents out. null = not entered (none counted, declared). Whole, at most occupiedLots. */
  parkOwnedHomes: number | null;
  /** Average monthly home rent per park-owned home, ON TOP of its lot rent. Required when parkOwnedHomes > 0. */
  parkOwnedHomeRentCents: number | null;
  /** Laundry, utility bill-back — per month for the whole park. null = not entered. */
  otherMonthlyIncomeCents: number | null;
  /** Share of billed income not collected, in percentage points. */
  creditLossPct: number;
  /** Taxes, insurance, water/sewer the park pays, repairs, payroll — per year, EXCLUDING management and the capex reserve. */
  annualOperatingExpensesCents: number;
  /** Property management, % of effective gross income. */
  managementPct: number;
  /** Capital reserve per lot per year, applied to every lot. */
  capexReservePerLotPerYearCents: number;
  purchasePriceCents: number;
  /** null = not entered (excluded and declared), never zero. */
  closingCostsCents: number | null;
  /** Roads, water, sewer, electrical work at acquisition. null = none budgeted. */
  infrastructureCapexCents: number | null;
  /** null = bought for cash. */
  downPaymentPct: number | null;
  interestRatePct: number | null;
  amortizationYears: number | null;
  /** The cap rate comparable parks trade at. null = not entered: no value at market. */
  marketCapRatePct: number | null;
}

export interface ParkAcquisitionOutputs {
  totalCostCents: number;
  cashRequiredCents: number;
  lotIncomeCents: number;
  parkOwnedHomeIncomeCents: number;
  otherIncomeCents: number;
  grossIncomeCents: number;
  effectiveGrossIncomeCents: number;
  managementCents: number;
  capexReserveCents: number;
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
   * or when NOI is negative (an income approach gives no value to a loss).
   */
  stabilizedValueCents: number | null;
  /** Occupied lots ÷ total lots, as a ratio. */
  lotOccupancy: number;
  /** Price ÷ total lots, in cents (rounded). */
  pricePerLotCents: number;
  financed: boolean;
}

export class ParkAcquisitionInputError extends Error {}

export function computeParkAcquisition(i: ParkAcquisitionInputs): ParkAcquisitionOutputs {
  if (!Number.isInteger(i.totalLots) || i.totalLots < 1) {
    throw new ParkAcquisitionInputError("Total lots must be a whole number, at least 1");
  }
  if (!Number.isInteger(i.occupiedLots) || i.occupiedLots < 0 || i.occupiedLots > i.totalLots) {
    throw new ParkAcquisitionInputError("Occupied lots must be a whole number, from 0 up to the total lots");
  }
  if (
    i.parkOwnedHomes !== null &&
    (!Number.isInteger(i.parkOwnedHomes) || i.parkOwnedHomes < 0 || i.parkOwnedHomes > i.occupiedLots)
  ) {
    // A rented park-owned home sits on an occupied lot, so there cannot be more
    // of them than occupied lots.
    throw new ParkAcquisitionInputError("Park-owned homes must be a whole number, from 0 up to the occupied lots");
  }
  // Home rent with no home count is ambiguous: dropping it would model a
  // lot-rent-only park while the operator typed home income. Ask instead.
  if (i.parkOwnedHomes === null && i.parkOwnedHomeRentCents !== null) {
    throw new ParkAcquisitionInputError(
      "A park-owned home rent was entered without the number of park-owned homes. Enter how many homes the park owns and rents out, or clear the home rent",
    );
  }
  if (i.parkOwnedHomes !== null && i.parkOwnedHomes > 0 && i.parkOwnedHomeRentCents === null) {
    throw new ParkAcquisitionInputError("Park-owned homes need their average monthly home rent");
  }
  if (i.purchasePriceCents <= 0) throw new ParkAcquisitionInputError("Purchase price must be positive");
  // A negative income or cost is a typo that moves every return; refuse it.
  for (const [k, v] of [
    ["monthlyLotRentCents", i.monthlyLotRentCents],
    ["parkOwnedHomeRentCents", i.parkOwnedHomeRentCents],
    ["otherMonthlyIncomeCents", i.otherMonthlyIncomeCents],
    ["annualOperatingExpensesCents", i.annualOperatingExpensesCents],
    ["capexReservePerLotPerYearCents", i.capexReservePerLotPerYearCents],
    ["closingCostsCents", i.closingCostsCents],
    ["infrastructureCapexCents", i.infrastructureCapexCents],
  ] as const) {
    if (v !== null && v < 0) throw new ParkAcquisitionInputError(`${k} cannot be negative`);
  }
  for (const [k, v] of [
    ["creditLossPct", i.creditLossPct],
    ["managementPct", i.managementPct],
  ] as const) {
    if (v < 0 || v > 100) throw new ParkAcquisitionInputError(`${k} must be between 0 and 100`);
  }
  if (i.marketCapRatePct !== null && (i.marketCapRatePct <= 0 || i.marketCapRatePct > 100)) {
    throw new ParkAcquisitionInputError("Market cap rate must be above 0% and at most 100%");
  }
  if (i.downPaymentPct !== null && (i.downPaymentPct < 0 || i.downPaymentPct > 100)) {
    throw new ParkAcquisitionInputError("Down payment must be between 0% and 100%");
  }
  // Loan terms with no down payment are ambiguous: dropping them would model
  // all cash while the operator typed a loan (V1 audit). Ask instead.
  if (i.downPaymentPct === null && (i.interestRatePct !== null || i.amortizationYears !== null)) {
    throw new ParkAcquisitionInputError(
      "Loan terms were entered without a down payment. Enter the down payment, or clear the loan terms for an all-cash purchase",
    );
  }
  const financed = i.downPaymentPct !== null && i.downPaymentPct < 100;
  if (financed && (i.interestRatePct === null || i.amortizationYears === null)) {
    throw new ParkAcquisitionInputError("A financed purchase needs an interest rate and an amortization period");
  }
  if (financed && (i.interestRatePct! < 0 || i.interestRatePct! > 30)) {
    throw new ParkAcquisitionInputError("Interest rate must be between 0% and 30%");
  }
  if (financed && (!Number.isInteger(i.amortizationYears) || i.amortizationYears! < 1 || i.amortizationYears! > 40)) {
    throw new ParkAcquisitionInputError("Amortization must be a whole number of years, 1 to 40");
  }

  const closing = i.closingCostsCents ?? 0;
  const infrastructure = i.infrastructureCapexCents ?? 0;
  const totalCostCents = i.purchasePriceCents + closing + infrastructure;

  const downPct = i.downPaymentPct ?? 100;
  const downPaymentCents = Math.round((i.purchasePriceCents * downPct) / 100);
  const loanCents = i.purchasePriceCents - downPaymentCents;
  const cashRequiredCents = downPaymentCents + closing + infrastructure;

  const lotIncomeCents = i.occupiedLots * i.monthlyLotRentCents * 12;
  const homes = i.parkOwnedHomes ?? 0;
  const parkOwnedHomeIncomeCents = homes > 0 ? homes * (i.parkOwnedHomeRentCents ?? 0) * 12 : 0;
  const otherIncomeCents = (i.otherMonthlyIncomeCents ?? 0) * 12;
  const grossIncomeCents = lotIncomeCents + parkOwnedHomeIncomeCents + otherIncomeCents;
  const effectiveGrossIncomeCents = Math.round(grossIncomeCents * (1 - i.creditLossPct / 100));
  const managementCents = Math.round((effectiveGrossIncomeCents * i.managementPct) / 100);
  const capexReserveCents = i.capexReservePerLotPerYearCents * i.totalLots;
  const annualOperatingExpenseCents = i.annualOperatingExpensesCents + managementCents + capexReserveCents;
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
    lotIncomeCents,
    parkOwnedHomeIncomeCents,
    otherIncomeCents,
    grossIncomeCents,
    effectiveGrossIncomeCents,
    managementCents,
    capexReserveCents,
    annualOperatingExpenseCents,
    annualNoiCents,
    annualDebtServiceCents,
    monthlyCashFlowCents: Math.round(annualCashFlow / 12),
    capRate: annualNoiCents / i.purchasePriceCents,
    cashOnCash: cashRequiredCents > 0 ? annualCashFlow / cashRequiredCents : null,
    dscr: financed && annualDebtServiceCents > 0 ? annualNoiCents / annualDebtServiceCents : null,
    operatingExpenseRatio: effectiveGrossIncomeCents > 0 ? annualOperatingExpenseCents / effectiveGrossIncomeCents : null,
    stabilizedValueCents,
    lotOccupancy: i.occupiedLots / i.totalLots,
    pricePerLotCents: Math.round(i.purchasePriceCents / i.totalLots),
    financed,
  };
}
