/**
 * Invite-flow rate limits (Pelle G/H/I).
 *
 *   - Per-org invite CREATION: 100 / day  (24h sliding window)
 *   - Per-user invite ACCEPTANCE: 10 / hour
 *
 * Strategy mirrors middleware/rateLimit.ts: Redis sliding-window if
 * available, in-memory fallback otherwise. We don't reuse the Express
 * middleware here because the create endpoint accepts BULK invites in
 * one request — the limit is on number of invites issued, not requests.
 */

import { getRedisClient } from "../utils/redis";
import { logger } from "../utils/logger";

const INVITE_CREATE_LIMIT = 100; // invites per org per 24h
const INVITE_CREATE_WINDOW_MS = 24 * 60 * 60 * 1000;
const INVITE_ACCEPT_LIMIT = 10; // accept attempts per user per hour
const INVITE_ACCEPT_WINDOW_MS = 60 * 60 * 1000;

interface MemEntry {
  timestamps: number[];
}

const memStore = new Map<string, MemEntry>();

// Cleanup memory store hourly
setInterval(() => {
  const cutoff = Date.now() - Math.max(INVITE_CREATE_WINDOW_MS, INVITE_ACCEPT_WINDOW_MS) * 2;
  for (const [k, v] of memStore.entries()) {
    v.timestamps = v.timestamps.filter((t) => t > cutoff);
    if (v.timestamps.length === 0) memStore.delete(k);
  }
}, 60 * 60 * 1000).unref?.();

export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
  limit: number;
}

async function checkRedisCounter(
  redisKey: string,
  windowSeconds: number,
  limit: number,
  cost: number
): Promise<RateLimitDecision | null> {
  try {
    const redis = await getRedisClient();
    if (!redis) return null;
    const fullKey = `invite-rl:${redisKey}`;
    const next = await redis.incrby(fullKey, cost);
    if (next === cost) {
      await redis.expire(fullKey, windowSeconds);
    }
    const ttl = await redis.ttl(fullKey);
    const remaining = Math.max(0, limit - next);
    const allowed = next <= limit;
    return {
      allowed,
      remaining,
      retryAfterSeconds: allowed ? 0 : Math.max(1, ttl > 0 ? ttl : windowSeconds),
      limit,
    };
  } catch (err) {
    logger.warn("[inviteRateLimit] redis check failed — falling back to in-memory", {
      metadata: { error: (err as Error).message, redisKey },
    });
    return null;
  }
}

function checkMemoryCounter(
  key: string,
  windowMs: number,
  limit: number,
  cost: number
): RateLimitDecision {
  const now = Date.now();
  const cutoff = now - windowMs;
  const entry = memStore.get(key) ?? { timestamps: [] };
  entry.timestamps = entry.timestamps.filter((t) => t > cutoff);
  if (entry.timestamps.length + cost > limit) {
    const oldest = entry.timestamps[0] ?? now;
    const retryAfter = Math.max(1, Math.ceil((oldest + windowMs - now) / 1000));
    memStore.set(key, entry);
    return {
      allowed: false,
      remaining: Math.max(0, limit - entry.timestamps.length),
      retryAfterSeconds: retryAfter,
      limit,
    };
  }
  for (let i = 0; i < cost; i++) entry.timestamps.push(now);
  memStore.set(key, entry);
  return {
    allowed: true,
    remaining: Math.max(0, limit - entry.timestamps.length),
    retryAfterSeconds: 0,
    limit,
  };
}

/**
 * Reserve N invite-create slots for the given org. Default cost = 1; bulk
 * invite endpoints should pass the array length so the limit covers them
 * accurately rather than letting one request burn the whole quota.
 */
export async function checkInviteCreateLimit(
  organizationId: number,
  cost = 1
): Promise<RateLimitDecision> {
  const redisKey = `org:${organizationId}:create`;
  const memKey = `org:${organizationId}:create`;
  const windowSeconds = Math.ceil(INVITE_CREATE_WINDOW_MS / 1000);
  const redisResult = await checkRedisCounter(redisKey, windowSeconds, INVITE_CREATE_LIMIT, cost);
  return redisResult ?? checkMemoryCounter(memKey, INVITE_CREATE_WINDOW_MS, INVITE_CREATE_LIMIT, cost);
}

/**
 * Reserve one invite-accept attempt for the given user.
 */
export async function checkInviteAcceptLimit(userId: string): Promise<RateLimitDecision> {
  const redisKey = `user:${userId}:accept`;
  const memKey = `user:${userId}:accept`;
  const windowSeconds = Math.ceil(INVITE_ACCEPT_WINDOW_MS / 1000);
  const redisResult = await checkRedisCounter(redisKey, windowSeconds, INVITE_ACCEPT_LIMIT, 1);
  return redisResult ?? checkMemoryCounter(memKey, INVITE_ACCEPT_WINDOW_MS, INVITE_ACCEPT_LIMIT, 1);
}

// Test-only: clear in-memory counters between tests.
export function _resetInviteRateLimitMemory(): void {
  memStore.clear();
}

export const INVITE_CREATE_LIMITS = {
  limit: INVITE_CREATE_LIMIT,
  windowMs: INVITE_CREATE_WINDOW_MS,
};

export const INVITE_ACCEPT_LIMITS = {
  limit: INVITE_ACCEPT_LIMIT,
  windowMs: INVITE_ACCEPT_WINDOW_MS,
};
