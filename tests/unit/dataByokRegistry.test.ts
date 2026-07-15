/**
 * R1d BYO-data-keys — registry bypass integration test.
 *
 * Proves the money-path contract end to end at the registry:
 *   - When the org has connected its own key for a paid provider, the lookup
 *     is AFFORDABLE even with an empty credit pool (platform cost = 0), the
 *     customer's key is threaded into provider.lookup, and the credit pool is
 *     NEVER debited.
 *   - When the org has NOT connected a key, behaviour is unchanged: no
 *     override is passed and the pool IS debited for the paid lookup.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mutable BYOK state the mocked resolver reads per test.
let connectedProviders = new Set<string>();
let resolvedKey: string | null = null;
vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: vi.fn(async () => connectedProviders),
  resolveDataProviderKey: vi.fn(async () => resolvedKey),
}));

// Spy the credit-pool debit surface (dynamic-imported by the registry).
const poolDebit = vi.fn(async () => ({ allowed: true, debitedCents: 0 }));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: (...args: unknown[]) => poolDebit(...args),
}));

const testInput = { type: "coordinates" as const, latitude: 33.4484, longitude: -112.074 };

function makePaidProvider(name: string) {
  return {
    name,
    displayName: `Paid (${name})`,
    categories: ["comps"],
    supportedInputTypes: ["coordinates" as const],
    tierRequired: "starter" as const,
    license: "proprietary" as const,
    redistributable: "no" as const,
    minMonthlyCommitCents: 0,
    costPerLookupCents: vi.fn().mockReturnValue(20),
    isConfigured: vi.fn().mockResolvedValue(true),
    lookup: vi.fn().mockResolvedValue({
      provider: name,
      category: "comps",
      confidence: 85,
      costCents: 20,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 40,
      data: { comps: true },
      source: name,
      classification: "estimate",
    }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 10, checkedAt: new Date() }),
  };
}

async function flush() {
  await new Promise((r) => setTimeout(r, 0));
}

describe("R1d registry BYO-data-key bypass", () => {
  let mod: typeof import("../../server/services/providers/provider-registry");

  beforeEach(async () => {
    vi.resetModules();
    connectedProviders = new Set<string>();
    resolvedKey = null;
    poolDebit.mockClear();
    mod = await import("../../server/services/providers/provider-registry");
  });

  it("serves on the customer key with an empty pool and never debits", async () => {
    const provider = makePaidProvider("byok-comps");
    mod.providerRegistry.register("comps", provider as any, 10);

    connectedProviders = new Set(["byok-comps"]);
    resolvedKey = "cust-comps-key";

    // creditBalance 0 — without BYOK the affordability gate would drop it.
    const result = await mod.providerRegistry.lookup("comps", testInput, "starter", 0, 42);
    await flush();

    expect(result).not.toBeNull();
    expect(result!.provider).toBe("byok-comps");
    // The customer's key was threaded into the vendor call.
    expect(provider.lookup).toHaveBeenCalledWith("comps", testInput, { apiKeyOverride: "cust-comps-key" });
    // The pool was never debited — the customer paid their own vendor.
    expect(poolDebit).not.toHaveBeenCalled();
  });

  it("debits the pool and passes no override when the org has no data key", async () => {
    const provider = makePaidProvider("platform-comps");
    mod.providerRegistry.register("comps", provider as any, 10);

    connectedProviders = new Set<string>(); // no BYOK
    resolvedKey = null;

    const result = await mod.providerRegistry.lookup("comps", testInput, "starter", 1000, 42);

    expect(result).not.toBeNull();
    // No override context on the platform path.
    expect(provider.lookup).toHaveBeenCalledWith("comps", testInput, undefined);
    // The paid lookup debited the pool for the org (fire-and-forget through a
    // dynamic import — wait for the microtask chain to settle).
    await vi.waitFor(() => expect(poolDebit).toHaveBeenCalledTimes(1));
    expect(poolDebit.mock.calls[0][0]).toMatchObject({ organizationId: 42 });
  });
});
