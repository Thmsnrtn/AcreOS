/**
 * server/services/servicerRemittance.ts
 *
 * Note Servicer monthly remittance generator (Pillar K — Ursa).
 *
 * For each active note_ownership_of_record row owned by this servicer org:
 *   1. Sum note_payments inside the [periodStart, periodEnd] window.
 *   2. Compute the servicer fee against the gross (default 0% in this
 *      foundation PR — the per-org / per-owner fee schedule arrives in a
 *      follow-up; the foundation table stores fee cents directly so a UI
 *      override is possible today).
 *   3. Roll up per-owner totals (an owner may hold multiple notes serviced
 *      by us; one remittance row per owner per period).
 *   4. Write a `servicer_remittances` row in `draft` status.
 *   5. Queue a PDF render (stubbed — see TODO below).
 *
 * Idempotent on (organizationId, ownerOrgId, periodStart, periodEnd): the
 * unique index in `migrations/0096_servicer_foundation.sql` enforces it.
 * Re-running the job for the same window updates the existing draft row
 * instead of creating duplicates.
 */

import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import { db } from "../db";
import {
  acquiredNotes,
  notePayments,
  noteOwnershipOfRecord,
  servicerRemittances,
  type InsertServicerRemittance,
  type ServicerRemittance,
} from "@shared/schema";
import { logger } from "../utils/logger";

export interface GenerateMonthlyRemittancesResult {
  organizationId: number;
  periodStart: string;
  periodEnd: string;
  remittancesGenerated: number;
  ownersCovered: number;
  totalGrossCents: number;
  totalNetCents: number;
  rows: ServicerRemittance[];
}

/**
 * Resolve the canonical period for a given `periodEnd` date — the calendar
 * month containing that date, anchored at month-start.
 *
 * Example: periodEnd = 2026-04-30 → periodStart = 2026-04-01.
 */
function resolveMonthlyPeriod(periodEnd: Date): { periodStart: string; periodEnd: string } {
  const y = periodEnd.getUTCFullYear();
  const m = periodEnd.getUTCMonth();
  const startDate = new Date(Date.UTC(y, m, 1));
  // Last day of the month, regardless of what the caller passed.
  const endDate = new Date(Date.UTC(y, m + 1, 0));
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { periodStart: fmt(startDate), periodEnd: fmt(endDate) };
}

/**
 * Generate monthly remittances for every active owner-of-record row
 * serviced by the given org, for the month containing `periodEnd`.
 *
 * Returns one remittance row per (servicer, owner, month).
 */
export async function generateMonthlyRemittances(
  orgId: number,
  periodEnd: Date,
): Promise<GenerateMonthlyRemittancesResult> {
  const { periodStart: periodStartStr, periodEnd: periodEndStr } = resolveMonthlyPeriod(periodEnd);

  // Pull active ownership-of-record rows for this servicer org. Active =
  // supersededAt IS NULL. Join through acquired_notes so a note we no
  // longer service (cascade-deleted) doesn't surface.
  const ownerships = await db
    .select({
      ownerOrgId: noteOwnershipOfRecord.ownerOrgId,
      noteId: noteOwnershipOfRecord.noteId,
      basisPercentage: noteOwnershipOfRecord.basisPercentage,
    })
    .from(noteOwnershipOfRecord)
    .innerJoin(acquiredNotes, eq(acquiredNotes.id, noteOwnershipOfRecord.noteId))
    .where(
      and(
        eq(noteOwnershipOfRecord.organizationId, orgId),
        isNull(noteOwnershipOfRecord.supersededAt),
      ),
    );

  if (ownerships.length === 0) {
    return {
      organizationId: orgId,
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      remittancesGenerated: 0,
      ownersCovered: 0,
      totalGrossCents: 0,
      totalNetCents: 0,
      rows: [],
    };
  }

  // Roll up gross collected cents per (ownerOrgId) across all notes that
  // owner holds with us during the window. We sum principal + interest +
  // escrow + late fees — every dollar collected against the note in the
  // period flows through the servicer first. The owner's per-note basis
  // percentage scales their share.
  const grossByOwner = new Map<number, number>();

  for (const ow of ownerships) {
    const [agg] = await db
      .select({
        grossCents: sql<number>`COALESCE(SUM(
          COALESCE(${notePayments.principalCents}, 0)
          + COALESCE(${notePayments.interestCents}, 0)
          + COALESCE(${notePayments.escrowCents}, 0)
          + COALESCE(${notePayments.lateFeeCents}, 0)
        ), 0)`,
      })
      .from(notePayments)
      .where(
        and(
          eq(notePayments.organizationId, orgId),
          eq(notePayments.noteId, ow.noteId),
          gte(notePayments.paymentDate, periodStartStr),
          lte(notePayments.paymentDate, periodEndStr),
        ),
      );

    const noteGross = Number(agg?.grossCents ?? 0);
    // basisPercentage stored as numeric(5,2) — Drizzle hands it back as a
    // string ("100.00"). Coerce to a number for the math; round to cents.
    const basisPct = Number(ow.basisPercentage ?? "100");
    const ownerShare = Math.round((noteGross * basisPct) / 100);

    grossByOwner.set(ow.ownerOrgId, (grossByOwner.get(ow.ownerOrgId) ?? 0) + ownerShare);
  }

  // Upsert one remittance row per owner. Default fee is 0 in this
  // foundation PR — see TODO below.
  const rows: ServicerRemittance[] = [];
  let totalGrossCents = 0;
  let totalNetCents = 0;

  for (const [ownerOrgId, grossCents] of grossByOwner) {
    const servicerFeeCents = 0; // TODO: per-owner fee schedule.
    const netCents = grossCents - servicerFeeCents;
    totalGrossCents += grossCents;
    totalNetCents += netCents;

    const insertRow: InsertServicerRemittance = {
      organizationId: orgId,
      ownerOrgId,
      periodStart: periodStartStr,
      periodEnd: periodEndStr,
      grossCents,
      servicerFeeCents,
      netCents,
      status: "draft",
    };

    const [row] = await db
      .insert(servicerRemittances)
      .values(insertRow)
      .onConflictDoUpdate({
        target: [
          servicerRemittances.organizationId,
          servicerRemittances.ownerOrgId,
          servicerRemittances.periodStart,
          servicerRemittances.periodEnd,
        ],
        set: {
          grossCents,
          servicerFeeCents,
          netCents,
          generatedAt: new Date(),
          updatedAt: new Date(),
        },
      })
      .returning();

    if (row) {
      rows.push(row);
      // TODO: enqueue PDF render. The render shape will mirror the 1099
      // transmittal PDF (jsPDF, S3 upload) — deferred until the fee
      // schedule lands so the document body has real line items.
      logger.info("servicerRemittance.pdfRender enqueue (stub)", {
        remittanceId: row.id,
        organizationId: orgId,
        ownerOrgId,
        periodStart: periodStartStr,
        periodEnd: periodEndStr,
      });
    }
  }

  return {
    organizationId: orgId,
    periodStart: periodStartStr,
    periodEnd: periodEndStr,
    remittancesGenerated: rows.length,
    ownersCovered: grossByOwner.size,
    totalGrossCents,
    totalNetCents,
    rows,
  };
}
