/**
 * Founder decision 2026-10-11: a Tennessee coordinate lookup never uses the
 * state's non-commercial parcel service. In order:
 *   1. AcreOS's own kept county parcels (loaded from the Comptroller download)
 *      answer when one contains the point;
 *   2. else the org's OWN Regrid key;
 *   3. else a plain-words refusal — never the platform Regrid key, never a
 *      statewide row (even one still active in the database).
 * Every coordinate entry point is driven: lookupParcelByCoordinates (parcels
 * lookup by lat/lng, field scout, drive mode, deals tax lookup all call it),
 * the Regrid provider's coordinate fallback, and the county-GIS provider's
 * registry coordinate lookups. Lookups by APN are unchanged.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { judgeRefusal } from "@shared/refusal/plainRefusal";

const TN_SERVICE_ROW = {
  id: 9,
  state: "TN",
  county: "*",
  isActive: true,
  endpointType: "arcgis_feature",
  baseUrl: "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer",
  layerId: "0",
};

const h = vi.hoisted(() => ({
  fetches: [] as string[],
  owned: null as null | Record<string, unknown>,
  orgRegridKey: null as string | null,
  endpointRows: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/providers/fetchGeo", async () => {
  const { assertOutboundAllowed } = await import("../../server/services/providers/blockedOutboundSources");
  return {
    fetchGeo: async (url: string) => {
      h.fetches.push(url);
      assertOutboundAllowed(url);
      const body = url.includes("app.regrid.com")
        ? { results: [{ geometry: { type: "Polygon", coordinates: [[[-86, 36], [-86, 36.1], [-85.9, 36.1], [-86, 36]]] }, properties: { fields: { parcelnumb: "R-1", owner: "REGRID OWNER", lat: 36, lon: -86 } } }] }
        : { features: [{ attributes: { PARCELID: "TN-SVC-1", OWNER: "SERVICE OWNER" }, geometry: { rings: [[[-86, 36], [-86, 36.1], [-85.9, 36.1], [-86, 36]]] } }] };
      return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
    },
  };
});
vi.mock("../../server/services/providers/resolveProviderCredential", () => ({ resolveProviderCredential: async () => h.orgRegridKey }));
vi.mock("../../server/storage", () => ({
  storage: { getParcelSnapshot: async () => undefined, upsertParcelSnapshot: async (r: unknown) => r, getOrganizationIntegration: async () => null, logApiUsage: async () => undefined },
}));
vi.mock("../../server/services/residentialComps", () => ({ getOrgBusinessType: async () => "land_flipper" }));
vi.mock("../../server/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) => Promise.resolve(h.endpointRows).then(f, r);
  const update = () => ({ set: () => ({ where: async () => [] }) });
  return { db: { select: () => chain, update } };
});
vi.mock("../../server/services/data-cache/observation-log", () => ({ recordProviderParcelFacts: async () => undefined, coerceSaleDate: () => null }));
vi.mock("../../server/services/providerIntelligence", () => ({ recordLookup: async () => undefined }));
vi.mock("../../server/services/coverageLedger", () => ({ enqueueCountyForDiscovery: async () => undefined }));
vi.mock("../../server/services/landData/ownedParcelStore", () => ({
  ownedParcelAtPoint: async () => h.owned,
}));

import { lookupParcelByCoordinates, lookupFromCountyGISByPoint, TN_PARCELS_NOT_YET } from "../../server/services/parcel";
import { countyGisProvider } from "../../server/services/providers/county-gis-provider";
import { regridProvider } from "../../server/services/providers/regrid-provider";

// Smithville, DeKalb County, TN.
const TN = { lat: 35.96, lng: -85.81 };
const OWNED = {
  apn: "021 045.00",
  state: "TN",
  county: "dekalb",
  boundary: { type: "Polygon", coordinates: [[[-85.82, 35.95], [-85.8, 35.95], [-85.8, 35.97], [-85.82, 35.95]]] },
  centroid: { lat: 35.96, lng: -85.81 },
  acres: 12.5,
  sourceName: "TN Comptroller parcel download",
  fetchedAt: new Date("2026-10-11T00:00:00Z"),
};

let prevPlatform: string | undefined;
beforeEach(() => {
  h.fetches = [];
  h.owned = null;
  h.orgRegridKey = null;
  // The statewide row as production still holds it before migration 0271.
  h.endpointRows = [TN_SERVICE_ROW];
  prevPlatform = process.env.REGRID_API_KEY;
  process.env.REGRID_API_KEY = "platform-key";
  return () => {
    if (prevPlatform === undefined) delete process.env.REGRID_API_KEY;
    else process.env.REGRID_API_KEY = prevPlatform;
  };
});

const touchedService = () => h.fetches.some((u) => /tennessee_property_boundaries_public_use/i.test(u));

describe("Tennessee coordinate lookups", () => {
  it("1. a kept county parcel answers first — nothing is fetched", async () => {
    h.owned = OWNED;
    h.orgRegridKey = "org-key";
    const r = await lookupParcelByCoordinates(TN.lat, TN.lng, { organizationId: 7 });
    expect(r).toMatchObject({ found: true, source: "owned", parcel: { apn: "021 045.00" } });
    expect(h.fetches).toEqual([]);
  });

  it("2. else the org's OWN Regrid key", async () => {
    h.orgRegridKey = "org-key";
    const r = await lookupParcelByCoordinates(TN.lat, TN.lng, { organizationId: 7 });
    expect(r.source).toBe("regrid");
    expect(h.fetches.every((u) => u.includes("app.regrid.com"))).toBe(true);
  });

  it("3. else a plain refusal — not the platform key, not the statewide row", async () => {
    const r = await lookupParcelByCoordinates(TN.lat, TN.lng, { organizationId: 7 });
    expect(r).toEqual({ found: false, error: TN_PARCELS_NOT_YET });
    expect(h.fetches).toEqual([]);
    expect(TN_PARCELS_NOT_YET).toMatch(/^Tennessee parcel details aren't available yet/);
    expect(judgeRefusal(TN_PARCELS_NOT_YET).problems).toEqual([]);
  });

  it("the Regrid provider's coordinate fallback (platform key) refuses the same way", async () => {
    const r = await regridProvider.lookup("parcel_data", { type: "coordinates", latitude: TN.lat, longitude: TN.lng }).catch((e: Error) => e);
    expect(touchedService()).toBe(false);
    expect(h.fetches.filter((u) => u.includes("app.regrid.com"))).toEqual([]);
    if (!(r instanceof Error)) expect((r as { data: unknown }).data).toBeNull();
  });

  it("the county-GIS provider's registry coordinate lookup: kept parcel, or a refusal — never the service", async () => {
    await expect(countyGisProvider.lookup("parcel_data", { type: "coordinates", latitude: TN.lat, longitude: TN.lng })).rejects.toThrow(TN_PARCELS_NOT_YET);
    h.owned = OWNED;
    const hit = await countyGisProvider.lookup("parcel_data", { type: "coordinates", latitude: TN.lat, longitude: TN.lng });
    expect((hit.data as { apn: string }).apn).toBe("021 045.00");
    expect(touchedService()).toBe(false);
  });

  it("a row still pointing at the service is skipped by the statewide point lookup itself", async () => {
    const r = await lookupFromCountyGISByPoint(TN.lat, TN.lng);
    expect(r).toBeNull();
    expect(touchedService()).toBe(false);
  });
});

describe("outside Tennessee nothing changes", () => {
  it("a Kentucky point still walks the normal layers (statewide rows, then Regrid)", async () => {
    h.endpointRows = [];
    const r = await lookupParcelByCoordinates(37.84, -84.27, { organizationId: 7 });
    expect(r.error).not.toBe(TN_PARCELS_NOT_YET);
    expect(h.fetches.some((u) => u.includes("app.regrid.com"))).toBe(true);
  });
});
