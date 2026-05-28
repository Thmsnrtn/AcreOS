/**
 * /api/me/preferences — user-scoped appearance preferences.
 *
 * Phase B.5 of the production port. Drives the theme system (5 themes ×
 * light/dark + 5 font pairings + density + motion) per design-system §3-§6.
 *
 * GET    /api/me/preferences          → current preferences with defaults
 *                                       filled in for missing fields
 * PATCH  /api/me/preferences          → merge partial update; validates
 *                                       enum membership; rejects unknown
 *                                       values via Errors.validationFailed
 *
 * Validation note: each field has a fixed enum. Unknown values are rejected
 * loudly rather than silently coerced — bad data should not survive a
 * round-trip through the API. Defaults applied client-side; null in any
 * field means "use the client default" (bedrock / auto / editorial /
 * adaptive / motion-from-OS).
 */

import { Router, type Response } from "express";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users, type AppearancePreferences } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

const DEFAULT_PREFERENCES: Required<AppearancePreferences> = {
  theme: "bedrock",
  mode: "auto",
  fontPairing: "editorial",
  density: "adaptive",
  // Server-side default is "full"; client-side detection of
  // prefers-reduced-motion still applies until the user explicitly chooses.
  motion: "full",
  // Customization surfaces default to empty/disabled until the user opts in.
  sidebarConfig: {},
  listViews: {},
  notificationQuietHours: { enabled: false },
};

const preferencesSchema = z.object({
  theme: z.enum(["bedrock", "homestead", "quarry", "nocturne", "meadow", "slate"]).optional(),
  mode: z.enum(["light", "dark", "auto"]).optional(),
  fontPairing: z.enum(["editorial", "modern", "classic", "native", "refined"]).optional(),
  density: z.enum(["compact", "comfortable", "adaptive"]).optional(),
  motion: z.enum(["full", "reduced"]).optional(),
  // Phase C.1 — sidebar + mobile-bar customization. IDs are validated
  // client-side against the nav-items registry; server accepts any
  // string[] but caps length to prevent abuse.
  sidebarConfig: z.object({
    sidebarItems: z.array(z.string().max(64)).max(64).optional(),
    mobileItems: z.array(z.string().max(64)).max(8).optional(),
  }).strict().optional(),
  // Phase C.3 — per-list-type view preferences.
  listViews: z.record(
    z.string().max(64),
    z.enum(["rows", "cards", "expand-on-click"]),
  ).optional(),
  // Phase C.2 — global quiet hours. 0-23 hour values; window wraps midnight
  // when startHour > endHour. Server enforces nothing yet — this is a
  // user-visible preference; outbound channels read it at send time
  // (wired progressively as Phase E surfaces touch the channel paths).
  notificationQuietHours: z.object({
    enabled: z.boolean().optional(),
    startHour: z.number().int().min(0).max(23).optional(),
    endHour: z.number().int().min(0).max(23).optional(),
  }).strict().optional(),
}).strict();

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ appearancePreferences: users.appearancePreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const stored = (row?.appearancePreferences ?? {}) as AppearancePreferences;
    res.json({ ...DEFAULT_PREFERENCES, ...stored });
  } catch (error) {
    Errors.internal(res, error);
  }
});

router.patch("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);

    const parsed = preferencesSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const update = parsed.data;
    if (Object.keys(update).length === 0) {
      return Errors.badRequest(res, "Empty preferences update");
    }

    // Read current, merge, write — keeps the column shape consistent under
    // partial updates without needing a JSONB merge function.
    const [current] = await db
      .select({ appearancePreferences: users.appearancePreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    const merged: AppearancePreferences = {
      ...(current?.appearancePreferences ?? {}),
      ...update,
    };

    await db
      .update(users)
      .set({ appearancePreferences: merged, updatedAt: new Date() })
      .where(eq(users.id, userId));

    logger.info("Appearance preferences updated", { userId, fields: Object.keys(update) });
    res.json({ ...DEFAULT_PREFERENCES, ...merged });
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
