/**
 * The agent own-book valuation engine (`agent_own_book_valuation`) — Step-0
 * gap sheet agent_investor.md, work item 5 (engine half).
 *
 * FALSIFYING: on pre-build main this file fails to import (the engine does
 * not exist), no engine declares `agent_investor`, and the kit's ownership
 * guard refuses every agent_investor decision.
 *
 * Proves:
 *   - the hand-computed golden case: comp median + provided AVM reconcile to
 *     the estimate, the range spans exactly the figures provided, the max
 *     allowable offer takes the operator's margin / rehab / closing off the
 *     estimate, and `profit` is the expected own-book profit at the ask;
 *   - the comps-only and AVM-only paths (AVM-only states no invented range);
 *   - every input's origin is frozen into the scenario assumptions, and the
 *     output is classified an estimate;
 *   - EVERY refusal leg: no evidence at all, a comp counted but its price
 *     not provided, a non-positive comp price, no offer context, and the
 *     range checks on margin / AVM / asking;
 *   - the engine is registered properly: in ALL_ENGINES, declaring only
 *     agent_investor, predicting `profit` (gradeable), and previewing
 *     through the same kit path a recorded decision uses;
 *   - determinism: the same inputs produce the same scenario body.
 */
import { describe, expect, it } from "vitest";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { agentOwnBookValuationEngine } from "../../server/services/economics/engines/agentOwnBookValuation";
import { previewUnderwriting } from "../../server/services/underwriting/verticalDecision";

const ENGINE = "agent_own_book_valuation";

/** Golden case, hand-computed in the header of the engine's test plan. */
const golden = {
  compCount: 3,
  comp1SalePriceCents: 28_000_000, // $280,000
  comp2SalePriceCents: 30_000_000, // $300,000
  comp3SalePriceCents: 32_000_000, // $320,000
  avmValueCents: 31_000_000, // $310,000
  askingPriceCents: 27_000_000, // $270,000
  targetMarginPct: 10,
  rehabEstimateCents: 1_500_000, // $15,000
  closingCostCents: 500_000, // $5,000
};

const run = (inputs: Record<string, number | string>) =>
  computeScenario({ subjectType: "property", subjectId: 1, label: "t", engineId: ENGINE, inputs }, ALL_ENGINES);

const metricOf = (inputs: Record<string, number | string>, id: string) =>
  run(inputs).metrics.find((m) => m.id === id)?.value;

describe("the golden case — comps and AVM together", () => {
  it("reconciles the comp median and the AVM into the estimate", () => {
    // comp median $300,000; AVM $310,000; estimate = average = $305,000
    expect(metricOf(golden, "estimated_value")).toBe(30_500_000);
  });

  it("the range spans exactly the figures provided — nothing invented", () => {
    expect(metricOf(golden, "estimated_value_low")).toBe(28_000_000);
    expect(metricOf(golden, "estimated_value_high")).toBe(32_000_000);
  });

  it("max allowable offer = estimate less margin, rehab and closing", () => {
    // $305,000 × 90% = $274,500; − $15,000 − $5,000 = $254,500
    expect(metricOf(golden, "max_allowable_offer")).toBe(25_450_000);
  });

  it("profit = estimate − asking − rehab − closing at the ask", () => {
    // $305,000 − $270,000 − $15,000 − $5,000 = $15,000
    expect(metricOf(golden, "profit")).toBe(1_500_000);
  });

  it("is deterministic — the same inputs give the same body", () => {
    expect(run(golden)).toEqual(run(golden));
  });
});

describe("single-evidence paths", () => {
  const compsOnly = { ...golden } as Record<string, number>;
  delete compsOnly.avmValueCents;

  it("comps only: the estimate is the comp median", () => {
    expect(metricOf(compsOnly, "estimated_value")).toBe(30_000_000);
    expect(metricOf(compsOnly, "estimated_value_low")).toBe(28_000_000);
    expect(metricOf(compsOnly, "estimated_value_high")).toBe(32_000_000);
    // $300,000 × 90% − $20,000 = $250,000; profit $300k − $270k − $20k = $10,000
    expect(metricOf(compsOnly, "max_allowable_offer")).toBe(25_000_000);
    expect(metricOf(compsOnly, "profit")).toBe(1_000_000);
  });

  it("an even comp count medians the middle pair", () => {
    const two = { ...compsOnly, compCount: 2 };
    delete (two as Record<string, number>).comp3SalePriceCents;
    expect(metricOf(two, "estimated_value")).toBe(29_000_000);
  });

  const avmOnly = { ...golden, compCount: 0 } as Record<string, number>;
  delete avmOnly.comp1SalePriceCents;
  delete avmOnly.comp2SalePriceCents;
  delete avmOnly.comp3SalePriceCents;

  it("AVM only: the estimate is the AVM value and the range invents no spread", () => {
    expect(metricOf(avmOnly, "estimated_value")).toBe(31_000_000);
    expect(metricOf(avmOnly, "estimated_value_low")).toBe(31_000_000);
    expect(metricOf(avmOnly, "estimated_value_high")).toBe(31_000_000);
    // $310,000 × 90% − $20,000 = $259,000; profit $310k − $270k − $20k = $20,000
    expect(metricOf(avmOnly, "max_allowable_offer")).toBe(25_900_000);
    expect(metricOf(avmOnly, "profit")).toBe(2_000_000);
  });
});

describe("origins and the estimate label", () => {
  it("freezes every provided input's origin into the assumptions", () => {
    const body = run(golden);
    const a = Object.fromEntries(body.assumptions.map((x) => [x.key, x]));
    expect(a.comp_1_sale_price).toMatchObject({ value: 28_000_000, origin: "user" });
    expect(a.comp_3_sale_price).toMatchObject({ value: 32_000_000, origin: "user" });
    expect(a.avm_value).toMatchObject({ value: 31_000_000, origin: "user" });
    expect(a.asking_price).toMatchObject({ value: 27_000_000, origin: "user" });
    expect(a.target_margin).toMatchObject({ value: 10, origin: "user" });
    expect(a.value_estimate).toMatchObject({ value: 30_500_000, origin: "derived" });
  });

  it("classifies the output as an estimate, in the label and the record", () => {
    const body = run(golden);
    const cls = body.assumptions.find((x) => x.key === "valuation_classification");
    expect(cls?.value).toBe("estimate");
    expect(agentOwnBookValuationEngine.label.toLowerCase()).toContain("estimate");
  });

  it("records an absent rehab / closing figure as an absence, not a zero estimate", () => {
    const bare = { ...golden } as Record<string, number>;
    delete bare.rehabEstimateCents;
    delete bare.closingCostCents;
    const keys = run(bare).assumptions.map((x) => x.key);
    expect(keys).toContain("rehab_estimate");
    expect(keys).toContain("closing_costs");
    // No deductions: MAO = $274,500; profit = $305k − $270k = $35,000
    expect(metricOf(bare, "max_allowable_offer")).toBe(27_450_000);
    expect(metricOf(bare, "profit")).toBe(3_500_000);
  });

  it("persists only the inputs the engine consumed", () => {
    const body = run({ ...golden, unrelatedCents: 999 });
    expect(body.inputs).not.toHaveProperty("unrelatedCents");
    expect(body.inputs.compCount).toBe(3);
    expect(body.inputs.avmValueCents).toBe(31_000_000);
  });
});

describe("refusals — refuse, never fabricate", () => {
  it("refuses when neither comps nor an AVM are provided", () => {
    const bare = { ...golden } as Record<string, number>;
    delete bare.avmValueCents;
    bare.compCount = 0;
    delete bare.comp1SalePriceCents;
    delete bare.comp2SalePriceCents;
    delete bare.comp3SalePriceCents;
    expect(() => run(bare)).toThrow(ScenarioEngineError);
    expect(() => run(bare)).toThrow(/No valuation evidence/);
  });

  it("refuses when compCount is absent and no AVM is provided", () => {
    const { compCount: _c, avmValueCents: _a, ...rest } = golden;
    expect(() => run(rest)).toThrow(/No valuation evidence/);
  });

  it("refuses when a counted comp has no sale price, naming the input", () => {
    const missing = { ...golden } as Record<string, number>;
    delete missing.comp2SalePriceCents;
    expect(() => run(missing)).toThrow(/comp2SalePriceCents/);
  });

  it("refuses a non-positive comp price", () => {
    expect(() => run({ ...golden, comp1SalePriceCents: 0 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...golden, comp1SalePriceCents: -100 })).toThrow(ScenarioEngineError);
  });

  it("refuses fractional-cent comp prices", () => {
    expect(() => run({ ...golden, comp1SalePriceCents: 100.5 })).toThrow(ScenarioEngineError);
  });

  it("refuses when the offer context is absent, naming it", () => {
    const { askingPriceCents: _a, ...rest } = golden;
    expect(() => run(rest)).toThrow(/askingPriceCents/);
  });

  it("refuses a non-positive asking price, AVM or an out-of-range margin", () => {
    for (const bad of [
      { askingPriceCents: 0 },
      { avmValueCents: 0 },
      { avmValueCents: -1 },
      { targetMarginPct: 100 },
      { targetMarginPct: -1 },
      { rehabEstimateCents: -1 },
      { closingCostCents: -1 },
      { compCount: 11 },
      { compCount: 2.5 },
    ]) {
      expect(() => run({ ...golden, ...bad }), JSON.stringify(bad)).toThrow(ScenarioEngineError);
    }
  });

  it("refuses when the target margin is missing — no platform margin is substituted", () => {
    const { targetMarginPct: _m, ...rest } = golden;
    expect(() => run(rest)).toThrow(/targetMarginPct/);
  });
});

describe("registered properly — the kit's ownership guard is not special-cased", () => {
  it("is in ALL_ENGINES, declares only agent_investor, and predicts profit", () => {
    expect(engineById(ENGINE, ALL_ENGINES)).toBe(agentOwnBookValuationEngine);
    expect(agentOwnBookValuationEngine.verticals).toEqual(["agent_investor"]);
    expect(agentOwnBookValuationEngine.produces).toContain("profit");
    expect(agentOwnBookValuationEngine.produces).toContain("max_allowable_offer");
  });

  it("previews through the same kit path the recorded decision uses", () => {
    const p = previewUnderwriting(ENGINE, golden);
    expect(p.metrics.find((m) => m.id === "estimated_value")?.value).toBe(30_500_000);
    expect(p.metrics.find((m) => m.id === "profit")?.value).toBe(1_500_000);
  });
});
