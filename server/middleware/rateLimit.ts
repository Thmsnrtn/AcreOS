import type { Request, Response, NextFunction } from "express";

/**
 * Rate limit entry in the in-memory store
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
  default: { maxRequests: 100, windowMs: 60 * 1000 } as RateLimitConfig, // 100 per minute
  strict: { maxRequests: 50, windowMs: 60 * 1000 } as RateLimitConfig, // 50 per minute (AI, Stripe)
  auth: { maxRequests: 10, windowMs: 60 * 1000 } as RateLimitConfig, // 10 per minute
  public: { maxRequests: 50, windowMs: 60 * 1000 } as RateLimitConfig, // 50 per minute
} as const;

/**
 * In-memory store for rate limit tracking
 * Key format: "ip:address" or "user:userId"
 */
const rateLimitStore = new Map<string, RateLimitEntry>();

/**
 * Cleanup interval to remove old entries and prevent memory leaks
 * Runs every minute
 */
const CLEANUP_INTERVAL = 60 * 1000;

setInterval(() => {
  const now = Date.now();
  const keysToDelete: string[] = [];

  const entries = Array.from(rateLimitStore.entries());
  for (const [key, entry] of entries) {
    // Remove timestamps that are older than the maximum possible window
    // Keep 2 minutes of history as buffer to handle edge cases
    const maxWindowMs = Math.max(
      RATE_LIMIT_CONFIGS.default.windowMs,
      RATE_LIMIT_CONFIGS.strict.windowMs,
      RATE_LIMIT_CONFIGS.auth.windowMs,
      RATE_LIMIT_CONFIGS.public.windowMs
    );
    const cutoffTime = now - (2 * maxWindowMs);

    // Filter out old timestamps
    const recentTimestamps = entry.timestamps.filter((ts: number) => ts > cutoffTime);

    if (recentTimestamps.length === 0) {
      keysToDelete.push(key);
    } else {
      entry.timestamps = recentTimestamps;
    }
  }

  // Delete entries with no recent activity
  for (const key of keysToDelete) {
    rateLimitStore.delete(key);
  }
}, CLEANUP_INTERVAL);

/**
 * Create a rate limiting middleware with sliding window algorithm
 *
 * The sliding window algorithm:
 * 1. Removes timestamps older than the current window
 * 2. Checks if the number of remaining timestamps exceeds the limit
 * 3. If not exceeded, adds current timestamp and allows request
 * 4. Sets appropriate response headers
 *
 * @param config - Rate limit configuration with maxRequests and windowMs
 * @param keyFunction - Optional function to generate rate limit key from request
 * @returns Express middleware function
 */
export function createRateLimiter(
  config: RateLimitConfig,
  keyFunction?: KeyFunction
) {
  // Default key function uses IP address
  const getKey =
    keyFunction ||
    ((req: Request) => {
      const ip = req.ip || req.socket.remoteAddress || "unknown";
      return `ip:${ip}`;
    });

  return (req: Request, res: Response, next: NextFunction) => {
    const key = getKey(req);
    const now = Date.now();
    const windowStart = now - config.windowMs;

    // Get or create entry for this key
    let entry = rateLimitStore.get(key);
    if (!entry) {
      entry = { timestamps: [] };
      rateLimitStore.set(key, entry);
    }

    // Sliding window: remove timestamps outside the current window
    entry.timestamps = entry.timestamps.filter((ts) => ts > windowStart);

    // Check if limit is exceeded
    if (entry.timestamps.length >= config.maxRequests) {
      const oldestTimestamp = entry.timestamps[0];
      const resetTime = oldestTimestamp + config.windowMs;
      const retryAfterSeconds = Math.ceil((resetTime - now) / 1000);

      // Set standard rate limit response headers
      res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
      res.setHeader("X-RateLimit-Remaining", "0");
      res.setHeader(
        "X-RateLimit-Reset",
        Math.ceil(resetTime / 1000).toString()
      );
      res.setHeader("Retry-After", retryAfterSeconds.toString());

      return res.status(429).json({
        message: `Rate limit exceeded. Maximum ${config.maxRequests} requests per ${Math.round(config.windowMs / 1000)} seconds allowed.`,
        retryAfter: retryAfterSeconds,
      });
    }

    // Add current request timestamp
    entry.timestamps.push(now);

    // Calculate remaining requests and reset time
    const remaining = config.maxRequests - entry.timestamps.length;
    const oldestTimestamp = entry.timestamps[0];
    const resetTime = oldestTimestamp + config.windowMs;

    // Set rate limit headers for successful requests
    res.setHeader("X-RateLimit-Limit", config.maxRequests.toString());
    res.setHeader("X-RateLimit-Remaining", remaining.toString());
    res.setHeader("X-RateLimit-Reset", Math.ceil(resetTime / 1000).toString());

    next();
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
    const userId = user.claims?.sub || user.id;
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
export const aiLimiter = createAuthenticatedRateLimiter({ maxRequests: 30, windowMs: 60 * 1000 });
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
