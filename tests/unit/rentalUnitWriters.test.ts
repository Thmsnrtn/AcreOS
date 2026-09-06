/**
 * Who actually WRITES a rental unit — and the tenancies that used to fall
 * through the gap.
 *
 * `rental_units` landed with occupancy computed from it, and almost nothing
 * capable of putting a row in it. Four verified consequences, each pinned
 * below:
 *
 *   1. RENEWAL VACATED A TENANT. `POST /api/leases/:id/renew` copied
 *      `unitLabel` but not `unitId`, then flipped the parent to 'renewed'. The
 *      only ACTIVE lease for the tenancy was the new row, with unit_id NULL —
 *      so the occupancy join found nothing and a unit with somebody living in
 *      it read VACANT. A landlord who renews every tenant watched occupancy
 *      fall toward 0% on a full building.
 *
 *   2. THE UI PATH MODELLED NO UNIT AT ALL. `POST /api/leases` wrote
 *      `unit_label` only, so an org that enters leases through /leases never
 *      created a single unit and occupancy answered
 *      `measurable: false, reason: "no_units_modelled"` forever.
 *
 *   3. THE EMPTY STATE NAMED AN IMPOSSIBLE ACTION. It told the operator to
 *      "add units to a property", and no unit CRUD existed anywhere.
 *
 *   4. LABELS DIVERGED FROM THE BACKFILL. Migration 0219 writes
 *      TRIM(unit_label); the importer wrote its raw string. " 3B" and "3B" are
 *      two labels, so the unique index waves the second one through and BOTH
 *      sit in the occupancy denominator of a building that has one 3B.
 *
 * There is no DATABASE_URL in this environment, so the arithmetic and the
 * refusal predicate are tested as pure functions, and the wiring is asserted
 * against the route files AS CODE — comments are stripped first. That is not
 * pedantry: a previous test in this repo matched a comment that quoted the very
 * line it was meant to pin and passed vacuously after the code moved.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";
import {
  normalizeUnitLabel,
  trimLeaseUnitLabel,
  unitDeletionRefusal,
  WHOLE_PROPERTY_UNIT_LABEL,
} from "../../server/routes-rentals";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/**
 * Source with every comment removed. Block comments go first, then trailing
 * and whole-line `//`. `(^|\s)` before the slashes keeps `https://…` intact.
 */
function code(src: string): string {
  return stripComments(src);
}

/** The body of one Express handler, comment-free: from its registration to the next one. */
function handler(src: string, registration: string): string {
  const stripped = code(src);
  const start = stripped.indexOf(registration);
  expect(start, `handler not found: ${registration}`).toBeGreaterThanOrEqual(0);
  const rest = stripped.slice(start + registration.length);
  const next = rest.search(/\n\s*app\.(get|post|patch|put|delete)\(/);
  return rest.slice(0, next === -1 ? undefined : next);
}

const RENTALS_SRC = read("server/routes-rentals.ts");
const IMPORT_SRC = read("server/routes-rent-roll-import.ts");
const MIGRATION_SRC = read("migrations/0219_rental_units.sql");
const LEASES_PAGE_SRC = read("client/src/pages/leases.tsx");

const RENTALS_CODE = code(RENTALS_SRC);
const IMPORT_CODE = code(IMPORT_SRC);

// ---------------------------------------------------------------------------
// The comment-stripper itself. If it stops stripping, every assertion below
// silently weakens into "the file mentions this somewhere", which is exactly
// the failure this file exists to avoid.
// ---------------------------------------------------------------------------

describe("assertions run against code, not prose", () => {
  it("strips line comments, trailing comments and block comments", () => {
    const src = [
      "// unitId: parent.unitId,",
      "const kept = 1; // unitId: parent.unitId,",
      "/* unitId: parent.unitId, */",
      "/**",
      " * unitId: parent.unitId,",
      " */",
      "const alsoKept = 2;",
    ].join("\n");
    const out = code(src);
    expect(out).not.toContain("unitId: parent.unitId,");
    expect(out).toContain("const kept = 1;");
    expect(out).toContain("const alsoKept = 2;");
  });

  it("leaves URLs alone", () => {
    expect(code('const u = "https://example.test/x";')).toContain("https://example.test/x");
  });
});

// ---------------------------------------------------------------------------
// FINDING 12 — one normalisation, and it is the migration's.
// ---------------------------------------------------------------------------

describe("a unit label means the same thing at every write site", () => {
  it("blank, whitespace-only, null and undefined all map to the backfill's literal", () => {
    for (const blank of ["", "   ", "\t", "\n ", null, undefined]) {
      expect(normalizeUnitLabel(blank)).toBe(WHOLE_PROPERTY_UNIT_LABEL);
    }
  });

  it("the literal is the one migration 0219 actually wrote — not a retyped copy", () => {
    // The backfill's whole-property label is the source of truth. If these
    // ever disagree, an SFR lease created through the API gets a SECOND unit
    // beside the backfilled one and the building's denominator doubles.
    // (0219 disambiguates a collision with an operator-typed 'Whole property'
    // into 'Whole property (2)' … — the FIRST candidate, and the one every
    // ordinary property lands on, is the bare literal asserted here.)
    expect(MIGRATION_SRC).toMatch(
      new RegExp(`SELECT\\s+'${WHOLE_PROPERTY_UNIT_LABEL}'\\s+AS label`),
    );
    expect(WHOLE_PROPERTY_UNIT_LABEL).toBe("Whole property");
  });

  it("trims exactly as TRIM(unit_label) does, so ' 3B' and '3B' are ONE unit", () => {
    expect(MIGRATION_SRC).toContain(`TRIM(l."unit_label")`);
    expect(normalizeUnitLabel(" 3B")).toBe("3B");
    expect(normalizeUnitLabel("3B ")).toBe("3B");
    expect(normalizeUnitLabel("  3B  ")).toBe(normalizeUnitLabel("3B"));
  });

  it("does not otherwise touch the operator's vocabulary", () => {
    // The label has to match the lease, the mailbox and the work order. Case
    // folding "Lot 14" to "lot 14" would send a maintenance ticket to a door
    // that is not what the landlord calls it.
    expect(normalizeUnitLabel("Lot 14")).toBe("Lot 14");
    expect(normalizeUnitLabel("Suite 200-B")).toBe("Suite 200-B");
    expect(normalizeUnitLabel("3b")).toBe("3b");
  });

  it("the lease's DISPLAY copy trims too, but stays null when nothing was given", () => {
    // Deliberately NOT normalizeUnitLabel: the lease joins to the
    // 'Whole property' unit by unit_id, and stamping that phrase into the
    // human-facing string would invent a label the landlord never used —
    // which is also what 0219 chose (it left unit_label untouched).
    expect(trimLeaseUnitLabel("  3B  ")).toBe("3B");
    expect(trimLeaseUnitLabel("")).toBeNull();
    expect(trimLeaseUnitLabel("   ")).toBeNull();
    expect(trimLeaseUnitLabel(null)).toBeNull();
    expect(trimLeaseUnitLabel(undefined)).toBeNull();
  });

  it("the importer no longer writes its raw string", () => {
    expect(IMPORT_CODE).toContain("normalizeUnitLabel(u.unit)");
    // The two raw writes that produced the duplicate " 3B".
    expect(IMPORT_CODE).not.toContain("label: u.unit,");
    expect(IMPORT_CODE).not.toContain("unitLabel: u.unit,");
    // Belt and braces at the schema edge.
    expect(IMPORT_CODE).toMatch(/unit:\s*z\.string\(\)\.trim\(\)/);
  });

  it("the unit create and patch routes normalise too", () => {
    const create = handler(RENTALS_SRC, `app.post("/api/rentals/properties/:propertyId/units"`);
    expect(create).toContain("normalizeUnitLabel(parsed.data.label)");
    const patch = handler(RENTALS_SRC, `app.patch("/api/rentals/units/:id"`);
    expect(patch).toContain("normalizeUnitLabel(parsed.data.label)");
  });
});

// ---------------------------------------------------------------------------
// FINDING 1 — the renewal that vacated a tenant.
// ---------------------------------------------------------------------------

describe("renewing a lease keeps the tenant in their unit", () => {
  const renew = handler(RENTALS_SRC, `app.post("/api/leases/:id/renew"`);

  it("carries the parent's unitId onto the renewal lease", () => {
    expect(renew).toContain("parent.unitId");
    expect(renew).toMatch(/unitId:\s*renewedUnitId/);
  });

  it("the renewal insert sets unitId in the SAME values() as unitLabel", () => {
    // The defect was precisely that unitLabel was carried and unitId was not.
    const values = renew.slice(renew.indexOf("tx.insert(rentalLeases)"));
    const unitIdAt = values.search(/\bunitId:/);
    const unitLabelAt = values.search(/\bunitLabel:/);
    expect(unitIdAt).toBeGreaterThanOrEqual(0);
    expect(unitLabelAt).toBeGreaterThanOrEqual(0);
  });

  it("falls back to find-or-create so a pre-0219 parent still gets a real unit", () => {
    expect(renew).toContain("findOrCreateUnitId");
  });

  it("refuses rather than writing a renewal with a null unit", () => {
    expect(renew).toMatch(/if\s*\(!renewedUnitId\)/);
    expect(renew).toContain("throw new Error");
  });
});

// ---------------------------------------------------------------------------
// FINDING 2 — the lease-creation path that modelled no unit.
// ---------------------------------------------------------------------------

describe("creating a lease creates (or finds) its unit", () => {
  const create = handler(RENTALS_SRC, `app.post("/api/leases"`);

  it("resolves a unitId and puts it on the lease", () => {
    expect(create).toMatch(/const unitId = await findOrCreateUnitId\(/);
    expect(create).toMatch(/\n\s*unitId,/);
  });

  it("does it inside the same transaction as the lease insert", () => {
    const txAt = create.indexOf("db.transaction");
    const findAt = create.indexOf("findOrCreateUnitId");
    const insertAt = create.indexOf("tx.insert(rentalLeases)");
    expect(txAt).toBeGreaterThanOrEqual(0);
    // Both the find-or-create and the lease insert live after the transaction
    // opens, so a failure cannot leave a half-linked lease behind.
    expect(findAt).toBeGreaterThan(txAt);
    expect(insertAt).toBeGreaterThan(findAt);
  });

  it("uses the transaction handle, not the ambient db, for the unit write", () => {
    expect(create).toMatch(/findOrCreateUnitId\(tx,/);
  });

  it("writes the trimmed display copy rather than the raw request string", () => {
    expect(create).toContain("unitLabel: trimLeaseUnitLabel(parsed.data.unitLabel)");
    expect(create).not.toContain("unitLabel: parsed.data.unitLabel ?? null");
  });

  it("refuses rather than writing an unlinked lease", () => {
    expect(create).toMatch(/if\s*\(!unitId\)/);
    expect(create).toContain("throw new Error");
  });
});

// ---------------------------------------------------------------------------
// FINDING 5 — the empty state's instruction is now performable.
// ---------------------------------------------------------------------------

describe("unit CRUD exists, on the rentals router (no new top-level nav)", () => {
  it("the empty state still names 'add units to a property'", () => {
    expect(RENTALS_SRC).toContain("add units to a property or import a rent roll");
  });

  it("registers list / create / edit / delete", () => {
    expect(RENTALS_CODE).toContain(`app.get("/api/rentals/properties/:propertyId/units"`);
    expect(RENTALS_CODE).toContain(`app.post("/api/rentals/properties/:propertyId/units"`);
    expect(RENTALS_CODE).toContain(`app.patch("/api/rentals/units/:id"`);
    expect(RENTALS_CODE).toContain(`app.delete("/api/rentals/units/:id"`);
  });

  it("every unit route is org-scoped and auth-gated", () => {
    // Each route's org scope, in the form that route actually takes: the reads
    // and writes filter on it, the create stamps it.
    const orgScope: Array<[string, string]> = [
      [`app.get("/api/rentals/properties/:propertyId/units"`, "eq(rentalUnits.organizationId, orgId)"],
      [`app.post("/api/rentals/properties/:propertyId/units"`, "organizationId: orgId"],
      [`app.patch("/api/rentals/units/:id"`, "eq(rentalUnits.organizationId, orgId)"],
      [`app.delete("/api/rentals/units/:id"`, "eq(rentalUnits.organizationId, orgId)"],
    ];
    for (const [reg, scope] of orgScope) {
      const body = handler(RENTALS_SRC, reg);
      expect(body, reg).toContain("isAuthenticated");
      expect(body, reg).toContain("getOrganizationId(req)");
      expect(body, reg).toContain(scope);
    }
  });

  it("the property-scoped routes verify the property belongs to the org first", () => {
    // Without this, a caller could list or add units on somebody else's parcel
    // by guessing a numeric id.
    for (const reg of [
      `app.get("/api/rentals/properties/:propertyId/units"`,
      `app.post("/api/rentals/properties/:propertyId/units"`,
    ]) {
      const body = handler(RENTALS_SRC, reg);
      expect(body, reg).toContain("eq(properties.organizationId, orgId)");
      expect(body, reg).toContain(`Errors.notFound(res, "Property")`);
    }
  });

  it("uses AuthenticatedRequest and Errors.* rather than (req as any) / raw statuses", () => {
    for (const reg of [
      `app.get("/api/rentals/properties/:propertyId/units"`,
      `app.post("/api/rentals/properties/:propertyId/units"`,
      `app.patch("/api/rentals/units/:id"`,
      `app.delete("/api/rentals/units/:id"`,
    ]) {
      const body = handler(RENTALS_SRC, reg);
      expect(body, reg).toContain("req: AuthenticatedRequest");
      expect(body, reg).not.toContain("req as any");
      expect(body, reg).not.toContain("res.status(");
      expect(body, reg).toContain("Errors.internal(res, err)");
    }
  });

  it("create and patch are zod-validated", () => {
    expect(handler(RENTALS_SRC, `app.post("/api/rentals/properties/:propertyId/units"`))
      .toContain("unitCreateSchema.safeParse(req.body)");
    expect(handler(RENTALS_SRC, `app.patch("/api/rentals/units/:id"`))
      .toContain("unitUpdateSchema.safeParse(req.body)");
  });
});

// ---------------------------------------------------------------------------
// FINDING 5 (delete) — never orphan a tenancy.
// ---------------------------------------------------------------------------

describe("deleting a unit refuses while a lease references it", () => {
  it("no leases: deletable", () => {
    expect(unitDeletionRefusal("3B", 0)).toBeNull();
    expect(unitDeletionRefusal("3B", -1)).toBeNull();
  });

  it("one lease: refused, and the message names the count", () => {
    const msg = unitDeletionRefusal("3B", 1);
    expect(msg).not.toBeNull();
    expect(msg).toContain("1 lease");
    expect(msg).not.toContain("1 leases");
    expect(msg).toContain("3B");
  });

  it("several leases: refused, pluralised, count named", () => {
    const msg = unitDeletionRefusal("Lot 14", 4);
    expect(msg).not.toBeNull();
    expect(msg).toContain("4 leases");
    expect(msg).toContain("Lot 14");
  });

  it("offers the non-destructive alternative instead of a dead end", () => {
    // 'retired' takes a unit out of the occupancy denominator without
    // detaching anybody's tenancy — that is the honest way out.
    expect(unitDeletionRefusal("3B", 2)).toContain("retired");
  });

  it("the route counts leases and short-circuits BEFORE the delete", () => {
    const del = handler(RENTALS_SRC, `app.delete("/api/rentals/units/:id"`);
    expect(del).toContain("unitDeletionRefusal(");
    const refusalAt = del.indexOf("unitDeletionRefusal(");
    const deleteAt = del.indexOf("db.delete(rentalUnits)");
    expect(refusalAt).toBeGreaterThanOrEqual(0);
    expect(deleteAt).toBeGreaterThan(refusalAt);
    // The count is over leases pointing at THIS unit, org-scoped.
    expect(del).toContain("eq(rentalLeases.unitId, unit.id)");
    expect(del).toContain("eq(rentalLeases.organizationId, orgId)");
    expect(del).toContain("Errors.badRequest(res, refusal");
  });
});

// ---------------------------------------------------------------------------
// FINDING 8 — 'pad' and 'suite' are reachable.
// ---------------------------------------------------------------------------

describe("kind has writers, so a mobile-home park can model pads", () => {
  it("create accepts kind, defaulting to 'unit' and inferring nothing", () => {
    expect(RENTALS_CODE).toMatch(/kind:\s*z\.enum\(RENTAL_UNIT_KINDS\)\.default\("unit"\)/);
    const create = handler(RENTALS_SRC, `app.post("/api/rentals/properties/:propertyId/units"`);
    expect(create).toContain("kind: parsed.data.kind");
  });

  it("patch can change kind", () => {
    const patch = handler(RENTALS_SRC, `app.patch("/api/rentals/units/:id"`);
    expect(patch).toMatch(/parsed\.data\.kind !== undefined/);
    expect(patch).toContain("updates.kind = parsed.data.kind");
  });

  it("the importer sets kind, per row or per roll, defaulting to 'unit'", () => {
    expect(IMPORT_CODE).toMatch(/kind:\s*z\.enum\(RENTAL_UNIT_KINDS\)\.optional\(\)/);
    expect(IMPORT_CODE).toMatch(/unitKind:\s*z\.enum\(RENTAL_UNIT_KINDS\)\.default\("unit"\)/);
    expect(IMPORT_CODE).toContain("kind: u.kind ?? parsed.data.unitKind");
  });

  it("find-or-create applies kind on CREATE only, never clobbering an edit", () => {
    // A conflict means the operator already owns that row. An import must not
    // reset a park's pads back to 'unit'.
    const helper = RENTALS_CODE.slice(
      RENTALS_CODE.indexOf("async function findOrCreateUnitId"),
      RENTALS_CODE.indexOf("const unitCreateSchema"),
    );
    expect(helper).toContain("onConflictDoNothing()");
    const conflictReadAt = helper.indexOf("tx.select({ id: rentalUnits.id })");
    expect(conflictReadAt).toBeGreaterThan(helper.indexOf("kind: args.kind ?? \"unit\""));
    expect(helper.slice(conflictReadAt)).not.toContain("kind");
  });
});

// ---------------------------------------------------------------------------
// FINDINGS 14 + 16 — a re-import is honest, and nothing is dropped silently.
// ---------------------------------------------------------------------------

describe("the rent-roll import never reports success over a silent drop", () => {
  it("counts and returns skipped rows with a reason", () => {
    expect(IMPORT_CODE).toContain("skippedRows: SkippedRow[]");
    expect(IMPORT_CODE).toContain("skippedRowCount: skippedRows.length");
    expect(IMPORT_CODE).toMatch(/reason:\s*"unit_unresolved"/);
    expect(IMPORT_CODE).toMatch(/reason:\s*"no_tenant_identity"/);
  });

  it("the unresolved-unit branch pushes a skip instead of only warning", () => {
    // It used to `continue` on a logger.warn alone: for an OCCUPIED row that
    // dropped the tenant, the lease and the charge with no counter moving.
    const warnAt = IMPORT_CODE.indexOf("unit insert conflicted but no matching unit found");
    expect(warnAt).toBeGreaterThanOrEqual(0);
    const after = IMPORT_CODE.slice(warnAt, warnAt + 900);
    expect(after).toContain("skippedRows.push(");
    expect(after.indexOf("skippedRows.push(")).toBeLessThan(after.indexOf("continue;"));
  });

  it("an occupied row with no tenant name is recorded, not swallowed", () => {
    expect(IMPORT_CODE).not.toContain("if (!u.tenantFirst && !u.tenantLast) continue;");
  });

  it("returns rowsSubmitted so the caller can check the arithmetic itself", () => {
    expect(IMPORT_CODE).toContain("rowsSubmitted: parsed.data.units.length");
  });

  it("a re-upload does not create a second active lease on the same unit", () => {
    // FINDING 14, the half that was corrupting data: only the unit insert was
    // conflict-guarded, so a second upload duplicated every tenant and put a
    // second ACTIVE lease on every unit.
    expect(IMPORT_CODE).toContain("eq(rentalLeases.unitId, unitId)");
    expect(IMPORT_CODE).toMatch(/eq\(rentalLeases\.status,\s*"active"\)/);
    expect(IMPORT_CODE).toMatch(/if\s*\(activeLease\)\s*\{/);
    expect(IMPORT_CODE).toContain("existingLeases++");
  });

  it("the tenancy guard runs BEFORE the tenant insert, so people stop duplicating too", () => {
    const guardAt = IMPORT_CODE.indexOf("const [activeLease]");
    const tenantAt = IMPORT_CODE.indexOf("tx.insert(tenants)");
    expect(guardAt).toBeGreaterThanOrEqual(0);
    expect(tenantAt).toBeGreaterThan(guardAt);
  });

  it("documents that PEOPLE are deliberately not de-duplicated", () => {
    // The decision is recorded in prose next to the guard, so a future reader
    // does not "finish the job" by merging two different Maria Lopezes.
    expect(IMPORT_SRC).toContain("no natural key for a human");
  });
});

// ---------------------------------------------------------------------------
// Client — the free-text field now feeds the find-or-create.
// ---------------------------------------------------------------------------

describe("the /leases unit field feeds the find-or-create", () => {
  const pageCode = code(LEASES_PAGE_SRC);

  it("still posts unitLabel, and adds no new route", () => {
    expect(pageCode).toContain("unitLabel: unitLabel || undefined");
    expect(pageCode).toContain("/api/rentals/properties/${propertyIdNum}/units");
  });

  it("suggests the property's existing labels so a near-miss isn't typed", () => {
    expect(pageCode).toContain("lease-unit-label-options");
    expect(pageCode).toContain("<datalist");
  });

  it("the input keeps a real label association and describes what blank means", () => {
    expect(pageCode).toContain(`htmlFor="lease-unit-label"`);
    expect(pageCode).toContain(`id="lease-unit-label"`);
    expect(LEASES_PAGE_SRC).toContain("whole-property tenancy");
  });

  it("surfaces the server's refusal message instead of 'Failed (400)'", () => {
    expect(pageCode).toContain("body?.message");
  });
});
