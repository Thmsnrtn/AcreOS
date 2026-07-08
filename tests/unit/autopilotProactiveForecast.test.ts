import { describe, it, expect } from "vitest";
import {
  trendSlope,
  projectAhead,
  runwayDays,
  forecastToPreemptiveMoves,
  RUNWAY_LEAD_DAYS,
} from "../../server/services/autopilot/proactiveForecast";

describe("proactiveForecast — projection primitives (pure, honest)", () => {
  it("trendSlope: null under 2 points, correct slope otherwise", () => {
    expect(trendSlope([5])).toBeNull();
    expect(trendSlope([0, 1, 2, 3])).toBeCloseTo(1);
    expect(trendSlope([3, 2, 1, 0])).toBeCloseTo(-1);
  });

  it("projectAhead extrapolates the trend", () => {
    expect(projectAhead([0, 1, 2], 3)).toBeCloseTo(5);
    expect(projectAhead([10], 3)).toBeNull(); // too little data
  });

  it("runwayDays: null when not burning, 0 when already under floor", () => {
    expect(runwayDays(10000, 5000, 0)).toBeNull();
    expect(runwayDays(4000, 5000, 100)).toBe(0);
    expect(runwayDays(15000, 5000, 1000)).toBe(10); // 10000 headroom / 1000
  });
});

describe("proactiveForecast — pre-emptive moves (act ahead)", () => {
  it("protects runway when the projected breach is within the lead window", () => {
    const moves = forecastToPreemptiveMoves({ reserveCents: 50000, floorCents: 10000, dailyBurnCents: 2000 }); // 20 days
    expect(moves.find((m) => m.kind === "protect_runway")).toBeTruthy();
  });

  it("does NOT fire runway when the breach is far out", () => {
    const moves = forecastToPreemptiveMoves({ reserveCents: 10_000_000, floorCents: 10000, dailyBurnCents: 2000 });
    expect(moves.find((m) => m.kind === "protect_runway")).toBeFalsy();
  });

  it("retains ahead of a rising churn trend", () => {
    const moves = forecastToPreemptiveMoves({ churnHistory: [0.01, 0.02, 0.03, 0.05] });
    expect(moves.find((m) => m.kind === "retain_ahead_of_churn")).toBeTruthy();
  });

  it("does NOT fire on flat/declining churn", () => {
    expect(forecastToPreemptiveMoves({ churnHistory: [0.05, 0.05, 0.05] }).length).toBe(0);
    expect(forecastToPreemptiveMoves({ churnHistory: [0.05, 0.03, 0.01] }).length).toBe(0);
  });

  it("scales for a sharp projected demand rise", () => {
    const moves = forecastToPreemptiveMoves({ demandHistory: [10, 15, 22, 30] });
    expect(moves.find((m) => m.kind === "scale_for_demand")).toBeTruthy();
  });

  it("proposes nothing from no signals (no fabricated forecast)", () => {
    expect(forecastToPreemptiveMoves({})).toEqual([]);
  });

  it("orders by lead time (most urgent first)", () => {
    const moves = forecastToPreemptiveMoves({
      reserveCents: 50000, floorCents: 10000, dailyBurnCents: 2000, // ~20d
      churnHistory: [0.01, 0.03, 0.05], // 7d
    });
    expect(moves[0].leadDays).toBeLessThanOrEqual(moves[moves.length - 1].leadDays);
  });
});
