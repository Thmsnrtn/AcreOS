/**
 * Per-category cache TTL (Iris/Quinn/Lena: tie TTL to source cadence).
 *
 * A flat 24h TTL either re-hammers stable endpoints (soils/PLSS never change)
 * or serves stale tax data as fresh. Tie TTL to how often the authoritative
 * source actually changes. Extracted into its own module so it's testable
 * without pulling the DB-bound provider registry into the test process.
 */
import type { DataCategory } from "./types";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const ONE_YEAR_MS = 365 * DAY_MS;
/** Owner/tax-class cadence — used for any category not in the map below. */
export const DEFAULT_CACHE_TTL_MS = 30 * DAY_MS;

export const CATEGORY_CACHE_TTL_MS: Partial<Record<DataCategory, number>> = {
  // flood/wetlands/land-cover ~90d (soils/PLSS handled by LONG_TTL_SOURCES).
  environmental: 90 * DAY_MS,
  demographics: 90 * DAY_MS, // ACS updates annually; 90d is safe
  // Parcel / owner / tax change ~annually but we re-pull monthly to catch
  // ownership transfers + assessment updates.
  parcel_data: 30 * DAY_MS,
  owner_info: 30 * DAY_MS,
  valuation: 30 * DAY_MS,
  property_details: 30 * DAY_MS,
  comps: 30 * DAY_MS,
  structure: 90 * DAY_MS,
  skip_trace: 30 * DAY_MS,
  // Tier-1 open-data expansion (2026-07-28): USFS WHP is re-released roughly
  // annually and FCC BDC availability filings update twice a year — 90d keeps
  // both honest without re-hammering the upstreams.
  wildfire_hazard: 90 * DAY_MS,
  broadband: 90 * DAY_MS,
};

/**
 * Soils + PLSS cadastral effectively never change → ~1 year. These are keyed
 * by the authoritative source NAME (LookupResult.source) rather than category
 * because the open-data provider delivers them under "environmental".
 */
export const LONG_TTL_SOURCES = new Set<string>([
  "USDA SSURGO",
  "USDA WSS",
  "BLM PLSS",
]);

/** TTL in ms for a (category, source) pair. */
export function cacheTtlMs(category: DataCategory, source?: string): number {
  if (source && LONG_TTL_SOURCES.has(source)) return ONE_YEAR_MS;
  return CATEGORY_CACHE_TTL_MS[category] ?? DEFAULT_CACHE_TTL_MS;
}
