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

import { Router, type Request, type Response } from "express";
import { isAuthenticated } from "./auth";
import { getOrCreateOrg } from "./middleware/getOrCreateOrg";
import { db } from "./db";
import { leads, properties, deals, tasks } from "@shared/schema";
import { eq, and, inArray } from "drizzle-orm";

const router = Router();
const MAX_BATCH = 100;

function getOrg(req: Request) {
  return (req as any).organization;
}

function validateIds(ids: any[]): number[] {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("ids must be a non-empty array");
  }
  if (ids.length > MAX_BATCH) {
    throw new Error(`Maximum ${MAX_BATCH} records per batch operation`);
  }
  const parsed = ids.map((id: any) => parseInt(id));
  if (parsed.some(isNaN)) {
    throw new Error("All ids must be valid numbers");
  }
  return parsed;
}

// ─── Leads ────────────────────────────────────────────────────────────────────

router.post("/leads/update", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { ids, updates } = req.body;
    const parsedIds = validateIds(ids);

    const allowedUpdates: Record<string, any> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) allowedUpdates.assignedTo = updates.assignedTo;
    if (updates.tags) allowedUpdates.tags = updates.tags;

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(leads)
      .set(allowedUpdates)
      .where(and(
        eq(leads.organizationId, org.id),
        inArray(leads.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/leads/delete", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { ids } = req.body;
    const parsedIds = validateIds(ids);

    await db.delete(leads)
      .where(and(
        eq(leads.organizationId, org.id),
        inArray(leads.id, parsedIds)
      ));

    res.json({ success: true, deleted: parsedIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Properties ───────────────────────────────────────────────────────────────

router.post("/properties/update", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { ids, updates } = req.body;
    const parsedIds = validateIds(ids);

    const allowedUpdates: Record<string, any> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) allowedUpdates.assignedTo = updates.assignedTo;

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(properties)
      .set(allowedUpdates)
      .where(and(
        eq(properties.organizationId, org.id),
        inArray(properties.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Deals ────────────────────────────────────────────────────────────────────

router.post("/deals/update", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { ids, updates } = req.body;
    const parsedIds = validateIds(ids);

    const allowedUpdates: Record<string, any> = {};
    if (updates.status) allowedUpdates.status = updates.status;
    if (updates.assignedTo !== undefined) allowedUpdates.assignedTo = updates.assignedTo;
    if (updates.stage) allowedUpdates.stage = updates.stage;

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ error: "No valid updates provided" });
    }

    allowedUpdates.updatedAt = new Date();

    await db.update(deals)
      .set(allowedUpdates)
      .where(and(
        eq(deals.organizationId, org.id),
        inArray(deals.id, parsedIds)
      ));

    res.json({ success: true, updated: parsedIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ─── Tasks ────────────────────────────────────────────────────────────────────

router.post("/tasks/complete", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { ids } = req.body;
    const parsedIds = validateIds(ids);

    await db.update(tasks)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(and(
        eq(tasks.organizationId, org.id),
        inArray(tasks.id, parsedIds)
      ));

    res.json({ success: true, completed: parsedIds.length });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

export default router;
