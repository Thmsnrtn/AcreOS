// @ts-nocheck
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

const router = Router();

function getOrg(req: Request) { return (req as any).org; }
function getUser(req: Request) { return (req as any).user; }

// GET /api/territories
router.get("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const rows = await db
      .select()
      .from(territories)
      .where(eq(territories.organizationId, org.id));
    res.json({ territories: rows });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/territories
router.post("/", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const { name, description, stateCode, counties } = req.body;
    if (!name || !stateCode) return res.status(400).json({ error: "name and stateCode required" });

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
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/territories/:id
router.put("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

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

    if (!updated) return res.status(404).json({ error: "Territory not found" });
    res.json({ territory: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/territories/:id
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });

    await db
      .delete(territories)
      .where(and(eq(territories.id, id), eq(territories.organizationId, org.id)));
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/territories/:id/assign
router.post("/:id/assign", async (req: Request, res: Response) => {
  try {
    const org = getOrg(req);
    const id = parseInt(req.params.id);
    const { userId } = req.body;
    if (isNaN(id)) return res.status(400).json({ error: "Invalid ID" });
    if (!userId) return res.status(400).json({ error: "userId required" });

    const [updated] = await db
      .update(territories)
      .set({ assignedUserId: userId, updatedAt: new Date() })
      .where(and(eq(territories.id, id), eq(territories.organizationId, org.id)))
      .returning();

    if (!updated) return res.status(404).json({ error: "Territory not found" });
    res.json({ territory: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
