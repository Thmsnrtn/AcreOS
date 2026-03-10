// @ts-nocheck
/**
 * Redis-Backed Rate Limiting (EPIC 10 — Infrastructure Hardening)
 *
 * Replaces in-memory per-instance rate limiting with Redis-backed limits
 * that enforce correctly across ALL server instances in multi-region deployment.
 *
 * Implementation uses the sliding window algorithm for accuracy.
 *
 * Rate limit tiers by subscription:
 *   free: 100 req/min, 1,000 req/hour, 10,000 req/day
 *   starter: 300 req/min, 5,000 req/hour, 50,000 req/day
 *   pro: 1,000 req/min, 20,000 req/hour, 200,000 req/day
 *   scale: 5,000 req/min, 100,000 req/hour, 1,000,000 req/day
 *   founder: unlimited
 *
 * API key rate limits (separate from auth'd user limits):
 *   free_api: 10 req/min, 1,000 req/day
 *   pro_api: 100 req/min, 50,000 req/day
 *   enterprise_api: 500 req/min, unlimited
 */

import type { Request, Response, NextFunction } from "express";

// ---------------------------------------------------------------------------
// Sliding window rate limiter using Redis ZRANGEBYSCORE + ZADD
// This is more accurate than token bucket for API fairness
// ---------------------------------------------------------------------------

interface RateLimitConfig {
  windowMs: number; // Window duration in milliseconds
  maxRequests: number; // Max requests per window
  keyPrefix: string; // Redis key prefix
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
  message?: string;
  statusCode?: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: Date;
  totalRequests: number;
}

async function checkRateLimit(
  redisClient: any,
  key: string,
  config: RateLimitConfig
): Promise<RateLimitResult> {
  if (!redisClient) {
    // No Redis — fall back to allow (graceful degradation)
    return { allowed: true, remaining: config.maxRequests, resetAt: new Date(), totalRequests: 0 };
  }

  const now = Date.now();
  const windowStart = now - config.windowMs;
  const fullKey = `${config.keyPrefix}:${key}`;

  try {
    // Sliding window using Redis sorted set
    // Score = timestamp, member = unique request ID
    const pipeline = redisClient.pipeline ? redisClient.pipeline() : null;

    if (pipeline) {
      // Atomic pipeline operations
      pipeline.zremrangebyscore(fullKey, 0, windowStart); // Remove expired entries
      pipeline.zadd(fullKey, now, `${now}:${Math.random()}`); // Add current request
      pipeline.zcard(fullKey); // Count requests in window
      pipeline.expire(fullKey, Math.ceil(config.windowMs / 1000) + 1); // Auto-expire

      const results = await pipeline.exec();
      const requestCount = results?.[2]?.[1] || 1;

      const allowed = requestCount <= config.maxRequests;
      const remaining = Math.max(0, config.maxRequests - requestCount);
      const resetAt = new Date(now + config.windowMs);

      // If over limit, remove the request we just added
      if (!allowed) {
        await redisClient.zremrangebyscore(fullKey, now, now);
      }

      return { allowed, remaining, resetAt, totalRequests: requestCount };
    } else {
      // Fallback: simple get/set without pipeline
      const count = await redisClient.incr(fullKey);
      if (count === 1) {
        await redisClient.expire(fullKey, Math.ceil(config.windowMs / 1000));
      }
      const allowed = count <= config.maxRequests;
      return {
        allowed,
        remaining: Math.max(0, config.maxRequests - count),
        resetAt: new Date(now + config.windowMs),
        totalRequests: count,
      };
    }
  } catch (err) {
    // Redis error — fail open (allow request, log error)
    console.error("[RedisRateLimit] Redis error:", err instanceof Error ? err.message : String(err));
    return { allowed: true, remaining: config.maxRequests, resetAt: new Date(), totalRequests: 0 };
  }
}

// ---------------------------------------------------------------------------
// Rate limit tier configs
// ---------------------------------------------------------------------------

const RATE_LIMIT_TIERS: Record<
  string,
  { perMinute: number; perHour: number; perDay: number }
> = {
  free: { perMinute: 100, perHour: 1000, perDay: 10000 },
  starter: { perMinute: 300, perHour: 5000, perDay: 50000 },
  pro: { perMinute: 1000, perHour: 20000, perDay: 200000 },
  scale: { perMinute: 5000, perHour: 100000, perDay: 1000000 },
  founder: { perMinute: 99999, perHour: 999999, perDay: 9999999 },
};

const API_KEY_TIERS: Record<
  string,
  { perMinute: number; perDay: number }
> = {
  free: { perMinute: 10, perDay: 1000 },
  starter: { perMinute: 30, perDay: 10000 },
  pro: { perMinute: 100, perDay: 50000 },
  scale: { perMinute: 500, perDay: 500000 },
  enterprise: { perMinute: 2000, perDay: 9999999 },
};

// ---------------------------------------------------------------------------
// Middleware factories
// ---------------------------------------------------------------------------

/**
 * Standard authenticated-user rate limiter
 * Uses organization ID + subscription tier as the rate limit key
 */
export function createOrgRateLimit(redisClient: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const orgId = (req as any).orgId || (req as any).user?.organizationId;
      const tier = (req as any).org?.subscriptionTier || "free";
      const isFounder = (req as any).org?.isFounder;

      if (!orgId || isFounder) {
        // Not authenticated or founder bypass — skip rate limiting
        return next();
      }

      const limits = RATE_LIMIT_TIERS[tier] || RATE_LIMIT_TIERS.free;

      // Check per-minute limit
      const minuteResult = await checkRateLimit(redisClient, `org:${orgId}`, {
        windowMs: 60 * 1000,
        maxRequests: limits.perMinute,
        keyPrefix: "rl:min",
      });

      if (!minuteResult.allowed) {
        res.setHeader("X-RateLimit-Limit", limits.perMinute);
        res.setHeader("X-RateLimit-Remaining", 0);
        res.setHeader("X-RateLimit-Reset", Math.floor(minuteResult.resetAt.getTime() / 1000));
        res.setHeader("Retry-After", Math.ceil((minuteResult.resetAt.getTime() - Date.now()) / 1000));
        return res.status(429).json({
          error: "rate_limit_exceeded",
          message: `Too many requests. Limit: ${limits.perMinute}/minute for ${tier} tier.`,
          retryAfter: Math.ceil((minuteResult.resetAt.getTime() - Date.now()) / 1000),
          upgradeUrl: "/settings/billing",
        });
      }

      // Check per-hour limit
      const hourResult = await checkRateLimit(redisClient, `org:${orgId}`, {
        windowMs: 60 * 60 * 1000,
        maxRequests: limits.perHour,
        keyPrefix: "rl:hour",
      });

      if (!hourResult.allowed) {
        return res.status(429).json({
          error: "hourly_rate_limit_exceeded",
          message: `Hourly limit of ${limits.perHour} requests reached.`,
          retryAfter: Math.ceil((hourResult.resetAt.getTime() - Date.now()) / 1000),
        });
      }

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit-Minute", limits.perMinute);
      res.setHeader("X-RateLimit-Remaining-Minute", minuteResult.remaining);
      res.setHeader("X-RateLimit-Limit-Hour", limits.perHour);
      res.setHeader("X-RateLimit-Remaining-Hour", hourResult.remaining);

      return next();
    } catch (err) {
      // Fail open — never block requests due to rate limit system errors
      console.error("[RedisRateLimit] Middleware error:", err instanceof Error ? err.message : String(err));
      return next();
    }
  };
}

/**
 * API key rate limiter for public developer API
 */
export function createApiKeyRateLimit(redisClient: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const apiKey = (req.headers.authorization || "").replace("Bearer ", "");
    if (!apiKey || !apiKey.startsWith("acr_")) {
      return next(); // Not an API key request — skip
    }

    const apiTier = (req as any).apiKeyTier || "free";
    const limits = API_KEY_TIERS[apiTier] || API_KEY_TIERS.free;

    const minuteResult = await checkRateLimit(redisClient, `apikey:${apiKey.substring(0, 20)}`, {
      windowMs: 60 * 1000,
      maxRequests: limits.perMinute,
      keyPrefix: "rl:api:min",
    });

    if (!minuteResult.allowed) {
      return res.status(429).json({
        error: "api_rate_limit_exceeded",
        message: `API key rate limit exceeded. Max: ${limits.perMinute} requests/minute.`,
        docs: "https://docs.acreos.com/api/rate-limits",
      });
    }

    const dayResult = await checkRateLimit(redisClient, `apikey:${apiKey.substring(0, 20)}`, {
      windowMs: 24 * 60 * 60 * 1000,
      maxRequests: limits.perDay,
      keyPrefix: "rl:api:day",
    });

    if (!dayResult.allowed) {
      return res.status(429).json({
        error: "daily_api_limit_exceeded",
        message: `Daily API limit of ${limits.perDay} requests reached.`,
      });
    }

    res.setHeader("X-RateLimit-Limit", limits.perMinute);
    res.setHeader("X-RateLimit-Remaining", minuteResult.remaining);
    res.setHeader("X-RateLimit-Daily-Limit", limits.perDay);
    res.setHeader("X-RateLimit-Daily-Remaining", dayResult.remaining);

    return next();
  };
}

/**
 * AI endpoint rate limiter — more restrictive due to cost
 * Applies stricter per-org limits for /api/ai/* routes
 */
export function createAIRateLimit(redisClient: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req as any).orgId;
    const isFounder = (req as any).org?.isFounder;
    const tier = (req as any).org?.subscriptionTier || "free";

    if (!orgId || isFounder) return next();

    // AI-specific limits: much lower than general API
    const aiLimits: Record<string, number> = {
      free: 20,
      starter: 100,
      pro: 500,
      scale: 2000,
      founder: 99999,
    };

    const maxAIPerHour = aiLimits[tier] || aiLimits.free;

    const result = await checkRateLimit(redisClient, `org:${orgId}:ai`, {
      windowMs: 60 * 60 * 1000, // per hour
      maxRequests: maxAIPerHour,
      keyPrefix: "rl:ai",
    });

    if (!result.allowed) {
      return res.status(429).json({
        error: "ai_rate_limit_exceeded",
        message: `AI request limit of ${maxAIPerHour}/hour reached for ${tier} tier.`,
        suggestion: "Upgrade your plan for higher AI limits.",
        upgradeUrl: "/settings/billing",
      });
    }

    res.setHeader("X-AI-RateLimit-Remaining", result.remaining);
    return next();
  };
}

/**
 * Unauthenticated endpoint rate limiter (by IP)
 * Protects login, registration, and public endpoints
 */
export function createIpRateLimit(
  redisClient: any,
  options: { maxPerMinute?: number; maxPerHour?: number } = {}
) {
  const maxPerMinute = options.maxPerMinute || 30;
  const maxPerHour = options.maxPerHour || 200;

  return async (req: Request, res: Response, next: NextFunction) => {
    const ip =
      req.headers["x-forwarded-for"]?.toString().split(",")[0].trim() ||
      req.socket?.remoteAddress ||
      "unknown";

    const minuteResult = await checkRateLimit(redisClient, `ip:${ip}`, {
      windowMs: 60 * 1000,
      maxRequests: maxPerMinute,
      keyPrefix: "rl:ip:min",
    });

    if (!minuteResult.allowed) {
      return res.status(429).json({
        error: "too_many_requests",
        message: "Too many requests from this IP address. Please slow down.",
      });
    }

    const hourResult = await checkRateLimit(redisClient, `ip:${ip}`, {
      windowMs: 60 * 60 * 1000,
      maxRequests: maxPerHour,
      keyPrefix: "rl:ip:hour",
    });

    if (!hourResult.allowed) {
      return res.status(429).json({
        error: "too_many_requests",
        message: "Hourly request limit exceeded for this IP address.",
      });
    }

    return next();
  };
}

/**
 * Webhook delivery rate limiter
 * Prevents flood attacks via webhook replay or large payloads
 */
export function createWebhookRateLimit(redisClient: any) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const orgId = (req as any).orgId;
    if (!orgId) return next();

    const result = await checkRateLimit(redisClient, `org:${orgId}:webhook`, {
      windowMs: 60 * 1000,
      maxRequests: 100, // Max 100 webhook deliveries per minute
      keyPrefix: "rl:webhook",
    });

    if (!result.allowed) {
      console.warn(`[RateLimit] Webhook flood from org ${orgId} — throttled`);
      return res.status(429).json({ error: "webhook_rate_limited" });
    }

    return next();
  };
}

export { checkRateLimit, type RateLimitConfig, type RateLimitResult };
