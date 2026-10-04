/**
 * The multifamily acquisition form (engine `multifamily_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const MULTIFAMILY_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "unitCount", label: "Units", unit: "count", min: 1, hint: "Rentable units in the building, occupied or not." },
  { key: "avgMonthlyRentPerUnitCents", label: "Average rent per unit, monthly ($)", unit: "cents", min: 0, hint: "What a unit actually rents for, averaged across the building — from the rent roll, not the listing's pro-forma." },
  { key: "otherMonthlyIncomeCents", label: "Other income, monthly ($)", unit: "cents", optional: true, min: 0, hint: "Laundry, parking, storage and fees for the whole building. Left empty, none is counted — and the result says so." },
  { key: "vacancyPct", label: "Vacancy and credit loss (%)", unit: "percent", min: 0, max: 100, hint: "Share of potential income you will not collect — empty units, turnover and unpaid rent." },
  { key: "annualOperatingExpensesCents", label: "Operating expenses, annual ($)", unit: "cents", min: 0, hint: "Taxes, insurance, utilities, payroll and repairs for the year. Leave out management and reserves; they are entered below." },
  { key: "managementPct", label: "Management (% of collected income)", unit: "percent", min: 0, max: 100, hint: "Enter your own time's worth if you self-manage — it is not free." },
  { key: "reservesPerUnitPerYearCents", label: "Replacement reserves per unit, annual ($)", unit: "cents", min: 0, hint: "What you set aside each year, per unit, for roofs, boilers, appliances and other replacements." },
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "closingCostsCents", label: "Closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, closing costs are excluded — and the result says so." },
  { key: "capexCents", label: "Immediate capex ($)", unit: "cents", optional: true, min: 0, hint: "Capital work you will do at purchase. Left empty, the building is treated as needing none." },
  { key: "downPaymentPct", label: "Down payment (%)", unit: "percent", optional: true, min: 0, max: 100, hint: "Leave empty to model an all-cash purchase." },
  { key: "interestRatePct", label: "Interest rate (%)", unit: "percent", optional: true, min: 0, max: 30, hint: "Required when the purchase is financed." },
  { key: "amortizationYears", label: "Amortization (years)", unit: "count", optional: true, min: 1, max: 40, hint: "Required when the purchase is financed." },
  { key: "marketCapRatePct", label: "Market cap rate (%)", unit: "percent", optional: true, min: 0.01, max: 100, hint: "The cap rate comparable buildings trade at. Enter it to see what this building's NOI is worth at market; left empty, that value is not computed." },
];
