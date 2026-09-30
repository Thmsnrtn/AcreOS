/**
 * Quality directive 2026-09-29 (reachable false claims) — a flood reading is
 * only what FEMA said, and a cached reading carries the rights it was fetched
 * under.
 *
 *  - An NFHL query that returns NO feature was reported as "Zone X (Minimal
 *    Flood Hazard)", risk low. That scored the parcel minimal-risk (95/100 in
 *    the public report) and cleared the diligence checklist item. No feature
 *    means FEMA has no digital zone at the point — unmapped, not minimal.
 *  - `data-source-lookup.ts` still called the retired `/gis/nfhl/` host, so
 *    EVERY lookup failed — and a failure returned the same invented Zone X.
 *  - `lastUpdated` was the lookup instant and read downstream as the map's
 *    vintage.
 *  - The broker read its cache before the tier check and returned whatever
 *    row was newest, labelled "Cache": a caller capped at `maxTier:"free"`
 *    could receive a paid source's row.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { dataSources, dataSourceCache } from "@shared/schema";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../server/services/settings", () => ({ getSetting: async (_k: string, d: unknown) => d }));

const S = vi.hoisted(() => ({
  cacheRows: [] as Array<Record<string, unknown>>,
  sourceRows: [] as Array<Record<string, unknown>>,
  cacheWrites: 0,
}));

function chain(rows: () => unknown[]) {
  const p: Record<string, unknown> = {};
  for (const m of ["where", "orderBy", "limit"]) p[m] = () => p;
  p.then = (onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) => Promise.resolve(rows()).then(onF, onR);
  return p;
}

vi.mock("../../server/db", () => ({
  db: {
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    select: () => ({
      from: (t: unknown) =>
        chain(() => (t === dataSourceCache ? S.cacheRows : t === dataSources ? S.sourceRows : [])),
    }),
    insert: () => ({
      values: () => {
        S.cacheWrites++;
        return { onConflictDoUpdate: () => ({ catch: async () => undefined }) };
      },
    }),
  },
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getDataSources: async () => [],
    getDataSourceCacheEntry: async () => undefined,
    createDataSourceCacheEntry: async () => {
      S.cacheWrites++;
    },
  },
}));

const originalFetch = global.fetch;
let fetchSpy: ReturnType<typeof vi.fn>;
function femaReturns(features: unknown[]) {
  fetchSpy.mockResolvedValue({ ok: true, status: 200, json: async () => ({ features }) });
}

beforeEach(() => {
  S.cacheRows = [];
  S.sourceRows = [];
  S.cacheWrites = 0;
  fetchSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
});
afterEach(() => {
  global.fetch = originalFetch;
});

const at = { latitude: 30.1234, longitude: -97.5678 };

describe("the diligence lookup (data-source-lookup)", () => {
  it("no feature at the point is UNMAPPED, not Zone X", async () => {
    femaReturns([]);
    const { dataSourceLookupService } = await import("../../server/services/data-source-lookup");
    const r = await dataSourceLookupService.lookupFloodZone(at);
    expect(r.data.zone).toBeNull();
    expect(r.data.riskLevel).toBe("unknown");
    expect(r.data.status).toBe("unmapped");
    expect(JSON.stringify(r.data)).not.toMatch(/Zone X/);
    expect(r.data).not.toHaveProperty("lastUpdated");
  });

  it("FEMA unreachable is no reading — not an invented Zone X", async () => {
    fetchSpy.mockRejectedValue(new Error("ECONNRESET"));
    const { dataSourceLookupService } = await import("../../server/services/data-source-lookup");
    const r = await dataSourceLookupService.lookupFloodZone(at);
    expect(r.success).toBe(false);
    expect(r.data.zone).toBeNull();
    expect(r.data.riskLevel).toBe("unknown");
  });

  it("calls the live NFHL host, not the retired /gis/nfhl/ gateway", async () => {
    femaReturns([{ attributes: { FLD_ZONE: "AE" } }]);
    const { dataSourceLookupService } = await import("../../server/services/data-source-lookup");
    const r = await dataSourceLookupService.lookupFloodZone(at);
    expect(String(fetchSpy.mock.calls[0][0])).toContain("hazards.fema.gov/arcgis/");
    expect(r.data).toMatchObject({ zone: "Zone AE", riskLevel: "high", status: "mapped" });
  });
});

describe("the reading downstream", () => {
  it("an unmapped point does not clear the checklist item or score as minimal", async () => {
    const { floodZoneFromNfhl } = await import("../../server/services/data-source-broker");
    const { annotateFlood } = await import("../../server/services/checklistAnnotation");
    const { floodZoneSubScore } = await import("../../server/services/publicParcelReport");
    const unmapped = floodZoneFromNfhl([], new Date("2026-09-30T00:00:00Z"));
    const a = annotateFlood(unmapped);
    expect(a.verdict).not.toBe("likely_clears");
    expect(a.asOf).toBeNull(); // the lookup instant is not the map's vintage
    expect(floodZoneSubScore(unmapped.zone)).toBeNull();
  });

  it("zone D is undetermined, and shaded X (0.2% annual chance) is moderate", async () => {
    const { floodZoneFromNfhl } = await import("../../server/services/data-source-broker");
    const now = new Date();
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "D" } }], now).riskLevel).toBe("unknown");
    expect(
      floodZoneFromNfhl([{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" } }], now)
        .riskLevel,
    ).toBe("medium");
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "AREA OF MINIMAL FLOOD HAZARD" } }], now).riskLevel).toBe("low");
  });
});

describe("the broker", () => {
  it("an empty answer is not cached, and the broker also says unmapped", async () => {
    // Through a real (DB) source row — the built-in source is never cached.
    S.sourceRows = [{ id: 3, title: "FEMA NFHL", key: "fema_nfhl", accessLevel: "public", isEnabled: true, isVerified: true }];
    femaReturns([]);
    const { DataSourceBroker } = await import("../../server/services/data-source-broker");
    const r = await new DataSourceBroker().lookup("flood_zone", { ...at, maxTier: "free" });
    expect(r.data).toMatchObject({ status: "unmapped", zone: null, riskLevel: "unknown" });
    expect(S.cacheWrites).toBe(0);
  });

  it("a cache hit above the caller's tier is not served", async () => {
    S.cacheRows = [{ dataSourceId: 9, data: { status: "mapped", zone: "Zone AE", riskLevel: "high" }, fetchedAt: new Date(), successfulFetch: true }];
    S.sourceRows = [{ id: 9, title: "Paid Flood Co", key: "paid_flood", accessLevel: "paid" }];
    femaReturns([{ attributes: { FLD_ZONE: "X" } }]);
    const { DataSourceBroker } = await import("../../server/services/data-source-broker");
    const r = await new DataSourceBroker().lookup("flood_zone", { ...at, maxTier: "free" });
    expect(r.fromCache).toBe(false);
    expect(r.source.title).not.toBe("Paid Flood Co");
    expect(fetchSpy).toHaveBeenCalled();
  });

  it("a cache hit within the tier names the source that wrote it", async () => {
    S.cacheRows = [{ dataSourceId: 3, data: { status: "mapped", zone: "Zone AE", riskLevel: "high" }, fetchedAt: new Date(), successfulFetch: true }];
    S.sourceRows = [{ id: 3, title: "FEMA NFHL (public)", key: "fema_nfhl", accessLevel: "public" }];
    const { DataSourceBroker } = await import("../../server/services/data-source-broker");
    const r = await new DataSourceBroker().lookup("flood_zone", { ...at, maxTier: "free" });
    expect(r.fromCache).toBe(true);
    expect(r.source).toMatchObject({ id: 3, title: "FEMA NFHL (public)", tier: "free", costCents: 0 });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("independent audit of 60ebfd9 — the rest of the population", () => {
  it("a flood row cached before the fix (no status — possibly the invented Zone X) is not served", async () => {
    S.cacheRows = [{ dataSourceId: 3, data: { zone: "Zone X (Minimal Flood Hazard)", riskLevel: "low" }, fetchedAt: new Date(), successfulFetch: true }];
    S.sourceRows = [{ id: 3, title: "FEMA NFHL (public)", key: "fema_nfhl", accessLevel: "public", isEnabled: true }];
    femaReturns([]);
    const { DataSourceBroker } = await import("../../server/services/data-source-broker");
    const r = await new DataSourceBroker().lookup("flood_zone", { ...at, maxTier: "free" });
    expect(r.fromCache).toBe(false);
    expect(r.data.status).toBe("unmapped");
  });

  it("a disabled source's cached row is not served", async () => {
    S.cacheRows = [{ dataSourceId: 3, data: { status: "mapped", zone: "Zone AE", riskLevel: "high" }, fetchedAt: new Date(), successfulFetch: true }];
    S.sourceRows = [{ id: 3, title: "Old flood source", key: "old", accessLevel: "public", isEnabled: false }];
    femaReturns([{ attributes: { FLD_ZONE: "X" } }]);
    const { DataSourceBroker } = await import("../../server/services/data-source-broker");
    const r = await new DataSourceBroker().lookup("flood_zone", { ...at, maxTier: "free" });
    expect(r.fromCache).toBe(false);
  });

  it("'AREA NOT INCLUDED' is unmapped, not high risk; OPEN WATER is not a verdict", async () => {
    const { floodZoneFromNfhl } = await import("../../server/services/data-source-broker");
    const now = new Date();
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "AREA NOT INCLUDED" } }], now)).toMatchObject({ status: "unmapped", riskLevel: "unknown" });
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "OPEN WATER" } }], now).riskLevel).toBe("unknown");
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "A12" } }], now).riskLevel).toBe("high");
    expect(floodZoneFromNfhl([{ attributes: { FLD_ZONE: "AR/AE" } }], now).riskLevel).toBe("high");
  });

  it("shaded X is labelled so a label-only scorer does not call it minimal", async () => {
    const { floodZoneFromNfhl } = await import("../../server/services/data-source-broker");
    const { floodZoneSubScore } = await import("../../server/services/publicParcelReport");
    const shaded = floodZoneFromNfhl([{ attributes: { FLD_ZONE: "X", ZONE_SUBTY: "0.2 PCT ANNUAL CHANCE FLOOD HAZARD" } }], new Date());
    expect(shaded.zone).toBe("Zone SHADED X");
    expect(floodZoneSubScore(shaded.zone)).toBe(75);
    expect(floodZoneSubScore("Zone X")).toBe(95);
  });

  it("the auto due-diligence engine (the third FEMA caller) no longer reports 'likely Zone X'", async () => {
    fetchSpy.mockImplementation(async (url: unknown) => {
      if (String(url).includes("NFHL/MapServer/28/query")) return { ok: true, status: 200, json: async () => ({ features: [] }) };
      throw new Error("offline");
    });
    const { runAutoDueDiligence } = await import("../../server/services/dueDiligenceEngine");
    const report = await runAutoDueDiligence(1, 5, 30.1, -97.5);
    const floodCalls = fetchSpy.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("NFHL"));
    expect(floodCalls.every((u) => u.includes("/arcgis/"))).toBe(true);
    expect(report.checks.floodZone.zone).toBeNull();
    expect(report.checks.floodZone.risk).toBe("unknown");
    expect(report.greenFlags.join(" ")).not.toMatch(/flood/i);
  });
});
