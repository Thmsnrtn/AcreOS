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

// NOT re-exported. `periodicStatements` briefly imported the parser through
// this module — a two-hop path that made a Reg-Z statements module depend on
// the notes-delinquency module for a generic date parse. It imports
// `@shared/dates/calendar` directly now.


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

/**
 * The note's grace period in days, or `null` when the record does not carry one.
 *
 * ── WHY THIS EXISTS ─────────────────────────────────────────────────────────
 * Three call sites read `acquired_notes.grace_period_days`, and they disagreed
 * about the same term on the same note:
 *
 *   server/jobs/acquiredNoteAging.ts   `note.gracePeriodDays ?? 0`
 *   server/services/documents.ts       `note.gracePeriodDays || 10`
 *   server/routes-documents.ts         `note.gracePeriodDays || 10`
 *
 * So the servicing engine measured delinquency against a ZERO-day grace period
 * while the promissory note the borrower signs — the one with a SIGNATURES
 * block — promised TEN. A borrower could be marked late by the engine inside a
 * window the instrument grants them.
 *
 * The `||` is worse than the disagreement. It fires on `0`, so a note whose
 * record explicitly says "no grace period" generated a legal document
 * asserting ten days. That is not a default filling a gap; it is a document
 * contradicting the record it was generated from.
 *
 * ── THE CONTRACT ────────────────────────────────────────────────────────────
 * • an explicit `0` is a REAL TERM and is returned as `0`;
 * • `null` / `undefined` / a non-finite or negative value means the record does
 *   not state one, and the answer is `null` — never a stand-in;
 * • callers decide what to do with `null`, and they must decide DIFFERENTLY:
 *   the aging engine may treat "unstated" as no grace (conservative for the
 *   lender is not conservative for the borrower, so it says so in a log), while
 *   a document may not print a number nobody agreed to.
 *
 * The column carries `.default(10)` in the schema, so a note created through
 * the app has 10. `null` reaches here from imported or legacy rows — exactly
 * the notes whose terms AcreOS did not originate and must not invent.
 */
export function noteGracePeriodDays(
  gracePeriodDays: number | null | undefined,
): number | null {
  if (gracePeriodDays === null || gracePeriodDays === undefined) return null;
  if (!Number.isFinite(gracePeriodDays)) return null;
  if (gracePeriodDays < 0) return null;
  return Math.floor(gracePeriodDays);
}
