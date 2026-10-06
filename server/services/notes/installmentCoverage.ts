/**
 * The serviced note's installment schedule, and the ONE installment-coverage
 * rule every posting writer applies (DEFECT-0185, W10.5).
 *
 * ── The schedule ─────────────────────────────────────────────────────────
 * A serviced note (`notes`) is monthly: installment i (0-based) is due on
 * `firstPaymentDate` plus i calendar months, the same day of the month,
 * clamped to the month's end (a note first due on the 31st is due Feb 28,
 * Mar 31, Apr 30 …), for `termMonths` installments. The months are always
 * counted from the anchor, never stepped from the previous due date — a step
 * from a clamped Feb 28 lands on Mar 28, a different day than the note says.
 *
 * `next_payment_date` is the first installment not yet fully covered. When it
 * sits ON that schedule we know which installment it is, and therefore the due
 * dates of every installment after it. When it does not (a writer stepped it
 * off the 31st, a lender edited it, the note has no first date or term), the
 * later due dates are NOT known, and nothing here invents them: callers fall
 * back to the one installment the note does state (refuse-not-fabricate).
 *
 * ── The coverage rule ────────────────────────────────────────────────────
 * A payment covers installments oldest-first. It funds every installment
 * that is DUE by the time it posts (at least the current one, so an early
 * payment still pays the upcoming installment) before a cent goes to late
 * fees; only money beyond those installments pays fees owed, up to what is
 * owed (§1026.36(c)(2): a fee never makes an installment short — the
 * founder's ruling 2026-09-29 #6, generalized from one installment to the
 * installments due); anything after that reduces principal. Money already
 * credited toward the current installment (an earlier partial) counts. The
 * due date then advances by the installments FULLY covered: a partial
 * advances nothing, a lump that funds three advances three.
 *
 * AcreOS never moves customer money; this is bookkeeping over money the
 * lender's own processor (or the lender, by hand) already received.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** The most new late-fee assessments one evaluation records for one note. */
export const MAX_ASSESSMENTS_PER_RUN = 24;

const daysInUtcMonth = (year: number, month: number) => new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * `d` plus `months` calendar months in UTC, the day clamped to the target
 * month's end, the time of day kept. The same answer `dateUtils.addMonths`
 * gives in a UTC process, independent of the process time zone.
 */
export function addMonthsUtc(d: Date, months: number): Date {
  const total = d.getUTCMonth() + months;
  const year = d.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const day = Math.min(d.getUTCDate(), daysInUtcMonth(year, month));
  return new Date(
    Date.UTC(year, month, day, d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()),
  );
}

export const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The UTC calendar month containing `d`: [start, end). One installment per month. */
export function utcMonthWindow(d: Date): { start: Date; end: Date } {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  return { start, end: new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)) };
}

/** Whole days past due as of `at` (the §1026.36(c)(2) rule's own count). */
export const daysPastDue = (due: Date, at: Date) => Math.floor((at.getTime() - due.getTime()) / DAY_MS);

export interface ScheduledNoteTerms {
  firstPaymentDate?: Date | string | null;
  termMonths?: number | null;
  nextPaymentDate: Date | string | null;
}

export type ScheduleResolution =
  | { kind: "grid"; first: Date; termMonths: number; currentIndex: number }
  | { kind: "undetermined"; reason: string };

const asDate = (v: Date | string | null | undefined): Date | null => {
  if (v === null || v === undefined) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
};

/**
 * Which installment `next_payment_date` is, by the note's own schedule — or
 * why that cannot be determined.
 */
export function resolveInstallmentSchedule(note: ScheduledNoteTerms): ScheduleResolution {
  const first = asDate(note.firstPaymentDate);
  const next = asDate(note.nextPaymentDate);
  const term = note.termMonths;
  if (!next) return { kind: "undetermined", reason: "note has no next payment date" };
  if (!first) return { kind: "undetermined", reason: "note states no first payment date, so its schedule is unknown" };
  if (term === null || term === undefined || !Number.isInteger(term) || term <= 0) {
    return { kind: "undetermined", reason: "note states no term, so its schedule is unknown" };
  }
  const index =
    (next.getUTCFullYear() - first.getUTCFullYear()) * 12 + (next.getUTCMonth() - first.getUTCMonth());
  if (index < 0) return { kind: "undetermined", reason: "next payment date precedes the note's first payment date" };
  if (index >= term) return { kind: "undetermined", reason: "next payment date is past the note's term" };
  if (isoDay(addMonthsUtc(first, index)) !== isoDay(next)) {
    return {
      kind: "undetermined",
      reason: `next payment date ${isoDay(next)} is off the note's schedule (installment ${index + 1} is due ${isoDay(addMonthsUtc(first, index))})`,
    };
  }
  return { kind: "grid", first, termMonths: term, currentIndex: index };
}

/**
 * How many installments, from the current one on, are due on or before
 * `asOf` — at least 1 (the current installment, due or not). On the note's
 * schedule the count stops at the term; off it, months are stepped from the
 * stored date (the cadence is still monthly) up to `maxCount`.
 */
export function countInstallmentsDue(note: ScheduledNoteTerms, asOf: Date, maxCount = 600): number {
  const next = asDate(note.nextPaymentDate);
  if (!next) return 1;
  const sched = resolveInstallmentSchedule(note);
  const remaining = sched.kind === "grid" ? sched.termMonths - sched.currentIndex : maxCount;
  const dueOn = (j: number) =>
    sched.kind === "grid" ? addMonthsUtc(sched.first, sched.currentIndex + j) : addMonthsUtc(next, j);
  // Months from the current due date to asOf, then corrected for the day.
  let j =
    (asOf.getUTCFullYear() - next.getUTCFullYear()) * 12 + (asOf.getUTCMonth() - next.getUTCMonth()) + 1;
  j = Math.min(Math.max(j, 0), remaining);
  while (j > 0 && dueOn(j - 1).getTime() > asOf.getTime()) j--;
  return Math.max(1, j);
}

/**
 * The note's next payment date once `covered` more installments are paid.
 * On the schedule: the schedule's date (a 31st stays the 31st). Off it: month
 * steps from the stored date. No stored date: from `now` (the pre-ledger rule).
 */
export function nextDueDateAfterCoverage(note: ScheduledNoteTerms, covered: number, now: Date): Date | null {
  const next = asDate(note.nextPaymentDate);
  if (covered <= 0) return next;
  if (!next) return addMonthsUtc(now, covered);
  const sched = resolveInstallmentSchedule(note);
  return sched.kind === "grid"
    ? addMonthsUtc(sched.first, sched.currentIndex + covered)
    : addMonthsUtc(next, covered);
}

export interface ServicedPaymentAllocationInput {
  amountCents: number;
  /** notes.monthly_payment in cents; null when none is recorded. */
  scheduledCents: number | null;
  /** Completed money already credited toward the CURRENT installment (earlier partials). */
  priorCreditCents: number;
  /** Installments due by the posting time, from the current one — at least 1. */
  installmentsDue: number;
  /** Late fees assessed and not yet collected. */
  outstandingFeeCents: number;
  /**
   * What pays the note off (notePaymentMath.splitPayoffCents). The demand of
   * the installments due never exceeds it: on a note whose remaining
   * installments add up to more than its payoff, money beyond the payoff
   * goes to the fees owed — as the payoff quote, which includes them,
   * assumes. Omitted: no cap.
   */
  payoffCents?: number | null;
}

export interface ServicedPaymentAllocation {
  /** Installments this payment (with prior credit) fully covers — what the due date advances by. */
  installmentsCovered: number;
  /** Cents applied to the installments due. */
  toInstallmentsCents: number;
  /** Cents applied to late fees owed — only money beyond the installments due. */
  lateFeeCents: number;
  /** Cents beyond the installments due and the fees owed: principal only. */
  principalOnlyCents: number;
  /** false when there was no scheduled amount to measure coverage against. */
  measured: boolean;
}

const assertCents = (name: string, v: number) => {
  if (!Number.isInteger(v)) throw new Error(`allocateServicedPayment: ${name} must be integer cents, got ${v}`);
};

/** THE coverage rule. Pure; integer cents in, integer cents out. */
export function allocateServicedPayment(input: ServicedPaymentAllocationInput): ServicedPaymentAllocation {
  const { amountCents, scheduledCents } = input;
  assertCents("amountCents", amountCents);
  assertCents("priorCreditCents", input.priorCreditCents);
  assertCents("outstandingFeeCents", input.outstandingFeeCents);
  if (amountCents < 0) throw new Error("allocateServicedPayment: amountCents must be >= 0");
  if (scheduledCents === null || scheduledCents <= 0) {
    // Nothing to measure an installment against: the pre-ledger behaviour —
    // a payment advances one installment and pays no fee (there is no
    // "above the installment" without an installment).
    return { installmentsCovered: 1, toInstallmentsCents: amountCents, lateFeeCents: 0, principalOnlyCents: 0, measured: false };
  }
  assertCents("scheduledCents", scheduledCents);
  const due = Math.max(1, Math.floor(input.installmentsDue));
  const prior = Math.max(0, input.priorCreditCents);
  const scheduledDemand = Math.max(0, due * scheduledCents - prior);
  const demand =
    input.payoffCents != null && Number.isFinite(input.payoffCents)
      ? Math.min(scheduledDemand, Math.max(0, input.payoffCents))
      : scheduledDemand;
  const toInstallmentsCents = Math.min(amountCents, demand);
  const lateFeeCents = Math.min(amountCents - toInstallmentsCents, Math.max(0, input.outstandingFeeCents));
  // A payment that reaches the payoff cap covers every installment due.
  const reachedPayoff = demand < scheduledDemand && toInstallmentsCents >= demand;
  const installmentsCovered = reachedPayoff ? due : Math.min(due, Math.floor((prior + toInstallmentsCents) / scheduledCents));
  return {
    installmentsCovered,
    toInstallmentsCents,
    lateFeeCents,
    principalOnlyCents: amountCents - toInstallmentsCents - lateFeeCents,
    measured: true,
  };
}
