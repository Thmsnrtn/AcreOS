/**
 * T194 — Territory Management Routes
 *
 * GET    /api/territories              — list territories for org
 * POST   /api/territories              — create territory
 * PUT    /api/territories/:id          — update territory
 * DELETE /api/territories/:id          — delete territory
 * POST   /api/territories/:id/assign   — assign user to territory
 */

import { Router, type Request, type Response } from "express";
import { db } from "./db";
import { territories, teamMembers } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { Errors } from "./utils/errors";

const router = Router();

function getUser(req: Request) { return req.user; }

// GET /api/territories
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const rows = await db
      .select()
      .from(territories)
      .where(eq(territories.organizationId, org.id));
    res.json({ territories: rows });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /api/territories
router.post("/", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const { name, description, stateCode, counties } = req.body;
    if (!name || !stateCode) return Errors.badRequest(res, "name and stateCode required");

    const [territory] = await db
      .insert(territories)
      .values({
        organizationId: org.id,
        name,
        description,
        stateCode: stateCode.toUpperCase(),
        counties: Array.isArray(counties) ? counties : [],
      })
      .returning();

    res.status(201).json({ territory });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// PUT /api/territories/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    const { name, description, stateCode, counties } = req.body;
    const updates: Record<string, any> = {};
    if (name) updates.name = name;
    if (description !== undefined) updates.description = description;
    if (stateCode) updates.stateCode = stateCode.toUpperCase();
    if (counties) updates.counties = counties;

    const [updated] = await db
      .update(territories)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(eq(territories.id, id), eq(territories.organizationId, org.id)))
      .returning();

    if (!updated) return Errors.notFound(res, "territory");
    res.json({ territory: updated });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// DELETE /api/territories/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");

    await db
      .delete(territories)
      .where(and(eq(territories.id, id), eq(territories.organizationId, org.id)));
    res.json({ success: true });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

// POST /api/territories/:id/assign
router.post("/:id/assign", async (req: Request, res: Response) => {
  try {
    const org = req.organization;
    const id = parseInt(req.params.id);
    const { userId } = req.body;
    if (isNaN(id)) return Errors.badRequest(res, "Invalid ID");
    if (!userId) return Errors.badRequest(res, "userId required");

    const [updated] = await db
      .update(territories)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(and(eq(territories.id, id), eq(territories.organizationId, org.id)))
      .returning();

    if (!updated) return Errors.notFound(res, "territory");
    res.json({ territory: updated });
  } catch (err: any) {
    Errors.internal(res, err);
  }
});

export default router;
