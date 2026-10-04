/**
 * The mobile-home park acquisition form (engine `park_acquisition`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const PARK_ACQUISITION_FIELDS: readonly EngineField[] = [
  { key: "totalLots", label: "Total lots", unit: "count", min: 1, hint: "Every lot (pad) in the park, occupied or not." },
  { key: "occupiedLots", label: "Occupied lots", unit: "count", min: 0, hint: "Lots with a paying resident today, counted from the rent roll. Empty lots earn nothing, so occupancy comes from this count — it is never assumed." },
  { key: "monthlyLotRentCents", label: "Lot rent, monthly ($)", unit: "cents", min: 0, hint: "What an occupied lot pays for the ground, averaged across the park — from the rent roll, not the listing's pro-forma." },
  { key: "parkOwnedHomes", label: "Park-owned homes rented out", unit: "count", optional: true, min: 0, hint: "Homes the park owns and rents to residents. They sit on occupied lots, so there cannot be more of them than occupied lots. Enter 0 for a lot-rent-only park; left empty, no home rent is counted — and the result says so." },
  { key: "parkOwnedHomeRentCents", label: "Home rent per park-owned home, monthly ($)", unit: "cents", optional: true, min: 0, hint: "The home's rent ON TOP of its lot rent, averaged across the park-owned homes. Required when the park owns homes." },
  { key: "otherMonthlyIncomeCents", label: "Other income, monthly ($)", unit: "cents", optional: true, min: 0, hint: "Laundry and utility bill-back for the whole park. Left empty, none is counted — and the result says so." },
  { key: "creditLossPct", label: "Credit loss (%)", unit: "percent", min: 0, max: 100, hint: "Share of the rent billed to occupied lots and homes that you will not collect: late payers, evictions, abandoned homes. Empty lots are already left out by the occupied-lot count, so do not count them again here." },
  { key: "annualOperatingExpensesCents", label: "Operating expenses, annual ($)", unit: "cents", min: 0, hint: "Taxes, insurance, the water and sewer the park pays, repairs and payroll for the year. Leave out management and the capex reserve; they are entered below." },
  { key: "managementPct", label: "Management (% of collected income)", unit: "percent", min: 0, max: 100, hint: "Enter your own time's worth if you self-manage — it is not free." },
  { key: "capexReservePerLotPerYearCents", label: "Capex reserve per lot, annual ($)", unit: "cents", min: 0, hint: "What you set aside each year, per lot, for roads, water and sewer lines and pedestals. It applies to every lot, occupied or not." },
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "closingCostsCents", label: "Closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, closing costs are excluded — and the result says so." },
  { key: "infrastructureCapexCents", label: "Infrastructure capex ($)", unit: "cents", optional: true, min: 0, hint: "Roads, water, sewer and electrical work you will do at purchase. Left empty, the park is treated as needing none." },
  { key: "downPaymentPct", label: "Down payment (%)", unit: "percent", optional: true, min: 0, max: 100, hint: "Leave empty, with the loan terms empty too, to model an all-cash purchase." },
  { key: "interestRatePct", label: "Interest rate (%)", unit: "percent", optional: true, min: 0, max: 30, hint: "Required when the purchase is financed." },
  { key: "amortizationYears", label: "Amortization (years)", unit: "count", optional: true, min: 1, max: 40, hint: "Required when the purchase is financed." },
  { key: "marketCapRatePct", label: "Market cap rate (%)", unit: "percent", optional: true, min: 0.01, max: 100, hint: "The cap rate comparable parks trade at. Enter it to see what this park's NOI is worth at that rate; left empty, that value is not computed." },
];
