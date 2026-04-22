/**
 * HTTP Cache-Control headers for GET /api/ responses.
 *
 * Navigation-heavy SPAs repeatedly hit the same read endpoints as the
 * user moves between pages (/today → /leads → back to /today). Without
 * proper Cache-Control, every navigation triggers a fresh round-trip,
 * DB query, and serialization — even for data that hasn't changed.
 *
 * This middleware adds private, short-TTL cache headers to GET /api/
 * responses so the browser (and the React Query cache mechanics)
 * serve cached responses instantly when the user navigates back within
 * the TTL window. Mutation responses are never cached.
 *
 * Rules:
 *   - GET /api/auth/*              → max-age=30, no-cache on logout
 *   - GET /api/organization        → max-age=60
 *   - GET /api/feature-flags       → max-age=300
 *   - GET /api/white-label/config  → max-age=300
 *   - GET /api/intelligence/*      → max-age=120
 *   - GET /api/dashboard/*         → max-age=60
 *   - GET /api/leads|properties|deals|notes → max-age=30 (list views)
 *   - GET /api/status              → max-age=30 (public)
 *   - Everything else              → no explicit caching (safer default)
 *
 * All responses use `private` (no CDN caching) because bodies can
 * include org-specific data. stale-while-revalidate gives the browser
 * permission to serve the old response while fetching a fresh one in
 * the background — the user sees instant results, the data refreshes
 * silently.
 */

import type { Request, Response, NextFunction } from "express";

interface CacheRule {
  pattern: RegExp;
  maxAge: number;
  swr?: number;
}

const RULES: CacheRule[] = [
  // Short-TTL — data that might change per-request
  { pattern: /^\/api\/leads(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/properties(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/deals(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/notes(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/payments(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/tasks(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/campaigns(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/alerts(\/|\?|$)/, maxAge: 15, swr: 30 },
  { pattern: /^\/api\/notifications(\/|\?|$)/, maxAge: 15, swr: 30 },
  { pattern: /^\/api\/dashboard\//, maxAge: 60, swr: 120 },
  { pattern: /^\/api\/activity(\/|\?|$)/, maxAge: 30, swr: 60 },

  // Medium-TTL — org identity / feature flags don't change often
  { pattern: /^\/api\/organization(\/|\?|$)/, maxAge: 60, swr: 300 },
  { pattern: /^\/api\/auth\/user(\/|\?|$)/, maxAge: 30, swr: 120 },
  { pattern: /^\/api\/white-label\//, maxAge: 300, swr: 900 },
  { pattern: /^\/api\/feature-flags(\/|\?|$)/, maxAge: 300, swr: 900 },
  { pattern: /^\/api\/intelligence\//, maxAge: 120, swr: 300 },

  // Long-TTL — truly static-ish
  { pattern: /^\/api\/changelog(\/|\?|$)/, maxAge: 600, swr: 3600 },
  { pattern: /^\/api\/status(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/api\/docs(\/|\?|$)/, maxAge: 3600, swr: 86400 },
];

export function httpCacheHeaders(req: Request, res: Response, next: NextFunction): void {
  // Only apply to safe-read GETs. Mutations, uploads, webhooks, etc. skip.
  if (req.method !== "GET") {
    next();
    return;
  }
  // Never cache error responses. Install a setHeader guard that only
  // applies the cache header if the status code is 2xx by the time the
  // response is sent.
  const originalSend = res.send.bind(res);
  const originalJson = res.json.bind(res);
  let applied = false;

  const applyIfEligible = () => {
    if (applied) return;
    if (res.statusCode < 200 || res.statusCode >= 300) return;
    // Don't clobber a Cache-Control header the handler already set.
    if (res.getHeader("Cache-Control")) return;

    const match = RULES.find((r) => r.pattern.test(req.path + (req.url.includes("?") ? "?" : "")));
    if (!match) return;

    const parts = [`private`, `max-age=${match.maxAge}`];
    if (match.swr) parts.push(`stale-while-revalidate=${match.swr}`);
    res.setHeader("Cache-Control", parts.join(", "));
    // Vary on Cookie so cached responses don't cross-pollinate between
    // logged-in/out states or between orgs (different __session cookies).
    const existingVary = res.getHeader("Vary");
    res.setHeader(
      "Vary",
      existingVary ? `${existingVary}, Cookie` : "Cookie",
    );
    applied = true;
  };

  res.send = (body: any) => {
    applyIfEligible();
    return originalSend(body);
  };
  res.json = (body: any) => {
    applyIfEligible();
    return originalJson(body);
  };

  next();
}
