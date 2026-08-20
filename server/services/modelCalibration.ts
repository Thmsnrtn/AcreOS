/**
 * ML Model Calibration — closes the training loop.
 * Conservative: 10% influence per week via exponential moving average.
 */

import { db } from "../db";
import { deals, properties } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface ScoreOutcome {
  propertyId: number;
  lcsAtAcquisition: number;
  dealOutcome: "won" | "lost";
  profit: number;
  daysToSell: number;
  /** Owning org — outcomes feed the org's own calibration. */
  organizationId?: number;
}

export interface CalibrationResult {
  recordsAnalyzed: number;
  lcsCorrelation: number;
  adjustments: { dimension: string; oldWeight: number; newWeight: number }[];
  timestamp: Date;
}

export async function recordScoreOutcome(outcome: ScoreOutcome): Promise<void> {
  // S2b — this was a log-only no-op: nothing was written anywhere, so the
  // outcome side of the LCS learning loop silently discarded every closed
  // deal. Outcomes now persist as `lcs_outcome` rows in model_calibration_log
  // (the calibration ledger), giving the loop an inspectable trail. The
  // calibrator itself re-derives outcomes from deals + scores at run time —
  // this row is the explicit event record, not a second source of truth.
  try {
    const { modelCalibrationLog } = await import("@shared/schema");
    await db.insert(modelCalibrationLog).values({
      organizationId: outcome.organizationId ?? null,
      modelName: "lcs_outcome",
      weights: {
        lcsAtAcquisition: outcome.lcsAtAcquisition,
        profit: outcome.profit,
        daysToSell: outcome.daysToSell,
        won: outcome.dealOutcome === "won" ? 1 : 0,
        propertyId: outcome.propertyId,
      },
      sampleSize: 1,
      adjusted: false,
      reason: `deal ${outcome.dealOutcome} — property ${outcome.propertyId}`,
    });
  } catch (err) {
    logger.error("Failed to persist score outcome", err instanceof Error ? err : undefined);
  }
  logger.info("Score outcome recorded", {
    propertyId: outcome.propertyId,
    lcs: outcome.lcsAtAcquisition,
    outcome: outcome.dealOutcome,
    profit: outcome.profit,
  });
}

export async function runWeeklyCalibration(orgId: number): Promise<CalibrationResult> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);

  // Get closed deals from last 90 days
  // SCOPED. `orgId` was optional and referenced nowhere in this body, so the
  // sweep ran platform-wide while `/api/ml/calibration-report` — reachable by
  // any authenticated tenant user — returned the result as that org's own
  // calibration. This is the fifth entry point of the calibration set; the other
  // four live in outcomeCalibrationLoop.ts and were fixed first. Fixing four of
  // five is why the parameter is now required rather than defaulted.
  const closedDeals = await db.select().from(deals)
    .where(and(
      eq(deals.organizationId, orgId),
      gte(deals.updatedAt, ninetyDaysAgo),
      sql`${deals.status} IN ('closed', 'cancelled')`
    ))
    .limit(500);

  if (closedDeals.length < 5) {
    return {
      recordsAnalyzed: closedDeals.length,
      lcsCorrelation: 0,
      adjustments: [],
      timestamp: new Date(),
    };
  }

  // Compute correlation between deal outcomes and scores
  const wonDeals = closedDeals.filter(d => d.status === "closed");
  const lostDeals = closedDeals.filter(d => d.status === "cancelled");

  const avgWonAmount = wonDeals.length > 0
    ? wonDeals.reduce((s, d) => s + parseFloat(d.acceptedAmount || "0"), 0) / wonDeals.length
    : 0;
  const avgLostAmount = lostDeals.length > 0
    ? lostDeals.reduce((s, d) => s + parseFloat(d.offerAmount || "0"), 0) / lostDeals.length
    : 0;

  // Simplified correlation metric
  const correlation = wonDeals.length > 0 && lostDeals.length > 0
    ? (avgWonAmount - avgLostAmount) / Math.max(avgWonAmount, avgLostAmount, 1)
    : 0;

  // EMA weight adjustments (conservative — 10% influence)
  const EMA_ALPHA = 0.1;
  const currentWeights = {
    location: 25, physical: 20, legal: 15,
    financial: 20, environmental: 10, market: 10,
  };

  const adjustments = Object.entries(currentWeights).map(([dim, weight]) => {
    // Empirical weight: slightly adjust based on which dimensions correlate with wins
    const empiricalWeight = weight * (1 + correlation * 0.05);
    const newWeight = Math.round((1 - EMA_ALPHA) * weight + EMA_ALPHA * empiricalWeight);
    return { dimension: dim, oldWeight: weight, newWeight };
  });

  logger.info("Weekly calibration complete", {
    records: closedDeals.length,
    correlation: correlation.toFixed(3),
    adjustments: adjustments.filter(a => a.oldWeight !== a.newWeight).length,
  });

  return {
    recordsAnalyzed: closedDeals.length,
    lcsCorrelation: parseFloat(correlation.toFixed(4)),
    adjustments,
    timestamp: new Date(),
  };
}
