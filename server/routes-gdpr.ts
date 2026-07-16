/**
 * T175 — GDPR/Privacy Routes (LEGACY soft-redirect shim).
 *
 * Originally these endpoints ran synchronously via gdprService:
 *   POST /api/privacy/export → built the JSON archive inline and streamed
 *                              it back as a file download.
 *   POST /api/privacy/delete → anonymized the user record inline.
 *   GET  /api/privacy/status → checked users.deletedAt.
 *
 * That bypassed the GDPR/CCPA pipeline shipped in panel-300 #26
 * (24h SLA, dsar_requests_lifecycle, audit_events fan-out, overdue cron).
 * It also meant a successful "export" was a moment-in-time blob that
 * never wrote to audit_events — fine for dev, untenable for a SOC-2
 * surface or for an actual regulator.
 *
 * As of 2026-05-11 these endpoints CREATE a row in dsar_requests_lifecycle
 * with a 24h SLA deadline, write a DSAR_INTAKE audit event, and return
 * `{ requestId, eta: '24h', status: 'queued' }` instead of executing
 * inline. The customer sees "your request is queued" and gets an email
 * once the founder fulfils it via /founder/compliance-ops.
 *
 * Kept as a separate router (not deleted) so any older client cache that
 * still POSTs to /api/privacy/export gets a meaningful queued response,
 * not a 404. The canonical customer-facing intake is /api/privacy/dsar
 * (see routes-privacy-dsar.ts) — these are deprecated aliases for one
 * release cycle.
 */

import { Router, type Response } from "express";
import { isAuthenticated } from "./auth";
import { db } from "./db";
import { dsarRequestsLifecycle } from "@shared/schema";
import { and, desc, eq } from "drizzle-orm";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import { logger } from "./utils/logger";

const router = Router();

const SLA_HOURS = 24;

function getRequesterEmail(req: AuthenticatedRequest): string | null {
  const email = req.user?.email;
  return typeof email === "string" && email.length > 0 ? email.toLowerCase() : null;
}

async function enqueueDsar(
  req: AuthenticatedRequest,
  requestType: "access" | "erasure",
  auditNote: string,
): Promise<{ id: string; slaDeadlineAt: Date } | null> {
  const email = getRequesterEmail(req);
  if (!email) return null;

  const slaDeadline = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);
  const [row] = await db
    .insert(dsarRequestsLifecycle)
    .values({
      requestType,
      requesterEmail: email,
      slaDeadlineAt: slaDeadline,
      auditNotes: auditNote,
    })
    .returning();

  try {
    await auditFromRequest(req, {
      action: AuditActions.DSAR_INTAKE,
      target: { type: "dsar", id: row.id },
      metadata: {
        requestType,
        email,
        source: "legacy_privacy_endpoint",
        slaDeadlineAt: row.slaDeadlineAt,
      },
    });
  } catch (err) {
    logger.warn("[gdpr] audit log failed for DSAR intake", err as Error);
  }

  return { id: row.id, slaDeadlineAt: row.slaDeadlineAt };
}

// Export personal data (GDPR Article 15) — queued, 24h SLA.
router.post("/export", isAuthenticated, async (req, res: Response) => {
  const areq = req as AuthenticatedRequest;
  const email = getRequesterEmail(areq);
  if (!email) return Errors.unauthorized(res);

  try {
    const enqueued = await enqueueDsar(areq, "access", "Customer-side /api/privacy/export (legacy shim)");
    if (!enqueued) return Errors.internal(res, new Error("Failed to enqueue DSAR"));
    return res.status(202).json({
      requestId: enqueued.id,
      status: "queued",
      eta: "24h",
      slaDeadlineAt: enqueued.slaDeadlineAt,
      message:
        "Your data export request is queued. You will receive an email within 24 hours when it is ready.",
      canonical: "/api/privacy/dsar",
    });
  } catch (err) {
    return Errors.internal(res, err);
  }
});

// Request account anonymization (GDPR Article 17) — queued, 24h SLA.
router.post("/delete", isAuthenticated, async (req, res: Response) => {
  const areq = req as AuthenticatedRequest;
  const email = getRequesterEmail(areq);
  if (!email) return Errors.unauthorized(res);

  const { confirm } = req.body ?? {};
  if (confirm !== "DELETE MY DATA") {
    return Errors.badRequest(
      res,
      "Confirmation required. Send { confirm: 'DELETE MY DATA' } to proceed.",
    );
  }

  try {
    const enqueued = await enqueueDsar(areq, "erasure", "Customer-side /api/privacy/delete (legacy shim)");
    if (!enqueued) return Errors.internal(res, new Error("Failed to enqueue DSAR"));
    return res.status(202).json({
      requestId: enqueued.id,
      status: "queued",
      eta: "24h",
      slaDeadlineAt: enqueued.slaDeadlineAt,
      message:
        "Your data deletion request is queued. You will receive an email within 24 hours confirming completion. Your account remains active until then.",
      canonical: "/api/privacy/dsar",
    });
  } catch (err) {
    return Errors.internal(res, err);
  }
});

// Status — now queries dsar_requests_lifecycle for the user's open and
// recently-fulfilled requests rather than the old users.deletedAt check.
router.get("/status", isAuthenticated, async (req, res: Response) => {
  const areq = req as AuthenticatedRequest;
  const email = getRequesterEmail(areq);
  if (!email) return Errors.unauthorized(res);

  try {
    const rows = await db
      .select()
      .from(dsarRequestsLifecycle)
      .where(eq(dsarRequestsLifecycle.requesterEmail, email))
      .orderBy(desc(dsarRequestsLifecycle.receivedAt))
      .limit(20);

    const now = Date.now();
    const open = rows
      .filter((r) => !r.fulfilledAt)
      .map((r) => ({
        id: r.id,
        type: r.requestType,
        receivedAt: r.receivedAt,
        slaDeadlineAt: r.slaDeadlineAt,
        overdue: new Date(r.slaDeadlineAt).getTime() < now,
      }));
    const recent = rows
      .filter((r) => r.fulfilledAt)
      .slice(0, 5)
      .map((r) => ({
        id: r.id,
        type: r.requestType,
        fulfilledAt: r.fulfilledAt,
        deliveryMethod: r.deliveryMethod,
      }));

    // Legacy field — true only if a fulfilled erasure exists.
    const deleted = rows.some((r) => r.requestType === "erasure" && !!r.fulfilledAt);

    return res.json({
      deleted,
      email,
      open,
      recent,
    });
  } catch (err) {
    return Errors.internal(res, err);
  }
});

export default router;
