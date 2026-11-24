/**
 * A signature is written, and read back, only under the caller's organization.
 *
 * ── WHAT THIS PINS ──────────────────────────────────────────────────────────
 *  1. THE WRITE. `POST /api/signatures` resolves `documentId` under the
 *     caller's organization before it writes anything. A document id that is
 *     not one of the caller's documents is refused with 404 ("Document"), and
 *     no signature row is written. A document of the caller's own still signs.
 *  2. THE READS. Every reader of the `signatures` table that serves a document
 *     filters by `signatures.organization_id` (the table's own NOT NULL tenant
 *     column). A row carrying another organization's id never appears on the
 *     document's sealed PDF (rendered bytes read back with pdf-parse, plus the
 *     result's signatureCount and the route's integrity header) or on its
 *     completion certificate. The certificate is driven through the REAL
 *     storage method (documentsRepo), not a mock that filters for it.
 *  3. THE READER POPULATION. Every `.from(signatures…)` in server/ is found by
 *     PARSING (comments are never visited) and must be a member of the
 *     register below, each of which is exercised here; a new reader is the
 *     thing that fails.
 *
 * idempotent: true — db, auth and org middleware are mocked with an in-memory
 * table store whose select() filters by the eq() pairs of the real predicate;
 * the route registrar, the renderer and the storage read are real.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

const ORG_A = 42;
const ORG_B = 99;
const DOC_A = 5;
const DOC_B = 7;

const H = vi.hoisted(() => {
  const tables: Record<string, any[]> = {};
  const state = { orgId: 42, email: "olive@example.com" };
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
  const real: { repo?: any } = {};
  const storageMock: any = {
    getGeneratedDocument: vi.fn(async (orgId: number, id: number) => {
      const doc = (tables.generated_documents ?? []).find((d) => d.id === Number(id) && d.organizationId === orgId);
      return doc ? { ...doc } : undefined;
    }),
    createSignature: vi.fn(async (sig: any) => {
      const at = new Date(Date.UTC(2026, 10, 9, 12, 0, nextSignatureId));
      const row = { id: nextSignatureId++, signedAt: at, createdAt: at, documentContentHash: null, ...sig };
      (tables.signatures ??= []).push(row);
      return { ...row };
    }),
    // The real storage reads, over the same in-memory store — so a read that
    // drops its org predicate is caught here rather than agreed with by a mock.
    getSignatures: vi.fn((orgId: number, documentId?: number) => real.repo.getSignatures.call({}, orgId, documentId)),
    getDocumentSignatures: vi.fn((orgId: number, documentId: number) =>
      real.repo.getDocumentSignatures.call({}, orgId, documentId),
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
  return { tables, state, dbMock, storageMock, real, reset };
});

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/db", () => ({ db: H.dbMock }));
vi.mock("../../server/storage", () => ({ storage: H.storageMock, db: H.dbMock }));
vi.mock("../../server/middleware/idempotency", () => ({
  idempotencyMiddleware: (_req: any, _res: any, next: any) => next(),
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: any, _res: any, next: any) => {
    req.user = { id: "7", email: H.state.email };
    next();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: any, _res: any, next: any) => {
    req.organization = { id: H.state.orgId, name: `Org ${H.state.orgId}` };
    next();
  },
}));

import { documentsRepo } from "../../server/storage/documentsRepo";
import { registerDocSystemRoutes } from "../../server/routes-doc-system";
import { generateSealedDocumentPdf } from "../../server/services/esign/sealedDocumentPdf";

H.real.repo = documentsRepo;

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const app = express();
app.use(express.json());
registerDocSystemRoutes(app);

const FOREIGN_SIGNER = "Zed Foreignorg";
const OWN_SIGNER = "Bea Ownorg";

function seed() {
  H.tables.organizations = [
    { id: ORG_A, name: "Org A" },
    { id: ORG_B, name: "Org B" },
  ];
  const doc = (id: number, organizationId: number) => ({
    id,
    organizationId,
    name: `Agreement ${id}`,
    type: "purchase_agreement",
    content: `<p>Agreement ${id}</p>`,
    variables: {},
    status: "pending_signature",
    expiresAt: null,
    completedAt: null,
    signers: [],
  });
  H.tables.generated_documents = [doc(DOC_A, ORG_A), doc(DOC_B, ORG_B)];
}

function sigRow(id: number, organizationId: number, documentId: number, signerName: string) {
  const at = new Date(Date.UTC(2026, 9, 1, 0, 0, id));
  return {
    id,
    organizationId,
    documentId,
    signerName,
    signerEmail: `${signerName.split(" ")[0].toLowerCase()}@example.com`,
    signerRole: "signer",
    signatureData: signerName,
    signatureType: "typed",
    ipAddress: null,
    userAgent: null,
    consentGiven: true,
    consentText: "I agree.",
    documentContentHash: null,
    signedAt: at,
    createdAt: at,
  };
}

async function pdfText(pdf: Buffer): Promise<string> {
  const { PDFParse } = await import("pdf-parse");
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

beforeEach(() => {
  H.reset();
  vi.clearAllMocks();
  H.state.orgId = ORG_A;
  seed();
});

describe("POST /api/signatures resolves the document under the caller's organization", () => {
  const body = (documentId: number) => ({
    documentId,
    signerName: "Olive Operator",
    signerEmail: H.state.email,
    signatureData: "Olive Operator",
    signatureType: "typed",
  });

  it("refuses a document id that belongs to another organization, and writes nothing", async () => {
    const res = await request(app).post("/api/signatures").send(body(DOC_B));
    expect(res.status, JSON.stringify(res.body)).toBe(404);
    expect(res.body.message).toMatch(/Document/);
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
    expect(H.tables.signatures ?? []).toHaveLength(0);
    expect(H.tables.generated_documents.find((d) => d.id === DOC_B)?.status).toBe("pending_signature");
  });

  it("refuses a document id that exists nowhere", async () => {
    const res = await request(app).post("/api/signatures").send(body(12345));
    expect(res.status).toBe(404);
    expect(H.storageMock.createSignature).not.toHaveBeenCalled();
  });

  it("still records the signed-in user's signature on a document of their own organization", async () => {
    const res = await request(app).post("/api/signatures").send(body(DOC_A));
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(H.storageMock.createSignature).toHaveBeenCalledTimes(1);
    const written = H.storageMock.createSignature.mock.calls[0][0];
    expect(written.organizationId).toBe(ORG_A);
    expect(written.documentId).toBe(DOC_A);
  });
});

describe("signature reads serve only the document's own organization's rows", () => {
  beforeEach(() => {
    // One row of the document's own org, and one carrying another org's id
    // against the same document id (a row the old write path could produce).
    H.tables.signatures = [sigRow(501, ORG_A, DOC_B, FOREIGN_SIGNER), sigRow(502, ORG_B, DOC_B, OWN_SIGNER)];
    H.state.orgId = ORG_B;
  });

  it("the sealed PDF renderer omits a row of another organization", async () => {
    const sealed = await generateSealedDocumentPdf({ organizationId: ORG_B, documentId: DOC_B });
    expect(sealed.signatureCount).toBe(1);
    const text = await pdfText(sealed.pdf);
    // Vacuity: the renderer did print signer names, so absence below is real.
    expect(text).toContain(OWN_SIGNER);
    expect(text).not.toContain(FOREIGN_SIGNER);
  });

  it("the sealed-pdf route serves the same scoped artifact", async () => {
    const res = await request(app)
      .get(`/api/generated-documents/${DOC_B}/sealed-pdf`)
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on("data", (c: Buffer) => chunks.push(c));
        r.on("end", () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const text = await pdfText(res.body as Buffer);
    expect(text).toContain(OWN_SIGNER);
    expect(text).not.toContain(FOREIGN_SIGNER);
  });

  it("the completion certificate omits a row of another organization (real storage read)", async () => {
    const res = await request(app).get(`/api/generated-documents/${DOC_B}/completion-certificate`);
    expect(res.status, JSON.stringify(res.body)).toBe(200);
    expect(res.body.signatureCount).toBe(1);
    const names = (res.body.signatures as any[]).map((s) => s.signerName);
    expect(names).toEqual([OWN_SIGNER]);
  });

  it("the document's signature list omits a row of another organization (real storage read)", async () => {
    const res = await request(app).get(`/api/generated-documents/${DOC_B}/signatures`);
    expect(res.status).toBe(200);
    expect((res.body as any[]).map((s) => s.signerName)).toEqual([OWN_SIGNER]);
    const list = await request(app).get(`/api/signatures?documentId=${DOC_B}`);
    expect((list.body as any[]).map((s) => s.signerName)).toEqual([OWN_SIGNER]);
  });

  it("a signature of another organization is not found by id (real storage read)", async () => {
    H.storageMock.getSignature = vi.fn((orgId: number, id: number) => H.real.repo.getSignature.call({}, orgId, id));
    expect((await request(app).get(`/api/signatures/501`)).status).toBe(404);
    const own = await request(app).get(`/api/signatures/502`);
    expect(own.status).toBe(200);
    expect(own.body.signerName).toBe(OWN_SIGNER);
  });
});

describe("the population of signature readers", () => {
  // Every `.from(<signatures table>)` call in server/, by file and enclosing
  // function. Each member is exercised by a test above.
  const REGISTER = new Set([
    "server/storage/documentsRepo.ts#getSignatures",
    "server/storage/documentsRepo.ts#getSignature",
    "server/storage/documentsRepo.ts#getDocumentSignatures",
    "server/services/esign/sealedDocumentPdf.ts#generateSealedDocumentPdf",
  ]);

  function walk(dir: string, out: string[] = []): string[] {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.name === "node_modules" || e.name.startsWith(".")) continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p, out);
      else if (/\.(ts|tsx|mts)$/.test(e.name) && !e.name.endsWith(".d.ts")) out.push(p);
    }
    return out;
  }

  function enclosingName(node: ts.Node): string {
    for (let n: ts.Node | undefined = node.parent; n; n = n.parent) {
      if ((ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n)) && n.name) return n.name.getText();
      if (ts.isPropertyAssignment(n) && (ts.isFunctionExpression(n.initializer) || ts.isArrowFunction(n.initializer)))
        return n.name.getText();
      if (ts.isVariableDeclaration(n) && n.initializer && (ts.isArrowFunction(n.initializer) || ts.isFunctionExpression(n.initializer)))
        return n.name.getText();
    }
    return "<module>";
  }

  it("every reader is registered, and the scan still sees each registered one", () => {
    const root = path.resolve(__dirname, "../..");
    const found = new Set<string>();
    for (const file of walk(path.join(root, "server"))) {
      const src = fs.readFileSync(file, "utf8");
      if (!/signatures/.test(src)) continue;
      // Local names the schema's `signatures` table is imported under.
      const sf = ts.createSourceFile(file, src, ts.ScriptTarget.Latest, true);
      const aliases = new Set<string>();
      sf.forEachChild((n) => {
        if (!ts.isImportDeclaration(n) || !ts.isStringLiteral(n.moduleSpecifier)) return;
        if (!/(@shared\/schema|shared\/schema)$/.test(n.moduleSpecifier.text)) return;
        const named = n.importClause?.namedBindings;
        if (named && ts.isNamedImports(named))
          for (const el of named.elements)
            if ((el.propertyName ?? el.name).text === "signatures") aliases.add(el.name.text);
      });
      if (aliases.size === 0) continue;
      const rel = path.relative(root, file).split(path.sep).join("/");
      const visit = (n: ts.Node) => {
        if (
          ts.isCallExpression(n) &&
          ts.isPropertyAccessExpression(n.expression) &&
          /^(from|innerJoin|leftJoin|rightJoin|fullJoin)$/.test(n.expression.name.text) &&
          n.arguments.length > 0 &&
          ts.isIdentifier(n.arguments[0]) &&
          aliases.has(n.arguments[0].text)
        ) {
          found.add(`${rel}#${enclosingName(n)}`);
        }
        ts.forEachChild(n, visit);
      };
      visit(sf);
    }
    const unregistered = [...found].filter((k) => !REGISTER.has(k));
    expect(unregistered, "new signature reader: scope it by organization and register it here").toEqual([]);
    // Per-member vacuity: a scan that silently stopped seeing a reader would
    // otherwise read exactly like that reader having been removed.
    expect([...REGISTER].filter((k) => !found.has(k))).toEqual([]);
  });
});
