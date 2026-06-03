/**
 * IRIS — continuous p95 baseline + regression detector.
 *
 * Two entrypoints:
 *
 *   1. samplePerformance()
 *      Drains the in-process response-time ring (server/middleware/
 *      responseTimeRing.ts), computes p50/p95/p99/sample_count per
 *      tracked endpoint, persists one iris_perf_samples row per
 *      non-empty drain. Routes with zero observations in the window
 *      are skipped (no row inserted) — that's the right semantics for
 *      a healthcheck route that wasn't hit, and it also keeps the
 *      regression detector honest (it should not compare against a
 *      synthesized zero).
 *
 *   2. detectRegression(windowHours)
 *      For each tracked endpoint, compares the most-recent window's p95
 *      against the rolling 7d baseline p95 (median-of-windows). Fires
 *      a finding (returned + logged at warn level) when:
 *         p95 > baselineMultiplier × baseline_p95   OR
 *         p95 > absoluteCeilingMs
 *      …AND the latest window has at least minSampleCountForAlert
 *      observations (don't trip on a single slow request).
 *
 *  No DB schema changes for the detector — the alert is logger.warn +
 *  a returned summary the cron caller can hand to a future Sentry hook.
 *  The persisted ledger (iris_perf_samples) is the source of truth.
 */

import { and, desc, gte, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  irisPerfSamples,
  IRIS_TRACKED_ENDPOINTS,
  IRIS_REGRESSION_THRESHOLDS,
  type InsertIrisPerfSample,
} from "@shared/schema/iris-perf";
import { drainRings } from "../../middleware/responseTimeRing";
import { logger } from "../../utils/logger";

// ============================================================================
// samplePerformance — drain + persist
// ============================================================================

export interface SamplePerformanceResult {
  windowsPersisted: number;
  endpointsScanned: number;
  totalObservations: number;
}

export async function samplePerformance(
  now: Date = new Date(),
): Promise<SamplePerformanceResult> {
  const snapshots = drainRings(now);
  let totalObservations = 0;
  let windowsPersisted = 0;

  for (const snap of snapshots) {
    if (snap.durations.length === 0) continue;
    const { p50, p95, p99 } = computePercentiles(snap.durations);
    const row: InsertIrisPerfSample = {
      endpointPath: snap.endpointPath,
      method: snap.method,
      p50Ms: String(p50),
      p95Ms: String(p95),
      p99Ms: String(p99),
      sampleCount: snap.durations.length,
      windowStartedAt: snap.windowStartedAt,
      windowEndedAt: snap.windowEndedAt,
    };
    try {
      await db.insert(irisPerfSamples).values(row);
      windowsPersisted++;
      totalObservations += snap.durations.length;
    } catch (err) {
      logger.warn(
        `[irisPerf] failed to persist sample for ${snap.method} ${snap.endpointPath}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  return {
    windowsPersisted,
    endpointsScanned: IRIS_TRACKED_ENDPOINTS.length,
    totalObservations,
  };
}

// ============================================================================
// detectRegression — compare latest window vs rolling 7d baseline
// ============================================================================

export interface PerfRegression {
  endpointPath: string;
  method: string;
  latestP95Ms: number;
  baselineP95Ms: number;
  baselineWindowCount: number;
  latestSampleCount: number;
  ratio: number;
  triggeredBy: "multiplier" | "absolute" | "both";
  windowEndedAt: Date;
}

export interface DetectRegressionResult {
  regressions: PerfRegression[];
  endpointsChecked: number;
  endpointsSkippedNoBaseline: number;
}

export async function detectRegression(
  windowHours: number = IRIS_REGRESSION_THRESHOLDS.baselineWindowHours,
): Promise<DetectRegressionResult> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const regressions: PerfRegression[] = [];
  let endpointsChecked = 0;
  let endpointsSkippedNoBaseline = 0;

  for (const endpoint of IRIS_TRACKED_ENDPOINTS) {
    endpointsChecked++;
    const rows = await db
      .select()
      .from(irisPerfSamples)
      .where(
        and(
          eq(irisPerfSamples.endpointPath, endpoint.path),
          eq(irisPerfSamples.method, endpoint.method),
          gte(irisPerfSamples.windowStartedAt, cutoff),
        ),
      )
      .orderBy(desc(irisPerfSamples.windowStartedAt));

    // Need at least one baseline window (the prior window) plus the
    // current window to make a comparison.
    if (rows.length < 2) {
      endpointsSkippedNoBaseline++;
      continue;
    }

    const [latest, ...prior] = rows;
    const latestP95 = Number(latest.p95Ms);
    const latestSampleCount = latest.sampleCount;
    if (latestSampleCount < IRIS_REGRESSION_THRESHOLDS.minSampleCountForAlert) {
      continue;
    }
    const baselineP95 = medianOf(prior.map((r) => Number(r.p95Ms)));
    const reg = evaluateRegression({
      latestP95,
      baselineP95,
      latestSampleCount,
    });
    if (reg) {
      regressions.push({
        endpointPath: endpoint.path,
        method: endpoint.method,
        latestP95Ms: latestP95,
        baselineP95Ms: baselineP95,
        baselineWindowCount: prior.length,
        latestSampleCount,
        ratio: baselineP95 > 0 ? latestP95 / baselineP95 : Infinity,
        triggeredBy: reg,
        windowEndedAt: latest.windowEndedAt,
      });
      logger.warn(
        `[irisPerf] regression on ${endpoint.method} ${endpoint.path}: ` +
          `latest p95=${latestP95.toFixed(0)}ms ` +
          `baseline=${baselineP95.toFixed(0)}ms ` +
          `ratio=${(latestP95 / Math.max(baselineP95, 1)).toFixed(2)} ` +
          `trigger=${reg}`,
      );
    }
  }

  return {
    regressions,
    endpointsChecked,
    endpointsSkippedNoBaseline,
  };
}

/**
 * Decide whether the latest window is a regression, and which threshold
 * fired. Exported for direct unit testing without DB.
 */
export function evaluateRegression(input: {
  latestP95: number;
  baselineP95: number;
  latestSampleCount: number;
}): PerfRegression["triggeredBy"] | null {
  const { latestP95, baselineP95, latestSampleCount } = input;
  if (latestSampleCount < IRIS_REGRESSION_THRESHOLDS.minSampleCountForAlert) {
    return null;
  }
  const multiplierThreshold =
    baselineP95 * IRIS_REGRESSION_THRESHOLDS.baselineMultiplier;
  const overMultiplier = baselineP95 > 0 && latestP95 > multiplierThreshold;
  const overAbsolute =
    latestP95 > IRIS_REGRESSION_THRESHOLDS.absoluteCeilingMs;
  if (overMultiplier && overAbsolute) return "both";
  if (overMultiplier) return "multiplier";
  if (overAbsolute) return "absolute";
  return null;
}

// ============================================================================
// PERCENTILE HELPERS — exported for unit tests
// ============================================================================

/**
 * Compute p50, p95, p99 from a list of observations. Uses the
 * nearest-rank percentile (the simplest definition; OK for cron-level
 * trend tracking — Iris isn't paying for the difference between this and
 * a linear-interpolation method). The list is copied before sorting so
 * the caller's array stays untouched.
 */
export function computePercentiles(observations: number[]): {
  p50: number;
  p95: number;
  p99: number;
} {
  if (observations.length === 0) {
    return { p50: 0, p95: 0, p99: 0 };
  }
  const sorted = [...observations].sort((a, b) => a - b);
  return {
    p50: nearestRank(sorted, 50),
    p95: nearestRank(sorted, 95),
    p99: nearestRank(sorted, 99),
  };
}

function nearestRank(sorted: number[], percentile: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  // ceil(p/100 × n) gives 1-based rank; clamp to [1, n].
  const rank = Math.min(n, Math.max(1, Math.ceil((percentile / 100) * n)));
  return sorted[rank - 1];
}

export function medianOf(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid];
  return (sorted[mid - 1] + sorted[mid]) / 2;
}

// ============================================================================
// FOUNDER ENDPOINT QUERY HELPERS
// ============================================================================

/**
 * Pull the last `hours` of samples for the founder endpoint. Returned
 * grouped by endpoint for client-side rendering convenience.
 */
export async function getRecentSamples(hours: number = 48): Promise<{
  byEndpoint: Record<
    string,
    {
      path: string;
      method: string;
      samples: Array<{
        windowStartedAt: Date;
        windowEndedAt: Date;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        sampleCount: number;
      }>;
    }
  >;
  totalSamples: number;
}> {
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);
  const rows = await db
    .select()
    .from(irisPerfSamples)
    .where(gte(irisPerfSamples.windowStartedAt, cutoff))
    .orderBy(desc(irisPerfSamples.windowStartedAt));

  const byEndpoint: Record<
    string,
    {
      path: string;
      method: string;
      samples: Array<{
        windowStartedAt: Date;
        windowEndedAt: Date;
        p50Ms: number;
        p95Ms: number;
        p99Ms: number;
        sampleCount: number;
      }>;
    }
  > = {};
  for (const r of rows) {
    const key = `${r.method} ${r.endpointPath}`;
    if (!byEndpoint[key]) {
      byEndpoint[key] = {
        path: r.endpointPath,
        method: r.method,
        samples: [],
      };
    }
    byEndpoint[key].samples.push({
      windowStartedAt: r.windowStartedAt,
      windowEndedAt: r.windowEndedAt,
      p50Ms: Number(r.p50Ms),
      p95Ms: Number(r.p95Ms),
      p99Ms: Number(r.p99Ms),
      sampleCount: r.sampleCount,
    });
  }
  // Silence the unused-import warning when this helper is used only
  // by the perfMonitor cron path.
  void sql;
  return { byEndpoint, totalSamples: rows.length };
}
