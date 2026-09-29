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
import { and, asc, eq, gte, inArray, isNull, lt, lte, sql } from "drizzle-orm";
import { lateFeeAssessments } from "@shared/schema/reg-z";
import { achDebitAttempts } from "@shared/schema/ach-autopay";
import { notes, payments, type Note } from "@shared/schema";
import { noteGracePeriodDays } from "@shared/notes/delinquency";
import { db } from "../../db";
import { logger } from "../../utils/logger";
import { shouldAssessLateFee } from "../lateFees";
import { decimalDollarsToCents } from "../notePaymentMath";
import { addMonths } from "../../utils/dateUtils";
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { lenderServicingPhase, orgsStillServiced } from "../borrower/servicingPhase";

const DAY_MS = 24 * 60 * 60 * 1000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);
const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** An autopay debit that is still settling has not missed anything. */
const ACH_IN_FLIGHT = ["created", "submitted", "processing"];
/** Notes the daily sweep evaluates: servicing, not accelerated or closed. */
const SWEPT_NOTE_STATUSES = ["active", "late", "delinquent"];
const SWEEP_LIMIT = 5000;

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

type InstallmentVerdict =
  | { kind: "none"; reason: string }
  | { kind: "fee"; dueDate: Date; feeCents: number; justification: string };

/**
 * Would the note's CURRENT installment (its next payment date) carry a fee as
 * of `at`? Grace passed, not paid in full, and no autopay debit initiated
 * within grace still settling. Reads only; never writes.
 */
async function evaluateCurrentInstallment(note: ServicedNoteForFees, at: Date): Promise<InstallmentVerdict> {
  const grace = noteGracePeriodDays(note.gracePeriodDays);
  const configuredLateFeeCents = decimalDollarsToCents(note.lateFee);
  if (grace === null) return { kind: "none", reason: "note states no grace period" };
  if (configuredLateFeeCents <= 0) return { kind: "none", reason: "note has no late fee" };
  if (!note.nextPaymentDate) return { kind: "none", reason: "note has no installment due" };
  const dueDate = new Date(note.nextPaymentDate);
  const dayStart = utcDayStart(dueDate);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

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
        gte(payments.dueDate, dayStart),
        lt(payments.dueDate, dayEnd),
      ),
    );

  const decision = shouldAssessLateFee({
    periodStart: dueDate,
    periodEnd: addMonths(dueDate, 1),
    dueDate,
    gracePeriodDays: grace,
    periodicPaymentAmountCents: decimalDollarsToCents(note.monthlyPayment),
    amountCreditedToCycleCents: Number(credited?.cents ?? 0),
    evaluationDate: at,
    configuredLateFeeCents,
  });
  if (!decision.shouldAssess) return { kind: "none", reason: decision.justification };

  // An autopay debit initiated within grace that has not settled yet is the
  // borrower paying on time through a rail that takes days — not a miss.
  const graceEnds = new Date(dayStart.getTime() + (grace + 1) * DAY_MS);
  const [inFlight] = await db
    .select({ id: achDebitAttempts.id })
    .from(achDebitAttempts)
    .where(
      and(
        eq(achDebitAttempts.organizationId, note.organizationId),
        eq(achDebitAttempts.noteId, note.id),
        gte(achDebitAttempts.dueDate, dayStart),
        lt(achDebitAttempts.dueDate, dayEnd),
        inArray(achDebitAttempts.status, ACH_IN_FLIGHT),
        lte(achDebitAttempts.createdAt, graceEnds),
      ),
    )
    .limit(1);
  if (inFlight) return { kind: "none", reason: "autopay debit initiated within grace is still settling" };

  return { kind: "fee", dueDate, feeCents: decision.feeAmountCents, justification: decision.justification };
}

/**
 * Assess the fee for the note's CURRENT installment (its next payment date)
 * if grace has passed and the installment is not paid in full. Idempotent.
 * Nothing is assessed once the lender's servicing wind-down is over — a
 * payoff quote opened after that must not create a fee (ruling #3).
 */
export async function assessServicedNoteLateFee(
  note: ServicedNoteForFees,
  now: Date = new Date(),
  paymentId: string | null = null,
  servicingKnownActive = false,
): Promise<AssessmentOutcome> {
  if (!servicingKnownActive && (await lenderServicingPhase(note.organizationId, now)).phase === "ended") {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: "lender servicing has ended" };
  }
  const verdict = await evaluateCurrentInstallment(note, now);
  if (verdict.kind === "none") {
    return { assessed: false, alreadyExisted: false, feeCents: 0, reason: verdict.reason };
  }
  const { dueDate } = verdict;

  const inserted = await db
    .insert(lateFeeAssessments)
    .values({
      organizationId: note.organizationId,
      loanId: String(note.id),
      loanType: "note",
      periodStart: isoDay(dueDate),
      periodEnd: isoDay(addMonths(dueDate, 1)),
      paymentId,
      feeAmountCents: verdict.feeCents,
      justification: verdict.justification,
      status: "assessed",
    })
    .onConflictDoNothing()
    .returning({ id: lateFeeAssessments.id });
  if (inserted.length > 0) {
    logger.info("[servicedLateFees] fee assessed", {
      organizationId: note.organizationId,
      noteId: note.id,
      periodStart: isoDay(dueDate),
      feeCents: verdict.feeCents,
    });
  }
  return {
    assessed: inserted.length > 0,
    alreadyExisted: inserted.length === 0,
    feeCents: verdict.feeCents,
    reason: verdict.justification,
  };
}

/**
 * The fee the CURRENT installment will carry by `asOf` that is not recorded
 * yet — for a payoff quote good through a later date. 0 when none is due by
 * then, or when it is already assessed (it is in what is owed).
 */
export async function lateFeeDueByCents(note: ServicedNoteForFees, asOf: Date): Promise<number> {
  if ((await lenderServicingPhase(note.organizationId, asOf)).phase === "ended") return 0;
  const verdict = await evaluateCurrentInstallment(note, asOf);
  if (verdict.kind === "none") return 0;
  const [existing] = await db
    .select({ id: lateFeeAssessments.id })
    .from(lateFeeAssessments)
    .where(
      and(
        eq(lateFeeAssessments.organizationId, note.organizationId),
        eq(lateFeeAssessments.loanType, "note"),
        eq(lateFeeAssessments.loanId, String(note.id)),
        eq(lateFeeAssessments.periodStart, isoDay(verdict.dueDate)),
      ),
    )
    .limit(1);
  return existing ? 0 : verdict.feeCents;
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
  const rows = await db
    .select({
      amount: payments.amount,
      principalAmount: payments.principalAmount,
      interestAmount: payments.interestAmount,
      feeAmount: payments.feeAmount,
      lateFeeAmount: payments.lateFeeAmount,
    })
    .from(payments)
    .where(and(eq(payments.organizationId, organizationId), eq(payments.noteId, noteId), eq(payments.status, "completed")));
  const collectedCents = rows.reduce(
    (sum, r) => sum + (lateFeeWasCarvedFromPayment(r) ? decimalDollarsToCents(r.lateFeeAmount) : 0),
    0,
  );
  return Math.max(0, Number(assessed?.cents ?? 0) - collectedCents);
}

/**
 * Did this payment row actually PAY its late fee? Only when the fee was
 * carved out of the amount: its parts sum to the amount (a refund reversal
 * carries the negative of every part, so a refunded fee is owed again).
 * Before this ledger, posting wrote a day-count fee ON TOP of a payment whose
 * whole amount went to principal and interest — parts summing to MORE than
 * the amount, and their reversals likewise. Counting those would let a fee no
 * money paid cancel a fee now genuinely owed. Pro-rata reversal shares round
 * per part, hence the 5-cent tolerance.
 */
function lateFeeWasCarvedFromPayment(row: {
  amount: string | number | null;
  principalAmount: string | number | null;
  interestAmount: string | number | null;
  feeAmount: string | number | null;
  lateFeeAmount: string | number | null;
}): boolean {
  const c = decimalDollarsToCents;
  const parts = c(row.principalAmount) + c(row.interestAmount) + c(row.feeAmount) + c(row.lateFeeAmount);
  return Math.abs(parts) <= Math.abs(c(row.amount)) + 5;
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
 * The daily pass: every serviced note (active, late or delinquent — not
 * defaulted, whose installments acceleration ended) whose installment is past
 * due is evaluated, and a fee is recorded where grace has passed on an unpaid
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
    .where(and(inArray(notes.status, SWEPT_NOTE_STATUSES), isNull(notes.deletedAt), lt(notes.nextPaymentDate, now)))
    .orderBy(asc(notes.nextPaymentDate))
    .limit(SWEEP_LIMIT);
  if (due.length === SWEEP_LIMIT) {
    logger.warn("[servicedLateFees] sweep hit its per-run limit; the oldest installments were evaluated first", {
      limit: SWEEP_LIMIT,
    });
  }
  for (const note of due) {
    if (!serviced.has(note.organizationId)) continue;
    result.scanned++;
    try {
      const r = await assessServicedNoteLateFee(note, now, null, true);
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
