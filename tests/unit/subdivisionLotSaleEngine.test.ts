/**
 * The subdivision lot-sale engine, pinned by hand-computed figures.
 *
 * Golden case: four lots locked at $85,000, $52,000, $95,000 and $60,000 (the
 * corner lot, the interior lot, the cul-de-sac lot and one more), 8% selling
 * cost, an 18-month sell-out, a $120,000 parent basis, $6,500 survey, $4,000
 * plat, $2,500 permits, $35,000 improvements, $450/month carry.
 *   gross sell-out    = 85,000 + 52,000 + 95,000 + 60,000      = $292,000
 *   selling costs     = 292,000 × 8%                           = $23,360
 *   net proceeds      = 292,000 − 23,360                       = $268,640
 *   subdivision costs = 6,500 + 4,000 + 2,500 + 35,000         = $48,000
 *   carry             = 450 × 18                               = $8,100
 *   total cost        = 120,000 + 48,000 + 8,100               = $176,100
 *   profit            = 268,640 − 176,100                      = $92,540
 *   ROI               = 92,540 / 176,100                       ≈ 0.525497 (52.55%)
 *   hold              = 18 months
 *
 * Rounding case: one lot at $33,333.33 with a 6.5% selling cost.
 *   selling costs     = 3,333,333¢ × 6.5% = 216,666.645¢        → 216,667¢ ($2,166.67)
 *   net proceeds      = 3,333,333 − 216,667                    = 3,116,666¢
 */
import { describe, expect, it } from "vitest";
import {
  SubdivisionLotSaleInputError,
  computeSubdivisionLotSale,
  lotIdOfInputKey,
  lotPriceInputKey,
  type SubdivisionLotSaleInputs,
} from "../../shared/calculators/subdivisionLotSale";
import { subdivisionLotSaleEngine } from "../../server/services/economics/engines/subdivisionLotSale";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";

// The REAL registry — the one the kit's ownership guard and the preview read.
// Registration is part of what is tested: an engine not in it underwrites nothing.
const ENGINES = ALL_ENGINES;
it("is registered in ALL_ENGINES, exactly once", () => {
  expect(ALL_ENGINES.filter((e) => e.id === subdivisionLotSaleEngine.id)).toEqual([subdivisionLotSaleEngine]);
});

const golden: SubdivisionLotSaleInputs = {
  lotPricesCents: [8_500_000, 5_200_000, 9_500_000, 6_000_000],
  sellingCostPct: 8,
  monthsToSellOut: 18,
  parentBasisCents: 12_000_000,
  surveyCents: 650_000,
  platCents: 400_000,
  permitsCents: 250_000,
  improvementsCents: 3_500_000,
  monthlyCarryCents: 45_000,
};

/** The golden case as scenario wire inputs (lot keys named by child parcel id). */
const goldenWire: Record<string, number | string> = {
  [lotPriceInputKey(101)]: 8_500_000,
  [lotPriceInputKey(102)]: 5_200_000,
  [lotPriceInputKey(103)]: 9_500_000,
  [lotPriceInputKey(104)]: 6_000_000,
  sellingCostPct: 8,
  monthsToSellOut: 18,
  parentBasisCents: 12_000_000,
  surveyCents: 650_000,
  platCents: 400_000,
  permitsCents: 250_000,
  improvementsCents: 3_500_000,
  monthlyCarryCents: 45_000,
};

const run = (inputs: Record<string, number | string>) =>
  computeScenario(
    { subjectType: "property", subjectId: 1, label: "test", engineId: "subdivision_lot_sale", inputs },
    ENGINES,
  );
const value = (body: ReturnType<typeof run>, id: string) => body.metrics.find((m) => m.id === id)?.value;

describe("computeSubdivisionLotSale — golden case", () => {
  const o = computeSubdivisionLotSale(golden);
  it("sell-out and proceeds", () => {
    expect(o.lotCount).toBe(4);
    expect(o.grossSelloutCents).toBe(29_200_000);
    expect(o.sellingCostsCents).toBe(2_336_000);
    expect(o.netProceedsCents).toBe(26_864_000);
  });
  it("costs", () => {
    expect(o.subdivisionCostsCents).toBe(4_800_000);
    expect(o.carryCents).toBe(810_000);
    expect(o.totalCostCents).toBe(17_610_000);
  });
  it("profit, ROI and hold", () => {
    expect(o.profitCents).toBe(9_254_000);
    expect(o.roi).toBeCloseTo(92_540 / 176_100, 12);
    expect(o.roi).toBeCloseTo(0.525497, 6);
    expect(o.holdMonths).toBe(18);
  });
  it("selling cost rounds once, to the nearest cent", () => {
    const r = computeSubdivisionLotSale({ ...golden, lotPricesCents: [3_333_333], sellingCostPct: 6.5 });
    expect(r.sellingCostsCents).toBe(216_667);
    expect(r.netProceedsCents).toBe(3_116_666);
  });
});

describe("computeSubdivisionLotSale — the honest edges", () => {
  it("no parent basis: total cost, profit and ROI are null — never 0 — and proceeds still compute", () => {
    const o = computeSubdivisionLotSale({ ...golden, parentBasisCents: null });
    expect(o.totalCostCents).toBeNull();
    expect(o.profitCents).toBeNull();
    expect(o.roi).toBeNull();
    expect(o.grossSelloutCents).toBe(29_200_000);
    expect(o.netProceedsCents).toBe(26_864_000);
  });
  it("omitted subdivision costs and carry are excluded, not invented", () => {
    const o = computeSubdivisionLotSale({
      ...golden,
      surveyCents: null,
      platCents: null,
      permitsCents: null,
      improvementsCents: null,
      monthlyCarryCents: null,
    });
    expect(o.subdivisionCostsCents).toBe(0);
    expect(o.carryCents).toBe(0);
    // 268,640 − 120,000 = 148,640
    expect(o.totalCostCents).toBe(12_000_000);
    expect(o.profitCents).toBe(14_864_000);
  });
  it("a zero total cost has no ROI — undefined, not infinite", () => {
    const o = computeSubdivisionLotSale({
      ...golden,
      parentBasisCents: 0,
      surveyCents: null,
      platCents: null,
      permitsCents: null,
      improvementsCents: null,
      monthlyCarryCents: null,
    });
    expect(o.totalCostCents).toBe(0);
    expect(o.profitCents).toBe(26_864_000);
    expect(o.roi).toBeNull();
  });
  it("a loss is a negative profit, not a refusal", () => {
    // 268,640 − (300,000 + 48,000 + 8,100) = −87,460
    const o = computeSubdivisionLotSale({ ...golden, parentBasisCents: 30_000_000 });
    expect(o.profitCents).toBe(-8_746_000);
    expect(o.roi).toBeCloseTo(-87_460 / 356_100, 12);
  });
});

describe("computeSubdivisionLotSale — every bound refuses", () => {
  const refuses = (over: Partial<SubdivisionLotSaleInputs>, msg: RegExp) =>
    expect(() => computeSubdivisionLotSale({ ...golden, ...over })).toThrow(msg);

  it("a grid with no lots", () => {
    refuses({ lotPricesCents: [] }, /no lots/);
    expect(() => computeSubdivisionLotSale({ ...golden, lotPricesCents: [] })).toThrow(SubdivisionLotSaleInputError);
  });
  it("a negative or fractional lot price", () => {
    refuses({ lotPricesCents: [8_500_000, -1] }, /cannot be negative/);
    refuses({ lotPricesCents: [8_500_000.5] }, /whole cents/);
  });
  it("selling cost outside 0–100%", () => {
    refuses({ sellingCostPct: -0.01 }, /between 0% and 100%/);
    refuses({ sellingCostPct: 100.01 }, /between 0% and 100%/);
  });
  it("sell-out months that are fractional, under 1 or over the maximum", () => {
    refuses({ monthsToSellOut: 0 }, /whole number, 1 to 240/);
    refuses({ monthsToSellOut: 1.5 }, /whole number/);
    refuses({ monthsToSellOut: 241 }, /whole number, 1 to 240/);
  });
  it("any negative cost — a typo would move every return", () => {
    refuses({ parentBasisCents: -1 }, /Parent parcel cost basis cannot be negative/);
    refuses({ surveyCents: -1 }, /Survey cost cannot be negative/);
    refuses({ platCents: -1 }, /Plat cost cannot be negative/);
    refuses({ permitsCents: -1 }, /Permit cost cannot be negative/);
    refuses({ improvementsCents: -1 }, /Improvement cost cannot be negative/);
    refuses({ monthlyCarryCents: -1 }, /Monthly carry cannot be negative/);
  });
  it("the bounds themselves are accepted", () => {
    expect(() => computeSubdivisionLotSale({ ...golden, sellingCostPct: 0, monthsToSellOut: 1 })).not.toThrow();
    expect(() =>
      computeSubdivisionLotSale({ ...golden, sellingCostPct: 100, monthsToSellOut: 240 }),
    ).not.toThrow();
    expect(() => computeSubdivisionLotSale({ ...golden, lotPricesCents: [0], parentBasisCents: 0 })).not.toThrow();
  });
});

describe("lot price keys", () => {
  it("round-trip a child parcel id and reject anything else", () => {
    expect(lotIdOfInputKey(lotPriceInputKey(4012))).toBe(4012);
    expect(lotIdOfInputKey("lotPriceCents_")).toBeNull();
    expect(lotIdOfInputKey("lotPriceCents_12x")).toBeNull();
    expect(lotIdOfInputKey("sellingCostPct")).toBeNull();
  });
});

describe("the registered engine", () => {
  it("declares subdivider, under its own id and version", () => {
    expect(subdivisionLotSaleEngine.id).toBe("subdivision_lot_sale");
    expect(subdivisionLotSaleEngine.version).toBe("subdivision-lot-sale-1");
    expect(subdivisionLotSaleEngine.verticals).toEqual(["subdivider"]);
  });

  it("emits every metric it declares, and predicts total_cost and profit so an outcome can grade it", () => {
    expect(subdivisionLotSaleEngine.produces).toEqual(
      expect.arrayContaining(["total_cost", "profit"]),
    );
    for (const id of subdivisionLotSaleEngine.produces) expect(metricById(id), id).toBeDefined();
    const body = run(goldenWire);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...subdivisionLotSaleEngine.produces].sort());
  });

  it("produces the golden figures through the registry, each in its registered unit", () => {
    const body = run(goldenWire);
    expect(body.engineVersion).toBe("subdivision-lot-sale-1");
    expect(value(body, "gross_sellout")).toBe(29_200_000);
    expect(value(body, "net_proceeds")).toBe(26_864_000);
    expect(value(body, "total_cost")).toBe(17_610_000);
    expect(value(body, "profit")).toBe(9_254_000);
    // roi is a RATIO (a fraction): 52.55% is 0.5255, not 52.55.
    expect(value(body, "roi")).toBeCloseTo(0.525497, 6);
    expect(value(body, "hold_months")).toBe(18);
    const unit = Object.fromEntries(body.metrics.map((m) => [m.id, m.unit]));
    expect(unit).toEqual({
      gross_sellout: "cents",
      net_proceeds: "cents",
      total_cost: "cents",
      profit: "cents",
      roi: "ratio",
      hold_months: "months",
    });
  });

  it("freezes exactly what it consumed: every lot, in child-parcel order, and no stray keys", () => {
    const shuffled: Record<string, number | string> = { note: "ignore me", ...goldenWire };
    delete shuffled[lotPriceInputKey(101)];
    shuffled[lotPriceInputKey(101)] = 8_500_000; // now last in insertion order
    const body = run(shuffled);
    const lotKeys = Object.keys(body.inputs).filter((k) => lotIdOfInputKey(k) !== null);
    expect(lotKeys).toEqual([101, 102, 103, 104].map(lotPriceInputKey));
    expect(body.inputs).not.toHaveProperty("note");
    expect(body.inputs).toEqual(run(goldenWire).inputs);
  });

  it("a fully answered lock declares nothing", () => {
    expect(run(goldenWire).assumptions).toEqual([]);
  });

  it("an unknown parent basis is declared, and total cost and profit are null — not $0", () => {
    const { parentBasisCents: _omit, ...noBasis } = goldenWire;
    const body = run(noBasis);
    expect(value(body, "total_cost")).toBeNull();
    expect(value(body, "profit")).toBeNull();
    expect(value(body, "roi")).toBeNull();
    expect(value(body, "gross_sellout")).toBe(29_200_000);
    const basis = body.assumptions.find((a) => a.key === "parent_basis");
    expect(basis?.origin).toBe("platform-default");
    expect(basis?.basis).toMatch(/cannot be graded/);
    expect(body.inputs).not.toHaveProperty("parentBasisCents");
  });

  it("declares each omitted cost line as an assumption — never a silent $0", () => {
    const body = run({
      [lotPriceInputKey(1)]: 5_000_000,
      sellingCostPct: 8,
      monthsToSellOut: 12,
      parentBasisCents: 2_000_000,
    });
    const declared = body.assumptions.map((a) => a.key).sort();
    expect(declared).toEqual(["carry", "improvement_cost", "permit_cost", "plat_cost", "survey_cost"]);
    for (const a of body.assumptions) expect(a.origin).toBe("platform-default");
    expect(body.assumptions.find((a) => a.key === "carry")?.basis).toMatch(/12-month sell-out/);
    // Only the absent lines are declared: an explicit $0 is the operator's answer.
    const zeroSurvey = run({ ...goldenWire, surveyCents: 0 });
    expect(zeroSurvey.assumptions).toEqual([]);
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ sellingCostPct: 8, monthsToSellOut: 12 })).toThrow(ScenarioEngineError);
    expect(() => run({ sellingCostPct: 8, monthsToSellOut: 12 })).toThrow(/no lots/);
    expect(() => run({ ...goldenWire, sellingCostPct: 120 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...goldenWire, monthsToSellOut: 0 })).toThrow(/1 to 240/);
    // Money is integer cents: a fractional lot price or cost is refused, not rounded.
    expect(() => run({ ...goldenWire, [lotPriceInputKey(101)]: 8_500_000.5 })).toThrow(/integer/);
    expect(() => run({ ...goldenWire, surveyCents: 650_000.5 })).toThrow(/integer/);
    const { sellingCostPct: _omit, ...noSellingCost } = goldenWire;
    expect(() => run(noSellingCost)).toThrow(/sellingCostPct/);
  });
});

describe("lot keys are canonical", () => {
  it("a non-canonical spelling of a lot id is refused, never double-counted", () => {
    const base = { sellingCostPct: 8, monthsToSellOut: 12, parentBasisCents: 1_000_000 };
    expect(() =>
      computeScenario(
        { subjectType: "property", subjectId: 1, label: "x", engineId: "subdivision_lot_sale", inputs: { ...base, lotPriceCents_7: 100_000, lotPriceCents_07: 200_000 } },
        ALL_ENGINES,
      ),
    ).toThrow(/not a canonical lot key/);
  });
});
