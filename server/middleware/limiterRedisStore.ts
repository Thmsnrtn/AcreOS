/**
 * limiterRedisStore — Redis-backed Store for `express-rate-limit` lanes.
 *
 * Tier 1G (elevation blueprint 2026-06-10). The auth/signup limiter lanes in
 * server/index.ts use `express-rate-limit`, whose default MemoryStore is
 * per-process: on a multi-machine Fly deployment every machine grants the
 * full budget, so the effective limit is N× the intended one (and resets on
 * every deploy). This store enforces the budget in Redis — shared across
 * the whole process group — when REDIS_URL is configured, and degrades to
 * the stock MemoryStore per-instance behavior otherwise (same semantics as
 * the rest of the rate-limit stack, see server/middleware/rateLimit.ts).
 *
 * Algorithm: fixed window via INCR + PEXPIRE — identical to the Redis path
 * in rateLimit.ts so both stacks share operational characteristics. Fail
 * open per house rule: any Redis error falls back to the in-memory store
 * for that call (per-instance enforcement beats no enforcement).
 */

import { MemoryStore, type Store, type Options, type IncrementResponse } from "express-rate-limit";
import { getRedisClient } from "../utils/redis";
import { logger } from "../utils/logger";

/**
 * Pure backend-selection logic, exported for unit tests: Redis is used iff
 * REDIS_URL is configured. (Connection failures degrade per-call inside the
 * store — selection only looks at configuration.)
 */
export function limiterStoreBackend(env: { REDIS_URL?: string } = process.env): "redis" | "memory" {
  return env.REDIS_URL && env.REDIS_URL.trim().length > 0 ? "redis" : "memory";
}

export class ResilientRedisStore implements Store {
  /** Keys live in Redis — shared across instances. */
  localKeys = false;
  prefix: string;
  private windowMs = 60_000;
  private fallback = new MemoryStore();

  constructor(prefix: string) {
    this.prefix = `erl:${prefix}:`;
  }

  init(options: Options): void {
    this.windowMs = options.windowMs;
    this.fallback.init(options);
  }

  async increment(key: string): Promise<IncrementResponse> {
    const redis = await getRedisClient();
    if (!redis) return this.fallback.increment(key);
    try {
      const fullKey = this.prefix + key;
      const totalHits: number = await redis.incr(fullKey);
      if (totalHits === 1) {
        await redis.pexpire(fullKey, this.windowMs);
      }
      const pttl: number = await redis.pttl(fullKey);
      const resetTime = new Date(Date.now() + (pttl > 0 ? pttl : this.windowMs));
      return { totalHits, resetTime };
    } catch (err) {
      logger.warn("Redis limiter store increment failed — using in-memory fallback", {
        metadata: { prefix: this.prefix, error: err instanceof Error ? err.message : String(err) },
      });
      return this.fallback.increment(key);
    }
  }

  async decrement(key: string): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return this.fallback.decrement(key);
    try {
      await redis.decr(this.prefix + key);
    } catch {
      await this.fallback.decrement(key);
    }
  }

  async resetKey(key: string): Promise<void> {
    const redis = await getRedisClient();
    if (!redis) return this.fallback.resetKey(key);
    try {
      await redis.del(this.prefix + key);
    } catch {
      await this.fallback.resetKey(key);
    }
  }
}

/**
 * Store factory for an `express-rate-limit` lane. Returns a Redis-backed
 * store when REDIS_URL is configured; `undefined` otherwise so the limiter
 * uses its stock per-instance MemoryStore.
 */
export function createLimiterStore(prefix: string): Store | undefined {
  if (limiterStoreBackend() !== "redis") return undefined;
  return new ResilientRedisStore(prefix);
}
