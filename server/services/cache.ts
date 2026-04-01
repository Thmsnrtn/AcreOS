import { logger } from "../utils/logger";
/**
 * Lightweight Redis cache utility.
 *
 * When REDIS_URL is set, caches values in Redis with a TTL.
 * Falls back to a no-op (always miss) when Redis is unavailable,
 * so callers work correctly in local dev without Redis.
 *
 * Usage:
 *   const cached = await cache.get<Lead[]>(`leads:${orgId}`);
 *   if (!cached) {
 *     const fresh = await expensiveQuery();
 *     await cache.set(`leads:${orgId}`, fresh, 300); // 5 min TTL
 *     return fresh;
 *   }
 *   return cached;
 */

interface CacheClient {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  delPattern(pattern: string): Promise<void>;
}

class NoopCache implements CacheClient {
  async get<T>(_key: string): Promise<T | null> { return null; }
  async set<T>(_key: string, _value: T, _ttl: number): Promise<void> {}
  async del(_key: string): Promise<void> {}
  async delPattern(_pattern: string): Promise<void> {}
}

class RedisCache implements CacheClient {
  private client: any;
  private readonly PREFIX = "acreos:";

  constructor(client: any) {
    this.client = client;
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(this.PREFIX + key);
      if (raw === null) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(this.PREFIX + key, JSON.stringify(value), "EX", ttlSeconds);
    } catch {
      // Non-fatal — cache miss on next read is acceptable
    }
  }

  async del(key: string): Promise<void> {
    try {
      await this.client.del(this.PREFIX + key);
    } catch {}
  }

  async delPattern(pattern: string): Promise<void> {
    try {
      const keys: string[] = await this.client.keys(this.PREFIX + pattern);
      if (keys.length > 0) {
        await this.client.del(...keys);
      }
    } catch {}
  }
}

let _cache: CacheClient | null = null;

async function initCache(): Promise<CacheClient> {
  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) {
    return new NoopCache();
  }
  try {
    const IORedis = (await import("ioredis")).default;
    const client = new IORedis(redisUrl, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
    });
    await client.connect();
    return new RedisCache(client);
  } catch (err) {
    logger.warn("[cache] Redis connection failed, falling back to no-op cache", { metadata: { detail: err } });
    return new NoopCache();
  }
}

/** Returns the singleton cache client (initializes lazily on first call). */
export async function getCache(): Promise<CacheClient> {
  if (!_cache) {
    _cache = await initCache();
  }
  return _cache;
}

/** TTL constants in seconds */
export const CACHE_TTL = {
  LEAD_SCORES: 5 * 60,        // 5 minutes
  ORG_SETTINGS: 10 * 60,      // 10 minutes
  CONVERSATIONS: 2 * 60,      // 2 minutes
} as const;
