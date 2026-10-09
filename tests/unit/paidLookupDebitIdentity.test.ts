/**
 * Quality directive 2026-09-29 (money/cost truth) — a paid data lookup is
 * debited once per genuine vendor call, to the org that made it, before the
 * caller moves on, and never on credit it does not have.
 *
 *  - The debit's idempotency id was input fingerprint + UTC day, with no org.
 *    `poolDebit` dedups on that id globally, so a second org looking up the
 *    same parcel the same day was never debited, and two genuine calls by one
 *    org collapsed into one ledger row.
 *  - The debit was fire-and-forget.
 *  - A BYOK key row made the provider "free" in the affordability check; when
 *    the key then failed to resolve, the call ran on the platform key and
 *    billed a pool that could not afford it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

const S = vi.hoisted(() => ({
  byok: new Set<string>(),
  debits: [] as Array<{ organizationId: number; externalEventId: string }>,
  debitDelayMs: 0,
  debitSettled: 0,
}));
vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: async () => S.byok,
  resolveDataProviderKey: async () => null, // the key row exists but does not resolve
}));
vi.mock("../../server/services/creditPool", () => ({
  poolDebit: async (a: { organizationId: number; externalEventId: string }) => {
    if (S.debitDelayMs) await new Promise((r) => setTimeout(r, S.debitDelayMs));
    S.debits.push({ organizationId: a.organizationId, externalEventId: a.externalEventId });
    S.debitSettled++;
    return {};
  },
}));

let Registry: typeof import("../../server/services/providers/provider-registry");

beforeEach(async () => {
  vi.resetModules();
  S.byok = new Set();
  S.debits = [];
  S.debitDelayMs = 0;
  S.debitSettled = 0;
  Registry = await import("../../server/services/providers/provider-registry");
});

function paidProvider() {
  return {
    name: "paid-p",
    displayName: "Paid",
    categories: ["parcel_data"],
    supportedInputTypes: ["coordinates" as const],
    tierRequired: "free" as const,
    costPerLookupCents: vi.fn().mockReturnValue(3),
    isConfigured: vi.fn().mockResolvedValue(true),
    lookup: vi.fn().mockResolvedValue({
      provider: "paid-p",
      category: "parcel_data",
      confidence: 80,
      costCents: 3,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 5,
      data: { ok: true },
      source: "Proprietary Vendor",
    }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1, checkedAt: new Date() }),
  };
}

const input = { type: "coordinates" as const, latitude: 30.1, longitude: -97.7 };

describe("one vendor call, one debit, to the org that made it", () => {
  it("two orgs, same parcel, same day: two debits with distinct ids", async () => {
    const { providerRegistry } = Registry;
    providerRegistry.register("parcel_data", paidProvider() as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 8);
    expect(S.debits.map((d) => d.organizationId)).toEqual([7, 8]);
    expect(new Set(S.debits.map((d) => d.externalEventId)).size).toBe(2);
    expect(S.debits[0].externalEventId).toContain("org:7");
  });

  it("a lookup the caller already paid for through the pool gate (poolPreDebited) is NOT debited again", async () => {
    const { providerRegistry } = Registry;
    providerRegistry.register("parcel_data", paidProvider() as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7, { poolPreDebited: true });
    expect(S.debits).toHaveLength(0);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(S.debits).toHaveLength(1);
  });

  it("two genuine calls by one org are two ledger attempts", async () => {
    const { providerRegistry } = Registry;
    providerRegistry.register("parcel_data", paidProvider() as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(S.debits).toHaveLength(2);
    expect(S.debits[0].externalEventId).not.toBe(S.debits[1].externalEventId);
  });

  it("the debit has settled when the lookup returns", async () => {
    const { providerRegistry } = Registry;
    S.debitDelayMs = 400;
    providerRegistry.register("parcel_data", paidProvider() as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(S.debitSettled).toBe(1);
  });
});

describe("a BYOK key that does not resolve is not a free pass", () => {
  it("with no credits, the platform-key call is skipped — not made and billed", async () => {
    const { providerRegistry } = Registry;
    S.byok = new Set(["paid-p"]);
    const p = paidProvider();
    providerRegistry.register("parcel_data", p as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 0, 7);
    expect(p.lookup).not.toHaveBeenCalled();
    expect(S.debits).toEqual([]);
  });

  it("with credits, it runs on the platform key and is debited", async () => {
    const { providerRegistry } = Registry;
    S.byok = new Set(["paid-p"]);
    const p = paidProvider();
    providerRegistry.register("parcel_data", p as never, 10);
    await providerRegistry.lookup("parcel_data", input, "free", 1000, 7);
    expect(p.lookup).toHaveBeenCalledTimes(1);
    expect(S.debits).toHaveLength(1);
  });
});
