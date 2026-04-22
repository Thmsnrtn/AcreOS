/**
 * HTTP Cache-Control headers for GET /api/ responses.
 *
 * Uses `on-headers` (already a transitive dep via `compression`) to run
 * right before the headers flush to the socket — the only reliable
 * moment to decide based on final status code. Earlier attempts that
 * overrode res.send / res.json / res.writeHead were silently bypassed
 * by downstream middleware (compression wraps res.end, etc.).
 *
 * All responses use `private` (no CDN caching) since bodies can include
 * org-specific data. stale-while-revalidate gives the browser permission
 * to serve the old response while refreshing in the background — the
 * user sees instant results, the data updates silently.
 */

import type { Request, Response, NextFunction } from "express";
// @ts-ignore — transitive dep via `compression`, no types
import onHeaders from "on-headers";

interface CacheRule {
  pattern: RegExp;
  maxAge: number;
  swr?: number;
}

// Patterns match req.path — which, under app.use("/api", mw), is
// relative to the mount prefix. So "/leads", not "/api/leads".
const RULES: CacheRule[] = [
  // Short-TTL — data that might change per-request
  { pattern: /^\/leads(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/properties(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/deals(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/notes(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/payments(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/tasks(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/campaigns(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/alerts(\/|\?|$)/, maxAge: 15, swr: 30 },
  { pattern: /^\/notifications(\/|\?|$)/, maxAge: 15, swr: 30 },
  { pattern: /^\/dashboard\//, maxAge: 60, swr: 120 },
  { pattern: /^\/activity(\/|\?|$)/, maxAge: 30, swr: 60 },

  // Medium-TTL — org identity / feature flags don't change often
  { pattern: /^\/organization(\/|\?|$)/, maxAge: 60, swr: 300 },
  { pattern: /^\/auth\/user(\/|\?|$)/, maxAge: 30, swr: 120 },
  { pattern: /^\/white-label\//, maxAge: 300, swr: 900 },
  { pattern: /^\/feature-flags(\/|\?|$)/, maxAge: 300, swr: 900 },
  { pattern: /^\/config\/features(\/|\?|$)/, maxAge: 300, swr: 900 },
  { pattern: /^\/intelligence\//, maxAge: 120, swr: 300 },

  // Long-TTL — truly static-ish
  { pattern: /^\/changelog(\/|\?|$)/, maxAge: 600, swr: 3600 },
  { pattern: /^\/status(\/|\?|$)/, maxAge: 30, swr: 60 },
  { pattern: /^\/docs(\/|\?|$)/, maxAge: 3600, swr: 86400 },
];

export function httpCacheHeaders(req: Request, res: Response, next: NextFunction): void {
  if (req.method !== "GET") return next();

  const match = RULES.find((r) => r.pattern.test(req.path));
  if (!match) return next();

  onHeaders(res, function () {
    // Skip on non-2xx — don't tell browsers to cache errors.
    const sc = res.statusCode;
    if (sc < 200 || sc >= 300) return;
    // Don't overwrite if a handler already set its own policy.
    if (res.getHeader("Cache-Control")) return;

    const parts = [`private`, `max-age=${match.maxAge}`];
    if (match.swr) parts.push(`stale-while-revalidate=${match.swr}`);
    res.setHeader("Cache-Control", parts.join(", "));

    const existingVary = res.getHeader("Vary");
    res.setHeader("Vary", existingVary ? `${existingVary}, Cookie` : "Cookie");
  });

  next();
}
