/**
 * The wholesale MAO form (engine `wholesale_mao`).
 * Conventions: shared/economics/engineFields.ts. Every field is required: the
 * engine refuses a missing rule rather than assume one.
 */
import type { EngineField } from "../engineFields";

export const WHOLESALE_MAO_FIELDS: readonly EngineField[] = [
  { key: "arvCents", label: "After-repair value ($)", unit: "cents", min: 1, hint: "From the sold comps you list below — the comps are frozen with the decision." },
  { key: "rehabEstimateCents", label: "Rehab estimate ($)", unit: "cents", min: 0, hint: "Before contingency. Each side adds its own contingency." },
  { key: "targetFeeCents", label: "Target assignment fee ($)", unit: "cents", min: 0, hint: "The fee you want to assign at. It comes off the lower of the two ceilings." },
  { key: "sellerRulePct", label: "Your rule (% of ARV)", unit: "percent", min: 1, max: 100, hint: "The ceiling you'd accept as the end buyer yourself." },
  { key: "sellerContingencyPct", label: "Your rehab contingency (%)", unit: "percent", min: 0, max: 100 },
  { key: "buyerRulePct", label: "End buyer's rule (% of ARV)", unit: "percent", min: 1, max: 100, hint: "What your cash buyer has told you they pay — their number, not a rule of thumb." },
  { key: "buyerContingencyPct", label: "End buyer's rehab contingency (%)", unit: "percent", min: 0, max: 100 },
];
