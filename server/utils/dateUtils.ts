/**
 * Safe month arithmetic that handles month-end overflow.
 *
 * JavaScript's Date.setMonth() silently rolls over when the day exceeds the
 * target month's length (e.g. Jan 31 + 1 month → Mar 3 instead of Feb 28).
 * This corrupts payment schedules, maturity dates, and any financial date math.
 *
 * addMonths() clamps the result to the last day of the target month whenever
 * overflow is detected.
 */

export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const targetMonth = d.getMonth() + months;
  d.setMonth(targetMonth);
  // Clamp to last day of target month if overflow occurred
  if (d.getMonth() !== ((targetMonth % 12) + 12) % 12) {
    d.setDate(0); // Sets to last day of previous month
  }
  return d;
}
