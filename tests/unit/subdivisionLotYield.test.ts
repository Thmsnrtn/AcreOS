/**
 * Subdivision V1, Leg 2 — the lot-yield estimate (lot-yield v1).
 * Package 2026-11-05 §4 / §8.2 tests 6–8. Pure module; every number below is
 * hand-computed in the fixture comments.
 */
import { describe, expect, it } from "vitest";
import {
  estimateLotYield,
  reconcileWithDrawnPlans,
  type LotYieldInputs,
} from "../../shared/subdivision/lotYield";

const fact = (value: number, source = "operator-stated", asOf: string | null = "2026-11-01") => ({ value, source, asOf });

/**
 * GOLDEN CASE (arithmetic by hand):
 *   gross 40 ac − floodway 3.5 − easement 1.25 − slope 2.75 = 32.5 ac
 *   roads 15%: 32.5 × 0.85 = 27.625 ac net buildable
 *   high: 27.625 ÷ 1.0 ac (stated minimum lot) = 27.625 → 27 lots
 *   low:  27.625 ÷ 2.5 ac (target lot)         = 11.05  → 11 lots
 */
const GOLDEN: LotYieldInputs = {
  grossAcres: fact(40, "county GIS parcel export"),
  floodwayAcres: fact(3.5, "FEMA panel 47187C0210F read by operator"),
  easementAcres: fact(1.25, "recorded utility easement, deed book 1234"),
  unbuildableSlopeAcres: fact(2.75, "operator's topo read at a 15% threshold"),
  roadsRowFraction: 0.15,
  minimumLot: { acres: 1, citation: "county subdivision regs §4.2 as the operator read them" },
  targetLotAcres: 2.5,
};

describe("§8.2 test 6 — golden case", () => {
  const e = estimateLotYield(GOLDEN);

  it("matches the hand arithmetic to the acre and the lot at both ends", () => {
    expect(e.version).toBe("lot-yield v1");
    expect(e.refusedReason).toBeNull();
    expect(e.afterDeductions.high.value).toBe(32.5);
    expect(e.afterDeductions.low.value).toBe(32.5);
    expect(e.netBuildable.high.value).toBe(27.625);
    expect(e.netBuildable.low.value).toBe(27.625);
    expect(e.yield.high.value).toBe(27);
    expect(e.yield.low.value).toBe(11);
    expect(e.notDeterminable).toEqual([]);
  });

  it("the deduction lines re-add: gross − Σ deductions = acres before roads", () => {
    const sum = e.deductions.reduce((a, d) => a + (d.acres ?? 0), 0);
    expect(GOLDEN.grossAcres!.value - sum).toBe(e.afterDeductions.high.value);
    expect(e.deductions.map((d) => d.status)).toEqual(["stated", "stated", "stated"]);
    // Every stated line keeps its source and as-of verbatim.
    expect(e.deductions[0]).toMatchObject({ source: "FEMA panel 47187C0210F read by operator", asOf: "2026-11-01" });
  });

  it("each end names its basis; the stated minimum lot is labelled operator-stated with its citation", () => {
    expect(e.yield.high.basis).toMatch(/stated minimum lot 1 ac \(operator-stated; cited: county subdivision regs §4\.2/);
    expect(e.yield.low.basis).toMatch(/operator's target lot 2\.5 ac/);
  });

  it("a 1/10,000-acre float artefact never costs a lot (0.3 ÷ 0.1 is 3, not 2)", () => {
    const tiny = estimateLotYield({ ...GOLDEN, grossAcres: fact(0.3), floodwayAcres: fact(0), easementAcres: fact(0), unbuildableSlopeAcres: fact(0), roadsRowFraction: 0, minimumLot: { acres: 0.1, citation: "x" }, targetLotAcres: null });
    expect(tiny.yield.high.value).toBe(3);
    expect(tiny.yield.low.value).toBe(3);
  });
});

describe("§8.2 test 7 — a missing fact widens or refuses; a deduction is never silently zero", () => {
  for (const [field, key] of [
    ["floodwayAcres", "floodway"],
    ["easementAcres", "easement"],
    ["unbuildableSlopeAcres", "unbuildable_slope"],
  ] as const) {
    it(`${key} absent: that line is not_determinable with a resolution path, the low end refuses naming it, the high end assumes nothing lost and says so`, () => {
      const e = estimateLotYield({ ...GOLDEN, [field]: null });
      const line = e.deductions.find((d) => d.key === key)!;
      expect(line).toMatchObject({ status: "not_determinable", acres: null });
      expect(line.resolution).toBeTruthy();
      expect(e.notDeterminable).toEqual([key]);
      // Every low end — before roads, after roads, and in lots — is refused, never zero-filled.
      expect(e.afterDeductions.low.value).toBeNull();
      expect(e.netBuildable.low.value).toBeNull();
      expect(e.yield.low.value).toBeNull();
      expect(e.yield.low.refusedReason).toContain(key);
      expect(e.netBuildable.high.basis).toContain(`assumes nothing lost to ${key}`);
      // The high end is gross less only the STATED deductions — larger than golden.
      expect(e.yield.high.value!).toBeGreaterThan(27);
    });
  }

  it("a stated ZERO is a statement, not an absence: it computes and is not listed as not determinable", () => {
    const e = estimateLotYield({ ...GOLDEN, floodwayAcres: fact(0, "FEMA panel: zone X, no floodway") });
    expect(e.deductions[0]).toMatchObject({ status: "stated", acres: 0 });
    expect(e.notDeterminable).toEqual([]);
    expect(e.yield.low.value).not.toBeNull();
  });

  it("all three absent: low refused naming all three; high is gross less roads only", () => {
    const e = estimateLotYield({ ...GOLDEN, floodwayAcres: null, easementAcres: null, unbuildableSlopeAcres: null });
    expect(e.notDeterminable).toEqual(["floodway", "easement", "unbuildable_slope"]);
    expect(e.netBuildable.high.value).toBe(34); // 40 × 0.85
    expect(e.yield.high.value).toBe(34);
    expect(e.yield.low.value).toBeNull();
  });

  it("whole-estimate refusals name the missing input: gross acres, roads %, lot basis", () => {
    expect(estimateLotYield({ ...GOLDEN, grossAcres: null }).refusedReason).toMatch(/gross acreage/);
    expect(estimateLotYield({ ...GOLDEN, roadsRowFraction: null }).refusedReason).toMatch(/roads/);
    expect(estimateLotYield({ ...GOLDEN, roadsRowFraction: 1 }).refusedReason).toMatch(/roads/);
    expect(estimateLotYield({ ...GOLDEN, minimumLot: null, targetLotAcres: null }).refusedReason).toMatch(/lot-size basis/);
    for (const bad of [estimateLotYield({ ...GOLDEN, grossAcres: null })]) {
      expect(bad.yield.low.value).toBeNull();
      expect(bad.yield.high.value).toBeNull();
    }
  });

  it("a stated roads allowance of 0 is valid and computes", () => {
    expect(estimateLotYield({ ...GOLDEN, roadsRowFraction: 0 }).netBuildable.high.value).toBe(32.5);
  });

  it("one lot basis only: both ends divide by it", () => {
    const e = estimateLotYield({ ...GOLDEN, targetLotAcres: null });
    expect(e.yield.low.value).toBe(27);
    expect(e.yield.high.value).toBe(27);
  });

  it("a target lot SMALLER than the stated minimum is never divided by (audit 2026-11-05): the minimum is a floor", () => {
    // net 1.8 ac (gross 1.8, no deductions, no roads); minimum 1 ac; target 0.5 ac.
    const e = estimateLotYield({ ...GOLDEN, grossAcres: fact(1.8), floodwayAcres: fact(0), easementAcres: fact(0), unbuildableSlopeAcres: fact(0), roadsRowFraction: 0, minimumLot: { acres: 1, citation: "regs" }, targetLotAcres: 0.5 });
    expect([e.yield.low.value, e.yield.high.value]).toEqual([1, 1]);
    expect(e.yield.high.basis).toMatch(/your target 0\.5 ac is below it and is not used/);
  });

  it("deductions larger than the parcel floor at zero acres, zero lots — never negative", () => {
    const e = estimateLotYield({ ...GOLDEN, floodwayAcres: fact(50) });
    expect(e.netBuildable.high.value).toBe(0);
    expect(e.yield.high.value).toBe(0);
  });
});

describe("§8.2 test 8 — disagreement preserved: drawn vs estimated, neither overwritten", () => {
  // Estimate 8–10: gross 13.5 ac, no deductions, roads 0.1 → net 12.15;
  // ÷ 1.2 ac → 10 (high); ÷ 1.5 ac → 8 (low).
  const inputs: LotYieldInputs = {
    grossAcres: fact(13.5),
    floodwayAcres: fact(0),
    easementAcres: fact(0),
    unbuildableSlopeAcres: fact(0),
    roadsRowFraction: 0.1,
    minimumLot: { acres: 1.2, citation: "operator-stated" },
    targetLotAcres: 1.5,
  };
  const e = estimateLotYield(inputs);

  it("the fixture is the 8–10 range", () => {
    expect([e.yield.low.value, e.yield.high.value]).toEqual([8, 10]);
  });

  it("a plan drawn at 12 renders BOTH numbers and reads above the range; inputs are untouched", () => {
    const plans = Object.freeze([Object.freeze({ planId: "p1", name: "Plan A", lotCount: 12 }), Object.freeze({ planId: "p2", name: "Plan B", lotCount: 9 })]);
    const before = JSON.stringify({ e, plans });
    const r = reconcileWithDrawnPlans(e, plans);
    expect(r[0]).toMatchObject({ drawn: 12, estimateLow: 8, estimateHigh: 10, relation: "above_range" });
    expect(r[0].statement).toBe("Plan A: drawn 12 lots vs estimated range 8–10 — the drawing exceeds the estimate");
    expect(r[1]).toMatchObject({ drawn: 9, relation: "within_range" });
    expect(JSON.stringify({ e, plans })).toBe(before);
  });

  it("a plan under the range reads below; a plan with no lots drawn is not compared", () => {
    const r = reconcileWithDrawnPlans(e, [
      { planId: "p3", name: "Plan C", lotCount: 5 },
      { planId: "p4", name: "Plan D", lotCount: null },
    ]);
    expect(r[0].relation).toBe("below_range");
    expect(r[1]).toMatchObject({ relation: "not_comparable", statement: "Plan D: no lots drawn yet; estimated range 8–10" });
  });

  it("with the low end not determinable, only 'above' is decidable", () => {
    const partial = estimateLotYield({ ...inputs, floodwayAcres: null });
    const r = reconcileWithDrawnPlans(partial, [
      { planId: "a", name: "A", lotCount: 99 },
      { planId: "b", name: "B", lotCount: 3 },
    ]);
    expect(r[0].relation).toBe("above_range");
    expect(r[1].relation).toBe("not_comparable");
    expect(r[1].statement).toContain("low end not determinable");
  });
});

