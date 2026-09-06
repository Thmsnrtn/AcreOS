/**
 * MEASURED NOI — turning an ASSUMED cap rate into a MEASURED one, without ever
 * presenting an assumption as a measurement (Wave 3, multifamily → core, stage 3).
 *
 * WHAT CHANGED
 * ------------
 * NOI's operating expense used to be a flat 40%-of-collections guess baked into
 * every projection. `property_expenses` now holds what the operator actually
 * spent, and snapshotForProperty prefers it: measured stored expenses > an
 * explicit opExBps override > the assumed 40%. The whole risk of this stage is
 * fabrication — a flattering measured NOI presented as complete, or an assumption
 * shown as measured — so the rules below are pinned tightly.
 *
 * WHAT THIS FILE PINS
 * -------------------
 *   1. summarizeMeasuredOpEx (PURE) sums ONLY operating rows, EXCLUDES the two
 *      non-operating Schedule-E lines (mortgage_interest, depreciation), and a
 *      window with no operating rows reports rowCount 0 — the definition of "not
 *      measured".
 *   2. A measured op-ex produces a DIFFERENT (measured) NOI and cap rate than
 *      the 40% assumption — the difference the ledger exists to reveal.
 *   3. WIRING, against route source AS CODE (comments stripped first): the route
 *      reads property_expenses as the SOLE NOI expense source and NEVER also sums
 *      maintenance invoices; the precedence and the assumed-40% fallback are
 *      exactly as specified; cap rate is built from the resulting NOI.
 *   4. The client shows "(est.)" ONLY where the op-ex is assumed — measured drops
 *      it, an override reads "(assumed ratio)", and the rollup drops it only when
 *      every property is measured.
 */
import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { stripComments } from "../helpers/stripComments";

import {
  summarizeMeasuredOpEx,
  isMeasuredCoverageComplete,
  computeNoi,
  ASSUMED_OPEX_BPS,
  type MeasurableExpenseRow,
} from "../../shared/rental/noi";
import {
  isOperatingCategory,
  type PropertyExpenseCategory,
} from "../../shared/rental/propertyExpense";

const ROOT = path.resolve(__dirname, "../..");
const read = (p: string) => fs.readFileSync(path.resolve(ROOT, p), "utf-8");

/**
 * A stored expense row, isOperating derived exactly as the write path does.
 * `incurredOn` defaults to a single fixed month (so coverage-agnostic tests read
 * as one covered month); coverage tests pass explicit dates.
 */
function row(
  category: PropertyExpenseCategory,
  amountCents: number,
  incurredOn = "2026-01-15",
): MeasurableExpenseRow {
  return { category, amountCents, isOperating: isOperatingCategory(category), incurredOn };
}

/** Source with comments removed — the same discipline as the other route tests. */
function code(src: string): string {
  return stripComments(src);
}

const INV_SRC = read("server/routes-investor-analytics.ts");
const INV_CODE = code(INV_SRC);
const CLIENT = read("client/src/pages/investor-analytics.tsx");

// ---------------------------------------------------------------------------
// 1. The measured operating expense — pure, and honest about coverage.
// ---------------------------------------------------------------------------

describe("summarizeMeasuredOpEx sums only operating rows", () => {
  it("totals the operating rows and keeps a per-category breakdown", () => {
    const summary = summarizeMeasuredOpEx([
      row("repairs", 120_000),
      row("insurance", 60_000),
      row("repairs", 40_000),
    ]);
    expect(summary.rowCount).toBe(3);
    expect(summary.sumCents).toBe(220_000);
    expect(summary.byCategoryCents).toEqual({ repairs: 160_000, insurance: 60_000 });
  });

  it("EXCLUDES mortgage_interest and depreciation from NOI", () => {
    // A financing cost and a non-cash allowance are stored for Schedule-E
    // completeness but must never enter NOI — a levered and an unlevered owner
    // of the same building must compute the SAME NOI.
    const summary = summarizeMeasuredOpEx([
      row("repairs", 100_000),
      row("mortgage_interest", 900_000),
      row("depreciation", 500_000),
    ]);
    expect(summary.rowCount).toBe(1);
    expect(summary.sumCents).toBe(100_000);
    expect(summary.byCategoryCents.mortgage_interest).toBeUndefined();
    expect(summary.byCategoryCents.depreciation).toBeUndefined();
  });

  it("a window with NO operating rows reports rowCount 0 — the definition of 'not measured'", () => {
    // Empty, and a window holding ONLY non-operating rows, are both "nothing
    // measured": a mortgage-interest-only property is not a measured one, and
    // must fall back to the assumed ratio and keep its estimate label.
    expect(summarizeMeasuredOpEx([]).rowCount).toBe(0);
    expect(summarizeMeasuredOpEx([]).sumCents).toBe(0);
    const nonOpOnly = summarizeMeasuredOpEx([
      row("mortgage_interest", 900_000),
      row("depreciation", 500_000),
    ]);
    expect(nonOpOnly.rowCount).toBe(0);
    expect(nonOpOnly.sumCents).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 1b. Coverage completeness — a thin measured op-ex is NOT complete books.
// ---------------------------------------------------------------------------

describe("monthsCovered distinguishes a full year from a thin slice", () => {
  it("counts DISTINCT trailing-12 months among operating rows, not row count", () => {
    // Two rows in January, one in March → 2 distinct months across 3 rows.
    const summary = summarizeMeasuredOpEx([
      row("repairs", 10_000, "2026-01-05"),
      row("supplies", 5_000, "2026-01-20"),
      row("utilities", 8_000, "2026-03-02"),
    ]);
    expect(summary.rowCount).toBe(3);
    expect(summary.monthsCovered).toBe(2);
  });

  it("a one-month measured op-ex is thin (monthsCovered 1) and NOT complete", () => {
    const summary = summarizeMeasuredOpEx([row("repairs", 10_000, "2026-01-05")]);
    expect(summary.monthsCovered).toBe(1);
    expect(isMeasuredCoverageComplete(summary.monthsCovered)).toBe(false);
  });

  it("a full trailing-12 span (one row per month) IS complete", () => {
    const rows = Array.from({ length: 12 }, (_, i) =>
      row("repairs", 10_000, `2026-${String(i + 1).padStart(2, "0")}-10`),
    );
    const summary = summarizeMeasuredOpEx(rows);
    expect(summary.monthsCovered).toBe(12);
    expect(isMeasuredCoverageComplete(summary.monthsCovered)).toBe(true);
  });

  it("a non-operating row never makes its month count as covered", () => {
    // Coverage is OPERATING coverage: a lone depreciation/mortgage_interest row
    // in a month with no operating expense must not inflate the covered span.
    const summary = summarizeMeasuredOpEx([
      row("repairs", 10_000, "2026-01-05"),
      row("depreciation", 500_000, "2026-06-01"),
      row("mortgage_interest", 900_000, "2026-09-01"),
    ]);
    expect(summary.monthsCovered).toBe(1);
    expect(isMeasuredCoverageComplete(summary.monthsCovered)).toBe(false);
  });

  it("isMeasuredCoverageComplete: below 12 is partial, 12+ is complete", () => {
    expect(isMeasuredCoverageComplete(0)).toBe(false);
    expect(isMeasuredCoverageComplete(11)).toBe(false);
    expect(isMeasuredCoverageComplete(12)).toBe(true);
    // A trailing-12 lookback can touch a 13th boundary month — still complete.
    expect(isMeasuredCoverageComplete(13)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 2. A measured op-ex changes NOI and the cap rate — the point of the stage.
// ---------------------------------------------------------------------------

describe("a measured op-ex yields a measured NOI and cap rate", () => {
  const monthlyRentCollected = 500_000; // $5,000/mo
  const marketValueCents = 100_000_000; // $1,000,000

  it("measured expenses replace the 40% assumption, moving NOI and cap rate", () => {
    const measured = summarizeMeasuredOpEx([
      row("taxes", 1_200_000), // $12,000/yr
      row("insurance", 600_000), // $6,000/yr
    ]);
    expect(measured.rowCount).toBeGreaterThan(0);

    const measuredOpExMonthly = Math.round(measured.sumCents / 12); // 1,800,000/12 = 150,000
    const assumedOpExMonthly = Math.round((monthlyRentCollected * ASSUMED_OPEX_BPS) / 10000); // 200,000
    // The ledger reveals this building's real op-ex is LOWER than the flat guess.
    expect(measuredOpExMonthly).toBe(150_000);
    expect(assumedOpExMonthly).toBe(200_000);
    expect(measuredOpExMonthly).not.toBe(assumedOpExMonthly);

    const measuredCapPct =
      Math.round(((monthlyRentCollected - measuredOpExMonthly) * 12 / marketValueCents) * 10000) / 100;
    const assumedCapPct =
      Math.round(((monthlyRentCollected - assumedOpExMonthly) * 12 / marketValueCents) * 10000) / 100;
    // The cap rate is now derived from what the operator actually spent, not a
    // guess — a different, measured number.
    expect(measuredCapPct).not.toBe(assumedCapPct);
    expect(measuredCapPct).toBe(4.2); // (500000-150000)*12 / 100,000,000 = 4.2%
    expect(assumedCapPct).toBe(3.6);
  });
});

// ---------------------------------------------------------------------------
// 3. Wiring — the route reads property_expenses as the SOLE NOI expense source.
// ---------------------------------------------------------------------------

describe("the route wires the measured op-ex correctly", () => {
  it("summarises property_expenses through the single operating predicate", () => {
    expect(INV_SRC).toContain('from "@shared/rental/noi"');
    expect(INV_CODE).toContain("summarizeMeasuredOpEx(expenseRows)");
    expect(INV_CODE).toContain("from(propertyExpenses)");
  });

  it("NEVER also sums maintenance invoices into NOI (the double-count guard)", () => {
    // property_expenses is the sole source; a maintenance invoice reaches NOI
    // only once it has been rolled INTO that ledger. Reading maintenanceTickets
    // or an invoice column here would count the same repair twice.
    expect(INV_CODE).not.toContain("maintenanceTickets");
    expect(INV_CODE).not.toMatch(/invoice_cents|invoiceCents/);
  });

  it("delegates op-ex precedence to the pure decideOperatingExpense — measured > override > assumed, with the commercial carve-out", () => {
    // REWRITTEN (Wave 4, not deleted): the precedence used to be an inline ternary
    // here. It was extracted to shared/rental/noi.ts:decideOperatingExpense so the
    // commercial carve-out — an UNMEASURED commercial property gets NO assumed
    // op-ex (null NOI/cap rate), never a 60%-of-rent invention — is testable
    // without a DB. The behaviour is pinned in noiOpExDecision.test.ts.
    expect(INV_CODE).toContain("decideOperatingExpense({");
    expect(INV_CODE).toMatch(/isCommercial,/);
    const NOI = read("shared/rental/noi.ts");
    expect(NOI).toContain("ASSUMED_OPEX_BPS"); // the assumed 40% default lives with the helper
    expect(NOI).toMatch(/opExSource: "commercial_unmeasured"/);
  });

  it("cap rate is built from the resulting NOI, which is null when op-ex is unavailable", () => {
    // REWRITTEN (not deleted) when the `multifamily_noi` scenario engine landed.
    // The subtraction used to be an inline ternary here and was pinned by
    // grepping for it. Registering the engine gave `collections - opEx` a second
    // caller, so it was extracted to shared/rental/noi.ts:computeNoi — the same
    // move decideOperatingExpense made in Wave 4, and for the same reason.
    //
    // The INVARIANT this test has always existed to protect is unchanged: NOI
    // and cap rate fall AWAY (null) rather than being fabricated when op-ex is
    // unavailable — an unmeasured commercial property. It is now asserted
    // BEHAVIOURALLY against the extracted function rather than by matching a
    // source expression, so it cannot go stale the next time the code moves.
    expect(INV_CODE).toContain("computeNoi({");
    expect(INV_CODE).toMatch(/noiAnnual \/ marketValue/);

    // A null op-ex propagates to a null NOI — NOT to an NOI equal to rent.
    expect(computeNoi({ monthlyRentCollectedCents: 500_000, opExMonthlyCents: null }))
      .toEqual({ noiMonthlyCents: null, noiAnnualCents: null });
    // And a known op-ex still subtracts and annualises exactly as before.
    expect(computeNoi({ monthlyRentCollectedCents: 500_000, opExMonthlyCents: 200_000 }))
      .toEqual({ noiMonthlyCents: 300_000, noiAnnualCents: 3_600_000 });
  });

  it("exposes opExMonthsCovered (coverage completeness) on the payload", () => {
    expect(INV_CODE).toContain("opExMonthsCovered");
    expect(INV_CODE).toContain("measuredOpEx.monthsCovered");
  });

  it("the portfolio rollup is all-measured ONLY when every property is measured AND complete", () => {
    expect(INV_CODE).toContain("portfolioOpExBasis");
    // "operator_supplied" requires every property measured with COMPLETE
    // coverage — a single assumed OR thin-coverage property is "mixed" and keeps
    // the estimate label (a portfolio of thin-coverage properties is not "books").
    expect(INV_CODE).toMatch(
      /every\(\s*\(x\) => x\.opExSource === "measured_expenses" && isMeasuredCoverageComplete\(x\.opExMonthsCovered\)/,
    );
    expect(INV_CODE).toContain('"mixed"');
  });
});

// ---------------------------------------------------------------------------
// 4. The client shows "(est.)" ONLY where the op-ex is assumed.
// ---------------------------------------------------------------------------

describe("the client labels the op-ex honestly", () => {
  it("drops the qualifier ONLY for measured AND full coverage; thin coverage shows N/12 mo", () => {
    // 2026-08-28: the string-suffix opExQualifier became the OpExProvenance
    // component rendering the canonical DataProvenanceChip (epistemic-UX
    // step-3 migration). The INVARIANT is unchanged and re-pinned against the
    // new shape: full measured coverage renders nothing, thin coverage renders
    // the factual month span, and assumptions are labeled estimates — never a
    // bare number, never an invented percentage.
    expect(CLIENT).toContain("function OpExProvenance");
    expect(CLIENT).toContain("isMeasuredCoverageComplete(monthsCovered)");
    expect(CLIENT).toMatch(/\(\$\{covered\}\/\$\{TRAILING_12_WINDOW_MONTHS\} mo\)/);
    expect(CLIENT).toContain('source === "ratio_override" ? "Your assumed ratio" : "40% op-ex rule"');
    expect(CLIENT).toContain('classification="estimate"');
  });

  it("feeds the per-property coverage (opExMonthsCovered) into the qualifier", () => {
    expect(CLIENT).toContain("opExMonthsCovered");
    expect(CLIENT).toContain("monthsCovered={p.opExMonthsCovered}");
  });

  it("a 1-month (thin) measured property renders a partial marker, never a bare number", () => {
    // The client's rule, exercised on the same predicate it imports: a single
    // covered month is NOT complete, so opExQualifier returns a non-empty
    // "(1/12 mo)" and the measured cap rate can never render unqualified.
    const thinMonths = summarizeMeasuredOpEx([row("repairs", 10_000, "2026-01-05")]).monthsCovered;
    expect(isMeasuredCoverageComplete(thinMonths)).toBe(false);

    const fullMonths = summarizeMeasuredOpEx(
      Array.from({ length: 12 }, (_, i) => row("repairs", 10_000, `2026-${String(i + 1).padStart(2, "0")}-10`)),
    ).monthsCovered;
    expect(isMeasuredCoverageComplete(fullMonths)).toBe(true);
  });

  it("gates the portfolio rollup '(est.)' on the whole portfolio being measured-and-complete", () => {
    expect(CLIENT).toMatch(/portfolioOpExBasis === "operator_supplied" \? "" : " \(est\.\)"/);
  });

  it("carries opExBasis and opExSource on the client type so the gate has data", () => {
    expect(CLIENT).toContain("opExBasis");
    expect(CLIENT).toContain("opExSource");
  });
});
