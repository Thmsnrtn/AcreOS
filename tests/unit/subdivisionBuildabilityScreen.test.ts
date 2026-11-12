/**
 * Subdivision V1, Leg 1 — the buildability screen (buildability-screen v1).
 * Package 2026-11-05 §3 / §8.1 tests 1, 2, 3 and 5 (test 4 is the route's).
 * Pure module; every fact below is synthetic.
 */
import { describe, expect, it } from "vitest";
import {
  runBuildabilityScreen,
  type RecordedFact,
  type ScreenFacts,
  type ScreenThresholds,
} from "../../shared/subdivision/buildabilityScreen";
import { estimateLotYield } from "../../shared/subdivision/lotYield";

const f = <T,>(value: T, source = "operator-recorded", asOf: string | null = "2026-11-01"): RecordedFact<T> => ({ value, source, asOf });

/** §3.2's seven triggers, in order (stated here, not imported, so the list is checked rather than echoed). */
const TRIGGER_IDS = ["no_legal_access", "flood", "septic", "unresolved_easement", "slope", "no_water_or_wastewater_path", "sub_minimum_yield"] as const;

const NOTHING: ScreenFacts = {
  legalAccess: null,
  grossAcres: null,
  floodwayAcres: null,
  floodplainAcres: null,
  percResult: null,
  sewerAvailable: null,
  waterAvailable: null,
  unresolvedEasementAcres: null,
  maxSlopePct: null,
  percEstimate: null,
};
const NO_THRESHOLDS: ScreenThresholds = { floodplainShareMax: null, maxBuildableSlopePct: null };

/** A parcel with every fact recorded and every trigger clear. */
const CLEAN: ScreenFacts = {
  legalAccess: f("recorded_access" as const, "deed book 1234 p. 56"),
  grossAcres: f(40, "county GIS"),
  floodwayAcres: f(0, "FEMA panel 47187C0210F"),
  floodplainAcres: f(4, "FEMA panel 47187C0210F"),
  percResult: f("pass" as const, "perc test by A. Soil, 2026-09-12"),
  sewerAvailable: f(false, "utility letter"),
  waterAvailable: f(true, "utility letter"),
  unresolvedEasementAcres: f(0, "title commitment"),
  maxSlopePct: f(12, "topo survey"),
  percEstimate: null,
};
const THRESHOLDS: ScreenThresholds = { floodplainShareMax: 0.2, maxBuildableSlopePct: 15 };
const YIELD = estimateLotYield({
  grossAcres: CLEAN.grossAcres,
  floodwayAcres: CLEAN.floodwayAcres,
  easementAcres: f(0),
  unbuildableSlopeAcres: f(0),
  roadsRowFraction: 0.15,
  minimumLot: { acres: 1, citation: "regs" },
  targetLotAcres: 2,
});
const verdictOf = (r: ReturnType<typeof runBuildabilityScreen>, id: string) => r.verdicts.find((v) => v.id === id)!;

describe("the seven triggers, three verdicts", () => {
  it("covers exactly the §3.2 set, in order", () => {
    const r = runBuildabilityScreen(CLEAN, THRESHOLDS, YIELD);
    expect(r.verdicts.map((v) => v.id)).toEqual([...TRIGGER_IDS]);
    expect(TRIGGER_IDS).toHaveLength(7);
  });

  it("a fully-recorded clean parcel: every trigger clear on evidence, every verdict carries its evidence, none a resolution path", () => {
    const r = runBuildabilityScreen(CLEAN, THRESHOLDS, YIELD);
    for (const v of r.verdicts) {
      expect(v.verdict, v.id).toBe("clear_on_evidence");
      expect(v.evidence.length, v.id).toBeGreaterThan(0);
      expect(v.resolution, v.id).toBeNull();
    }
    expect(r.headline).toBe("No kill trigger fired on the facts recorded — every trigger determined");
  });
});

describe("§8.1 test 1 — trigger boundaries", () => {
  // Floodplain 4 of 40 ac = 10% exactly.
  it.each([
    [0.11, "clear_on_evidence"],
    [0.1, "clear_on_evidence"], // AT the threshold: not "exceeds"
    [0.09, "triggered"],
  ])("floodplain share 10%% against a stated %s → %s", (max, expected) => {
    expect(verdictOf(runBuildabilityScreen(CLEAN, { ...THRESHOLDS, floodplainShareMax: max }, YIELD), "flood").verdict).toBe(expected);
  });

  it.each([
    [13, "clear_on_evidence"],
    [12, "clear_on_evidence"], // AT the threshold
    [11, "triggered"],
  ])("slope 12%% against a stated %s%% → %s", (max, expected) => {
    expect(verdictOf(runBuildabilityScreen(CLEAN, { ...THRESHOLDS, maxBuildableSlopePct: max }, YIELD), "slope").verdict).toBe(expected);
  });

  it("any floodway acreage fires the flood trigger whatever the threshold", () => {
    const r = runBuildabilityScreen({ ...CLEAN, floodwayAcres: f(0.5) }, { ...THRESHOLDS, floodplainShareMax: 1 }, YIELD);
    expect(verdictOf(r, "flood")).toMatchObject({ verdict: "triggered", reason: "0.5 ac lie in the regulatory floodway" });
  });

  it("a threshold the rule needs but the run did not state is not determinable — never a platform default", () => {
    const r = runBuildabilityScreen(CLEAN, NO_THRESHOLDS, YIELD);
    expect(verdictOf(r, "flood")).toMatchObject({ verdict: "not_determinable", reason: expect.stringMatching(/no floodplain-share threshold stated/) });
    expect(verdictOf(r, "slope")).toMatchObject({ verdict: "not_determinable", reason: expect.stringMatching(/no build threshold stated/) });
    // But no floodplain at all needs no threshold to clear.
    expect(verdictOf(runBuildabilityScreen({ ...CLEAN, floodplainAcres: f(0) }, NO_THRESHOLDS, YIELD), "flood").verdict).toBe("clear_on_evidence");
  });

  it("legal access: none, or only an unrecorded easement, fires; recorded access clears", () => {
    expect(verdictOf(runBuildabilityScreen({ ...CLEAN, legalAccess: f("no_legal_access" as const) }, THRESHOLDS, YIELD), "no_legal_access").verdict).toBe("triggered");
    expect(verdictOf(runBuildabilityScreen({ ...CLEAN, legalAccess: f("unrecorded_easement_only" as const) }, THRESHOLDS, YIELD), "no_legal_access").verdict).toBe("triggered");
  });

  it("sub-minimum yield: fires under 2 lots at the HIGH end; clears only when the LOW end is ≥ 2", () => {
    const small = estimateLotYield({ grossAcres: f(1.5), floodwayAcres: f(0), easementAcres: f(0), unbuildableSlopeAcres: f(0), roadsRowFraction: 0, minimumLot: { acres: 1, citation: "x" }, targetLotAcres: null });
    expect(verdictOf(runBuildabilityScreen(CLEAN, THRESHOLDS, small), "sub_minimum_yield").verdict).toBe("triggered");
    const partial = estimateLotYield({ grossAcres: f(40), floodwayAcres: null, easementAcres: f(0), unbuildableSlopeAcres: f(0), roadsRowFraction: 0.1, minimumLot: { acres: 1, citation: "x" }, targetLotAcres: null });
    expect(verdictOf(runBuildabilityScreen(CLEAN, THRESHOLDS, partial), "sub_minimum_yield").verdict).toBe("not_determinable");
  });
});

describe("§8.1 test 2 — unknown is not clear", () => {
  const r = runBuildabilityScreen(NOTHING, NO_THRESHOLDS, null);

  it("a parcel with no flood, access or soil facts returns those triggers not determinable — all seven, here", () => {
    expect(r.verdicts.map((v) => v.verdict)).toEqual(Array(7).fill("not_determinable"));
    expect(r.notDeterminable).toEqual([...TRIGGER_IDS]);
    expect(r.triggered).toEqual([]);
  });

  it("the headline counts them and names them, and never asserts buildability", () => {
    expect(r.headline).toMatch(/^No kill trigger fired on the facts recorded — 7 of 7 triggers not determinable \(no legal access; /);
    for (const v of r.verdicts) expect(r.headline).toContain(v.label.toLowerCase());
    // Structural: no headline, verdict or state of any run asserts a parcel IS buildable.
    for (const facts of [NOTHING, CLEAN]) {
      const out = runBuildabilityScreen(facts, THRESHOLDS, YIELD);
      expect(out.headline).not.toMatch(/\bbuildable\b/i);
      for (const v of out.verdicts) expect(["triggered", "clear_on_evidence", "not_determinable"]).toContain(v.verdict);
    }
  });

  it("one recorded clear fact never clears its neighbours", () => {
    const one = runBuildabilityScreen({ ...NOTHING, legalAccess: f("recorded_access" as const) }, NO_THRESHOLDS, null);
    expect(one.notDeterminable).toHaveLength(6);
    expect(one.headline).toMatch(/6 of 7 triggers not determinable/);
  });
});

describe("§8.1 test 3 — recorded facts fire and clear; no perc probability anywhere", () => {
  it("a recorded perc failure with no sewer fact fires; adding sewer availability clears it on evidence", () => {
    const failed = { ...NOTHING, percResult: f("fail" as const, "perc test by A. Soil") };
    expect(verdictOf(runBuildabilityScreen(failed, NO_THRESHOLDS, null), "septic")).toMatchObject({
      verdict: "triggered",
      reason: "a recorded perc failure, with no sewer path recorded",
    });
    const sewered = { ...failed, sewerAvailable: f(true, "utility letter") };
    const v = verdictOf(runBuildabilityScreen(sewered, NO_THRESHOLDS, null), "septic");
    expect(v.verdict).toBe("clear_on_evidence");
    expect(v.evidence.map((e) => e.fact)).toContain("public sewer available");
  });

  it("no perc result and no sewer fact: not determinable, with a perc test as the priced path", () => {
    expect(verdictOf(runBuildabilityScreen(NOTHING, NO_THRESHOLDS, null), "septic").resolution).toMatchObject({ action: expect.stringMatching(/perc test/), cost: "ordered service" });
  });

  it("no payload carries a perc probability, pass-rate, or synonym (§3.4)", () => {
    for (const facts of [NOTHING, CLEAN, { ...CLEAN, percResult: f("fail" as const) }]) {
      const json = JSON.stringify(runBuildabilityScreen(facts, THRESHOLDS, YIELD));
      expect(json).not.toMatch(/probabilit|pass[-_ ]?rate|likelihood|chance/i);
    }
  });
});

describe("unknown is not clear — EXHAUSTIVELY: every fact a clear verdict REQUIRES, removed one at a time (audit 2026-11-05)", () => {
  // Bases in which each listed fact is the ONLY route to the trigger's clear
  // verdict; removing it must leave that trigger not clear.
  const PERC_ONLY: ScreenFacts = { ...CLEAN, sewerAvailable: null }; // septic + utilities clear on the passed perc alone
  const SEWER_ONLY: ScreenFacts = { ...CLEAN, percResult: null, sewerAvailable: f(true, "utility letter") };
  const NO_FLOODPLAIN: ScreenFacts = { ...CLEAN, floodplainAcres: f(0, "FEMA panel") };
  const CASES: ReadonlyArray<[string, ScreenFacts, keyof ScreenFacts, string]> = [
    ["clean", CLEAN, "legalAccess", "no_legal_access"],
    ["clean", CLEAN, "floodwayAcres", "flood"],
    ["clean", CLEAN, "floodplainAcres", "flood"],
    ["clean", CLEAN, "grossAcres", "flood"],
    ["no floodplain", NO_FLOODPLAIN, "floodwayAcres", "flood"],
    ["no floodplain", NO_FLOODPLAIN, "floodplainAcres", "flood"],
    ["perc only", PERC_ONLY, "percResult", "septic"],
    ["sewer only", SEWER_ONLY, "sewerAvailable", "septic"],
    ["clean", CLEAN, "unresolvedEasementAcres", "unresolved_easement"],
    ["clean", CLEAN, "maxSlopePct", "slope"],
    ["clean", CLEAN, "waterAvailable", "no_water_or_wastewater_path"],
    ["perc only", PERC_ONLY, "percResult", "no_water_or_wastewater_path"],
    ["sewer only", SEWER_ONLY, "sewerAvailable", "no_water_or_wastewater_path"],
  ];
  for (const [name, base, fact, trigger] of CASES) {
    it(`${name}: ${trigger} is clear with ${fact}, and NOT clear without it`, () => {
      expect(verdictOf(runBuildabilityScreen(base, THRESHOLDS, YIELD), trigger).verdict).toBe("clear_on_evidence");
      expect(verdictOf(runBuildabilityScreen({ ...base, [fact]: null }, THRESHOLDS, YIELD), trigger).verdict).not.toBe("clear_on_evidence");
    });
  }
  it("slope and flood are not clear without their stated thresholds", () => {
    expect(verdictOf(runBuildabilityScreen(CLEAN, { ...THRESHOLDS, maxBuildableSlopePct: null }, YIELD), "slope").verdict).not.toBe("clear_on_evidence");
    expect(verdictOf(runBuildabilityScreen(CLEAN, { ...THRESHOLDS, floodplainShareMax: null }, YIELD), "flood").verdict).not.toBe("clear_on_evidence");
  });

  it("a sub-minimum parcel with a target BELOW the stated minimum still fires sub-minimum yield (audit 2026-11-05)", () => {
    const y = estimateLotYield({ grossAcres: f(1.8), floodwayAcres: f(0), easementAcres: f(0), unbuildableSlopeAcres: f(0), roadsRowFraction: 0, minimumLot: { acres: 1, citation: "regs" }, targetLotAcres: 0.5 });
    expect(verdictOf(runBuildabilityScreen(CLEAN, THRESHOLDS, y), "sub_minimum_yield").verdict).toBe("triggered");
  });
});

describe("resolution paths are specific to what is missing (audit 2026-11-05)", () => {
  it("a missing THRESHOLD resolves by stating it — free, now — not by ordering a survey", () => {
    const r = runBuildabilityScreen(CLEAN, NO_THRESHOLDS, YIELD);
    expect(verdictOf(r, "flood").resolution).toEqual({ action: "state your floodplain-share threshold for this run", cost: "free, now", owner: "you" });
    expect(verdictOf(r, "slope").resolution).toEqual({ action: "state your slope build threshold for this run", cost: "free, now", owner: "you" });
  });
  it("a missing gross acreage (floodplain recorded) resolves by stating it", () => {
    expect(verdictOf(runBuildabilityScreen({ ...CLEAN, grossAcres: null }, THRESHOLDS, YIELD), "flood").resolution?.action).toMatch(/^state the parcel's gross acreage/);
  });
  it("a missing FACT about the land keeps the trigger's priced path", () => {
    expect(verdictOf(runBuildabilityScreen({ ...CLEAN, maxSlopePct: null }, THRESHOLDS, YIELD), "slope").resolution?.action).toMatch(/topographic survey/);
  });
});

describe("§8.1 test 5 — every not-determinable verdict carries a priced resolution path", () => {
  it("each of the seven, when not determinable, names action, cost and owner", () => {
    for (const v of runBuildabilityScreen(NOTHING, NO_THRESHOLDS, null).verdicts) {
      expect(v.resolution, v.id).toMatchObject({ action: expect.any(String), cost: expect.any(String), owner: expect.any(String) });
      expect(v.resolution!.action.length, v.id).toBeGreaterThan(5);
    }
  });
});
