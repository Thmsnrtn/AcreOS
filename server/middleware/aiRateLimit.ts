/**
 * aiRateLimit — per-organization rate limit on /api/ai/* routes.
 *
 * Phase 3 Week 9.
 *
 * Distinct from `aiLimiter` in rateLimit.ts because:
 *   - aiLimiter is keyed by user (or IP fallback) and gates the user's
 *     personal request rate. It is meant to stop a single tab from melting
 *     the dashboard.
 *   - aiRateLimit is keyed by *organization* and gates the whole org's
 *     fan-out across all of its members. It is meant to stop a single
 *     tenant from saturating provider quotas for the whole instance.
 *
 * Limits:
 *   - 60 req / minute / org
 *   - 600 req / hour / org
 *
 * Either window can trip independently. Both use the same Redis-backed
 * sliding-window infra in createRateLimiter so behavior matches the rest
 * of the rate-limit stack: cross-instance enforcement when Redis is up,
 * per-instance fallback otherwise.
 *
 * Founder orgs (req.isFounder) bypass entirely — same convention as
 * usageLimitGate and feature gates.
 *
 * NOTE on key: this middleware mounts at app.use("/api/ai", ...) which runs
 * BEFORE per-route auth middleware. req.organizationId is therefore not yet
 * populated for most requests. We fall back to user:<id> when an authed user
 * exists on the request (some upstream middleware may have set it), and to
 * ip:<addr> otherwise. The org-level cost CAP is enforced inside
 * routeAITask itself — this middleware is best-effort traffic shaping.
 */

import type { Request, Response, NextFunction } from "express";
import { createRateLimiter } from "./rateLimit";

// Key extractor — one of:
//   org:<id>   — when req.organizationId is set (post-auth on routes that
//                attach it via getOrCreateOrg before this limiter)
//   user:<id>  — authenticated request without an org (rare; pre-onboarding)
//   ip:<ip>    — unauthenticated request (the global IP limiter still applies)
function orgKey(req: Request): string {
  const orgId = req.organizationId as number | undefined;
  if (orgId) return `org:${orgId}`;
  const user = req.user;
  if (user?.id) return `user:${user.id}`;
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
}

// Two stacked limiters — minute window AND hour window. A request passes
// only if both allow. We construct them once and call them sequentially.
const minuteLimiter = createRateLimiter(
  { maxRequests: 60, windowMs: 60 * 1000 },
  (req) => `ai-min:${orgKey(req)}`,
);

const hourLimiter = createRateLimiter(
  { maxRequests: 600, windowMs: 60 * 60 * 1000 },
  (req) => `ai-hr:${orgKey(req)}`,
);

/**
 * Express middleware: per-org token-bucket-ish rate limit on AI routes.
 *
 * Bypasses founder orgs. Checks the per-minute window first (smaller bucket
 * trips fastest), then the per-hour window. Both must pass.
 *
 * Mounted at /api/ai/* — see server/routes.ts.
 */
export function aiRateLimit(req: Request, res: Response, next: NextFunction): void {
  // Founder bypass — req.isFounder is set by getOrCreateOrg / auth.
  if (req.isFounder) {
    next();
    return;
  }

  // Minute limiter first, then hour limiter. Both write rate-limit headers;
  // the second-to-run will overwrite the first's, which is the desired
  // behavior (the most restrictive remaining window is what the client
  // should see).
  minuteLimiter(req, res, (err?: any) => {
    if (err) return next(err);
    if (res.headersSent) return; // 429 already sent by minuteLimiter
    hourLimiter(req, res, next);
  });
}
