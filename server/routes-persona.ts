/**
 * /api/me/persona — investor archetype getter/setter (product-call #9 + JC#7).
 *
 * Persona drives onboarding path, default surfaces, and vocabulary
 * substitutions per VERTICAL-EXPANSION-PLAN.md. The column is a plain
 * text field (migrations/0031) so adding new personas only requires a
 * registry update on the client; this endpoint validates against the
 * Persona union from shared/models/auth.ts.
 *
 * GET    /api/me/persona  → { persona }
 * PUT    /api/me/persona  → set persona; returns the new value
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const personaSchema = z.object({
  persona: z.enum([
    "land_investor",
    "note_investor",
    "tax_delinquent",
    "wholesaler",
    "subdivider",
    "fix_flipper",
    "landlord",
  ]),
});

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ persona: users.persona })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    res.json({ persona: row?.persona ?? "land_investor" });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.put("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = personaSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.errors);
    }
    await db
      .update(users)
      .set({ persona: parsed.data.persona, updatedAt: new Date() })
      .where(eq(users.id, userId));
    logger.info("Persona updated", { userId, persona: parsed.data.persona });
    res.json({ persona: parsed.data.persona });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
