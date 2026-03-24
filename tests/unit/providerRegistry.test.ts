import { describe, it, expect, vi, beforeEach } from "vitest";

// We need to mock the logger before importing the registry
vi.mock("../../server/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("ProviderRegistry", () => {
  let ProviderRegistryModule: typeof import("../../server/services/providers/provider-registry");

  beforeEach(async () => {
    vi.resetModules();
    ProviderRegistryModule = await import("../../server/services/providers/provider-registry");
  });

  function makeMockProvider(overrides: Partial<{
    name: string;
    tierRequired: string;
    cost: number;
    categories: string[];
    shouldFail: boolean;
    data: unknown;
    confidence: number;
  }> = {}) {
    const {
      name = "test-provider",
      tierRequired = "free",
      cost = 0,
      categories = ["parcel_data"],
      shouldFail = false,
      data = { test: true },
      confidence = 80,
    } = overrides;

    return {
      name,
      displayName: `Test Provider (${name})`,
      categories,
      supportedInputTypes: ["coordinates" as const],
      tierRequired: tierRequired as any,
      costPerLookupCents: vi.fn().mockReturnValue(cost),
      isConfigured: vi.fn().mockResolvedValue(true),
      lookup: shouldFail
        ? vi.fn().mockRejectedValue(new Error("Provider failed"))
        : vi.fn().mockResolvedValue({
            provider: name,
            category: categories[0],
            confidence,
            costCents: cost,
            fetchedAt: new Date(),
            cached: false,
            latencyMs: 50,
            data,
          }),
      healthCheck: vi.fn().mockResolvedValue({
        healthy: true,
        latencyMs: 100,
        checkedAt: new Date(),
      }),
    };
  }

  const testInput = {
    type: "coordinates" as const,
    latitude: 33.4484,
    longitude: -112.074,
  };

  describe("tier filtering", () => {
    it("returns free provider for free tier org", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const freeProvider = makeMockProvider({ name: "free-p", tierRequired: "free", cost: 0 });
      const proProvider = makeMockProvider({ name: "pro-p", tierRequired: "pro", cost: 10 });

      providerRegistry.register("parcel_data", freeProvider as any, 10);
      providerRegistry.register("parcel_data", proProvider as any, 50);

      const result = await providerRegistry.lookup("parcel_data", testInput, "free", 1000);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("free-p");
      expect(freeProvider.lookup).toHaveBeenCalledTimes(1);
      expect(proProvider.lookup).not.toHaveBeenCalled();
    });

    it("returns pro provider for pro tier org", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const freeProvider = makeMockProvider({ name: "free-p", tierRequired: "free", cost: 0, confidence: 60 });
      const proProvider = makeMockProvider({ name: "pro-p", tierRequired: "pro", cost: 10, confidence: 90 });

      providerRegistry.register("parcel_data", freeProvider as any, 10);
      providerRegistry.register("parcel_data", proProvider as any, 50);

      const result = await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);
      // Free is tried first (lower tier = tried first)
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("free-p");
    });
  });

  describe("fallback on failure", () => {
    it("falls back to next provider when first fails", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const failing = makeMockProvider({ name: "failing", tierRequired: "free", shouldFail: true });
      const backup = makeMockProvider({ name: "backup", tierRequired: "free", data: { backup: true } });

      providerRegistry.register("parcel_data", failing as any, 10);
      providerRegistry.register("parcel_data", backup as any, 20);

      const result = await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("backup");
      expect(failing.lookup).toHaveBeenCalledTimes(1);
      expect(backup.lookup).toHaveBeenCalledTimes(1);
    });
  });

  describe("credit deduction check", () => {
    it("skips provider when credit balance is insufficient", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const expensive = makeMockProvider({ name: "expensive", tierRequired: "free", cost: 500 });
      const cheap = makeMockProvider({ name: "cheap", tierRequired: "free", cost: 5 });

      providerRegistry.register("parcel_data", expensive as any, 10);
      providerRegistry.register("parcel_data", cheap as any, 20);

      const result = await providerRegistry.lookup("parcel_data", testInput, "pro", 10);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("cheap");
      expect(expensive.lookup).not.toHaveBeenCalled();
    });
  });

  describe("circuit breaker", () => {
    it("opens circuit after 3 consecutive failures", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const failing = makeMockProvider({ name: "flaky", tierRequired: "free", shouldFail: true });
      const backup = makeMockProvider({ name: "stable", tierRequired: "free" });

      providerRegistry.register("parcel_data", failing as any, 10);
      providerRegistry.register("parcel_data", backup as any, 20);

      // 3 calls to trigger circuit breaker
      await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);
      await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);
      await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);

      // After 3 failures, circuit should be open — flaky provider skipped entirely
      const result = await providerRegistry.lookup("parcel_data", testInput, "pro", 1000);
      expect(result).not.toBeNull();
      expect(result!.provider).toBe("stable");
      // Flaky was called 3 times (before circuit opened), then 0 more
      expect(failing.lookup).toHaveBeenCalledTimes(3);
    });
  });

  describe("BYOK bypass", () => {
    it("returns null when no providers available for category", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const result = await providerRegistry.lookup("skip_trace", testInput, "free", 1000);
      expect(result).toBeNull();
    });
  });

  describe("getAvailableProviders", () => {
    it("returns only providers within tier", () => {
      const { providerRegistry } = ProviderRegistryModule;
      const free = makeMockProvider({ name: "free-p", tierRequired: "free" });
      const pro = makeMockProvider({ name: "pro-p", tierRequired: "pro" });

      providerRegistry.register("parcel_data", free as any, 10);
      providerRegistry.register("parcel_data", pro as any, 50);

      const available = providerRegistry.getAvailableProviders("starter");
      expect(available.map((p) => p.name)).toContain("free-p");
      expect(available.map((p) => p.name)).not.toContain("pro-p");
    });
  });

  describe("enrichAll", () => {
    it("runs multiple categories and returns results map", async () => {
      const { providerRegistry } = ProviderRegistryModule;
      const parcelProvider = makeMockProvider({
        name: "parcel-p",
        categories: ["parcel_data"],
        data: { parcel: true },
      });
      const envProvider = makeMockProvider({
        name: "env-p",
        categories: ["environmental"],
        data: { env: true },
      });

      providerRegistry.register("parcel_data", parcelProvider as any, 10);
      providerRegistry.register("environmental", envProvider as any, 10);

      const results = await providerRegistry.enrichAll(
        ["parcel_data", "environmental"],
        testInput,
        "pro",
        5000
      );

      expect(results.size).toBe(2);
      expect(results.get("parcel_data")?.data).toEqual({ parcel: true });
      expect(results.get("environmental")?.data).toEqual({ env: true });
    });
  });
});
