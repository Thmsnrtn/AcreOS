/**
 * Late fees on SERVICED notes (the `notes` book) — assessed, owed, collected
 * (founder ruling 2026-09-29 #6, DEFECT-0099).
 *
 * Before this there was no record of a fee OWED. Each posting path computed a
 * fee from days late at payment time and wrote it to
 * `payments.late_fee_amount` as COLLECTED — while every cent of the payment
 * went to principal and interest (`splitPaymentCents` splits the whole
 * amount). The ledger said fees were collected that no money paid; payoff
 * quotes and statements had to say "late fees are not tracked".
 *
 * Now:
 *  - ASSESSED: a fee is recorded in `late_fee_assessments` (loan_type 'note')
 *    when grace passes on a missed installment — by the daily assessment job,
 *    or by a posting that arrives after grace, whichever sees it first. One
 *    row per installment (the table's unique key), decided by the existing
 *    §1026.36(c)(2) non-pyramiding rule `shouldAssessLateFee`: an installment
 *    paid in full within grace never carries a fee, whatever came before.
 *  - COLLECTED: `payments.late_fee_amount` is what a payment actually paid
 *    toward fees. A payment first covers the scheduled installment; only the
 *    part ABOVE the installment pays outstanding fees (`feeFromExcessCents`),
 *    and the rest reduces principal. A payment is never short an installment
 *    because a fee took part of it — that is pyramiding.
 *  - OWED: assessed (status 'assessed') minus collected. Payoff quotes and
 *    periodic statements include it.
 *
 * When the note states no grace period there is no fee (an invented term is
 * money taken under a clause the note does not contain), and when the
 * lender's servicing wind-down is over AcreOS assesses nothing (ruling #3).
 */
import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { lateFeeAssessments } from "@shared/schema/reg-z";
import { notes, payments, type Note } from "@shared/schema";
import { noteGracePeriodDays } from "@shared/notes/delinquency";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { shouldAssessLateFee } from "../lateFees";
import { decimalDollarsToCents } from "../notePaymentMath";
import { addMonths } from "../../utils/dateUtils";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { orgsStillServiced } from "../borrower/servicingPhase";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

export type ServicedNoteForFees = Pick<
  Note,
  "id" | "organizationId" | "nextPaymentDate" | "gracePeriodDays" | "lateFee" | "monthlyPayment"
>;

export interface AssessmentOutcome {
  assessed: boolean;
  alreadyExisted: boolean;
  feeCents: number;
  reason: string;
}

/**
 * Assess the fee for the note's CURRENT installment (its next payment date)
 * if grace has passed and the installment is not paid in full. Idempotent.
 */
export async function assessServicedNoteLateFee(
  note: ServicedNoteForFees,
  now: Date = new Date(),
  paymentId: string | null = null,
): Promise<AssessmentOutcome> {
  const grace = noteGracePeriodDays(note.gracePeriodDays);
  const configuredLateFeeCents = decimalDollarsToCents(note.lateFee);
  if (grace === null) {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "note states no grace period" };
  }
  if (configuredLateFeeCents <= 0) {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "note has no late fee" };
  }
  if (!note.nextPaymentDate) {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "note has no installment due" };
  }
  const dueDate = new Date(note.nextPaymentDate);

  // What was paid toward THIS installment: completed payments posted against
  // this due date (reversals carry negative amounts and net out).
  const [credited] = await db
    .select({ cents: sql<string>`COALESCE(SUM(ROUND(${payments.amount} * 100)), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, note.organizationId),
        eq(payments.noteId, note.id),
        eq(payments.status, "completed"),
        gte(payments.dueDate, new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()))),
        lt(payments.dueDate, new Date(Date.UTC(dueDate.getUTCFullYear(), dueDate.getUTCMonth(), dueDate.getUTCDate()) + DAY_MS)),
      ),
    );
  const creditedCents = Number(credited?.cents ?? 0);

  const decision = shouldAssessLateFee({
    periodStart: dueDate,
    periodEnd: addMonths(dueDate, 1),
    dueDate,
    gracePeriodDays: grace,
    periodicPaymentAmountCents: decimalDollarsToCents(note.monthlyPayment),
    amountCreditedToCycleCents: creditedCents,
    evaluationDate: now,
    configuredLateFeeCents,
  });
  if (!decision.shouldAssess) {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: decision.justification };
  }

  const inserted = await db
    .insert(lateFeeAssessments)
    .values({
      organizationId: note.organizationId,
      loanId: String(note.id),
      loanType: "note",
      periodStart: isoDay(dueDate),
      periodEnd: isoDay(addMonths(dueDate, 1)),
      paymentId,
      feeAmountCents: decision.feeAmountCents,
      justification: decision.justification,
      status: "assessed",
    })
    .onConflictDoNothing()
    .returning({ id: lateFeeAssessments.id });
  if (inserted.length > 0) {
    logger.info("[servicedLateFees] fee assessed", {
      organizationId: note.organizationId,
      noteId: note.id,
      periodStart: isoDay(dueDate),
      feeCents: decision.feeAmountCents,
    });
  }
  return {
    assessed: inserted.length > 0,
    alreadyExisted: inserted.length === 0,
    feeCents: decision.feeAmountCents,
    reason: decision.justification,
  };
}

/** Late fees the borrower owes on this note: assessed minus collected, never negative. */
export async function outstandingServicedLateFeesCents(organizationId: number, noteId: number): Promise<number> {
  const [assessed] = await db
    .select({ cents: sql<string>`COALESCE(SUM(${lateFeeAssessments.feeAmountCents}), 0)` })
    .from(lateFeeAssessments)
    .where(
      and(
        eq(lateFeeAssessments.organizationId, organizationId),
        eq(lateFeeAssessments.loanType, "note"),
        eq(lateFeeAssessments.loanId, String(noteId)),
        eq(lateFeeAssessments.status, "assessed"),
      ),
    );
  // Every row counts: a refund reversal carries the NEGATIVE of what it
  // reverses, so a refunded fee payment is owed again.
  const [collected] = await db
    .select({ cents: sql<string>`COALESCE(SUM(ROUND(COALESCE(${payments.lateFeeAmount}, 0) * 100)), 0)` })
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.noteId, noteId), eq(payments.status, "completed")));
  return Math.max(0, Number(assessed?.cents ?? 0) - Number(collected?.cents ?? 0));
}

/**
 * How much of a payment goes to outstanding late fees: only what is ABOVE the
 * scheduled installment, and never more than is owed. The installment is
 * covered first, so no payment is made short by a fee (§1026.36(c)(2)).
 */
export function feeFromExcessCents(input: {
  amountCents: number;
  scheduledCents: number | null;
  outstandingFeeCents: number;
}): number {
  if (input.scheduledCents === null || input.outstandingFeeCents <= 0) return 0;
  const excess = input.amountCents - input.scheduledCents;
  return excess > 0 ? Math.min(excess, input.outstandingFeeCents) : 0;
}

export interface LateFeePassResult {
  scanned: number;
  assessed: number;
  alreadyAssessed: number;
  errors: number;
}

/**
 * The daily pass: every active serviced note whose installment is past due is
 * evaluated, and a fee is recorded where grace has passed on an unpaid
 * installment. Lenders whose 90-day servicing wind-down is over are skipped —
 * AcreOS no longer services their loans (ruling #3).
 */
export async function runServicedLateFeeAssessmentPass(now: Date = new Date()): Promise<LateFeePassResult> {
  const result: LateFeePassResult = { scanned: 0, assessed: 0, alreadyAssessed: 0, errors: 0 };
  const serviced = new Set(await orgsStillServiced(now));
  // PLATFORM SWEEP, said out loud: a scheduled job reads every
  // organization's active notes and writes each fee under that note's org.
  const due = await unscopedForPlatformOps(
    "serviced late-fee assessment daily sweep: a scheduled platform job that evaluates every organization's past-due notes and records each fee under the note's own org",
  )
    .select({
      id: notes.id,
      organizationId: notes.organizationId,
      nextPaymentDate: notes.nextPaymentDate,
      gracePeriodDays: notes.gracePeriodDays,
      lateFee: notes.lateFee,
      monthlyPayment: notes.monthlyPayment,
    })
    .from(notes)
    .where(and(eq(notes.status, "active"), isNull(notes.deletedAt), lt(notes.nextPaymentDate, now)));
  for (const note of due) {
    if (!serviced.has(note.organizationId)) continue;
    result.scanned++;
    try {
      const r = await assessServicedNoteLateFee(note, now);
      if (r.assessed) result.assessed++;
      else if (r.alreadyExisted) result.alreadyAssessed++;
    } catch (err) {
      result.errors++;
      logger.error("[servicedLateFees] assessment failed", err instanceof Error ? err : undefined, {
        organizationId: note.organizationId,
        noteId: note.id,
      });
    }
  }
  return result;
}
