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
/**
 * cents → "$1,234.56", with a real minus sign for negatives. Locale-independent
 * on purpose: `toLocaleString` renders differently per runtime ICU build, so a
 * figure frozen into a decision record would not read back identically.
 *
 * THIS IS THE ONLY `formatCents` IN THE REPOSITORY, and `formatCentsIsCanonical`
 * .test.ts keeps it that way by scanning source for definitions rather than
 * trusting a list here. That derivation is the point: this comment used to state
 * how many rivals there were and name them, and was wrong on both the count and
 * the names — seven had accumulated, because a hand-written register in prose
 * has no way to notice the eighth. (The retired sentence is deliberately not
 * quoted here; the test that forbids a new count claim would match the
 * quotation, which is the tenth time in this program that prose has tripped a
 * check meant for code.)
 *
 * The copies were not all the same function, which is why unifying them blindly
 * would have changed behaviour: two were byte-identical to this, one used
 * `toLocaleString`, two abbreviated ($1.2M / $3.4K), and one aliased `usd()`.
 * Each now points at the canonical renderer for what it actually does — this one
 * for exact money, `client/src/lib/format.ts#dollarsCompact` for the abbreviated
 * form, `#usd` for dollar-valued input.
 */
export function formatCents(cents: number): string {
  const neg = cents < 0;
  const s = (Math.abs(cents) / 100).toFixed(2);
  const [int, frac] = s.split(".");
  const withCommas = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${neg ? "−" : ""}$${withCommas}.${frac}`;
}

export function sumCents(values: Array<string | number | null | undefined>): number {
  let total = 0;
  for (const v of values) total += centsFromDecimal(v);
  return total;
}
