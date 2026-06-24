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

import { loopConfidenceFrom } from "../../server/services/autopilot/forecast";
import { MAX_EVIDENCE_PER_LEVER, landEvidenceByLever } from "../../server/services/autopilot/packs/land/causalModel";

describe("T2.4 — calibration is load-bearing (loopConfidence tightens escalation)", () => {
  const medium = { tier: "medium" as const, score: 2, reasons: ["it reaches a customer"] };
  const high = { tier: "high" as const, score: 4, reasons: ["irreversible"] };
  const low = { tier: "low" as const, score: 0, reasons: [] };

  it("full confidence preserves the high-only behavior", () => {
    expect(shouldEscalateForRisk(true, medium, 1)).toBe(false);
    expect(shouldEscalateForRisk(true, high, 1)).toBe(true);
  });
  it("low confidence escalates a MEDIUM action too (tighten-only)", () => {
    expect(shouldEscalateForRisk(true, medium, 0.2)).toBe(true);
    expect(shouldEscalateForRisk(true, low, 0.2)).toBe(false); // low risk never escalates
  });
  it("never escalates when the domain gate didn't pass (no false positives)", () => {
    expect(shouldEscalateForRisk(false, high, 0.2)).toBe(false);
  });
  it("loopConfidenceFrom: over-confident lowest, well-calibrated full", () => {
    expect(loopConfidenceFrom({ brier: 0.3, n: 50, grade: "over-confident", bins: [] })).toBeLessThan(0.5);
    expect(loopConfidenceFrom({ brier: null, n: 0, grade: "unproven", bins: [] })).toBeLessThan(0.5);
    expect(loopConfidenceFrom({ brier: 0.1, n: 50, grade: "well-calibrated", bins: [] })).toBe(1);
  });
});

describe("T2.4 — learning-loop poisoning resistance (evidence cap)", () => {
  it("caps a flood of consequences per lever so the model can't be slammed", () => {
    const flood = Array.from({ length: 500 }, () => ({ moveKind: "grow_owned_channels", paymentRecovered: true }));
    const ev = landEvidenceByLever(flood);
    expect(ev.publish_guide.successes).toBe(MAX_EVIDENCE_PER_LEVER);
  });
});
