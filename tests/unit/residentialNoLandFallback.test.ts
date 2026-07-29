/**
 * No-silent-land-fallback pin — wave V3 of founder ruling #11.
 *
 * The provider registry's ladder sorts candidates free → starter → pro, so
 * for the "comps"/"valuation" categories Regrid (starter, LAND-parcel data:
 * its comps case delegates to the land radius search, its valuation to the
 * land parcel lookup) is tried BEFORE ATTOM (pro, house data). The free tier
 * registers NO comps/valuation provider at all (county-gis: parcel_data +
 * owner_info; open-data: parcel_data + broker categories) — verified against
 * providers-init.ts.
 *
 * These tests pin BOTH sides of that fact against the REAL registry:
 *   1. unrestricted lookup → the land-oriented starter provider wins
 *      (this IS the silent land fallback — the reason the residential seam
 *      must restrict candidates);
 *   2. `allowProviders: ["attom"]` → only the residential-capable provider
 *      runs; the land provider is never invoked.
 */
import { describe, it, expect, vi, beforeAll } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Chainable no-op db: cache reads resolve empty, cache writes resolve.
vi.mock("../../server/db", () => {
  const limit = async () => [];
  const orderBy = () => ({ limit });
  const where = () => ({ limit, orderBy });
  const from = () => ({ where, limit });
  return {
    db: {
      select: () => ({ from }),
      insert: () => ({
        values: () => ({ onConflictDoUpdate: async () => undefined }),
      }),
    },
  };
});

vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: async () => new Set<string>(),
  resolveDataProviderKey: async () => null,
}));

vi.mock("../../server/services/providerIntelligence", () => ({
  recordLookup: async () => undefined,
  recordFreeMiss: async () => undefined,
  getCategoryPerformance: async () => new Map(),
}));

vi.mock("../../server/services/openData/changeDetection", () => ({
  recordCategoryChanges: async () => undefined,
  pointScopeRef: () => "point:0,0",
}));

vi.mock("../../server/services/providers/circuit-breaker", () => ({
  ProviderCircuitBreaker: class {
    async shouldAllow() {
      return { allowed: true, halfOpenProbe: false };
    }
    recordSuccess() {}
    recordFailure() {}
    snapshot() {
      return { failures: 0, open: false };
    }
  },
}));

vi.mock("../../server/services/providers/circuit-breaker-store", () => ({
  dbBreakerStore: {},
}));

vi.mock("../../server/services/creditPool", () => ({
  poolDebit: vi.fn(async () => ({ allowed: true, debitedCents: 0 })),
}));

import { providerRegistry } from "../../server/services/providers/provider-registry";
import type { DataProvider, LookupInput } from "../../server/services/providers/types";

const INPUT: LookupInput = { type: "coordinates", latitude: 33.4484, longitude: -112.074 };

function fakeProvider(
  name: string,
  tier: "free" | "starter" | "pro",
  costCents: number,
  source: string,
  data: unknown,
): DataProvider & { lookup: ReturnType<typeof vi.fn> } {
  return {
    name,
    displayName: name,
    categories: ["comps", "valuation"],
    supportedInputTypes: ["coordinates", "address"],
    tierRequired: tier,
    license: "proprietary",
    redistributable: "no",
    minMonthlyCommitCents: 0,
    costPerLookupCents: () => costCents,
    isConfigured: async () => true,
    lookup: vi.fn(async (category) => ({
      provider: name,
      category,
      confidence: 80,
      costCents,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 1,
      data,
      source,
      sourceAsOf: null,
      classification: "authoritative" as const,
    })),
    healthCheck: async () => ({ healthy: true, latencyMs: 0, checkedAt: new Date() }),
  };
}

// Mirror the real registrations for comps/valuation (providers-init.ts):
// regrid at starter/priority 30 serving LAND data, attom at pro/priority 50
// serving HOUSE data. Registered once on the module singleton.
const landRegrid = fakeProvider("regrid", "starter", 8, "Regrid", { landParcelComps: true });
const houseAttom = fakeProvider("attom", "pro", 20, "ATTOM Data", { property: [] });

beforeAll(() => {
  providerRegistry.register("comps", landRegrid, 30);
  providerRegistry.register("comps", houseAttom, 50);
});

describe("registry ladder without restriction (the documented hazard)", () => {
  it("tries the LAND-oriented starter provider first — the silent land fallback the seam exists to prevent", async () => {
    landRegrid.lookup.mockClear();
    houseAttom.lookup.mockClear();

    const result = await providerRegistry.lookup("comps", INPUT, "pro", 1000);
    expect(result?.provider).toBe("regrid"); // land data would win under a house label
    expect(landRegrid.lookup).toHaveBeenCalledTimes(1);
    expect(houseAttom.lookup).not.toHaveBeenCalled();
  });
});

describe("allowProviders restriction (the residential seam contract)", () => {
  it("['attom'] → only the residential-capable provider runs; the land provider is NEVER invoked", async () => {
    landRegrid.lookup.mockClear();
    houseAttom.lookup.mockClear();

    const result = await providerRegistry.lookup("comps", INPUT, "pro", 1000, undefined, {
      allowProviders: ["attom"],
    });
    expect(result?.provider).toBe("attom");
    expect(result?.source).toBe("ATTOM Data");
    expect(landRegrid.lookup).not.toHaveBeenCalled();
    expect(houseAttom.lookup).toHaveBeenCalledTimes(1);
  });

  it("['attom'] with attom unable to serve → null (honest miss), still no land fallback", async () => {
    landRegrid.lookup.mockClear();
    houseAttom.lookup.mockClear();
    houseAttom.lookup.mockRejectedValueOnce(new Error("ATTOM API error: 502"));

    const result = await providerRegistry.lookup("comps", INPUT, "pro", 1000, undefined, {
      allowProviders: ["attom"],
    });
    expect(result).toBeNull();
    expect(landRegrid.lookup).not.toHaveBeenCalled();
  });

  it("free tier registers no comps provider at all — the 'free fallback' for comps is an honest null", async () => {
    landRegrid.lookup.mockClear();
    houseAttom.lookup.mockClear();

    // Both fakes require starter/pro, mirroring production where NO free
    // provider registers comps/valuation (county-gis + open-data don't).
    const result = await providerRegistry.lookup("comps", INPUT, "free", 1000);
    expect(result).toBeNull();
    expect(landRegrid.lookup).not.toHaveBeenCalled();
    expect(houseAttom.lookup).not.toHaveBeenCalled();
  });
});
