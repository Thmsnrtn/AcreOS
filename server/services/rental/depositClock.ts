/**
 * The security-deposit statutory clock.
 *
 * `security_deposits.statutoryDeadline` was a column with a comment and no
 * writer — no route in the repo ever set it. Deposit mishandling is the most
 * common landlord-tenant claim there is, and in most states the sanction is not
 * "pay late": it is loss of the right to withhold ANYTHING plus statutory
 * damages (often 2-3x) plus fees. An empty countdown reads to the operator as
 * "no clock is running", which is the worst possible lie for this column.
 *
 * The trigger is MOVE-OUT, in this precedence:
 *   1. the move-out inspection's `inspectionDate` (`move_inspections.kind =
 *      'move_out'`) — the date the operator actually walked the unit;
 *   2. failing that, the lease's `endDate` when the lease is marked
 *      ended/terminated.
 * Lease end alone is NOT used while the lease is still active: a lease can end
 * on paper and the tenant hand back keys later, and the statutes run from the
 * end of the tenancy/possession.
 *
 * Unencoded jurisdictions: the deadline stays NULL and
 * `statutoryDeadlineUnknownReason` carries the sentence the UI must render.
 * We do not default to 30 days. See shared/regulatory/depositReturnRules.ts.
 *
 * No money moves here. This module writes dates and text onto a ledger row —
 * AcreOS never holds, transmits or refunds a tenant deposit (founder ruling
 * "be the rail, not the provider").
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { moveInspections, rentalLeases, securityDeposits } from "@shared/schema";
import {
  computeDepositDeadline,
  depositDeadlineCountdown,
  type DepositCountdown,
  type DepositDeadlineResult,
} from "@shared/regulatory/depositReturnRules";
import { logger } from "../../utils/logger";

export type DepositClockTrigger = "move_out_inspection" | "lease_ended" | "reconciliation" | "manual";

export interface DepositClockOutcome {
  /** false when there is no security_deposits row for the lease yet. */
  depositFound: boolean;
  depositId: string | null;
  deadline: DepositDeadlineResult | null;
  countdown: DepositCountdown | null;
  /** true when this call changed the stored deadline / basis. */
  updated: boolean;
  /** The move-out date used and where it came from. */
  moveOut: ResolvedMoveOut;
}

/** Where a resolved move-out date came from. Never guessed, never defaulted. */
export interface ResolvedMoveOut {
  /** YYYY-MM-DD, or null when the tenancy has not demonstrably ended. */
  moveOutDate: string | null;
  basis: "move_out_inspection" | "lease_end_date" | "previously_recorded" | "none";
  /** Explains a null so the operator is told what to record, not shown a blank. */
  reason: string | null;
}

/**
 * Resolve the trigger date for the statutory clock, in the precedence this
 * module's header sets out:
 *
 *   1. the most recent move-out inspection's `inspectionDate` — the day the
 *      operator actually walked the unit;
 *   2. failing that, the lease's `endDate`, but ONLY once the lease is marked
 *      ended/terminated. A lease can end on paper while the tenant hands back
 *      keys later, and the statutes run from the end of possession.
 *
 * Neither available ⇒ null plus the sentence the UI renders. We do not
 * substitute "today", and we do not read an active lease's future end date as
 * a move-out: both would start a clock that is not running.
 */
export async function resolveMoveOutDate(args: {
  organizationId: number;
  leaseId: string;
}): Promise<ResolvedMoveOut> {
  const [inspection] = await db
    .select({ inspectionDate: moveInspections.inspectionDate })
    .from(moveInspections)
    .where(
      and(
        eq(moveInspections.organizationId, args.organizationId),
        eq(moveInspections.leaseId, args.leaseId),
        eq(moveInspections.kind, "move_out"),
      ),
    )
    .orderBy(desc(moveInspections.inspectionDate))
    .limit(1);

  if (inspection?.inspectionDate) {
    return {
      moveOutDate: String(inspection.inspectionDate).slice(0, 10),
      basis: "move_out_inspection",
      reason: null,
    };
  }

  const [lease] = await db
    .select({ status: rentalLeases.status, endDate: rentalLeases.endDate })
    .from(rentalLeases)
    .where(
      and(eq(rentalLeases.id, args.leaseId), eq(rentalLeases.organizationId, args.organizationId)),
    );

  const tenancyOver = lease?.status === "ended" || lease?.status === "terminated";
  if (tenancyOver && lease?.endDate) {
    return {
      moveOutDate: String(lease.endDate).slice(0, 10),
      basis: "lease_end_date",
      reason: null,
    };
  }

  return {
    moveOutDate: null,
    basis: "none",
    reason: tenancyOver
      ? "This lease is marked ended but carries no end date and has no move-out inspection, so AcreOS " +
        "has no date to run the deposit clock from. Record the move-out inspection date."
      : "The tenancy has not ended on record (no move-out inspection, and the lease is not marked " +
        "ended or terminated), so no deposit clock is running yet. AcreOS will not start one from a " +
        "future lease end date.",
  };
}

/**
 * Compute and persist the deposit deadline for a lease.
 *
 * Idempotent: recomputing the same move-out date + state + deduction posture
 * produces the same date and writes nothing. Re-running after deductions are
 * added DOES rewrite the deadline in states whose window differs with
 * deductions (FL, MT, IL) — which is correct, and `statutoryDeadlineSetAt`
 * records when the basis last changed.
 */
export async function startDepositClock(args: {
  organizationId: number;
  leaseId: string;
  /**
   * The move-out date, when the caller already holds it (the reconcile route
   * has the inspection in hand). Omit or pass null to resolve it from the
   * record via `resolveMoveOutDate`.
   */
  moveOutDate?: string | null;
  trigger: DepositClockTrigger;
  /** Operator id, for the audit line. */
  userId?: string;
}): Promise<DepositClockOutcome> {
  const [lease] = await db
    .select({ id: rentalLeases.id, state: rentalLeases.state })
    .from(rentalLeases)
    .where(and(eq(rentalLeases.id, args.leaseId), eq(rentalLeases.organizationId, args.organizationId)));

  const [deposit] = await db
    .select()
    .from(securityDeposits)
    .where(
      and(eq(securityDeposits.leaseId, args.leaseId), eq(securityDeposits.organizationId, args.organizationId)),
    );

  // Resolve the trigger BEFORE the early return so a caller with no deposit
  // row still learns whether a clock would be running.
  const moveOut: ResolvedMoveOut = args.moveOutDate
    ? { moveOutDate: String(args.moveOutDate).slice(0, 10), basis: "move_out_inspection", reason: null }
    : await resolveMoveOutDate({ organizationId: args.organizationId, leaseId: args.leaseId });

  if (!deposit) {
    return {
      depositFound: false,
      depositId: null,
      deadline: null,
      countdown: null,
      updated: false,
      moveOut,
    };
  }

  const hasDeductions = (deposit.deductionsTotalCents ?? 0) > 0;
  // A date already stored on the deposit row is the last resort — it was itself
  // written by this function from a real trigger.
  const moveOutDate = moveOut.moveOutDate ?? deposit.moveOutDate ?? null;
  const deadline = computeDepositDeadline({
    moveOutDate,
    state: lease?.state ?? null,
    hasDeductions,
  });

  const unchanged =
    deposit.statutoryDeadline === (deadline.deadlineDate ?? null) &&
    deposit.moveOutDate === (moveOutDate ?? null) &&
    deposit.statutoryDeadlineDays === (deadline.deadlineDays ?? null) &&
    deposit.statutoryDeadlineUnknownReason === (deadline.unknownReason ?? null);

  if (!unchanged) {
    await db
      .update(securityDeposits)
      .set({
        moveOutDate: moveOutDate ?? null,
        statutoryDeadline: deadline.deadlineDate,
        statutoryDeadlineDays: deadline.deadlineDays,
        statutoryDeadlineCitation: deadline.citation,
        statutoryDeadlineUnknownReason: deadline.unknownReason,
        statutoryDeadlineSetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(securityDeposits.id, deposit.id));

    if (deadline.known) {
      logger.info("[BH-4] deposit statutory clock set", {
        orgId: args.organizationId,
        userId: args.userId,
        leaseId: args.leaseId,
        depositId: deposit.id,
        trigger: args.trigger,
        moveOutDate,
        deadline: deadline.deadlineDate,
        deadlineDays: deadline.deadlineDays,
        citation: deadline.citation,
      });
    } else {
      // Not an error — an honest gap. Logged at warn so it is visible in ops
      // rather than swallowed, because the operator has to calendar it by hand.
      logger.warn("[BH-4] deposit statutory clock NOT set — no encoded rule", {
        orgId: args.organizationId,
        userId: args.userId,
        leaseId: args.leaseId,
        depositId: deposit.id,
        trigger: args.trigger,
        state: lease?.state ?? null,
        reason: deadline.unknownReason,
      });
    }
  }

  return {
    depositFound: true,
    depositId: deposit.id,
    deadline,
    countdown: depositDeadlineCountdown(deadline.deadlineDate),
    updated: !unchanged,
    moveOut:
      moveOutDate === moveOut.moveOutDate
        ? moveOut
        : // No live trigger resolved, so the date this function stored on a
          // previous run stands. Reported as such rather than re-attributed to
          // an inspection or a lease end that is not there now.
          { moveOutDate, basis: "previously_recorded", reason: null },
  };
}
