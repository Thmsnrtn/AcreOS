/**
 * Phase 3 Week 11 — Sub-processor DPA registry (founder-only).
 *
 * Lists every external vendor that touches customer data and tracks the
 * Data Processing Agreement lifecycle (pending → negotiating → signed →
 * expired). Outreach is a manual workstream; this surface is the founder's
 * checklist.
 *
 * Endpoints:
 *   GET   /api/founder/sub-processors          — list all vendors
 *   PATCH /api/founder/sub-processors/:id      — edit-in-place
 *   POST  /api/founder/sub-processors          — add new vendor
 */

import type { Express, Response } from "express";
import { z } from "zod";
import { eq, asc } from "drizzle-orm";

import { db } from "./db";
import { dataProcessingAgreements, DPA_STATUSES } from "@shared/schema";
import { isAuthenticated } from "./auth";
import { isFounderIdentity } from "./services/founder";
import { Errors } from "./utils/errors";
import { auditFromRequest, AuditActions } from "./utils/auditLog";
import type { AuthenticatedRequest } from "./types/request";

function requireFounder(req: AuthenticatedRequest, res: Response): boolean {
  const user = req.user as any;
  const userId = (req as any).auth?.userId ?? user?.clerkUserId ?? null;
  const email = user?.email ?? null;
  if (!isFounderIdentity({ email, userId })) {
    Errors.notFound(res, "Resource");
    return false;
  }
  return true;
}

const updateSchema = z.object({
  status: z.enum(DPA_STATUSES).optional(),
  signedDate: z.string().optional().nullable(),
  expiresAt: z.string().optional().nullable(),
  contactEmail: z.string().email().max(320).optional().nullable(),
  scope: z.string().max(2000).optional().nullable(),
  evidenceUrl: z.string().max(1000).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

const createSchema = z.object({
  vendorName: z.string().min(1).max(200),
  status: z.enum(DPA_STATUSES).default("pending"),
  contactEmail: z.string().email().max(320).optional(),
  scope: z.string().max(2000).optional(),
  notes: z.string().max(5000).optional(),
});

export function registerSubProcessorRoutes(app: Express): void {
  // ── GET /api/founder/sub-processors ───────────────────────────────────
  app.get("/api/founder/sub-processors", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    try {
      const rows = await db
        .select()
        .from(dataProcessingAgreements)
        .orderBy(asc(dataProcessingAgreements.vendorName));
      return res.json({ vendors: rows });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── POST /api/founder/sub-processors ──────────────────────────────────
  app.post("/api/founder/sub-processors", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const [row] = await db
        .insert(dataProcessingAgreements)
        .values({
          vendorName: parsed.data.vendorName,
          status: parsed.data.status,
          contactEmail: parsed.data.contactEmail ?? null,
          scope: parsed.data.scope ?? null,
          notes: parsed.data.notes ?? null,
        })
        .returning();
      await auditFromRequest(req, {
        action: AuditActions.SUBPROCESSOR_UPDATED,
        target: { type: "subprocessor", id: row.id },
        metadata: { op: "create", vendorName: row.vendorName },
      });
      return res.status(201).json({ vendor: row });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });

  // ── PATCH /api/founder/sub-processors/:id ─────────────────────────────
  app.patch("/api/founder/sub-processors/:id", isAuthenticated, async (req, res) => {
    const areq = req as AuthenticatedRequest;
    if (!requireFounder(areq, res)) return;
    const parsed = updateSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    try {
      const [existing] = await db
        .select()
        .from(dataProcessingAgreements)
        .where(eq(dataProcessingAgreements.id, req.params.id))
        .limit(1);
      if (!existing) return Errors.notFound(res, "Sub-processor");

      const patch: Record<string, unknown> = { updatedAt: new Date() };
      if (parsed.data.status !== undefined) patch.status = parsed.data.status;
      if (parsed.data.signedDate !== undefined) patch.signedDate = parsed.data.signedDate;
      if (parsed.data.expiresAt !== undefined) patch.expiresAt = parsed.data.expiresAt;
      if (parsed.data.contactEmail !== undefined) patch.contactEmail = parsed.data.contactEmail;
      if (parsed.data.scope !== undefined) patch.scope = parsed.data.scope;
      if (parsed.data.evidenceUrl !== undefined) patch.evidenceUrl = parsed.data.evidenceUrl;
      if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes;

      const [updated] = await db
        .update(dataProcessingAgreements)
        .set(patch)
        .where(eq(dataProcessingAgreements.id, existing.id))
        .returning();

      await auditFromRequest(req, {
        action: AuditActions.SUBPROCESSOR_UPDATED,
        target: { type: "subprocessor", id: existing.id },
        metadata: {
          op: "update",
          vendorName: existing.vendorName,
          changed: Object.keys(parsed.data),
        },
      });

      return res.json({ vendor: updated });
    } catch (err) {
      return Errors.internal(res, err);
    }
  });
}
