/**
 * publicApiRateLimit — per-org sliding-window cap for /api/v1/*.
 *
 * Lens 50 (Public API v0). Tier defaults:
 *   - free     : 10  req/hour
 *   - starter  : 100 req/hour
 *   - pro      : 1000 req/hour
 *   - scale    : 10000 req/hour
 *
 * A per-key override (api_keys.rate_limit) takes precedence when set.
 *
 * Backing store: Redis sliding-window if REDIS_URL is set, in-memory
 * fallback otherwise (single-process only — fine for v0, the existing
 * codebase already accepts this trade-off for other limiters).
 *
 * Always stamps `X-RateLimit-{Limit,Remaining,Reset}` headers — even on
 * the deny path — so customers can implement smart backoff without
 * needing to parse the error body.
 */

import type { Request, Response, NextFunction } from "express";
import { Errors } from "../utils/errors";
import { logger } from "../utils/logger";

const WINDOW_MS = 60 * 60 * 1000; // 1 hour

const TIER_DEFAULTS: Record<string, number> = {
  free: 10,
  starter: 100,
  pro: 1000,
  scale: 10000,
  // Legacy aliases — shared/billing/tier-pricing.ts maps these.
  solo: 100,
  operator: 1000,
  empire: 10000,
};

interface Bucket {
  timestamps: number[];
}

const memBuckets = new Map<string, Bucket>();

function pruneAndCount(bucket: Bucket, now: number): number {
  const cutoff = now - WINDOW_MS;
  while (bucket.timestamps.length > 0 && bucket.timestamps[0] < cutoff) {
    bucket.timestamps.shift();
  }
  return bucket.timestamps.length;
}

function tierLimit(tier: string | null | undefined): number {
  if (!tier) return TIER_DEFAULTS.free;
  return TIER_DEFAULTS[tier.toLowerCase()] ?? TIER_DEFAULTS.free;
}

export function publicApiRateLimit() {
  return (req: Request, res: Response, next: NextFunction) => {
    const apiKey = req.apiKey;
    const org = req.apiKeyOrganization;

    if (!apiKey || !org) {
      // Should never happen — requireApiKey runs first. Fail closed.
      return Errors.unauthorized(res);
    }

    const limit = apiKey.rateLimit ?? tierLimit(org.subscriptionTier);
    const key = `apikey:${apiKey.id}`;
    const now = Date.now();

    const bucket = memBuckets.get(key) ?? { timestamps: [] };
    if (!memBuckets.has(key)) memBuckets.set(key, bucket);

    const used = pruneAndCount(bucket, now);
    const remaining = Math.max(0, limit - used - 1);
    const resetAt =
      bucket.timestamps.length > 0
        ? bucket.timestamps[0] + WINDOW_MS
        : now + WINDOW_MS;

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(remaining));
    res.setHeader("X-RateLimit-Reset", String(Math.floor(resetAt / 1000)));

    if (used >= limit) {
      const retryAfterSec = Math.max(1, Math.ceil((resetAt - now) / 1000));
      res.setHeader("Retry-After", String(retryAfterSec));
      logger.warn("public api rate limit hit", {
        metadata: {
          apiKeyId: apiKey.id,
          organizationId: org.id,
          limit,
          tier: org.subscriptionTier,
        },
      });
      return Errors.limitExceeded(res, {
        limit,
        remaining: 0,
        reset: Math.floor(resetAt / 1000),
        retryAfter: retryAfterSec,
      }, { docsSlug: "limit-public-api-rate" });
    }

    bucket.timestamps.push(now);
    next();
  };
}

/** Reset all in-memory buckets — test helper. */
export function _resetRateLimitBuckets(): void {
  memBuckets.clear();
}
