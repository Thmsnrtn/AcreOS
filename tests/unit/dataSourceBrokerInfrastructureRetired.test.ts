/**
 * Pin for the honest-unavailable behavior of the `infrastructure` category
 * (2026-07-28).
 *
 * The broker's only infrastructure implementation queried HIFLD
 * hospitals/fire-stations/schools FeatureServers at
 * services1.arcgis.com/Hp6G80Pky0om7QvQ. HIFLD Open was DISCONTINUED Aug 2025
 * (portal offline — docs/company/open-data-program.md). Fetching those dead
 * endpoints burned up to 12s per lookup and then returned empty arrays that
 * looked like "no hospitals nearby" — a fabricated-looking answer from a dead
 * source.
 *
 * The fix: `RETIRED_CATEGORIES` short-circuits the category to an explicit
 * `success:false` with the retirement reason in `fallbacksUsed`, making ZERO
 * network calls. These tests fail if anyone re-wires infrastructure to dead
 * endpoints, or makes the unavailable state slow or dishonest.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Chainable Drizzle stub (same pattern as dataSourceBrokerBuiltinFetch.test.ts):
// every query-builder method returns the same thenable proxy resolving to [].
function makeDbStub(resolved: unknown[] = []) {
  const handler: ProxyHandler<any> = {
    get(_t, prop) {
      if (prop === "then") {
        return (onF: (v: unknown) => unknown) => Promise.resolve(resolved).then(onF);
      }
      if (prop === "catch") {
        return () => Promise.resolve(undefined);
      }
      return () => proxy;
    },
  };
  const proxy: any = new Proxy(function () {}, handler);
  return proxy;
}

vi.mock("../../server/db", () => ({ db: makeDbStub([]) }));
vi.mock("../../server/storage", () => ({ storage: {} }));

describe("DataSourceBroker infrastructure category (HIFLD retired)", () => {
  let DataSourceBroker: typeof import("../../server/services/data-source-broker").DataSourceBroker;
  let RETIRED_CATEGORIES: typeof import("../../server/services/data-source-broker").RETIRED_CATEGORIES;
  let fetchSpy: ReturnType<typeof vi.fn>;
  const originalFetch = global.fetch;

  beforeEach(async () => {
    vi.resetModules();
    ({ DataSourceBroker, RETIRED_CATEGORIES } = await import(
      "../../server/services/data-source-broker"
    ));
    fetchSpy = vi.fn();
    global.fetch = fetchSpy as unknown as typeof fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.clearAllMocks();
  });

  it("returns an explicit success:false WITHOUT any network call", async () => {
    const broker = new DataSourceBroker();
    const result = await broker.lookup("infrastructure", {
      latitude: 30.2672,
      longitude: -97.7431,
      maxTier: "free",
    });

    // The whole point: no fetch against the dead HIFLD FeatureServers.
    expect(fetchSpy).not.toHaveBeenCalled();

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.fromCache).toBe(false);
    expect(result.source.costCents).toBe(0);
    expect(result.source.title).toMatch(/HIFLD/i);
    expect(result.source.title).toMatch(/discontinued/i);
  });

  it("carries the retirement reason so consumers/logs can explain the miss", async () => {
    const broker = new DataSourceBroker();
    const result = await broker.lookup("infrastructure", {
      latitude: 30.2672,
      longitude: -97.7431,
    });

    const reasons = result.fallbacksUsed.join(" ");
    expect(reasons).toMatch(/HIFLD Open discontinued Aug 2025/);
    expect(reasons).toMatch(/replacement pending/i);
  });

  it("resolves immediately — no dead-endpoint timeout tax", async () => {
    const broker = new DataSourceBroker();
    const result = await broker.lookup("infrastructure", {
      latitude: 30.2672,
      longitude: -97.7431,
    });
    // The old path burned up to 12s against dead hosts; the honest state is
    // effectively instant (generous bound to avoid CI flake).
    expect(result.lookupTimeMs).toBeLessThan(1000);
  });

  it("registers infrastructure as a retired category with a reason (registry shape)", () => {
    expect(RETIRED_CATEGORIES.infrastructure).toBeDefined();
    expect(RETIRED_CATEGORIES.infrastructure!.reason).toContain("HIFLD Open discontinued Aug 2025");
  });

  it("does not affect a non-retired category's built-in federal path", async () => {
    // flood_zone must still attempt its built-in FEMA fetch (regression guard
    // that the retired short-circuit is scoped to retired categories only).
    fetchSpy.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ features: [{ attributes: { FLD_ZONE: "X" } }] }),
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("flood_zone", {
      latitude: 30.2672,
      longitude: -97.7431,
      maxTier: "free",
    });

    expect(fetchSpy).toHaveBeenCalled();
    expect(result.success).toBe(true);
  });
});
