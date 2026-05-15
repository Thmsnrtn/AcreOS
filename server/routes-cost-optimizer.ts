/**
 * routes-cost-optimizer — Founder-only endpoints for the self-tuning cost
 * optimiser (Wave 8).
 *
 *   GET  /api/founder/cost-optimizer/runs?limit=30
 *        → paginated list of nightly optimiser runs (default 30 days).
 *
 *   POST /api/founder/cost-optimizer/apply
 *        Body: { runId: number, recommendationId: string }
 *        → records the operator approval and applies the change. Mutates
 *        the recommendation row in-place to capture appliedAt + appliedBy.
 *
 *   POST /api/founder/cost-optimizer/run-now
 *        → triggers an out-of-band optimiser run. Useful from the dashboard
 *        when the founder wants a fresh snapshot rather than waiting for
 *        the nightly cycle.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { desc } from "drizzle-orm";

import type { AuthenticatedRequest } from "./types/request";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

import { db } from "./db";
import { costOptimizationRuns } from "@shared/schema";
import { applyRecommendation, runCostOptimizer } from "./jobs/costOptimizer";

const applyBodySchema = z.object({
  runId: z.number().int().positive(),
  recommendationId: z.string().min(1).max(128),
});

export function registerCostOptimizerRoutes(app: Express): void {
  // ── GET /api/founder/cost-optimizer/runs ─────────────────────────────────
  app.get(
    "/api/founder/cost-optimizer/runs",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Cost optimiser is restricted to founders");
        }
        const limitRaw = Number(req.query.limit ?? 30);
        const limit = Number.isFinite(limitRaw) ? Math.min(Math.max(limitRaw, 1), 90) : 30;

        const rows = await db
          .select()
          .from(costOptimizationRuns)
          .orderBy(desc(costOptimizationRuns.runAt))
          .limit(limit);

        // Numeric columns come back as strings via drizzle/pg; normalise for the UI.
        const runs = rows.map((r) => ({
          id: r.id,
          runAt: r.runAt,
          totalAiCostUsd: Number(r.totalAiCostUsd ?? 0),
          totalFlyCostUsd: Number(r.totalFlyCostUsd ?? 0),
          customerCount: r.customerCount,
          mrrUsd: Number(r.mrrUsd ?? 0),
          profitMarginPct: Number(r.profitMarginPct ?? 0),
          recommendations: r.recommendations ?? [],
          autoAppliedActions: r.autoAppliedActions ?? [],
          summary: r.summary ?? "",
        }));

        return res.json({ runs });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/founder/cost-optimizer/apply ───────────────────────────────
  app.post(
    "/api/founder/cost-optimizer/apply",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Applying recommendations is restricted to founders");
        }
        const parsed = applyBodySchema.safeParse(req.body);
        if (!parsed.success) {
          return Errors.validationFailed(res, parsed.error.issues);
        }
        const approverEmail = req.user?.email ?? "founder";
        const result = await applyRecommendation({
          runId: parsed.data.runId,
          recommendationId: parsed.data.recommendationId,
          approverEmail,
        });
        if (!result.ok) {
          if (result.reason === "run_not_found" || result.reason === "recommendation_not_found") {
            return Errors.notFound(res, "recommendation");
          }
          if (result.reason === "already_applied") {
            return Errors.badRequest(res, "Recommendation already applied");
          }
          return Errors.badRequest(res, `Could not apply recommendation: ${result.reason}`);
        }
        logger.info("[CostOptimizer] founder applied recommendation", {
          metadata: {
            runId: parsed.data.runId,
            recommendationId: parsed.data.recommendationId,
            approver: approverEmail,
          },
        });
        return res.json({ ok: true, recommendation: result.recommendation });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /api/founder/cost-optimizer/run-now ─────────────────────────────
  app.post(
    "/api/founder/cost-optimizer/run-now",
    isAuthenticated,
    getOrCreateOrg,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        if (!req.isFounder) {
          return Errors.forbidden(res, "Triggering optimiser runs is restricted to founders");
        }
        const result = await runCostOptimizer();
        return res.json({ ok: true, ...result });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
