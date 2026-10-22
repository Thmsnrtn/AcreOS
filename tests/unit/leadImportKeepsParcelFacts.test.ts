/**
 * A county / tax-delinquent list imported into AcreOS keeps the facts a land
 * investor prices and mails on: ACREAGE, VALUE (the county's assessed value
 * and a market estimate, never one for the other) and TAX-DELINQUENT status.
 *
 * Three parts:
 *   1. The shared parsers (shared/leads/parcelFacts.ts) refuse, never
 *      fabricate: unreadable → null, never 0.
 *   2. The header rule maps the column names county lists actually use.
 *   3. THE POPULATION. Every lead import path — every server file that both
 *      reads a tabular list and inserts leads, every caller of importLeads(),
 *      every client screen that posts mapped rows — is enumerated here, and
 *      each must go through the shared parsers. A new import path that is not
 *      in the list fails discovery; a member whose unit cannot be found fails
 *      its vacuity floor. Comments are stripped first (tests/helpers/
 *      stripComments.ts), so a comment naming a parser does not count.
 *
 * The behavioural proof per path (the row that reaches the insert) is
 * tests/unit/leadCsvImportParcelFacts.test.ts.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { stripComments } from "../helpers/stripComments";
import {
  classifyParcelFactHeader,
  leadParcelFactsFromRow,
  parcelFactRows,
} from "../../shared/leads/parcelFacts";
import { suggestMapping } from "../../shared/leads/csvImportMapping";

import { REPO_SWEEP_TIMEOUT_MS } from "../helpers/sweepBudget";

vi.setConfig({ testTimeout: REPO_SWEEP_TIMEOUT_MS });

const ROOT = join(__dirname, "../..");
const read = (rel: string) => stripComments(readFileSync(join(ROOT, rel), "utf8"));

describe("parsers refuse, never fabricate", () => {
  // Through the one entry point every import path calls; the cell parsers
  // themselves are module-private.
  const acre = (v: unknown) => leadParcelFactsFromRow({ acreage: v }).acreage;
  const assessed = (v: unknown) => leadParcelFactsFromRow({ assessedValue: v }).assessedValue;
  const owed = (v: unknown) => leadParcelFactsFromRow({ taxDelinquentAmount: v }).taxDelinquentAmount;
  const flag = (v: unknown) => leadParcelFactsFromRow({ taxDelinquent: v }).taxDelinquent;
  const years = (v: unknown) => leadParcelFactsFromRow({ taxDelinquentYears: v }).taxDelinquentYears;

  it("acreage", () => {
    expect(acre("12.5 ac")).toBe("12.5");
    expect(acre("12.5")).toBe("12.5");
    expect(acre("1,234.5")).toBe("1234.5");
    expect(acre("40 acres")).toBe("40");
    expect(acre("2.5AC")).toBe("2.5");
    expect(acre(7.25)).toBe("7.25");
    for (const bad of ["N/A", "", "   ", "garbage", "5000 sq ft", "2 ha", "0", "-3", "1,2", "12.5.1", null, undefined]) {
      expect(acre(bad), String(bad)).toBeNull();
    }
  });

  it("money", () => {
    expect(assessed("$45,000")).toBe("45000");
    expect(assessed("12345.67")).toBe("12345.67");
    expect(assessed("$ 1,200.00")).toBe("1200");
    for (const bad of ["N/A", "", "$-", "garbage", "(1,200)", "-5", "0", "$0.00", null]) {
      expect(assessed(bad), String(bad)).toBeNull();
    }
    // An amount owed may truly be zero; garbage is still null.
    expect(owed("0")).toBe("0");
    expect(owed("N/A")).toBeNull();
  });

  it("delinquent flag", () => {
    for (const t of ["Y", "Yes", "TRUE", "true", "1", "Delinquent", "T"]) expect(flag(t), t).toBe(true);
    for (const f of ["N", "No", "False", "0", "Current", "Not Delinquent"]) expect(flag(f), f).toBe(false);
    for (const u of ["", "  ", "maybe", null, undefined]) expect(flag(u), String(u)).toBeNull();
  });

  it("years delinquent", () => {
    expect(years("3")).toBe(3);
    expect(years("3 yrs")).toBe(3);
    expect(years("0")).toBe(0);
    for (const bad of ["", "N/A", "three", "2019", "-1"]) expect(years(bad), bad).toBeNull();
  });

  it("a positive amount owed or years count implies delinquent; a blank row says nothing", () => {
    expect(leadParcelFactsFromRow({ taxDelinquentAmount: "$310" }).taxDelinquent).toBe(true);
    expect(leadParcelFactsFromRow({ taxDelinquentYears: "2" }).taxDelinquent).toBe(true);
    expect(leadParcelFactsFromRow({ taxDelinquent: "N", taxDelinquentAmount: "0" }).taxDelinquent).toBe(false);
    expect(leadParcelFactsFromRow({})).toEqual({
      acreage: null, assessedValue: null, estimatedValue: null,
      taxDelinquent: null, taxDelinquentAmount: null, taxDelinquentYears: null,
    });
  });
});

describe("county headers map to the right fact", () => {
  const EXPECT: Array<[string, string]> = [
    ["Acres", "acreage"],
    ["Acreage", "acreage"],
    ["Lot Size (Acres)", "acreage"],
    ["Calc Acres", "acreage"],
    ["CalcAcres", "acreage"],
    ["Parcel Acres", "acreage"],
    ["Assessed Value", "assessedValue"],
    ["Total Assessed", "assessedValue"],
    ["State Assessed Value", "assessedValue"],
    ["Market Value", "estimatedValue"],
    ["Estimated Value", "estimatedValue"],
    ["Tax Delinquent", "taxDelinquent"],
    ["Delinquent", "taxDelinquent"],
    ["TAX_DELINQUENT", "taxDelinquent"],
    ["Delinquent Amount", "taxDelinquentAmount"],
    ["Taxes Owed", "taxDelinquentAmount"],
    ["Amount Due", "taxDelinquentAmount"],
    ["Years Delinquent", "taxDelinquentYears"],
  ];
  it.each(EXPECT)("Smart CSV sheet: %s → %s", (header, field) => {
    expect(suggestMapping([header])[header]).toBe(field);
  });

  it("a land value is the assessed value only when no assessed column exists", () => {
    expect(suggestMapping(["Land Value"])["Land Value"]).toBe("assessedValue");
    const both = suggestMapping(["Land Value", "Total Assessed"]);
    expect(both["Land Value"]).toBe("skip");
    expect(both["Total Assessed"]).toBe("assessedValue");
  });

  it("non-facts stay non-facts", () => {
    for (const h of ["Lot Size Sqft", "Tax Year", "Delinquent Since", "APN", "Mailing State", "County"]) {
      expect(["acreage", "assessedValue", "estimatedValue", "taxDelinquent", "taxDelinquentAmount", "taxDelinquentYears"]).not.toContain(
        suggestMapping([h])[h],
      );
    }
    expect(classifyParcelFactHeader("Lot Size Sqft")).toBeNull();
  });

  it("existing mappings are not displaced", () => {
    const m = suggestMapping(["APN", "Owner Name", "Mailing State", "County", "Phone 1"]);
    expect(m).toEqual({ APN: "apn", "Owner Name": "ownerName", "Mailing State": "state", County: "county", "Phone 1": "phone" });
  });
});

describe("the lead detail shows the facts with their own labels", () => {
  it("assessed and estimated are labelled apart; absent facts are absent", () => {
    const rows = parcelFactRows({ acreage: "12.5", assessedValue: "45000", estimatedValue: null, taxDelinquent: true, taxDelinquentAmount: "1234.5", taxDelinquentYears: 3 });
    expect(rows.map((r) => [r.label, r.value])).toEqual([
      ["Acreage", "12.5 ac"],
      ["Assessed value (county)", "$45,000"],
      ["Tax delinquent", "Yes"],
      ["Taxes owed", "$1,234.50"],
      ["Years delinquent", "3 years"],
    ]);
    expect(parcelFactRows({ estimatedValue: "61500" }).map((r) => r.label)).toEqual(["Estimated value"]);
    expect(parcelFactRows({})).toEqual([]);
  });

  it("the lead detail panel renders those rows", () => {
    const src = read("client/src/components/lead-detail-content.tsx");
    expect(src).toMatch(/parcelFactRows\(lead\)/);
    expect(src).toMatch(/parcelFacts\.map\(/);
  });
});

// ─── THE POPULATION ─────────────────────────────────────────────────────────

/** Source from `anchor` up to the next route registration (or function) after it. */
function unitAt(src: string, anchor: string): string {
  const at = src.indexOf(anchor);
  if (at < 0) return "";
  const rest = src.slice(at + anchor.length);
  const next = rest.search(/\n\s*(api|app|router)\.(get|post|put|patch|delete)\(|\n(export )?(async )?function /);
  return anchor + (next < 0 ? rest : rest.slice(0, next));
}

interface Member {
  file: string;
  /** Where the unit begins: a route literal or a function declaration. */
  anchor: string;
  /** The unit must contain every one of these calls. */
  uses: string[];
}

/** Every lead import path. Add a new one here — discovery below fails until you do. */
const IMPORT_PATHS: Member[] = [
  { file: "server/routes-leads.ts", anchor: `"/api/leads/csv-import"`, uses: ["leadParcelFactsFromRow(row)"] },
  { file: "server/routes-leads.ts", anchor: `"/api/leads/import/tax-delinquent"`, uses: ["taxDelinquentListFacts(row)"] },
  { file: "server/routes-leads.ts", anchor: "function taxDelinquentListFacts(", uses: ["leadParcelFactsFromRow("] },
  { file: "server/routes-leads.ts", anchor: `"/api/leads/import"`, uses: ["importLeads("] },
  { file: "server/services/importExport.ts", anchor: "export async function importLeads(", uses: ["leadParcelFactsFromRow(", "parcelFactCellsFromRecord("] },
  { file: "server/routes-import-export.ts", anchor: `"/api/import/:entityType"`, uses: ["importLeads("] },
  { file: "server/services/migrationJobs.ts", anchor: "async function runImportChunk(", uses: ["importLeads("] },
  { file: "server/services/taxDelinquentPipeline.ts", anchor: "function normalizeRecords(", uses: ["leadParcelFactsFromRow(", "parcelFactCellsFromRecord("] },
  { file: "server/services/taxDelinquentPipeline.ts", anchor: "export async function processTaxDelinquentImport(", uses: ["normalizeRecords(", "...rec.facts"] },
];

/** The client screens that turn CSV headers into row fields before posting. */
const CLIENT_MAPPERS: Member[] = [
  { file: "client/src/components/leads/CsvImportSheet.tsx", anchor: "export function CsvImportSheet(", uses: ["suggestMapping(", "mapCsvRow("] },
  { file: "shared/leads/csvImportMapping.ts", anchor: "function classify(", uses: ["classifyParcelFactHeader("] },
  { file: "client/src/components/tax-delinquent-importer.tsx", anchor: "export function TaxDelinquentImporter(", uses: ["classifyParcelFactHeader("] },
];

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === "__tests__") continue;
      walk(p, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe("population: every lead import path uses the shared parcel-fact parsers", () => {
  const serverFiles = walk(join(ROOT, "server")).map((p) => ({ rel: relative(ROOT, p), src: stripComments(readFileSync(p, "utf8")) }));
  const clientFiles = walk(join(ROOT, "client/src")).map((p) => ({ rel: relative(ROOT, p), src: stripComments(readFileSync(p, "utf8")) }));

  it("discovery: a server file that reads a list AND inserts leads is a listed path", () => {
    const writesLeads = /\binsert\(leads\)|\bcreateLeadsBatch\(/;
    const readsList = /\bparseCSV\(|\bparseCsv\(|\bmappedData\b|\bcsvImportRowSchema\b|\bcsvData\b/;
    const discovered = serverFiles
      .filter((f) => !f.rel.startsWith("server/storage"))
      .filter((f) => writesLeads.test(f.src) && readsList.test(f.src))
      .map((f) => f.rel)
      .sort();
    const listed = new Set(IMPORT_PATHS.map((m) => m.file));
    expect(discovered.length).toBeGreaterThanOrEqual(3);
    for (const f of discovered) expect(listed.has(f), `${f} reads a list and inserts leads but is not in IMPORT_PATHS`).toBe(true);
  });

  it("discovery: every caller of importLeads() is a listed path", () => {
    const callers = serverFiles
      .filter((f) => /\bimportLeads\(/.test(f.src.replace(/export async function importLeads\(/, "")))
      .map((f) => f.rel);
    expect(callers.length).toBeGreaterThanOrEqual(3);
    for (const f of callers) {
      expect(IMPORT_PATHS.some((m) => m.file === f && m.uses.includes("importLeads(")), `${f} calls importLeads() but is not listed`).toBe(true);
    }
  });

  it("discovery: every client screen posting mapped lead rows is a listed mapper", () => {
    const posters = clientFiles
      .filter((f) => /["'`]\/api\/leads\/(csv-import|import\/tax-delinquent)["'`]/.test(f.src))
      .map((f) => f.rel);
    expect(posters.length).toBeGreaterThanOrEqual(2);
    for (const f of posters) expect(CLIENT_MAPPERS.some((m) => m.file === f), `${f} posts mapped lead rows but is not in CLIENT_MAPPERS`).toBe(true);
  });

  it.each([...IMPORT_PATHS, ...CLIENT_MAPPERS].map((m) => [`${m.file} @ ${m.anchor}`, m] as const))(
    "%s uses the shared parsers",
    (_label, m) => {
      const unit = unitAt(read(m.file), m.anchor);
      // Vacuity floor: the unit was found and is a real body, not a stub.
      expect(unit.length, `unit ${m.anchor} not found in ${m.file}`).toBeGreaterThan(200);
      for (const call of m.uses) expect(unit, `${m.file} @ ${m.anchor} must call ${call}`).toContain(call);
    },
  );

  it("the private ad-hoc number parsers the pipeline had are gone", () => {
    const src = read("server/services/taxDelinquentPipeline.ts");
    expect(src).not.toMatch(/function parseAmount\(|function parseAcres\(/);
  });
});
