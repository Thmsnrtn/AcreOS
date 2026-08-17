// ============================================================================
// SHARED/DATES/CALENDAR.TS — an impossible date is refused, never rolled forward.
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. One function, and it
// exists because JavaScript answers the wrong question by default:
//
//     new Date("2026-02-30T00:00:00.000Z")   // → March 2nd, and Number.isFinite
//                                            //   agrees it is a fine date
//
// February 30th is not a day. Every parser in this repo that trusted `new Date`
// therefore turned a nonexistent date into a real one two days later, silently,
// and the surfaces that did it were the ones where two days matter:
//
//   • `shared/regulatory/depositReturnRules.ts` computed the STATUTORY
//     security-deposit return deadline. `2026-02-30` became March 2, so a
//     21-day deadline landed on 2026-03-23 instead of 2026-03-21 — late, on an
//     obligation that carries penalties in most states for being late.
//   • `server/services/notePaymentMath.ts#parseIsoDateUtc` parses PAYOFF and
//     payment-posting dates. `GET /api/notes/:id/payoff?date=2026-02-30` quoted
//     a borrower two extra days of interest, and the route's own
//     `catch → 400 "date must be a valid ISO date"` never fired, because
//     nothing threw.
//   • Both were reachable from a request. The rent-ledger boundary validator
//     that should have stopped them read
//     `z.string().regex(/^\d{4}-\d{2}-\d{2}$/)` under the comment *"validated
//     rather than coerced — a bad date must not become one"*, which is a SHAPE
//     test and the exact thing it says it is not.
//
// The fix is one line of arithmetic — construct the date, then check that it
// reads back as the fields you put in — and it belongs in one place rather than
// in each of the four parsers that needed it.
//
// WHY IT IS NOT NAMED `parseIsoDate`. Because that name was already taken, twice,
// by functions that answer this question differently. A name that means "parses
// a date" where one caller gets a refusal and another gets March 2nd is how the
// defect survived; `parseCalendarDate` says which one it is.
// ============================================================================

/**
 * `YYYY-MM-DD` at the START of the value, so an ISO datetime also matches.
 * Shape only — whether those digits are a real day is decided below.
 */
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Strict calendar-date coercion. Accepts a `date` column (ISO `'YYYY-MM-DD'`), a
 * `timestamp` column (a `Date`), or an ISO datetime string, and always returns a
 * UTC-midnight `Date` — calendar dates are not instants, so local-time
 * construction would shift the answer by a day for anyone west of UTC.
 *
 * Returns `null` for anything unparseable AND for a date JS would silently roll
 * over. The round-trip through `Date.UTC` is the whole point: the parsed value is
 * compared field-by-field against the input, which is what separates this from a
 * regex. Bad stored data must surface as "unknown", not as a date nobody agreed
 * to.
 */
export function parseCalendarDate(value: string | Date | null | undefined): Date | null {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return new Date(
      Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()),
    );
  }
  if (typeof value !== "string") return null;
  const match = ISO_DATE_PREFIX.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check catches the rollover cases (Feb 30, Apr 31, month 13, ...).
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

/** True when `value` names a real calendar day. */
export function isCalendarDate(value: string | Date | null | undefined): boolean {
  return parseCalendarDate(value) !== null;
}
