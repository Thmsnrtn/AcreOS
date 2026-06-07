/**
 * Parcel Alerts API — Iyari #5 (owner-change & tax-status delta surface).
 *
 * Customer-facing read + mark-read for the alerts produced by the parcel delta
 * detector (server/services/parcelDeltaDetector.ts). The detector is the sole
 * WRITER of parcel_alerts; this router is read + mark-read only. Every query is
 * org-scoped via getOrganization(req); no cross-tenant access is possible.
 *
 *   GET   /api/parcel-alerts            — list alerts (newest first), + unreadCount
 *   POST  /api/parcel-alerts/:id/read   — mark one alert read
 *   POST  /api/parcel-alerts/read-all   — mark all of this org's alerts read
 *
 * Mounted behind the Today door (see client/src/components/today/ParcelAlerts.tsx).
 */

import { Router, type Response } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { parcelAlerts } from "@shared/schema";
import { db } from "./storage";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganization } from "./types/request";
import { Errors } from "./utils/errors";

const router = Router();

const MAX_LIMIT = 50;

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const limitRaw = Number(req.query.limit);
    const limit = Number.isFinite(limitRaw)
      ? Math.min(Math.max(1, Math.trunc(limitRaw)), MAX_LIMIT)
      : MAX_LIMIT;
    const unreadOnly = req.query.unreadOnly === "true";

    const conditions = [eq(parcelAlerts.organizationId, org.id)];
    if (unreadOnly) conditions.push(eq(parcelAlerts.isRead, false));

    const [alerts, unreadRow] = await Promise.all([
      db
        .select()
        .from(parcelAlerts)
        .where(and(...conditions))
        .orderBy(desc(parcelAlerts.createdAt), desc(parcelAlerts.id))
        .limit(limit),
      db
        .select({ count: sql<number>`COUNT(*)` })
        .from(parcelAlerts)
        .where(
          and(
            eq(parcelAlerts.organizationId, org.id),
            eq(parcelAlerts.isRead, false),
          ),
        ),
    ]);

    const unreadCount = Number(unreadRow[0]?.count ?? 0);
    return res.json({ alerts, unreadCount });
  } catch (error) {
    return Errors.internal(res, error);
  }
});

router.post("/:id/read", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return Errors.badRequest(res, "Invalid alert id");
    }

    const updated = await db
      .update(parcelAlerts)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(parcelAlerts.id, id),
          eq(parcelAlerts.organizationId, org.id),
        ),
      )
      .returning({ id: parcelAlerts.id });

    if (updated.length === 0) {
      return Errors.notFound(res, "Parcel alert");
    }
    return res.json({ ok: true, id: updated[0].id });
  } catch (error) {
    return Errors.internal(res, error);
  }
});

router.post("/read-all", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const org = getOrganization(req);
    const updated = await db
      .update(parcelAlerts)
      .set({ isRead: true, readAt: new Date() })
      .where(
        and(
          eq(parcelAlerts.organizationId, org.id),
          eq(parcelAlerts.isRead, false),
        ),
      )
      .returning({ id: parcelAlerts.id });

    return res.json({ ok: true, markedRead: updated.length });
  } catch (error) {
    return Errors.internal(res, error);
  }
});

export default router;
