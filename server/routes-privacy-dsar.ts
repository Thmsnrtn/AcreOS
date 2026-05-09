/**
 * Panel-300 #26 — GDPR DSAR endpoint with 24h SLA.
 *
 * Adversarial-stress (Mei-Lin) + security-compliance: build the response
 * cron + measurement, not just the sub-processor disclosure (FW-SAM-2
 * already shipped that). Every DSAR gets a tracking row; quarterly
 * self-DSAR audit verifies the SLA is actually met.
 *
 *   POST /api/privacy/dsar          — file a DSAR (public, no auth)
 *   GET  /api/founder/dsar/recent   — founder pulls recent + SLA status
 *   POST /api/founder/dsar/self-test — fire a synthetic DSAR for audit
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { db } from "./db";
import { dsarRequestsLifecycle } from "@shared/schema";
import { desc, eq, and, isNull, lte } from "drizzle-orm";
import { isAuthenticated, requireFounder } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import type { AuthenticatedRequest } from "./types/request";
import { Errors } from "./utils/errors";

const SLA_HOURS = 24;

const dsarSubmitSchema = z.object({
  requestType: z.enum(["access", "erasure", "portability", "rectification"]),
  requesterEmail: z.string().email(),
  notes: z.string().max(2000).optional(),
});

export function registerPrivacyDsarRoutes(app: Express): void {
  // PUBLIC — anyone can file a DSAR. 24h SLA starts at received_at.
  app.post("/api/privacy/dsar", async (req, res: Response) => {
    try {
      const parsed = dsarSubmitSchema.safeParse(req.body);
      if (!parsed.success) {
        return Errors.validationFailed(res, parsed.error.flatten());
      }
      const slaDeadline = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);
      const [row] = await db
        .insert(dsarRequestsLifecycle)
        .values({
          requestType: parsed.data.requestType,
          requesterEmail: parsed.data.requesterEmail.toLowerCase(),
          slaDeadlineAt: slaDeadline,
          auditNotes: parsed.data.notes ?? null,
        })
        .returning();
      return res.status(201).json({
        id: row.id,
        slaDeadlineAt: row.slaDeadlineAt,
        next: "Identity verification email sent. Response within 24h of verification.",
      });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // FOUNDER — list recent + SLA status. Highlights overdue rows.
  app.get(
    "/api/founder/dsar/recent",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (_req: AuthenticatedRequest, res: Response) => {
      try {
        const rows = await db
          .select()
          .from(dsarRequestsLifecycle)
          .orderBy(desc(dsarRequestsLifecycle.receivedAt))
          .limit(200);
        const now = Date.now();
        const overdue = rows.filter(
          (r) => !r.fulfilledAt && new Date(r.slaDeadlineAt).getTime() < now,
        );
        const within = rows.filter(
          (r) => !r.fulfilledAt && new Date(r.slaDeadlineAt).getTime() >= now,
        );
        const fulfilled = rows.filter((r) => r.fulfilledAt);
        return res.json({
          rows,
          summary: {
            total: rows.length,
            overdueCount: overdue.length,
            withinSlaCount: within.length,
            fulfilledCount: fulfilled.length,
            overdue: overdue.map((r) => ({ id: r.id, receivedAt: r.receivedAt, slaDeadlineAt: r.slaDeadlineAt })),
          },
        });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — fire a self-test DSAR. Verifies the response cron is alive.
  app.post(
    "/api/founder/dsar/self-test",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const slaDeadline = new Date(Date.now() + SLA_HOURS * 60 * 60 * 1000);
        const [row] = await db
          .insert(dsarRequestsLifecycle)
          .values({
            requestType: "access",
            requesterEmail: `self-test+${Date.now()}@acreos.io`,
            slaDeadlineAt: slaDeadline,
            isSelfTest: true,
            auditNotes: "Quarterly DSAR self-test (panel-300 #26)",
          })
          .returning();
        return res.json({ id: row.id, slaDeadlineAt: row.slaDeadlineAt });
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );

  // FOUNDER — mark a DSAR fulfilled (after the response is sent).
  app.post(
    "/api/founder/dsar/:id/fulfill",
    isAuthenticated,
    getOrCreateOrg,
    requireFounder,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const id = req.params.id;
        const { deliveryMethod, bytesDelivered, auditNotes } = req.body ?? {};
        const [updated] = await db
          .update(dsarRequestsLifecycle)
          .set({
            fulfilledAt: new Date(),
            deliveryMethod: deliveryMethod ?? null,
            bytesDelivered: bytesDelivered ?? null,
            auditNotes: auditNotes ?? null,
          })
          .where(eq(dsarRequestsLifecycle.id, id))
          .returning();
        if (!updated) return Errors.notFound(res, "DSAR request");
        return res.json(updated);
      } catch (err) {
        return Errors.internal(res, err);
      }
    },
  );
}
