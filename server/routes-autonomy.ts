/**
 * /api/me/autonomy — per-agent autonomy matrix.
 *
 * Split off from /api/me/preferences in JC#14 (migration 0030) — autonomy is
 * operational policy (who acts, when, with what monetary ceiling), not a
 * visual preference. Lives in its own column so theme writes can't trample
 * agent policy and agents have a narrow read surface at action time.
 *
 * GET    /api/me/autonomy   → current matrix (empty object if unset; client
 *                              fills defaults from settings/autonomy-panel)
 * PATCH  /api/me/autonomy   → merge partial update; level 0-3, threshold
 *                              cents are non-negative ints, time guards 0-23
 *
 * Server-side enforcement (agents reading this at action time and gating /
 * asking / logging accordingly) is wired progressively as Phase E surfaces
 * touch agent action paths.
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users, type AutonomyPreferences } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const autonomyLevelSchema = z.union([
  z.literal(0), z.literal(1), z.literal(2), z.literal(3),
]);

const agentAutonomySchema = z.object({
  level: autonomyLevelSchema.optional(),
  perAction: z.record(z.string().max(64), autonomyLevelSchema).optional(),
  thresholdsCents: z.record(z.string().max(64), z.number().int().min(0).max(1_000_000_000)).optional(),
  // Workstream A (Honesty) — kill switch. ISO-8601 datetime. While in the
  // future, downstream executors MUST skip auto-execution for this agent
  // (only ask / draft, never execute). Wired progressively — schema accepts
  // it now so the /settings/pax surface can persist it.
  pausedUntil: z.string().datetime().optional(),
}).strict();

const autonomySchema = z.object({
  atlas: agentAutonomySchema.optional(),
  pax: agentAutonomySchema.optional(),
  sophie: agentAutonomySchema.optional(),
  timeGuards: z.object({
    pauseStartHour: z.number().int().min(0).max(23).optional(),
    pauseEndHour: z.number().int().min(0).max(23).optional(),
    dailyActionLimit: z.number().int().min(0).max(10000).optional(),
  }).strict().optional(),
}).strict();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ autonomyPreferences: users.autonomyPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    res.json((row?.autonomyPreferences ?? {}) as AutonomyPreferences);
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.patch("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const parsed = autonomySchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const update = parsed.data;
    if (Object.keys(update).length === 0) {
      return Errors.badRequest(res, "Empty autonomy update");
    }

    const [current] = await db
      .select({ autonomyPreferences: users.autonomyPreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const merged: AutonomyPreferences = {
      ...(current?.autonomyPreferences ?? {}),
      ...update,
    };

    await db
      .update(users)
      .set({ autonomyPreferences: merged, updatedAt: new Date() })
      .where(eq(users.id, userId));

    logger.info("Autonomy preferences updated", { userId, fields: Object.keys(update) });
    res.json(merged);
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
