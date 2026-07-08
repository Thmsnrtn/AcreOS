import { describe, it, expect } from "vitest";
import {
  computeProgress,
  domainUrgency,
  summarizeObjective,
} from "../../server/services/autopilot/objectives";

function obj(over: Partial<{ key: string; label: string; unit: string; target: number; current: number; owningDomain: string }> = {}) {
  return { key: "k", label: "L", unit: "count", target: 100, current: 0, owningDomain: "growth", ...over };
}

describe("objectives — computeProgress (pure, direction-aware)", () => {
  it("higher-is-better: pct = current/target, clamped", () => {
    expect(computeProgress(obj({ current: 25, target: 100 })).pct).toBeCloseTo(0.25);
    expect(computeProgress(obj({ current: 150, target: 100 })).pct).toBe(1); // clamped
    expect(computeProgress(obj({ current: 100, target: 100 })).met).toBe(true);
  });

  it("lower-is-better (minutes): pct rises as current falls toward target", () => {
    expect(computeProgress(obj({ unit: "minutes", current: 120, target: 120 })).met).toBe(true);
    expect(computeProgress(obj({ unit: "minutes", current: 60, target: 120 })).pct).toBe(1); // beat it
    const half = computeProgress(obj({ unit: "minutes", current: 240, target: 120 }));
    expect(half.met).toBe(false);
    expect(half.pct).toBe(0); // 2x target = 0%
  });

  it("handles a zero target without dividing by zero", () => {
    expect(computeProgress(obj({ target: 0, current: 0 })).met).toBe(true);
  });
});

describe("objectives — domainUrgency (planner weighting, pure)", () => {
  it("is neutral (1.0) for a domain that owns no objective", () => {
    expect(domainUrgency([obj({ owningDomain: "growth" })], "finance")).toBe(1);
  });

  it("rises toward 2.0 as the domain's objectives sit further from target", () => {
    const far = domainUrgency([obj({ owningDomain: "growth", current: 0, target: 100 })], "growth");
    const near = domainUrgency([obj({ owningDomain: "growth", current: 90, target: 100 })], "growth");
    expect(far).toBeGreaterThan(near);
    expect(far).toBeLessThanOrEqual(2);
    expect(near).toBeGreaterThanOrEqual(1);
  });

  it("is 1.0 when the domain's objectives are all met (no extra nudge)", () => {
    expect(domainUrgency([obj({ owningDomain: "growth", current: 100, target: 100 })], "growth")).toBe(1);
  });
});

describe("objectives — summarizeObjective (letter rendering)", () => {
  it("formats cents + rate + count units", () => {
    expect(summarizeObjective(computeProgress(obj({ unit: "cents", label: "MRR", current: 20000, target: 100000 })))).toContain("$200");
    expect(summarizeObjective(computeProgress(obj({ unit: "rate", label: "Trial→paid", current: 0.2, target: 0.5 })))).toContain("20%");
    expect(summarizeObjective(computeProgress(obj({ label: "Activated", current: 3, target: 10 })))).toContain("3 → 10");
  });
});
