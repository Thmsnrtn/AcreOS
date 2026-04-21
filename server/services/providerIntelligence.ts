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
    });
  } catch (err: any) {
    logger.warn("[providerIntelligence] record failed (non-blocking)", {
      metadata: { error: err?.message, provider: record.providerName },
    });
  }
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
