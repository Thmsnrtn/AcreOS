/**
 * The wholesale assignment engine, pinned by hand-computed figures.
 *
 * Golden case: ARV $250,000, buyer's rule 70%, buyer's repairs $40,000,
 * contract price $120,000, marketing $2,500, closing $1,000, earnest money $1,000.
 *   buyer's max price = 250,000 × 0.70 − 40,000       = $135,000
 *   assignment fee    = 135,000 − 120,000              = $15,000
 *   total cost        = 2,500 + 1,000                  = $3,500   (EMD NOT included)
 *   profit            = 15,000 − 3,500                 = $11,500
 *   ROI               = 11,500 / 3,500                 = 3.285714… (ratio; 328.6%)
 *   EMD at risk       = $1,000
 *
 * Rounding case: ARV $123,457.89 at 65% = 8,024,762.85¢ → 8,024,763¢, less
 * $10,000 repairs = 7,024,763¢ ($70,247.63) — the computeMao convention of
 * rounding ARV × rule to the cent before subtracting repairs.
 *
 * Contract too high: contract $140,000 against a $135,000 buyer's max.
 *   fee    = 135,000 − 140,000 = −$5,000 (an answer, not an error)
 *   profit = −5,000 − 3,500    = −$8,500
 *   ROI    = −8,500 / 3,500    = −2.428571…
 */
import { describe, expect, it } from "vitest";
import {
  computeWholesaleAssignment,
  WholesaleAssignmentInputError,
  type WholesaleAssignmentInputs,
} from "../../shared/calculators/wholesaleAssignment";
import { wholesaleAssignmentEngine } from "../../server/services/economics/engines/wholesaleAssignment";
import { computeScenario, METRICS, ScenarioEngineError, type EngineSpec } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { WHOLESALE_ASSIGNMENT_FIELDS } from "../../shared/economics/fields/wholesaleAssignment";


// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine that is not in it cannot
// underwrite anything in production.
const ENGINES: readonly EngineSpec[] = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === "wholesale_assignment")).toEqual([wholesaleAssignmentEngine]);
});

const golden: WholesaleAssignmentInputs = {
  arvCents: 25_000_000,
  buyerRulePct: 70,
  buyerRepairEstimateCents: 4_000_000,
  contractPriceCents: 12_000_000,
  marketingCostCents: 250_000,
  closingCostsCents: 100_000,
  earnestMoneyCents: 100_000,
};

describe("computeWholesaleAssignment — golden case", () => {
  const o = computeWholesaleAssignment(golden);
  it("the buyer's max price is ARV × rule − the buyer's repairs", () => {
    expect(o.buyerMaxPriceCents).toBe(13_500_000);
  });
  it("the fee is what the buyer pays over your contract", () => {
    expect(o.assignmentFeeCents).toBe(1_500_000);
  });
  it("total cost is marketing + closing, never earnest money", () => {
    expect(o.totalCostCents).toBe(350_000);
    expect(o.earnestMoneyAtRiskCents).toBe(100_000);
  });
  it("profit and ROI", () => {
    expect(o.profitCents).toBe(1_150_000);
    expect(o.roi).toBeCloseTo(3.2857142857, 8);
  });
});

describe("computeWholesaleAssignment — the honest edges", () => {
  it("rounds ARV × rule to the cent before subtracting repairs", () => {
    const o = computeWholesaleAssignment({ ...golden, arvCents: 12_345_789, buyerRulePct: 65, buyerRepairEstimateCents: 1_000_000 });
    expect(o.buyerMaxPriceCents).toBe(7_024_763);
  });
  it("a contract above the buyer's max is a negative fee — an answer, not an error", () => {
    const o = computeWholesaleAssignment({ ...golden, contractPriceCents: 14_000_000 });
    expect(o.assignmentFeeCents).toBe(-500_000);
    expect(o.profitCents).toBe(-850_000);
    expect(o.roi).toBeCloseTo(-2.4285714286, 8);
  });
  it("repairs beyond the buyer's rule give a negative buyer's max, returned as is", () => {
    const o = computeWholesaleAssignment({ ...golden, buyerRepairEstimateCents: 20_000_000 });
    expect(o.buyerMaxPriceCents).toBe(-2_500_000);
    expect(o.assignmentFeeCents).toBe(-14_500_000);
  });
  it("no costs entered: total cost 0, profit is the fee, ROI undefined (not a number)", () => {
    const o = computeWholesaleAssignment({ ...golden, marketingCostCents: null, closingCostsCents: null });
    expect(o.totalCostCents).toBe(0);
    expect(o.profitCents).toBe(1_500_000);
    expect(o.roi).toBeNull();
  });
  it("earnest money never moves total cost or profit", () => {
    const without = computeWholesaleAssignment({ ...golden, earnestMoneyCents: null });
    const withEmd = computeWholesaleAssignment({ ...golden, earnestMoneyCents: 5_000_000 });
    expect(withEmd.totalCostCents).toBe(without.totalCostCents);
    expect(withEmd.profitCents).toBe(without.profitCents);
    expect(without.earnestMoneyAtRiskCents).toBeNull();
  });
  it("the buyer's rule must be 0–100; both ends are accepted", () => {
    expect(() => computeWholesaleAssignment({ ...golden, buyerRulePct: -1 })).toThrow(/buyerRulePct/);
    expect(() => computeWholesaleAssignment({ ...golden, buyerRulePct: 100.5 })).toThrow(/buyerRulePct/);
    expect(computeWholesaleAssignment({ ...golden, buyerRulePct: 0 }).buyerMaxPriceCents).toBe(-4_000_000);
    expect(computeWholesaleAssignment({ ...golden, buyerRulePct: 100 }).buyerMaxPriceCents).toBe(21_000_000);
  });
  it("ARV and contract price must be positive", () => {
    expect(() => computeWholesaleAssignment({ ...golden, arvCents: 0 })).toThrow(/After-repair value/);
    expect(() => computeWholesaleAssignment({ ...golden, arvCents: -1 })).toThrow(/After-repair value/);
    expect(() => computeWholesaleAssignment({ ...golden, contractPriceCents: 0 })).toThrow(/Contract price/);
  });
  it("negative costs are refused — a typo would flatter the fee or the profit", () => {
    expect(() => computeWholesaleAssignment({ ...golden, buyerRepairEstimateCents: -1 })).toThrow(/buyerRepairEstimateCents/);
    expect(() => computeWholesaleAssignment({ ...golden, marketingCostCents: -1 })).toThrow(/marketingCostCents/);
    expect(() => computeWholesaleAssignment({ ...golden, closingCostsCents: -1 })).toThrow(/closingCostsCents/);
    expect(() => computeWholesaleAssignment({ ...golden, earnestMoneyCents: -1 })).toThrow(/earnestMoneyCents/);
  });
  it("earnest money above the contract price is refused; equal is accepted", () => {
    expect(() => computeWholesaleAssignment({ ...golden, earnestMoneyCents: 12_000_001 })).toThrow(WholesaleAssignmentInputError);
    expect(computeWholesaleAssignment({ ...golden, earnestMoneyCents: 12_000_000 }).earnestMoneyAtRiskCents).toBe(12_000_000);
  });
  it("zero repairs is accepted (a buyer who budgets none)", () => {
    expect(computeWholesaleAssignment({ ...golden, buyerRepairEstimateCents: 0 }).buyerMaxPriceCents).toBe(17_500_000);
  });
});

describe("the registered engine", () => {
  const wire = {
    arvCents: 25_000_000,
    buyerRulePct: 70,
    buyerRepairEstimateCents: 4_000_000,
    contractPriceCents: 12_000_000,
  };
  const run = (inputs: Record<string, number | string>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "wholesale_assignment", inputs }, ENGINES);

  it("is the only engine declaring residential_wholesaler, and declares only that", () => {
    expect(wholesaleAssignmentEngine.verticals).toEqual(["residential_wholesaler"]);
    expect(wholesaleAssignmentEngine.version).toBe("wholesale-assignment-1");
    const declaring = ENGINES.filter((e) => (e.verticals ?? []).includes("residential_wholesaler"));
    expect(declaring).toEqual([wholesaleAssignmentEngine]);
  });

  it("emits every metric it declares, each registered, and predicts total_cost and profit", () => {
    const body = run({ ...wire, marketingCostCents: 250_000, closingCostsCents: 100_000 });
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...wholesaleAssignmentEngine.produces].sort());
    for (const id of wholesaleAssignmentEngine.produces) expect(METRICS.some((m) => m.id === id)).toBe(true);
    const v = (id: string) => body.metrics.find((m) => m.id === id);
    expect(v("buyer_max_price")).toEqual({ id: "buyer_max_price", value: 13_500_000, unit: "cents" });
    // Never under the flip "MAO" label — that means the most YOU offer the seller.
    expect(v("max_allowable_offer")).toBeUndefined();
    expect(v("assignment_fee")).toEqual({ id: "assignment_fee", value: 1_500_000, unit: "cents" });
    expect(v("total_cost")).toEqual({ id: "total_cost", value: 350_000, unit: "cents" });
    expect(v("profit")).toEqual({ id: "profit", value: 1_150_000, unit: "cents" });
    // roi is a RATIO (fraction), not a percent: 3.2857, never 328.57.
    expect(v("roi")?.unit).toBe("ratio");
    expect(v("roi")?.value).toBeCloseTo(3.2857142857, 8);
  });

  it("declares each omitted cost as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["closing_costs", "marketing_cost"]);
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("marketingCostCents");
    expect(body.inputs).not.toHaveProperty("closingCostsCents");
    expect(body.metrics.find((m) => m.id === "roi")?.value).toBeNull();
  });

  it("an explicit $0 cost is the operator's answer, not a default to declare", () => {
    const body = run({ ...wire, marketingCostCents: 0, closingCostsCents: 0 });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toMatchObject({ marketingCostCents: 0, closingCostsCents: 0 });
  });

  it("earnest money is shown as the operator's own figure at risk, and stays out of total cost", () => {
    const body = run({ ...wire, marketingCostCents: 250_000, closingCostsCents: 100_000, earnestMoneyCents: 100_050 });
    const emd = body.assumptions.find((a) => a.key === "earnest_money_at_risk");
    expect(emd).toMatchObject({ origin: "user", value: "$1,000.50 at risk" });
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(350_000);
    expect(body.assumptions.filter((a) => a.origin === "platform-default")).toEqual([]);
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, buyerRulePct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, marketingCostCents: -5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, arvCents: 1.5 })).toThrow(/integer/);
    const { buyerRulePct: _omit, ...noRule } = wire;
    expect(() => run(noRule)).toThrow(/buyerRulePct/);
  });

  it("the form asks for every input the engine reads, optional exactly where the engine allows absence", () => {
    const required = WHOLESALE_ASSIGNMENT_FIELDS.filter((f) => !f.optional).map((f) => f.key).sort();
    const optional = WHOLESALE_ASSIGNMENT_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(required).toEqual(["arvCents", "buyerRepairEstimateCents", "buyerRulePct", "contractPriceCents"]);
    expect(optional).toEqual(["closingCostsCents", "earnestMoneyCents", "marketingCostCents"]);
    // The required set alone computes.
    expect(() => run(wire)).not.toThrow();
  });
});
