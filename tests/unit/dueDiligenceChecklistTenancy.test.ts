/**
 * The per-property due-diligence checklist is one organization's row.
 *
 * `GET /api/due-diligence/:propertyId` called
 * `getOrCreateDueDiligenceChecklist(org.id, propertyId)`, whose read was keyed
 * by `propertyId` ALONE. So a caller naming another org's property id was
 * served that org's checklist; and where none existed yet, the helper CREATED
 * one (stamped with the caller's org) on the foreign property. The PUT had
 * been gated on property ownership; the GET and the shared helper had not.
 *
 * Two layers are proven here, both by behaviour:
 *   1. the route 404s for a property the caller's org does not own, and never
 *      reaches the get-or-create;
 *   2. the repository itself — evaluated against a fake `db` that applies the
 *      predicate drizzle actually built to rows of two organizations — neither
 *      returns another org's row nor creates one on another org's property,
 *      so a future caller that forgets the route gate still cannot leak.
 */

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { Column, Param, SQL, Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { PgDialect } from "drizzle-orm/pg-core";

const ORG_A = 42;
const ORG_B = 999;
const PROP_A = 501; // owned by org A
const PROP_B = 777; // owned by org B

// ── Fake db: evaluates the equalities drizzle built ─────────────────────────

type Row = Record<string, unknown>;
const tables = new Map<string, Row[]>();
let nextId = 1;

function keysOf(table: unknown): Map<string, string> {
  return new Map(
    Object.entries(getTableColumns(table as any)).map(([k, c]) => [(c as { name: string }).name, k]),
  );
}

const dialect = new PgDialect();
function equalities(predicate: unknown): Array<[string, unknown]> {
  const rendered = dialect.sqlToQuery((predicate as SQL).getSQL()).sql;
  // Only `=` and `and` are modelled; anything else would be mis-evaluated.
  expect(rendered, "fake db only models AND-ed equalities").not.toMatch(/\bor\b|<|>|!=|\bin\b/i);
  const tokens: Array<{ kind: "col" | "param"; v: unknown }> = [];
  const seen = new WeakSet<object>();
  const walk = (n: any): void => {
    if (n === null || typeof n !== "object" || seen.has(n)) return;
    seen.add(n);
    if (Array.isArray(n)) return n.forEach(walk);
    if (is(n, Column)) return void tokens.push({ kind: "col", v: n.name });
    if (is(n, Param)) return void tokens.push({ kind: "param", v: n.value });
    if (is(n, Table)) return;
    if (is(n, SQL)) return (n as any).queryChunks.forEach(walk);
    if (typeof n.getSQL === "function") return walk(n.getSQL());
  };
  walk(predicate);
  const out: Array<[string, unknown]> = [];
  for (let i = 0; i < tokens.length - 1; i++) {
    if (tokens[i].kind === "col" && tokens[i + 1].kind === "param") {
      out.push([String(tokens[i].v), tokens[i + 1].v]);
    }
  }
  return out;
}

const fakeDb = {
  select: () => ({
    from: (table: unknown) => ({
      where: async (predicate: unknown) => {
        const keys = keysOf(table);
        const eqs = equalities(predicate);
        const rows = tables.get(getTableName(table as any)) ?? [];
        return rows.filter((r) => eqs.every(([col, v]) => r[keys.get(col) ?? col] === v));
      },
    }),
  }),
  insert: (table: unknown) => ({
    values: (v: Row) => ({
      returning: async () => {
        const name = getTableName(table as any);
        const row = { id: nextId++, ...v };
        tables.set(name, [...(tables.get(name) ?? []), row]);
        return [row];
      },
    }),
  }),
};

vi.mock("../../server/db", () => ({
  get db() {
    return fakeDb;
  },
  withTransaction: async (fn: any) => fn(fakeDb),
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { acquisitionRepo } from "../../server/storage/acquisitionRepo";
import { dueDiligenceChecklists } from "@shared/schema";

const PROPERTY_OWNER: Record<number, number> = { [PROP_A]: ORG_A, [PROP_B]: ORG_B };

/** A `this` with the real repo methods and an org-scoped property getter. */
const repoThis: any = {
  ...acquisitionRepo,
  async getProperty(orgId: number, id: number) {
    return PROPERTY_OWNER[id] === orgId ? { id, organizationId: orgId } : undefined;
  },
};

const checklistRows = () => tables.get(getTableName(dueDiligenceChecklists)) ?? [];

describe("due-diligence checklist repository is org-scoped", () => {
  beforeEach(() => {
    tables.clear();
    nextId = 1;
  });

  it("get-or-create on another org's property returns nothing and creates nothing", async () => {
    const got = await repoThis.getOrCreateDueDiligenceChecklist(ORG_B, PROP_A);
    expect(got).toBeUndefined();
    expect(checklistRows()).toHaveLength(0);
  });

  it("B can never create a row that A is later served", async () => {
    await repoThis.getOrCreateDueDiligenceChecklist(ORG_B, PROP_A);
    const forA = await repoThis.getOrCreateDueDiligenceChecklist(ORG_A, PROP_A);
    expect(forA.organizationId).toBe(ORG_A);
    expect(checklistRows().every((r) => r.organizationId === ORG_A)).toBe(true);
  });

  it("an existing checklist of org A is not returned to org B", async () => {
    const created = await repoThis.getOrCreateDueDiligenceChecklist(ORG_A, PROP_A);
    expect(created.organizationId).toBe(ORG_A); // vacuity: the row exists
    expect(await repoThis.getDueDiligenceChecklist(ORG_A, PROP_A)).toBeDefined();
    expect(await repoThis.getDueDiligenceChecklist(ORG_B, PROP_A)).toBeUndefined();
    expect(await repoThis.getOrCreateDueDiligenceChecklist(ORG_B, PROP_A)).toBeUndefined();
  });

  it("a legacy foreign-org row on A's property is not served to A", async () => {
    // Rows created by the old helper carry the creator's org on the owner's
    // property. The owner must get its own checklist, not the stray one.
    tables.set(getTableName(dueDiligenceChecklists), [
      { id: 900, organizationId: ORG_B, propertyId: PROP_A, items: [], status: "in_progress" },
    ]);
    const forA = await repoThis.getOrCreateDueDiligenceChecklist(ORG_A, PROP_A);
    expect(forA.id).not.toBe(900);
    expect(forA.organizationId).toBe(ORG_A);
  });
});

// ── Route layer ─────────────────────────────────────────────────────────────

vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "user-b", claims: { sub: "user-b" } };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: ORG_B, name: "Org B" };
    req.organizationId = ORG_B;
    next();
  },
}));

const getProperty = vi.fn();
const getOrCreateDueDiligenceChecklist = vi.fn();
const getDueDiligenceChecklist = vi.fn();
vi.mock("../../server/storage", () => ({
  storage: {
    getProperty: (...a: unknown[]) => getProperty(...a),
    getOrCreateDueDiligenceChecklist: (...a: unknown[]) => getOrCreateDueDiligenceChecklist(...a),
    getDueDiligenceChecklist: (...a: unknown[]) => getDueDiligenceChecklist(...a),
  },
}));
vi.mock("../../server/services/leadScoring", () => ({ leadScoringService: {} }));
vi.mock("../../server/services/propertyEnrichment", () => ({ propertyEnrichmentService: {} }));
vi.mock("../../server/services/usageLimits", () => ({ checkUsageLimit: vi.fn() }));
vi.mock("../../server/services/usury", () => ({ checkUsury: vi.fn() }));
vi.mock("../../server/services/dealHandoffService", () => ({
  getAllHandoffs: vi.fn(),
  getHandoffsForDeal: vi.fn(),
  initiateHandoff: vi.fn(),
  updateHandoffChecklist: vi.fn(),
  completeHandoff: vi.fn(),
}));

import { registerDealRoutes } from "../../server/routes-deals";

describe("GET /api/due-diligence/:propertyId", () => {
  let app: express.Application;
  beforeAll(() => {
    app = express();
    app.use(express.json());
    registerDealRoutes(app as any);
  });
  beforeEach(() => {
    getProperty.mockReset();
    getOrCreateDueDiligenceChecklist.mockReset();
    getDueDiligenceChecklist.mockReset();
    getProperty.mockImplementation(async (orgId: number, id: number) =>
      PROPERTY_OWNER[id] === orgId ? { id, organizationId: orgId } : undefined,
    );
    getOrCreateDueDiligenceChecklist.mockImplementation(async (orgId: number, propertyId: number) => ({
      id: 1,
      organizationId: orgId === ORG_B ? ORG_A : orgId, // what an unscoped helper would serve
      propertyId,
      items: [{ id: "x", name: "Org A private note" }],
    }));
  });

  it("404s for another org's property and never reaches get-or-create", async () => {
    const res = await request(app).get(`/api/due-diligence/${PROP_A}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain("Org A private note");
    expect(getOrCreateDueDiligenceChecklist).not.toHaveBeenCalled();
  });

  it("200s for the caller's own property", async () => {
    const res = await request(app).get(`/api/due-diligence/${PROP_B}`);
    expect(res.status).toBe(200);
    expect(getOrCreateDueDiligenceChecklist).toHaveBeenCalledWith(ORG_B, PROP_B);
  });

  it("the PUT reads the existing checklist by the caller's org", async () => {
    getDueDiligenceChecklist.mockResolvedValue(undefined);
    await request(app).put(`/api/due-diligence/${PROP_B}`).send({ notes: "x" });
    expect(getDueDiligenceChecklist).toHaveBeenCalledWith(ORG_B, PROP_B);
  });
});
