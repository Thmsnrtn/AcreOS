/**
 * G11 (b): no response body on the import surface may carry a SQL statement, a
 * table/column dump or a parameter list. A persistence failure becomes a
 * field-level message (row, field, fix) before it reaches the API response.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ createProperty: vi.fn() }));
vi.mock("../../server/storage", () => ({ storage: { createProperty: h.createProperty } }));
vi.mock("../../server/db", () => ({ db: {} }));
vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

import { importNotesFromCSV, importProperties, importRowError } from "../../server/services/importExport";

const DUMP =
  'Failed query: insert into "properties" ("id", "organization_id", "apn", "size_acres") values (default, $1, $2, $3)\nparams: 7,A1,abc';
function driverError(code: string, column?: string) {
  const cause = Object.assign(new Error('invalid input syntax for type numeric: "abc"'), { code, column });
  return Object.assign(new Error(DUMP), { cause });
}
const bad = /Failed query:|insert into|params:|\$\d/i;

describe("import errors contain no SQL", () => {
  beforeEach(() => {
    h.createProperty.mockReset();
  });

  it("maps driver errors to field-level text", () => {
    expect(importRowError(driverError("22P02", "size_acres"))).toMatch(/^sizeAcres: .*Fix:/);
    expect(importRowError(driverError("23502", "apn"))).toMatch(/^apn: is required/);
    for (const code of ["22P02", "23502", "23505", "23503", "22001", "23514", "XX000"]) {
      expect(importRowError(driverError(code, "county")), code).not.toMatch(bad);
    }
  });

  it("an error with SQL in its message but no code is still not passed through", () => {
    expect(importRowError(new Error(DUMP))).not.toMatch(bad);
  });

  it("our own field-level messages pass through unchanged", () => {
    expect(importRowError(new Error("apn: APN is required"))).toBe("apn: APN is required");
  });

  it("a bad-properties file: every row error is clean, siblings still land", async () => {
    h.createProperty.mockImplementation(async (p: { apn: string }) => {
      if (p.apn === "BAD") throw driverError("22P02", "size_acres");
      return { id: 1, ...p };
    });
    const rows = [
      { apn: "OK1", county: "Wake", state: "NC", sizeAcres: "1" },
      { apn: "BAD", county: "Wake", state: "NC", sizeAcres: "2" },
      { apn: "OK2", county: "Wake", state: "NC", sizeAcres: "not-a-number" },
      { apn: "", county: "Wake", state: "NC", sizeAcres: "3" },
    ];
    const r = await importProperties(rows, 1);
    expect(r.successCount).toBe(1);
    expect(r.errorCount).toBe(3);
    for (const e of r.errors) expect(e.error).not.toMatch(bad);
    expect(r.errors.find((e) => e.row === 4)?.error).toMatch(/sizeAcres: "not-a-number"/);
  });

  it("a 501-row job shape: all rows fail at the driver, none of the 501 messages carries SQL", async () => {
    h.createProperty.mockImplementation(async () => {
      throw driverError("23502", "county");
    });
    const rows = Array.from({ length: 501 }, (_, i) => ({ apn: `A${i}`, county: "Wake", state: "NC", sizeAcres: "1" }));
    const r = await importProperties(rows, 1);
    expect(r.errorCount).toBe(501);
    expect(r.errors.every((e) => !bad.test(e.error))).toBe(true);
  });

  it("a fieldMap cannot address a reserved key (remote property injection)", async () => {
    // Before: {"constructor": "originalPrincipal"} was honoured, so a cell under a
    // column named "constructor" became the principal. It must be ignored.
    const row = { borrowerFirstName: "Ann", constructor: "5000", "Start Date": "2026-01-01", "First Payment Date": "2026-02-01" } as Record<string, string>;
    const r = await importNotesFromCSV([row], 1, { constructor: "originalPrincipal", __proto__: "originalPrincipal" } as Record<string, string>);
    expect(r.errors[0].error).toMatch(/Original principal amount is required/);
    expect(({} as Record<string, unknown>).originalPrincipal).toBeUndefined();
  });
});
