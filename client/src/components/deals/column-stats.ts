/**
 * Column intelligence for the Deals board (Wave 1.3, handoff P1 §4.2
 * move 1, first slice): per-column count + total value DERIVED from the
 * rows the board has actually loaded — pure client-side arithmetic over
 * real data. No endpoint, no invented numbers: a column's value line is
 * exactly the sum of the amounts its visible cards display.
 *
 * Amount semantics mirror DealCard: a deal's display value is its
 * acceptedAmount when present, else its offerAmount (drizzle `numeric`
 * columns arrive as strings). Deals with neither contribute nothing —
 * `valuedCount` says how many cards actually carry a number, so a column
 * whose total omits some cards can say so instead of implying coverage.
 *
 * Pure module — unit-tested in tests/unit/doorInteractions.test.tsx.
 */

export interface DealAmountLike {
  acceptedAmount?: string | number | null;
  offerAmount?: string | number | null;
}

export interface ColumnStats {
  /** Rows in the column (loaded rows — the same set the column renders). */
  count: number;
  /** Sum of each row's display amount (accepted ?? offer), finite only. */
  totalValue: number;
  /** How many rows contributed a finite amount to totalValue. */
  valuedCount: number;
}

/** A candidate parses when it's non-null, non-empty, and a finite number. */
function parseAmount(candidate: string | number | null | undefined): number | null {
  if (candidate == null || candidate === "") return null;
  const n = typeof candidate === "string" ? Number(candidate) : candidate;
  return Number.isFinite(n) ? n : null;
}

/**
 * A deal's display value — acceptedAmount first (the agreed number), else
 * offerAmount, else null. Mirrors DealCard's amount line exactly.
 */
export function dealDisplayValue(deal: DealAmountLike): number | null {
  return parseAmount(deal.acceptedAmount) ?? parseAmount(deal.offerAmount);
}

/** Count + total value for one board column, from its loaded rows. */
export function columnStats(deals: ReadonlyArray<DealAmountLike>): ColumnStats {
  let totalValue = 0;
  let valuedCount = 0;
  for (const deal of deals) {
    const value = dealDisplayValue(deal);
    if (value !== null) {
      totalValue += value;
      valuedCount += 1;
    }
  }
  return { count: deals.length, totalValue, valuedCount };
}
