/**
 * An absent basis is stated, not silently omitted.
 *
 * TWO SURFACES, ONE SHAPE
 * ───────────────────────
 * `cashFlowForecaster.projectExpenses` derived every carrying cost — tax,
 * insurance, maintenance — as a percentage of `assessedValue`, read as
 * `property.assessedValue ? parseFloat(...) : 0`. A property with no assessed
 * value therefore produced three costs of exactly 0, and the `> 0` guards then
 * skipped pushing them at all. The forecast came out with NO carrying costs and
 * no indication that any were missing, which reads as "this property costs
 * nothing to hold".
 *
 * `dueDiligenceReportGenerator` derived its whole Financial Projections page
 * from `valuation?.estimatedValue || (property?.marketValue ? Number(...) : 0)`,
 * so a parcel with neither printed, in a document headed "due diligence":
 *
 *     Aggressive (25%): Buy $0 → Sell $0 → Profit $0 (N/A% ROI)
 *     7% / 84mo: Down $0 + $0/mo = $0 total
 *
 * Silence is the failure mode in the first and a page of zeros in the second,
 * and both are the same rule: a reader cannot tell an omitted figure from an
 * absent one. It is the defect the CLIMATE section of that same report carried
 * until 2026-08-18, and it takes the same answer — name the absence and say
 * what it does and does not mean.
 *
 * Asserted at the source with comments stripped and a floor, because both
 * surfaces need a database and a jsPDF harness this file does not carry, and
 * because in each case the defect IS the expression.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

function stripped(rel: string): string {
  const raw = readFileSync(resolve(__dirname, "../..", rel), "utf8");
  const code = stripComments(raw);
  expect(code.length, `${rel}: comment stripping removed the file`)
    .toBeGreaterThan(raw.length * 0.3);
  return code;
}

describe("the cash-flow forecast says when it could not price the carry", () => {
  it("does not substitute 0 for a missing assessed value", () => {
    const code = stripped("server/services/cashFlowForecaster.ts");
    expect(code, "the forecaster defaults a missing assessed value to 0 again")
      .not.toMatch(/assessedValue\s*\?\s*parseFloat\([^)]*\)\s*:\s*0/);
  });

  it("emits a labelled gap instead of silently omitting the costs", () => {
    const code = stripped("server/services/cashFlowForecaster.ts");
    // The row exists to carry the sentence, so the sentence is what is pinned.
    expect(code).toMatch(/Carrying costs \(tax, insurance, maintenance\) are NOT included/);
    expect(code, "the note must say the forecast is understated, not merely incomplete")
      .toMatch(/understates holding cost/);
  });

  it("still projects carry when there IS an assessed value", () => {
    // The other direction: a guard that suppressed everything would satisfy
    // both cases above and silently empty every forecast.
    const code = stripped("server/services/cashFlowForecaster.ts");
    expect(code).toContain("const annualTaxRate = 0.015");
    expect(code).toMatch(/monthlyTax\s*=\s*\(assessedValue \* annualTaxRate\)/);
  });
});

describe("the due-diligence report does not project from a value it lacks", () => {
  it("does not substitute 0 for a missing valuation", () => {
    const code = stripped("server/services/dueDiligenceReportGenerator.ts");
    expect(code, "the projections page derives from 0 again")
      .not.toMatch(/estimatedValue\s*\|\|\s*\(property\?\.marketValue\s*\?[^)]*\)\s*:\s*0\)/);
  });

  it("says the projections were not made, and why", () => {
    const code = stripped("server/services/dueDiligenceReportGenerator.ts");
    expect(code).toMatch(/Not projected/);
    // The load-bearing sentence: without it a reader infers "checked, worth
    // nothing" from the absence, which is what the climate fix established.
    // Matched on a phrase that lives inside ONE string literal: the sentence is
    // built by concatenation, so "absence of " and "a valuation" sit on
    // different lines and a regex spanning them finds nothing even though the
    // rendered text is correct. The test caught that about itself.
    expect(code).toMatch(/not a valuation of zero/);
  });

  it("still prints the scenarios when a value IS available", () => {
    const code = stripped("server/services/dueDiligenceReportGenerator.ts");
    expect(code).toContain("Aggressive (25%)");
    expect(code).toContain("Seller Finance Scenarios");
    // Guarded rather than deleted — the else branch must still exist.
    expect(code).toMatch(/\}\s*else\s*\{/);
  });
});
