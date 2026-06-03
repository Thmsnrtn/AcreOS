/**
 * Tests for Iris perf-monitor regression detection + percentile math.
 *
 * Pure-unit coverage — no DB. We exercise:
 *   - computePercentiles: empty input + nearest-rank semantics
 *   - medianOf: even + odd lengths
 *   - evaluateRegression: 2× multiplier threshold, absolute ceiling,
 *     minimum-sample-count guard, both-fire case.
 */

import { describe, expect, it } from "vitest";
import {
  computePercentiles,
  evaluateRegression,
  medianOf,
} from "./perfMonitor";
import { IRIS_REGRESSION_THRESHOLDS } from "@shared/schema/iris-perf";

describe("computePercentiles", () => {
  it("returns zeros on empty input", () => {
    const r = computePercentiles([]);
    expect(r.p50).toBe(0);
    expect(r.p95).toBe(0);
    expect(r.p99).toBe(0);
  });

  it("nearest-rank percentile on a known distribution", () => {
    // 100 values, 1..100. p50 = 50, p95 = 95, p99 = 99.
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    const r = computePercentiles(xs);
    expect(r.p50).toBe(50);
    expect(r.p95).toBe(95);
    expect(r.p99).toBe(99);
  });

  it("handles a single observation (rank clamps to 1)", () => {
    const r = computePercentiles([42]);
    expect(r.p50).toBe(42);
    expect(r.p95).toBe(42);
    expect(r.p99).toBe(42);
  });

  it("does not mutate the caller's array", () => {
    const xs = [3, 1, 2];
    computePercentiles(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe("medianOf", () => {
  it("returns 0 on empty input", () => {
    expect(medianOf([])).toBe(0);
  });

  it("returns the middle on odd length", () => {
    expect(medianOf([5, 1, 3])).toBe(3);
  });

  it("averages the middle two on even length", () => {
    expect(medianOf([4, 2, 1, 3])).toBe(2.5);
  });

  it("is unaffected by input order", () => {
    expect(medianOf([1, 2, 3, 4, 5])).toBe(medianOf([5, 4, 3, 2, 1]));
  });
});

describe("evaluateRegression", () => {
  const minSamples = IRIS_REGRESSION_THRESHOLDS.minSampleCountForAlert;

  it("returns null when sample count is below the alert minimum", () => {
    // 10× baseline AND > absolute ceiling — but only 1 sample. No fire.
    const r = evaluateRegression({
      latestP95: 5000,
      baselineP95: 100,
      latestSampleCount: 1,
    });
    expect(r).toBeNull();
  });

  it("fires 'multiplier' when latest > 2× baseline but under absolute ceiling", () => {
    // baseline = 100ms, latest = 300ms (3× > 2× threshold), absolute
    // ceiling = 1000ms → only multiplier fires.
    const r = evaluateRegression({
      latestP95: 300,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("multiplier");
  });

  it("fires 'absolute' when latest > 1000ms but ratio is under 2×", () => {
    // baseline = 800ms, latest = 1200ms — ratio = 1.5× (below multiplier),
    // but 1200 > 1000ms absolute ceiling.
    const r = evaluateRegression({
      latestP95: 1200,
      baselineP95: 800,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("absolute");
  });

  it("fires 'both' when both thresholds are triggered", () => {
    // baseline = 100ms, latest = 2500ms — 25× ratio AND > 1000ms.
    const r = evaluateRegression({
      latestP95: 2500,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("both");
  });

  it("returns null on a healthy window", () => {
    const r = evaluateRegression({
      latestP95: 120,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });

  it("does not fire when baseline_p95 is 0 (insufficient history)", () => {
    // baseline 0 with a non-zero latest under the absolute ceiling: no fire.
    // (The multiplier check guards on baselineP95 > 0 so we don't divide
    // by zero or treat the first-ever sample as a regression.)
    const r = evaluateRegression({
      latestP95: 500,
      baselineP95: 0,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });

  it("still fires absolute when baseline 0 but latest exceeds 1000ms ceiling", () => {
    const r = evaluateRegression({
      latestP95: 1500,
      baselineP95: 0,
      latestSampleCount: minSamples,
    });
    expect(r).toBe("absolute");
  });

  it("respects the exact 2× multiplier threshold (not-equal-to is healthy)", () => {
    // 200 / 100 = 2.0 — the multiplier check is strictly greater-than.
    const r = evaluateRegression({
      latestP95: 200,
      baselineP95: 100,
      latestSampleCount: minSamples,
    });
    expect(r).toBeNull();
  });
});
