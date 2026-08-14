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

// `parseCalendarDate` moved to `shared/dates/calendar.ts` once three other
// subsystems turned out to need it — the deposit-return deadline, note payoff
// math, and the rent-ledger request boundary. Re-exported here so this module
// stays the import site for the notes surfaces.
import { parseCalendarDate } from "../dates/calendar";

export { parseCalendarDate };


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
