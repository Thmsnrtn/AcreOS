import { describe, it, expect } from "vitest";
import { applyObjectiveWeighting, rankMoves, type DecisionSenses, type RankedMove } from "../../server/services/autopilot/decide";
import { selectProactiveGrowthPlay, growthFunnelLine } from "../../server/services/autopilot/growthEngine";
import { makeSeededRng, type PlayStats } from "../../server/services/autopilot/efficacy";

const calm: DecisionSenses = {
  openIncidents: 0,
  complianceOpenCount: 0,
  envelopeStatus: "green",
  supportBacklog: 0,
  trials: 0,
  activationStalled: false,
  mrr: 0,
  dispatchBacklog: 0,
};

describe("decide — applyObjectiveWeighting (P5 → brain)", () => {
  it("never crosses priority tiers (safety ladder preserved)", () => {
    const moves = rankMoves({ ...calm, openIncidents: 1, supportBacklog: 1 });
    const weighted = applyObjectiveWeighting(moves, { support: 2, deploy: 1 });
    // The P0 stabilize move must still be first regardless of objective urgency.
    expect(weighted[0].priority).toBe(0);
    expect(weighted.map((m) => m.priority)).toEqual([...weighted.map((m) => m.priority)].sort((a, b) => a - b));
  });

  it("orders WITHIN a tier by domain urgency, stably", () => {
    const moves: RankedMove[] = [
      { priority: 4, domain: "ops", kind: "a", rationale: "" },
      { priority: 4, domain: "growth", kind: "b", rationale: "" },
      { priority: 4, domain: "finance", kind: "c", rationale: "" },
    ];
    const out = applyObjectiveWeighting(moves, { growth: 1.9, finance: 1.2, ops: 1 });
    expect(out.map((m) => m.kind)).toEqual(["b", "c", "a"]); // growth > finance > ops
  });

  it("is a no-op when all urgencies are neutral", () => {
    const moves = rankMoves(calm);
    expect(applyObjectiveWeighting(moves, {}).map((m) => m.kind)).toEqual(moves.map((m) => m.kind));
  });
});

describe("growthEngine — proactive, conversion-weighted play selection", () => {
  it("falls back to rotation while cold (no outcome data yet)", () => {
    const rng = makeSeededRng(1);
    const a = selectProactiveGrowthPlay([], 0, rng);
    const b = selectProactiveGrowthPlay([], 1, rng);
    expect(a.id).toBeTruthy();
    expect(a.id).not.toBe(b.id); // rotation advances
  });

  it("favors a proven converter once real outcomes exist", () => {
    const stats: PlayStats[] = [
      { playId: "county-guide", successes: 20, failures: 1 },
      { playId: "buyer-faq", successes: 0, failures: 20 },
    ];
    // Across several samples the strong play should dominate.
    const rng = makeSeededRng(42);
    const picks = Array.from({ length: 20 }, (_, i) => selectProactiveGrowthPlay(stats, i, rng).id);
    const winners = picks.filter((p) => p === "county-guide").length;
    expect(winners).toBeGreaterThan(10);
  });
});

describe("growthEngine — funnel line", () => {
  it("reports the attribution rate", () => {
    expect(growthFunnelLine(12, 4, 1)).toContain("25%");
    expect(growthFunnelLine(0, 0, 0)).toContain("0%");
  });
});
