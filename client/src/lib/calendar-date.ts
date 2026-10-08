/**
 * Calendar dates (a day, no time of day) carried in a timestamp column.
 *
 * An `<input type="date">` yields "2026-11-01". `new Date("2026-11-01")` parses
 * that as UTC MIDNIGHT, and formatting it in the viewer's local time put it on
 * the previous day anywhere west of UTC — a campaign planned for Nov 1 showed
 * as "Oct 31". These helpers keep the picked day the same day everywhere:
 *
 *  - a picked day is stored at 12:00 UTC (same calendar day from UTC-11 to
 *    UTC+11 even if some reader formats it in local time);
 *  - it is always READ back by its UTC calendar parts, which also renders the
 *    rows already stored at UTC midnight on the day the customer picked.
 */

const CALENDAR_DATE_FMT = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  timeZone: "UTC",
});

function toValidDate(value: Date | string | null | undefined): Date | null {
  if (value == null || value === "") return null;
  const d = value instanceof Date ? value : new Date(value);
  return isNaN(d.getTime()) ? null : d;
}

/** "2026-11-01" (from a date input) → 2026-11-01T12:00:00Z; "" → undefined. */
export function calendarDateFromInput(value: string): Date | undefined {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return undefined;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12));
  return isNaN(d.getTime()) ? undefined : d;
}

/** A stored calendar date → the "yyyy-MM-dd" a date input expects ("" if none). */
export function calendarDateToInput(value: Date | string | null | undefined): string {
  const d = toValidDate(value);
  if (!d) return "";
  const y = String(d.getUTCFullYear()).padStart(4, "0");
  const mo = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${mo}-${day}`;
}

/** A stored calendar date in the house style: "Nov 1, 2026" ("—" if none). */
export function formatCalendarDate(value: Date | string | null | undefined): string {
  const d = toValidDate(value);
  return d ? CALENDAR_DATE_FMT.format(d) : "—";
}
