import type { Request, Response, NextFunction } from "express";
import { getRedisClient } from "../utils/redis";
import { logger } from "../utils/logger";

// ── Rate Limit Hit Monitoring ────────────────────────────────────────────────
// Tracks how many times each key has been rate-limited in the current hour.
// If a key exceeds ALERT_THRESHOLD hits, a structured warning is logged for
// Sentry/Winston to capture (no DB writes in the hot path — avoids DoS amplification).

const ALERT_THRESHOLD = 20; // Hits in one hour before logging a high-severity warning
const rateLimitHits = new Map<string, { count: number; windowStart: number; endpoint: string }>();
const HIT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function recordRateLimitHit(key: string, endpoint: string): void {
  const now = Date.now();
  const entry = rateLimitHits.get(key);

  if (!entry || now - entry.windowStart > HIT_WINDOW_MS) {
    rateLimitHits.set(key, { count: 1, windowStart: now, endpoint });
    return;
  }

  entry.count++;

  // Escalating log levels: warn at threshold, error at 2×, critical at 5×
  if (entry.count === ALERT_THRESHOLD) {
    logger.warn(`Rate limit alert: key=${key} rate-limited ${entry.count} times in 1h`, { metadata: { key, count: entry.count, endpoint } });
  } else if (entry.count === ALERT_THRESHOLD * 2) {
    logger.error(`Rate limit HIGH: key=${key} rate-limited ${entry.count} times in 1h — possible abuse`);
  } else if (entry.count >= ALERT_THRESHOLD * 5 && entry.count % (ALERT_THRESHOLD * 5) === 0) {
    logger.error(`Rate limit CRITICAL: key=${key} rate-limited ${entry.count} times in 1h — likely attack`);
  }
}

// Cleanup rate limit hit counters hourly
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of rateLimitHits.entries()) {
    if (now - entry.windowStart > HIT_WINDOW_MS) {
      rateLimitHits.delete(key);
    }
  }
}, HIT_WINDOW_MS);

/** Expose rate limit hit stats for the founder health endpoint */
export function getRateLimitHitStats(): Array<{ key: string; count: number; endpoint: string }> {
  return Array.from(rateLimitHits.entries())
    .filter(([, e]) => e.count >= ALERT_THRESHOLD)
    .map(([key, e]) => ({ key, count: e.count, endpoint: e.endpoint }))
    .sort((a, b) => b.count - a.count);
}

/**
 * Rate limit entry in the in-memory store (fallback when Redis is unavailable)
 * Uses sliding window algorithm with array of timestamps
 */
interface RateLimitEntry {
  timestamps: number[];
}

/**
 * Rate limit configuration
 */
export interface RateLimitConfig {
  maxRequests: number;
  windowMs: number;
}

/**
 * Function type to extract the key from a request
 * Can be based on IP, user ID, or custom logic
 */
type KeyFunction = (req: Request) => string;

/**
 * Predefined rate limit configurations
 */
export const RATE_LIMIT_CONFIGS = {
  default: { maxRequests: 1000, windowMs: 60 * 1000 } as RateLimitConfig, // 1000 per minute (SPA loads 5-10 API calls per page)
  strict: { maxRequests: 50, windowMs: 60 * 1000 } as RateLimitConfig, // 50 per minute (AI, Stripe)
  auth: { maxRequests: 10, windowMs: 60 * 1000 } as RateLimitConfig, // 10 per minute
  public: { maxRequests: 50, windowMs: 60 * 1000 } as RateLimitConfig, // 50 per minute
} as const;

// ── In-memory fallback store ─────────────────────────────────────────────────
// Used only when Redis is unavailable. Per-instance enforcement is still better
// than no enforcement.

const rateLimitStore = new Map<string, RateLimitEntry>();

const CLEANUP_INTERVAL = 60 * 1000;

setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];

  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    const maxWindowMs = Math.max(
      RATE_LIMIT_CONFIGS.default.windowMs,
      RATE_LIMIT_CONFIGS.strict.windowMs,
      RATE_LIMIT_CONFIGS.auth.windowMs,
      RATE_LIMIT_CONFIGS.public.windowMs
    );
    const cutoffTime = now - (2 * maxWindowMs);

    const recentTimestamps = entry.timestamps.filter((ts: number) => ts > cutoffTime);

    if (recentTimestamps.length === 0) {
      keysToDelete.push(key);
    } else {
      entry.timestamps = recentTimestamps;
    }
  }

  for (const key of keysToDelete) {
    rateLimitStore.delete(key);
  }
}, CLEANUP_INTERVAL);

// ── Redis-backed sliding window check ────────────────────────────────────────
// Uses INCR + EXPIRE for a fixed-window counter in Redis. This works correctly
// across multiple server instances. Falls back to in-memory if Redis is down.

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number; // epoch ms
  retryAfterSeconds: number;
}

async function checkRateLimitRedis(
  redisKey: string,
  config: RateLimitConfig,
): Promise<RateLimitResult | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null; // No Redis — caller should use in-memory fallback

    const now = Date.now();
    const windowSeconds = Math.ceil(config.windowMs / 1000);
    const fullKey = `rl:${redisKey}`;

    const count = await redis.incr(fullKey);
    if (count === 1) {
      // First request in this window — set expiry
      await redis.expire(fullKey, windowSeconds);
    }

    // Get the TTL to calculate reset time
    const ttl = await redis.ttl(fullKey);
    const resetTime = now + (ttl > 0 ? ttl * 1000 : config.windowMs);

    const allowed = count <= config.maxRequests;
    const remaining = Math.max(0, config.maxRequests - count);
    const retryAfterSeconds = allowed ? 0 : Math.ceil((resetTime - now) / 1000);

    return { allowed, remaining, resetTime, retryAfterSeconds };
  } catch (err) {
    logger.error("Redis rate limit check failed — falling back to in-memory", err instanceof Error ? err : undefined);
    return null; // Signal caller to use in-memory fallback
  }
}

function checkRateLimitInMemory(
  key: string,
  config: RateLimitConfig,
): RateLimitResult {
  const now = Date.now();
  const windowStart = now - config.windowMs;

  let entry = rateLimitStore.get(key);
  if (!entry) {
    entry = { timestamps: [] };
    rateLimitStore.set(key, entry);
  }

  entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

  if (entry.timestamps.length >= config.maxRequests) {
    const oldestTimestamp = entry.timestamps[0];
    const resetTime = oldestTimestamp + config.windowMs;
    const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);
    return { allowed: false, remaining: 0, resetTime, retryAfterSeconds };
  }

  entry.timestamps.push(now);
  const remaining = config.maxRequests - entry.timestamps.length;
  const resetTime = entry.timestamps[0] + config.windowMs;

  return { allowed: true, remaining, resetTime, retryAfterSeconds: 0 };
}

/**
 * Create a rate limiting middleware with Redis-backed sliding window.
 *
 * Strategy:
 * 1. Try Redis INCR + EXPIRE for cross-instance enforcement
 * 2. If Redis is unavailable, fall back to per-instance in-memory sliding window
 * 3. Never block requests due to rate limiter infrastructure errors (fail open)
 *
 * @param config - Rate limit configuration with maxRequests and windowMs
 * @param keyFunction - Optional function to generate rate limit key from request
 * @returns Express middleware function
 */
export function createRateLimiter(
  config: RateLimitConfig,
  keyFunction?: KeyFunction
) {
  const getKey =
    keyFunction ||
    ((req: Request) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      return `ip:${ip}`;
    });

  return async (req: Request, res: Response, next: NextFunction) => {
    const key = getKey(req);

    try {
      // Try Redis first for cross-instance enforcement
      const redisResult = await checkRateLimitRedis(key, config);
      const result = redisResult ?? checkRateLimitInMemory(key, config);

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", result.remaining.toString());
      res.setHeader("X-RateLimit-Reset", Math.ceil(result.resetTime / 1000).toString());

      if (!result.allowed) {
        res.setHeader("Retry-After", result.retryAfterSeconds.toString());
        recordRateLimitHit(key, req.path);

        return res.status(429).json({
          error: "rate_limit_exceeded",
          message: `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${Math.round(config.windowMs / 1000)} seconds allowed.`,
          retryAfter: result.retryAfterSeconds,
          statusCode: 429,
        });
      }

      next();
    } catch (err) {
      // Fail open — never block requests due to rate limiter errors
      logger.error("Rate limiter middleware error — allowing request", err instanceof Error ? err : undefined, {
        metadata: { key },
      });
      next();
    }
  };
}

/**
 * Key function for extracting user ID from authenticated requests
 * Falls back to IP address if user is not authenticated
 * Uses "user:userId" format for authenticated users
 * Uses "ip:address" format for unauthenticated requests
 */
export const authenticatedKeyFunction: KeyFunction = (req: Request) => {
  const user = (req as any).user;
  if (user) {
    const userId = user?.id || user.id;
    if (userId) {
      return `user:${userId}`;
    }
  }
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  return `ip:${ip}`;
};

/**
 * Create a rate limiter for authenticated users
 * Uses user ID as the key, falling back to IP for unauthenticated requests
 *
 * @param config - Rate limit configuration
 * @returns Express middleware function
 */
export function createAuthenticatedRateLimiter(config: RateLimitConfig) {
  return createRateLimiter(config, authenticatedKeyFunction);
}

/**
 * Pre-configured rate limiter instances for common use cases
 * These are ready to use directly in routes
 */
export const rateLimiters = {
  default: createAuthenticatedRateLimiter(RATE_LIMIT_CONFIGS.default),
  strict: createAuthenticatedRateLimiter(RATE_LIMIT_CONFIGS.strict),
  auth: createRateLimiter(RATE_LIMIT_CONFIGS.auth), // IP-based for auth endpoints
  public: createRateLimiter(RATE_LIMIT_CONFIGS.public), // IP-based for public endpoints
};

/**
 * Named limiters for specific route groups
 */
export const authLimiter = createRateLimiter({ maxRequests: 10, windowMs: 15 * 60 * 1000 });

// ─── Pillar D / D2 — Per-org tier-aware rate limits ─────────────────────────
//
// Three pieces:
//   1. orgTieredKeyFunction — keys on req.organization.id when present,
//      falls back to authenticatedKeyFunction.
//   2. TIER_QUOTAS — default per-minute request budget by subscription tier.
//      Founder can override per-org via organizations.settings.rateLimitOverride.
//   3. createOrgTieredRateLimiter() — picks the right inner limiter at
//      request time based on the org's tier (and any override).
//
// Why this matters: per-IP limits don't protect tenants from each other.
// One enterprise customer running a sloppy script can use 100% of the
// shared budget. Per-org quotas prevent the noisy-neighbor problem.

export const TIER_QUOTAS: Record<string, RateLimitConfig> = {
  // Conservative — fits a single-user-per-org workflow.
  free: { maxRequests: 60, windowMs: 60 * 1000 },
  // Default for paid customers.
  starter: { maxRequests: 300, windowMs: 60 * 1000 },
  // Power users + small teams.
  pro: { maxRequests: 1500, windowMs: 60 * 1000 },
  // Enterprise customers — large enough that custom override is usually
  // unnecessary but `org.settings.rateLimitOverride` is available.
  enterprise: { maxRequests: 6000, windowMs: 60 * 1000 },
};

export const orgTieredKeyFunction: KeyFunction = (req: Request) => {
  const org = (req as Request & { organization?: { id?: number } }).organization;
  if (org?.id) return `org:${org.id}`;
  return authenticatedKeyFunction(req);
};

interface OrgSettingsShape {
  rateLimitOverride?: { maxRequests?: number; windowMs?: number };
}
interface OrgShape {
  id?: number;
  subscriptionTier?: string | null;
  settings?: OrgSettingsShape | null;
}

function resolveOrgQuota(req: Request): RateLimitConfig {
  const org = (req as Request & { organization?: OrgShape }).organization;
  const tier = (org?.subscriptionTier ?? "free").toLowerCase();
  const tierDefault = TIER_QUOTAS[tier] ?? TIER_QUOTAS.free;
  const override = org?.settings?.rateLimitOverride;
  if (
    override &&
    typeof override.maxRequests === "number" &&
    override.maxRequests > 0 &&
    typeof override.windowMs === "number" &&
    override.windowMs >= 1000
  ) {
    return { maxRequests: override.maxRequests, windowMs: override.windowMs };
  }
  return tierDefault;
}

/**
 * Create a per-org tier-aware rate limiter. Returns express middleware that
 * dispatches to a tier-specific inner limiter at request time. The inner
 * limiters are memoized so we don't allocate a fresh closure per request.
 */
export function createOrgTieredRateLimiter() {
  // Lazy-init one limiter per (maxRequests, windowMs) combo we encounter.
  const innerLimiters = new Map<string, ReturnType<typeof createRateLimiter>>();
  const getLimiter = (config: RateLimitConfig) => {
    const key = `${config.maxRequests}@${config.windowMs}`;
    let inner = innerLimiters.get(key);
    if (!inner) {
      inner = createRateLimiter(config, orgTieredKeyFunction);
      innerLimiters.set(key, inner);
    }
    return inner;
  };
  return (req: Request, res: Response, next: NextFunction) => {
    const config = resolveOrgQuota(req);
    return getLimiter(config)(req, res, next);
  };
}

/** Ready-to-use per-org tier-aware limiter for /api/* mount sites. */
export const orgTieredLimiter = createOrgTieredRateLimiter();
// r3 Gabriel × Pax: /ai page loads fan out to ~8 ai-category endpoints
// on mount (conversations, scheduled-tasks/pending-results, pax/observations,
// ai/nudges, conversations/:id/messages, observations/stream, etc.) plus
// the first user prompt. 30/min trips on a warm dashboard refresh. Lift
// to 120/min — still well short of any provider cap and not a self-block.
export const aiLimiter = createAuthenticatedRateLimiter({ maxRequests: 120, windowMs: 60 * 1000 });
export const webhookLimiter = createRateLimiter({ maxRequests: 100, windowMs: 60 * 1000 });
export const importLimiter = createAuthenticatedRateLimiter({ maxRequests: 5, windowMs: 60 * 1000 });

/**
 * Helper function to get rate limit stats for a specific key
 * Useful for debugging and monitoring
 */
export function getRateLimitStats(key: string): {
  currentCount: number;
  maxRequests: number;
  windowMs: number;
  resetAt: number;
} | null {
  const entry = rateLimitStore.get(key);
  if (!entry) {
    return null;
  }

  const now = Date.now();
  // Find the maximum window among all configs
  const maxWindowMs = Math.max(
    RATE_LIMIT_CONFIGS.default.windowMs,
    RATE_LIMIT_CONFIGS.strict.windowMs,
    RATE_LIMIT_CONFIGS.auth.windowMs,
    RATE_LIMIT_CONFIGS.public.windowMs
  );

  const windowStart = now - maxWindowMs;
  const recentCount = entry.timestamps.filter((ts) => ts > windowStart).length;

  return {
    currentCount: recentCount,
    maxRequests: RATE_LIMIT_CONFIGS.default.maxRequests,
    windowMs: maxWindowMs,
    resetAt: entry.timestamps[0] ? entry.timestamps[0] + maxWindowMs : now,
  };
}

/**
 * Clear all rate limit entries (useful for testing)
 */
export function clearRateLimitStore() {
  rateLimitStore.clear();
}
