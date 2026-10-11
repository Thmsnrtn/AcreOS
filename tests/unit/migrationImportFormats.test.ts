/**
 * One-click migration import (W5b).
 *
 *   - A VERIFIED preset maps its layout correctly — mailing vs situs kept
 *     apart (Regrid's `mailadd` is where mail goes, `address` is the parcel).
 *   - The AcreOS preset's signature is exactly what our own export writes, so
 *     the preset cannot drift from the exporter it claims to read.
 *   - Unverified tools have no preset and say why.
 *   - The .xlsx reader reads a real workbook (shared + inline strings, a ZIP
 *     stored as a number, a gap column) through the ZIP central directory,
 *     and refuses a legacy .xls rather than guessing.
 *   - Every lead-import path is in the population that calls the suppression
 *     hook and records the batch — a new import path without them is the
 *     thing that fails.
 */
import { describe, expect, it, vi } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { detectImportFormat, IMPORT_FORMAT_PRESETS, UNVERIFIED_SOURCES } from "../../shared/leads/importFormats";
import { mapCsvRow, suggestMapping } from "../../shared/leads/csvImportMapping";
import { readXlsx, XlsxReadError } from "../../server/services/imports/xlsxReader";
import { buildZipArchive } from "../../server/services/migrationJobs";
import { stripComments } from "../helpers/stripComments";
import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = path.resolve(__dirname, "../..");

describe("verified presets", () => {
  it("Regrid: owner mailing block → mailing fields, situs → property fields, Census `city` skipped", () => {
    const headers = ["parcelnumb", "owner", "mailadd", "mail_city", "mail_state2", "mail_zip", "address", "scity", "state2", "szip", "county", "city", "ll_gisacre"];
    const d = detectImportFormat(headers);
    expect(d?.preset.id).toBe("regrid_parcels");
    const mapping = Object.fromEntries(headers.map((h) => [h, d!.mapping[h] ?? suggestMapping(headers)[h]]));
    const row = mapCsvRow(headers, ["12-34", "SMITH JOHN", "PO BOX 9", "AUSTIN", "TX", "78701", "1 RANCH RD", "MARFA", "TX", "79843", "Presidio", "Precinct 2", "40.1"], mapping as any);
    expect(row).toMatchObject({ apn: "12-34", ownerName: "SMITH JOHN", address: "PO BOX 9", city: "AUSTIN", state: "TX", zip: "78701", propertyAddress: "1 RANCH RD", propertyCity: "MARFA", county: "Presidio" });
    expect(row.city).not.toBe("Precinct 2");
  });

  it("AcreOS: the preset signature is a subset of the headers exportLeadsToCSV writes", () => {
    const src = fs.readFileSync(path.join(ROOT, "server/services/importExport.ts"), "utf8");
    const block = /export async function exportLeadsToCSV[\s\S]*?const headers = \[([\s\S]*?)\];/.exec(src);
    expect(block, "found the exporter's header list").toBeTruthy();
    const written = [...block![1].matchAll(/"([^"]+)"/g)].map((m) => m[1].toLowerCase());
    expect(written.length).toBeGreaterThan(10);
    const preset = IMPORT_FORMAT_PRESETS.find((p) => p.id === "acreos_export")!;
    for (const s of preset.signature) expect(written, s).toContain(s);
    for (const k of Object.keys(preset.columns)) expect(written, k).toContain(k);
  });

  it("a file from an unverified tool matches no preset, and the reason is shown", () => {
    expect(detectImportFormat(["Owner 1 Full Name", "Owner Mailing Address", "APN", "Address", "City"])).toBeNull();
    expect(UNVERIFIED_SOURCES.map((u) => u.tool)).toEqual(expect.arrayContaining(["PropStream", "DataTree"]));
    for (const u of UNVERIFIED_SOURCES) expect(u.why.length).toBeGreaterThan(20);
  });
});

// ── a hand-built .xlsx ───────────────────────────────────────────────────────
async function workbook(sheetRows: string): Promise<Buffer> {
  const xml = (s: string) => Buffer.from(s, "utf8");
  return buildZipArchive([
    { name: "[Content_Types].xml", data: xml('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>') },
    { name: "xl/workbook.xml", data: xml('<workbook xmlns:r="r"><sheets><sheet name="Leads" sheetId="1" r:id="rId7"/></sheets></workbook>') },
    { name: "xl/_rels/workbook.xml.rels", data: xml('<Relationships><Relationship Id="rId7" Type="worksheet" Target="worksheets/leads.xml"/></Relationships>') },
    { name: "xl/sharedStrings.xml", data: xml('<sst><si><t>Owner Name</t></si><si><t>APN</t></si><si><t>Mailing Zip</t></si><si><r><t>O&apos;Brien</t></r><r><t xml:space="preserve"> &amp; Sons</t></r></si></sst>') },
    { name: "xl/worksheets/leads.xml", data: xml(`<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`) },
  ]);
}

describe("the .xlsx reader", () => {
  it("reads headers and rows through the workbook's own sheet relationship", async () => {
    const buf = await workbook(
      '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="s"><v>2</v></c></row>' +
        '<row r="2"><c r="A2" t="s"><v>3</v></c><c r="B2" t="inlineStr"><is><t>001-22</t></is></c><c r="D2"><v>7102</v></c></row>' +
        '<row r="3"/>',
    );
    const out = readXlsx(buf, { maxRows: 100 });
    expect(out.headers).toEqual(["Owner Name", "APN", "", "Mailing Zip"]);
    expect(out.rows).toEqual([["O'Brien & Sons", "001-22", "", "7102"]]);
    // …and the importer's own rule restores the ZIP's dropped leading zero.
    const mapped = mapCsvRow(out.headers, out.rows[0], suggestMapping(out.headers));
    expect(mapped.zip).toBe("07102");
  });

  it("caps rows and says it truncated", async () => {
    const rows = Array.from({ length: 6 }, (_, i) => `<row r="${i + 1}"><c r="A${i + 1}" t="inlineStr"><is><t>r${i}</t></is></c></row>`).join("");
    const out = readXlsx(await workbook(rows), { maxRows: 3 });
    expect(out.rows.length).toBe(3);
    expect(out.truncated).toBe(true);
  });

  it("refuses a legacy .xls and a non-workbook instead of guessing", () => {
    const ole = Buffer.alloc(64);
    ole.writeUInt32LE(0xe011cfd0, 0);
    expect(() => readXlsx(ole, { maxRows: 10 })).toThrow(XlsxReadError);
    expect(() => readXlsx(Buffer.from("name,apn\nA,1\n".repeat(5)), { maxRows: 10 })).toThrow(XlsxReadError);
  });
});

describe("every lead-import writer passes the suppression hook", () => {
  // The population: each import path that creates leads from a list. A file
  // that batch-creates leads (createLeadsBatch) must be listed here — the
  // second test fails otherwise — and each listed unit must load the
  // suppression hook BEFORE its insert.
  const UNITS: Array<{ file: string; unit: RegExp; insert: string }> = [
    { file: "server/routes-leads.ts", unit: /"\/api\/leads\/csv-import"[\s\S]*?\n  \);\n/, insert: "db.insert(leads)" },
    { file: "server/routes-leads.ts", unit: /"\/api\/leads\/import\/tax-delinquent"[\s\S]*?\n  \}\);\n/, insert: "storage.createLeadsBatch(" },
    { file: "server/services/importExport.ts", unit: /export async function importLeads\([\s\S]*?\n\}\n/, insert: "storage.createLeadsBatch(" },
    { file: "server/services/taxDelinquentPipeline.ts", unit: /const toInsert[\s\S]*?db\.insert\(leads\)/, insert: "db.insert(leads)" },
  ];

  it.each(UNITS.map((u) => [`${u.file} ${u.unit.source.slice(0, 40)}`, u] as const))("%s loads the hook before inserting", (_n, u) => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, u.file), "utf8"));
    const body = u.unit.exec(src)?.[0] ?? "";
    expect(body.length, "found the unit").toBeGreaterThan(500);
    const hook = body.indexOf("loadOutreachSuppression(");
    expect(hook, "calls the suppression hook").toBeGreaterThan(0);
    expect(body.lastIndexOf(u.insert), "inserts after the hook").toBeGreaterThan(hook);
  });

  it("no other server file batch-creates leads", () => {
    const listed = new Set(UNITS.map((u) => u.file));
    const offenders: string[] = [];
    const walk = (d: string) => {
      for (const e of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) {
        const rel = path.join(d, e.name);
        if (e.isDirectory()) walk(rel);
        else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) {
          const src = stripComments(fs.readFileSync(path.join(ROOT, rel), "utf8"));
          if (/\.createLeadsBatch\(/.test(src) && !listed.has(rel) && !rel.startsWith(path.join("server", "storage"))) offenders.push(rel);
        }
      }
    };
    walk("server");
    expect(offenders).toEqual([]);
  });

  it("the CSV importer also records its batch for undo", () => {
    const src = stripComments(fs.readFileSync(path.join(ROOT, "server/routes-leads.ts"), "utf8"));
    const handler = UNITS[0].unit.exec(src)![0];
    expect(handler).toMatch(/getOpenImportBatch\(org\.id, importBatchId\)/);
    expect(handler).toMatch(/recordImportIntoBatch\(org\.id, importBatchId/);
  });
});
