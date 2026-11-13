/**
 * Deal document store (autonomy gap §8 slice 5) — the 16-case plan of
 * docs/docstore-design-2026-11.md §10, driven against a REAL database built
 * from this repository (provisional migration 0309) and a recording S3 double.
 *
 * The acceptance story is "the title commitment arrives": a PDF is attached to
 * a deal, the bytes are kept, a row records it, it appears on the timeline, and
 * it is listable and downloadable — all org-scoped.
 *
 * WHY THE ACTING ORG IS A VARIABLE. Every cross-org case here REPLAYS a request
 * that succeeded, with `acting.orgId` swapped to the other organization — the
 * same URL, the same rows in the database, a different asker. That is the
 * semantic defect (one tenant reaching another's documents), not a symbol that
 * could be renamed away: CLAUDE.md, "a load-bearing gate must be falsified
 * against the SEMANTIC defect". Deleting the org predicate from any of the four
 * service queries turns cases 6-9 red.
 *
 * NO REAL S3 CALL IN ANY CASE. `@aws-sdk/client-s3` and
 * `@aws-sdk/s3-request-presigner` are replaced by the same recording double
 * tests/unit/documentStore.test.ts uses, extended to hold the bytes it was
 * handed so a round trip can compare them. Because it RECORDS, the two
 * "nothing was written" cases (10, 12, 13) and the "the store was never
 * reached" case (8) can assert on an empty command log rather than on the
 * absence of an error.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { realDbAvailable, useRealDb } from "../helpers/realDb";

useRealDb("dealDocuments.realdb.test.ts");

import { randomUUID } from "crypto";
import express from "express";
import request from "supertest";

// ── The acting identity: who is asking. Hoisted because the middleware mocks
// below are hoisted, and mutated per case — this object IS the org-id swap.
const acting = vi.hoisted(() => ({ orgId: 0, userId: "synthetic-docstore-user" }));

// ── The S3 seam (tests/unit/documentStore.test.ts:12-40), plus an object map so
// a download can be compared with what the upload actually handed the store.
const s3 = vi.hoisted(() => ({
  sent: [] as Array<{ kind: string; input: Record<string, unknown> }>,
  signed: [] as Array<{ input: Record<string, unknown>; expiresIn: number }>,
  objects: new Map<string, Uint8Array>(),
}));

vi.mock("@aws-sdk/client-s3", () => {
  class PutObjectCommand {
    kind = "put";
    constructor(public input: Record<string, unknown>) {}
  }
  class GetObjectCommand {
    kind = "get";
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectCommand {
    kind = "delete";
    constructor(public input: Record<string, unknown>) {}
  }
  class DeleteObjectsCommand {
    kind = "deleteMany";
    constructor(public input: Record<string, unknown>) {}
  }
  class ListObjectsV2Command {
    kind = "list";
    constructor(public input: Record<string, unknown>) {}
  }
  class S3Client {
    async send(cmd: { kind: string; input: Record<string, unknown> }) {
      s3.sent.push({ kind: cmd.kind, input: cmd.input });
      if (cmd.kind === "put") {
        const body = cmd.input.Body;
        const bytes =
          typeof body === "string"
            ? new TextEncoder().encode(body)
            : new Uint8Array(body as ArrayLike<number>);
        s3.objects.set(String(cmd.input.Key), bytes);
        return {};
      }
      if (cmd.kind === "get") {
        const stored = s3.objects.get(String(cmd.input.Key));
        if (!stored) throw Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        return { Body: { transformToByteArray: async () => stored } };
      }
      if (cmd.kind === "list") return { Contents: [], IsTruncated: false };
      return {};
    }
  }
  return {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    DeleteObjectCommand,
    DeleteObjectsCommand,
    ListObjectsV2Command,
  };
});

vi.mock("@aws-sdk/s3-request-presigner", () => ({
  getSignedUrl: async (
    _c: unknown,
    cmd: { input: Record<string, unknown> },
    opts: { expiresIn: number },
  ) => {
    s3.signed.push({ input: cmd.input, expiresIn: opts.expiresIn });
    return `https://signed.example/${String(cmd.input.Key)}`;
  },
}));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// ── The HTTP seam. `isAuthenticated` and `getOrCreateOrg` install the acting
// identity, and nothing else: the routes must take the org from the request
// context (getOrganizationId) and never from the body or the URL.
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: unknown, _res: unknown, next: () => void) => {
    (req as { user?: { id: string } }).user = { id: acting.userId };
    next();
  },
}));

vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: unknown, _res: unknown, next: () => void) => {
    const r = req as { organization?: { id: number }; organizationId?: number };
    r.organization = { id: acting.orgId };
    r.organizationId = acting.orgId;
    next();
  },
}));

// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = "acre-docs-test";
const STORAGE_ENV = ["DOCUMENTS_S3_BUCKET", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY"] as const;
const savedEnv: Record<string, string | undefined> = {};

function configureStorage(): void {
  process.env.DOCUMENTS_S3_BUCKET = BUCKET;
  process.env.AWS_ACCESS_KEY_ID = "AKIA_TEST";
  process.env.AWS_SECRET_ACCESS_KEY = "secret";
}

function unconfigureStorage(): void {
  for (const key of STORAGE_ENV) delete process.env[key];
}

/** A 9-byte PDF: the magic bytes validateFileMiddleware sniffs, and nothing else. */
const PDF_BYTES = Buffer.from("%PDF-1.7\n", "ascii");
/** PNG magic — deliberately named `.pdf` in case 12, so the gate must be the bytes. */
const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);

type Database = (typeof import("../../server/db"))["db"];
type SqlTag = (typeof import("drizzle-orm"))["sql"];
type ObjectDocumentsModule = typeof import("../../server/services/objectDocuments");

let db: Database;
let sql: SqlTag;
let app: ReturnType<typeof express>;
let kinds: ObjectDocumentsModule["DOCUMENT_OBJECT_KINDS"];
let uploadUnavailableMessage = "";
let downloadUnavailableMessage = "";

let orgA = 0;
let orgB = 0;
let dealA = 0;
let propertyA = 0;
let noteA = "";
let dealB = 0;

/** Set by case 1 and replayed by cases 4, 7, 8, 9 and 11. */
let dealDocumentId = "";
let dealPutKey = "";

/** Case 16's population record: which segment was exercised on which verb. */
const covered = new Map<string, Set<string>>();
function markCovered(segment: string, verb: "upload" | "list" | "download"): void {
  const verbs = covered.get(segment) ?? new Set<string>();
  verbs.add(verb);
  covered.set(segment, verbs);
}

async function rows<T>(query: ReturnType<SqlTag>): Promise<T[]> {
  const result = await db.execute(query);
  return (result as unknown as { rows: T[] }).rows;
}

/** The one row a query must have returned — never an index into a maybe-empty array. */
function first<T>(found: T[], what: string): T {
  const row = found[0];
  if (row === undefined) throw new Error(`expected a row: ${what}`);
  return row;
}

/** The pg error code for a statement that must be refused by the database itself. */
function codeOf(query: Promise<unknown>): Promise<string | null | undefined> {
  return query.then(
    () => null,
    (err: { code?: string; cause?: { code?: string } }) => err.code ?? err.cause?.code,
  );
}

// ── Fixtures ────────────────────────────────────────────────────────────────
// Built from information_schema rather than from a hand-written column list:
// organizations / deals / properties / acquired_notes are wide CRM tables whose
// NOT NULL set is not this slice's business, and a fixture that spells them out
// goes stale the first time one of them gains a column. Only the columns this
// test MEANS (the org link, the parent link) are named; everything else that is
// NOT NULL and has no default is filled with a synthetic, per-row-unique value.

interface ColumnMeta {
  name: string;
  dataType: string;
  udtName: string;
  nullable: boolean;
  hasDefault: boolean;
}

const columnCache = new Map<string, ColumnMeta[]>();
let fixtureCounter = 0;
const nonce = (): string => `${Date.now().toString(36)}-${(fixtureCounter += 1)}-${Math.floor(Math.random() * 1e6)}`;

async function columnsOf(table: string): Promise<ColumnMeta[]> {
  const cached = columnCache.get(table);
  if (cached) return cached;
  const found = await rows<{
    column_name: string;
    data_type: string;
    udt_name: string;
    is_nullable: string;
    column_default: string | null;
  }>(sql`SELECT column_name, data_type, udt_name, is_nullable, column_default
         FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = ${table}
         ORDER BY ordinal_position`);
  if (found.length === 0) {
    throw new Error(`fixture: table '${table}' does not exist — is the schema built from this repo?`);
  }
  const meta = found.map((row) => ({
    name: row.column_name,
    dataType: row.data_type,
    udtName: row.udt_name,
    nullable: row.is_nullable === "YES",
    hasDefault: row.column_default !== null,
  }));
  columnCache.set(table, meta);
  return meta;
}

async function syntheticValue(table: string, column: ColumnMeta, rowNonce: string): Promise<unknown> {
  switch (column.dataType) {
    case "smallint":
    case "integer":
    case "bigint":
    case "numeric":
    case "real":
    case "double precision":
      return 1;
    case "boolean":
      return false;
    case "uuid":
      return randomUUID();
    case "date":
    case "timestamp without time zone":
    case "timestamp with time zone":
      return new Date().toISOString();
    case "json":
    case "jsonb":
      return "{}";
    case "ARRAY":
      return "{}";
    case "USER-DEFINED": {
      const [label] = await rows<{ enumlabel: string }>(
        sql`SELECT e.enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
            WHERE t.typname = ${column.udtName} ORDER BY e.enumsortorder LIMIT 1`,
      );
      if (!label) {
        throw new Error(`fixture: no enum label for ${table}.${column.name} (${column.udtName})`);
      }
      return label.enumlabel;
    }
    default:
      return `SYNTHETIC-${table}-${column.name}-${rowNonce}`;
  }
}

async function insertFixture<T>(table: string, seed: Record<string, unknown>): Promise<T> {
  const meta = await columnsOf(table);
  const rowNonce = nonce();
  const values: Record<string, unknown> = {};
  for (const [name, value] of Object.entries(seed)) {
    if (meta.some((column) => column.name === name)) values[name] = value;
  }
  for (const column of meta) {
    if (column.name in values || column.nullable || column.hasDefault) continue;
    values[column.name] = await syntheticValue(table, column, rowNonce);
  }
  const names = Object.keys(values);
  const columnList = sql.join(
    names.map((name) => sql.identifier(name)),
    sql`, `,
  );
  const valueList = sql.join(
    names.map((name) => sql`${values[name]}`),
    sql`, `,
  );
  const [row] = await rows<T>(
    sql`INSERT INTO ${sql.identifier(table)} (${columnList}) VALUES (${valueList}) RETURNING *`,
  );
  if (!row) throw new Error(`fixture: insert into '${table}' returned no row`);
  return row;
}

async function countDocuments(where: ReturnType<SqlTag>): Promise<number> {
  const found = await rows<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM uploaded_documents WHERE ${where}`,
  );
  return Number(first(found, "count(*) over uploaded_documents").n);
}

/**
 * The response body as BYTES. superagent has no parser registered for
 * application/pdf, so the payload arrives as `res.text`; the fixture is ASCII,
 * so either path is lossless and the test does not depend on which one ran.
 */
function bodyBytes(res: { body?: unknown; text?: string }): Buffer {
  if (Buffer.isBuffer(res.body)) return res.body;
  return Buffer.from(res.text ?? "", "binary");
}

/** Make `orgId` the asker, then issue the request. THIS is the org-id swap. */
function as(orgId: number): ReturnType<typeof request> {
  acting.orgId = orgId;
  return request(app);
}

const puts = (): Array<{ kind: string; input: Record<string, unknown> }> =>
  s3.sent.filter((c) => c.kind === "put");
const gets = (): Array<{ kind: string; input: Record<string, unknown> }> =>
  s3.sent.filter((c) => c.kind === "get");

describe.runIf(realDbAvailable)("deal document store — real database", () => {
  beforeAll(async () => {
    for (const key of STORAGE_ENV) savedEnv[key] = process.env[key];
    configureStorage();

    ({ db } = await import("../../server/db"));
    ({ sql } = await import("drizzle-orm"));

    const service = await import("../../server/services/objectDocuments");
    kinds = service.DOCUMENT_OBJECT_KINDS;
    uploadUnavailableMessage = service.DOCUMENT_STORAGE_UNAVAILABLE_MESSAGE;
    downloadUnavailableMessage = service.DOCUMENT_DOWNLOAD_UNAVAILABLE_MESSAGE;

    const { registerObjectDocumentRoutes } = await import("../../server/routes-object-documents");
    app = express();
    app.use(express.json());
    registerObjectDocumentRoutes(app);

    orgA = (await insertFixture<{ id: number }>("organizations", { name: `SYNTHETIC Docstore A ${nonce()}` })).id;
    orgB = (await insertFixture<{ id: number }>("organizations", { name: `SYNTHETIC Docstore B ${nonce()}` })).id;

    propertyA = (
      await insertFixture<{ id: number }>("properties", {
        organization_id: orgA,
        address: `SYNTHETIC 1 Docstore Way ${nonce()}`,
      })
    ).id;
    dealA = (
      await insertFixture<{ id: number }>("deals", {
        organization_id: orgA,
        property_id: propertyA,
        created_by: acting.userId,
        user_id: acting.userId,
      })
    ).id;
    noteA = String(
      (await insertFixture<{ id: string }>("acquired_notes", { organization_id: orgA })).id,
    );

    const propertyB = (
      await insertFixture<{ id: number }>("properties", {
        organization_id: orgB,
        address: `SYNTHETIC 2 Docstore Way ${nonce()}`,
      })
    ).id;
    dealB = (
      await insertFixture<{ id: number }>("deals", {
        organization_id: orgB,
        property_id: propertyB,
        created_by: acting.userId,
        user_id: acting.userId,
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    for (const key of STORAGE_ENV) {
      if (savedEnv[key] === undefined) delete process.env[key];
      else process.env[key] = savedEnv[key];
    }
    const { pool } = await import("../../server/db");
    await pool.end();
  });

  beforeEach(() => {
    configureStorage();
    s3.sent.length = 0;
    s3.signed.length = 0;
  });

  // ── 1-3: round trips, one per kind ────────────────────────────────────────

  it("1 — deal round trip: upload, list, download", async () => {
    const upload = await as(orgA)
      .post(`/api/deals/${dealA}/documents`)
      .field("category", "title")
      .attach("file", PDF_BYTES, "title-commitment.pdf");

    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    expect(upload.body.document).toMatchObject({
      organizationId: orgA,
      dealId: dealA,
      propertyId: null,
      acquiredNoteId: null,
      fileName: "title-commitment.pdf",
      contentType: "application/pdf",
      byteSize: PDF_BYTES.length,
      category: "title",
      uploadedBy: acting.userId,
    });
    expect(typeof upload.body.document.id).toBe("string");
    dealDocumentId = String(upload.body.document.id);
    dealPutKey = String(puts()[0]?.input.Key ?? "");
    markCovered("deals", "upload");

    const list = await as(orgA).get(`/api/deals/${dealA}/documents`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({
      objectType: "deal",
      objectId: dealA,
      total: 1,
      storageAvailable: true,
    });
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([dealDocumentId]);
    markCovered("deals", "list");

    const download = await as(orgA).get(
      `/api/deals/${dealA}/documents/${dealDocumentId}/download`,
    );
    expect(download.status).toBe(200);
    expect(download.headers["content-type"]).toContain("application/pdf");
    expect(download.headers["content-length"]).toBe(String(PDF_BYTES.length));
    expect(download.headers["content-disposition"]).toContain('filename="title-commitment.pdf"');
    expect(bodyBytes(download).equals(PDF_BYTES)).toBe(true);
    markCovered("deals", "download");
  });

  it("2 — property round trip: upload, list, download", async () => {
    const upload = await as(orgA)
      .post(`/api/properties/${propertyA}/documents`)
      .attach("file", PDF_BYTES, "survey.pdf");

    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    expect(upload.body.document).toMatchObject({
      organizationId: orgA,
      dealId: null,
      propertyId: propertyA,
      acquiredNoteId: null,
      fileName: "survey.pdf",
      contentType: "application/pdf",
      byteSize: PDF_BYTES.length,
      category: null,
    });
    const documentId = String(upload.body.document.id);
    markCovered("properties", "upload");

    const list = await as(orgA).get(`/api/properties/${propertyA}/documents`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ objectType: "property", objectId: propertyA, total: 1 });
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([documentId]);
    markCovered("properties", "list");

    const download = await as(orgA).get(
      `/api/properties/${propertyA}/documents/${documentId}/download`,
    );
    expect(download.status).toBe(200);
    expect(bodyBytes(download).equals(PDF_BYTES)).toBe(true);
    markCovered("properties", "download");
  });

  it("3 — acquired note round trip (uuid parent): upload, list, download", async () => {
    const upload = await as(orgA)
      .post(`/api/notes/${noteA}/documents`)
      .attach("file", PDF_BYTES, "allonge.pdf");

    expect(upload.status, JSON.stringify(upload.body)).toBe(201);
    expect(upload.body.document).toMatchObject({
      organizationId: orgA,
      dealId: null,
      propertyId: null,
      acquiredNoteId: noteA,
      fileName: "allonge.pdf",
      contentType: "application/pdf",
    });
    const documentId = String(upload.body.document.id);
    markCovered("notes", "upload");

    const list = await as(orgA).get(`/api/notes/${noteA}/documents`);
    expect(list.status).toBe(200);
    expect(list.body).toMatchObject({ objectType: "note", objectId: noteA, total: 1 });
    expect(list.body.documents.map((d: { id: string }) => d.id)).toEqual([documentId]);
    markCovered("notes", "list");

    const download = await as(orgA).get(`/api/notes/${noteA}/documents/${documentId}/download`);
    expect(download.status).toBe(200);
    expect(bodyBytes(download).equals(PDF_BYTES)).toBe(true);
    markCovered("notes", "download");
  });

  // ── 4: tenancy is in the key ──────────────────────────────────────────────

  it("4 — tenancy is in the key: the row's storage_ref and the S3 Key both name org/<orgA>", async () => {
    const row = first(
      await rows<{ storage_ref: string }>(
        sql`SELECT storage_ref FROM uploaded_documents WHERE id = ${dealDocumentId}`,
      ),
      "the deal document row written by case 1",
    );
    expect(row.storage_ref.startsWith(`s3://${BUCKET}/org/${orgA}/documents/`)).toBe(true);
    expect(row.storage_ref).toContain(`/documents/deals/${dealA}/`);
    // Not merely what the row says — what was actually sent to the store.
    expect(dealPutKey.startsWith(`org/${orgA}/documents/deals/${dealA}/`)).toBe(true);
    expect(dealPutKey.endsWith(`${dealDocumentId}.pdf`)).toBe(true);
  });

  // ── 5: the database refuses a row with the wrong number of parents ────────

  it("5 — exactly-one-parent is enforced by the DATABASE, both ways", async () => {
    const base = sql`"organization_id", "file_name", "content_type", "byte_size", "storage_ref", "uploaded_by"`;
    const baseValues = sql`${orgA}, 'two-parents.pdf', 'application/pdf', 9, ${`s3://${BUCKET}/org/${orgA}/documents/x.pdf`}, ${acting.userId}`;

    const twoParents = await codeOf(
      db.execute(
        sql`INSERT INTO uploaded_documents (${base}, "deal_id", "property_id")
            VALUES (${baseValues}, ${dealA}, ${propertyA})`,
      ),
    );
    expect(twoParents).toBe("23514");

    const noParent = await codeOf(
      db.execute(sql`INSERT INTO uploaded_documents (${base}) VALUES (${baseValues})`),
    );
    expect(noParent).toBe("23514");

    expect(
      await countDocuments(sql`organization_id = ${orgA} AND file_name = 'two-parents.pdf'`),
    ).toBe(0);
  });

  // ── 6-9: the org-id swap ──────────────────────────────────────────────────

  it("6 — cross-org upload is 404 and writes nothing", async () => {
    const before = await countDocuments(sql`deal_id = ${dealA}`);

    const res = await as(orgB)
      .post(`/api/deals/${dealA}/documents`)
      .attach("file", PDF_BYTES, "poached.pdf");

    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
    expect(puts()).toEqual([]);
    expect(await countDocuments(sql`deal_id = ${dealA}`)).toBe(before);
    expect(await countDocuments(sql`organization_id = ${orgB}`)).toBe(0);

    // orgB is a WORKING tenant: its own deal answers 200 with an empty list.
    // Without this the 404 above would also be green for a fixture whose
    // second organization simply could not reach the routes at all.
    const own = await as(orgB).get(`/api/deals/${dealB}/documents`);
    expect(own.status).toBe(200);
    expect(own.body).toMatchObject({ objectType: "deal", objectId: dealB, total: 0 });
  });

  it("7 — the same list request, replayed as another org, is 404 and leaks nothing", async () => {
    const mine = await as(orgA).get(`/api/deals/${dealA}/documents`);
    expect(mine.status).toBe(200);
    expect(mine.body.total).toBe(1);

    // Identical URL, identical database, different asker.
    const theirs = await as(orgB).get(`/api/deals/${dealA}/documents`);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error).toBe("NOT_FOUND");
    expect(theirs.body.documents).toBeUndefined();
    expect(JSON.stringify(theirs.body)).not.toContain(dealDocumentId);
  });

  it("8 — the same download URL, replayed as another org, is 404 and never reaches the store", async () => {
    const url = `/api/deals/${dealA}/documents/${dealDocumentId}/download`;

    const theirs = await as(orgB).get(url);
    expect(theirs.status).toBe(404);
    expect(theirs.body.error).toBe("NOT_FOUND");
    // The refusal happens before any S3 call: the bytes are never fetched, so
    // there is nothing for a later bug to hand back.
    expect(gets()).toEqual([]);
    expect(s3.signed).toEqual([]);

    // …and the same URL still works for its owner, so the 404 is about WHO asked.
    const mine = await as(orgA).get(url);
    expect(mine.status).toBe(200);
  });

  it("9 — the right org through the wrong parent is 404 (org alone is not enough)", async () => {
    const res = await as(orgA).get(
      `/api/properties/${propertyA}/documents/${dealDocumentId}/download`,
    );
    expect(res.status).toBe(404);
    expect(res.body.error).toBe("NOT_FOUND");
    expect(gets()).toEqual([]);
  });

  // ── 10-11: the honest refusal ─────────────────────────────────────────────

  it("10 — with no store configured the upload refuses, keeps nothing and says so", async () => {
    unconfigureStorage();
    const before = await countDocuments(sql`deal_id = ${dealA}`);

    const res = await as(orgA)
      .post(`/api/deals/${dealA}/documents`)
      .attach("file", PDF_BYTES, "unsaved.pdf");

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(uploadUnavailableMessage);
    expect(puts()).toEqual([]);
    expect(await countDocuments(sql`deal_id = ${dealA}`)).toBe(before);
    expect(await countDocuments(sql`file_name = 'unsaved.pdf'`)).toBe(0);
  });

  it("11 — with no store configured the download refuses, rather than 500ing or serving nothing", async () => {
    unconfigureStorage();

    const res = await as(orgA).get(
      `/api/deals/${dealA}/documents/${dealDocumentId}/download`,
    );

    expect(res.status).toBe(503);
    expect(res.body.message).toBe(downloadUnavailableMessage);
    expect(gets()).toEqual([]);
  });

  // ── 12-13: the content gate ───────────────────────────────────────────────

  it("12 — a PNG named .pdf is rejected on its BYTES, and nothing is written", async () => {
    const before = await countDocuments(sql`deal_id = ${dealA}`);

    const res = await as(orgA)
      .post(`/api/deals/${dealA}/documents`)
      .attach("file", PNG_BYTES, "deed.pdf");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(res.body.message).toContain("image/png");
    expect(puts()).toEqual([]);
    expect(await countDocuments(sql`deal_id = ${dealA}`)).toBe(before);
    expect(await countDocuments(sql`file_name = 'deed.pdf'`)).toBe(0);
  });

  it("13 — an empty file is rejected, and nothing is written", async () => {
    const before = await countDocuments(sql`deal_id = ${dealA}`);

    const res = await as(orgA)
      .post(`/api/deals/${dealA}/documents`)
      .attach("file", Buffer.alloc(0), "empty.pdf");

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("BAD_REQUEST");
    expect(puts()).toEqual([]);
    expect(await countDocuments(sql`deal_id = ${dealA}`)).toBe(before);
    expect(await countDocuments(sql`file_name = 'empty.pdf'`)).toBe(0);
  });

  // ── 14-15: the timeline, and its stated limit ─────────────────────────────

  it("14 — a deal upload writes a document_uploaded timeline row carrying the API path", async () => {
    const events = await rows<{ description: string; metadata: unknown }>(
      sql`SELECT description, metadata FROM activity_events
          WHERE organization_id = ${orgA}
            AND entity_type = 'deal'
            AND entity_id = ${dealA}
            AND event_type = 'document_uploaded'`,
    );
    expect(events).toHaveLength(1);
    const event = first(events, "the document_uploaded activity event for the deal");
    expect(event.description).toContain("title-commitment.pdf");

    const metadata = (
      typeof event.metadata === "string" ? JSON.parse(event.metadata) : event.metadata
    ) as { documentUrl?: string };

    // The API download PATH, never a signed S3 URL: a signed URL expires in
    // 300s and a timeline is permanent, so storing one records a dead link.
    expect(metadata.documentUrl).toBe(
      `/api/deals/${dealA}/documents/${dealDocumentId}/download`,
    );
    expect(metadata.documentUrl?.startsWith("https://")).toBe(false);
  });

  it("15 — an acquired note gets NO timeline row (the stated limit of §7, pinned)", async () => {
    const row = first(
      await rows<{ n: number }>(
        sql`SELECT count(*)::int AS n FROM activity_events
            WHERE organization_id = ${orgA}
              AND (entity_id::text = ${noteA} OR coalesce(metadata::text, '') LIKE ${`%${noteA}%`})`,
      ),
      "count(*) over activity_events for the note",
    );
    expect(Number(row.n)).toBe(0);

    // activity_events.entity_id is an INTEGER and an acquired note's id is a
    // uuid (§7). When a later slice widens that, this assertion is what has to
    // be rewritten — the limitation cannot drift silently.
    const noteKind = kinds.find((def) => def.kind === "note");
    expect(noteKind?.timelineEntityType).toBeNull();
  });

  // ── 16: the vacuity guard over the enumerated population ──────────────────

  it("16 — every kind in DOCUMENT_OBJECT_KINDS was exercised on all three verbs", () => {
    expect(kinds.length).toBeGreaterThan(0);
    for (const def of kinds) {
      const verbs = covered.get(def.segment);
      expect(verbs, `no case covers the '${def.segment}' segment`).toBeDefined();
      expect([...(verbs ?? [])].sort()).toEqual(["download", "list", "upload"]);
    }
    // A fourth kind added to the registration loop without a round-trip case
    // above fails here, rather than leaving every other case green.
    expect(kinds.map((def) => def.segment).sort()).toEqual(
      [...covered.keys()].sort(),
    );
  });
});
