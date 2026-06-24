import { describe, it, expect } from "vitest";
import { shouldRampBudget, nextBudgetStepUsd, marginAllowsRamp } from "../../server/services/autopilot/economics";

// The budget-ramp wire (zero-capital compounding): once owned-channel CAC is
// proven healthy, the autopilot proposes a BOUNDED, founder-gated lift to the
// monthly growth cap. These lock the pure math the wire's safety rests on.

describe("nextBudgetStepUsd — bounded, ceilinged ramp steps", () => {
  it("steps the cap up by +50% by default", () => {
    expect(nextBudgetStepUsd(50, 500)).toBe(75);
    expect(nextBudgetStepUsd(100, 500)).toBe(150);
  });

  it("never exceeds the hard ceiling (clamps the step)", () => {
    expect(nextBudgetStepUsd(50, 60)).toBe(60); // 75 would overshoot → clamp to 60
    expect(nextBudgetStepUsd(400, 500)).toBe(500); // 600 → clamp to 500
  });

  it("is a no-op once already at or above the ceiling (caller skips)", () => {
    expect(nextBudgetStepUsd(500, 500)).toBe(500); // == ceiling → unchanged
    expect(nextBudgetStepUsd(600, 500)).toBe(600); // over ceiling → unchanged (never shrinks here)
  });

  it("honors a custom step factor but never shrinks the cap", () => {
    expect(nextBudgetStepUsd(40, 500, 2)).toBe(80);
    expect(nextBudgetStepUsd(40, 500, 0.5)).toBe(40); // factor < 1 floored to 1 → no shrink
  });

  it("returns the input unchanged for non-positive / non-finite caps", () => {
    expect(nextBudgetStepUsd(0, 500)).toBe(0);
    expect(nextBudgetStepUsd(-10, 500)).toBe(-10);
    expect(nextBudgetStepUsd(Number.NaN, 500)).toBeNaN();
  });
});

describe("marginAllowsRamp — tighten-only margin guard on paid ramps", () => {
  it("allows a ramp pre-revenue (owned growth isn't gated on fixed-cost margin)", () => {
    expect(marginAllowsRamp({ revenueUsd: 0, marginUsd: -200 }).allow).toBe(true);
  });
  it("BLOCKS a ramp when there's revenue but customers are margin-negative", () => {
    const g = marginAllowsRamp({ revenueUsd: 500, marginUsd: -50 });
    expect(g.allow).toBe(false);
    expect(g.reason).toMatch(/negative/i);
  });
  it("allows a ramp when revenue is present and margin is positive", () => {
    expect(marginAllowsRamp({ revenueUsd: 500, marginUsd: 120 }).allow).toBe(true);
  });
  it("can only ever BLOCK — it never asserts a ramp on its own (no trigger path)", () => {
    // Positive margin is permissive, not a trigger: shouldRampBudget still gates.
    expect(marginAllowsRamp({ revenueUsd: 1000, marginUsd: 0 }).allow).toBe(true);
  });
});

describe("shouldRampBudget — the boundaries the wire depends on", () => {
  it("HOLDS until there are enough attributed signups (no ramp on thin data)", () => {
    const r = shouldRampBudget({ attributedSignups: 4, spendUsd: 0 });
    expect(r.ramp).toBe(false);
    expect(r.reason).toMatch(/too little data/i);
  });

  it("RAMPS when CAC is at or under target over enough signups", () => {
    const r = shouldRampBudget({ attributedSignups: 5, spendUsd: 100 }); // CAC $20 ≤ $50
    expect(r.ramp).toBe(true);
    expect(r.cacUsd).toBeCloseTo(20, 5);
  });

  it("HOLDS when CAC is above target even with enough signups", () => {
    const r = shouldRampBudget({ attributedSignups: 5, spendUsd: 300 }); // CAC $60 > $50
    expect(r.ramp).toBe(false);
    expect(r.cacUsd).toBeCloseTo(60, 5);
  });
});
