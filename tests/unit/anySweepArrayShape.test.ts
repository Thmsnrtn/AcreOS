/**
 * ANY-sweep (2026-11-21) — the SD-DEF-1 siblings.
 *
 * SD-DEF-1 (PR #652) cured `GET /api/parcels/:id/permits`, whose gates query
 * was `sql`${col} = ANY(${ids}::uuid[])``. Drizzle expands a JS array inside
 * sql`` into a parenthesised parameter list, so Postgres never sees an
 * array. The build record flagged five more sites with the raw shape; this
 * sweep diagnosed each by (a) rendering its exact query through PgDialect
 * and (b) executing the rendered forms against a real Postgres (PGlite):
 *
 *   rentals GET /api/tenants/:id   `= ANY(($1)::uuid[])`     → malformed array literal
 *                                  `= ANY(($1, $2)::uuid[])` → cannot cast type record to uuid[]
 *   rentals GET /api/leases/:id    (identical shape, identical errors)
 *   solene  GET /api/founder/solene-audit/recent
 *                                  `= ANY(($1))`   → malformed array literal: "7"
 *                                  `= ANY(($1, $2))` → op ANY/ALL (array) requires array on right side
 *   agentComms getUnreadFor        `= ANY(($1))`   → malformed array literal: "incidents"
 *                                  `= ANY(($1, …))` → op ANY/ALL (array) requires array on right side
 *
 * All four are cured with the codebase's inArray idiom (the permits cure).
 * The fifth flagged site, storage/customizationRepo.ts
 * deleteCustomFieldValuesForEntity, is NOT cured: its shape is defective in
 * isolation but unreachable — it has no caller in the repo, and it loads
 * definitions under a hardcoded organizationId of 0 while organizations.id
 * is a serial (≥1), so definitionIds is always [] and its length>0 guard
 * always skips the delete. See hidden_files/build-any-sweep-2026-11.md.
 *
 * The mock db below emulates exactly the measured Postgres rejections: it
 * renders every captured where clause through PgDialect and rejects the
 * `= ANY((…` parenthesised-list shape the way Postgres does. On the pre-fix
 * tree every non-empty read below fails (route → 500 / service → throw);
 * on the cured tree (inArray) they return their rows.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

const ORG_ID = 127;
const TENANT_ID = "11111111-2222-4333-8444-555555555555";
const TENANT_ID_2 = "22222222-3333-4444-8555-666666666666";
const LEASE_ID = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const LEASE_ID_2 = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";

const h = vi.hoisted(() => ({
  tenant: null as any,
  lease: null as any,
  links: [] as any[],
  linkedLeases: [] as any[],
  linkedTenants: [] as any[],
  runs: [] as any[],
  countRows: [] as any[],
  messages: [] as any[],
  wheres: [] as Array<{ sqlText: string; params: unknown[] }>,
}));

/** The measured Postgres error for a rendered `= ANY((…` shape. */
function postgresRejection(sqlText: string): Error | null {
  const m = sqlText.match(/= ANY\(\(([^)]*)\)([^)]*\)?)/);
  if (!m) return null;
  const inner = m[1];
  const isList = inner.includes(",");
  if (sqlText.includes("::uuid[]")) {
    return isList
      ? new Error("cannot cast type record to uuid[]")
      : new Error("malformed array literal");
  }
  return isList
    ? new Error("op ANY/ALL (array) requires array on right side")
    : new Error("malformed array literal");
}

vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  const rowsFor = (table: unknown, sqlText: string | null): any[] => {
    const g = globalThis as any;
    if (table === g.__tenantsTable) {
      return sqlText && sqlText.includes('"tenants"."id" in') ? h.linkedTenants : h.tenant ? [h.tenant] : [];
    }
    if (table === g.__rentalLeasesTable) {
      return sqlText && sqlText.includes('"rental_leases"."id" in') ? h.linkedLeases : h.lease ? [h.lease] : [];
    }
    if (table === g.__leaseTenantsTable) return h.links;
    if (table === g.__leaseAddendumsTable) return [];
    if (table === g.__soleneRunsTable) return h.runs;
    if (table === g.__soleneFindingsTable) return h.countRows;
    if (table === g.__agentMessagesTable) return h.messages;
    return [];
  };
  const makeChain = (table: unknown, whereArg: unknown) => {
    let rendered: { sql: string; params: unknown[] } | null = null;
    if (whereArg !== undefined) {
      try {
        rendered = dialect.sqlToQuery(whereArg as SQL);
      } catch {
        rendered = null;
      }
      if (rendered) h.wheres.push({ sqlText: rendered.sql, params: rendered.params });
    }
    const run = (): Promise<any[]> => {
      if (rendered) {
        const rejection = postgresRejection(rendered.sql);
        if (rejection) return Promise.reject(rejection);
      }
      return Promise.resolve(rowsFor(table, rendered?.sql ?? null));
    };
    const chain: any = {
      where: (w: unknown) => makeChain(table, w),
      orderBy: (..._args: unknown[]) => chain,
      limit: (..._args: unknown[]) => chain,
      groupBy: (..._args: unknown[]) => chain,
      then: (resolve: any, reject: any) => run().then(resolve, reject),
      catch: (reject: any) => run().catch(reject),
    };
    return chain;
  };
  return {
    db: {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => makeChain(table, undefined),
      }),
    },
  };
});

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "founder@test.com" };
    next();
  },
  requireFounder: (_req: any, _res: any, next: any) => next(),
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_ID, name: "ANY-SWEEP Org" };
    req.organizationId = ORG_ID;
    next();
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/solene/capitalTracker", () => ({
  getMonthlyEnvelopeStatus: vi.fn(async () => ({})),
  getSpendSummary: vi.fn(async () => ({})),
}));

import { registerRentalRoutes } from "../../server/routes-rentals";
import { registerSoleneAuditRoutes } from "../../server/routes-solene-audit";
import { agentCommsService } from "../../server/services/agentComms";
import {
  tenants,
  rentalLeases,
  leaseTenants,
  leaseAddendums,
} from "@shared/schema";
import { soleneAuditRuns, soleneAuditFindings } from "@shared/schema/solene-audit";
import { agentChannelMessages } from "@shared/schema";

(globalThis as any).__tenantsTable = tenants;
(globalThis as any).__rentalLeasesTable = rentalLeases;
(globalThis as any).__leaseTenantsTable = leaseTenants;
(globalThis as any).__leaseAddendumsTable = leaseAddendums;
(globalThis as any).__soleneRunsTable = soleneAuditRuns;
(globalThis as any).__soleneFindingsTable = soleneAuditFindings;
(globalThis as any).__agentMessagesTable = agentChannelMessages;

const app = express();
app.use(express.json());
registerRentalRoutes(app);
registerSoleneAuditRoutes(app);

function tenantRow(id: string) {
  return { id, organizationId: ORG_ID, firstName: "Ada", lastName: "Lovelace", status: "active" };
}
function leaseRow(id: string) {
  return { id, organizationId: ORG_ID, propertyId: 9, status: "active", monthlyRentCents: 120000 };
}
function linkRow(leaseId: string, tenantId: string) {
  return {
    id: `link-${leaseId}-${tenantId}`,
    organizationId: ORG_ID,
    leaseId,
    tenantId,
    rentSharePct: "1",
    isPrimary: true,
  };
}

beforeEach(() => {
  h.tenant = tenantRow(TENANT_ID);
  h.lease = leaseRow(LEASE_ID);
  h.links = [];
  h.linkedLeases = [];
  h.linkedTenants = [];
  h.runs = [];
  h.countRows = [];
  h.messages = [];
  h.wheres = [];
});

describe("ANY-sweep — rentals tenant/lease detail reads", () => {
  it("GET /api/tenants/:id with ONE linked lease returns it (200) — the scalar-cast length that 500'd", async () => {
    h.links = [linkRow(LEASE_ID, TENANT_ID)];
    h.linkedLeases = [leaseRow(LEASE_ID)];
    const res = await request(app).get(`/api/tenants/${TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.tenant.id).toBe(TENANT_ID);
    expect(res.body.leases).toHaveLength(1);
    expect(res.body.leases[0].id).toBe(LEASE_ID);
  });

  it("GET /api/tenants/:id with TWO linked leases returns both (200) — the record-cast length that 500'd", async () => {
    h.links = [linkRow(LEASE_ID, TENANT_ID), linkRow(LEASE_ID_2, TENANT_ID)];
    h.linkedLeases = [leaseRow(LEASE_ID), leaseRow(LEASE_ID_2)];
    const res = await request(app).get(`/api/tenants/${TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.leases.map((l: any) => l.id).sort()).toEqual([LEASE_ID, LEASE_ID_2].sort());
  });

  it("GET /api/tenants/:id with no linked leases returns [] and never issues the array query (guard preserved)", async () => {
    h.links = [];
    const res = await request(app).get(`/api/tenants/${TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.leases).toEqual([]);
    expect(h.wheres.some((w) => w.sqlText.includes('"rental_leases"."id"'))).toBe(false);
  });

  it("GET /api/leases/:id with ONE linked tenant returns it (200)", async () => {
    h.links = [linkRow(LEASE_ID, TENANT_ID)];
    h.linkedTenants = [tenantRow(TENANT_ID)];
    const res = await request(app).get(`/api/leases/${LEASE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.tenants).toHaveLength(1);
    expect(res.body.tenants[0].tenant.id).toBe(TENANT_ID);
  });

  it("GET /api/leases/:id with TWO linked tenants returns both (200)", async () => {
    h.links = [linkRow(LEASE_ID, TENANT_ID), linkRow(LEASE_ID, TENANT_ID_2)];
    h.linkedTenants = [tenantRow(TENANT_ID), tenantRow(TENANT_ID_2)];
    const res = await request(app).get(`/api/leases/${LEASE_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.tenants.map((t: any) => t.tenant.id).sort()).toEqual([TENANT_ID, TENANT_ID_2].sort());
  });

  it("rendered-SQL pin: the rentals array queries use `in ($n, …)`, never `= ANY((`", async () => {
    h.links = [linkRow(LEASE_ID, TENANT_ID), linkRow(LEASE_ID_2, TENANT_ID)];
    h.linkedLeases = [leaseRow(LEASE_ID), leaseRow(LEASE_ID_2)];
    await request(app).get(`/api/tenants/${TENANT_ID}`);
    const arrayWheres = h.wheres.filter((w) => w.sqlText.includes('"rental_leases"."id" in'));
    expect(arrayWheres).toHaveLength(1);
    expect(arrayWheres[0].sqlText).toContain('"rental_leases"."id" in ($');
    expect(arrayWheres[0].params).toEqual(expect.arrayContaining([LEASE_ID, LEASE_ID_2]));
    expect(h.wheres.some((w) => /= ANY\(\(/.test(w.sqlText))).toBe(false);
  });
});

describe("ANY-sweep — solene audit recent (identical twin of the /founder/build failure)", () => {
  const runRow = (id: number) => ({
    id,
    runStartedAt: new Date("2026-11-20T00:00:00.000Z"),
    runEndedAt: new Date("2026-11-20T00:05:00.000Z"),
    scope: "per-week",
    decisionsExamined: 10,
    driftCount: 1,
    findingCount: 3,
    driftSignalEmitted: false,
    skipReason: null,
  });

  it("ONE run returns finding counts (200) — the malformed-array-literal length that 500'd", async () => {
    h.runs = [runRow(7)];
    h.countRows = [
      { runId: 7, severity: "fail", count: 2 },
      { runId: 7, severity: "info", count: 1 },
    ];
    const res = await request(app).get("/api/founder/solene-audit/recent");
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ totalRuns: 1, driftSignalCount: 0, totalFindings: 3 });
    expect(res.body.runs[0].findingCounts).toEqual({ info: 1, warn: 0, fail: 2, critical: 0, total: 3 });
  });

  it("TWO runs return per-run counts (200) — the ANY/ALL-requires-array length that 500'd", async () => {
    h.runs = [runRow(7), runRow(8)];
    h.countRows = [
      { runId: 7, severity: "fail", count: 2 },
      { runId: 8, severity: "warn", count: 3 },
    ];
    const res = await request(app).get("/api/founder/solene-audit/recent");
    expect(res.status).toBe(200);
    expect(res.body.summary.totalRuns).toBe(2);
    expect(res.body.summary.totalFindings).toBe(5);
    const findingsWhere = h.wheres.find((w) => w.sqlText.includes('"solene_audit_findings"."run_id"'));
    expect(findingsWhere?.sqlText).toContain('"solene_audit_findings"."run_id" in ($');
    expect(findingsWhere?.params).toEqual(expect.arrayContaining([7, 8]));
    expect(h.wheres.some((w) => /= ANY\(\(/.test(w.sqlText))).toBe(false);
  });

  it("zero runs still returns the empty summary (early return preserved)", async () => {
    h.runs = [];
    const res = await request(app).get("/api/founder/solene-audit/recent");
    expect(res.status).toBe(200);
    expect(res.body.summary).toEqual({ totalRuns: 0, driftSignalCount: 0, totalFindings: 0 });
  });
});

describe("ANY-sweep — agentComms getUnreadFor", () => {
  it("returns unread messages for a 4-channel agent (atlas_cto) — the length that threw", async () => {
    h.messages = [
      { id: 1, toChannel: "incidents", readByAgents: [] },
      { id: 2, toChannel: "releases", readByAgents: [] },
    ];
    const messages = await agentCommsService.getUnreadFor("atlas_cto");
    expect(messages).toHaveLength(2);
    const w = h.wheres.find((x) => x.sqlText.includes('"agent_channel_messages"."to_channel"'));
    expect(w?.sqlText).toContain('"agent_channel_messages"."to_channel" in ($');
    expect(w?.params).toEqual(
      expect.arrayContaining(["releases", "incidents", "metrics_alerts", "compliance_flags", "atlas_cto"]),
    );
    expect(h.wheres.some((x) => /= ANY\(\(/.test(x.sqlText))).toBe(false);
  });

  it("returns unread messages for a 2-channel agent (shield_legal) — the minimum subscribed length", async () => {
    h.messages = [{ id: 3, toChannel: "incidents", readByAgents: [] }];
    const messages = await agentCommsService.getUnreadFor("shield_legal");
    expect(messages).toHaveLength(1);
    const w = h.wheres.find((x) => x.sqlText.includes('"agent_channel_messages"."to_channel"'));
    expect(w?.params).toEqual(expect.arrayContaining(["incidents", "compliance_flags"]));
  });

  it("unknown agent (0 subscribed channels) still returns [] without a query", async () => {
    const messages = await agentCommsService.getUnreadFor("nobody");
    expect(messages).toEqual([]);
    expect(h.wheres).toHaveLength(0);
  });
});
