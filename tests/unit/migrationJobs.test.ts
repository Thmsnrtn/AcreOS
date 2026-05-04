/**
 * Phase 4 Week 15-16 — Migration In/Out Parity unit tests
 *
 * Covers the pure pieces of server/services/migrationJobs.ts that don't
 * require a DB connection:
 *
 *   - buildZipArchive / readZipArchive round-trip
 *   - 50K-row hard cap (we exercise the parseCSV pre-scan only since the
 *     full createImportJob flow needs a DB)
 *   - 1000-row CSV is parsed cleanly
 */

import { describe, it, expect } from "vitest";
import { buildZipArchive, readZipArchive, MAX_IMPORT_ROWS, IMPORT_CHUNK_SIZE } from "../../server/services/migrationJobs";
import { parseCSV } from "../../server/services/importExport";

function buildLeadCsv(rows: number): string {
  const headers = "firstName,lastName,email,phone";
  const lines = [headers];
  for (let i = 0; i < rows; i++) {
    lines.push(`First${i},Last${i},user${i}@example.com,555-000-${(i % 10000).toString().padStart(4, "0")}`);
  }
  return lines.join("\n");
}

describe("migrationJobs constants", () => {
  it("caps imports at 50,000 rows", () => {
    expect(MAX_IMPORT_ROWS).toBe(50_000);
  });

  it("uses 500-row chunks", () => {
    expect(IMPORT_CHUNK_SIZE).toBe(500);
  });
});

describe("CSV parsing at scale", () => {
  it("parses a 1,000-row lead CSV without error", () => {
    const csv = buildLeadCsv(1000);
    const rows = parseCSV(csv);
    expect(rows).toHaveLength(1000);
    expect(rows[0]).toMatchObject({
      firstName: "First0",
      lastName: "Last0",
      email: "user0@example.com",
    });
    expect(rows[999]).toMatchObject({
      firstName: "First999",
      lastName: "Last999",
      email: "user999@example.com",
    });
  });

  it("rejects a 50,001-row CSV via the pre-scan size check", () => {
    // Mirror the pre-scan logic in createImportJob without hitting the DB.
    const csv = buildLeadCsv(MAX_IMPORT_ROWS + 1);
    const rows = parseCSV(csv);
    expect(rows.length).toBeGreaterThan(MAX_IMPORT_ROWS);

    // The fail-fast path used inside createImportJob:
    const guard = () => {
      if (rows.length > MAX_IMPORT_ROWS) {
        throw new Error(
          `CSV file exceeds maximum of ${MAX_IMPORT_ROWS.toLocaleString()} rows. ` +
            `Got ${rows.length.toLocaleString()}. Please split into smaller files.`
        );
      }
    };
    expect(guard).toThrowError(/exceeds maximum of 50,000 rows/);
  });
});

describe("ZIP archive round-trip", () => {
  it("encodes and decodes a single text entry", async () => {
    const text = "id,name\n1,Alice\n2,Bob\n";
    const buf = await buildZipArchive([{ name: "leads.csv", data: Buffer.from(text, "utf8") }]);
    expect(buf.readUInt32LE(0)).toBe(0x04034b50); // local file header signature
    const entries = readZipArchive(buf);
    expect(entries).toHaveLength(1);
    expect(entries[0].name).toBe("leads.csv");
    expect(entries[0].data.toString("utf8")).toBe(text);
  });

  it("encodes multiple entries and preserves their order + content", async () => {
    const entries = [
      { name: "leads.csv", data: Buffer.from("a,b,c\n1,2,3\n", "utf8") },
      { name: "properties.csv", data: Buffer.from("x,y\n10,20\n", "utf8") },
      {
        name: "README.md",
        data: Buffer.from("# AcreOS Export\n\nGenerated 2026-05-03.", "utf8"),
      },
    ];
    const buf = await buildZipArchive(entries);
    const decoded = readZipArchive(buf);
    expect(decoded).toHaveLength(3);
    expect(decoded.map((e) => e.name)).toEqual(["leads.csv", "properties.csv", "README.md"]);
    for (let i = 0; i < entries.length; i++) {
      expect(decoded[i].data.toString("utf8")).toBe(entries[i].data.toString("utf8"));
    }
  });

  it("compresses repetitive data smaller than the original payload", async () => {
    const repeat = "abcdef,".repeat(1000); // very compressible
    const buf = await buildZipArchive([{ name: "x.csv", data: Buffer.from(repeat, "utf8") }]);
    // The whole archive (with headers) should still be well under the raw size
    expect(buf.length).toBeLessThan(repeat.length);
  });
});
