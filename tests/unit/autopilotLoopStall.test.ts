import { describe, it, expect } from "vitest";
import {
  detectLoopStall,
  observeLoopHealth,
  type LoopHealthObservation,
} from "../../server/services/autopilot/loopStall";

const HOUR = 60 * 60 * 1000;
const NOW = 1_750_000_000_000; // fixed epoch for determinism

const obs = (over: Partial<LoopHealthObservation> = {}): LoopHealthObservation => ({
  now: NOW,
  lastPulseAt: NOW - HOUR, // fresh
  dispatchBacklog: 0,
  oldestQueuedDispatchAgeMs: null,
  dispatchConsumerEnabled: false,
  ...over,
});

describe("autopilot loop-stall detector — the self-watchdog", () => {
  it("a freshly-ticking loop is healthy and never pages", () => {
    const v = detectLoopStall(obs());
    expect(v.severity).toBe("healthy");
    expect(v.shouldPageFounder).toBe(false);
  });

  it("a heartbeat 8h late is degraded (missed the 6h refresh) but does not page", () => {
    const v = detectLoopStall(obs({ lastPulseAt: NOW - 8 * HOUR }));
    expect(v.severity).toBe("degraded");
    expect(v.shouldPageFounder).toBe(false);
  });

  it("a heartbeat dark for 25h is STALLED and pages the founder", () => {
    const v = detectLoopStall(obs({ lastPulseAt: NOW - 25 * HOUR }));
    expect(v.severity).toBe("stalled");
    expect(v.shouldPageFounder).toBe(true);
    expect(v.summary).toMatch(/STALLED/);
  });

  it("a fresh deploy with no pulse yet is degraded, never a page (no false alarm on boot)", () => {
    const v = detectLoopStall(obs({ lastPulseAt: null }));
    expect(v.severity).toBe("degraded");
    expect(v.shouldPageFounder).toBe(false);
  });

  it("a backlog is NOT a stall while the consumer is gated off (expected, not broken)", () => {
    const v = detectLoopStall(
      obs({ dispatchConsumerEnabled: false, dispatchBacklog: 12, oldestQueuedDispatchAgeMs: 10 * HOUR }),
    );
    expect(v.severity).toBe("healthy");
  });

  it("once the consumer is ENABLED, a 7h-old undrained dispatch is a stall and pages", () => {
    const v = detectLoopStall(
      obs({ dispatchConsumerEnabled: true, dispatchBacklog: 3, oldestQueuedDispatchAgeMs: 7 * HOUR }),
    );
    expect(v.severity).toBe("stalled");
    expect(v.shouldPageFounder).toBe(true);
  });

  it("the worst signal wins: a late heartbeat AND a stuck consumer reports stalled", () => {
    const v = detectLoopStall(
      obs({
        lastPulseAt: NOW - 8 * HOUR, // degraded
        dispatchConsumerEnabled: true,
        dispatchBacklog: 2,
        oldestQueuedDispatchAgeMs: 7 * HOUR, // stalled
      }),
    );
    expect(v.severity).toBe("stalled");
    expect(v.signals.length).toBeGreaterThanOrEqual(2);
  });

  it("observeLoopHealth wires injected sources and survives a source failure", async () => {
    const v = await observeLoopHealth({
      now: () => NOW,
      getLatestPulseAt: async () => {
        throw new Error("db down");
      },
      getQueuedDispatches: async () => [{ queuedAtMs: NOW - 2 * HOUR }],
      dispatchConsumerEnabled: true,
    });
    // pulse read threw → treated as null → degraded (no false page); consumer
    // enabled with a 2h-old dispatch → degraded too. Watchdog survives.
    expect(v.severity).toBe("degraded");
    expect(v.shouldPageFounder).toBe(false);
  });
});
