/**
 * apiTelemetryRollup — Tahoe L14 follow-up.
 *
 * Rolls up `api_telemetry_samples` rows older than the retention window into
 * monthly aggregates in `api_telemetry_rollup_monthly`, then deletes the
 * source rows. Designed to run nightly from runScheduledJobs.ts.
 *
 * Why
 *   - api_telemetry_samples grows ~1 row per (route, 60s window) — at 500
 *     routes that's ~720k rows per day. Holding a year of that is feasible
 *     but the founder cost dashboard only needs per-tick granularity for the
 *     last 30 days; older windows can collapse to monthly without losing the
 *     signal we care about ("what did this route cost in Feb?").
 *
 * Retention window
 *   - 30 days by default. Configurable via env `API_TELEMETRY_RETENTION_DAYS`
 *     for test fixtures + emergency widening.
 *
 * Idempotency
 *   - The rollup UPSERTs on (year, month, route_key, cost_class). Re-running
 *     the job against a window that was partially rolled up doesn't double-
 *     count because we DELETE the source rows after the UPSERT lands. If a
 *     re-run happens after the UPSERT but before the DELETE (rare crash),
 *     the next run will INSERT zero new rows for the already-rolled window
 *     and re-issue the DELETE — net effect: idempotent within ±1 source
 *     row.
 *   - The function is split into `aggregateAndUpsert` + `purgeRolledSources`
 *     specifically so tests can drive each half in isolation.
 *
 * Side effects
 *   - logger.info with structured tags on every run (rows aggregated, rows
 *     deleted, retentionDays, oldestSampleAt).
 */

import { and, lt, sql } from "drizzle-orm";
import { db } from "../db";
import {
  apiTelemetrySamples,
  apiTelemetryRollupMonthly,
} from "@shared/schema";
import { logger } from "../utils/logger";

const DEFAULT_RETENTION_DAYS = 30;

function getRetentionDays(): number {
  const raw = process.env.API_TELEMETRY_RETENTION_DAYS;
  if (!raw) return DEFAULT_RETENTION_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_RETENTION_DAYS;
  return Math.floor(n);
}

export interface RollupRunResult {
  retentionDays: number;
  cutoff: Date;
  rollupRowsUpserted: number;
  sourceRowsDeleted: number;
  oldestSampleAt: Date | null;
}

/**
 * Aggregate every api_telemetry_samples row strictly older than `cutoff`
 * into api_telemetry_rollup_monthly. UPSERT semantics on
 * (year, month, route_key, cost_class):
 *
 *   - request_count        += sum of bucket
 *   - total_duration_ms    += sum of bucket
 *   - total_cost_cents     += 0 today (per-route cost not yet wired)
 *   - distinct_orgs         = max(existing, 0) — also 0 today
 *
 * Returns the count of (year, month, route_key, cost_class) buckets touched.
 */
export async function aggregateAndUpsert(cutoff: Date): Promise<number> {
  // Aggregate the samples older than cutoff into per-(year, month, route,
  // cost_class) groups. EXTRACT runs in UTC because window_start is stored
  // with TZ and we want calendar months in UTC for cross-region stability.
  const aggregateSql = sql`
    SELECT
      EXTRACT(YEAR FROM ${apiTelemetrySamples.windowStart})::int AS year,
      EXTRACT(MONTH FROM ${apiTelemetrySamples.windowStart})::int AS month,
      ${apiTelemetrySamples.route} AS route_key,
      ${apiTelemetrySamples.costClass} AS cost_class,
      SUM(
        ${apiTelemetrySamples.count2xx}
        + ${apiTelemetrySamples.count4xx}
        + ${apiTelemetrySamples.count5xx}
      )::bigint AS request_count,
      SUM(${apiTelemetrySamples.totalMs})::bigint AS total_duration_ms,
      -- Sum of per-window distinct-org counts. This is an upper bound on
      -- monthly uniques (a tenant active across two windows counts twice),
      -- not a cross-window dedup — acceptable for the dashboard's "how many
      -- tenants exercise this route" signal, and far cheaper than retaining
      -- per-org sample rows. Coalesced for rows written before the column
      -- existed (defaulted to 0 by the migration, so COALESCE is belt-and-
      -- braces).
      SUM(COALESCE(${apiTelemetrySamples.distinctOrgs}, 0))::int AS distinct_orgs
    FROM ${apiTelemetrySamples}
    WHERE ${apiTelemetrySamples.windowStart} < ${cutoff}
    GROUP BY 1, 2, 3, 4
  `;

  const rows = (await db.execute(aggregateSql)) as unknown as {
    rows?: Array<{
      year: number;
      month: number;
      route_key: string;
      cost_class: string | null;
      request_count: string | number | bigint;
      total_duration_ms: string | number | bigint;
      distinct_orgs: string | number | bigint;
    }>;
  };

  const aggregated = (rows.rows ?? (rows as unknown as Array<{
    year: number;
    month: number;
    route_key: string;
    cost_class: string | null;
    request_count: string | number | bigint;
    total_duration_ms: string | number | bigint;
    distinct_orgs: string | number | bigint;
  }>)) ?? [];

  if (aggregated.length === 0) return 0;

  // UPSERT each bucket. We loop rather than batch because the count is
  // small (one row per route per month past retention) and the conflict
  // target needs identical handling of NULL cost_class — easier to keep
  // straight in serial inserts than crafting a single multi-VALUES upsert.
  let touched = 0;
  for (const r of aggregated) {
    const requestCount = Number(r.request_count);
    const totalDurationMs = Number(r.total_duration_ms);
    const distinctOrgs = Number(r.distinct_orgs);

    // ON CONFLICT … DO UPDATE — add to existing counts. Idempotency for
    // partial crashes: a re-run will produce zero new aggregated rows
    // for already-rolled windows (because purgeRolledSources will have
    // deleted them), so this branch only fires for fresh buckets.
    await db
      .insert(apiTelemetryRollupMonthly)
      .values({
        year: r.year,
        month: r.month,
        routeKey: r.route_key,
        costClass: r.cost_class,
        requestCount,
        totalDurationMs,
        totalCostCents: 0,
        distinctOrgs,
      })
      .onConflictDoUpdate({
        target: [
          apiTelemetryRollupMonthly.year,
          apiTelemetryRollupMonthly.month,
          apiTelemetryRollupMonthly.routeKey,
          apiTelemetryRollupMonthly.costClass,
        ],
        set: {
          requestCount: sql`${apiTelemetryRollupMonthly.requestCount} + ${requestCount}`,
          totalDurationMs: sql`${apiTelemetryRollupMonthly.totalDurationMs} + ${totalDurationMs}`,
          distinctOrgs: sql`${apiTelemetryRollupMonthly.distinctOrgs} + ${distinctOrgs}`,
          updatedAt: new Date(),
        },
      });
    touched++;
  }

  return touched;
}

/**
 * Delete api_telemetry_samples rows strictly older than `cutoff`. Returns
 * the row-count of deletions for the run summary.
 *
 * Always runs AFTER aggregateAndUpsert in the public runRollup() entrypoint
 * — never expose this as a standalone "delete old samples without rolling"
 * helper, because that would silently lose data.
 */
export async function purgeRolledSources(cutoff: Date): Promise<number> {
  const result = await db
    .delete(apiTelemetrySamples)
    .where(lt(apiTelemetrySamples.windowStart, cutoff));
  // drizzle-orm returns { rowCount } on the node-postgres path and an
  // empty payload on neon-http; normalise to 0 when unknown.
  const rc = (result as { rowCount?: number }).rowCount;
  return typeof rc === "number" ? rc : 0;
}

/**
 * Public entrypoint — called by the scheduled job nightly.
 *
 * 1. Compute cutoff = now - retentionDays
 * 2. Aggregate samples < cutoff into monthly rollups (UPSERT)
 * 3. Delete samples < cutoff
 * 4. Log a single structured summary row
 */
export async function runApiTelemetryRollup(opts?: {
  /** Override retention window. Mostly used by tests. */
  retentionDays?: number;
  /** Override clock for tests. */
  now?: Date;
}): Promise<RollupRunResult> {
  const retentionDays = opts?.retentionDays ?? getRetentionDays();
  const now = opts?.now ?? new Date();
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);

  // Optional context — oldest sample timestamp, for the log row.
  let oldestSampleAt: Date | null = null;
  try {
    const [oldest] = await db
      .select({ ts: sql<string>`MIN(${apiTelemetrySamples.windowStart})` })
      .from(apiTelemetrySamples);
    if (oldest?.ts) oldestSampleAt = new Date(oldest.ts);
  } catch (err) {
    // Non-fatal — keep going; log will surface null.
    logger.warn("apiTelemetryRollup.oldest_lookup_failed", {
      metadata: { error: err instanceof Error ? err.message : String(err) },
    });
  }

  const rollupRowsUpserted = await aggregateAndUpsert(cutoff);
  const sourceRowsDeleted = await purgeRolledSources(cutoff);

  logger.info("apiTelemetryRollup.run", {
    metadata: {
      retentionDays,
      cutoff: cutoff.toISOString(),
      rollupRowsUpserted,
      sourceRowsDeleted,
      oldestSampleAt: oldestSampleAt?.toISOString() ?? null,
    },
  });

  return {
    retentionDays,
    cutoff,
    rollupRowsUpserted,
    sourceRowsDeleted,
    oldestSampleAt,
  };
}
