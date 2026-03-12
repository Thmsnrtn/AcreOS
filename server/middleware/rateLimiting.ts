/**
 * Feature-Area Rate Limiting Middleware
 *
 * Provides per-organization rate limiting scoped to specific feature areas.
 * Uses an in-process sliding-window store. For multi-instance deployments,
 * the store falls back gracefully — each instance enforces its own window,
 * providing a soft limit that scales with replica count.
 *
 * Limits (per org, per minute):
 *   voice_calls    — 10 req/min
 *   valuation      — 50 req/min
 *   marketplace    — 100 req/min
 *   ai             — 30 req/min
 *   general        — 200 req/min
 *
 * Usage:
 *   import { featureRateLimiter } from "./middleware/rateLimiting";
 *   app.use("/api/calls", featureRateLimiter("voice_calls"));
 *   app.use("/api/valuations", featureRateLimiter("valuation"));
 */

import type { Request, Response, NextFunction } from "express";

// ─── Feature config ───────────────────────────────────────────────────────────

export type FeatureArea =
  | "voice_calls"
  | "valuation"
  | "marketplace"
  | "ai"
  | "general";

interface FeatureLimit {
  maxRequests: number;
  windowMs: number;
}

const FEATURE_LIMITS: Record<FeatureArea, FeatureLimit> = {
  voice_calls: { maxRequests: 10, windowMs: 60_000 },
  valuation:   { maxRequests: 50, windowMs: 60_000 },
  marketplace: { maxRequests: 100, windowMs: 60_000 },
  ai:          { maxRequests: 30, windowMs: 60_000 },
  general:     { maxRequests: 200, windowMs: 60_000 },
};

// ─── Sliding-window store ─────────────────────────────────────────────────────

interface WindowEntry {
  timestamps: number[];
}

// Key format: "feature:orgId" or "feature:ip:address"
const store = new Map<string, WindowEntry>();

// Periodic cleanup — remove entries with no recent activity
const CLEANUP_INTERVAL_MS = 2 * 60 * 1000; // every 2 min
setInterval(() => {
  const now = Date.now();
  const maxWindow = Math.max(...Object.values(FEATURE_LIMITS).map((l) => l.windowMs));
  const cutoff = now - maxWindow * 2;
  for (const [key, entry] of store.entries()) {
    const recent = entry.timestamps.filter((ts) => ts > cutoff);
    if (recent.length === 0) {
      store.delete(key);
    } else {
      entry.timestamps = recent;
    }
  }
}, CLEANUP_INTERVAL_MS);

// ─── Key extraction ───────────────────────────────────────────────────────────

function getRateLimitKey(feature: FeatureArea, req: Request): string {
  // Prefer org-scoped limiting (authenticated users)
  const orgId = (req as any).organization?.id ?? (req as any).session?.organizationId;
  if (orgId) {
    return `${feature}:org:${orgId}`;
  }
  // Fall back to IP-based limiting
  const ip = req.ip ?? req.socket?.remoteAddress ?? "unknown";
  return `${feature}:ip:${ip}`;
}

// ─── Core limiter logic ───────────────────────────────────────────────────────

function checkLimit(
  key: string,
  limit: FeatureLimit
): { allowed: boolean; remaining: number; resetAt: number; retryAfterSeconds: number } {
  const now = Date.now();
  const windowStart = now - limit.windowMs;

  let entry = store.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    store.set(key, entry);
  }

  // Slide the window
  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= limit.maxRequests) {
    const oldestTs = entry.timestamps[0];
    const resetAt = oldestTs + limit.windowMs;
    const retryAfterSeconds = Math.ceil((resetAt - now) / 1000);
    return {
      allowed: false,
      remaining: 0,
      resetAt,
      retryAfterSeconds,
    };
  }

  entry.timestamps.push(now);
  const remaining = limit.maxRequests - entry.timestamps.length;
  const oldestTs = entry.timestamps[0];
  const resetAt = oldestTs + limit.windowMs;

  return { allowed: true, remaining, resetAt, retryAfterSeconds: 0 };
}

// ─── Middleware factory ───────────────────────────────────────────────────────

/**
 * Returns an Express middleware that rate-limits the given feature area.
 * Responds with HTTP 429 when the org/IP exceeds its limit.
 */
export function featureRateLimiter(feature: FeatureArea) {
  const limit = FEATURE_LIMITS[feature];

  return (req: Request, res: Response, next: NextFunction): void => {
    const key = getRateLimitKey(feature, req);
    const result = checkLimit(key, limit);

    // Always set informational headers
    res.setHeader("X-RateLimit-Feature", feature);
    res.setHeader("X-RateLimit-Limit", limit.maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
    res.setHeader(
      "X-RateLimit-Reset",
      Math.ceil(result.resetAt / 1000).toString()
    );

    if (!result.allowed) {
      res.setHeader("Retry-After", result.retryAfterSeconds.toString());
      res.status(429).json({
        error: "Rate limit exceeded",
        feature,
        limit: limit.maxRequests,
        windowSeconds: Math.round(limit.windowMs / 1000),
        retryAfter: result.retryAfterSeconds,
        message: `Too many ${feature.replace("_", " ")} requests. Maximum ${limit.maxRequests} per minute per organization.`,
      });
      return;
    }

    next();
  };
}

// ─── Pre-built middleware instances ──────────────────────────────────────────

/** 10 req/min per org — voice/telephony endpoints */
export const voiceCallsLimiter = featureRateLimiter("voice_calls");

/** 50 req/min per org — AVM valuation endpoints */
export const valuationLimiter = featureRateLimiter("valuation");

/** 100 req/min per org — marketplace listing/bidding endpoints */
export const marketplaceLimiter = featureRateLimiter("marketplace");

/** 30 req/min per org — AI/Atlas/chat endpoints */
export const aiFeatureLimiter = featureRateLimiter("ai");

/** 200 req/min per org — general API endpoints */
export const generalLimiter = featureRateLimiter("general");

// ─── Diagnostics (for tests / admin) ─────────────────────────────────────────

export function getFeatureRateLimitStats(
  feature: FeatureArea,
  req: Request
): { key: string; count: number; limit: number; windowMs: number } {
  const key = getRateLimitKey(feature, req);
  const limit = FEATURE_LIMITS[feature];
  const entry = store.get(key);
  const now = Date.now();
  const windowStart = now - limit.windowMs;
  const count = entry
    ? entry.timestamps.filter((ts) => ts > windowStart).length
    : 0;
  return { key, count, limit: limit.maxRequests, windowMs: limit.windowMs };
}

export function clearFeatureRateLimitStore(): void {
  store.clear();
}
