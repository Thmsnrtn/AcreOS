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
const CODE = SRC
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .split("\n")
  .filter((l) => !l.trim().startsWith("//"))
  .join("\n");

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
    // AcreOS holds no property-expense records; inventing them would be worse
    // than an honest rule of thumb. What was missing is the label.
    expect(CODE).toMatch(/opExBps \?\? 4000/);
  });

  it("basis is operator_supplied when measured OR overridden; assumed_ratio only when neither", () => {
    // REWRITTEN (Wave 3 stage 3, not deleted): the op-ex is no longer always the
    // assumed ratio. The new precedence is measured stored expenses > opExBps
    // override > assumed 40%, so opExBasis is "operator_supplied" when EITHER a
    // measured ledger exists OR an explicit ratio was supplied, and "assumed_ratio"
    // survives only when NEITHER holds. The old assertion pinned
    // `opExBps === undefined ? "assumed_ratio" : "operator_supplied"`, which is
    // now the wrong truth — a measured property with no override must still read
    // operator_supplied.
    expect(SRC).toContain("opExBasis");
    expect(CODE).toMatch(
      /\(hasMeasured \|\| opExBps !== undefined\) \?\s*"operator_supplied" : "assumed_ratio"/,
    );
    // And the FINER provenance the client labels from: measured drops "(est.)";
    // an override is operator_supplied but NOT measured; the flat default is the
    // only assumed_ratio.
    expect(SRC).toContain("opExSource");
    expect(CODE).toMatch(
      /hasMeasured\s*\?\s*"measured_expenses" : \(opExBps !== undefined \? "ratio_override" : "assumed_ratio"\)/,
    );
  });

  it("the comment names the consequence rather than just the constant", () => {
    // NOI, cap rate and DSCR all inherit the assumption. A future reader must
    // not think this is a tuning knob.
    expect(flat(SRC)).toMatch(/ASSUMPTION, not a \/\/ measurement/);
  });
});

describe("the gap prose matches the code", () => {
  it("the registry no longer denies the surface exists", () => {
    const registry = read("shared/business-types.ts");
    expect(
      registry,
      "the first draft said there is no NOI-per-building surface; there is one",
    ).not.toContain("there is no NOI-per-building surface at");
    // And it names the real defect instead.
    expect(flat(registry)).toMatch(/40%-of-collected \/\/ rule of thumb/);
  });

  it("the multifamily persona names the assumption instead of denying the surface", () => {
    const personas = read("server/services/pax/personas.ts");
    expect(personas).toMatch(/ASSUMED 40% expense ratio/);
    expect(flat(personas)).toMatch(/never quote that NOI as though the expenses behind it were measured/);
  });

  it("multifamily is now beta (2026-08 audit Wave 2) — because the assumption is DISCLOSED, not because it was measured", () => {
    // The op-ex fix in this file does not, on its own, move the maturity — a
    // labelled assumption is still an assumption. What the 2026-08 audit ruled
    // is that an HONEST beta only requires the number to be presented as an
    // estimate (opExBasis "assumed_ratio" server-side, "(est.)" on the client
    // tiles, and the Pax voice naming it), which the assertions above pin. The
    // real property-expense axis and the T-12 workspace remain the CORE goal —
    // core is still roadmap-for-core until that expense model ships. This
    // assertion is rewritten (not deleted) to the new truth: the registry entry
    // reads beta, and its op-ex is still labelled an assumption downstream.
    const registry = read("shared/business-types.ts");
    const mf = registry.slice(registry.indexOf("multifamily: {"));
    expect(mf.slice(0, mf.indexOf("workflowTemplateIds"))).toContain('maturity: "beta"');
  });
});
