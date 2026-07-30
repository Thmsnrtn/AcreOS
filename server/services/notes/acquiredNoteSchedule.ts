/**
 * acquiredNoteSchedule — the one place that answers "when is money next due
 * on this acquired note?"
 *
 * WHY THIS EXISTS
 * ---------------
 * `acquired_notes` stores `paymentDueDay` (1-31) and nothing else about
 * timing. Every surface that needed a due date therefore invented one:
 *
 *  - `client/src/pages/notes.tsx` derives "Next payment" in the BROWSER from
 *    `paymentDueDay` + `new Date()`. It never asks whether a payment was
 *    made, and it rolls a past-due date forward to next month — so a note six
 *    months behind renders the same friendly date as a current one. That is
 *    fabrication by omission: the screen states a fact ("next payment: the
 *    15th") that is not true of that note.
 *  - `server/services/periodicStatements/index.ts` stamps "the 1st of next
 *    month" on every Reg-Z §1026.41 periodic statement regardless of the
 *    note's actual due day.
 *  - `server/services/lateFees/index.ts` and
 *    `server/services/respa/earlyIntervention.ts` were correct modules with
 *    ZERO production callers, because nothing could hand them a due date.
 *    `earlyIntervention` now has its first one: `server/jobs/acquiredNoteAging.ts`
 *    calls `flagEarlyIntervention` at the §1024.39 day-36 gate, off the days
 *    this module derives. `lateFees` still has none — `assessLateFee` /
 *    `shouldAssessLateFee` have no production call site anywhere in the repo,
 *    so the §1026.36(c)(2) guard and the one-fee-per-cycle write remain
 *    unreached. `lateFeeAssessable` below is only the ADVISORY read; it
 *    assesses nothing, and it is not that caller.
 *
 * This module is the missing input. It is deliberately PURE — no db, no
 * storage, no logger, no express, and no `new Date()` anywhere (module scope
 * or otherwise). Every entry point takes `asOf` explicitly so that "what does
 * this note look like on 2026-03-01?" is a test, not a mocked clock.
 *
 * THE HONESTY RULE THAT SHAPES EVERY RETURN TYPE
 * ----------------------------------------------
 * Each function can return `null`, and `null` means "we do not know" — never
 * a hopeful guess. Callers are expected to render an honest blank. Returning
 * a plausible-looking date for a note whose facts don't support one is the
 * exact defect this module was built to remove (constitution: refuse, never
 * fabricate).
 *
 * The sharpest instance is `historyPredatesAcquisition` below: a note bought
 * years after it was originated carries a servicing history AcreOS never saw,
 * and inferring a due date from origination alone would badge a borrower as a
 * default candidate — and trip a federal early-intervention obligation — off
 * a date nobody verified. `nextPaymentVerdict` returns the REASON for each
 * blank so callers can explain themselves instead of rendering a bare dash.
 */

/**
 * Delinquency bands.
 *
 * MUST stay identical to `DelinquencyStatus` in
 * `server/services/financeAgent.ts`. The originated-note book (financeAgent)
 * and the acquired-note book (this file) describe the same borrower reality;
 * if one calls 20 days past due "delinquent" and the other calls it
 * "seriously delinquent", the founder gets two different answers to one
 * question and stops trusting both.
 *
 * We cannot import from financeAgent — that module pulls in storage, the
 * OpenAI client, and the email rails, which would make this module impure and
 * un-unit-testable. So we re-declare, and `acquiredNoteSchedule.test.ts` pins
 * the equality by reading financeAgent.ts as TEXT and comparing the numbers.
 * That test is what makes the duplication safe.
 */
export type NoteDelinquencyStatus =
  | "current"
  | "early_delinquent"
  | "delinquent"
  | "seriously_delinquent"
  | "default_candidate";

/** Mirrors `DELINQUENCY_THRESHOLDS` in server/services/financeAgent.ts. */
export const NOTE_DELINQUENCY_THRESHOLDS: {
  earlyDelinquent: { min: number; max: number };
  delinquent: { min: number; max: number };
  seriouslyDelinquent: { min: number; max: number };
  defaultCandidate: { min: number; max: number };
} = {
  earlyDelinquent: { min: 1, max: 5 },
  delinquent: { min: 6, max: 15 },
  seriouslyDelinquent: { min: 16, max: 30 },
  defaultCandidate: { min: 31, max: Infinity },
};

/**
 * The facts a caller must assemble before a due date is derivable.
 *
 * `firstPaymentDate` and `paidThroughDate` are nullable because acquired
 * notes are frequently imported from a spreadsheet or a prior servicer's
 * export that carried neither. Nullable-and-honest beats defaulted-and-wrong:
 * a missing anchor produces `null` here, and `null` produces a blank on the
 * screen, which is the correct thing to show someone who genuinely does not
 * have the paperwork yet.
 */
export interface AcquiredNoteScheduleFacts {
  /** 1-31. Clamped to the month's last day (a "31st" note is due Feb 28/29). */
  paymentDueDay: number;
  /** 'YYYY-MM-DD' — the schedule anchor when the note's paperwork records it. */
  firstPaymentDate: string | null;
  /** 'YYYY-MM-DD' */
  originationDate: string;
  /** 'YYYY-MM-DD' */
  maturityDate: string;
  /**
   * 'YYYY-MM-DD' — the day WE bought the paper. Required (NOT NULL on the
   * table), and load-bearing: it is the only fact that distinguishes a note
   * whose servicing history AcreOS never saw from one it has watched since
   * day one. See the `history_predates_acquisition` rule below.
   */
  acquisitionDate: string;
  /** 'YYYY-MM-DD' — the due date of the last period FULLY satisfied. */
  paidThroughDate: string | null;
}

/**
 * Why the next due date is what it is — or why it is blank.
 *
 * The `basis` / `reason` discriminant exists so a screen can say "no schedule
 * on file — this note was acquired after origination and no payment history
 * was imported" instead of an unexplained dash. An unexplained blank reads as
 * a bug and gets worked around; an explained blank tells the operator exactly
 * which fact to go find.
 */
export type NextDueVerdict =
  | { date: string; basis: "paid_through" | "first_payment" | "origination" }
  | {
      date: null;
      reason:
        | "history_predates_acquisition"
        | "paid_through_maturity"
        | "incoherent_facts";
    };

const DAY_MS = 24 * 60 * 60 * 1000;

// ============================================================================
// DATE PRIMITIVES
//
// All arithmetic is UTC. Note dates are calendar dates, not instants — a
// payment due "the 15th" is due the 15th in every timezone. Using local-time
// Date construction would shift the answer by a day for anyone west of UTC,
// which is how due-date bugs usually enter a codebase.
// ============================================================================

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Strict 'YYYY-MM-DD' parse. Returns null rather than throwing, and rejects
 * dates that JS would silently roll over (`2025-02-30` becomes March 2nd if
 * you let `Date.UTC` have its way — we refuse it instead, because a note
 * whose stored maturity is 2025-02-30 has bad data and should surface as
 * "unknown", not as a March date nobody agreed to).
 */
function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Round-trip check catches the rollover cases (Feb 30, Apr 31, ...).
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== day
  ) {
    return null;
  }
  return parsed;
}

function toIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/** Days in a given UTC month. Day 0 of month+1 IS the last day of month. */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * The scheduled due date inside a specific month, clamped.
 *
 * A note with `paymentDueDay = 31` is due Feb 28 (or 29 in a leap year), not
 * March 3rd. Clamping by constructing day 0 of the FOLLOWING month is the
 * only formulation that gets leap years right without a leap-year branch.
 */
function dueDateInMonth(year: number, monthIndex: number, dueDay: number): Date {
  const clamped = Math.min(dueDay, daysInMonth(year, monthIndex));
  return new Date(Date.UTC(year, monthIndex, clamped));
}

/** Shift a scheduled due date by `months`, re-clamping in the target month. */
function shiftMonths(from: Date, months: number, dueDay: number): Date {
  return dueDateInMonth(
    from.getUTCFullYear(),
    from.getUTCMonth() + months,
    dueDay,
  );
}

// ============================================================================
// FACT VALIDATION
// ============================================================================

interface CoherentFacts {
  dueDay: number;
  origination: Date;
  maturity: Date;
  acquisition: Date;
  firstPayment: Date | null;
  paidThrough: Date | null;
}

/**
 * Turn raw facts into something we're willing to compute on, or null.
 *
 * Incoherent facts return null instead of throwing. A throw here would take
 * down a list endpoint rendering 200 notes because one row has a bad due day;
 * a null renders one honest blank next to 199 real dates.
 */
function coerceFacts(facts: AcquiredNoteScheduleFacts): CoherentFacts | null {
  const dueDay = facts?.paymentDueDay;
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return null;

  const origination = parseIsoDate(facts.originationDate);
  const maturity = parseIsoDate(facts.maturityDate);
  const acquisition = parseIsoDate(facts.acquisitionDate);
  if (!origination || !maturity || !acquisition) return null;
  // A note that matures before it originates is corrupt data, not a
  // zero-length note. Refuse rather than derive from nonsense.
  if (maturity.getTime() < origination.getTime()) return null;

  // Optional fields: present-but-unparseable is a data problem, so we refuse
  // the whole derivation. Silently ignoring a malformed paidThroughDate would
  // fall back to the anchor and report a note as wildly past due when it is
  // in fact current — the worst possible direction to be wrong in.
  if (facts.firstPaymentDate != null && !parseIsoDate(facts.firstPaymentDate)) {
    return null;
  }
  if (facts.paidThroughDate != null && !parseIsoDate(facts.paidThroughDate)) {
    return null;
  }

  return {
    dueDay,
    origination,
    maturity,
    acquisition,
    firstPayment: parseIsoDate(facts.firstPaymentDate),
    paidThrough: parseIsoDate(facts.paidThroughDate),
  };
}

/**
 * The first scheduled payment date of the note's life.
 *
 * When the paperwork records `firstPaymentDate`, that IS the anchor — no
 * recomputation, because the note says what it says.
 *
 * Otherwise the anchor is the first `paymentDueDay` STRICTLY after
 * origination. "Strictly" matters: a note originated on the 1st with a due
 * day of 1 does not have a payment due the day it is signed.
 */
function scheduleAnchor(facts: CoherentFacts): Date {
  if (facts.firstPayment) return facts.firstPayment;
  const candidate = dueDateInMonth(
    facts.origination.getUTCFullYear(),
    facts.origination.getUTCMonth(),
    facts.dueDay,
  );
  if (candidate.getTime() > facts.origination.getTime()) return candidate;
  return shiftMonths(candidate, 1, facts.dueDay);
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * The next date money is contractually due, WITH the basis for it (or the
 * reason there isn't one).
 *
 * Four rules do all the work, and each one exists because its absence caused,
 * or would have caused, a real defect:
 *
 * 1. **paidThroughDate is the truth when present.** Next due is the first
 *    scheduled date STRICTLY AFTER paid-through. Acquired notes are routinely
 *    imported mid-life — a 2019 origination bought in 2026 — so deriving from
 *    origination alone reports a seven-year-old date, and iterating forward
 *    from it invents eighty-odd periods that nobody in this system has any
 *    evidence about. We do direct month arithmetic off paid-through instead;
 *    it is O(1) and it makes no claim about the periods in between.
 *
 * 2. **A past-due date is NOT rolled forward.** If the answer is in the past
 *    relative to `asOf`, that IS the answer. Being overdue is the signal this
 *    entire module exists to surface; hiding it behind a friendly upcoming
 *    date (notes.tsx does exactly this) is why a six-months-behind note looks
 *    identical to a current one today.
 *
 * 3. **Past maturity is null, not a date.** Once the monthly schedule runs
 *    out, what's owed is a balloon/payoff figure, and that is a different
 *    surface with different math. Emitting a 361st monthly due date on a
 *    360-month note would be an invented obligation.
 *
 * 4. **A history AcreOS never saw is not a history we get to assert.** See
 *    `historyPredatesAcquisition` — this is the anti-fabrication rule, and it
 *    is the one with federal consequences.
 */
export function nextPaymentVerdict(
  facts: AcquiredNoteScheduleFacts,
  asOf: Date,
): NextDueVerdict {
  // `asOf` is required by the contract (callers must be explicit about "when"),
  // but note that it deliberately does NOT move the answer — see rule 2. It is
  // validated so a bad clock can't produce a confident-looking result.
  if (!(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    return { date: null, reason: "incoherent_facts" };
  }

  const coherent = coerceFacts(facts);
  if (!coherent) return { date: null, reason: "incoherent_facts" };

  const anchor = scheduleAnchor(coherent);
  let next: Date;
  let basis: "paid_through" | "first_payment" | "origination";

  if (coherent.paidThrough) {
    basis = "paid_through";
    // First scheduled due date strictly after paid-through. Start in
    // paid-through's own month (covers a paid-through recorded a few days
    // before that month's due date) and step one month if we're not past it.
    const sameMonth = dueDateInMonth(
      coherent.paidThrough.getUTCFullYear(),
      coherent.paidThrough.getUTCMonth(),
      coherent.dueDay,
    );
    next =
      sameMonth.getTime() > coherent.paidThrough.getTime()
        ? sameMonth
        : shiftMonths(sameMonth, 1, coherent.dueDay);
    // A paid-through that predates the anchor (bad import, or a payment
    // applied before the first scheduled period) must not manufacture a
    // period earlier than the note's first one.
    if (next.getTime() < anchor.getTime()) next = anchor;
  } else if (coherent.firstPayment) {
    // No payment history, but the paperwork states where the schedule starts.
    // The anchor is a fact off the instrument, so we'll stand behind it.
    basis = "first_payment";
    next = anchor;
  } else {
    // No payment history AND no stated first payment: the anchor is a pure
    // inference from origination. That is only safe for paper we have held
    // since it was written.
    if (historyPredatesAcquisition(coherent, anchor)) {
      return { date: null, reason: "history_predates_acquisition" };
    }
    // Nothing recorded as paid on a note we have held all along. The honest
    // answer is the first scheduled payment — even if it is in the past. It
    // means "no payment has ever been recorded against this note", which is
    // either true and alarming or a data-entry gap the operator needs to
    // see. Quietly rolling it to next month would erase both readings.
    basis = "origination";
    next = anchor;
  }

  if (next.getTime() > coherent.maturity.getTime()) {
    // Reached the end of the monthly schedule. (Also covers the degenerate
    // case of an anchor already past maturity — either way, no monthly
    // period remains and the payoff surface owns what happens next.)
    return { date: null, reason: "paid_through_maturity" };
  }
  return { date: toIsoDate(next), basis };
}

/**
 * THE ANTI-FABRICATION RULE.
 *
 * True when the schedule inferred from origination starts more than one
 * period before we bought the paper — i.e. the note was already being
 * serviced by somebody else, and AcreOS has no record of what happened.
 *
 * What breaks without it: import a decade-old note with no payment rows yet
 * and `deriveNextPaymentDate` confidently returns a 2019 date. Every surface
 * then badges that borrower `default_candidate` off ~2,500 days delinquent,
 * and the RESPA §1024.39 early-intervention caller fires on it — a FEDERAL
 * obligation triggered by a date nobody verified, against a borrower who may
 * have paid the prior servicer perfectly every month. That is a fabricated
 * delinquency, and it is worse than a blank: it is a confident lie about a
 * person's credit standing.
 *
 * We also refuse to substitute `acquisitionDate` as the anchor. Doing so
 * would assert the note was CURRENT at acquisition, which is equally
 * unknown — swapping one invented fact for another. The only honest output
 * is "no schedule on file", with a reason the operator can act on by
 * importing the paid-through date from the prior servicer.
 *
 * The one-period tolerance keeps the seller-financed-at-close case working:
 * paper originated and bought in the same month (or one period apart, which
 * is just settlement timing) has no hidden history to miss.
 */
function historyPredatesAcquisition(facts: CoherentFacts, anchor: Date): boolean {
  const onePeriodAfterAnchor = shiftMonths(anchor, 1, facts.dueDay);
  return onePeriodAfterAnchor.getTime() < facts.acquisition.getTime();
}

/**
 * The next date money is contractually due, or null when it cannot be
 * honestly determined.
 *
 * Thin wrapper over `nextPaymentVerdict` — use that directly when the screen
 * needs to explain WHY the date is blank rather than render a bare dash.
 */
export function deriveNextPaymentDate(
  facts: AcquiredNoteScheduleFacts,
  asOf: Date,
): string | null {
  return nextPaymentVerdict(facts, asOf).date;
}

/**
 * Advance paid-through by `periodsPaid` monthly periods, capped at maturity.
 *
 * Used by the payment-application path: when a payment satisfies a period in
 * full, paid-through moves forward by one. Returns the new paid-through date
 * as 'YYYY-MM-DD', or null when the facts are incoherent or nothing has been
 * paid yet.
 *
 * Capping at maturity keeps paid-through inside the note's life so that
 * `deriveNextPaymentDate` reads "paid through maturity → nothing more due"
 * rather than drifting into invented post-maturity periods.
 *
 * ─── THE SECOND DOOR (closed 2026-07-30) ──────────────────────────────────
 *
 * `nextPaymentVerdict` refuses to date a note whose servicing history
 * predates its acquisition. This function did NOT, and it starts from the
 * same origination anchor — so the guard had a second door standing open, on
 * the path every operator uses first.
 *
 * Measured, on the module's own documented fixture (originated 2019-03-10,
 * acquired 2026-07-01, no history imported — which is the shape of EVERY
 * tape-imported note, since the importer sets neither anchor):
 *
 *     nextPaymentVerdict → { date: null, reason: "history_predates_acquisition" }
 *     advancePaidThrough(facts, 1) → "2019-03-15"
 *     → next due 2019-04-15 → 2,653 days delinquent → default_candidate
 *
 * One ordinary payment, and the platform asserts seven years of arrears
 * against a real borrower, flips the note to `default`, and trips the RESPA
 * §1024.39 obligation — off a date nobody verified. That is precisely the
 * failure this module was written to prevent.
 *
 * So the same rule applies here. A payment is evidence that MONEY ARRIVED; it
 * is not evidence of WHICH PERIOD it satisfied, because on a note with unseen
 * history it could as easily be a catch-up on old arrears. With no
 * paid-through and no first-payment anchor to stand on, the honest answer
 * stays null, and the operator states the truth by setting `paidThroughDate`
 * or `firstPaymentDate` on the note (both are writable on create and PATCH).
 */
export function advancePaidThrough(
  facts: AcquiredNoteScheduleFacts,
  periodsPaid: number,
): string | null {
  const coherent = coerceFacts(facts);
  if (!coherent) return null;
  // Fractional or negative periods are a caller bug, not a schedule we can
  // express. Paid-through only ever moves forward, in whole periods.
  if (!Number.isInteger(periodsPaid) || periodsPaid < 0) return null;

  if (periodsPaid === 0) {
    // No period satisfied: paid-through is unchanged (and still null when it
    // started null — "nothing paid" is not a date).
    return coherent.paidThrough ? toIsoDate(coherent.paidThrough) : null;
  }

  const anchor = scheduleAnchor(coherent);

  // Only bites when there is nothing to advance FROM. Once paid-through is
  // established — by the operator, or by a payment on a note whose history we
  // did see — advancing it is ordinary arithmetic and this rule steps aside.
  if (!coherent.paidThrough && historyPredatesAcquisition(coherent, anchor)) {
    return null;
  }
  // With no prior paid-through, the first period satisfied is the anchor
  // period itself, so N periods lands on anchor + (N-1) months.
  const advanced = coherent.paidThrough
    ? shiftMonths(coherent.paidThrough, periodsPaid, coherent.dueDay)
    : shiftMonths(anchor, periodsPaid - 1, coherent.dueDay);

  if (advanced.getTime() > coherent.maturity.getTime()) {
    return toIsoDate(coherent.maturity);
  }
  return toIsoDate(advanced);
}

/**
 * Days past due and the matching delinquency band.
 *
 * ─── WHY GRACE DOES NOT MOVE THIS CLOCK (corrected 2026-07-30) ─────────────
 *
 * This function counts from the DUE DATE, not from the end of grace. The
 * first version counted from `due + gracePeriodDays`, which felt kind and was
 * wrong in the one direction that matters:
 *
 *   • RESPA §1024.39 attaches at 36 days DELINQUENT, and a loan is delinquent
 *     from the day the payment was due. Starting the count after a 10-day
 *     grace delays a federal early-intervention obligation by ten days.
 *   • §1026.41(d)(8)'s 45-day disclosure and its 90-day foreclosure-risk
 *     notice are measured the same way.
 *   • `financeAgent.calculateDaysDelinquent` (the originated book) counts from
 *     the due date with no grace. With the old arithmetic, one borrower 12
 *     days past due read `delinquent` (12 days) on one book and
 *     `early_delinquent` (2 days) on the other — exactly the two-spellings-of
 *     -"60 days down" split the schema comment says was avoided.
 *
 * Grace is a term of the NOTE about FEES, not a redefinition of delinquency.
 * It lives in `lateFeeAssessable` and nowhere else. Keeping it here also made
 * the §1026.41 statement self-contradictory: `delinquentSinceDate` is the due
 * date, so "delinquent since 2026-04-01 · 45 days delinquent" printed on a
 * date 55 days after 04-01.
 *
 * The arithmetic (`Math.floor` of the ms difference, floored at 0, `current`
 * at <= 0) now matches financeAgent's convention exactly, so the two books
 * agree on the day count and not merely on the band names.
 *
 * When `nextPaymentDate` is null we report `{0, "current"}` — but that is a
 * neutral default, NOT an assertion that the note is current. Null means the
 * caller could not derive a due date; the caller should render a blank rather
 * than the word "current". Callers that need the distinction must branch on
 * the null date before calling this — `notDeterminable()` below is the
 * explicit way to say so.
 */
export function computeNoteDelinquency(input: {
  nextPaymentDate: string | null;
  /**
   * Accepted for call-site symmetry with `lateFeeAssessable` and deliberately
   * IGNORED. See the block above: grace governs fees, not delinquency. The
   * parameter is kept rather than removed so a caller that passes it is not
   * silently changed in meaning by a future edit that re-adds the offset.
   */
  gracePeriodDays?: number;
  asOf: Date;
}): { daysDelinquent: number; delinquencyStatus: NoteDelinquencyStatus } {
  const due = parseIsoDate(input?.nextPaymentDate);
  const asOf = input?.asOf;
  if (!due || !(asOf instanceof Date) || Number.isNaN(asOf.getTime())) {
    return { daysDelinquent: 0, delinquencyStatus: "current" };
  }

  const daysDelinquent = Math.max(
    0,
    Math.floor((asOf.getTime() - due.getTime()) / DAY_MS),
  );

  return {
    daysDelinquent,
    delinquencyStatus: bandFor(daysDelinquent),
  };
}

/**
 * True when a note's delinquency CANNOT be determined, because there is no
 * due date to measure from.
 *
 * Exists because `computeNoteDelinquency` has to return something, and the
 * `NoteDelinquencyStatus` union has no "unknown" member — so its neutral
 * `{0, "current"}` is indistinguishable from a genuinely current note. Two
 * places were writing that neutral value to the database and to the screen as
 * though it were a finding: the payment path stamped `current` over a note it
 * could not read (permanently, since the nightly sweep then refuses to touch
 * an undeterminable note), and the list chip rendered the literal word
 * "Current" beside a due-date cell reading "no schedule on file".
 *
 * Callers branch on this BEFORE deciding to persist or display a band.
 */
export function delinquencyIsDeterminable(
  nextPaymentDate: string | null | undefined,
): boolean {
  return parseIsoDate(nextPaymentDate ?? null) !== null;
}

function bandFor(days: number): NoteDelinquencyStatus {
  const t = NOTE_DELINQUENCY_THRESHOLDS;
  if (days <= 0) return "current";
  if (days <= t.earlyDelinquent.max) return "early_delinquent";
  if (days <= t.delinquent.max) return "delinquent";
  if (days <= t.seriouslyDelinquent.max) return "seriously_delinquent";
  return "default_candidate";
}

/**
 * Whether a late fee WOULD be assessable right now. Advisory only.
 *
 * This function assesses nothing, writes nothing, and moves no money —
 * founder ruling: AcreOS is the rail, not the provider. The actual
 * non-pyramiding decision and the per-cycle write live in
 * `server/services/lateFees/index.ts`, which owns the §1026.36(c)(2) guard
 * and the one-fee-per-cycle unique index. This is the cheap read that lets a
 * screen say "a late fee is assessable" without pretending one was charged.
 *
 * `reason` is always populated — including on the true path — because these
 * strings end up in front of an operator who has to justify the fee to a
 * borrower, and "true" with no explanation is not justifiable.
 */
export function lateFeeAssessable(input: {
  nextPaymentDate: string | null;
  gracePeriodDays: number;
  lateFeeCents: number;
  asOf: Date;
}): { assessable: boolean; reason: string } {
  const due = parseIsoDate(input?.nextPaymentDate);
  if (!due) {
    return {
      assessable: false,
      reason:
        "No next payment date could be derived for this note, so there is nothing to assess a late fee against.",
    };
  }

  // Checked before delinquency so a note with no configured fee never shows
  // "assessable" language on a screen — an operator reading that would go
  // looking for an amount that does not exist.
  const feeCents = input.lateFeeCents;
  if (!Number.isFinite(feeCents) || feeCents <= 0) {
    return {
      assessable: false,
      reason:
        "No late fee is configured on this note (late fee amount is 0), so no late fee is assessable.",
    };
  }

  // GRACE LIVES HERE, AND ONLY HERE.
  //
  // This used to delegate the whole calculation to `computeNoteDelinquency`,
  // which applied the grace offset itself. When that function was corrected to
  // count delinquency from the due date (RESPA's clock, not the note's fee
  // terms), this call site silently lost its grace protection and would have
  // reported a fee assessable on day 1 of a 10-day grace — charging a borrower
  // who is inside the terms they signed. Its own test caught it.
  //
  // The arithmetic is deliberately local rather than a shared helper: grace is
  // a fee concept, and re-entangling it with the delinquency clock is exactly
  // the mistake that was just undone.
  const grace =
    Number.isFinite(input.gracePeriodDays) && input.gracePeriodDays > 0
      ? Math.floor(input.gracePeriodDays)
      : 0;
  const daysPastGrace = Math.floor(
    (input.asOf.getTime() - (due.getTime() + grace * DAY_MS)) / DAY_MS,
  );

  if (!Number.isFinite(daysPastGrace) || daysPastGrace <= 0) {
    return {
      assessable: false,
      reason: `Payment due ${toIsoDate(due)} is still within the ${grace}-day grace period, so no late fee is assessable.`,
    };
  }

  return {
    assessable: true,
    reason: `Payment due ${toIsoDate(due)} is ${daysPastGrace} day(s) past the grace period. A late fee of ${feeCents} cents would be assessable; nothing has been assessed by this check.`,
  };
}
