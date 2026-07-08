import { describe, it, expect } from "vitest";
import { aggregateCouncil, councilConfidence, type CouncilVote } from "../../server/services/autopilot/council";

/**
 * Frontier #8 — measured disagreement. The council quantifies how divided the
 * voices are and turns that into a confidence multiplier that can only TIGHTEN
 * escalation (combined by MIN with calibration confidence downstream).
 */
const votes = (...kinds: string[]): CouncilVote[] => kinds.map((recommendedKind) => ({ recommendedKind }));

describe("aggregateCouncil", () => {
  it("unanimous → full agreement, zero disagreement", () => {
    const a = aggregateCouncil(votes("grow", "grow", "grow"));
    expect(a.consensusKind).toBe("grow");
    expect(a.agreement).toBe(1);
    expect(a.disagreement).toBe(0);
    expect(a.votes).toBe(3);
  });
  it("a 2-1 split → consensus is the majority, agreement 2/3", () => {
    const a = aggregateCouncil(votes("grow", "grow", "support"));
    expect(a.consensusKind).toBe("grow");
    expect(a.agreement).toBeCloseTo(2 / 3, 6);
    expect(a.tally).toEqual({ grow: 2, support: 1 });
  });
  it("a 3-way tie → deeply divided (agreement 1/3)", () => {
    const a = aggregateCouncil(votes("a", "b", "c"));
    expect(a.agreement).toBeCloseTo(1 / 3, 6);
    expect(a.disagreement).toBeCloseTo(2 / 3, 6);
  });
  it("drops malformed votes; empty panel = null consensus + full agreement (no signal)", () => {
    const a = aggregateCouncil([{ recommendedKind: "" }, null as unknown as CouncilVote, { recommendedKind: "x" }]);
    expect(a.consensusKind).toBe("x");
    expect(a.votes).toBe(1);
    expect(aggregateCouncil([])).toEqual({ consensusKind: null, votes: 0, agreement: 1, disagreement: 0, tally: {} });
  });
});

describe("councilConfidence — disagreement → caution (mirrors calibration bands)", () => {
  it("a panel too small to disagree yields no penalty", () => {
    expect(councilConfidence(aggregateCouncil(votes("a")))).toBe(1);
    expect(councilConfidence(aggregateCouncil([]))).toBe(1);
  });
  it("unanimous → 1, clear majority → 0.7, bare majority → 0.5, tie → 0.3", () => {
    expect(councilConfidence(aggregateCouncil(votes("a", "a", "a")))).toBe(1);
    expect(councilConfidence(aggregateCouncil(votes("a", "a", "a", "b")))).toBe(0.7); // 3/4 ≥ 2/3
    expect(councilConfidence(aggregateCouncil(votes("a", "a", "b")))).toBe(0.7); // 2/3
    expect(councilConfidence(aggregateCouncil(votes("a", "a", "a", "b", "c")))).toBe(0.5); // 3/5 = 0.6 (>0.5, <2/3)
    expect(councilConfidence(aggregateCouncil(votes("a", "a", "b", "c")))).toBe(0.3); // 2/4 = 0.5 exactly → tie band
    expect(councilConfidence(aggregateCouncil(votes("a", "b", "c")))).toBe(0.3); // 1/3 ≤ 0.5
  });
  it("is monotone — more agreement never yields LESS confidence", () => {
    const split = councilConfidence(aggregateCouncil(votes("a", "b", "c")));
    const majority = councilConfidence(aggregateCouncil(votes("a", "a", "c")));
    const unanimous = councilConfidence(aggregateCouncil(votes("a", "a", "a")));
    expect(split).toBeLessThanOrEqual(majority);
    expect(majority).toBeLessThanOrEqual(unanimous);
  });
});
