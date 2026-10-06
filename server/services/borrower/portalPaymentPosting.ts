/**
 * ONE posting rule for a borrower's card payment on the serviced-note book.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * A borrower's Stripe Checkout Session used to be posted by TWO live writers
 * that disagreed about what the payment meant:
 *
 *   * the browser return (`POST /api/borrower/verify-payment`) — integer-cent
 *     split via `splitPaymentCents`, grace-aware late fee, an atomic
 *     `INSERT … ON CONFLICT (transaction_id) DO NOTHING`, and a
 *     `payment.received` workflow event;
 *   * the Connect webhook (`WebhookHandlers.processBorrowerPortalPayment`) —
 *     a FLOAT ratio of the next schedule row (`.toFixed(2)`), late fee
 *     hard-coded to "0", a read-then-write dedupe that races on redelivery,
 *     NO workflow event, and the only receipt email the borrower ever got.
 *
 * Which one ran first was decided by network timing — Stripe's own docs say
 * the landing page and the webhook arrive in no guaranteed order — so the
 * same $100 could land as $10 or $20 of interest, with or without a late fee,
 * with or without a receipt, depending on whether the borrower kept the tab
 * open. Both writers also marked the next installment `paid` and advanced
 * the due date for ANY amount, so an authorized $50 against a $100 installment
 * showed the borrower nothing due next month.
 *
 * This module is the single writer both entry points now call. The callers
 * keep what is genuinely theirs — the browser route owns the borrower session
 * and the connected-account `retrieve`; the webhook owns signature/ownership
 * of the event — and hand the note plus the session here. Everything that
 * decides what the money MEANS lives in this one function.
 *
 * Writes go through `tx.*` inside `withTransaction` and `storage.updateNote`,
 * never `db.insert(payments)` / `db.update(notes)`:
 * `legacyNoteModelIsTerminal.test.ts` pins the set of direct writers on the
 * legacy book and must not see a new one.
 */

import type Stripe from "stripe";
import { and, eq } from "drizzle-orm";
import { notes, payments, type Note, type Payment } from "@shared/schema";
import { noteGracePeriodDays } from "@shared/notes/delinquency";
import { storage } from "../../storage";
import { withTransaction } from "../../db";
import { logger } from "../../utils/logger";
import { emitPaymentEvent } from "../workflow-engine";
import {
  splitPaymentCents,
  splitPayoffCents,
  decimalDollarsToCents,
  percentStringToBps,
} from "../notePaymentMath";
import {
  assessEveryInstallmentDue,
  assessServicedNoteLateFee,
  creditedToInstallmentCents,
  outstandingServicedLateFeesCents,
} from "../notes/servicedLateFees";
import {
  allocateServicedPayment,
  countInstallmentsDue,
  nextDueDateAfterCoverage,
} from "../notes/installmentCoverage";

// ─────────────────────────────────────────────────────────────────────
// Workflow payment events (Wave B — "wire the engine")
// ─────────────────────────────────────────────────────────────────────
// Both portal writers post through `postBorrowerPortalCheckoutPayment`, which
// posts at most one row per checkout session and returns `already_recorded`
// when the row exists — so emitting on the `posted` branch yields exactly ONE
// event per payment row, never one per retry or per redelivery.
//
// Money-path discipline: the emit runs AFTER the balance-mutating write has
// committed, and is wrapped so a workflow fault can never fail, roll back or
// re-post a borrower payment.
//
// Unlike the note/rent ledgers, `payments.id` is a serial integer, so the
// real payment id IS the emitted entityId.
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days between the scheduled due date and the moment the payment
 * posted. Returns null when the note carries no next-payment date, so the
 * event never publishes a guessed lateness. 0 means on-time-or-early.
 */
export function daysLateForBorrowerPayment(
  dueDate: Date | null | undefined,
  paymentDate: Date,
): number | null {
  if (!dueDate) return null;
  const due = dueDate instanceof Date ? dueDate.getTime() : new Date(dueDate).getTime();
  const paid = paymentDate.getTime();
  if (Number.isNaN(due) || Number.isNaN(paid)) return null;
  const diffDays = Math.floor((paid - due) / DAY_MS);
  return diffDays > 0 ? diffDays : 0;
}

/** Everything the emit needs, read from rows that are already committed. */
export interface PostedBorrowerPayment {
  organizationId: number;
  noteId: number;
  paymentId: number;
  amountCents: number;
  principalCents: number;
  interestCents: number;
  lateFeeCents: number;
  /** notes.monthly_payment in cents — null when the note has none recorded. */
  scheduledPaymentCents: number | null;
  dueDate: Date | null;
  paymentDate: Date;
  remainingBalanceCents: number;
  paymentMethod: string;
  /**
   * Which entry point posted it: `borrower_portal` (browser return),
   * `stripe_webhook` (Connect `checkout.session.completed`), or the sunset
   * `borrower_portal_legacy_token` path.
   */
  source: string;
}

/** The `data` bag workflow conditions match on / templates interpolate. */
export function buildBorrowerPaymentEventData(p: PostedBorrowerPayment): Record<string, any> {
  const scheduled = p.scheduledPaymentCents;
  return {
    source: p.source,
    // Identity
    noteId: p.noteId,
    paymentId: p.paymentId,
    // Money
    amountCents: p.amountCents,
    amount: p.amountCents / 100,
    principalCents: p.principalCents,
    interestCents: p.interestCents,
    lateFeeCents: p.lateFeeCents,
    scheduledPaymentCents: scheduled,
    // Shape
    isFullPayment: scheduled === null ? null : p.amountCents >= scheduled,
    isPartial: scheduled === null ? null : p.amountCents < scheduled,
    paymentMethod: p.paymentMethod,
    paymentDate: p.paymentDate.toISOString(),
    dueDate: p.dueDate ? p.dueDate.toISOString() : null,
    daysLate: daysLateForBorrowerPayment(p.dueDate, p.paymentDate),
    // State after the payment
    remainingBalanceCents: p.remainingBalanceCents,
    remainingPrincipal: p.remainingBalanceCents / 100,
    isPaidOff: p.remainingBalanceCents <= 0,
  };
}

/**
 * Fire-and-forget workflow emit for a borrower payment that is ALREADY
 * committed. Never throws.
 */
export function emitBorrowerPaymentReceived(p: PostedBorrowerPayment): void {
  try {
    emitPaymentEvent(
      "payment.received",
      p.organizationId,
      p.paymentId,
      buildBorrowerPaymentEventData(p),
    );
  } catch (err) {
    // Swallowed on purpose — the borrower's money is banked and the response
    // must not change because a workflow misbehaved.
    logger.error(
      "Borrower payment workflow emit failed (payment already posted)",
      err instanceof Error ? err : undefined,
      { organizationId: p.organizationId, noteId: p.noteId, paymentId: p.paymentId },
    );
  }
}

// ─────────────────────────────────────────────────────────────────────
// The posting rule
// ─────────────────────────────────────────────────────────────────────

/**
 * The fields of a Checkout Session the posting rule reads. The webhook has
 * the session straight from the signed event payload; the browser route has
 * it from a connected-account `retrieve`. Neither needs the full object.
 */
export type PortalCheckoutSession = Pick<
  Stripe.Checkout.Session,
  "id" | "amount_total" | "payment_status" | "metadata"
>;

/**
 * Which entry point posted the payment:
 *  - `borrower_portal`  — the portal's browser return (/api/borrower/verify-payment)
 *  - `stripe_webhook`   — the Connect `checkout.session.completed` for a portal session
 *  - `payment_link`     — the Connect `checkout.session.completed` for a lender-shared
 *                          Stripe Payment Link (metadata.paymentType === "note_payment")
 */
export type PortalPaymentSource = "borrower_portal" | "stripe_webhook" | "payment_link";

/**
 * Every source a serviced-note payment can be posted from. `operator_recorded`
 * is the lender recording money received outside a processor (a check, cash,
 * a wire) from the finance page — POST /api/payments.
 */
export type ServicedPaymentSource = PortalPaymentSource | "operator_recorded";

export interface PostBorrowerPortalCheckoutPaymentInput {
  /** Loaded and ownership-checked by the caller (session pin or webhook metadata). */
  note: Note;
  stripeSession: PortalCheckoutSession;
  source: PortalPaymentSource;
  /** Injectable clock for tests. */
  now?: Date;
}

/**
 * What happened to the installment the payment was applied against.
 *
 *  - `applied`         — the amount (with any earlier partial toward the
 *                        current installment) covered at least one scheduled
 *                        payment; that many pending schedule rows are `paid`
 *                        and the due date moved that many installments
 *                        (DEFECT-0185: a lump that funds three advances three).
 *  - `partial`         — the amount covered no whole installment. The
 *                        balance and ledger are updated (the money is real) but
 *                        the installment stays `pending` and the due date does
 *                        not move: a $50 payment against a $100 installment does
 *                        not mean nothing is due.
 *  - `no_schedule_row` — the note has no pending schedule row to mark.
 */
export type InstallmentOutcome = "applied" | "partial" | "no_schedule_row";

export type PostBorrowerPortalCheckoutPaymentResult =
  | { outcome: "refused"; reason: "payment_not_completed" | "session_not_for_note" }
  | { outcome: "already_recorded"; payment: Payment }
  | {
      outcome: "posted";
      payment: Payment;
      amountCents: number;
      principalCents: number;
      interestCents: number;
      lateFeeCents: number;
      remainingBalanceCents: number;
      /** Money received beyond the payoff and applied to nothing (DEFECT-0098). */
      unappliedCents: number;
      installment: InstallmentOutcome;
      /**
       * Installments the payment (with any earlier partial toward the current
       * one) fully covered — what the due date advanced by. 0 when `partial`.
       */
      installmentsCovered: number;
      /** The note's due date AFTER this payment — unchanged when `partial`. */
      nextPaymentDate: Date | null;
      receiptEmailed: boolean;
    };

export async function postBorrowerPortalCheckoutPayment(
  input: PostBorrowerPortalCheckoutPaymentInput,
): Promise<PostBorrowerPortalCheckoutPaymentResult> {
  const { note, stripeSession, source } = input;
  const now = input.now ?? new Date();

  // ── Refusals, before any write ──────────────────────────────────────
  // `checkout.session.completed` fires for delayed-notification payment
  // methods while `payment_status` is still `unpaid`; only a `paid` session
  // is money. The browser route always checked this; the webhook never did.
  if (stripeSession.payment_status !== "paid") {
    return { outcome: "refused", reason: "payment_not_completed" };
  }
  // Ownership: `metadata.noteId` is OURS — written by
  // `buildBorrowerCardCheckoutParams` at session-create time. Both callers
  // check it too; this is the invariant the posting rule owns regardless of
  // who calls it.
  const paidForNoteId = stripeSession.metadata?.noteId;
  if (paidForNoteId !== undefined && paidForNoteId !== null && Number(paidForNoteId) !== note.id) {
    return { outcome: "refused", reason: "session_not_for_note" };
  }

  // ── Amount ──────────────────────────────────────────────────────────
  const amountCents =
    stripeSession.amount_total != null && stripeSession.amount_total > 0
      ? stripeSession.amount_total
      : decimalDollarsToCents(stripeSession.metadata?.paymentAmount ?? note.monthlyPayment);

  return postServicedNotePayment({
    note,
    amountCents,
    transactionId: stripeSession.id,
    source,
    paymentMethod: "card",
    now,
    sendReceipt: true,
  });
}

/**
 * Does a serviced note take a payment recorded by hand? Yes while it is being
 * serviced — `active`, and `defaulted`, since money on a defaulted note is a
 * cure, not a mistake (audit of 1694a0b: the old list refused it). No once it
 * is finished (`paid_off`, `foreclosed`, `sold`) or before it is originated
 * (`pending` — origination runs through the Reg-Z chokepoint first). `late`
 * and `delinquent` are accepted for rows written before delinquency moved to
 * its own column (`delinquencyStatus`).
 */
const SERVICED_NOTE_STATUSES_TAKING_PAYMENT: ReadonlySet<string> = new Set(["active", "defaulted", "late", "delinquent"]);
export function servicedNoteTakesPayment(status: string | null | undefined): boolean {
  return SERVICED_NOTE_STATUSES_TAKING_PAYMENT.has(String(status ?? ""));
}

export interface PostServicedNotePaymentInput {
  /** Loaded, org-checked by the caller. */
  note: Note;
  amountCents: number;
  /** The payment's identity — `payments.transaction_id` (unique). A repeat is a no-op. */
  transactionId: string;
  source: ServicedPaymentSource;
  paymentMethod: string;
  now?: Date;
  /**
   * The borrower receipt describes a charge on the lender's own processor;
   * money the lender recorded by hand (a check, cash) gets no such receipt.
   */
  sendReceipt: boolean;
}

export type PostServicedNotePaymentResult = Exclude<PostBorrowerPortalCheckoutPaymentResult, { outcome: "refused" }>;

/**
 * THE posting rule for the serviced-note book (`notes` / `payments`): the
 * late-fee rule, the integer-cents split, one idempotent row keyed by
 * `transactionId`, the balance moved on the locked row, the installments and
 * due date advanced by the installments the money fully covered (the shared
 * coverage rule, `notes/installmentCoverage.ts` — DEFECT-0185), fees owed
 * read under the note's row lock, `payment.received` emitted once. The portal, the Stripe webhook, Payment Links and the operator's
 * finance-page "Record payment" all post through it (audit of 224a5c0: the
 * finance route lowered the balance and nothing else, so a recorded payment
 * left the note overdue and autopay free to debit the same installment).
 */
export async function postServicedNotePayment(
  input: PostServicedNotePaymentInput,
): Promise<PostServicedNotePaymentResult> {
  const { note, amountCents, transactionId, source, paymentMethod } = input;
  const now = input.now ?? new Date();

  // ── Late fees ASSESSED first (founder ruling 2026-09-29 #6, DEFECT-0099;
  // every missed installment, DEFECT-0185). A payment arriving after grace on
  // installments not yet paid in full records each one's fee as ASSESSED
  // (idempotent per installment — the daily job may already have), BEFORE
  // the payment covers them: an installment paid late is still late.
  const paymentDate = now;
  // Every installment due — not one capped run's worth: a catch-up that
  // covers deferred installments must not advance past their fees (W10.5).
  await assessEveryInstallmentDue(note, now, assessServicedNoteLateFee);
  if (noteGracePeriodDays(note.gracePeriodDays) === null && decimalDollarsToCents(note.lateFee) > 0) {
    logger.info("note_late_fee_skipped_grace_unstated", {
      metadata: { noteId: note.id, organizationId: note.organizationId, configuredLateFeeCents: decimalDollarsToCents(note.lateFee) },
    });
  }

  // ── One transaction, on the LOCKED note ─────────────────────────────
  // Everything that depends on where the note stands is read AFTER
  // `SELECT … FOR UPDATE` on the note row (DEFECT-0185): the installment due,
  // the credit already toward it, and the fees owed. Two concurrent,
  // different payments serialize on that lock, and the second reads — READ
  // COMMITTED, a fresh statement after the lock — the payment, the fee
  // collected and the due date the first committed. Reading owed before the
  // transaction let both collect the same fee (the floor at 0 hid it), and
  // advancing from the caller's snapshot let both "advance" to the same date.
  //
  // INSERT … ON CONFLICT (transaction_id) DO NOTHING RETURNING *: if the
  // conflict fires (returned []), the other writer already posted this
  // payment and we return its row without touching the note — no second
  // mutation, no error to the borrower, no second receipt. Every note query
  // carries the org: `noteId` is trusted from the caller, but the tenant
  // predicate is the invariant every read of `notes` in this repo carries.
  const posted = await withTransaction(async (tx) => {
    const [lockedNote] = await tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, note.id), eq(notes.organizationId, note.organizationId)))
      .for("update");
    if (!lockedNote) {
      // The note vanished between the caller's read and the lock. Throwing
      // posts nothing; Stripe will redeliver the webhook.
      throw new Error(`Note ${note.id} not found under organization ${note.organizationId} at posting time`);
    }
    // The locked row is the truth; the caller's snapshot only fills a field
    // the row did not carry.
    const current: Note = { ...note, ...lockedNote };
    const dueDate: Date | null = current.nextPaymentDate ? new Date(current.nextPaymentDate) : null;
    const scheduledCents =
      current.monthlyPayment != null ? decimalDollarsToCents(current.monthlyPayment) : null;

    // ── The ONE coverage rule (installmentCoverage.ts): the installments due
    // first, then fees owed from money beyond them, then principal; the due
    // date advances by the installments fully covered.
    const allocation = allocateServicedPayment({
      amountCents,
      scheduledCents,
      priorCreditCents: dueDate
        ? await creditedToInstallmentCents(note.organizationId, note.id, dueDate, tx)
        : 0,
      installmentsDue: countInstallmentsDue(current, now),
      outstandingFeeCents: await outstandingServicedLateFeesCents(note.organizationId, note.id, tx),
      payoffCents: splitPayoffCents(
        Math.max(0, decimalDollarsToCents(lockedNote.currentBalance)),
        percentStringToBps(current.interestRate),
      ),
    });
    const lateFeeCents = allocation.lateFeeCents;

    // ── Split — integer cents, exact decimal→cents conversion ───────────
    // What went to fees is not split into principal and interest.
    // `split.residueCents` is money the borrower sent beyond the payoff. It is
    // NOT invented into principal or interest, and it is not silently dropped
    // either (DEFECT-0098): the payment row keeps the full amount, and after
    // commit the lender gets an activity entry naming the unapplied excess,
    // the borrower's receipt says so, and the result carries it. Returning or
    // applying it is the lender's call — moving customer money is not ours.
    const lockedBalanceCents = decimalDollarsToCents(lockedNote.currentBalance);
    const split = splitPaymentCents({
      paymentAmountCents: amountCents - lateFeeCents,
      currentBalanceCents: Math.max(0, lockedBalanceCents),
      annualRateBps: percentStringToBps(current.interestRate),
    });

    const inserted = await tx
      .insert(payments)
      .values({
        organizationId: note.organizationId,
        noteId: note.id,
        amount: (amountCents / 100).toString(),
        principalAmount: (split.principalCents / 100).toString(),
        interestAmount: (split.interestCents / 100).toString(),
        feeAmount: "0",
        lateFeeAmount: (lateFeeCents / 100).toString(),
        paymentDate,
        // Posted against the installment that was next when it arrived.
        dueDate: dueDate ?? now,
        paymentMethod,
        transactionId,
        status: "completed",
      })
      .onConflictDoNothing({ target: payments.transactionId })
      .returning();

    if (inserted.length === 0) {
      // The row we collided with was written by the other writer for THIS
      // note, under this organization. Reading it back with the org
      // predicate means a transaction id that somehow exists under another
      // tenant is a loud error here, never another tenant's payment row
      // returned as this borrower's.
      const [existing] = await tx
        .select()
        .from(payments)
        .where(
          and(
            eq(payments.transactionId, transactionId),
            eq(payments.organizationId, note.organizationId),
          ),
        );
      if (!existing) {
        throw new Error(
          `payments.transaction_id ${transactionId} is already recorded outside organization ${note.organizationId} — refusing to post or read it`,
        );
      }
      return { created: false, row: existing } as const;
    }

    const [row] = inserted;
    // The balance the borrower is told, and the event carries, is the one
    // the LOCKED row produced — not the caller's pre-lock snapshot.
    const newBalanceCents = Math.max(0, lockedBalanceCents - split.principalCents);
    const updated = await tx
      .update(notes)
      .set({
        currentBalance: (newBalanceCents / 100).toString(),
        // Paid down to zero → paid off. Otherwise a DEFAULTED note stays
        // defaulted: a payment on it is money toward a cure, and whether the
        // loan is reinstated is the lender's decision — silently flipping it
        // to active re-armed autopay, reminders and the fee sweep (audit of
        // the fourth follow-up).
        status: newBalanceCents <= 0 ? "paid_off" : lockedNote.status === "defaulted" ? "defaulted" : "active",
        version: (lockedNote.version ?? 1) + 1,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(notes.id, note.id),
          eq(notes.organizationId, note.organizationId),
          eq(notes.version, lockedNote.version ?? 1),
        ),
      )
      .returning();
    if (updated.length === 0) {
      throw new Error(`Optimistic lock conflict on note ${note.id} — concurrent update detected`);
    }

    // ── Installments — advanced by what the money covered, in the SAME
    // transaction, from the locked row's due date. A partial (nothing fully
    // covered) leaves the installment pending and the due date put: a $50
    // payment against a $100 installment does not mean nothing is due.
    const schedule = current.amortizationSchedule || [];
    let installment: InstallmentOutcome;
    let nextPaymentDate: Date | null = dueDate;
    const notePatch: {
      amortizationSchedule?: typeof schedule;
      nextPaymentDate?: Date;
      pendingCheckoutSessionId?: null;
      pendingCheckoutOpenedAt?: null;
    } = {};
    const covered = allocation.installmentsCovered;
    if (covered <= 0) {
      installment = "partial";
      logger.info("borrower_portal_partial_payment_installment_left_pending", {
        metadata: { noteId: note.id, organizationId: note.organizationId, amountCents, scheduledCents, source },
      });
    } else {
      const pendingToMark = new Set(
        schedule.filter((s) => s.status === "pending").slice(0, covered).map((s) => s.paymentNumber),
      );
      if (pendingToMark.size > 0) {
        notePatch.amortizationSchedule = schedule.map((s) =>
          pendingToMark.has(s.paymentNumber) ? { ...s, status: "paid" } : s,
        );
        installment = "applied";
      } else {
        installment = "no_schedule_row";
      }
      nextPaymentDate = nextDueDateAfterCoverage(current, covered, now);
      if (nextPaymentDate) notePatch.nextPaymentDate = nextPaymentDate;
      if (covered > 1) {
        logger.info("serviced_note_payment_covered_several_installments", {
          metadata: { noteId: note.id, organizationId: note.organizationId, installmentsCovered: covered, source },
        });
      }
    }
    // Clear the pending-checkout slot only if it still names THIS session —
    // read from the LOCKED row: the caller's copy can predate a newer session
    // that is still open, and clearing that pointer would lift the autopay
    // hold while the borrower can still pay it (W10.5 audit).
    if (lockedNote.pendingCheckoutSessionId === transactionId) {
      notePatch.pendingCheckoutSessionId = null;
      notePatch.pendingCheckoutOpenedAt = null;
    }
    if (Object.keys(notePatch).length > 0) {
      await storage.updateNote(note.id, notePatch, note.organizationId, tx);
    }

    return {
      created: true,
      row,
      remainingBalanceCents: newBalanceCents,
      split,
      lateFeeCents,
      scheduledCents,
      installment,
      nextPaymentDate,
      installmentsCovered: covered,
      dueDate,
    } as const;
  });

  if (!posted.created) {
    return { outcome: "already_recorded", payment: posted.row };
  }

  const payment = posted.row;
  const { remainingBalanceCents, split, lateFeeCents, scheduledCents, installment, nextPaymentDate } = posted;

  // ── Post-commit effects — exactly once, on the winning writer ───────
  emitBorrowerPaymentReceived({
    organizationId: note.organizationId,
    noteId: note.id,
    paymentId: payment.id,
    amountCents,
    principalCents: split.principalCents,
    interestCents: split.interestCents,
    lateFeeCents,
    scheduledPaymentCents: scheduledCents,
    // The locked row's stored due date (the installment this payment was
    // posted against), NOT the `?? now` fallback on the row — a missing due
    // date stays null in the event.
    dueDate: posted.dueDate,
    paymentDate,
    remainingBalanceCents,
    paymentMethod,
    source,
  });

  if (split.residueCents > 0) {
    const excess = (split.residueCents / 100).toFixed(2);
    logger.warn("borrower_payment_unapplied_overpayment", {
      metadata: {
        organizationId: note.organizationId,
        noteId: note.id,
        paymentId: payment.id,
        transactionId,
        unappliedCents: split.residueCents,
        source,
      },
    });
    try {
      await storage.logActivity({
        organizationId: note.organizationId,
        action: "borrower_payment_unapplied_overpayment",
        entityType: "note",
        entityId: note.id,
        description:
          `Borrower payment ${transactionId} exceeded the payoff by $${excess}. ` +
          `The excess is included in the recorded payment amount but was not applied to the note — refund it or apply it by hand.`,
      });
    } catch (err) {
      logger.error(
        "borrower_payment_unapplied_overpayment_not_logged",
        err instanceof Error ? err : undefined,
        { metadata: { organizationId: note.organizationId, noteId: note.id, unappliedCents: split.residueCents } },
      );
    }
  }

  // Activation telemetry. First borrower payment received. Idempotent
  // FIRST-occurrence on (org, eventName).
  try {
    const { recordActivationEventAsync } = await import("../activation");
    recordActivationEventAsync({
      orgId: note.organizationId,
      userId: null,
      eventName: "first_borrower_payment_received",
      eventValue: { paymentId: payment.id, noteId: note.id, amount: amountCents / 100 },
    });
  } catch {
    /* non-fatal */
  }

  const receiptEmailed = input.sendReceipt && await sendBorrowerPaymentReceipt(note, {
    amountCents,
    remainingBalanceCents,
    nextPaymentDate,
    installment,
    paymentDate,
    unappliedCents: split.residueCents,
  });

  return {
    outcome: "posted",
    payment,
    amountCents,
    principalCents: split.principalCents,
    interestCents: split.interestCents,
    lateFeeCents,
    remainingBalanceCents,
    unappliedCents: split.residueCents,
    installment,
    installmentsCovered: posted.installmentsCovered,
    nextPaymentDate,
    receiptEmailed,
  };
}

// ─────────────────────────────────────────────────────────────────────
// Receipt
// ─────────────────────────────────────────────────────────────────────

/**
 * Send the borrower one receipt for a payment that is ALREADY posted.
 *
 * WHO COLLECTED IT. The charge is a direct charge on the lender's own
 * connected processor (founder ruling 2026-07-29, "be the rail, not the
 * provider") — AcreOS never held this money and took no cut of it. The
 * receipt says so, and names the lender when the org has a name on file; it
 * degrades to "your lender" rather than inventing one.
 *
 * COUNTERPARTY lane (founder decision 2026-07-17): the lender org owns this
 * message — their borrower, their charge, their identity. No connected
 * identity → honest refusal from emailService, no platform fallback.
 *
 * Never throws; a mail failure must not roll back or re-post the payment.
 */
async function sendBorrowerPaymentReceipt(
  note: Note,
  posted: {
    amountCents: number;
    remainingBalanceCents: number;
    nextPaymentDate: Date | null;
    installment: InstallmentOutcome;
    paymentDate: Date;
    unappliedCents: number;
  },
): Promise<boolean> {
  try {
    const borrower = note.borrowerId
      ? await storage.getBorrowerLead(note.organizationId, note.borrowerId)
      : null;
    const borrowerEmail = borrower?.email;
    if (!borrowerEmail) return false;

    const { emailService } = await import("../emailService");
    const lenderOrg = await storage.getOrganization(note.organizationId);
    const collector = lenderOrg?.name?.trim() || "your lender";
    const amount = (posted.amountCents / 100).toFixed(2);
    const remaining = (posted.remainingBalanceCents / 100).toFixed(2);
    const paidOff = posted.remainingBalanceCents <= 0;
    const nextDue = paidOff
      ? "Paid in full!"
      : posted.nextPaymentDate
        ? posted.nextPaymentDate.toLocaleDateString()
        : "See your loan details";
    const partialLine =
      posted.installment === "partial"
        ? "This was a partial payment. Your current installment remains open and its due date has not changed."
        : null;
    const unappliedLine =
      posted.unappliedCents > 0
        ? `Your payment was $${(posted.unappliedCents / 100).toFixed(2)} more than the remaining payoff. That amount was not applied to your loan — ${collector} will return it or contact you about it.`
        : null;
    const custodyLine = `This payment was collected by ${collector}. AcreOS is the software your lender uses — it doesn't hold your payment or take a share of it.`;

    const result = await emailService.sendEmail({
      organizationId: note.organizationId,
      purpose: "counterparty",
      to: borrowerEmail,
      subject: `Payment Receipt — $${amount}`,
      html: `
        <h2>Payment Receipt</h2>
        <p>Thank you for your payment.</p>
        <ul>
          <li><strong>Amount Paid:</strong> $${amount}</li>
          <li><strong>Paid To:</strong> ${collector}</li>
          <li><strong>Payment Date:</strong> ${posted.paymentDate.toLocaleDateString()}</li>
          <li><strong>Remaining Balance:</strong> $${remaining}</li>
          <li><strong>Next Payment Due:</strong> ${nextDue}</li>
        </ul>
        ${partialLine ? `<p>${partialLine}</p>` : ""}
        ${unappliedLine ? `<p>${unappliedLine}</p>` : ""}
        <p>${custodyLine}</p>
        <p>If you have questions about your account, please contact your lender.</p>
      `,
      text: [
        "Payment Receipt",
        "",
        `Amount Paid: $${amount}`,
        `Paid To: ${collector}`,
        `Payment Date: ${posted.paymentDate.toLocaleDateString()}`,
        `Remaining Balance: $${remaining}`,
        `Next Payment Due: ${nextDue}`,
        ...(partialLine ? ["", partialLine] : []),
        ...(unappliedLine ? ["", unappliedLine] : []),
        "",
        custodyLine,
      ].join("\n"),
    });

    if (result.success) {
      logger.info("borrower_payment_receipt_sent", {
        metadata: { organizationId: note.organizationId, noteId: note.id },
      });
      return true;
    }
    // sendEmail RETURNS a refusal (it does not throw). Log what actually
    // happened — the payment is recorded and must not be rolled back for it.
    logger.warn("borrower_payment_receipt_not_sent", {
      metadata: {
        organizationId: note.organizationId,
        noteId: note.id,
        errorType: result.errorType,
        error: result.error,
      },
    });
    return false;
  } catch (err) {
    logger.warn("borrower_payment_receipt_failed", {
      metadata: {
        organizationId: note.organizationId,
        noteId: note.id,
        error: err instanceof Error ? err.message : String(err),
      },
    });
    return false;
  }
}
