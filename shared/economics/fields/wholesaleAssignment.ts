/**
 * The wholesale assignment form (engine `wholesale_assignment`).
 * Conventions: shared/economics/engineFields.ts.
 */
import type { EngineField } from "../engineFields";

export const WHOLESALE_ASSIGNMENT_FIELDS: readonly EngineField[] = [
  { key: "arvCents", label: "After-repair value ($)", unit: "cents", min: 1, hint: "What the house sells for once it's fixed up — from sold comps, not list prices." },
  { key: "buyerRulePct", label: "Buyer's rule (% of ARV)", unit: "percent", min: 0, max: 100, hint: "The share of ARV your cash buyers pay before repairs — 70 if they buy on the 70% rule." },
  { key: "buyerRepairEstimateCents", label: "Buyer's repair estimate ($)", unit: "cents", min: 0, hint: "What your buyer will budget for repairs. Buyers usually estimate higher than you do." },
  { key: "contractPriceCents", label: "Your contract price ($)", unit: "cents", min: 1, hint: "The price you'd put the house under contract at with the seller." },
  { key: "marketingCostCents", label: "Marketing cost of this deal ($)", unit: "cents", optional: true, min: 0, hint: "Mail, ads, lists and skip tracing it took to find this house. Left empty, it is excluded — and the result says so." },
  { key: "closingCostsCents", label: "Your closing costs ($)", unit: "cents", optional: true, min: 0, hint: "Title, escrow or attorney fees you pay to assign. Left empty, they are excluded — and the result says so." },
  { key: "earnestMoneyCents", label: "Earnest money ($)", unit: "cents", optional: true, min: 0, hint: "Shown as money at risk. It is not a cost: it normally comes back when the contract assigns." },
];
