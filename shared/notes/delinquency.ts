// ============================================================================
// SHARED/NOTES/DELINQUENCY.TS — may we say this borrower is behind?
// ----------------------------------------------------------------------------
// Pure and browser-safe: no DB, no `process`, no imports. One predicate, and it
// answers a REFUSAL question rather than a computational one: *can a note's
// aging be determined at all?*
//
// WHY IT LIVES IN shared/ AND NOT ON EITHER SIDE. It had three implementations —
// `server/services/notes/acquiredNoteSchedule.ts` (which calls itself "the one
// place that answers when money is next due"), `client/src/pages/notes.tsx`, and
// `client/src/pages/note-detail.tsx`. Both client copies carried the same note:
//
//     Mirrors `delinquencyIsDeterminable` in
//     server/services/notes/acquiredNoteSchedule.ts (the client cannot import
//     server code, so the check is restated here rather than approximated).
//
// True about `server/`, and it skips the option that resolves it: `shared/` is
// browser-safe by construction (`lint:browser-safe-shared` enforces it) and both
// sides already import from it. So the honest reading of that comment is not
// "restating was necessary" but "this predicate was in the wrong directory" —
// and while it sat there the mirror drifted. The client copies tested the SHAPE
// of the string, `/^\d{4}-\d{2}-\d{2}$/`, while the server parsed the date and
// round-tripped it through `Date.UTC`. `"2026-02-30"` and `"2026-13-45"` match
// the shape and are not days. The client would have declared aging determinable
// for a date the server refuses to measure from.
//
// Not reachable today — the value comes from `acquired_notes.next_payment_date`,
// a Postgres `date` column, which cannot hold an impossible day — and that is
// recorded rather than dressed up as a live fix. The point is the direction: a
// predicate that decides whether the product may make a claim about a borrower's
// standing must not have two answers, and a comment admitting a mirror is a
// standing invitation to write a third.
//
// The constitution's refuse-not-fabricate rule is what this serves. A note whose
// due date the server could not derive gets a NEUTRAL `0` / `"current"` written
// to NOT NULL columns whose band union has no "unknown" member — so the number
// cannot be the discriminator, and reading it as one printed a reassuring
// "Current" chip beside "Next payment not on file". The DATE is the only honest
// discriminator, and this is the one place that judges it.
// ============================================================================

/** `YYYY-MM-DD` at the START of the value, so an ISO datetime also matches.
 *  Shape only — whether those digits are a real day is decided below. */
const ISO_DATE_PREFIX = /^(\d{4})-(\d{2})-(\d{2})/;

/**
 * Strict calendar-date coercion. Accepts a `date` column (ISO 'YYYY-MM-DD'), a
 * `timestamp` column (a `Date`), or an ISO datetime string, and always returns a
 * UTC-midnight `Date` — note due dates are calendar dates, not instants, so
 * local-time construction would shift the answer by a day for anyone west of UTC.
 *
 * Returns `null` for anything unparseable, and for a date JS would silently roll
 * over: `new Date("2026-02-30")` is March 2nd, so the parsed value is compared
 * field-by-field against the input. Bad stored data must surface as "unknown",
 * not as a date nobody agreed to.
 *
 * NAMED `parseCalendarDate`, not `parseIsoDate`, and the distinction is
 * load-bearing. `shared/regulatory/depositReturnRules.ts` exports a
 * `parseIsoDate` that does `String(iso).slice(0, 10)` and then trusts
 * `new Date()`, so it ACCEPTS `"2026-02-30"` and silently returns March 2 — on a
 * statutory security-deposit return deadline. Two functions with one name and
 * opposite answers about whether a date EXISTS is precisely what this module was
 * created to stop, so the strict one takes a name that says which it is.
 *
 * THIS BODY CAME FROM `server/services/periodicStatements/index.ts`, which had
 * independently written the same function and made it better: it also takes a
 * `Date` and an ISO datetime, where the copy this module started with accepted
 * only an anchored 'YYYY-MM-DD'. That matters beyond tidiness — `next_payment_date`
 * is a `date` column on `acquired_notes` and a `timestamp` on two other tables,
 * so the anchored version would refuse a due date that genuinely exists. Adopting
 * the superset is a WIDENING, safe on every current caller (all of them pass
 * 'YYYY-MM-DD' produced by `toIsoDate`) and correct on the ones that do not yet.
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

/**
 * True when the note's aging can be determined at all — i.e. there is a real due
 * date to measure from.
 *
 * This is NOT the same question as `daysDelinquent === 0`. See the header: the
 * neutral zero written for an underivable schedule is indistinguishable from a
 * genuinely current note if you key off the number.
 */
export function delinquencyIsDeterminable(
  nextPaymentDate: string | Date | null | undefined,
): boolean {
  return parseCalendarDate(nextPaymentDate ?? null) !== null;
}
