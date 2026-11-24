import { parseCalendarDate } from "../dates/calendar";

/**
 * The deposit-deadline MATH — everything in the security-deposit clock that
 * is not the per-state registry itself.
 *
 * Split out of `depositReturnRules.ts` (bundle diet, N7 fix round D4): the
 * registry table is served to the customer client as a data asset
 * (`/deposit-return-rules.json`, pinned deep-equal to the registry by
 * tests/unit/depositRulesServedAsData.test.ts) because the rent-roll page
 * is the registry's only client consumer and the table alone was ~5 KB of
 * the customer bundle. The client loads the table through
 * client/src/lib/static-data.ts and calls `computeDepositDeadlineFromRule`
 * with the looked-up rule; the server keeps importing
 * `computeDepositDeadline` from `depositReturnRules.ts`, which is this
 * function composed with the registry lookup — one implementation, two
 * data sources, pinned equal by the same suite.
 */

export interface DepositReturnRule {
  /** 2-letter state / jurisdiction code. */
  state: string;
  /**
   * Days the landlord has to deliver the itemized statement + any refund when
   * amounts ARE withheld. This is the deadline the clock counts to.
   */
  deadlineDays: number;
  /**
   * Days allowed when NOTHING is withheld, where the statute is shorter or
   * longer than `deadlineDays`. Undefined ⇒ same window either way.
   */
  deadlineDaysNoDeductions?: number;
  /** true ⇒ `deadlineDays` is counted in business days, not calendar days. */
  businessDays?: boolean;
  /** Whether an itemized written statement of deductions is required. */
  itemizedStatementRequired: boolean;
  citation: string;
  /** Conditions/caveats the operator must read before relying on the date. */
  note?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Parse a YYYY-MM-DD date column into a UTC-midnight Date. Null if unusable. */
/*
 * `parseIsoDate` lived here and did `String(iso).slice(0, 10)` and then trusted
 * `new Date()`, so it ACCEPTED "2026-02-30" and returned March 2nd — making a
 * 21-day statutory return deadline land two days late, on an obligation that
 * carries penalties for being late. Replaced by `parseCalendarDate`, which
 * round-trips the parse and refuses a date that is not a day.
 */

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Add calendar days in UTC. */
function addCalendarDays(from: Date, days: number): Date {
  return new Date(from.getTime() + days * DAY_MS);
}

/**
 * Add business days (Mon-Fri) in UTC. State holidays are NOT encoded — the
 * caller is told so via the rule's `note`, and the returned date is therefore
 * the outer edge rather than a guarantee.
 */
function addBusinessDays(from: Date, days: number): Date {
  let cursor = from;
  let remaining = days;
  while (remaining > 0) {
    cursor = addCalendarDays(cursor, 1);
    const dow = cursor.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining -= 1;
  }
  return cursor;
}

export interface DepositDeadlineResult {
  /** false ⇒ we have no encoded rule; every other field is null. */
  known: boolean;
  /** YYYY-MM-DD the itemized statement + refund must be delivered by. */
  deadlineDate: string | null;
  deadlineDays: number | null;
  businessDays: boolean;
  itemizedStatementRequired: boolean | null;
  citation: string | null;
  note: string | null;
  /** Populated ONLY when known=false. Render this verbatim; never a date. */
  unknownReason: string | null;
}

/**
 * The deposit clock, against a rule the caller looked up (null ⇒ the
 * jurisdiction is not in the registry). `moveOutDate` is the trigger — the
 * day the tenancy actually ended (move-out inspection date, or the lease's
 * end date when the lease is marked ended/terminated without an inspection).
 *
 * When the jurisdiction is not in the registry we return
 * `{ known: false, deadlineDate: null, unknownReason: "…" }`. Callers MUST
 * surface `unknownReason` instead of substituting a default — the whole point
 * of this function is to refuse to invent the one date that creates liability.
 */
export function computeDepositDeadlineFromRule(
  rule: DepositReturnRule | null,
  args: {
    moveOutDate: string | null | undefined;
    state: string | null | undefined;
    hasDeductions: boolean;
  },
): DepositDeadlineResult {
  const unknown = (reason: string): DepositDeadlineResult => ({
    known: false,
    deadlineDate: null,
    deadlineDays: null,
    businessDays: false,
    itemizedStatementRequired: null,
    citation: null,
    note: null,
    unknownReason: reason,
  });

  if (!rule) {
    const label = args.state ? args.state.toUpperCase().trim() : "(no state on the lease)";
    return unknown(
      `No security-deposit return deadline is encoded for ${label}. AcreOS will not guess a statutory date — ` +
        "confirm the deadline with counsel for this jurisdiction and calendar it manually.",
    );
  }

  const moveOut = parseCalendarDate(args.moveOutDate);
  if (!moveOut) {
    return unknown(
      `A move-out date is required before the ${rule.state} deposit clock can start (${rule.citation}). ` +
        "Record the move-out inspection date or the lease end date first.",
    );
  }

  const days =
    !args.hasDeductions && rule.deadlineDaysNoDeductions !== undefined
      ? rule.deadlineDaysNoDeductions
      : rule.deadlineDays;

  const deadline = rule.businessDays ? addBusinessDays(moveOut, days) : addCalendarDays(moveOut, days);

  return {
    known: true,
    deadlineDate: toIso(deadline),
    deadlineDays: days,
    businessDays: rule.businessDays === true,
    itemizedStatementRequired: rule.itemizedStatementRequired,
    citation: rule.citation,
    note: rule.note ?? null,
    unknownReason: null,
  };
}

export interface DepositCountdown {
  deadlineDate: string | null;
  /** Negative once the deadline has passed. Null when there is no deadline. */
  daysRemaining: number | null;
  overdue: boolean;
  /** true when ≤ 7 days remain (or it is already overdue). */
  urgent: boolean;
}

/** Countdown for the UI. No deadline ⇒ every field null/false, never a zero. */
export function depositDeadlineCountdown(
  deadlineDate: string | null | undefined,
  today: Date = new Date(),
): DepositCountdown {
  const deadline = parseCalendarDate(deadlineDate);
  if (!deadline) {
    return { deadlineDate: null, daysRemaining: null, overdue: false, urgent: false };
  }
  const todayUtc = parseCalendarDate(toIso(today)) ?? today;
  const daysRemaining = Math.round((deadline.getTime() - todayUtc.getTime()) / DAY_MS);
  return {
    deadlineDate: toIso(deadline),
    daysRemaining,
    overdue: daysRemaining < 0,
    urgent: daysRemaining <= 7,
  };
}
