/**
 * W2 registries and truths — every entry sourced, every refusal honest.
 *
 *  - County source census (TN): 95 counties; coverage derived from sources
 *    (a row cannot claim more than its sources prove); "storable" only where
 *    the terms permit storing; the 9 self-maintained counties are not shown
 *    as covered by the state download.
 *  - Tax-sale registry: sources only, no sale dates typed in.
 *  - Data truths: every parcel carries the GIS-not-legal and easements
 *    warnings; alignment check fires on a big acreage gap; western water
 *    links only for listed states; no mineral claim without a roll.
 *  - Licence register: every source the land pipeline cites is registered;
 *    the TN public service may not be cached or re-served.
 *  - National datasets: keyed sources refuse without their key; LODES
 *    aggregation sums by county; every category is registered.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { COUNTY_SOURCE_CENSUS, deriveCoverage, censusRowFor } from "@shared/landData/countySourceCensus";
import { TAX_SALE_SOURCES } from "@shared/landData/taxSaleSources";
import {
  parcelTruths,
  WESTERN_WATER_RIGHTS_DATABASES,
  MINERAL_ROLL_COUNTIES,
  ALIGNMENT_TOLERANCE_RATIO,
} from "@shared/landData/parcelTruths";
import { licenseFor, mayCacheAndRedistribute } from "../../server/services/providers/data-licenses";
import { unregisteredContextLicenses, arcgisBboxQueryUrl, LAND_CONTEXT_SOURCES } from "../../server/services/providers/land-context-sources";
import {
  aggregateLodesByCounty,
  nationalDatasetReadiness,
  NATIONAL_DATASET_CATEGORIES,
  nationalDatasetsProvider,
} from "../../server/services/providers/national-datasets-provider";
import { TN_SELF_MAINTAINED_COUNTIES } from "../../server/services/landData/tnParcelSources";
import { stripComments } from "../helpers/stripComments";

const root = path.resolve(__dirname, "../..");

describe("county source census — Tennessee", () => {
  const tn = COUNTY_SOURCE_CENSUS.find((c) => c.state === "TN")!;

  it("covers all 95 counties with 5-digit TN FIPS codes, once each", () => {
    expect(tn.rows).toHaveLength(95);
    expect(new Set(tn.rows.map((r) => r.countyFips)).size).toBe(95);
    for (const r of tn.rows) expect(r.countyFips).toMatch(/^47\d{3}$/);
  });

  it("every row's coverage is exactly what its sources prove", () => {
    for (const r of tn.rows) expect(r.coverage, r.county).toBe(deriveCoverage(r.sources));
  });

  it("a source whose terms prohibit commercial use never earns 'live lookups' coverage (founder decision 2026-10-11)", () => {
    const base = { publisher: "p", url: "https://x.example/FeatureServer/0", mayStore: false, automatedDownload: true, terms: "t", checkedOn: "2026-10-11" };
    expect(deriveCoverage([{ ...base, kind: "state_public_service", commercialUse: "prohibited", verification: "verified_live" }])).not.toBe("lookup_only");
    expect(deriveCoverage([{ ...base, kind: "county_service", commercialUse: "unstated", verification: "verified_live" }])).toBe("lookup_only");
    // And the TN census no longer cites the retired state service at all.
    expect(tn.rows.flatMap((r) => r.sources).filter((s) => s.kind === "state_public_service")).toEqual([]);
  });

  it("nothing claims storable unless the source's terms permit storing", () => {
    for (const r of tn.rows) {
      for (const s of r.sources) {
        if (s.mayStore) expect(s.commercialUse, `${r.county} ${s.url}`).toBe("permitted");
        if (s.commercialUse === "prohibited") expect(s.mayStore).toBe(false);
        expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(s.url).toMatch(/^https:\/\//);
      }
    }
  });

  it("the nine self-maintained counties are not claimed by the state download", () => {
    for (const name of TN_SELF_MAINTAINED_COUNTIES) {
      const row = censusRowFor("TN", `${name} County`)!;
      expect(row, name).toBeTruthy();
      expect(row.maintainedBy).toBe("county");
      expect(row.sources.some((s) => s.kind === "state_download"), name).toBe(false);
      expect(row.coverage, name).not.toBe("storable_with_manual_download");
    }
  });

  it("unverified candidates are labelled unverified, never as verified", () => {
    const unverified = tn.rows.flatMap((r) => r.sources).filter((s) => s.terms === "not reviewed");
    expect(unverified.length).toBeGreaterThan(0);
    for (const s of unverified) expect(s.verification).toBe("unverified");
  });
});

describe("tax-sale source registry", () => {
  it("every entry is a fetched source with a check date, and no sale date is typed in", () => {
    expect(TAX_SALE_SOURCES.length).toBeGreaterThan(0);
    for (const s of TAX_SALE_SOURCES) {
      expect(s.url).toMatch(/^https:\/\//);
      expect(s.checkedOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(s.pageSays.length).toBeGreaterThan(10);
      expect(Object.keys(s)).not.toContain("saleDate");
    }
    const src = stripComments(readFileSync(path.join(root, "shared/landData/taxSaleSources.ts"), "utf8"));
    expect(src).not.toMatch(/saleDate|nextSale|auctionDate/);
  });
});

describe("data truths", () => {
  const base = { state: "TN", county: "DeKalb", gisAcres: 6.1, deededAcres: 6.0 };

  it("always warns GIS lines are not legal boundaries and easements are unknown", () => {
    const keys = parcelTruths(base).map((t) => t.key);
    expect(keys).toContain("gis_not_legal_boundary");
    expect(keys).toContain("easements_unknown");
    expect(keys).toContain("parcel_id_crosswalk");
  });

  it("the alignment check fires on a 25% GIS-vs-deed gap and not on a 2% one", () => {
    // Fixed numbers, not derived from the constant: a mutation of the
    // tolerance must move this test, not ride along with it.
    expect(ALIGNMENT_TOLERANCE_RATIO).toBeLessThan(0.25);
    const over = parcelTruths({ ...base, gisAcres: 7.5 }).find((t) => t.key === "gis_not_legal_boundary")!;
    const under = parcelTruths(base).find((t) => t.key === "gis_not_legal_boundary")!;
    expect(over.severity).toBe("warning");
    expect(under.severity).toBe("info");
  });

  it("western water rights link only for listed states, each with a URL", () => {
    expect(parcelTruths(base).some((t) => t.key === "western_water_rights")).toBe(false);
    const co = parcelTruths({ ...base, state: "CO" }).find((t) => t.key === "western_water_rights")!;
    expect(co.link?.url).toBe(WESTERN_WATER_RIGHTS_DATABASES.find((w) => w.state === "CO")!.url);
    for (const w of WESTERN_WATER_RIGHTS_DATABASES) expect(w.url).toMatch(/^https:\/\//);
  });

  it("split minerals: 'not assessed' without a roll — never a claim", () => {
    expect(MINERAL_ROLL_COUNTIES).toHaveLength(0);
    const m = parcelTruths(base).find((t) => t.key === "split_mineral_estate")!;
    expect(m.message).toMatch(/^Not assessed/);
    expect(m.confidence).toBe("low");
  });

  it("paper subdivision warning needs a platted lot AND no road AND a small parcel", () => {
    const paper = parcelTruths({ ...base, gisAcres: 1, subdivision: "LAKE ESTATES", accessIndication: "no_road_contact" }).find((t) => t.key === "paper_subdivision")!;
    expect(paper.severity).toBe("warning");
    const plain = parcelTruths({ ...base, subdivision: "LAKE ESTATES", accessIndication: "public_road_contact" }).find((t) => t.key === "paper_subdivision")!;
    expect(plain.severity).toBe("info");
    expect(parcelTruths({ ...base, subdivision: "000" }).some((t) => t.key === "paper_subdivision")).toBe(false);
  });

  it("wildfire and EPA warnings appear only when looked up", () => {
    const keys = parcelTruths(base).map((t) => t.key);
    expect(keys).not.toContain("wildfire_risk");
    expect(keys).not.toContain("epa_sites");
    const w = parcelTruths({ ...base, wildfireHazardClass: 4, epaFacilitiesWithinOneMile: 2 });
    expect(w.find((t) => t.key === "wildfire_risk")!.severity).toBe("warning");
    expect(w.find((t) => t.key === "epa_sites")!.severity).toBe("caution");
  });
});

describe("licence register — the land pipeline's sources", () => {
  it("every context-layer source the engine cites is registered", () => {
    expect(unregisteredContextLicenses()).toEqual([]);
  });

  it("the TN public service may never be cached or re-served; the Comptroller download may, with attribution", () => {
    expect(mayCacheAndRedistribute("TN Property Boundaries Public Use service")).toBe(false);
    expect(licenseFor("TN Comptroller parcel download").redistributable).toBe("attribution");
  });

  it("every national dataset source is registered and cacheable", () => {
    for (const src of ["HUD Fair Market Rents", "US Census ACS", "Census LEHD LODES", "TDOT Traffic Counts", "FEMA Mobile Home Parks (RAPT)", "USGS PAD-US"]) {
      expect(licenseFor(src).lastReviewed, src).not.toBe("1970-01-01");
      expect(mayCacheAndRedistribute(src), src).toBe(true);
    }
  });

  it("context queries ask the server for WGS84 GeoJSON inside the padded bbox", () => {
    const u = new URL(arcgisBboxQueryUrl(LAND_CONTEXT_SOURCES.wetlands, [-86, 36, -85.9, 36.1], 0));
    expect(u.searchParams.get("outSR")).toBe("4326");
    expect(u.searchParams.get("f")).toBe("geojson");
    expect(u.searchParams.get("geometry")).toBe("-86.001000,35.999000,-85.899000,36.101000");
  });
});

describe("national datasets provider", () => {
  it("keyed sources refuse without their key — never a default", () => {
    expect(nationalDatasetReadiness("fair_market_rent", {})).toMatch(/HUD_USER_API_TOKEN/);
    expect(nationalDatasetReadiness("acs_county_profile", {})).toMatch(/CENSUS_API_KEY/);
    expect(nationalDatasetReadiness("fair_market_rent", { HUD_USER_API_TOKEN: "t" })).toBeNull();
    expect(nationalDatasetReadiness("jobs_lehd", {})).toBeNull();
  });

  it("a keyless lookup throws the refusal instead of answering", async () => {
    const prev = process.env.HUD_USER_API_TOKEN;
    delete process.env.HUD_USER_API_TOKEN;
    await expect(
      nationalDatasetsProvider.lookup("fair_market_rent", { type: "coordinates", latitude: 36, longitude: -85.9 }),
    ).rejects.toThrow(/HUD_USER_API_TOKEN/);
    if (prev !== undefined) process.env.HUD_USER_API_TOKEN = prev;
  });

  it("LODES WAC rows sum to county totals by the first five digits of w_geocode", async () => {
    async function* lines() {
      yield "w_geocode,C000,CA01";
      yield "470410001001000,12,1";
      yield "470410001001001,8,0";
      yield "470370195001000,100,3";
    }
    const m = await aggregateLodesByCounty(lines());
    expect(Object.fromEntries(m)).toEqual({ "47041": 20, "47037": 100 });
  });

  it("is registered for every category in providers-init", () => {
    const src = stripComments(readFileSync(path.join(root, "server/providers-init.ts"), "utf8"));
    expect(src).toMatch(/for \(const category of nationalDatasetsProvider\.categories\)\s*\{\s*providerRegistry\.register\(category, nationalDatasetsProvider/);
    expect(nationalDatasetsProvider.categories).toEqual([...NATIONAL_DATASET_CATEGORIES]);
  });
});
