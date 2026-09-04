/**
 * A KPI card may not paint a green "+0.0% from last period" for a period
 * nobody measured.
 *
 * ── THE DEFECT ──────────────────────────────────────────────────────────────
 * `getExecutiveMetrics` returned `notesValueChange: 0`, `dealsChange: 0` and
 * `conversionChange: 0` as hardcoded literals — never computed. `KPICard`
 * renders any `change !== undefined` as a trend row, and `change >= 0` selects
 * the positive colour, a TrendingUp icon and a '+' prefix. So Active Notes
 * Value, Deals in Pipeline and Lead Conversion Rate each displayed a green
 * "+0.0% from last period" on every load, for every customer, forever — and
 * `handleExportReport` pushed all three into the customer's CSV as
 * measurements.
 *
 * `revenueChange` had the same defect in its else-branch: `prevRevenue > 0 ?
 * … : 0`. A customer with no revenue in the prior window is not a customer
 * whose revenue held flat.
 *
 * `getRevenueMetrics` returned `projectedRevenue: totalRevenue * 1.1` — a flat
 * 10% growth assumption, exported as "Projected revenue". The standard was
 * already in the same file: `getConversionRates` returns honest-empty with the
 * comment "are NOT tracked, so we return honest-empty rather than
 * fabricating" (2026-09-04 review, CONFIRMED; the no-fabrication hard-stop).
 *
 * ── WHAT THIS PINS, AND WHAT THE LINT PINS ──────────────────────────────────
 * `check-measurement-defaults` now fails on all three SHAPES — a delta key
 * bound to a literal, its ternary spelling, and a measurement multiplied by an
 * assumed growth factor. What a source-shape lint cannot see is the
 * DISTINCTION this fix rests on: that the honest answer is `undefined` rather
 * than some other constant, and that the one delta which CAN be computed is
 * computed from a real prior-window query rather than asserted. That is what
 * is pinned here.
 *
 * idempotent: true — pure source reads, no DB.
 */

import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const ROOT = path.resolve(__dirname, "../..");
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), "utf8");

/**
 * Source with comment lines removed.
 *
 * Both files now carry a comment naming the deleted expression — that record
 * is the point of the fix, and a raw scan reads it as the defect. Four
 * separate predicates in this repository have been caught doing exactly that
 * in one day; this one strips first.
 */
const code = (rel: string) =>
  read(rel)
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join("\n");
const REPO = "server/storage/analyticsRepo.ts";
const CLIENT = "client/src/components/analytics-content.tsx";

/** The returned object literal of getExecutiveMetrics. */
function executiveReturn(): string {
  const src = read(REPO);
  const at = src.indexOf("async getExecutiveMetrics");
  expect(at, "getExecutiveMetrics is gone — this test is reading nothing").toBeGreaterThan(-1);
  const ret = src.indexOf("return {", at);
  expect(ret).toBeGreaterThan(at);
  return src.slice(ret, src.indexOf("};", ret));
}

describe("the executive KPIs say 'not measured' instead of saying zero", () => {
  const ret = executiveReturn();

  it("no delta is a numeric literal", () => {
    const literals = [...ret.matchAll(/(\w*(?:Change|Delta|Growth))\s*:\s*(-?\d+(?:\.\d+)?)\s*,/g)];
    expect(
      literals.map((m) => `${m[1]}: ${m[2]}`),
      "a hardcoded delta is a fabricated measurement: the card renders any " +
        "defined change as a trend row and treats >= 0 as positive",
    ).toEqual([]);
  });

  it("the two point-in-time metrics carry no delta at all", () => {
    // getActiveNotesValue sums what is active NOW and dealsInPipeline counts
    // what is active NOW. Neither has a stored history to compare against, so
    // there is no honest delta to compute — only one to invent.
    for (const field of ["notesValueChange", "dealsChange"]) {
      expect(ret, `${field} must be undefined, not a number`).toMatch(
        new RegExp(`${field}:\\s*undefined`),
      );
    }
  });

  it("the two computable deltas come from a real prior-window query", () => {
    const src = read(REPO);
    // revenueChange: an existing prior-window payments query, and an else that
    // refuses rather than returning 0.
    expect(src).toContain("const prevRevenue = Number(prevPayments[0]?.total || 0);");
    expect(src).toMatch(/prevRevenue > 0\s*\?[\s\S]{0,90}:\s*undefined;/);
    // conversionChange: its own prior-window lead queries, measured the same
    // way the current-window rate is so the delta compares like with like.
    expect(src).toContain("const prevTotalLeads = Number(prevTotalLeadsResult[0]?.count || 0);");
    expect(src).toContain("const prevConverted = Number(prevConvertedResult[0]?.count || 0);");
    expect(src).toMatch(/prevConversionRate !== undefined && prevConversionRate > 0/);
    expect(src).toMatch(/:\s*undefined;\s*$/m);
  });

  it("the invented projection is gone from the customer path", () => {
    expect(code(REPO)).not.toMatch(/projectedRevenue:\s*totalRevenue\s*\*/);
    // Vacuity: the comment recording the deletion is still there, so a
    // stripper that blanked the file would not read as clean.
    expect(read(REPO)).toContain("projectedRevenue: totalRevenue * 1.1");
    expect(
      code(CLIENT),
      "the CSV export still carries a field the server no longer computes",
    ).not.toContain('push("Revenue", "Projected revenue"');
  });
});

describe("the client renders an absent delta as absent", () => {
  const client = read(CLIENT);

  it("KPICard omits the trend row when change is undefined", () => {
    // This is what makes `undefined` the right answer rather than a different
    // constant: the renderer already had the honest branch.
    expect(client).toContain("{change !== undefined && (");
  });

  it("the CSV export skips undefined rather than writing an empty cell", () => {
    expect(client).toMatch(/if \(value === undefined \|\| value === null\) return;/);
  });

  it("the executive fields are optional in the client's own type", () => {
    // A required `number` would have made `undefined` a type error and pushed
    // the next author straight back to 0.
    for (const field of ["revenueChange", "notesValueChange", "dealsChange", "conversionChange"]) {
      expect(client, `${field} must be optional`).toMatch(new RegExp(`${field}\\?:\\s*number;`));
    }
  });
});
