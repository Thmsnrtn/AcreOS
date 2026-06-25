/**
 * Tests for the Solene dispatch queue.
 *
 * Coverage:
 *  - enqueueDispatch rejects above-cap requests without founderOverride
 *  - enqueueDispatch accepts above-cap with founderOverride
 *  - enqueueDispatch rejects negative / zero / non-finite cost
 *  - enqueueDispatch rejects empty promptText
 *  - claimNextDispatch returns null on empty queue
 *  - claimNextDispatch respects priority DESC + queued_at ASC
 *  - claimNextDispatch under concurrent pull never returns same row twice
 *    (SKIP LOCKED guarantee — simulated via the mock's pull semantics)
 *  - completeDispatch writes both queue row + result row in a transaction
 *  - failDispatch with status='cancelled' writes the cancelled marker
 *
 * We mock `db` to keep this test unit-scope (no Postgres required).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

interface QueueRow {
  id: number;
  queued_at: Date;
  status: string;
  priority: string;
  source_type: string;
  source_id: string;
  agent_role: string;
  prompt_text: string;
  max_cost_usd: string;
  timeout_ms: number;
  started_at: Date | null;
  completed_at: Date | null;
  result_summary: string | null;
  result_full_path: string | null;
  enqueued_by: string | null;
  idempotency_key: string | null;
}

interface ResultRow {
  id: number;
  dispatch_id: number;
  success: boolean;
  cost_usd: string;
  error_message: string | null;
}

const QUEUE: QueueRow[] = [];
const RESULTS: ResultRow[] = [];
let nextQueueId = 1;
let nextResultId = 1;

vi.mock("../../db", () => {
  // Synchronous mutex-style claim: only one caller at a time can hold the
  // "claim transaction". This mirrors Postgres FOR UPDATE SKIP LOCKED
  // semantics for the test — two parallel claims see different rows.
  let claimLock = Promise.resolve();

  function makeTx() {
    return {
      insert: (table: unknown) => ({
        values: (row: any) => {
          const tableName = (table as any)?._?.name ?? "";
          if (tableName.includes("results") || row.dispatchId !== undefined) {
            RESULTS.push({
              id: nextResultId++,
              dispatch_id: row.dispatchId,
              success: row.success,
              cost_usd: row.costUsd,
              error_message: row.errorMessage ?? null,
            });
          } else {
            // queue insert
            const r: QueueRow = {
              id: nextQueueId++,
              queued_at: new Date(),
              status: row.status ?? "queued",
              priority: row.priority,
              source_type: row.sourceType,
              source_id: row.sourceId,
              agent_role: row.agentRole,
              prompt_text: row.promptText,
              max_cost_usd: row.maxCostUsd,
              timeout_ms: row.timeoutMs,
              started_at: null,
              completed_at: null,
              result_summary: null,
              result_full_path: null,
              enqueued_by: row.enqueuedBy ?? null,
              idempotency_key: row.idempotencyKey ?? null,
            };
            return {
              // Non-keyed path: unconditional insert (push at returning time).
              returning: (_cols: unknown) => {
                QUEUE.push(r);
                return Promise.resolve([{ id: r.id }]);
              },
              // Exactly-once path: insert ON CONFLICT (idempotency_key) DO NOTHING.
              onConflictDoNothing: (_t: unknown) => ({
                returning: (_cols: unknown) => {
                  if (r.idempotency_key != null && QUEUE.some((q) => q.idempotency_key === r.idempotency_key)) {
                    return Promise.resolve([]); // conflict — no second row
                  }
                  QUEUE.push(r);
                  return Promise.resolve([{ id: r.id }]);
                },
              }),
            };
          }
          return Promise.resolve();
        },
      }),
      update: (_table: unknown) => ({
        set: (patch: any) => ({
          where: (_clause: any) => {
            // We're naive — match on the most recently-set id via the clause
            // parameter. For tests, we look up by patch fields. The real
            // implementation has typed clauses; here we extract id from the
            // mock's expectation that callers pass id.
            const id = (_clause as any)?.__id;
            const row = QUEUE.find((q) => q.id === id);
            if (row) {
              if (patch.status !== undefined) row.status = patch.status;
              if (patch.startedAt !== undefined) row.started_at = patch.startedAt;
              if (patch.completedAt !== undefined) row.completed_at = patch.completedAt;
              if (patch.resultSummary !== undefined) row.result_summary = patch.resultSummary;
              if (patch.resultFullPath !== undefined) row.result_full_path = patch.resultFullPath;
            }
            return Promise.resolve();
          },
        }),
      }),
      select: (cols: any) => ({
        from: (_t: unknown) => ({
          where: (clause: any) => ({
            limit: (_n: number) => {
              // The mocked eq() sets __id to the compared VALUE — a numeric id
              // for claim/update lookups, or the effect-key string for
              // enqueueDispatch's exactly-once by-key fetch. Match either.
              const v = (clause as any)?.__id;
              const row = QUEUE.find((q) => q.id === v) ?? QUEUE.find((q) => q.idempotency_key === v);
              if (!row) return Promise.resolve([]);
              return Promise.resolve([{ id: row.id, status: row.status }]);
            },
          }),
        }),
      }),
    };
  }

  const db = {
    insert: (table: unknown) => makeTx().insert(table),
    update: (table: unknown) => makeTx().update(table),
    select: (cols: any) => makeTx().select(cols),
    transaction: async (fn: any) => {
      const tx = makeTx();
      return await fn(tx);
    },
    execute: async (_query: unknown) => {
      // claimNextDispatch — simulate SKIP LOCKED via mutex.
      let claimed: QueueRow | null = null;
      const release = await new Promise<() => void>((resolve) => {
        const prior = claimLock;
        let r: () => void = () => {};
        claimLock = new Promise<void>((rel) => {
          r = rel;
        });
        prior.then(() => resolve(r));
      });
      try {
        // Pull highest priority then earliest queued.
        const pickable = QUEUE
          .filter((q) => q.status === "queued")
          .sort((a, b) => {
            const pa = Number(a.priority);
            const pb = Number(b.priority);
            if (pa !== pb) return pb - pa;
            return a.queued_at.getTime() - b.queued_at.getTime();
          });
        if (pickable.length > 0) {
          claimed = pickable[0];
          claimed.status = "in_progress";
          claimed.started_at = new Date();
        }
      } finally {
        release();
      }
      if (!claimed) return { rows: [] } as any;
      return { rows: [claimed] } as any;
    },
  };

  return { db };
});

// drizzle's eq returns an object — give our mock a way to read the id.
vi.mock("drizzle-orm", async () => {
  const actual = await vi.importActual<typeof import("drizzle-orm")>("drizzle-orm");
  return {
    ...actual,
    eq: (_col: any, val: any) => ({ __id: val }),
  };
});

// These tests exercise queue mechanics, not the ensemble cost cap. The cap
// reads agent_dispatch MTD spend, which this file's DB mock doesn't model — and
// the cap now (correctly) fails CLOSED on an unreadable spend (re-audit it.3),
// so leaving it real would throw here. No-op the cap; keep the real error
// classes for the dedicated ensembleMonthlyCap.test.ts.
vi.mock("./capitalTracker", async () => {
  const actual = await vi.importActual<typeof import("./capitalTracker")>("./capitalTracker");
  return { ...actual, assertWithinEnsembleCap: vi.fn().mockResolvedValue(undefined) };
});

beforeEach(() => {
  QUEUE.length = 0;
  RESULTS.length = 0;
  nextQueueId = 1;
  nextResultId = 1;
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("dispatchQueue.enqueueDispatch", () => {
  it("rejects maxCostUsd above ceiling without founderOverride", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    await expect(
      enqueueDispatch({
        sourceType: "auto_dispatch",
        sourceId: "opp:1",
        agentRole: "iris",
        promptText: "hi",
        maxCostUsd: 101,
      }),
    ).rejects.toThrow(/exceeds ceiling/);
  });

  it("accepts above-cap when founderOverride=true", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    const id = await enqueueDispatch({
      sourceType: "founder_manual",
      sourceId: "founder:tom",
      agentRole: "iris",
      promptText: "deep dive — overnight investigation",
      maxCostUsd: 500,
      founderOverride: true,
    });
    expect(id).toBeGreaterThan(0);
  });

  it("rejects non-positive maxCostUsd", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    await expect(
      enqueueDispatch({
        sourceType: "detector",
        sourceId: "x",
        agentRole: "iris",
        promptText: "do something",
        maxCostUsd: 0,
      }),
    ).rejects.toThrow(/invalid maxCostUsd/);
    await expect(
      enqueueDispatch({
        sourceType: "detector",
        sourceId: "x",
        agentRole: "iris",
        promptText: "do something",
        maxCostUsd: -5,
      }),
    ).rejects.toThrow(/invalid maxCostUsd/);
  });

  it("rejects empty promptText", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    await expect(
      enqueueDispatch({
        sourceType: "detector",
        sourceId: "x",
        agentRole: "iris",
        promptText: "   ",
      }),
    ).rejects.toThrow(/promptText must be non-empty/);
  });

  // The 2026-06-05 cost audit (shared/schema/solene-dispatch.ts) lowered the
  // DEFAULT per-dispatch cap to $5 (DISPATCH_DEFAULT_COST_USD); $25 is now the
  // hard ceiling (DISPATCH_MAX_COST_USD), not the default.
  it("defaults maxCostUsd to $5 and timeoutMs to 10 minutes", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    const id = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "opp:42",
      agentRole: "soren",
      promptText: "small task",
    });
    const row = QUEUE.find((q) => q.id === id);
    expect(row).toBeDefined();
    expect(Number(row!.max_cost_usd)).toBe(5);
    expect(row!.timeout_ms).toBe(10 * 60 * 1000);
    expect(row!.status).toBe("queued");
  });
});

describe("dispatchQueue.claimNextDispatch", () => {
  it("returns null on empty queue", async () => {
    const { claimNextDispatch } = await import("./dispatchQueue");
    const r = await claimNextDispatch();
    expect(r).toBeNull();
  });

  it("respects priority DESC, then queued_at ASC", async () => {
    const { enqueueDispatch, claimNextDispatch } = await import("./dispatchQueue");
    const low = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "low",
      agentRole: "iris",
      promptText: "low",
      priority: 0.5,
    });
    await new Promise((r) => setTimeout(r, 5));
    const high1 = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "high1",
      agentRole: "iris",
      promptText: "h1",
      priority: 5.0,
    });
    await new Promise((r) => setTimeout(r, 5));
    const high2 = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "high2",
      agentRole: "iris",
      promptText: "h2",
      priority: 5.0,
    });

    const a = await claimNextDispatch();
    const b = await claimNextDispatch();
    const c = await claimNextDispatch();
    expect(a?.id).toBe(high1);
    expect(b?.id).toBe(high2);
    expect(c?.id).toBe(low);

    const empty = await claimNextDispatch();
    expect(empty).toBeNull();
  });

  it("under concurrent pull, never returns same row twice (SKIP LOCKED)", async () => {
    const { enqueueDispatch, claimNextDispatch } = await import("./dispatchQueue");
    const ids = await Promise.all(
      Array.from({ length: 4 }, (_, i) =>
        enqueueDispatch({
          sourceType: "auto_dispatch",
          sourceId: `c:${i}`,
          agentRole: "iris",
          promptText: `c${i}`,
        }),
      ),
    );
    // Two "workers" race for claims.
    const claims = await Promise.all([
      claimNextDispatch(),
      claimNextDispatch(),
      claimNextDispatch(),
      claimNextDispatch(),
    ]);
    const claimedIds = claims.map((c) => c?.id).filter(Boolean);
    // All 4 enqueued rows should have been claimed exactly once.
    expect(claimedIds.sort()).toEqual(ids.slice().sort());
    expect(new Set(claimedIds).size).toBe(claimedIds.length);
  });

  it("flips status to in_progress and sets started_at", async () => {
    const { enqueueDispatch, claimNextDispatch } = await import("./dispatchQueue");
    const id = await enqueueDispatch({
      sourceType: "detector",
      sourceId: "z",
      agentRole: "krieger",
      promptText: "z",
    });
    const claimed = await claimNextDispatch();
    expect(claimed?.id).toBe(id);
    expect(claimed?.status).toBe("in_progress");
    expect(claimed?.startedAt).toBeInstanceOf(Date);
  });
});

describe("dispatchQueue.completeDispatch / failDispatch", () => {
  it("completeDispatch writes both queue + result rows", async () => {
    const { enqueueDispatch, claimNextDispatch, completeDispatch } = await import(
      "./dispatchQueue"
    );
    const id = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "x",
      agentRole: "iris",
      promptText: "task",
    });
    await claimNextDispatch();
    await completeDispatch(id, {
      costUsd: 1.2345,
      durationMs: 60_000,
      tokenInput: 5000,
      tokenOutput: 1500,
      resultSummary: "shipped",
      resultFullPath: "/tmp/solene-dispatches/1.jsonl",
      commitsReferenced: ["abc123"],
      filesModified: ["server/x.ts"],
    });
    const queueRow = QUEUE.find((q) => q.id === id);
    expect(queueRow?.status).toBe("completed");
    expect(queueRow?.completed_at).toBeInstanceOf(Date);
    const resultRow = RESULTS.find((r) => r.dispatch_id === id);
    expect(resultRow?.success).toBe(true);
    expect(Number(resultRow?.cost_usd)).toBeCloseTo(1.2345, 4);
  });

  it("failDispatch with status='cancelled' marks cancelled", async () => {
    const { enqueueDispatch, failDispatch } = await import("./dispatchQueue");
    const id = await enqueueDispatch({
      sourceType: "auto_dispatch",
      sourceId: "y",
      agentRole: "iris",
      promptText: "task",
    });
    await failDispatch(
      id,
      { errorMessage: "kill switch", costUsd: 0.1 },
      { status: "cancelled" },
    );
    const queueRow = QUEUE.find((q) => q.id === id);
    expect(queueRow?.status).toBe("cancelled");
    const resultRow = RESULTS.find((r) => r.dispatch_id === id);
    expect(resultRow?.success).toBe(false);
    expect(resultRow?.error_message).toMatch(/kill switch/);
  });
});

describe("isOrphanedDispatch (pure) — Frontier #12 reaper predicate", () => {
  const NOW = 1_700_000_000_000;
  const ago = (ms: number) => new Date(NOW - ms);

  it("an in_progress dispatch past timeout + margin IS orphaned", async () => {
    const { isOrphanedDispatch } = await import("./dispatchQueue");
    const d = { status: "in_progress", startedAt: ago(20 * 60_000), timeoutMs: 10 * 60_000 };
    expect(isOrphanedDispatch(d, NOW)).toBe(true); // 20m > 10m + 5m margin
  });

  it("an in_progress dispatch still WITHIN timeout + margin is NOT orphaned", async () => {
    const { isOrphanedDispatch } = await import("./dispatchQueue");
    const d = { status: "in_progress", startedAt: ago(12 * 60_000), timeoutMs: 10 * 60_000 };
    expect(isOrphanedDispatch(d, NOW)).toBe(false); // 12m < 10m + 5m margin
  });

  it("never reaps a non-in_progress row, however stale", async () => {
    const { isOrphanedDispatch } = await import("./dispatchQueue");
    const old = { startedAt: ago(99 * 60_000), timeoutMs: 1 };
    expect(isOrphanedDispatch({ ...old, status: "queued" }, NOW)).toBe(false);
    expect(isOrphanedDispatch({ ...old, status: "completed" }, NOW)).toBe(false);
    expect(isOrphanedDispatch({ ...old, status: "failed" }, NOW)).toBe(false);
    expect(isOrphanedDispatch({ ...old, status: "cancelled" }, NOW)).toBe(false);
  });

  it("never reaps an in_progress row with no startedAt (claim not yet stamped)", async () => {
    const { isOrphanedDispatch } = await import("./dispatchQueue");
    expect(isOrphanedDispatch({ status: "in_progress", startedAt: null, timeoutMs: 1 }, NOW)).toBe(false);
  });

  it("the margin is honored exactly at the boundary", async () => {
    const { isOrphanedDispatch } = await import("./dispatchQueue");
    const at = (ms: number) => ({ status: "in_progress", startedAt: ago(ms), timeoutMs: 10 * 60_000 });
    expect(isOrphanedDispatch(at(15 * 60_000), NOW)).toBe(false); // exactly timeout+margin → not yet
    expect(isOrphanedDispatch(at(15 * 60_000 + 1), NOW)).toBe(true); // 1ms past → orphaned
  });
});

describe("computeEffectKey (pure) — exactly-once seal (panel #2)", () => {
  it("is deterministic — same effect + same window → identical key", async () => {
    const { computeEffectKey } = await import("./dispatchQueue");
    const a = computeEffectKey({ domain: "growth", moveKind: "grow_owned_channels", playId: "county-guide", targetId: "42", nowMs: 1_700_000_000_000 });
    const b = computeEffectKey({ domain: "growth", moveKind: "grow_owned_channels", playId: "county-guide", targetId: "42", nowMs: 1_700_000_000_000 });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("a concurrent tick within the same window dedups (same key); the next window differs", async () => {
    const { computeEffectKey, DEFAULT_EFFECT_WINDOW_MS } = await import("./dispatchQueue");
    const base = { domain: "growth", moveKind: "grow_owned_channels", playId: "p", targetId: "t" };
    const t0 = 1_700_000_000_000 - (1_700_000_000_000 % DEFAULT_EFFECT_WINDOW_MS); // window-aligned
    // two ticks inside the same window → same key (the double-fire dedups)
    expect(computeEffectKey({ ...base, nowMs: t0 + 1000 })).toBe(computeEffectKey({ ...base, nowMs: t0 + DEFAULT_EFFECT_WINDOW_MS - 1 }));
    // a tick in the NEXT window → different key (a legitimate later run proceeds)
    expect(computeEffectKey({ ...base, nowMs: t0 + 1000 })).not.toBe(computeEffectKey({ ...base, nowMs: t0 + DEFAULT_EFFECT_WINDOW_MS + 1000 }));
  });

  it("distinct targets / plays / domains / moves never collide", async () => {
    const { computeEffectKey } = await import("./dispatchQueue");
    const k = (o: any) => computeEffectKey({ domain: "growth", moveKind: "m", playId: "p", targetId: "t", nowMs: 1_700_000_000_000, ...o });
    const base = k({});
    expect(k({ targetId: "other" })).not.toBe(base);
    expect(k({ playId: "other" })).not.toBe(base);
    expect(k({ domain: "support" })).not.toBe(base);
    expect(k({ moveKind: "other" })).not.toBe(base);
  });
});

describe("enqueueDispatch — exactly-once on idempotencyKey", () => {
  it("a second enqueue with the SAME key returns the first id and inserts NO second row", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    const before = QUEUE.length;
    const opts = { sourceType: "auto_dispatch" as const, sourceId: "x", agentRole: "soren" as const, promptText: "go", idempotencyKey: "eff-key-abc" };
    const id1 = await enqueueDispatch(opts);
    const id2 = await enqueueDispatch(opts); // concurrent tick / retry
    expect(id2).toBe(id1);
    expect(QUEUE.length).toBe(before + 1); // exactly one row, not two
  });

  it("an UNKEYED enqueue is unaffected — always inserts", async () => {
    const { enqueueDispatch } = await import("./dispatchQueue");
    const before = QUEUE.length;
    await enqueueDispatch({ sourceType: "auto_dispatch", sourceId: "y", agentRole: "soren", promptText: "go" });
    await enqueueDispatch({ sourceType: "auto_dispatch", sourceId: "y", agentRole: "soren", promptText: "go" });
    expect(QUEUE.length).toBe(before + 2);
  });
});
