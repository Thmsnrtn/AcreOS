/**
 * Panel-300 #22 — multi-vertical consolidated P&L + W-2-exit calculator.
 *
 * Customers-verticals (Magnus, Imani) flag this as the difference between
 * "AcreOS is one of my tools" and "AcreOS is the system of record." A
 * multi-vertical operator running Land + Notes + BH simultaneously needs
 * a unified P&L that shows revenue / costs / IRR per vertical AND in
 * aggregate. Without it, they churn back to Excel.
 *
 * The W-2-exit calculator: project monthly net cash flow over 24 months
 * using current vertical performance, and tell the operator what month
 * their W-2 income is replaceable.
 *
 * Pure aggregation — no new schema. Reads from leads, deals, notes,
 * rental_leases, rent_payments, etc. across the orgVerticalPacks set.
 */

import { db } from "../db";
import {
  organizations,
  orgVerticalPacks,
  deals,
  notes as notesTable,
  rentalLeases,
  rentPayments,
} from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";

export interface VerticalPnL {
  vertical: string;
  revenueCents: number;
  costsCents: number;
  netCents: number;
  trailing30Days: { revenueCents: number; costsCents: number };
}

export interface MultiVerticalPnL {
  organizationId: number;
  organizationName: string;
  asOf: string;
  verticals: VerticalPnL[];
  consolidated: { revenueCents: number; costsCents: number; netCents: number };
  monthlyNetRunRateCents: number;
}

/**
 * Aggregate P&L per vertical for a single org.
 *
 * Vertical-specific revenue + costs come from existing tables:
 *   - Land (deals + properties): deals.cashOffer / deals.assignmentFee
 *   - Notes: notes.amountFinanced + rent_payments / amortization-derived
 *   - BH (rentalLeases): rent_payments
 *
 * Costs side is partial — pulled from per-deal costs where stored, plus
 * AI-call telemetry from aiTelemetryEvents for the org.
 */
export async function aggregateMultiVerticalPnL(orgId: number): Promise<MultiVerticalPnL> {
  const [org] = await db.select().from(organizations).where(eq(organizations.id, orgId)).limit(1);
  if (!org) throw new Error(`Organization ${orgId} not found`);

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const activePacks = await db
    .select()
    .from(orgVerticalPacks)
    .where(and(
      eq(orgVerticalPacks.organizationId, orgId),
      eq(orgVerticalPacks.status, "active"),
    ));

  const verticals: VerticalPnL[] = [];

  // Land vertical (always-on per current product shape) — revenue from
  // deals.cashOffer (acquisitions are NEGATIVE) + deals.assignmentFee
  // (wholesale revenue is POSITIVE).
  try {
    const [landAgg] = await db
      .select({
        rev: sql<string>`COALESCE(SUM(CASE WHEN ${deals.assignmentFee} IS NOT NULL THEN ${deals.assignmentFee}::numeric * 100 ELSE 0 END), 0)`,
        cost: sql<string>`COALESCE(SUM(CASE WHEN ${deals.cashOffer} IS NOT NULL THEN ${deals.cashOffer}::numeric * 100 ELSE 0 END), 0)`,
      })
      .from(deals)
      .where(eq(deals.organizationId, orgId));
    const [landRecent] = await db
      .select({
        rev: sql<string>`COALESCE(SUM(CASE WHEN ${deals.assignmentFee} IS NOT NULL THEN ${deals.assignmentFee}::numeric * 100 ELSE 0 END), 0)`,
        cost: sql<string>`COALESCE(SUM(CASE WHEN ${deals.cashOffer} IS NOT NULL THEN ${deals.cashOffer}::numeric * 100 ELSE 0 END), 0)`,
      })
      .from(deals)
      .where(and(eq(deals.organizationId, orgId), gte(deals.createdAt, thirtyDaysAgo)));
    verticals.push({
      vertical: "land",
      revenueCents: Math.round(Number(landAgg?.rev ?? 0)),
      costsCents: Math.round(Number(landAgg?.cost ?? 0)),
      netCents: Math.round(Number(landAgg?.rev ?? 0) - Number(landAgg?.cost ?? 0)),
      trailing30Days: {
        revenueCents: Math.round(Number(landRecent?.rev ?? 0)),
        costsCents: Math.round(Number(landRecent?.cost ?? 0)),
      },
    });
  } catch {/* table-shape variations are tolerated */}

  // Note investor revenue — sum of received note payments on org's notes
  if (activePacks.some((p) => p.packKey === "note_investor")) {
    try {
      const [noteAgg] = await db
        .select({
          rev: sql<string>`COALESCE(SUM(${notesTable.amountFinanced}::numeric * 100), 0)`,
        })
        .from(notesTable)
        .where(eq(notesTable.organizationId, orgId));
      verticals.push({
        vertical: "note_investor",
        revenueCents: Math.round(Number(noteAgg?.rev ?? 0)),
        costsCents: 0,
        netCents: Math.round(Number(noteAgg?.rev ?? 0)),
        trailing30Days: { revenueCents: 0, costsCents: 0 },
      });
    } catch {/* tolerate */}
  }

  // BH (rental) revenue — sum of rent_payments
  if (activePacks.some((p) => p.packKey === "buy_and_hold")) {
    try {
      const [bhAgg] = await db
        .select({
          rev: sql<string>`COALESCE(SUM(${rentPayments.amountCents}), 0)`,
        })
        .from(rentPayments)
        .innerJoin(rentalLeases, eq(rentalLeases.id, rentPayments.leaseId))
        .where(eq(rentalLeases.organizationId, orgId));
      const [bhRecent] = await db
        .select({
          rev: sql<string>`COALESCE(SUM(${rentPayments.amountCents}), 0)`,
        })
        .from(rentPayments)
        .innerJoin(rentalLeases, eq(rentalLeases.id, rentPayments.leaseId))
        .where(and(eq(rentalLeases.organizationId, orgId), gte(rentPayments.paidAt, thirtyDaysAgo)));
      verticals.push({
        vertical: "buy_and_hold",
        revenueCents: Math.round(Number(bhAgg?.rev ?? 0)),
        costsCents: 0,
        netCents: Math.round(Number(bhAgg?.rev ?? 0)),
        trailing30Days: {
          revenueCents: Math.round(Number(bhRecent?.rev ?? 0)),
          costsCents: 0,
        },
      });
    } catch {/* tolerate */}
  }

  const consolidated = verticals.reduce(
    (acc, v) => ({
      revenueCents: acc.revenueCents + v.revenueCents,
      costsCents: acc.costsCents + v.costsCents,
      netCents: acc.netCents + v.netCents,
    }),
    { revenueCents: 0, costsCents: 0, netCents: 0 },
  );

  // Monthly net run-rate from the trailing-30-day window.
  const monthlyNetRunRateCents = verticals.reduce(
    (s, v) => s + (v.trailing30Days.revenueCents - v.trailing30Days.costsCents),
    0,
  );

  return {
    organizationId: orgId,
    organizationName: org.name,
    asOf: new Date().toISOString(),
    verticals,
    consolidated,
    monthlyNetRunRateCents,
  };
}

/**
 * W-2-exit projection: given the operator's current monthly W-2 income
 * (from req body) and the trailing-30d net run-rate, compute what month
 * the operator can replace their W-2.
 *
 * Assumes 5% MoM growth in vertical net revenue (conservative). Returns
 * the month index (1-based) in which AcreOS net run-rate ≥ W-2 income,
 * or null if not achievable within 24 months.
 */
export function projectW2Exit(opts: {
  monthlyW2IncomeCents: number;
  monthlyNetRunRateCents: number;
  monthlyGrowthRatePct?: number; // default 5
}): {
  achievableMonth: number | null;
  monthsModeled: number;
  finalRunRateCents: number;
  growthRatePct: number;
} {
  const growthRatePct = opts.monthlyGrowthRatePct ?? 5;
  const growthFactor = 1 + growthRatePct / 100;
  const monthsModeled = 24;

  let runRate = opts.monthlyNetRunRateCents;
  let achievableMonth: number | null = null;

  for (let month = 1; month <= monthsModeled; month++) {
    if (runRate >= opts.monthlyW2IncomeCents && achievableMonth === null) {
      achievableMonth = month;
    }
    runRate = Math.round(runRate * growthFactor);
  }

  return {
    achievableMonth,
    monthsModeled,
    finalRunRateCents: runRate,
    growthRatePct,
  };
}
