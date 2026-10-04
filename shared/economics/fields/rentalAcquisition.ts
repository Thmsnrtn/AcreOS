/**
 * The buy-and-hold acquisition form (engine `rental_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const RENTAL_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "closingCostsCents", label: "Closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, closing costs are excluded — and the result says so." },
  { key: "rehabCents", label: "Rehab budget ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, the property is treated as rent-ready." },
  { key: "monthlyRentCents", label: "Monthly rent ($)", unit: "cents", min: 0, hint: "The rent you can actually achieve, not the asking rent on the listing." },
  { key: "vacancyPct", label: "Vacancy (%)", unit: "percent", min: 0, max: 100, hint: "Share of the year the unit earns nothing — turnover and collection loss." },
  { key: "monthlyFixedExpensesCents", label: "Fixed monthly costs ($)", unit: "cents", min: 0, hint: "Taxes, insurance, HOA and any utilities you pay." },
  { key: "managementPct", label: "Management (% of rent)", unit: "percent", min: 0, max: 100, hint: "Enter your own time's worth if you self-manage — it is not free." },
  { key: "reservesPct", label: "Repairs + capex reserve (% of rent)", unit: "percent", min: 0, max: 100, hint: "What you set aside for repairs and big-ticket replacements." },
  { key: "downPaymentPct", label: "Down payment (%)", unit: "percent", optional: true, min: 0, max: 100, hint: "Leave empty to model an all-cash purchase." },
  { key: "interestRatePct", label: "Interest rate (%)", unit: "percent", optional: true, min: 0, max: 30 },
  { key: "amortizationYears", label: "Amortization (years)", unit: "count", optional: true, min: 1, max: 40 },
];
