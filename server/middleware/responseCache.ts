/**
 * T171 — Response Cache Middleware
 *
 * Simple in-memory LRU cache for GET API responses.
 * Reduces DB load for repeated reads of semi-static data
 * (dashboard stats, market metrics, analytics).
 *
 * Usage:
 *   import { cacheResponse } from "./middleware/responseCache";
 *   app.get("/api/analytics/executive", isAuthenticated, cacheResponse(60), handler);
 *
 * The cache key is: `${req.method}:${req.path}:${orgId}:${JSON.stringify(req.query)}`
 * Cache entries are scoped per org so cross-org leakage is impossible.
 */

import type { Request, Response, NextFunction } from "express";

interface CacheEntry {
  data: any;
  expiresAt: number;
}

// Bounded LRU cache: max 500 entries to prevent unbounded memory growth
const MAX_ENTRIES = 500;
const cache = new Map<string, CacheEntry>();

// Task #196: Cache stampede prevention — track in-flight requests per cache key.
// When multiple concurrent requests arrive for the same uncached key,
// only the first triggers the underlying computation; the rest wait for its result.
const inFlight = new Map<string, Promise<any>>();

function evictExpiredEntries(): void {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (entry.expiresAt <= now) {
      cache.delete(key);
    }
  }
}

function evictOldestEntries(): void {
  // Delete the first (oldest) entries until we're under the limit
  const excess = cache.size - MAX_ENTRIES;
  if (excess <= 0) return;
  let removed = 0;
  for (const key of cache.keys()) {
    cache.delete(key);
    removed++;
    if (removed >= excess) break;
  }
}

/**
 * cacheResponse(ttlSeconds)
 * Returns a middleware that caches GET responses for the given TTL.
 */
export function cacheResponse(ttlSeconds: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    // Only cache GET requests
    if (req.method !== "GET") {
      next();
      return;
    }

    const orgId = (req as any).organization?.id ?? "anon";
    const cacheKey = `${req.method}:${req.path}:${orgId}:${JSON.stringify(req.query)}`;

    // Evict expired entries periodically (every 100 requests)
    if (Math.random() < 0.01) {
      evictExpiredEntries();
    }

    const entry = cache.get(cacheKey);
    if (entry && entry.expiresAt > Date.now()) {
      res.setHeader("X-Cache", "HIT");
      res.json(entry.data);
      return;
    }

    // Task #196: Stampede prevention — if another request is already computing
    // this cache entry, wait for it instead of duplicating the work.
    const existing = inFlight.get(cacheKey);
    if (existing) {
      res.setHeader("X-Cache", "COALESCED");
      existing.then((data) => {
        if (!res.headersSent) res.json(data);
      }).catch(() => {
        if (!res.headersSent) next();
      });
      return;
    }

    // Create a deferred promise that resolves when res.json is called
    let resolveInFlight: (data: any) => void;
    let rejectInFlight: (err: any) => void;
    const inFlightPromise = new Promise<any>((resolve, reject) => {
      resolveInFlight = resolve;
      rejectInFlight = reject;
    });
    inFlight.set(cacheKey, inFlightPromise);

    // Intercept res.json to capture the response
    const originalJson = res.json.bind(res);
    res.json = (data: any) => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        cache.set(cacheKey, {
          data,
          expiresAt: Date.now() + ttlSeconds * 1000,
        });
        if (cache.size > MAX_ENTRIES) {
          evictOldestEntries();
        }
        resolveInFlight!(data);
      } else {
        rejectInFlight!(new Error(`Non-cacheable status ${res.statusCode}`));
      }
      inFlight.delete(cacheKey);
      res.setHeader("X-Cache", "MISS");
      return originalJson(data);
    };

    // Clean up in-flight entry if the request errors without calling res.json
    res.on("close", () => {
      if (inFlight.has(cacheKey)) {
        inFlight.delete(cacheKey);
        rejectInFlight!(new Error("Connection closed"));
      }
    });

    next();
  };
}

/**
 * invalidateOrgCache(orgId)
 * Clears all cache entries for a specific organization.
 * Call this after mutations that modify org data.
 */
export function invalidateOrgCache(orgId: number | string): void {
  const prefix = `:${orgId}:`;
  for (const key of cache.keys()) {
    if (key.includes(prefix)) {
      cache.delete(key);
    }
  }
}

/**
 * clearAllCache()
 * Clears the entire cache. Useful for testing or admin operations.
 */
export function clearAllCache(): void {
  cache.clear();
}

/**
 * getCacheStats()
 * Returns cache statistics for monitoring.
 */
export function getCacheStats(): {
  size: number;
  maxSize: number;
  fillPercent: number;
} {
  return {
    size: cache.size,
    maxSize: MAX_ENTRIES,
    fillPercent: Math.round((cache.size / MAX_ENTRIES) * 100),
  };
}
