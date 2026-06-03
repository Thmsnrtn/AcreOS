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

import { and, desc, gte, eq, inArray, like, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  irisPerfSamples,
  IRIS_TRACKED_ENDPOINTS,
  IRIS_REGRESSION_THRESHOLDS,
  type InsertIrisPerfSample,
} from "@shared/schema/iris-perf";
import { soleneDispatchQueue } from "@shared/schema/solene-dispatch";
import { drainRings } from "../../middleware/responseTimeRing";
import { enqueueDispatch } from "../solene/dispatchQueue";
import { logger } from "../../utils/logger";

/**
 * Severity mapping for a triggered regression. The detector → dispatch
 * auto-enqueue gate is `severity >= medium`, so any time a regression fires
 * we have at least medium severity. We keep an explicit ladder so a future
 * Sentry / pager hook can route by it without re-deriving from triggeredBy.
 *
 *   "multiplier"  → medium   (latency doubled but still under absolute ceiling)
 *   "absolute"    → high     (1s+ crossed — user-visible)
 *   "both"        → high     (doubled AND crossed the ceiling)
 */
export type PerfRegressionSeverity = "low" | "medium" | "high";

export function severityFromTrigger(
  trigger: PerfRegression["triggeredBy"],
): PerfRegressionSeverity {
  if (trigger === "absolute" || trigger === "both") return "high";
  return "medium";
}

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
  severity: PerfRegressionSeverity;
  /**
   * How many consecutive most-recent windows ALSO fired a regression. 1 means
   * "only the latest window"; 2+ means the regression has persisted past a
   * single noisy window and is safe to auto-dispatch a fix for.
   */
  persistedWindowCount: number;
  windowEndedAt: Date;
}

export interface DetectRegressionResult {
  regressions: PerfRegression[];
  endpointsChecked: number;
  endpointsSkippedNoBaseline: number;
  /** Number of regressions that triggered an auto-dispatch enqueue. */
  dispatchesEnqueued: number;
}

/**
 * Minimum number of consecutive sampling windows a regression must persist
 * across before we auto-enqueue a fix dispatch. Set to 2 to avoid flapping
 * on a single noisy window — one cron tick of bad p95 is a blip, two in a
 * row is a real regression.
 */
export const PERSISTENCE_WINDOWS_REQUIRED = 2;

/**
 * Per-dispatch cap for an auto-enqueued perf-regression fix. $20 because
 * the fix is scoped (one endpoint, one root-cause) and we'd rather an
 * out-of-budget run escalate to Solene than burn through the $100 ceiling
 * silently.
 */
export const PERF_REGRESSION_DISPATCH_MAX_COST_USD = 20;
export const PERF_REGRESSION_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000;
/** Higher than auto-dispatch (1.0), below founder-bypass (3.0). */
export const PERF_REGRESSION_DISPATCH_PRIORITY = 1.5;

export async function detectRegression(
  windowHours: number = IRIS_REGRESSION_THRESHOLDS.baselineWindowHours,
): Promise<DetectRegressionResult> {
  const cutoff = new Date(Date.now() - windowHours * 60 * 60 * 1000);
  const regressions: PerfRegression[] = [];
  let endpointsChecked = 0;
  let endpointsSkippedNoBaseline = 0;
  let dispatchesEnqueued = 0;

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
    if (!reg) continue;

    // ---- Persistence check ------------------------------------------------
    // The latest window fired. To distinguish a one-tick blip from a real
    // regression we require the immediately-prior window to have ALSO fired
    // against ITS rolling baseline (rows[2..]). Without this guard a single
    // burst of slow requests would auto-dispatch a fix the next tick can't
    // even reproduce.
    const persistedWindowCount = countConsecutivePersistence(rows);

    const severity = severityFromTrigger(reg);

    const regression: PerfRegression = {
      endpointPath: endpoint.path,
      method: endpoint.method,
      latestP95Ms: latestP95,
      baselineP95Ms: baselineP95,
      baselineWindowCount: prior.length,
      latestSampleCount,
      ratio: baselineP95 > 0 ? latestP95 / baselineP95 : Infinity,
      triggeredBy: reg,
      severity,
      persistedWindowCount,
      windowEndedAt: latest.windowEndedAt,
    };
    regressions.push(regression);

    logger.warn(
      `[irisPerf] regression on ${endpoint.method} ${endpoint.path}: ` +
        `latest p95=${latestP95.toFixed(0)}ms ` +
        `baseline=${baselineP95.toFixed(0)}ms ` +
        `ratio=${(latestP95 / Math.max(baselineP95, 1)).toFixed(2)} ` +
        `trigger=${reg} severity=${severity} persisted=${persistedWindowCount}`,
    );

    // ---- Auto-dispatch gate ----------------------------------------------
    // severity >= medium AND persisted across the required window count.
    // medium-or-above is satisfied by any triggered regression (the
    // severity ladder starts at medium when reg !== null) — keep the check
    // explicit so the policy is reviewable without re-reading the helper.
    const meetsSeverityGate =
      severity === "medium" || severity === "high";
    if (!meetsSeverityGate) continue;
    if (persistedWindowCount < PERSISTENCE_WINDOWS_REQUIRED) continue;

    // baselineId — the id of the oldest row that fed the rolling baseline.
    // It's stable across consecutive ticks until the rolling-window cutoff
    // drops it, which is exactly the dedupe key we want for sourceId.
    const baselineId = prior[prior.length - 1]?.id ?? latest.id;
    const recentSampleIds = rows.slice(0, 4).map((r) => r.id);

    const enqueued = await tryEnqueuePerfRegressionDispatch({
      endpointPath: endpoint.path,
      method: endpoint.method,
      baselineId,
      currentP95Ms: latestP95,
      baselineP95Ms: baselineP95,
      samplingWindowCount: persistedWindowCount,
      recentSampleIds,
    });
    if (enqueued) dispatchesEnqueued++;
  }

  return {
    regressions,
    endpointsChecked,
    endpointsSkippedNoBaseline,
    dispatchesEnqueued,
  };
}

/**
 * Returns how many of the most-recent windows (starting from index 0) fired
 * a regression against the rows immediately older than them. The latest
 * window is assumed to have already fired (the caller only invokes this
 * after evaluateRegression returned non-null for rows[0]).
 *
 * Stops counting as soon as a window either:
 *   - has below-minSampleCount observations, or
 *   - does not satisfy evaluateRegression against its own tail.
 *
 * We need at least 2 trailing rows after each candidate to form a baseline,
 * so the maximum count returned is bounded by rows.length - 2.
 */
export function countConsecutivePersistence(
  rows: Array<{ p95Ms: string | number; sampleCount: number }>,
): number {
  let count = 0;
  for (let i = 0; i < rows.length; i++) {
    const candidate = rows[i];
    const tail = rows.slice(i + 1);
    if (tail.length === 0) break;
    const cP95 = Number(candidate.p95Ms);
    const cSamples = candidate.sampleCount;
    const tailBaseline = medianOf(tail.map((r) => Number(r.p95Ms)));
    const reg = evaluateRegression({
      latestP95: cP95,
      baselineP95: tailBaseline,
      latestSampleCount: cSamples,
    });
    if (!reg) break;
    count++;
  }
  return count;
}

// ============================================================================
// Auto-dispatch on persistent regression — wires the detector into the live
// solene_dispatch_queue. Idempotent on (endpointPath, baselineId) tuple so a
// single regression doesn't enqueue every cron tick while a fix is in flight.
// ============================================================================

export interface PerfRegressionFixPromptInput {
  endpointPath: string;
  method?: string;
  currentP95Ms: number;
  baselineP95Ms: number;
  samplingWindowCount: number;
  recentSampleIds: number[];
}

/**
 * Build the prompt body for an auto-enqueued perf-regression fix dispatch.
 * Pure function — exported for unit testing without DB / enqueue.
 *
 * The framing is deliberately root-cause-first: the dispatch worker is told
 * to DIAGNOSE before touching code, and to escalate to Solene when the
 * root-cause demands architecture-level work it isn't authorized to do
 * solo. The elite-engineering bar is "fix the cause, not the symptom".
 */
export function buildPerfRegressionFixPrompt(
  input: PerfRegressionFixPromptInput,
): string {
  const {
    endpointPath,
    method,
    currentP95Ms,
    baselineP95Ms,
    samplingWindowCount,
    recentSampleIds,
  } = input;
  const ratio =
    baselineP95Ms > 0
      ? (currentP95Ms / baselineP95Ms).toFixed(2)
      : "Infinity";
  const route = method ? `${method} ${endpointPath}` : endpointPath;
  const sampleIdList =
    recentSampleIds.length > 0 ? recentSampleIds.join(", ") : "(none)";

  return [
    `IRIS perf-regression auto-dispatch — root-cause then fix.`,
    ``,
    `Endpoint:    ${route}`,
    `Current p95: ${currentP95Ms.toFixed(0)}ms`,
    `Baseline p95: ${baselineP95Ms.toFixed(0)}ms`,
    `Ratio:       ${ratio}× baseline`,
    `Persisted:   ${samplingWindowCount} consecutive sampling windows`,
    `Recent iris_perf_samples ids: [${sampleIdList}]`,
    ``,
    `Investigation order — DO NOT skip steps:`,
    ``,
    `  1. Read the p95 baseline data for this endpoint:`,
    `       SELECT id, window_started_at, p50_ms, p95_ms, p99_ms, sample_count`,
    `       FROM iris_perf_samples`,
    `       WHERE endpoint_path = '${endpointPath}'`,
    `       ORDER BY window_started_at DESC LIMIT 50;`,
    `     Identify when the p95 started climbing.`,
    ``,
    `  2. Identify the most recent commits that touched code paths routed`,
    `     through ${endpointPath} (route handler, middleware, services it`,
    `     calls, DB queries it issues). \`git log\` ranged around the`,
    `     window where p95 broke. Note the candidate commits.`,
    ``,
    `  3. Propose the root-cause hypothesis. Be explicit: which commit,`,
    `     which change, why it would land as added p95 latency. Do not`,
    `     proceed to a fix before this step is written down.`,
    ``,
    `  4. Implement the fix — or, if the root-cause is architecture-level`,
    `     (caching strategy, query plan that needs an index, N+1 across a`,
    `     hot loop, a synchronous external call that should be queued),`,
    `     STOP and escalate to Solene with the hypothesis + a one-paragraph`,
    `     scoping note. Architecture-level work is not a solo dispatch.`,
    ``,
    `Constraints: ${PERF_REGRESSION_DISPATCH_MAX_COST_USD} USD hard cap,`,
    `${Math.round(PERF_REGRESSION_DISPATCH_TIMEOUT_MS / 60000)} minute timeout,`,
    `commit per fix with a body that names the root-cause hypothesis.`,
  ].join("\n");
}

interface TryEnqueueInput {
  endpointPath: string;
  method: string;
  baselineId: number;
  currentP95Ms: number;
  baselineP95Ms: number;
  samplingWindowCount: number;
  recentSampleIds: number[];
}

/**
 * Idempotency-guarded enqueue. Returns true when a dispatch was enqueued,
 * false when one was skipped (already-queued or enqueue failed). Never
 * propagates an enqueue error — detection is observability-only, the cron
 * tick must move on regardless.
 */
async function tryEnqueuePerfRegressionDispatch(
  input: TryEnqueueInput,
): Promise<boolean> {
  const { endpointPath, baselineId } = input;
  const sourceIdPrefix = `iris-perf-regression:${endpointPath}:`;
  const sourceId = `${sourceIdPrefix}${baselineId}`;

  // Idempotency — skip if there's already a queued or in_progress dispatch
  // for this endpoint, regardless of which baselineId was used to enqueue
  // it. While a fix is in flight we don't want another one piling on top.
  try {
    const existing = await db
      .select({ id: soleneDispatchQueue.id })
      .from(soleneDispatchQueue)
      .where(
        and(
          eq(soleneDispatchQueue.sourceType, "detector"),
          like(soleneDispatchQueue.sourceId, `${sourceIdPrefix}%`),
          inArray(soleneDispatchQueue.status, ["queued", "in_progress"]),
        ),
      )
      .limit(1);
    if (existing.length > 0) {
      logger.info(
        `[iris-perf] dispatch already in flight for ${endpointPath} (id=${existing[0].id}); skipping enqueue`,
      );
      return false;
    }
  } catch (err) {
    logger.warn(
      `[iris-perf] idempotency check failed for ${endpointPath}`,
      err instanceof Error ? err : undefined,
    );
    // Fall through — better to risk a duplicate dispatch than to silently
    // never enqueue when the DB is briefly flaky.
  }

  const promptText = buildPerfRegressionFixPrompt({
    endpointPath: input.endpointPath,
    method: input.method,
    currentP95Ms: input.currentP95Ms,
    baselineP95Ms: input.baselineP95Ms,
    samplingWindowCount: input.samplingWindowCount,
    recentSampleIds: input.recentSampleIds,
  });

  try {
    const id = await enqueueDispatch({
      sourceType: "detector",
      sourceId,
      agentRole: "iris",
      promptText,
      maxCostUsd: PERF_REGRESSION_DISPATCH_MAX_COST_USD,
      timeoutMs: PERF_REGRESSION_DISPATCH_TIMEOUT_MS,
      priority: PERF_REGRESSION_DISPATCH_PRIORITY,
      enqueuedBy: "iris-perf-monitor",
    });
    logger.info(
      `[iris-perf] enqueued dispatch id=${id} for ${endpointPath} (baselineId=${baselineId})`,
    );
    return true;
  } catch (err) {
    logger.warn(
      `[iris-perf] enqueue failed for ${endpointPath}`,
      err instanceof Error ? err : undefined,
    );
    return false;
  }
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
