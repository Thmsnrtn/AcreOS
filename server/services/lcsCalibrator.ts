// @ts-nocheck
/**
 * LCS Calibrator — adjusts Land Credit Score dimension weights based on
 * empirical correlation between dimension scores and deal profitability.
 *
 * Uses EMA (Exponential Moving Average) to smooth weight adjustments over time.
 */

import { db } from "../db";
import { deals, landCreditScores } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

// ── Types ───────────────────────────────────────────────────────────

interface WeightSnapshot {
  weights: Record<string, number>;
  correlations: Record<string, number>;
  sampleSize: number;
  timestamp: string;
}

interface CalibrationResult {
  weights: Record<string, number>;
  correlations: Record<string, number>;
  sampleSize: number;
  adjusted: boolean;
  reason: string;
}

// ── In-memory state per org ─────────────────────────────────────────

const orgWeights: Map<number, Record<string, number>> = new Map();
const lcsWeightHistory: Map<number, WeightSnapshot[]> = new Map();

const DIMENSIONS = ["location", "physical", "legal", "financial", "environmental", "market"] as const;

const DEFAULT_WEIGHTS: Record<string, number> = {
  location: 25,
  physical: 20,
  legal: 15,
  financial: 20,
  environmental: 10,
  market: 10,
};

const MIN_WEIGHT = 5;
const MAX_WEIGHT = 40;
const MIN_OUTCOMES = 20;
const EMA_ALPHA = 0.1;

// ── Helpers ─────────────────────────────────────────────────────────

function getWeightsForOrg(orgId: number): Record<string, number> {
  if (!orgWeights.has(orgId)) {
    orgWeights.set(orgId, { ...DEFAULT_WEIGHTS });
  }
  return orgWeights.get(orgId)!;
}

function normalizeWeights(weights: Record<string, number>): Record<string, number> {
  const total = Object.values(weights).reduce((s, v) => s + v, 0);
  if (total === 0) return { ...DEFAULT_WEIGHTS };

  const normalized: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    normalized[key] = parseFloat(((weights[key] / total) * 100).toFixed(2));
  }
  return normalized;
}

function clampWeights(weights: Record<string, number>): Record<string, number> {
  const clamped: Record<string, number> = {};
  for (const key of Object.keys(weights)) {
    clamped[key] = Math.max(MIN_WEIGHT, Math.min(MAX_WEIGHT, weights[key]));
  }
  return clamped;
}

function pearsonCorrelation(xs: number[], ys: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;

  const meanX = xs.reduce((s, v) => s + v, 0) / n;
  const meanY = ys.reduce((s, v) => s + v, 0) / n;

  let numerator = 0;
  let denomX = 0;
  let denomY = 0;

  for (let i = 0; i < n; i++) {
    const dx = xs[i] - meanX;
    const dy = ys[i] - meanY;
    numerator += dx * dy;
    denomX += dx * dx;
    denomY += dy * dy;
  }

  const denom = Math.sqrt(denomX * denomY);
  if (denom === 0) return 0;

  return numerator / denom;
}

// ── Core Calibration ────────────────────────────────────────────────

export async function runLcsCalibration(orgId: number): Promise<CalibrationResult> {
  const currentWeights = getWeightsForOrg(orgId);

  try {
    // Query closed deals with associated LCS scores
    const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);

    const closedDeals = await db.select({
      dealId: deals.id,
      propertyId: deals.propertyId,
      offerAmount: deals.offerAmount,
      acceptedAmount: deals.acceptedAmount,
    }).from(deals)
      .where(and(
        eq(deals.organizationId, orgId),
        gte(deals.updatedAt, sixMonthsAgo),
        sql`${deals.status} IN ('closed', 'closed_won')`,
      ))
      .limit(500);

    if (closedDeals.length < MIN_OUTCOMES) {
      return {
        weights: currentWeights,
        correlations: {},
        sampleSize: closedDeals.length,
        adjusted: false,
        reason: `Need ${MIN_OUTCOMES}+ outcome records, have ${closedDeals.length}`,
      };
    }

    // For each deal, get the LCS dimension scores and profitability
    const dimensionScores: Record<string, number[]> = {};
    const profitValues: number[] = [];

    for (const dim of DIMENSIONS) {
      dimensionScores[dim] = [];
    }

    for (const deal of closedDeals) {
      if (!deal.propertyId) continue;

      const [lcs] = await db.select().from(landCreditScores)
        .where(eq(landCreditScores.propertyId, deal.propertyId))
        .orderBy(desc(landCreditScores.createdAt))
        .limit(1);

      if (!lcs) continue;

      const factors = (lcs as any).factors || (lcs as any).scoreBreakdown || {};
      const accepted = parseFloat(deal.acceptedAmount || "0");
      const offer = parseFloat(deal.offerAmount || "0");
      const profit = accepted > 0 && offer > 0 ? accepted - offer : 0;

      let hasAllDims = true;
      for (const dim of DIMENSIONS) {
        const dimData = factors[dim];
        const score = dimData?.score ?? null;
        if (score == null) {
          hasAllDims = false;
          break;
        }
      }

      if (!hasAllDims) continue;

      profitValues.push(profit);
      for (const dim of DIMENSIONS) {
        dimensionScores[dim].push(factors[dim]?.score ?? 50);
      }
    }

    if (profitValues.length < MIN_OUTCOMES) {
      return {
        weights: currentWeights,
        correlations: {},
        sampleSize: profitValues.length,
        adjusted: false,
        reason: `Only ${profitValues.length} records with full dimension data (need ${MIN_OUTCOMES})`,
      };
    }

    // Compute correlations and adjust weights
    const correlations: Record<string, number> = {};
    const empiricalWeights: Record<string, number> = {};

    for (const dim of DIMENSIONS) {
      const corr = pearsonCorrelation(dimensionScores[dim], profitValues);
      correlations[dim] = parseFloat(corr.toFixed(4));

      // Determine empirical weight adjustment
      const absCorr = Math.abs(corr);
      let adjustment = 0;
      if (absCorr < 0.1) {
        adjustment = -2; // Low correlation: reduce weight
      } else if (absCorr > 0.5) {
        adjustment = 2; // High correlation: increase weight
      }

      empiricalWeights[dim] = currentWeights[dim] + adjustment;
    }

    // Apply EMA: new_weight = 0.9 * old_weight + 0.1 * empirical_weight
    const newWeights: Record<string, number> = {};
    for (const dim of DIMENSIONS) {
      newWeights[dim] = (1 - EMA_ALPHA) * currentWeights[dim] + EMA_ALPHA * empiricalWeights[dim];
    }

    // Clamp and normalize
    const clamped = clampWeights(newWeights);
    const normalized = normalizeWeights(clamped);

    // Store
    orgWeights.set(orgId, normalized);

    // Record history
    if (!lcsWeightHistory.has(orgId)) {
      lcsWeightHistory.set(orgId, []);
    }
    const history = lcsWeightHistory.get(orgId)!;
    history.push({
      weights: { ...normalized },
      correlations: { ...correlations },
      sampleSize: profitValues.length,
      timestamp: new Date().toISOString(),
    });

    // Keep last 50 snapshots
    if (history.length > 50) {
      history.splice(0, history.length - 50);
    }

    logger.info("LCS calibration completed", {
      orgId,
      sampleSize: profitValues.length,
      correlations,
      newWeights: normalized,
    });

    return {
      weights: normalized,
      correlations,
      sampleSize: profitValues.length,
      adjusted: true,
      reason: "Weights calibrated based on outcome correlations",
    };
  } catch (err) {
    logger.error("LCS calibration failed", err instanceof Error ? err : undefined);
    return {
      weights: currentWeights,
      correlations: {},
      sampleSize: 0,
      adjusted: false,
      reason: `Calibration error: ${err instanceof Error ? err.message : "unknown"}`,
    };
  }
}

export function getCurrentWeights(orgId: number): {
  weights: Record<string, number>;
  history: WeightSnapshot[];
  lastUpdated: string | null;
} {
  const weights = getWeightsForOrg(orgId);
  const history = lcsWeightHistory.get(orgId) || [];
  const lastUpdated = history.length > 0 ? history[history.length - 1].timestamp : null;

  return { weights, history, lastUpdated };
}
