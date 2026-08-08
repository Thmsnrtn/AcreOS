/**
 * THE T-12 GRID (Wave 3, multifamily → core, stage 5).
 *
 * WHAT THIS FILE PINS
 * -------------------
 * buildT12Grid is pure — no DB — so the ONE invariant the workspace rests on is
 * a behavioural test, not a source assertion:
 *
 *   1. EXACTLY twelve rows, contiguous and in order, ZERO-FILLED — a month with
 *      no income and no expense is PRESENT as a row of zeros, never omitted and
 *      never inferred from an average.
 *   2. NOI = income − OPERATING expense, per month.
 *   3. Per-category operating sums are correct and land in the right month.
 *   4. The two non-operating Schedule-E lines (mortgage_interest, depreciation)
 *      are EXCLUDED from operating expense, from byCategoryCents, and therefore
 *      from NOI — a levered and an unlevered owner read the same NOI.
 *   5. Rows outside the twelve-month window are dropped, never misfiled into a
 *      boundary month; summarizeT12 totals equal the sum of the visible cells.
 *
 * The whole risk of a T-12 is a month that quietly disappears (reads as "no
 * data" when the truth is "nothing happened") or a financing cost sneaking into
 * NOI. Both are pinned here.
 */
import { describe, it, expect } from "vitest";

import {
  buildT12Grid,
  summarizeT12,
  T12_MONTHS,
  type T12IncomeRow,
} from "../../shared/rental/t12";
import {
  isOperatingCategory,
  type PropertyExpenseCategory,
} from "../../shared/rental/propertyExpense";
import type { MeasurableExpenseRow } from "../../shared/rental/noi";

/** An expense row, isOperating derived exactly as the write path does. */
function exp(
  category: PropertyExpenseCategory,
  amountCents: number,
  incurredOn: string,
): MeasurableExpenseRow {
  return { category, amountCents, isOperating: isOperatingCategory(category), incurredOn };
}

function inc(receivedAt: string, amountCents: number): T12IncomeRow {
  return { receivedAt, amountCents };
}

// A concrete window used across the cases: Jan..Dec 2026.
const START = "2026-01";
const MONTHS = [
  "2026-01", "2026-02", "2026-03", "2026-04", "2026-05", "2026-06",
  "2026-07", "2026-08", "2026-09", "2026-10", "2026-11", "2026-12",
];

// ---------------------------------------------------------------------------
// 1. Exactly twelve zero-filled rows.
// ---------------------------------------------------------------------------

describe("buildT12Grid produces exactly twelve zero-filled rows", () => {
  it("empty inputs still yield twelve contiguous month rows, all zeros", () => {
    const grid = buildT12Grid([], [], START);
    expect(grid).toHaveLength(T12_MONTHS);
    expect(grid.map((r) => r.month)).toEqual(MONTHS);
    for (const row of grid) {
      expect(row.incomeCents).toBe(0);
      expect(row.operatingExpenseCents).toBe(0);
      expect(row.noiCents).toBe(0);
      expect(row.byCategoryCents).toEqual({});
    }
  });

  it("crosses a year boundary correctly (a window starting mid-year)", () => {
    const grid = buildT12Grid([], [], "2025-08");
    expect(grid).toHaveLength(12);
    expect(grid[0].month).toBe("2025-08");
    expect(grid[5].month).toBe("2026-01"); // Aug 2025 + 5 = Jan 2026
    expect(grid[11].month).toBe("2026-07");
  });

  it("a month with no income or expense is PRESENT as a zero row, not omitted", () => {
    // Activity only in March; every other month must still exist, at zero.
    const grid = buildT12Grid(
      [inc("2026-03-10", 140_000)],
      [exp("repairs", 20_000, "2026-03-15")],
      START,
    );
    expect(grid).toHaveLength(12);
    const jan = grid.find((r) => r.month === "2026-01")!;
    expect(jan).toBeDefined();
    expect(jan.incomeCents).toBe(0);
    expect(jan.operatingExpenseCents).toBe(0);
    expect(jan.noiCents).toBe(0);
    // …and the active month carries the real numbers.
    const mar = grid.find((r) => r.month === "2026-03")!;
    expect(mar.incomeCents).toBe(140_000);
    expect(mar.operatingExpenseCents).toBe(20_000);
    expect(mar.noiCents).toBe(120_000);
  });
});

// ---------------------------------------------------------------------------
// 2. NOI = income − operating expense, per month.
// ---------------------------------------------------------------------------

describe("NOI is income minus operating expense, month by month", () => {
  it("computes NOI per month, including a negative NOI month", () => {
    const grid = buildT12Grid(
      [inc("2026-01-05", 100_000), inc("2026-02-05", 100_000)],
      [
        exp("repairs", 30_000, "2026-01-20"),
        exp("insurance", 250_000, "2026-02-02"), // a big month → NOI goes negative
      ],
      START,
    );
    const jan = grid.find((r) => r.month === "2026-01")!;
    const feb = grid.find((r) => r.month === "2026-02")!;
    expect(jan.noiCents).toBe(70_000); // 100k − 30k
    expect(feb.noiCents).toBe(-150_000); // 100k − 250k, honestly negative
  });

  it("multiple payments in a month sum into that month's income", () => {
    const grid = buildT12Grid(
      [inc("2026-05-03", 70_000), inc("2026-05-18", 70_000)], // partial payments
      [],
      START,
    );
    const may = grid.find((r) => r.month === "2026-05")!;
    expect(may.incomeCents).toBe(140_000);
    expect(may.noiCents).toBe(140_000);
  });
});

// ---------------------------------------------------------------------------
// 3. Per-category operating sums.
// ---------------------------------------------------------------------------

describe("per-category operating sums land in the right month", () => {
  it("sums categories within a month and keeps them broken out", () => {
    const grid = buildT12Grid(
      [],
      [
        exp("repairs", 30_000, "2026-04-05"),
        exp("repairs", 10_000, "2026-04-25"),
        exp("utilities", 12_000, "2026-04-10"),
      ],
      START,
    );
    const apr = grid.find((r) => r.month === "2026-04")!;
    expect(apr.byCategoryCents).toEqual({ repairs: 40_000, utilities: 12_000 });
    expect(apr.operatingExpenseCents).toBe(52_000);
  });

  it("summarizeT12 totals equal the sum of the visible month cells", () => {
    const grid = buildT12Grid(
      [inc("2026-01-05", 100_000), inc("2026-07-05", 100_000)],
      [exp("taxes", 60_000, "2026-01-05"), exp("taxes", 60_000, "2026-07-05")],
      START,
    );
    const totals = summarizeT12(grid);
    expect(totals.incomeCents).toBe(200_000);
    expect(totals.operatingExpenseCents).toBe(120_000);
    expect(totals.byCategoryCents).toEqual({ taxes: 120_000 });
    expect(totals.noiCents).toBe(80_000);
  });
});

// ---------------------------------------------------------------------------
// 4. Non-operating categories are excluded from NOI.
// ---------------------------------------------------------------------------

describe("non-operating Schedule-E lines never enter NOI", () => {
  it("mortgage_interest and depreciation are excluded from opex, byCategory and NOI", () => {
    const grid = buildT12Grid(
      [inc("2026-06-01", 100_000)],
      [
        exp("repairs", 20_000, "2026-06-10"),
        exp("mortgage_interest", 500_000, "2026-06-01"),
        exp("depreciation", 300_000, "2026-06-01"),
      ],
      START,
    );
    const jun = grid.find((r) => r.month === "2026-06")!;
    // Only the $200 repair is operating; the financing + non-cash lines are out.
    expect(jun.operatingExpenseCents).toBe(20_000);
    expect(jun.byCategoryCents).toEqual({ repairs: 20_000 });
    expect(jun.byCategoryCents.mortgage_interest).toBeUndefined();
    expect(jun.byCategoryCents.depreciation).toBeUndefined();
    // NOI reflects operating expense only: 100k − 20k, NOT 100k − 820k.
    expect(jun.noiCents).toBe(80_000);
  });

  it("a month with ONLY non-operating expense has zero opex and NOI equal to income", () => {
    const grid = buildT12Grid(
      [inc("2026-09-01", 100_000)],
      [exp("mortgage_interest", 500_000, "2026-09-01")],
      START,
    );
    const sep = grid.find((r) => r.month === "2026-09")!;
    expect(sep.operatingExpenseCents).toBe(0);
    expect(sep.byCategoryCents).toEqual({});
    expect(sep.noiCents).toBe(100_000);
  });
});

// ---------------------------------------------------------------------------
// 5. Out-of-window rows are dropped, never misfiled.
// ---------------------------------------------------------------------------

describe("rows outside the twelve-month window are dropped, not misfiled", () => {
  it("an income/expense dated outside the window affects no month", () => {
    const grid = buildT12Grid(
      [inc("2025-12-31", 999_999), inc("2027-01-01", 999_999)], // both outside Jan..Dec 2026
      [exp("repairs", 999_999, "2025-11-01")], // outside too
      START,
    );
    expect(grid).toHaveLength(12);
    for (const row of grid) {
      expect(row.incomeCents).toBe(0);
      expect(row.operatingExpenseCents).toBe(0);
      expect(row.noiCents).toBe(0);
    }
    expect(summarizeT12(grid).incomeCents).toBe(0);
  });

  it("a blank or malformed date contributes to no month rather than a bogus one", () => {
    const grid = buildT12Grid(
      [inc("", 100_000)],
      [exp("repairs", 100_000, "")],
      START,
    );
    expect(summarizeT12(grid).incomeCents).toBe(0);
    expect(summarizeT12(grid).operatingExpenseCents).toBe(0);
  });
});
