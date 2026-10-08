/**
 * Lead CSV import: Excel/Sheets exports parse cleanly, and the 500-row cap is
 * a clear refusal — through the real routes and the real upload validation.
 *
 * Measured on this tree before the change (2026-10-07):
 *   - A BOM file never reached the parser. The upload sniffer
 *     (fileUploadSecurity.detectMimeFromBuffer) accepted printable ASCII only,
 *     so Excel's "CSV UTF-8" export (EF BB BF) — and any file with an accented
 *     name in its first 512 bytes — was refused 400 "Unable to determine file
 *     type", in a non-standard `{ message }` body.
 *   - parseCSV itself handled BOM + CRLF, but by ACCIDENT: String#trim strips
 *     U+FEFF, and the line split was /\r?\n/. A QUOTED value holding a line
 *     break (an address, a note) was cut into two rows, shifting every later
 *     column — the parser split lines before it looked at quotes.
 *   - The cap was enforced, never silently truncating and never a 500:
 *     /api/leads/import refused 501 rows with a clear 400. POST
 *     /api/leads/csv-import (the mapped-rows importer CsvImportSheet uses)
 *     refused with "Validation failed" / "Array must contain at most 500
 *     element(s)", which does not tell a customer what to do.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const h = vi.hoisted(() => ({ imported: [] as Array<Array<Record<string, string>>> }));

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/auth", () => ({
  isAuthenticated: (req: { user?: unknown }, _s: unknown, n: () => void) => {
    req.user = { id: "u1" };
    n();
  },
}));
vi.mock("../../server/middleware/getOrCreateOrg", () => ({
  getOrCreateOrg: (req: { organization?: unknown }, _s: unknown, n: () => void) => {
    req.organization = { id: 7, subscriptionTier: "pro" };
    n();
  },
}));
vi.mock("../../server/utils/permissions", async (orig) => ({
  ...(await orig<typeof import("../../server/utils/permissions")>()),
  attachPermissionContext: () => (_q: unknown, _s: unknown, n: () => void) => n(),
  requirePermission: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/roleScope", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/roleScope")>()),
  requireScope: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/middleware/usageLimitGate", async (orig) => ({
  ...(await orig<typeof import("../../server/middleware/usageLimitGate")>()),
  usageLimitGate: () => (_q: unknown, _s: unknown, n: () => void) => n(),
}));
vi.mock("../../server/services/usageLimits", async (orig) => ({
  ...(await orig<typeof import("../../server/services/usageLimits")>()),
  checkUsageLimit: async () => ({ allowed: true, current: 0, limit: null, resourceType: "leads", tier: "pro" }),
}));
vi.mock("../../server/storage", () => ({ storage: {}, db: {} }));
vi.mock("../../server/services/importExport", async (orig) => ({
  ...(await orig<typeof import("../../server/services/importExport")>()),
  importLeads: async (rows: Array<Record<string, string>>) => {
    h.imported.push(rows);
    return { imported: rows.length, errors: [] };
  },
}));

beforeEach(() => {
  h.imported.length = 0;
});

async function app() {
  const a = express();
  a.use(express.json({ limit: "5mb" }));
  const { registerLeadRoutes } = await import("../../server/routes-leads");
  registerLeadRoutes(a);
  return a;
}

const BOM = "﻿";
const excelExport =
  BOM +
  "firstName,lastName,address,notes\r\n" +
  "Ann,Lee,\"12 Oak Rd\r\nUnit 4\",\"says \"\"call after 5\"\"\"\r\n" +
  "Bob,Ray,9 Elm St,5\" pipe on the lot\r\n";

describe("BOM + CRLF exports", () => {
  it("preview: header names carry no BOM and no value ends in \\r; a quoted line break stays one row", async () => {
    const res = await request(await app())
      .post("/api/leads/import/preview")
      .attach("file", Buffer.from(excelExport, "utf8"), { filename: "leads.csv", contentType: "text/csv" });
    expect(res.status).toBe(200);
    expect(res.body.headers).toEqual(["firstName", "lastName", "address", "notes"]);
    expect(res.body.totalRows).toBe(2);
    expect(res.body.preview[0]).toEqual({
      firstName: "Ann",
      lastName: "Lee",
      address: "12 Oak Rd\r\nUnit 4",
      notes: 'says "call after 5"',
    });
    // A mid-field quote is a literal, not the start of a quoted run.
    expect(res.body.preview[1]).toEqual({ firstName: "Bob", lastName: "Ray", address: "9 Elm St", notes: '5" pipe on the lot' });
    for (const row of res.body.preview as Array<Record<string, string>>) {
      for (const k of Object.keys(row)) expect(k).not.toMatch(/﻿|\r/);
    }
  });

  it("import: the rows handed to the importer are keyed by the clean header (firstName maps)", async () => {
    const res = await request(await app())
      .post("/api/leads/import")
      .attach("file", Buffer.from(excelExport, "utf8"), { filename: "leads.csv", contentType: "text/csv" });
    expect(res.status).toBe(200);
    expect(h.imported).toHaveLength(1);
    expect(h.imported[0][0].firstName).toBe("Ann");
    expect(h.imported[0][1].lastName).toBe("Ray");
  });
});

describe("line endings, directly on the parser", () => {
  it("CRLF, LF and lone CR (classic Mac export) give the same rows", async () => {
    const { parseCSV } = await import("../../server/services/importExport");
    const expected = [{ a: "1", b: "2" }, { a: "3", b: "4" }];
    for (const eol of ["\r\n", "\n", "\r"]) {
      expect(parseCSV(`${BOM}a,b${eol}1,2${eol}3,4${eol}`), JSON.stringify(eol)).toEqual(expected);
    }
  });
});

describe("the upload sniffer accepts real text and still refuses binary", () => {
  it("accented names in the first bytes are text", async () => {
    const res = await request(await app())
      .post("/api/leads/import/preview")
      .attach("file", Buffer.from("firstName,lastName\nJosé,Muñoz\n", "utf8"), { filename: "n.csv", contentType: "text/csv" });
    expect(res.status).toBe(200);
    expect(res.body.preview[0]).toEqual({ firstName: "José", lastName: "Muñoz" });
  });

  it("binary content named .csv is refused, in the standard error shape", async () => {
    const res = await request(await app())
      .post("/api/leads/import/preview")
      .attach("file", Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x10, 0x80]), { filename: "x.csv", contentType: "text/csv" });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "BAD_REQUEST", statusCode: 400 });
  });
});

describe("the 500-row cap", () => {
  const csvOf = (n: number) =>
    "firstName,lastName\n" + Array.from({ length: n }, (_, i) => `F${i},L${i}`).join("\n") + "\n";

  it("an upload of 501 rows is refused with a clear 400 and imports nothing", async () => {
    const res = await request(await app())
      .post("/api/leads/import")
      .attach("file", Buffer.from(csvOf(501)), { filename: "big.csv", contentType: "text/csv" });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/maximum of 500 rows.*501 rows/);
    expect(h.imported).toHaveLength(0);
  });

  it("exactly 500 rows is accepted whole — not truncated", async () => {
    const res = await request(await app())
      .post("/api/leads/import")
      .attach("file", Buffer.from(csvOf(500)), { filename: "ok.csv", contentType: "text/csv" });
    expect(res.status).toBe(200);
    expect(h.imported[0]).toHaveLength(500);
  });

  it("POST /api/leads/csv-import with 501 mapped rows says how many, what the cap is, and that nothing was imported", async () => {
    const rows = Array.from({ length: 501 }, (_, i) => ({ firstName: `F${i}`, lastName: `L${i}` }));
    const res = await request(await app()).post("/api/leads/csv-import").send({ rows });
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ error: "BAD_REQUEST", statusCode: 400, details: { maxRows: 500, rows: 501 } });
    expect(res.body.message).toMatch(/at most 500 rows; this one has 501.*Nothing was imported/);
  });
});
