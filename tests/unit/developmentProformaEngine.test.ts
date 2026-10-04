/**
 * The land development pro-forma engine, pinned by hand-computed figures.
 *
 * Golden case: $500,000 land, $100,000 entitlement/soft costs, $600,000
 * horizontal improvements, 20 lots at $90,000, 6% selling costs, 6 months to
 * entitle, 6 months to build, 12 months to sell out, $5,000/mo carry.
 *   hold months   = 6 + 6 + 12                              = 24
 *   carry         = 5,000 × 24                              = $120,000
 *   total cost    = 500,000 + 100,000 + 600,000 + 120,000   = $1,320,000
 *   gross sellout = 20 × 90,000                             = $1,800,000
 *   selling costs = 1,800,000 × 6%                          = $108,000
 *   net proceeds  = 1,800,000 − 108,000                     = $1,692,000
 *   profit        = 1,692,000 − 1,320,000                   = $372,000
 *   ROI           = 372,000 / 1,320,000                     = 0.281818…
 *   annualised    = 0.281818… × 12 / 24                     = 0.140909…
 *
 * IRR timeline (monthly, 25 flows):
 *   t = 0        −(500,000 + 100,000)                       = −$600,000
 *   t = 1…6      −5,000 carry                               = −$5,000 each
 *   t = 7…12     −600,000/6 − 5,000                         = −$105,000 each
 *   t = 13…24    +1,692,000/12 − 5,000 = 141,000 − 5,000    = +$136,000 each
 *   check: −600,000 − 30,000 − 630,000 + 1,632,000          = $372,000 = profit
 *   NPV at 1.85%/mo ≈ +$7,238 and at 1.90%/mo ≈ −$669, so the monthly IRR
 *   lies between them (≈ 1.8957%), and annual = (1 + m)^12 − 1 ≈ 25.28%.
 *   The test re-checks that bracket with its own NPV, independent of the solver.
 */
import { describe, expect, it } from "vitest";
import {
  computeDevelopmentProforma,
  type DevelopmentProformaInputs,
} from "../../shared/calculators/developmentProforma";
import { developmentProformaEngine } from "../../server/services/economics/engines/developmentProforma";
import { DEVELOPMENT_PROFORMA_FIELDS } from "../../shared/economics/fields/developmentProforma";
import { computeScenario, metricById, ScenarioEngineError } from "../../shared/economics/scenario";
import { ALL_ENGINES } from "../../server/services/economics/engines";

const golden: DevelopmentProformaInputs = {
  landCostCents: 50_000_000,
  entitlementCostsCents: 10_000_000,
  improvementCostsCents: 60_000_000,
  lotCount: 20,
  averageLotPriceCents: 9_000_000,
  sellingCostPct: 6,
  entitlementMonths: 6,
  developmentMonths: 6,
  selloutMonths: 12,
  monthlyCarryCents: 500_000,
};

function npv(monthlyRate: number, flows: number[]): number {
  return flows.reduce((s, f, t) => s + f / Math.pow(1 + monthlyRate, t), 0);
}

describe("computeDevelopmentProforma — golden case", () => {
  const o = computeDevelopmentProforma(golden);
  it("hold and carry", () => {
    expect(o.holdMonths).toBe(24);
    expect(o.carryCents).toBe(12_000_000);
  });
  it("costs, sell-out and profit", () => {
    expect(o.totalCostCents).toBe(132_000_000);
    expect(o.grossSelloutCents).toBe(180_000_000);
    expect(o.sellingCostsCents).toBe(10_800_000);
    expect(o.netProceedsCents).toBe(169_200_000);
    expect(o.profitCents).toBe(37_200_000);
  });
  it("returns", () => {
    expect(o.roi).toBeCloseTo(0.2818181818, 9);
    expect(o.annualizedReturn).toBeCloseTo(0.1409090909, 9);
  });
  it("the timeline is the one the header describes", () => {
    expect(o.cashFlowsCents).toHaveLength(25);
    expect(o.cashFlowsCents[0]).toBe(-60_000_000);
    expect(o.cashFlowsCents.slice(1, 7)).toEqual(Array(6).fill(-500_000));
    expect(o.cashFlowsCents.slice(7, 13)).toEqual(Array(6).fill(-10_500_000));
    expect(o.cashFlowsCents.slice(13)).toEqual(Array(12).fill(13_600_000));
    expect(o.cashFlowsCents.reduce((a, b) => a + b, 0)).toBe(o.profitCents);
  });
  it("IRR: the hand bracket, then the solved annual figure", () => {
    expect(npv(0.0185, o.cashFlowsCents)).toBeGreaterThan(0);
    expect(npv(0.019, o.cashFlowsCents)).toBeLessThan(0);
    expect(o.irr).not.toBeNull();
    const monthly = Math.pow(1 + o.irr!, 1 / 12) - 1;
    expect(monthly).toBeGreaterThan(0.0185);
    expect(monthly).toBeLessThan(0.019);
    expect(Math.abs(npv(monthly, o.cashFlowsCents))).toBeLessThan(100); // within $1 of zero
    expect(o.irr).toBeCloseTo(0.25277, 4);
  });
});

describe("computeDevelopmentProforma — the honest edges", () => {
  it("no carry entered: carry is excluded, not guessed", () => {
    const o = computeDevelopmentProforma({ ...golden, monthlyCarryCents: null });
    expect(o.carryCents).toBe(0);
    expect(o.totalCostCents).toBe(120_000_000);
    expect(o.profitCents).toBe(49_200_000);
  });
  it("a losing project is a real answer, not an error", () => {
    const o = computeDevelopmentProforma({ ...golden, averageLotPriceCents: 5_000_000 });
    // gross 1,000,000; net 940,000; profit 940,000 − 1,320,000 = −380,000
    expect(o.profitCents).toBe(-38_000_000);
    expect(o.roi).toBeLessThan(0);
  });
  it("lots that sell for nothing: no positive flow, so IRR is undefined, not a number", () => {
    const o = computeDevelopmentProforma({ ...golden, averageLotPriceCents: 0 });
    expect(o.irr).toBeNull();
    expect(o.grossSelloutCents).toBe(0);
  });
  it("already entitled, no improvements: zero months are the operator's answer", () => {
    const o = computeDevelopmentProforma({
      ...golden,
      entitlementCostsCents: 0,
      improvementCostsCents: 0,
      entitlementMonths: 0,
      developmentMonths: 0,
    });
    expect(o.holdMonths).toBe(12);
    expect(o.cashFlowsCents).toHaveLength(13);
    expect(o.cashFlowsCents[0]).toBe(-50_000_000);
  });
  it("uneven spreads keep every cent: the remainder lands in the last month", () => {
    const o = computeDevelopmentProforma({ ...golden, improvementCostsCents: 1_000, developmentMonths: 3, monthlyCarryCents: 0 });
    // 1,000 / 3 = 333, 333, 334
    expect(o.cashFlowsCents.slice(7, 10)).toEqual([-333, -333, -334]);
    expect(o.cashFlowsCents.reduce((a, b) => a + b, 0)).toBe(o.profitCents);
  });
  it("improvement spending with no build months is refused, not dropped", () => {
    expect(() => computeDevelopmentProforma({ ...golden, developmentMonths: 0 })).toThrow(/Improvement costs/);
  });
  it("a land price that is not positive is refused", () => {
    expect(() => computeDevelopmentProforma({ ...golden, landCostCents: 0 })).toThrow(/Land price/);
    expect(() => computeDevelopmentProforma({ ...golden, landCostCents: -1 })).toThrow(/Land price/);
  });
  it("negative costs and prices are refused — a typo would flatter every return", () => {
    expect(() => computeDevelopmentProforma({ ...golden, entitlementCostsCents: -1 })).toThrow(/entitlementCostsCents/);
    expect(() => computeDevelopmentProforma({ ...golden, improvementCostsCents: -1 })).toThrow(/improvementCostsCents/);
    expect(() => computeDevelopmentProforma({ ...golden, averageLotPriceCents: -1 })).toThrow(/averageLotPriceCents/);
    expect(() => computeDevelopmentProforma({ ...golden, monthlyCarryCents: -1 })).toThrow(/monthlyCarryCents/);
  });
  it("the lot count must be a whole number from 1 to 10,000", () => {
    expect(() => computeDevelopmentProforma({ ...golden, lotCount: 0 })).toThrow(/Lot count/);
    expect(() => computeDevelopmentProforma({ ...golden, lotCount: 10_001 })).toThrow(/Lot count/);
    expect(() => computeDevelopmentProforma({ ...golden, lotCount: 2.5 })).toThrow(/Lot count/);
    expect(computeDevelopmentProforma({ ...golden, lotCount: 1 }).grossSelloutCents).toBe(9_000_000);
    expect(computeDevelopmentProforma({ ...golden, lotCount: 10_000 }).grossSelloutCents).toBe(90_000_000_000);
  });
  it("selling costs outside 0–100% are refused", () => {
    expect(() => computeDevelopmentProforma({ ...golden, sellingCostPct: -1 })).toThrow(/sellingCostPct/);
    expect(() => computeDevelopmentProforma({ ...golden, sellingCostPct: 101 })).toThrow(/sellingCostPct/);
    expect(computeDevelopmentProforma({ ...golden, sellingCostPct: 0 }).sellingCostsCents).toBe(0);
    expect(computeDevelopmentProforma({ ...golden, sellingCostPct: 100 }).netProceedsCents).toBe(0);
  });
  it("periods must be whole months within range", () => {
    expect(() => computeDevelopmentProforma({ ...golden, entitlementMonths: -1 })).toThrow(/entitlementMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, entitlementMonths: 121 })).toThrow(/entitlementMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, entitlementMonths: 1.5 })).toThrow(/entitlementMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, developmentMonths: -1 })).toThrow(/developmentMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, developmentMonths: 121 })).toThrow(/developmentMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, developmentMonths: 2.5 })).toThrow(/developmentMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, selloutMonths: 0 })).toThrow(/selloutMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, selloutMonths: 121 })).toThrow(/selloutMonths/);
    expect(() => computeDevelopmentProforma({ ...golden, selloutMonths: 6.5 })).toThrow(/selloutMonths/);
    expect(computeDevelopmentProforma({ ...golden, entitlementMonths: 120, developmentMonths: 120, selloutMonths: 120 }).holdMonths).toBe(360);
  });
});

describe("the form fields", () => {
  it("cover exactly the inputs the engine consumes, with the engine's bounds", () => {
    const body = computeScenario(
      { subjectType: "property", subjectId: 1, label: "x", engineId: "development_proforma", inputs: { ...golden } as unknown as Record<string, number> },
      ALL_ENGINES,
    );
    expect(DEVELOPMENT_PROFORMA_FIELDS.map((f) => f.key).sort()).toEqual(Object.keys(body.inputs).sort());
    expect(DEVELOPMENT_PROFORMA_FIELDS.filter((f) => f.optional).map((f) => f.key)).toEqual(["monthlyCarryCents"]);
    const sellout = DEVELOPMENT_PROFORMA_FIELDS.find((f) => f.key === "selloutMonths");
    expect([sellout?.min, sellout?.max]).toEqual([1, 120]);
  });
});

describe("the registered engine", () => {
  // The REAL registry — the one the kit's guard and the preview read.
  const engines = ALL_ENGINES;
  it("is registered in ALL_ENGINES, exactly once", () => {
    expect(ALL_ENGINES.filter((e) => e.id === developmentProformaEngine.id)).toEqual([developmentProformaEngine]);
  });
  const wire: Record<string, number> = {
    landCostCents: 50_000_000,
    entitlementCostsCents: 10_000_000,
    improvementCostsCents: 60_000_000,
    lotCount: 20,
    averageLotPriceCents: 9_000_000,
    sellingCostPct: 6,
    entitlementMonths: 6,
    developmentMonths: 6,
    selloutMonths: 12,
  };
  const run = (inputs: Record<string, number>) =>
    computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: "development_proforma", inputs }, engines);

  it("declares developer and only developer", () => {
    expect(developmentProformaEngine.id).toBe("development_proforma");
    expect(developmentProformaEngine.version).toBe("development-proforma-1");
    expect(developmentProformaEngine.verticals).toEqual(["developer"]);
  });

  it("emits every metric it declares, in its registered unit, and predicts total_cost and profit", () => {
    const body = run({ ...wire, monthlyCarryCents: 500_000 });
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...developmentProformaEngine.produces].sort());
    for (const m of body.metrics) expect(m.unit).toBe(metricById(m.id)?.unit);
    const v = (id: string) => body.metrics.find((m) => m.id === id)?.value;
    expect(v("total_cost")).toBe(132_000_000);
    expect(v("profit")).toBe(37_200_000);
    expect(v("gross_sellout")).toBe(180_000_000);
    expect(v("net_proceeds")).toBe(169_200_000);
    expect(v("hold_months")).toBe(24);
    expect(v("irr")).toBeCloseTo(0.25277, 4);
    expect(body.assumptions).toEqual([]);
  });

  it("declares an omitted carry as an assumption — never a silent $0", () => {
    const body = run(wire);
    expect(body.assumptions.map((a) => a.key)).toEqual(["carry"]);
    expect(body.assumptions[0].origin).toBe("platform-default");
    expect(body.assumptions[0].basis).toMatch(/24-month/);
    expect(body.inputs).not.toHaveProperty("monthlyCarryCents");
    expect(body.metrics.find((m) => m.id === "total_cost")?.value).toBe(120_000_000);
  });

  it("an explicit $0 carry is the operator's answer, so nothing is declared", () => {
    const body = run({ ...wire, monthlyCarryCents: 0 });
    expect(body.assumptions).toEqual([]);
    expect(body.inputs).toHaveProperty("monthlyCarryCents", 0);
  });

  it("an undefined IRR is null in the scenario, not zero", () => {
    const body = run({ ...wire, averageLotPriceCents: 0 });
    expect(body.metrics.find((m) => m.id === "irr")?.value).toBeNull();
  });

  it("refuses bad input as a scenario error the route can show", () => {
    expect(() => run({ ...wire, sellingCostPct: 150 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, lotCount: 0 })).toThrow(ScenarioEngineError);
    expect(() => run({ ...wire, landCostCents: 1.5 })).toThrow(/integer/);
    const { lotCount: _omit, ...missing } = wire;
    expect(() => run(missing)).toThrow(/lotCount/);
  });
});
