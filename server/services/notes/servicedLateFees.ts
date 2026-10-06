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
 *
 * EVERY missed installment (DEFECT-0185, W10.5). Batch F evaluated only the
 * installment at `next_payment_date`, so a borrower three behind carried one
 * fee. An evaluation now walks the installments from `next_payment_date` on,
 * by the note's own schedule (`installmentCoverage.ts`: first payment date +
 * term, calendar months), assessing each one grace has passed on that is not
 * paid in full — at most MAX_ASSESSMENTS_PER_RUN new ones per run, the rest
 * reported and picked up by the next run (already-assessed installments are
 * skipped, so the walk always progresses). One installment is one calendar
 * month: an assessment already recorded in that month, under any day, is that
 * installment's fee — never a second. When the schedule cannot be determined
 * (the stored date is off the note's schedule, no first date or term), only
 * the installment the note does state is evaluated, and the outcome says why.
 * The walk is sound only while posting writers advance `next_payment_date`
 * by the installments they cover: `postServicedNotePayment` (portal card,
 * webhook, Payment Links, the finance page's manual record — DEFECT-0253)
 * applies the shared coverage rule; ACH settlement advances one installment
 * per debit (one installment is what it debits).
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
import { unscopedForPlatformOps } from "../../utils/orgScopedDb";
import { lenderServicingPhase, orgsStillServiced } from "../borrower/servicingPhase";
import {
  MAX_ASSESSMENTS_PER_RUN,
  addMonthsUtc,
  daysPastDue,
  isoDay,
  resolveInstallmentSchedule,
  utcMonthWindow,
} from "./installmentCoverage";

const DAY_MS = 24 * 60 * 60 * 1000;
const utcDayStart = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/**
 * The connection a read runs on: the module's `db`, or the posting's
 * transaction — so what is owed is read under the note's row lock.
 */
type Executor = Pick<typeof db, "select">;
/**
 * An autopay debit that is still settling has not missed anything — and
 * while one is, the processor is paying the installment, so nobody may record
 * it again by hand (DEFECT-0265). The one list: the ACH reconciliation sweep
 * and POST /api/payments read it from here.
 */
export const ACH_IN_FLIGHT_STATUSES: string[] = ["created", "submitted", "processing"];
/** Notes the daily sweep evaluates: servicing, not accelerated or closed. */
const SWEPT_NOTE_STATUSES = ["active", "late", "delinquent"];
/**
 * The sweep's status rule at every caller: an accelerated (defaulted),
 * paid-off or foreclosed note accrues no monthly late fee. A caller that does
 * not know the status is not second-guessed.
 */
const statusAccruesFees = (status: string | null | undefined) =>
  status == null || SWEPT_NOTE_STATUSES.includes(status);
const SWEEP_LIMIT = 5000;

export type ServicedNoteForFees = Pick<
  Note,
  "id" | "organizationId" | "nextPaymentDate" | "gracePeriodDays" | "lateFee" | "monthlyPayment"
> &
  // The note's schedule. Without them only the installment at
  // `nextPaymentDate` is evaluated (the ACH settlement passes the debit's own
  // due date and nothing else).
  Partial<Pick<Note, "firstPaymentDate" | "termMonths" | "createdAt">>;

export interface AssessmentOutcome {
  /** At least one installment's fee was newly recorded. */
  assessed: boolean;
  /** Nothing new was recorded, and at least one past-grace installment already carried its fee. */
  alreadyExisted: boolean;
  /** Cents newly assessed by this evaluation. */
  feeCents: number;
  reason: string;
  /** Installments whose fee this evaluation recorded. */
  installmentsAssessed: number;
  /** Past-grace installments that already carried their fee. */
  installmentsAlreadyAssessed: number;
  /** Past-grace installments NOT evaluated because the run hit its cap — the next run takes them. */
  deferredInstallments: number;
  /** How far the evaluation walked: the note's schedule, or only the installment it states. */
  walk: "schedule" | "current_only";
  /** Why the walk stopped at the current installment, when it did. */
  walkRefusedReason?: string;
}

type InstallmentVerdict =
  | { kind: "none"; reason: string }
  | { kind: "fee"; dueDate: Date; feeCents: number; justification: string };

/**
 * Completed money credited toward the installment due in `dueDate`'s month:
 * payments posted against it (reversals carry negative amounts and net out).
 * A payment is posted against the installment that was next when it arrived,
 * and every installment has its own calendar month.
 */
export async function creditedToInstallmentCents(
  organizationId: number,
  noteId: number,
  dueDate: Date,
  executor: Executor = db,
): Promise<number> {
  const { start, end } = utcMonthWindow(dueDate);
  const [credited] = await executor
    .select({ cents: sql<string>`COALESCE(SUM(ROUND(${payments.amount} * 100)), 0)` })
    .from(payments)
    .where(
      and(
        eq(payments.organizationId, organizationId),
        eq(payments.noteId, noteId),
        eq(payments.status, "completed"),
        gte(payments.dueDate, start),
        lt(payments.dueDate, end),
      ),
    );
  return Number(credited?.cents ?? 0) || 0;
}

/**
 * Is an assessment already recorded for the installment due in `dueDate`'s
 * month — under any day of it, any status (a waived fee is not re-assessed)?
 * The table's unique key is the exact day; a writer that stepped the due
 * date off the note's schedule (the 31st → the 28th) names the same
 * installment by another day, and that must not become a second fee.
 */
async function installmentAlreadyAssessed(note: ServicedNoteForFees, dueDate: Date): Promise<boolean> {
  const { start, end } = utcMonthWindow(dueDate);
  const [existing] = await db
    .select({ id: lateFeeAssessments.id })
    .from(lateFeeAssessments)
    .where(
      and(
        eq(lateFeeAssessments.organizationId, note.organizationId),
        eq(lateFeeAssessments.loanType, "note"),
        eq(lateFeeAssessments.loanId, String(note.id)),
        gte(lateFeeAssessments.periodStart, isoDay(start)),
        lt(lateFeeAssessments.periodStart, isoDay(end)),
      ),
    )
    .limit(1);
  return Boolean(existing);
}

/**
 * Would the installment due on `dueDate` carry a fee as of `at`? Grace
 * passed, not paid in full, and no autopay debit initiated within grace still
 * settling. Reads only; never writes.
 */
async function evaluateInstallment(note: ServicedNoteForFees, dueDate: Date, at: Date): Promise<InstallmentVerdict> {
  const grace = noteGracePeriodDays(note.gracePeriodDays);
  const configuredLateFeeCents = decimalDollarsToCents(note.lateFee);
  if (grace === null) return { kind: "none", reason: "note states no grace period" };
  if (configuredLateFeeCents <= 0) return { kind: "none", reason: "note has no late fee" };
  const dayStart = utcDayStart(dueDate);
  const dayEnd = new Date(dayStart.getTime() + DAY_MS);

  const decision = shouldAssessLateFee({
    periodStart: dueDate,
    periodEnd: addMonthsUtc(dueDate, 1),
    dueDate,
    gracePeriodDays: grace,
    periodicPaymentAmountCents: decimalDollarsToCents(note.monthlyPayment),
    amountCreditedToCycleCents: await creditedToInstallmentCents(note.organizationId, note.id, dueDate),
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
        inArray(achDebitAttempts.status, ACH_IN_FLIGHT_STATUSES),
        lte(achDebitAttempts.createdAt, graceEnds),
      ),
    )
    .limit(1);
  if (inFlight) return { kind: "none", reason: "autopay debit initiated within grace is still settling" };

  return { kind: "fee", dueDate, feeCents: decision.feeAmountCents, justification: decision.justification };
}

/**
 * The installments an evaluation may consider, oldest first, from the one at
 * `next_payment_date`. On the note's schedule: every installment to the end
 * of the term. Off it: only the one the note states.
 */
/**
 * The installments to evaluate: the current one, then — on a known schedule —
 * each later one — only when the current installment itself came due WHILE
 * AcreOS HELD THE NOTE (on or after `createdAt`). An unrecorded payment is not
 * a missed one: a note imported with a stale `next_payment_date`, or one whose
 * start in AcreOS is unknown, gets only the current installment evaluated (as
 * before the walk existed),
 * never a fee for every month AcreOS did not observe — those fees reach the
 * borrower's statement and payoff quote (refuse-not-fabricate; W10.5).
 */
function candidateInstallments(note: ServicedNoteForFees):
  | { walk: "schedule"; dueDates: Date[] }
  | { walk: "current_only"; dueDates: Date[]; reason: string } {
  const current = new Date(note.nextPaymentDate as Date);
  const sched = resolveInstallmentSchedule(note);
  if (sched.kind !== "grid") return { walk: "current_only", dueDates: [current], reason: sched.reason };
  const heldSince = note.createdAt ? new Date(note.createdAt) : null;
  if (!heldSince || Number.isNaN(heldSince.getTime())) {
    return { walk: "current_only", dueDates: [current], reason: "when AcreOS began servicing the note is unknown" };
  }
  // The current installment came due BEFORE AcreOS held the note: the date is
  // the import's, not one AcreOS advanced, so payments AcreOS never saw may
  // have covered it — and a payment recorded now is applied to that backlog,
  // so every month after it would read as unpaid (W10.5 audit). Only the
  // current installment, as before the walk existed.
  // By UTC calendar day: a note entered at 15:00 with its first payment due
  // that day (midnight) is held "since" that installment, not after it.
  if (isoDay(current) < isoDay(heldSince)) {
    return {
      walk: "current_only",
      dueDates: [current],
      reason: "the next due date predates AcreOS holding the note (an imported date)",
    };
  }
  const dueDates = [current];
  for (let i = sched.currentIndex + 1; i < sched.termMonths; i++) dueDates.push(addMonthsUtc(sched.first, i));
  return { walk: "schedule", dueDates };
}

interface WalkResult {
  outcome: AssessmentOutcome;
  /** Fees that would be owed by `at` and are not recorded yet (for a projection). */
  unrecorded: InstallmentVerdict[];
}

/**
 * Walk the installments from `next_payment_date` through `at`. With
 * `record`, each fee found is inserted (idempotent per installment); without,
 * nothing is written and the fees that WOULD be assessed are returned.
 */
async function walkInstallments(
  note: ServicedNoteForFees,
  at: Date,
  record: { paymentId: string | null } | null,
): Promise<WalkResult> {
  const outcome: AssessmentOutcome = {
    assessed: false,
    alreadyExisted: false,
    feeCents: 0,
    reason: "",
    installmentsAssessed: 0,
    installmentsAlreadyAssessed: 0,
    deferredInstallments: 0,
    walk: "current_only",
  };
  const unrecorded: InstallmentVerdict[] = [];
  const grace = noteGracePeriodDays(note.gracePeriodDays);
  // The note's own terms first: no grace stated, no fee configured, or no
  // installment due means no fee on any installment — the walk never starts.
  const none = (reason: string): WalkResult => ({ outcome: { ...outcome, reason }, unrecorded });
  if (grace === null) return none("note states no grace period");
  if (decimalDollarsToCents(note.lateFee) <= 0) return none("note has no late fee");
  if (!note.nextPaymentDate) return none("note has no installment due");

  const candidates = candidateInstallments(note);
  outcome.walk = candidates.walk;
  if (candidates.walk === "current_only") outcome.walkRefusedReason = candidates.reason;

  const reasons: string[] = [];
  for (let n = 0; n < candidates.dueDates.length; n++) {
    const dueDate = candidates.dueDates[n];
    // Later installments are later still: the first one inside grace ends the walk.
    if (daysPastDue(dueDate, at) <= grace) {
      if (n === 0) reasons.push(`installment due ${isoDay(dueDate)} is within its ${grace}-day grace period`);
      break;
    }
    if (record && outcome.installmentsAssessed >= MAX_ASSESSMENTS_PER_RUN) {
      // Bounded, and said out loud: the rest are counted, never dropped.
      outcome.deferredInstallments = candidates.dueDates.slice(n).filter((d) => daysPastDue(d, at) > grace).length;
      logger.warn("[servicedLateFees] per-run assessment cap reached; the remaining installments are evaluated next run", {
        organizationId: note.organizationId,
        noteId: note.id,
        cap: MAX_ASSESSMENTS_PER_RUN,
        deferredInstallments: outcome.deferredInstallments,
        nextUnevaluatedDueDate: isoDay(dueDate),
      });
      break;
    }
    if (await installmentAlreadyAssessed(note, dueDate)) {
      outcome.installmentsAlreadyAssessed++;
      continue;
    }
    const verdict = await evaluateInstallment(note, dueDate, at);
    if (verdict.kind === "none") {
      reasons.push(verdict.reason);
      continue;
    }
    if (!record) {
      unrecorded.push(verdict);
      continue;
    }
    const inserted = await db
      .insert(lateFeeAssessments)
      .values({
        organizationId: note.organizationId,
        loanId: String(note.id),
        loanType: "note",
        periodStart: isoDay(dueDate),
        periodEnd: isoDay(addMonthsUtc(dueDate, 1)),
        paymentId: record.paymentId,
        feeAmountCents: verdict.feeCents,
        justification: verdict.justification,
        status: "assessed",
      })
      .onConflictDoNothing()
      .returning({ id: lateFeeAssessments.id });
    reasons.push(verdict.justification);
    if (inserted.length > 0) {
      outcome.installmentsAssessed++;
      outcome.feeCents += verdict.feeCents;
      logger.info("[servicedLateFees] fee assessed", {
        organizationId: note.organizationId,
        noteId: note.id,
        periodStart: isoDay(dueDate),
        feeCents: verdict.feeCents,
      });
    } else {
      outcome.installmentsAlreadyAssessed++;
    }
  }
  if (candidates.walk === "current_only" && note.firstPaymentDate !== undefined) {
    logger.info("[servicedLateFees] only the stated installment evaluated", {
      organizationId: note.organizationId,
      noteId: note.id,
      reason: candidates.reason,
    });
  }
  outcome.assessed = outcome.installmentsAssessed > 0;
  outcome.alreadyExisted = !outcome.assessed && outcome.installmentsAlreadyAssessed > 0;
  outcome.reason =
    reasons.length <= 1
      ? reasons[0] ?? "no installment is past its grace period"
      : `${outcome.installmentsAssessed} installment fee(s) assessed, ${outcome.installmentsAlreadyAssessed} already on record: ${reasons.join(" | ")}`;
  return { outcome, unrecorded };
}

/**
 * Assess the fee for every installment from the note's next payment date on
 * that grace has passed on and that is not paid in full — by the note's own
 * schedule, at most MAX_ASSESSMENTS_PER_RUN new ones per call. Idempotent per
 * installment. Nothing is assessed once the lender's servicing wind-down is
 * over — a payoff quote opened after that must not create a fee (ruling #3).
 */
export async function assessServicedNoteLateFee(
  note: ServicedNoteForFees & { status?: string | null },
  now: Date = new Date(),
  paymentId: string | null = null,
  servicingKnownActive = false,
): Promise<AssessmentOutcome> {
  const refused = (reason: string): AssessmentOutcome => ({
    assessed: false,
    alreadyExisted: false,
    feeCents: 0,
    reason,
    installmentsAssessed: 0,
    installmentsAlreadyAssessed: 0,
    deferredInstallments: 0,
    walk: "current_only",
  });
  // A payment on a defaulted note used to assess one on the way in (audit of
  // the fourth follow-up).
  if (!statusAccruesFees(note.status)) return refused(`note is ${note.status}`);
  if (!servicingKnownActive && (await lenderServicingPhase(note.organizationId, now)).phase === "ended") {
    return refused("lender servicing has ended");
  }
  return (await walkInstallments(note, now, { paymentId })).outcome;
}

/** Rounds of the capped walk a caller that must see EVERY fee runs (24 each): 600 installments, past any note's term. */
const FULL_WALK_ROUNDS = 25;

/**
 * Assess every installment due, not just one capped run's worth. The cap (24)
 * bounds the daily sweep; a payment posting, the payment preview and today's
 * payoff quote must not stop there — a catch-up that covers the deferred
 * installments would advance the date past them and their fees would never
 * be assessed, and a preview or quote would understate what posting assesses
 * (W10.5 audits). Stops as soon as a run defers nothing.
 */
export async function assessEveryInstallmentDue(
  note: ServicedNoteForFees & { status?: string | null },
  now: Date,
  // Callers pass the assessor they import, so a run is the same call they
  // would otherwise make — one capped run, repeated while it defers.
  assess: (n: ServicedNoteForFees & { status?: string | null }, at: Date) => Promise<Pick<AssessmentOutcome, "deferredInstallments">> = assessServicedNoteLateFee,
): Promise<void> {
  for (let round = 0; round < FULL_WALK_ROUNDS; round++) {
    const outcome = await assess(note, now);
    if (!outcome?.deferredInstallments) return;
  }
}

/**
 * The fees the note's installments will carry by `asOf` that are not
 * recorded yet — for a payoff quote good through a later date. 0 when none
 * is due by then; an installment already assessed is in what is owed.
 */
export async function lateFeeDueByCents(note: ServicedNoteForFees & { status?: string | null }, asOf: Date): Promise<number> {
  // A payoff quote must not include a fee the posting will never assess.
  if (!statusAccruesFees(note.status)) return 0;
  if ((await lenderServicingPhase(note.organizationId, asOf)).phase === "ended") return 0;
  const { unrecorded } = await walkInstallments(note, asOf, null);
  return unrecorded.reduce((sum, v) => sum + (v.kind === "fee" ? v.feeCents : 0), 0);
}

/**
 * Late fees the borrower owes on this note: assessed minus collected, never
 * negative. A posting passes its transaction, AFTER locking the note row, so
 * two concurrent payments cannot each collect the same fee (DEFECT-0185):
 * the second reads, under the lock, the fee the first committed.
 */
export async function outstandingServicedLateFeesCents(
  organizationId: number,
  noteId: number,
  executor: Executor = db,
): Promise<number> {
  const [assessed] = await executor
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
  const rows = await executor
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
  /** Installment fees recorded across all notes (a note three behind counts three). */
  installmentsAssessed: number;
  /** Past-grace installments left for the next run by the per-note cap — counted, never dropped. */
  deferredInstallments: number;
}

/**
 * The daily pass: every serviced note (active, late or delinquent — not
 * defaulted, whose installments acceleration ended) whose installment is past
 * due is evaluated, and a fee is recorded for each installment grace has
 * passed on that is unpaid (bounded per note per run; the remainder is
 * counted in `deferredInstallments` and taken by the next run). Lenders whose 90-day servicing wind-down is over are skipped —
 * AcreOS no longer services their loans (ruling #3).
 */
export async function runServicedLateFeeAssessmentPass(now: Date = new Date()): Promise<LateFeePassResult> {
  const result: LateFeePassResult = {
    scanned: 0,
    assessed: 0,
    alreadyAssessed: 0,
    errors: 0,
    installmentsAssessed: 0,
    deferredInstallments: 0,
  };
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
      // The note's schedule — what lets the walk reach every missed installment.
      firstPaymentDate: notes.firstPaymentDate,
      termMonths: notes.termMonths,
      // When AcreOS began holding the note: the walk never reaches before it.
      createdAt: notes.createdAt,
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
      result.installmentsAssessed += r.installmentsAssessed;
      result.deferredInstallments += r.deferredInstallments;
    } catch (err) {
      result.errors++;
      logger.error("[servicedLateFees] assessment failed", err instanceof Error ? err : undefined, {
        organizationId: note.organizationId,
        noteId: note.id,
      });
    }
  }
  if (result.deferredInstallments > 0) {
    logger.warn("[servicedLateFees] sweep left past-grace installments for the next run (per-note cap)", {
      deferredInstallments: result.deferredInstallments,
      cap: MAX_ASSESSMENTS_PER_RUN,
    });
  }
  return result;
}
