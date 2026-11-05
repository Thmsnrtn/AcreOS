/**
 * Subdivision V1, Leg 3 — the feasibility engine (subdivision-feasibility v1).
 * Package 2026-11-05 §5 / §8.3 tests 9–14. Every figure is hand-computed in the
 * fixture comments; the IRR was solved independently (bisection in Python) and
 * is also checked here by its own definition (NPV at the rate ≈ 0).
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
const stores = vi.hoisted(() => ({ scenarios: [] as unknown[], decisions: [] as unknown[] }));
vi.mock("../../server/services/economics/scenarioStore", () => ({
  recordScenario: async (_org: number, body: unknown) => {
    stores.scenarios.push(body);
    return { id: stores.scenarios.length, body: { metrics: [], assumptions: [] } };
  },
}));
vi.mock("../../server/services/decisions/decisionStore", () => ({
  recordDecision: async (_org: number, body: unknown) => {
    stores.decisions.push(body);
    return { id: stores.decisions.length };
  },
}));

import { computeFeasibility, feasibilitySensitivity, type FeasibilityInputs } from "../../shared/subdivision/feasibility";
import { feasibilityInputsFromWire, subdivisionFeasibilityEngine } from "../../server/services/economics/engines/subdivisionFeasibility";
import { ALL_ENGINES } from "../../server/services/economics/engines";
import { computeScenario, engineById, ScenarioEngineError } from "../../shared/economics/scenario";
import { previewUnderwriting, recordUnderwrittenDecision } from "../../server/services/underwriting/verticalDecision";

const $ = (d: number) => d * 100;

/**
 * GOLDEN PROJECT (dollars):
 *   land 100,000 · 10 lots · gross 400,000 (avg 40,000) · pace 5 lots/month · septic
 *   hard: grading 20,000 + roads 50,000 + water 10,000 + septic 30,000
 *         + stormwater 5,000 + utilities 15,000 + landscaping 0 (stated)  = 130,000
 *   soft: eng/survey 12,000 + legal 3,000 + permitting 10,000 + financing 0
 *         + marketing 20,000 + contingency 5,000                           =  50,000
 *   total before carry 280,000 · margin before carry 120,000 · per lot 12,000
 *   timeline p50 60 days (2 mo) / p90 90 days (3 mo) · holding 1,000/mo
 *   carry p50 2,000 / p90 3,000 · margin after p50 118,000 / p90 117,000
 *   cash flows: -280,000 · -1,000 · -1,000 · +200,000 · +200,000
 *   monthly IRR 0.1057410999… → annual (1+r)^12−1 = 2.3407304…
 *   hold (p50) 2 + 10/5 = 4 months
 */
const WIRE: Record<string, number | string> = {
  landCostCents: $(100_000),
  lotCount: 10,
  grossProceedsCents: $(400_000),
  absorptionLotsPerMonth: 5,
  wastewater: "septic",
  gradingCents: $(20_000),
  roadsCents: $(50_000),
  waterCents: $(10_000),
  septicCents: $(30_000),
  stormwaterCents: $(5_000),
  utilitiesCents: $(15_000),
  landscapingCents: 0,
  engineeringSurveyCents: $(12_000),
  legalCents: $(3_000),
  permittingFeesCents: $(10_000),
  financingCents: 0,
  marketingCents: $(20_000),
  contingencyCents: $(5_000),
  timelineP50Days: 60,
  timelineP90Days: 90,
  holdingCostMonthlyCents: $(1_000),
};
const GOLDEN: FeasibilityInputs = feasibilityInputsFromWire(WIRE);

describe("§8.3 test 9 — golden feasibility", () => {
  const r = computeFeasibility(GOLDEN);

  it("matches the hand arithmetic to the cent", () => {
    expect(r.hard.totalCents).toBe($(130_000));
    expect(r.soft.totalCents).toBe($(50_000));
    expect(r.totalCostBeforeCarry.cents).toBe($(280_000));
    expect(r.marginBeforeCarry.cents).toBe($(120_000));
    expect(r.carry).toEqual({ p50Cents: $(2_000), p90Cents: $(3_000), refusedReason: null });
    expect(r.marginAfterCarryP50.cents).toBe($(118_000));
    expect(r.marginAfterCarryP90.cents).toBe($(117_000));
    expect(r.marginPerLotBeforeCarry.cents).toBe($(12_000));
    expect(r.holdMonthsP50).toBe(4);
  });

  it("the cost-group lines re-add to their totals and to total cost", () => {
    const sum = (s: typeof r.hard) => s.lines.reduce((a, l) => a + (l.cents ?? 0), 0);
    expect(sum(r.hard)).toBe(r.hard.totalCents);
    expect(sum(r.soft)).toBe(r.soft.totalCents);
    expect(GOLDEN.landCostCents + sum(r.hard) + sum(r.soft)).toBe(r.totalCostBeforeCarry.cents);
  });

  it("IRR: the independent solution, and NPV at the monthly rate is zero", () => {
    expect(r.irr.annual).toBeCloseTo(2.3407304, 5);
    const flows = r.cashFlowsCents!;
    expect(flows).toEqual([-$(280_000), -$(1_000), -$(1_000), $(200_000), $(200_000)]);
    const m = Math.pow(1 + (r.irr.annual as number), 1 / 12) - 1;
    expect(flows.reduce((a, cf, t) => a + cf / Math.pow(1 + m, t), 0)).toBeCloseTo(0, 0);
  });

  it("the septic project marks the sewer line NOT APPLICABLE (never a $0 line); stated zeros are labelled", () => {
    expect(r.hard.lines.find((l) => l.key === "sewerCents")).toMatchObject({ status: "not_applicable", cents: null });
    expect(r.hard.lines.find((l) => l.key === "landscapingCents")).toMatchObject({ status: "stated_zero", cents: 0 });
    expect(r.soft.lines.find((l) => l.key === "financingCents")).toMatchObject({ status: "stated_zero" });
  });
});

describe("§8.3 test 10 — refuse per line; zero is a statement", () => {
  it("omit the roads line: the hard section refuses BY NAME, and nothing that sums it presents as complete", () => {
    const { roadsCents: _omit, ...rest } = WIRE;
    const r = computeFeasibility(feasibilityInputsFromWire(rest));
    expect(r.hard.totalCents).toBeNull();
    expect(r.hard.refusedReason).toMatch(/Hard \/ infrastructure costs refused — not entered: roads & right-of-way construction/);
    for (const line of [r.totalCostBeforeCarry, r.marginBeforeCarry, r.marginAfterCarryP50, r.marginAfterCarryP90, r.marginPerLotBeforeCarry]) {
      expect(line.cents).toBeNull();
      expect(line.refusedReason).toMatch(/roads/);
    }
    expect(r.irr.annual).toBeNull();
    // The soft section still computes — refusal is per section, not global.
    expect(r.soft.totalCents).toBe($(50_000));
  });

  it("state roads explicitly as 0: the section computes, the line labelled stated-zero", () => {
    const r = computeFeasibility(feasibilityInputsFromWire({ ...WIRE, roadsCents: 0 }));
    expect(r.hard.totalCents).toBe($(80_000));
    expect(r.hard.lines.find((l) => l.key === "roadsCents")?.status).toBe("stated_zero");
  });

  it("a cost on the non-applicable wastewater line is refused (sewer cost on a septic project)", () => {
    expect(() => subdivisionFeasibilityEngine.compute({ ...WIRE, sewerCents: $(1) })).toThrow(ScenarioEngineError);
  });

  it("malformed phases, phases that don't sum to the lots, and a zero pace are refused — never guessed", () => {
    for (const bad of [{ phaseLotCounts: "4;4" }, { phaseLotCounts: "4,4" }, { absorptionLotsPerMonth: 0 }]) {
      expect(() => subdivisionFeasibilityEngine.compute({ ...WIRE, ...bad }), JSON.stringify(bad)).toThrow(ScenarioEngineError);
    }
  });
});

describe("§8.3 test 11 — carry withholding (operator-stated timeline, ruling 2026-11-05)", () => {
  it("no timeline: p50/p90 margins, carry and IRR withheld WITH the reason; the before-carry margin still reported", () => {
    const { timelineP50Days: _a, timelineP90Days: _b, ...noTimeline } = WIRE;
    const r = computeFeasibility(feasibilityInputsFromWire(noTimeline));
    expect(r.marginBeforeCarry.cents).toBe($(120_000));
    for (const line of [r.marginAfterCarryP50, r.marginAfterCarryP90]) {
      expect(line.cents).toBeNull();
      expect(line.refusedReason).toMatch(/No timeline stated for this run/);
    }
    expect(r.irr).toEqual({ annual: null, refusedReason: expect.stringMatching(/No timeline stated/) });
    // On the engine output: `profit` (after p50 carry) is null — never the before-carry figure.
    const m = subdivisionFeasibilityEngine.compute(noTimeline).metrics;
    expect(m.find((x) => x.id === "profit")?.value).toBeNull();
    expect(m.find((x) => x.id === "margin_before_carry")?.value).toBe($(120_000));
  });

  it("timeline present but no holding cost: carry refused, by name", () => {
    const { holdingCostMonthlyCents: _h, ...noHolding } = WIRE;
    expect(computeFeasibility(feasibilityInputsFromWire(noHolding)).carry.refusedReason).toMatch(/monthly holding cost/);
  });

  it("only a p50 stated: the p90 margin alone is withheld", () => {
    const { timelineP90Days: _b, ...p50only } = WIRE;
    const r = computeFeasibility(feasibilityInputsFromWire(p50only));
    expect(r.marginAfterCarryP50.cents).toBe($(118_000));
    expect(r.marginAfterCarryP90).toEqual({ cents: null, refusedReason: "No p90 timeline stated: this margin is withheld." });
  });
});

describe("§8.3 test 12 — sensitivity moves margin and IRR the right way, by the right amount", () => {
  const cells = feasibilitySensitivity(GOLDEN);
  const at = (axis: string, change: number) => cells.find((c) => c.axis === axis && c.change === change)!;

  it("lot price ±10% moves the before-carry margin by exactly ±40,000", () => {
    expect(at("lot_price", 0.1).marginBeforeCarryCents).toBe($(160_000));
    expect(at("lot_price", -0.1).marginBeforeCarryCents).toBe($(80_000));
    expect(at("lot_price", 0.2).irrAnnual!).toBeGreaterThan(at("lot_price", 0.1).irrAnnual!);
    expect(at("lot_price", -0.2).irrAnnual!).toBeLessThan(at("lot_price", -0.1).irrAnnual!);
  });

  it("infrastructure ±15% moves the margin by exactly ∓19,500 (15% of 130,000 hard costs)", () => {
    expect(at("infrastructure_cost", 0.15).marginBeforeCarryCents).toBe($(120_000 - 19_500));
    expect(at("infrastructure_cost", -0.15).marginBeforeCarryCents).toBe($(120_000 + 19_500));
  });

  it("a faster pace leaves the margin unchanged and raises the IRR; a slower pace lowers it", () => {
    const base = computeFeasibility(GOLDEN).irr.annual!;
    expect(at("absorption_pace", 0.25).marginBeforeCarryCents).toBe($(120_000));
    expect(at("absorption_pace", 0.25).irrAnnual!).toBeGreaterThan(base);
    expect(at("absorption_pace", -0.25).irrAnnual!).toBeLessThan(base);
  });

  it("every cell is reproducible: recomputing its perturbed snapshot gives the same numbers", () => {
    expect(feasibilitySensitivity(GOLDEN)).toEqual(cells);
    expect(cells.map((c) => c.label)).toEqual([
      "Lot price -20%", "Lot price -10%", "Lot price +10%", "Lot price +20%",
      "Absorption pace -25%", "Absorption pace +25%",
      "Infrastructure cost -15%", "Infrastructure cost +15%",
    ]);
  });
});

describe("§8.3 tests 13–14 — engine registration, ownership, preview ≡ record", () => {
  it("is registered, declares ONLY subdivider, and every produced metric is in the registry", () => {
    const e = engineById("subdivision_feasibility", ALL_ENGINES)!;
    expect(e.verticals).toEqual(["subdivider"]);
    const body = computeScenario({ subjectType: "property", subjectId: 1, label: "x", engineId: e.id, inputs: WIRE }, ALL_ENGINES);
    expect(body.metrics.map((m) => m.id).sort()).toEqual([...e.produces].sort());
  });

  it("no engine but this one declares subdivider (so a subdivider decision can only cite it)", () => {
    expect(ALL_ENGINES.filter((x) => (x.verticals ?? []).includes("subdivider")).map((x) => x.id)).toEqual(["subdivision_feasibility"]);
  });

  it("preview ≡ record: the preview's metrics and declared assumptions equal the scenario computeScenario freezes", () => {
    const preview = previewUnderwriting("subdivision_feasibility", WIRE);
    const recorded = computeScenario({ subjectType: "property", subjectId: 42, label: "Base", engineId: "subdivision_feasibility", inputs: WIRE }, ALL_ENGINES);
    expect(preview.metrics).toEqual(recorded.metrics);
    expect(preview.assumptions).toEqual(recorded.assumptions);
    expect(preview.engineVersion).toBe("subdivision-feasibility v1");
  });

  it("the timeline is declared as the OPERATOR's, never a county figure; omitted carry parts are declared, not absorbed", () => {
    const a = subdivisionFeasibilityEngine.compute(WIRE).assumptions;
    expect(a.find((x) => x.key === "timeline")).toMatchObject({ origin: "user", basis: expect.stringMatching(/not a county figure/) });
    expect(a.find((x) => x.key === "debt_carry")).toMatchObject({ origin: "platform-default", value: "not entered — excluded" });
    expect(a.find((x) => x.key === "sales_pace")).toMatchObject({ origin: "user", basis: expect.stringMatching(/not a platform forecast/) });
  });
});

describe("§8.3 test 13 — ownership guard (evidence rule v2): refused BEFORE any write", () => {
  const decision = (engineId: string, inputs: Record<string, number | string>) => ({
    subjectType: "property" as const,
    subjectId: 42,
    engineId,
    strategyPackId: "subdivider" as const,
    inputs,
    scenarioLabel: "x",
    kind: "pursue" as const,
    choice: "Proceed",
    rationale: "test",
    actorRef: "user_1",
    authority: "org_member:subdivision_decide",
    reviewDueAt: null,
  });

  it("a subdivider decision citing an engine that does not declare subdivider writes neither store", async () => {
    stores.scenarios.length = 0;
    stores.decisions.length = 0;
    await expect(recordUnderwrittenDecision(7, decision("flip_mao", { arv: 1 }))).rejects.toThrow(/does not underwrite subdivider/);
    await expect(recordUnderwrittenDecision(7, decision("land_deal", { purchaseCents: 1 }))).rejects.toThrow(/does not underwrite subdivider/);
    expect(stores.scenarios).toEqual([]);
    expect(stores.decisions).toEqual([]);
  });

  it("the feasibility engine passes the guard and writes exactly one scenario + one decision, citing it", async () => {
    stores.scenarios.length = 0;
    stores.decisions.length = 0;
    await recordUnderwrittenDecision(7, decision("subdivision_feasibility", WIRE));
    expect(stores.scenarios).toHaveLength(1);
    expect(stores.decisions).toHaveLength(1);
    expect(stores.scenarios[0]).toMatchObject({ engineId: "subdivision_feasibility", strategyPackId: "subdivider" });
  });
});
