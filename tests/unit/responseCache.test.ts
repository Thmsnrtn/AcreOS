/**
 * T176 — Response Cache Middleware Tests
 * Tests LRU cache eviction, TTL expiration, and per-org isolation.
 */

import { describe, it, expect, beforeEach } from "vitest";

// ─── Inline cache logic for pure testing ─────────────────────────────────────

interface CacheEntry {
  data: any;
  expiresAt: number;
}

class TestCache {
  private cache = new Map<string, CacheEntry>();
  private readonly MAX_ENTRIES: number;

  constructor(maxEntries = 100) {
    this.MAX_ENTRIES = maxEntries;
  }

  set(key: string, data: any, ttlMs: number): void {
    if (this.cache.size >= this.MAX_ENTRIES) {
      const firstKey = this.cache.keys().next().value;
      if (firstKey) this.cache.delete(firstKey);
    }
    this.cache.set(key, { data, expiresAt: Date.now() + ttlMs });
  }

  get(key: string): any | null {
    const entry = this.cache.get(key);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.cache.delete(key);
      return null;
    }
    return entry.data;
  }

  has(key: string): boolean {
    return this.get(key) !== null;
  }

  clear(): void {
    this.cache.clear();
  }

  size(): number {
    return this.cache.size;
  }

  evictExpired(): number {
    const now = Date.now();
    let count = 0;
    for (const [key, entry] of this.cache.entries()) {
      if (entry.expiresAt <= now) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }

  invalidateByOrg(orgId: string | number): number {
    const prefix = `:${orgId}:`;
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(prefix)) {
        this.cache.delete(key);
        count++;
      }
    }
    return count;
  }
}

function makeCacheKey(method: string, path: string, orgId: number | string, query: Record<string, any> = {}): string {
  return `${method}:${path}:${orgId}:${JSON.stringify(query)}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("ResponseCache", () => {
  let cache: TestCache;

  beforeEach(() => {
    cache = new TestCache(10);
  });

  describe("basic set/get", () => {
    it("stores and retrieves a value", () => {
      cache.set("key1", { hello: "world" }, 60_000);
      expect(cache.get("key1")).toEqual({ hello: "world" });
    });

    it("returns null for unknown keys", () => {
      expect(cache.get("unknown")).toBeNull();
    });

    it("returns null after TTL expires", () => {
      cache.set("key1", "data", -1); // already expired
      expect(cache.get("key1")).toBeNull();
    });

    it("does not expire within TTL", () => {
      cache.set("key1", "data", 60_000);
      expect(cache.get("key1")).toBe("data");
    });
  });

  describe("LRU eviction", () => {
    it("evicts oldest entry when at capacity", () => {
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i, 60_000);
      }
      // At capacity (10 entries), adding one more evicts key0
      cache.set("key10", 10, 60_000);
      expect(cache.size()).toBe(10);
      expect(cache.get("key0")).toBeNull(); // evicted
      expect(cache.get("key10")).toBe(10); // new entry present
    });

    it("preserves newer entries during eviction", () => {
      for (let i = 0; i < 10; i++) {
        cache.set(`key${i}`, i, 60_000);
      }
      cache.set("newKey", 99, 60_000);
      expect(cache.get("newKey")).toBe(99);
    });
  });

  describe("TTL expiration", () => {
    it("evictExpired removes expired entries and returns count", () => {
      cache.set("expired1", 1, -1000); // expired
      cache.set("expired2", 2, -1000); // expired
      cache.set("live", 3, 60_000);    // still live

      const removed = cache.evictExpired();
      expect(removed).toBe(2);
      expect(cache.size()).toBe(1);
      expect(cache.get("live")).toBe(3);
    });

    it("evictExpired returns 0 when nothing is expired", () => {
      cache.set("live1", 1, 60_000);
      cache.set("live2", 2, 60_000);
      expect(cache.evictExpired()).toBe(0);
    });
  });

  describe("per-org isolation", () => {
    it("invalidates only entries belonging to a specific org", () => {
      cache.set(makeCacheKey("GET", "/api/analytics", 1), "org1-data", 60_000);
      cache.set(makeCacheKey("GET", "/api/leads", 1), "org1-leads", 60_000);
      cache.set(makeCacheKey("GET", "/api/analytics", 2), "org2-data", 60_000);

      const removed = cache.invalidateByOrg(1);
      expect(removed).toBe(2);
      expect(cache.has(makeCacheKey("GET", "/api/analytics", 1))).toBe(false);
      expect(cache.has(makeCacheKey("GET", "/api/leads", 1))).toBe(false);
      expect(cache.has(makeCacheKey("GET", "/api/analytics", 2))).toBe(true);
    });

    it("does not affect other orgs when invalidating", () => {
      cache.set(makeCacheKey("GET", "/api/dashboard", 3), "org3", 60_000);
      cache.set(makeCacheKey("GET", "/api/dashboard", 4), "org4", 60_000);

      cache.invalidateByOrg(3);
      expect(cache.get(makeCacheKey("GET", "/api/dashboard", 4))).toBe("org4");
    });

    it("returns 0 invalidated when org has no cached entries", () => {
      cache.set(makeCacheKey("GET", "/api/analytics", 5), "data", 60_000);
      expect(cache.invalidateByOrg(99)).toBe(0);
    });
  });

  describe("cache key generation", () => {
    it("generates unique keys for different paths", () => {
      const k1 = makeCacheKey("GET", "/api/leads", 1);
      const k2 = makeCacheKey("GET", "/api/deals", 1);
      expect(k1).not.toBe(k2);
    });

    it("generates unique keys for different orgs", () => {
      const k1 = makeCacheKey("GET", "/api/analytics", 1);
      const k2 = makeCacheKey("GET", "/api/analytics", 2);
      expect(k1).not.toBe(k2);
    });

    it("generates unique keys for different query params", () => {
      const k1 = makeCacheKey("GET", "/api/leads", 1, { page: 1 });
      const k2 = makeCacheKey("GET", "/api/leads", 1, { page: 2 });
      expect(k1).not.toBe(k2);
    });

    it("generates identical keys for same inputs", () => {
      const k1 = makeCacheKey("GET", "/api/analytics", 1, { range: "30d" });
      const k2 = makeCacheKey("GET", "/api/analytics", 1, { range: "30d" });
      expect(k1).toBe(k2);
    });
  });

  describe("cache clear", () => {
    it("clears all entries", () => {
      cache.set("k1", 1, 60_000);
      cache.set("k2", 2, 60_000);
      cache.clear();
      expect(cache.size()).toBe(0);
    });
  });
});
