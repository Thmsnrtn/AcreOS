/**
 * The /founder/studio freeSourceFirst dial (routing.data) must actually steer
 * the data-source broker's ordering — before this wiring the Switch was
 * seeded, zod-validated, rendered, and read by NOTHING (a founder control
 * that controlled nothing; flagged in unit 116's triage).
 *
 * Contract proven here:
 *   - dial ON  → free tiers forced ahead of byok/paid (historical behaviour)
 *   - dial OFF → tier forcing dropped; natural priority-then-health order,
 *     so a better-priority paid source runs before a free one
 *   - missing setting / read failure → ON (the seeded default), so orgs that
 *     never touched the dial keep exactly the old ordering
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { DataSource } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

// Chainable Drizzle stub (same idiom as dataSourceBrokerBuiltinFetch.test.ts):
// every builder method returns the proxy, which is a thenable resolving to
// `resolved`.
function makeDbStub(resolved: unknown[]) {
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

// Paid source deliberately carries the BETTER (lower) priority so the two
// dial positions produce visibly different orders.
const freeSource = {
  id: 1,
  key: "county_gis",
  title: "County GIS (free)",
  category: "valuation",
  accessLevel: "free",
  isEnabled: true,
  isVerified: true,
  priority: 50,
  costPerCall: 0,
} as unknown as DataSource;

const paidSource = {
  id: 2,
  key: "regrid",
  title: "Regrid (paid)",
  category: "valuation",
  accessLevel: "paid",
  isEnabled: true,
  isVerified: true,
  priority: 10,
  costPerCall: 25,
} as unknown as DataSource;

vi.mock("../../server/db", () => ({
  db: makeDbStub([freeSource, paidSource]),
}));

vi.mock("../../server/storage", () => ({ storage: {} }));

const { getSettingMock } = vi.hoisted(() => ({ getSettingMock: vi.fn() }));
vi.mock("../../server/services/settings", () => ({
  getSetting: getSettingMock,
}));

describe("freeSourceFirst dial — pure ordering seam", () => {
  let orderSourcesForLookup: typeof import("../../server/services/dataSourceOrdering").orderSourcesForLookup;

  beforeEach(async () => {
    vi.resetModules();
    getSettingMock.mockReset();
    ({ orderSourcesForLookup } = await import("../../server/services/dataSourceOrdering"));
  });

  const opts = (freeSourceFirst: boolean) => ({
    freeSourceFirst,
    tierOf: (s: DataSource) => (s.accessLevel === "paid" ? ("paid" as const) : ("free" as const)),
    successRateOf: () => 0.5,
  });

  it("ON: free tier is forced ahead of a better-priority paid source", () => {
    const ordered = orderSourcesForLookup([paidSource, freeSource], opts(true));
    expect(ordered.map((s) => s.id)).toEqual([1, 2]);
  });

  it("OFF: tier forcing is dropped — natural priority order puts paid first", () => {
    const ordered = orderSourcesForLookup([freeSource, paidSource], opts(false));
    expect(ordered.map((s) => s.id)).toEqual([2, 1]);
  });

  it("OFF still keeps verified sources ahead of unverified ones (quality axis, not cost)", () => {
    const unverifiedPaid = { ...paidSource, id: 3, isVerified: false, priority: 1 } as DataSource;
    const ordered = orderSourcesForLookup([unverifiedPaid, freeSource], opts(false));
    expect(ordered.map((s) => s.id)).toEqual([1, 3]);
  });
});

describe("freeSourceFirst dial — broker consults routing.data", () => {
  let DataSourceBroker: typeof import("../../server/services/data-source-broker").DataSourceBroker;

  beforeEach(async () => {
    vi.resetModules();
    getSettingMock.mockReset();
    ({ DataSourceBroker } = await import("../../server/services/data-source-broker"));
  });

  async function sourcesWithDial(
    settingImpl: (key: string, fallback: unknown) => Promise<unknown>,
  ): Promise<DataSource[]> {
    getSettingMock.mockImplementation(settingImpl);
    const broker = new DataSourceBroker();
    return (broker as any).getSourcesForCategory("valuation");
  }

  it("reads the routing.data setting key", async () => {
    await sourcesWithDial(async (_key, fallback) => fallback);
    expect(getSettingMock).toHaveBeenCalledWith(
      "routing.data",
      expect.objectContaining({ freeSourceFirst: true }),
    );
  });

  it("dial ON (stored true): free source ordered first despite worse priority", async () => {
    const sources = await sourcesWithDial(async () => ({ freeSourceFirst: true }));
    expect(sources.map((s) => s.id)).toEqual([1, 2]);
  });

  it("dial OFF (stored false): better-priority paid source ordered first", async () => {
    const sources = await sourcesWithDial(async () => ({ freeSourceFirst: false }));
    expect(sources.map((s) => s.id)).toEqual([2, 1]);
  });

  it("missing setting: getSetting falls back → dial defaults ON, historical order unchanged", async () => {
    const sources = await sourcesWithDial(async (_key, fallback) => fallback);
    expect(sources.map((s) => s.id)).toEqual([1, 2]);
  });

  it("malformed stored value (freeSourceFirst not boolean): defaults ON", async () => {
    const sources = await sourcesWithDial(async () => ({ freeSourceFirst: "yes" }));
    expect(sources.map((s) => s.id)).toEqual([1, 2]);
  });

  it("settings read failure: defaults ON and does not fail the lookup path", async () => {
    const sources = await sourcesWithDial(async () => {
      throw new Error("db unavailable");
    });
    expect(sources.map((s) => s.id)).toEqual([1, 2]);
  });
});
