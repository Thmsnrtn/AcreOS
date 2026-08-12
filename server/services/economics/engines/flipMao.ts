/**
 * The fix-and-flip scenario engine — the third registered engine.
 *
 * IT DELEGATES; IT DOES NOT REIMPLEMENT. `computeMao`
 * (server/services/flipUnderwriting.ts) stays the single flip engine. This is
 * an adapter that presents its result in the shared metric vocabulary so a flip
 * forecast can be frozen into a DecisionSnapshot and graded later by an
 * Outcome. Two implementations of the same money formula is the duplication
 * canonical law 1 forbids.
 *
 * WHY computeMao AND NOT calculateFlipAnalysis
 * --------------------------------------------
 * Both exist. `calculateFlipAnalysis` is the legacy 70%-rule function and its
 * own file header warns that its numbers read HIGH by construction — it ignores
 * acquisition closing costs and carry. `computeMao` is the honest one: net
 * profit is `null` (not zero, not optimistic) whenever an input it needs is
 * absent, holding cost has no invented default, and it reports which price the
 * profit was computed against. Its null-not-zero discipline is already exactly
 * what the Scenario contract requires, which is why it maps across without a
 * translation layer that could quietly fill a gap.
 *
 * IT REUSES `profit`, `roi` AND `total_cost`
 * ------------------------------------------
 * Rather than minting flip-specific twins. Cross-strategy comparison happens
 * through normalised scenario outputs (BI92), and it dies the moment two engines
 * name the same quantity differently. Only `max_allowable_offer` and
 * `rehab_with_contingency` are genuinely flip-specific.
 */

import {
  ScenarioEngineError,
  metric,
  requireCents,
  requireNumber,
  type EngineSpec,
} from "@shared/economics/scenario";
import { computeMao, type FlipDefaults } from "../../flipUnderwriting";

/**
 * Bumped when the ADAPTER's mapping changes. The arithmetic's own version is
 * owned by flipUnderwriting; this names the presentation contract on top of it.
 */
const FLIP_MAO_ENGINE_VERSION = "flip-mao-1" as const;

export const flipMaoEngine: EngineSpec = {
  id: "flip_mao",
  version: FLIP_MAO_ENGINE_VERSION,
  label: "Fix & flip (MAO, net of closing and carry)",
  produces: [
    "max_allowable_offer",
    "rehab_with_contingency",
    "total_cost",
    "profit",
    "roi",
  ],

  compute(inputs) {
    const arvCents = requireCents(inputs, "arvCents");
    const rehabEstimateCents = requireCents(inputs, "rehabEstimateCents");
    if (arvCents <= 0) {
      throw new ScenarioEngineError("arvCents must be positive");
    }

    // Optional: omit when the operator has no price yet — computeMao then
    // computes profit AT the MAO and labels it, rather than assuming a price.
    const purchasePriceCents =
      inputs["purchasePriceCents"] === undefined
        ? null
        : requireCents(inputs, "purchasePriceCents");
    const feeCents =
      inputs["feeCents"] === undefined ? 0 : requireCents(inputs, "feeCents");

    // The operator's saved rules arrive flattened. Percentages go through
    // requireNumber, not requireCents — 7.5% is a legitimate value and money
    // fractions are not.
    const defaults: FlipDefaults = {
      maoRulePct: requireNumber(inputs, "maoRulePct"),
      rehabContingencyPct: requireNumber(inputs, "rehabContingencyPct"),
      sellingCostPct: requireNumber(inputs, "sellingCostPct"),
      purchaseClosingPct: requireNumber(inputs, "purchaseClosingPct"),
      holdMonths: requireNumber(inputs, "holdMonths"),
      monthlyHoldingCostCents: requireCents(inputs, "monthlyHoldingCostCents"),
      targetProfitPct: requireNumber(inputs, "targetProfitPct"),
    };

    const r = computeMao({
      arvCents,
      rehabEstimateCents,
      purchasePriceCents,
      feeCents,
      defaults,
    });

    return {
      normalisedInputs: {
        arvCents,
        rehabEstimateCents,
        ...(purchasePriceCents === null ? {} : { purchasePriceCents }),
        feeCents,
        maoRulePct: defaults.maoRulePct,
        rehabContingencyPct: defaults.rehabContingencyPct,
        sellingCostPct: defaults.sellingCostPct,
        purchaseClosingPct: defaults.purchaseClosingPct,
        holdMonths: defaults.holdMonths,
        monthlyHoldingCostCents: defaults.monthlyHoldingCostCents,
        targetProfitPct: defaults.targetProfitPct,
      },
      metrics: [
        metric("max_allowable_offer", r.maoCents),
        metric("rehab_with_contingency", r.rehabWithContingencyCents),
        metric("total_cost", r.totalCashInCents),
        // netProfitCents is NULL when holding cost is unknown — carried through
        // as null rather than zeroed. That is the whole reason this engine
        // wraps computeMao and not the legacy 70%-rule function.
        metric("profit", r.netProfitCents),
        // netRoiPct is a PERCENT; the `roi` metric is a RATIO. Converting here
        // rather than storing a percent under a ratio label is the difference
        // between a comparable number and a 100x error (BI182).
        metric("roi", r.netRoiPct === null ? null : r.netRoiPct / 100),
      ],
    };
  },
};
