/**
 * Pillar 6 — data-cache/lookup-cache unit tests.
 *
 * Covers:
 *   1. Cache hit: second call with same fingerprint returns from cache and
 *      does NOT invoke fetchFn.
 *   2. Stale cache: third call after freshnessHours expiry refetches.
 *   3. Hit row inserted with the right orgId on every cache-served read.
 *   4. getCacheHitSavingsForOrg sums correctly across orgs.
 *
 * The drizzle-orm `db` object is replaced with a small in-memory fake that
 * implements the exact chainable surface the service uses.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─────────────────────────────────────────────────────────────────────────────
// In-memory fake DB. Captures rows the service writes so assertions can
// inspect them.
// ─────────────────────────────────────────────────────────────────────────────

type CachedLookupRow = {
  id: number;
  provider: string;
  entityType: string;
  queryFingerprint: string;
  resultJson: unknown;
  freshnessHours: number;
  firstFetchedAt: Date;
  firstFetchedBy: number | null;
  hits: number;
  lastHitAt: Date | null;
  costCents: number;
  createdAt: Date;
  updatedAt: Date;
};

type CachedLookupHitRow = {
  id: number;
  cachedLookupId: number;
  organizationId: number;
  hitAt: Date;
};

const state: {
  cachedLookups: CachedLookupRow[];
  cachedLookupHits: CachedLookupHitRow[];
  // Pending insert values, set by .values() and consumed by terminal methods.
  pendingInsertValues: any;
  pendingInsertTarget: "cached_lookups" | "cached_lookup_hits" | null;
  pendingUpdateValues: any;
  pendingUpdateTarget: "cached_lookups" | null;
  // Pending select state.
  pendingSelectColumns: any;
  pendingSelectFrom: "cached_lookups" | "cached_lookup_hits" | null;
  pendingSelectJoin: "cached_lookups" | null;
  pendingSelectWhere: ((row: any) => boolean) | null;
} = {
  cachedLookups: [],
  cachedLookupHits: [],
  pendingInsertValues: null,
  pendingInsertTarget: null,
  pendingUpdateValues: null,
  pendingUpdateTarget: null,
  pendingSelectColumns: null,
  pendingSelectFrom: null,
  pendingSelectJoin: null,
  pendingSelectWhere: null,
};

function resetState() {
  state.cachedLookups = [];
  state.cachedLookupHits = [];
  state.pendingInsertValues = null;
  state.pendingInsertTarget = null;
  state.pendingUpdateValues = null;
  state.pendingUpdateTarget = null;
  state.pendingSelectColumns = null;
  state.pendingSelectFrom = null;
  state.pendingSelectJoin = null;
  state.pendingSelectWhere = null;
}

// Sentinel objects for the schema; the service compares table references by
// identity in drizzle, but our fake just needs *some* object to dispatch on.
const cachedLookupsSentinel = { __table: "cached_lookups" } as any;
const cachedLookupHitsSentinel = { __table: "cached_lookup_hits" } as any;

vi.mock("@shared/schema", () => ({
  cachedLookups: cachedLookupsSentinel,
  cachedLookupHits: cachedLookupHitsSentinel,
}));

// Predicate builders. Our fake `where()` accepts a tag returned by the
// service's call to and(eq(...), eq(...)). We don't introspect what the
// service passes — we just resolve queries by scanning state with a
// caller-supplied predicate that the service-under-test wires up via
// drizzle helpers. To avoid coupling, the fake just returns ALL rows and
// the service filters in-memory? No — that would defeat the test. Instead
// we recreate matcher logic from the service's known query shape.

// Helpers used by drizzle mocks:
vi.mock("drizzle-orm", async () => {
  return {
    and: (...args: any[]) => ({ __op: "and", args }),
    eq: (col: any, val: any) => ({ __op: "eq", col, val }),
    gte: (col: any, val: any) => ({ __op: "gte", col, val }),
    sql: (strings: any, ...vals: any[]) => ({ __op: "sql", strings, vals }),
  };
});

function evalPredicate(pred: any, row: any): boolean {
  if (!pred) return true;
  if (pred.__op === "and") return pred.args.every((a: any) => evalPredicate(a, row));
  if (pred.__op === "eq") {
    const colName = pred.col?.name ?? pred.col?.__col ?? null;
    return row[colName] === pred.val;
  }
  if (pred.__op === "gte") {
    const colName = pred.col?.name ?? pred.col?.__col ?? null;
    return row[colName] >= pred.val;
  }
  return true;
}

// Column reference helpers — give each schema table a column proxy so
// `eq(cachedLookups.provider, "x")` lands as { col: { __col: "provider" } }.
function columnProxy(table: "cached_lookups" | "cached_lookup_hits") {
  return new Proxy({} as any, {
    get(_target, key) {
      return { __col: String(key), __table: table, name: String(key) };
    },
  });
}

cachedLookupsSentinel.id = { __col: "id", name: "id" };
cachedLookupsSentinel.provider = { __col: "provider", name: "provider" };
cachedLookupsSentinel.entityType = { __col: "entityType", name: "entityType" };
cachedLookupsSentinel.queryFingerprint = { __col: "queryFingerprint", name: "queryFingerprint" };
cachedLookupsSentinel.firstFetchedAt = { __col: "firstFetchedAt", name: "firstFetchedAt" };
cachedLookupsSentinel.hits = { __col: "hits", name: "hits" };
cachedLookupsSentinel.costCents = { __col: "costCents", name: "costCents" };

cachedLookupHitsSentinel.id = { __col: "id", name: "id" };
cachedLookupHitsSentinel.cachedLookupId = { __col: "cachedLookupId", name: "cachedLookupId" };
cachedLookupHitsSentinel.organizationId = { __col: "organizationId", name: "organizationId" };
cachedLookupHitsSentinel.hitAt = { __col: "hitAt", name: "hitAt" };

const db = {
  select: (cols?: any) => ({
    from: (table: any) => {
      const tableName = table.__table;
      const ctx = { tableName, joined: null as string | null, where: null as any };
      const chain: any = {
        innerJoin(joinTable: any, _on: any) {
          ctx.joined = joinTable.__table;
          return chain;
        },
        where(predicate: any) {
          ctx.where = predicate;
          return chain;
        },
        limit(_n: number) {
          return chain._execute();
        },
        async _execute() {
          if (tableName === "cached_lookups" && !ctx.joined) {
            const rows = state.cachedLookups.filter((r) => evalPredicate(ctx.where, r));
            if (cols && cols.count) {
              return [{ count: rows.length }];
            }
            return rows;
          }
          if (tableName === "cached_lookup_hits" && !ctx.joined) {
            const rows = state.cachedLookupHits.filter((r) => evalPredicate(ctx.where, r));
            if (cols && cols.count) return [{ count: rows.length }];
            return rows;
          }
          if (tableName === "cached_lookup_hits" && ctx.joined === "cached_lookups") {
            // savings query: join hits → lookups, filter on hits side
            const hitRows = state.cachedLookupHits.filter((r) => evalPredicate(ctx.where, r));
            let savings = 0;
            let hitCount = 0;
            for (const hit of hitRows) {
              const lookup = state.cachedLookups.find((l) => l.id === hit.cachedLookupId);
              if (!lookup) continue;
              savings += lookup.costCents ?? 0;
              hitCount += 1;
            }
            return [{ savingsCents: savings, hitCount }];
          }
          return [];
        },
        // Make the chain awaitable when not terminated by .limit().
        then(onF: any, onR: any) {
          return chain._execute().then(onF, onR);
        },
      };
      return chain;
    },
  }),

  insert: (table: any) => ({
    values(vals: any) {
      const insertedRows: any[] = [];
      const target = table.__table;
      const apply = () => {
        if (target === "cached_lookups") {
          const conflict = state.cachedLookups.find(
            (r) => r.provider === vals.provider
              && r.entityType === vals.entityType
              && r.queryFingerprint === vals.queryFingerprint,
          );
          if (conflict) {
            // Will be handled in onConflictDoUpdate.
            return { conflict };
          }
          const row: CachedLookupRow = {
            id: state.cachedLookups.length + 1,
            provider: vals.provider,
            entityType: vals.entityType,
            queryFingerprint: vals.queryFingerprint,
            resultJson: vals.resultJson,
            freshnessHours: vals.freshnessHours,
            firstFetchedAt: vals.firstFetchedAt,
            firstFetchedBy: vals.firstFetchedBy ?? null,
            hits: vals.hits ?? 0,
            lastHitAt: vals.lastHitAt ?? null,
            costCents: vals.costCents ?? 0,
            createdAt: vals.createdAt ?? new Date(),
            updatedAt: vals.updatedAt ?? new Date(),
          };
          state.cachedLookups.push(row);
          insertedRows.push(row);
          return { row };
        }
        if (target === "cached_lookup_hits") {
          const row: CachedLookupHitRow = {
            id: state.cachedLookupHits.length + 1,
            cachedLookupId: vals.cachedLookupId,
            organizationId: vals.organizationId,
            hitAt: vals.hitAt ?? new Date(),
          };
          state.cachedLookupHits.push(row);
          insertedRows.push(row);
          return { row };
        }
        return {};
      };
      const result = apply();
      const chain: any = {
        onConflictDoUpdate(opts: any) {
          if (result?.conflict && target === "cached_lookups") {
            const conflict = result.conflict as CachedLookupRow;
            Object.assign(conflict, opts.set);
            insertedRows.push(conflict);
          }
          return chain;
        },
        returning(_cols?: any) {
          return Promise.resolve(insertedRows.map((r) => ({ id: r.id })));
        },
        then(onF: any, onR: any) {
          return Promise.resolve(insertedRows).then(onF, onR);
        },
      };
      return chain;
    },
  }),

  update: (table: any) => ({
    set(vals: any) {
      const target = table.__table;
      return {
        async where(predicate: any) {
          const rows = target === "cached_lookups" ? state.cachedLookups : state.cachedLookupHits;
          for (const r of rows) {
            if (evalPredicate(predicate, r)) {
              for (const [k, v] of Object.entries(vals)) {
                if (v && (v as any).__op === "sql") {
                  // crude: assume `hits + 1`
                  (r as any).hits = ((r as any).hits ?? 0) + 1;
                } else {
                  (r as any)[k] = v;
                }
              }
            }
          }
        },
      };
    },
  }),
};

vi.mock("../../server/db", () => ({ db, withTransaction: async (fn: any) => fn(db) }));
vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("data-cache/lookup-cache", () => {
  beforeEach(() => {
    resetState();
    vi.useRealTimers();
  });

  it("normalizeQuery is deterministic across input ordering + casing", async () => {
    const { normalizeQuery } = await import("../../server/services/data-cache/lookup-cache");
    const a = normalizeQuery({ name: "JOHN Smith", address: " 123 Main St " });
    const b = normalizeQuery({ address: "123 main st", name: "john smith" });
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("second call with same fingerprint reads from cache (fetchFn not invoked)", async () => {
    const { getCachedOrFetch } = await import("../../server/services/data-cache/lookup-cache");
    const fetchFn = vi.fn(async () => ({ result: { phones: ["555-0100"] }, costCents: 20 }));

    const first = await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "abc",
      organizationId: 1,
      fetchFn,
    });
    expect(first.fromCache).toBe(false);
    expect(first.costCentsCharged).toBe(20);

    const second = await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "abc",
      organizationId: 2,
      fetchFn,
    });
    expect(second.fromCache).toBe(true);
    expect(second.costCentsCharged).toBe(0);
    expect(second.result).toEqual({ phones: ["555-0100"] });
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it("inserts a hit row tagged with the calling orgId on every cache hit", async () => {
    const { getCachedOrFetch } = await import("../../server/services/data-cache/lookup-cache");
    const fetchFn = async () => ({ result: { ok: true }, costCents: 50 });

    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "hits-fp",
      organizationId: 1,
      fetchFn,
    });
    // Two cache reads from different orgs.
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "hits-fp",
      organizationId: 7,
      fetchFn,
    });
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "hits-fp",
      organizationId: 9,
      fetchFn,
    });

    expect(state.cachedLookupHits).toHaveLength(2);
    expect(state.cachedLookupHits.map((h) => h.organizationId).sort()).toEqual([7, 9]);
    // hit counter on the lookup row is bumped twice
    const [row] = state.cachedLookups;
    expect(row.hits).toBe(2);
  });

  it("stale cache refetches after freshnessHours expiry", async () => {
    const { getCachedOrFetch } = await import("../../server/services/data-cache/lookup-cache");
    const fetchFn = vi
      .fn()
      .mockResolvedValueOnce({ result: { v: 1 }, costCents: 20 })
      .mockResolvedValueOnce({ result: { v: 2 }, costCents: 30 });

    // First call: miss → store with freshness 1h, firstFetchedAt = NOW - 2h
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "stale-fp",
      freshnessHours: 1,
      organizationId: 1,
      fetchFn,
    });
    // Backdate the row so it is now stale.
    state.cachedLookups[0].firstFetchedAt = new Date(Date.now() - 2 * 60 * 60 * 1000);

    // Second call: row exists but is older than freshnessHours → refetch.
    const refetched = await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "stale-fp",
      freshnessHours: 1,
      organizationId: 2,
      fetchFn,
    });
    expect(refetched.fromCache).toBe(false);
    expect(refetched.result).toEqual({ v: 2 });
    expect(refetched.costCentsCharged).toBe(30);
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("getCacheHitSavingsForOrg sums correctly across orgs", async () => {
    const { getCachedOrFetch, getCacheHitSavingsForOrg } = await import(
      "../../server/services/data-cache/lookup-cache"
    );

    // Two different cached lookups paid by org 1.
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "fp-A",
      organizationId: 1,
      fetchFn: async () => ({ result: {}, costCents: 25 }),
    });
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "fp-B",
      organizationId: 1,
      fetchFn: async () => ({ result: {}, costCents: 40 }),
    });
    // Org 2 hits both — should save 25 + 40 = 65.
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "fp-A",
      organizationId: 2,
      fetchFn: async () => ({ result: {}, costCents: 25 }),
    });
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "fp-B",
      organizationId: 2,
      fetchFn: async () => ({ result: {}, costCents: 40 }),
    });
    // Org 3 hits A only — saves 25.
    await getCachedOrFetch({
      provider: "batch_skiptrace",
      entityType: "skip_trace",
      queryFingerprint: "fp-A",
      organizationId: 3,
      fetchFn: async () => ({ result: {}, costCents: 25 }),
    });

    const org2 = await getCacheHitSavingsForOrg(2, 30);
    expect(org2.savingsCents).toBe(65);
    expect(org2.hitCount).toBe(2);

    const org3 = await getCacheHitSavingsForOrg(3, 30);
    expect(org3.savingsCents).toBe(25);
    expect(org3.hitCount).toBe(1);

    // Org 1 was the FIRST fetcher of both — its hits log is empty, savings = 0.
    const org1 = await getCacheHitSavingsForOrg(1, 30);
    expect(org1.savingsCents).toBe(0);
    expect(org1.hitCount).toBe(0);
  });
});
