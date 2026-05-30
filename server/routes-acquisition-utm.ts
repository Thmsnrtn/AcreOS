/**
 * /api/me/acquisition-utm — capture UTM attribution at signup (Wave 3 / E).
 *
 * Why this exists: distribution telemetry foundation. Pre-this, AcreOS had
 * no way to answer "where did this customer come from?" The org-level
 * utm_* columns existed in the schema but were never wired to a write
 * path. This endpoint accepts the client-captured attribution snapshot
 * (built in the browser from window.location.search + document.referrer
 * BEFORE sign-up) and persists it on the user row exactly once.
 *
 * Idempotency: writes only when users.acquisition_utm IS NULL. The
 * client is allowed to POST every time (e.g. on every sign-in until it
 * succeeds clearing sessionStorage), and the server silently no-ops on
 * subsequent calls so first-touch attribution sticks.
 *
 * Auth: isAuthenticated only — no org context needed (this is a user-
 * level fact, not an org-level one).
 */

import { Router, type Response } from "express";
import { eq, isNull, and } from "drizzle-orm";
import { z } from "zod";
import { db } from "./db";
import { users, type AcquisitionUtm } from "@shared/models/auth";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// Each individual UTM key is capped at 256 chars — long enough for real
// campaign names but short enough to refuse 10KB blobs jammed into the
// URL by abuse traffic. The referrer field gets 1024 because URLs
// legitimately get that long.
const utmKey = z.string().min(1).max(256).optional();
const referrerKey = z.string().min(1).max(1024).optional();
const landedAtKey = z
  .string()
  .datetime({ offset: true })
  .or(z.string().datetime())
  .optional();

const acquisitionUtmSchema = z
  .object({
    utm_source: utmKey,
    utm_medium: utmKey,
    utm_campaign: utmKey,
    utm_term: utmKey,
    utm_content: utmKey,
    referrer: referrerKey,
    landedAt: landedAtKey,
  })
  .strict();

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = acquisitionUtmSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }

    // Strip empty / undefined keys so we don't persist
    // `{ utm_source: undefined }` shaped rows.
    const cleaned: AcquisitionUtm = {};
    for (const [k, v] of Object.entries(parsed.data)) {
      if (typeof v === "string" && v.length > 0) {
        (cleaned as Record<string, string>)[k] = v;
      }
    }

    // Refuse to persist an empty snapshot — every key was blank/undefined.
    // The client should not POST in this case but we defend regardless.
    if (Object.keys(cleaned).length === 0) {
      return res.json({ persisted: false, reason: "empty" });
    }

    // Idempotent write. The WHERE clause restricts the update to rows
    // where acquisition_utm IS NULL, so a second call from a confused
    // client is a silent no-op. We do NOT round-trip a SELECT first to
    // avoid a TOCTOU gap.
    const updated = await db
      .update(users)
      .set({ acquisitionUtm: cleaned, updatedAt: new Date() })
      .where(and(eq(users.id, userId), isNull(users.acquisitionUtm)))
      .returning({ id: users.id });

    if (updated.length === 0) {
      // Either the user didn't exist (impossible — isAuthenticated would
      // have rejected) or acquisition_utm was already set. Treat both as
      // success for the client.
      return res.json({ persisted: false, reason: "already_set" });
    }

    logger.info("[acquisition-utm] captured", {
      userId,
      utm_source: cleaned.utm_source ?? null,
      utm_medium: cleaned.utm_medium ?? null,
      utm_campaign: cleaned.utm_campaign ?? null,
    });

    return res.json({ persisted: true });
  } catch (error) {
    logger.error("[acquisition-utm] capture failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return Errors.internal(res, error);
  }
});

export default router;
