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

  it("defines 3–5 golden probes spanning multiple sources/categories", () => {
    expect(GOLDEN_PROBES.length).toBeGreaterThanOrEqual(3);
    expect(GOLDEN_PROBES.length).toBeLessThanOrEqual(5);
    const categories = new Set(GOLDEN_PROBES.map((p) => p.category));
    expect(categories.size).toBeGreaterThanOrEqual(2);
  });

  it("marks a probe healthy when the source returns plausible data", async () => {
    lookupMock.mockResolvedValue(ok());
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
    const envFails = outcomes.filter((o) => o.category !== "parcel_data");
    expect(envFails.every((o) => !o.healthy)).toBe(true);
    expect(envFails[0].detail).toMatch(/empty|null/i);
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
