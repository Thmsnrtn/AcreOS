/**
 * D1 amendment A3 — demand events.
 *
 * The provider registry already writes one provider_lookup_log row per lookup
 * attempt; A3 completes that row into a demand event (intent class, answering
 * layer, confidence served). These tests drive the REAL registry and capture
 * what it hands to the telemetry writer, for each layer that can answer:
 * open data, a paid vendor on the platform key, a vendor on the org's own key,
 * and a failed attempt. Plus the pure layer rule.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));

let connectedProviders = new Set<string>();
let resolvedKey: string | null = null;
vi.mock("../../server/services/byok/dataByok", () => ({
  getConnectedDataProviders: vi.fn(async () => connectedProviders),
  resolveDataProviderKey: vi.fn(async () => resolvedKey),
}));
vi.mock("../../server/services/creditPool", () => ({ poolDebit: vi.fn(async () => ({ allowed: true, debitedCents: 0 })) }));

const recorded: Array<Record<string, unknown>> = [];
vi.mock("../../server/services/providerIntelligence", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../server/services/providerIntelligence")>()),
  recordLookup: vi.fn(async (r: Record<string, unknown>) => {
    recorded.push(r);
  }),
}));

import { answeringLayerFor } from "@shared/openData/demandEvent";

const input = { type: "apn" as const, apn: "SYN-1", state: "FL", county: "Liberty" };

function provider(name: string, cents: number, behaviour: "ok" | "throw" = "ok") {
  return {
    name,
    displayName: name,
    categories: ["parcel_data"],
    supportedInputTypes: ["apn" as const],
    tierRequired: "free" as const,
    license: "public_domain" as const,
    redistributable: "no" as const,
    minMonthlyCommitCents: 0,
    costPerLookupCents: vi.fn().mockReturnValue(cents),
    isConfigured: vi.fn().mockResolvedValue(true),
    lookup:
      behaviour === "throw"
        ? vi.fn().mockRejectedValue(new Error("upstream 503"))
        : vi.fn().mockResolvedValue({
            provider: name, category: "parcel_data", confidence: 72, costCents: cents, fetchedAt: new Date(),
            cached: false, latencyMs: 31, data: { apn: "X" }, source: name, classification: "authoritative",
          }),
    healthCheck: vi.fn().mockResolvedValue({ healthy: true, latencyMs: 1, checkedAt: new Date() }),
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("the answering-layer rule", () => {
  it("is decided from facts held at answer time", () => {
    expect(answeringLayerFor({ cached: true, listPriceCents: 15, byokServed: false })).toBe("cache");
    expect(answeringLayerFor({ cached: false, listPriceCents: 0, byokServed: false })).toBe("open_data");
    expect(answeringLayerFor({ cached: false, listPriceCents: 15, byokServed: false })).toBe("vendor");
    expect(answeringLayerFor({ cached: false, listPriceCents: 15, byokServed: true })).toBe("vendor_byok");
  });
});

describe("the registry writes a demand event for every lookup it answers (default-on)", () => {
  let mod: typeof import("../../server/services/providers/provider-registry");
  beforeEach(async () => {
    vi.resetModules();
    recorded.length = 0;
    connectedProviders = new Set();
    resolvedKey = null;
    mod = await import("../../server/services/providers/provider-registry");
  });

  const lookup = () => mod.providerRegistry.lookup("parcel_data", input, "starter", 1000, 42);

  it("open data (Layer 1): layer open_data, cost 0, the served confidence", async () => {
    mod.providerRegistry.register("parcel_data", provider("fl-statewide", 0) as any, 1);
    await lookup();
    await flush();
    expect(recorded.at(-1)).toMatchObject({
      organizationId: 42, state: "FL", county: "Liberty", intentClass: "parcel_data",
      answeringLayer: "open_data", costCents: 0, confidenceServed: 72, success: true,
    });
  });

  it("a paid vendor on the platform key (Layer 3): layer vendor, its cost", async () => {
    mod.providerRegistry.register("parcel_data", provider("regrid-like", 10) as any, 1);
    await lookup();
    await flush();
    expect(recorded.at(-1)).toMatchObject({ intentClass: "parcel_data", answeringLayer: "vendor", costCents: 10, confidenceServed: 72 });
  });

  it("a vendor on the org's own key: layer vendor_byok, cost to AcreOS 0", async () => {
    mod.providerRegistry.register("parcel_data", provider("regrid-like", 10) as any, 1);
    connectedProviders = new Set(["regrid-like"]);
    resolvedKey = "org-key";
    await lookup();
    await flush();
    expect(recorded.at(-1)).toMatchObject({ answeringLayer: "vendor_byok", costCents: 0 });
  });

  it("a failed attempt is still demand — recorded with its layer and no served confidence", async () => {
    mod.providerRegistry.register("parcel_data", provider("regrid-like", 10, "throw") as any, 1);
    await lookup();
    await flush();
    const failure = recorded.find((r) => r.success === false)!;
    expect(failure).toMatchObject({ intentClass: "parcel_data", answeringLayer: "vendor", organizationId: 42 });
    expect(failure.confidenceServed).toBeUndefined();
  });
});
