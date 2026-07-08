/**
 * Integer-cents conversion seam (roadmap W3.3, 2026-07 audit).
 *
 * House rule: money is SUMMED and COMPARED in integer cents, never in JS
 * floats. Postgres `numeric` columns are exact — the drift only enters when
 * code does `parseFloat(row.amount)` and then `+=` in a float accumulator
 * (0.1 + 0.2 !== 0.3), or casts an aggregate to `::float8`. The
 * borrower-payment layer (server/services/notePaymentMath.ts) got this
 * right from day one; this module is the shared conversion helper so every
 * other money path can adopt the same model without re-inventing rounding.
 *
 * Conventions (match notePaymentMath):
 *  - `Math.round` half-up at the cent boundary, applied ONCE per value at
 *    the string→cents edge — never on running totals.
 *  - Cents are plain `number` (safe: 2^53 cents ≈ $90 trillion).
 *  - Format/display converts back at the very end via `dollarsFromCents`.
 */

/**
 * Parse a decimal money value (Drizzle `numeric` string, number, or null)
 * into integer cents. Invalid/absent input → 0 (money code treats missing
 * as zero, mirroring the `coalesce(..., 0)` it replaces).
 */
export function centsFromDecimal(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/** Integer cents → decimal dollars (for display/API edges only). */
export function dollarsFromCents(cents: number): number {
  return cents / 100;
}

/**
 * Sum a list of decimal money values in integer cents. The safe
 * replacement for `values.reduce((s, v) => s + parseFloat(v), 0)`.
 */
export function sumCents(values: Array<string | number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += centsFromDecimal(v);
  return total;
}
