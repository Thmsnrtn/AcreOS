/**
 * Shared abuse controls for the public DSAR intake doors (Autopilot B-3).
 *
 * Both public intakes — the canonical POST /api/privacy/dsar
 * (routes-privacy-dsar.ts) and the legacy alias POST /api/public/dsar
 * (routes-dsar.ts) — write the same lifecycle record, so they carry the
 * same defences, defined once here:
 *
 *   - a per-IP rate limit (5 submissions per IP per hour — DSAR endpoints
 *     are abuse vectors: anonymous text storage), keyed on the real client
 *     IP via getClientIp (never bare req.ip, which behind Cloudflare → Fly
 *     is the edge address — see server/utils/clientIp.ts and the
 *     DEFECT-0062 keying rule);
 *   - Cloudflare Turnstile verification when CLOUDFLARE_TURNSTILE_SECRET
 *     is configured; when it is not, the rate limit is the defence and
 *     verification passes through.
 *
 * Before B-3 only the legacy alias carried these defences, so retiring
 * the alias would have retired the only rate-limited DSAR door.
 */

import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { Request } from "express";
import { getClientIp } from "../../utils/clientIp";
import { logger } from "../../utils/logger";

export const dsarIntakeLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => ipKeyGenerator(getClientIp(req)),
  message: { error: "RATE_LIMITED", message: "Too many DSAR submissions; try again in an hour." },
});

/**
 * Verify a Turnstile token server-side. Returns true when Turnstile is
 * not configured (rate-limit-only posture); when it is configured a
 * missing or rejected token returns false.
 */
export async function verifyDsarTurnstile(
  token: string | undefined,
  remoteIp: string | null,
): Promise<boolean> {
  const secret = process.env.CLOUDFLARE_TURNSTILE_SECRET;
  if (!secret) {
    // Turnstile not configured — fall back to rate-limit + email loop.
    return true;
  }
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.append("remoteip", remoteIp);
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const json = (await r.json()) as { success?: boolean };
    return Boolean(json.success);
  } catch (err) {
    logger.error("[dsar] turnstile verify failed", err as Error);
    return false;
  }
}
