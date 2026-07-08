import { describe, it, expect } from "vitest";
import { learnedAutoResolveThreshold } from "../../server/services/autopilot/learnedGates";
import { chooseSupportAction, DEFAULT_AUTO_RESOLVE_THRESHOLD, type SupportCtx } from "../../server/services/autopilot/domainLadders";
import type { SignalOutcome } from "../../server/services/autopilot/learnedPolicy";

const earnAll = () => true;

/** History where auto-resolves succeed reliably from confidence `cut` upward. */
function historyFrom(cut: number, n: number): SignalOutcome[] {
  return Array.from({ length: n }, (_, i) => {
    const signal = 0.5 + (i % 5) / 10; // 0.5..0.9
    return { signal, success: signal >= cut };
  });
}

describe("learnedGates — the auto-resolve gate self-calibrates end-to-end (Leap 1)", () => {
  it("cold start: keeps the typed default, so 0.65 confidence does NOT auto-resolve", () => {
    const lt = learnedAutoResolveThreshold(historyFrom(0.6, 10)); // too few samples
    expect(lt.source).toBe("default");
    expect(lt.threshold).toBe(DEFAULT_AUTO_RESOLVE_THRESHOLD);

    const ctx: SupportCtx = { aiConfidence: 0.65, reopened: false, complexity: "low", autoResolveThreshold: lt.threshold };
    expect(chooseSupportAction(ctx, earnAll).chosen?.id).toBe("drafted_reply"); // 0.65 < 0.8
  });

  it("with supporting history it LEARNS a lower bar, and 0.65 confidence now auto-resolves (free)", () => {
    const lt = learnedAutoResolveThreshold(historyFrom(0.6, 200)); // success holds from 0.6
    expect(lt.source).toBe("learned");
    expect(lt.threshold).toBeLessThanOrEqual(0.65);

    const ctx: SupportCtx = { aiConfidence: 0.65, reopened: false, complexity: "low", autoResolveThreshold: lt.threshold };
    // The SAME ticket that was drafted under the typed default now auto-resolves
    // under the learned threshold — the gate calibrated from real outcomes.
    expect(chooseSupportAction(ctx, earnAll).chosen?.id).toBe("auto_resolve");
  });

  it("a complex/reopened ticket still escalates regardless of the learned bar (safety preserved)", () => {
    const lt = learnedAutoResolveThreshold(historyFrom(0.6, 200));
    const ctx: SupportCtx = { aiConfidence: 0.99, reopened: true, complexity: "high", autoResolveThreshold: lt.threshold };
    expect(chooseSupportAction(ctx, earnAll).chosen?.id).toBe("escalate_founder");
  });
});
