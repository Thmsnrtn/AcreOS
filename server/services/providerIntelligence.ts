/**
 * Provider Intelligence — smarter routing + founder-facing cost/quality visibility.
 *
 * Today the provider registry sorts candidates by tier → cost →
 * hard-coded priority. That's a static ordering that doesn't reflect
 * real-world performance: ATTOM might hit 80% for this query type
 * while BatchData hits 60% — but they'd be sorted identically
 * because their tier+cost are the same.
 *
 * This service adds the performance-aware layer on top:
 *   - Every lookup gets logged (provider, category, success, latency, cost)
 *   - Per-(provider, category) success rate computed over rolling 7-day window
 *   - Registry consults the score as a tiebreaker after tier+cost
 *
 * Plus: founder visibility at /founder/providers showing spend per
 * provider, success rate per category, average latency. The founder
 * can spot a provider that's degrading quality-wise AND one that's
 * burning too much money.
 */

import { db } from "../db";
import { providerLookupLog } from "@shared/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface LookupRecord {
  providerName: string;
  category: string;
  inputType: string;
  success: boolean;
  cached?: boolean;
  latencyMs?: number;
  costCents?: number;
  errorCode?: string;
  organizationId?: number;
  /** 2-letter state of the looked-up parcel, for free-miss-by-county rollup. */
  state?: string;
  /** County name of the looked-up parcel, for free-miss-by-county rollup. */
  county?: string;
}

/**
 * Called by the provider registry after every lookup attempt.
 * Non-blocking, failure-tolerant — if the log write fails, we don't
 * block the actual response.
 */
export async function recordLookup(record: LookupRecord): Promise<void> {
  try {
    await db.insert(providerLookupLog).values({
      providerName: record.providerName,
      category: record.category,
      inputType: record.inputType,
      success: record.success,
      cached: record.cached ?? false,
      latencyMs: record.latencyMs ?? null,
      costCents: record.costCents ?? 0,
      errorCode: record.errorCode ?? null,
      organizationId: record.organizationId ?? null,
      state: record.state ?? null,
      county: record.county ?? null,
    });
  } catch (err: any) {
    logger.warn("[providerIntelligence] record failed (non-blocking)", {
      metadata: { error: err?.message, provider: record.providerName },
    });
  }
}

/**
 * Free-miss-by-county telemetry (Iris/Lena: make the eventual paid-data buy
 * data-driven). Records a synthetic lookup-log row marking that the FREE
 * provider stack returned nothing for this county + category. The
 * `freeMissesByCounty` rollup counts these so we can say "Regrid would have
 * filled 38% of misses in the 12 counties our customers worked last month"
 * before spending a dollar.
 */
export async function recordFreeMiss(args: {
  category: string;
  state?: string;
  county?: string;
  organizationId?: number;
}): Promise<void> {
  try {
    await db.insert(providerLookupLog).values({
      providerName: "free-stack",
      category: args.category,
      inputType: "free_miss",
      success: false,
      cached: false,
      latencyMs: null,
      costCents: 0,
      errorCode: "free_miss",
      organizationId: args.organizationId ?? null,
      state: args.state ?? null,
      county: args.county ?? null,
    });
  } catch (err: any) {
    logger.warn("[providerIntelligence] free-miss record failed (non-blocking)", {
      metadata: { error: err?.message, category: args.category },
    });
  }
}

/**
 * Roll up free misses by (state, county, category) over a window. Drives the
 * paid-data procurement decision: where are the free misses concentrated, and
 * would a paid provider (Regrid) fill them?
 */
export async function freeMissesByCounty(windowDays: number = 30): Promise<
  Array<{ state: string | null; county: string | null; category: string; misses: number }>
> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT state, county, category, count(*)::int AS misses
    FROM provider_lookup_log
    WHERE error_code = 'free_miss'
      AND created_at >= ${since}
    GROUP BY state, county, category
    ORDER BY misses DESC
  `);
  return (rows.rows as any[]).map((r) => ({
    state: r.state ?? null,
    county: r.county ?? null,
    category: r.category,
    misses: Number(r.misses),
  }));
}

/**
 * Compute performance scores for a category over a rolling window.
 * Returns Map<providerName, score 0..100> where score = successRate * 100.
 * Uncached lookups only (cache hits aren't a meaningful quality signal).
 */
export async function getCategoryPerformance(
  category: string,
  windowDays: number = 7,
): Promise<Map<string, { score: number; n: number; avgLatencyMs: number | null; costCents: number }>> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);
  const rows = await db.execute(sql`
    SELECT
      provider_name,
      count(*)::int AS n,
      sum(CASE WHEN success THEN 1 ELSE 0 END)::int AS succ,
      avg(latency_ms)::float AS avg_latency,
      sum(cost_cents)::int AS cost_cents
    FROM provider_lookup_log
    WHERE category = ${category}
      AND created_at >= ${since}
      AND cached = false
    GROUP BY provider_name
  `);
  const out = new Map<string, { score: number; n: number; avgLatencyMs: number | null; costCents: number }>();
  for (const row of rows.rows as any[]) {
    const n = Number(row.n);
    const succ = Number(row.succ);
    const score = n > 0 ? Math.round((succ / n) * 100) : 50; // default 50 if no data
    out.set(row.provider_name, {
      score,
      n,
      avgLatencyMs: row.avg_latency != null ? Math.round(Number(row.avg_latency)) : null,
      costCents: Number(row.cost_cents ?? 0),
    });
  }
  return out;
}

/**
 * Summary for the founder /providers page.
 */
export async function getProviderSummary(windowDays: number = 30): Promise<{
  windowDays: number;
  byProvider: Array<{
    provider: string;
    lookups: number;
    successRate: number;
    avgLatencyMs: number | null;
    totalCostCents: number;
  }>;
  byCategory: Array<{
    category: string;
    lookups: number;
    successRate: number;
  }>;
  totalCostCents: number;
  totalLookups: number;
}> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000);

  const [byProviderRows, byCategoryRows, totalRow] = await Promise.all([
    db.execute(sql`
      SELECT
        provider_name,
        count(*)::int AS n,
        sum(CASE WHEN success THEN 1 ELSE 0 END)::int AS succ,
        avg(latency_ms)::float AS avg_latency,
        sum(cost_cents)::int AS cost_cents
      FROM provider_lookup_log
      WHERE created_at >= ${since}
      GROUP BY provider_name
      ORDER BY n DESC
    `),
    db.execute(sql`
      SELECT
        category,
        count(*)::int AS n,
        sum(CASE WHEN success THEN 1 ELSE 0 END)::int AS succ
      FROM provider_lookup_log
      WHERE created_at >= ${since}
      GROUP BY category
      ORDER BY n DESC
    `),
    db.execute(sql`
      SELECT
        count(*)::int AS n,
        sum(cost_cents)::int AS cost_cents
      FROM provider_lookup_log
      WHERE created_at >= ${since}
    `),
  ]);

  const byProvider = (byProviderRows.rows as any[]).map((r) => ({
    provider: r.provider_name,
    lookups: Number(r.n),
    successRate: Number(r.n) > 0 ? Math.round((Number(r.succ) / Number(r.n)) * 1000) / 10 : 0,
    avgLatencyMs: r.avg_latency != null ? Math.round(Number(r.avg_latency)) : null,
    totalCostCents: Number(r.cost_cents ?? 0),
  }));
  const byCategory = (byCategoryRows.rows as any[]).map((r) => ({
    category: r.category,
    lookups: Number(r.n),
    successRate: Number(r.n) > 0 ? Math.round((Number(r.succ) / Number(r.n)) * 1000) / 10 : 0,
  }));
  const totals = (totalRow.rows[0] as any) ?? { n: 0, cost_cents: 0 };

  return {
    windowDays,
    byProvider,
    byCategory,
    totalCostCents: Number(totals.cost_cents ?? 0),
    totalLookups: Number(totals.n ?? 0),
  };
}
