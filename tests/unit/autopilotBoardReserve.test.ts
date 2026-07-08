import { describe, it, expect } from "vitest";
import { classifyReserve, attentionLoad, FOUNDER_RESERVE_VALUE_THRESHOLD_USD, type DecisionContext } from "../../server/services/autopilot/boardReserve";
import { composeBoardReport } from "../../server/services/autopilot/boardReport";

const delegableBase: DecisionContext = {
  reversible: true, valueUsd: 10, novel: false, touchesConstitution: false,
  touchesCapitalAllocation: false, isHumanRelationship: false, domainAutonomyEarned: true,
};

describe("boardReserve — the irreducible 0.1% (H4)", () => {
  it("a clean, reversible, low-stakes, earned action is delegable", () => {
    expect(classifyReserve(delegableBase).reserve).toBe("delegable");
  });

  it("reserves constitutional changes forever", () => {
    expect(classifyReserve({ ...delegableBase, touchesConstitution: true }).reserve).toBe("founder_reserve");
  });

  it("reserves irreversible high-stakes + capital above threshold", () => {
    expect(classifyReserve({ ...delegableBase, reversible: false, valueUsd: FOUNDER_RESERVE_VALUE_THRESHOLD_USD }).reserve).toBe("founder_reserve");
    expect(classifyReserve({ ...delegableBase, touchesCapitalAllocation: true, valueUsd: FOUNDER_RESERVE_VALUE_THRESHOLD_USD + 1 }).reserve).toBe("founder_reserve");
  });

  it("a small irreversible action is NOT reserved on stakes alone", () => {
    expect(classifyReserve({ ...delegableBase, reversible: false, valueUsd: 5 }).reserve).toBe("delegable");
  });

  it("reserves novel situations and human relationships", () => {
    expect(classifyReserve({ ...delegableBase, novel: true }).reserve).toBe("founder_reserve");
    expect(classifyReserve({ ...delegableBase, isHumanRelationship: true }).reserve).toBe("founder_reserve");
  });

  it("keeps the founder in the loop until the domain earns autonomy (earning phase)", () => {
    const v = classifyReserve({ ...delegableBase, domainAutonomyEarned: false });
    expect(v.reserve).toBe("founder_reserve");
    expect(v.reasons[0]).toContain("not yet earned");
  });
});

describe("boardReserve — attention load calibration", () => {
  it("flags over-budget when the founder is asked above the 0.1% target", () => {
    expect(attentionLoad(5, 100).overBudget).toBe(true); // 5%
    expect(attentionLoad(1, 100000).overBudget).toBe(false); // 0.001%
  });

  it("is not over budget with no decisions yet", () => {
    expect(attentionLoad(0, 0).overBudget).toBe(false);
  });
});

describe("boardReport — composition (H4)", () => {
  it("renders the three board sections + the zero-state", () => {
    const r = composeBoardReport({ topMove: null, pendingCount: 0, attention: attentionLoad(0, 0) });
    expect(r).toContain("What the company is working on");
    expect(r).toContain("running itself");
  });

  it("surfaces pending decisions + an over-budget calibration warning", () => {
    const r = composeBoardReport({ topMove: "Recover 2 failed payments", okr: "Objectives: 40%", pendingCount: 3, attention: attentionLoad(10, 100) });
    expect(r).toContain("3 action(s)");
    expect(r).toContain("Calibration");
    expect(r).toContain("Objectives: 40%");
  });

  it("surfaces the decision-quality + self-marketing lines so the founder can watch it calibrate", () => {
    const r = composeBoardReport({
      topMove: null,
      decisionQuality: "Decision quality: 78% hit-rate over 42 resolved.",
      marketing: "Self-marketing: 4 free channel(s) running · paid still locked.",
      pendingCount: 0,
      attention: attentionLoad(0, 0),
    });
    expect(r).toContain("78% hit-rate");
    expect(r).toContain("Self-marketing");
    expect(r).toContain("How it's tracking");
  });
});
