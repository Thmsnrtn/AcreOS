import { describe, it, expect } from "vitest";
import { assessRisk, shouldEscalateForRisk, type RiskFactors } from "../../server/services/autopilot/riskautonomy";

const base: RiskFactors = { reversible: true, customerFacing: false, predictedCostUsd: 5, noveltyN: 20 };

describe("autopilot risk-calibrated autonomy", () => {
  it("a reversible, proven, cheap, internal action is LOW risk", () => {
    expect(assessRisk(base).tier).toBe("low");
  });

  it("a novel action (low evidence) escalates the risk — 'I haven't done this enough to be sure'", () => {
    const novel = assessRisk({ ...base, noveltyN: 1 });
    expect(novel.score).toBeGreaterThanOrEqual(2);
    expect(novel.reasons.join(" ")).toMatch(/barely done this|can't be sure/i);
  });

  it("irreversible + customer-facing stacks to HIGH", () => {
    expect(assessRisk({ ...base, reversible: false, customerFacing: true }).tier).toBe("high");
  });

  it("expensive actions add risk", () => {
    expect(assessRisk({ ...base, predictedCostUsd: 12 }).reasons.join(" ")).toMatch(/cost up to \$12/);
    expect(assessRisk({ ...base, predictedCostUsd: 12 }).score).toBeGreaterThan(assessRisk(base).score);
  });

  it("SAFETY: risk only TIGHTENS — it escalates a permitted action, never loosens a denied one", () => {
    const high = assessRisk({ ...base, reversible: false, customerFacing: true });
    // domain permitted + high risk → escalate
    expect(shouldEscalateForRisk(true, high)).toBe(true);
    // domain NOT permitted → risk never grants autonomy (returns false = no override either way)
    expect(shouldEscalateForRisk(false, high)).toBe(false);
    // domain permitted + low risk → proceed
    expect(shouldEscalateForRisk(true, assessRisk(base))).toBe(false);
  });

  it("is total: extreme inputs never throw or produce NaN", () => {
    const r = assessRisk({ reversible: false, customerFacing: true, predictedCostUsd: 1e6, noveltyN: 0 });
    expect(r.tier).toBe("high");
    expect(Number.isFinite(r.score)).toBe(true);
  });
});
