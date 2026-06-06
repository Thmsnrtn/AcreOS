/**
 * /api/marketing/touch — public marketing-touch ingest (Soren, 2026-06-06).
 *
 * The write path for the acquisition event substrate
 * (docs/internal/marketing-os/03-analytics.md §4). Captures every pre-signup
 * marketing/lifecycle touchpoint — page views on /learn + landing, CTA
 * clicks, signup-funnel steps — keyed by a 1st-party `anonymous_id` cookie.
 *
 * Why server-side (not just PostHog): the spec's §6.2 recommendation is to
 * OWN the raw data in our own Postgres and RENT the dashboard. PostHog can be
 * blocked by extensions and its data leaves our infra; this table is the
 * canonical record we control. The client's lib/analytics.ts still fires
 * PostHog events in parallel — this endpoint is the durable substrate.
 *
 * Auth: UNAUTHENTICATED by design — most touches happen pre-signup. The
 * `anonymous_id` is the join key; `user_id`/`organization_id` are backfilled
 * post-signup (see backfillTouchIdentity()).
 *
 * Privacy locks (feedback_rate_limit_ip_keying + spec §4):
 *   - NO raw IP stored. Country-only via cf-ipcountry / x-vercel-ip-country.
 *   - User-agent HASHED (sha256, truncated), never raw.
 *
 * Rate limiting: keyed by anonymous_id (NOT pure IP) — carrier NAT shares one
 * IP across many phones, so an IP-keyed limiter on this hot path would punish
 * legitimate mobile traffic (feedback_rate_limit_ip_keying).
 */

import { Router, type Request, type Response, type Express } from "express";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "./db";
import { marketingTouch, type InsertMarketingTouch } from "@shared/schema";
import { createRateLimiter } from "./middleware/rateLimit";
import { Errors } from "./utils/errors";
import { logger } from "./utils/logger";

const router = Router();

// Each free-text field is capped so abuse traffic can't jam 10KB blobs into a
// column. Campaign names get 256; referrer/path get more (URLs run long).
const shortStr = z.string().min(1).max(256);
const longStr = z.string().min(1).max(1024);

const touchSchema = z
  .object({
    anonymousId: z.string().min(8).max(64),
    surface: shortStr,
    eventType: z
      .enum(["page_view", "cta_click", "funnel_step", "email_open", "email_click"])
      .default("page_view"),
    sourceArtifactId: shortStr.optional(),
    utm_source: shortStr.optional(),
    utm_medium: shortStr.optional(),
    utm_campaign: shortStr.optional(),
    utm_term: shortStr.optional(),
    utm_content: shortStr.optional(),
    referrer: longStr.optional(),
    landingPath: longStr,
    deviceType: z.enum(["mobile", "desktop", "tablet"]).optional(),
    // Caller-supplied event extras (step name, durationMs, ctaId, …). Capped
    // depth/size by JSON.stringify length below.
    payload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

/**
 * Country-only geo from edge headers. NEVER the raw IP.
 */
function ipCountryOf(req: Request): string | null {
  const c =
    (req.headers["cf-ipcountry"] as string | undefined) ??
    (req.headers["x-vercel-ip-country"] as string | undefined);
  if (!c || c === "XX" || c.length > 4) return null;
  return c.toUpperCase();
}

/**
 * Hash the UA for cohort grouping. Truncated sha256 — enough entropy to group,
 * not enough to fingerprint an individual. Never store the raw UA.
 */
function userAgentHashOf(req: Request): string | null {
  const ua = req.headers["user-agent"];
  if (typeof ua !== "string" || ua.length === 0) return null;
  return createHash("sha256").update(ua).digest("hex").slice(0, 16);
}

// 60 touches / minute / anonymousId. Generous for real browsing (page views +
// CTA clicks across a session) but caps a single bad actor. Keyed by the
// anonymousId from the body, NOT the IP (carrier NAT). Falls back to IP only
// when no anonymousId is present (malformed request — will 422 anyway).
const touchLimiter = createRateLimiter(
  { maxRequests: 60, windowMs: 60 * 1000 },
  (req: Request) => {
    const anon = (req.body as { anonymousId?: unknown })?.anonymousId;
    if (typeof anon === "string" && anon.length >= 8) return `mtouch:${anon}`;
    const ip = req.ip || req.socket.remoteAddress || "unknown";
    return `mtouch:ip:${ip}`;
  },
);

router.post("/", touchLimiter, async (req: Request, res: Response) => {
  try {
    const parsed = touchSchema.safeParse(req.body);
    if (!parsed.success) {
      return Errors.validationFailed(res, parsed.error.issues);
    }
    const d = parsed.data;

    // Bound the payload size — refuse pathological blobs.
    if (d.payload && JSON.stringify(d.payload).length > 4096) {
      return Errors.badRequest(res, "payload too large");
    }

    const row: InsertMarketingTouch = {
      anonymousId: d.anonymousId,
      surface: d.surface,
      eventType: d.eventType,
      sourceArtifactId: d.sourceArtifactId ?? null,
      utmSource: d.utm_source ?? null,
      utmMedium: d.utm_medium ?? null,
      utmCampaign: d.utm_campaign ?? null,
      utmTerm: d.utm_term ?? null,
      utmContent: d.utm_content ?? null,
      referrer: d.referrer ?? null,
      landingPath: d.landingPath,
      deviceType: d.deviceType ?? null,
      userAgentHash: userAgentHashOf(req),
      ipCountry: ipCountryOf(req),
      payload: d.payload ?? null,
    };

    await db.insert(marketingTouch).values(row);

    // 204 — fire-and-forget from the client. No body to parse on the happy
    // path keeps the beacon cheap.
    return res.status(204).end();
  } catch (error) {
    // A failed analytics write must NEVER surface to the visitor as a hard
    // error in a way that breaks the page. Log it; return 204 so the client
    // beacon treats it as delivered and moves on.
    logger.error(
      "[marketing-touch] ingest failed",
      error instanceof Error ? error : undefined,
    );
    return res.status(204).end();
  }
});

export function registerMarketingTouchRoutes(app: Express): void {
  app.use("/api/marketing/touch", router);
}

export default router;
