/**
 * The creative-finance wrap form (engine `creative_wrap`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const CREATIVE_WRAP_FIELDS: readonly EngineField[] = [
  // ── Acquisition: the loan you take over and what you pay to take the deal ──
  { key: "underlyingBalanceCents", label: "Underlying loan balance ($)", unit: "cents", min: 1, hint: "The balance still owed on the loan you take over — the seller's mortgage taken subject-to, or the note the seller carries back. From the latest statement, not the original amount." },
  { key: "underlyingRatePct", label: "Underlying loan rate (%)", unit: "percent", min: 0, max: 30, hint: "The interest rate on that loan." },
  { key: "underlyingRemainingMonths", label: "Underlying months remaining", unit: "months", min: 1, max: 480, hint: "Payments left on that loan's schedule (e.g. 300 on a 30-year loan five years in)." },
  { key: "underlyingPaymentCents", label: "Underlying monthly payment ($)", unit: "cents", optional: true, min: 1, hint: "Principal and interest only, from the statement — not taxes or insurance. Leave empty to use the level payment for this balance, rate and term." },
  { key: "cashToSellerCents", label: "Cash to seller ($)", unit: "cents", min: 0, hint: "What you pay the seller for their equity at closing. Enter 0 if you pay them nothing." },
  { key: "closingCostsCents", label: "Closing and acquisition costs ($)", unit: "cents", optional: true, min: 0, hint: "Title, escrow, legal, recording and any arrears you bring current. Left empty, they are excluded, and the result says so." },
  { key: "repairsCents", label: "Repairs before resale ($)", unit: "cents", optional: true, min: 0, hint: "What you spend to make it sellable. Left empty, no repairs are counted, and the result says so. The months the repairs take are not modelled: resale is assumed in the month you take the property." },
  // ── Resale on the wrap: what the end buyer pays you ──
  { key: "salePriceCents", label: "Sale price to end buyer ($)", unit: "cents", min: 1, hint: "The price on the wrap sale." },
  { key: "buyerDownPaymentCents", label: "Buyer's down payment ($)", unit: "cents", min: 0, hint: "What the end buyer pays you up front. The rest of the price is the wrap note." },
  { key: "wrapRatePct", label: "Wrap rate (%)", unit: "percent", min: 0, max: 30, hint: "The interest rate on the note the end buyer signs." },
  { key: "wrapAmortizationMonths", label: "Wrap amortization (months)", unit: "months", min: 1, max: 480, hint: "The months the wrap note's payment is figured over (360 for 30 years)." },
  { key: "monthlyServicingCents", label: "Monthly servicing cost ($)", unit: "cents", optional: true, min: 0, hint: "What a loan servicer charges you each month to collect from the buyer and pay the underlying. Left empty, none is counted, and the result says so." },
  { key: "horizonMonths", label: "Payoff month", unit: "months", min: 1, max: 480, hint: "The month you expect the end buyer to refinance or pay off the wrap. No more than the shorter of the two loans' terms. The whole return depends on it, so there is no default." },
];
