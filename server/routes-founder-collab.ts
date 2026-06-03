/**
 * Solene (L6.32) — founder-collaboration endpoints.
 *
 * Tom-facing surface for answering / managing the asks dispatched agents
 * have raised. Read endpoints surface the inbox; write endpoints record
 * Tom's answer or supersede an ask whose situation has changed.
 *
 *   GET  /api/founder/asks
 *       ?status=open|answered|timed_out|superseded   (default: open)
 *       ?limit=20                                    (capped at 100)
 *
 *   GET  /api/founder/asks/:id
 *       Single ask + (when present) the recorded answer.
 *
 *   POST /api/founder/asks/:id/answer
 *       body: { answerText?, chosenOptionId? }
 *       Delegates to answerFounderAsk — all format validation lives there.
 *
 *   POST /api/founder/asks/:id/supersede
 *       body: { reason }
 *
 * Auth: isAuthenticated + requireFounder on every endpoint.
 *
 * NOT YET REGISTERED in server/routes.ts (frozen during Phase B). Solene
 * wires registerFounderCollabRoutes in follow-up.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  answerFounderAsk,
  getAsk,
  listOpenAsks,
  supersedeAsk,
} from "./services/solene/founderCollab";
import { db } from "./db";
import { soleneFounderAsks, FOUNDER_ASK_STATUSES, type SoleneFounderAskStatus } from "@shared/schema/solene-founder-collab";
import { desc, eq } from "drizzle-orm";

const DEFAULT_LIST_LIMIT = 20;
const MAX_LIST_LIMIT = 100;

export function registerFounderCollabRoutes(app: Express): void {
  // ────────────────────────────────────────────────────────────────────────
  // GET /api/founder/asks
  // ────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/founder/asks",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const rawStatus = typeof req.query.status === "string"
          ? req.query.status
          : "open";
        if (
          !(FOUNDER_ASK_STATUSES as readonly string[]).includes(rawStatus)
        ) {
          return Errors.badRequest(
            res,
            `Unknown status='${rawStatus}'`,
            { allowed: FOUNDER_ASK_STATUSES },
          );
        }
        const status = rawStatus as SoleneFounderAskStatus;

        const rawLimit = Number(req.query.limit ?? DEFAULT_LIST_LIMIT);
        const limit = Number.isFinite(rawLimit)
          ? Math.min(Math.max(1, Math.floor(rawLimit)), MAX_LIST_LIMIT)
          : DEFAULT_LIST_LIMIT;

        // The default surface — open asks — is sorted by urgency tier via
        // listOpenAsks. Other statuses are sorted newest-first.
        const rows = status === "open"
          ? (await listOpenAsks()).slice(0, limit)
          : await db
              .select()
              .from(soleneFounderAsks)
              .where(eq(soleneFounderAsks.status, status))
              .orderBy(desc(soleneFounderAsks.askedAt))
              .limit(limit);

        return res.json({
          asks: rows,
          count: rows.length,
        });
      } catch (err) {
        logger.error("[founder-collab] list-asks failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // GET /api/founder/asks/:id
  // ────────────────────────────────────────────────────────────────────────
  app.get(
    "/api/founder/asks/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid ask id");
        }
        const ask = await getAsk(id);
        if (!ask) {
          return Errors.notFound(res, "Ask");
        }
        return res.json({ ask });
      } catch (err) {
        logger.error("[founder-collab] get-ask failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // POST /api/founder/asks/:id/answer
  // ────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/founder/asks/:id/answer",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid ask id");
        }
        const { answerText, chosenOptionId } = (req.body ?? {}) as {
          answerText?: string;
          chosenOptionId?: string;
        };

        try {
          await answerFounderAsk({
            askId: id,
            answerText,
            chosenOptionId,
          });
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Errors.badRequest(res, message);
        }

        const updated = await getAsk(id);
        return res.json({ ask: updated });
      } catch (err) {
        logger.error("[founder-collab] answer-ask failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ────────────────────────────────────────────────────────────────────────
  // POST /api/founder/asks/:id/supersede
  // ────────────────────────────────────────────────────────────────────────
  app.post(
    "/api/founder/asks/:id/supersede",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
          return Errors.badRequest(res, "Invalid ask id");
        }
        const { reason } = (req.body ?? {}) as { reason?: string };
        if (!reason || reason.trim().length === 0) {
          return Errors.badRequest(res, "reason is required");
        }

        try {
          await supersedeAsk(id, reason);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          return Errors.badRequest(res, message);
        }

        const updated = await getAsk(id);
        return res.json({ ask: updated });
      } catch (err) {
        logger.error("[founder-collab] supersede-ask failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );
}
