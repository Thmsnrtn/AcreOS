/**
 * Tier-2 bulk open-data corpora — machine-readable registry.
 *
 * Founder ruling 2026-07-28 #10 (docs/company/founder-decisions-2026-07-28.md):
 * own the public-domain corpora (~$10–30/mo object storage), woven into Wave 3
 * of the open-data intelligence program. This file is the checkable registry
 * of WHICH corpora were approved — same discipline as
 * shared/governance/constitution.ts: typed entries, exported const array,
 * mirrored from the authoritative research doc (docs/company/open-data-maps.md
 * + open-data-program.md), never invented here.
 *
 * HONESTY CONTRACT (no-fabrication doctrine, same as the watchdog scaffolding,
 * ruling #8): object storage is NOT provisioned and no ingestion pipeline
 * exists. Every entry's ingestStatus is "not_provisioned" and stays that way
 * until real bytes actually land in a real bucket. approxSizeGB is null
 * wherever the research doc states no per-corpus total — a null is honest,
 * a guessed number is fabrication.
 *
 * There is deliberately NO "ingested" status in this wave's vocabulary:
 * with no ingestion code in the repo, no code path could truthfully claim it.
 */

/**
 * License classes, mirrored from docs/company/open-data-maps.md /
 * open-data-program.md:
 *  - public-domain-usgov: US federal work, 17 U.S.C. — no attribution required
 *    (courtesy credits noted per-entry where the doc names them).
 *  - cc0: explicitly catalogued under CC0 (TIGER/Line on data.gov).
 *  - odbl: ODbL — attribution required, and share-alike applies to derivative
 *    DATABASES (see the Overture entry's licenseNote; the program principle is
 *    "tiles are Produced Works — never redistribute a merged database").
 *  - state-public-record: state open-parcel programs — public record with
 *    per-state disclaimers (open-data-program.md "Free with real terms"),
 *    NOT federal public domain, so labeling them public-domain-usgov would
 *    misstate the license.
 */
export type CorpusLicense =
  | "public-domain-usgov"
  | "cc0"
  | "odbl"
  | "state-public-record";

/**
 * The ONLY statuses that exist this wave. "not_provisioned" = no object
 * storage configured; "storage_configured_pipeline_pending" = the founder set
 * the OPEN_DATA_BUCKET_* keys but no ingestion pipeline exists yet, so nothing
 * has been ingested. An "ingested" status is deliberately absent — it may only
 * be added in the wave that ships real ingestion code.
 */
export type CorpusIngestStatus =
  | "not_provisioned"
  | "storage_configured_pipeline_pending";

export interface CorpusManifestEntry {
  /** Stable kebab-case id — never reused, never renamed. */
  key: string;
  /** Short human name. */
  name: string;
  /** Publishing organization. */
  sourceOrg: string;
  license: CorpusLicense;
  /** Exact license nuance mirrored from the research doc, where one exists. */
  licenseNote?: string;
  /**
   * Total corpus size in GB — ONLY where docs/company/open-data-maps.md
   * states one. null = the doc states no per-corpus total. Never invented.
   */
  approxSizeGB: number | null;
  /** Refresh cadence as documented; honest "no fixed cadence" where unstated. */
  refreshCadence: string;
  /** One sentence: what owning this corpus unlocks for the platform. */
  whatItUnlocks: string;
  /** All "not_provisioned" today — storage does not exist yet. */
  ingestStatus: "not_provisioned";
}

/**
 * Sentinel reason string reported for every corpus while no object storage is
 * configured. corporaStatus.ts returns this verbatim — tests pin it.
 */
export const STORAGE_NOT_PROVISIONED =
  "object storage not provisioned — set OPEN_DATA_BUCKET_* to arm the ingestion pipeline" as const;

/**
 * The env keys the FUTURE ingestion pipeline will read (any S3-compatible
 * store — R2, S3, etc.; ~$10–30/mo at full corpus scale per the program
 * research). All four must be set before storage counts as configured.
 * Documented (commented out) in .env.example.
 */
export const OPEN_DATA_BUCKET_ENV_KEYS = [
  "OPEN_DATA_BUCKET_ENDPOINT",
  "OPEN_DATA_BUCKET_NAME",
  "OPEN_DATA_BUCKET_ACCESS_KEY_ID",
  "OPEN_DATA_BUCKET_SECRET",
] as const;

export type OpenDataBucketEnvKey = (typeof OPEN_DATA_BUCKET_ENV_KEYS)[number];

/**
 * The approved Tier-2 corpora (founder ruling 2026-07-28 #10). Sources,
 * licenses, and cadences mirror docs/company/open-data-maps.md §2–7 and
 * open-data-program.md Phase 3/4 exactly.
 */
export const TIER2_CORPORA: readonly CorpusManifestEntry[] = [
  {
    key: "naip-aerial",
    name: "USDA NAIP aerial imagery (RGB COGs)",
    sourceOrg: "USDA FSA (via AWS Open Data, naip-visualization bucket)",
    license: "public-domain-usgov",
    licenseNote:
      'Public domain (US federal); "Courtesy USDA FSA" is courteous, not required. ' +
      "The naip-visualization bucket is Requester-Pays: free within us-west-2, " +
      "egress billed otherwise — process in-region.",
    approxSizeGB: null,
    refreshCadence: "2–3 year cycle per state (60 cm standard since 2018; 30 cm option)",
    whatItUnlocks:
      "Self-hosted aerial basemap for active markets — independence from USGS/Esri endpoint uptime and licensing ambiguity.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "usgs-3dep-dem-1m",
    name: "USGS 3DEP 1 m DEM (COG, 10×10 km tiles)",
    sourceOrg: "USGS (3D Elevation Program)",
    license: "public-domain-usgov",
    licenseNote:
      'All 3DEP products are public domain; "Courtesy of the U.S. Geological Survey" appreciated, not required.',
    approxSizeGB: null,
    refreshCadence: "as new lidar acquisitions publish (no fixed national cadence stated)",
    whatItUnlocks:
      "Self-generated terrain-RGB, sharp hillshade, and honest slope/contour analytics for land buyers — upgrading Phase-1 point sampling.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "usgs-3dep-lidar-ept",
    name: "USGS 3DEP lidar point clouds (Entwine Point Tiles)",
    sourceOrg: "USGS (3DEP LPC on AWS Open Data, usgs-lidar bucket)",
    license: "public-domain-usgov",
    licenseNote: "Public domain; standard Open Data bucket (no requester-pays).",
    approxSizeGB: null,
    refreshCadence: "as new lidar acquisitions publish (no fixed national cadence stated)",
    whatItUnlocks:
      "Full-density point clouds for canopy/structure analysis and future 3D parcel visualization, streamable without preprocessing.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "statewide-parcels-bulk",
    name: "Statewide parcel bulk (FL, MT, NC, WA, NJ, AR, TN — the 7 verified states)",
    sourceOrg: "State GIS programs (live-verified 2026-07-13, statewideParcelEndpoints.ts)",
    license: "state-public-record",
    licenseNote:
      "Public record with per-state disclaimers (open-data-program.md); NOT federal public domain. " +
      "Lookup seam is live; bulk ingest into parcel_snapshots remains open.",
    approxSizeGB: null,
    refreshCadence: "varies per state program (no single documented cadence)",
    whatItUnlocks:
      "Bulk parcel polygons + attributes replacing per-parcel Regrid spend for lead gen in the free states.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "annual-nlcd",
    name: "Annual NLCD land cover 1985–2025 (30 m, CONUS)",
    sourceOrg: "USGS / MRLC",
    license: "public-domain-usgov",
    approxSizeGB: null,
    refreshCadence: "annual",
    whatItUnlocks:
      "Four decades of land-cover change detection per parcel — the temporal-spine signal no live endpoint can serve.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "usda-cdl",
    name: "USDA NASS Cropland Data Layer (annual, CONUS)",
    sourceOrg: "USDA NASS",
    license: "public-domain-usgov",
    licenseNote:
      '"No copyright restrictions… public domain and free to redistribute"; NASS appreciates acknowledgment (not required). 30 m historically; 10 m beginning with 2024.',
    approxSizeGB: null,
    refreshCadence: "annual",
    whatItUnlocks:
      "Crop-specific land-use history for agricultural valuation and land-use change detection.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "blm-plss-cadnsdi",
    name: "BLM PLSS CadNSDI state GDBs (section-township-range)",
    sourceOrg: "BLM (Cadastral / CadNSDI)",
    license: "public-domain-usgov",
    licenseNote:
      'US federal (BLM) — public domain in practice; no explicit license statement verified, so the doc marks it "unclear (federal, assumed PD)"; credit "BLM Cadastral/CadNSDI" recommended.',
    approxSizeGB: null,
    refreshCadence: "no fixed cadence stated (BLM releases)",
    whatItUnlocks:
      "Self-tiled section/township/range overlay — the killer map feature for rural land — without leaning on BLM's no-SLA MapServer.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "census-tiger-line",
    name: "Census TIGER/Line boundaries (roads, counties, states, places, tracts)",
    sourceOrg: "US Census Bureau",
    license: "cc0",
    licenseNote: "Public domain; data.gov catalogs releases under CC0 — no attribution required.",
    approxSizeGB: null,
    refreshCadence: "annual releases",
    whatItUnlocks:
      "Topology-complete national boundary/reference tiles owned outright, refreshed on our schedule.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "dot-nad-addresses",
    name: "National Address Database (~80M address points)",
    sourceOrg: "USDOT",
    license: "public-domain-usgov",
    licenseNote:
      '"Work of the federal government… not subject to copyright (17 U.S.C.)". Coverage not uniform — mix of full/partial/non-participating states.',
    approxSizeGB: null,
    refreshCadence: "periodic USDOT releases (no fixed cadence stated)",
    whatItUnlocks:
      "A self-hosted address-point layer and geocoding substrate independent of paid geocoders.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "pad-us",
    name: "PAD-US protected/public lands inventory (4.x)",
    sourceOrg: "USGS GAP Analysis Project",
    license: "public-domain-usgov",
    licenseNote: "Public domain (inclusion requires PD-distributable data).",
    approxSizeGB: null,
    refreshCadence: "versioned releases (no fixed cadence stated)",
    whatItUnlocks:
      "Public-land adjacency as an owned overlay — a core rural-land value signal served from our own tiles.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "usgs-3dhp-hydrography",
    name: "USGS 3DHP hydrography (successor to NHD/WBD/NHDPlus HR)",
    sourceOrg: "USGS (3D Hydrography Program)",
    license: "public-domain-usgov",
    licenseNote: "Public domain (USGS). NHD retired Oct 2023 — 3DHP is the maintained successor.",
    approxSizeGB: null,
    refreshCadence: "quarterly service updates",
    whatItUnlocks:
      "Streams, lakes, and watersheds baked into our own vector tiles — water frontage detection without a federal endpoint in the hot path.",
    ingestStatus: "not_provisioned",
  },
  {
    key: "overture-buildings",
    name: "Overture Maps buildings theme (GeoParquet)",
    sourceOrg: "Overture Maps Foundation (conflates OSM + Microsoft ML + Google Open Buildings + Esri)",
    license: "odbl",
    licenseNote:
      "ODbL (because OSM is an input). Commercial use is fine, but: on-map attribution " +
      '"© OpenStreetMap contributors", and SHARE-ALIKE applies to derivative databases — ' +
      "if we mix Overture buildings into our own database and distribute it, that derivative " +
      "DB must be ODbL. Rendering tiles/maps (Produced Works) only needs attribution, not " +
      "share-alike — so this corpus stays in tiles and is never merged into a redistributed database.",
    approxSizeGB: null,
    refreshCadence: "monthly releases",
    whatItUnlocks:
      "Best-available open building footprints as a tile overlay — structure detection on rural parcels.",
    ingestStatus: "not_provisioned",
  },
] as const;

/** Lookup helper, constitution.ts style. */
export function corpusByKey(key: string): CorpusManifestEntry | undefined {
  return TIER2_CORPORA.find((c) => c.key === key);
}
