/**
 * Unit tests for `scheduleSelfRescheduling` (server/jobs/scheduler.ts).
 *
 * Verifies:
 *   1. The cancel function stops further runs even if a run is mid-flight.
 *   2. A clean run schedules the next tick at exactly intervalMs.
 *   3. After a failure, backoff doubles per consecutive failure and is
 *      capped at maxBackoffMs (computeBackoffMs is the source of truth).
 *   4. A successful run after failures resets the consecutiveFailures counter.
 *   5. Cancel is idempotent (calling twice doesn't throw).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock db so the scheduler doesn't try real Postgres inserts ────────────────
vi.mock("../../server/db", () => {
  const chainable = () => {
    const obj: any = {};
    obj.values = () => obj;
    obj.returning = async () => [{ id: 1 }];
    obj.set = () => obj;
    obj.where = async () => undefined;
    return obj;
  };
  return {
    db: {
      insert: () => chainable(),
      update: () => chainable(),
    },
    pool: {},
  };
});

// drizzle-orm `eq` is dynamically imported inside scheduler.ts; stub it.
vi.mock("drizzle-orm", async (orig) => {
  const actual: any = await orig();
  return { ...actual, eq: (..._a: unknown[]) => undefined };
});

import {
  scheduleSelfRescheduling,
  computeBackoffMs,
  getJobRuntimeStatus,
} from "../../server/jobs/scheduler";

describe("computeBackoffMs", () => {
  it("returns base interval when there are no failures", () => {
    expect(computeBackoffMs(1000, 0)).toBe(1000);
  });

  it("doubles per consecutive failure starting at 2x", () => {
    expect(computeBackoffMs(1000, 1)).toBe(2000);
    expect(computeBackoffMs(1000, 2)).toBe(4000);
    expect(computeBackoffMs(1000, 3)).toBe(8000);
    expect(computeBackoffMs(1000, 4)).toBe(16000);
  });

  it("caps at maxBackoffMs", () => {
    expect(computeBackoffMs(1000, 20, 10_000)).toBe(10_000);
    expect(computeBackoffMs(1000, 10, 5_000)).toBe(5_000);
  });

  it("uses default cap of 1 hour", () => {
    // 1000 * 2^30 is huge; should cap at 3_600_000.
    expect(computeBackoffMs(1000, 30)).toBe(60 * 60 * 1000);
  });
});

describe("scheduleSelfRescheduling", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes run() then schedules next tick at intervalMs", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const cancel = scheduleSelfRescheduling({
      name: "test-clean-run",
      intervalMs: 1000,
      run,
    });

    // First run is scheduled with initialDelayMs=0; advance 0 ticks plus
    // microtask drain to let the awaits resolve.
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    // Next tick should fire at 1000ms.
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2);

    cancel();
  });

  it("cancel() stops further runs", async () => {
    const run = vi.fn().mockResolvedValue(undefined);
    const cancel = scheduleSelfRescheduling({
      name: "test-cancel",
      intervalMs: 500,
      run,
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    cancel();
    await vi.advanceTimersByTimeAsync(10_000);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("cancel() is idempotent", () => {
    const cancel = scheduleSelfRescheduling({
      name: "test-cancel-idem",
      intervalMs: 1000,
      run: async () => {},
    });
    cancel();
    expect(() => cancel()).not.toThrow();
  });

  it("on error, applies exponential backoff before next run", async () => {
    const run = vi
      .fn()
      .mockRejectedValueOnce(new Error("boom 1"))
      .mockRejectedValueOnce(new Error("boom 2"))
      .mockResolvedValueOnce(undefined);

    const onError = vi.fn();
    const cancel = scheduleSelfRescheduling({
      name: "test-backoff",
      intervalMs: 1000,
      run,
      onError,
    });

    // Run #1 — fails.
    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(getJobRuntimeStatus("test-backoff")?.consecutiveFailures).toBe(1);

    // After 1 failure backoff = 1000 * 2 = 2000ms. Advancing 1999ms must
    // NOT trigger run #2.
    await vi.advanceTimersByTimeAsync(1999);
    expect(run).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(getJobRuntimeStatus("test-backoff")?.consecutiveFailures).toBe(2);

    // After 2 failures backoff = 1000 * 4 = 4000ms.
    await vi.advanceTimersByTimeAsync(3999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    // Run #3 succeeded → counter resets, next interval reverts to 1000ms.
    expect(getJobRuntimeStatus("test-backoff")?.consecutiveFailures).toBe(0);
    expect(getJobRuntimeStatus("test-backoff")?.lastStatus).toBe("success");

    cancel();
  });

  it("respects maxBackoffMs cap", async () => {
    // Force a quickly-saturating cap to exercise the cap branch.
    const run = vi.fn().mockRejectedValue(new Error("always fails"));
    const cancel = scheduleSelfRescheduling({
      name: "test-cap",
      intervalMs: 1000,
      maxBackoffMs: 3000,
      run,
      onError: () => {},
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(run).toHaveBeenCalledTimes(1);

    // 1st failure → backoff would be 2000 (under cap).
    await vi.advanceTimersByTimeAsync(2000);
    expect(run).toHaveBeenCalledTimes(2);

    // 2nd failure → 4000 normally, but capped at 3000.
    await vi.advanceTimersByTimeAsync(2999);
    expect(run).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(run).toHaveBeenCalledTimes(3);

    // 3rd failure also capped at 3000.
    await vi.advanceTimersByTimeAsync(3000);
    expect(run).toHaveBeenCalledTimes(4);

    cancel();
  });
});
