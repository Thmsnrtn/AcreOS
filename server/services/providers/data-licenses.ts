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
  /** What the terms say that matters for how AcreOS may use the source. */
  note?: string;
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
    note: "W4 (2026-10-11): the Quick Stats API needs a free key (NASS_API_KEY); without it the land-value recorder refuses. The bulk files at www.nass.usda.gov/datasets/ are an official download (the land-value backtest fixture came from qs.economics_20261010.txt.gz).",
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
  // EPA UST Finder (federal composite of state UST/LUST data) — added with
  // the 2026-07-28 environmental-depth expansion. EPA FRS + EPA ECHO entries
  // already existed above/below.
  "EPA UST Finder": {
    source: "EPA UST Finder",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Underground storage tank data: U.S. EPA UST Finder",
    termsUrl: "https://www.epa.gov/ust/ust-finder",
    lastReviewed: "2026-07-28",
    reviewedBy: "Iris",
  },
  "FEMA NRI": {
    source: "FEMA NRI",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Natural hazard risk: FEMA National Risk Index",
    termsUrl: "https://www.fema.gov/about/openfema/terms-conditions",
    lastReviewed: "2026-06-07",
    reviewedBy: "Iris",
  },
  "USGS": {
    source: "USGS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Data: U.S. Geological Survey",
    termsUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    lastReviewed: "2026-06-07",
    reviewedBy: "Iris",
  },
  "NOAA": {
    source: "NOAA",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Climate/storm data: NOAA",
    termsUrl: "https://www.weather.gov/disclaimer",
    lastReviewed: "2026-06-07",
    reviewedBy: "Iris",
  },
  "MRLC NLCD": {
    source: "MRLC NLCD",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Land cover: MRLC National Land Cover Database",
    termsUrl: "https://www.mrlc.gov",
    lastReviewed: "2026-06-07",
    reviewedBy: "Iris",
  },
  // Tier-1 open-data expansion (founder ruling #10, 2026-07-28).
  "USFS Wildfire Hazard Potential": {
    source: "USFS Wildfire Hazard Potential",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Wildfire hazard: USFS Wildfire Hazard Potential (Wildfire Risk to Communities)",
    termsUrl: "https://research.fs.usda.gov/firelab/products/dataandtools/wildfire-hazard-potential",
    lastReviewed: "2026-07-28",
    reviewedBy: "Iris",
  },
  // FCC BDC: the AVAILABILITY data (provider/technology/speed filings) is
  // public and freely redistributable. The CostQuest location Fabric
  // UNDERNEATH it is a licensed commercial dataset — we must never persist or
  // redistribute Fabric location records (location IDs/coordinates/address
  // attributes of Broadband Serviceable Locations). Our broadband results are
  // availability facts only (served/speeds/technologies/provider count), so
  // the "yes" posture applies to what we actually store. See
  // docs/company/open-data-duediligence.md (licensing flag).
  "FCC Broadband Data Collection": {
    source: "FCC Broadband Data Collection",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Broadband availability: FCC Broadband Data Collection (National Broadband Map)",
    termsUrl: "https://broadbandmap.fcc.gov/data-download",
    lastReviewed: "2026-07-28",
    reviewedBy: "Iris",
  },
  // ── W2 land-data foundation (2026-10-10). Each entry records the terms
  // text that was read, not a guess; robots.txt was checked for every host.
  "USGS PAD-US": {
    source: "USGS PAD-US",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Public lands: USGS Gap Analysis Project, Protected Areas Database of the United States (PAD-US) 4.1",
    termsUrl: "https://www.usgs.gov/programs/gap-analysis-project/science/pad-us-data-overview",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  // The state's own per-county shapefile download — its page states "The
  // shapefile data can be used in a commercial application." The download is
  // a form (no automated or recurring extracts are offered), so a person
  // fetches it; the loader ingests the file. Founder to confirm the reading.
  "TN Comptroller parcel download": {
    source: "TN Comptroller parcel download",
    license: "county-tos",
    redistributable: "attribution",
    attributionText: "Parcels: Tennessee Comptroller of the Treasury, Division of Property Assessments",
    termsUrl:
      "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent (founder to confirm)",
  },
  // The TNMap "Property Boundaries Public Use" feature service. Its item
  // description says "This service is not intended for commercial use" and
  // points commercial users to the download above.
  // FOUNDER DECISION 2026-10-11 (founder's picker; docs/company/
  // founder-decisions-2026-10-11.md): AcreOS stops using it entirely — no live
  // lookup, no stored copy, no sample, no census count. Every outbound fetch
  // refuses its URL (blockedOutboundSources.ts + server/outboundGuard.ts).
  "TN Property Boundaries Public Use service": {
    source: "TN Property Boundaries Public Use service",
    license: "county-tos",
    redistributable: "no",
    attributionText: "Parcels: Tennessee Comptroller of the Treasury / TNMap",
    termsUrl: "https://www.arcgis.com/home/item.html?id=e356f1a241844d6f9025f2fa4e977df3",
    lastReviewed: "2026-10-11",
    reviewedBy: "Founder decision 2026-10-11: not used on any path",
  },
  "TDOT Traffic Counts": {
    source: "TDOT Traffic Counts",
    license: "county-tos",
    redistributable: "attribution",
    attributionText: "Traffic counts: Tennessee Department of Transportation",
    termsUrl: "https://www.arcgis.com/home/item.html?id=59838882a69d426286670dcd25d90e15",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "HUD Fair Market Rents": {
    source: "HUD Fair Market Rents",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Fair Market Rents: U.S. Department of Housing and Urban Development (HUD USER)",
    termsUrl: "https://www.huduser.gov/portal/dataset/fmr-api.html",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "Census LEHD LODES": {
    source: "Census LEHD LODES",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Jobs: U.S. Census Bureau, LEHD Origin-Destination Employment Statistics (LODES 8)",
    termsUrl: "https://lehd.ces.census.gov/data/",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "FEMA Mobile Home Parks (RAPT)": {
    source: "FEMA Mobile Home Parks (RAPT)",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Manufactured-home parks: FEMA Resilience Analysis and Planning Tool (from HIFLD)",
    termsUrl: "https://www.arcgis.com/home/item.html?id=2ba2e5e2007f4a159d4dfab8534beed3",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "USDA NAIP": {
    source: "USDA NAIP",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Imagery: USDA FSA National Agriculture Imagery Program, via USGS The National Map",
    termsUrl: "https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "OpenFreeMap": {
    source: "OpenFreeMap",
    license: "odbl",
    redistributable: "attribution",
    attributionText: "© OpenMapTiles © OpenStreetMap contributors (OpenFreeMap)",
    termsUrl: "https://openfreemap.org/",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  "AWS Terrain Tiles": {
    source: "AWS Terrain Tiles",
    license: "public-domain-usgov",
    redistributable: "attribution",
    attributionText: "Terrain: Mapzen terrain tiles (USGS 3DEP, SRTM and others) via AWS Open Data",
    termsUrl: "https://github.com/tilezen/joerd/blob/master/docs/attribution.md",
    lastReviewed: "2026-10-10",
    reviewedBy: "W2 build agent",
  },
  // Umbrella name for mixed federal/open delegated lookups whose specific
  // source the broker does not surface a single canonical name for. All are
  // public-domain federal works (§105) → redistributable.
  "Open Data": {
    source: "Open Data",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Public open-data sources (federal/open)",
    lastReviewed: "2026-06-07",
    reviewedBy: "Iris",
  },
  // ── W4 forecasting: public series (shared/forecasting/publicSeries.ts) ──
  "FRED/ALFRED (BLS CES)": {
    source: "FRED/ALFRED (BLS CES)",
    license: "public-domain-usgov",
    redistributable: "attribution",
    attributionText: "Payroll employment: U.S. Bureau of Labor Statistics (CES), retrieved from FRED®/ALFRED®, Federal Reserve Bank of St. Louis",
    termsUrl: "https://fred.stlouisfed.org/legal/",
    lastReviewed: "2026-10-11",
    reviewedBy: "W4",
    note: "BLS series are public domain. FRED's terms ask that FRED be cited and forbid scraping or extraction of the website; automated retrieval uses the FRED API with a free key (FRED_API_KEY). Without the key the recorder refuses.",
  },
  "FRED/ALFRED (BLS LAUS)": {
    source: "FRED/ALFRED (BLS LAUS)",
    license: "public-domain-usgov",
    redistributable: "attribution",
    attributionText: "Unemployment rate: U.S. Bureau of Labor Statistics (LAUS), retrieved from FRED®/ALFRED®, Federal Reserve Bank of St. Louis",
    termsUrl: "https://fred.stlouisfed.org/legal/",
    lastReviewed: "2026-10-11",
    reviewedBy: "W4",
    note: "As FRED/ALFRED (BLS CES): public domain at origin, FRED API with a free key for automated retrieval.",
  },
  "US Census BPS": {
    source: "US Census BPS",
    license: "public-domain-usgov",
    redistributable: "yes",
    attributionText: "Building permits: U.S. Census Bureau, Building Permits Survey",
    termsUrl: "https://www.census.gov/construction/bps/",
    lastReviewed: "2026-10-11",
    reviewedBy: "W4",
    note: "Monthly state files are an official download directory (www2.census.gov/econ/bps/State/); no key.",
  },
  "FRED (Philadelphia Fed state coincident indexes)": {
    source: "FRED (Philadelphia Fed state coincident indexes)",
    license: "proprietary",
    redistributable: "no",
    attributionText: "Federal Reserve Bank of Philadelphia, State Coincident Indexes",
    termsUrl: "https://fred.stlouisfed.org/legal/",
    lastReviewed: "2026-10-11",
    reviewedBy: "W4",
    note: "NOT USED. Third-party copyrighted on FRED: \"may only be used for non-commercial educational or personal use\" without the owner's written permission. AcreOS is commercial, so the cycle model reads BLS payrolls instead.",
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
