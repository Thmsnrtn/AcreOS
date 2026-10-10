/**
 * Land-context layer sources for the W2 parcel-fact pipeline.
 *
 * The free federal layers the fact engine (server/services/landData/
 * computeParcelFacts.ts) reads around a parcel. Every source here is
 * registered in the data-licence register (./data-licenses.ts) under the same
 * `licenseSource` name, and every request goes through fetchGeo (timeouts,
 * per-host politeness, contactable User-Agent, SSRF guard).
 *
 * Bulk neighbourhood reads are not single-parcel lookups, so they are not
 * routed through providerRegistry.lookup(); they share the registry's
 * reliability contract instead: one hardened fetch, licence check before any
 * byte is stored, and a loud, per-layer failure (null layer → the dependent
 * facts are "unavailable", never defaulted). See docs/company/open-data-w2-tennessee.md.
 */

import { fetchGeo } from "./fetchGeo";
import { licenseFor } from "./data-licenses";
import type { FactSource } from "@shared/landData/parcelFacts";
import type {
  AreaFeature,
  FloodFeature,
  LayerOf,
  ParcelContext,
  PublicLandFeature,
  RoadFeature,
  TownFeature,
} from "../landData/computeParcelFacts";
import type { AreaGeometry, LineGeometry } from "../landData/geometry";
import { readThreeDepWindows, slopeSamplerFromGrids, THREEDEP_13_BASE } from "../landData/dem";

export type Bbox = [number, number, number, number];

export interface ArcgisLayerSource {
  /** Data-licence register key (must exist there). */
  licenseSource: string;
  layerUrl: string;
  where?: string;
  outFields: string;
  /** Simplification tolerance in degrees (ArcGIS maxAllowableOffset). */
  maxAllowableOffset?: number;
  pageSize: number;
  /** How far beyond the parcel bbox to search, in degrees. */
  searchPadDeg: number;
}

const TIGERWEB = "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb";

export const LAND_CONTEXT_SOURCES = {
  roadsPrimary: {
    licenseSource: "US Census TIGER",
    layerUrl: `${TIGERWEB}/Transportation/MapServer/2`,
    outFields: "MTFCC,NAME",
    pageSize: 1000,
    searchPadDeg: 0.003,
  },
  roadsSecondary: {
    licenseSource: "US Census TIGER",
    layerUrl: `${TIGERWEB}/Transportation/MapServer/6`,
    outFields: "MTFCC,NAME",
    pageSize: 1000,
    searchPadDeg: 0.003,
  },
  roadsLocal: {
    licenseSource: "US Census TIGER",
    layerUrl: `${TIGERWEB}/Transportation/MapServer/8`,
    outFields: "MTFCC,NAME",
    pageSize: 1000,
    searchPadDeg: 0.003,
  },
  towns: {
    licenseSource: "US Census TIGER",
    layerUrl: `${TIGERWEB}/Places_CouSub_ConCity_SubMCD/MapServer/4`,
    outFields: "NAME,GEOID",
    maxAllowableOffset: 0.0002,
    pageSize: 500,
    searchPadDeg: 0.35,
  },
  wetlands: {
    licenseSource: "USFWS NWI",
    layerUrl: "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer/0",
    outFields: "WETLAND_TYPE,ATTRIBUTE",
    maxAllowableOffset: 0.00002,
    pageSize: 500,
    searchPadDeg: 0.001,
  },
  floodZones: {
    licenseSource: "FEMA NFHL",
    layerUrl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/28",
    where: "SFHA_TF='T'",
    outFields: "FLD_ZONE,SFHA_TF",
    maxAllowableOffset: 0.00002,
    pageSize: 500,
    searchPadDeg: 0.001,
  },
  firmPanels: {
    licenseSource: "FEMA NFHL",
    layerUrl: "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer/3",
    outFields: "FIRM_PAN,EFF_DATE",
    maxAllowableOffset: 0.001,
    pageSize: 200,
    searchPadDeg: 0,
  },
  publicLands: {
    licenseSource: "USGS PAD-US",
    layerUrl: "https://services.arcgis.com/v01gqwM5QqNysAAi/arcgis/rest/services/Fee_Managers_PADUS/FeatureServer/0",
    // Publicly owned fee land only — NGO and private conservation fee land is
    // not "public land" a buyer can walk onto.
    where: "Own_Type IN ('FED','STAT','LOC','DIST','JNT')",
    outFields: "Unit_Nm,Mang_Name,Own_Type",
    maxAllowableOffset: 0.00005,
    pageSize: 500,
    searchPadDeg: 0.002,
  },
} as const satisfies Record<string, ArcgisLayerSource>;

export type LandContextSourceKey = keyof typeof LAND_CONTEXT_SOURCES;

/**
 * Transmission lines: REFUSED on terms, not on reachability (checked
 * 2026-10-10). HIFLD Open, the public-domain source, was discontinued in
 * Aug 2025. The copies still online are archived Living Atlas items whose
 * item licence is the Esri Master License Agreement ("U.S. Electric Power
 * Transmission Lines (Archive)", last data update 2024-09-30), which does not
 * grant use outside the Esri platform. Until a source with open terms is
 * wired (DOE/EIA re-hosting, or OpenStreetMap power=line under ODbL with
 * attribution), distance-to-power is reported unavailable with this reason.
 */
export const TRANSMISSION_REFUSAL =
  "no transmission-line source with open terms is wired: HIFLD Open was discontinued in Aug 2025 and the archived copies carry the Esri Master License Agreement";

export interface GeoJsonFeature {
  type: "Feature";
  geometry: { type: string; coordinates: unknown } | null;
  properties: Record<string, unknown> | null;
}

/** Build one ArcGIS envelope query URL (pure — unit tested). */
export function arcgisBboxQueryUrl(src: ArcgisLayerSource, bbox: Bbox, offset: number): string {
  const pad = src.searchPadDeg;
  const params = new URLSearchParams({
    where: src.where ?? "1=1",
    geometry: [bbox[0] - pad, bbox[1] - pad, bbox[2] + pad, bbox[3] + pad].map((n) => n.toFixed(6)).join(","),
    geometryType: "esriGeometryEnvelope",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: src.outFields,
    returnGeometry: "true",
    geometryPrecision: "6",
    resultOffset: String(offset),
    resultRecordCount: String(src.pageSize),
    f: "geojson",
  });
  if (src.maxAllowableOffset) params.set("maxAllowableOffset", String(src.maxAllowableOffset));
  return `${src.layerUrl}/query?${params.toString()}`;
}

/** Hard ceiling on features per layer per neighbourhood read (memory bound). */
const MAX_FEATURES_PER_LAYER = 20_000;

export async function fetchArcgisBbox(
  src: ArcgisLayerSource,
  bbox: Bbox,
  fetcher: (url: string) => Promise<Response> = (u) =>
    fetchGeo(u, { timeoutMs: 45_000, retries: 2, ratePerSec: 2, maxConcurrentPerHost: 2 }),
): Promise<GeoJsonFeature[]> {
  const out: GeoJsonFeature[] = [];
  for (let offset = 0; offset < MAX_FEATURES_PER_LAYER; offset += src.pageSize) {
    const res = await fetcher(arcgisBboxQueryUrl(src, bbox, offset));
    if (!res.ok) throw new Error(`${src.layerUrl} HTTP ${res.status}`);
    const body = (await res.json()) as {
      features?: GeoJsonFeature[];
      error?: { message?: string };
      exceededTransferLimit?: boolean;
      properties?: { exceededTransferLimit?: boolean };
    };
    if (body.error) throw new Error(`${src.layerUrl}: ${body.error.message ?? "ArcGIS error"}`);
    const feats = body.features ?? [];
    out.push(...feats);
    const more = body.exceededTransferLimit ?? body.properties?.exceededTransferLimit ?? feats.length === src.pageSize;
    if (!more || feats.length === 0) return out;
  }
  throw new Error(`${src.layerUrl}: more than ${MAX_FEATURES_PER_LAYER} features in one neighbourhood — refusing a partial layer`);
}

// ── GeoJSON → typed context features ──────────────────────────────────────

const isLine = (g: GeoJsonFeature["geometry"]): g is LineGeometry =>
  !!g && (g.type === "LineString" || g.type === "MultiLineString");
const isArea = (g: GeoJsonFeature["geometry"]): g is AreaGeometry =>
  !!g && (g.type === "Polygon" || g.type === "MultiPolygon");
const str = (v: unknown): string => (v === null || v === undefined ? "" : String(v));

function toRoads(fs: GeoJsonFeature[]): RoadFeature[] {
  return fs.filter((f) => isLine(f.geometry)).map((f) => ({
    geometry: f.geometry as LineGeometry,
    mtfcc: str(f.properties?.MTFCC),
    name: str(f.properties?.NAME) || null,
  }));
}
function toAreas(fs: GeoJsonFeature[]): AreaFeature[] {
  return fs.filter((f) => isArea(f.geometry)).map((f) => ({ geometry: f.geometry as AreaGeometry }));
}
function toFlood(fs: GeoJsonFeature[]): FloodFeature[] {
  return fs.filter((f) => isArea(f.geometry)).map((f) => ({
    geometry: f.geometry as AreaGeometry,
    sfha: str(f.properties?.SFHA_TF) === "T",
    zone: str(f.properties?.FLD_ZONE),
  }));
}
function toPublicLands(fs: GeoJsonFeature[]): PublicLandFeature[] {
  return fs.filter((f) => isArea(f.geometry)).map((f) => ({
    geometry: f.geometry as AreaGeometry,
    name: str(f.properties?.Unit_Nm) || "Unnamed public unit",
    manager: str(f.properties?.Mang_Name) || "Unknown manager",
  }));
}
function toTowns(fs: GeoJsonFeature[]): TownFeature[] {
  return fs.filter((f) => isArea(f.geometry)).map((f) => ({
    geometry: f.geometry as AreaGeometry,
    name: str(f.properties?.NAME),
  }));
}

function sourceFor(key: LandContextSourceKey | "3dep", retrievedOn: string, sourceAsOf: string | null = null): FactSource {
  const name = key === "3dep" ? "USGS 3DEP" : LAND_CONTEXT_SOURCES[key].licenseSource;
  const url = key === "3dep" ? THREEDEP_13_BASE : LAND_CONTEXT_SOURCES[key].layerUrl;
  return { name, url, retrievedOn, sourceAsOf };
}

/** Every licence name this module stamps must exist in the register. */
export function unregisteredContextLicenses(): string[] {
  const names = new Set<string>(["USGS 3DEP", ...Object.values(LAND_CONTEXT_SOURCES).map((s) => s.licenseSource)]);
  return Array.from(names).filter((n) => licenseFor(n).lastReviewed === "1970-01-01");
}

/**
 * Load every context layer for a neighbourhood bbox. A layer that fails is
 * returned as null (and logged by the caller) — the facts depending on it
 * become "unavailable" rather than computed from a partial picture.
 */
export async function loadParcelContext(
  bbox: Bbox,
  retrievedOn: string,
  opts: { fetcher?: (url: string) => Promise<Response>; onLayerError?: (layer: string, err: unknown) => void } = {},
): Promise<ParcelContext> {
  const get = async <T>(layer: string, fn: () => Promise<T>): Promise<T | null> => {
    try {
      return await fn();
    } catch (err) {
      opts.onLayerError?.(layer, err);
      return null;
    }
  };
  const S = LAND_CONTEXT_SOURCES;
  const f = opts.fetcher;
  const layer = <F>(key: LandContextSourceKey, features: F[]): LayerOf<F> => ({ source: sourceFor(key, retrievedOn), features });

  const roads = await get("roads", async () => {
    const all = [
      ...(await fetchArcgisBbox(S.roadsPrimary, bbox, f)),
      ...(await fetchArcgisBbox(S.roadsSecondary, bbox, f)),
      ...(await fetchArcgisBbox(S.roadsLocal, bbox, f)),
    ];
    return layer("roadsLocal", toRoads(all));
  });
  const wetlands = await get("wetlands", async () => layer("wetlands", toAreas(await fetchArcgisBbox(S.wetlands, bbox, f))));
  const flood = await get("flood", async () => {
    const panels = await fetchArcgisBbox(S.firmPanels, bbox, f);
    const zones = await fetchArcgisBbox(S.floodZones, bbox, f);
    return { ...layer("floodZones", toFlood(zones)), firmCovered: panels.length > 0 };
  });
  const publicLands = await get("publicLands", async () => layer("publicLands", toPublicLands(await fetchArcgisBbox(S.publicLands, bbox, f))));
  const towns = await get("towns", async () => layer("towns", toTowns(await fetchArcgisBbox(S.towns, bbox, f))));
  const slope = await get("3dep", async () => {
    const grids = await readThreeDepWindows(bbox);
    if (grids.length === 0) throw new Error("no 3DEP tile covers this bbox");
    return slopeSamplerFromGrids(grids, sourceFor("3dep", retrievedOn));
  });
  return {
    roads,
    wetlands,
    flood,
    publicLands,
    transmission: null,
    towns,
    slope,
    layerReasons: { transmission: TRANSMISSION_REFUSAL },
  };
}
