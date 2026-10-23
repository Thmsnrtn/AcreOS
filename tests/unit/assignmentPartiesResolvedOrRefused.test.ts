/**
 * Assignment parties are resolved or the document is refused — never raw
 * braces (regression from migration 0284).
 *
 * 0284 relabelled the seeded "Assignment Contract" parties to
 * {{assignor_name}} / {{assignee_name}}, but resolveContextVariables never set
 * either, and the package path resolved no context at all — so every
 * generated assignment printed "ASSIGNOR: {{assignor_name}}" on a contract.
 *
 * Drives the REAL seeder and the REAL routes over supertest. The DB mock
 * answers per table (getTableName), so the org's legal entity name and the
 * assignment's end buyer flow in through the real resolver.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import { getTableName } from "drizzle-orm";

const H = vi.hoisted(() => {
  const inserted: any[] = [];
  const rows: Record<string, any[]> = {};
  const chain = (table: any): any => {
    const c: any = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
    c.then = (f: any, r: any) => {
      let name = "";
      try { name = H_getTableName(table); } catch { /* not a table */ }
      return Promise.resolve(rows[name] ?? []).then(f, r);
    };
    return c;
  };
  let H_getTableName: (t: any) => string = () => "";
  const dbMock: any = {
    select: () => ({ from: (t: any) => chain(t) }),
    insert: () => ({
      values: (v: any) => {
        inserted.push(...(Array.isArray(v) ? v : [v]));
        const p: any = Promise.resolve([]);
        p.returning = async () => [];
        return p;
      },
    }),
    execute: async () => ({ rows: [] }),
  };
  const state = {
    templates: new Map<number, any>(),
    created: [] as any[],
    pkg: null as any,
    pkgUpdate: null as any,
  };
  const storageMock: any = {
    getDocumentTemplate: async (_org: number, id: number) => state.templates.get(Number(id)),
    createGeneratedDocument: async (doc: any) => {
      state.created.push(doc);
      return { id: state.created.length, ...doc };
    },
    getDocumentPackage: async () => state.pkg,
    updateDocumentPackage: async (_id: number, upd: any) => {
      state.pkgUpdate = upd;
      return { ...state.pkg, ...upd };
    },
    getDeal: async () => undefined,
    getProperty: async () => undefined,
  };
  return {
    inserted, rows, dbMock, storageMock, state,
    setTableName: (f: (t: any) => string) => { H_getTableName = f; },
  };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "7" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Tom's workspace", legalEntityName: H.rows.organizations?.[0]?.legalEntityName ?? null };
    next();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { documentsRepo } from "../../server/storage/documentsRepo";
import { registerDocSystemRoutes } from "../../server/routes-doc-system";

H.setTableName(getTableName);

const app = express();
app.use(express.json());
registerDocSystemRoutes(app);

let assignmentId = 0;

beforeEach(async () => {
  H.inserted.length = 0;
  await (documentsRepo.seedSystemTemplates as any).call({});
  const seeded = [...H.inserted];
  H.state.templates.clear();
  seeded.forEach((t, i) => H.state.templates.set(i + 1, { id: i + 1, organizationId: null, ...t }));
  assignmentId = seeded.findIndex((t) => t.type === "assignment") + 1;
  expect(assignmentId).toBeGreaterThan(0);
  H.state.created.length = 0;
  H.state.pkg = null;
  H.state.pkgUpdate = null;
  for (const k of Object.keys(H.rows)) delete H.rows[k];
  // An unrestricted state, so the compliance gate is not what refuses.
  H.rows.wholesaler_state_rules = [{ state: "TN", status: "unrestricted", recommendation: "assignment_ok", citation: null, summary: null }];
  H.rows.deals = [{ id: 5, organizationId: 42, propertyId: 9, type: "acquisition", status: "under_contract", acceptedAmount: "40000" }];
  H.rows.properties = [{ id: 9, organizationId: 42, address: "1 County Rd", city: "Columbia", state: "TN", zip: "38401", county: "Maury", apn: "071-012.00", sizeAcres: "10", sellerId: null, buyerId: null }];
});

function seedParties({ legal = "Acre Holdings LLC", endBuyer = "Riverbend Land Co" }: { legal?: string | null; endBuyer?: string | null } = {}) {
  H.rows.organizations = [{ legalEntityName: legal }];
  H.rows.contract_assignments = [{ id: 1, organizationId: 42, dealId: 5, endBuyerName: endBuyer, assignmentFeeCents: 500000, originalContractDate: "2026-09-01", status: "draft" }];
}

describe("POST /api/generated-documents — assignment parties", () => {
  it("resolves assignor from the org's legal entity name and assignee from the assignment's end buyer", async () => {
    seedParties();
    const res = await request(app).post("/api/generated-documents").send({ templateId: assignmentId, dealId: 5 });
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    const doc = H.state.created[0];
    expect(doc.content).toMatch(/ASSIGNOR:<\/strong>\s*Acre Holdings LLC/);
    expect(doc.content).toMatch(/ASSIGNEE:<\/strong>\s*Riverbend Land Co/);
    expect(doc.content).not.toMatch(/\{\{\s*assign(or|ee)_name\s*\}\}/);
    // The display name is not a legal party name.
    expect(doc.content).not.toContain("Tom's workspace");
    expect(doc.content).toContain("071-012.00");
  });

  for (const [what, parties, field] of [
    ["no legal entity name on the org", { legal: null }, "assignor_name"],
    ["no end buyer on the assignment", { endBuyer: null }, "assignee_name"],
    ["a whitespace-only end buyer", { endBuyer: "   " }, "assignee_name"],
  ] as const) {
    it(`${what} → refused naming ${field}; nothing created, no raw braces anywhere`, async () => {
      seedParties(parties);
      const res = await request(app).post("/api/generated-documents").send({ templateId: assignmentId, dealId: 5 });
      expect(res.status).toBe(422);
      expect(res.body.details.missing.map((m: any) => m.field)).toContain(field);
      expect(H.state.created).toHaveLength(0);
    });
  }

  it("an operator-supplied party name is honoured (manual override still works)", async () => {
    seedParties({ legal: null });
    const res = await request(app)
      .post("/api/generated-documents")
      .send({ templateId: assignmentId, dealId: 5, variables: { assignor_name: "Jane Doe" } });
    expect(res.status).toBe(201);
    expect(H.state.created[0].content).toMatch(/ASSIGNOR:<\/strong>\s*Jane Doe/);
  });
});

describe("POST /api/document-packages/:id/generate-all — assignment parties", () => {
  it("resolves both parties through the same context resolver", async () => {
    seedParties();
    H.state.pkg = { id: 3, organizationId: 42, dealId: 5, propertyId: 9, documents: [{ templateId: assignmentId, name: "Assignment" }] };
    const res = await request(app).post("/api/document-packages/3/generate-all").send({});
    expect(res.status).toBe(200);
    expect(H.state.pkgUpdate.documents[0].status).toBe("generated");
    const doc = H.state.created[0];
    expect(doc.content).toMatch(/ASSIGNOR:<\/strong>\s*Acre Holdings LLC/);
    expect(doc.content).toMatch(/ASSIGNEE:<\/strong>\s*Riverbend Land Co/);
    expect(doc.content).not.toMatch(/\{\{\s*assign(or|ee)_name\s*\}\}/);
  });

  it("unknown party → item blocked with the missing field named, not generated", async () => {
    seedParties({ endBuyer: null });
    H.state.pkg = { id: 3, organizationId: 42, dealId: 5, propertyId: 9, documents: [{ templateId: assignmentId, name: "Assignment" }] };
    const res = await request(app).post("/api/document-packages/3/generate-all").send({});
    expect(res.status).toBe(200);
    const item = H.state.pkgUpdate.documents[0];
    expect(item.status).toBe("blocked");
    expect(item.missing.map((m: any) => m.field)).toEqual(["assignee_name"]);
    expect(H.state.created).toHaveLength(0);
  });
});
