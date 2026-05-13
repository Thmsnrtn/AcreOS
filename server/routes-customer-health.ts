/**
 * Pillar E / E4+E9 — Customer health endpoint.
 *
 *   GET /api/founder/customer-health
 *     Returns most-recent score per org (DISTINCT ON), filterable by band.
 *
 *   GET /api/founder/customer-health/distribution
 *     Count of orgs in each band as of the latest scoring run.
 */

import type { Express, Response } from "express";
import { db } from "./db";
import { customerHealthScores, organizations, HEALTH_BANDS } from "@shared/schema";
import { eq, sql, desc } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

export function registerCustomerHealthRoutes(app: Express): void {
  app.get(
    "/api/founder/customer-health",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const band = req.query.band as string | undefined;
        const limit = Math.min(200, Math.max(1, parseInt((req.query.limit as string) || "100", 10)));

        // Most recent score per org via DISTINCT ON. Joined to organizations
        // for name + tier display.
        const rows = await db.execute(sql.raw(`
          SELECT DISTINCT ON (h.organization_id)
            h.organization_id,
            o.name,
            o.subscription_tier,
            h.score,
            h.band,
            h.usage_velocity_points,
            h.feature_breadth_points,
            h.nps_signal_points,
            h.data_quality_points,
            h.pax_engagement_points,
            h.signals,
            h.calculated_at
          FROM customer_health_scores h
          JOIN organizations o ON o.id = h.organization_id
          ${band && (HEALTH_BANDS as readonly string[]).includes(band) ? `WHERE h.band = '${band}'` : ""}
          ORDER BY h.organization_id, h.calculated_at DESC
          LIMIT ${limit}
        `));

        return res.json({
          scores: rows ?? [],
          generatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        logger.error("[customer-health] list failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  app.get(
    "/api/founder/customer-health/distribution",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        // Distribution = count per band of the LATEST score per org.
        const rows = await db.execute(sql.raw(`
          WITH latest AS (
            SELECT DISTINCT ON (organization_id) organization_id, band, score, calculated_at
            FROM customer_health_scores
            ORDER BY organization_id, calculated_at DESC
          )
          SELECT band, count(*)::int AS n, ROUND(AVG(score)::numeric, 1) AS avg_score
          FROM latest
          GROUP BY band
        `));

        const distribution: Record<string, { n: number; avgScore: number }> = {};
        for (const row of (rows as unknown as Array<{ band: string; n: number; avg_score: string | number }>) ?? []) {
          distribution[row.band] = { n: Number(row.n), avgScore: Number(row.avg_score) };
        }

        return res.json({
          distribution,
          bands: [...HEALTH_BANDS],
          generatedAt: new Date().toISOString(),
        });
      } catch (err: unknown) {
        logger.error("[customer-health] distribution failed", err);
        return Errors.internal(res, err);
      }
    },
  );

  // Helper: void unused-import warning if any code path doesn't reference
  // the `organizations` symbol.
  void organizations;
  void eq;
  void desc;
}
