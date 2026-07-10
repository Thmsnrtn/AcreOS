/**
 * LCS Calibrator — adjusts Land Credit Score dimension weights based on
 * empirical correlation between dimension scores and deal profitability.
 *
 * Uses EMA (Exponential Moving Average) to smooth weight adjustments over time.
 */

import { db } from "../db";
import { deals, landCreditScores, modelCalibrationLog } from "@shared/schema";
import { eq, and, gte, desc, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { raiseAlert } from "./alertSpine";

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
//
// These Maps are a hot cache ONLY. The durable record is the
// model_calibration_log table (Tier 2A): every adjusted calibration run
// persists a weight snapshot, and on first access after a deploy we
// hydrate from the latest persisted rows — so calibration learned over
// months is no longer erased by a restart.

const orgWeights: Map<number, Record<string, number>> = new Map();
const lcsWeightHistory: Map<number, WeightSnapshot[]> = new Map();
const hydratedOrgs: Set<number> = new Set();

const MODEL_NAME = "lcs_calibrator";
const HISTORY_LIMIT = 50;

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

/**
 * Hydrate the in-memory cache from model_calibration_log on first access
 * per org per process. Latest persisted snapshot = live weights; the last
 * HISTORY_LIMIT rows rebuild the history. Failure-tolerant: a read error
 * falls back to defaults (and logs) rather than blocking scoring.
 */
async function ensureHydrated(orgId: number): Promise<void> {
  if (hydratedOrgs.has(orgId)) return;
  hydratedOrgs.add(orgId);
  try {
    const rows = await db
      .select()
      .from(modelCalibrationLog)
      .where(and(
        eq(modelCalibrationLog.organizationId, orgId),
        eq(modelCalibrationLog.modelName, MODEL_NAME),
      ))
      .orderBy(desc(modelCalibrationLog.createdAt))
      .limit(HISTORY_LIMIT);

    if (rows.length === 0) return;

    // rows are newest-first; history is stored oldest-first.
    const chronological = [...rows].reverse();
    const history: WeightSnapshot[] = chronological.map((r) => ({
      weights: (r.weights ?? {}) as Record<string, number>,
      correlations: (r.correlations ?? {}) as Record<string, number>,
      sampleSize: r.sampleSize ?? 0,
      timestamp: (r.createdAt instanceof Date ? r.createdAt : new Date(r.createdAt as any)).toISOString(),
    }));
    lcsWeightHistory.set(orgId, history);

    const latest = rows[0];
    if (latest.weights && Object.keys(latest.weights).length > 0) {
      orgWeights.set(orgId, { ...(latest.weights as Record<string, number>) });
    }
  } catch (err) {
    logger.warn("LCS calibrator hydration failed — using defaults until next calibration", {
      metadata: { orgId, error: err instanceof Error ? err.message : String(err) },
    });
  }
}

/**
 * Persist a calibration snapshot. On failure, raises a warning-severity
 * alert — a silent persist failure means the next deploy silently erases
 * learned weights, which is exactly the failure mode Tier 2A closes.
 */
async function persistSnapshot(orgId: number, result: CalibrationResult): Promise<void> {
  try {
    await db.insert(modelCalibrationLog).values({
      organizationId: orgId,
      modelName: MODEL_NAME,
      weights: result.weights,
      correlations: result.correlations,
      sampleSize: result.sampleSize,
      adjusted: result.adjusted,
      reason: result.reason,
    });
  } catch (err) {
    logger.error("LCS calibration persist failed", err instanceof Error ? err : undefined);
    await raiseAlert({
      severity: "warning",
      source: "lcs_calibrator",
      title: "LCS calibration snapshot persist failed",
      detail: `Calibrated weights for org ${orgId} could not be written to model_calibration_log; they will be lost on next deploy. Error: ${err instanceof Error ? err.message : String(err)}`,
      dedupeKey: `persist_failed:${orgId}`,
      organizationId: orgId,
      metadata: { sampleSize: result.sampleSize },
    }).catch(() => {});
  }
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

/**
 * Weekly sweep (S2d): run calibration for every org that closed a deal in
 * the window. Until now runLcsCalibration was reachable ONLY through the
 * manual /api/ml route, so calibration never actually ran on real cadence.
 * Per-org failures are isolated — one bad org never stops the sweep.
 */
export async function runLcsCalibrationSweep(): Promise<{ orgsSwept: number; adjusted: number }> {
  const sixMonthsAgo = new Date(Date.now() - 180 * 86400000);
  const rows = await db
    .selectDistinct({ organizationId: deals.organizationId })
    .from(deals)
    .where(and(gte(deals.updatedAt, sixMonthsAgo), sql`${deals.status} IN ('closed', 'closed_won', 'dead', 'cancelled')`));
  let adjusted = 0;
  for (const row of rows) {
    if (!row.organizationId) continue;
    try {
      const result = await runLcsCalibration(row.organizationId);
      if (result.adjusted) adjusted++;
    } catch (err) {
      logger.warn("[lcs-calibrator] sweep: org calibration failed", {
        metadata: { organizationId: row.organizationId, error: err instanceof Error ? err.message : String(err) },
      });
    }
  }
  logger.info("[lcs-calibrator] weekly sweep complete", { metadata: { orgsSwept: rows.length, adjusted } });
  return { orgsSwept: rows.length, adjusted };
}

export async function runLcsCalibration(orgId: number): Promise<CalibrationResult> {
  await ensureHydrated(orgId);
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

      // S2a: canonical rows persist factors INSIDE scoreBreakdown (with
      // numeric top-level dims beside it); accept the legacy shapes too.
      const breakdown = ((lcs as any).scoreBreakdown ?? {}) as Record<string, unknown>;
      const factors = ((breakdown.factors as Record<string, unknown>) ?? (lcs as any).factors ?? breakdown) as Record<string, any>;
      const accepted = parseFloat(deal.acceptedAmount || "0");
      const offer = parseFloat(deal.offerAmount || "0");
      const profit = accepted > 0 && offer > 0 ? accepted - offer : 0;

      const dimScore = (dim: string): number | null => {
        const d = factors[dim];
        if (typeof d === "number" && Number.isFinite(d)) return d;
        const sc = d?.score;
        return typeof sc === "number" && Number.isFinite(sc) ? sc : null;
      };

      let hasAllDims = true;
      for (const dim of DIMENSIONS) {
        if (dimScore(dim) == null) {
          hasAllDims = false;
          break;
        }
      }

      if (!hasAllDims) continue;

      profitValues.push(profit);
      for (const dim of DIMENSIONS) {
        dimensionScores[dim].push(dimScore(dim) ?? 50);
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
    if (history.length > HISTORY_LIMIT) {
      history.splice(0, history.length - HISTORY_LIMIT);
    }

    logger.info("LCS calibration completed", {
      orgId,
      sampleSize: profitValues.length,
      correlations,
      newWeights: normalized,
    });

    const result: CalibrationResult = {
      weights: normalized,
      correlations,
      sampleSize: profitValues.length,
      adjusted: true,
      reason: "Weights calibrated based on outcome correlations",
    };

    // Durable record — survives deploys (Tier 2A).
    await persistSnapshot(orgId, result);

    return result;
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

export async function getCurrentWeights(orgId: number): Promise<{
  weights: Record<string, number>;
  history: WeightSnapshot[];
  lastUpdated: string | null;
}> {
  await ensureHydrated(orgId);
  const weights = getWeightsForOrg(orgId);
  const history = lcsWeightHistory.get(orgId) || [];
  const lastUpdated = history.length > 0 ? history[history.length - 1].timestamp : null;

  return { weights, history, lastUpdated };
}
