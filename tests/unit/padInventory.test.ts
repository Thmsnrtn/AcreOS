/**
 * PAD INVENTORY — the gap between a column that can hold a value and an
 * inventory an operator has.
 *
 * WHAT WAS BROKEN
 * ───────────────
 * `rental_units.kind` has enumerated unit | pad | suite since migration 0219,
 * and `POST /api/rentals/properties/:id/units` has accepted it. Full server
 * CRUD was live. And nothing in the product ever wrote `kind: 'pad'`:
 *
 *   - `findOrCreateUnitId` defaulted to "unit" and BOTH its callers (lease
 *     create, lease renewal) omitted the argument entirely;
 *   - the POST route's schema defaulted to "unit";
 *   - the rent-roll importer defaulted its roll-level `unitKind` to "unit" —
 *     and had no caller anywhere in the repo;
 *   - no client code posted to the unit routes AT ALL. The single client-side
 *     use of the units endpoint was a `<datalist>` of label suggestions on
 *     /leases.
 *
 * So a mobile-home park's ground leases — where the resident owns the home and
 * rents the pad — were modelled as apartments, and shared/business-types.ts
 * said it in as many words: "A column that can hold a value is not an inventory
 * an operator has."
 *
 * WHAT THIS FILE PINS
 * ───────────────────
 *   1. Range expansion as a PURE function — no DATABASE_URL here, so
 *      `expandUnitLabels` is exercised directly rather than through a route.
 *   2. The IDEMPOTENCY CONTRACT: `created` and `existed` are disjoint and
 *      exhaustive, and a re-run reports 0 created rather than looking like a
 *      fresh import. The unique index makes a re-run safe; the report is what
 *      keeps it from being a lie.
 *   3. That the PROSE now matches what the code does — the persona voice and
 *      the business-type registry, checked against the actual write sites.
 *
 * SOURCE ASSERTIONS STRIP COMMENTS FIRST. This build has been bitten three
 * times by a regex that matched the comment documenting a removed line rather
 * than the line itself. `code()` below removes every comment before any
 * code-shaped assertion runs, and there is a test for the stripper.
 *
 * The one deliberate exception is `shared/business-types.ts`, whose gap
 * statements ARE comments — the registry's honesty lives in prose next to the
 * data. Those assertions read RAW source, and say so at the call site.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

import {
  expandUnitLabels,
  buildBulkCreateReport,
  describeBulkCreateReport,
  unitVocabulary,
  dominantUnitVocabulary,
  countUnits,
  UNIT_KIND_OPTIONS,
  UNIT_BULK_MAX_LABELS,
  UNIT_LABEL_MAX_LENGTH,
  parseRentRollPaste,
} from "../../shared/rental/unitInventory";
import { BUSINESS_TYPES } from "../../shared/business-types";
import { PERSONAS } from "../../server/services/pax/personas";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/**
 * Source with every comment removed. Block comments first, then trailing and
 * whole-line `//`. `(^|\s)` before the slashes keeps `https://…` intact.
 */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .map((line) => line.replace(/(^|\s)\/\/.*$/, ""))
    .filter((line) => line.trim().length > 0)
    .join("\n");
}

const RENTALS_SRC = read("server/routes-rentals.ts");
const RENTALS_CODE = code(RENTALS_SRC);
const IMPORT_CODE = code(read("server/routes-rent-roll-import.ts"));
const LEASES_PAGE_CODE = code(read("client/src/pages/leases.tsx"));
const UNITS_PANEL_SRC = read("client/src/components/rentals/units-panel.tsx");
const UNITS_PANEL_CODE = code(UNITS_PANEL_SRC);
const SIDEBAR_CODE = code(read("client/src/components/layout-sidebar.tsx"));
const NAV_ITEMS_CODE = code(read("client/src/lib/nav-items.ts"));
const PERSONAS_SRC = read("server/services/pax/personas.ts");
const BUSINESS_TYPES_SRC = read("shared/business-types.ts");

// ---------------------------------------------------------------------------
// The stripper itself. If it stops stripping, every source assertion below is
// suspect — including the ones that assert a phrase is GONE.
// ---------------------------------------------------------------------------

describe("the comment stripper", () => {
  it("removes line, trailing and block comments and keeps the code", () => {
    const stripped = code([
      "// kind: 'pad'",
      "const a = 1; // kind: 'pad'",
      "/* kind: 'pad' */",
      "/*",
      " * kind: 'pad'",
      " */",
      "const b = \"real\";",
    ].join("\n"));
    expect(stripped).not.toContain("'pad'");
    expect(stripped).toContain("const a = 1;");
    expect(stripped).toContain('const b = "real";');
  });

  it("leaves a URL alone", () => {
    expect(code('const u = "https://example.com/x";')).toContain("https://example.com/x");
  });
});

// ---------------------------------------------------------------------------
// 1. Range expansion — pure
// ---------------------------------------------------------------------------

describe("expandUnitLabels — a range, as a pure function", () => {
  it('expands "Lot 1" → "Lot 60" to exactly sixty labels, in order', () => {
    const r = expandUnitLabels({ mode: "range", prefix: "Lot ", start: 1, end: 60 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toHaveLength(60);
    expect(r.expansion.labels[0]).toBe("Lot 1");
    expect(r.expansion.labels[59]).toBe("Lot 60");
    // No hidden de-duplication: a range cannot repeat itself.
    expect(r.expansion.duplicateLabels).toEqual([]);
    expect(r.expansion.submittedCount).toBe(60);
  });

  it("a one-element range is a range", () => {
    const r = expandUnitLabels({ mode: "range", prefix: "Suite ", start: 200, end: 200 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["Suite 200"]);
  });

  it("zero-pads so 7 sorts next to 8 rather than after 70", () => {
    const r = expandUnitLabels({ mode: "range", prefix: "Lot ", start: 7, end: 9, padTo: 3 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["Lot 007", "Lot 008", "Lot 009"]);
  });

  it("supports a suffix, and a bare-number range with no prefix", () => {
    const withSuffix = expandUnitLabels({ mode: "range", prefix: "", suffix: "A", start: 1, end: 2 });
    expect(withSuffix.ok).toBe(true);
    if (withSuffix.ok) expect(withSuffix.expansion.labels).toEqual(["1A", "2A"]);

    const bare = expandUnitLabels({ mode: "range", start: 10, end: 12 });
    expect(bare.ok).toBe(true);
    if (bare.ok) expect(bare.expansion.labels).toEqual(["10", "11", "12"]);
  });

  it("labels are trimmed the way every other write site trims them", () => {
    // " 3B" and "3B" are two labels to the unique index, so a bulk create that
    // did not trim would seed duplicates the importer and the 0219 backfill
    // would never reconcile with.
    const r = expandUnitLabels({ mode: "range", prefix: "  Lot ", suffix: "  ", start: 1, end: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["Lot 1"]);
  });

  it("refuses a range that ends before it starts, and says which way round it is", () => {
    const r = expandUnitLabels({ mode: "range", prefix: "Lot ", start: 60, end: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/ends before it starts/i);
    expect(r.error).toContain("60");
    expect(r.error).toContain("1");
  });

  it("refuses a range wider than the ceiling instead of attempting it", () => {
    const r = expandUnitLabels({ mode: "range", prefix: "Lot ", start: 1, end: UNIT_BULK_MAX_LABELS + 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(new RegExp(String(UNIT_BULK_MAX_LABELS)));
    // A 6,000-lot range is a typo, not an inventory — the refusal says so.
    expect(r.error).toMatch(/typo|batches|smaller/i);
  });

  it("exactly the ceiling is allowed — the boundary is not off by one", () => {
    const r = expandUnitLabels({ mode: "range", start: 1, end: UNIT_BULK_MAX_LABELS });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toHaveLength(UNIT_BULK_MAX_LABELS);
  });

  it("refuses non-integer and negative bounds rather than coercing them", () => {
    expect(expandUnitLabels({ mode: "range", start: 1.5, end: 3 }).ok).toBe(false);
    expect(expandUnitLabels({ mode: "range", start: -1, end: 3 }).ok).toBe(false);
    expect(expandUnitLabels({ mode: "range", start: Number.NaN, end: 3 }).ok).toBe(false);
  });

  it("refuses a prefix/suffix that would push a label past the column's length", () => {
    const r = expandUnitLabels({
      mode: "range",
      prefix: "x".repeat(UNIT_LABEL_MAX_LENGTH),
      start: 1,
      end: 2,
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(new RegExp(String(UNIT_LABEL_MAX_LENGTH)));
  });
});

describe("expandUnitLabels — a pasted list", () => {
  it("splits on newlines and drops blank lines", () => {
    const r = expandUnitLabels({ mode: "list", text: "Lot 1\n\n  Lot 2  \n\nLot 3\n" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["Lot 1", "Lot 2", "Lot 3"]);
  });

  it("also splits on commas, semicolons and tabs — real pastes are messy", () => {
    const r = expandUnitLabels({ mode: "list", text: "3A, 3B; 3C\t3D" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["3A", "3B", "3C", "3D"]);
  });

  it("attempts a repeated label ONCE and reports the repetition rather than hiding it", () => {
    const r = expandUnitLabels({ mode: "list", text: "Lot 1\nLot 2\nLot 1\nLot 2\nLot 3" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["Lot 1", "Lot 2", "Lot 3"]);
    expect(r.expansion.duplicateLabels).toEqual(["Lot 1", "Lot 2"]);
    // The count the operator pasted is preserved, so 5-in / 3-attempted is
    // visible arithmetic rather than a silent shrink.
    expect(r.expansion.submittedCount).toBe(5);
  });

  it("does NOT case-fold — labels are the operator's own vocabulary", () => {
    // "3b" and "3B" are different rows to the unique index, and the label has
    // to match the lease, the mailbox and the work order. Normalising case
    // here would merge two real doors, or silently rename one.
    const r = expandUnitLabels({ mode: "list", text: "3b\n3B" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.expansion.labels).toEqual(["3b", "3B"]);
    expect(r.expansion.duplicateLabels).toEqual([]);
  });

  it("refuses an empty paste and a paste over the ceiling", () => {
    expect(expandUnitLabels({ mode: "list", text: "   \n\n " }).ok).toBe(false);
    const many = Array.from({ length: UNIT_BULK_MAX_LABELS + 1 }, (_, i) => `L${i}`).join("\n");
    const r = expandUnitLabels({ mode: "list", text: many });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/batches/i);
  });

  it("refuses an over-long label instead of truncating it", () => {
    const r = expandUnitLabels({ mode: "list", text: "x".repeat(UNIT_LABEL_MAX_LENGTH + 1) });
    expect(r.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2. The idempotency contract
// ---------------------------------------------------------------------------

describe("bulk create idempotency — the report is the contract", () => {
  const attempted = ["Lot 1", "Lot 2", "Lot 3", "Lot 4"];

  it("created and existed are DISJOINT and together cover every attempted label", () => {
    const report = buildBulkCreateReport(attempted, ["Lot 2", "Lot 4"]);
    expect(report.created).toEqual(["Lot 2", "Lot 4"]);
    expect(report.existed).toEqual(["Lot 1", "Lot 3"]);
    expect(report.created.filter((l) => report.existed.includes(l))).toEqual([]);
    expect([...report.created, ...report.existed].sort()).toEqual([...attempted].sort());
    expect(report.createdCount + report.existedCount).toBe(report.attemptedCount);
  });

  it("a first run creates everything", () => {
    const report = buildBulkCreateReport(attempted, attempted);
    expect(report.createdCount).toBe(4);
    expect(report.existedCount).toBe(0);
  });

  it("RE-RUNNING the same spec creates nothing and says so — it does not look like a fresh import", () => {
    // The whole hazard: the (org, property, label) unique index absorbs the
    // second run, so it cannot duplicate. What it must not do is report the
    // no-op as success-with-work, or an operator who re-pastes their 60-lot
    // roll comes to believe they own 120 pads.
    const report = buildBulkCreateReport(attempted, []);
    expect(report.createdCount).toBe(0);
    expect(report.existedCount).toBe(4);
    expect(report.existed).toEqual(attempted);
    const sentence = describeBulkCreateReport(report, unitVocabulary("pad"));
    expect(sentence).toMatch(/no new pads/i);
    expect(sentence).toContain("4");
    expect(sentence).not.toMatch(/created 4/i);
  });

  it("the partial re-run — six new pads on top of an existing park — reports both numbers", () => {
    const park = Array.from({ length: 60 }, (_, i) => `Lot ${i + 1}`);
    const freshlyCreated = park.slice(54); // Lots 55–60
    const report = buildBulkCreateReport(park, freshlyCreated);
    expect(report.createdCount).toBe(6);
    expect(report.existedCount).toBe(54);
    const sentence = describeBulkCreateReport(report, unitVocabulary("pad"));
    expect(sentence).toContain("6 pads");
    expect(sentence).toContain("54");
    expect(sentence).toMatch(/left untouched/i);
  });

  it("carries the input's own duplicates through to the report", () => {
    const report = buildBulkCreateReport(["Lot 1"], ["Lot 1"], ["Lot 1"]);
    expect(report.duplicateLabels).toEqual(["Lot 1"]);
  });

  it("an empty attempt is 'nothing to create', not a silent success", () => {
    const report = buildBulkCreateReport([], []);
    expect(describeBulkCreateReport(report, unitVocabulary("unit"))).toMatch(/nothing to create/i);
  });
});

describe("the bulk route is wired the way the contract requires", () => {
  it("exists on the EXISTING rentals router, under the property it belongs to", () => {
    expect(RENTALS_CODE).toContain('app.post("/api/rentals/properties/:propertyId/units/bulk"');
  });

  it("is org-scoped and property-scoped before it writes anything", () => {
    expect(RENTALS_CODE).toContain("const orgId = getOrganizationId(req);");
    expect(RENTALS_CODE).toContain("eq(properties.organizationId, orgId)");
    expect(RENTALS_CODE).toContain("organizationId: orgId,");
  });

  it("expands the SPEC server-side rather than trusting a client-sent label array", () => {
    // If the client sent labels, the preview an operator approved and the rows
    // actually written could diverge. The spec goes through the same pure
    // function on both sides.
    expect(RENTALS_CODE).toContain("expandUnitLabels(parsed.data.spec)");
    expect(RENTALS_CODE).not.toContain("parsed.data.labels");
  });

  it("leans on the unique index rather than a read-then-write race", () => {
    expect(RENTALS_CODE).toContain("onConflictDoNothing()");
    expect(RENTALS_CODE).toContain("buildBulkCreateReport(");
  });

  it("normalises every label through the one normaliser", () => {
    expect(RENTALS_CODE).toContain("attempted = expansion.expansion.labels.map((l) => normalizeUnitLabel(l))");
  });

  it("refuses a bad spec with the pure function's own sentence, via Errors.badRequest", () => {
    expect(RENTALS_CODE).toContain("Errors.badRequest(res, expansion.error");
    expect(RENTALS_CODE).toContain("RENTAL_UNIT_BULK_SPEC_INVALID");
  });

  it("takes NO physical facts in bulk — 60 pads do not share a bedroom count", () => {
    const schemaStart = RENTALS_CODE.indexOf("const unitBulkCreateSchema");
    const schemaEnd = RENTALS_CODE.indexOf("export function registerRentalRoutes");
    expect(schemaStart).toBeGreaterThanOrEqual(0);
    const schema = RENTALS_CODE.slice(schemaStart, schemaEnd);
    expect(schema).toContain("kind: z.enum(RENTAL_UNIT_KINDS)");
    expect(schema).not.toContain("bedrooms");
    expect(schema).not.toContain("bathrooms");
    expect(schema).not.toContain("marketRentCents");
  });
});

// ---------------------------------------------------------------------------
// 3. `kind` now flows — the write sites
// ---------------------------------------------------------------------------

describe("something in the product finally writes kind: 'pad'", () => {
  it("the lease form's caller passes the kind it knows into findOrCreateUnitId", () => {
    expect(RENTALS_CODE).toContain("kind: parsed.data.unitKind,");
    expect(RENTALS_CODE).toContain("unitKind: z.enum(RENTAL_UNIT_KINDS).optional()");
  });

  it("the /leases client posts unitKind — the field is not merely accepted, it is sent", () => {
    expect(LEASES_PAGE_CODE).toContain("unitKind,");
    expect(LEASES_PAGE_CODE).toContain("setUnitKind");
    // The existing label passthrough is untouched.
    expect(LEASES_PAGE_CODE).toContain("unitLabel: unitLabel || undefined");
  });

  it("the units panel posts to the create, bulk and rent-roll-import routes", () => {
    expect(UNITS_PANEL_CODE).toContain("/api/rentals/properties/${propertyId}/units`");
    expect(UNITS_PANEL_CODE).toContain("/api/rentals/properties/${propertyId}/units/bulk`");
    // The importer's `unitKind` had NO caller anywhere in the repo before this.
    expect(UNITS_PANEL_CODE).toContain("/api/parcels/${propertyId}/rent-roll/import`");
    expect(UNITS_PANEL_CODE).toContain("unitKind: kind,");
  });

  it("the units panel can edit and retire, not only create", () => {
    expect(UNITS_PANEL_CODE).toContain('"PATCH"');
    expect(UNITS_PANEL_CODE).toContain('status: "retired"');
    expect(UNITS_PANEL_CODE).toContain('"DELETE"');
  });

  it("the rent-roll importer still applies kind on CREATE only", () => {
    // A conflict must leave the operator's own kind alone rather than resetting
    // a park's pads to 'unit' on the second upload.
    expect(IMPORT_CODE).toContain("kind: u.kind ?? parsed.data.unitKind");
    expect(IMPORT_CODE).toContain("onConflictDoNothing()");
  });

  it("nothing INFERS a kind from a property or a label", () => {
    // Guessing 'pad' from structure_type, or from a label that reads "Lot 14",
    // would put a fact in the record that nobody asserted.
    expect(RENTALS_CODE).not.toMatch(/structureType[\s\S]{0,80}pad/i);
    expect(UNITS_PANEL_CODE).not.toMatch(/structureType/i);
    expect(RENTALS_CODE).not.toMatch(/startsWith\(["']Lot/i);
  });
});

describe("the rent-roll paste — the importer's first driver", () => {
  it("reads the fixed column order and never sniffs headers", () => {
    const { rows, errors } = parseRentRollPaste("Lot 1, Maria, Lopez, 1400");
    expect(errors).toEqual([]);
    expect(rows).toEqual([
      { unit: "Lot 1", tenantFirst: "Maria", tenantLast: "Lopez", rentCents: 140000, isVacant: false },
    ]);
  });

  it("treats a row with no tenant name as VACANT — the shape every seller's roll arrives in", () => {
    const { rows } = parseRentRollPaste("Lot 1, Maria, Lopez, 1400\nLot 2, , , 1350");
    expect(rows[1].isVacant).toBe(true);
    expect(rows[1].tenantFirst).toBeUndefined();
    // Vacant rows are KEPT. The importer used to open its loop with
    // `if (u.isVacant) continue;`, discarding exactly the rows occupancy needs.
    expect(rows).toHaveLength(2);
  });

  it("does NOT infer vacancy from a zero rent — a $0 line is an employee unit", () => {
    const { rows } = parseRentRollPaste("Lot 3, Sven, Ek, 0");
    expect(rows[0].isVacant).toBe(false);
    expect(rows[0].rentCents).toBe(0);
  });

  it("names an unreadable rent instead of guessing at it", () => {
    const { rows, errors } = parseRentRollPaste("Lot 1, A, B, twelve hundred");
    expect(rows).toEqual([]);
    expect(errors[0]).toMatch(/Line 1/);
    expect(errors[0]).toMatch(/not a rent amount/i);
  });

  it("tolerates a currency symbol, blank lines and stray whitespace", () => {
    const { rows, errors } = parseRentRollPaste("\n  Lot 1 , Maria , Lopez , $1400.50 \n\n");
    expect(errors).toEqual([]);
    expect(rows[0].unit).toBe("Lot 1");
    expect(rows[0].tenantFirst).toBe("Maria");
    expect(rows[0].rentCents).toBe(140050);
  });

  it("REFUSES a thousands separator rather than silently reading $1,400 as $1", () => {
    // The comma is the column separator, so "$1,400" splits into "$1" and
    // "400" — five columns. Reading the rent as $1.00 and writing it onto a
    // real tenancy is the worst available outcome, and it would be silent.
    const { rows, errors } = parseRentRollPaste("Lot 1, Maria, Lopez, $1,400");
    expect(rows).toEqual([]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/Line 1/);
    expect(errors[0]).toMatch(/5 columns, expected 4/);
    expect(errors[0]).toMatch(/thousands separator/i);
  });
});

// ---------------------------------------------------------------------------
// The nav hard-stop
// ---------------------------------------------------------------------------

describe("the surface adds no nav entry — the five doors are fixed", () => {
  it("is a TAB on the existing /leases surface", () => {
    expect(LEASES_PAGE_CODE).toContain("<UnitsPanel />");
    expect(LEASES_PAGE_CODE).toContain('<TabsTrigger value="units"');
    expect(LEASES_PAGE_CODE).toContain('<TabsTrigger value="leases"');
  });

  it("no sidebar module, child or overflow entry points at a units route", () => {
    expect(SIDEBAR_CODE).not.toContain('href: "/units"');
    expect(SIDEBAR_CODE).not.toContain('href: "/rental-units"');
    expect(NAV_ITEMS_CODE).not.toContain('"/units"');
  });

  it("adds no route to the app router either", () => {
    const appCode = code(read("client/src/App.tsx"));
    expect(appCode).not.toContain('path="/units"');
    expect(appCode).not.toContain('path="/rental-units"');
  });
});

// ---------------------------------------------------------------------------
// Vocabulary — a park operator manages pads, not "units"
// ---------------------------------------------------------------------------

describe("the discriminator reaches the words on the screen", () => {
  it("names each kind in its operator's own vocabulary", () => {
    expect(unitVocabulary("pad").plural).toBe("pads");
    expect(unitVocabulary("pad").titleSingular).toBe("Pad");
    expect(unitVocabulary("pad").description).toMatch(/owns the home and rents the ground/i);
    expect(unitVocabulary("suite").plural).toBe("suites");
    expect(unitVocabulary("unit").plural).toBe("units");
    expect(UNIT_KIND_OPTIONS.map((k) => k.kind)).toEqual(["unit", "pad", "suite"]);
  });

  it("falls back to the neutral noun for an unknown or missing kind", () => {
    expect(unitVocabulary(null).kind).toBe("unit");
    expect(unitVocabulary("cabin").kind).toBe("unit");
  });

  it("a property of all pads is spoken of as pads; a mixed one is not mislabelled", () => {
    expect(dominantUnitVocabulary(["pad", "pad", "pad"]).plural).toBe("pads");
    // No majority rule — calling a suite a pad because most rows are pads is
    // exactly the mislabelling the discriminator exists to prevent.
    expect(dominantUnitVocabulary(["pad", "pad", "suite"]).plural).toBe("units");
    expect(dominantUnitVocabulary([]).plural).toBe("units");
  });

  it("counts agree with the noun", () => {
    expect(countUnits(1, unitVocabulary("pad"))).toBe("1 pad");
    expect(countUnits(60, unitVocabulary("pad"))).toBe("60 pads");
  });

  it("the units panel speaks in the chosen kind's words rather than hardcoding 'unit'", () => {
    expect(UNITS_PANEL_CODE).toContain("unitVocabulary(");
    expect(UNITS_PANEL_CODE).toContain("dominantUnitVocabulary(");
  });
});

// ---------------------------------------------------------------------------
// 4. The prose now matches the code
// ---------------------------------------------------------------------------

describe("the mobile_home registry entry states the pad gap as CLOSED", () => {
  // NOTE: these read RAW source on purpose. The registry's honesty lives in
  // comments beside the data, so stripping them would leave nothing to assert.
  // Every other source assertion in this file is comment-stripped.
  const entryStart = BUSINESS_TYPES_SRC.indexOf("mobile_home: {");
  const entry = BUSINESS_TYPES_SRC.slice(entryStart, BUSINESS_TYPES_SRC.indexOf("agent_investor: {"));
  // The comment block is hard-wrapped, so every sentence straddles newlines
  // AND `//` markers. Strip the markers and collapse whitespace, then match —
  // a raw match here would pass or fail on where the line happened to wrap.
  const flat = entry.replace(/^\s*\/\/ ?/gm, "").replace(/\s+/g, " ");

  it("no longer claims nothing in the product writes 'pad'", () => {
    expect(entryStart).toBeGreaterThanOrEqual(0);
    expect(flat).not.toContain("A column that can hold a value is not an inventory an operator has");
    expect(flat).not.toMatch(/nothing in the product ever writes 'pad'/i);
    expect(flat).not.toMatch(/no populated lot\/pad inventory/i);
  });

  it("names the write paths that closed it", () => {
    expect(flat).toMatch(/PAD INVENTORY — CLOSED/);
    expect(flat).toMatch(/units surface/i);
    expect(flat).toMatch(/bulk/i);
    expect(flat).toMatch(/idempotent/i);
  });

  it("the home side is now DELIVERED (Wave 5 core), disclosing only the genuine residuals", () => {
    // REWRITTEN at the flip (not deleted): the two gaps this used to pin as
    // out-of-scope — home-as-chattel handling and utilities pass-through — are
    // now built (shared/rental/lotRentSplit.ts + utilityBillback.ts), so the
    // registry NAMES them delivered and discloses only what an honest core cannot
    // reach: submarket lot-rent comps and DMV/VIN title verification.
    expect(flat).toMatch(/home-vs-lot rent SPLIT/i);
    expect(flat).toMatch(/utility pass-through billback/i);
    expect(flat).toMatch(/submarket lot-rent comps/i);
    expect(flat).toMatch(/VERIFICATION/i);
  });

  it("maturity is now CORE (Wave 5) — the home-side engines are built, not disclosed as gaps", () => {
    // REWRITTEN at the flip (not deleted): Wave 5 built the home-vs-lot rent
    // split + POH/TOH mix engine and the submeter/RUBS utility-billback engine,
    // each a pure tested engine that refuses rather than fabricates, so the two
    // named core gaps are closed and calling mobile_home "core" is honest. Core
    // still does NOT claim submarket lot-rent comps or DMV/VIN title
    // verification — those residuals are disclosed, not fabricated.
    expect(BUSINESS_TYPES.mobile_home.maturity).toBe("core");
  });
});

describe("the Pax mobile-homes voice matches what the product does", () => {
  const p = PERSONAS.mobile_homes;
  // Hard-wrapped prose: phrases straddle newlines, so flatten before matching.
  const flat = p.systemPromptAppendix.replace(/\s+/g, " ");

  it("says the platform models pad inventory, and how", () => {
    expect(flat).toMatch(/AcreOS models pad inventory/i);
    expect(flat).toMatch(/create, edit and retire/i);
    expect(flat).toMatch(/Lot 1.{0,20}Lot 60|in bulk/i);
    expect(flat).toMatch(/occupancy is computed over those pads/i);
  });

  it("drops the retired claims entirely", () => {
    expect(flat).not.toMatch(/no lot\/pad inventory model/i);
    expect(flat).not.toMatch(/nothing in AcreOS creates one today/i);
    expect(flat).not.toMatch(/treat the pad inventory as absent/i);
  });

  it("the never-imply enumeration now guards VERIFICATION / comps / sale-execution, not the home side itself", () => {
    // REWRITTEN at the flip: the platform now MODELS home titles (record-only)
    // and submetering, so the voice no longer says "never imply titles or
    // submetering" — it guards the honest residuals instead.
    expect(flat).toMatch(/never imply title verification/i);
    expect(flat).not.toMatch(/never imply the platform models pads/i);
  });

  it("offers the home side (split + billback) while refusing verification / comps / sale execution", () => {
    // REWRITTEN at the flip: chattel titles and utilities pass-through are now
    // real (record-only titles; submeter/RUBS billback), so the voice offers
    // them and refuses only the honest residuals.
    expect(flat).toMatch(/home-vs-lot rent split/i);
    expect(flat).toMatch(/utilities pass-through is billed/i);
    expect(flat).toMatch(/never imply title verification/i);
  });

  it("the appendix's pad claim is backed by a real write site, not just prose", () => {
    // The failure mode this file exists to prevent is prose drifting ahead of
    // code. Tie the sentence to the route that makes it true.
    expect(flat).toMatch(/AcreOS models pad inventory/i);
    expect(RENTALS_CODE).toContain('app.post("/api/rentals/properties/:propertyId/units/bulk"');
    expect(UNITS_PANEL_CODE).toContain("units/bulk");
    // And the persona file itself carries no leftover absence claim.
    expect(code(PERSONAS_SRC)).not.toMatch(/treat the pad inventory as absent/i);
  });
});
