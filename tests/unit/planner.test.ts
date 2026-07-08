import { describe, it, expect } from "vitest";
import {
  buildPlan,
  assessPlanProgress,
  repairPlan,
  nextStep,
  type MoveEv,
} from "../../server/services/autopilot/planner";

/**
 * Frontier #7 — the multi-step planner + plan-repair commitment ledger.
 */
const moves = (xs: Array<[string, number]>): MoveEv[] => xs.map(([moveKind, ev]) => ({ moveKind, ev }));

describe("buildPlan — bounded, distinct, diminishing-returns lookahead", () => {
  it("orders distinct moves by EV, discounts later steps, caps at the horizon", () => {
    const p = buildPlan(moves([["a", 10], ["b", 8], ["c", 6], ["d", 4]]), 3, 0.5);
    expect(p.steps.map((s) => s.moveKind)).toEqual(["a", "b", "c"]); // top-3 distinct
    expect(p.steps[0].weightedEv).toBe(10); // decay^0
    expect(p.steps[1].weightedEv).toBe(4); // 8 × 0.5
    expect(p.steps[2].weightedEv).toBe(1.5); // 6 × 0.25
    expect(p.totalEv).toBeCloseTo(15.5, 6);
  });
  it("never repeats a move (you don't stack the same lever)", () => {
    const p = buildPlan(moves([["a", 5], ["a", 9], ["b", 3]]), 3);
    expect(p.steps.map((s) => s.moveKind)).toEqual(["a", "b"]);
  });
  it("plans ONLY positive-EV moves (null-action default — no place for non-positive)", () => {
    const p = buildPlan(moves([["a", 2], ["b", 0], ["c", -3]]), 3);
    expect(p.steps.map((s) => s.moveKind)).toEqual(["a"]);
  });
  it("is total on the empty / all-nonpositive set", () => {
    expect(buildPlan([], 3).steps).toEqual([]);
    expect(buildPlan(moves([["a", -1]]), 3).totalEv).toBe(0);
  });
  it("clamps a silly horizon/decay", () => {
    expect(buildPlan(moves([["a", 1], ["b", 1]]), 0).steps.length).toBe(1); // horizon→1
    expect(buildPlan(moves([["a", 1]]), 1, 5).decay).toBe(0.6); // decay out of range → default
  });
});

describe("assessPlanProgress — the commitment ledger", () => {
  const plan = buildPlan(moves([["a", 10], ["b", 8]]), 2, 1); // decay 1 → predictedEv = raw
  it("on-track when actuals meet predictions", () => {
    const pr = assessPlanProgress(plan, [{ moveKind: "a", actualEv: 10 }, { moveKind: "b", actualEv: 9 }]);
    expect(pr.executed).toBe(2);
    expect(pr.diverged).toBe(false);
    expect(pr.attainment).toBeGreaterThanOrEqual(1);
  });
  it("DIVERGED when reality delivers under half the predicted", () => {
    const pr = assessPlanProgress(plan, [{ moveKind: "a", actualEv: 2 }]); // 2 vs predicted 10
    expect(pr.executed).toBe(1);
    expect(pr.attainment).toBeCloseTo(0.2, 6);
    expect(pr.diverged).toBe(true);
  });
  it("counts only executed steps; nothing executed ⇒ not diverged", () => {
    expect(assessPlanProgress(plan, []).diverged).toBe(false);
  });
});

describe("repairPlan — re-form a falsified plan from the observed state", () => {
  it("drops spent moves and re-plans the remainder from fresh EVs", () => {
    const repaired = repairPlan(["a"], moves([["a", 10], ["b", 7], ["c", 5]]), 3, 0.5);
    expect(repaired.steps.map((s) => s.moveKind)).toEqual(["b", "c"]); // 'a' is spent
    expect(nextStep(repaired)).toBe("b");
  });
  it("can surface a NEW best after divergence (the point of repair)", () => {
    // 'a' underdelivered + is spent; a freshly-high 'd' now leads.
    const repaired = repairPlan(["a"], moves([["d", 12], ["b", 7]]), 3);
    expect(nextStep(repaired)).toBe("d");
  });
});
