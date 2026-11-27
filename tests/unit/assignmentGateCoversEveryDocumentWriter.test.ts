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
 *   A2. The UPDATE sites are read the same way — every `updateGeneratedDocument(`
 *      call, every `update(generatedDocuments)` and raw `UPDATE generated_documents`
 *      — and each unit's patch keys are pinned in UPDATERS. An update that can
 *      rewrite a document's body (content / type / templateId / variables, or a
 *      patch the parser cannot see into) can turn a gated draft into an
 *      assignment after the gate ran; UPDATERS must say so (`rewritesBody`), and
 *      the derived answer must match. Every shape has a per-shape floor on the
 *      real tree (where the tree has one) and a canary fixture.
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
  "server/services/wholesale/sellerFollowUps.ts::createSellerFollowUp": {
    canProduceAssignment: false,
    why: "writes type SELLER_FOLLOW_UP_DRAFT_TYPE, a module constant (\"seller_follow_up_draft\")",
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

type Shape = "create-call" | "insert-table" | "insert-sql" | "update-call" | "update-table" | "update-sql";

interface Site {
  unit: string;
  shape: Shape;
  /** create sites: the `type` of the written row — a literal (or a same-file const bound to one), null when computed. */
  typeLiteral: string | null;
  /** update sites: the keys the patch writes, sorted; `builder:<fn>` for a patch built by a call; `*` where the parser cannot see. */
  keys?: string[];
}

/** Top-level `const NAME = "literal"` bindings in a file. */
function constStrings(sf: ts.SourceFile): Map<string, string> {
  const out = new Map<string, string>();
  for (const st of sf.statements) {
    if (!ts.isVariableStatement(st) || !(st.declarationList.flags & ts.NodeFlags.Const)) continue;
    for (const d of st.declarationList.declarations) {
      if (ts.isIdentifier(d.name) && d.initializer && ts.isStringLiteralLike(unwrap(d.initializer))) {
        out.set(d.name.text, (unwrap(d.initializer) as ts.StringLiteralLike).text);
      }
    }
  }
  return out;
}

/** Patch builders whose returned keys are read from source in A2. */
const STATUS_PATCH_BUILDERS = new Set(["statusPatchFor"]);

/** The keys an update patch writes. Conditional spreads (`...(x && { k })`, `...(c ? { k } : {})`) are followed. */
function patchKeys(e: ts.Expression | undefined): string[] {
  if (!e) return ["*"];
  const u = unwrap(e);
  const keys = new Set<string>();
  const add = (x: ts.Expression) => {
    const v = unwrap(x);
    if (ts.isObjectLiteralExpression(v)) {
      for (const p of v.properties) {
        if (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p) || ts.isMethodDeclaration(p)) {
          const n = p.name;
          if (ts.isIdentifier(n) || ts.isStringLiteralLike(n)) keys.add(n.text);
          else keys.add("*");
        } else if (ts.isSpreadAssignment(p)) add(p.expression);
        else keys.add("*");
      }
    } else if (ts.isBinaryExpression(v) && v.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) add(v.right);
    else if (ts.isConditionalExpression(v)) { add(v.whenTrue); add(v.whenFalse); }
    else if (ts.isCallExpression(v)) {
      const c = unwrap(v.expression);
      // Only a builder whose source this file reads (below) is named; any
      // other call passes through keys the parser cannot see.
      keys.add(ts.isIdentifier(c) && STATUS_PATCH_BUILDERS.has(c.text) ? `builder:${c.text}` : "*");
    } else keys.add("*");
  };
  add(u);
  return [...keys].sort();
}

function analyze(fileName: string, text: string): Site[] {
  const sf = parseSource(fileName, text);
  const consts = constStrings(sf);
  const out: Site[] = [];
  const unitOf = (node: ts.Node) => `${fileName}::${enclosingRoute(node) ?? ownerFunctionName(node)}`;
  const isDocsTable = (a: ts.Expression) => ts.isIdentifier(unwrap(a)) && (unwrap(a) as ts.Identifier).text === "generatedDocuments";
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
              else if (ts.isIdentifier(init) && consts.has(init.text)) typeLiteral = consts.get(init.text)!;
            }
          }
        }
        out.push({ unit: unitOf(node), shape: "create-call", typeLiteral });
      }
      // db.insert(generatedDocuments)
      if (name === "insert" && node.arguments.some(isDocsTable)) {
        out.push({ unit: unitOf(node), shape: "insert-table", typeLiteral: null });
      }
      // storage.updateGeneratedDocument(id, patch[, orgId])
      if (name === "updateGeneratedDocument" && node.arguments.length >= 2) {
        out.push({ unit: unitOf(node), shape: "update-call", typeLiteral: null, keys: patchKeys(node.arguments[1]) });
      }
      // db.update(generatedDocuments).set(patch)
      if (name === "update" && node.arguments.some(isDocsTable)) {
        const acc = node.parent;
        const call = acc?.parent;
        const located = acc && ts.isPropertyAccessExpression(acc) && acc.name.text === "set" && call && ts.isCallExpression(call) && call.expression === acc;
        out.push({ unit: unitOf(node), shape: "update-table", typeLiteral: null, keys: located ? patchKeys((call as ts.CallExpression).arguments[0]) : ["*"] });
      }
    }
    // Raw SQL into the table.
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) {
      const t = ts.isTemplateExpression(node)
        ? [node.head.text, ...node.templateSpans.map((s) => s.literal.text)].join("")
        : node.text;
      if (/insert\s+into\s+"?generated_documents"?/i.test(t)) out.push({ unit: unitOf(node), shape: "insert-sql", typeLiteral: null });
      if (/update\s+"?generated_documents"?\s+set/i.test(t)) out.push({ unit: unitOf(node), shape: "update-sql", typeLiteral: null, keys: ["*"] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

const isCreate = (s: Site) => s.shape.startsWith("create") || s.shape.startsWith("insert");
const isUpdate = (s: Site) => s.shape.startsWith("update");

function scanServer() {
  const files = listServerSources();
  const all: Site[] = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    if (!/GeneratedDocument|generatedDocuments|generated_documents/.test(text)) continue;
    all.push(...analyze(rel(f), text));
  }
  return { files: files.length, sites: all.filter(isCreate), updates: all.filter(isUpdate), all };
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
      { unit: "server/fixture.ts::POST /api/x", shape: "create-call", typeLiteral: null },
      { unit: "server/fixture.ts::helper", shape: "create-call", typeLiteral: "lease" },
    ]);
  });
});

// ── A2. the update sites ────────────────────────────────────────────────────

/** Fields whose change rewrites what a document says (and so what the gate checked). */
const BODY_FIELDS = new Set(["content", "type", "templateId", "variables", "*"]);

const UPDATERS: Record<string, { keys: string[]; rewritesBody: boolean; note: string }> = {
  "server/routes-doc-system.ts::PUT /api/generated-documents/:id": {
    keys: ["content", "name", "signers", "status"],
    rewritesBody: true,
    note:
      "edits content of a non-frozen document after creation, past the assignment gate; also takes `status` from the body " +
      "(follow-up, e-sign ruling: a member can mark a document signed with no ceremony)",
  },
  "server/routes-doc-system.ts::POST /api/signatures": {
    keys: ["builder:statusPatchFor"],
    rewritesBody: false,
    note: "status fields derived from the signatures table (statusPatchFor)",
  },
  "server/routes-doc-system.ts::POST /api/generated-documents/:id/request-signature": {
    keys: ["esignProvider", "esignStatus", "expiresAt", "sentAt", "signers", "status"],
    rewritesBody: false,
    note: "sends for signature: roster and send state only",
  },
  "server/routes-doc-system.ts::POST /api/generated-documents/:id/send-for-signature": {
    keys: ["esignProvider", "esignStatus", "expiresAt", "sentAt", "signers", "status"],
    rewritesBody: false,
    note: "legacy send path: roster and send state only",
  },
  "server/routes-public-sign.ts::POST /api/public/sign/:docId": {
    keys: ["builder:statusPatchFor"],
    rewritesBody: false,
    note: "status fields derived from the signatures table (statusPatchFor)",
  },
  "server/storage/documentsRepo.ts::updateGeneratedDocument": {
    keys: ["*", "updatedAt"],
    rewritesBody: true,
    note: "the storage method every update above calls — the population is its callers",
  },
  "server/storage/documentsRepo.ts::restoreDocumentVersion": {
    keys: ["content"],
    rewritesBody: true,
    note: "restores an earlier version's content (follow-up: not re-gated)",
  },
};

describe("A2 — every generated-document update site is classified, with the keys it writes", () => {
  const { updates, all } = scanServer();

  it("per-shape floors: the walker still reads each shape the tree has", () => {
    const count = (sh: Shape) => all.filter((s) => s.shape === sh).length;
    expect(count("create-call")).toBeGreaterThanOrEqual(6);
    expect(count("insert-table")).toBeGreaterThanOrEqual(1);
    expect(count("update-call")).toBeGreaterThanOrEqual(6);
    expect(count("update-table")).toBeGreaterThanOrEqual(1);
  });

  it("no update site outside the register", () => {
    const unknown = [...new Set(updates.map((s) => s.unit))].filter((u) => !(u in UPDATERS));
    expect(unknown, "classify each new generated-document update site in UPDATERS").toEqual([]);
  });

  it("per member: every registered update site is still found, writing exactly the keys it is registered with", () => {
    for (const [unit, reg] of Object.entries(UPDATERS)) {
      const own = updates.filter((s) => s.unit === unit);
      expect(own.length, unit).toBeGreaterThan(0);
      const keys = [...new Set(own.flatMap((s) => s.keys ?? ["*"]))].sort();
      expect(keys, unit).toEqual([...reg.keys].sort());
    }
  });

  it("rewritesBody is derived from the keys, not asserted: a patch that gains a body field must be reclassified", () => {
    for (const [unit, reg] of Object.entries(UPDATERS)) {
      const derived = reg.keys.some((k) => BODY_FIELDS.has(k));
      expect(reg.rewritesBody, unit).toBe(derived);
    }
  });

  it("the patch builders named in UPDATERS write status fields only (read from their source)", () => {
    const builders = new Set(Object.values(UPDATERS).flatMap((r) => r.keys).filter((k) => k.startsWith("builder:")).map((k) => k.slice(8)));
    expect([...builders]).toEqual(["statusPatchFor"]);
    const file = "server/services/esign/signingProgress.ts";
    const sf = parseSource(file, fs.readFileSync(file, "utf8"));
    const keys = new Set<string>();
    let found = false;
    const visit = (n: ts.Node) => {
      if (ts.isFunctionDeclaration(n) && n.name?.text === "statusPatchFor" && n.body) {
        found = true;
        const ret = (m: ts.Node) => {
          if (ts.isReturnStatement(m) && m.expression) for (const k of patchKeys(m.expression)) keys.add(k);
          else if (!ts.isFunctionLike(m)) ts.forEachChild(m, ret);
        };
        ts.forEachChild(n.body, ret);
      }
      ts.forEachChild(n, visit);
    };
    visit(sf);
    expect(found, "statusPatchFor not found").toBe(true);
    expect(keys.size).toBeGreaterThan(0);
    for (const k of keys) expect(["status", "completedAt", "signedAt"], k).toContain(k);
  });

  it("canaries: one fixture per shape is read, with its unit and keys", () => {
    const fixture = [
      'app.put("/api/d/:id", async (req, res) => {',
      "  // await storage.updateGeneratedDocument(1, { type: 'assignment' });",
      "  const { content, status } = req.body;",
      "  await storage.updateGeneratedDocument(1, { ...(content && { content }), ...(status ? { status } : {}) }, 2);",
      "});",
      'app.post("/api/d/:id/s", async (req, res) => { await storage.updateGeneratedDocument(1, statusPatchFor(p)); });',
      'app.post("/api/d/:id/t", async (req, res) => { await storage.updateGeneratedDocument(1, req.body); });',
      'app.post("/api/d/:id/u", async (req, res) => { await storage.updateGeneratedDocument(1, { ...pick(req.body), name: "n" }); });',
      "export async function viaTable() { await db.update(generatedDocuments).set({ name: 'x', updatedAt: now }).where(w); }",
      "export async function viaTableOutOfChain() { const q = db.update(generatedDocuments); await q.set({ name: 'x' }); }",
      "export async function viaSql() { await db.execute(sql`UPDATE generated_documents SET type = ${t} WHERE id = ${i}`); }",
      "export async function insertSql() { await db.execute(sql`INSERT INTO generated_documents (type) VALUES (${t})`); }",
      "export async function insertTable() { await db.insert(generatedDocuments).values(v); }",
      'const KIND = "lease";',
      "export async function viaConst() { await storage.createGeneratedDocument({ type: KIND }); }",
    ].join("\n");
    const got = analyze("server/fixture.ts", fixture).map((s) => [s.unit.replace("server/fixture.ts::", ""), s.shape, s.keys ?? s.typeLiteral]);
    expect(got).toEqual([
      ["PUT /api/d/:id", "update-call", ["content", "status"]],
      ["POST /api/d/:id/s", "update-call", ["builder:statusPatchFor"]],
      ["POST /api/d/:id/t", "update-call", ["*"]],
      ["POST /api/d/:id/u", "update-call", ["*", "name"]],
      ["viaTable", "update-table", ["name", "updatedAt"]],
      ["viaTableOutOfChain", "update-table", ["*"]],
      ["viaSql", "update-sql", ["*"]],
      ["insertSql", "insert-sql", null],
      ["insertTable", "insert-table", null],
      ["viaConst", "create-call", "lease"],
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
