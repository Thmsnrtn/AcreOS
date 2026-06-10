/**
 * Scheduler lease-row claim semantics (Tier 1H — job bodies out of held
 * transactions).
 *
 * The scheduler replaced its run-the-body-inside-an-advisory-locked-
 * transaction pattern with a lease row in job_locks: short atomic claim,
 * body runs OUTSIDE any transaction, heartbeat re-extends, completion
 * releases. These tests pin the claim's mutual-exclusion contract against a
 * fake db that models the Postgres semantics the real statements rely on:
 *
 *   - conditional UPDATE matches only an expired row or one we already own
 *   - INSERT loses by unique violation (23505) when a row already exists
 *
 * The headline case is the concurrency one: two simultaneous claimers,
 * exactly one wins.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

// ── Fake job_locks table ─────────────────────────────────────────────────────
// Single-row model (every test uses one lease name). The fake interprets the
// exact statement shapes claimJobLease/releaseJobLease issue.

interface FakeRow {
  jobName: string;
  lockedBy: string;
  lockedAt: Date;
  expiresAt: Date;
}

const state = vi.hoisted(() => ({ row: null as FakeRow | null }));

vi.mock("../../server/db", () => {
  const db = {
    update: (_table: unknown) => ({
      set: (vals: { lockedBy: string; lockedAt: Date; expiresAt: Date }) => ({
        where: (_cond: unknown) => ({
          returning: async (_sel: unknown) => {
            // Atomic conditional UPDATE: matches iff a row exists AND
            // (expired OR owned by this claimer).
            await Promise.resolve(); // yield, like a real network round-trip
            const row = state.row;
            const now = new Date();
            if (row && (row.expiresAt < now || row.lockedBy === vals.lockedBy)) {
              state.row = { ...row, ...vals };
              return [{ id: 1 }];
            }
            return [];
          },
        }),
      }),
    }),
    insert: (_table: unknown) => ({
      values: async (vals: { jobName: string; lockedBy: string; expiresAt: Date }) => {
        await Promise.resolve();
        if (state.row) {
          const err = new Error("duplicate key value violates unique constraint");
          (err as Error & { code: string }).code = "23505";
          throw err;
        }
        state.row = { ...vals, lockedAt: new Date() };
      },
    }),
    delete: (_table: unknown) => ({
      where: async (_cond: unknown) => {
        await Promise.resolve();
        state.row = null;
      },
    }),
  };
  return { db };
});

import { claimJobLease, releaseJobLease } from "../../server/jobs/scheduler";

describe("claimJobLease — lease-row mutual exclusion", () => {
  beforeEach(() => {
    state.row = null;
  });

  it("two concurrent claimers: exactly one wins", async () => {
    const [a, b] = await Promise.all([
      claimJobLease("sched:concurrency_test", "machine-A", 60),
      claimJobLease("sched:concurrency_test", "machine-B", 60),
    ]);
    expect([a, b].filter(Boolean)).toHaveLength(1);
    expect(state.row).not.toBeNull();
    expect(["machine-A", "machine-B"]).toContain(state.row!.lockedBy);
  });

  it("a second claimer is rejected while the lease is unexpired", async () => {
    expect(await claimJobLease("sched:x", "machine-A", 60)).toBe(true);
    expect(await claimJobLease("sched:x", "machine-B", 60)).toBe(false);
    expect(state.row!.lockedBy).toBe("machine-A");
  });

  it("the owner can re-claim (heartbeat extend) and the TTL moves forward", async () => {
    expect(await claimJobLease("sched:x", "machine-A", 60)).toBe(true);
    const firstExpiry = state.row!.expiresAt.getTime();
    await new Promise((r) => setTimeout(r, 5));
    expect(await claimJobLease("sched:x", "machine-A", 60)).toBe(true);
    expect(state.row!.expiresAt.getTime()).toBeGreaterThan(firstExpiry);
    expect(state.row!.lockedBy).toBe("machine-A");
  });

  it("an expired lease can be stolen by another machine", async () => {
    // ttlSeconds = -1 ⇒ the lease is born expired.
    expect(await claimJobLease("sched:x", "machine-A", -1)).toBe(true);
    expect(await claimJobLease("sched:x", "machine-B", 60)).toBe(true);
    expect(state.row!.lockedBy).toBe("machine-B");
  });

  it("release clears the lease so the next claimer wins", async () => {
    expect(await claimJobLease("sched:x", "machine-A", 60)).toBe(true);
    await releaseJobLease("sched:x", "machine-A");
    expect(await claimJobLease("sched:x", "machine-B", 60)).toBe(true);
    expect(state.row!.lockedBy).toBe("machine-B");
  });
});
