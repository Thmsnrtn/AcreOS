/**
 * /api/me/preferences — user-scoped appearance preferences.
 *
 * Drives personal appearance: one colorway (Fieldstone · Bedrock · Meridian)
 * and one display mode (light · dark · auto = "Match device"). The canonical
 * lists, default and legacy migration live in shared/appearance.ts.
 *
 * GET    /api/me/preferences          → current preferences with defaults
 *                                       filled in for missing fields
 * PATCH  /api/me/preferences          → merge partial update; validates
 *                                       enum membership; rejects unknown
 *                                       values via Errors.validationFailed
 *
 * Validation note: each field has a fixed enum. Unknown values are rejected
 * loudly rather than silently coerced — bad data should not survive a
 * round-trip through the API. Two deliberate compatibility allowances for
 * clients that loaded before the Fieldstone redesign:
 *   - a RETIRED colorway id (homestead, quarry, …) is accepted and stored as
 *     its successor (normalizeColorway), never as itself;
 *   - the retired fontPairing / density / motion fields are accepted and
 *     discarded, so an old client's combined PATCH still saves its colorway.
 * Stored rows are normalized on READ too, so a row written before the
 * redesign returns a current colorway without any bulk rewrite of user data.
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
import { clock } from "./utils/clock";
import {
  COLORWAY_IDS,
  DEFAULT_COLORWAY,
  DEFAULT_DISPLAY_MODE,
  DISPLAY_MODES,
  LEGACY_COLORWAY_MIGRATION,
  RETIRED_APPEARANCE_FIELDS,
  normalizeAppearance,
  normalizeColorway,
} from "@shared/appearance";

const router = Router();

const DEFAULT_PREFERENCES: Required<AppearancePreferences> = {
  theme: DEFAULT_COLORWAY,
  mode: DEFAULT_DISPLAY_MODE,
  // Customization surfaces default to empty/disabled until the user opts in.
  sidebarConfig: {},
  listViews: {},
  notificationQuietHours: { enabled: false },
};

const ACCEPTED_COLORWAY_VALUES = [
  ...COLORWAY_IDS,
  ...Object.keys(LEGACY_COLORWAY_MIGRATION),
] as [string, ...string[]];

export const preferencesSchema = z.object({
  theme: z.enum(ACCEPTED_COLORWAY_VALUES).transform((v) => normalizeColorway(v)!).optional(),
  mode: z.enum(DISPLAY_MODES).optional(),
  // Retired personal-appearance fields — accepted from older clients, then
  // dropped (see stripRetired). Kept to their old enums so garbage still 422s.
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

/** Remove the retired fields from a stored or incoming blob. */
function stripRetired<T extends object>(blob: T): T {
  const out = { ...blob } as Record<string, unknown>;
  for (const f of RETIRED_APPEARANCE_FIELDS) delete out[f];
  return out as T;
}

/** Stored JSONB → the response body: defaults filled, retired fields gone,
 *  a pre-redesign colorway or mode read through the shared normalization. */
export function serializePreferences(stored: unknown): Required<AppearancePreferences> {
  const blob = stored && typeof stored === "object" ? (stored as Record<string, unknown>) : {};
  const { theme, mode } = normalizeAppearance(blob);
  return { ...DEFAULT_PREFERENCES, ...(stripRetired(blob) as AppearancePreferences), theme, mode };
}

router.get("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const [row] = await db
      .select({ appearancePreferences: users.appearancePreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    res.json(serializePreferences(row?.appearancePreferences));
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
    const update = stripRetired(parsed.data as Record<string, unknown>) as AppearancePreferences;
    if (Object.keys(parsed.data).length === 0) {
      return Errors.badRequest(res, "Empty preferences update");
    }

    // Read current, merge, write — keeps the column shape consistent under
    // partial updates without needing a JSONB merge function.
    const [current] = await db
      .select({ appearancePreferences: users.appearancePreferences })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);

    // Retired keys left in an older row are dropped on the person's own
    // next write; nothing rewrites rows in bulk.
    const merged: AppearancePreferences = stripRetired({
      ...((current?.appearancePreferences ?? {}) as AppearancePreferences),
      ...update,
    });

    await db
      .update(users)
      .set({ appearancePreferences: merged, updatedAt: clock.now() })
      .where(eq(users.id, userId));

    logger.info("Appearance preferences updated", { userId, fields: Object.keys(update) });
    res.json(serializePreferences(merged));
  } catch (error) {
    Errors.internal(res, error);
  }
});

export default router;
