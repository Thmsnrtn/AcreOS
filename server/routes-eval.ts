/**
 * Eval Routes — Wave: cost (worker dispatch).
 *
 * Eval suites (evals/run-eval.ts) are CPU-heavy because they fan out
 * model calls + judge calls. Running them on the customer-facing app
 * machine starves real requests. Instead, the route handler enqueues
 * an `eval_run` event onto the outbox table; the worker process group
 * (server/worker.ts) consumes it.
 *
 * Surface:
 *   POST /api/eval/run    body: { suite?, limit? }
 *     → 202 { outboxId, status: "pending" }
 *   GET  /api/eval/run/:outboxId
 *     → { outboxId, status, attempts, lastErrorMessage, sentAt }
 *
 * Founder-gated for v1 — eval is a founder-facing tooling surface.
 */

import { Router, type Response } from "express";
import { type AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { stampTraceContext } from "./utils/queueTraceContext";
import { db } from "./db";
import { outbox } from "@shared/schema";
import { eq } from "drizzle-orm";

const router = Router();

router.post("/run", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.isFounder) {
    return Errors.forbidden(res, "Eval endpoints are founder-only");
  }
  try {
    const suite = typeof req.body?.suite === "string" ? req.body.suite : undefined;
    const limit = typeof req.body?.limit === "number" ? req.body.limit : undefined;

    const [row] = await db
      .insert(outbox)
      .values({
        eventType: "eval_run",
        status: "pending",
        attempts: 0,
        payload: stampTraceContext({
          suite: suite ?? "default",
          ...(limit ? { limit } : {}),
        }),
      })
      .returning({ id: outbox.id });

    logger.info("eval.run.enqueued", { outboxId: row?.id, suite, limit });
    res.status(202).json({ outboxId: row?.id, status: "pending" });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.get("/run/:outboxId", async (req: AuthenticatedRequest, res: Response) => {
  if (!req.isFounder) {
    return Errors.forbidden(res, "Eval endpoints are founder-only");
  }
  try {
    const outboxId = parseInt(req.params.outboxId, 10);
    if (Number.isNaN(outboxId)) return Errors.badRequest(res, "outboxId must be numeric");
    const [row] = await db.select().from(outbox).where(eq(outbox.id, outboxId)).limit(1);
    if (!row || row.eventType !== "eval_run") return Errors.notFound(res, "Eval run");
    res.json({
      outboxId: row.id,
      status: row.status,
      attempts: row.attempts,
      lastErrorMessage: row.lastErrorMessage,
      sentAt: row.sentAt,
      createdAt: row.createdAt,
    });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
