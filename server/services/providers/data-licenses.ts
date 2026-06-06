/**
 * Data-license register (Beatrice CRO lens, first-customer readiness).
 *
 * Single authoritative map of every data SOURCE → its governing license,
 * attribution string, redistribution posture, terms URL, and last-reviewed
 * date. This is the spine that lets us answer "can we cache and re-serve this
 * row?" from data rather than from a PDF or someone's memory.
 *
 * Federal sources are public-domain under 17 U.S.C. §105 (redistributable: yes).
 * OpenStreetMap is ODbL (attribution + share-alike). County/state portals
 * default to "review-required" until a human reads the specific portal terms —
 * for those, the per-county license lives on `county_gis_endpoints` columns
 * (migration 0120), not here, because they can't be enumerated at build time.
 *
 * The registry consults `redistributableFor(source)` before persisting a
 * result to provider_cache: only "yes"/"attribution" may be cached and
 * re-served; "no"/"review-required" are live-passthrough only.
 */

import type {
  DataLicense,
  RedistributePosture,
} from "./types";

export interface DataLicenseEntry {
  /** Canonical source name — must match LookupResult.source. */
  source: string;
  license: DataLicense;
  redistributable: RedistributePosture;
  /** Rendered wherever this source contributes a displayed value. */
  attributionText?: string;
  /** Link to the governing terms / license page. */
  termsUrl?: string;
  /** ISO date a human last reviewed these terms. */
  lastReviewed: string;
  /** Who performed the review. */
  reviewedBy?: string;
}

/**
 * Federal + well-known open sources, keyed by canonical source name.
 * Keep these names in sync with the `source` strings each provider stamps on
 * its LookupResult.
 */
export const DATA_LICENSE_REGISTER: Record<string, DataLicenseEntry> = {
  "FEMA NFHL": {
    source: "FEMA NFHL",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Flood data: FEMA National Flood Hazard Layer",
    termsUrl: "https://www.fema.gov/about/openfema/terms-conditions",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "USFWS NWI": {
    source: "USFWS NWI",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Wetlands data: U.S. Fish & Wildlife Service National Wetlands Inventory",
    termsUrl: "https://www.fws.gov/wetlands/data/metadata.html",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "USDA SSURGO": {
    source: "USDA SSURGO",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Soil data: USDA NRCS Soil Survey (SSURGO)",
    termsUrl: "https://sdmdataaccess.nrcs.usda.gov",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "USDA WSS": {
    source: "USDA WSS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Soil data: USDA Web Soil Survey",
    termsUrl: "https://websoilsurvey.nrcs.usda.gov",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "USDA NASS": {
    source: "USDA NASS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Ag land values: USDA NASS QuickStats",
    termsUrl: "https://quickstats.nass.usda.gov",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "USGS 3DEP": {
    source: "USGS 3DEP",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Elevation data: USGS 3DEP",
    termsUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "US Census ACS": {
    source: "US Census ACS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Demographics: U.S. Census Bureau (ACS)",
    termsUrl: "https://www.census.gov/data/developers/about/terms-of-service.html",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "US Census TIGER": {
    source: "US Census TIGER",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Boundaries: U.S. Census Bureau (TIGER/Line)",
    termsUrl: "https://www.census.gov/data/developers/about/terms-of-service.html",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "BLM PLSS": {
    source: "BLM PLSS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Cadastral data: BLM PLSS",
    termsUrl: "https://www.blm.gov/services/geospatial",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "EPA FRS": {
    source: "EPA FRS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Environmental data: U.S. EPA Facility Registry Service",
    termsUrl: "https://www.epa.gov/frs",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "EPA ECHO": {
    source: "EPA ECHO",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Compliance data: U.S. EPA ECHO",
    termsUrl: "https://echo.epa.gov",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "OpenStreetMap": {
    source: "OpenStreetMap",
    license: "odbl",
    // ODbL permits redistribution WITH attribution + share-alike. We treat it
    // as attribution-required for caching, and keep OSM-derived fields as
    // display context, never as a resold derived database.
    redistributable: "attribution",
    attributionText: "© OpenStreetMap contributors",
    termsUrl: "https://www.openstreetmap.org/copyright",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  // Paid feeds — proprietary, contract governs. Default conservative: do not
  // bulk-redistribute. Per-contract cache TTL / attribution gets populated
  // when each contract is signed (Beatrice item 7).
  "Regrid": {
    source: "Regrid",
    license: "proprietary",
    redistributable: "no",
    attributionText: "Parcel data: Regrid",
    termsUrl: "https://regrid.com/terms",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "ATTOM Data": {
    source: "ATTOM Data",
    license: "proprietary",
    redistributable: "no",
    attributionText: "Property data: ATTOM Data",
    termsUrl: "https://www.attomdata.com/terms",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
  "BatchData": {
    source: "BatchData",
    license: "proprietary",
    redistributable: "no",
    attributionText: "Skip-trace data: BatchData",
    termsUrl: "https://batchdata.com/terms",
    lastReviewed: "2026-06-06",
    reviewedBy: "Beatrice",
  },
};

/** Conservative default for any source not in the register. */
export const UNKNOWN_LICENSE_ENTRY: DataLicenseEntry = {
  source: "unknown",
  license: "county-tos",
  redistributable: "review-required",
  lastReviewed: "1970-01-01",
};

/** Look up the register entry for a source name (fallback = review-required). */
export function licenseFor(source: string): DataLicenseEntry {
  return DATA_LICENSE_REGISTER[source] ?? { ...UNKNOWN_LICENSE_ENTRY, source };
}

/** Redistribution posture for a source name. */
export function redistributableFor(source: string): RedistributePosture {
  return licenseFor(source).redistributable;
}

/** Attribution string for a source name, if any. */
export function attributionFor(source: string): string | undefined {
  return licenseFor(source).attributionText;
}

/**
 * Whether a result from `source` may be persisted to provider_cache and
 * re-served. Only "yes"/"attribution" qualify; "no"/"review-required" are
 * live-passthrough only (Beatrice items 1+2).
 */
export function mayCacheAndRedistribute(source: string): boolean {
  const posture = redistributableFor(source);
  return posture === "yes" || posture === "attribution";
}
