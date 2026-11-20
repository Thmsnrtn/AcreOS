/**
 * SD-DEF-1 — GET /api/parcels/:id/permits 500'd on every non-empty read.
 *
 * Found by the Subdivider journey walk (2026-11-20, org 127, parcel 1049):
 * POST /api/parcels/:id/permits created a checklist (201, 14 gates) and a
 * gate PATCH approved (200), but GET /api/parcels/:id/permits returned
 * 500 INTERNAL_ERROR on every attempt — the permits surface was write-only
 * in practice. The empty case returned early and worked, which is how the
 * defect survived: every empty org reads fine.
 *
 * Mechanism (proven by rendering the pre-fix query through PgDialect):
 * the gates query was
 *   sql`${permitGates.checklistId} = ANY(${ids}::uuid[])`
 * Drizzle expands a JS array inside sql`` into a parenthesised parameter
 * list, so Postgres received
 *   "checklist_id" = ANY(($2, $3)::uuid[])   (two checklists)
 *   "checklist_id" = ANY(($2)::uuid[])      (one checklist — the walk case)
 * i.e. a cast of a record / a scalar uuid to uuid[], which Postgres
 * rejects ("cannot cast type record to uuid[]"). The same shape is
 * documented in-repo twice: routes-team-system-audit.ts ("drizzle binds
 * a JS array param in a shape Postgres rejects, which 500'd
 * /founder/build whenever at least one audit run existed") and
 * services/creditPool.ts ("cannot cast type record to text[]").
 *
 * The mock db below emulates exactly that Postgres rejection: it renders
 * every captured where clause through PgDialect and refuses the
 * `= ANY((...` record-cast shape, the way Postgres does. On the pre-fix
 * tree the create-then-list pair therefore fails with 500 (the walk's
 * symptom); on the cured tree (drizzle inArray) it returns the checklist
 * with its gates grouped, counted, and org-scoped.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { PgDialect } from "drizzle-orm/pg-core";
import type { SQL } from "drizzle-orm";

// ── Mock state ────────────────────────────────────────────────────────────

const CHECKLIST_ID = "743fbc6a-26e2-42f4-8996-263afd2c7823";
const CHECKLIST_ID_2 = "8a1f2c3d-4444-4555-8666-777777777777";
const ORG_ID = 127;
const PARENT_ID = 1049;

const h = vi.hoisted(() => ({
  checklists: [] as any[],
  gates: [] as any[],
  wheres: [] as Array<{ table: unknown; sqlText: string; params: unknown[] }>,
}));

vi.mock("../../server/db", () => {
  const dialect = new PgDialect();
  // A thenable query chain: `.where(w)` is awaitable directly (POST's
  // parent lookup) and also carries `.orderBy(...)` (the GET reads).
  const makeChain = (rows: () => any[], whereArg: unknown, table: unknown) => {
    let rendered: { sql: string; params: unknown[] } | null = null;
    try {
      rendered = dialect.sqlToQuery(whereArg as SQL);
    } catch {
      rendered = null;
    }
    if (rendered) h.wheres.push({ table, sqlText: rendered.sql, params: rendered.params });
    const run = (): Promise<any[]> => {
      // Emulate Postgres: `= ANY(($n, ...)::uuid[])` casts a record (or a
      // lone scalar) to uuid[] — Postgres rejects it, the route catches,
      // and the client sees 500 INTERNAL_ERROR. This is the SD-DEF-1
      // failure, reproduced at the exact boundary where it occurred.
      if (rendered && /= ANY\(\(/.test(rendered.sql)) {
        return Promise.reject(
          new Error("cannot cast type record to uuid[]"),
        );
      }
      return Promise.resolve(rows());
    };
    const chain: any = {
      orderBy: (..._args: unknown[]) => run(),
      then: (resolve: any, reject: any) => run().then(resolve, reject),
      catch: (reject: any) => run().catch(reject),
    };
    return chain;
  };
  return {
    db: {
      select: (_fields?: unknown) => ({
        from: (table: unknown) => ({
          where: (whereArg: unknown) => {
            // Route table identity is resolved lazily in the test body via
            // the captured table reference; rows are chosen by matching
            // the known table objects stashed on the chain call.
            const rows = () => {
              const t: any = table as any;
              if (t === (globalThis as any).__permitChecklistsTable) return h.checklists;
              if (t === (globalThis as any).__permitGatesTable) return h.gates;
              if (t === (globalThis as any).__propertiesTable) {
                return [{ id: PARENT_ID, organizationId: ORG_ID, county: "Bastrop", state: "TX" }];
              }
              return [];
            };
            return makeChain(rows, whereArg, table);
          },
        }),
      }),
      insert: (table: unknown) => ({
        values: (values: any) => ({
          returning: () => {
            if (table === (globalThis as any).__permitChecklistsTable) {
              const row = {
                id: CHECKLIST_ID,
                organizationId: ORG_ID,
                parentParcelId: PARENT_ID,
                countyState: values.countyState,
                countyName: values.countyName,
                templateKey: values.templateKey,
                title: values.title,
                notes: null,
                completedAt: null,
                createdAt: new Date("2026-11-20T22:58:00.000Z"),
                updatedAt: new Date("2026-11-20T22:58:00.000Z"),
              };
              h.checklists = [row];
              return Promise.resolve([row]);
            }
            if (table === (globalThis as any).__permitGatesTable) {
              const rows = (values as any[]).map((v, i) => ({
                id: `gate-${i + 1}`,
                organizationId: ORG_ID,
                checklistId: v.checklistId,
                sequence: v.sequence,
                gateKey: v.gateKey,
                label: v.label,
                status: v.status,
                submittedAt: null,
                expectedReturnAt: null,
                completedAt: null,
                feeCents: v.feeCents ?? null,
                contactName: null,
                contactEmail: null,
                contactPhone: null,
                referenceNumber: null,
                notes: null,
                documentVersionId: null,
                createdAt: new Date("2026-11-20T22:58:00.000Z"),
                updatedAt: new Date("2026-11-20T22:58:00.000Z"),
              }));
              h.gates = rows;
              return Promise.resolve(rows);
            }
            return Promise.resolve([]);
          },
        }),
      }),
    },
  };
});

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user_1", email: "brigid@example.com" };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_ID, name: "SUBDIV-20261120 Subdivider Co" };
    req.organizationId = ORG_ID;
    next();
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../server/services/subdivisionEvents", () => ({
  emitPermitGateApproved: vi.fn(),
}));

vi.mock("../../server/services/tax/landExit", () => ({
  refuseRedeemableDeedSpend: async () => true,
}));

import { registerPermitTrackerRoutes } from "../../server/routes-permit-tracker";
import { permitChecklists, permitGates, properties } from "@shared/schema";

// Stash the real table objects for the mock's table dispatch (the mock
// factory above is hoisted and cannot close over these imports).
(globalThis as any).__permitChecklistsTable = permitChecklists;
(globalThis as any).__permitGatesTable = permitGates;
(globalThis as any).__propertiesTable = properties;

const app = express();
app.use(express.json());
registerPermitTrackerRoutes(app);

function gateRow(id: string, checklistId: string, sequence: number, status: string) {
  return {
    id,
    organizationId: ORG_ID,
    checklistId,
    sequence,
    gateKey: `gate_${sequence}`,
    label: `Gate ${sequence}`,
    status,
    submittedAt: null,
    expectedReturnAt: null,
    completedAt: null,
    feeCents: null,
    contactName: null,
    contactEmail: null,
    contactPhone: null,
    referenceNumber: null,
    notes: null,
    documentVersionId: null,
    createdAt: new Date("2026-11-20T22:58:00.000Z"),
    updatedAt: new Date("2026-11-20T22:58:00.000Z"),
  };
}

function checklistRow(id: string) {
  return {
    id,
    organizationId: ORG_ID,
    parentParcelId: PARENT_ID,
    countyState: "TX",
    countyName: "Bastrop",
    templateKey: "tn_williamson_residential_subdivision_v1",
    title: "Bastrop TX — checklist",
    notes: null,
    completedAt: null,
    createdAt: new Date("2026-11-20T22:58:00.000Z"),
    updatedAt: new Date("2026-11-20T22:58:00.000Z"),
  };
}

beforeEach(() => {
  h.checklists = [];
  h.gates = [];
  h.wheres = [];
});

// ── Tests ─────────────────────────────────────────────────────────────────

describe("SD-DEF-1 — GET /api/parcels/:id/permits (create-then-list)", () => {
  it("creates a checklist via POST (201, 14 gates) and re-reads it via GET (200) — the exact pair the walk proved broken", async () => {
    const created = await request(app)
      .post(`/api/parcels/${PARENT_ID}/permits`)
      .send({ templateKey: "tn_williamson_residential_subdivision_v1" });
    expect(created.status).toBe(201);
    expect(created.body.checklist.gates).toHaveLength(14);

    const res = await request(app).get(`/api/parcels/${PARENT_ID}/permits`);
    expect(res.status).toBe(200);
    expect(res.body.checklists).toHaveLength(1);
    expect(res.body.checklists[0].id).toBe(CHECKLIST_ID);
    expect(res.body.checklists[0].gates).toHaveLength(14);
    expect(res.body.checklists[0].completedCount).toBe(0);
    expect(res.body.checklists[0].stalledCount).toBe(0);
  });

  it("returns a checklist's gates grouped with completed counts (one approved gate, as in the walk)", async () => {
    h.checklists = [checklistRow(CHECKLIST_ID)];
    h.gates = [
      gateRow("gate-1", CHECKLIST_ID, 1, "approved"),
      gateRow("gate-2", CHECKLIST_ID, 2, "not_started"),
      gateRow("gate-3", CHECKLIST_ID, 3, "not_started"),
    ];
    const res = await request(app).get(`/api/parcels/${PARENT_ID}/permits`);
    expect(res.status).toBe(200);
    expect(res.body.checklists).toHaveLength(1);
    expect(res.body.checklists[0].gates).toHaveLength(3);
    expect(res.body.checklists[0].completedCount).toBe(1);
  });

  it("groups gates per checklist when a parcel has two checklists", async () => {
    h.checklists = [checklistRow(CHECKLIST_ID), checklistRow(CHECKLIST_ID_2)];
    h.gates = [
      gateRow("gate-1", CHECKLIST_ID, 1, "approved"),
      gateRow("gate-2", CHECKLIST_ID_2, 1, "not_started"),
      gateRow("gate-3", CHECKLIST_ID_2, 2, "skipped"),
    ];
    const res = await request(app).get(`/api/parcels/${PARENT_ID}/permits`);
    expect(res.status).toBe(200);
    expect(res.body.checklists).toHaveLength(2);
    const byId = new Map(res.body.checklists.map((c: any) => [c.id, c]));
    expect(byId.get(CHECKLIST_ID).gates).toHaveLength(1);
    expect(byId.get(CHECKLIST_ID).completedCount).toBe(1);
    expect(byId.get(CHECKLIST_ID_2).gates).toHaveLength(2);
    expect(byId.get(CHECKLIST_ID_2).completedCount).toBe(1); // skipped counts as completed
  });

  it("binds the gates read as an IN list over the checklist ids — never the ANY(record-cast) shape Postgres rejects", async () => {
    h.checklists = [checklistRow(CHECKLIST_ID), checklistRow(CHECKLIST_ID_2)];
    h.gates = [];
    const res = await request(app).get(`/api/parcels/${PARENT_ID}/permits`);
    expect(res.status).toBe(200);
    const gatesWhere = h.wheres.find((w) => w.table === permitGates);
    expect(gatesWhere, "the gates query must run when checklists exist").toBeDefined();
    expect(gatesWhere!.sqlText).not.toMatch(/= ANY\(\(/);
    expect(gatesWhere!.sqlText).toMatch(/"checklist_id" in \(\$\d+, \$\d+\)/);
    expect(gatesWhere!.params).toEqual(
      expect.arrayContaining([ORG_ID, CHECKLIST_ID, CHECKLIST_ID_2]),
    );
  });

  it("empty org still reads fine: no checklists → 200 { checklists: [] } (the early return that masked the defect)", async () => {
    const res = await request(app).get(`/api/parcels/${PARENT_ID}/permits`);
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ checklists: [] });
    // The gates query never runs in the empty case.
    expect(h.wheres.find((w) => w.table === permitGates)).toBeUndefined();
  });
});
