/**
 * The per-building analytics surface, and the two things it used to assert
 * without knowing.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Scoping the multifamily gaps turned up that the registry comment shipped
 * with the units build was itself wrong: it said "there is no NOI-per-building
 * surface at all". There is one — `GET /api/properties/:id/analytics`. What is
 * actually wrong with it is narrower and worse than its absence would be:
 *
 *   1. `const vacantUnits = 0;  // we don't track unit count on a property yet`
 *      Vacancy on this surface was HARDCODED to zero, so a half-empty building
 *      reported 0% vacancy and a cap rate computed as though every unit were
 *      let. The units table made that comment stale; nothing pointed at it, so
 *      it survived the occupancy fix in a second place.
 *   2. `unitCount` came from lease COUNT, so a unit that had never been leased
 *      could not appear in the denominator — the same defect the occupancy
 *      endpoint had.
 *   3. Operating expense is 40% of collections, ASSUMED. AcreOS holds no
 *      property-expense records at all, so NOI, cap rate and DSCR all inherit
 *      an assumption. That is not fixable here — it needs an expense model —
 *      but presenting it without saying so is.
 *
 * These are source-level assertions because the surface is a DB-backed route
 * and there is no DATABASE_URL here. They pin the shape of the fix, not just
 * its presence.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");
const SRC = read("server/routes-investor-analytics.ts");

/**
 * Source with comments stripped.
 *
 * Necessary because the fixes below are DOCUMENTED by quoting the lines they
 * replaced — so a naive text search finds the explanation and reports the bug
 * as still present. That has now bitten three assertions across this build;
 * asserting against code means asserting against code.
 */
const CODE = stripComments(SRC);

/** Collapse whitespace so an assertion survives prose being re-wrapped. */
const flat = (t: string) => t.replace(/\s+/g, " ");

describe("vacancy is no longer hardcoded to zero", () => {
  it("the zero-vacancy line is gone", () => {
    expect(CODE).not.toMatch(/const\s+vacantUnits\s*=\s*0\s*;/);
  });

  it("vacancy is derived from rentable units minus occupied", () => {
    expect(CODE).toMatch(/rentableUnits\s*-\s*occupiedUnits/);
    // Floored: a data error where occupied exceeds stock must not print a
    // negative vacancy.
    expect(CODE).toMatch(/Math\.max\(0,\s*rentableUnits\s*-\s*occupiedUnits\)/);
  });

  it("reads the units table, org- and property-scoped", () => {
    expect(SRC).toContain("rentalUnits");
    expect(SRC).toMatch(/eq\(rentalUnits\.organizationId,\s*orgId\)/);
    expect(SRC).toMatch(/eq\(rentalUnits\.propertyId,\s*propId\)/);
  });

  it("counts only `active` stock — the occupancy denominator, not the statutory one", () => {
    // Two questions, two denominators. The statutory §92.019 count also
    // includes `offline`; folding them together is how one of the two numbers
    // starts lying.
    expect(SRC).toMatch(/status === "active"/);
    expect(SRC, "an offline unit is not rentable stock").not.toMatch(
      /status === "offline"[\s\S]{0,80}rentableUnits/,
    );
  });
});

describe("a pre-0219 org sees exactly what it saw before", () => {
  it("falls back to the lease-derived count only when units are not modelled", () => {
    // Returning 0 for an org that has not entered units would read as "no
    // property" on every screen — a regression dressed as a fix.
    expect(CODE).toMatch(/modelled\s*\?\s*rentableUnits\s*:/);
    expect(SRC).toMatch(/leases\.length\s*>\s*0\s*\?\s*Math\.max\(active\.length,\s*1\)\s*:\s*1/);
  });

  it("says which basis it used, so the caller is not guessing", () => {
    expect(SRC).toContain("unitCountBasis");
    expect(SRC).toMatch(/modelled\s*\?\s*"modelled_units"\s*:\s*"lease_derived"/);
  });
});

describe("the cost of a vacancy is finally representable", () => {
  it("potential rent is in-place PLUS the asking rent of vacant units", () => {
    // It used to be `monthlyRentPotential = monthlyRentCollected`, so the two
    // were equal by construction and an empty unit cost the operator nothing
    // on this screen.
    expect(CODE).not.toMatch(/monthlyRentPotential\s*=\s*monthlyRentCollected\s*;/);
    expect(CODE).toMatch(/monthlyRentCollected\s*\+\s*vacantAskingCents/);
  });

  it("a vacant unit with no asking rent contributes nothing, not a guess", () => {
    expect(SRC).toMatch(/typeof u\.marketRentCents === "number"/);
  });
});

describe("the assumed expense ratio is labelled as one", () => {
  it("the 40% default is still there — it is not the thing being fixed", () => {
    // REWRITTEN (Wave 4, not deleted): AcreOS holds no property-expense records for
    // a residential property; the honest 40% rule of thumb survives, but it moved
    // from an inline `opExBps ?? 4000` in the route to the named ASSUMED_OPEX_BPS
    // in the pure decideOperatingExpense helper (shared/rental/noi.ts).
    const NOI = read("shared/rental/noi.ts");
    expect(NOI).toContain("ASSUMED_OPEX_BPS = 4000");
    expect(CODE).toContain("decideOperatingExpense({");
  });

  it("basis is operator_supplied when measured OR overridden; assumed_ratio only when neither; commercial-unmeasured has neither", () => {
    // REWRITTEN (Wave 4, not deleted): the precedence (measured > override >
    // assumed, with the commercial carve-out) is no longer an inline ternary — it
    // was extracted to the pure decideOperatingExpense so it is DB-free testable
    // (noiOpExDecision.test.ts). The route delegates to it and threads isCommercial.
    expect(SRC).toContain("opExBasis");
    expect(SRC).toContain("opExSource");
    expect(CODE).toContain("decideOperatingExpense({");
    expect(CODE).toMatch(/isCommercial,/);
    // The finer provenance now includes the commercial carve-out value.
    const NOI = read("shared/rental/noi.ts");
    expect(NOI).toMatch(/opExSource: "commercial_unmeasured"/);
  });

  it("the comment names the consequence rather than just the constant", () => {
    // NOI, cap rate and DSCR all inherit the assumption. A future reader must
    // not think this is a tuning knob.
    expect(flat(SRC)).toMatch(/ASSUMPTION, not a \/\/ measurement/);
  });
});

describe("the gap prose matches the code (Wave 3 — core-closed truth)", () => {
  // REWRITTEN (Wave 3, beta → core, NOT deleted): the beta-era pins asserted
  // multifamily's op-ex was an assumption the voice disclosed and the maturity
  // read "beta". Wave 3 closed the two gaps — MEASURED operating expenses (the
  // property_expenses ledger → summarizeMeasuredOpEx), per-building occupancy,
  // and the T-12 workspace — so these assertions move to the new truth: the
  // registry and the voice now state the measured capability with its honest
  // data-dependent labelling, and the maturity reads "core".

  it("the registry states the measured-expense + T-12 capability, not a bare assumption", () => {
    const registry = read("shared/business-types.ts");
    // Never re-denies the per-building NOI surface (an old, corrected draft did).
    expect(registry).not.toContain("there is no NOI-per-building surface at");
    // Names the CLOSED capabilities.
    expect(flat(registry)).toMatch(/MEASURED operating expenses/);
    expect(flat(registry)).toMatch(/T-12 UNDERWRITING WORKSPACE/);
    expect(flat(registry)).toMatch(/PER-BUILDING occupancy/);
    // Keeps the honest labelling: the flat 40% survives ONLY as a disclosed
    // fallback — it is not gone, it is demoted, so an unmeasured property still
    // reads as an estimate.
    expect(flat(registry)).toMatch(/40% ratio survives ONLY as/);
  });

  it("the multifamily persona offers the measured NOI + T-12 with honest labelling", () => {
    const personas = read("server/services/pax/personas.ts");
    // States the capability exists now — measured from the operator's own
    // recorded expenses, plus the T-12 workspace.
    expect(flat(personas)).toMatch(/built from the operator's OWN recorded operating expenses/);
    expect(personas).toMatch(/T-12 underwriting workspace/);
    // No longer asserts the beta-era "no T-12" / assumed-only state.
    expect(personas).not.toContain("there is no T-12 underwriting");
    // Keeps the labelling honesty AND the residual DSCR caveat — a measured NOI
    // is never quoted as complete books off a thin/absent ledger.
    expect(flat(personas)).toMatch(
      /Never quote a measured NOI as though a thin or absent expense ledger were a full year's books/,
    );
    expect(personas).toMatch(/DSCR needs the operator's own/);
  });

  it("multifamily is now CORE (Wave 3) — the assumption is CLOSED, not just disclosed", () => {
    // The move to core is backed by real capability, not a flag flip: measured
    // operating expenses (this file's route pins), per-building occupancy
    // (perBuildingOccupancy.test.ts), and the T-12 workspace (t12Workspace.test.ts
    // + the wiring gate in multifamilyCore.test.ts). The registry entry reads
    // core, and the flat 40% is now only a disclosed fallback rather than the
    // headline op-ex.
    const registry = read("shared/business-types.ts");
    const mf = registry.slice(registry.indexOf("multifamily: {"));
    expect(mf.slice(0, mf.indexOf("workflowTemplateIds"))).toContain('maturity: "core"');
  });
});
