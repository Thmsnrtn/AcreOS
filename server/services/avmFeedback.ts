/**
 * T43 — AVM Training Data Feedback Loop
 *
 * Every time a deal closes, records:
 *   - What AcreOS AVM predicted vs actual acquisition price
 *   - Prediction accuracy score
 *   - Market and property attributes at time of prediction
 *
 * Aggregates monthly accuracy stats for the founder dashboard.
 * This is how the AVM gets better over time.
 *
 * Call recordAvmOutcome() from the deal-close handler in routes-deals.ts.
 */

import { db } from "../db";
import { valuationPredictions, deals, properties } from "@shared/schema";
import { eq, and, gte, lte, sql, avg, count } from "drizzle-orm";

export interface AvmOutcomeInput {
  orgId: number;
  dealId: number;
  propertyId?: number;
  apn?: string;
  predictedValue: number; // what AVM said before the deal
  actualAcquisitionPrice: number; // what the investor paid
  actualSalePrice?: number; // if already sold/listed
  acreage?: number;
  state?: string;
  county?: string;
  propertyType?: string;
  modelVersion?: string;
}

export interface AvmAccuracyReport {
  period: string;
  totalPredictions: number;
  avgAbsoluteError: number; // avg |predicted - actual| in dollars
  avgPercentageError: number; // avg |(predicted - actual) / actual|
  withinTenPct: number; // % of predictions within 10%
  withinTwentyPct: number;
  overestimateRate: number; // % where predicted > actual
  underestimateRate: number;
  byState: { state: string; avgPctError: number; count: number }[];
}

// ─── Record outcome when a deal closes ───────────────────────────────────────

export async function recordAvmOutcome(input: AvmOutcomeInput): Promise<void> {
  const error = input.predictedValue - input.actualAcquisitionPrice;
  const pctError =
    input.actualAcquisitionPrice > 0
      ? Math.abs(error) / input.actualAcquisitionPrice
      : null;

  await db.insert(valuationPredictions).values({
    organizationId: input.orgId,
    dealId: input.dealId,
    propertyId: input.propertyId,
    apn: input.apn,
    predictedValue: input.predictedValue.toString(),
    actualValue: input.actualAcquisitionPrice.toString(),
    actualSalePrice: input.actualSalePrice?.toString(),
    absoluteError: Math.abs(error).toString(),
    percentageError: pctError?.toString(),
    overestimated: error > 0,
    acreage: input.acreage?.toString(),
    state: input.state,
    county: input.county,
    propertyType: input.propertyType,
    modelVersion: input.modelVersion ?? "v1",
    recordedAt: new Date(),
  });
}

// ─── Monthly accuracy report ──────────────────────────────────────────────────

export async function getAvmAccuracyReport(
  orgId: number | null, // null = platform-wide (founder view)
  months = 6
): Promise<AvmAccuracyReport[]> {
  const fromDate = new Date();
  fromDate.setMonth(fromDate.getMonth() - months);

  const orgFilter = orgId != null ? eq(valuationPredictions.organizationId, orgId) : sql`true`;

  const rows = await db
    .select({
      month: sql<string>`to_char(recorded_at, 'YYYY-MM')`,
      totalPredictions: count(),
      avgAbsError: avg(valuationPredictions.absoluteError),
      avgPctError: avg(valuationPredictions.percentageError),
      overestimateCount: sql<number>`count(*) filter (where overestimated = true)`,
      within10: sql<number>`count(*) filter (where percentage_error <= 0.10)`,
      within20: sql<number>`count(*) filter (where percentage_error <= 0.20)`,
    })
    .from(valuationPredictions)
    .where(and(orgFilter, gte(valuationPredictions.recordedAt, fromDate)))
    .groupBy(sql`to_char(recorded_at, 'YYYY-MM')`)
    .orderBy(sql`to_char(recorded_at, 'YYYY-MM') desc`);

  return rows.map(r => ({
    period: r.month,
    totalPredictions: Number(r.totalPredictions),
    avgAbsoluteError: Number(r.avgAbsError ?? 0),
    avgPercentageError: Number(r.avgPctError ?? 0),
    withinTenPct: r.totalPredictions > 0 ? Number(r.within10) / Number(r.totalPredictions) : 0,
    withinTwentyPct: r.totalPredictions > 0 ? Number(r.within20) / Number(r.totalPredictions) : 0,
    overestimateRate: r.totalPredictions > 0 ? Number(r.overestimateCount) / Number(r.totalPredictions) : 0,
    underestimateRate: r.totalPredictions > 0 ? 1 - Number(r.overestimateCount) / Number(r.totalPredictions) : 0,
    byState: [],
  }));
}

// ─── Per-state breakdown ──────────────────────────────────────────────────────

export async function getAvmAccuracyByState(
  orgId: number | null,
  fromDate?: Date
): Promise<{ state: string; avgPctError: number; count: number }[]> {
  const since = fromDate ?? new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
  const orgFilter = orgId != null ? eq(valuationPredictions.organizationId, orgId) : sql`true`;

  const rows = await db
    .select({
      state: valuationPredictions.state,
      avgPctError: avg(valuationPredictions.percentageError),
      count: count(),
    })
    .from(valuationPredictions)
    .where(
      and(
        orgFilter,
        gte(valuationPredictions.recordedAt, since),
        sql`${valuationPredictions.state} is not null`
      )
    )
    .groupBy(valuationPredictions.state)
    .orderBy(avg(valuationPredictions.percentageError));

  return rows
    .filter(r => r.state)
    .map(r => ({
      state: r.state!,
      avgPctError: Number(r.avgPctError ?? 0),
      count: Number(r.count),
    }));
}
