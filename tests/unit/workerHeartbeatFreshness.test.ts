/**
 * Worker heartbeat freshness tests (Tess #5).
 *
 * The external eye pages on `stale === true`, so the threshold boundary has to
 * be exact: a worker that beat 9m59s ago must read fresh, 10m01s must read
 * stale, and a never-beat (null) row must read stale. These cover the pure
 * computation the GET /api/health/worker-heartbeat handler delegates to.
 */

import { describe, it, expect } from "vitest";
import {
  computeHeartbeatFreshness,
  DEFAULT_STALE_SECONDS,
} from "../../server/routes-worker-heartbeat";

const NOW = Date.UTC(2026, 5, 8, 12, 0, 0); // fixed clock

describe("computeHeartbeatFreshness", () => {
  it("a recent beat is fresh (ok=true, stale=false)", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW - 30_000), // 30s ago
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.stale).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.ageSeconds).toBe(30);
  });

  it("a null beat (never beat) reads stale", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: null,
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.stale).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.lastBeatAt).toBeNull();
    expect(r.ageSeconds).toBeNull();
  });

  it("just inside the threshold is fresh", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW - (DEFAULT_STALE_SECONDS - 1) * 1000),
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.stale).toBe(false);
    expect(r.ageSeconds).toBe(DEFAULT_STALE_SECONDS - 1);
  });

  it("exactly at the threshold is NOT stale (age must EXCEED threshold)", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW - DEFAULT_STALE_SECONDS * 1000),
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.ageSeconds).toBe(DEFAULT_STALE_SECONDS);
    expect(r.stale).toBe(false);
  });

  it("one second past the threshold is stale", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW - (DEFAULT_STALE_SECONDS + 1) * 1000),
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.stale).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("clamps a future timestamp to age 0 (clock skew) rather than negative", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW + 5000), // 5s in the future
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
    });
    expect(r.ageSeconds).toBe(0);
    expect(r.stale).toBe(false);
  });

  it("passes through instanceId + gitSha for debuggability", () => {
    const r = computeHeartbeatFreshness({
      lastBeatAt: new Date(NOW - 1000),
      now: NOW,
      thresholdSeconds: DEFAULT_STALE_SECONDS,
      instanceId: "worker-abc",
      gitSha: "deadbeef",
    });
    expect(r.instanceId).toBe("worker-abc");
    expect(r.gitSha).toBe("deadbeef");
  });
});
