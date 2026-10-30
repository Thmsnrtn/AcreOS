/**
 * `scheduleSelfRescheduling refuses a duplicate name` (scheduler double-boot
 * fix, 2026-10).
 *
 * Decision: a second ACTIVE registration of the same name in one process is a
 * no-op with a loud error log (refusal, not replacement — the loop already
 * running keeps its state). The returned cancel of a refused registration does
 * nothing, so it can never kill the legitimate loop. Cancelling frees the name.
 * Distinct names are unaffected.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const logs = vi.hoisted(() => ({ errors: [] as string[] }));

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    error: (m: string) => {
      logs.errors.push(m);
    },
  },
}));

vi.mock("../../server/db", () => {
  const thenable = (rows: unknown[]) => ({
    returning: async () => rows,
    then: (resolve: (v: unknown) => void) => resolve(undefined),
  });
  return {
    db: {
      update: () => ({ set: () => ({ where: () => thenable([{ id: 1 }]) }) }),
      insert: () => ({ values: () => thenable([{ id: 1 }]) }),
      delete: () => ({ where: async () => undefined }),
    },
    pool: {},
  };
});

import { scheduleSelfRescheduling, getAllJobRuntimeStatus } from "../../server/jobs/scheduler";

describe("scheduleSelfRescheduling refuses a duplicate name", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    logs.errors.length = 0;
  });
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("runs one loop and logs loudly when the same name is registered twice", async () => {
    const run = vi.fn(async () => {});
    const cancelA = scheduleSelfRescheduling({ name: "dup_probe", intervalMs: 1000, run });
    const cancelB = scheduleSelfRescheduling({ name: "dup_probe", intervalMs: 1000, run });

    expect(logs.errors.some((m) => /dup_probe.*DUPLICATE REGISTRATION REFUSED/.test(m))).toBe(true);
    expect(getAllJobRuntimeStatus().filter((s) => s.name === "dup_probe")).toHaveLength(1);

    await vi.advanceTimersByTimeAsync(0); // first tick
    expect(run).toHaveBeenCalledTimes(1); // a doubled loop would be 2
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(2); // 1 per interval, not 2

    cancelB(); // refused registration's cancel is inert
    await vi.advanceTimersByTimeAsync(1000);
    expect(run).toHaveBeenCalledTimes(3);

    cancelA();
    await vi.advanceTimersByTimeAsync(5000);
    expect(run).toHaveBeenCalledTimes(3);
  });

  it("does not affect distinct names, and a cancelled name can be re-registered", async () => {
    const a = vi.fn(async () => {});
    const b = vi.fn(async () => {});
    const cancelA = scheduleSelfRescheduling({ name: "distinct_a", intervalMs: 1000, run: a });
    scheduleSelfRescheduling({ name: "distinct_b", intervalMs: 1000, run: b });
    expect(logs.errors).toHaveLength(0);

    cancelA();
    const a2 = vi.fn(async () => {});
    scheduleSelfRescheduling({ name: "distinct_a", intervalMs: 1000, run: a2 });
    expect(logs.errors).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(a2).toHaveBeenCalledTimes(1);
  });
});
