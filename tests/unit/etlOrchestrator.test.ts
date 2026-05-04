/**
 * Phase 8 Months 11 — Wenzeslaus ETL orchestrator unit tests.
 *
 * Verifies the load-bearing contracts:
 *
 *   1. First run with empty watermark fetches all records.
 *   2. The watermark is advanced to the max `updatedAt` seen.
 *   3. The next run with that watermark only fetches strictly newer
 *      records.
 *   4. A failing handler.upsert() lands the record in the DLQ instead
 *      of aborting the whole run.
 *   5. replayDlqRecord() re-runs the handler against the captured
 *      payload and burns the DLQ row on success.
 *
 * The DB layer is mocked end-to-end so we don't need Postgres.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted in-memory DB mock ──────────────────────────────────────────────

const hoisted = vi.hoisted(() => {
  type EtlJobRow = {
    id: number;
    jobName: string;
    providerName: string;
    sourceUrl: string | null;
    watermarkColumn: string | null;
    watermarkValue: string | null;
    schedule: string;
    isActive: boolean;
    softDeleteOnMissing: boolean;
    lastSuccessAt: Date | null;
    lastErrorAt: Date | null;
    lastError: string | null;
    config: Record<string, unknown>;
    createdAt: Date;
    updatedAt: Date;
  };
  type EtlRunRow = {
    id: number;
    jobId: number;
    startedAt: Date;
    completedAt: Date | null;
    status: string;
    recordsRead: number;
    recordsInserted: number;
    recordsUpdated: number;
    recordsDeleted: number;
    recordsFailed: number;
    errorMessage: string | null;
    watermarkBefore: string | null;
    watermarkAfter: string | null;
  };
  type DlqRow = {
    id: number;
    eventType: string;
    payload: Record<string, unknown>;
    status: string;
    attempts: number;
    lastErrorAt: Date | null;
    failedAt: Date;
    failureReason: string;
  };

  const state = {
    jobs: [] as EtlJobRow[],
    runs: [] as EtlRunRow[],
    dlq: [] as DlqRow[],
    runSeq: 1,
    dlqSeq: 1,
  };

  // Magic table sentinels — `eq()` etc only need referential equality.
  const tables = {
    etlJobs: { __t: "etl_jobs" },
    etlRuns: { __t: "etl_runs" },
    outboxDlq: { __t: "outbox_dlq" },
  };

  function tableOf(target: any): keyof typeof tables | null {
    if (target === tables.etlJobs) return "etlJobs";
    if (target === tables.etlRuns) return "etlRuns";
    if (target === tables.outboxDlq) return "outboxDlq";
    return null;
  }

  // Build an extremely small drizzle-shaped fluent API. Drizzle calls
  // chain like `.select().from(t).where(cond).orderBy(...).limit(N)` and
  // resolve to an array. We don't honour `where` filters precisely — we
  // record the intended target and the most recent comparator so each
  // test path can be served deterministically.

  function selectChain(target: any, options: { whereId?: number; whereJobName?: string; whereJobId?: number; whereEventType?: string } = {}) {
    const t = tableOf(target);
    const finish = async (): Promise<any[]> => {
      if (t === "etlJobs") {
        let rows = state.jobs;
        if (options.whereId != null) rows = rows.filter((r) => r.id === options.whereId);
        if (options.whereJobName != null)
          rows = rows.filter((r) => r.jobName === options.whereJobName);
        return rows;
      }
      if (t === "etlRuns") {
        let rows = state.runs;
        if (options.whereJobId != null)
          rows = rows.filter((r) => r.jobId === options.whereJobId);
        return rows;
      }
      if (t === "outboxDlq") {
        let rows = state.dlq;
        if (options.whereId != null) rows = rows.filter((r) => r.id === options.whereId);
        if (options.whereEventType != null)
          rows = rows.filter((r) => r.eventType === options.whereEventType);
        return rows;
      }
      return [];
    };
    const chain: any = {
      where: (cond: any) => {
        const c = cond ?? {};
        return selectChain(target, { ...options, ...c });
      },
      orderBy: () => chain,
      limit: () => chain,
      then: (resolve: any, reject?: any) => finish().then(resolve, reject),
      catch: (reject: any) => finish().catch(reject),
    };
    return chain;
  }

  const dbMock = {
    select: () => ({
      from: (target: any) => selectChain(target),
    }),
    insert: (target: any) => ({
      values: (vals: any) => {
        const t = tableOf(target);
        const row = Array.isArray(vals) ? vals[0] : vals;
        const insert = () => {
          if (t === "etlJobs") {
            const id = state.jobs.length + 1;
            const now = new Date();
            state.jobs.push({
              id,
              jobName: row.jobName,
              providerName: row.providerName,
              sourceUrl: row.sourceUrl ?? null,
              watermarkColumn: row.watermarkColumn ?? null,
              watermarkValue: row.watermarkValue ?? null,
              schedule: row.schedule ?? "*/15 * * * *",
              isActive: row.isActive ?? true,
              softDeleteOnMissing: row.softDeleteOnMissing ?? false,
              lastSuccessAt: row.lastSuccessAt ?? null,
              lastErrorAt: row.lastErrorAt ?? null,
              lastError: row.lastError ?? null,
              config: row.config ?? {},
              createdAt: now,
              updatedAt: now,
            });
            return [{ id }];
          }
          if (t === "etlRuns") {
            const id = state.runSeq++;
            state.runs.push({
              id,
              jobId: row.jobId,
              startedAt: new Date(),
              completedAt: null,
              status: row.status ?? "running",
              recordsRead: row.recordsRead ?? 0,
              recordsInserted: row.recordsInserted ?? 0,
              recordsUpdated: row.recordsUpdated ?? 0,
              recordsDeleted: row.recordsDeleted ?? 0,
              recordsFailed: row.recordsFailed ?? 0,
              errorMessage: row.errorMessage ?? null,
              watermarkBefore: row.watermarkBefore ?? null,
              watermarkAfter: row.watermarkAfter ?? null,
            });
            return [{ id }];
          }
          if (t === "outboxDlq") {
            const id = state.dlqSeq++;
            state.dlq.push({
              id,
              eventType: row.eventType,
              payload: row.payload ?? {},
              status: row.status ?? "failed",
              attempts: row.attempts ?? 0,
              lastErrorAt: row.lastErrorAt ?? null,
              failedAt: new Date(),
              failureReason: row.failureReason,
            });
            return [{ id }];
          }
          return [];
        };
        const promise: any = {
          returning: async () => insert(),
          then: (resolve: any, reject?: any) => {
            try {
              insert();
              return Promise.resolve(undefined).then(resolve, reject);
            } catch (e) {
              return Promise.reject(e).catch(reject);
            }
          },
          catch: () => promise,
        };
        return promise;
      },
    }),
    update: (target: any) => ({
      set: (patch: any) => ({
        where: async (cond: any) => {
          const t = tableOf(target);
          const c = cond ?? {};
          if (t === "etlJobs") {
            for (const r of state.jobs) {
              if (c.whereId != null && r.id !== c.whereId) continue;
              Object.assign(r, patch);
            }
          } else if (t === "etlRuns") {
            for (const r of state.runs) {
              if (c.whereId != null && r.id !== c.whereId) continue;
              Object.assign(r, patch);
            }
          } else if (t === "outboxDlq") {
            for (const r of state.dlq) {
              if (c.whereId != null && r.id !== c.whereId) continue;
              Object.assign(r, patch);
            }
          }
        },
      }),
    }),
    delete: (target: any) => ({
      where: async (cond: any) => {
        const t = tableOf(target);
        const c = cond ?? {};
        if (t === "outboxDlq") {
          state.dlq = state.dlq.filter((r) => r.id !== c.whereId);
        }
      },
    }),
  };

  // eq()/and()/like() return a small object the chain helpers above can
  // read. Since drizzle's actual operators are opaque tokens, our mock
  // just needs them to round-trip the column → comparator pairing.
  const eq = (col: any, val: any) => {
    if (col?.__col === "id") return { whereId: val };
    if (col?.__col === "jobId") return { whereJobId: val };
    if (col?.__col === "jobName") return { whereJobName: val };
    if (col?.__col === "eventType") return { whereEventType: val };
    if (col?.__col === "isActive") return {}; // we ignore in test
    return {};
  };
  const and = (...conds: any[]) => Object.assign({}, ...conds);
  const like = (_col: any, _val: any) => ({});

  return { state, tables, dbMock, eq, and, like };
});

// ─── Mocks ──────────────────────────────────────────────────────────────────

vi.mock("../../server/db", () => ({ db: hoisted.dbMock }));

vi.mock("drizzle-orm", () => ({
  eq: hoisted.eq,
  and: hoisted.and,
  like: hoisted.like,
  desc: (x: any) => x,
  asc: (x: any) => x,
  sql: Object.assign(
    (..._args: any[]) => ({}),
    { raw: (..._args: any[]) => ({}) },
  ),
  isNull: () => ({}),
  gte: () => ({}),
}));

vi.mock("@shared/schema", () => {
  const cols = (table: any, names: string[]) => {
    for (const n of names) {
      table[n] = { __col: n };
    }
    return table;
  };
  const etlJobs = cols(hoisted.tables.etlJobs, [
    "id",
    "jobName",
    "providerName",
    "sourceUrl",
    "watermarkColumn",
    "watermarkValue",
    "schedule",
    "isActive",
    "softDeleteOnMissing",
    "lastSuccessAt",
    "lastErrorAt",
    "lastError",
    "config",
    "createdAt",
    "updatedAt",
  ]);
  const etlRuns = cols(hoisted.tables.etlRuns, [
    "id",
    "jobId",
    "startedAt",
    "completedAt",
    "status",
    "recordsRead",
    "recordsInserted",
    "recordsUpdated",
    "recordsDeleted",
    "recordsFailed",
    "errorMessage",
    "watermarkBefore",
    "watermarkAfter",
  ]);
  const outboxDlq = cols(hoisted.tables.outboxDlq, [
    "id",
    "eventType",
    "payload",
    "status",
    "attempts",
    "lastErrorAt",
    "failedAt",
    "failureReason",
  ]);
  return { etlJobs, etlRuns, outboxDlq };
});

vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../server/storage", () => ({
  storage: {
    acquireJobLock: vi.fn().mockResolvedValue(true),
    releaseJobLock: vi.fn().mockResolvedValue(undefined),
  },
}));

// ─── System under test ──────────────────────────────────────────────────────

import {
  registerEtlHandler,
  runJob,
  replayDlqRecord,
  _clearEtlHandlersForTest,
  type EtlProviderHandler,
  type EtlRecord,
} from "../../server/services/etlOrchestrator";

// ─── Test fixtures ──────────────────────────────────────────────────────────

function makeFixture() {
  // Two records "all-time" — first ever pull should see both.
  const all: Array<{ id: string; updatedAt: string }> = [
    { id: "a", updatedAt: "2026-01-01T00:00:00.000Z" },
    { id: "b", updatedAt: "2026-02-01T00:00:00.000Z" },
  ];
  // One record "after the watermark" — only the second pull should see it.
  const newer: Array<{ id: string; updatedAt: string }> = [
    { id: "c", updatedAt: "2026-03-01T00:00:00.000Z" },
  ];

  let upserted: EtlRecord[] = [];

  const handler: EtlProviderHandler = {
    name: "test_provider",
    fetch: async function* (opts) {
      const since = opts.since
        ? typeof opts.since === "string"
          ? opts.since
          : opts.since.toISOString()
        : null;
      const source = since ? newer : all;
      for (const r of source) {
        yield {
          externalId: r.id,
          updatedAt: r.updatedAt,
          payload: { id: r.id, updatedAt: r.updatedAt },
        };
      }
    },
    upsert: async (record) => {
      upserted.push(record);
      return { action: "inserted" };
    },
  };

  return { handler, getUpserted: () => upserted, resetUpserted: () => (upserted = []) };
}

// ─── Tests ──────────────────────────────────────────────────────────────────

describe("etlOrchestrator.runJob — watermark behaviour", () => {
  beforeEach(() => {
    hoisted.state.jobs.length = 0;
    hoisted.state.runs.length = 0;
    hoisted.state.dlq.length = 0;
    hoisted.state.runSeq = 1;
    hoisted.state.dlqSeq = 1;
    _clearEtlHandlersForTest();
  });

  it("first run with empty watermark fetches every record and advances watermark to max(updatedAt)", async () => {
    const { handler, getUpserted } = makeFixture();
    registerEtlHandler("test_provider", handler);

    // Seed an etl_jobs row with a null watermark (i.e. never run before).
    hoisted.state.jobs.push({
      id: 1,
      jobName: "test_job",
      providerName: "test_provider",
      sourceUrl: null,
      watermarkColumn: "updated_at",
      watermarkValue: null,
      schedule: "*/15 * * * *",
      isActive: true,
      softDeleteOnMissing: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runJob(1);

    expect(result.status).toBe("success");
    expect(result.stats.read).toBe(2);
    expect(result.stats.inserted).toBe(2);
    expect(result.stats.failed).toBe(0);
    expect(getUpserted().map((r) => r.externalId).sort()).toEqual(["a", "b"]);
    // Watermark advances to the highest updatedAt seen.
    expect(result.watermarkAfter).toBe("2026-02-01T00:00:00.000Z");

    // Persisted on the etl_jobs row.
    expect(hoisted.state.jobs[0].watermarkValue).toBe(
      "2026-02-01T00:00:00.000Z",
    );
    expect(hoisted.state.jobs[0].lastSuccessAt).toBeInstanceOf(Date);
  });

  it("second run with watermark only pulls records newer than the watermark", async () => {
    const { handler, getUpserted, resetUpserted } = makeFixture();
    registerEtlHandler("test_provider", handler);
    hoisted.state.jobs.push({
      id: 1,
      jobName: "test_job",
      providerName: "test_provider",
      sourceUrl: null,
      watermarkColumn: "updated_at",
      watermarkValue: null,
      schedule: "*/15 * * * *",
      isActive: true,
      softDeleteOnMissing: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    await runJob(1); // populates watermark
    resetUpserted();

    const second = await runJob(1);

    expect(second.status).toBe("success");
    expect(second.stats.read).toBe(1);
    expect(getUpserted().map((r) => r.externalId)).toEqual(["c"]);
    expect(second.watermarkAfter).toBe("2026-03-01T00:00:00.000Z");
  });
});

describe("etlOrchestrator — DLQ + replay", () => {
  beforeEach(() => {
    hoisted.state.jobs.length = 0;
    hoisted.state.runs.length = 0;
    hoisted.state.dlq.length = 0;
    hoisted.state.runSeq = 1;
    hoisted.state.dlqSeq = 1;
    _clearEtlHandlersForTest();
  });

  it("dead-letters a per-record failure without aborting the run, then replay re-runs the handler and burns the DLQ row", async () => {
    let upsertAttempts = 0;
    const goodRecords: EtlRecord[] = [];
    let shouldFail = true;

    const handler: EtlProviderHandler = {
      name: "flaky",
      fetch: async function* () {
        yield {
          externalId: "doomed",
          updatedAt: "2026-04-01T00:00:00.000Z",
          payload: { id: "doomed" },
        };
        yield {
          externalId: "fine",
          updatedAt: "2026-04-02T00:00:00.000Z",
          payload: { id: "fine" },
        };
      },
      upsert: async (record) => {
        upsertAttempts += 1;
        if (record.externalId === "doomed" && shouldFail) {
          throw new Error("simulated upsert failure");
        }
        goodRecords.push(record);
        return { action: "inserted" };
      },
    };
    registerEtlHandler("flaky", handler);

    hoisted.state.jobs.push({
      id: 1,
      jobName: "flaky_job",
      providerName: "flaky",
      sourceUrl: null,
      watermarkColumn: "updated_at",
      watermarkValue: null,
      schedule: "*/15 * * * *",
      isActive: true,
      softDeleteOnMissing: false,
      lastSuccessAt: null,
      lastErrorAt: null,
      lastError: null,
      config: {},
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const result = await runJob(1);

    // Run still succeeded overall — only the bad record got DLQ'd.
    expect(result.status).toBe("success");
    expect(result.stats.read).toBe(2);
    expect(result.stats.inserted).toBe(1);
    expect(result.stats.failed).toBe(1);
    expect(goodRecords.map((r) => r.externalId)).toEqual(["fine"]);

    // DLQ row exists with the original payload.
    expect(hoisted.state.dlq).toHaveLength(1);
    const dlqRow = hoisted.state.dlq[0];
    expect(dlqRow.eventType).toBe("etl:flaky_job:record");
    expect((dlqRow.payload as any).externalId).toBe("doomed");
    expect((dlqRow.payload as any).record).toBeDefined();

    // Now flip the handler to succeed and replay.
    shouldFail = false;
    const replay = await replayDlqRecord(dlqRow.id);

    expect(replay.ok).toBe(true);
    expect(upsertAttempts).toBeGreaterThan(2); // ran upsert again on replay
    // DLQ row removed on success.
    expect(hoisted.state.dlq).toHaveLength(0);
    // The previously-failing record is now in the "good" set.
    expect(goodRecords.map((r) => r.externalId).sort()).toEqual([
      "doomed",
      "fine",
    ]);
  });
});
