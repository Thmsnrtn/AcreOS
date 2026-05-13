/**
 * Pillar F / F2 — Pax customer-facing AI quality endpoint.
 *
 *   GET /api/founder/pax-quality
 *     Returns rolling-30-day measures of how Pax is doing for customers:
 *       - csat: thumbs-up vs thumbs-down ratio (from aiMessages.rating)
 *       - resolutionRate: % of support tickets resolved via Pax
 *       - costPerResolution: agent_llm_traces cost / resolved tickets
 *       - dailyCsat: per-day series for trending
 *       - totalConversations / totalMessages
 *
 * Single endpoint surfacing the metrics the audit flagged as missing —
 * fields exist in the DB, they just weren't being aggregated.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { sql } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerPaxQualityRoutes(app: Express): void {
  app.get(
    "/api/founder/pax-quality",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // ── Rating roll-up (last 30d) ────────────────────────────────────
        const ratingRow = await db.execute(sql.raw(`
          SELECT
            COUNT(*)::int                                                  AS rated_count,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int               AS thumbs_up,
            SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::int              AS thumbs_down
          FROM ai_messages
          WHERE rating IS NOT NULL
            AND created_at > NOW() - INTERVAL '30 days'
        `));
        const r = ((ratingRow as unknown as Array<{ rated_count: number; thumbs_up: number; thumbs_down: number }>)[0]) ?? {
          rated_count: 0,
          thumbs_up: 0,
          thumbs_down: 0,
        };
        const totalRated = Number(r.rated_count);
        const csatRatio = totalRated > 0 ? Number(r.thumbs_up) / totalRated : null;

        // ── Resolution rate from support tickets ─────────────────────────
        const ticketRow = await db.execute(sql.raw(`
          SELECT
            COUNT(*)::int                                                    AS opened,
            SUM(CASE WHEN resolved_at IS NOT NULL THEN 1 ELSE 0 END)::int    AS resolved,
            SUM(CASE WHEN resolution_type IN ('auto_fixed', 'knowledge_base') THEN 1 ELSE 0 END)::int AS resolved_by_pax
          FROM support_tickets
          WHERE created_at > NOW() - INTERVAL '30 days'
        `));
        const t = ((ticketRow as unknown as Array<{ opened: number; resolved: number; resolved_by_pax: number }>)[0]) ?? {
          opened: 0,
          resolved: 0,
          resolved_by_pax: 0,
        };
        const totalOpened = Number(t.opened);
        const totalResolved = Number(t.resolved);
        const resolvedByPax = Number(t.resolved_by_pax);

        // ── Pax LLM cost (last 30d) — for cost-per-resolution ────────────
        const costRow = await db.execute(sql.raw(`
          SELECT
            COUNT(*)::int                                                    AS calls,
            COALESCE(SUM(cost_cents), 0)::int                                AS cents
          FROM agent_llm_traces
          WHERE agent_codename IN ('pax', 'pax_support', 'support')
            AND created_at > NOW() - INTERVAL '30 days'
        `));
        const c = ((costRow as unknown as Array<{ calls: number; cents: number }>)[0]) ?? { calls: 0, cents: 0 };
        const totalCostCents = Number(c.cents);

        // ── Daily CSAT series (last 30d) ─────────────────────────────────
        const dailyRows = await db.execute(sql.raw(`
          SELECT
            date_trunc('day', created_at)::date::text AS day,
            SUM(CASE WHEN rating = 1 THEN 1 ELSE 0 END)::int  AS up,
            SUM(CASE WHEN rating = -1 THEN 1 ELSE 0 END)::int AS down
          FROM ai_messages
          WHERE rating IS NOT NULL
            AND created_at > NOW() - INTERVAL '30 days'
          GROUP BY 1
          ORDER BY 1
        `));
        const dailyCsat = ((dailyRows as unknown as Array<{ day: string; up: number; down: number }>) ?? []).map((d) => {
          const total = Number(d.up) + Number(d.down);
          return {
            day: d.day,
            ratio: total > 0 ? Number(d.up) / total : null,
            up: Number(d.up),
            down: Number(d.down),
          };
        });

        return res.json({
          windowDays: 30,
          generatedAt: new Date().toISOString(),
          csat: {
            ratedMessages: totalRated,
            thumbsUp: Number(r.thumbs_up),
            thumbsDown: Number(r.thumbs_down),
            ratio: csatRatio,
            daily: dailyCsat,
          },
          resolution: {
            ticketsOpened: totalOpened,
            ticketsResolved: totalResolved,
            ticketsResolvedByPax: resolvedByPax,
            paxResolutionRate: totalResolved > 0 ? resolvedByPax / totalResolved : null,
            overallResolutionRate: totalOpened > 0 ? totalResolved / totalOpened : null,
          },
          cost: {
            llmCalls: Number(c.calls),
            totalCostCents,
            totalCostUsd: totalCostCents / 100,
            costPerPaxResolutionCents:
              resolvedByPax > 0 ? Math.round(totalCostCents / resolvedByPax) : null,
          },
        });
      } catch (err: unknown) {
        logger.error("[pax-quality] query failed", err);
        return Errors.internal(res, err);
      }
    },
  );
}
