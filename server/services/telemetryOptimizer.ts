import { db } from "../db";
import { aiTelemetryEvents, aiModelConfigs } from "@shared/schema";
import { invalidateDbModelCache } from "./aiRouter";
import { sql, eq, gte, and } from "drizzle-orm";
import { logger } from "../utils/logger";

// ============================================
// TELEMETRY OPTIMIZER
// Runs nightly to analyze aiTelemetryEvents and update aiModelConfigs weights
// based on empirical performance data (error rate, cost, latency).
// ============================================

type ComplexityTier = "simple" | "moderate" | "complex";

interface ModelStats {
  model: string;
  complexity: ComplexityTier;
  sampleCount: number;
  errorRate: number;
  avgLatencyMs: number;
  avgCostCents: number;
}

interface ModelScore extends ModelStats {
  normalizedCost: number;
  normalizedLatency: number;
  score: number;
}

interface TelemetryOptimizerResult {
  tiersOptimized: number;
  changesApplied: number;
  summary: string[];
}

const COMPLEXITY_TIERS: ComplexityTier[] = ["simple", "moderate", "complex"];
const MIN_SAMPLES = 10;
const LOOKBACK_DAYS = 7;

/**
 * Queries raw aggregated stats from aiTelemetryEvents for the last N days.
 * Returns one row per (model, complexity) combination.
 */
async function queryRawStats(): Promise<ModelStats[]> {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - LOOKBACK_DAYS);

  const rows = await db
    .select({
      model: aiTelemetryEvents.model,
      complexity: aiTelemetryEvents.complexity,
      totalCount: sql<number>`count(*)::int`,
      errorCount: sql<number>`count(*) filter (where ${aiTelemetryEvents.success} = false)::int`,
      avgLatencyMs: sql<number>`avg(${aiTelemetryEvents.latencyMs})::float`,
      avgCostCents: sql<number>`avg(${aiTelemetryEvents.estimatedCostCents}::numeric)::float`,
    })
    .from(aiTelemetryEvents)
    .where(
      and(
        gte(aiTelemetryEvents.createdAt, cutoff),
        sql`${aiTelemetryEvents.cacheHit} = false`, // exclude cache hits — no real perf data
        sql`${aiTelemetryEvents.complexity} is not null`,
      )
    )
    .groupBy(aiTelemetryEvents.model, aiTelemetryEvents.complexity);

  return rows
    .filter(
      (r): r is typeof r & { complexity: ComplexityTier } =>
        r.complexity !== null &&
        COMPLEXITY_TIERS.includes(r.complexity as ComplexityTier)
    )
    .map((r) => ({
      model: r.model,
      complexity: r.complexity as ComplexityTier,
      sampleCount: r.totalCount,
      errorRate: r.totalCount > 0 ? r.errorCount / r.totalCount : 0,
      avgLatencyMs: r.avgLatencyMs ?? 0,
      avgCostCents: r.avgCostCents ?? 0,
    }));
}

/**
 * Normalizes a value within [min, max] to [0, 1].
 * Returns 0 if all values are equal (no spread).
 */
function normalize(value: number, min: number, max: number): number {
  if (max === min) return 0;
  return (value - min) / (max - min);
}

/**
 * Scores models within a single complexity tier.
 * Higher score = better model.
 * score = 1 / (errorRate * 10 + normalizedCost + normalizedLatency)
 */
function scoreModels(statsForTier: ModelStats[]): ModelScore[] {
  if (statsForTier.length === 0) return [];

  const costs = statsForTier.map((s) => s.avgCostCents);
  const latencies = statsForTier.map((s) => s.avgLatencyMs);

  const minCost = Math.min(...costs);
  const maxCost = Math.max(...costs);
  const minLatency = Math.min(...latencies);
  const maxLatency = Math.max(...latencies);

  return statsForTier.map((s) => {
    const normalizedCost = normalize(s.avgCostCents, minCost, maxCost);
    const normalizedLatency = normalize(s.avgLatencyMs, minLatency, maxLatency);
    const denominator = s.errorRate * 10 + normalizedCost + normalizedLatency;
    // Avoid divide-by-zero: if all metrics are perfect, denominator can be 0
    const score = denominator === 0 ? Infinity : 1 / denominator;

    return {
      ...s,
      normalizedCost,
      normalizedLatency,
      score,
    };
  });
}

/**
 * Fetches current aiModelConfigs rows for a given complexity tier.
 * We use taskTypes to identify which configs are associated with which tier.
 * Complexity tiers map to task type patterns stored in aiModelConfigs.taskTypes.
 */
async function getCurrentConfigsForTier(
  tier: ComplexityTier
): Promise<Array<{ id: number; modelId: string; weight: number }>> {
  // All enabled configs — we track by modelId across tiers.
  // The optimizer sets weight=100 for best-in-tier, weight=50 for rest.
  const configs = await db
    .select({
      id: aiModelConfigs.id,
      modelId: aiModelConfigs.modelId,
      weight: aiModelConfigs.weight,
    })
    .from(aiModelConfigs)
    .where(eq(aiModelConfigs.enabled, true));

  return configs.map((c) => ({
    id: c.id,
    modelId: c.modelId,
    weight: c.weight ?? 50,
  }));
}

/**
 * Main optimizer function.
 * Runs nightly, analyzes last 7 days of telemetry, and updates model weights.
 */
export async function runTelemetryOptimizer(): Promise<TelemetryOptimizerResult> {
  logger.info("[telemetry-optimizer] Starting nightly optimization run...");

  const summary: string[] = [];
  let tiersOptimized = 0;
  let changesApplied = 0;

  try {
    // 1. Query raw stats from last 7 days
    const rawStats = await queryRawStats();
    logger.info(`[telemetry-optimizer] Loaded ${rawStats.length} model+complexity data points`);

    if (rawStats.length === 0) {
      const msg = "No telemetry data found in the last 7 days. Skipping optimization.";
      logger.info(`[telemetry-optimizer] ${msg}`);
      return { tiersOptimized: 0, changesApplied: 0, summary: [msg] };
    }

    // 2. Process each complexity tier
    for (const tier of COMPLEXITY_TIERS) {
      const tierStats = rawStats.filter((s) => s.complexity === tier);

      // Filter models with insufficient data
      const qualifiedStats = tierStats.filter((s) => s.sampleCount >= MIN_SAMPLES);

      if (qualifiedStats.length === 0) {
        const msg = `Tier '${tier}': no models with >= ${MIN_SAMPLES} samples. Skipping.`;
        logger.info(`[telemetry-optimizer] ${msg}`);
        summary.push(msg);
        continue;
      }

      tiersOptimized++;

      // 3. Score models for this tier
      const scored = scoreModels(qualifiedStats);
      scored.sort((a, b) => b.score - a.score);

      const winner = scored[0];
      logger.info(`[telemetry-optimizer] Tier '${tier}' winner: ${winner.model} ` +
          `(score=${winner.score.toFixed(4)}, errorRate=${(winner.errorRate * 100).toFixed(1)}%, ` +
          `latency=${winner.avgLatencyMs.toFixed(0)}ms, costCents=${winner.avgCostCents.toFixed(4)})`);

      // 4. Fetch current DB configs
      const currentConfigs = await getCurrentConfigsForTier(tier);
      if (currentConfigs.length === 0) {
        const msg = `Tier '${tier}': no enabled configs in DB. Cannot update weights.`;
        logger.info(`[telemetry-optimizer] ${msg}`);
        summary.push(msg);
        continue;
      }

      // Find the currently highest-weighted config
      const currentBest = currentConfigs.reduce((best, c) =>
        (c.weight ?? 0) > (best.weight ?? 0) ? c : best
      );

      // 5. Check if winner differs from current best in DB
      if (currentBest.modelId === winner.model) {
        const msg = `Tier '${tier}': current best '${winner.model}' already optimal. No change needed.`;
        logger.info(`[telemetry-optimizer] ${msg}`);
        summary.push(msg);
        continue;
      }

      // 6. Apply weight update — winner gets 100, others drop to 50
      const winnerConfig = currentConfigs.find((c) => c.modelId === winner.model);

      if (!winnerConfig) {
        const msg = `Tier '${tier}': winning model '${winner.model}' not found in aiModelConfigs. Cannot promote.`;
        logger.info(`[telemetry-optimizer] ${msg}`);
        summary.push(msg);
        continue;
      }

      // Promote winner
      await db
        .update(aiModelConfigs)
        .set({ weight: 100, updatedAt: new Date() })
        .where(eq(aiModelConfigs.id, winnerConfig.id));

      // Demote all others in the config table
      for (const config of currentConfigs) {
        if (config.id !== winnerConfig.id && (config.weight ?? 0) > 50) {
          await db
            .update(aiModelConfigs)
            .set({ weight: 50, updatedAt: new Date() })
            .where(eq(aiModelConfigs.id, config.id));
        }
      }

      changesApplied++;
      const msg =
        `Tier '${tier}': promoted '${winner.model}' (weight→100), ` +
        `demoted '${currentBest.modelId}' (weight→50). ` +
        `Score: ${winner.score.toFixed(4)} vs prev best score: ${
          scored.find((s) => s.model === currentBest.modelId)?.score.toFixed(4) ?? "n/a"
        }`;
      logger.info(`[telemetry-optimizer] ${msg}`);
      summary.push(msg);
    }

    // 7. Invalidate model cache if any updates were made
    if (changesApplied > 0) {
      invalidateDbModelCache();
      logger.info(`[telemetry-optimizer] DB model cache invalidated after ${changesApplied} change(s).`);
    }

    const finalMsg = `Optimization complete: ${tiersOptimized} tier(s) analyzed, ${changesApplied} update(s) applied.`;
    logger.info(`[telemetry-optimizer] ${finalMsg}`);
    summary.unshift(finalMsg);

    return { tiersOptimized, changesApplied, summary };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    logger.error(`[telemetry-optimizer] Fatal error: ${errMsg}`, err);
    return {
      tiersOptimized,
      changesApplied,
      summary: [`Error during optimization: ${errMsg}`, ...summary],
    };
  }
}

/**
 * Returns raw per-model-per-tier stats for the admin dashboard.
 * Includes score computation for display purposes.
 */
export async function getTelemetryStats(): Promise<{
  stats: ModelStats[];
  scored: Record<ComplexityTier, ModelScore[]>;
  windowDays: number;
  generatedAt: string;
}> {
  const rawStats = await queryRawStats();

  const scored: Record<ComplexityTier, ModelScore[]> = {
    simple: [],
    moderate: [],
    complex: [],
  };

  for (const tier of COMPLEXITY_TIERS) {
    const tierStats = rawStats.filter((s) => s.complexity === tier);
    const qualified = tierStats.filter((s) => s.sampleCount >= MIN_SAMPLES);
    const tierScored = scoreModels(qualified);
    tierScored.sort((a, b) => b.score - a.score);
    scored[tier] = tierScored;
  }

  return {
    stats: rawStats,
    scored,
    windowDays: LOOKBACK_DAYS,
    generatedAt: new Date().toISOString(),
  };
}
