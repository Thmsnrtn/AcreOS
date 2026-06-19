import { describe, it, expect } from "vitest";
import {
  decisionQualityReport,
  replayPolicy,
  agreementProxy,
  decisionEvalLine,
  MIN_RESOLVED_FOR_SIGNAL,
  type DecisionRecord,
} from "../../server/services/autopilot/decisionEval";

function rec(over: Partial<DecisionRecord> = {}): DecisionRecord {
  return { moveKind: "grow_owned_channels", domain: "growth", senses: {}, predictedSuccess: 0.7, vote: "success", ...over };
}

function many(n: number, vote: DecisionRecord["vote"], predicted = 0.7): DecisionRecord[] {
  return Array.from({ length: n }, () => rec({ vote, predictedSuccess: predicted }));
}

describe("decisionEval — quality report (E1 keystone, cold-start-safe)", () => {
  it("refuses to score below the signal threshold", () => {
    const r = decisionQualityReport(many(5, "success"));
    expect(r.sufficient).toBe(false);
    expect(r.resolved).toBe(5);
  });

  it("computes hit-rate over resolved decisions, ignoring pending", () => {
    const r = decisionQualityReport([...many(15, "success"), ...many(5, "failure"), ...many(10, "pending")]);
    expect(r.resolved).toBe(20);
    expect(r.successRate).toBeCloseTo(0.75); // 15/20
    expect(r.sufficient).toBe(true);
  });

  it("calibration error is low when forecasts match outcomes", () => {
    // 20 wins all predicted 0.9 → |0.9-1| = 0.1 each
    const r = decisionQualityReport(many(20, "success", 0.9));
    expect(r.calibrationError).toBeCloseTo(0.1);
    expect(r.brier).toBeCloseTo(0.01); // (0.9-1)^2
  });

  it("calibration error is high when the brain is overconfident on losses", () => {
    const r = decisionQualityReport(many(20, "failure", 0.9)); // predicted 0.9, actual 0
    expect(r.calibrationError).toBeCloseTo(0.9);
  });

  it("handles zero records honestly", () => {
    const r = decisionQualityReport([]);
    expect(r.successRate).toBeNull();
    expect(r.brier).toBeNull();
    expect(r.sufficient).toBe(false);
  });
});

describe("decisionEval — replay + honest off-policy proxy", () => {
  const records: DecisionRecord[] = [
    rec({ moveKind: "a", vote: "success", senses: { x: 1 } }),
    rec({ moveKind: "b", vote: "failure", senses: { x: 2 } }),
    rec({ moveKind: "a", vote: "success", senses: { x: 3 } }),
  ];

  it("replays a candidate policy over logged situations", () => {
    const replay = replayPolicy(records, (s) => ((s as any).x === 2 ? "c" : "a"));
    expect(replay.map((r) => r.chosen)).toEqual(["a", "c", "a"]);
  });

  it("a policy that matches the wins + dodges the loss scores high on the proxy", () => {
    // candidate picks 'a' on wins (agree) and 'c' on the loss (diverge from 'b')
    const replay = replayPolicy(records, (s) => ((s as any).x === 2 ? "c" : "a"));
    const proxy = agreementProxy(replay);
    expect(proxy.agreementOnWins).toBe(1); // matched both wins
    expect(proxy.divergenceOnLosses).toBe(1); // avoided the losing move
    expect(proxy.caveat).toContain("necessary-not-sufficient");
  });

  it("a policy that repeats the losing move diverges 0% on losses", () => {
    const replay = replayPolicy(records, () => "b"); // always 'b' (the loser)
    const proxy = agreementProxy(replay);
    expect(proxy.divergenceOnLosses).toBe(0);
  });
});

describe("decisionEval — letter line", () => {
  it("says cold-start when insufficient", () => {
    expect(decisionEvalLine(decisionQualityReport(many(3, "success")))).toContain("cold start");
  });
  it("reports the hit-rate when sufficient", () => {
    const line = decisionEvalLine(decisionQualityReport(many(MIN_RESOLVED_FOR_SIGNAL, "success", 0.8)));
    expect(line).toContain("hit-rate");
  });
});
