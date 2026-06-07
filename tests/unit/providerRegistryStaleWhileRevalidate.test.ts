/**
 * Stale-while-revalidate + free-miss telemetry (Iris/Quinn/Lena lenses).
 *
 * When every candidate provider is unavailable (live failure / circuit open),
 * the registry must serve the freshest EXPIRED cache flagged `stale: true`
 * rather than returning null — a FEMA outage should degrade to "as-of date"
 * data, not a blank card. And a genuine free-stack miss must record a
 * free-miss-by-county signal so the eventual paid-data buy is data-driven.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Mutable handles so each test can program the db + telemetry behavior.
const dbState: {
  freshRow: any | null;
  staleRow: any | null;
} = { freshRow: null, staleRow: null };

let staleReadCount = 0;

// Minimal drizzle-query stub. readCache() filters expiresAt > now (fresh);
// readStaleCache() filters expiresAt <= now ordered desc (stale). We can't see
// the WHERE clause from here, so we distinguish by call order: the registry
// calls readCache (fresh) on the happy path, and readStaleCache only in the
// failure/ circuit-open branches via .orderBy(). We model that by returning
// freshRow from a plain select chain, and staleRow from a chain that calls
// .orderBy().
function makeSelectChain() {
  const chain: any = {
    _ordered: false,
    from() {
      return chain;
    },
    where() {
      return chain;
    },
    orderBy() {
      chain._ordered = true;
      return chain;
    },
    async limit() {
      if (chain._ordered) {
        staleReadCount += 1;
        return dbState.staleRow ? [dbState.staleRow] : [];
      }
      return dbState.freshRow ? [dbState.freshRow] : [];
    },
  };
  return chain;
}

vi.mock("../../server/db", () => ({
  db: {
    select: () => makeSelectChain(),
    insert: () => ({
      values: () => ({
        onConflictDoUpdate: async () => undefined,
        onConflictDoNothing: () => ({ returning: async () => [] }),
        returning: async () => [],
      }),
    }),
  },
}));

const recordFreeMiss = vi.fn().mockResolvedValue(undefined);
const recordLookup = vi.fn().mockResolvedValue(undefined);
vi.mock("../../server/services/providerIntelligence", () => ({
  recordFreeMiss,
  recordLookup,
  getCategoryPerformance: vi.fn().mockResolvedValue(new Map()),
}));

const testInput = {
  type: "coordinates" as const,
  latitude: 30.1,
  longitude: -97.7,
  state: "TX",
  county: "Travis",
};

function failingFreeProvider(name = "free-fail") {
  return {
    name,
    displayName: name,
    categories: ["parcel_data"],
    supportedInputTypes: ["coordinates"],
    tierRequired: "free",
    license: "county-tos",
    redistributable: "review-required",
    costPerLookupCents: () => 0,
    isConfigured: async () => true,
    lookup: vi.fn().mockRejectedValue(new Error("upstream down")),
    healthCheck: async () => ({ healthy: false, latencyMs: 0, checkedAt: new Date() }),
  };
}

describe("stale-while-revalidate", () => {
  let mod: typeof import("../../server/services/providers/provider-registry");

  beforeEach(async () => {
    vi.resetModules();
    vi.clearAllMocks();
    dbState.freshRow = null;
    dbState.staleRow = null;
    staleReadCount = 0;
    mod = await import("../../server/services/providers/provider-registry");
  });

  it("serves expired cache flagged stale when the live provider fails", async () => {
    dbState.staleRow = {
      provider: "open-data",
      category: "parcel_data",
      createdAt: new Date("2026-01-01"),
      responseData: {
        data: { apn: "123" },
        confidence: 80,
        source: "FEMA NFHL",
        sourceAsOf: "2024-08-01T00:00:00.000Z",
        classification: "authoritative",
      },
    };

    const { providerRegistry } = mod;
    providerRegistry.register("parcel_data", failingFreeProvider() as any, 10);

    const result = await providerRegistry.lookup("parcel_data", testInput, "free", 1000);
    expect(result).not.toBeNull();
    expect(result!.stale).toBe(true);
    expect(result!.cached).toBe(true);
    expect(result!.source).toBe("FEMA NFHL");
    expect(result!.sourceAsOf).toEqual(new Date("2024-08-01T00:00:00.000Z"));
    expect(staleReadCount).toBeGreaterThan(0);
  });

  it("records a free-miss-by-county signal on a genuine free-stack miss", async () => {
    // No stale row, free provider fails → genuine miss.
    dbState.staleRow = null;
    const { providerRegistry } = mod;
    providerRegistry.register("parcel_data", failingFreeProvider("free-miss-p") as any, 10);

    const result = await providerRegistry.lookup("parcel_data", testInput, "free", 1000);
    expect(result).toBeNull();
    // Allow the fire-and-forget dynamic import to resolve.
    await new Promise((r) => setTimeout(r, 0));
    expect(recordFreeMiss).toHaveBeenCalledWith(
      expect.objectContaining({ category: "parcel_data", state: "TX", county: "Travis" }),
    );
  });
});
