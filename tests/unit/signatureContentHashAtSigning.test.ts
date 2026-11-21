/**
 * Every signature write records the document's content hash, and every reader
 * tells "verified", "tampered" and "not recorded" apart.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `POST /api/public/sign/:docId`, the route a counterparty signs on, wrote the
 * signature row without `document_content_hash`. Only the operator's own
 * self-signature route (`POST /api/signatures`) recorded it. The sealed PDF and
 * the completion certificate then read "no hash" exactly as "hash differs", so
 * every counterparty-signed document printed a tamper warning, the certificate
 * reported its integrity check as false, and `X-Document-Integrity-Verified`
 * was false — for documents nobody had changed.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *  1. The WRITER POPULATION. Every `createSignature(` call, and every
 *     insert/update/delete on the `signatures` table, in server/, shared/ and
 *     scripts/ is found by PARSING (the parser never visits a comment, so a
 *     comment naming a call is not a call). The calls must equal the register
 *     below and each registered writer is driven through its real route; the
 *     only raw insert is the storage method; nothing updates or deletes a row.
 *     A canary per extraction shape proves the scan still reads that shape.
 *  2. LIKE WITH LIKE. Both writers store the same hash for the same content,
 *     it equals an independent SHA-256 of that content, and the renderer
 *     recomputes the same value.
 *  3. FOUR STATES, ON EVERY SURFACE. The sealed PDF (real pdfkit bytes read
 *     back with pdf-parse), its headers, and the completion certificate each
 *     say which state a document is in: verified; mismatch — the only state
 *     that says "tamper"; not recorded — never "tamper", never "verified"; and
 *     no signatures.
 *
 * Rows written before the public route recorded the hash are not backfilled
 * (founder-gated, and a hash computed later would describe later content);
 * the not-recorded state is how they read, permanently.
 *
 * idempotent: true — db, storage, auth and signing tokens are mocked; the two
 * route registrars, the renderer and the integrity module are real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const ORG_ID = 42;
const DOC_ID = 7;

const H = vi.hoisted(() => {
  const OPERATOR_EMAIL = "olive@example.com";
  const tables: Record<string, any[]> = {};
  const tableName = (t: any) => t?.[Symbol.for("drizzle:Name")] ?? "";
  const snakeToCamel = (s: string) => s.replace(/_([a-z])/g, (_m, c: string) => c.toUpperCase());

  /** (column, value) pairs out of a drizzle eq()/and() predicate, so the mock filters like SQL. */
  const eqPairs = (node: any, pairs: Array<{ column: string; value: unknown }> = []) => {
    if (!node || typeof node !== "object") return pairs;
    let pending: string | null = null;
    for (const chunk of Array.isArray(node.queryChunks) ? node.queryChunks : []) {
      if (!chunk || typeof chunk !== "object") continue;
      if (Array.isArray(chunk.queryChunks)) {
        eqPairs(chunk, pairs);
        continue;
      }
      if (typeof chunk.name === "string" && chunk.table !== undefined) {
        pending = chunk.name;
        continue;
      }
      if ("encoder" in chunk && "value" in chunk && pending !== null) {
        pairs.push({ column: pending, value: chunk.value });
        pending = null;
      }
    }
    return pairs;
  };
  const matching = (rows: any[], where: any) => {
    if (!where) return rows;
    const pairs = eqPairs(where);
    return rows.filter((r) => pairs.every((p) => r[snakeToCamel(p.column)] === p.value));
  };

  const dbMock: any = {
    select: () => ({
      from: (table: any) => {
        const ctx: { where?: any } = {};
        const chain = (): any => ({
          where: (w: any) => {
            ctx.where = w;
            return chain();
          },
          orderBy: () => chain(),
          limit: () => chain(),
          then: (onF: any, onR: any) =>
            Promise.resolve(matching(tables[tableName(table)] ?? [], ctx.where).map((r) => ({ ...r }))).then(onF, onR),
        });
        return chain();
      },
    }),
  };

  let nextSignatureId = 1;
  let clockMs = Date.UTC(2026, 10, 8, 15, 0, 0);
  const storageMock: any = {
    getGeneratedDocument: vi.fn(async (orgId: number, id: number) => {
      const doc = (tables.generated_documents ?? []).find((d) => d.id === Number(id) && d.organizationId === orgId);
      return doc ? { ...doc } : undefined;
    }),
    createSignature: vi.fn(async (sig: any) => {
      // As the real insert: a field the writer leaves out lands as NULL.
      const at = new Date((clockMs += 1000));
      const row = { id: nextSignatureId++, signedAt: at, createdAt: at, ...sig, documentContentHash: sig.documentContentHash ?? null };
      (tables.signatures ??= []).push(row);
      return { ...row };
    }),
    getSignatures: vi.fn(async (orgId: number, documentId?: number) =>
      (tables.signatures ?? []).filter((r) => r.organizationId === orgId && (documentId === undefined || r.documentId === documentId)),
    ),
    getDocumentSignatures: vi.fn(async (orgId: number, documentId: number) =>
      (tables.signatures ?? []).filter((r) => r.organizationId === orgId && r.documentId === documentId),
    ),
    updateGeneratedDocument: vi.fn(async (id: number, patch: any) => {
      const doc = (tables.generated_documents ?? []).find((d) => d.id === id);
      if (doc) Object.assign(doc, patch);
      return doc ? { ...doc } : undefined;
    }),
  };

  const reset = () => {
    for (const k of Object.keys(tables)) delete tables[k];
    nextSignatureId = 1;
  };
  return { OPERATOR_EMAIL, tables, dbMock, storageMock, reset };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/services/signingTokens", () => ({
  verifySigningToken: (_docId: number, _signerId: string, token: string) => token === "valid",
  makeSigningToken: () => "valid",
}));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "7", email: H.OPERATOR_EMAIL };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: 42, name: "Test Org" };
    next();
  },
}));

import { registerPublicSignRoutes } from "../../server/routes-public-sign";
import { registerDocSystemRoutes } from "../../server/routes-doc-system";
import { generateSealedDocumentPdf } from "../../server/services/esign/sealedDocumentPdf";
import { assessDocumentIntegrity, hashDocumentContent } from "../../server/services/esign/contentIntegrity";
import { ESIGN_DISCLOSURE_VERSION } from "@shared/schema";

// This file parses every source file under server/, shared/ and scripts/ that
// names a signature. Under the coverage run that does not fit the suite's 30s
// default, and a killed gate reports nothing about what it guards.
vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const app = express();
app.use(express.json());
registerPublicSignRoutes(app);
registerDocSystemRoutes(app);

// Non-ASCII, HTML and a trailing newline: a writer or reader that hashed a
// derived form (plain text, trimmed, re-encoded) would disagree on this.
const CONTENT =
  "<h1>Purchase Agreement</h1>\n<p>Señora Ada Ñúñez conveys 10½ acres “as is” — parcel 071-012.00.</p>\n";
const SELLER = { id: "s-1", name: "Ada Seller", email: "ada@example.com", role: "seller", order: 1 };
const BUYER = { id: "s-2", name: "Bo Buyer", email: "bo@example.com", role: "buyer", order: 2 };

/** Independent of the module under test, on purpose. */
const sha256 = (s: string) => crypto.createHash("sha256").update(Buffer.from(s, "utf8")).digest("hex");

function seedDoc(content: string | null = CONTENT) {
  H.tables.organizations = [{ id: ORG_ID, name: "Test Org" }];
  H.tables.generated_documents = [
    {
      id: DOC_ID,
      organizationId: ORG_ID,
      name: "Purchase Agreement",
      type: "purchase_agreement",
      content,
      variables: {},
      status: "pending_signature",
      expiresAt: null,
      completedAt: null,
      signers: [{ ...SELLER }, { ...BUYER }],
    },
  ];
}

/** The row the public route used to write: everything but the hash. */
function seedLegacyCounterpartySignature(signer = SELLER) {
  (H.tables.signatures ??= []).push({
    id: 900 + (H.tables.signatures?.length ?? 0),
    organizationId: ORG_ID,
    documentId: DOC_ID,
    signerName: signer.name,
    signerEmail: signer.email,
    signerRole: signer.role,
    signatureData: signer.name,
    signatureType: "typed",
    ipAddress: "203.0.113.9",
    userAgent: "legacy-agent",
    consentGiven: true,
    consentText: "I agree that this electronic signature is legally binding.",
    documentContentHash: null,
    signedAt: new Date(Date.UTC(2026, 9, 1)),
    createdAt: new Date(Date.UTC(2026, 9, 1)),
  });
}

async function counterpartySigns(signer = BUYER) {
  (H.tables.signing_consent_audit ??= []).push({
    id: (H.tables.signing_consent_audit?.length ?? 0) + 1,
    organizationId: ORG_ID,
    documentId: DOC_ID,
    signerEmail: signer.email,
    disclosureVersion: ESIGN_DISCLOSURE_VERSION,
    consentedAt: new Date(),
  });
  const res = await request(app)
    .post(`/api/public/sign/${DOC_ID}`)
    .send({ s: signer.id, t: "valid", signatureData: signer.name, signatureType: "typed", consentGiven: true });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

async function operatorSignsOwn() {
  const res = await request(app).post("/api/signatures").send({
    documentId: DOC_ID,
    signerName: "Olive Operator",
    signerEmail: H.OPERATOR_EMAIL,
    signerRole: "seller",
    signatureData: "Olive Operator",
    signatureType: "typed",
  });
  expect(res.status, JSON.stringify(res.body)).toBe(200);
}

function writtenOnce() {
  // Per-member vacuity: a writer that wrote nothing has recorded no hash and
  // must not pass for one that recorded the right one.
  expect(H.storageMock.createSignature).toHaveBeenCalledTimes(1);
  return H.storageMock.createSignature.mock.calls[0][0];
}

const binary = (res: any, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on("data", (c: Buffer) => chunks.push(c));
  res.on("end", () => cb(null, Buffer.concat(chunks)));
};

async function pdfText(pdf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getText()).text.replace(/\s+/g, " ");
  } finally {
    await parser.destroy();
  }
}

/** Everything a downloader or auditor can read about the document's integrity. */
async function readSurfaces() {
  const cert = await request(app).get(`/api/generated-documents/${DOC_ID}/completion-certificate`);
  expect(cert.status, JSON.stringify(cert.body)).toBe(200);
  const sealed = await request(app).get(`/api/generated-documents/${DOC_ID}/sealed-pdf`).buffer(true).parse(binary);
  expect(sealed.status).toBe(200);
  expect(sealed.headers["content-type"]).toContain("application/pdf");
  return {
    cert: cert.body,
    verifiedHeader: sealed.headers["x-document-integrity-verified"],
    statusHeader: sealed.headers["x-document-integrity-status"],
    text: await pdfText(sealed.body as Buffer),
  };
}

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
  seedDoc();
});

// ═══════════════════════════════════════════════════════════════════════════
// 1. The writer population
// ═══════════════════════════════════════════════════════════════════════════

const ROOT = path.resolve(__dirname, "../..");
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete", "all"]);
const RAW_SQL_ON_SIGNATURES = /\b(?:insert\s+into|update|delete\s+from)\s+"?signatures"?(?=[\s(;"'`]|$)/i;

/** The route a node is registered under, else its nearest named function. */
function unitOf(node: ts.Node, sf: ts.SourceFile): string {
  for (let p = node.parent; p; p = p.parent) {
    if (ts.isCallExpression(p) && ts.isPropertyAccessExpression(p.expression) && ROUTE_METHODS.has(p.expression.name.text)) {
      const first = p.arguments[0];
      if (first && ts.isStringLiteralLike(first) && first.text.startsWith("/")) {
        return `${p.expression.name.text.toUpperCase()} ${first.text}`;
      }
    }
  }
  for (let p = node.parent; p; p = p.parent) {
    if ((ts.isFunctionDeclaration(p) || ts.isMethodDeclaration(p)) && p.name) return p.name.getText(sf);
    if (
      (ts.isPropertyAssignment(p) || ts.isVariableDeclaration(p)) &&
      p.initializer &&
      (ts.isArrowFunction(p.initializer) || ts.isFunctionExpression(p.initializer))
    ) {
      return p.name.getText(sf);
    }
  }
  return "<module>";
}

interface WriterSites {
  calls: string[];
  inserts: string[];
  mutations: string[];
  rawSql: string[];
}

/**
 * Parse one source file and report every place that can write a signature row.
 * Table references are resolved through the file's own bindings (named import,
 * alias, namespace, dynamic import or require destructuring of a schema
 * module), so a local variable that merely shares the name is not counted.
 */
function writerSites(rel: string, src: string): WriterSites {
  const kind = /\.(c|m)?ts$/.test(rel) ? ts.ScriptKind.TS : ts.ScriptKind.JS;
  const sf = ts.createSourceFile(rel, src, ts.ScriptTarget.Latest, true, kind);
  const isSchema = (spec: string) => /schema/.test(spec);
  const tableBindings = new Set<string>();
  const namespaces = new Set<string>();

  const bind = (n: ts.Node) => {
    if (ts.isImportDeclaration(n) && ts.isStringLiteral(n.moduleSpecifier) && isSchema(n.moduleSpecifier.text)) {
      const nb = n.importClause?.namedBindings;
      if (nb && ts.isNamespaceImport(nb)) namespaces.add(nb.name.text);
      if (nb && ts.isNamedImports(nb)) {
        for (const el of nb.elements) if ((el.propertyName ?? el.name).text === "signatures") tableBindings.add(el.name.text);
      }
    }
    if (ts.isVariableDeclaration(n) && n.initializer && ts.isObjectBindingPattern(n.name)) {
      const init = ts.isAwaitExpression(n.initializer) ? n.initializer.expression : n.initializer;
      const fromSchema =
        ts.isCallExpression(init) &&
        init.arguments.length > 0 &&
        ts.isStringLiteralLike(init.arguments[0]) &&
        isSchema(init.arguments[0].text) &&
        (init.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(init.expression) && init.expression.text === "require"));
      if (fromSchema) {
        for (const el of n.name.elements) {
          const prop = el.propertyName && ts.isIdentifier(el.propertyName) ? el.propertyName.text : el.name.getText(sf);
          if (prop === "signatures" && ts.isIdentifier(el.name)) tableBindings.add(el.name.text);
        }
      }
    }
    ts.forEachChild(n, bind);
  };
  bind(sf);

  const isTable = (e: ts.Expression | undefined) =>
    !!e &&
    ((ts.isIdentifier(e) && tableBindings.has(e.text)) ||
      (ts.isPropertyAccessExpression(e) &&
        e.name.text === "signatures" &&
        ts.isIdentifier(e.expression) &&
        namespaces.has(e.expression.text)));

  const out: WriterSites = { calls: [], inserts: [], mutations: [], rawSql: [] };
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n)) {
      const callee = n.expression;
      const name = ts.isPropertyAccessExpression(callee)
        ? callee.name.text
        : ts.isIdentifier(callee)
          ? callee.text
          : ts.isElementAccessExpression(callee) && ts.isStringLiteralLike(callee.argumentExpression)
            ? callee.argumentExpression.text
            : null;
      if (name === "createSignature") out.calls.push(`${rel}::${unitOf(n, sf)}`);
      if (name === "insert" && isTable(n.arguments[0])) out.inserts.push(`${rel}::${unitOf(n, sf)}`);
      if ((name === "update" || name === "delete") && isTable(n.arguments[0])) {
        out.mutations.push(`${rel}::${unitOf(n, sf)}`);
      }
    }
    if ((ts.isStringLiteralLike(n) || ts.isTemplateExpression(n)) && RAW_SQL_ON_SIGNATURES.test(n.getText(sf))) {
      out.rawSql.push(`${rel}::${unitOf(n, sf)}`);
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
}

/**
 * The population: every non-test source file under server/, shared/ and
 * scripts/. Only files that contain "signature" (any case) are parsed — a
 * writer must name the method or the table to reach it, so the prefilter can
 * only over-include. It is a cost cut, not a predicate.
 */
function scanRepository() {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.isSymbolicLink()) continue;
      const abs = path.join(dir, e.name);
      if (e.isDirectory()) walk(abs);
      else if (/\.(c|m)?(ts|js)$/.test(e.name) && !/\.(test|spec)\./.test(e.name) && !e.name.endsWith(".d.ts")) {
        files.push(abs);
      }
    }
  };
  for (const dir of ["server", "shared", "scripts"]) walk(path.join(ROOT, dir));
  const all: WriterSites = { calls: [], inserts: [], mutations: [], rawSql: [] };
  let parsed = 0;
  for (const abs of files) {
    const src = fs.readFileSync(abs, "utf8");
    if (!/signature/i.test(src)) continue;
    parsed += 1;
    const sites = writerSites(path.relative(ROOT, abs).split(path.sep).join("/"), src);
    for (const k of Object.keys(all) as Array<keyof WriterSites>) all[k].push(...sites[k]);
  }
  return { filesRead: files.length, filesParsed: parsed, ...all };
}

/** Every route that records a signature, and how to drive it. */
const SIGNATURE_WRITERS: Record<string, () => Promise<void>> = {
  "server/routes-doc-system.ts::POST /api/signatures": operatorSignsOwn,
  "server/routes-public-sign.ts::POST /api/public/sign/:docId": () => counterpartySigns(BUYER),
};
/** The single raw insert: the storage method every writer above calls. */
const RAW_INSERTS = ["server/storage/documentsRepo.ts::createSignature"];

let scanned: ReturnType<typeof scanRepository> | null = null;
/** Run inside a test, under its declared budget — not at collection time. */
const scan = () => (scanned ??= scanRepository());

describe("every signature writer records the content hash at signing", () => {
  it("vacuity: the scan read the tree and parsed the files that hold the writers", () => {
    // Measured 2026-11-08: 2,028 files read, 134 parsed.
    expect(scan().filesRead, "read almost no source files — the walk is broken").toBeGreaterThan(1500);
    expect(scan().filesParsed, "parsed far fewer candidate files than exist — the prefilter is broken").toBeGreaterThan(100);
  });

  it("the createSignature call sites are exactly the registered writers", () => {
    expect(
      [...scan().calls].sort(),
      "A signature writer was added or moved. Drive it in SIGNATURE_WRITERS so this suite proves it " +
        "records hashDocumentContent(content) — a row without the hash can never be verified.",
    ).toEqual(Object.keys(SIGNATURE_WRITERS).sort());
  });

  it("the only raw insert into signatures is the storage method, and nothing updates, deletes or raw-writes a row", () => {
    expect([...scan().inserts].sort()).toEqual(RAW_INSERTS);
    // A path that rewrites a recorded row could rewrite its hash to match
    // changed content, which would turn a tamper finding into "verified".
    expect(scan().mutations, "something updates or deletes signature rows").toEqual([]);
    expect(scan().rawSql, "raw SQL writes the signatures table").toEqual([]);
  });

  it.each(Object.keys(SIGNATURE_WRITERS))("%s records SHA-256 of the content it signed", async (writer) => {
    await SIGNATURE_WRITERS[writer]();
    const written = writtenOnce();
    expect(written.documentId).toBe(DOC_ID);
    expect(written.documentContentHash).toBe(sha256(CONTENT));
  });

  it("like with like: both writers store one hash for one content, and the renderer recomputes it", async () => {
    const hashes: string[] = [];
    for (const writer of Object.keys(SIGNATURE_WRITERS)) {
      H.reset();
      vi.clearAllMocks();
      seedDoc();
      await SIGNATURE_WRITERS[writer]();
      hashes.push(writtenOnce().documentContentHash);
    }
    expect(new Set(hashes).size).toBe(1);
    expect(hashes[0]).toBe(sha256(CONTENT));
    const sealed = await generateSealedDocumentPdf({ organizationId: ORG_ID, documentId: DOC_ID });
    expect(sealed.contentSha256).toBe(hashes[0]);
    expect(sealed.integrityStatus).toBe("verified");
    expect(sealed.allHashesMatch).toBe(true);
  });

  describe("canaries — the scan still reads each shape it relies on", () => {
    it("a call inside a nested callback is attributed to the route that registers it", () => {
      const sites = writerSites(
        "server/x.ts",
        `app.post("/api/x/:id", async (req, res) => {
           await db.transaction(async (tx) => { await storage.createSignature({ documentId: 1 }); });
         });`,
      );
      expect(sites.calls).toEqual(["server/x.ts::POST /api/x/:id"]);
    });

    it("a commented-out call, and a mention in a string, are not calls", () => {
      const sites = writerSites(
        "server/x.ts",
        `// storage.createSignature({ documentId: 1 });
         /* await storage.createSignature(x); */
         const note = "storage.createSignature( is the writer";`,
      );
      expect(sites.calls).toEqual([]);
    });

    it("a destructured or bracket-accessed call is still a call", () => {
      const sites = writerSites(
        "server/x.ts",
        `export async function f() { const { createSignature } = storage; await createSignature(x); }
         export async function g() { await storage["createSignature"](x); }`,
      );
      expect(sites.calls).toEqual(["server/x.ts::f", "server/x.ts::g"]);
    });

    it("the table is found through an alias, a namespace, a dynamic import and require", () => {
      const sites = writerSites(
        "server/x.ts",
        `import { signatures as sigT } from "@shared/schema";
         import * as schema from "../shared/schema";
         export async function a(tx) { await tx.insert(sigT).values({}); }
         export async function b() { await db.update(schema.signatures).set({}); }
         export async function c() { const { signatures: t } = await import("@shared/schema"); await db.delete(t); }
         export function d() { const { signatures } = require("../shared/schema"); return db.insert(signatures); }`,
      );
      expect(sites.inserts).toEqual(["server/x.ts::a", "server/x.ts::d"]);
      expect(sites.mutations).toEqual(["server/x.ts::b", "server/x.ts::c"]);
    });

    it("a local variable that only shares the table's name is not the table", () => {
      const sites = writerSites(
        "server/x.ts",
        `export async function f() { const signatures = await storage.getSignatures(1); await queue.insert(signatures); }`,
      );
      expect(sites.inserts).toEqual([]);
    });

    it("raw SQL in a plain string or a tagged template is found, a different table is not", () => {
      const sites = writerSites(
        "scripts/x.mjs",
        "export function f() { return db.execute(sql`INSERT INTO \"signatures\" (a) VALUES (${1})`); }\n" +
          "export function g() { return pool.query('update signatures set document_content_hash = $1'); }\n" +
          "export function h() { return pool.query('INSERT INTO signatures_archive (a) VALUES (1)'); }",
      );
      expect(sites.rawSql).toEqual(["scripts/x.mjs::f", "scripts/x.mjs::g"]);
    });
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// 2. The four states, on every surface that states them
// ═══════════════════════════════════════════════════════════════════════════

describe("the sealed PDF, its headers and the completion certificate say which state a document is in", () => {
  it("VERIFIED: a counterparty signs and nothing changes", async () => {
    await counterpartySigns(BUYER);
    const s = await readSurfaces();

    expect(s.text).toContain("VERIFIED — the document content matches the hash captured by every signature");
    expect(s.text).toContain("Matches the current content");
    expect(s.text).not.toContain("TAMPER WARNING");
    expect(s.text).not.toMatch(/not recorded at signing/i);
    expect(s.verifiedHeader).toBe("true");
    expect(s.statusHeader).toBe("verified");

    expect(s.cert.integrityStatus).toBe("verified");
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBe(true);
    expect(s.cert.signatures).toHaveLength(1);
    expect(s.cert.signatures[0]).toMatchObject({
      capturedContentHash: sha256(CONTENT),
      currentContentHash: sha256(CONTENT),
      integrity: "match",
      hashMatchesNow: true,
    });
    // One statement, one wording: the certificate says what the PDF prints.
    expect(s.text).toContain(s.cert.integrityStatement);
  });

  it("TAMPER WARNING: the content changes after a recorded hash — the only state that says tamper", async () => {
    await counterpartySigns(BUYER);
    // A change the route guard and the DB trigger exist to prevent, made here
    // directly so the check behind them is exercised.
    H.tables.generated_documents[0].content = CONTENT + "<p>Amended after signing.</p>";
    const s = await readSurfaces();

    expect(s.text).toContain("TAMPER WARNING — the document content no longer matches the hash captured at signing");
    expect(s.text).toContain("(1 of 1 signature)");
    expect(s.text).toContain("Does not match the current content");
    expect(s.text).not.toContain("VERIFIED");
    expect(s.verifiedHeader).toBe("false");
    expect(s.statusHeader).toBe("mismatch");

    expect(s.cert.integrityStatus).toBe("mismatch");
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBe(false);
    expect(s.cert.signatures[0]).toMatchObject({ integrity: "mismatch", hashMatchesNow: false });
    expect(s.text).toContain(s.cert.integrityStatement);
  });

  it("NOT RECORDED: a signature without a hash is neither tampered nor verified", async () => {
    seedLegacyCounterpartySignature(SELLER);
    const s = await readSurfaces();

    expect(s.text).toContain("INTEGRITY HASH NOT RECORDED AT SIGNING — 1 of 1 signature recorded no content hash");
    expect(s.text).toContain("Not recorded at signing");
    expect(s.text).toContain("Cannot be checked: no hash was recorded at signing");
    expect(s.text).not.toMatch(/tamper/i);
    expect(s.text).not.toMatch(/\bverified\b/i);
    // "Verified: false" is literally true here; the status header says why.
    expect(s.verifiedHeader).toBe("false");
    expect(s.statusHeader).toBe("not_recorded");

    expect(s.cert.integrityStatus).toBe("not_recorded");
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBeNull();
    expect(s.cert.signatures[0]).toMatchObject({
      capturedContentHash: null,
      integrity: "not_recorded",
      hashMatchesNow: null,
    });
    expect(s.cert.integrityStatement).toMatch(/not recorded at signing/i);
    expect(s.cert.integrityStatement).not.toMatch(/tamper|verified/i);
    expect(s.text).toContain(s.cert.integrityStatement);
  });

  it("NOT RECORDED outranks a match: one old row without a hash and one new row with it", async () => {
    seedLegacyCounterpartySignature(SELLER);
    await counterpartySigns(BUYER);
    const s = await readSurfaces();

    expect(s.text).toContain("1 of 2 signatures recorded no content hash");
    expect(s.text).toContain("1 other signature matches the current content");
    expect(s.text).not.toMatch(/tamper/i);
    expect(s.text).not.toMatch(/\bverified\b/i);
    expect(s.statusHeader).toBe("not_recorded");
    expect(s.verifiedHeader).toBe("false");

    expect(s.cert.integrityStatus).toBe("not_recorded");
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBeNull();
    expect(s.cert.signatures.map((x: any) => [x.signerEmail, x.integrity, x.hashMatchesNow])).toEqual([
      [SELLER.email, "not_recorded", null],
      [BUYER.email, "match", true],
    ]);
  });

  it("a real mismatch outranks a missing hash", async () => {
    seedLegacyCounterpartySignature(SELLER);
    await counterpartySigns(BUYER);
    H.tables.generated_documents[0].content = CONTENT.replace("10½", "1½");
    const s = await readSurfaces();

    expect(s.text).toContain("TAMPER WARNING");
    expect(s.text).toContain("(1 of 2 signatures)");
    expect(s.statusHeader).toBe("mismatch");
    expect(s.cert.integrityStatus).toBe("mismatch");
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBe(false);
    expect(s.cert.signatures.map((x: any) => x.integrity)).toEqual(["not_recorded", "mismatch"]);
  });

  it("NO SIGNATURES: nothing to verify, and no verdict either way", async () => {
    const s = await readSurfaces();

    expect(s.text).toContain("No signatures to verify.");
    expect(s.text).not.toMatch(/tamper/i);
    expect(s.verifiedHeader).toBe("false");
    expect(s.statusHeader).toBe("no_signatures");
    expect(s.cert.integrityStatus).toBe("no_signatures");
    // Was `false`; with nothing to compare there is no answer, and `false` is
    // reserved for a real mismatch.
    expect(s.cert.allSignatureHashesMatchCurrentContent).toBeNull();
  });
});

describe("the verdict itself", () => {
  it("no content means no hash; a recorded hash against removed content is a real mismatch", () => {
    expect(hashDocumentContent(null)).toBeNull();
    expect(hashDocumentContent("")).toBeNull();
    expect(hashDocumentContent(CONTENT)).toBe(sha256(CONTENT));
    expect(assessDocumentIntegrity(null, [{ documentContentHash: sha256(CONTENT) }]).status).toBe("mismatch");
    expect(assessDocumentIntegrity(CONTENT, [{ documentContentHash: null }]).status).toBe("not_recorded");
    expect(assessDocumentIntegrity(CONTENT, []).status).toBe("no_signatures");
  });
});
