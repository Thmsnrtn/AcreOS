/**
 * Every server path that WRITES a generated document is classified, and every
 * one that can produce an assignment of contract consults the wholesaler
 * state-rule gate (checkAssignmentCompliance) before it writes.
 *
 * WHY A POPULATION, NOT A LIST OF ROUTES (CLAUDE.md, law 3). The gate was
 * pinned by driving two routes (assignmentComplianceGateCoversSeededTemplate).
 * A third writer — the contract chain's POST /api/deals/:id/contract, which
 * drafts assignments for the deal's Documents tab — had no test that the gate
 * runs there at all, and a sixth writer added tomorrow would be green by
 * default. So:
 *
 *   A. The population is EVERY call of `createGeneratedDocument(` and every
 *      `insert(generatedDocuments)` in server/, parsed with the TypeScript
 *      compiler (never a scan: a comment naming the call is not a call).
 *      Each call is attributed to its unit — the route registration around it,
 *      or the function. A unit not in WRITERS is red until someone classifies it.
 *   B. Writers that cannot produce an assignment prove it from source: the
 *      document `type` they write is a string literal the canonical predicate
 *      (isAssignmentTemplate) rejects. Change it to a variable and this is red.
 *   C. Writers that CAN produce one are DRIVEN here with an assignment in a
 *      state the real checkAssignmentCompliance blocks (no rule row on file):
 *      refused, nothing written. A control with an unrestricted rule row
 *      writes, so a refusal cannot be an artefact of the harness.
 *
 * Mutation-checked: replacing the contract chain's gate with `return null`,
 * or the doc-system gate with `{ ok: true }`, turns C red; adding a writer
 * unit outside WRITERS turns A red.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import ts from "typescript";
import express from "express";
import request from "supertest";
import { listServerSources, parseSource, rel, ownerFunctionName, unwrap } from "../helpers/serverPopulation";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

// ── A. the population ───────────────────────────────────────────────────────

type WriterClass =
  | { canProduceAssignment: true; drivenBelow: string }
  | { canProduceAssignment: false; why: string };

const WRITERS: Record<string, WriterClass> = {
  "server/routes-doc-system.ts::POST /api/generated-documents": {
    canProduceAssignment: true,
    drivenBelow: "any template, org-owned ones included",
  },
  "server/routes-doc-system.ts::POST /api/document-packages/:id/generate-all": {
    canProduceAssignment: true,
    drivenBelow: "any template in the package",
  },
  "server/routes-contract-chain.ts::POST /api/deals/:id/contract": {
    canProduceAssignment: true,
    drivenBelow: "kind=assignment_of_contract",
  },
  "server/routes-deals.ts::POST /api/deals/:id/offer-letter-pdf": {
    canProduceAssignment: false,
    why: "writes type offer_letter with no template body",
  },
  "server/services/rental/leaseSigningPacket.ts::createLeaseSignaturePacket": {
    canProduceAssignment: false,
    why: "writes type residential_lease from the lease packet assembler",
  },
  "server/storage/documentsRepo.ts::createGeneratedDocument": {
    canProduceAssignment: false,
    why: "the storage method every writer above calls — the population is its callers",
  },
};

const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"]);

/** The route registration (`x.post("/api/…", …)`) enclosing a node, if any. */
function enclosingRoute(node: ts.Node): string | null {
  let n: ts.Node | undefined = node.parent;
  while (n) {
    if (ts.isCallExpression(n)) {
      const callee = unwrap(n.expression);
      const first = n.arguments[0];
      if (
        ts.isPropertyAccessExpression(callee) &&
        ROUTE_METHODS.has(callee.name.text) &&
        first &&
        ts.isStringLiteralLike(first) &&
        first.text.startsWith("/")
      ) {
        return `${callee.name.text.toUpperCase()} ${first.text}`;
      }
    }
    n = n.parent;
  }
  return null;
}

interface Site {
  unit: string;
  /** The `type` property of the written row: a literal, or null when computed. */
  typeLiteral: string | null;
}

function analyze(fileName: string, text: string): Site[] {
  const sf = parseSource(fileName, text);
  const out: Site[] = [];
  const unitOf = (node: ts.Node) => `${fileName}::${enclosingRoute(node) ?? ownerFunctionName(node)}`;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node)) {
      const callee = unwrap(node.expression);
      const name = ts.isPropertyAccessExpression(callee) ? callee.name.text : ts.isIdentifier(callee) ? callee.text : null;
      if (name === "createGeneratedDocument" && node.arguments.length > 0) {
        const arg = unwrap(node.arguments[0]);
        let typeLiteral: string | null = null;
        if (ts.isObjectLiteralExpression(arg)) {
          for (const p of arg.properties) {
            if (ts.isPropertyAssignment(p) && ts.isIdentifier(p.name) && p.name.text === "type") {
              const init = unwrap(p.initializer);
              if (ts.isStringLiteralLike(init)) typeLiteral = init.text;
            }
          }
        }
        out.push({ unit: unitOf(node), typeLiteral });
      }
      // db.insert(generatedDocuments)
      if (name === "insert" && node.arguments.some((a) => ts.isIdentifier(unwrap(a)) && (unwrap(a) as ts.Identifier).text === "generatedDocuments")) {
        out.push({ unit: unitOf(node), typeLiteral: null });
      }
    }
    // Raw SQL into the table.
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const t = ts.isTemplateExpression(node)
        ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("")
        : node.text;
      if (/insert\s+into\s+"?generated_documents"?/i.test(t)) out.push({ unit: unitOf(node), typeLiteral: null });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

function scanServer() {
  const files = listServerSources();
  const sites: Site[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!/createGeneratedDocument|generatedDocuments|generated_documents/.test(text)) continue;
    sites.push(...analyze(rel(f), text));
  }
  return { files: files.length, sites };
}

describe("A — every generated-document writer is classified", () => {
  const { files, sites } = scanServer();

  it("floors: the walker read the server tree and found the writers", () => {
    expect(files).toBeGreaterThan(500);
    expect(sites.length).toBeGreaterThanOrEqual(Object.keys(WRITERS).length);
  });

  it("no writer outside the register", () => {
    const unknown = [...new Set(sites.map((s) => s.unit))].filter((u) => !(u in WRITERS));
    expect(unknown, "classify each new generated-document writer in WRITERS (and drive it below if it can produce an assignment)").toEqual([]);
  });

  it("per member: every registered writer is still found (a stale entry is red)", () => {
    for (const unit of Object.keys(WRITERS)) {
      expect(sites.some((s) => s.unit === unit), unit).toBe(true);
    }
  });

  it("canaries: a commented call is not a writer; a call is attributed to its route", () => {
    const fixture = [
      'app.post("/api/x", async (req, res) => {',
      "  // storage.createGeneratedDocument({ type: 'assignment' })",
      "  await db.transaction(async (tx) => {",
      '    await storage.createGeneratedDocument({ type: template.type, content: "" });',
      "  });",
      "});",
      "export async function helper() { await storage.createGeneratedDocument({ type: \"lease\" }); }",
    ].join("\n");
    const found = analyze("server/fixture.ts", fixture);
    expect(found).toEqual([
      { unit: "server/fixture.ts::POST /api/x", typeLiteral: null },
      { unit: "server/fixture.ts::helper", typeLiteral: "lease" },
    ]);
  });
});

// ── B. the non-assignment writers prove it from source ──────────────────────

describe("B — writers classified as unable to produce an assignment write a fixed, non-assignment type", () => {
  const { sites } = scanServer();
  it("each such call site writes a string-literal type the canonical predicate rejects", async () => {
    const { isAssignmentTemplate } = await import("../../server/routes-doc-system");
    for (const [unit, cls] of Object.entries(WRITERS)) {
      if (cls.canProduceAssignment || unit.startsWith("server/storage/")) continue;
      const own = sites.filter((s) => s.unit === unit);
      expect(own.length, unit).toBeGreaterThan(0);
      for (const s of own) {
        expect(s.typeLiteral, `${unit} must write a literal type`).not.toBeNull();
        expect(isAssignmentTemplate({ type: s.typeLiteral, content: "" }), `${unit}: ${s.typeLiteral}`).toBe(false);
      }
    }
  });
});

// ── C. the assignment-capable writers are driven ────────────────────────────

const H = vi.hoisted(() => {
  type Row = Record<string, any>;
  const state = {
    ruleRows: [] as Row[],
    created: [] as Row[],
    templates: new Map<number, Row>(),
    pkg: null as Row | null,
    pkgUpdate: null as Row | null,
    assignment: null as Row | null,
  };
  return { state };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", async () => {
  const schema = await vi.importActual<typeof import("@shared/schema")>("@shared/schema");
  const rowsFor = (table: unknown): Record<string, any>[] => {
    if (table === schema.wholesalerStateRules) return H.state.ruleRows;
    if (table === schema.contractAssignments) return H.state.assignment ? [H.state.assignment] : [];
    return [];
  };
  const chain = (rows: unknown[]): any => {
    const c: any = {};
    for (const m of ["where", "limit", "orderBy", "innerJoin", "leftJoin"]) c[m] = () => c;
    c.then = (f: any, r: any) => Promise.resolve(rows).then(f, r);
    return c;
  };
  const db: any = {
    select: () => ({ from: (t: unknown) => chain(rowsFor(t)) }),
    insert: () => ({ values: () => ({ returning: async () => [], then: (f: any) => Promise.resolve([]).then(f) }) }),
    update: () => ({ set: () => ({ where: async () => [] }) }),
    execute: async () => ({ rows: [] }),
  };
  return { db };
});
vi.mock("../../server/storage", async () => {
  const { db } = await import("../../server/db");
  const org = { id: 42, name: "Trey", legalEntityName: "Trey Wholesale LLC", settings: { companyEmail: "t@example.com" } };
  return {
    db,
    storage: {
      getDeal: async (o: number, id: number) =>
        o === 42 && id === 5
          ? { id: 5, organizationId: 42, propertyId: 3, type: "acquisition", status: "accepted", acceptedAmount: "125000", closingDate: new Date("2026-09-01T12:00:00Z") }
          : undefined,
      getProperty: async (o: number, id: number) =>
        o === 42 && id === 3
          ? { id: 3, organizationId: 42, apn: "17-0999-0042", address: "88 Longleaf Rd", city: "Marietta", state: "GA", county: "Cobb", zip: "30060", sellerId: 9, structureType: null }
          : undefined,
      getLead: async (o: number, id: number) => (o === 42 && id === 9 ? { id: 9, organizationId: 42, firstName: "Homer", lastName: "Vance" } : undefined),
      getOrganization: async (id: number) => (id === 42 ? org : undefined),
      getDocumentTemplate: async (_o: number, id: number) => H.state.templates.get(Number(id)),
      createGeneratedDocument: async (doc: Record<string, any>) => {
        H.state.created.push(doc);
        return { id: H.state.created.length, ...doc };
      },
      getDocumentPackage: async () => H.state.pkg,
      updateDocumentPackage: async (_id: number, upd: Record<string, any>) => {
        H.state.pkgUpdate = upd;
        return { ...H.state.pkg, ...upd };
      },
    },
  };
});
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "7" };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Trey", legalEntityName: "Trey Wholesale LLC", settings: {} };
    next();
  },
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));

const UNRESTRICTED_GA = { state: "GA", status: "unrestricted", recommendation: "assignment_ok", citation: null, summary: "Permitted.", attorneyReviewedAt: null };
const ASSIGNMENT_TEMPLATE = {
  id: 1, organizationId: null, isSystemTemplate: true, name: "Assignment Contract", type: "assignment",
  content: "<p>ASSIGNOR: {{assignor_name}} ASSIGNEE: {{assignee_name}}</p>",
};

async function makeApp() {
  const { registerDocSystemRoutes } = await import("../../server/routes-doc-system");
  const { registerContractChainRoutes } = await import("../../server/routes-contract-chain");
  const app = express();
  app.use(express.json());
  registerDocSystemRoutes(app);
  registerContractChainRoutes(app);
  return app;
}

beforeEach(() => {
  H.state.ruleRows = [];
  H.state.created = [];
  H.state.templates = new Map([[1, ASSIGNMENT_TEMPLATE]]);
  H.state.pkg = null;
  H.state.pkgUpdate = null;
  H.state.assignment = { id: 1, organizationId: 42, dealId: 5, status: "draft", endBuyerName: "Eve Buyer LLC", assignmentFeeCents: 750000, originalContractDate: "2026-08-01" };
});

/** One drive per assignment-capable writer: [request, did it write?]. */
const DRIVES: Record<string, (app: express.Express) => Promise<{ status: number; wrote: boolean }>> = {
  "server/routes-doc-system.ts::POST /api/generated-documents": async (app) => {
    const res = await request(app)
      .post("/api/generated-documents")
      .send({ templateId: 1, variables: { state: "GA", assignor_name: "Trey Wholesale LLC", assignee_name: "Eve Buyer LLC" } });
    return { status: res.status, wrote: H.state.created.length > 0 };
  },
  "server/routes-doc-system.ts::POST /api/document-packages/:id/generate-all": async (app) => {
    H.state.pkg = { id: 9, organizationId: 42, dealId: null, propertyId: null, documents: [{ templateId: 1, name: "Assignment" }] };
    const res = await request(app)
      .post("/api/document-packages/9/generate-all")
      .send({ variables: { state: "GA", assignor_name: "Trey Wholesale LLC", assignee_name: "Eve Buyer LLC" } });
    return { status: res.status, wrote: H.state.created.length > 0 };
  },
  "server/routes-contract-chain.ts::POST /api/deals/:id/contract": async (app) => {
    const preview = await request(app).get("/api/deals/5/contract-preview?kind=assignment_of_contract");
    expect(preview.status, JSON.stringify(preview.body).slice(0, 300)).toBe(200);
    const res = await request(app)
      .post("/api/deals/5/contract")
      .send({ kind: "assignment_of_contract", confirmReviewed: true, reviewedContentHash: preview.body.contentHash });
    return { status: res.status, wrote: H.state.created.length > 0 };
  },
};

describe("C — every assignment-capable writer consults the gate before it writes", () => {
  it("the drives cover exactly the assignment-capable writers", () => {
    const capable = Object.entries(WRITERS).filter(([, c]) => c.canProduceAssignment).map(([u]) => u).sort();
    expect(Object.keys(DRIVES).sort()).toEqual(capable);
  });

  for (const unit of Object.keys(DRIVES)) {
    it(`${unit}: refused and nothing written in a state with no rule on file`, async () => {
      const app = await makeApp();
      H.state.ruleRows = []; // GA unseeded → the real checkAssignmentCompliance blocks
      const r = await DRIVES[unit](app);
      expect(r.wrote, "an assignment was written past the gate").toBe(false);
      if (unit.includes("generate-all")) {
        expect(H.state.pkgUpdate?.documents?.[0]?.status).toBe("blocked");
      } else {
        expect([409, 422]).toContain(r.status);
      }
    });

    it(`${unit}: control — an unrestricted state writes (the harness can write)`, async () => {
      const app = await makeApp();
      H.state.ruleRows = [UNRESTRICTED_GA];
      const r = await DRIVES[unit](app);
      expect(r.wrote).toBe(true);
    });
  }
});
