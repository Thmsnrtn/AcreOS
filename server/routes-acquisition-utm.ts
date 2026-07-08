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
import { marketingTouch, teamMembers } from "@shared/schema";
import type { AuthenticatedRequest } from "./types/request";
import { getUserId } from "./types/request";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";
import { applyReferralCode } from "./services/referralService";

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
    // Marketing-touch substrate join key. When the client includes its
    // 1st-party anonymous_id, the server backfills user_id/organization_id
    // onto the pre-signup marketing_touch rows so the touch chain survives
    // the auth handshake. See docs/internal/marketing-os/03-analytics.md §2.2.
    anonymousId: z.string().min(8).max(64).optional(),
    // Tier 2C — referral + tier context ride the same first-touch chain.
    // `ref` is a referral code (also APPLIED server-side below, not just
    // stored); plan/billing are the pricing-CTA tier context.
    ref: z
      .string()
      .regex(/^[A-Za-z0-9_-]{4,16}$/)
      .optional(),
    plan: z.enum(["free", "starter", "pro", "scale"]).optional(),
    billing: z.enum(["monthly", "yearly"]).optional(),
    // Tier 3A — public parcel report first-touch carry ("ST/county-slug/APN").
    // Bounded segments mirror normalizeReportKey's limits so abuse traffic
    // can't jam arbitrary blobs into the snapshot.
    parcel: z
      .string()
      .regex(/^[A-Z]{2}\/[a-z0-9-]{1,64}\/[A-Za-z0-9 ._-]{2,64}$/)
      .optional(),
  })
  .strict();

/**
 * Backfill the marketing_touch chain for an anonymous_id with the now-known
 * user_id (and organization_id, if the user already belongs to one). Only
 * touches the org-less / user-less rows so a re-fire is a cheap no-op.
 * Best-effort: never throws into the caller — attribution backfill must not
 * break the signup flow.
 */
async function backfillTouchIdentity(
  anonymousId: string,
  userId: string,
): Promise<void> {
  try {
    // Resolve the user's org (most-recent membership) if one exists yet.
    const membership = await db
      .select({ organizationId: teamMembers.organizationId })
      .from(teamMembers)
      .where(eq(teamMembers.userId, userId))
      .limit(1);
    const organizationId = membership[0]?.organizationId ?? null;

    await db
      .update(marketingTouch)
      .set({ userId, organizationId })
      .where(
        and(
          eq(marketingTouch.anonymousId, anonymousId),
          isNull(marketingTouch.userId),
        ),
      );

    // Founder Autopilot attribution: if this visitor's witnessed touch chain
    // references a published autopilot artifact, record the signup conversion.
    // Best-effort + dedup'd; founder-dashboard only, never the learning loop.
    try {
      const { attributeSignup } = await import("./services/autopilot/attribution");
      void attributeSignup(anonymousId, organizationId);
    } catch {
      /* attribution must never break signup */
    }
  } catch (error) {
    logger.warn("[acquisition-utm] marketing_touch backfill failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

router.post("/", async (req: AuthenticatedRequest, res: Response) => {
  try {
    const userId = getUserId(req);
    const parsed = acquisitionUtmSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }

    // Pull the marketing-touch join key out before building the UTM blob —
    // anonymousId is a substrate join key, not an acquisition_utm field.
    const { anonymousId, ...utmFields } = parsed.data;

    // Backfill the marketing_touch chain regardless of whether a UTM blob is
    // present — a visitor with touches but no UTM still wants their chain
    // joined to the new account. Fire-and-forget (best-effort).
    if (anonymousId) {
      void backfillTouchIdentity(anonymousId, userId);
    }

    // Tier 2C — apply the referral code server-side at signup flush. The
    // authenticated user IS the referee (never body-supplied), and
    // applyReferralCode never throws — referral attribution must not
    // break the signup flow. The code is still persisted in the UTM blob
    // below so attribution survives even if apply was refused (e.g. the
    // code row was already claimed).
    if (utmFields.ref) {
      void applyReferralCode(utmFields.ref, userId);
    }

    // Strip empty / undefined keys so we don't persist
    // `{ utm_source: undefined }` shaped rows.
    const cleaned: AcquisitionUtm = {};
    for (const [k, v] of Object.entries(utmFields)) {
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
