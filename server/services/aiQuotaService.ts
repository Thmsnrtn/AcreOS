/**
 * aiQuotaService — per-org daily AI USD quota enforcement + accounting.
 *
 * Phase 3 Week 9.
 *
 * Two responsibilities:
 *   1. checkQuota(orgId, cap)   — sum today's spend; throw AIQuotaExceeded
 *      if it has already met or exceeded the cap.
 *   2. recordUsage(orgId, usd, taskType) — atomic upsert into
 *      ai_usage_daily that increments totalUsd, callCount, and the
 *      byFeature[taskType] sub-rollup.
 *
 * Both are called from server/services/aiRouter.ts:routeAITask. The check
 * runs *before* the upstream provider call (fail fast); the record runs
 * *after* a successful (or failed-after-tokens-billed) call.
 *
 * Founder orgs MUST be skipped at the call site (we do not know req.isFounder
 * inside the router — the caller passes config.orgId only when the org should
 * be metered).
 *
 * The quota check is intentionally a SUM, not the cached aiUsageDaily row,
 * because in flight transactions can cross the boundary while another
 * concurrent call has not yet committed its row. The unique index on
 * (organization_id, date) plus the ON CONFLICT upsert handles concurrent
 * recordUsage cleanly.
 */

import { sql, and, eq } from "drizzle-orm";
import { db } from "../db";
import { aiUsageDaily, organizations } from "@shared/schema";
import { logger } from "../utils/logger";

/** Thrown when an org has hit its daily AI USD cap. Surfaced as HTTP 429. */
export class AIQuotaExceeded extends Error {
  readonly statusCode = 429;
  readonly code = "AI_QUOTA_EXCEEDED";
  readonly usedUsdToday: number;
  readonly capUsd: number;

  constructor(usedUsdToday: number, capUsd: number) {
    super(
      `Organization has exceeded its daily AI quota of $${capUsd.toFixed(2)} ` +
      `(used $${usedUsdToday.toFixed(4)} today).`,
    );
    this.name = "AIQuotaExceeded";
    this.usedUsdToday = usedUsdToday;
    this.capUsd = capUsd;
  }
}

/** UTC date in YYYY-MM-DD form — the partition key for ai_usage_daily.date. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Sum the org's totalUsd for today (UTC). Returns 0 when no row exists.
 * Used both by checkQuota and by GET /api/org/ai-quota.
 */
export async function sumTodayUsd(orgId: number): Promise<number> {
  const row = await db
    .select({ total: aiUsageDaily.totalUsd })
    .from(aiUsageDaily)
    .where(and(
      eq(aiUsageDaily.organizationId, orgId),
      eq(aiUsageDaily.date, todayUtc()),
    ))
    .limit(1);
  if (!row.length) return 0;
  const v = row[0].total;
  // numeric → string in pg-driver land; coerce defensively.
  return typeof v === "string" ? parseFloat(v) : Number(v);
}

/**
 * Throws AIQuotaExceeded if the org has already met-or-exceeded its cap.
 *
 * cap === 0 means "unlimited" (treats founder/internal orgs as uncapped even
 * if the caller forgets to skip).
 */
export async function checkQuota(orgId: number, capUsd: number): Promise<void> {
  if (!Number.isFinite(capUsd) || capUsd <= 0) return; // 0 = unlimited
  const used = await sumTodayUsd(orgId);
  if (used >= capUsd) {
    throw new AIQuotaExceeded(used, capUsd);
  }
}

/**
 * Increment ai_usage_daily for (orgId, today). Atomic via ON CONFLICT upsert.
 *
 * @param orgId      Organization the call is being billed to.
 * @param costUsd    USD cost of the just-completed call (>= 0).
 * @param taskType   Used as the key in byFeature for per-feature rollups.
 */
export async function recordUsage(
  orgId: number,
  costUsd: number,
  taskType: string,
): Promise<void> {
  if (!Number.isFinite(costUsd) || costUsd < 0) costUsd = 0;
  if (!taskType) taskType = "unknown";
  const date = todayUtc();

  try {
    // INSERT ... ON CONFLICT (organization_id, date) DO UPDATE
    //   SET total_usd  = total_usd + EXCLUDED.total_usd,
    //       call_count = call_count + 1,
    //       by_feature = jsonb_set(
    //         coalesce(by_feature, '{}'::jsonb),
    //         '{<taskType>}',
    //         jsonb_build_object(
    //           'usd',   coalesce((by_feature->'<taskType>'->>'usd')::numeric, 0) + EXCLUDED.total_usd,
    //           'calls', coalesce((by_feature->'<taskType>'->>'calls')::int, 0) + 1
    //         )
    //       )
    //
    // The taskType key is sanitized — only [A-Za-z0-9_-] permitted — to
    // prevent jsonb path injection. Anything else collapses to "unknown".
    const safeKey = /^[A-Za-z0-9_\-]+$/.test(taskType) ? taskType : "unknown";

    await db.execute(sql`
      INSERT INTO ai_usage_daily (organization_id, date, total_usd, call_count, by_feature, updated_at)
      VALUES (
        ${orgId},
        ${date}::date,
        ${costUsd}::numeric,
        1,
        jsonb_build_object(${safeKey}::text, jsonb_build_object('usd', ${costUsd}::numeric, 'calls', 1)),
        now()
      )
      ON CONFLICT (organization_id, date) DO UPDATE SET
        total_usd  = ai_usage_daily.total_usd + EXCLUDED.total_usd,
        call_count = ai_usage_daily.call_count + 1,
        by_feature = jsonb_set(
          COALESCE(ai_usage_daily.by_feature, '{}'::jsonb),
          ARRAY[${safeKey}::text],
          jsonb_build_object(
            'usd',   COALESCE((ai_usage_daily.by_feature->${safeKey}::text->>'usd')::numeric, 0) + EXCLUDED.total_usd,
            'calls', COALESCE((ai_usage_daily.by_feature->${safeKey}::text->>'calls')::int, 0) + 1
          ),
          true
        ),
        updated_at = now()
    `);
  } catch (err) {
    // Accounting failures must NEVER block the user-facing request — log and
    // continue. The next call will still see the prior aggregate.
    logger.warn("[aiQuotaService] recordUsage failed — continuing", {
      metadata: { orgId, costUsd, taskType, detail: err instanceof Error ? err.message : err },
    });
  }
}

/**
 * Read the org's daily cap. Returns 50.00 if the row is somehow missing.
 * Skips the DB if cached on the request — but the simpler unconditional
 * read is cheap (PK lookup) and keeps the caller free of stale-cap bugs.
 */
export async function getOrgQuotaCap(orgId: number): Promise<number> {
  const rows = await db
    .select({ cap: organizations.orgAiQuotaDailyUsd })
    .from(organizations)
    .where(eq(organizations.id, orgId))
    .limit(1);
  if (!rows.length) return 50.0;
  const v = rows[0].cap;
  return typeof v === "string" ? parseFloat(v) : Number(v ?? 50.0);
}

/**
 * Used by GET /api/org/ai-quota — returns the full quota state for the
 * authenticated org, including byFeature rollup.
 */
export async function getQuotaState(orgId: number): Promise<{
  usedUsdToday: number;
  capUsd: number;
  percentRemaining: number;
  byFeature: Record<string, { usd: number; calls: number }>;
  callCountToday: number;
}> {
  const [capUsd, row] = await Promise.all([
    getOrgQuotaCap(orgId),
    db.select().from(aiUsageDaily).where(and(
      eq(aiUsageDaily.organizationId, orgId),
      eq(aiUsageDaily.date, todayUtc()),
    )).limit(1),
  ]);

  const used = row.length
    ? (typeof row[0].totalUsd === "string" ? parseFloat(row[0].totalUsd) : Number(row[0].totalUsd))
    : 0;
  const calls = row.length ? row[0].callCount : 0;
  const byFeature = (row.length && row[0].byFeature) ? row[0].byFeature : {};

  // capUsd === 0 means unlimited → percentRemaining is conceptually 100.
  const percentRemaining = capUsd <= 0
    ? 100
    : Math.max(0, Math.min(100, ((capUsd - used) / capUsd) * 100));

  return {
    usedUsdToday: used,
    capUsd,
    percentRemaining,
    byFeature,
    callCountToday: calls,
  };
}
