import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Mock the registry so we control exactly what each golden probe "sees" —
// the point of this test is the SHAPE/PLAUSIBILITY assertions, not the network.
const lookupMock = vi.fn();
vi.mock("../../server/services/providers/provider-registry", () => ({
  providerRegistry: { lookup: (...args: unknown[]) => lookupMock(...args) },
}));

import { runDataSourceProbes, GOLDEN_PROBES } from "../../server/jobs/dataSourceProbe";

function ok(source = "FEMA NFHL", confidence = 70, data: unknown = { floodZone: "AE" }) {
  return {
    provider: "open-data",
    category: "environmental",
    confidence,
    costCents: 0,
    fetchedAt: new Date(),
    cached: false,
    latencyMs: 5,
    data,
    source,
    classification: "authoritative" as const,
  };
}

describe("dataSourceProbe", () => {
  beforeEach(() => {
    lookupMock.mockReset();
  });
  afterEach(() => vi.restoreAllMocks());

  it("covers the load-bearing free-data categories (plus the retired-infrastructure pin)", () => {
    expect(GOLDEN_PROBES.length).toBeGreaterThanOrEqual(3);
    const categories = new Set(GOLDEN_PROBES.map((p) => p.category));
    // The categories the platform leans on hardest must each have a canary.
    for (const required of ["environmental", "demographics", "parcel_data", "flood_zone", "soil", "wetlands", "elevation", "infrastructure"]) {
      expect(categories).toContain(required);
    }
  });

  it("marks a probe healthy when the source returns plausible data", async () => {
    // infrastructure is retired (HIFLD, Aug 2025): its probe expects the
    // honest-unavailable state, so the mock returns null for it.
    lookupMock.mockImplementation(async (category: string) =>
      category === "infrastructure" ? null : ok(),
    );
    const outcomes = await runDataSourceProbes();
    expect(outcomes).toHaveLength(GOLDEN_PROBES.length);
    // parcel probe tolerates a null hit, but a plausible result is also healthy.
    expect(outcomes.every((o) => o.healthy)).toBe(true);
  });

  it("FAILS a probe when the source answers with empty/garbage data", async () => {
    // environmental/demographics probes require usable data; empty object fails.
    lookupMock.mockImplementation(async (category: string) => {
      if (category === "parcel_data") return null; // tolerated miss
      return ok("FEMA NFHL", 70, {}); // empty -> implausible
    });
    const outcomes = await runDataSourceProbes();
    // parcel_data tolerates a miss; infrastructure EXPECTS emptiness (retired).
    const envFails = outcomes.filter((o) => o.category !== "parcel_data" && o.category !== "infrastructure");
    expect(envFails.every((o) => !o.healthy)).toBe(true);
    expect(envFails[0].detail).toMatch(/empty|null/i);
  });

  it("pins the retired-infrastructure expectation: unavailable = healthy, data = FAIL", async () => {
    // Unavailable (broker short-circuit surfaces as null/empty through the
    // registry) is the EXPECTED state.
    lookupMock.mockImplementation(async (category: string) =>
      category === "infrastructure" ? null : ok(),
    );
    let outcomes = await runDataSourceProbes();
    let infra = outcomes.find((o) => o.category === "infrastructure")!;
    expect(infra.healthy).toBe(true);

    // If infrastructure ever RETURNS data, the pin must trip so the probe
    // expectations get updated alongside the replacement source.
    lookupMock.mockImplementation(async () => ok("HIFLD", 70, { hospitals: [{ NAME: "St. Somewhere" }] }));
    outcomes = await runDataSourceProbes();
    infra = outcomes.find((o) => o.category === "infrastructure")!;
    expect(infra.healthy).toBe(false);
    expect(infra.detail).toMatch(/retired/i);
  });

  it("FAILS a probe when all providers are exhausted (null) for a required category", async () => {
    lookupMock.mockResolvedValue(null);
    const outcomes = await runDataSourceProbes();
    const env = outcomes.find((o) => o.category === "environmental")!;
    expect(env.healthy).toBe(false);
    expect(env.detail).toMatch(/exhausted|no result/i);
  });

  it("FAILS a probe with low confidence", async () => {
    lookupMock.mockImplementation(async (category: string) => {
      if (category === "parcel_data") return null;
      return ok("FEMA NFHL", 5, { floodZone: "AE" }); // below the floor
    });
    const outcomes = await runDataSourceProbes();
    const env = outcomes.find((o) => o.category === "environmental")!;
    expect(env.healthy).toBe(false);
    expect(env.detail).toMatch(/confidence/i);
  });

  it("isolates a thrown error to a single probe (does not abort the run)", async () => {
    let call = 0;
    lookupMock.mockImplementation(async () => {
      call++;
      if (call === 1) throw new Error("FEMA timeout");
      return ok();
    });
    const outcomes = await runDataSourceProbes();
    expect(outcomes).toHaveLength(GOLDEN_PROBES.length);
    expect(outcomes[0].healthy).toBe(false);
    expect(outcomes[0].detail).toMatch(/timeout/i);
    // remaining probes still ran
    expect(outcomes.slice(1).some((o) => o.healthy)).toBe(true);
  });

  it("tolerates a clean parcel miss (null) as healthy", async () => {
    lookupMock.mockImplementation(async (category: string) =>
      category === "parcel_data" ? null : ok(),
    );
    const outcomes = await runDataSourceProbes();
    const parcel = outcomes.find((o) => o.category === "parcel_data")!;
    expect(parcel.healthy).toBe(true);
  });
});
