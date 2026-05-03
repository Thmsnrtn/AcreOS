/**
 * Support Saved Replies API
 *
 * Pre-canned operator responses inserted into the support-case reply
 * composer. `organization_id IS NULL` rows are globally available
 * (founder-curated); scoped rows belong to a specific customer org.
 *
 * Endpoints:
 *   GET    /api/admin/support/saved-replies        — list (global + scoped if ?organizationId=X)
 *   POST   /api/admin/support/saved-replies        — create
 *   PATCH  /api/admin/support/saved-replies/:id    — edit
 *   DELETE /api/admin/support/saved-replies/:id    — remove
 */

import { Router, type Response } from "express";
import { eq, isNull, or, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { supportSavedReplies } from "@shared/schema";
import { Errors } from "./utils/errors";
import { getUserId } from "./types/request";
import type { AuthenticatedRequest } from "./types/request";

const router = Router();

const upsertSchema = z.object({
  name: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(10_000),
  organizationId: z.number().int().positive().optional().nullable(),
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const orgIdRaw = req.query.organizationId;
    const orgId = typeof orgIdRaw === "string" && /^\d+$/.test(orgIdRaw) ? parseInt(orgIdRaw, 10) : null;
    const where = orgId
      ? or(isNull(supportSavedReplies.organizationId), eq(supportSavedReplies.organizationId, orgId))
      : isNull(supportSavedReplies.organizationId);
    const rows = await db
      .select()
      .from(supportSavedReplies)
      .where(where)
      .orderBy(desc(supportSavedReplies.updatedAt));
    res.json({ replies: rows });
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const parsed = upsertSchema.safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const userId = getUserId(req);
    const [row] = await db
      .insert(supportSavedReplies)
      .values({
        name: parsed.data.name,
        body: parsed.data.body,
        organizationId: parsed.data.organizationId ?? null,
        createdBy: userId,
      })
      .returning();
    res.status(201).json(row);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.patch("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid id");
    const parsed = upsertSchema.partial().safeParse(req.body);
    if (!parsed.success) return Errors.validationFailed(res, parsed.error.issues);
    const [row] = await db
      .update(supportSavedReplies)
      .set({
        ...(parsed.data.name !== undefined && { name: parsed.data.name }),
        ...(parsed.data.body !== undefined && { body: parsed.data.body }),
        ...(parsed.data.organizationId !== undefined && { organizationId: parsed.data.organizationId }),
        updatedAt: new Date(),
      })
      .where(eq(supportSavedReplies.id, id))
      .returning();
    if (!row) return Errors.notFound(res, "Saved reply");
    res.json(row);
  } catch (err) {
    Errors.internal(res, err);
  }
});

router.delete("/:id", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return Errors.badRequest(res, "Invalid id");
    const [row] = await db.delete(supportSavedReplies).where(eq(supportSavedReplies.id, id)).returning();
    if (!row) return Errors.notFound(res, "Saved reply");
    res.json({ ok: true });
  } catch (err) {
    Errors.internal(res, err);
  }
});

export default router;
