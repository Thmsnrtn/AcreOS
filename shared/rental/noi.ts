// ============================================================================
// SHARED/RENTAL/NOI.TS — turning the expense ledger into a MEASURED op-ex
// ----------------------------------------------------------------------------
// Pure and browser-safe: no imports beyond the sibling expense axis, no DB, no
// `process`. This is the ONE place that turns stored property_expenses rows into
// the operating expense behind NOI, so the two things that must never happen —
// a non-operating Schedule-E line reaching NOI, and a thin ledger reading as a
// complete one — are decided once here and cannot be re-decided per call site.
//
// WHY A SEPARATE, PURE FUNCTION
// ─────────────────────────────
// snapshotForProperty (server/routes-investor-analytics.ts) is DB-backed, so
// its NOI math cannot be exercised without a database. Pulling the operating-row
// summarisation out into a pure function means the honesty rules below get a
// real behavioural test (tests/unit/propertyExpenseNoi.test.ts) rather than only
// a source-level assertion, AND the T-12 workspace can reuse the per-category
// breakdown without re-querying.
// ============================================================================

import type { PropertyExpenseCategory } from "./propertyExpense";

/**
 * The flat rule-of-thumb operating-expense ratio, in basis points (40.00% of
 * collections). This is an ASSUMPTION used ONLY when a property has no measured
 * operating expenses and no explicit override — never a measurement. Kept here
 * as a named constant so the number and its meaning travel together.
 */
export const ASSUMED_OPEX_BPS = 4000;

/**
 * The length, in months, of the trailing window NOI is measured over. A
 * measured op-ex is only "complete" — safe to present with no qualifier, as the
 * operator's actual books — when operating-expense rows span this many of the
 * trailing months. Fewer, and the op-ex is thin: a real but PARTIAL slice of the
 * year that would understate cost if read as the whole. Kept here so the server
 * label and the client label share ONE definition of "complete".
 */
export const TRAILING_12_WINDOW_MONTHS = 12;

/**
 * True when a measured op-ex covers the whole trailing-12 window — i.e. every
 * one of the last twelve calendar months carries at least one operating-expense
 * row. This is a FACTUAL span (the real number of months with recorded
 * expenses), not an arbitrary confidence threshold: below it, the client shows
 * the coverage explicitly ("N/12 mo") rather than a bare measured number, so a
 * one- or two-month op-ex can never read as a complete year's books. The `>=`
 * absorbs the window's boundary month (a trailing-12 lookback can touch 13
 * partial calendar months); full coverage is full coverage.
 */
export function isMeasuredCoverageComplete(monthsCovered: number): boolean {
  return monthsCovered >= TRAILING_12_WINDOW_MONTHS;
}

/**
 * A stored property_expenses row, as much of it as the NOI math needs. `isOperating`
 * is the STORED flag (property_expenses.isOperating), derived from
 * isOperatingCategory at WRITE time and frozen — read it, never recompute it from
 * the category here, so a later reclassification of a category cannot silently
 * rewrite the operating status of history (the schema's stated reason for storing
 * it). `incurredOn` is the YYYY-MM-DD the expense was filed to; its month bucket
 * is what `monthsCovered` counts.
 */
export interface MeasurableExpenseRow {
  category: PropertyExpenseCategory;
  amountCents: number;
  isOperating: boolean;
  incurredOn: string;
}

export interface MeasuredOpExSummary {
  /**
   * How many OPERATING rows were present in the window — the "measured"
   * coverage. Zero means nothing was measured, and the caller must fall back to
   * an assumed ratio and KEEP the estimate label. This is the precise
   * definition of "measured": operating expense rows present in the window.
   */
  rowCount: number;
  /**
   * How many DISTINCT trailing-12 calendar months (YYYY-MM) carry at least one
   * operating-expense row — the completeness of the coverage, distinct from its
   * row count. A property can have many rows in a single month (a thin slice)
   * and still not be a full year's books; this is the number that tells them
   * apart, and the one the client turns into "N/12 mo" when it is below full.
   */
  monthsCovered: number;
  /** Sum of the OPERATING rows' amountCents over the window, in cents. */
  sumCents: number;
  /**
   * Per-Schedule-E-category operating totals, in cents. Non-operating categories
   * (mortgage_interest, depreciation) never appear — they are excluded from the
   * sum and from this map alike, so it can never present a financing cost as an
   * operating one. The T-12 workspace renders its category rows from this.
   */
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
}

/**
 * Summarise the OPERATING expense rows for a property's trailing-12 window.
 *
 * The exclusion of the two non-operating Schedule-E lines (mortgage_interest,
 * depreciation) is the whole point: they are stored for Schedule-E completeness
 * but must never enter NOI, or a levered and an unlevered owner of the same
 * building would compute different NOI, and every cap rate and DSCR built on it
 * would be wrong. Rows are filtered by their STORED `isOperating` flag, so this
 * matches exactly what the operator's write recorded.
 *
 * `monthsCovered` counts the distinct YYYY-MM buckets among the OPERATING rows,
 * so downstream can tell a full year of records from a thin one- or two-month
 * slice and refuse to present the latter as complete books.
 */
export type OpExSource =
  | "measured_expenses"
  | "ratio_override"
  | "assumed_ratio"
  | "commercial_unmeasured";
export type OpExBasis = "operator_supplied" | "assumed_ratio" | "unavailable";

export interface OpExDecision {
  /** Null for an unmeasured commercial property — no assumed op-ex, hence no NOI. */
  opExMonthlyCents: number | null;
  opExBasis: OpExBasis;
  opExSource: OpExSource;
}

/**
 * Decide the monthly operating expense behind NOI, and label its provenance —
 * the ONE place the op-ex precedence lives, pure so it is testable without a DB.
 *
 * Precedence: measured stored expenses > explicit opExBps override > (residential)
 * the assumed 40%-of-collections ratio. The commercial carve-out is the honesty
 * rule Wave 4 adds: a COMMERCIAL property with neither measured expenses nor an
 * override gets NO assumed op-ex — the residential ratio is meaningless for a
 * NNN/gross building, so op-ex is null (opExSource "commercial_unmeasured") and NOI/
 * cap rate fall away rather than being fabricated from a 60%-of-rent guess.
 */
export function decideOperatingExpense(args: {
  hasMeasured: boolean;
  measuredOpExMonthlyCents: number;
  opExBps: number | undefined;
  isCommercial: boolean;
  monthlyRentCollectedCents: number;
}): OpExDecision {
  const { hasMeasured, measuredOpExMonthlyCents, opExBps, isCommercial, monthlyRentCollectedCents } = args;
  if (hasMeasured) {
    return { opExMonthlyCents: measuredOpExMonthlyCents, opExBasis: "operator_supplied", opExSource: "measured_expenses" };
  }
  if (opExBps !== undefined) {
    return {
      opExMonthlyCents: Math.round((monthlyRentCollectedCents * opExBps) / 10000),
      opExBasis: "operator_supplied",
      opExSource: "ratio_override",
    };
  }
  if (isCommercial) {
    return { opExMonthlyCents: null, opExBasis: "unavailable", opExSource: "commercial_unmeasured" };
  }
  return {
    opExMonthlyCents: Math.round((monthlyRentCollectedCents * ASSUMED_OPEX_BPS) / 10000),
    opExBasis: "assumed_ratio",
    opExSource: "assumed_ratio",
  };
}

export function summarizeMeasuredOpEx(rows: MeasurableExpenseRow[]): MeasuredOpExSummary {
  const operating = rows.filter((r) => r.isOperating);
  const byCategoryCents: Partial<Record<PropertyExpenseCategory, number>> = {};
  const months = new Set<string>();
  let sumCents = 0;
  for (const r of operating) {
    const cents = Math.round(Number(r.amountCents));
    sumCents += cents;
    byCategoryCents[r.category] = (byCategoryCents[r.category] ?? 0) + cents;
    // The month bucket is the first 7 chars of the ISO date (YYYY-MM). A blank
    // or malformed incurredOn contributes no bucket rather than a bogus one.
    if (typeof r.incurredOn === "string" && r.incurredOn.length >= 7) {
      months.add(r.incurredOn.slice(0, 7));
    }
  }
  return { rowCount: operating.length, monthsCovered: months.size, sumCents, byCategoryCents };
}
