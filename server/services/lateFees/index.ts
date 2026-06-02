/**
 * lateFees — §1026.36(c)(2) late-fee non-pyramiding.
 *
 * 12 C.F.R. §1026.36(c)(2):
 *   "No servicer shall impose any late fee or delinquency charge in
 *    connection with a periodic payment when the only delinquency is
 *    attributable to late fees or delinquency charges assessed on an
 *    earlier payment, and the periodic payment is otherwise a full
 *    periodic payment for the applicable period and is paid on its due
 *    date or within any applicable grace period."
 *
 * The reg targets a specific anti-pattern: borrower pays cycle 2's
 * periodic in full and on time, but a prior cycle's unpaid late-fee
 * causes the servicer to mark cycle 2 short, which then triggers a
 * NEW late-fee on cycle 2. That's pyramiding. AcreOS refuses to do it.
 *
 * Our enforcement strategy:
 *  1. Late fees are assessed per CYCLE, not per payment. The unique
 *     index on late_fee_assessments(loan_id, period_start) guarantees
 *     at most one fee per cycle — re-running the assessor is a no-op.
 *  2. The assessor evaluates a single cycle's status: was the periodic
 *     amount paid in full by due_date + grace_period? If yes, no fee
 *     EVER, regardless of prior cycles.
 *  3. Subsequent cycles are evaluated independently. A borrower who
 *     paid cycle 1 late and cycle 2 on time gets a fee on cycle 1
 *     (the missed one) — never on cycle 2 (the on-time one).
 *
 * The pure algorithm lives in `shouldAssessLateFee`. The DB writer
 * is `assessLateFee`.
 */

import { db } from "../../db";
import { lateFeeAssessments, paymentApplications } from "@shared/schema/reg-z";
import { and, eq, gte, lte, sql } from "drizzle-orm";
import { logger } from "../../utils/logger";

// ============================================================================
// PURE ALGORITHM
// ============================================================================

export interface ShouldAssessLateFeeInput {
  /** The cycle being evaluated. */
  periodStart: Date;
  periodEnd: Date;
  /** Due date for this cycle. */
  dueDate: Date;
  /** Grace period (days) per the note's terms. Late fee fires after grace. */
  gracePeriodDays: number;
  /** Periodic payment amount required to cover this cycle in full. */
  periodicPaymentAmountCents: number;
  /**
   * Total amount actually credited (P+I+E+Suspense-release) to this cycle
   * by the borrower, by the time of evaluation. Computed upstream from
   * payment_applications rows whose appliedAt falls inside the cycle.
   */
  amountCreditedToCycleCents: number;
  /** "Now" — when the assessor is running. */
  evaluationDate: Date;
  /** Configured late-fee amount (cents) per the note. */
  configuredLateFeeCents: number;
}

export interface ShouldAssessLateFeeResult {
  shouldAssess: boolean;
  feeAmountCents: number;
  justification: string;
}

/**
 * The non-pyramiding decision. Returns {shouldAssess: false} for ANY
 * cycle where the periodic was paid in full within the grace period —
 * even if prior cycles were late.
 *
 * Test coverage: lateFees.test.ts walks the 3-consecutive-missed-then-paid
 * scenario plus boundary cases.
 */
export function shouldAssessLateFee(
  input: ShouldAssessLateFeeInput,
): ShouldAssessLateFeeResult {
  const {
    dueDate,
    gracePeriodDays,
    periodicPaymentAmountCents,
    amountCreditedToCycleCents,
    evaluationDate,
    configuredLateFeeCents,
    periodStart,
  } = input;

  // Early-out: if the note isn't configured for a late fee, the assessor
  // is a no-op on every cycle. (Borrower-friendly default.)
  if (configuredLateFeeCents <= 0) {
    return {
      shouldAssess: false,
      feeAmountCents: 0,
      justification: `Note has no configured late fee (configuredLateFeeCents=${configuredLateFeeCents}). No assessment.`,
    };
  }

  // §1026.36(c)(2) anti-pyramiding rule: was THIS cycle's periodic paid
  // in full? If yes, no fee. We do NOT look at prior-cycle status —
  // the reg explicitly forbids carrying a prior shortfall forward.
  if (amountCreditedToCycleCents >= periodicPaymentAmountCents) {
    return {
      shouldAssess: false,
      feeAmountCents: 0,
      justification: `Cycle ${periodStart.toISOString().slice(0, 10)} was paid in full (credited ${amountCreditedToCycleCents}¢ >= periodic ${periodicPaymentAmountCents}¢). Per §1026.36(c)(2), no late fee may be assessed on a cycle that is itself paid in full, regardless of prior-cycle delinquency.`,
    };
  }

  // Compute the boundary: due_date + grace_period_days (end of day).
  const MS_PER_DAY = 24 * 60 * 60 * 1000;
  const graceEnd = new Date(dueDate.getTime() + gracePeriodDays * MS_PER_DAY);

  // §1026.36(c)(2) boundary clause: "paid on its due date or within any
  // applicable grace period". Strictly later than grace triggers eligibility.
  // We use Math.floor(days) for the grace check so a payment landing exactly
  // at dueDate + N days is still inside grace.
  const daysPastDue = Math.floor((evaluationDate.getTime() - dueDate.getTime()) / MS_PER_DAY);

  if (daysPastDue <= gracePeriodDays) {
    return {
      shouldAssess: false,
      feeAmountCents: 0,
      justification: `Evaluation date is within the ${gracePeriodDays}-day grace period (${daysPastDue} day(s) past due). Per §1026.36(c)(2), no late fee until grace expires.`,
    };
  }

  // We're past grace AND the cycle is short. Fee eligible.
  // Note: we don't multiply or pyramid. One fee, on the missed cycle itself.
  return {
    shouldAssess: true,
    feeAmountCents: configuredLateFeeCents,
    justification: `Cycle ${periodStart.toISOString().slice(0, 10)} was not paid in full by due_date + grace_period of ${gracePeriodDays} days (credited ${amountCreditedToCycleCents}¢ < periodic ${periodicPaymentAmountCents}¢). Fee of ${configuredLateFeeCents}¢ assessed per §1026.36(c)(2) on the missed cycle itself, not on subsequent cycles. graceEnd=${graceEnd.toISOString().slice(0, 10)}.`,
  };
}

// ============================================================================
// DB ORCHESTRATOR
// ============================================================================

export interface AssessLateFeeInput {
  organizationId: number;
  loanId: string;
  loanType?: "note" | "acquired_note";
  periodStart: Date;
  periodEnd: Date;
  dueDate: Date;
  gracePeriodDays: number;
  periodicPaymentAmountCents: number;
  configuredLateFeeCents: number;
  evaluationDate?: Date;
}

export interface AssessLateFeeResult {
  assessed: boolean;
  alreadyExists: boolean;
  feeAmountCents: number;
  justification: string;
}

/**
 * Assess a late fee for a specific cycle. Idempotent on (loanId, periodStart).
 *
 * Reads the credited-to-cycle amount by summing payment_applications rows
 * whose appliedAt falls in the cycle window. This is the canonical
 * source of truth — we don't trust a per-cycle counter that could drift.
 */
export async function assessLateFee(
  input: AssessLateFeeInput,
): Promise<AssessLateFeeResult> {
  const loanType = input.loanType ?? "note";
  const evaluationDate = input.evaluationDate ?? new Date();

  // Idempotency check: has a fee row already been written for this cycle?
  const existing = await db
    .select()
    .from(lateFeeAssessments)
    .where(
      and(
        eq(lateFeeAssessments.loanId, input.loanId),
        eq(lateFeeAssessments.periodStart, input.periodStart.toISOString().slice(0, 10)),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return {
      assessed: false,
      alreadyExists: true,
      feeAmountCents: existing[0].feeAmountCents,
      justification: existing[0].justification,
    };
  }

  // Sum payment_applications credited to this cycle.
  const credited = await db
    .select({
      total: sql<number>`COALESCE(SUM(${paymentApplications.appliedToPrincipalCents}) + SUM(${paymentApplications.appliedToInterestCents}) + SUM(${paymentApplications.appliedToEscrowCents}), 0)::bigint`,
    })
    .from(paymentApplications)
    .where(
      and(
        eq(paymentApplications.loanId, input.loanId),
        gte(paymentApplications.appliedAt, input.periodStart),
        lte(paymentApplications.appliedAt, input.periodEnd),
      ),
    );

  const amountCreditedToCycleCents = Number(credited[0]?.total ?? 0);

  const decision = shouldAssessLateFee({
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    dueDate: input.dueDate,
    gracePeriodDays: input.gracePeriodDays,
    periodicPaymentAmountCents: input.periodicPaymentAmountCents,
    amountCreditedToCycleCents,
    evaluationDate,
    configuredLateFeeCents: input.configuredLateFeeCents,
  });

  if (!decision.shouldAssess) {
    logger.info(
      `[lateFees] no fee for loan ${input.loanId} cycle ${input.periodStart.toISOString().slice(0, 10)}: ${decision.justification}`,
    );
    return {
      assessed: false,
      alreadyExists: false,
      feeAmountCents: 0,
      justification: decision.justification,
    };
  }

  // Persist. ON CONFLICT DO NOTHING guards against a race between
  // the existing-check above and the insert. If a parallel call beat us,
  // we read the winner's row and return alreadyExists=true.
  const inserted = await db
    .insert(lateFeeAssessments)
    .values({
      organizationId: input.organizationId,
      loanId: input.loanId,
      loanType,
      periodStart: input.periodStart.toISOString().slice(0, 10),
      periodEnd: input.periodEnd.toISOString().slice(0, 10),
      feeAmountCents: decision.feeAmountCents,
      justification: decision.justification,
      status: "assessed",
    })
    .onConflictDoNothing({
      target: [lateFeeAssessments.loanId, lateFeeAssessments.periodStart],
    })
    .returning();

  if (inserted.length === 0) {
    // Race lost — read the existing row.
    const winner = await db
      .select()
      .from(lateFeeAssessments)
      .where(
        and(
          eq(lateFeeAssessments.loanId, input.loanId),
          eq(lateFeeAssessments.periodStart, input.periodStart.toISOString().slice(0, 10)),
        ),
      )
      .limit(1);
    return {
      assessed: false,
      alreadyExists: true,
      feeAmountCents: winner[0]?.feeAmountCents ?? 0,
      justification: winner[0]?.justification ?? "race-lost row read",
    };
  }

  return {
    assessed: true,
    alreadyExists: false,
    feeAmountCents: decision.feeAmountCents,
    justification: decision.justification,
  };
}
