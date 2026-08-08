// ============================================================================
// SHARED/RENTAL/T12.TS — the trailing-12 underwriting grid (Wave 3, stage 5)
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports beyond the sibling
// expense axis. This turns the two cash-basis facts a building already has —
// rent PAYMENTS (income) and property_expenses (operating cost) — into the
// twelve-month income / operating-expense / NOI grid a multifamily operator
// underwrites off. The one honesty rule lives here so no call site can re-decide
// it: EXACTLY twelve month rows, ZERO-FILLED. A month with no income and no
// expense is a row of zeros that is PRESENT — never omitted, never inferred,
// never back-filled from an average. A dropped month reads as "no data"; a
// zero row reads as "nothing happened", and only the second is true.
//
// WHY A SEPARATE, PURE FUNCTION
// ─────────────────────────────
// The T-12 route (server/routes-investor-analytics.ts) is DB-backed, so its
// grid math cannot be exercised without a database. Pulling the bucketing and
// the operating-only NOI rule out into a pure function gives them a real
// behavioural test (tests/unit/t12Workspace.test.ts) rather than a source-level
// assertion, and keeps the zero-fill invariant in ONE place.
//
// OPERATING-ONLY NOI, THE SAME RULE AS summarizeMeasuredOpEx
// ─────────────────────────────────────────────────────────
// NOI is net OPERATING income, so the grid's expense side and the per-category
// rows are OPERATING expenses only. Rows are filtered by their STORED
// `isOperating` flag (never recomputed from the category here — a later
// reclassification of a category must not silently rewrite history), so the two
// non-operating Schedule-E lines (mortgage_interest, depreciation) never reach a
// month's operatingExpenseCents, its byCategoryCents, or its noiCents. A levered
// and an unlevered owner of the same building read the same T-12 NOI.
//
// CASH BASIS, DELIBERATELY
// ────────────────────────
// Income is rent RECEIVED (rent_payments.amountCents bucketed by receivedAt),
// not rent CHARGED — the T-12 is what the building actually collected, the check
// on a seller's pro-forma, so it must not count a billed-but-unpaid month as
// income. Expenses are money actually spent (property_expenses). Both axes are
// cash the operator can reconcile against a bank statement.
// ============================================================================

import type { MeasurableExpenseRow } from "./noi";
import type { PropertyExpenseCategory } from "./propertyExpense";

/** How many month rows a T-12 grid always has. Trailing TWELVE — no more, no fewer. */
export const T12_MONTHS = 12;

/**
 * A cash-basis income row — one rent PAYMENT, as much of it as the grid needs.
 * `receivedAt` is the YYYY-MM-DD the money was received (rent_payments.receivedAt,
 * a date); its month bucket is the column the payment lands in. Cash basis: a
 * payment counts in the month it arrived, never the month it was charged for.
 */
export interface T12IncomeRow {
  receivedAt: string;
  amountCents: number;
}

/**
 * One month column of the grid. Every field is a fact about THIS month alone:
 * nothing is spread, averaged, or annualised. `incomeCents` and
 * `operatingExpenseCents` are the month's cash in and operating cash out;
 * `byCategoryCents` breaks the operating expense down by Schedule-E line (only
 * OPERATING categories ever appear, so the category cells sum to
 * `operatingExpenseCents`); `noiCents` is income minus operating expense for the
 * month. A month with no activity is all zeros — and is still emitted.
 */
export interface T12MonthRow {
  /** YYYY-MM. */
  month: string;
  incomeCents: number;
  operatingExpenseCents: number;
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  /** incomeCents − operatingExpenseCents (operating expenses only). */
  noiCents: number;
}

/**
 * The twelve month keys of the window, in order, starting at `windowStartMonth`.
 * Pure calendar arithmetic (no Date, so no timezone can shift a month boundary):
 * a "YYYY-MM" plus an integer month offset, carrying into the year.
 */
function windowMonthKeys(windowStartMonth: string): string[] {
  const [rawYear, rawMonth] = windowStartMonth.split("-");
  const startYear = Number(rawYear);
  const startMonthIndex = Number(rawMonth) - 1; // 0-based
  const keys: string[] = [];
  for (let i = 0; i < T12_MONTHS; i++) {
    const total = startMonthIndex + i;
    const year = startYear + Math.floor(total / 12);
    const monthIndex = ((total % 12) + 12) % 12; // 0-based, safe for any input
    keys.push(`${year}-${String(monthIndex + 1).padStart(2, "0")}`);
  }
  return keys;
}

/** The YYYY-MM bucket of an ISO date, or null when it is blank/malformed. */
function monthBucket(isoDate: string | null | undefined): string | null {
  return typeof isoDate === "string" && isoDate.length >= 7 ? isoDate.slice(0, 7) : null;
}

/**
 * Build the trailing-12 income / operating-expense / NOI grid.
 *
 * Returns EXACTLY twelve rows — one per calendar month from `windowStartMonth`
 * (a "YYYY-MM") forward — zero-filled, so a month that carries no income and no
 * expense is present as a row of zeros rather than being dropped. Income is the
 * sum of `incomeRows` whose receivedAt month falls in the window; operating
 * expense is the sum of `expenseRows` that are `isOperating` AND fall in the
 * window, broken out per Schedule-E category; NOI is income minus operating
 * expense per month. Rows whose month is OUTSIDE the twelve-month window are
 * ignored — never folded into a boundary month — so the grid can never attribute
 * a stray thirteenth-month row to a month it did not belong to.
 */
export function buildT12Grid(
  incomeRows: T12IncomeRow[],
  expenseRows: MeasurableExpenseRow[],
  windowStartMonth: string,
): T12MonthRow[] {
  const monthKeys = windowMonthKeys(windowStartMonth);
  const index = new Map<string, T12MonthRow>();
  const rows: T12MonthRow[] = monthKeys.map((month) => {
    const row: T12MonthRow = {
      month,
      incomeCents: 0,
      operatingExpenseCents: 0,
      byCategoryCents: {},
      noiCents: 0,
    };
    index.set(month, row);
    return row;
  });

  for (const income of incomeRows) {
    const bucket = monthBucket(income.receivedAt);
    if (bucket === null) continue;
    const row = index.get(bucket);
    if (!row) continue; // outside the twelve-month window — dropped, not misfiled
    row.incomeCents += Math.round(Number(income.amountCents));
  }

  for (const expense of expenseRows) {
    // Read the STORED operating flag — never recompute from the category — so
    // mortgage_interest and depreciation stay out of the NOI grid exactly as the
    // operator's write recorded them.
    if (!expense.isOperating) continue;
    const bucket = monthBucket(expense.incurredOn);
    if (bucket === null) continue;
    const row = index.get(bucket);
    if (!row) continue;
    const cents = Math.round(Number(expense.amountCents));
    row.operatingExpenseCents += cents;
    row.byCategoryCents[expense.category] = (row.byCategoryCents[expense.category] ?? 0) + cents;
  }

  for (const row of rows) {
    row.noiCents = row.incomeCents - row.operatingExpenseCents;
  }

  return rows;
}

/**
 * Sum the grid down to its window totals — the "Total" column an operator reads
 * across the year. Every total is a sum of VISIBLE cells (the same zero-filled
 * months), so it can never disagree with the grid it came from.
 */
export interface T12Totals {
  incomeCents: number;
  operatingExpenseCents: number;
  byCategoryCents: Partial<Record<PropertyExpenseCategory, number>>;
  noiCents: number;
}

export function summarizeT12(grid: T12MonthRow[]): T12Totals {
  const totals: T12Totals = { incomeCents: 0, operatingExpenseCents: 0, byCategoryCents: {}, noiCents: 0 };
  for (const row of grid) {
    totals.incomeCents += row.incomeCents;
    totals.operatingExpenseCents += row.operatingExpenseCents;
    totals.noiCents += row.noiCents;
    for (const [category, cents] of Object.entries(row.byCategoryCents)) {
      const key = category as PropertyExpenseCategory;
      totals.byCategoryCents[key] = (totals.byCategoryCents[key] ?? 0) + (cents ?? 0);
    }
  }
  return totals;
}
