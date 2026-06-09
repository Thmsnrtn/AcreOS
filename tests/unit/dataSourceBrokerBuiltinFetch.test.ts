/**
 * Regression guard for the 2026-06-09 production bug (v633): the public
 * parcel-check returned `available:false`/`data:null` for EVERY free government
 * data category on valid coordinates, in ~7ms, WITHOUT making any network call.
 *
 * Root cause: `DataSourceBroker.lookup()` only ran its hardcoded federal fetch
 * implementations INSIDE `for (const source of sources)`, where `sources` came
 * from the `data_sources` DB table. When that table is empty/unseeded (the prod
 * state), the loop had zero iterations and the broker fell straight through to
 * `success:false` — never touching FEMA/USGS/USDA/Census even though those
 * endpoints are baked into the code and need no DB row.
 *
 * These tests prove the broker now ATTEMPTS the built-in federal fetch with an
 * EMPTY `data_sources` table, and returns `success:true` with real data when the
 * endpoint responds. If anyone re-gates the federal fetch behind a DB row, these
 * fail.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Chainable Drizzle stub. Every query-builder method returns the same proxy,
// which is also a thenable resolving to `resolved` (default: [] — the empty,
// unseeded `data_sources` table that triggered the production bug). Inserts
// resolve to undefined so cacheResult() is a no-op.
function makeDbStub(resolved: unknown[] = []) {
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === "then") {
        return (onF: (v: unknown) => unknown) => Promise.resolve(resolved).then(onF);
      }
      // insert().values().onConflictDoUpdate() and .catch() must also resolve.
      if (prop === "catch") {
        return () => Promise.resolve(undefined);
      }
      return () => proxy;
    },
  };
  const proxy: any = new Proxy(function () {}, handler);
  return proxy;
}

const dbStub = makeDbStub([]);

vi.mock("../../server/db", () => ({
  db: dbStub,
}));

// storage is imported at module top but unused on the lookup path we exercise.
vi.mock("../../server/storage", () => ({ storage: {} }));

describe("DataSourceBroker built-in federal fetch (empty data_sources table)", () => {
  let DataSourceBroker: typeof import("../../server/services/data-source-broker").DataSourceBroker;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.resetModules();
    ({ DataSourceBroker } = await import("../../server/services/data-source-broker"));
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("ATTEMPTS the FEMA flood fetch and returns success:true with data — even with zero DB sources", async () => {
    // Live-shaped FEMA NFHL layer-28 response for a high-risk zone.
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({
        features: [
          { attributes: { FLD_ZONE: "AE", ZONE_SUBTY: "", STATIC_BFE: 1120, DFIRM_ID: "04013C" } },
        ],
      }),
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("flood_zone", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    // The regression: this used to be false with no fetch. Now it must fetch.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const calledUrl = String(fetchSpy.mock.calls[0][0]);
    // And it must hit the CURRENT FEMA host (the `/arcgis/` path), not the dead
    // `/gis/nfhl/` WebSEAL gateway.
    expect(calledUrl).toContain("hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28/query");
    expect(calledUrl).not.toContain("/gis/nfhl/");

    expect(result.success).toBe(true);
    expect(result.data).toBeTruthy();
    expect(result.data.zone).toBe("Zone AE");
    expect(result.data.riskLevel).toBe("high");
    expect(result.source.tier).toBe("free");
    expect(result.source.costCents).toBe(0);
  });

  it("ATTEMPTS the USGS elevation fetch with zero DB sources", async () => {
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ value: "331.673", date: "2021-11-06" }),
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("elevation", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(String(fetchSpy.mock.calls[0][0])).toContain("epqs.nationalmap.gov");
    expect(result.success).toBe(true);
    expect(result.data.elevationFeet).toBe(332);
    expect(result.data.source).toContain("USGS");
  });

  it("returns an honest success:false when the federal endpoint itself fails (no fabrication)", async () => {
    // Endpoint reachable but erroring — the broker should attempt the fetch
    // (proving no short-circuit) and then degrade honestly.
    fetchSpy.mockResolvedValue({ ok: false, status: 500, json: async () => ({}) });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("flood_zone", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(fetchSpy).toHaveBeenCalled(); // attempted — not the 7ms short-circuit
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.fallbacksUsed.join(" ")).toMatch(/built-in federal/i);
  });
});
