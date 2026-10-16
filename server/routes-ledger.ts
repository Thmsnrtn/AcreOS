/**
 * routes-ledger — Operations Ledger API for the AI COO.
 *
 * Append-only. No PUT. No DELETE. Ever.
 *
 * POST /api/ops/ledger — Append an entry (COO service token auth)
 * GET  /api/ops/ledger — Query entries (filters: actor, actionType, status, since, until, limit)
 *
 * Auth: Same bearer token as /api/ops/* (OPS_SERVICE_TOKEN).
 * GET-only + POST-only. No other methods.
 */

import type { Express, Request, Response } from "express";
import { sql, desc, eq, and, gte, lte } from "drizzle-orm";
import { unscopedForPlatformOps } from "./utils/orgScopedDb";
import { cooLedger } from "@shared/schema";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { clock } from "./utils/clock";

// Reuse the ops auth middleware pattern from routes-ops.ts
// (imported here to avoid duplication — in production, extract to shared module)
import crypto from "crypto";
import { sendError } from "./utils/errors";

function opsServiceAuth(req: Request, res: Response, next: Function): void {
  const expected = process.env.OPS_SERVICE_TOKEN;
  if (!expected) {
    sendError(res, 503, "UNAVAILABLE", "Ops API not configured");
    return;
  }
  if (req.method !== "GET" && req.method !== "HEAD" && req.method !== "POST") {
    sendError(res, 403, "FORBIDDEN", "Ops service token is read-only except ledger append");
    return;
  }
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith("Bearer ")) {
    sendError(res, 401, "UNAUTHORIZED", "Missing bearer token");
    return;
  }
  const token = auth.slice("Bearer ".length).trim();
  const a = Buffer.from(token, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    sendError(res, 401, "UNAUTHORIZED", "Invalid token");
    return;
  }
  (next as Function)();
}

const REASON = "AI COO ops ledger: append-only record of COO/autopilot actions (read-only except append)";

export function registerLedgerRoutes(app: Express): void {
  // Append a ledger entry
  app.post("/api/ops/ledger", opsServiceAuth, async (req: Request, res: Response) => {
    try {
      const { actor, actionType, target, reasoning, status, resultSummary, costUsd, parentId, metadata } = req.body;

      if (!actionType || typeof actionType !== "string") {
        return Errors.badRequest(res, "actionType is required");
      }

      // Validate actor
      const validActors = ["coo", "founder", "autopilot", "system"];
      const safeActor = validActors.includes(actor) ? actor : "coo";

      // Validate status
      const validStatuses = ["started", "completed", "failed", "blocked"];
      const safeStatus = validStatuses.includes(status) ? status : "completed";

      const rows = await unscopedForPlatformOps(REASON)
        .insert(cooLedger)
        .values({
          actor: safeActor,
          actionType,
          target: target || null,
          reasoning: reasoning || null,
          status: safeStatus,
          resultSummary: resultSummary || null,
          costUsd: costUsd ? String(costUsd) : null,
          parentId: parentId || null,
          metadata: metadata || null,
        })
        .returning({ id: cooLedger.id, createdAt: cooLedger.createdAt });

      return res.json({
        id: rows[0].id,
        createdAt: rows[0].createdAt,
      });
    } catch (err) {
      logger.error("[/api/ops/ledger POST] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });

  // Query ledger entries
  app.get("/api/ops/ledger", opsServiceAuth, async (req: Request, res: Response) => {
    try {
      const { actor, actionType, status, since, until, limit } = req.query;

      const conditions = [];
      if (actor && typeof actor === "string") {
        conditions.push(eq(cooLedger.actor, actor));
      }
      if (actionType && typeof actionType === "string") {
        conditions.push(eq(cooLedger.actionType, actionType));
      }
      if (status && typeof status === "string") {
        conditions.push(eq(cooLedger.status, status));
      }
      if (since && typeof since === "string") {
        conditions.push(gte(cooLedger.createdAt, new Date(since)));
      }
      if (until && typeof until === "string") {
        conditions.push(lte(cooLedger.createdAt, new Date(until)));
      }

      const limitNum = Math.min(parseInt(limit as string) || 100, 1000);

      const rows = await unscopedForPlatformOps(REASON)
        .select()
        .from(cooLedger)
        .where(conditions.length > 0 ? and(...conditions) : undefined)
        .orderBy(desc(cooLedger.createdAt))
        .limit(limitNum);

      return res.json({
        asOf: clock.now().toISOString(),
        count: rows.length,
        entries: rows,
      });
    } catch (err) {
      logger.error("[/api/ops/ledger GET] failed", err instanceof Error ? err : undefined);
      return Errors.internal(res, err);
    }
  });
}
