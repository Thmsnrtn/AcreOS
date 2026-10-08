/**
 * The /api/import/* router answers POSTs, and no import can grant consent.
 *
 * 1. MOUNTING. In server/routes-import-export.ts the handler of
 *    `GET /api/import/notes/columns` was missing its closing `});`, and a stray
 *    one further down closed it instead — so every route between them
 *    (`/api/import/:entityType`, `/:entityType/preview`, `/notes`,
 *    `/communications`, `/documents`, `/:entityType/columns`) was registered
 *    INSIDE that GET handler: never at startup, and only (repeatedly, behind
 *    the API 404 catch-all) after someone fetched the notes columns. In the
 *    production build every import POST answered 404 "Not found" while the
 *    jobs GETs, registered at the top level, worked.
 *
 *    The behavioural test mounts the router the way the server does, with the
 *    API catch-all after it, and POSTs without any prior GET. The structural
 *    test reads EVERY server .ts file and refuses any route registration that
 *    sits inside another registration's handler, with a population floor and a
 *    canary proving the walker sees the shape.
 *
 * 2. CONSENT. An import may set do-not-contact; it may never set TCPA consent.
 *    `server/services/import.ts` copied a consent column straight onto the
 *    lead, so one "consent = yes" column granted consent to a purchased list.
 *    And `PATCH /api/leads/:id/consent` granted consent from any source string,
 *    "list_vendor" included, with no per-lead evidence row.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import ts from "typescript";

const H = vi.hoisted(() => {
  const state = {
    lead: { id: 5, organizationId: 7, tcpaConsent: false, doNotContact: false } as any,
    consentUpdates: [] as any[],
    consentEvents: [] as any[],
    txInserts: [] as any[],
    batchCreates: [] as any[],
  };
  const dbMock: any = {
    select: () => ({ from: () => ({ where: async () => [] }) }),
    transaction: async (fn: any) =>
      fn({ insert: () => ({ values: async (v: any) => { state.txInserts.push(v); } }) }),
  };
  const storageMock = {
    getLead: vi.fn(async (orgId: number, id: number) => (orgId === 7 && id === state.lead.id ? state.lead : undefined)),
    updateLeadConsent: vi.fn(async (id: number, c: any) => {
      state.consentUpdates.push({ id, ...c });
      return { ...state.lead, ...c };
    }),
    createAuditLogEntry: vi.fn(async () => ({ id: 1 })),
    findDuplicateLeads: vi.fn(async () => []),
    getTeamMemberByEmail: vi.fn(async () => null),
    createLeadsBatch: vi.fn(async (rows: any[]) => {
      state.batchCreates.push(...rows);
      return rows.map((r, i) => ({ id: 100 + i, ...r }));
    }),
    createLead: vi.fn(async (r: any) => ({ id: 99, ...r })),
  };
  return { state, dbMock, storageMock };
});

vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _s: any, n: any) => {
    req.user = { id: "owner-1" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _s: any, n: any) => {
    req.organization = { id: 7, name: "Org" };
    n();
  },
}));
vi.mock("../../server/utils/permissions", () => ({ requirePermission: () => (_q: any, _s: any, n: any) => n() }));
vi.mock("../../server/middleware/fileUploadSecurity", () => ({
  // No file arrives: the handler itself must answer "No file uploaded".
  createUploadMiddleware: () => ({ single: () => (_q: any, _s: any, n: any) => n(), array: () => (_q: any, _s: any, n: any) => n() }),
  validateFileMiddleware: () => (_q: any, _s: any, n: any) => n(),
}));
vi.mock("../../server/services/consentEvents", () => ({
  recordConsentGranted: async (a: any) => {
    H.state.consentEvents.push(a);
  },
}));
vi.mock("../../server/services/leadEvents", () => ({ emitLeadCreated: vi.fn(), emitLeadCreatedDurably: vi.fn() }));

import { registerImportExportRoutes } from "../../server/routes-import-export";
import { importLeads as legacyImportLeads } from "../../server/services/import";
import { importLeads } from "../../server/services/importExport";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

// Reads the repository tree; the sweep budget, not the 30s default.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

function makeApp() {
  const app = express();
  app.use(express.json());
  registerImportExportRoutes(app);
  // The production API catch-all, registered after every router.
  app.use("/api", (_req, res) => res.status(404).json({ message: "Not found" }));
  return app;
}

beforeEach(() => {
  H.state.consentUpdates = [];
  H.state.consentEvents = [];
  H.state.txInserts = [];
  H.state.batchCreates = [];
});

describe("/api/import/* POSTs are mounted at startup", () => {
  it.each([
    ["/api/import/leads"],
    ["/api/import/properties"],
    ["/api/import/notes"],
    ["/api/import/leads/preview"],
  ])("POST %s reaches its handler (no prior GET, catch-all behind it)", async (url) => {
    const res = await request(makeApp()).post(url);
    expect(res.status, `${url} → ${res.status} ${JSON.stringify(res.body)}`).not.toBe(404);
    expect(res.body.message).toMatch(/No file uploaded/);
  });

  it("GET /api/import/leads/columns answers at startup", async () => {
    const res = await request(makeApp()).get("/api/import/leads/columns");
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.columns)).toBe(true);
  });

  it("fetching the notes columns does not register more routes", async () => {
    const app = makeApp();
    const count = () => ((app as any).router ?? (app as any)._router).stack.length;
    const before = count();
    await request(app).get("/api/import/notes/columns");
    await request(app).get("/api/import/notes/columns");
    expect(count()).toBe(before);
  });
});

describe("no server route is registered inside another route's handler", () => {
  const ROOT = path.join(__dirname, "../..");
  const VERBS = new Set(["get", "post", "put", "patch", "delete", "all"]);

  /** Registrations `x.verb("/path", ...handlers)` in a source, flagging any inside another's handler. */
  function scan(file: string, src: string) {
    const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
    let registrations = 0;
    const nested: string[] = [];
    const visit = (n: ts.Node, enclosing: string | null) => {
      if (
        ts.isCallExpression(n) &&
        ts.isPropertyAccessExpression(n.expression) &&
        VERBS.has(n.expression.name.text) &&
        n.arguments.length >= 2 &&
        ts.isStringLiteralLike(n.arguments[0]) &&
        n.arguments[0].text.startsWith("/")
      ) {
        registrations++;
        const route = `${n.expression.name.text.toUpperCase()} ${n.arguments[0].text}`;
        if (enclosing) {
          const line = sf.getLineAndCharacterOfPosition(n.getStart()).line + 1;
          nested.push(`${file}:${line} ${route} is registered inside the handler of ${enclosing}`);
        }
        n.arguments.slice(1).forEach((a) => visit(a, route));
        return;
      }
      ts.forEachChild(n, (c) => visit(c, enclosing));
    };
    visit(sf, null);
    return { registrations, nested };
  }

  it("canary: the walker sees a registration nested in a handler", () => {
    const fixture = `export function r(api) {
      api.get("/a", auth, (_req, res) => { res.json({});
      api.post("/b", auth, async (req, res) => { res.json({}); });
      });
    }`;
    const r = scan("fixture.ts", fixture);
    expect(r.registrations).toBe(2);
    expect(r.nested).toHaveLength(1);
    expect(r.nested[0]).toContain("POST /b is registered inside the handler of GET /a");
  });

  it("holds over every server .ts file", () => {
    const files = execSync("git ls-files server", { cwd: ROOT, encoding: "utf8" })
      .split("\n")
      .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));
    let registrations = 0;
    const nested: string[] = [];
    let importExportRegistrations = 0;
    for (const f of files) {
      const r = scan(f, fs.readFileSync(path.join(ROOT, f), "utf8"));
      registrations += r.registrations;
      nested.push(...r.nested);
      if (f === "server/routes-import-export.ts") importExportRegistrations = r.registrations;
    }
    // Population floors: the walker read the route surface, and the file this
    // defect lived in specifically (measured 2,813 and 23 on 2026-10-06).
    expect(files.length).toBeGreaterThan(1000);
    expect(registrations).toBeGreaterThan(2500);
    expect(importExportRegistrations).toBeGreaterThanOrEqual(20);
    expect(nested, nested.join("\n")).toEqual([]);
  });
});

describe("PATCH /api/leads/:id/consent grants only express, per-lead consent", () => {
  it.each(["list_vendor", "imported", "purchased_list"])("refuses consentSource %s and writes nothing", async (src) => {
    const res = await request(makeApp()).patch("/api/leads/5/consent").send({ tcpaConsent: true, consentSource: src });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not express consent/);
    expect(H.state.consentUpdates).toHaveLength(0);
    expect(H.state.consentEvents).toHaveLength(0);
  });

  it("the lead page's Grant (manual) is accepted and leaves an evidence row", async () => {
    const res = await request(makeApp()).patch("/api/leads/5/consent").send({ tcpaConsent: true, consentSource: "manual" });
    expect(res.status).toBe(200);
    expect(H.state.consentUpdates).toEqual([expect.objectContaining({ id: 5, tcpaConsent: true, consentSource: "manual" })]);
    expect(H.state.consentEvents).toEqual([expect.objectContaining({ leadId: 5, organizationId: 7, recordedBy: "owner-1" })]);
  });

  it("a written opt-in is accepted; opting out needs no source", async () => {
    expect((await request(makeApp()).patch("/api/leads/5/consent").send({ tcpaConsent: true, consentSource: "written" })).status).toBe(200);
    expect((await request(makeApp()).patch("/api/leads/5/consent").send({ tcpaConsent: false, optOutReason: "asked" })).status).toBe(200);
    expect(H.state.consentUpdates.map((u) => u.tcpaConsent)).toEqual([true, false]);
  });

  it("a non-boolean tcpaConsent is refused", async () => {
    const res = await request(makeApp()).patch("/api/leads/5/consent").send({ tcpaConsent: "yes", consentSource: "website" });
    expect(res.status).toBe(400);
    expect(H.state.consentUpdates).toHaveLength(0);
  });
});

describe("an import never grants consent, and honours do-not-contact", () => {
  it("services/import.ts: a consent column becomes a note, never consent", async () => {
    const r = await legacyImportLeads(
      [
        { firstName: "Ann", lastName: "Lee", tcpaConsent: "true", doNotContact: "false" },
        { firstName: "Bo", lastName: "Ray", tcpaConsent: "false", doNotContact: "true" },
      ],
      7,
    );
    expect(r.successCount).toBe(2);
    expect(H.state.txInserts).toHaveLength(2);
    expect(H.state.txInserts.map((v) => v.tcpaConsent)).toEqual([false, false]);
    expect(H.state.txInserts[0].notes).toMatch(/claimed TCPA consent.*Not recorded as consent/);
    expect(H.state.txInserts[1].doNotContact).toBe(true);
  });

  it("services/importExport.ts: a DNC column sets do-not-contact; a consent column is ignored", async () => {
    const r = await importLeads(
      [
        { firstName: "Ann", lastName: "Lee", DNC: "Y", tcpaConsent: "true" },
        { firstName: "Bo", lastName: "Ray", DNC: "N", tcpa_consent: "yes" },
      ],
      7,
      { fieldMap: { tcpa_consent: "tcpaConsent" } },
    );
    expect(r.successCount).toBe(2);
    expect(H.state.batchCreates.map((c) => !!c.doNotContact)).toEqual([true, false]);
    expect(H.state.batchCreates.every((c) => c.tcpaConsent !== true)).toBe(true);
  });
});
