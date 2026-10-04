/**
 * The land development pro-forma form (engine `development_proforma`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const DEVELOPMENT_PROFORMA_FIELDS: readonly EngineField[] = [
  { key: "landCostCents", label: "Land price ($)", unit: "cents", min: 1 },
  { key: "entitlementCostsCents", label: "Entitlement and soft costs ($)", unit: "cents", min: 0, hint: "Engineering, surveys, studies, plat and permit fees, legal. Enter 0 if the land is already entitled." },
  { key: "improvementCostsCents", label: "Horizontal improvements, whole project ($)", unit: "cents", min: 0, hint: "Roads, utilities, grading and drainage. If you budget per lot, multiply by the number of lots." },
  { key: "lotCount", label: "Lots to sell", unit: "count", min: 1, max: 10_000 },
  { key: "averageLotPriceCents", label: "Average lot sale price ($)", unit: "cents", min: 0, hint: "What a finished lot will actually sell for, not the best-case asking price." },
  { key: "sellingCostPct", label: "Selling costs (% of sales)", unit: "percent", min: 0, max: 100, hint: "Commissions, closing costs and marketing on each lot sale." },
  { key: "entitlementMonths", label: "Months to entitle", unit: "months", min: 0, max: 120, hint: "From closing on the land to an approved plat. Enter 0 if it is already entitled." },
  { key: "developmentMonths", label: "Months to build improvements", unit: "months", min: 0, max: 120, hint: "Improvement spending is spread evenly over these months." },
  { key: "selloutMonths", label: "Months to sell out", unit: "months", min: 1, max: 120, hint: "Lots are modelled as selling evenly over this period." },
  { key: "monthlyCarryCents", label: "Monthly carry ($)", unit: "cents", optional: true, min: 0, hint: "Taxes, insurance and loan interest while you hold. Left empty, carry is excluded — and the result says so." },
];
