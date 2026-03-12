/**
 * Redis Query Caching Layer — T1
 *
 * Wraps hot read paths (leads list, properties, dashboard stats, county GIS)
 * with a Redis-backed cache. Falls back to a simple in-memory Map when Redis
 * is not configured so local dev keeps working without changes.
 *
 * Usage:
 *   const data = await cache.get("leads:org:42") ?? (await fetchLeads());
 *   await cache.set("leads:org:42", data, { ttlSeconds: 120 });
 *   await cache.invalidate("leads:org:42");
 *   await cache.invalidatePattern("leads:org:42:*");
 */

import { log } from "../index";
import { redisCircuitBreaker } from "../utils/circuitBreaker";

const REDIS_URL = process.env.REDIS_URL;
const DEFAULT_TTL = 120; // 2 minutes

// ─── In-memory fallback ──────────────────────────────────────────────────────

interface MemEntry {
  value: string;
  expiresAt: number;
}

const memStore = new Map<string, MemEntry>();

function memGet(key: string): string | null {
  const entry = memStore.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    memStore.delete(key);
    return null;
  }
  return entry.value;
}

function memSet(key: string, value: string, ttlSeconds: number): void {
  memStore.set(key, { value, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function memDel(key: string): void {
  memStore.delete(key);
}

function memDelPattern(pattern: string): void {
  const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
  for (const key of memStore.keys()) {
    if (regex.test(key)) memStore.delete(key);
  }
}

// ─── Redis client (lazy init) ────────────────────────────────────────────────

let redisClient: any = null;

async function getRedis(): Promise<any> {
  if (!REDIS_URL) return null;
  if (redisClient) return redisClient;
  try {
    const IORedis = (await import("ioredis")).default;
    redisClient = new IORedis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
      lazyConnect: true,
    });
    redisClient.on("error", (err: Error) => {
      log(`Redis cache error: ${err.message}`, "cache");
    });
    await redisClient.connect().catch(() => {});
    log("Redis cache connected", "cache");
    return redisClient;
  } catch (err: any) {
    log(`Redis cache init failed: ${err.message} — falling back to in-memory`, "cache");
    redisClient = null;
    return null;
  }
}

// ─── Cache options ────────────────────────────────────────────────────────────

interface CacheSetOptions {
  ttlSeconds?: number;
}

// ─── Public API ──────────────────────────────────────────────────────────────

export const cache = {
  /**
   * Get a cached value. Returns null on miss or error.
   */
  async get<T = unknown>(key: string): Promise<T | null> {
    try {
      const redis = await getRedis();
      const raw = redis
        ? await redisCircuitBreaker.call<string | null>(() => redis.get(key))
        : memGet(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  },

  /**
   * Set a value. TTL defaults to 120s.
   */
  async set<T = unknown>(
    key: string,
    value: T,
    options: CacheSetOptions = {}
  ): Promise<void> {
    const ttl = options.ttlSeconds ?? DEFAULT_TTL;
    try {
      const serialized = JSON.stringify(value);
      const redis = await getRedis();
      if (redis) {
        await redisCircuitBreaker.call(() => redis.setex(key, ttl, serialized));
      } else {
        memSet(key, serialized, ttl);
      }
    } catch {
      // Cache write errors are non-fatal (incl. circuit open)
    }
  },

  /**
   * Invalidate a specific key.
   */
  async invalidate(key: string): Promise<void> {
    try {
      const redis = await getRedis();
      if (redis) {
        await redisCircuitBreaker.call(() => redis.del(key));
      } else {
        memDel(key);
      }
    } catch {}
  },

  /**
   * Invalidate all keys matching a glob pattern (e.g. "leads:org:42:*").
   * Uses SCAN + DEL on Redis to avoid blocking the server.
   */
  async invalidatePattern(pattern: string): Promise<void> {
    try {
      const redis = await getRedis();
      if (redis) {
        await redisCircuitBreaker.call(async () => {
          let cursor = "0";
          do {
            const [nextCursor, keys] = await redis.scan(
              cursor,
              "MATCH",
              pattern,
              "COUNT",
              100
            );
            cursor = nextCursor;
            if (keys.length > 0) {
              await redis.del(...keys);
            }
          } while (cursor !== "0");
        });
      } else {
        memDelPattern(pattern);
      }
    } catch {}
  },

  /**
   * Convenience: get-or-set pattern. Fetches from cache or calls fn, then caches.
   */
  async getOrSet<T = unknown>(
    key: string,
    fn: () => Promise<T>,
    options: CacheSetOptions = {}
  ): Promise<T> {
    const cached = await cache.get<T>(key);
    if (cached !== null) return cached;
    const value = await fn();
    await cache.set(key, value, options);
    return value;
  },
};

// ─── Cache key builders ───────────────────────────────────────────────────────

export const CacheKeys = {
  leads: (orgId: number, params = "") => `leads:org:${orgId}:${params}`,
  lead: (orgId: number, id: number) => `lead:org:${orgId}:${id}`,
  properties: (orgId: number, params = "") => `properties:org:${orgId}:${params}`,
  property: (orgId: number, id: number) => `property:org:${orgId}:${id}`,
  deals: (orgId: number, params = "") => `deals:org:${orgId}:${params}`,
  deal: (orgId: number, id: number) => `deal:org:${orgId}:${id}`,
  dashboardStats: (orgId: number) => `dashboard:stats:org:${orgId}`,
  countyGis: (state: string, county: string) => `county:gis:${state}:${county}`,
  organization: (orgId: number) => `organization:${orgId}`,
  teamMembers: (orgId: number) => `team:members:org:${orgId}`,
};

// TTL presets (seconds)
export const CacheTTL = {
  short: 60,       // 1 min — frequently changing data
  standard: 120,   // 2 min — default for most lists
  long: 300,       // 5 min — slow-changing data (org settings, team)
  veryLong: 3600,  // 1 hr — near-static data (county GIS endpoints)
};
