/**
 * Founder Critical Alerts API
 *
 * Backs the founder-bell "Critical alerts" view + ack-timer countdown.
 *
 * Concept: P0/P1 notifications carry an ack deadline (15 min for P0,
 * 60 min for P1 by default). If the founder doesn't ack within the
 * window, we flip an `escalated_at` flag and surface a banner
 * "P0 unacked for X min — escalate now?". Real paging integrations
 * (PagerDuty/Opsgenie) plug in later by reading the same table.
 *
 * Endpoints:
 *   GET    /api/founder/critical-alerts              — list current alerts (unacked + recently-escalated)
 *   POST   /api/founder/critical-alerts/:id/ack      — operator acks a specific alert
 *   POST   /api/founder/critical-alerts/:id/escalate — manually trigger escalation (sets escalated_at now)
 */

import { Router, type Response } from "express";
import { eq, desc, isNull, or, gt } from "drizzle-orm";
import { db } from "./db";
import { criticalAlertAcks, notifications } from "@shared/schema";
import { Errors } from "./utils/errors";
import { getUserId } from "./types/request";
import type { AuthenticatedRequest } from "./types/request";

const router = Router();

// Default ack-deadline thresholds (configurable later via /founder/settings).
const DEFAULT_THRESHOLDS_MIN = { P0: 15, P1: 60 } as const;

function thresholdMinutes(severity: "P0" | "P1"): number {
  return DEFAULT_THRESHOLDS_MIN[severity];
}

router.get("/", async (_req: AuthenticatedRequest, res: Response) => {
  try {
    // Show: unacked alerts (regardless of deadline state) + escalated-but-recent
    // (last 24h). Acked alerts drop off the view.
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const rows = await db
      .select({
        id: criticalAlertAcks.id,
        notificationId: criticalAlertAcks.notificationId,
        severity: criticalAlertAcks.severity,
        firedAt: criticalAlertAcks.firedAt,
        ackDeadlineAt: criticalAlertAcks.ackDeadlineAt,
        ackedAt: criticalAlertAcks.ackedAt,
        ackedBy: criticalAlertAcks.ackedBy,
        escalatedAt: criticalAlertAcks.escalatedAt,
        escalationTarget: criticalAlertAcks.escalationTarget,
        notificationTitle: notifications.title,
        notificationMessage: notifications.message,
      })
      .from(criticalAlertAcks)
      .leftJoin(notifications, eq(notifications.id, criticalAlertAcks.notificationId))
      .where(
        or(
          isNull(criticalAlertAcks.ackedAt),
          gt(criticalAlertAcks.firedAt, dayAgo)
        )
      )
      .orderBy(desc(criticalAlertAcks.firedAt));

    const now = Date.now();
    const enriched = rows.map((r) => {
      const deadline = r.ackDeadlineAt ? new Date(r.ackDeadlineAt).getTime() : null;
      const overdue = !r.ackedAt && deadline !== null && deadline < now;
      const secondsUntilDeadline =
        deadline !== null && !r.ackedAt ? Math.round((deadline - now) / 1000) : null;
      return { ...r, overdue, secondsUntilDeadline };
    });

    res.json({ alerts: enriched, thresholds: DEFAULT_THRESHOLDS_MIN });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/:id/ack", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid id");
    const userId = getUserId(req);
    const [row] = await db
      .update(criticalAlertAcks)
      .set({ ackedAt: new Date(), ackedBy: userId })
      .where(eq(criticalAlertAcks.id, id))
      .returning();
    if (!row) return Errors.notFound(res, "Critical alert");
    res.json(row);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/:id/escalate", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid id");
    const target = typeof req.body?.target === "string" ? req.body.target : "primary_backup";
    const [row] = await db
      .update(criticalAlertAcks)
      .set({ escalatedAt: new Date(), escalationTarget: target })
      .where(eq(criticalAlertAcks.id, id))
      .returning();
    if (!row) return Errors.notFound(res, "Critical alert");
    res.json(row);
  } catch (err) {
    Errors.internal(res, err);
  }
});

/**
 * Helper for jobs/handlers that fire a P0/P1 notification — call this to
 * register the ack-timer row alongside it. Kept here so the route file
 * is the single source of truth for ack-deadline math.
 */
export async function registerCriticalAlert(opts: {
  notificationId: number;
  severity: "P0" | "P1";
  firedAt?: Date;
}): Promise<void> {
  const fired = opts.firedAt ?? new Date();
  const deadline = new Date(fired.getTime() + thresholdMinutes(opts.severity) * 60_000);
  await db.insert(criticalAlertAcks).values({
    notificationId: opts.notificationId,
    severity: opts.severity,
    firedAt: fired,
    ackDeadlineAt: deadline,
  });
}

export default router;
