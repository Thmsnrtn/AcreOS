/**
 * A per-lead score may not be computed from a constant.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `GET /api/seller-motivation/:leadId` handed `computeSellerMotivationScore`
 * eleven signals. A `leads` row can supply TWO. The other nine were read through
 * `as any` off columns that do not exist, each with a default that reads like a
 * measurement:
 *
 *     assessedValue          "5000"        (on properties; leads has no propertyId)
 *     ownershipYears         5
 *     estimatedCurrentValue  assessedValue * 1.4   -> always 7000
 *     countyCompetitionLevel "medium"
 *     taxDelinquentYears     0             not a column of ANY table
 *     taxDelinquentAmount    0                    "
 *     lastSalePrice          0                    "
 *     ownerName              undefined            "   -> isInherited and
 *                                                      isCorporateOwner always false
 *     ownerState             undefined            "   -> isOutOfState ALWAYS false
 *
 * Only `isTaxDelinquent` varied, so the endpoint returned at most TWO distinct
 * scores across every lead in every organization and presented each as that
 * lead's motivation. `getOptimalOutreachTiming` received
 * `(lead as any).ownerState || lead.state || "TX"` — the same fabricated Texas
 * fallback found in `auditOrgUsury` the same day.
 *
 * `isOutOfState` is worth naming on its own: an out-of-state owner is one of the
 * strongest motivation signals in land, and it could never fire.
 *
 * ── WHAT THIS FILE PROVES, AND WHY IT IS NOT A SOURCE SCAN ──────────────────
 * The first two cases assert the engine is genuinely sensitive to the signals
 * that were being faked — so "the route stopped calling it" is a real loss of a
 * real capability, not the removal of a no-op. The rest assert the route now
 * says so instead of inventing them.
 */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  computeSellerMotivationScore,
  type SellerMotivationInput,
} from "../../server/services/sellerMotivationEngine";

const ROOT = path.resolve(__dirname, "../..");

/** The vector the route used to build, with every fabricated default in place. */
const FABRICATED: SellerMotivationInput = {
  isTaxDelinquent: false,
  taxDelinquentYears: 0,
  taxDelinquentAmount: 0,
  assessedValue: 5000,
  isOutOfState: false,
  ownershipYears: 5,
  isInherited: false,
  isCorporateOwner: false,
  lastSalePrice: 0,
  estimatedCurrentValue: 7000,
  countyCompetitionLevel: "medium",
};

describe("the faked signals genuinely move the score", () => {
  it("VACUITY: the engine scores the fabricated vector at all", () => {
    const r = computeSellerMotivationScore(FABRICATED);
    expect(typeof r.score).toBe("number");
  });

  it("isOutOfState changes the outcome — so always-false was a real loss", () => {
    const off = computeSellerMotivationScore(FABRICATED).score;
    const on = computeSellerMotivationScore({ ...FABRICATED, isOutOfState: true }).score;
    expect(
      on,
      "the engine is indifferent to isOutOfState, which would make the defect harmless — " +
        "re-check the premise of this file before trusting it",
    ).not.toBe(off);
  });

  it("ownership length and delinquency depth change the outcome too", () => {
    const base = computeSellerMotivationScore(FABRICATED).score;
    expect(computeSellerMotivationScore({ ...FABRICATED, ownershipYears: 30 }).score).not.toBe(base);
    expect(
      computeSellerMotivationScore({ ...FABRICATED, isTaxDelinquent: true, taxDelinquentYears: 4 }).score,
    ).not.toBe(base);
  });
});

describe("the route refuses instead of scoring from placeholders", () => {
  const src = fs.readFileSync(path.join(ROOT, "server/routes-epic-services.ts"), "utf8");
  const handler = (() => {
    const at = src.indexOf('router.get("/seller-motivation/:leadId"');
    expect(at, "the seller-motivation route moved — re-anchor this file").toBeGreaterThan(-1);
    return src.slice(at, src.indexOf("\nrouter.", at + 10));
  })();
  const code = handler.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

  it("does not call the engine with a synthesized vector", () => {
    expect(
      code,
      "the route is scoring again — if the signals are now recorded, this file should be " +
        "rewritten to assert they are READ, not deleted",
    ).not.toMatch(/computeSellerMotivationScore\s*\(/);
  });

  it("substitutes no placeholder for a signal it does not have", () => {
    // Value-level, so restoring the defect under different numbers still fails.
    expect(code, 'the "5000" assessed-value placeholder is back').not.toMatch(/["']5000["']/);
    expect(code, "the 1.4 value multiplier is back").not.toMatch(/\*\s*1\.4/);
    expect(code, "a hardcoded state fallback is back").not.toMatch(/\|\|\s*["'][A-Z]{2}["']/);
    expect(code, "an `as any` read on the lead row is back").not.toMatch(/lead as any/);
  });

  it("names the signals it lacks, so the gap is actionable", () => {
    for (const signal of ["ownerState", "ownershipYears", "lastSalePrice", "taxDelinquentAmount"]) {
      expect(code, `the refusal does not name ${signal}`).toContain(signal);
    }
    expect(code).toMatch(/available:\s*false/);
    expect(code).toMatch(/motivation:\s*null/);
  });
});
