/**
 * Solene (Phase B L6.31) — founder-mode bypass HTTP surface.
 *
 *   POST /api/founder/bypass/dispatch
 *     Direct agent invocation with full founder authority. Priority 3.0 by
 *     default; founderOverride is set automatically when maxCostUsd > $100.
 *
 *   POST /api/founder/bypass/cancel/:id
 *     Cancel any in-flight dispatch (queued or in_progress).
 *
 *   GET /api/founder/bypass/recent
 *     Recent founder invocations (audit feed). ?limit=20 (max 100).
 *
 * Auth: isAuthenticated + requireFounder on every route.
 *
 * NOTE: Routes are authored but NOT yet registered in server/routes.ts —
 * that file is frozen this wave. Solene wires registerFounderBypassRoutes
 * into the main router in a follow-up session.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  founderDispatch,
  founderCancelDispatch,
  listFounderInvocations,
} from "@acreos/solene";
import { DISPATCH_AGENT_ROLES } from "@shared/schema/solene-dispatch";

const dispatchBodySchema = z.object({
  agentRole: z.enum(DISPATCH_AGENT_ROLES),
  promptText: z.string().min(1, "promptText required").max(50_000),
  maxCostUsd: z
    .number()
    .positive("maxCostUsd must be > 0")
    .max(10_000, "maxCostUsd must be <= $10,000"),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(60 * 60 * 1000)
    .optional(),
  priority: z.number().min(0).max(100).optional(),
  reason: z.string().max(2_000).optional(),
});

const cancelBodySchema = z.object({
  reason: z.string().min(1, "reason required").max(2_000),
});

export function registerFounderBypassRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // POST /api/founder/bypass/dispatch
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/bypass/dispatch",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = dispatchBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      try {
        const result = await founderDispatch(parsed.data);
        return res.json({
          dispatchId: result.dispatchId,
          bypassedCostCeiling: result.bypassedCostCeiling,
          bypassedPlanProposalStage: result.bypassedPlanProposalStage,
          recordedAt: result.recordedAt,
        });
      } catch (err) {
        logger.error("[founder-bypass] dispatch failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/bypass/cancel/:id
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/bypass/cancel/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = Number.parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id <= 0) {
        return Errors.badRequest(res, "dispatch id must be a positive integer");
      }
      const parsed = cancelBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.issues);
      }
      try {
        await founderCancelDispatch(id, parsed.data.reason);
        return res.status(204).end();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/no dispatch with id=/.test(message)) {
          return Errors.notFound(res, "Dispatch");
        }
        logger.error("[founder-bypass] cancel failed", {
          err: message,
          dispatchId: id,
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/founder/bypass/recent
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/bypass/recent",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const rawLimit = req.query.limit;
      let limit = 20;
      if (typeof rawLimit === "string" && rawLimit.length > 0) {
        const parsed = Number.parseInt(rawLimit, 10);
        if (!Number.isFinite(parsed) || parsed <= 0) {
          return Errors.badRequest(res, "limit must be a positive integer");
        }
        limit = Math.min(parsed, 100);
      }
      try {
        const invocations = await listFounderInvocations(limit);
        return res.json({
          invocations,
          count: invocations.length,
        });
      } catch (err) {
        logger.error("[founder-bypass] recent failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );
}
