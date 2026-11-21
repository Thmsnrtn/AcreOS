/**
 * Acquired-book figures for the SHARED money surfaces (H-DEF-4).
 *
 * The hybrid walk (journey-walk-hybrid-2026-11.md) proved the shared
 * surfaces — GET /api/finance/portfolio-summary, GET /api/finance/delinquency
 * and GET /api/today — covered the serviced (seller-finance) book only: an
 * org's acquired notes appeared nowhere, and a past-due acquired note raised
 * no Today item. The hybrid promise is one workspace over both books, so
 * these helpers compute the acquired book's figures for those surfaces.
 *
 * LABELLING LAW (the brief's cure shape): figures are returned per book,
 * each carrying its `book` discriminator (ACQUIRED_BOOK_ID /
 * SELLER_FINANCE_BOOK_ID from the schema — the books differ in money
 * representation and id type, so a merged number would be a silent
 * misreading). Nothing here merges the books into an unlabelled total.
 *
 * MONEY: acquired rows are integer CENTS (bigint columns); every figure
 * this module returns is DOLLARS, matching the serviced book's response
 * shape, converted exactly once here (cents / 100, rounded to cents).
 *
 * DELINQUENCY is derived LIVE from `nextPaymentDate` via
 * `computeNoteDelinquency` — the schedule service's one derivation, the
 * same one the aging sweep and payment path use — never from the stored
 * `daysDelinquent` column, which nothing refreshes at import (H-DEF-3).
 * A note whose due date cannot be determined is NOT counted delinquent
 * and NOT counted current: "unknown is not late" and unknown is not
 * current either; it is excluded from the aging buckets and reported in
 * `undeterminableCount`.
 */

import { ACQUIRED_BOOK_ID, type AcquiredNote, type NotePayment } from "@shared/schema/notes-vertical";
import { computeNoteDelinquency, delinquencyIsDeterminable } from "../notes/acquiredNoteSchedule";

/** The row shape these helpers need — a structural subset of AcquiredNote. */
export type AcquiredBookNote = Pick<
  AcquiredNote,
  | "id"
  | "noteNumber"
  | "payerName"
  | "status"
  | "originalPrincipalCents"
  | "currentBalanceCents"
  | "paymentAmountCents"
  | "interestRateBps"
  | "nextPaymentDate"
>;

/** The payment row shape these helpers need — a subset of NotePayment. */
export type AcquiredBookPayment = Pick<
  NotePayment,
  "paymentDate" | "principalCents" | "interestCents" | "lateFeeCents"
>;

/** Statuses that still owe money / still count as the live book. */
const ACTIVE_STATUSES = new Set(["performing", "late", "default"]);
const PAID_OFF_STATUSES = new Set(["paid_off"]);

function dollars(cents: number): number {
  return Math.round(cents) / 100;
}

function isActive(n: AcquiredBookNote): boolean {
  return ACTIVE_STATUSES.has(n.status);
}

/** Live days past due for one note, or null when it cannot be determined. */
function acquiredDaysDelinquent(
  n: Pick<AcquiredBookNote, "nextPaymentDate">,
  now: Date,
): number | null {
  if (!delinquencyIsDeterminable(n.nextPaymentDate)) return null;
  return computeNoteDelinquency({ nextPaymentDate: n.nextPaymentDate, asOf: now }).daysDelinquent;
}

export interface AcquiredBookSummary {
  book: typeof ACQUIRED_BOOK_ID;
  totalNotes: number;
  activeNotes: number;
  totalPortfolioValue: number;
  totalMonthlyPayment: number;
  totalOriginalPrincipal: number;
  averageInterestRate: number;
  statusBreakdown: Array<{ status: string; count: number; value: number }>;
  delinquentCount: number;
  delinquencyRate: number;
  undeterminableCount: number;
  monthlyCashFlow: Array<{ month: string; amount: number }>;
  monthlyBreakdownByType: Array<{
    month: string;
    principal: number;
    interest: number;
    lateFees: number;
    total: number;
  }>;
  netInflowMtd: number;
}

export function summarizeAcquiredBook(
  rows: AcquiredBookNote[],
  payments: AcquiredBookPayment[],
  now: Date,
): AcquiredBookSummary {
  const active = rows.filter(isActive);
  const paidOff = rows.filter((n) => PAID_OFF_STATUSES.has(n.status));

  const totalPortfolioValue = dollars(active.reduce((s, n) => s + Number(n.currentBalanceCents || 0), 0));
  const totalMonthlyPayment = dollars(active.reduce((s, n) => s + Number(n.paymentAmountCents || 0), 0));
  const totalOriginalPrincipal = dollars(rows.reduce((s, n) => s + Number(n.originalPrincipalCents || 0), 0));
  const averageInterestRate =
    active.length > 0
      ? active.reduce((s, n) => s + Number(n.interestRateBps || 0) / 100, 0) / active.length
      : 0;

  const byStatus = new Map<string, { count: number; cents: number }>();
  for (const n of rows) {
    const e = byStatus.get(n.status) ?? { count: 0, cents: 0 };
    e.count += 1;
    e.cents += Number(n.currentBalanceCents || 0);
    byStatus.set(n.status, e);
  }
  const statusBreakdown = Array.from(byStatus.entries()).map(([status, e]) => ({
    status,
    count: e.count,
    value: dollars(e.cents),
  }));

  let delinquentCount = 0;
  let undeterminableCount = 0;
  for (const n of active) {
    const days = acquiredDaysDelinquent(n, now);
    if (days === null) undeterminableCount += 1;
    else if (days > 0) delinquentCount += 1;
  }
  const delinquencyRate = active.length > 0 ? (delinquentCount / active.length) * 100 : 0;

  // Monthly cash flow, last 12 months — same window/labels as the serviced
  // book's loop in routes-finance. Acquired payments carry no status column:
  // every note_payments row is a posted ledger fact (reversals are rows with
  // negative cents, so they net out in the sums rather than being filtered).
  const monthlyCashFlow: AcquiredBookSummary["monthlyCashFlow"] = [];
  const monthlyBreakdownByType: AcquiredBookSummary["monthlyBreakdownByType"] = [];
  for (let i = 11; i >= 0; i--) {
    const monthStart = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const monthEnd = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59);
    const monthLabel = monthStart.toISOString().slice(0, 7);
    const monthPayments = payments.filter((p) => {
      const d = p.paymentDate ? new Date(p.paymentDate) : null;
      return d && d >= monthStart && d <= monthEnd;
    });
    const principal = monthPayments.reduce((s, p) => s + Number(p.principalCents || 0), 0);
    const interest = monthPayments.reduce((s, p) => s + Number(p.interestCents || 0), 0);
    const lateFees = monthPayments.reduce((s, p) => s + Number(p.lateFeeCents || 0), 0);
    const total = principal + interest + lateFees;
    monthlyCashFlow.push({ month: monthLabel, amount: dollars(total) });
    monthlyBreakdownByType.push({
      month: monthLabel,
      principal: dollars(principal),
      interest: dollars(interest),
      lateFees: dollars(lateFees),
      total: dollars(total),
    });
  }

  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const netInflowMtd = dollars(
    payments
      .filter((p) => p.paymentDate && new Date(p.paymentDate) >= monthStart)
      .reduce((s, p) => s + Number(p.principalCents || 0) + Number(p.interestCents || 0) + Number(p.lateFeeCents || 0), 0),
  );

  return {
    book: ACQUIRED_BOOK_ID,
    totalNotes: rows.length,
    activeNotes: active.length,
    totalPortfolioValue,
    totalMonthlyPayment,
    totalOriginalPrincipal,
    averageInterestRate: Math.round(averageInterestRate * 100) / 100,
    statusBreakdown,
    delinquentCount,
    delinquencyRate: Math.round(delinquencyRate * 10) / 10,
    undeterminableCount,
    monthlyCashFlow,
    monthlyBreakdownByType,
    netInflowMtd,
  };
}

export interface AcquiredDelinquency {
  book: typeof ACQUIRED_BOOK_ID;
  delinquencyRate: number;
  atRiskAmount: number;
  totalDelinquentNotes: number;
  undeterminableCount: number;
  agingBuckets: {
    current: { count: number; value: number };
    days30: { count: number; value: number };
    days60: { count: number; value: number };
    days90Plus: { count: number; value: number };
  };
  totalPrincipalCollected: number;
  totalInterestCollected: number;
}

export function acquiredDelinquency(
  rows: AcquiredBookNote[],
  payments: AcquiredBookPayment[],
  now: Date,
): AcquiredDelinquency {
  const active = rows.filter(isActive);
  const buckets = {
    current: [] as AcquiredBookNote[],
    days30: [] as AcquiredBookNote[],
    days60: [] as AcquiredBookNote[],
    days90Plus: [] as AcquiredBookNote[],
  };
  let undeterminableCount = 0;
  for (const n of active) {
    const days = acquiredDaysDelinquent(n, now);
    if (days === null) {
      undeterminableCount += 1;
    } else if (days <= 0) {
      buckets.current.push(n);
    } else if (days <= 30) {
      buckets.days30.push(n);
    } else if (days <= 60) {
      buckets.days60.push(n);
    } else {
      buckets.days90Plus.push(n);
    }
  }
  const delinquent = [...buckets.days30, ...buckets.days60, ...buckets.days90Plus];
  const bucketView = (list: AcquiredBookNote[]) => ({
    count: list.length,
    value: dollars(list.reduce((s, n) => s + Number(n.currentBalanceCents || 0), 0)),
  });
  return {
    book: ACQUIRED_BOOK_ID,
    delinquencyRate: active.length > 0 ? (delinquent.length / active.length) * 100 : 0,
    atRiskAmount: dollars(delinquent.reduce((s, n) => s + Number(n.currentBalanceCents || 0), 0)),
    totalDelinquentNotes: delinquent.length,
    undeterminableCount,
    agingBuckets: {
      current: bucketView(buckets.current),
      days30: bucketView(buckets.days30),
      days60: bucketView(buckets.days60),
      days90Plus: bucketView(buckets.days90Plus),
    },
    totalPrincipalCollected: dollars(payments.reduce((s, p) => s + Number(p.principalCents || 0), 0)),
    totalInterestCollected: dollars(payments.reduce((s, p) => s + Number(p.interestCents || 0), 0)),
  };
}

export interface DelinquentAcquiredNote {
  note: AcquiredBookNote;
  daysDelinquent: number;
}

/**
 * The acquired notes that are past due right now, worst first — the input
 * to Today's queue (an acquired note's delinquency raises a Today item,
 * as the serviced book's lateness does) and to any other shared surface
 * that needs the list rather than the aggregates.
 */
export function delinquentAcquiredNotes(rows: AcquiredBookNote[], now: Date): DelinquentAcquiredNote[] {
  const out: DelinquentAcquiredNote[] = [];
  for (const n of rows) {
    if (!isActive(n)) continue;
    const days = acquiredDaysDelinquent(n, now);
    if (days !== null && days > 0) out.push({ note: n, daysDelinquent: days });
  }
  return out.sort((a, b) => b.daysDelinquent - a.daysDelinquent);
}
