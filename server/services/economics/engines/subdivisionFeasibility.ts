/**
 * The subdivision feasibility engine: the registered adapter over
 * shared/subdivision/feasibility.ts (Subdivision V1, Leg 3; package §5.4).
 *
 * It declares the `subdivider` vertical: a subdivider decision counts only when
 * it cites a scenario from this engine (evidence rule v2). The adapter's job is
 * the boundary — validate the wire inputs, map outputs onto the shared metric
 * vocabulary, and DECLARE every substitution and modelling choice as an
 * assumption with its origin and basis, so they render wherever the figures
 * do. An omitted cost line is never absorbed as $0: its section, and every
 * figure that sums it, is null with the reason.
 */
import {
  ScenarioEngineError,
  metric,
  optionalCents,
  requireCents,
  requireNumber,
  requireOneOf,
  type EngineSpec,
  type ScenarioAssumption,
} from "@shared/economics/scenario";
import {
  FEASIBILITY_ENGINE_VERSION,
  FeasibilityInputError,
  HARD_LINES,
  SOFT_LINES,
  computeFeasibility,
  type CostLineKey,
  type FeasibilityInputs,
} from "@shared/subdivision/feasibility";

const SUBDIVISION_FEASIBILITY_ENGINE_ID = "subdivision_feasibility";

function optionalNumber(inputs: Record<string, number | string>, key: string): number | null {
  return inputs[key] === undefined ? null : requireNumber(inputs, key);
}

/** "4,4,4" → [4,4,4]; absent → null. Malformed is refused, never guessed. */
function phases(inputs: Record<string, number | string>): number[] | null {
  const v = inputs.phaseLotCounts;
  if (v === undefined) return null;
  if (typeof v !== "string" || !/^\s*\d+(\s*,\s*\d+)*\s*$/.test(v)) {
    throw new ScenarioEngineError('Scenario input "phaseLotCounts" must be lots per phase, comma-separated (e.g. "4,4,4")');
  }
  return v.split(",").map((x) => Number(x.trim()));
}

/** Every key this engine reads. Any other key is refused, never stored as an input it did not consume. */
const INPUT_KEYS: ReadonlySet<string> = new Set([
  "landCostCents",
  "lotCount",
  "grossProceedsCents",
  "absorptionLotsPerMonth",
  "wastewater",
  "phaseLotCounts",
  ...HARD_LINES,
  ...SOFT_LINES,
  "timelineP50Days",
  "timelineP90Days",
  "holdingCostMonthlyCents",
  "debtPrincipalCents",
  "debtRatePct",
  "opportunityCostPct",
]);

/** Normalise the wire inputs into the calculator's shape (shared by compute and the sensitivity route). */
export function feasibilityInputsFromWire(inputs: Record<string, number | string>): FeasibilityInputs {
  const unknown = Object.keys(inputs).filter((k) => !INPUT_KEYS.has(k));
  if (unknown.length > 0) throw new ScenarioEngineError(`Unknown input${unknown.length === 1 ? "" : "s"} for subdivision feasibility: ${unknown.join(", ")}`);
  const costs: Partial<Record<CostLineKey, number | null>> = {};
  for (const k of [...HARD_LINES, ...SOFT_LINES]) costs[k] = optionalCents(inputs, k);
  return {
    landCostCents: requireCents(inputs, "landCostCents"),
    lotCount: requireNumber(inputs, "lotCount"),
    grossProceedsCents: requireCents(inputs, "grossProceedsCents"),
    absorptionLotsPerMonth: requireNumber(inputs, "absorptionLotsPerMonth"),
    wastewater: requireOneOf(inputs, "wastewater", ["sewer", "septic"] as const),
    phaseLotCounts: phases(inputs),
    costs,
    timelineP50Days: optionalNumber(inputs, "timelineP50Days"),
    timelineP90Days: optionalNumber(inputs, "timelineP90Days"),
    holdingCostMonthlyCents: optionalCents(inputs, "holdingCostMonthlyCents"),
    debtPrincipalCents: optionalCents(inputs, "debtPrincipalCents"),
    debtRatePct: optionalNumber(inputs, "debtRatePct"),
    opportunityCostPct: optionalNumber(inputs, "opportunityCostPct"),
  };
}

export const subdivisionFeasibilityEngine: EngineSpec = {
  id: SUBDIVISION_FEASIBILITY_ENGINE_ID,
  version: FEASIBILITY_ENGINE_VERSION,
  label: "Subdivision feasibility (costs, carry over your timeline, absorption, IRR)",
  verticals: ["subdivider"],
  produces: ["gross_sellout", "project_cost_before_carry", "margin_before_carry", "profit", "margin_after_carry_p90", "margin_per_lot", "irr", "hold_months"],

  compute(inputs) {
    const inp = feasibilityInputsFromWire(inputs);
    let out;
    try {
      out = computeFeasibility(inp);
    } catch (err) {
      if (err instanceof FeasibilityInputError) throw new ScenarioEngineError(err.message);
      throw err;
    }

    const timelineStated = inp.timelineP50Days !== null || inp.timelineP90Days !== null;
    const assumptions: ScenarioAssumption[] = [
      // ── What the operator stated ──
      { key: "sales_pace", value: `${inp.absorptionLotsPerMonth} lots/month`, origin: "user", basis: "Your stated absorption pace — your market claim, not a platform forecast." },
      { key: "wastewater", value: inp.wastewater, origin: "user", basis: `Your wastewater path: the ${inp.wastewater === "sewer" ? "septic" : "sewer"} cost line is not applicable (never costed at $0).` },
      inp.phaseLotCounts
        ? { key: "phasing", value: inp.phaseLotCounts.join(", ") + " lots", origin: "user", basis: "Your phases, sold in order at the stated pace." }
        : { key: "phasing", value: "one phase", origin: "derived", basis: "No phases were entered, so the project is modelled as one phase." },
      // ── How the engine models it (its choices, not the operator's) ──
      { key: "cost_timing", value: "land, hard and soft costs at month 0", origin: "derived", basis: "Every entered cost is spent up front; the IRR is computed on that timing." },
      { key: "sale_price_model", value: "average lot price", origin: "derived", basis: "Each lot sells at gross proceeds ÷ lots; the last sales month takes the remainder." },
      { key: "phase_allocation", value: "by lot count", origin: "derived", basis: "Proceeds, costs and carry are allocated to phases by their share of the lots; phases do not change the cash flows." },
    ];
    if (timelineStated) {
      assumptions.push(
        { key: "timeline", value: `p50 ${inp.timelineP50Days ?? "not stated"} days / p90 ${inp.timelineP90Days ?? "not stated"} days`, origin: "user", basis: "Your own timeline for this parcel — not a county figure." },
        { key: "sales_start", value: "the month after entitlement", origin: "derived", basis: "Lots start selling the month after your p50 timeline ends, which the cash flows round up to whole months." },
        { key: "carry_spread", value: "even over the entitlement months", origin: "derived", basis: "Carry over the p50 timeline is spread evenly across its months; carry during sell-out is not modelled — enter it as a cost line." },
        { key: "irr_timeline", value: "p50", origin: "derived", basis: "The IRR is computed on the p50 timeline only." },
        { key: "opportunity_cost_basis", value: "land cost", origin: "derived", basis: "Opportunity cost, where a rate is entered, accrues on the land cost." },
      );
    }
    if (out.carry.refusedReason === null) {
      if (inp.debtPrincipalCents === null) {
        assumptions.push({ key: "debt_carry", value: "not entered — excluded", origin: "platform-default", basis: "No debt principal was entered, so carry includes no interest." });
      }
      if (inp.opportunityCostPct === null) {
        assumptions.push({ key: "opportunity_cost", value: "not entered — excluded", origin: "platform-default", basis: "No opportunity-cost rate was entered, so carry includes none." });
      }
    }

    // Only the keys the engine consumed (unknown keys were refused above).
    const wire: Record<string, number | string> = {};
    for (const [k, v] of Object.entries(inputs)) if (INPUT_KEYS.has(k)) wire[k] = v;

    return {
      normalisedInputs: wire,
      assumptions,
      metrics: [
        metric("gross_sellout", out.grossProceeds.cents),
        metric("project_cost_before_carry", out.totalCostBeforeCarry.cents),
        metric("margin_before_carry", out.marginBeforeCarry.cents),
        // `profit` is the margin after carry over the p50 timeline — WITHHELD
        // (null) when no timeline is stated, never the before-carry figure.
        metric("profit", out.marginAfterCarryP50.cents),
        metric("margin_after_carry_p90", out.marginAfterCarryP90.cents),
        metric("margin_per_lot", out.marginPerLotBeforeCarry.cents),
        metric("irr", out.irr.annual),
        metric("hold_months", out.holdMonthsP50),
      ],
    };
  },
};
