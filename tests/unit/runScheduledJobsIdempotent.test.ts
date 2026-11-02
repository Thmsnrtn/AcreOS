/**
 * runScheduledJobs is idempotent in one process (scheduler double-boot fix,
 * 2026-10).
 *
 * The defect: two `runScheduledJobs()` executions in one process created two
 * chained-setTimeout loops per job, so every job ticked twice ~0.3s apart and
 * both ticks held the per-job lock as "self-owned". The guard must hold even
 * if the import cycle that caused the second call is ever reintroduced, so the
 * test drives the REAL runScheduledJobs twice and counts the scheduler's
 * registration state — what actually creates a loop — not the guard's flag.
 *
 * Also pinned here: the janitor registers via runScheduledJobs (and nowhere
 * else), so it has exactly one registration across both process placements.
 */
import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";

const reg = vi.hoisted(() => ({ names: [] as string[], intervals: 0 }));
const errors = vi.hoisted(() => ({ lines: [] as string[] }));

vi.mock("../../server/jobs/scheduler", async (orig) => {
  const actual = await orig<typeof import("../../server/jobs/scheduler")>();
  return {
    ...actual,
    scheduleSelfRescheduling: (opts: { name: string }) => {
      reg.names.push(opts.name);
      return () => {};
    },
  };
});

vi.mock("../../server/utils/jobRuntime", async (orig) => {
  const actual = await orig<typeof import("../../server/utils/jobRuntime")>();
  return {
    ...actual,
    trackInterval: () => {
      reg.intervals += 1;
      return 0 as unknown as ReturnType<typeof setInterval>;
    },
  };
});

vi.mock("../../server/utils/logger", async (orig) => {
  const actual = await orig<typeof import("../../server/utils/logger")>();
  const spy = (message: string, ...rest: unknown[]) => {
    if (typeof message === "string") errors.lines.push(message);
    void rest;
  };
  return {
    ...actual,
    logger: new Proxy(actual.logger as object, {
      get(t, p, r) {
        return p === "error" ? spy : Reflect.get(t, p, r);
      },
    }),
  };
});

describe("runScheduledJobs is idempotent in one process", () => {
  let runScheduledJobs: () => Promise<void>;

  // Many start*Job helpers register through a dynamic import, which needs real
  // time to resolve: wait until the registration count has stopped moving.
  const settle = async () => {
    let last = -1;
    for (let i = 0; i < 100; i++) {
      await new Promise((r) => setTimeout(r, 300));
      const now = reg.names.length + reg.intervals;
      if (now === last) return;
      last = now;
    }
  };

  beforeAll(async () => {
    ({ runScheduledJobs } = await import("../../server/jobs/runScheduledJobs"));
  }, 60_000);

  afterAll(async () => {
    await settle(); // don't tear the environment down under an in-flight import
  }, 60_000);

  it("a second call registers nothing and says so loudly", async () => {
    await runScheduledJobs();
    await settle();
    const firstNames = [...reg.names];
    const firstIntervals = reg.intervals;
    expect(firstNames.length).toBeGreaterThan(0); // vacuity: the real catalogue ran
    expect(firstIntervals).toBeGreaterThan(0);

    errors.lines.length = 0;
    await runScheduledJobs();
    await settle();

    expect(reg.names).toEqual(firstNames); // no new self-rescheduling loops
    expect(reg.intervals).toBe(firstIntervals); // no new interval loops
    expect(errors.lines.some((l) => /DUPLICATE CALL REFUSED/.test(l))).toBe(true);
  }, 60_000);

  it("the janitor is registered exactly once, by runScheduledJobs", () => {
    expect(reg.names.filter((n) => n === "clean_expired_job_locks")).toHaveLength(1);
    expect(reg.names.filter((n) => n === "clean_borrower_sessions")).toHaveLength(1);
  });
});
