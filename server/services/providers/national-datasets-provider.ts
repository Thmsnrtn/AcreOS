/**
 * Small national datasets as data-provider entries (W2 task 4).
 *
 * Registered in the provider registry (server/providers-init.ts) so every
 * read gets the registry's contract: free tier, circuit breaking, and caching
 * in provider_cache (each source here is public domain or attribution-only in
 * the licence register, so results may be cached and re-served).
 *
 *   fair_market_rent         HUD Fair Market Rents (HUD USER API; free token)
 *   acs_county_profile       Census ACS 5-year county profile (API key required
 *                            by the Census API as of 2026-10-10 — "Missing Key")
 *   jobs_lehd                LEHD LODES 8 workplace jobs by county (bulk CSV)
 *   traffic_counts           TDOT traffic count stations (Tennessee only)
 *   manufactured_home_parks  FEMA RAPT mobile-home parks (from HIFLD)
 *   protected_lands_padus    USGS PAD-US public land near a point
 *
 * A dataset that cannot answer throws with the reason, so the registry falls
 * through and records a miss — it never returns a default.
 */

import { createGunzip } from "node:zlib";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { fetchGeo } from "./fetchGeo";
import type { DataCategory, DataProvider, LookupInput, LookupResult, ProviderHealthStatus } from "./types";
import { clock } from "../../utils/clock";

export const NATIONAL_DATASET_CATEGORIES = [
  "fair_market_rent",
  "acs_county_profile",
  "jobs_lehd",
  "traffic_counts",
  "manufactured_home_parks",
  "protected_lands_padus",
] as const satisfies readonly DataCategory[];

export type NationalDatasetCategory = (typeof NATIONAL_DATASET_CATEGORIES)[number];

const SOURCE: Record<NationalDatasetCategory, string> = {
  fair_market_rent: "HUD Fair Market Rents",
  acs_county_profile: "US Census ACS",
  jobs_lehd: "Census LEHD LODES",
  traffic_counts: "TDOT Traffic Counts",
  manufactured_home_parks: "FEMA Mobile Home Parks (RAPT)",
  protected_lands_padus: "USGS PAD-US",
};

export const LODES_YEAR = 2023;
export const ACS_YEAR = 2023;
const TDOT_TRAFFIC_POINTS = "https://services2.arcgis.com/nf3p7v7Zy4fTOh6M/arcgis/rest/services/Traffic_Points/FeatureServer/0";
const FEMA_MHP = "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/Mobile_Home_Parks_RAPT/FeatureServer/2";
const PADUS_FEE = "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0";
const TIGER_COUNTIES = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/State_County/MapServer/1";

/** Why a dataset is unavailable in this deploy, or null when it can answer. */
export function nationalDatasetReadiness(
  category: NationalDatasetCategory,
  env: Record<string, string | undefined> = process.env,
): string | null {
  if (category === "fair_market_rent" && !env.HUD_USER_API_TOKEN) {
    return "HUD_USER_API_TOKEN not set — the HUD USER API needs a free token, so Fair Market Rents are unavailable";
  }
  if (category === "acs_county_profile" && !env.CENSUS_API_KEY) {
    return "CENSUS_API_KEY not set — the Census API now rejects keyless requests, so the ACS profile is unavailable";
  }
  return null;
}

async function getJson(url: string, init: Parameters<typeof fetchGeo>[1] = {}): Promise<any> {
  const res = await fetchGeo(url, { timeoutMs: 30_000, ...init });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  const body = await res.json();
  if (body?.error) throw new Error(`${new URL(url).host}: ${body.error.message ?? "error"}`);
  return body;
}

/** County FIPS (5 digits) at a point, from Census TIGERweb. */
export async function countyFipsAt(lat: number, lng: number): Promise<{ fips: string; name: string }> {
  const q = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "GEOID,BASENAME",
    returnGeometry: "false",
    f: "json",
  });
  const j = await getJson(`${TIGER_COUNTIES}/query?${q}`);
  const a = j.features?.[0]?.attributes;
  if (!a?.GEOID) throw new Error("no county at this point (TIGERweb)");
  return { fips: String(a.GEOID), name: String(a.BASENAME) };
}

// ── LODES: jobs by county, aggregated once per state per process ───────────

const lodesByState = new Map<string, Promise<Map<string, number>>>();

/** Sum LODES WAC total jobs (C000) by county from the state file. Pure on a line iterator. */
export async function aggregateLodesByCounty(lines: AsyncIterable<string>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  let header: string[] | null = null;
  let geoIdx = -1, jobsIdx = -1;
  for await (const line of lines) {
    if (!header) {
      header = line.split(",");
      geoIdx = header.indexOf("w_geocode");
      jobsIdx = header.indexOf("C000");
      if (geoIdx < 0 || jobsIdx < 0) throw new Error("LODES file is missing w_geocode or C000");
      continue;
    }
    const cols = line.split(",");
    const county = (cols[geoIdx] ?? "").slice(0, 5);
    const n = Number(cols[jobsIdx]);
    if (county.length === 5 && Number.isFinite(n)) out.set(county, (out.get(county) ?? 0) + n);
  }
  return out;
}

async function lodesFor(stateAbbr: string): Promise<Map<string, number>> {
  const st = stateAbbr.toLowerCase();
  let p = lodesByState.get(st);
  if (!p) {
    p = (async () => {
      const url = `https://lehd.ces.census.gov/data/lodes/LODES8/${st}/wac/${st}_wac_S000_JT00_${LODES_YEAR}.csv.gz`;
      const res = await fetchGeo(url, { timeoutMs: 60_000 });
      if (!res.ok || !res.body) throw new Error(`LODES ${st} ${LODES_YEAR} HTTP ${res.status}`);
      const gunzip = Readable.fromWeb(res.body as any).pipe(createGunzip());
      return aggregateLodesByCounty(createInterface({ input: gunzip, crlfDelay: Infinity }));
    })();
    lodesByState.set(st, p);
    p.catch(() => lodesByState.delete(st));
    if (lodesByState.size > 4) lodesByState.delete(lodesByState.keys().next().value as string);
  }
  return p;
}

// ── The provider ───────────────────────────────────────────────────────────

function point(input: LookupInput): { lat: number; lng: number; state?: string } {
  if (input.type !== "coordinates") throw new Error("national datasets need coordinates");
  return { lat: input.latitude, lng: input.longitude, state: input.state };
}

function result(category: NationalDatasetCategory, data: unknown, start: number, sourceAsOf: Date | null): LookupResult {
  return {
    provider: "national-datasets",
    category,
    confidence: 90,
    costCents: 0,
    fetchedAt: clock.now(),
    cached: false,
    latencyMs: clock.nowMs() - start,
    data,
    source: SOURCE[category],
    sourceAsOf,
    classification: "authoritative",
  };
}

const miles = (m: number) => m * 1609.344;

export const nationalDatasetsProvider: DataProvider = {
  name: "national-datasets",
  displayName: "National open datasets (HUD, Census, LEHD, TDOT, FEMA, USGS)",
  categories: [...NATIONAL_DATASET_CATEGORIES],
  supportedInputTypes: ["coordinates"],
  tierRequired: "free",
  license: "public-domain-usgov",
  redistributable: "yes",
  costPerLookupCents: () => 0,
  async isConfigured() {
    return true;
  },

  async lookup(category: DataCategory, input: LookupInput): Promise<LookupResult> {
    const start = clock.nowMs();
    const cat = category as NationalDatasetCategory;
    if (!(NATIONAL_DATASET_CATEGORIES as readonly string[]).includes(cat)) throw new Error(`unsupported category ${category}`);
    const refusal = nationalDatasetReadiness(cat);
    if (refusal) throw new Error(refusal);
    const { lat, lng, state } = point(input);

    switch (cat) {
      case "fair_market_rent": {
        const { fips } = await countyFipsAt(lat, lng);
        const j = await getJson(`https://www.huduser.gov/hudapi/public/fmr/data/${fips}99999`, {
          headers: { Authorization: `Bearer ${process.env.HUD_USER_API_TOKEN}` },
        });
        const d = j.data;
        if (!d?.basicdata) throw new Error("HUD returned no FMR for this county");
        return result(cat, { countyFips: fips, year: d.year ?? null, areaName: d.area_name ?? null, basicdata: d.basicdata }, start, null);
      }
      case "acs_county_profile": {
        const { fips } = await countyFipsAt(lat, lng);
        const vars = ["NAME", "B01003_001E", "B19013_001E", "B25064_001E"];
        const q = new URLSearchParams({ get: vars.join(","), for: `county:${fips.slice(2)}`, in: `state:${fips.slice(0, 2)}`, key: String(process.env.CENSUS_API_KEY) });
        const rows = await getJson(`https://api.census.gov/data/${ACS_YEAR}/acs/acs5?${q}`);
        const [h, v] = rows as string[][];
        const at = (k: string) => (v ? Number(v[h.indexOf(k)]) : NaN);
        return result(
          cat,
          { countyFips: fips, name: v?.[0] ?? null, acsYear: `${ACS_YEAR} 5-year`, population: at("B01003_001E"), medianHouseholdIncome: at("B19013_001E"), medianGrossRent: at("B25064_001E") },
          start,
          null,
        );
      }
      case "jobs_lehd": {
        const { fips, name } = await countyFipsAt(lat, lng);
        const st = state ?? (await stateAbbrFromFips(fips.slice(0, 2)));
        const jobs = (await lodesFor(st)).get(fips);
        if (jobs === undefined) throw new Error(`LODES ${LODES_YEAR} has no workplace rows for county ${fips}`);
        return result(cat, { countyFips: fips, county: name, year: LODES_YEAR, totalJobsAtWorkplaces: jobs }, start, null);
      }
      case "traffic_counts": {
        if ((state ?? "").toUpperCase() !== "TN") throw new Error("no state traffic-count source is wired outside Tennessee");
        const q = new URLSearchParams({
          geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
          distance: "3000", units: "esriSRUnit_Meter", where: "AADT > 0",
          outFields: "ON_ROAD,AADT,AADTYEAR,LATITUDE,LONGITUDE", returnGeometry: "false", f: "json",
        });
        const j = await getJson(`${TDOT_TRAFFIC_POINTS}/query?${q}`);
        const stations = (j.features ?? []).map((f: any) => f.attributes);
        if (stations.length === 0) throw new Error("no TDOT count station within 3 km");
        const d = (s: any) => Math.hypot((s.LONGITUDE - lng) * Math.cos((lat * Math.PI) / 180), s.LATITUDE - lat) * 111_320;
        stations.sort((a: any, b: any) => d(a) - d(b));
        const s = stations[0];
        return result(cat, { road: s.ON_ROAD, aadt: s.AADT, year: s.AADTYEAR, distanceM: Math.round(d(s)), stationsWithin3km: stations.length }, start, null);
      }
      case "manufactured_home_parks": {
        const q = new URLSearchParams({
          geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
          distance: String(Math.round(miles(5))), units: "esriSRUnit_Meter", where: "1=1",
          outFields: "NAME,UNITS,SOURCEDATE", returnGeometry: "false", f: "json",
        });
        const j = await getJson(`${FEMA_MHP}/query?${q}`);
        const parks = (j.features ?? []).map((f: any) => ({ name: f.attributes.NAME, units: f.attributes.UNITS, sourceDate: f.attributes.SOURCEDATE }));
        return result(cat, { radiusMiles: 5, count: parks.length, parks: parks.slice(0, 25) }, start, null);
      }
      case "protected_lands_padus": {
        const q = new URLSearchParams({
          geometry: `${lng},${lat}`, geometryType: "esriGeometryPoint", inSR: "4326",
          distance: "1000", units: "esriSRUnit_Meter",
          where: "Own_Type IN ('FED','STAT','LOC','DIST','JNT')",
          outFields: "Unit_Nm,Mang_Name,Pub_Access", returnGeometry: "false", f: "json",
        });
        const j = await getJson(`${PADUS_FEE}/query?${q}`);
        const units = (j.features ?? []).map((f: any) => ({ name: f.attributes.Unit_Nm, manager: f.attributes.Mang_Name, publicAccess: f.attributes.Pub_Access }));
        return result(cat, { radiusM: 1000, units }, start, null);
      }
    }
  },

  async healthCheck(): Promise<ProviderHealthStatus> {
    const start = clock.nowMs();
    try {
      await getJson(`${PADUS_FEE}?f=json`);
      return { healthy: true, latencyMs: clock.nowMs() - start, checkedAt: clock.now() };
    } catch (err) {
      return { healthy: false, latencyMs: clock.nowMs() - start, checkedAt: clock.now(), message: err instanceof Error ? err.message : String(err) };
    }
  },
};

const STATE_FIPS: Record<string, string> = {
  "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
  "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
  "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
  "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
  "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI", "56": "WY",
};

async function stateAbbrFromFips(fips2: string): Promise<string> {
  const st = STATE_FIPS[fips2];
  if (!st) throw new Error(`unknown state FIPS ${fips2}`);
  return st;
}
