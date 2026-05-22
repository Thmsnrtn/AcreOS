/**
 * Pillar 6 — Free-source-first router.
 *
 * Many entityTypes have a free public-data source that answers the same
 * question as a paid provider. The router tries those FIRST and only falls
 * back to a paid provider on miss/error. Combined with `lookup-cache.ts`
 * this gives us:
 *
 *   1. Free source hit  → $0 (still cached for the next caller)
 *   2. Paid source hit  → $X, but cached so customer #2 reads it free
 *   3. No source        → null, caller decides what to do
 *
 * Wired free sources at the time of writing:
 *   - flood_zone → FEMA NFHL (free, no key; already used in
 *     server/services/dueDiligenceEngine.ts)
 *   - wetlands → USFWS NWI (free, no key)
 *   - census   → US Census API (free, optional key)
 *   - usda     → USDA NASS (free, requires key; cached by
 *     server/services/usdaNassService.ts)
 *   - parcel_polygon → county GIS (STUB; per-county adapters TODO,
 *     default returns "no free source available")
 */

import { logger } from "../../utils/logger";

export interface FreeSourceResult<T = unknown> {
  result: T;
  source: string;
  /**
   * Hint about how stable this free source is, so the cache layer can apply
   * the right TTL when storing the answer.
   */
  freshnessHours?: number;
}

export type FreeSourceAdapter<TQuery = any, TResult = any> = (
  query: TQuery,
) => Promise<FreeSourceResult<TResult> | null>;

// ─────────────────────────────────────────────────────────────────────────────
// Adapters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * FEMA National Flood Hazard Layer (NFHL) — free, no key.
 * Query: { lat, lng }
 */
export const femaFloodAdapter: FreeSourceAdapter<{ lat: number; lng: number }, {
  zone: string | null;
  inFloodplain: boolean;
  raw: unknown;
}> = async (query) => {
  if (typeof query?.lat !== "number" || typeof query?.lng !== "number") return null;
  const url = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=${query.lng},${query.lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STUDY_TYP&f=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const features = data.features || [];
    const zone = features[0]?.attributes?.FLD_ZONE ?? "X";
    const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
    const inFloodplain = highRiskZones.some((z: string) => zone.startsWith(z));
    return {
      result: { zone, inFloodplain, raw: data },
      source: "fema_nfhl",
      freshnessHours: 8760,
    };
  } catch (err) {
    logger.warn(`[freeSource:fema_nfhl] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/**
 * USFWS National Wetlands Inventory — free, no key.
 * Query: { lat, lng, bufferDeg? }
 */
export const usfwsWetlandsAdapter: FreeSourceAdapter<
  { lat: number; lng: number; bufferDeg?: number },
  { hasWetlands: boolean; wetlandAcres: number; raw: unknown }
> = async (query) => {
  if (typeof query?.lat !== "number" || typeof query?.lng !== "number") return null;
  const buf = query.bufferDeg ?? 0.005;
  const envelope = `${query.lng - buf},${query.lat - buf},${query.lng + buf},${query.lat + buf}`;
  const url = `https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer/0/query?geometry=${envelope}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ATTRIBUTE,ACRES,WETLAND_TYPE&f=json`;
  try {
    const resp = await fetch(url, { signal: AbortSignal.timeout(8000) });
    if (!resp.ok) return null;
    const data: any = await resp.json();
    const features = data.features || [];
    const wetlandAcres = features.reduce(
      (sum: number, f: any) => sum + (f.attributes?.ACRES || 0),
      0,
    );
    return {
      result: { hasWetlands: wetlandAcres > 0, wetlandAcres, raw: data },
      source: "usfws_nwi",
      freshnessHours: 8760,
    };
  } catch (err) {
    logger.warn(`[freeSource:usfws_nwi] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/**
 * Census ACS county demographics. Stub-thin — delegates to
 * censusDataService which already caches results in usdaNass-style.
 * Query: { stateFips, countyFips, year? }
 */
export const censusDemographicsAdapter: FreeSourceAdapter<
  { stateFips: string; countyFips: string; year?: number },
  unknown
> = async (query) => {
  if (!query?.stateFips || !query?.countyFips) return null;
  try {
    const mod: any = await import("../censusDataService");
    const fn = mod?.censusDataService?.fetchCountyDemographics
      ?? mod?.fetchCountyDemographics;
    if (typeof fn !== "function") return null;
    const result = await fn(query.stateFips, query.countyFips, query.year);
    if (!result) return null;
    return { result, source: "census_acs", freshnessHours: 8760 };
  } catch (err) {
    logger.warn(`[freeSource:census_acs] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/**
 * USDA NASS land-value / cash-rent series. Delegates to usdaNassService.
 * Query: passes through.
 */
export const usdaNassAdapter: FreeSourceAdapter<any, unknown> = async (query) => {
  try {
    const mod: any = await import("../usdaNassService");
    const svc = mod?.usdaNassService ?? mod?.default ?? mod;
    // Most consumers want land-value by state; we accept either a typed
    // method or a generic `query` function.
    const fn = svc?.getLandValueByState ?? svc?.query ?? svc?.fetch;
    if (typeof fn !== "function") return null;
    const result = await fn(query);
    if (!result) return null;
    return { result, source: "usda_nass", freshnessHours: 8760 };
  } catch (err) {
    logger.warn(`[freeSource:usda_nass] failed: ${err instanceof Error ? err.message : String(err)}`);
    return null;
  }
};

/**
 * Per-county GIS adapter — STUB. Per-county registry will live here once
 * the county adapters from `arcgis-discovery.ts` are wired up. For now
 * always returns null so callers fall back to paid parcel providers
 * (Regrid, ATTOM).
 */
export const countyGisParcelAdapter: FreeSourceAdapter<{ county: string; state: string; apn?: string }, unknown> = async (query) => {
  // TODO: look up county adapter from a registry; for now no free source.
  if (!query?.county || !query?.state) return null;
  return null;
};

// ─────────────────────────────────────────────────────────────────────────────
// Routing table — entityType → ordered list of adapters to try.
// ─────────────────────────────────────────────────────────────────────────────

const ROUTE: Record<string, FreeSourceAdapter<any, any>[]> = {
  flood_zone: [femaFloodAdapter],
  wetlands: [usfwsWetlandsAdapter],
  census: [censusDemographicsAdapter],
  usda: [usdaNassAdapter],
  parcel_polygon: [countyGisParcelAdapter],
  // Skip-trace, AVM, liens have no free equivalent — return null.
};

/**
 * Try every free source registered for `entityType` in order. Return the
 * first success. Returns null when none succeed (caller falls back to a
 * paid provider).
 */
export async function tryFreeSourcesFirst<T = unknown>(
  entityType: string,
  query: unknown,
): Promise<FreeSourceResult<T> | null> {
  const adapters = ROUTE[entityType];
  if (!adapters || adapters.length === 0) return null;
  for (const adapter of adapters) {
    try {
      const r = await adapter(query);
      if (r && r.result !== undefined && r.result !== null) {
        return r as FreeSourceResult<T>;
      }
    } catch (err) {
      logger.warn(`[freeSourceRouter] adapter failed for ${entityType}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return null;
}

/**
 * Lists the registered free sources for diagnostics. The founder cockpit
 * studio/routing pane can render this table.
 */
export function listFreeSourceCoverage(): Array<{ entityType: string; sources: string[] }> {
  return Object.entries(ROUTE).map(([entityType, adapters]) => ({
    entityType,
    sources: adapters.map((a) => a.name || "anonymous"),
  }));
}
