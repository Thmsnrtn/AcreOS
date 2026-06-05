/**
 * routes-ai-cost — AI quota + founder cost dashboard endpoints.
 *
 * Phase 3 Week 9.
 *
 * Two surfaces:
 *
 *   1. GET /api/org/ai-quota
 *      — any authenticated org member can read their own org's cap + usage.
 *
 *   2. GET /api/founder/ai-costs
 *      — founder only; rolled-up data for the AI cost dashboard:
 *        Card 1 — today's usage by org (top 10) with recent daily series
 *        Card 2 — cost by feature (taskType) with stacked daily history
 *        Card 3 — top-N most expensive single calls today
 *        Card 4 — per-model cost distribution for the last 7 days
 *
 *      All four roll up from ai_usage_daily + ai_telemetry_events (the
 *      latter is the only place we have per-call granularity).
 */

import type { Express, Response } from "express";
import { sql, desc, eq, and, gte } from "drizzle-orm";

import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

import { db } from "./db";
import {
  aiUsageDaily,
  aiTelemetryEvents,
  organizations,
} from "@shared/schema";
import { getQuotaState, todayUtc } from "./services/aiQuotaService";

// ─── Helpers ────────────────────────────────────────────────────────────────

function isoDateNDaysAgo(n: number): string {
  return new Date(Date.now() - n * 86400_000).toISOString().slice(0, 10);
}

// ─── Route registration ─────────────────────────────────────────────────────

export function registerAiCostRoutes(app: Express): void {

  // ── GET /api/org/ai-quota ─────────────────────────────────────────────────
  // Any authenticated org member can read their org's cap + today's usage.
  app.get(
    "/api/org/ai-quota",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const orgId = getOrganizationId(req);
        const state = await getQuotaState(orgId);
        return res.json(state);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/founder/ai-costs ─────────────────────────────────────────────
  // Founder-only AI cost rollup for /founder/ai-costs.
  app.get(
    "/api/founder/ai-costs",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "AI cost dashboard is restricted to founders");
        }

        const today = todayUtc();
        const sevenDaysAgo = isoDateNDaysAgo(6); // 7 days inclusive of today

        // ── Card 1: today's usage by org (top 10) + 7-day sparkline per org ─
        // Top 10 by today's totalUsd; sparkline = the trailing 7 daily figures.
        const todayByOrgRows = await db
          .select({
            organizationId: aiUsageDaily.organizationId,
            totalUsd: aiUsageDaily.totalUsd,
            callCount: aiUsageDaily.callCount,
            orgName: organizations.name,
            cap: organizations.orgAiQuotaDailyUsd,
          })
          .from(aiUsageDaily)
          .leftJoin(organizations, eq(organizations.id, aiUsageDaily.organizationId))
          .where(eq(aiUsageDaily.date, today));

        // Compute sparklines in a single query for the orgs we care about
        const last7DaysRows = await db
          .select({
            organizationId: aiUsageDaily.organizationId,
            date: aiUsageDaily.date,
            totalUsd: aiUsageDaily.totalUsd,
          })
          .from(aiUsageDaily)
          .where(gte(aiUsageDaily.date, sevenDaysAgo));

        const sparklineByOrg = new Map<number, Array<{ date: string; usd: number }>>();
        for (const r of last7DaysRows) {
          const list = sparklineByOrg.get(r.organizationId) ?? [];
          list.push({
            date: typeof r.date === "string" ? r.date : new Date(r.date as any).toISOString().slice(0, 10),
            usd: typeof r.totalUsd === "string" ? parseFloat(r.totalUsd) : Number(r.totalUsd ?? 0),
          });
          sparklineByOrg.set(r.organizationId, list);
        }

        const todayByOrg = todayByOrgRows
          .map((r) => ({
            organizationId: r.organizationId,
            organizationName: r.orgName ?? `Org ${r.organizationId}`,
            usedUsdToday: typeof r.totalUsd === "string" ? parseFloat(r.totalUsd) : Number(r.totalUsd ?? 0),
            callCount: r.callCount ?? 0,
            capUsd: r.cap ? (typeof r.cap === "string" ? parseFloat(r.cap) : Number(r.cap)) : 50,
            sparkline: (sparklineByOrg.get(r.organizationId) ?? []).sort((a, b) => a.date.localeCompare(b.date)),
          }))
          .sort((a, b) => b.usedUsdToday - a.usedUsdToday)
          .slice(0, 10);

        // ── Card 2: cost by feature (taskType), stacked over the last 7 days ─
        // Aggregated from ai_telemetry_events because it has per-call task_type.
        const byFeatureRows = await db.execute(sql`
          SELECT
            task_type,
            SUM(estimated_cost_cents)::numeric / 100.0 AS usd,
            COUNT(*)::int                              AS calls
          FROM ai_telemetry_events
          WHERE created_at >= now() - interval '7 days'
          GROUP BY task_type
          ORDER BY usd DESC
          LIMIT 25
        `);

        const byFeature = (byFeatureRows.rows as any[]).map((r) => ({
          taskType: r.task_type as string,
          usd: Number(r.usd ?? 0),
          calls: Number(r.calls ?? 0),
        }));

        // ── Card 3: top expensive prompts (largest single calls today) ─────
        const topCallsRows = await db
          .select({
            id: aiTelemetryEvents.id,
            organizationId: aiTelemetryEvents.organizationId,
            taskType: aiTelemetryEvents.taskType,
            model: aiTelemetryEvents.model,
            promptTokens: aiTelemetryEvents.promptTokens,
            completionTokens: aiTelemetryEvents.completionTokens,
            estimatedCostCents: aiTelemetryEvents.estimatedCostCents,
            latencyMs: aiTelemetryEvents.latencyMs,
            complexity: aiTelemetryEvents.complexity,
            createdAt: aiTelemetryEvents.createdAt,
          })
          .from(aiTelemetryEvents)
          .where(gte(aiTelemetryEvents.createdAt,
            new Date(Date.now() - 24 * 3600_000)))
          .orderBy(desc(aiTelemetryEvents.estimatedCostCents))
          .limit(20);

        const topCalls = topCallsRows.map((r) => {
          const cents = typeof r.estimatedCostCents === "string"
            ? parseFloat(r.estimatedCostCents)
            : Number(r.estimatedCostCents ?? 0);
          return {
            id: r.id,
            organizationId: r.organizationId,
            taskType: r.taskType,
            model: r.model,
            promptTokens: r.promptTokens ?? 0,
            completionTokens: r.completionTokens ?? 0,
            usd: cents / 100,
            latencyMs: r.latencyMs ?? 0,
            complexity: r.complexity ?? "moderate",
            createdAt: r.createdAt,
          };
        });

        // ── Card 4: per-model cost distribution (last 7 days) ──────────────
        const byModelRows = await db.execute(sql`
          SELECT
            model,
            SUM(estimated_cost_cents)::numeric / 100.0 AS usd,
            COUNT(*)::int                              AS calls,
            SUM(prompt_tokens)::int                    AS prompt_tokens,
            SUM(completion_tokens)::int                AS completion_tokens
          FROM ai_telemetry_events
          WHERE created_at >= now() - interval '7 days'
          GROUP BY model
          ORDER BY usd DESC
        `);

        const byModel = (byModelRows.rows as any[]).map((r) => ({
          model: r.model as string,
          usd: Number(r.usd ?? 0),
          calls: Number(r.calls ?? 0),
          promptTokens: Number(r.prompt_tokens ?? 0),
          completionTokens: Number(r.completion_tokens ?? 0),
        }));

        // ── Totals header ──────────────────────────────────────────────────
        const totalUsdToday = todayByOrgRows.reduce(
          (acc, r) => acc + (typeof r.totalUsd === "string"
            ? parseFloat(r.totalUsd)
            : Number(r.totalUsd ?? 0)),
          0,
        );
        const totalCallsToday = todayByOrgRows.reduce(
          (acc, r) => acc + (r.callCount ?? 0),
          0,
        );

        return res.json({
          totals: {
            usdToday: totalUsdToday,
            callsToday: totalCallsToday,
            orgsActiveToday: todayByOrgRows.length,
          },
          todayByOrg,
          byFeature,
          topCalls,
          byModel,
        });
      } catch (err) {
        logger.error("[founder/ai-costs] failed", err instanceof Error ? err : undefined);
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /api/founder/ai-cost/ceiling-status ──────────────────────────────
  // Real-time rolling-24h ceiling status — matches what
  // assertWithinPlatformCostCeiling() actually enforces. The /ai-costs
  // dashboard above shows calendar-day totals (good for trend), this
  // shows "how close am I right now to the cap?". Surfaces in the
  // founder Build page as a live $/$5 fuel gauge.
  app.get(
    "/api/founder/ai-cost/ceiling-status",
    isAuthenticated,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(
            res,
            "Cost ceiling status is restricted to founders",
          );
        }
        const since24h = new Date(Date.now() - 24 * 3600_000);
        const [row] = await db
          .select({
            cents: sql<string>`COALESCE(SUM(${aiTelemetryEvents.estimatedCostCents}), 0)`,
          })
          .from(aiTelemetryEvents)
          .where(gte(aiTelemetryEvents.createdAt, since24h));
        const usedCents = Number(row?.cents ?? 0);
        const ceilingCents = (() => {
          const fromEnv = process.env.AI_PLATFORM_DAILY_CEILING_CENTS;
          if (fromEnv) {
            const n = Number(fromEnv);
            if (Number.isFinite(n) && n > 0) return n;
          }
          return 500;
        })();
        const alertThresholdUsd = (() => {
          const fromEnv = process.env.AI_COST_ALERT_USD_THRESHOLD;
          if (fromEnv) {
            const n = Number(fromEnv);
            if (Number.isFinite(n) && n > 0) return n;
          }
          return 5;
        })();
        return res.json({
          windowHours: 24,
          usedUsd: usedCents / 100,
          ceilingUsd: ceilingCents / 100,
          remainingUsd: Math.max(0, (ceilingCents - usedCents) / 100),
          usedPct:
            ceilingCents > 0
              ? Math.min(100, (usedCents / ceilingCents) * 100)
              : 0,
          alertThresholdUsd,
          atCeiling: usedCents >= ceilingCents,
          aboveAlert: usedCents >= alertThresholdUsd * 100,
        });
      } catch (err) {
        logger.error(
          "[founder/ai-cost/ceiling-status] failed",
          err instanceof Error ? err : undefined,
        );
        return Errors.internal(res, err);
      }
    },
  );
}
