/**
 * Limiter store selection + Redis-backed express-rate-limit store (Tier 1G).
 *
 * Pins:
 *   - limiterStoreBackend(): pure REDIS_URL-driven backend selection
 *   - createLimiterStore(): undefined (stock MemoryStore) without Redis,
 *     ResilientRedisStore with it
 *   - ResilientRedisStore: shared fixed-window INCR+PEXPIRE when Redis is
 *     live; in-memory fallback when the client is absent or a call throws
 *     (fail open — per-instance enforcement beats no enforcement).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Controllable fake Redis client. `current` is what getRedisClient resolves to.
const fakeRedis = vi.hoisted(() => {
  const counters = new Map<string, number>();
  const client = {
    incr: vi.fn(async (key: string) => {
      const v = (counters.get(key) ?? 0) + 1;
      counters.set(key, v);
      return v;
    }),
    pexpire: vi.fn(async (_key: string, _ms: number) => 1),
    pttl: vi.fn(async (_key: string) => 30_000),
    decr: vi.fn(async (key: string) => {
      const v = (counters.get(key) ?? 0) - 1;
      counters.set(key, v);
      return v;
    }),
    del: vi.fn(async (key: string) => {
      counters.delete(key);
      return 1;
    }),
  };
  return { counters, client, current: client as typeof client | null };
});

vi.mock("../../server/utils/redis", () => ({
  getRedisClient: vi.fn(async () => fakeRedis.current),
}));

import {
  limiterStoreBackend,
  createLimiterStore,
  ResilientRedisStore,
} from "../../server/middleware/limiterRedisStore";

describe("limiterStoreBackend — backend selection", () => {
  it("selects memory when REDIS_URL is absent", () => {
    expect(limiterStoreBackend({})).toBe("memory");
  });

  it("selects memory when REDIS_URL is empty/whitespace", () => {
    expect(limiterStoreBackend({ REDIS_URL: "" })).toBe("memory");
    expect(limiterStoreBackend({ REDIS_URL: "   " })).toBe("memory");
  });

  it("selects redis when REDIS_URL is configured", () => {
    expect(limiterStoreBackend({ REDIS_URL: "redis://placeholder.local:6379" })).toBe("redis");
  });
});

describe("createLimiterStore — factory", () => {
  const originalRedisUrl = process.env.REDIS_URL;

  afterEach(() => {
    if (originalRedisUrl === undefined) delete process.env.REDIS_URL;
    else process.env.REDIS_URL = originalRedisUrl;
  });

  it("returns undefined without REDIS_URL (limiter keeps stock MemoryStore)", () => {
    delete process.env.REDIS_URL;
    expect(createLimiterStore("auth")).toBeUndefined();
  });

  it("returns a ResilientRedisStore when REDIS_URL is configured", () => {
    process.env.REDIS_URL = "redis://placeholder.local:6379";
    const store = createLimiterStore("auth");
    expect(store).toBeInstanceOf(ResilientRedisStore);
    // Keys must be shared across instances, not per-process.
    expect(store!.localKeys).toBe(false);
  });
});

describe("ResilientRedisStore — increment paths", () => {
  let store: ResilientRedisStore;

  beforeEach(() => {
    fakeRedis.counters.clear();
    fakeRedis.current = fakeRedis.client;
    fakeRedis.client.incr.mockClear();
    fakeRedis.client.pexpire.mockClear();
    fakeRedis.client.pttl.mockClear();
    store = new ResilientRedisStore("auth");
    store.init({ windowMs: 60_000 } as never);
  });

  it("uses Redis INCR with a prefixed key and sets the window TTL on first hit", async () => {
    const res = await store.increment("user_123");
    expect(res.totalHits).toBe(1);
    expect(res.resetTime).toBeInstanceOf(Date);
    expect(fakeRedis.client.incr).toHaveBeenCalledWith("erl:auth:user_123");
    // First hit starts the fixed window.
    expect(fakeRedis.client.pexpire).toHaveBeenCalledWith("erl:auth:user_123", 60_000);

    const res2 = await store.increment("user_123");
    expect(res2.totalHits).toBe(2);
    // TTL is only set on the first hit of the window.
    expect(fakeRedis.client.pexpire).toHaveBeenCalledTimes(1);
  });

  it("falls back to the in-memory store when no Redis client is available", async () => {
    fakeRedis.current = null;
    const res = await store.increment("user_123");
    expect(res.totalHits).toBe(1);
    expect(fakeRedis.client.incr).not.toHaveBeenCalled();
    // Fallback still counts (per-instance enforcement).
    const res2 = await store.increment("user_123");
    expect(res2.totalHits).toBe(2);
  });

  it("falls back to the in-memory store when a Redis call throws (fail open)", async () => {
    fakeRedis.client.incr.mockRejectedValueOnce(new Error("connection reset"));
    const res = await store.increment("user_123");
    expect(res.totalHits).toBe(1); // served by MemoryStore, not an error
  });

  it("resetKey deletes the prefixed Redis key", async () => {
    await store.increment("user_123");
    await store.resetKey("user_123");
    expect(fakeRedis.client.del).toHaveBeenCalledWith("erl:auth:user_123");
  });
});
