/**
 * Temporal Spine wiring (ruling #9 wave 3): the provider registry's cache
 * write path must, when its upsert REPLACES an existing provider_cache entry
 * for the same cacheKey, hand the previous + new payloads to
 * recordCategoryChanges with the point scopeRef ("lat,lng" @ 4dp) — and a
 * change-recording failure must never break the lookup.
 *
 * DB is mocked (this env has no DATABASE_URL) using the same drizzle-chain
 * stub pattern as providerRegistryStaleWhileRevalidate.test.ts, made
 * table-aware via getTableName so breaker-state selects don't interfere.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const h = vi.hoisted(() => ({
  prevRow: null as Record<string, unknown> | null,
  providerCacheSelectCount: 0,
}));

vi.mock("../../server/db", async () => {
  const { getTableName } = await import("drizzle-orm");
  return {
    db: {
      select: () => {
        let tableName = "";
        let ordered = false;
        const chain: any = {
          from(t: unknown) {
            tableName = getTableName(t as never);
            return chain;
          },
          where() {
            return chain;
          },
          orderBy() {
            ordered = true;
            return chain;
          },
          async limit() {
            if (tableName !== "provider_cache" || ordered) return [];
            h.providerCacheSelectCount += 1;
            // 1st non-ordered provider_cache select in a lookup = readCache
            // (fresh miss → live lookup runs); 2nd = writeCache's pre-upsert
            // read of what we previously knew.
            if (h.providerCacheSelectCount >= 2 && h.prevRow) return [h.prevRow];
            return [];
          },
        };
        return chain;
      },
      insert: () => ({
        values: () => {
          const p: any = Promise.resolve(undefined);
          p.onConflictDoUpdate = async () => undefined;
          p.onConflictDoNothing = () => ({ returning: async () => [] });
          p.returning = async () => [];
          return p;
        },
      }),
    },
  };
});

vi.mock("../../server/services/providerIntelligence", () => ({
  recordFreeMiss: vi.fn().mockResolvedValue(undefined),
  recordLookup: vi.fn().mockResolvedValue(undefined),
  getCategoryPerformance: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../server/services/openData/changeDetection", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../server/services/openData/changeDetection")
  >();
  return { ...actual, recordCategoryChanges: vi.fn().mockResolvedValue([]) };
});

const testInput = {
  type: "coordinates" as const,
  latitude: 33.448376,
  longitude: -112.074036,
};

function femaProvider(data: Record<string, unknown>) {
  return {
    name: "open-data",
    displayName: "Open Data",
    categories: ["flood_zone"],
    supportedInputTypes: ["coordinates"],
    tierRequired: "free",
    license: "public-domain-usgov",
    redistributable: "yes",
    costPerLookupCents: () => 0,
    isConfigured: async () => true,
    lookup: vi.fn().mockResolvedValue({
      provider: "open-data",
      category: "flood_zone",
      confidence: 90,
      costCents: 0,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 5,
      data,
      source: "FEMA NFHL", // redistributable → cache write path runs
      sourceAsOf: null,
      classification: "authoritative",
    }),
    healthCheck: async () => ({ healthy: true, latencyMs: 1, checkedAt: new Date() }),
  };
}

async function flushFireAndForget() {
  await new Promise((r) => setTimeout(r, 20));
}

describe("provider registry — Temporal Spine cache-replacement wiring", () => {
  let mod: typeof import("../../server/services/providers/provider-registry");
  // Re-resolved after each resetModules — the registry binds to the FRESH
  // mocked changeDetection instance, so the handle must come from the same
  // module registry generation.
  let recordCategoryChanges: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    h.prevRow = null;
    h.providerCacheSelectCount = 0;
    mod = await import("../../server/services/providers/provider-registry");
    const cd = await import("../../server/services/openData/changeDetection");
    recordCategoryChanges = cd.recordCategoryChanges as unknown as ReturnType<typeof vi.fn>;
  });

  it("diffs the replaced cache entry against the new result (point scopeRef @ 4dp)", async () => {
    h.prevRow = {
      provider: "open-data",
      category: "flood_zone",
      cacheKey: "irrelevant-here",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      responseData: {
        data: { zone: "Zone X", riskLevel: "low" },
        confidence: 90,
        source: "FEMA NFHL",
        sourceAsOf: "2025-06-01T00:00:00.000Z",
        classification: "authoritative",
      },
    };

    const { providerRegistry } = mod;
    providerRegistry.register("flood_zone", femaProvider({ zone: "Zone AE", riskLevel: "high" }) as any, 10);

    const result = await providerRegistry.lookup("flood_zone", testInput, "free", 1000);
    expect(result).not.toBeNull();
    await flushFireAndForget();

    expect(recordCategoryChanges).toHaveBeenCalledTimes(1);
    expect(recordCategoryChanges).toHaveBeenCalledWith({
      category: "flood_zone",
      scopeType: "point",
      scopeRef: "33.4484,-112.0740",
      previous: { zone: "Zone X", riskLevel: "low" },
      next: { zone: "Zone AE", riskLevel: "high" },
      previousAsOf: new Date("2025-06-01T00:00:00.000Z"),
      source: "FEMA NFHL",
    });
  });

  it("falls back to the cache row's createdAt when the previous entry has no sourceAsOf", async () => {
    h.prevRow = {
      provider: "open-data",
      category: "flood_zone",
      cacheKey: "irrelevant-here",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      responseData: {
        data: { zone: "Zone X", riskLevel: "low" },
        confidence: 90,
        source: "FEMA NFHL",
        sourceAsOf: null,
        classification: "authoritative",
      },
    };

    const { providerRegistry } = mod;
    providerRegistry.register("flood_zone", femaProvider({ zone: "Zone AE", riskLevel: "high" }) as any, 10);

    await providerRegistry.lookup("flood_zone", testInput, "free", 1000);
    await flushFireAndForget();

    expect(recordCategoryChanges).toHaveBeenCalledWith(
      expect.objectContaining({ previousAsOf: new Date("2026-01-01T00:00:00.000Z") }),
    );
  });

  it("records nothing on first sight (no existing cache entry to replace)", async () => {
    h.prevRow = null;

    const { providerRegistry } = mod;
    providerRegistry.register("flood_zone", femaProvider({ zone: "Zone AE", riskLevel: "high" }) as any, 10);

    const result = await providerRegistry.lookup("flood_zone", testInput, "free", 1000);
    expect(result).not.toBeNull();
    await flushFireAndForget();

    expect(recordCategoryChanges).not.toHaveBeenCalled();
  });

  it("a change-recording failure never breaks the lookup", async () => {
    recordCategoryChanges.mockRejectedValue(new Error("spine down"));
    h.prevRow = {
      provider: "open-data",
      category: "flood_zone",
      cacheKey: "irrelevant-here",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      expiresAt: new Date("2026-02-01T00:00:00.000Z"),
      responseData: {
        data: { zone: "Zone X", riskLevel: "low" },
        confidence: 90,
        source: "FEMA NFHL",
        sourceAsOf: null,
        classification: "authoritative",
      },
    };

    const { providerRegistry } = mod;
    providerRegistry.register("flood_zone", femaProvider({ zone: "Zone AE", riskLevel: "high" }) as any, 10);

    const result = await providerRegistry.lookup("flood_zone", testInput, "free", 1000);
    expect(result).not.toBeNull();
    expect(result!.data).toEqual({ zone: "Zone AE", riskLevel: "high" });
    await flushFireAndForget();
    expect(recordCategoryChanges).toHaveBeenCalled();
  });
});
