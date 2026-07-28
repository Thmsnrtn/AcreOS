/**
 * Tier-1 open-data signal expansion (founder ruling #10, 2026-07-28):
 * wildfire_hazard (USFS WHP classified identify), broadband (FCC BDC,
 * keyed-optional), soil septic-suitability extension (USDA SDA), and
 * environmental EPA depth (ECHO + UST Finder) — all through the existing
 * broker seam. No network: every parser is exercised against canned
 * responses matching the live-verified 2026-07-28 shapes.
 *
 * Also pins category registration completeness across the seam
 * (provider map / cache TTL / license register / credit weights) so a new
 * category can't ship half-wired.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("../../server/utils/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

// Chainable Drizzle stub (same pattern as dataSourceBrokerBuiltinFetch.test):
// resolves every select to [] (empty, unseeded data_sources) and swallows
// cache inserts.
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

import {
  DataSourceBroker,
  whpClassToLabel,
  parseBdcAvailability,
  parseSdaColumnRows,
  FCC_BDC_UNKEYED_REASON,
  WHP_CLASS_LABELS,
} from "../../server/services/data-source-broker";
import { cacheTtlMs, DAY_MS } from "../../server/services/providers/cache-ttl";
import {
  licenseFor,
  redistributableFor,
  mayCacheAndRedistribute,
} from "../../server/services/providers/data-licenses";
import { creditActionForCategory } from "../../shared/billing/credit-weights";

const originalFetch = global.fetch;
const originalToken = process.env.FCC_BDC_TOKEN;
const originalUsername = process.env.FCC_BDC_USERNAME;

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchSpy = vi.fn();
  global.fetch = fetchSpy as unknown as typeof fetch;
  delete process.env.FCC_BDC_TOKEN;
  delete process.env.FCC_BDC_USERNAME;
});

afterEach(() => {
  global.fetch = originalFetch;
  if (originalToken === undefined) delete process.env.FCC_BDC_TOKEN;
  else process.env.FCC_BDC_TOKEN = originalToken;
  if (originalUsername === undefined) delete process.env.FCC_BDC_USERNAME;
  else process.env.FCC_BDC_USERNAME = originalUsername;
  vi.clearAllMocks();
});

function jsonResponse(payload: unknown, ok = true, status = 200) {
  return {
    ok,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload),
  };
}

// ── WHP class → label mapping ─────────────────────────────────────

describe("whpClassToLabel — documented WHP classified legend only", () => {
  it("maps classes 1-5 to the contract labels", () => {
    expect(whpClassToLabel("1")).toEqual({ whpClass: 1, whpLabel: "very_low", note: null });
    expect(whpClassToLabel("2")).toEqual({ whpClass: 2, whpLabel: "low", note: null });
    expect(whpClassToLabel("3")).toEqual({ whpClass: 3, whpLabel: "moderate", note: null });
    expect(whpClassToLabel("4")).toEqual({ whpClass: 4, whpLabel: "high", note: null });
    expect(whpClassToLabel("5")).toEqual({ whpClass: 5, whpLabel: "very_high", note: null });
  });

  it("NoData → nulls with an honest note (never a guessed class)", () => {
    const r = whpClassToLabel("NoData");
    expect(r.whpClass).toBeNull();
    expect(r.whpLabel).toBeNull();
    expect(r.note).toMatch(/no data/i);
  });

  it("non-burnable (6) and water (7) legend categories → nulls + note", () => {
    expect(whpClassToLabel("6").whpClass).toBeNull();
    expect(whpClassToLabel("6").note).toMatch(/non-burnable/i);
    expect(whpClassToLabel("7").whpClass).toBeNull();
    expect(whpClassToLabel("7").note).toMatch(/water/i);
  });

  it("continuous-index values (e.g. 4800) and garbage are unmappable → nulls + note", () => {
    // 4800 is what the CONTINUOUS WHP service returns — must never be
    // presented as a class.
    const cont = whpClassToLabel("4800");
    expect(cont.whpClass).toBeNull();
    expect(cont.whpLabel).toBeNull();
    expect(cont.note).toMatch(/unmappable/i);
    expect(whpClassToLabel("banana").whpClass).toBeNull();
    expect(whpClassToLabel(null).whpClass).toBeNull();
    expect(whpClassToLabel("").whpClass).toBeNull();
  });

  it("legend map covers exactly classes 1-5", () => {
    expect(Object.keys(WHP_CLASS_LABELS).map(Number).sort()).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("broker wildfire_hazard lookup (canned identify responses)", () => {
  it("queries the CLASSIFIED WHP ImageServer and returns mapped class/label", async () => {
    // Live-verified identify shape (2026-07-28).
    fetchSpy.mockResolvedValue(jsonResponse({ objectId: 0, name: "Pixel", value: "4" }));

    const broker = new DataSourceBroker();
    const result = await broker.lookup("wildfire_hazard", {
      latitude: 39.65,
      longitude: -105.35,
      maxTier: "free",
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const url = String(fetchSpy.mock.calls[0][0]);
    expect(url).toContain("imagery.geoplatform.gov/iipp/rest/services/Fire_Aviation");
    expect(url).toContain("WildfireHazardPotentialClassified/ImageServer/identify");

    expect(result.success).toBe(true);
    expect(result.data.whpClass).toBe(4);
    expect(result.data.whpLabel).toBe("high");
    expect(result.data.note).toBeNull();
    expect(result.data.source).toBe("USFS Wildfire Hazard Potential");
    expect(result.source.costCents).toBe(0);
  });

  it("NoData pixel → honest nulls + note (still a successful, non-fabricated answer)", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({ objectId: 0, name: "Pixel", value: "NoData" }));

    const broker = new DataSourceBroker();
    const result = await broker.lookup("wildfire_hazard", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    expect(result.data.whpClass).toBeNull();
    expect(result.data.whpLabel).toBeNull();
    expect(result.data.note).toMatch(/no data/i);
  });

  it("upstream failure → success:false, no fabricated class", async () => {
    fetchSpy.mockResolvedValue(jsonResponse({}, false, 500));

    const broker = new DataSourceBroker();
    const result = await broker.lookup("wildfire_hazard", {
      latitude: 39.65,
      longitude: -105.35,
      maxTier: "free",
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
  });
});

// ── Broadband (FCC BDC, keyed-optional) ───────────────────────────

describe("broker broadband lookup — keyed-optional honesty", () => {
  it("UNKEYED: success:false with the exact reason, and NO network call", async () => {
    const broker = new DataSourceBroker();
    const result = await broker.lookup("broadband", {
      latitude: 30.2672,
      longitude: -97.7431,
      maxTier: "free",
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.fallbacksUsed).toContain(FCC_BDC_UNKEYED_REASON);
    expect(FCC_BDC_UNKEYED_REASON).toBe("FCC_BDC_TOKEN not set — broadband check unavailable");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("KEYED: block-find then BDC availability, parsed to availability facts only", async () => {
    process.env.FCC_BDC_TOKEN = "test-token";
    process.env.FCC_BDC_USERNAME = "probe@example.com";

    fetchSpy.mockImplementation(async (rawUrl: string) => {
      const url = String(rawUrl);
      if (url.includes("geo.fcc.gov/api/census/block/find")) {
        return jsonResponse({ Block: { FIPS: "480453795003021" } });
      }
      if (url.includes("broadbandmap.fcc.gov/api/public/map/availability/blockcode/480453795003021")) {
        // Envelope shape live-verified 2026-07-28; record columns per the
        // published BDC availability data spec. location_id is a Fabric field
        // and must NOT survive into our result.
        return jsonResponse({
          status: "successful",
          status_code: 200,
          data: [
            { location_id: 999111, provider_id: 130077, brand_name: "AT&T", technology: 50, max_advertised_download_speed: 5000, max_advertised_upload_speed: 5000 },
            { location_id: 999111, provider_id: 130403, brand_name: "Spectrum", technology: 40, max_advertised_download_speed: 1000, max_advertised_upload_speed: 35 },
            { location_id: 999111, provider_id: 130077, brand_name: "AT&T", technology: 10, max_advertised_download_speed: 100, max_advertised_upload_speed: 20 },
          ],
        });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("broadband", {
      latitude: 30.2672,
      longitude: -97.7431,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    expect(result.data.served).toBe(true);
    expect(result.data.maxDownMbps).toBe(5000);
    expect(result.data.maxUpMbps).toBe(5000);
    expect(result.data.providerCount).toBe(2); // distinct provider_ids
    expect(result.data.technologies).toEqual(["Cable", "Copper", "Fiber"]);
    expect(result.data.source).toBe("FCC Broadband Data Collection");
    // Fabric exclusion: no location records in what we keep.
    expect(JSON.stringify(result.data)).not.toContain("999111");

    // Documented auth headers were sent to the BDC call.
    const bdcCall = fetchSpy.mock.calls.find((c) => String(c[0]).includes("broadbandmap.fcc.gov"))!;
    const headers = (bdcCall[1] as { headers: Record<string, string> }).headers;
    expect(headers["hash_value"]).toBe("test-token");
    expect(headers["username"]).toBe("probe@example.com");
  });

  it("KEYED with an unrecognized response shape → success:false (refuses to guess)", async () => {
    process.env.FCC_BDC_TOKEN = "test-token";
    fetchSpy.mockImplementation(async (rawUrl: string) => {
      const url = String(rawUrl);
      if (url.includes("geo.fcc.gov")) return jsonResponse({ Block: { FIPS: "480453795003021" } });
      return jsonResponse({ totally: "different" });
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("broadband", {
      latitude: 30.2672,
      longitude: -97.7431,
      maxTier: "free",
    });

    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.fallbacksUsed.join(" ")).toMatch(/unrecognized|refusing/i);
  });
});

describe("parseBdcAvailability — availability facts only", () => {
  it("zero filings for the block = honest unserved (keyed context only)", () => {
    const r = parseBdcAvailability([]);
    expect(r.served).toBe(false);
    expect(r.maxDownMbps).toBeNull();
    expect(r.maxUpMbps).toBeNull();
    expect(r.technologies).toEqual([]);
    expect(r.providerCount).toBe(0);
  });

  it("unknown technology codes pass through honestly, never guessed", () => {
    const r = parseBdcAvailability([{ provider_id: 1, technology: 99, max_advertised_download_speed: 10 }]);
    expect(r.technologies).toEqual(["tech_99"]);
    expect(r.maxDownMbps).toBe(10);
    expect(r.maxUpMbps).toBeNull();
  });
});

// ── Soil septic extension (additive) ──────────────────────────────

describe("broker soil lookup — septic suitability additive extension", () => {
  function mockSdaFetches(opts: { septicFails?: boolean } = {}) {
    fetchSpy.mockImplementation(async (_url: string, init?: { body?: string }) => {
      const body = String(init?.body ?? "");
      if (body.includes("SDA_Get_Mukey_from_intersection_with_WktWgs84") && body.includes("musym")) {
        // Basic query — live-verified json+columnname shape.
        return jsonResponse({ Table: [["musym", "muname", "mukey"], ["Gt", "Glenbar clay loam, 0 to 2 percent slopes", "53350"]] });
      }
      if (body.includes("muaggatt")) {
        return jsonResponse({
          Table: [
            ["mukey", "muname", "capclass", "hydgrpdcd", "drainagecl", "flodfreqdcd", "hydricrating", "farmlndcl"],
            ["53350", "Glenbar clay loam, 0 to 2 percent slopes", "II", "B", "Well drained", "None", "No", "Prime farmland if irrigated"],
          ],
        });
      }
      if (body.includes("cointerp")) {
        if (opts.septicFails) return jsonResponse({}, false, 500);
        // Live-verified septic interpretation row (2026-07-28).
        return jsonResponse({ Table: [["compname", "interphrc"], ["Glenbar", "Very limited"]] });
      }
      throw new Error("unexpected SDA query in test");
    });
  }

  it("adds septicRating + septicRatingSource WITHOUT breaking the existing shape", async () => {
    mockSdaFetches();
    const broker = new DataSourceBroker();
    const result = await broker.lookup("soil", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    // Existing consumer-facing fields (checklistAnnotation, dueDiligence,
    // parcelIntelligenceFusion, mcp/supportAgent read these) — unchanged.
    expect(result.data.soilType).toBe("Glenbar clay loam, 0 to 2 percent slopes");
    expect(result.data.soilSymbol).toBe("Gt");
    expect(result.data.suitability).toBe("prime"); // capclass II
    expect(result.data.drainage).toBe("Well drained");
    expect(result.data.capabilityClass).toBe("II");
    expect(result.data.hydrologicGroup).toBe("B");
    expect(result.data.floodingFrequency).toBe("None");
    expect(result.data.hydricRating).toBe("No");
    expect(result.data.farmlandClass).toBe("Prime farmland if irrigated");
    expect(result.data.primeFarmland).toBe(true);
    expect(result.data.source).toBe("USDA NRCS SDA");
    // Additive contract fields.
    expect(result.data.septicRating).toBe("Very limited");
    expect(result.data.septicRatingSource).toBe("USDA SSURGO septic tank absorption fields");
  });

  it("septic sub-fetch failure → septicRating null, existing fields intact", async () => {
    mockSdaFetches({ septicFails: true });
    const broker = new DataSourceBroker();
    const result = await broker.lookup("soil", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    expect(result.data.soilType).toBe("Glenbar clay loam, 0 to 2 percent slopes");
    expect(result.data.septicRating).toBeNull();
    expect(result.data.septicRatingSource).toBe("USDA SSURGO septic tank absorption fields");
  });

  it("uses SDA's documented point-intersection helper (the old STContains form is rejected upstream)", async () => {
    mockSdaFetches();
    const broker = new DataSourceBroker();
    await broker.lookup("soil", { latitude: 33.4484, longitude: -112.074, maxTier: "free" });
    const basicBody = String((fetchSpy.mock.calls[0][1] as { body: string }).body);
    expect(basicBody).toContain("SDA_Get_Mukey_from_intersection_with_WktWgs84");
    expect(basicBody).not.toContain("mupolygonGeometry");
  });
});

describe("parseSdaColumnRows — json+columnname payloads", () => {
  it("zips header + value rows into objects", () => {
    const rows = parseSdaColumnRows({ Table: [["a", "b"], ["1", "2"], ["3", "4"]] });
    expect(rows).toEqual([{ a: "1", b: "2" }, { a: "3", b: "4" }]);
  });

  it("returns [] for empty/malformed payloads (no invented rows)", () => {
    expect(parseSdaColumnRows({})).toEqual([]);
    expect(parseSdaColumnRows({ Table: [["only-header"]] })).toEqual([]);
    expect(parseSdaColumnRows(null)).toEqual([]);
  });
});

// ── Environmental EPA depth (additive) ────────────────────────────

describe("broker environmental lookup — EPA ECHO + UST depth (additive)", () => {
  const triSites = [
    { FACILITY_NAME: "Acme Plating", STREET_ADDRESS: "1 Industrial Way", CITY: "Phoenix", STATE: "AZ" },
  ];

  it("adds echoFacilitiesWithViolations + ustSitesNearby beside untouched superfund fields", async () => {
    fetchSpy.mockImplementation(async (rawUrl: string) => {
      const url = String(rawUrl);
      if (url.includes("data.epa.gov/efservice/tri_facility")) return jsonResponse(triSites);
      if (url.includes("echodata.epa.gov/echo/echo_rest_services.get_facilities")) {
        // Live-verified summary envelope (2026-07-28).
        return jsonResponse({ Results: { Message: "Success", QueryRows: "1155", CVRows: "8", SVRows: "2" } });
      }
      if (url.includes("UST_Finder_Feature_Layer_2/FeatureServer/0/query")) {
        // Live-verified returnCountOnly shape (2026-07-28).
        return jsonResponse({ count: 168 });
      }
      throw new Error(`unexpected URL in test: ${url}`);
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("environmental", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    // Existing shape untouched.
    expect(result.data.superfundSites).toEqual([
      { name: "Acme Plating", address: "1 Industrial Way", city: "Phoenix", state: "AZ" },
    ]);
    expect(result.data.nearestSiteDistance).toBe(3);
    expect(result.data.riskLevel).toBe("medium");
    expect(result.data.source).toBe("EPA TRI");
    // Additive contract fields.
    expect(result.data.echoFacilitiesWithViolations).toBe(8);
    expect(result.data.ustSitesNearby).toBe(168);
    expect(result.data.note).toBeNull();
  });

  it("ECHO/UST sub-fetch failures → honest nulls + note, superfund fields intact", async () => {
    fetchSpy.mockImplementation(async (rawUrl: string) => {
      const url = String(rawUrl);
      if (url.includes("data.epa.gov/efservice/tri_facility")) return jsonResponse(triSites);
      // Both depth sub-fetches down.
      return jsonResponse({}, false, 503);
    });

    const broker = new DataSourceBroker();
    const result = await broker.lookup("environmental", {
      latitude: 33.4484,
      longitude: -112.074,
      maxTier: "free",
    });

    expect(result.success).toBe(true);
    expect(result.data.superfundSites).toHaveLength(1);
    expect(result.data.riskLevel).toBe("medium");
    expect(result.data.echoFacilitiesWithViolations).toBeNull();
    expect(result.data.ustSitesNearby).toBeNull();
    expect(result.data.note).toMatch(/ECHO/);
    expect(result.data.note).toMatch(/UST/);
  });
});

// ── Registration completeness across the seam ─────────────────────

describe("category registration completeness (types/provider/TTL/license/credits)", () => {
  it("open-data provider fulfills wildfire_hazard + broadband", async () => {
    const { openDataProvider } = await import("../../server/services/providers/open-data-provider");
    expect(openDataProvider.categories).toContain("wildfire_hazard");
    expect(openDataProvider.categories).toContain("broadband");
  });

  it("cache TTLs: wildfire_hazard 90d, broadband 90d", () => {
    expect(cacheTtlMs("wildfire_hazard")).toBe(90 * DAY_MS);
    expect(cacheTtlMs("broadband")).toBe(90 * DAY_MS);
  });

  it("license register: USFS WHP + FCC BDC + EPA sources present and cacheable", () => {
    expect(licenseFor("USFS Wildfire Hazard Potential").license).toBe("public-domain-usgov");
    expect(redistributableFor("USFS Wildfire Hazard Potential")).toBe("yes");
    expect(licenseFor("FCC Broadband Data Collection").license).toBe("public-domain-usgov");
    expect(mayCacheAndRedistribute("FCC Broadband Data Collection")).toBe(true);
    // EPA entries for the environmental-depth sources.
    expect(redistributableFor("EPA ECHO")).toBe("yes");
    expect(redistributableFor("EPA FRS")).toBe("yes");
    expect(redistributableFor("EPA UST Finder")).toBe("yes");
  });

  it("open data is NEVER billed: creditActionForCategory returns null for the new categories", () => {
    expect(creditActionForCategory("wildfire_hazard")).toBeNull();
    expect(creditActionForCategory("broadband")).toBeNull();
    // And the pre-existing free federal categories stay free.
    expect(creditActionForCategory("soil")).toBeNull();
    expect(creditActionForCategory("environmental")).toBeNull();
  });

  it("probe coverage: golden canaries exist for both new categories", async () => {
    const { GOLDEN_PROBES } = await import("../../server/jobs/dataSourceProbe");
    const categories = GOLDEN_PROBES.map((p) => p.category);
    expect(categories).toContain("wildfire_hazard");
    expect(categories).toContain("broadband");

    // The broadband probe pins refuse-not-fabricate: unkeyed, "no data" is
    // healthy and returned data is a FAILURE.
    const bb = GOLDEN_PROBES.find((p) => p.category === "broadband")!;
    expect(bb.check(null)).toBeNull(); // honest unavailable = healthy
    const fabricated = {
      provider: "open-data",
      category: "broadband",
      confidence: 70,
      costCents: 0,
      fetchedAt: new Date(),
      cached: false,
      latencyMs: 5,
      data: { served: true },
      source: "FCC Broadband Data Collection",
      classification: "authoritative",
    } as never;
    expect(bb.check(fabricated)).toMatch(/never be fabricated/i);

    // The wildfire probe requires a MAPPED class at its live-verified
    // golden coordinate.
    const wf = GOLDEN_PROBES.find((p) => p.category === "wildfire_hazard")!;
    const unmapped = {
      ...(fabricated as unknown as Record<string, unknown>),
      category: "wildfire_hazard",
      data: { whpClass: null, whpLabel: null, note: "no data" },
      source: "USFS Wildfire Hazard Potential",
    } as never;
    expect(wf.check(unmapped)).toMatch(/class/i);
    const mapped = {
      ...(unmapped as unknown as Record<string, unknown>),
      data: { whpClass: 4, whpLabel: "high", note: null },
    } as never;
    expect(wf.check(mapped)).toBeNull();
  });
});

// ── safeWgs84 — the coordinate sanitizer every constructed URL/T-SQL uses ──
import { safeWgs84 } from "../../server/services/data-source-broker";

describe("safeWgs84 — no caller-supplied string ever reaches a query or URL", () => {
  it("canonicalizes valid coordinates to fixed-format numeric strings", () => {
    expect(safeWgs84(33.4484, -112.074)).toEqual({ latStr: "33.448400", lngStr: "-112.074000" });
    expect(safeWgs84("33.4484", "-112.074")).toEqual({ latStr: "33.448400", lngStr: "-112.074000" });
  });
  it("throws on out-of-range, non-finite, and injection-shaped inputs", () => {
    expect(() => safeWgs84(91, 0)).toThrow(/latitude/);
    expect(() => safeWgs84(0, -181)).toThrow(/longitude/);
    expect(() => safeWgs84(NaN, 0)).toThrow(/latitude/);
    expect(() => safeWgs84(Infinity, 0)).toThrow(/latitude/);
    expect(() => safeWgs84("33'); DROP TABLE mapunit;--", 0)).toThrow(/latitude/);
    expect(() => safeWgs84(0, "../../etc")).toThrow(/longitude/);
  });
});
