/**
 * The note pricing engine — the note investor's registered engine: the adapter
 * over shared/calculators/notePricing.ts.
 *
 * The adapter's job is the boundary, as for every registered engine. It reads
 * the wire inputs, runs the pure engine, maps its lines onto the shared metric
 * vocabulary, and DECLARES what the operator stated and what the engine derived
 * as assumptions with their origin, so nothing an operator typed can read later
 * as a measured fact and nothing the engine worked out can read as a judgement.
 *
 * WHAT IT PREDICTS, AND WHY THESE FOUR. All four ids are already registered, so
 * nothing new enters the metric vocabulary:
 *   - `max_allowable_offer` — the max bid (the flip and wholesale engines' id
 *     for the same idea: the most you can pay and still meet your rules);
 *   - `discount_to_face`    — the max bid's discount to the unpaid balance (the
 *     id the vertical program registered for notes, 2026-10-04);
 *   - `total_cost`          — max bid + acquisition costs: what the outcome loop
 *     asks after an `acquired` answer ("what did it actually cost to acquire?");
 *   - `profit`              — scheduled net collections − total cost, IF every
 *     scheduled payment arrives; what the loop asks after a `sold` answer.
 * The last two make a decision citing this engine gradeable (a decided vertical
 * must predict `total_cost` or `profit`). The yield price, the binding
 * constraint, LTV and ITV travel as `derived` assumptions — the wholesale
 * engine's precedent for a computed breakdown — rather than as new metric ids.
 *
 * REFUSAL. The scenario contract has no "refused line": a registered engine
 * refuses by throwing ScenarioEngineError with the reason, as every other one
 * does. The max bid refusing (any price input missing, disputed or unstated, a
 * non-performing note, a stated ITV cap that cannot be applied) refuses the
 * scenario, naming every missing input. LTV and ITV are not metrics here, so a
 * refused LTV or ITV does not refuse the scenario; it is recorded as a derived
 * assumption that says it was not computed and why.
 *
 * Declares `note_investor`: a decision under that pack counts only when it
 * cites a scenario from this engine (evidence rule v2), and the kit's ownership
 * guard refuses this engine for every other pack — nothing here special-cases
 * the guard. NOTHING RECORDS A NOTE DECISION YET: the kit's stores key a
 * subject by an integer id, and every note is keyed by a uuid (see
 * docs/company/proposals/2026-11-06-b10-note-model-merge.md §B). Until that is
 * decided, this engine is reachable only through the generic, record-nothing
 * POST /api/scenarios/preview.
 */
import { ScenarioEngineError, metric, type EngineSpec, type ScenarioAssumption } from "@shared/economics/scenario";
import { NOTE_PRICING_ENGINE_ID, NOTE_PRICING_ENGINE_VERSION, priceNote, type NoteFact } from "@shared/calculators/notePricing";

const FACT_KEYS = [
  "upbCents",
  "noteRateBps",
  "paymentCents",
  "remainingTermMonths",
  "status",
  "daysDelinquent",
  "collateralValueCents",
  "lienPosition",
  "seniorLienBalanceCents",
] as const;
const STATED_KEYS = ["targetYieldBps", "servicingMonthlyCents", "acquisitionCostsCents", "maxItvBps"] as const;

export const notePricingEngine: EngineSpec = {
  id: NOTE_PRICING_ENGINE_ID,
  version: NOTE_PRICING_ENGINE_VERSION,
  label: "Note pricing (price at your target yield, max bid, discount to UPB)",
  verticals: ["note_investor"],
  produces: ["max_allowable_offer", "discount_to_face", "total_cost", "profit"],

  compute(inputs) {
    const fact = (k: (typeof FACT_KEYS)[number]): NoteFact | null => (inputs[k] === undefined ? null : { kind: "input", value: inputs[k] });
    const stated = (k: (typeof STATED_KEYS)[number]): number | null => {
      const v = inputs[k];
      if (v === undefined) return null;
      if (typeof v !== "number") throw new ScenarioEngineError(`Scenario input "${k}" must be a number`);
      return v;
    };

    const r = priceNote({
      facts: {
        upbCents: fact("upbCents"),
        noteRateBps: fact("noteRateBps"),
        paymentCents: fact("paymentCents"),
        remainingTermMonths: fact("remainingTermMonths"),
        status: fact("status"),
        daysDelinquent: fact("daysDelinquent"),
        collateralValueCents: fact("collateralValueCents"),
        lienPosition: fact("lienPosition"),
        seniorLienBalanceCents: fact("seniorLienBalanceCents"),
      },
      stated: {
        targetYieldBps: stated("targetYieldBps"),
        servicingMonthlyCents: stated("servicingMonthlyCents"),
        acquisitionCostsCents: stated("acquisitionCostsCents"),
        maxItvBps: stated("maxItvBps"),
      },
    });

    const { yieldPrice, maxBid, discountToUpb, totalCost, profitIfPerforming, ltv, itv } = r.lines;
    if (maxBid.status === "refused") {
      throw new ScenarioEngineError(`Note not priced — ${maxBid.refusals.map((x) => `${x.input}: ${x.reason}`).join("; ")}`);
    }
    // These three need nothing the max bid did not already need.
    if (yieldPrice.status !== "computed" || discountToUpb.status !== "computed" || totalCost.status !== "computed" || profitIfPerforming.status !== "computed") {
      throw new ScenarioEngineError("Note not priced — a line the max bid implies was refused");
    }

    const assumptions: ScenarioAssumption[] = [
      // The operator's judgements, labelled as theirs. The engine REQUIRES the
      // first three, so any value present was stated for this scenario.
      ...r.stated
        .filter((x) => x.value !== null)
        .map((x): ScenarioAssumption => ({
          key: x.key,
          value: x.value as number,
          unit: x.key.endsWith("Bps") ? "bps" : "cents",
          origin: "user",
          basis: `${x.label}: ${x.note}`,
        })),
      { key: "yield_price", value: yieldPrice.value, unit: "cents", origin: "derived", basis: yieldPrice.basis },
      { key: "binding_constraint", value: maxBid.binding, origin: "derived", basis: maxBid.basis },
      ltv.status === "computed"
        ? { key: "ltv", value: ltv.value, unit: "ratio", origin: "derived", basis: ltv.basis }
        : { key: "ltv", value: "not computed", origin: "derived", basis: ltv.refusals.map((x) => `${x.input}: ${x.reason}`).join("; ") },
      itv.status === "computed"
        ? { key: "itv", value: itv.value, unit: "ratio", origin: "derived", basis: itv.basis }
        : { key: "itv", value: "not computed", origin: "derived", basis: itv.refusals.map((x) => `${x.input}: ${x.reason}`).join("; ") },
      { key: "performance", value: "every scheduled payment arrives", origin: "derived", basis: r.assumptions.join(" ") },
    ];

    const normalisedInputs: Record<string, number | string> = {};
    for (const k of [...FACT_KEYS, ...STATED_KEYS]) if (inputs[k] !== undefined) normalisedInputs[k] = inputs[k];

    return {
      normalisedInputs,
      assumptions,
      metrics: [
        metric("max_allowable_offer", maxBid.value),
        metric("discount_to_face", discountToUpb.value),
        metric("total_cost", totalCost.value),
        metric("profit", profitIfPerforming.value),
      ],
    };
  },
};
