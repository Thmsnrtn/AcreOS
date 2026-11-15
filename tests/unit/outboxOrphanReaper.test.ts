/**
 * Outbox orphan reaper — regression suite (P1-16 F-C7).
 *
 * The reaper is the worker's crash-recovery path (WS5 drill orphaned 196/200
 * claimed rows). It was inline in worker.ts and untested; these tests pin its
 * shipped behaviour by rendering the exact statement it hands to `execute`.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

vi.mock("../../server/db", () => ({ db: { execute: vi.fn() } }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  reapOrphanedOutbox,
  OUTWARD_EVENT_TYPES,
  REAP_RUNNING_TTL_MS,
} from "../../server/services/outboxOrphanReaper";
import { logger } from "../../server/utils/logger";

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);
const dialect = new PgDialect();

async function run(opts: { rows?: unknown[]; maxAttempts?: number; ttlMs?: number } = {}) {
  const recorded: SQL[] = [];
  const execute = vi.fn(async (q: SQL) => {
    recorded.push(q);
    return { rows: opts.rows ?? [] };
  });
  await reapOrphanedOutbox({
    execute,
    nowMs: () => NOW,
    maxAttempts: opts.maxAttempts ?? 5,
    ...(opts.ttlMs !== undefined ? { ttlMs: opts.ttlMs } : {}),
  });
  expect(recorded).toHaveLength(1);
  const { sql: text, params } = dialect.sqlToQuery(recorded[0]);
  return { text: text.replace(/\s+/g, " ").trim(), params };
}

beforeEach(() => vi.clearAllMocks());

describe("exports", () => {
  it("OUTWARD_EVENT_TYPES is exactly lifecycle_email + cmo.broadcast", () => {
    expect([...OUTWARD_EVENT_TYPES].sort()).toEqual(["cmo.broadcast", "lifecycle_email"]);
  });
  it("REAP_RUNNING_TTL_MS defaults to 30 minutes", () => {
    expect(REAP_RUNNING_TTL_MS).toBe(1_800_000);
  });
});

describe("statement shape", () => {
  it("updates outbox rows that are status='running' and stale or never-claimed", async () => {
    const { text, params } = await run({ ttlMs: REAP_RUNNING_TTL_MS });
    expect(text).toMatch(/^UPDATE outbox SET /);
    expect(text).toContain("WHERE status = 'running' AND (claimed_at IS NULL OR claimed_at < $");
    expect(text).toContain("RETURNING id, event_type, status AS new_status");
    const cutoff = params.find((p) => p instanceof Date) as Date;
    expect(cutoff.getTime()).toBe(NOW - 1_800_000);
    // exactly one Date param: the cutoff
    expect(params.filter((p) => p instanceof Date)).toHaveLength(1);
  });

  it("cutoff tracks the injected TTL", async () => {
    const { params } = await run({ ttlMs: 60_000 });
    expect((params.find((p) => p instanceof Date) as Date).getTime()).toBe(NOW - 60_000);
  });

  it("CASE arms: outward → failed, then attempts → failed, else retry (in order)", async () => {
    const { text, params } = await run({ maxAttempts: 7 });
    const m = text.match(
      /SET status = CASE WHEN event_type IN \(([^)]*)\) THEN 'failed' WHEN attempts >= \$(\d+) THEN 'failed' ELSE 'retry' END/,
    );
    expect(m).not.toBeNull();
    const outwardIdx = [...m![1].matchAll(/\$(\d+)/g)].map((x) => Number(x[1]) - 1);
    expect(outwardIdx.map((i) => params[i]).sort()).toEqual(["cmo.broadcast", "lifecycle_email"]);
    expect(params[Number(m![2]) - 1]).toBe(7);
  });

  it("error message names the orphan reap and the TTL in minutes (30 at default)", async () => {
    const { text, params } = await run({ ttlMs: REAP_RUNNING_TTL_MS });
    expect(text).toContain("last_error_at = now()");
    expect(text).toContain("'reaped: orphaned running row past ' || $");
    expect(text).toContain("|| 'min TTL (likely a worker crash mid-batch)'");
    expect(params).toContain(30);
  });
});

describe("logging", () => {
  it("counts requeued vs failed in exactly one warn", async () => {
    await run({ rows: [{ new_status: "retry" }, { new_status: "failed" }, { new_status: "retry" }] });
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const msg = (logger.warn as any).mock.calls[0][0] as string;
    expect(msg).toBe(
      "[worker] reaped 3 orphaned running outbox row(s): 2 requeued, 1 failed (at-most-once / attempts exhausted)",
    );
  });

  it("zero rows → no warn", async () => {
    await run({ rows: [] });
    expect(logger.warn).not.toHaveBeenCalled();
  });
});

describe("never throws", () => {
  it("resolves and warns when execute rejects", async () => {
    await expect(
      reapOrphanedOutbox({
        execute: async () => {
          throw new Error("db down");
        },
        nowMs: () => NOW,
      }),
    ).resolves.toBeUndefined();
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [msg, err] = (logger.warn as any).mock.calls[0];
    expect(msg).toBe("[worker] outbox orphan reap failed");
    expect(err).toBeInstanceOf(Error);
  });
});
