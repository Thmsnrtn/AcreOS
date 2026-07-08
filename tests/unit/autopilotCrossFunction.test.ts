import { describe, it, expect } from "vitest";
import {
  pressuresFromSenses,
  netLeverage,
  coordinationWeights,
  rankDomainsByLeverage,
} from "../../server/services/autopilot/crossFunction";
import { buildOkrTree, okrLine } from "../../server/services/autopilot/okr";
import type { DecisionSenses } from "../../server/services/autopilot/decide";
import type { AutopilotObjective } from "@shared/schema";

const calm: DecisionSenses = {
  openIncidents: 0, complianceOpenCount: 0, envelopeStatus: "green", supportBacklog: 0,
  trials: 0, activationStalled: false, mrr: 0, dispatchBacklog: 0,
};

describe("crossFunction — second-order coordination (the key H3 insight)", () => {
  it("derives per-domain pressure from real senses", () => {
    const p = pressuresFromSenses({ ...calm, supportBacklog: 10, envelopeStatus: "red" });
    expect(p.support).toBe(1); // clamped
    expect(p.finance).toBe(1);
    expect(p.growth).toBe(0);
  });

  it("DAMPENS growth's net leverage when support is underwater", () => {
    const stressed = pressuresFromSenses({ ...calm, supportBacklog: 10 }); // support pressure high
    const calmP = pressuresFromSenses(calm);
    // growth adds support load (coupling +0.3), so its net leverage is lower
    // when support is already stressed than when support is calm.
    expect(netLeverage("growth", stressed)).toBeLessThan(netLeverage("growth", calmP));
  });

  it("ranks the true bottleneck (most-pressured, least-coupled-cost) first", () => {
    const ranked = rankDomainsByLeverage({ ...calm, supportBacklog: 10 });
    expect(ranked[0].domain).toBe("support"); // support is the bottleneck
  });

  it("coordination weights stay bounded ~[0.5,1.5] so they only reorder, never override tiers", () => {
    const w = coordinationWeights({ ...calm, supportBacklog: 50, envelopeStatus: "red" });
    for (const d of Object.keys(w) as Array<keyof typeof w>) {
      expect(w[d]).toBeGreaterThanOrEqual(0.5);
      expect(w[d]).toBeLessThanOrEqual(1.5);
    }
  });

  it("is neutral (~1.0 each) when nothing is stressed", () => {
    const w = coordinationWeights(calm);
    for (const d of Object.keys(w) as Array<keyof typeof w>) expect(w[d]).toBeCloseTo(1, 1);
  });
});

function obj(over: Partial<AutopilotObjective>): AutopilotObjective {
  return { id: 1, key: "k", label: "L", target: 100, current: 0, unit: "count", owningDomain: "growth", deadline: null, active: true, createdBy: null, createdAt: null, updatedAt: null, ...over } as AutopilotObjective;
}

describe("okr — rollup tree + binding constraint", () => {
  it("rolls up per-domain progress and finds the most-limiting objective", () => {
    const tree = buildOkrTree([
      obj({ key: "signups", label: "Signups", owningDomain: "growth", current: 1, target: 10 }), // 10%
      obj({ key: "sla", label: "First reply", owningDomain: "support", current: 8, target: 10 }), // 80%
    ]);
    expect(tree.bindingConstraint?.key).toBe("signups"); // lowest, unmet
    expect(tree.domains[0].domain).toBe("growth"); // most-behind domain first
    expect(tree.progress).toBeGreaterThan(0);
    expect(tree.progress).toBeLessThan(1);
  });

  it("reports all-met when every objective is satisfied", () => {
    const tree = buildOkrTree([obj({ current: 100, target: 100 })]);
    expect(tree.bindingConstraint).toBeNull();
    expect(okrLine(tree)).toContain("All objectives met");
  });

  it("handles the empty case", () => {
    expect(okrLine(buildOkrTree([]))).toContain("none set");
  });
});
