/**
 * The tax max-bid form (engine `tax_max_bid`).
 * Conventions: shared/economics/engineFields.ts. Every stack line is
 * required — a max bid derived from a defaulted line is a number the
 * operator cannot defend. The required return is stated one of two ways;
 * the engine refuses both-or-neither.
 */
import type { EngineField } from "../engineFields";

export const TAX_MAX_BID_FIELDS: readonly EngineField[] = [
  { key: "lotValueCents", label: "What the lot is worth ($)", unit: "cents", min: 1, hint: "Your own valuation of the lot — the number every other line is measured against." },
  { key: "survivingLiensCents", label: "Liens your search says survive ($)", unit: "cents", min: 0, hint: "From your own title or lien search. Enter 0 only if your search found none — not searched is not none. AcreOS does not decide which liens survive a sale." },
  { key: "otherTaxesCents", label: "Other taxes you would have to pay ($)", unit: "cents", min: 0, hint: "Other open years or jurisdictions the buyer takes on. Enter 0 only if you have checked and there are none." },
  { key: "clearAndHoldCostsCents", label: "Costs to clear title and hold ($)", unit: "cents", min: 0, hint: "Quiet title, closing and holding costs, as one total. Enter 0 only if there genuinely are none." },
  { key: "requiredReturnCents", label: "Your required return ($)", unit: "cents", optional: true, min: 0, hint: "State your return this way OR as a percentage of the lot's value — one or the other, not both." },
  { key: "requiredReturnPct", label: "— or your required return (% of value)", unit: "percent", optional: true, min: 0, max: 100, hint: "A percentage of what the lot is worth. Leave the dollar return empty if you use this." },
];
