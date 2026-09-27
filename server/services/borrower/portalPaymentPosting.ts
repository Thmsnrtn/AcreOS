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
import { addMonths } from "../../utils/dateUtils";
import { emitPaymentEvent } from "../workflow-engine";
import {
  splitPaymentCents,
  computeAppliedLateFeeCents,
  decimalDollarsToCents,
  percentStringToBps,
} from "../notePaymentMath";

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

export type PortalPaymentSource = "borrower_portal" | "stripe_webhook";

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
 *  - `applied`         — the amount covered the scheduled payment; the next
 *                        pending schedule row is `paid` and the due date moved
 *                        one month.
 *  - `partial`         — the amount was LESS than `notes.monthly_payment`. The
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
      installment: InstallmentOutcome;
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

  // ── Split — integer cents, exact decimal→cents conversion ───────────
  // `decimalDollarsToCents` / `percentStringToBps` replace the earlier
  // `Math.round(Number(x) * 100)`: identical for two-decimal balances and
  // whole-bp rates, exact (rather than float-rounded) for anything finer.
  const currentBalanceCents = decimalDollarsToCents(note.currentBalance);
  const annualRateBps = percentStringToBps(note.interestRate);
  const split = splitPaymentCents({
    paymentAmountCents: amountCents,
    currentBalanceCents,
    annualRateBps,
  });
  // `split.residueCents` (an overpayment beyond the payoff) is NOT persisted
  // here — the servicing book has no unapplied-funds column. Recorded as an
  // open defect rather than invented into principal or interest.

  // ── Late fee ────────────────────────────────────────────────────────
  // THIS ASSESSES A FEE AGAINST A BORROWER. When the record states no grace
  // period there is no late fee to apply: an invented term is money taken
  // under a clause the note does not contain (see routes-documents.ts:23 for
  // the same refusal on the generated instrument).
  const paymentDate = now;
  const dueDate = note.nextPaymentDate ?? now;
  const configuredLateFeeCents = decimalDollarsToCents(note.lateFee);
  const statedGrace = noteGracePeriodDays(note.gracePeriodDays);
  const lateFeeCents =
    statedGrace === null
      ? 0
      : computeAppliedLateFeeCents({
          dueDate,
          paymentDate,
          gracePeriodDays: statedGrace,
          configuredLateFeeCents,
        });
  if (statedGrace === null && configuredLateFeeCents > 0) {
    logger.info("note_late_fee_skipped_grace_unstated", {
      metadata: { noteId: note.id, organizationId: note.organizationId, configuredLateFeeCents },
    });
  }

  // ── Idempotent write ────────────────────────────────────────────────
  // INSERT … ON CONFLICT (transaction_id) DO NOTHING RETURNING * inside one
  // transaction. If the conflict fires (returned []), the other writer
  // already posted this session and we return its row without touching the
  // balance — no second mutation, no error to the borrower, no second
  // receipt. Both note queries carry the org: `noteId` is trusted from the
  // caller, but the tenant predicate is the invariant every read of `notes`
  // in this repo carries.
  const idempotentResult = await withTransaction(async (tx) => {
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
        dueDate,
        paymentMethod: "card",
        transactionId: stripeSession.id,
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
            eq(payments.transactionId, stripeSession.id),
            eq(payments.organizationId, note.organizationId),
          ),
        );
      if (!existing) {
        throw new Error(
          `payments.transaction_id ${stripeSession.id} is already recorded outside organization ${note.organizationId} — refusing to post or read it`,
        );
      }
      return { row: existing, created: false } as const;
    }

    const [row] = inserted;

    const [lockedNote] = await tx
      .select()
      .from(notes)
      .where(and(eq(notes.id, note.id), eq(notes.organizationId, note.organizationId)))
      .for("update");
    if (!lockedNote) {
      // The note vanished between the caller's read and the lock. Committing
      // the payment row with no balance movement would be a ledger that
      // disagrees with itself; throwing rolls the row back and Stripe will
      // redeliver the webhook.
      throw new Error(`Note ${note.id} not found under organization ${note.organizationId} at posting time`);
    }
    // The balance the borrower is told, and the event carries, is the one
    // the LOCKED row produced — not the caller's pre-lock snapshot, which a
    // concurrent posting may have moved.
    const newBalanceCents = Math.max(
      0,
      decimalDollarsToCents(lockedNote.currentBalance) - split.principalCents,
    );
    const updated = await tx
      .update(notes)
      .set({
        currentBalance: (newBalanceCents / 100).toString(),
        status: newBalanceCents <= 0 ? "paid_off" : "active",
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

    return { row, created: true, remainingBalanceCents: newBalanceCents } as const;
  });

  if (!idempotentResult.created) {
    return { outcome: "already_recorded", payment: idempotentResult.row };
  }

  const payment = idempotentResult.row;
  const remainingBalanceCents = idempotentResult.remainingBalanceCents;

  // ── Installment rule ────────────────────────────────────────────────
  // `notes.monthly_payment` is NOT NULL in the schema; the null branch exists
  // for fixtures and legacy rows and applies the pre-existing behaviour
  // (the event's `isPartial` is null there — no verdict is invented).
  const scheduledCents =
    note.monthlyPayment != null ? decimalDollarsToCents(note.monthlyPayment) : null;
  const isPartial = scheduledCents !== null && amountCents < scheduledCents;

  const schedule = note.amortizationSchedule || [];
  const nextPendingPayment = schedule.find((s) => s.status === "pending");

  let installment: InstallmentOutcome;
  let nextPaymentDate: Date | null = note.nextPaymentDate ?? null;
  const notePatch: {
    amortizationSchedule?: typeof schedule;
    nextPaymentDate?: Date;
    pendingCheckoutSessionId?: null;
  } = {};

  if (isPartial) {
    installment = "partial";
    logger.info("borrower_portal_partial_payment_installment_left_pending", {
      metadata: {
        noteId: note.id,
        organizationId: note.organizationId,
        amountCents,
        scheduledCents,
        source,
      },
    });
  } else {
    if (nextPendingPayment) {
      notePatch.amortizationSchedule = schedule.map((s) =>
        s.paymentNumber === nextPendingPayment.paymentNumber ? { ...s, status: "paid" } : s,
      );
      installment = "applied";
    } else {
      installment = "no_schedule_row";
    }
    nextPaymentDate = addMonths(new Date(note.nextPaymentDate || now), 1);
    notePatch.nextPaymentDate = nextPaymentDate;
  }

  // Clear the pending-checkout slot only if it still names THIS session.
  // Clearing unconditionally would wipe the pointer to a newer session that
  // is still open (the one-slot confusion in the other direction).
  if (note.pendingCheckoutSessionId === stripeSession.id) {
    notePatch.pendingCheckoutSessionId = null;
  }

  // Non-financial fields, safe outside the payment transaction. Skipped when
  // there is nothing to write (a partial payment with no slot to clear).
  if (Object.keys(notePatch).length > 0) {
    await storage.updateNote(note.id, notePatch, note.organizationId);
  }

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
    // The stored schedule date, NOT the `?? now` fallback used for the
    // late-fee math — a missing due date stays null in the event.
    dueDate: note.nextPaymentDate ?? null,
    paymentDate,
    remainingBalanceCents,
    paymentMethod: "card",
    source,
  });

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

  const receiptEmailed = await sendBorrowerPaymentReceipt(note, {
    amountCents,
    remainingBalanceCents,
    nextPaymentDate,
    installment,
    paymentDate,
  });

  return {
    outcome: "posted",
    payment,
    amountCents,
    principalCents: split.principalCents,
    interestCents: split.interestCents,
    lateFeeCents,
    remainingBalanceCents,
    installment,
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
  },
): Promise<boolean> {
  try {
    const borrower = note.borrowerId
      ? await storage.getLead(note.organizationId, note.borrowerId)
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
