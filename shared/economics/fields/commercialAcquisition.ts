/**
 * The commercial acquisition form (engine `commercial_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const COMMERCIAL_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "rentableSqft", label: "Rentable square feet", unit: "count", min: 1, hint: "The building's total rentable area, leased or not, from the rent roll or the leases." },
  { key: "annualBaseRentCents", label: "Base rent in place, annual ($)", unit: "cents", min: 0, hint: "The total base rent all current leases pay in a year — the dollar total, not the rate per square foot." },
  { key: "annualRecoveriesCents", label: "Expense recoveries billed to tenants, annual ($)", unit: "cents", optional: true, min: 0, hint: "Taxes, insurance and CAM the leases bill back to tenants (NNN, modified-gross). Left empty, none is counted, as for a gross lease — and the result says so." },
  { key: "otherAnnualIncomeCents", label: "Other income, annual ($)", unit: "cents", optional: true, min: 0, hint: "Parking, signage, antenna or storage income. Left empty, none is counted — and the result says so." },
  { key: "vacancyPct", label: "Vacancy and credit loss (%)", unit: "percent", min: 0, max: 100, hint: "Share of potential income you will not collect — empty suites, downtime between tenants and unpaid rent. It applies to recoveries too: an empty suite recovers nothing." },
  { key: "annualOperatingExpensesCents", label: "Operating expenses, annual ($)", unit: "cents", min: 0, hint: "Taxes, insurance, CAM, utilities and repairs for the year — the full cost, before recoveries. Leave out management and reserves; they are entered below." },
  { key: "managementPct", label: "Management (% of collected income)", unit: "percent", min: 0, max: 100, hint: "Enter your own time's worth if you self-manage — it is not free." },
  { key: "annualReservesCents", label: "Replacement reserves, annual ($)", unit: "cents", min: 0, hint: "What you set aside each year for the roof, parking lot, HVAC and other replacements, for the whole building." },
  { key: "tiLcCapexCents", label: "TI, leasing commissions and immediate capex ($)", unit: "cents", optional: true, min: 0, hint: "Tenant improvements, leasing commissions and capital work you will fund at purchase. Left empty, the building is treated as needing none." },
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "closingCostsCents", label: "Closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, closing costs are excluded — and the result says so." },
  { key: "downPaymentPct", label: "Down payment (%)", unit: "percent", optional: true, min: 0, max: 100, hint: "Leave empty, with no loan terms, to model an all-cash purchase." },
  { key: "interestRatePct", label: "Interest rate (%)", unit: "percent", optional: true, min: 0, max: 30, hint: "Required when the purchase is financed." },
  { key: "amortizationYears", label: "Amortization (years)", unit: "count", optional: true, min: 1, max: 40, hint: "Required when the purchase is financed." },
  { key: "marketCapRatePct", label: "Market cap rate (%)", unit: "percent", optional: true, min: 0.01, max: 100, hint: "The cap rate comparable buildings trade at. Enter it to see what this building's NOI is worth at market; left empty, that value is not computed." },
];
