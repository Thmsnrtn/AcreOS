/**
 * A lock that expires under its own job is not a lock.
 *
 * withJobLock() acquired a lease with a TTL and then ran an arbitrarily long
 * body without ever re-extending it. When the body outlived the TTL the lease
 * simply expired, and the next machine's tick acquired it and started the same
 * job concurrently — two dunning runs, two nudge sends, two ETL writes, from a
 * mechanism whose entire purpose is to prevent exactly that.
 *
 * The scheduler's own lease path had already learned this. When job bodies were
 * moved out of transactions (Tier 1H), scheduler.ts gained HEARTBEAT_MS at 3x
 * the TTL expiry rate and documents why. The fix landed on ONE of the two
 * mutual-exclusion mechanisms; withJobLock — the one job bodies take out for
 * themselves, across 185 call sites — kept the defect. Two mechanisms, one
 * repair: the population lesson in operational form.
 *
 * A measurement worth keeping, because it corrects the record: the TTLs here
 * are mostly generous. A first pass read them as seconds (`60`, `55`, `30`) and
 * that was a truncated regex stopping at the first number — the real values are
 * `60 * 60`, `55 * 60`, `23 * 60 * 60`. So this was never the everyday failure.
 * It is still not a lock: "the job has finished inside an hour every time so
 * far" is a hope, and the seconds-scale TTLs that do exist have no margin.
 *
 * Mutation probes (each must go RED): delete the startLeaseHeartbeat call;
 * never clear the interval in finally; make the heartbeat period longer than
 * the TTL it is meant to outrun.
 *
 * idempotent: true — storage and timers fully faked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const acquire = vi.hoisted(() => vi.fn(async () => true));
const release = vi.hoisted(() => vi.fn(async () => {}));

vi.mock("../../server/storage", () => ({
  storage: { acquireJobLock: acquire, releaseJobLock: release },
  db: { insert: () => ({ values: () => ({ catch: () => {} }) }) },
}));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@shared/schema", () => ({ jobHealthLogs: {} }));

describe("a held lease is re-extended while its body runs", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    acquire.mockClear();
    release.mockClear();
    acquire.mockImplementation(async () => true);
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-acquires several times across a body that outlives the TTL", async () => {
    const { withJobLock } = await import("../../server/utils/jobRuntime");
    const TTL = 60; // seconds
    let finish: () => void = () => {};
    const body = new Promise<void>((r) => (finish = r));

    const run = withJobLock("slow_job", TTL, async () => {
      await body;
      return "done";
    });

    // Let the body run four TTLs' worth of wall clock.
    await vi.advanceTimersByTimeAsync(TTL * 4 * 1000);
    finish();
    await run;

    // 1 initial claim + heartbeats at TTL/3.
    expect(
      acquire.mock.calls.length,
      "the lease was claimed once and never renewed — a body this long would " +
        "have lost it, and another machine would already be running the job",
    ).toBeGreaterThan(4);
    for (const call of acquire.mock.calls) {
      expect(call[0]).toBe("slow_job");
      expect(call[2], "a renewal must extend by the SAME ttl it was claimed with").toBe(TTL);
    }
  });

  it("the renewal identifies the same holder, so it extends rather than steals", async () => {
    const { withJobLock, instanceId } = await import("../../server/utils/jobRuntime");
    let finish: () => void = () => {};
    const body = new Promise<void>((r) => (finish = r));
    const run = withJobLock("owner_job", 30, async () => {
      await body;
    });
    await vi.advanceTimersByTimeAsync(30 * 2 * 1000);
    finish();
    await run;
    for (const call of acquire.mock.calls) expect(call[1]).toBe(instanceId);
  });

  it("stops beating when the body finishes", async () => {
    const { withJobLock } = await import("../../server/utils/jobRuntime");
    await withJobLock("quick_job", 60, async () => "ok");
    const afterRun = acquire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 10 * 1000);
    expect(
      acquire.mock.calls.length,
      "the heartbeat outlived its job — an interval left running re-extends a " +
        "lease for work that already finished, locking every later run out",
    ).toBe(afterRun);
    expect(release).toHaveBeenCalledWith("quick_job", expect.any(String));
  });

  it("stops beating when the body throws", async () => {
    const { withJobLock } = await import("../../server/utils/jobRuntime");
    await expect(
      withJobLock("boom_job", 60, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");
    const afterRun = acquire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 10 * 1000);
    expect(acquire.mock.calls.length).toBe(afterRun);
  });

  it("does not start a heartbeat when the lock was never acquired", async () => {
    acquire.mockImplementation(async () => false);
    const { withJobLock } = await import("../../server/utils/jobRuntime");
    const r = await withJobLock("contended_job", 60, async () => "should not run");
    expect(r).toBeNull();
    const afterRun = acquire.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 10 * 1000);
    expect(
      acquire.mock.calls.length,
      "a caller that lost the race is beating anyway — it would eventually take " +
        "the lease out from under the machine that won it",
    ).toBe(afterRun);
  });
});
