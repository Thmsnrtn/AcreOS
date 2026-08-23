/**
 * A financial report may not invent its cost lines.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `getDealPnL` computed:
 *
 *     revenue        = (deal as any).salePrice || (deal as any).offerAmount || 0
 *     Acquisition    = (deal as any).purchasePrice || 0
 *     Closing Costs  = revenue * 0.03
 *     Marketing      = revenue * 0.02
 *     Due Diligence  = 200
 *
 * `deals` has neither `salePrice` nor `purchasePrice`. So ACQUISITION — the
 * largest cost in any real estate deal — was ALWAYS ZERO, and the other three
 * lines were invented outright. The reported profit was
 * `offerAmount * 0.95 - 200` for every deal in the system, labelled a P&L.
 *
 * `getCostBasisReport` had the same shape: `improvements` came from
 * `(p as any).improvementCost`, which is a column of no table, so every basis
 * was reported without improvements. Understating basis overstates gain, which
 * is the direction that costs the customer money at tax time.
 *
 * Both figures exist. `cost_basis` records acquisitionPrice, acquisitionCosts,
 * improvementCosts and a maintained adjustedBasis, and CostBasisTracker owns it.
 * Two surfaces were computing the same rule independently and worse.
 *
 * ── WHAT THIS FILE PROVES ───────────────────────────────────────────────────
 * That no invented constant survives, and that absent is reported as absent.
 * The percentage assertions are value-level, so reintroducing the estimate at a
 * different rate still fails.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const src = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");
const code = (rel: string) =>
  src(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const REPORTING = "server/services/reportingEnhancements.ts";
const PAX = "server/services/paxEnhancements.ts";

describe("the P&L reports only costs that were recorded", () => {
  it("VACUITY: it still builds a cost list and a revenue figure", () => {
    // Without this, every absence assertion below is satisfied by a function
    // that no longer reports anything at all.
    const c = code(REPORTING);
    expect(c).toMatch(/const revenue =/);
    expect(c).toMatch(/category: "Acquisition"/);
  });

  it("invents no percentage or flat-fee cost line", () => {
    const c = code(REPORTING);
    expect(c, "a percentage-of-revenue cost estimate is back").not.toMatch(/revenue\s*\*\s*0\.\d+/);
    expect(c, "the flat $200 due-diligence line is back").not.toMatch(/amount:\s*200\b/);
    for (const invented of ["Closing Costs", "Marketing", "Due Diligence"]) {
      expect(c, `"${invented}" is a cost line nothing records`).not.toContain(`category: "${invented}"`);
    }
  });

  it("reports profit as null when no acquisition cost is recorded", () => {
    // Revenue minus nothing is revenue. Calling that profit is the defect.
    const c = code(REPORTING);
    expect(c).toMatch(/profit\s*=\s*acquisition === null \? null/);
    expect(c).toMatch(/costsComplete/);
  });

  it("takes acquisition from cost_basis, not from a cast on the deal", () => {
    const c = code(REPORTING);
    expect(c).toMatch(/from\(costBasis\)/);
    expect(c, "the deal row is being cast to read a cost again").not.toMatch(/deal as any/);
  });
});

describe("the cost basis report reads the canonical table", () => {
  it("no longer synthesises improvements from a non-existent column", () => {
    const c = code(REPORTING);
    // SINGULAR only. The real cost_basis column is `improvementCosts`, and
    // `not.toContain("improvementCost")` fails against correct code because the
    // ghost's name is a SUBSTRING of the real one — the exact trap CLAUDE.md
    // records from a trigger check that survived being renamed `..._RENAMED`.
    expect(
      c,
      "the singular improvementCost is not a column of any table",
    ).not.toMatch(/improvementCost(?!s)/);
    expect(c, "the real cost_basis column should be read").toMatch(/improvementCosts/);
  });

  it("says when a basis is absent rather than reporting zero", () => {
    const c = code(REPORTING);
    expect(c).toMatch(/basisRecorded/);
    expect(c).toMatch(/totalBasis: null/);
  });

  it("follows the file's own precedent for absent data", () => {
    // getPipelineVelocity already reported `timingAvailable: false` with nulls
    // and said in a comment that the fields are "intentionally absent, not
    // zero". The two functions below it did not follow it until now.
    expect(code(REPORTING)).toMatch(/timingAvailable/);
  });
});

describe("Pax's context uses the columns that exist", () => {
  it("reads assessedValue, the real column, not taxAssessedValue", () => {
    const c = code(PAX);
    expect(c, "taxAssessedValue is not a column of properties").not.toContain("taxAssessedValue");
    expect(c).toMatch(/prop\.assessedValue/);
  });

  it("takes the asking price from the property's list price", () => {
    const c = code(PAX);
    expect(c, "askingPrice is not a column of deals").not.toContain("askingPrice");
    expect(c).toMatch(/dealProperty\?\.listPrice/);
  });

  it("casts neither the property nor the deal row any more", () => {
    // Both spurious casts (purchasePrice, offerAmount) went with the real
    // ghosts. A spurious `as any` beside a ghost is how the ghost survives.
    const c = code(PAX);
    expect(c).not.toMatch(/prop as any/);
    expect(c).not.toMatch(/deal as any/);
  });
});
