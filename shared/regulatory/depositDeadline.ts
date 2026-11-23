import { parseCalendarDate } from "../dates/calendar";

/**
 * The deposit-clock computation core: the rule/record shapes and the
 * pure functions that turn a registry + a move-out date into a statutory
 * deadline. This module carries NO registry data, so the customer client
 * can bundle it and supply the registry at runtime from the served
 * asset (client/public/deposit-return-rules.json); the registry itself
 * lives in ./depositReturnRules.ts, which stays the source of truth and
 * re-exports everything here for its existing server/test importers.
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

/**
 * Returns the rule for a jurisdiction (2-letter, any case) from an
 * explicit registry — the shape the client uses with the served asset.
 * Null if absent.
 */
export function getDepositReturnRuleFrom(
  rules: Record<string, DepositReturnRule>,
  state: string | null | undefined,
): DepositReturnRule | null {
  if (!state) return null;
  const key = state.toUpperCase().trim();
  return rules[key] ?? null;
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
 * The deposit clock. `moveOutDate` is the trigger — the day the tenancy
 * actually ended (move-out inspection date, or the lease's end date when the
 * lease is marked ended/terminated without an inspection).
 *
 * When the jurisdiction is not in the registry we return
 * `{ known: false, deadlineDate: null, unknownReason: "…" }`. Callers MUST
 * surface `unknownReason` instead of substituting a default — the whole point
 * of this function is to refuse to invent the one date that creates liability.
 */
export function computeDepositDeadlineFrom(
  rules: Record<string, DepositReturnRule>,
  args: {
    moveOutDate: string | null | undefined;
    state: string | null | undefined;
    hasDeductions: boolean;
  },
): DepositDeadlineResult {
  return computeDepositDeadlineForRule(getDepositReturnRuleFrom(rules, args.state), args);
}

/**
 * The deposit clock for an already-resolved rule (null ⇒ the jurisdiction
 * is not in the registry). Split from computeDepositDeadlineFrom so the
 * registry module's own computeDepositDeadline can compose its public
 * accessor (getDepositReturnRule) with the same arithmetic.
 */
export function computeDepositDeadlineForRule(
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
