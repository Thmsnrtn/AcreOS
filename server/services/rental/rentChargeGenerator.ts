/**
 * Scheduled rent-charge generation.
 *
 * Rent charges were only ever created by an operator pressing "seed 12 months".
 * A landlord who never pressed it had an empty `rent_charges` table, so aging
 * buckets, the collected-% tile, the late-fee engine and every arrears number
 * computed over rent that was owed and never recorded. Nothing lied louder than
 * "$0 outstanding" on a unit that was two months behind.
 *
 * This module turns the lease's own schedule into the ledger, and it is
 * idempotent twice over:
 *   1. `planRentCharges` (pure, shared/rental/rentSchedule.ts) subtracts the
 *      periods already on the ledger, so a re-run plans nothing;
 *   2. the insert is `ON CONFLICT DO NOTHING` against
 *      `rent_charges_lease_month_uk (lease_id, charged_for_month)`, so even a
 *      concurrent double-run cannot double-charge.
 *
 * Partial first/final periods are NOT generated — proration is a lease term
 * AcreOS does not hold, and inventing a convention would overcharge somebody.
 * They come back as `skipped` for the operator to post at the agreed amount.
 *
 * Ledger only. No processor, no collection, no funds movement anywhere in this
 * file (founder ruling "be the rail, not the provider").
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { rentCharges, rentalLeases, leaseRentSchedule } from "@shared/schema";
import {
  planRentCharges,
  type PlannedRentCharge,
  type RentChargePlan,
  type SkippedRentPeriod,
} from "@shared/rental/rentSchedule";
import type { RentScheduleStepInput } from "@shared/rental/rentEscalation";
import { logger } from "../../utils/logger";

/** Leases whose rent should be on the ledger. */
const GENERATABLE_LEASE_STATUSES = ["active", "pending_signature"] as const;

export interface LeaseChargePlanView {
  leaseId: string;
  propertyId: number;
  unitLabel: string | null;
  monthlyRentCents: number;
  create: PlannedRentCharge[];
  skipped: SkippedRentPeriod[];
  /** Total cents that would be posted if the operator confirms. */
  totalToPostCents: number;
}

/**
 * READ-ONLY. What generation WOULD post, per lease, through `throughDate`.
 * This is what the operator reviews before any charge is written.
 */
export async function previewScheduledCharges(args: {
  organizationId: number;
  /** YYYY-MM-DD horizon; periods whose month starts on or before this. */
  throughDate: string;
  /** Limit to one lease. Omit for the whole org. */
  leaseId?: string;
}): Promise<{ leases: LeaseChargePlanView[]; totalToPostCents: number; chargeCount: number }> {
  const conditions = [
    eq(rentalLeases.organizationId, args.organizationId),
    inArray(rentalLeases.status, [...GENERATABLE_LEASE_STATUSES]),
  ];
  if (args.leaseId) conditions.push(eq(rentalLeases.id, args.leaseId));

  const leases = await db.select().from(rentalLeases).where(and(...conditions));
  if (leases.length === 0) return { leases: [], totalToPostCents: 0, chargeCount: 0 };

  const leaseIds = leases.map((l) => l.id);
  const existing = await db
    .select({ leaseId: rentCharges.leaseId, chargedForMonth: rentCharges.chargedForMonth })
    .from(rentCharges)
    .where(and(eq(rentCharges.organizationId, args.organizationId), inArray(rentCharges.leaseId, leaseIds)));

  const existingByLease = new Map<string, string[]>();
  for (const row of existing) {
    const list = existingByLease.get(row.leaseId) ?? [];
    list.push(String(row.chargedForMonth).slice(0, 10));
    existingByLease.set(row.leaseId, list);
  }

  // Batch-load commercial escalation steps (Wave 4). Most leases have none, in
  // which case they stay out of this map entirely and planForLease bills the flat
  // monthly rent, exactly as before. Batched to avoid an N+1 across leases.
  const scheduleRows = await db
    .select({
      leaseId: leaseRentSchedule.leaseId,
      effectiveMonth: leaseRentSchedule.effectiveMonth,
      stepType: leaseRentSchedule.stepType,
      amountCents: leaseRentSchedule.amountCents,
      pctBps: leaseRentSchedule.pctBps,
      cpiIndexBase: leaseRentSchedule.cpiIndexBase,
      cpiIndexCurrent: leaseRentSchedule.cpiIndexCurrent,
      floorPctBps: leaseRentSchedule.floorPctBps,
      ceilingPctBps: leaseRentSchedule.ceilingPctBps,
    })
    .from(leaseRentSchedule)
    .where(and(
      eq(leaseRentSchedule.organizationId, args.organizationId),
      inArray(leaseRentSchedule.leaseId, leaseIds),
    ));

  const stepsByLease = new Map<string, RentScheduleStepInput[]>();
  for (const row of scheduleRows) {
    const list = stepsByLease.get(row.leaseId) ?? [];
    list.push({
      effectiveMonth: String(row.effectiveMonth).slice(0, 10),
      stepType: row.stepType,
      amountCents: row.amountCents ?? null,
      pctBps: row.pctBps ?? null,
      // numeric columns arrive as strings — normalise to number for the engine.
      cpiIndexBase: row.cpiIndexBase != null ? Number(row.cpiIndexBase) : null,
      cpiIndexCurrent: row.cpiIndexCurrent != null ? Number(row.cpiIndexCurrent) : null,
      floorPctBps: row.floorPctBps ?? null,
      ceilingPctBps: row.ceilingPctBps ?? null,
    });
    stepsByLease.set(row.leaseId, list);
  }

  const views: LeaseChargePlanView[] = [];
  for (const lease of leases) {
    const plan = planForLease(
      lease,
      existingByLease.get(lease.id) ?? [],
      args.throughDate,
      stepsByLease.get(lease.id) ?? [],
    );
    if (plan.create.length === 0 && plan.skipped.every((s) => s.code === "already_on_ledger")) continue;
    views.push({
      leaseId: lease.id,
      propertyId: lease.propertyId,
      unitLabel: lease.unitLabel,
      monthlyRentCents: lease.monthlyRentCents,
      create: plan.create,
      skipped: plan.skipped.filter((s) => s.code !== "already_on_ledger"),
      totalToPostCents: plan.create.reduce((s, c) => s + c.amountCents, 0),
    });
  }

  return {
    leases: views,
    totalToPostCents: views.reduce((s, v) => s + v.totalToPostCents, 0),
    chargeCount: views.reduce((s, v) => s + v.create.length, 0),
  };
}

function planForLease(
  lease: typeof rentalLeases.$inferSelect,
  existingMonths: string[],
  throughDate: string,
  scheduleSteps: readonly RentScheduleStepInput[] = [],
): RentChargePlan {
  return planRentCharges({
    lease: {
      startDate: String(lease.startDate).slice(0, 10),
      endDate: lease.endDate ? String(lease.endDate).slice(0, 10) : null,
      rentDueDayOfMonth: lease.rentDueDayOfMonth,
      monthlyRentCents: lease.monthlyRentCents,
      scheduleSteps,
      isSection8: lease.isSection8,
      hapPortionCents: lease.hapPortionCents,
      tenantPortionCents: lease.tenantPortionCents,
    },
    existingMonths,
    throughDate,
  });
}

export interface GenerationResult {
  leasesConsidered: number;
  inserted: number;
  /** Planned but lost the ON CONFLICT race — proof of idempotency, not a fault. */
  skippedDuplicate: number;
  skippedPartialPeriods: SkippedRentPeriod[];
  insertedTotalCents: number;
}

/**
 * Post the scheduled charges. Idempotent — a second run over the same horizon
 * inserts nothing.
 */
export async function generateScheduledCharges(args: {
  organizationId: number;
  throughDate: string;
  leaseId?: string;
  userId?: string;
}): Promise<GenerationResult> {
  const preview = await previewScheduledCharges(args);
  const result: GenerationResult = {
    leasesConsidered: preview.leases.length,
    inserted: 0,
    skippedDuplicate: 0,
    skippedPartialPeriods: [],
    insertedTotalCents: 0,
  };

  for (const view of preview.leases) {
    result.skippedPartialPeriods.push(...view.skipped);
    for (const c of view.create) {
      // ON CONFLICT DO NOTHING on (lease_id, charged_for_month): the unique
      // index IS the double-charge guard, exactly as
      // ach_debit_attempts_period_uidx is on the borrower side.
      const rows = await db
        .insert(rentCharges)
        .values({
          organizationId: args.organizationId,
          leaseId: view.leaseId,
          chargedForMonth: c.chargedForMonth,
          dueDate: c.dueDate,
          amountCents: c.amountCents,
          hapPortionCents: c.hapPortionCents,
          tenantPortionCents: c.tenantPortionCents,
          paidCents: 0,
          balanceCents: c.amountCents,
        })
        .onConflictDoNothing()
        .returning({ id: rentCharges.id, amountCents: rentCharges.amountCents });
      if (rows.length > 0) {
        result.inserted += 1;
        result.insertedTotalCents += rows[0].amountCents;
      } else {
        result.skippedDuplicate += 1;
      }
    }
  }

  logger.info("[BH-3] scheduled rent charges posted", {
    orgId: args.organizationId,
    userId: args.userId,
    leaseId: args.leaseId ?? null,
    throughDate: args.throughDate,
    leasesConsidered: result.leasesConsidered,
    inserted: result.inserted,
    skippedDuplicate: result.skippedDuplicate,
    partialPeriodsSkipped: result.skippedPartialPeriods.length,
    insertedTotalCents: result.insertedTotalCents,
  });

  return result;
}
