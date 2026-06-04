/**
 * Phase D2 — founder onboarding-funnel routes.
 *
 *   GET  /api/founder/onboarding-funnel/summary?windowDays=30
 *     Returns FunnelSummary — totals + percentiles + 90-second threshold +
 *     abandonment by step.
 *
 *   GET  /api/founder/onboarding-funnel/orgs?limit=50&sortBy=ttfv|signup_at
 *     Per-org listing for the founder drill-down table. Latest snapshot
 *     per org.
 *
 *   GET  /api/founder/onboarding-funnel/orgs/:orgId
 *     Single-org detail: metric row + qualifying event + recent lifecycle
 *     events.
 *
 *   POST /api/founder/onboarding-funnel/recompute
 *     Triggers a fresh computeFunnelMetrics run. Returns the result
 *     summary (orgsProcessed / metricsWritten / errors / durationMs).
 *
 * Auth: isAuthenticated + requireFounder.
 *
 * Registration is a Solene follow-up — routes.ts is frozen this wave. The
 * register function is exported so a later patch can wire it into
 * server/routes.ts alongside registerDispatchRoutes / registerAgentClaimsRoutes.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { desc, asc } from "drizzle-orm";

import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { db } from "./db";
import { onboardingFunnelMetrics } from "@shared/schema/onboarding-funnel";
import {
  computeFunnelMetrics,
  getFunnelSummary,
  getOrgFunnelDetail,
} from "./services/onboarding/firstValueInstrumentation";

// ─── Query schemas ─────────────────────────────────────────────────────────

const summaryQuerySchema = z.object({
  windowDays: z
    .preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number().int().min(1).max(365),
    )
    .optional()
    .default(30),
});

const orgsQuerySchema = z.object({
  limit: z
    .preprocess(
      (v) => (typeof v === "string" ? Number(v) : v),
      z.number().int().min(1).max(500),
    )
    .optional()
    .default(50),
  sortBy: z
    .enum(["time_to_first_value_seconds", "signup_at", "measured_date"])
    .optional()
    .default("time_to_first_value_seconds"),
  sortDir: z.enum(["asc", "desc"]).optional().default("asc"),
});

const orgIdParamSchema = z.object({
  orgId: z.string().min(1).max(64),
});

// ─── Route registration ────────────────────────────────────────────────────

export function registerOnboardingFunnelRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // GET /api/founder/onboarding-funnel/summary
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/onboarding-funnel/summary",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = summaryQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const summary = await getFunnelSummary(parsed.data.windowDays);
        return res.json(summary);
      } catch (err) {
        logger.error("[onboarding-funnel] summary failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/founder/onboarding-funnel/orgs
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/onboarding-funnel/orgs",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = orgsQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const { limit, sortBy, sortDir } = parsed.data;
        // Sort column resolution: map the public sort key to the drizzle
        // column. Nulls last is the safe default for TTFV (incomplete
        // orgs sink to the bottom of an asc sort).
        const col =
          sortBy === "signup_at"
            ? onboardingFunnelMetrics.signupAt
            : sortBy === "measured_date"
              ? onboardingFunnelMetrics.measuredDate
              : onboardingFunnelMetrics.timeToFirstValueSeconds;
        const orderByExpr = sortDir === "asc" ? asc(col) : desc(col);

        const rows = await db
          .select()
          .from(onboardingFunnelMetrics)
          .orderBy(orderByExpr)
          .limit(limit);

        return res.json({
          orgs: rows,
          count: rows.length,
        });
      } catch (err) {
        logger.error("[onboarding-funnel] orgs-list failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/founder/onboarding-funnel/orgs/:orgId
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/onboarding-funnel/orgs/:orgId",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = orgIdParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const detail = await getOrgFunnelDetail(parsed.data.orgId);
        if (!detail) {
          return Errors.notFound(res, "Onboarding funnel metric");
        }
        return res.json(detail);
      } catch (err) {
        logger.error("[onboarding-funnel] org-detail failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/onboarding-funnel/recompute
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/onboarding-funnel/recompute",
    isAuthenticated,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const result = await computeFunnelMetrics();
        return res.json(result);
      } catch (err) {
        // computeFunnelMetrics is fire-and-forget internally and never
        // throws — but belt-and-suspenders for the founder-triggered path.
        logger.error("[onboarding-funnel] recompute failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );
}
