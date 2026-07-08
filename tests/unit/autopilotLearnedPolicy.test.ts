import { describe, it, expect } from "vitest";
import { learnThreshold, learnedThresholdLine, type SignalOutcome } from "../../server/services/autopilot/learnedPolicy";

/** Build history where success becomes likely at/above `cut`. */
function historyWithCut(cut: number, n: number): SignalOutcome[] {
  const out: SignalOutcome[] = [];
  for (let i = 0; i < n; i++) {
    const signal = (i % 10) / 10; // 0.0..0.9 spread
    out.push({ signal, success: signal >= cut });
  }
  return out;
}

describe("learnedPolicy — learnThreshold (Leap 1: rules → learning)", () => {
  it("returns the typed DEFAULT below minSamples (cold-start-safe)", () => {
    const lt = learnThreshold(historyWithCut(0.5, 10), 0.8, { minSamples: 30 });
    expect(lt.source).toBe("default");
    expect(lt.threshold).toBe(0.8);
  });

  it("LEARNS a lower-than-typed threshold when the data supports acting earlier", () => {
    // success kicks in at 0.5; typed default was a conservative 0.8.
    const lt = learnThreshold(historyWithCut(0.5, 100), 0.8, { minSamples: 30, targetSuccessRate: 0.95, minBucket: 8 });
    expect(lt.source).toBe("learned");
    expect(lt.threshold).toBe(0.5); // act as early as 0.5 — data supports it
    expect(lt.rateAtThreshold).toBeGreaterThanOrEqual(0.95);
  });

  it("keeps the conservative default when NOTHING clears the target", () => {
    // all failures → no threshold reaches the target success rate.
    const allFail: SignalOutcome[] = Array.from({ length: 100 }, (_, i) => ({ signal: (i % 10) / 10, success: false }));
    const lt = learnThreshold(allFail, 0.8, { minSamples: 30, targetSuccessRate: 0.7 });
    expect(lt.source).toBe("default");
    expect(lt.threshold).toBe(0.8);
  });

  it("never lowers the bar past where the success rate holds (conservative)", () => {
    // success only at/above 0.7; target 0.9 → learned threshold should be >= 0.7.
    const lt = learnThreshold(historyWithCut(0.7, 200), 0.85, { minSamples: 30, targetSuccessRate: 0.9, minBucket: 8 });
    expect(lt.source).toBe("learned");
    expect(lt.threshold).toBeGreaterThanOrEqual(0.7);
  });

  it("ignores a too-small tail bucket (no over-fitting)", () => {
    // one lucky high-signal success shouldn't set the threshold if the bucket is tiny.
    const h: SignalOutcome[] = [
      ...Array.from({ length: 49 }, () => ({ signal: 0.2, success: false })),
      { signal: 0.99, success: true },
    ];
    const lt = learnThreshold(h, 0.8, { minSamples: 30, targetSuccessRate: 0.7, minBucket: 8 });
    expect(lt.source).toBe("default"); // the single 0.99 win is below minBucket
  });

  it("renders an honest line for learned vs default", () => {
    expect(learnedThresholdLine("auto-resolve", learnThreshold(historyWithCut(0.5, 5), 0.8))).toContain("typed default");
    expect(learnedThresholdLine("auto-resolve", learnThreshold(historyWithCut(0.5, 100), 0.8, { targetSuccessRate: 0.95 }))).toContain("LEARNED");
  });
});
