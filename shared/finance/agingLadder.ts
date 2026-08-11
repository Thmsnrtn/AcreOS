/**
 * THE AGING LADDER — one engine, both books.
 *
 * An aging ladder is the same idea in the rent ledger and in the notes book:
 * take every open obligation, measure it against an AS-OF DATE, and drop it
 * into current / 1-30 / 31-60 / 61-90 / 90+. Building that twice is how two
 * books come to disagree about what "60 days late" means — which is exactly
 * the split `acquiredNoteSchedule.ts` documents at length for delinquency
 * bands. This module exists so there is one place the boundaries live.
 *
 * ── WHAT THIS IS NOT ───────────────────────────────────────────────────────
 * This is NOT the note DELINQUENCY BAND (`NoteDelinquencyStatus`:
 * current / early_delinquent / delinquent / seriously_delinquent /
 * default_candidate, boundaries 5/15/30). That band is a REGULATORY
 * classification of a borrower's standing and it drives RESPA §1024.39 /
 * Reg-Z §1026.41 obligations. The ladder here is an ACCOUNTS-RECEIVABLE
 * view of DOLLARS by age. Same day-count, different question, different
 * boundaries — deliberately. Any surface showing both must say which is
 * which; collapsing them would be the "two spellings of 60 days down"
 * failure in the opposite direction.
 *
 * ── THE FOUR RULES ─────────────────────────────────────────────────────────
 *
 * 1. NO CLOCK OF ITS OWN. `asOf` is an argument. Nothing here calls
 *    `new Date()`, reads `CURRENT_DATE`, or consults a timezone. The rent
 *    endpoint previously mixed two clocks — Postgres `CURRENT_DATE` for the
 *    day count and Node's `new Date()` for the `asOf` it reported — so the
 *    board could be labelled with one day and bucketed by another.
 *
 * 2. REFUSE, DO NOT INVENT. A row with no due date is NOT AGED. It never
 *    lands in `current`, because "current" is a finding ("this is not past
 *    due") and we have not made that finding. `not_aged` is a visible holding
 *    pen with a reason attached, not a silent drop.
 *
 * 3. A BUCKET TOTAL IS THE SUM OF ROWS YOU CAN OPEN. Every row handed to this
 *    engine comes back out — in a bucket, in `notAged`, or in `excluded` with
 *    the caller's reason. Nothing is dropped. `assertConserved` (and the test
 *    suite) checks the arithmetic identity that makes this true.
 *
 * 4. AN INCOMPLETE TOTAL SAYS SO. A row can be genuinely aged (we know when
 *    it came due) while its AMOUNT is unknown — the notes book has exactly
 *    this shape when a tape-imported note carries no paid-through anchor. Such
 *    a row still counts in its bucket, but the bucket's `totalIsComplete`
 *    goes false and `unknownAmountCount` says how many. A total that silently
 *    omits rows is a lie with a dollar sign on it.
 *
 * ── EXIT TEST (agingLadder.test.ts) ────────────────────────────────────────
 *   • a fixture ledger at known ages produces exact bucket MEMBERSHIP and
 *     exact totals;
 *   • conservation: buckets + notAged + excluded === the input, over the
 *     fixture AND over a swept range of ages;
 *   • a row with no due date lands in `not_aged` and is absent from `current`;
 *   • the boundaries are read back OUT of `AGING_LADDER_BUCKETS` and every
 *     edge day is pinned on both sides, so mutating a boundary reddens the
 *     suite rather than quietly re-shaping the board.
 *
 * MONEY POSTURE: record-only. This module describes balances that are already
 * recorded. It collects nothing, charges nothing and moves nothing
 * (founder ruling #15 — be the rail, not the provider).
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

// ---------------------------------------------------------------------------
// The ladder itself — THE single source of the boundaries
// ---------------------------------------------------------------------------

/**
 * The rungs, in order, oldest-last.
 *
 * `minDaysPastDue` / `maxDaysPastDue` are INCLUSIVE day counts measured from
 * the due date (day 0 = due today = current). `maxDaysPastDue: null` means the
 * rung is open-ended. Nothing else in the codebase may restate these numbers:
 * every consumer reads them from here, and `agingLadder.test.ts` pins each
 * edge on both sides so an edit to a boundary is a red suite.
 */
export const AGING_LADDER_BUCKETS = [
  { id: "current", label: "Current", shortLabel: "Current", minDaysPastDue: null, maxDaysPastDue: 0 },
  { id: "d1_30", label: "1-30 days past due", shortLabel: "1-30 days", minDaysPastDue: 1, maxDaysPastDue: 30 },
  { id: "d31_60", label: "31-60 days past due", shortLabel: "31-60 days", minDaysPastDue: 31, maxDaysPastDue: 60 },
  { id: "d61_90", label: "61-90 days past due", shortLabel: "61-90 days", minDaysPastDue: 61, maxDaysPastDue: 90 },
  { id: "d90_plus", label: "Over 90 days past due", shortLabel: "90+ days", minDaysPastDue: 91, maxDaysPastDue: null },
] as const;

export type AgingBucketId = (typeof AGING_LADDER_BUCKETS)[number]["id"];

/** The holding pen for rows we cannot age. Deliberately NOT a ladder rung. */
export const NOT_AGED_ID = "not_aged" as const;

/**
 * What a surface can have SELECTED — a rung, the not-aged pen, or nothing.
 *
 * Exported so the two books do not each spell `"not_aged"` in their own state
 * type; a typo there would silently make one book's filter unselectable.
 */
export type AgingSelection = AgingBucketId | typeof NOT_AGED_ID | null;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

/** Why a row's amount could not be used in a total. */
export type UnknownAmountCode =
  | "not_recorded"
  | "not_a_number"
  | "not_integer_cents";

/** Why a row could not be aged at all. */
export type NotAgedCode = "no_due_date" | "unparseable_due_date";

/**
 * One obligation to age.
 *
 * `outstandingCents` is deliberately `number | null`: null means "this row is
 * real, and we do not know what it is worth". That is a legitimate state on a
 * book that records a SCHEDULE rather than a CHARGE LEDGER, and it must not be
 * coerced to 0 — a zero would silently shrink a bucket total.
 */
export interface AgeableRow {
  /** Stable identifier the surface can use to open the underlying record. */
  id: string;
  /** 'YYYY-MM-DD'. Null ⇒ this row is NOT AGED (never `current`). */
  dueDate: string | null;
  /** Integer cents. Null ⇒ amount not known; the bucket total says so. */
  outstandingCents: number | null;
  /**
   * A human sentence explaining a null `dueDate` or a null `outstandingCents`,
   * supplied by the book (the notes book already computes one). Rendered
   * verbatim; never invented here.
   */
  reason?: string | null;
  /**
   * Set to hold this row OUT of the ladder while still reporting it — voided,
   * disputed, outside the requested window. The row appears in `excluded`
   * with this code and never in a bucket. Silence is not an option.
   */
  excludedCode?: string | null;
  /** Human sentence for `excludedCode`. */
  excludedReason?: string | null;
  /** Opaque passthrough the surface renders (lease label, note number, ...). */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

export interface AgedRow {
  id: string;
  dueDate: string;
  daysPastDue: number;
  bucket: AgingBucketId;
  outstandingCents: number | null;
  unknownAmountCode: UnknownAmountCode | null;
  reason: string | null;
  meta: Record<string, unknown> | null;
}

export interface NotAgedRow {
  id: string;
  code: NotAgedCode;
  reason: string | null;
  outstandingCents: number | null;
  unknownAmountCode: UnknownAmountCode | null;
  meta: Record<string, unknown> | null;
}

export interface ExcludedRow {
  id: string;
  code: string;
  reason: string | null;
  daysPastDue: number | null;
  outstandingCents: number | null;
  unknownAmountCode: UnknownAmountCode | null;
  meta: Record<string, unknown> | null;
}

export interface AgingBucket {
  id: AgingBucketId;
  label: string;
  shortLabel: string;
  minDaysPastDue: number | null;
  maxDaysPastDue: number | null;
  rows: AgedRow[];
  count: number;
  /** Sum of the rows in this bucket whose amount is KNOWN. */
  totalCents: number;
  /** How many rows in this bucket have no usable amount. */
  unknownAmountCount: number;
  /**
   * False when `unknownAmountCount > 0` — `totalCents` is then a FLOOR, not
   * the answer, and the surface must say so rather than print it plain.
   */
  totalIsComplete: boolean;
}

export interface AgingLadder {
  asOf: string;
  buckets: AgingBucket[];
  notAged: {
    rows: NotAgedRow[];
    count: number;
    totalCents: number;
    unknownAmountCount: number;
    totalIsComplete: boolean;
  };
  excluded: {
    rows: ExcludedRow[];
    count: number;
    totalCents: number;
    unknownAmountCount: number;
    totalIsComplete: boolean;
    /** One entry per distinct exclusion code, so the surface can name them. */
    byCode: Array<{ code: string; reason: string | null; count: number; totalCents: number }>;
  };
  /** Rows handed in, of every kind. */
  rowCount: number;
  /**
   * True when NOTHING was handed in. A surface MUST render an EmptyState on
   * this rather than a board of zeros — a zeroed ladder reads as the finding
   * "you are owed nothing", which is a different claim from "no ledger yet".
   */
  isEmpty: boolean;
  /** Sum of every KNOWN amount, ladder + notAged + excluded. */
  grandTotalCents: number;
  /** Sum of every KNOWN amount that landed on a ladder rung. */
  agedTotalCents: number;
  /** Unknown-amount rows anywhere in the result. */
  unknownAmountCount: number;
  /** False when any amount anywhere is unknown. */
  totalIsComplete: boolean;
}

// ---------------------------------------------------------------------------
// Date helpers (UTC-midnight, date-only — no timezone can move a bucket)
// ---------------------------------------------------------------------------

function parseIsoDate(value: string | null | undefined): Date | null {
  if (typeof value !== "string") return null;
  const match = ISO_DATE.exec(value);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  // Round-trip catches the rollovers (Feb 30, Apr 31, ...).
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

/**
 * True when `value` is a real calendar day in 'YYYY-MM-DD' form.
 *
 * Exported so a route can 400 an unusable `asOf` BEFORE calling `bucketAging`
 * (which throws) — and so it validates by the engine's OWN parser rather than a
 * regex that would wave through "2026-13-45" and "2026-02-30".
 */
export function isCalendarDate(value: string | null | undefined): boolean {
  return parseIsoDate(value) !== null;
}

function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

// ---------------------------------------------------------------------------
// Bucketing
// ---------------------------------------------------------------------------

/**
 * Which rung a day-count belongs on. Reads the boundaries out of
 * `AGING_LADDER_BUCKETS` — there is no second copy of 30/60/90 anywhere.
 *
 * Days <= 0 (due today, or due in the future) are `current`: not past due.
 *
 * Exported for the BOUNDARY RATCHET in `agingLadder.test.ts`, which sweeps the
 * day-count line through it to prove the rungs abut with no gap and no overlap.
 * Production code reaches it through `bucketAging`.
 */
export function bucketForDaysPastDue(daysPastDue: number): AgingBucketId {
  for (const bucket of AGING_LADDER_BUCKETS) {
    const aboveMin = bucket.minDaysPastDue === null || daysPastDue >= bucket.minDaysPastDue;
    const belowMax = bucket.maxDaysPastDue === null || daysPastDue <= bucket.maxDaysPastDue;
    if (aboveMin && belowMax) return bucket.id;
  }
  // Unreachable while the table covers (-inf, +inf); kept so a future edit that
  // opens a gap fails loudly at the call site instead of mis-filing a row.
  throw new RangeError(
    `AGING_LADDER_BUCKETS does not cover daysPastDue=${daysPastDue} — the ladder has a gap.`,
  );
}

function normalizeAmount(
  value: number | null | undefined,
): { cents: number | null; code: UnknownAmountCode | null } {
  if (value === null || value === undefined) return { cents: null, code: "not_recorded" };
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return { cents: null, code: "not_a_number" };
  }
  if (!Number.isInteger(value)) return { cents: null, code: "not_integer_cents" };
  return { cents: value, code: null };
}

/**
 * Build the ladder.
 *
 * `asOf` must be a real 'YYYY-MM-DD'. An unusable as-of throws rather than
 * returning a board: every row would fall to `not_aged` and the operator would
 * read "nothing is measurable" when the truth is "the caller passed a bad
 * date". A caller bug must not be laundered into a finding about the book.
 */
export function bucketAging(input: { asOf: string; rows: readonly AgeableRow[] }): AgingLadder {
  const asOfDate = parseIsoDate(input?.asOf);
  if (!asOfDate) {
    throw new TypeError(
      `bucketAging: asOf must be a valid 'YYYY-MM-DD' date, received ${JSON.stringify(input?.asOf)}`,
    );
  }
  const asOf = toIsoDate(asOfDate);
  const rows = input?.rows ?? [];

  const buckets: AgingBucket[] = AGING_LADDER_BUCKETS.map((b) => ({
    id: b.id,
    label: b.label,
    shortLabel: b.shortLabel,
    minDaysPastDue: b.minDaysPastDue,
    maxDaysPastDue: b.maxDaysPastDue,
    rows: [],
    count: 0,
    totalCents: 0,
    unknownAmountCount: 0,
    totalIsComplete: true,
  }));
  const byId = new Map(buckets.map((b) => [b.id, b]));

  const notAgedRows: NotAgedRow[] = [];
  const excludedRows: ExcludedRow[] = [];

  for (const row of rows) {
    const amount = normalizeAmount(row?.outstandingCents);
    const meta = row?.meta ?? null;
    const due = parseIsoDate(row?.dueDate ?? null);
    const days = due ? Math.round((asOfDate.getTime() - due.getTime()) / DAY_MS) : null;

    // 1. Caller-declared exclusion wins over everything. The row is REPORTED,
    //    not dropped — that is the whole point of this branch existing.
    if (row?.excludedCode) {
      excludedRows.push({
        id: row.id,
        code: row.excludedCode,
        reason: row.excludedReason ?? null,
        daysPastDue: days,
        outstandingCents: amount.cents,
        unknownAmountCode: amount.code,
        meta,
      });
      continue;
    }

    // 2. No usable due date ⇒ NOT AGED. Never `current`.
    if (!due) {
      notAgedRows.push({
        id: row.id,
        code: row?.dueDate == null ? "no_due_date" : "unparseable_due_date",
        reason: row?.reason ?? null,
        outstandingCents: amount.cents,
        unknownAmountCode: amount.code,
        meta,
      });
      continue;
    }

    const bucketId = bucketForDaysPastDue(days as number);
    const bucket = byId.get(bucketId)!;
    bucket.rows.push({
      id: row.id,
      dueDate: toIsoDate(due),
      daysPastDue: days as number,
      bucket: bucketId,
      outstandingCents: amount.cents,
      unknownAmountCode: amount.code,
      reason: row?.reason ?? null,
      meta,
    });
  }

  for (const bucket of buckets) {
    // Oldest first within a rung; input order breaks ties so the result is
    // deterministic for identical due dates.
    bucket.rows.sort((a, b) => b.daysPastDue - a.daysPastDue);
    bucket.count = bucket.rows.length;
    bucket.totalCents = bucket.rows.reduce((s, r) => s + (r.outstandingCents ?? 0), 0);
    bucket.unknownAmountCount = bucket.rows.filter((r) => r.outstandingCents === null).length;
    bucket.totalIsComplete = bucket.unknownAmountCount === 0;
  }

  const notAgedUnknown = notAgedRows.filter((r) => r.outstandingCents === null).length;
  const excludedUnknown = excludedRows.filter((r) => r.outstandingCents === null).length;

  const byCodeMap = new Map<string, { code: string; reason: string | null; count: number; totalCents: number }>();
  for (const r of excludedRows) {
    const entry = byCodeMap.get(r.code) ?? { code: r.code, reason: r.reason, count: 0, totalCents: 0 };
    entry.count += 1;
    entry.totalCents += r.outstandingCents ?? 0;
    if (entry.reason === null) entry.reason = r.reason;
    byCodeMap.set(r.code, entry);
  }

  const agedTotalCents = buckets.reduce((s, b) => s + b.totalCents, 0);
  const notAgedTotal = notAgedRows.reduce((s, r) => s + (r.outstandingCents ?? 0), 0);
  const excludedTotal = excludedRows.reduce((s, r) => s + (r.outstandingCents ?? 0), 0);
  const unknownAmountCount =
    buckets.reduce((s, b) => s + b.unknownAmountCount, 0) + notAgedUnknown + excludedUnknown;

  return {
    asOf,
    buckets,
    notAged: {
      rows: notAgedRows,
      count: notAgedRows.length,
      totalCents: notAgedTotal,
      unknownAmountCount: notAgedUnknown,
      totalIsComplete: notAgedUnknown === 0,
    },
    excluded: {
      rows: excludedRows,
      count: excludedRows.length,
      totalCents: excludedTotal,
      unknownAmountCount: excludedUnknown,
      totalIsComplete: excludedUnknown === 0,
      byCode: Array.from(byCodeMap.values()).sort((a, b) => a.code.localeCompare(b.code)),
    },
    rowCount: rows.length,
    isEmpty: rows.length === 0,
    grandTotalCents: agedTotalCents + notAgedTotal + excludedTotal,
    agedTotalCents,
    unknownAmountCount,
    totalIsComplete: unknownAmountCount === 0,
  };
}

/**
 * The conservation identity, as an executable check.
 *
 * Every row in, every row out. Both aging routes call this on every response
 * and log an error if it ever comes back false — the promise "a bucket total is
 * the sum of rows you can open" is worth exactly as much as its enforcement, so
 * it is checked in production and not only in the test.
 */
export function conservationHolds(
  ladder: AgingLadder,
  rows: readonly AgeableRow[],
): boolean {
  const placed =
    ladder.buckets.reduce((s, b) => s + b.count, 0) + ladder.notAged.count + ladder.excluded.count;
  if (placed !== rows.length) return false;

  const inputKnownTotal = rows.reduce((s, r) => {
    const { cents } = normalizeAmount(r?.outstandingCents);
    return s + (cents ?? 0);
  }, 0);
  return inputKnownTotal === ladder.grandTotalCents;
}

// ---------------------------------------------------------------------------
// Books that record a SCHEDULE rather than a CHARGE LEDGER
// ---------------------------------------------------------------------------

/**
 * Why a scheduled book could not be given a past-due window.
 *
 * `no_first_unsatisfied_due_date` is the important one: the notes book stores
 * `nextPaymentDate` (the oldest unsatisfied due date) and it is legitimately
 * null for tape-imported paper whose servicing history AcreOS never saw. That
 * is the case `nextPaymentVerdict` refuses to date, and refusing here too is
 * what keeps a 2019 due date from manufacturing seven years of arrears.
 */
export type ScheduleWindowRefusal =
  | "no_first_unsatisfied_due_date"
  | "unparseable_due_date"
  | "unparseable_as_of"
  | "invalid_due_day"
  | "unparseable_maturity"
  /**
   * The stored first-unsatisfied due date's day-of-month disagrees with the
   * note's `paymentDueDay`, so we cannot say what the schedule IS.
   *
   * This is not a hypothetical. `acquiredNoteSchedule.scheduleAnchor` returns
   * `firstPaymentDate` verbatim and un-snapped, while `importExport` DEFAULTS
   * `paymentDueDay` to 1 for any tape with no day-of-month column — so the two
   * routinely disagree on real rows. The walk used to take the stored date for
   * period 0 and then snap every later period to `paymentDueDay`, which
   * silently produced a hybrid schedule: an anchor of the 20th with a due day
   * of 1 emitted a twelve-day "month" and counted a fourth period that a
   * monthly schedule on the 20th has not reached, overstating arrears by a
   * full payment. The mirror case understates by one.
   *
   * Guessing which field is authoritative would be fabrication in the
   * direction of whichever we picked, so the ladder refuses and the amount
   * reports UNKNOWN. Fixing the underlying row (or the importer's default) is
   * what makes the note ageable.
   */
  | "anchor_does_not_match_due_day";

export interface ScheduleWindow {
  /** Due dates in [firstUnsatisfiedDueDate, asOf], oldest first. */
  dueDates: string[];
  /** `dueDates.length` — periods that have come due and are not satisfied. */
  periodsDue: number;
  /** The oldest unsatisfied due date, i.e. the date the ladder ages from. */
  oldestDueDate: string | null;
  /** True when the walk stopped because it reached maturity, not `asOf`. */
  cappedAtMaturity: boolean;
  refusal: ScheduleWindowRefusal | null;
}

/**
 * Which monthly periods have come due and remain unsatisfied.
 *
 * The rent ledger has a row per charge, so it needs none of this. The notes
 * book has a SCHEDULE — `paymentDueDay`, `maturityDate`, and a server-derived
 * `nextPaymentDate` — and no per-period charge rows. The honest past-due
 * figure there is (periods that came due since the last satisfied one) x
 * (the scheduled payment), and this function is the "how many periods" half.
 *
 * It starts from `firstUnsatisfiedDueDate` — a date the notes book has ALREADY
 * derived and stored through `nextPaymentVerdict`, including that function's
 * anti-fabrication refusals — and walks forward one calendar month at a time
 * with the same month-end clamp (a 31st note is due Feb 28/29). It never
 * invents an anchor of its own, so a note the book refused to date stays
 * refused here.
 *
 * Walking past `maturityDate` is not allowed: after maturity what is owed is a
 * balloon/payoff figure, a different surface with different math (see rule 3
 * in acquiredNoteSchedule.nextPaymentVerdict).
 */
export function scheduleWindowDue(input: {
  firstUnsatisfiedDueDate: string | null;
  /** 1-31, clamped per month. */
  paymentDueDay: number;
  /** 'YYYY-MM-DD' — the monthly schedule stops here. */
  maturityDate: string | null;
  asOf: string;
}): ScheduleWindow {
  const empty = (refusal: ScheduleWindowRefusal): ScheduleWindow => ({
    dueDates: [],
    periodsDue: 0,
    oldestDueDate: null,
    cappedAtMaturity: false,
    refusal,
  });

  const asOf = parseIsoDate(input?.asOf);
  if (!asOf) return empty("unparseable_as_of");
  if (input?.firstUnsatisfiedDueDate == null) return empty("no_first_unsatisfied_due_date");
  const first = parseIsoDate(input.firstUnsatisfiedDueDate);
  if (!first) return empty("unparseable_due_date");

  const dueDay = Number(input?.paymentDueDay);
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) return empty("invalid_due_day");

  // Maturity is required: without it the walk has no contractual stop and
  // could emit periods past the end of the note's life.
  const maturity = parseIsoDate(input?.maturityDate ?? null);
  if (!maturity) return empty("unparseable_maturity");

  // The anchor and the due day must describe the SAME schedule before we walk
  // it. `Math.min(dueDay, daysInMonth(...))` is how the walk itself resolves a
  // due day past the end of a short month, so the anchor is judged by exactly
  // the rule the later periods obey — a 31st due day anchored on Feb 28 is
  // consistent, not a mismatch.
  const anchorDay = first.getUTCDate();
  const expectedAnchorDay = Math.min(
    dueDay,
    daysInMonth(first.getUTCFullYear(), first.getUTCMonth()),
  );
  if (anchorDay !== expectedAnchorDay) return empty("anchor_does_not_match_due_day");

  const dueDates: string[] = [];
  let cappedAtMaturity = false;
  let cursor = first;
  // A monthly schedule cannot produce more than ~1200 periods inside any
  // realistic note life; the bound makes the loop provably terminating.
  for (let step = 0; step < 1200; step += 1) {
    if (cursor.getTime() > maturity.getTime()) {
      cappedAtMaturity = true;
      break;
    }
    if (cursor.getTime() > asOf.getTime()) break;
    dueDates.push(toIsoDate(cursor));
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const nextMonth = m === 11 ? 0 : m + 1;
    const nextYear = m === 11 ? y + 1 : y;
    cursor = new Date(
      Date.UTC(nextYear, nextMonth, Math.min(dueDay, daysInMonth(nextYear, nextMonth))),
    );
  }

  return {
    dueDates,
    periodsDue: dueDates.length,
    oldestDueDate: dueDates[0] ?? null,
    cappedAtMaturity,
    refusal: null,
  };
}
