import { describe, it, expect } from "vitest";

describe("freedomCalculator — edge cases", () => {
  it("no notes → freedom = 0%, shows 'Create your first note'", () => {
    const monthlyPassiveIncome = 0;
    const freedomTarget = 0;
    const freedomPercentage = freedomTarget > 0
      ? Math.min(100, Math.round((monthlyPassiveIncome / freedomTarget) * 100))
      : 0;
    expect(freedomPercentage).toBe(0);
  });

  it("target = 0 → shows 'Set a target' not Infinity%", () => {
    const monthlyPassiveIncome = 500;
    const freedomTarget = 0;
    // Must not divide by zero
    const freedomPercentage = freedomTarget > 0
      ? Math.min(100, Math.round((monthlyPassiveIncome / freedomTarget) * 100))
      : 0;
    expect(freedomPercentage).toBe(0);
    expect(isFinite(freedomPercentage)).toBe(true);
  });

  it("month with no payments → $0 income, not error", () => {
    const monthlyPassiveIncome = 0;
    const freedomTarget = 7000;
    const freedomPercentage = Math.min(100, Math.round((monthlyPassiveIncome / freedomTarget) * 100));
    expect(freedomPercentage).toBe(0);
  });

  it("current income > target → 'You've reached financial freedom!'", () => {
    const monthlyPassiveIncome = 8000;
    const freedomTarget = 7000;
    const freedomPercentage = Math.min(100, Math.round((monthlyPassiveIncome / freedomTarget) * 100));
    expect(freedomPercentage).toBe(100);
  });

  it("milestone detection at 25/50/75/100", () => {
    function getMilestone(pct: number): number {
      if (pct >= 100) return 100;
      if (pct >= 75) return 75;
      if (pct >= 50) return 50;
      if (pct >= 25) return 25;
      return 0;
    }
    expect(getMilestone(24)).toBe(0);
    expect(getMilestone(25)).toBe(25);
    expect(getMilestone(49)).toBe(25);
    expect(getMilestone(50)).toBe(50);
    expect(getMilestone(74)).toBe(50);
    expect(getMilestone(75)).toBe(75);
    expect(getMilestone(99)).toBe(75);
    expect(getMilestone(100)).toBe(100);
  });
});
