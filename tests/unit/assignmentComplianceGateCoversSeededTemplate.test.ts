/**
 * Wholesaler compliance gate covers every assignment template (P1-C item 10).
 *
 * POST /api/generated-documents gated only `template.type ===
 * "assignment_of_contract"`, but the SEEDED system template is type
 * "assignment" (server/storage/documentsRepo.ts) — so an IL assignment
 * generated with no block. The package path (generate-all) had no gate at
 * all. And the template labelled the SELLER as the Assignor.
 *
 * Drives the REAL seeder (to obtain the template exactly as it is seeded),
 * the REAL routes over supertest, and the REAL checkAssignmentCompliance
 * (an unseeded state is blocked by policy) — with only the DB and the auth
 * middleware mocked. A non-assignment control proves the harness generates,
 * so a 409 cannot be an artefact of a broken mock.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const H = vi.hoisted(() => {
  const inserted: any[] = [];
  const chain = (): any => {
    const c: any = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
    c.then = (f: any, r: any) => Promise.resolve([]).then(f, r);
    return c;
  };
  const dbMock: any = {
    select: () => ({ from: () => chain() }),
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
  return { inserted, dbMock, storageMock, state };
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
    req.organization = { id: 42 };
    next();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

import { documentsRepo } from "../../server/storage/documentsRepo";
import { registerDocSystemRoutes, isAssignmentTemplate } from "../../server/routes-doc-system";

const app = express();
app.use(express.json());
registerDocSystemRoutes(app);

let seeded: any[] = [];

beforeEach(async () => {
  H.inserted.length = 0;
  await (documentsRepo.seedSystemTemplates as any).call({});
  seeded = [...H.inserted];
  H.state.templates.clear();
  seeded.forEach((t, i) => H.state.templates.set(i + 1, { id: i + 1, organizationId: null, ...t }));
  H.state.created.length = 0;
  H.state.pkg = null;
  H.state.pkgUpdate = null;
});

function idOf(pred: (t: any) => boolean): number {
  const i = seeded.findIndex(pred);
  expect(i, "seeded template found").toBeGreaterThanOrEqual(0);
  return i + 1;
}

describe("assignment compliance gate", () => {
  it("the seeder produces templates and an assignment one of type 'assignment' (vacuity)", () => {
    expect(seeded.length).toBeGreaterThanOrEqual(5);
    const a = seeded.find((t) => /assign/i.test(t.name));
    expect(a?.type).toBe("assignment");
  });

  it("the canonical predicate covers every assignment spelling and the seeded template", () => {
    for (const type of ["assignment", "assignment_of_contract", "assignment_contract", "Contract_Assignment"]) {
      expect(isAssignmentTemplate({ type, content: "" }), type).toBe(true);
    }
    // Renaming the type does not reopen the bypass: the instrument is read.
    const seededAssignment = seeded.find((t) => t.type === "assignment");
    expect(isAssignmentTemplate({ ...seededAssignment, type: "other", name: "Custom" })).toBe(true);
    // Every seeded template that is NOT an assignment stays ungated.
    for (const t of seeded.filter((x) => x.type !== "assignment")) {
      expect(isAssignmentTemplate(t), t.name).toBe(false);
    }
  });

  it("POST /api/generated-documents with the SEEDED assignment template in IL is blocked, nothing created", async () => {
    const id = idOf((t) => t.type === "assignment");
    const res = await request(app)
      .post("/api/generated-documents")
      .send({ templateId: id, variables: { state: "IL", assignor_name: "W", assignee_name: "E" } });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("wholesaler_compliance_blocked");
    expect(H.state.created).toHaveLength(0);
  });

  it("control: a non-assignment seeded template generates (the harness works)", async () => {
    const id = idOf((t) => t.type === "promissory_note");
    const res = await request(app).post("/api/generated-documents").send({ templateId: id, variables: { state: "IL" } });
    expect(res.status).toBe(201);
    expect(H.state.created).toHaveLength(1);
  });

  it("POST /api/document-packages/:id/generate-all does not generate the assignment in IL", async () => {
    const assignment = idOf((t) => t.type === "assignment");
    const note = idOf((t) => t.type === "promissory_note");
    H.state.pkg = {
      id: 9, organizationId: 42, dealId: null, propertyId: null,
      documents: [{ templateId: assignment, name: "Assignment" }, { templateId: note, name: "Note" }],
    };
    const res = await request(app).post("/api/document-packages/9/generate-all").send({ variables: { state: "IL" } });
    expect(res.status).toBe(200);
    expect(H.state.created.map((d) => d.type)).toEqual(["promissory_note"]);
    const docs = H.state.pkgUpdate.documents;
    expect(docs[0].status).toBe("blocked");
    expect(docs[1].status).toBe("generated");
  });

  it("the seeded assignment names the original BUYER as Assignor, never the seller", () => {
    const a = seeded.find((t) => t.type === "assignment");
    expect(a.content).not.toMatch(/ASSIGNOR:<\/strong>\s*\{\{seller_name\}\}/);
    expect(a.content).not.toMatch(/Assignor:\s*\{\{seller_name\}\}/);
    expect(a.content).toMatch(/ASSIGNOR:<\/strong>\s*\{\{assignor_name\}\}/);
    const assignorVar = a.variables.find((v: any) => v.name === "assignor_name");
    expect(assignorVar.description).toMatch(/buyer/i);
    const sellerVar = a.variables.find((v: any) => v.name === "seller_name");
    expect(sellerVar.description).not.toMatch(/assignor/i);
  });

  it("databases already holding the old template are corrected on release (0284 in migrate.mjs)", async () => {
    const { readFileSync } = await import("node:fs");
    const { resolve } = await import("node:path");
    const { stripComments } = await import("../helpers/stripComments");
    const mjs = stripComments(readFileSync(resolve(__dirname, "../../scripts/migrate.mjs"), "utf8"));
    const block = mjs.match(/\$mig0284\$([\s\S]*?)\$mig0284\$/)?.[1];
    expect(block).toBeDefined();
    expect(block).toMatch(/UPDATE "document_templates"/);
    expect(block).toContain("'<strong>ASSIGNOR:</strong> {{seller_name}}', '<strong>ASSIGNOR:</strong> {{assignor_name}}'");
    expect(block).toMatch(/WHERE "is_system_template" = true\s+AND "content" LIKE '%<strong>ASSIGNOR:<\/strong> \{\{seller_name\}\}%'/);
    // The migration's variables list must match what the seeder now seeds.
    const seededVars = seeded.find((t) => t.type === "assignment").variables;
    const json = block!.match(/"variables" = '(\[[\s\S]*?\])'::jsonb/)?.[1];
    expect(json).toBeDefined();
    expect(JSON.parse(json!)).toEqual(seededVars);
  });
});
