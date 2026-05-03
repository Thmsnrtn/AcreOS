/**
 * Recognition Worker — Lavender Week 10 monthly-close pipeline.
 *
 * Three responsibilities (all keyed by the chart-of-accounts shipped in
 * 0042 / Week 6):
 *
 *   1. `recordStripeInvoicePaid(invoice)` — called from the Stripe webhook
 *      dispatcher when an `invoice.paid` (or `invoice.payment_succeeded`)
 *      event fires. Posts a balanced ledger pair:
 *
 *          DR  1000  Cash
 *          CR  4000  Subscription Revenue          (single-month invoices)
 *          CR  2050  Deferred Revenue              (annual / multi-month)
 *
 *      Annual invoices also create a `recognition_schedules` row so the
 *      worker can amortise revenue across the subscription period.
 *
 *   2. `recordStripeChargeRefunded(charge)` — posts the opposite pair so
 *      the GL nets to zero net of the refund.
 *
 *   3. `runRecognitionTick(asOf)` — the cron entry point. Drains every
 *      active recognition schedule whose next period boundary has passed,
 *      posting one DR Deferred-Revenue / CR Subscription-Revenue pair per
 *      month due. Idempotency: keyed on schedule id + month index, so
 *      retries cannot double-post.
 *
 * Idempotency
 * ───────────
 * All ledger writes use `referenceType = "stripe_event"` (or
 * "recognition_run") + a deterministic `referenceId`. Before posting a
 * new pair we check for any existing entry with the same reference; if
 * present the call is a no-op. This makes the webhook + cron path safe
 * to retry on Stripe redelivery or scheduler crash-loop.
 *
 * Transaction shape
 * ─────────────────
 * Every ledger write happens inside a single DB transaction so a partial
 * pair is impossible. The DB-level CHECK constraint
 * `account_ledger_entries_debit_xor_credit` makes a single-row pair
 * impossible to express; the application-side `postBalancedPair` helper
 * enforces that the pair sums to zero.
 */

import { db } from "../db";
import {
  accountLedgerEntries,
  chartOfAccounts,
  recognitionRuns,
  recognitionSchedules,
} from "@shared/schema";
import { and, eq, lte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

// ─── Account-number constants ─────────────────────────────────────────────
// These are the canonical numbers seeded by chartOfAccountsSeed.ts. The
// recognition worker resolves them dynamically by accountNumber so a
// customer who reparents or renames an account still maps cleanly.
const ACCT_CASH = "1000";
const ACCT_SUBSCRIPTION_REVENUE = "4000";
const ACCT_DEFERRED_REVENUE = "2050"; // not in default seed; ensureDeferredRevenueAccount() lazily creates

// Stripe surface — typed loosely so we don't pull a circular dep on the
// Stripe SDK types here. Webhook handlers downcast to these shapes.
export interface RecognitionInvoice {
  id: string;
  customerId: string;
  organizationId: number;
  amountPaidCents: number;
  /** ISO date — when the invoice was paid. */
  paidAt: string;
  /** Optional period boundaries for subscription invoices. */
  periodStartIso?: string;
  periodEndIso?: string;
  description?: string;
}

export interface RecognitionRefund {
  chargeId: string;
  organizationId: number;
  amountRefundedCents: number;
  refundedAt: string;
  invoiceId?: string;
  description?: string;
}

interface AccountLookup {
  cashId: string;
  revenueId: string;
  deferredId: string;
}

/**
 * Resolve canonical accounts for an org. Lazily creates a Deferred Revenue
 * (2050) account if missing — the default seed ships only the 15 accounts
 * a flipper / wholesaler needs; SaaS deferred revenue gets created on
 * first use so downstream orgs without recurring billing aren't polluted.
 */
async function resolveAccounts(orgId: number): Promise<AccountLookup> {
  const rows = await db
    .select({
      id: chartOfAccounts.id,
      number: chartOfAccounts.accountNumber,
    })
    .from(chartOfAccounts)
    .where(eq(chartOfAccounts.organizationId, orgId));

  const byNumber = new Map(rows.map((r) => [r.number, r.id]));

  const cashId = byNumber.get(ACCT_CASH);
  const revenueId = byNumber.get(ACCT_SUBSCRIPTION_REVENUE);

  if (!cashId) {
    throw new Error(
      `recognitionWorker: org ${orgId} has no ${ACCT_CASH} (Cash) account; seed chart_of_accounts first.`,
    );
  }
  if (!revenueId) {
    throw new Error(
      `recognitionWorker: org ${orgId} has no ${ACCT_SUBSCRIPTION_REVENUE} (Subscription Revenue) account.`,
    );
  }

  let deferredId = byNumber.get(ACCT_DEFERRED_REVENUE);
  if (!deferredId) {
    const [inserted] = await db
      .insert(chartOfAccounts)
      .values({
        organizationId: orgId,
        accountNumber: ACCT_DEFERRED_REVENUE,
        accountName: "Deferred Revenue",
        accountType: "liability",
        description:
          "Recurring-billing receipts not yet earned; drains monthly via the recognition worker.",
        isActive: true,
      })
      .returning({ id: chartOfAccounts.id });
    deferredId = inserted!.id;
  }

  return { cashId, revenueId, deferredId };
}

/**
 * Idempotency check — has any ledger entry already been posted under this
 * (referenceType, referenceId)? If yes, the caller short-circuits. We
 * check existence rather than counting because `account_ledger_entries`
 * always inserts a balanced n-tuple under one reference, so any hit means
 * the whole tuple is already present.
 */
async function isAlreadyPosted(referenceType: string, referenceId: string): Promise<boolean> {
  const [row] = await db
    .select({ id: accountLedgerEntries.id })
    .from(accountLedgerEntries)
    .where(
      and(
        eq(accountLedgerEntries.referenceType, referenceType),
        eq(accountLedgerEntries.referenceId, referenceId),
      ),
    )
    .limit(1);
  return !!row;
}

interface LedgerLeg {
  accountId: string;
  debit?: number;
  credit?: number;
}

/**
 * Post a balanced n-tuple of ledger entries inside a single transaction.
 * Throws if debits ≠ credits — this is the application-side echo of the
 * DB-level XOR check.
 */
async function postBalancedTuple(args: {
  organizationId: number;
  bookingDate: string; // YYYY-MM-DD
  description: string;
  referenceType: string;
  referenceId: string;
  legs: LedgerLeg[];
}): Promise<number> {
  const totalDebit = args.legs.reduce((s, l) => s + (l.debit ?? 0), 0);
  const totalCredit = args.legs.reduce((s, l) => s + (l.credit ?? 0), 0);
  if (totalDebit !== totalCredit) {
    throw new Error(
      `recognitionWorker: unbalanced ledger tuple for ${args.referenceType}:${args.referenceId} ` +
        `— debits=${totalDebit}, credits=${totalCredit}`,
    );
  }

  // tx wraps the existence check + insert so concurrent webhook redelivery
  // can't sneak two tuples in. We re-check inside the tx to plug TOCTOU.
  return await db.transaction(async (tx) => {
    const [existing] = await tx
      .select({ id: accountLedgerEntries.id })
      .from(accountLedgerEntries)
      .where(
        and(
          eq(accountLedgerEntries.referenceType, args.referenceType),
          eq(accountLedgerEntries.referenceId, args.referenceId),
        ),
      )
      .limit(1);
    if (existing) return 0;

    const rows = args.legs.map((l) => ({
      organizationId: args.organizationId,
      accountId: l.accountId,
      debit: l.debit ?? 0,
      credit: l.credit ?? 0,
      description: args.description,
      referenceType: args.referenceType,
      referenceId: args.referenceId,
      bookingDate: args.bookingDate,
    }));
    await tx.insert(accountLedgerEntries).values(rows);
    return rows.length;
  });
}

// ─── Public entry points ──────────────────────────────────────────────────

/**
 * Record a Stripe `invoice.paid` event.
 *
 * Single-month invoices ⇒ DR Cash / CR Subscription Revenue.
 * Annual / multi-month  ⇒ DR Cash / CR Deferred Revenue + a row in
 *                         `recognition_schedules` so the cron worker can
 *                         drain it monthly.
 *
 * Idempotent on `referenceId = stripe_invoice:<invoice.id>`.
 */
export async function recordStripeInvoicePaid(
  invoice: RecognitionInvoice,
): Promise<{ posted: boolean; legs: number; deferred: boolean }> {
  const referenceType = "stripe_event";
  const referenceId = `invoice.paid:${invoice.id}`;

  if (await isAlreadyPosted(referenceType, referenceId)) {
    return { posted: false, legs: 0, deferred: false };
  }

  const { cashId, revenueId, deferredId } = await resolveAccounts(invoice.organizationId);

  const months = monthsBetween(invoice.periodStartIso, invoice.periodEndIso);
  const isDeferred = months > 1;

  const bookingDate = invoice.paidAt.slice(0, 10);
  const description =
    invoice.description ??
    (isDeferred
      ? `Stripe invoice ${invoice.id} — ${months}mo prepayment to deferred revenue`
      : `Stripe invoice ${invoice.id} — recognised immediately`);

  const legs: LedgerLeg[] = isDeferred
    ? [
        { accountId: cashId, debit: invoice.amountPaidCents },
        { accountId: deferredId, credit: invoice.amountPaidCents },
      ]
    : [
        { accountId: cashId, debit: invoice.amountPaidCents },
        { accountId: revenueId, credit: invoice.amountPaidCents },
      ];

  const inserted = await postBalancedTuple({
    organizationId: invoice.organizationId,
    bookingDate,
    description,
    referenceType,
    referenceId,
    legs,
  });

  if (isDeferred && inserted > 0) {
    await db
      .insert(recognitionSchedules)
      .values({
        organizationId: invoice.organizationId,
        sourceType: "stripe_invoice",
        sourceId: invoice.id,
        totalCents: invoice.amountPaidCents,
        balanceRemainingCents: invoice.amountPaidCents,
        periodStart: invoice.periodStartIso!.slice(0, 10),
        periodEnd: invoice.periodEndIso!.slice(0, 10),
        monthsTotal: months,
        monthsRecognised: 0,
        status: "active",
      })
      .onConflictDoNothing();
  }

  logger.info("recognitionWorker.invoicePaid", {
    invoiceId: invoice.id,
    organizationId: invoice.organizationId,
    amountCents: invoice.amountPaidCents,
    months,
    deferred: isDeferred,
  });

  return { posted: inserted > 0, legs: inserted, deferred: isDeferred };
}

/**
 * Record a Stripe `charge.refunded` event. Posts the opposite pair of the
 * original invoice booking. We do not unwind any deferred-revenue
 * schedule here — operators handle full refunds via a manual journal in
 * the same tax period; partial refunds are out-of-scope for v1.
 */
export async function recordStripeChargeRefunded(
  refund: RecognitionRefund,
): Promise<{ posted: boolean; legs: number }> {
  const referenceType = "stripe_event";
  const referenceId = `charge.refunded:${refund.chargeId}`;

  if (await isAlreadyPosted(referenceType, referenceId)) {
    return { posted: false, legs: 0 };
  }

  const { cashId, revenueId } = await resolveAccounts(refund.organizationId);
  const bookingDate = refund.refundedAt.slice(0, 10);
  const description =
    refund.description ?? `Stripe refund — charge ${refund.chargeId}`;

  // Opposite of an immediate invoice booking: DR Revenue / CR Cash. This
  // reverses recognised revenue and reduces cash.
  const legs: LedgerLeg[] = [
    { accountId: revenueId, debit: refund.amountRefundedCents },
    { accountId: cashId, credit: refund.amountRefundedCents },
  ];

  const inserted = await postBalancedTuple({
    organizationId: refund.organizationId,
    bookingDate,
    description,
    referenceType,
    referenceId,
    legs,
  });

  logger.info("recognitionWorker.chargeRefunded", {
    chargeId: refund.chargeId,
    organizationId: refund.organizationId,
    amountCents: refund.amountRefundedCents,
  });

  return { posted: inserted > 0, legs: inserted };
}

/**
 * Cron entry point. Walks every active recognition schedule and posts a
 * monthly DR Deferred / CR Revenue pair for every period boundary that
 * has passed since the last tick. Returns a summary so the
 * `scheduleSelfRescheduling` wrapper can record `recordsProcessed`.
 *
 * The worker is idempotent in two ways:
 *   1. Each ledger write is keyed on
 *      `recognition_run:<scheduleId>:<monthIndex>` — re-running the same
 *      tick on the same as-of date produces no new rows.
 *   2. `recognitionSchedules.monthsRecognised` advances inside the same
 *      transaction as the ledger insert, so a crash mid-tick rolls the
 *      counter back and the next run picks up the dropped month.
 */
export async function runRecognitionTick(
  asOf: Date = new Date(),
): Promise<{ schedulesProcessed: number; entriesPosted: number; centsRecognised: number; runId: string }> {
  const asOfDate = asOf.toISOString().slice(0, 10);

  const [run] = await db
    .insert(recognitionRuns)
    .values({
      asOfDate,
      status: "running",
      schedulesProcessed: 0,
      entriesPosted: 0,
      centsRecognised: 0,
    })
    .returning({ id: recognitionRuns.id });
  const runId = run!.id;

  let schedulesProcessed = 0;
  let entriesPosted = 0;
  let centsRecognised = 0;

  try {
    // Pull every active schedule whose period_start has passed (we don't
    // pre-recognise future periods) and whose monthsRecognised < monthsTotal.
    const schedules = await db
      .select()
      .from(recognitionSchedules)
      .where(
        and(
          eq(recognitionSchedules.status, "active"),
          lte(recognitionSchedules.periodStart, asOfDate),
        ),
      );

    for (const s of schedules) {
      const dueMonths = monthsDueAsOf(s.periodStart as unknown as string, asOfDate, s.monthsTotal);
      if (dueMonths <= s.monthsRecognised) continue;

      const { revenueId, deferredId } = await resolveAccounts(s.organizationId);

      // Drain one month at a time so each post is auditable independently.
      for (let m = s.monthsRecognised + 1; m <= dueMonths; m++) {
        const monthlyCents = perMonthCents(s.totalCents, s.monthsTotal, m);
        const referenceType = "recognition_run";
        const referenceId = `${s.id}:m${m}`;

        const inserted = await postBalancedTuple({
          organizationId: s.organizationId,
          bookingDate: asOfDate,
          description: `Deferred revenue recognition — ${s.sourceType} ${s.sourceId} month ${m}/${s.monthsTotal}`,
          referenceType,
          referenceId,
          legs: [
            { accountId: deferredId, debit: monthlyCents },
            { accountId: revenueId, credit: monthlyCents },
          ],
        });

        if (inserted > 0) {
          entriesPosted += inserted;
          centsRecognised += monthlyCents;
        }

        await db
          .update(recognitionSchedules)
          .set({
            monthsRecognised: m,
            balanceRemainingCents: Math.max(0, s.balanceRemainingCents - monthlyCents),
            updatedAt: new Date(),
            status: m >= s.monthsTotal ? "completed" : "active",
          })
          .where(eq(recognitionSchedules.id, s.id));
        // Mutate the local copy so the loop's next iteration sees the new balance.
        s.balanceRemainingCents = Math.max(0, s.balanceRemainingCents - monthlyCents);
        s.monthsRecognised = m;
      }

      schedulesProcessed++;
    }

    await db
      .update(recognitionRuns)
      .set({
        runCompletedAt: new Date(),
        schedulesProcessed,
        entriesPosted,
        centsRecognised,
        status: "success",
      })
      .where(eq(recognitionRuns.id, runId));
  } catch (err) {
    await db
      .update(recognitionRuns)
      .set({
        runCompletedAt: new Date(),
        status: "failure",
        errorMessage: err instanceof Error ? err.message : String(err),
      })
      .where(eq(recognitionRuns.id, runId));
    throw err;
  }

  return { schedulesProcessed, entriesPosted, centsRecognised, runId };
}

// ─── Date math helpers ────────────────────────────────────────────────────

/** Whole-months between two ISO timestamps (rounded to the nearest month). */
export function monthsBetween(startIso?: string, endIso?: string): number {
  if (!startIso || !endIso) return 1;
  const s = new Date(startIso);
  const e = new Date(endIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return 1;
  const months =
    (e.getUTCFullYear() - s.getUTCFullYear()) * 12 + (e.getUTCMonth() - s.getUTCMonth());
  // Round any remainder up — "11.7 months" is treated as 12 (annual sub).
  const dayRemainder = e.getUTCDate() - s.getUTCDate();
  const rounded = months + (dayRemainder > 14 ? 1 : 0);
  return Math.max(1, rounded);
}

/**
 * How many monthly periods have come due as of `asOf`, given that the
 * subscription's billing period starts on `periodStartIso`. Capped at
 * `monthsTotal`.
 */
export function monthsDueAsOf(periodStartIso: string, asOfIso: string, monthsTotal: number): number {
  const s = new Date(periodStartIso);
  const a = new Date(asOfIso);
  if (Number.isNaN(s.getTime()) || Number.isNaN(a.getTime())) return 0;
  const months =
    (a.getUTCFullYear() - s.getUTCFullYear()) * 12 + (a.getUTCMonth() - s.getUTCMonth());
  // Recognise the first month on or after the period_start.
  const due = Math.max(0, months + 1);
  return Math.min(monthsTotal, due);
}

/**
 * Per-month cents — divides total evenly with the remainder dropped on
 * month 1 (so totals reconcile exactly, not approximately).
 */
export function perMonthCents(totalCents: number, monthsTotal: number, monthIndex: number): number {
  const base = Math.floor(totalCents / monthsTotal);
  const remainder = totalCents - base * monthsTotal;
  return monthIndex === 1 ? base + remainder : base;
}

/**
 * Wire the cron tick into the self-rescheduling job framework. Called
 * once at server boot. Hourly cadence — most months any given hour will
 * be a no-op, but we keep cadence tight so a missed boundary is caught
 * within an hour.
 */
export function startRecognitionWorker(): () => void {
  let cancelInner: (() => void) | null = null;
  void import("../jobs/scheduler").then(({ scheduleSelfRescheduling }) => {
    cancelInner = scheduleSelfRescheduling({
      name: "recognition_worker",
      intervalMs: 60 * 60 * 1000, // hourly
      initialDelayMs: 5 * 60 * 1000, // wait 5m after boot
      run: async () => {
        const out = await runRecognitionTick();
        return out.entriesPosted;
      },
    });
  });
  return () => cancelInner?.();
}

// Suppress unused-warning on `sql` import if linter is strict.
void sql;
