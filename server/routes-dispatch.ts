/**
 * Solene (Layer 1 cap #1) — founder HTTP surface for the dispatch queue.
 *
 *   POST /api/founder/dispatches/queue       — enqueue a new dispatch
 *   GET  /api/founder/dispatches             — list recent rows (+ result join)
 *   GET  /api/founder/dispatches/:id         — one row + result
 *   POST /api/founder/dispatches/:id/cancel  — queued -> cancelled (founder kill)
 *
 * Auth: isAuthenticated + requireFounder.
 *
 * Closes the runtime gap from commit cd290f4c — the worker loop + schema were
 * already live; this file is the founder-facing enqueue + visibility surface.
 *
 * The dispatchQueue service is the canonical owner of queue-mutating logic;
 * these handlers are thin: zod-validate, call the service, shape the response.
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  cancelQueuedDispatch,
  DEAD_LETTER_MARKER,
  enqueueDispatch,
  getDispatchById,
  listDispatches,
} from "@acreos/solene";
import {
  DISPATCH_AGENT_ROLES,
  DISPATCH_SOURCE_TYPES,
  DISPATCH_STATUSES,
} from "@shared/schema/solene-dispatch";

// ---------------------------------------------------------------------------
// zod schemas
// ---------------------------------------------------------------------------

const enqueueBodySchema = z.object({
  sourceType: z.enum(DISPATCH_SOURCE_TYPES),
  sourceId: z.string().min(1).max(512),
  agentRole: z.enum(DISPATCH_AGENT_ROLES),
  promptText: z.string().min(1).max(50_000),
  maxCostUsd: z.number().positive().finite().optional(),
  timeoutMs: z.number().int().positive().finite().optional(),
  priority: z.number().positive().finite().optional(),
  enqueuedBy: z.string().min(1).max(256).optional(),
  founderOverride: z.boolean().optional(),
});

const listQuerySchema = z.object({
  status: z.enum(DISPATCH_STATUSES).optional(),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

const idParamSchema = z.object({
  id: z.coerce.number().int().positive(),
});

const cancelBodySchema = z.object({
  reason: z.string().max(2_000).optional(),
});

// ---------------------------------------------------------------------------
// Response shaping — keep numeric fields as numbers for the founder client
// rather than the raw drizzle numeric-string columns.
// ---------------------------------------------------------------------------

function shapeDispatchRow(
  row: Awaited<ReturnType<typeof getDispatchById>>,
): unknown {
  if (!row) return null;
  const q = row.queue;
  const r = row.result;
  return {
    id: q.id,
    queuedAt: q.queuedAt,
    status: q.status,
    priority: Number(q.priority),
    sourceType: q.sourceType,
    sourceId: q.sourceId,
    agentRole: q.agentRole,
    promptText: q.promptText,
    maxCostUsd: Number(q.maxCostUsd),
    timeoutMs: q.timeoutMs,
    startedAt: q.startedAt,
    completedAt: q.completedAt,
    resultSummary: q.resultSummary,
    resultFullPath: q.resultFullPath,
    enqueuedBy: q.enqueuedBy,
    // Retry telemetry (step-away gap #3): how many runs actually started, when
    // a retried row becomes claimable again, and whether it exhausted its
    // retry budget (the dead-letter surface the Control door filters on).
    attempts: q.attempts,
    notBeforeAt: q.notBeforeAt,
    deadLettered: q.status === "failed" && (q.resultSummary ?? "").startsWith(DEAD_LETTER_MARKER),
    result: r
      ? {
          success: r.success,
          costUsd: Number(r.costUsd),
          durationMs: r.durationMs,
          tokenInput: r.tokenInput,
          tokenOutput: r.tokenOutput,
          errorMessage: r.errorMessage,
          commitsReferenced: r.commitsReferenced ?? [],
          filesModified: r.filesModified ?? [],
          followUpOpportunities: r.followUpOpportunities ?? {},
          recordedAt: r.recordedAt,
        }
      : null,
  };
}

// ---------------------------------------------------------------------------
// Route registration
// ---------------------------------------------------------------------------

export function registerDispatchRoutes(app: Express): void {
  // -------------------------------------------------------------------------
  // POST /api/founder/dispatches/queue
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/dispatches/queue",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = enqueueBodySchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const dispatchId = await enqueueDispatch(parsed.data);
        return res.status(201).json({ dispatchId });
      } catch (err) {
        // enqueueDispatch throws plain Error for cost-cap / prompt-empty /
        // invalid-timeout violations. Treat them as 400 bad-request — they are
        // user-fixable validation failures at the service layer, not 5xx.
        const message = err instanceof Error ? err.message : String(err);
        logger.warn("[dispatch] enqueue rejected", { err: message });
        return Errors.badRequest(res, message);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/founder/dispatches
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/dispatches",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = listQuerySchema.safeParse(req.query);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const rows = await listDispatches({
          status: parsed.data.status,
          limit: parsed.data.limit,
        });
        return res.json({
          dispatches: rows.map((r) => shapeDispatchRow(r)),
          count: rows.length,
        });
      } catch (err) {
        logger.error("[dispatch] list failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // GET /api/founder/dispatches/:id
  // -------------------------------------------------------------------------
  app.get(
    "/api/founder/dispatches/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const parsed = idParamSchema.safeParse(req.params);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      try {
        const row = await getDispatchById(parsed.data.id);
        if (!row) return Errors.notFound(res, "Dispatch");
        return res.json({ dispatch: shapeDispatchRow(row) });
      } catch (err) {
        logger.error("[dispatch] get-by-id failed", {
          id: parsed.data.id,
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // -------------------------------------------------------------------------
  // POST /api/founder/dispatches/:id/cancel
  // -------------------------------------------------------------------------
  app.post(
    "/api/founder/dispatches/:id/cancel",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const paramsParsed = idParamSchema.safeParse(req.params);
      if (!paramsParsed.success) {
        return Errors.validationFailed(res, paramsParsed.error.flatten());
      }
      const bodyParsed = cancelBodySchema.safeParse(req.body ?? {});
      if (!bodyParsed.success) {
        return Errors.validationFailed(res, bodyParsed.error.flatten());
      }
      try {
        const result = await cancelQueuedDispatch(
          paramsParsed.data.id,
          bodyParsed.data.reason ?? "",
        );
        if (result.priorStatus === null) {
          return Errors.notFound(res, "Dispatch");
        }
        if (!result.ok) {
          // Wrong state — cannot cancel from in_progress / completed / failed /
          // cancelled. In particular, in_progress is rejected because the
          // worker is mid-call and cancellation would orphan it.
          return Errors.badRequest(
            res,
            `Dispatch is in status '${result.priorStatus}'; only 'queued' rows can be cancelled.`,
            { priorStatus: result.priorStatus },
          );
        }
        return res.json({ ok: true, id: paramsParsed.data.id });
      } catch (err) {
        logger.error("[dispatch] cancel failed", {
          id: paramsParsed.data.id,
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );
}
