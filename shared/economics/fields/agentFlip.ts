/**
 * The agent-investor own-account flip form (engine `agent_flip`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const AGENT_FLIP_FIELDS: readonly EngineField[] = [
  { key: "purchasePriceCents", label: "Purchase price ($)", unit: "cents", min: 1 },
  { key: "buySideCommissionPct", label: "Buy-side commission you earn (%)", unit: "percent", min: 0, max: 10, hint: "The buyer-agent commission on your own purchase, as a % of the price." },
  { key: "buySideBrokerageSplitPct", label: "Brokerage split on the buy side (%)", unit: "percent", min: 0, max: 100, hint: "The share your brokerage keeps — 30 on a 70/30 split. Enter 0 if you are past your annual cap." },
  { key: "purchaseClosingCostsCents", label: "Purchase closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, purchase closing costs are excluded — and the result says so." },
  { key: "rehabCents", label: "Rehab budget ($)", unit: "cents", optional: true, min: 0, hint: "Left empty, the property is treated as ready to sell as bought." },
  { key: "holdMonths", label: "Holding period (months)", unit: "months", min: 1, max: 60, hint: "Months from your purchase closing to your sale closing." },
  { key: "monthlyHoldingCostCents", label: "Monthly holding cost ($)", unit: "cents", optional: true, min: 0, hint: "Taxes, insurance, utilities and loan interest while you hold. Left empty, carry is excluded." },
  { key: "salePriceCents", label: "Expected sale price ($)", unit: "cents", min: 1, hint: "What it will sell for after any rehab, from your own comps." },
  { key: "listingCommissionPct", label: "Listing commission you charge (%)", unit: "percent", min: 0, max: 10, hint: "Your own listing commission, as a % of the sale. 0 is a real answer." },
  { key: "listingBrokerageSplitPct", label: "Brokerage split on the listing (%)", unit: "percent", min: 0, max: 100, hint: "The share of your listing commission your brokerage keeps. Only that share is a cost to you." },
  { key: "coopCommissionPct", label: "Co-op commission to the buyer's agent (%)", unit: "percent", min: 0, max: 10, hint: "What you offer the other side, as a % of the sale. Paid in full." },
  { key: "saleClosingCostsPct", label: "Sale closing costs (% of sale)", unit: "percent", min: 0, max: 20, hint: "Seller-side title, transfer tax and concessions, as a % of the sale." },
];
