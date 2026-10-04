/**
 * The agent-investor flip engine, pinned by hand-computed figures.
 *
 * Golden case: $300,000 price, 3% buy-side commission with a 30% brokerage
 * split, $4,500 purchase closing, $40,000 rehab, 6 months held at $1,500/mo,
 * $425,000 sale, 3% own listing commission with a 30% brokerage split, 2.5%
 * co-op to the buyer's agent, 1.5% sale closing costs.
 *   buy-side commission  = 300,000 × 3%                    = $9,000
 *   buy-side credit      = 9,000 × (1 − 30%)               = $6,300
 *   holding              = 1,500 × 6                       = $9,000
 *   total cost           = 300,000 + 4,500 + 40,000 + 9,000
 *                          − 6,300                         = $347,200
 *   co-op                = 425,000 × 2.5%                  = $10,625
 *   listing commission   = 425,000 × 3%                    = $12,750
 *   brokerage's cut      = 12,750 × 30%                    = $3,825
 *   sale closing         = 425,000 × 1.5%                  = $6,375
 *   sale costs           = 10,625 + 3,825 + 6,375          = $20,825
 *   net proceeds         = 425,000 − 20,825                = $404,175
 *   profit               = 404,175 − 347,200               = $56,975
 *   ROI                  = 56,975 / 347,200                ≈ 0.1640985
 *   annualised (simple)  = 0.1640985 × 12 / 6              ≈ 0.3281970
 *   hold                 = 6 months
 *
 * The same deal for a buyer who is not an agent (no buy-side commission, and
 * the full $12,750 listing commission paid to someone else) profits
 * 56,975 − 6,300 − (12,750 − 3,825) = $41,750. The difference is exactly the
 * two commission treatments, and the test below proves it.
 */
import { describe, expect, it } from "vitest";
import {
  buySideCreditCents,
  computeAgentFlip,
  type AgentFlipInputs,
} from "../../shared/calculators/agentFlip";
import { agentFlipEngine } from "../../server/services/economics/engines/agentFlip";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { AGENT_FLIP_FIELDS } from "../../shared/economics/fields/agentFlip";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === agentFlipEngine.id)).toEqual([agentFlipEngine]);
});

const golden: AgentFlipInputs = {
  purchasePriceCents: 30_000_000,
  buySideCommissionPct: 3,
  buySideBrokerageSplitPct: 30,
  purchaseClosingCostsCents: 450_000,
  rehabCents: 4_000_000,
  holdMonths: 6,
  monthlyHoldingCostCents: 150_000,
  salePriceCents: 42_500_000,
  listingCommissionPct: 3,
  listingBrokerageSplitPct: 30,
  coopCommissionPct: 2.5,
  saleClosingCostsPct: 1.5,
};

describe("computeAgentFlip — golden case", () => {
  const o = computeAgentFlip(golden);
  it("the buy-side commission, net of the brokerage split, is credited", () => {
    expect(o.buySideCreditCents).toBe(630_000);
    expect(buySideCreditCents(30_000_000, 3, 30)).toBe(630_000);
  });
  it("total cost", () => {
    expect(o.holdingCostCents).toBe(900_000);
    expect(o.totalCostCents).toBe(34_720_000);
  });
  it("sale costs: co-op in full, only the brokerage's cut of the own listing", () => {
    expect(o.coopCommissionCents).toBe(1_062_500);
    expect(o.listingSplitCostCents).toBe(382_500);
    expect(o.saleClosingCostsCents).toBe(637_500);
    expect(o.saleCostsCents).toBe(2_082_500);
  });
  it("net proceeds and profit", () => {
    expect(o.netProceedsCents).toBe(40_417_500);
    expect(o.profitCents).toBe(5_697_500);
  });
  it("returns", () => {
    expect(o.roi).toBeCloseTo(0.1640985, 7);
    expect(o.annualizedReturn).toBeCloseTo(0.328197, 6);
    expect(o.holdMonths).toBe(6);
  });
  it("as a non-agent buyer (no buy-side commission, full listing paid out) the profit is $41,750", () => {
    const outsider = computeAgentFlip({ ...golden, buySideCommissionPct: 0, listingBrokerageSplitPct: 100 });
    expect(outsider.buySideCreditCents).toBe(0);
    expect(outsider.listingSplitCostCents).toBe(1_275_000);
    expect(outsider.profitCents).toBe(4_175_000);
  });
});

describe("computeAgentFlip — the honest edges", () => {
  it("omitted closing, rehab and holding cost are excluded", () => {
    const o = computeAgentFlip({ ...golden, purchaseClosingCostsCents: null, rehabCents: null, monthlyHoldingCostCents: null });
    expect(o.holdingCostCents).toBe(0);
    expect(o.totalCostCents).toBe(30_000_000 - 630_000);
  });
  it("a 0% split keeps the whole buy-side commission and costs nothing on the listing", () => {
    const o = computeAgentFlip({ ...golden, buySideBrokerageSplitPct: 0, listingBrokerageSplitPct: 0 });
    expect(o.buySideCreditCents).toBe(900_000);
    expect(o.listingSplitCostCents).toBe(0);
  });
  it("a 0% listing commission is a real answer: no listing cost", () => {
    expect(computeAgentFlip({ ...golden, listingCommissionPct: 0 }).listingSplitCostCents).toBe(0);
  });
  it("a losing deal reports a negative profit and ROI, not a floor at zero", () => {
    const o = computeAgentFlip({ ...golden, salePriceCents: 30_000_000 });
    expect(o.profitCents).toBeLessThan(0);
    expect(o.roi).toBeLessThan(0);
  });
  it("prices must be positive", () => {
    expect(() => computeAgentFlip({ ...golden, purchasePriceCents: 0 })).toThrow(/Purchase price/);
    expect(() => computeAgentFlip({ ...golden, salePriceCents: 0 })).toThrow(/sale price/);
    expect(() => computeAgentFlip({ ...golden, salePriceCents: -1 })).toThrow(/sale price/);
  });
  it("negative costs are refused — a typo would move every return", () => {
    for (const k of ["purchaseClosingCostsCents", "rehabCents", "monthlyHoldingCostCents"] as const) {
      expect(() => computeAgentFlip({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
    }
  });
  it("commission rates outside 0–10 are refused", () => {
    for (const k of ["buySideCommissionPct", "listingCommissionPct", "coopCommissionPct"] as const) {
      expect(() => computeAgentFlip({ ...golden, [k]: -0.5 })).toThrow(new RegExp(k));
      expect(() => computeAgentFlip({ ...golden, [k]: 10.5 })).toThrow(new RegExp(k));
    }
  });
  it("brokerage splits outside 0–100 are refused", () => {
    for (const k of ["buySideBrokerageSplitPct", "listingBrokerageSplitPct"] as const) {
      expect(() => computeAgentFlip({ ...golden, [k]: -1 })).toThrow(new RegExp(k));
      expect(() => computeAgentFlip({ ...golden, [k]: 101 })).toThrow(new RegExp(k));
    }
  });
  it("sale closing costs outside 0–20% are refused", () => {
    expect(() => computeAgentFlip({ ...golden, saleClosingCostsPct: -1 })).toThrow(/saleClosingCostsPct/);
    expect(() => computeAgentFlip({ ...golden, saleClosingCostsPct: 21 })).toThrow(/saleClosingCostsPct/);
  });
  it("the holding period is a whole number of months, 1 to 60", () => {
    expect(() => computeAgentFlip({ ...golden, holdMonths: 0 })).toThrow(/Holding period/);
    expect(() => computeAgentFlip({ ...golden, holdMonths: 61 })).toThrow(/Holding period/);
    expect(() => computeAgentFlip({ ...golden, holdMonths: 4.5 })).toThrow(/Holding period/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() =>
      computeAgentFlip({
        ...golden,
        buySideCommissionPct: 10,
        listingCommissionPct: 10,
        coopCommissionPct: 10,
        buySideBrokerageSplitPct: 100,
        listingBrokerageSplitPct: 100,
        saleClosingCostsPct: 20,
        holdMonths: 60,
      }),
    ).not.toThrow();
    expect(() =>
      computeAgentFlip({
        ...golden,
        buySideCommissionPct: 0,
        listingCommissionPct: 0,
        coopCommissionPct: 0,
        buySideBrokerageSplitPct: 0,
        listingBrokerageSplitPct: 0,
        saleClosingCostsPct: 0,
        holdMonths: 1,
        purchaseClosingCostsCents: 0,
        rehabCents: 0,
        monthlyHoldingCostCents: 0,
      }),
    ).not.toThrow();
  });
});

describe("the registered engine", () => {
  const wire = {
    purchasePriceCents: 30_000_000,
    buySideCommissionPct: 3,
    buySideBrokerageSplitPct: 30,
    holdMonths: 6,
    salePriceCents: 42_500_000,
    listingCommissionPct: 3,
    listingBrokerageSplitPct: 30,
    coopCommissionPct: 2.5,
    saleClosingCostsPct: 1.5,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "agent_flip", inputs }, ENGINES);

  it("declares agent_investor, under its own id and version", () => {
    expect(agentFlipEngine.id).toBe("agent_flip");
    expect(agentFlipEngine.version).toBe("agent-flip-1");
    expect(agentFlipEngine.verticals).toEqual(["agent_investor"]);
  });

  it("no other engine claims the agent_investor vertical", () => {
    expect(ENGINES.filter((e) => (e.verticals ?? []).includes("agent_investor")).map((e) => e.id)).toEqual(["agent_flip"]);
  });

  it("emits every metric it declares, and predicts total_cost and profit so an outcome can grade it", () => {
    const body = run(golden as unknown as Record<string, number>);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...agentFlipEngine.produces].sort());
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(34_720_000);
    expect(body.metrics.find((m) => m.id === "profit")?.value).toBe(5_697_500);
    expect(body.metrics.find((m) => m.id === "net_proceeds")?.value).toBe(40_417_500);
    expect(body.metrics.find((m) => m.id === "hold_months")?.value).toBe(6);
    expect(body.metrics.find((m) => m.id === "roi")?.value).toBeCloseTo(0.1640985, 7);
    expect(body.metrics.find((m) => m.id === "annualized_return")?.value).toBeCloseTo(0.328197, 6);
  });

  it("every metric carries its registered unit — returns are ratios, the hold is months", () => {
    const body = run(golden as unknown as Record<string, number>);
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    expect(body.metrics.find((m) => m.id === "roi")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "annualized_return")?.unit).toBe("ratio");
    expect(body.metrics.find((m) => m.id === "hold_months")?.unit).toBe("months");
    expect(body.metrics.find((m) => m.id === "profit")?.unit).toBe("cents");
  });

  it("declares each omission as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key).sort()).toEqual(["holding_cost", "purchase_closing_costs", "rehab"].sort());
    expect(body.assumptions.every((a) => a.origin === "platform-default")).toBe(true);
    expect(body.inputs).not.toHaveProperty("purchaseClosingCostsCents");
    expect(body.inputs).not.toHaveProperty("rehabCents");
    expect(body.inputs).not.toHaveProperty("monthlyHoldingCostCents");
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(30_000_000 - 630_000);
  });

  it("a fully answered form declares nothing", () => {
    expect(run(golden as unknown as Record<string, number>).assumptions).toEqual([]);
  });

  it("zero commissions and splits are the operator's answers, so nothing is declared for them", () => {
    const body = run({
      ...(golden as unknown as Record<string, number>),
      listingCommissionPct: 0,
      buySideBrokerageSplitPct: 0,
      listingBrokerageSplitPct: 0,
      coopCommissionPct: 0,
    });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toHaveProperty("listingCommissionPct", 0);
  });

  it("an extra input the engine does not read is not recorded as one", () => {
    const body = run({ ...wire, arvCents: 1 });
    expect(body.inputs).not.toHaveProperty("arvCents");
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, buySideCommissionPct: 12 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, holdMonths: 2.5 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, purchasePriceCents: 1.5 })).toThrow(/integer/);
    const { coopCommissionPct: _c, ...noCoop } = wire;
    expect(() => run(noCoop)).toThrow(/coopCommissionPct/);
    const { listingCommissionPct: _l, ...noListing } = wire;
    expect(() => run(noListing)).toThrow(/listingCommissionPct/);
  });
});

describe("the form", () => {
  it("names exactly the inputs the engine reads, with the optional ones optional", () => {
    const keys = AGENT_FLIP_FIELDS.map((f) => f.key).sort();
    expect(keys).toEqual(Object.keys(golden).sort());
    const optional = AGENT_FLIP_FIELDS.filter((f) => f.optional).map((f) => f.key).sort();
    expect(optional).toEqual(["monthlyHoldingCostCents", "purchaseClosingCostsCents", "rehabCents"].sort());
  });

  it("the form's bounds match the calculator's", () => {
    const f = Object.fromEntries(AGENT_FLIP_FIELDS.map((x) => [x.key, x]));
    expect([f.buySideCommissionPct.max, f.listingCommissionPct.max, f.coopCommissionPct.max]).toEqual([10, 10, 10]);
    expect([f.buySideBrokerageSplitPct.max, f.listingBrokerageSplitPct.max]).toEqual([100, 100]);
    expect(f.saleClosingCostsPct.max).toBe(20);
    expect([f.holdMonths.min, f.holdMonths.max, f.holdMonths.unit]).toEqual([1, 60, "months"]);
  });
});
