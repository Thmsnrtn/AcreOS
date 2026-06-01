/**
 * routes-founder-cost — GET /api/founder/cost-summary
 *
 * Founder-only consolidated cost view for the /founder/cost screen.
 * Pulls from three existing data sources:
 *
 *   1. AI spend — ai_usage_daily + ai_telemetry_events (same source as
 *      /api/founder/ai-costs). Returns this-month total + 30-day trend.
 *
 *   2. Infra / total cost — the latest cost_optimization_runs row, which
 *      contains totalFlyCostUsd, totalAiCostUsd, mrrUsd, profitMarginPct.
 *      That row is written nightly by server/jobs/costOptimizer.ts.
 *
 *   3. Per-org AI cost — top 5 orgs by this-month spend.
 *
 * All numbers are USD, returned with at-most 2 decimal places.
 * The endpoint intentionally returns honest zeros when there is no data —
 * Phase Zero-Zero reality is a zero-customer cluster.
 */

import type { Express, Response } from "express";
import { sql, desc, eq, gte } from "drizzle-orm";

import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated, requireFounder } from "./auth/clerkAuth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import {
  aiUsageDaily,
  costOptimizationRuns,
  organizations,
} from "@shared/schema";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function thisMonthStart(): string {
  const d = new Date();
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

function nDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function toNum(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") return parseFloat(v) || 0;
  return 0;
}

// ─── Route registration ───────────────────────────────────────────────────────

export function registerFounderCostRoutes(app: Express): void {
  app.get(
    "/api/founder/cost-summary",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const monthStart = thisMonthStart();
        const thirtyDaysAgo = nDaysAgo(29); // inclusive of today = 30 days

        // ── 1. This-month AI spend (aggregate) ──────────────────────────────
        const monthTotalRows = await db
          .select({ totalUsd: sql<string>`SUM(total_usd)`, totalCalls: sql<string>`SUM(call_count)` })
          .from(aiUsageDaily)
          .where(gte(aiUsageDaily.date, monthStart));

        const aiSpendThisMonth = toNum(monthTotalRows[0]?.totalUsd);
        const aiCallsThisMonth = toNum(monthTotalRows[0]?.totalCalls);

        // ── 2. 30-day daily AI spend trend (for sparkline) ──────────────────
        const trendRows = await db
          .select({
            date: aiUsageDaily.date,
            totalUsd: aiUsageDaily.totalUsd,
          })
          .from(aiUsageDaily)
          .where(gte(aiUsageDaily.date, thirtyDaysAgo))
          .orderBy(aiUsageDaily.date);

        const dailyTrend = trendRows.map((r) => ({
          date: typeof r.date === "string" ? r.date : (r.date as Date).toISOString().slice(0, 10),
          usd: toNum(r.totalUsd),
        }));

        // ── 3. Latest cost-optimizer run (infra snapshot) ───────────────────
        const latestRunRows = await db
          .select({
            runAt: costOptimizationRuns.runAt,
            totalAiCostUsd: costOptimizationRuns.totalAiCostUsd,
            totalFlyCostUsd: costOptimizationRuns.totalFlyCostUsd,
            mrrUsd: costOptimizationRuns.mrrUsd,
            profitMarginPct: costOptimizationRuns.profitMarginPct,
            customerCount: costOptimizationRuns.customerCount,
            summary: costOptimizationRuns.summary,
          })
          .from(costOptimizationRuns)
          .orderBy(desc(costOptimizationRuns.runAt))
          .limit(1);

        const latest = latestRunRows[0] ?? null;
        const infraSnapshot = latest
          ? {
              runAt: latest.runAt,
              aiCostUsd: toNum(latest.totalAiCostUsd),
              flyCostUsd: toNum(latest.totalFlyCostUsd),
              mrrUsd: toNum(latest.mrrUsd),
              profitMarginPct: toNum(latest.profitMarginPct),
              customerCount: latest.customerCount ?? 0,
              summary: latest.summary ?? "",
            }
          : null;

        // ── 4. Top-5 orgs by this-month AI spend ────────────────────────────
        const perOrgRows = await db
          .select({
            organizationId: aiUsageDaily.organizationId,
            orgName: organizations.name,
            totalUsd: sql<string>`SUM(${aiUsageDaily.totalUsd})`,
            totalCalls: sql<string>`SUM(${aiUsageDaily.callCount})`,
          })
          .from(aiUsageDaily)
          .leftJoin(organizations, eq(organizations.id, aiUsageDaily.organizationId))
          .where(gte(aiUsageDaily.date, monthStart))
          .groupBy(aiUsageDaily.organizationId, organizations.name)
          .orderBy(sql`SUM(${aiUsageDaily.totalUsd}) DESC`)
          .limit(5);

        const topOrgs = perOrgRows.map((r) => ({
          organizationId: r.organizationId,
          organizationName: r.orgName ?? `Org ${r.organizationId}`,
          usd: toNum(r.totalUsd),
          calls: toNum(r.totalCalls),
        }));

        // ── 5. Vendor lines: AI + Fly + Sentry (static for now) ─────────────
        // Real Sentry cost requires a billing API key Tom hasn't wired yet.
        // We surface what we can derive from known sources and label the rest
        // as "estimated" so the dashboard is honest.
        const vendorLines = [
          {
            vendor: "Anthropic (AI)",
            usd: infraSnapshot?.aiCostUsd ?? aiSpendThisMonth,
            source: "ai_telemetry" as const,
            note: "Derived from ai_usage_daily + ai_telemetry_events",
          },
          {
            vendor: "Fly.io (infra)",
            usd: infraSnapshot?.flyCostUsd ?? 0,
            source: "cost_optimizer" as const,
            note: "From nightly cost-optimizer run — $25 base + per-org scaling",
          },
          {
            vendor: "Sentry (observability)",
            usd: 0,
            source: "estimated" as const,
            note: "Not yet wired to Sentry billing API — free tier assumed",
          },
        ].sort((a, b) => b.usd - a.usd);

        return res.json({
          asOf: new Date().toISOString(),
          aiSpendThisMonth,
          aiCallsThisMonth,
          dailyTrend,
          infraSnapshot,
          topOrgs,
          vendorLines,
        });
      } catch (err) {
        logger.error("[/api/founder/cost-summary] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );
}
