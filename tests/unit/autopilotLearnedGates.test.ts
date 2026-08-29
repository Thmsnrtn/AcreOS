import { describe, it, expect } from "vitest";
import {
  learnedAutoResolveThreshold,
  DEFAULT_AUTO_RESOLVE_THRESHOLD,
} from "../../server/services/autopilot/learnedGates";
import type { SignalOutcome } from "../../server/services/autopilot/learnedPolicy";

/**
 * Rewritten 2026-08-28 (stage-4 turn 2), not deleted. The original drove the
 * domainLadders chooseSupportAction ladder, which was deleted as zero-caller
 * code; the invariant that SURVIVES is the threshold learning itself, which
 * IS production: customerSupportAutoResolver consults
 * currentSupportAutoResolveThreshold (learnedGates) before auto-resolving,
 * with its own add-caution-only floor (never below the env threshold) and a
 * billing hard-floor of 90 — those live gates are asserted where they live.
 * Here: the pure learner's cold-start honesty and calibration direction.
 */

/** History where auto-resolves succeed reliably from confidence `cut` upward. */
function historyFrom(cut: number, n: number): SignalOutcome[] {
  return Array.from({ length: n }, (_, i) => {
    const signal = 0.5 + (i % 5) / 10; // 0.5..0.9
    return { signal, success: signal >= cut };
  });
}

describe("learnedGates — the auto-resolve threshold self-calibrates", () => {
  it("cold start: keeps the typed default and says so", () => {
    const lt = learnedAutoResolveThreshold(historyFrom(0.6, 10)); // too few samples
    expect(lt.source).toBe("default");
    expect(lt.threshold).toBe(DEFAULT_AUTO_RESOLVE_THRESHOLD);
  });

  it("with supporting history it LEARNS a lower bar from real outcomes", () => {
    const lt = learnedAutoResolveThreshold(historyFrom(0.6, 200)); // success holds from 0.6
    expect(lt.source).toBe("learned");
    expect(lt.threshold).toBeLessThanOrEqual(0.65);
    expect(lt.threshold).toBeGreaterThan(0.5);
  });

  it("contradictory history refuses to lower the bar", () => {
    // Successes only from 0.9 up — learning must never hand back a bar below
    // what the outcomes support.
    const lt = learnedAutoResolveThreshold(historyFrom(0.9, 200));
    expect(lt.threshold).toBeGreaterThanOrEqual(DEFAULT_AUTO_RESOLVE_THRESHOLD);
  });
});
