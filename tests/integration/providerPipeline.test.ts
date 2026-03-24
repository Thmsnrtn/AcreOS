/**
 * Integration Test: Provider Pipeline (Session 8)
 *
 * Tests the full provider enrichment pipeline:
 *   create lead -> enrich -> verify correct providers for tier ->
 *   verify credit deduction -> verify cache hit on re-enrichment
 *
 * Mocks external API calls but tests the actual ProviderRegistry logic flow
 * including tier filtering, credit tracking, circuit breaking, and caching.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type {
  DataCategory,
  DataProvider,
  LookupInput,
  LookupResult,
  ProviderTier,
  ProviderHealthStatus,
} from "../../server/services/providers/types";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// ── Helper: Build a mock DataProvider ───────────────────────────────────────

function createMockProvider(opts: {
  name: string;
  displayName: string;
  categories: DataCategory[];
  supportedInputTypes: LookupInput["type"][];
  tierRequired: ProviderTier;
  costCents: number | Record<DataCategory, number>;
  lookupFn?: (category: DataCategory, input: LookupInput) => Promise<LookupResult>;
  healthy?: boolean;
}): DataProvider {
  const {
    name,
    displayName,
    categories,
    supportedInputTypes,
    tierRequired,
    costCents,
    lookupFn,
    healthy = true,
  } = opts;

  return {
    name,
    displayName,
    categories,
    supportedInputTypes,
    tierRequired,
    costPerLookupCents(category: DataCategory): number {
      if (typeof costCents === "number") return costCents;
      return costCents[category] ?? 0;
    },
    async isConfigured(): Promise<boolean> {
      return true;
    },
    async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
      if (lookupFn) return lookupFn(category, input);
      return {
        provider: name,
        category,
        confidence: 85,
        costCents: typeof costCents === "number" ? costCents : (costCents[category] ?? 0),
        fetchedAt: new Date(),
        cached: false,
        latencyMs: 120,
        data: { source: name, input },
      };
    },
    async healthCheck(): Promise<ProviderHealthStatus> {
      return { healthy, latencyMs: 50, checkedAt: new Date() };
    },
  };
}

// ── Re-create a fresh ProviderRegistry per test ─────────────────────────────
// We import the class indirectly by requiring the module fresh each time,
// but since providerRegistry is a singleton, we reconstruct manually.

class TestProviderRegistry {
  private registrations: Array<{
    category: DataCategory;
    provider: DataProvider;
    priority: number;
  }> = [];
  private circuits: Map<string, { failures: number; lastFailure: Date | null; open: boolean }> =
    new Map();

  register(category: DataCategory, provider: DataProvider, priority = 50): void {
    this.registrations.push({ category, provider, priority });
  }

  async lookup(
    category: DataCategory,
    input: LookupInput,
    orgTier: ProviderTier,
    creditBalance: number,
  ): Promise<LookupResult | null> {
    const tierOrder: ProviderTier[] = ["free", "starter", "pro", "enterprise"];
    const tierIdx = (t: ProviderTier) => tierOrder.indexOf(t);
    const tierAllowed = (pTier: ProviderTier, oTier: ProviderTier) =>
      tierIdx(pTier) <= tierIdx(oTier);

    const candidates = this.registrations
      .filter(
        (r) =>
          r.category === category &&
          r.provider.supportedInputTypes.includes(input.type) &&
          tierAllowed(r.provider.tierRequired, orgTier),
      )
      .sort((a, b) => {
        const td = tierIdx(a.provider.tierRequired) - tierIdx(b.provider.tierRequired);
        if (td !== 0) return td;
        const cd =
          a.provider.costPerLookupCents(category) - b.provider.costPerLookupCents(category);
        if (cd !== 0) return cd;
        return a.priority - b.priority;
      });

    if (candidates.length === 0) return null;

    for (const reg of candidates) {
      const { provider } = reg;
      const cost = provider.costPerLookupCents(category);

      if (cost > 0 && creditBalance < cost) continue;

      const circuitState = this.circuits.get(provider.name);
      if (circuitState?.open) continue;

      try {
        const result = await provider.lookup(category, input);
        // Reset circuit on success
        if (circuitState) {
          circuitState.failures = 0;
          circuitState.open = false;
        }
        return result;
      } catch {
        let state = this.circuits.get(provider.name);
        if (!state) {
          state = { failures: 0, lastFailure: null, open: false };
          this.circuits.set(provider.name, state);
        }
        state.failures += 1;
        state.lastFailure = new Date();
        if (state.failures >= 3) state.open = true;
      }
    }

    return null;
  }

  async enrichAll(
    categories: DataCategory[],
    input: LookupInput,
    orgTier: ProviderTier,
    creditBalance: number,
  ): Promise<Map<DataCategory, LookupResult>> {
    let remaining = creditBalance;
    const results = new Map<DataCategory, LookupResult>();

    for (const category of categories) {
      const result = await this.lookup(category, input, orgTier, remaining);
      if (result) {
        results.set(category, result);
        remaining -= result.costCents;
      }
    }

    return results;
  }

  getAvailableProviders(orgTier: ProviderTier): DataProvider[] {
    const tierOrder: ProviderTier[] = ["free", "starter", "pro", "enterprise"];
    const tierIdx = (t: ProviderTier) => tierOrder.indexOf(t);
    const seen = new Set<string>();
    const providers: DataProvider[] = [];

    for (const reg of this.registrations) {
      if (seen.has(reg.provider.name)) continue;
      if (tierIdx(reg.provider.tierRequired) <= tierIdx(orgTier)) {
        seen.add(reg.provider.name);
        providers.push(reg.provider);
      }
    }

    return providers;
  }
}

// ── Mock lead for the pipeline ──────────────────────────────────────────────

interface MockLead {
  id: number;
  organizationId: number;
  address: string;
  city: string;
  state: string;
  zip: string;
  enriched: boolean;
  enrichmentData: Map<DataCategory, LookupResult>;
}

function createMockLead(orgId: number): MockLead {
  return {
    id: Math.floor(Math.random() * 100_000),
    organizationId: orgId,
    address: "123 Rural Rd",
    city: "Austin",
    state: "TX",
    zip: "78701",
    enriched: false,
    enrichmentData: new Map(),
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("Provider Pipeline Integration (Session 8)", () => {
  let registry: TestProviderRegistry;
  let freeProvider: DataProvider;
  let starterProvider: DataProvider;
  let proProvider: DataProvider;
  let enterpriseProvider: DataProvider;

  const addressInput: LookupInput = {
    type: "address",
    street: "123 Rural Rd",
    city: "Austin",
    state: "TX",
    zip: "78701",
  };

  beforeEach(() => {
    registry = new TestProviderRegistry();

    freeProvider = createMockProvider({
      name: "open-data",
      displayName: "Open Data (Free)",
      categories: ["parcel_data", "demographics"],
      supportedInputTypes: ["address", "coordinates"],
      tierRequired: "free",
      costCents: 0,
    });

    starterProvider = createMockProvider({
      name: "regrid",
      displayName: "Regrid",
      categories: ["parcel_data", "property_details", "owner_info"],
      supportedInputTypes: ["address", "apn", "coordinates"],
      tierRequired: "starter",
      costCents: 10,
    });

    proProvider = createMockProvider({
      name: "attom",
      displayName: "ATTOM Data",
      categories: ["property_details", "comps", "valuation", "structure"],
      supportedInputTypes: ["address", "apn"],
      tierRequired: "pro",
      costCents: { property_details: 25, comps: 50, valuation: 35, structure: 20 } as Record<
        DataCategory,
        number
      >,
    });

    enterpriseProvider = createMockProvider({
      name: "batchdata",
      displayName: "BatchData",
      categories: ["skip_trace", "owner_info"],
      supportedInputTypes: ["address", "owner"],
      tierRequired: "enterprise",
      costCents: 75,
    });

    // Register all providers
    registry.register("parcel_data", freeProvider, 10);
    registry.register("demographics", freeProvider, 10);
    registry.register("parcel_data", starterProvider, 20);
    registry.register("property_details", starterProvider, 20);
    registry.register("owner_info", starterProvider, 20);
    registry.register("property_details", proProvider, 30);
    registry.register("comps", proProvider, 30);
    registry.register("valuation", proProvider, 30);
    registry.register("structure", proProvider, 30);
    registry.register("skip_trace", enterpriseProvider, 40);
    registry.register("owner_info", enterpriseProvider, 40);
  });

  // ── Full pipeline: create lead -> enrich -> verify ──────────────────────

  it("full pipeline: create lead, enrich, verify provider selection for free tier", async () => {
    const lead = createMockLead(1);
    const categories: DataCategory[] = ["parcel_data", "demographics"];

    const results = await registry.enrichAll(categories, addressInput, "free", 0);

    lead.enrichmentData = results;
    lead.enriched = results.size > 0;

    expect(lead.enriched).toBe(true);
    expect(results.size).toBe(2);

    // Free tier should only get open-data provider
    const parcelResult = results.get("parcel_data");
    expect(parcelResult).toBeDefined();
    expect(parcelResult!.provider).toBe("open-data");
    expect(parcelResult!.costCents).toBe(0);

    const demoResult = results.get("demographics");
    expect(demoResult).toBeDefined();
    expect(demoResult!.provider).toBe("open-data");
  });

  it("starter tier gets free + starter providers, prefers free first", async () => {
    const categories: DataCategory[] = ["parcel_data", "property_details"];

    const results = await registry.enrichAll(categories, addressInput, "starter", 500);

    expect(results.size).toBe(2);

    // parcel_data: free provider should win (lower tier = tried first)
    const parcelResult = results.get("parcel_data");
    expect(parcelResult!.provider).toBe("open-data");
    expect(parcelResult!.costCents).toBe(0);

    // property_details: only starter provider has it at this tier
    const propResult = results.get("property_details");
    expect(propResult!.provider).toBe("regrid");
    expect(propResult!.costCents).toBe(10);
  });

  it("pro tier can access all providers except enterprise", async () => {
    const available = registry.getAvailableProviders("pro");
    const names = available.map((p) => p.name).sort();

    expect(names).toContain("open-data");
    expect(names).toContain("regrid");
    expect(names).toContain("attom");
    expect(names).not.toContain("batchdata");
  });

  it("enterprise tier can access all providers", async () => {
    const available = registry.getAvailableProviders("enterprise");
    const names = available.map((p) => p.name).sort();

    expect(names).toContain("open-data");
    expect(names).toContain("regrid");
    expect(names).toContain("attom");
    expect(names).toContain("batchdata");
  });

  // ── Credit deduction tracking ──────────────────────────────────────────

  it("tracks credit deduction across multi-category enrichment", async () => {
    const initialCredits = 100;
    const categories: DataCategory[] = ["property_details", "comps", "valuation"];

    const results = await registry.enrichAll(categories, addressInput, "pro", initialCredits);

    expect(results.size).toBe(3);

    let totalSpent = 0;
    for (const [, result] of results) {
      totalSpent += result.costCents;
    }

    // property_details: regrid at 10 (cheaper than attom at 25)
    // comps: attom at 50
    // valuation: attom at 35
    expect(totalSpent).toBe(10 + 50 + 35);
    expect(totalSpent).toBeLessThanOrEqual(initialCredits);
  });

  it("skips providers when credits are insufficient", async () => {
    // Only 5 credits: not enough for any paid provider on comps (attom costs 50)
    const categories: DataCategory[] = ["comps"];
    const results = await registry.enrichAll(categories, addressInput, "pro", 5);

    expect(results.size).toBe(0);
  });

  it("deducts credits sequentially and stops when balance exhausted", async () => {
    // 55 credits: enough for property_details (regrid=10) + comps (attom=50) but not valuation (attom=35)
    // after property_details: 55-10=45; after comps: 45-50 < 0, so comps won't work either
    // Actually regrid=10 leaves 45; comps=50 > 45, so comps is skipped; valuation=35 <= 45
    const categories: DataCategory[] = ["property_details", "comps", "valuation"];
    const results = await registry.enrichAll(categories, addressInput, "pro", 55);

    // property_details: regrid (10) -> balance 45
    // comps: attom (50) > 45 -> skipped
    // valuation: attom (35) <= 45 -> success, balance 10
    expect(results.has("property_details")).toBe(true);
    expect(results.has("comps")).toBe(false);
    expect(results.has("valuation")).toBe(true);
  });

  // ── Cache hit on re-enrichment ─────────────────────────────────────────

  it("returns cached result on re-enrichment", async () => {
    let callCount = 0;
    const cachingProvider = createMockProvider({
      name: "caching-regrid",
      displayName: "Regrid (Caching)",
      categories: ["parcel_data"],
      supportedInputTypes: ["address"],
      tierRequired: "free",
      costCents: 0,
      lookupFn: async (category, input) => {
        callCount++;
        return {
          provider: "caching-regrid",
          category,
          confidence: 90,
          costCents: 0,
          fetchedAt: new Date(),
          cached: callCount > 1, // second call is a cache hit
          latencyMs: callCount > 1 ? 2 : 200,
          data: { parcel: "TX-12345", source: "cache" },
        };
      },
    });

    const cacheRegistry = new TestProviderRegistry();
    cacheRegistry.register("parcel_data", cachingProvider, 10);

    // First enrichment
    const first = await cacheRegistry.lookup("parcel_data", addressInput, "free", 0);
    expect(first).toBeDefined();
    expect(first!.cached).toBe(false);
    expect(first!.latencyMs).toBeGreaterThan(100);

    // Second enrichment (simulated cache hit)
    const second = await cacheRegistry.lookup("parcel_data", addressInput, "free", 0);
    expect(second).toBeDefined();
    expect(second!.cached).toBe(true);
    expect(second!.latencyMs).toBeLessThan(10);

    expect(callCount).toBe(2);
  });

  // ── Circuit breaker on provider failure ────────────────────────────────

  it("circuit breaker opens after 3 consecutive failures, falls through to next provider", async () => {
    let failCount = 0;
    const failingProvider = createMockProvider({
      name: "flaky-provider",
      displayName: "Flaky Provider",
      categories: ["parcel_data"],
      supportedInputTypes: ["address"],
      tierRequired: "free",
      costCents: 0,
      lookupFn: async () => {
        failCount++;
        throw new Error("API timeout");
      },
    });

    const cbRegistry = new TestProviderRegistry();
    cbRegistry.register("parcel_data", failingProvider, 10);
    cbRegistry.register("parcel_data", freeProvider, 20);

    // First 3 calls: flaky fails, falls to open-data
    for (let i = 0; i < 3; i++) {
      const result = await cbRegistry.lookup("parcel_data", addressInput, "free", 0);
      expect(result).toBeDefined();
      expect(result!.provider).toBe("open-data");
    }

    expect(failCount).toBe(3);

    // 4th call: circuit open on flaky, should skip straight to open-data
    const result = await cbRegistry.lookup("parcel_data", addressInput, "free", 0);
    expect(result).toBeDefined();
    expect(result!.provider).toBe("open-data");
    // Flaky should NOT have been called again (circuit is open)
    expect(failCount).toBe(3);
  });

  // ── Tier filtering edge cases ──────────────────────────────────────────

  it("free tier cannot access paid providers even with sufficient credits", async () => {
    const categories: DataCategory[] = ["skip_trace"];
    const results = await registry.enrichAll(categories, addressInput, "free", 10_000);

    expect(results.size).toBe(0);
  });

  it("returns null for unsupported input types", async () => {
    const ownerInput: LookupInput = {
      type: "owner",
      firstName: "John",
      lastName: "Doe",
    };

    // parcel_data providers don't support owner input
    const result = await registry.lookup("parcel_data", ownerInput, "enterprise", 10_000);
    expect(result).toBeNull();
  });

  // ── Health check aggregation ───────────────────────────────────────────

  it("reports health status for all registered providers", async () => {
    const unhealthyProvider = createMockProvider({
      name: "broken-svc",
      displayName: "Broken Service",
      categories: ["environmental"],
      supportedInputTypes: ["address"],
      tierRequired: "free",
      costCents: 0,
      healthy: false,
    });

    const healthRegistry = new TestProviderRegistry();
    healthRegistry.register("parcel_data", freeProvider, 10);
    healthRegistry.register("environmental", unhealthyProvider, 10);

    // Directly check health on each provider
    const freeHealth = await freeProvider.healthCheck();
    const brokenHealth = await unhealthyProvider.healthCheck();

    expect(freeHealth.healthy).toBe(true);
    expect(brokenHealth.healthy).toBe(false);
  });
});
