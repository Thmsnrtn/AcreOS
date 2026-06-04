/**
 * SOLENE CHAT routes (Phase 2 of AcreOS-Solene migration).
 *
 *   POST  /api/founder/solene-chat/conversations
 *   GET   /api/founder/solene-chat/conversations
 *   GET   /api/founder/solene-chat/conversations/:id
 *   POST  /api/founder/solene-chat/conversations/:id/messages   (streams SSE)
 *   POST  /api/founder/solene-chat/conversations/:id/archive
 *   POST  /api/founder/solene-chat/conversations/:id/rename
 *   POST  /api/founder/solene-chat/conversations/:id/approve-tool
 *   GET   /api/founder/solene-chat/cost-summary
 *
 * Auth: isAuthenticated + requireFounder on every route.
 *
 * The /messages route streams text/event-stream events from runTurn; the
 * SSE response honors client disconnect via the AbortController fed into
 * runTurn's signal.
 *
 * Solene will wire registerSoleneChatRoutes into server/routes.ts in a
 * follow-up — this wave keeps routes.ts frozen.
 */

import type { Express, Response } from "express";
import { isAuthenticated, requireFounder } from "./auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import {
  archiveConversation,
  createConversation,
  getConversation,
  getConversationCostSummary,
  listConversations,
  renameConversation,
} from "./services/solene/conversationStore";
import { runTurn } from "./services/solene/chat/turnRunner";
import {
  deletePendingApproval,
  getPendingApproval,
} from "./services/solene/chat/toolExecutor";
import type { ContentBlock } from "./services/solene/chat/openRouterClient";
import type { ChatTier } from "@shared/schema/solene-chat-config";
import { CHAT_TIERS } from "@shared/schema/solene-chat-config";

// ============================================================================
// Helpers
// ============================================================================

function isValidContentBlockArray(x: unknown): x is ContentBlock[] {
  if (!Array.isArray(x) || x.length === 0) return false;
  return x.every(
    (b) =>
      b &&
      typeof b === "object" &&
      typeof (b as { type?: unknown }).type === "string",
  );
}

function isChatTier(x: unknown): x is ChatTier {
  return typeof x === "string" && (CHAT_TIERS as readonly string[]).includes(x);
}

function parseIdParam(raw: unknown): number | null {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0 || !Number.isInteger(n)) return null;
  return n;
}

// ============================================================================
// register
// ============================================================================

export function registerSoleneChatRoutes(app: Express): void {
  // ── POST /conversations ────────────────────────────────────────────────
  app.post(
    "/api/founder/solene-chat/conversations",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const body = (req.body ?? {}) as {
          startedSurface?: unknown;
          title?: unknown;
        };
        const startedSurface =
          typeof body.startedSurface === "string"
            ? body.startedSurface
            : "acreos";
        if (startedSurface !== "cli" && startedSurface !== "acreos" && startedSurface !== "cron") {
          return Errors.badRequest(res, "Invalid startedSurface");
        }
        const title = typeof body.title === "string" ? body.title : undefined;
        const founderUserId = getUserId(req);
        const result = await createConversation({
          startedSurface,
          title,
          founderUserId,
        });
        return res.json({ conversationId: result.conversationId });
      } catch (err) {
        logger.error("[soleneChat] POST /conversations failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /conversations ─────────────────────────────────────────────────
  app.get(
    "/api/founder/solene-chat/conversations",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const archived =
          req.query.archived === "true"
            ? true
            : req.query.archived === "false"
              ? false
              : undefined;
        const limitRaw = req.query.limit;
        const limit =
          typeof limitRaw === "string" ? Math.floor(Number(limitRaw)) : undefined;
        const founderUserId = getUserId(req);
        const rows = await listConversations({
          founderUserId,
          archived,
          limit: Number.isFinite(limit) ? limit : undefined,
        });
        return res.json({ conversations: rows });
      } catch (err) {
        logger.error("[soleneChat] GET /conversations failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /conversations/:id ─────────────────────────────────────────────
  app.get(
    "/api/founder/solene-chat/conversations/:id",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = parseIdParam(req.params.id);
      if (id === null) {
        return Errors.badRequest(res, "Invalid conversation id");
      }
      try {
        const convo = await getConversation(id);
        if (!convo) {
          return Errors.notFound(res, "Conversation");
        }
        return res.json(convo);
      } catch (err) {
        logger.error("[soleneChat] GET /conversations/:id failed", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /conversations/:id/messages (streamed SSE) ─────────────────────
  app.post(
    "/api/founder/solene-chat/conversations/:id/messages",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = parseIdParam(req.params.id);
      if (id === null) {
        return Errors.badRequest(res, "Invalid conversation id");
      }
      const body = (req.body ?? {}) as {
        userMessage?: unknown;
        tierHint?: unknown;
      };
      if (!isValidContentBlockArray(body.userMessage)) {
        return Errors.badRequest(
          res,
          "userMessage must be a non-empty content-block array",
        );
      }
      const tierHint = isChatTier(body.tierHint) ? body.tierHint : undefined;

      let founderUserId: string;
      try {
        founderUserId = getUserId(req);
      } catch (err) {
        return Errors.unauthorized(res);
      }

      // ── SSE headers ──
      res.status(200);
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("Connection", "keep-alive");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();

      const abortController = new AbortController();
      req.on("close", () => {
        if (!res.writableEnded) {
          abortController.abort();
        }
      });

      const writeEvent = (event: string, data: unknown) => {
        try {
          res.write(`event: ${event}\n`);
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch {
          /* swallow — connection closed */
        }
      };

      try {
        for await (const ev of runTurn(
          {
            conversationId: id,
            userMessage: body.userMessage,
            founderUserId,
            tierHint,
          },
          abortController.signal,
        )) {
          writeEvent(ev.type, ev.data);
          if (ev.type === "turn_done" || ev.type === "error") {
            break;
          }
        }
      } catch (err) {
        logger.error("[soleneChat] runTurn threw", { err: String(err) });
        writeEvent("error", {
          message: `runTurn threw: ${err instanceof Error ? err.message : String(err)}`,
        });
      } finally {
        try {
          res.end();
        } catch {
          /* swallow */
        }
      }
    },
  );

  // ── POST /conversations/:id/archive ────────────────────────────────────
  app.post(
    "/api/founder/solene-chat/conversations/:id/archive",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = parseIdParam(req.params.id);
      if (id === null) {
        return Errors.badRequest(res, "Invalid conversation id");
      }
      try {
        await archiveConversation(id);
        return res.status(204).send();
      } catch (err) {
        logger.error("[soleneChat] archive failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /conversations/:id/rename ─────────────────────────────────────
  app.post(
    "/api/founder/solene-chat/conversations/:id/rename",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = parseIdParam(req.params.id);
      if (id === null) {
        return Errors.badRequest(res, "Invalid conversation id");
      }
      const body = (req.body ?? {}) as { title?: unknown };
      if (typeof body.title !== "string" || body.title.trim().length === 0) {
        return Errors.badRequest(res, "title must be a non-empty string");
      }
      try {
        await renameConversation(id, body.title.trim());
        return res.status(204).send();
      } catch (err) {
        logger.error("[soleneChat] rename failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );

  // ── POST /conversations/:id/approve-tool ──────────────────────────────
  app.post(
    "/api/founder/solene-chat/conversations/:id/approve-tool",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      const id = parseIdParam(req.params.id);
      if (id === null) {
        return Errors.badRequest(res, "Invalid conversation id");
      }
      const body = (req.body ?? {}) as {
        approvalToken?: unknown;
        decision?: unknown;
      };
      const approvalToken =
        typeof body.approvalToken === "string" ? body.approvalToken : "";
      const decision = body.decision === "approve" ? "approve" : body.decision === "reject" ? "reject" : null;
      if (!approvalToken || decision === null) {
        return Errors.badRequest(
          res,
          "approvalToken + decision (approve|reject) required",
        );
      }
      const pending = getPendingApproval(approvalToken);
      if (!pending) {
        return Errors.notFound(res, "Pending approval");
      }
      if (pending.conversationId !== id) {
        return Errors.badRequest(res, "approvalToken conversationId mismatch");
      }
      deletePendingApproval(approvalToken);

      if (decision === "reject") {
        logger.info("[soleneChat] approval rejected", {
          approvalToken,
          toolName: pending.toolName,
          conversationId: id,
        });
        return res.json({ status: "rejected" });
      }

      // approve → run the tool now under the founder's identity.
      try {
        // Force the tool through the auto-allowed code path by directly invoking
        // the underlying dispatch executor (skipping classifyChatTool, which
        // would re-block it).
        const { executeDispatchTool } = await import(
          "./services/solene/dispatchToolExecutor"
        );
        const result = await executeDispatchTool(
          pending.toolName,
          pending.toolInput,
          { dispatchId: null, agentRole: "solene-chat" },
        );
        logger.info("[soleneChat] approval executed", {
          approvalToken,
          toolName: pending.toolName,
          success: result.success,
          durationMs: result.durationMs,
        });
        return res.json({
          status: "executed",
          success: result.success,
          output: result.output,
          durationMs: result.durationMs,
        });
      } catch (err) {
        logger.error("[soleneChat] approval execute threw", {
          err: String(err),
        });
        return Errors.internal(res, err);
      }
    },
  );

  // ── GET /cost-summary ──────────────────────────────────────────────────
  app.get(
    "/api/founder/solene-chat/cost-summary",
    isAuthenticated,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const conversationIdRaw = req.query.conversationId;
        const conversationId =
          typeof conversationIdRaw === "string"
            ? parseIdParam(conversationIdRaw)
            : null;
        if (conversationId === null) {
          return Errors.badRequest(
            res,
            "conversationId query param required",
          );
        }
        const summary = await getConversationCostSummary(conversationId);
        return res.json(summary);
      } catch (err) {
        logger.error("[soleneChat] cost-summary failed", { err: String(err) });
        return Errors.internal(res, err);
      }
    },
  );
}
