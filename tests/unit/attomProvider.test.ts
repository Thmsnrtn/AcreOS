import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../server/db", () => ({
  db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
}));

describe("attomProvider", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv, ATTOM_API_KEY: "test-key-123" };
    vi.resetModules();
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it("reports not configured without API key", async () => {
    delete process.env.ATTOM_API_KEY;
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    const configured = await attomProvider.isConfigured();
    expect(configured).toBe(false);
  });

  it("reports configured with API key", async () => {
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    const configured = await attomProvider.isConfigured();
    expect(configured).toBe(true);
  });

  it("supports correct categories", async () => {
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    expect(attomProvider.categories).toContain("property_details");
    expect(attomProvider.categories).toContain("valuation");
    expect(attomProvider.categories).toContain("comps");
    expect(attomProvider.categories).toContain("owner_info");
    expect(attomProvider.categories).toContain("structure");
  });

  it("returns correct cost per category", async () => {
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    expect(attomProvider.costPerLookupCents("property_details")).toBe(5);
    expect(attomProvider.costPerLookupCents("valuation")).toBe(10);
    expect(attomProvider.costPerLookupCents("comps")).toBe(20);
  });

  it("requires pro tier", async () => {
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    expect(attomProvider.tierRequired).toBe("pro");
  });

  it("returns cached result when cache hit", async () => {
    const mockData = { property: [{ building: { rooms: { beds: 3 } } }] };

    vi.doMock("../../server/db", () => ({
      db: {
        execute: vi.fn().mockResolvedValue({
          rows: [{ response_data: mockData }],
        }),
      },
    }));

    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    const result = await attomProvider.lookup("property_details", {
      type: "coordinates",
      latitude: 33.4484,
      longitude: -112.074,
    });

    expect(result.cached).toBe(true);
    expect(result.costCents).toBe(0); // Cached responses are free
    expect(result.data).toEqual(mockData);
  });

  it("throws on unsupported input type", async () => {
    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    await expect(
      attomProvider.lookup("property_details", {
        type: "owner",
        firstName: "John",
        lastName: "Doe",
      })
    ).rejects.toThrow("ATTOM does not support input type: owner");
  });

  it("handles fetch error in health check gracefully", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    const health = await attomProvider.healthCheck();
    expect(health.healthy).toBe(false);
    expect(health.message).toContain("Network error");
  });

  it("maps structure data correctly from API response", async () => {
    const mockApiResponse = {
      property: [{
        building: {
          rooms: { beds: 4, bathsFull: 2 },
          size: { livingSize: 2400 },
          summary: { yearBuilt: 1998, levels: 2, propType: "SFR" },
        },
      }],
    };

    // Mock no cache hit, then mock fetch
    vi.doMock("../../server/db", () => ({
      db: { execute: vi.fn().mockResolvedValue({ rows: [] }) },
    }));

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockApiResponse),
    });

    const { attomProvider } = await import("../../server/services/providers/attom-provider");
    const result = await attomProvider.lookup("structure", {
      type: "coordinates",
      latitude: 33.4484,
      longitude: -112.074,
    });

    expect(result.cached).toBe(false);
    expect(result.data).toEqual({
      bedrooms: 4,
      bathrooms: 2,
      sqft: 2400,
      yearBuilt: 1998,
      stories: 2,
      structureType: "SFR",
    });
  });
});
