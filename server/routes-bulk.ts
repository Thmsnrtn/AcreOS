/**
 * T183 — Bulk Operations Routes
 *
 * POST /api/bulk/leads/update     — batch update lead status/assignment
 * POST /api/bulk/leads/delete     — batch delete leads
 * POST /api/bulk/properties/update — batch update property status
 * POST /api/bulk/deals/update     — batch update deal status
 * POST /api/bulk/tasks/complete   — batch complete tasks
 *
 * All operations are scoped to the user's organization and capped at 100 records per request.
 */

import { Router, type Response } from "express";
import { attachPermissionContext } from "./utils/permissions";
import { db } from "./db";
import { leads, properties, deals, tasks } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";
import { filterOutHeldIds } from "./services/legalHold";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { assertUserIsOrgMember } from "./utils/orgScope";
import type { AuthenticatedRequest } from "./types/request";
import { getOrganizationId } from "./types/request";

const router = Router();
const MAX_BATCH = 100;


function validateIds(ids: unknown): number[] | null {
  if (!Array.isArray(ids) || ids.length === 0) return null;
  if (ids.length > MAX_BATCH) return null;
  const parsed = ids.map((id: unknown) => parseInt(String(id), 10));
  if (parsed.some(Number.isNaN)) return null;
  return parsed;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

router.post("/leads/update", attachPermissionContext(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { ids, updates } = req.body ?? {};
    const parsedIds = validateIds(ids);
    if (!parsedIds) return Errors.badRequest(res, `ids must be a non-empty array of numbers (max ${MAX_BATCH})`);
    if (!updates || typeof updates !== "object") return Errors.badRequest(res, "updates must be an object");

    // Lens 48 — viewOnlyAssignedLeads gate must hold on bulk paths too,
    // not just the single-record PATCH. Without this, a VA could push
    // every lead in the org to "deleted" status via /api/bulk/leads/update.
    const context = req.permissionContext;
    const callerId = req.user?.id ?? null;
    if (context?.permissions.viewOnlyAssignedLeads) {
      return Errors.forbidden(res, "Bulk lead updates are not available with assigned-only access");
    }

    const allowedUpdates: Record<string, unknown> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) {
      // Lens 48 — cross-tenant assignment guard.
      if (updates.assignedTo !== null && updates.assignedTo !== "") {
        const ok = await assertUserIsOrgMember(String(updates.assignedTo), orgId);
        if (!ok) return Errors.badRequest(res, "assignedTo must be a member of this organization");
      }
      allowedUpdates.assignedTo = updates.assignedTo;
    }
    if (updates.tags) allowedUpdates.tags = updates.tags;

    if (Object.keys(allowedUpdates).length === 0) {
      return Errors.badRequest(res, "No valid updates provided");
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(leads)
      .set(allowedUpdates)
      .where(and(
        eq(leads.organizationId, orgId),
        inArray(leads.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err) {
    logger.error("bulk.leads.update failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

router.post("/leads/delete", attachPermissionContext(), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { ids } = req.body ?? {};
    const parsedIds = validateIds(ids);
    if (!parsedIds) return Errors.badRequest(res, `ids must be a non-empty array of numbers (max ${MAX_BATCH})`);

    // Lens 48 — same gate as /leads/update.
    const context = req.permissionContext;
    if (context?.permissions.viewOnlyAssignedLeads) {
      return Errors.forbidden(res, "Bulk lead deletes are not available with assigned-only access");
    }

    // Phase 3 Week 11 — FRCP 37(e) legal-hold preservation. Drop held ids
    // before bulk-DELETE; report skipped count back to the caller.
    const allowed = await filterOutHeldIds(orgId, "lead", parsedIds);
    const skipped = parsedIds.length - allowed.length;

    if (allowed.length > 0) {
      await db.delete(leads)
        .where(and(
          eq(leads.organizationId, orgId),
          inArray(leads.id, allowed)
        ));
    }

    res.json({ success: true, deleted: allowed.length, skippedDueToLegalHold: skipped });
  } catch (err) {
    logger.error("bulk.leads.delete failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// ─── Properties ───────────────────────────────────────────────────────────────

router.post("/properties/update", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { ids, updates } = req.body ?? {};
    const parsedIds = validateIds(ids);
    if (!parsedIds) return Errors.badRequest(res, `ids must be a non-empty array of numbers (max ${MAX_BATCH})`);
    if (!updates || typeof updates !== "object") return Errors.badRequest(res, "updates must be an object");

    const allowedUpdates: Record<string, unknown> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) {
      if (updates.assignedTo !== null && updates.assignedTo !== "") {
        const ok = await assertUserIsOrgMember(String(updates.assignedTo), orgId);
        if (!ok) return Errors.badRequest(res, "assignedTo must be a member of this organization");
      }
      allowedUpdates.assignedTo = updates.assignedTo;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return Errors.badRequest(res, "No valid updates provided");
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(properties)
      .set(allowedUpdates)
      .where(and(
        eq(properties.organizationId, orgId),
        inArray(properties.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err) {
    logger.error("bulk.properties.update failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// ─── Deals ────────────────────────────────────────────────────────────────────

router.post("/deals/update", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { ids, updates } = req.body ?? {};
    const parsedIds = validateIds(ids);
    if (!parsedIds) return Errors.badRequest(res, `ids must be a non-empty array of numbers (max ${MAX_BATCH})`);
    if (!updates || typeof updates !== "object") return Errors.badRequest(res, "updates must be an object");

    const allowedUpdates: Record<string, unknown> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) {
      if (updates.assignedTo !== null && updates.assignedTo !== "") {
        const ok = await assertUserIsOrgMember(String(updates.assignedTo), orgId);
        if (!ok) return Errors.badRequest(res, "assignedTo must be a member of this organization");
      }
      allowedUpdates.assignedTo = updates.assignedTo;
    }
    if (updates.stage) allowedUpdates.stage = updates.stage;

    if (Object.keys(allowedUpdates).length === 0) {
      return Errors.badRequest(res, "No valid updates provided");
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(deals)
      .set(allowedUpdates)
      .where(and(
        eq(deals.organizationId, orgId),
        inArray(deals.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err) {
    logger.error("bulk.deals.update failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.post("/tasks/complete", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgId = getOrganizationId(req);
    const { ids } = req.body ?? {};
    const parsedIds = validateIds(ids);
    if (!parsedIds) return Errors.badRequest(res, `ids must be a non-empty array of numbers (max ${MAX_BATCH})`);

    await db.update(tasks)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(tasks.organizationId, orgId),
        inArray(tasks.id, parsedIds)
      ));

    res.json({ success: true, completed: parsedIds.length });
  } catch (err) {
    logger.error("bulk.tasks.complete failed", err instanceof Error ? err : undefined);
    Errors.internal(res, err);
  }
});

export default router;
