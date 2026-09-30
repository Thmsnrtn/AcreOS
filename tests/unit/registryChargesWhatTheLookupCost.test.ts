/**
 * Independent audit of 6b730aa (parcel layering) — the provider registry
 * debited a provider's LIST price on every successful lookup, ignoring the
 * cost the provider reported for that lookup. The Regrid provider reports $0
 * when the parcel service answered from free county data or a cache; the
 * customer was charged 3¢ anyway, and the founder cost surface recorded 3¢
 * AcreOS never spent. The debit is now what the lookup cost, capped at the
 * list price the pre-check approved.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: async () => new Set<string>(),
  resolveDataProviderKey: async () => null,
}));

let Registry: typeof import("../../server/services/providers/provider-registry");

beforeEach(async () => {
  vi.resetModules();
  Registry = await import("../../server/services/providers/provider-registry");
});

function provider(listCents: number, reportedCents: number) {
  return {
    name: "paid-p",
    displayName: "Paid",
    categories: ["parcel_data"],
    supportedInputTypes: ["coordinates" as const],
    tierRequired: "free" as const,
    costPerLookupCents: vi.fn().mockReturnValue(listCents),
    isConfigured: vi.fn().mockResolvedValue(true),
    lookup: vi.fn().mockResolvedValue({
      provider: "paid-p",
      category: "parcel_data",
      confidence: 80,
      costCents: reportedCents,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 5,
      data: { ok: true },
      source: "Regrid",
    }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1, checkedAt: new Date() }),
  };
}

const input = { type: "coordinates" as const, latitude: 30.1, longitude: -97.7 };

/** The private debit, observed (it writes the credit ledger). */
function spyDebit(registry: unknown) {
  return vi
    .spyOn(registry as { debitPaidLookup: (...a: unknown[]) => Promise<void> }, "debitPaidLookup")
    .mockResolvedValue(undefined);
}

describe("the registry charges what the lookup cost", () => {
  it("a lookup the provider answered for free is not debited", async () => {
    const { providerRegistry } = Registry;
    const debit = spyDebit(providerRegistry);
    providerRegistry.register("parcel_data", provider(3, 0) as never, 10);
    const r = await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(r?.costCents).toBe(0);
    expect(debit).not.toHaveBeenCalled();
  });

  it("a paid answer is debited its reported cost", async () => {
    const { providerRegistry } = Registry;
    const debit = spyDebit(providerRegistry);
    providerRegistry.register("parcel_data", provider(3, 3) as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(debit).toHaveBeenCalledTimes(1);
    expect((debit.mock.calls[0] as unknown[])[3]).toBe(3);
  });

  it("never more than the list price the pre-check approved", async () => {
    const { providerRegistry } = Registry;
    const debit = spyDebit(providerRegistry);
    providerRegistry.register("parcel_data", provider(3, 50) as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect((debit.mock.calls[0] as unknown[])[3]).toBe(3);
  });
});
