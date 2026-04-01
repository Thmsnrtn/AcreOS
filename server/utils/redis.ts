/**
 * Shared Redis client utility.
 *
 * Provides a singleton Redis connection (via ioredis) used by rate limiting,
 * caching, and any other infrastructure that needs Redis.
 *
 * Gracefully degrades: if REDIS_URL is not set or connection fails, callers
 * receive `null` and must handle the fallback themselves.
 */

import { logger } from "./logger";

let redisClient: any | null = null;
let connectionAttempted = false;

/**
 * Returns the shared ioredis client, or `null` if Redis is unavailable.
 * The connection is established lazily on first call and reused thereafter.
 */
export async function getRedisClient(): Promise<any | null> {
  if (redisClient) return redisClient;
  if (connectionAttempted) return null; // Already tried and failed

  const url = process.env.REDIS_URL;
  if (!url) {
    logger.warn("REDIS_URL not set — features requiring Redis will use in-memory fallback", {});
    connectionAttempted = true;
    return null;
  }

  try {
    connectionAttempted = true;
    const IORedis = (await import("ioredis")).default;
    const client = new IORedis(url, {
      maxRetriesPerRequest: 3,
      enableOfflineQueue: false,
      lazyConnect: true,
      connectTimeout: 5000,
    });

    client.on("error", (err: Error) => {
      logger.error("Redis client error", { error: err.message });
    });

    client.on("close", () => {
      logger.warn("Redis connection closed", {});
      redisClient = null;
      connectionAttempted = false; // Allow reconnect on next call
    });

    await client.connect();
    logger.info("Redis connected for rate limiting and shared infra", {});
    redisClient = client;
    return redisClient;
  } catch (err) {
    logger.error("Failed to connect to Redis", {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
