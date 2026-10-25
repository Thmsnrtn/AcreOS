/**
 * D2g — GET /api/ops/data, mounted on the REAL registrar (registerOpsRoutes)
 * and served by the REAL loadDataOpsMetrics over a recording fake of the db.
 *
 * Proves:
 *   - token discipline: 503 unset, 401 missing / wrong / PREFIX of the right
 *     token / right token plus a suffix, 403 for a write, 200 only for the
 *     exact token;
 *   - only aggregates leave: every query's projected columns are an exact
 *     allow-list per table (a tenant column added to a select fails), every
 *     tenant-bearing table is read GROUPED, and the payload carries no tenant
 *     key;
 *   - release inventory is served from the D2b release store (0290): a store
 *     with no releases reads "reported, 0" — distinct from not_built, which
 *     only an unwired read can return.
 */
import express from "express";
import request from "supertest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface QueryRecord {
  table: string;
  joined: string[];
  projectionKeys: string[];
  columns: Set<string>;
  grouped: boolean;
}

const fake = vi.hoisted(() => {
  const queries: QueryRecord[] = [];
  const rowsByTable: Record<string, Record<string, unknown>[]> = {};
  return { queries, rowsByTable };
});

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/db", async () => {
  const d = await import("drizzle-orm");
  const collect = (v: unknown, into: Set<string>): void => {
    if (d.is(v, d.Column)) into.add(v.name);
    else if (d.is(v, d.SQL)) for (const c of v.queryChunks) collect(c, into);
  };
  interface Chain extends PromiseLike<Record<string, unknown>[]> {
    from(t: unknown): Chain;
    innerJoin(t: unknown, on: unknown): Chain;
    where(w: unknown): Chain;
    groupBy(...a: unknown[]): Chain;
    orderBy(...a: unknown[]): Chain;
    limit(n: number): Chain;
  }
  const select = (projection: Record<string, unknown>): Chain => {
    const rec: QueryRecord = { table: "", joined: [], projectionKeys: Object.keys(projection), columns: new Set(), grouped: false };
    for (const v of Object.values(projection)) collect(v, rec.columns);
    fake.queries.push(rec);
    const tableName = (t: unknown) => (d.is(t, d.Table) ? d.getTableName(t) : "?");
    const chain: Chain = {
      from(t) {
        rec.table = tableName(t);
        return chain;
      },
      innerJoin(t) {
        rec.joined.push(tableName(t));
        return chain;
      },
      where: () => chain,
      groupBy(...a) {
        rec.grouped = a.length > 0;
        return chain;
      },
      orderBy: () => chain,
      limit: () => chain,
      then(onF, onR) {
        // Rows carry exactly the projected keys — what a real select returns.
        const rows = (fake.rowsByTable[rec.table] ?? []).map((r) => Object.fromEntries(rec.projectionKeys.map((k) => [k, r[k]])));
        return Promise.resolve(rows).then(onF, onR);
      },
    };
    return chain;
  };
  return { db: { select } };
});

import { registerOpsRoutes } from "../../server/routes-ops";
import { loadDataOpsMetrics } from "../../server/services/ops/dataOpsMetrics";

const TOKEN = "t".repeat(40);
const app = () => {
  const a = express();
  registerOpsRoutes(a);
  return a;
};

beforeEach(() => {
  fake.queries.length = 0;
  fake.rowsByTable.county_discovery_queue = [
    { state: "FL", status: "complete", counties: 2, parcelsStored: 9000 },
    { state: "FL", status: null, counties: 5, parcelsStored: 0 },
  ];
  fake.rowsByTable.provider_lookup_log = [
    { answeringLayer: "open_data", success: true, cached: false, probe: false, n: 990 },
    { answeringLayer: "vendor", success: true, cached: false, probe: false, n: 10 },
  ];
  fake.rowsByTable.etl_runs = [{ jobName: "fl_statewide_cadastral_v1", status: "success", observation: { outcome: { status: "dry_run_only" }, summary: { county: "SYNTHETIC", normalized: 1, peakRssMb: 1 } } }];
  fake.rowsByTable.purpose_ledger = [{ surface: "skip_trace", purposeCode: "SYNTHETIC-PURPOSE", n: 3 }];
  fake.rowsByTable.dataset_releases = [];
  fake.rowsByTable.dataset_release_pointer = [];
});
afterEach(() => {
  delete process.env.OPS_SERVICE_TOKEN;
});

describe("GET /api/ops/data — token discipline on the real registrar", () => {
  it("503 when OPS_SERVICE_TOKEN is unset, even with a bearer header", async () => {
    delete process.env.OPS_SERVICE_TOKEN;
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(503);
    expect(fake.queries).toHaveLength(0);
  });

  it("401 for a missing header, a wrong token, a PREFIX of the right token, and the right token plus a suffix", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    expect((await request(app()).get("/api/ops/data")).status).toBe(401);
    expect((await request(app()).get("/api/ops/data").set("Authorization", "Bearer wrong")).status).toBe(401);
    expect((await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN.slice(0, -1)}`)).status).toBe(401);
    expect((await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN.slice(0, 8)}`)).status).toBe(401);
    expect((await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}x`)).status).toBe(401);
    expect((await request(app()).get("/api/ops/data").set("Authorization", TOKEN)).status).toBe(401);
    expect(fake.queries).toHaveLength(0);
  });

  it("a write with the right token never reaches a handler", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const r = await request(app()).post("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect([403, 404]).toContain(r.status);
    expect(fake.queries).toHaveLength(0);
  });

  it("200 with the exact token; days is clamped to 1..365", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const ok = await request(app()).get("/api/ops/data?days=9999").set("Authorization", `Bearer ${TOKEN}`);
    expect(ok.status).toBe(200);
    expect(ok.body.fallThrough.windowDays).toBe(365);
    expect(ok.body.fallThrough.paidPer1k).toBe(10);
    const low = await request(app()).get("/api/ops/data?days=-4").set("Authorization", `Bearer ${TOKEN}`);
    expect(low.body.fallThrough.windowDays).toBe(1);
  });
});

describe("GET /api/ops/data — only aggregates leave", () => {
  /** Exact projected columns per table. Adding a column to a select is a deliberate edit here. */
  const ALLOWED: Record<string, string[]> = {
    county_discovery_queue: ["owned_parcels_stored", "owned_status", "state"],
    provider_lookup_log: ["answering_layer", "cached", "provider_name", "success"],
    etl_runs: ["job_name", "observation", "status"],
    purpose_ledger: ["purpose_code", "surface"],
    // D2b release store — global platform tables (no tenant column).
    dataset_releases: ["county_count", "created_at", "parcel_count", "release_id"],
    dataset_release_pointer: ["action", "actor", "at", "previous_release_id", "reason", "release_id", "release_name", "seq"],
  };
  const TENANT_TABLES = ["county_discovery_queue", "provider_lookup_log", "purpose_ledger"];

  it("every query reads an allow-listed projection, and tenant-bearing tables are read grouped", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.status).toBe(200);
    // Population floor: the six reads the load makes, each seen once.
    expect(fake.queries.map((q) => q.table).sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const q of fake.queries) {
      expect([...q.columns].sort(), `${q.table} projection`).toEqual(ALLOWED[q.table]);
      if (TENANT_TABLES.includes(q.table)) expect(q.grouped, `${q.table} must be aggregated`).toBe(true);
    }
  });

  it("the payload carries no tenant key and no per-county or per-actor row", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    const keys = new Set<string>();
    const walk = (v: unknown): void => {
      if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") for (const [k, x] of Object.entries(v)) {
          keys.add(k);
          walk(x);
        }
    };
    walk(r.body);
    expect(keys.size).toBeGreaterThan(20);
    for (const k of ["organizationId", "orgId", "firstRequestedBy", "actorUserId", "userId", "leadId", "skipTraceId", "apid", "justification", "providerName"]) {
      expect(keys.has(k), k).toBe(false);
    }
  });

  it("release inventory is read from the release store: an empty store reports zero releases, not not_built", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.body.releaseInventory).toMatchObject({ status: "reported", releaseCount: 0, current: null });
  });

  it("a stored, promoted release appears with its minted name and as current", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const id = `sha256:${"a".repeat(64)}`;
    fake.rowsByTable.dataset_releases = [{ releaseId: id, createdAt: new Date("2026-10-24T00:00:00Z"), countyCount: 2, parcelCount: 40 }];
    fake.rowsByTable.dataset_release_pointer = [
      { seq: 1, action: "promote", releaseId: id, releaseName: "acreos-parcels v2026.10.1", previousReleaseId: null, at: new Date("2026-10-24T01:00:00Z"), actor: "founder", reason: "first" },
    ];
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.body.releaseInventory).toMatchObject({ status: "reported", releaseCount: 1, current: { releaseId: id, name: "acreos-parcels v2026.10.1" }, malformedNames: [] });
  });

  it("coverage.byState is served from the same grouped rows", async () => {
    process.env.OPS_SERVICE_TOKEN = TOKEN;
    const r = await request(app()).get("/api/ops/data").set("Authorization", `Bearer ${TOKEN}`);
    expect(r.body.coverage.byState).toEqual([
      expect.objectContaining({ state: "FL", countiesOwned: 2, countiesKnown: 7, neverRequested: 5, parcelsStored: 9000 }),
    ]);
  });
});

describe("loadDataOpsMetrics — a wired release reader replaces not_built", () => {
  it("folds the reader's rows", async () => {
    const m = await loadDataOpsMetrics(new Date("2026-10-24T00:00:00Z"), 30, async () => [
      { releaseId: "SYNTHETIC-1", name: "acreos-parcels v2026.10.1", createdAt: "2026-10-01T00:00:00Z", current: true, countyCount: 3, parcelCount: 10 },
    ]);
    expect(m.releaseInventory).toMatchObject({ status: "reported", releaseCount: 1, current: { name: "acreos-parcels v2026.10.1" } });
  });
});
