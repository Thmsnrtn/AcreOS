/**
 * Founder ruling 2026-09-29 #2 — parcel data from every source, layered, with
 * Regrid the primary parcel and owner layer once licensed.
 *
 * What this pins, each against the behaviour it replaced:
 *  1. The layer order is one declared constant, and the lookups walk it:
 *     Regrid first when a key exists, free county data behind it.
 *  2. An org's OWN Regrid key is what calls Regrid. Before, the registry
 *     resolved the BYOK key, passed it to the provider, and the provider
 *     dropped it — the parcel service called Regrid on the PLATFORM key while
 *     the registry, believing BYOK served, debited no credit.
 *  3. The shared snapshot (a GLOBAL cache every org reads) never receives a
 *     Regrid answer while Regrid's licence says it may not be re-served; a
 *     public county answer still goes there.
 *  4. The open-data provider no longer answers parcel_data (it labelled a
 *     platform-key Regrid answer "County GIS" at $0).
 *  5. A source that names no owner yields null, never "Unknown".
 *  6. County-list owner names are split by one rule that invents no names.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { stripComments } from "../helpers/stripComments";

const h = vi.hoisted(() => ({
  fetches: [] as Array<{ url: string; auth: string | undefined }>,
  regridFeatures: [] as Array<Record<string, unknown>>,
  countyEndpoint: null as Record<string, unknown> | null,
  countyFeatures: [] as Array<Record<string, unknown>>,
  orgRegridKey: null as string | null,
  snapshotWrites: [] as Array<Record<string, unknown>>,
}));

vi.mock("../../server/utils/logger", () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock("../../server/services/providers/fetchGeo", () => ({
  fetchGeo: async (url: string, init: { headers?: Record<string, string> }) => {
    h.fetches.push({ url, auth: init?.headers?.Authorization });
    const body = url.includes("app.regrid.com")
      ? { results: h.regridFeatures, parcels: { features: h.regridFeatures } }
      : { features: h.countyFeatures };
    return { ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) };
  },
}));
vi.mock("../../server/services/providers/resolveProviderCredential", () => ({
  resolveProviderCredential: async () => h.orgRegridKey,
}));
vi.mock("../../server/storage", () => ({
  storage: {
    getParcelSnapshot: async () => undefined,
    upsertParcelSnapshot: async (row: Record<string, unknown>) => {
      h.snapshotWrites.push(row);
      return row;
    },
    getOrganizationIntegration: async () => null,
    logApiUsage: async () => undefined,
  },
}));
vi.mock("../../server/services/residentialComps", () => ({ getOrgBusinessType: async () => "land_flipper" }));
vi.mock("../../server/db", () => {
  const chain: Record<string, unknown> = {};
  chain.from = () => chain;
  chain.where = () => chain;
  chain.limit = () => chain;
  chain.then = (f: (v: unknown) => unknown, r?: (e: unknown) => unknown) =>
    Promise.resolve(h.countyEndpoint ? [h.countyEndpoint] : []).then(f, r);
  // A county hit stamps its endpoint verified.
  const update = () => ({ set: () => ({ where: async () => [] }) });
  return { db: { select: () => chain, update } };
});
vi.mock("../../server/services/data-cache/observation-log", () => ({
  recordProviderParcelFacts: async () => undefined,
  coerceSaleDate: () => null,
}));
vi.mock("../../server/services/providerIntelligence", () => ({ recordLookup: async () => undefined }));
vi.mock("../../server/services/coverageLedger", () => ({ enqueueCountyForDiscovery: async () => undefined }));

import {
  lookupParcelByAPN,
  lookupParcelByCoordinates,
} from "../../server/services/parcel";
import { regridProvider } from "../../server/services/providers/regrid-provider";
import { openDataProvider } from "../../server/services/providers/open-data-provider";
import { sharedSnapshotSources } from "../../server/storage/gisRepo";
import { getComparableProperties } from "../../server/services/comps";
import { splitOwnerName } from "@shared/parcel/ownerName";

const regridFeature = (props: Record<string, unknown> = {}) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [[[0, 0], [0, 1], [1, 1], [0, 0]]] },
  properties: { fields: { parcelnumb: "123-45", owner: "JANE DOE", ll_uuid: "u1", lat: 30, lon: -97, county: "Travis", state2: "TX", ...props } },
});

let prevKey: string | undefined;
beforeEach(() => {
  h.fetches = [];
  h.regridFeatures = [regridFeature()];
  h.countyEndpoint = null;
  h.countyFeatures = [];
  h.orgRegridKey = null;
  h.snapshotWrites = [];
  prevKey = process.env.REGRID_API_KEY;
  process.env.REGRID_API_KEY = "platform-key";
});
afterEach(() => {
  if (prevKey === undefined) delete process.env.REGRID_API_KEY;
  else process.env.REGRID_API_KEY = prevKey;
});

describe("the layer order is declared once and walked", () => {
  const COUNTY = { state: "TX", county: "Travis", isActive: true, endpointType: "arcgis_rest", baseUrl: "https://gis.example/q", apnField: "APN" };
  const COUNTY_HIT = [{ attributes: { APN: "123-45", OWNER: "COUNTY RECORD OWNER" }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }];

  it("the org's OWN Regrid key: Regrid answers before the county is asked", async () => {
    h.orgRegridKey = "org-own-key";
    h.countyEndpoint = COUNTY;
    h.countyFeatures = COUNTY_HIT;
    const r = await lookupParcelByAPN("123-45", "tx/travis", 7);
    expect(r.source).toBe("regrid");
    expect(h.fetches.every((f) => f.url.includes("app.regrid.com"))).toBe(true);
  });

  it("AcreOS's platform licence: free county data first — no licensed call where the county answers", async () => {
    h.countyEndpoint = COUNTY;
    h.countyFeatures = COUNTY_HIT;
    const r = await lookupParcelByAPN("123-45", "tx/travis", 7);
    expect(r.source).toBe("county_gis");
    expect(h.fetches.some((f) => f.url.includes("app.regrid.com"))).toBe(false);
  });

  it("…and the platform licence answers where the county does not", async () => {
    const r = await lookupParcelByAPN("123-45", "tx/travis", 7);
    expect(r.source).toBe("regrid");
    expect(h.fetches.filter((f) => f.url.includes("app.regrid.com")).every((f) => f.auth === "Bearer platform-key")).toBe(true);
  });

  it("with no licence, the county layer answers and Regrid is never called", async () => {
    delete process.env.REGRID_API_KEY;
    h.countyEndpoint = { state: "TX", county: "Travis", isActive: true, endpointType: "arcgis_rest", baseUrl: "https://gis.example/q", apnField: "APN" };
    h.countyFeatures = [{ attributes: { APN: "123-45", OWNER: "COUNTY RECORD OWNER" }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }];
    const r = await lookupParcelByAPN("123-45", "tx/travis");
    expect(r.found).toBe(true);
    expect(r.source).toBe("county_gis");
    expect(h.fetches.some((f) => f.url.includes("app.regrid.com"))).toBe(false);
  });

  it("with no licence and no county coverage, it says so — it does not invent a parcel", async () => {
    delete process.env.REGRID_API_KEY;
    const r = await lookupParcelByAPN("123-45", "tx/travis", 7);
    expect(r.found).toBe(false);
    expect(r.error).toMatch(/Regrid API key not configured/);
  });
});

describe("an org's own Regrid key is the key that calls Regrid", () => {
  it("parcel service: the org's BYOK key, not the platform's", async () => {
    h.orgRegridKey = "org-own-key";
    await lookupParcelByAPN("123-45", "tx/travis", 7);
    await lookupParcelByCoordinates(30, -97, { organizationId: 7 });
    const regridCalls = h.fetches.filter((f) => f.url.includes("app.regrid.com"));
    expect(regridCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of regridCalls) expect(c.auth).toBe("Bearer org-own-key");
  });

  it("registry provider: the key the registry resolved reaches Regrid (it used to be dropped)", async () => {
    await regridProvider.lookup("parcel_data", { type: "coordinates", latitude: 30, longitude: -97 }, { apiKeyOverride: "byok-from-registry" });
    await regridProvider.lookup("parcel_data", { type: "apn", apn: "123-45", state: "tx", county: "travis" }, { apiKeyOverride: "byok-from-registry" });
    const regridCalls = h.fetches.filter((f) => f.url.includes("app.regrid.com"));
    expect(regridCalls.length).toBeGreaterThanOrEqual(2);
    for (const c of regridCalls) expect(c.auth).toBe("Bearer byok-from-registry");
  });
});

describe("comps: the org's own key, and one org's comps are not another's (audit of 6b730aa)", () => {
  const comps: Array<{ auth: string | undefined }> = [];
  beforeEach(() => {
    comps.length = 0;
    vi.stubGlobal("fetch", async (_url: string, init: { headers: Record<string, string> }) => {
      comps.push({ auth: init.headers.Authorization });
      // One parcel, so the result is complete and CACHED (an empty one is not).
      return {
        ok: true,
        status: 200,
        json: async () => ({ results: [{ properties: { parcelnumb: "9", lat: 33, lon: -100, ll_gisacre: 10, county: "Llano", state2: "TX" } }] }),
      };
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  it("the registry's BYOK key reaches the comps call (it used to fall back to the platform key)", async () => {
    await regridProvider.lookup("comps", { type: "coordinates", latitude: 31, longitude: -98 }, { apiKeyOverride: "byok-comps" });
    expect(comps).toEqual([{ auth: "Bearer byok-comps" }]);
  });

  it("an org's own key, read from the canonical vault resolver", async () => {
    h.orgRegridKey = "org-vault-key";
    await getComparableProperties(32, -99, 5, {}, 7);
    expect(comps).toEqual([{ auth: "Bearer org-vault-key" }]);
  });

  it("the same point for a second org is fetched for that org — not served from the first org's cache", async () => {
    await getComparableProperties(33, -100, 5, {}, 7);
    await getComparableProperties(33, -100, 5, {}, 8);
    expect(comps).toHaveLength(2);
  });
});

describe("the GLOBAL snapshot cache holds only what its licence lets every org see", () => {
  it("while Regrid is not redistributable, only county records are shared", () => {
    expect(sharedSnapshotSources()).toEqual(["county_gis"]);
  });

  it("a Regrid answer is NOT written to the shared snapshot (it was, and every org then read it free)", async () => {
    const r = await lookupParcelByAPN("123-45", "tx/travis", 7);
    expect(r.source).toBe("regrid");
    expect(h.snapshotWrites).toEqual([]);
  });

  it("a public county answer still is", async () => {
    delete process.env.REGRID_API_KEY;
    h.countyEndpoint = { state: "TX", county: "Travis", isActive: true, endpointType: "arcgis_rest", baseUrl: "https://gis.example/q", apnField: "APN" };
    h.countyFeatures = [{ attributes: { APN: "123-45", OWNER: "COUNTY RECORD OWNER" }, geometry: { rings: [[[0, 0], [0, 1], [1, 1], [0, 0]]] } }];
    await lookupParcelByAPN("123-45", "tx/travis");
    expect(h.snapshotWrites).toHaveLength(1);
    expect(h.snapshotWrites[0].source).toBe("county_gis");
  });
});

describe("open-data does not answer parcel_data", () => {
  it("it is not a parcel_data provider at all", () => {
    expect(openDataProvider.categories).not.toContain("parcel_data");
  });
});

describe("no placeholder owner", () => {
  it("a Regrid parcel naming no owner has owner null, not \"Unknown\"", async () => {
    h.regridFeatures = [regridFeature({ owner: "" })];
    const r = await lookupParcelByAPN("123-45", "tx/travis");
    expect(r.found).toBe(true);
    expect(r.parcel!.data.owner).toBeNull();
  });
  it("a source that literally says Unknown is read as no owner", async () => {
    h.regridFeatures = [regridFeature({ owner: "UNKNOWN" })];
    const r = await lookupParcelByAPN("123-45", "tx/travis");
    expect(r.parcel!.data.owner).toBeNull();
  });
});

describe("owner names from a county list invent nothing", () => {
  it.each([
    ["SMITH FAMILY TRUST", "", "SMITH FAMILY TRUST"],
    ["ACME LAND LLC", "", "ACME LAND LLC"],
    ["ACME", "", "ACME"],
    ["JONES, MARY", "MARY", "JONES"],
    ["JOHN SMITH", "JOHN", "SMITH"],
    ["ESTATE OF R. BROWN", "", "ESTATE OF R. BROWN"],
    ["SMITH JOHN ET AL", "", "SMITH JOHN ET AL"],
  ])("%s → first %j, last %j", (raw, first, last) => {
    expect(splitOwnerName(raw)).toEqual({ firstName: first, lastName: last });
  });

  it("an entity is recognised by a whole word, not a substring", () => {
    expect(splitOwnerName("TRUSTY JONES")).toEqual({ firstName: "TRUSTY", lastName: "JONES" });
    expect(splitOwnerName("COUNTRY ROAD PARTNERS")).toEqual({ firstName: "", lastName: "COUNTRY ROAD PARTNERS" });
  });

  it("both importers use the one rule", () => {
    for (const rel of ["server/routes-leads.ts", "server/services/taxDelinquentPipeline.ts"]) {
      const src = stripComments(readFileSync(resolve(__dirname, "../..", rel), "utf8"));
      expect(src, rel).toContain("splitOwnerName(");
      // The inventions this replaced.
      expect(src, rel).not.toMatch(/parts\.slice\(1\)\.join\(" "\) \|\| parts\[0\]/);
      expect(src, rel).not.toMatch(/nameParts\[nameParts\.length - 1\]/);
    }
  });
});
