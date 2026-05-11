/**
 * Outcome Calibration Loop — closes the feedback loop between predictions and reality.
 *
 * When a deal closes (won or lost), this service:
 *  1. Records the LCS score at acquisition vs actual outcome
 *  2. Computes confidence intervals for each scoring dimension
 *  3. Runs a backtest accuracy check across recent predictions
 *  4. Calibrates seller intent predictions against actual response rates
 *  5. Adjusts radar scoring weights based on hit rate
 *
 * Called from deal status change webhooks and the weekly calibration cron.
 */

import { db } from "../db";
import {
  deals, properties, leads, landCreditScores, opportunityScores,
  sellerIntentPredictions,
} from "@shared/schema";
import { eq, and, gte, desc, sql, count } from "drizzle-orm";
import { logger } from "../utils/logger";
import { recordScoreOutcome, runWeeklyCalibration, type CalibrationResult } from "./modelCalibration";

// ── Types ───────────────────────────────────────────────────────────

export interface ConfidenceInterval {
  dimension: string;
  mean: number;
  stdDev: number;
  lower95: number;
  upper95: number;
  sampleSize: number;
}

export interface BacktestResult {
  totalPredictions: number;
  correctPredictions: number;
  accuracy: number;
  bucketAccuracy: { bucket: string; predicted: number; actual: number; accuracy: number }[];
  calibrationError: number;
}

export interface SellerIntentCalibration {
  totalPredictions: number;
  respondedCount: number;
  predictedAvgScore: number;
  actualResponseRate: number;
  calibrationDelta: number;
}

export interface RadarCalibration {
  scoreBuckets: { range: string; dealsWon: number; totalDeals: number; hitRate: number }[];
  weightAdjustments: { factor: string; currentWeight: number; suggestedWeight: number }[];
}

export interface FullCalibrationReport {
  lcs: CalibrationResult;
  confidence: ConfidenceInterval[];
  backtest: BacktestResult;
  sellerIntent: SellerIntentCalibration;
  radar: RadarCalibration;
  generatedAt: string;
}

// ── Deal Outcome Recording ──────────────────────────────────────────

export async function onDealClosed(
  orgId: number,
  dealId: number,
  outcome: "won" | "lost"
): Promise<void> {
  try {
    const [deal] = await db.select().from(deals)
      .where(and(eq(deals.id, dealId), eq(deals.organizationId, orgId)))
      .limit(1);
    if (!deal || !deal.propertyId) return;

    // Get LCS at time of acquisition
    const [lcs] = await db.select().from(landCreditScores)
      .where(eq(landCreditScores.propertyId, deal.propertyId))
      .orderBy(desc(landCreditScores.createdAt))
      .limit(1);

    const accepted = parseFloat(deal.acceptedAmount || "0");
    const offer = parseFloat(deal.offerAmount || "0");
    const profit = outcome === "won" ? Math.max(0, accepted - offer) : 0;

    const daysToSell = deal.closingDate && deal.offerDate
      ? Math.ceil((new Date(deal.closingDate).getTime() - new Date(deal.offerDate).getTime()) / 86400000)
      : 0;

    await recordScoreOutcome({
      propertyId: deal.propertyId,
      lcsAtAcquisition: (lcs as any)?.totalScore ?? 0,
      dealOutcome: outcome,
      profit,
      daysToSell,
    });

    logger.info("Deal outcome recorded for calibration", { dealId, outcome, profit });
  } catch (err) {
    logger.error("Failed to record deal outcome", err instanceof Error ? err : undefined);
  }
}

// ── Confidence Intervals ────────────────────────────────────────────

export async function computeConfidenceIntervals(orgId?: number): Promise<ConfidenceInterval[]> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);
  const dimensions = ["location", "physical", "legal", "financial", "environmental", "market"];

  const intervals: ConfidenceInterval[] = [];

  for (const dim of dimensions) {
    // Gather recent LCS scores for this dimension
    const scores = await db.select({
      score: sql<number>`(${landCreditScores.scoreBreakdown}->>${dim})::float`,
    }).from(landCreditScores)
      .where(gte(landCreditScores.createdAt, ninetyDaysAgo))
      .limit(500);

    const values = scores.map(s => s.score).filter(v => v != null && isFinite(v));
    if (values.length < 5) {
      intervals.push({ dimension: dim, mean: 0, stdDev: 0, lower95: 0, upper95: 0, sampleSize: 0 });
      continue;
    }

    const mean = values.reduce((s, v) => s + v, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    const stdDev = Math.sqrt(variance);
    const margin = 1.96 * (stdDev / Math.sqrt(values.length));

    intervals.push({
      dimension: dim,
      mean: parseFloat(mean.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(2)),
      lower95: parseFloat((mean - margin).toFixed(2)),
      upper95: parseFloat((mean + margin).toFixed(2)),
      sampleSize: values.length,
    });
  }

  return intervals;
}

// ── Backtest Accuracy ───────────────────────────────────────────────

export async function runBacktestAccuracy(orgId?: number): Promise<BacktestResult> {
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);

  // Get deals with associated LCS scores
  const closedDeals = await db.select({
    dealId: deals.id,
    status: deals.status,
    propertyId: deals.propertyId,
    offerAmount: deals.offerAmount,
    acceptedAmount: deals.acceptedAmount,
  }).from(deals)
    .where(and(
      gte(deals.updatedAt, sixMonthsAgo),
      sql`${deals.status} IN ('closed', 'cancelled')`
    ))
    .limit(500);

  if (closedDeals.length < 10) {
    return { totalPredictions: closedDeals.length, correctPredictions: 0, accuracy: 0, bucketAccuracy: [], calibrationError: 0 };
  }

  // Bucket by predicted score range and measure actual outcomes
  const buckets = [
    { range: "0-30", min: 0, max: 30, predicted: 0, actual: 0 },
    { range: "31-50", min: 31, max: 50, predicted: 0, actual: 0 },
    { range: "51-70", min: 51, max: 70, predicted: 0, actual: 0 },
    { range: "71-100", min: 71, max: 100, predicted: 0, actual: 0 },
  ];

  let correct = 0;

  for (const deal of closedDeals) {
    if (!deal.propertyId) continue;

    const [lcs] = await db.select().from(landCreditScores)
      .where(eq(landCreditScores.propertyId, deal.propertyId))
      .orderBy(desc(landCreditScores.createdAt))
      .limit(1);

    const score = (lcs as any)?.overallScore ?? 50;
    const isWon = deal.status === "closed";

    const bucket = buckets.find(b => score >= b.min && score <= b.max);
    if (bucket) {
      bucket.predicted++;
      if (isWon) bucket.actual++;
    }

    // "correct" if high score → won OR low score → lost
    if ((score >= 60 && isWon) || (score < 40 && !isWon)) correct++;
  }

  const accuracy = closedDeals.length > 0 ? correct / closedDeals.length : 0;
  const bucketAccuracy = buckets.map(b => ({
    bucket: b.range,
    predicted: b.predicted,
    actual: b.actual,
    accuracy: b.predicted > 0 ? b.actual / b.predicted : 0,
  }));

  // Calibration error: how far predicted win rates differ from actual
  const calibrationError = bucketAccuracy.reduce((sum, b) => {
    const expectedRate = (parseInt(b.bucket.split("-")[0]) + parseInt(b.bucket.split("-")[1])) / 200;
    return sum + Math.abs(b.accuracy - expectedRate) * b.predicted;
  }, 0) / Math.max(closedDeals.length, 1);

  return {
    totalPredictions: closedDeals.length,
    correctPredictions: correct,
    accuracy: parseFloat(accuracy.toFixed(3)),
    bucketAccuracy,
    calibrationError: parseFloat(calibrationError.toFixed(4)),
  };
}

// ── Seller Intent Calibration ───────────────────────────────────────

export async function calibrateSellerIntent(orgId?: number): Promise<SellerIntentCalibration> {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86400000);

  const predictions = await db.select({
    leadId: sellerIntentPredictions.leadId,
    intentScore: sellerIntentPredictions.intentScore,
  }).from(sellerIntentPredictions)
    .where(gte(sellerIntentPredictions.createdAt, sixtyDaysAgo))
    .limit(500);

  if (predictions.length < 10) {
    return { totalPredictions: predictions.length, respondedCount: 0, predictedAvgScore: 0, actualResponseRate: 0, calibrationDelta: 0 };
  }

  // Check which predicted leads actually responded
  let respondedCount = 0;
  const leadIds = predictions.map(p => p.leadId);

  for (const leadId of leadIds) {
    const [lead] = await db.select({ status: leads.status, lastContactedAt: leads.lastContactedAt })
      .from(leads)
      .where(eq(leads.id, leadId))
      .limit(1);

    if (lead && (lead.status === "contacted" || lead.status === "qualified" || lead.status === "converted")) {
      respondedCount++;
    }
  }

  const predictedAvgScore = predictions.reduce((s, p) => s + p.intentScore, 0) / predictions.length;
  const actualResponseRate = respondedCount / predictions.length;
  const calibrationDelta = (predictedAvgScore / 100) - actualResponseRate;

  return {
    totalPredictions: predictions.length,
    respondedCount,
    predictedAvgScore: parseFloat(predictedAvgScore.toFixed(1)),
    actualResponseRate: parseFloat(actualResponseRate.toFixed(3)),
    calibrationDelta: parseFloat(calibrationDelta.toFixed(3)),
  };
}

// ── Radar Calibration ───────────────────────────────────────────────

export async function calibrateRadar(orgId?: number): Promise<RadarCalibration> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 86400000);

  // Get opportunity scores and match against deal outcomes
  const scores = await db.select({
    propertyId: opportunityScores.propertyId,
    totalScore: opportunityScores.totalScore,
  }).from(opportunityScores)
    .where(gte(opportunityScores.createdAt, ninetyDaysAgo))
    .limit(500);

  const buckets = [
    { range: "0-30", min: 0, max: 30, dealsWon: 0, totalDeals: 0 },
    { range: "31-50", min: 31, max: 50, dealsWon: 0, totalDeals: 0 },
    { range: "51-70", min: 51, max: 70, dealsWon: 0, totalDeals: 0 },
    { range: "71-100", min: 71, max: 100, dealsWon: 0, totalDeals: 0 },
  ];

  for (const score of scores) {
    if (!score.propertyId) continue;

    // Check if there's a deal for this property
    const [deal] = await db.select({ status: deals.status })
      .from(deals)
      .where(eq(deals.propertyId, score.propertyId))
      .orderBy(desc(deals.updatedAt))
      .limit(1);

    if (!deal) continue;

    const totalScore = Number(score.totalScore) || 0;
    const bucket = buckets.find(b => totalScore >= b.min && totalScore <= b.max);
    if (bucket) {
      bucket.totalDeals++;
      if (deal.status === "closed") bucket.dealsWon++;
    }
  }

  const scoreBuckets = buckets.map(b => ({
    range: b.range,
    dealsWon: b.dealsWon,
    totalDeals: b.totalDeals,
    hitRate: b.totalDeals > 0 ? parseFloat((b.dealsWon / b.totalDeals).toFixed(3)) : 0,
  }));

  // Suggest weight adjustments based on which factors in high-hit-rate deals differ
  const defaultWeights = {
    priceVsAssessed: 20, daysOnMarket: 15, sellerMotivation: 20,
    marketVelocity: 15, comparableSpreads: 15, environmentalRisk: 5, ownerSignals: 10,
  };

  const weightAdjustments = Object.entries(defaultWeights).map(([factor, weight]) => ({
    factor,
    currentWeight: weight,
    suggestedWeight: weight, // Placeholder — full adjustment requires per-factor outcome data
  }));

  return { scoreBuckets, weightAdjustments };
}

// ── Full Calibration Report ─────────────────────────────────────────

export async function runFullCalibration(orgId?: number): Promise<FullCalibrationReport> {
  const [lcs, confidence, backtest, sellerIntent, radar] = await Promise.all([
    runWeeklyCalibration(orgId),
    computeConfidenceIntervals(orgId),
    runBacktestAccuracy(orgId),
    calibrateSellerIntent(orgId),
    calibrateRadar(orgId),
  ]);

  const report: FullCalibrationReport = {
    lcs,
    confidence,
    backtest,
    sellerIntent,
    radar,
    generatedAt: new Date().toISOString(),
  };

  logger.info("Full calibration report generated", {
    lcsRecords: lcs.recordsAnalyzed,
    backtestAccuracy: backtest.accuracy,
    sellerIntentDelta: sellerIntent.calibrationDelta,
  });

  return report;
}
