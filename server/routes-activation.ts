/**
 * Phase 3 Week 14 — Founder activation funnel API.
 *
 * Reads activation_events to compute the funnel: % of orgs hitting each
 * canonical event in their first 7 / 30 / 90 days. Founder-gated.
 *
 *   GET /api/founder/activation/funnel?window=7|30|90  — funnel %
 *   GET /api/founder/activation/recent                  — last 50 events
 *   GET /api/founder/activation/by-event                — totals per event
 */

import type { Express } from "express";
import { desc, sql } from "drizzle-orm";

import { db } from "./db";
import { activationEvents, ACTIVATION_EVENTS } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { getActivationFunnel } from "./services/activation";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import type { AuthenticatedRequest } from "./types/request";

function requireFounder(req: AuthenticatedRequest, res: any): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.forbidden(res, "Founder access required");
    return false;
  }
  return true;
}

export function registerActivationRoutes(app: Express): void {
  app.get("/api/founder/activation/funnel", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;

    const windowParam = String(req.query.window ?? "30");
    const windowDays: 7 | 30 | 90 =
      windowParam === "7" ? 7 : windowParam === "90" ? 90 : 30;

    try {
      const funnel = await getActivationFunnel(windowDays);

      // Pad in canonical event names that haven't fired so the UI always
      // shows the full event list (with 0% bars).
      const seen = new Set(funnel.events.map((e) => e.eventName));
      const padded = [...funnel.events];
      for (const name of ACTIVATION_EVENTS) {
        if (!seen.has(name)) {
          padded.push({
            eventName: name,
            orgsHit: 0,
            totalOrgs: funnel.totalOrgs,
            pct: 0,
          });
        }
      }
      padded.sort((a, b) => b.pct - a.pct);

      return res.json({
        windowDays: funnel.windowDays,
        totalOrgs: funnel.totalOrgs,
        events: padded,
      });
    } catch (err) {
      logger.error("[activation] funnel query failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.get("/api/founder/activation/recent", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;

    const limit = Math.min(parseInt(String(req.query.limit ?? "50"), 10) || 50, 200);

    try {
      const rows = await db
        .select()
        .from(activationEvents)
        .orderBy(desc(activationEvents.occurredAt))
        .limit(limit);
      return res.json({ events: rows });
    } catch (err) {
      logger.error("[activation] recent query failed", err as Error);
      return Errors.internal(res, err);
    }
  });

  app.get("/api/founder/activation/by-event", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;

    try {
      const result = await db.execute(sql`
        SELECT event_name AS "eventName", COUNT(*)::int AS count
        FROM activation_events
        GROUP BY event_name
        ORDER BY count DESC
      `);
      const rows = (result as any).rows ?? (result as any) ?? [];
      return res.json({ events: rows });
    } catch (err) {
      logger.error("[activation] by-event query failed", err as Error);
      return Errors.internal(res, err);
    }
  });
}
