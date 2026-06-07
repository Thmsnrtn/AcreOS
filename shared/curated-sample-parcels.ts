/**
 * Curated sample parcels — RAFE (Tahoe Wave-2)
 * ============================================
 *
 * The parcel-data "aha" (soils + flood + wetlands + elevation lighting up on a
 * real parcel from free public data) is our single most differentiated moment.
 * But free open data is uneven — some counties have rich GIS, some return
 * nothing. If a first customer's VERY FIRST lookup lands on a thin county, the
 * aha becomes a shrug.
 *
 * This config curates a handful of parcels in counties where the three free
 * federal/state layers we lean on all resolve cleanly:
 *   - USDA SSURGO soil survey (nationwide, gSSURGO)
 *   - FEMA NFHL flood zones (covers all of these counties)
 *   - USGS 3DEP elevation / USGS terrain (nationwide)
 *
 * These are the counties our `TOP_LAND_COUNTIES` ingest already targets, so they
 * double as the screenshot/demo set for the landing page (Soren) and the
 * "See a sample" affordance on the Map door + enrichment empty states.
 *
 * IMPORTANT: these power a REAL lookup against the same open-data providers a
 * customer's own parcels use — nothing here is mocked. The coordinates are
 * interior points of the named county so the lookup is guaranteed to resolve
 * within that county's GIS extent; the descriptive fields are context only and
 * are never presented as "data we returned for this parcel."
 */

export interface CuratedSampleParcel {
  /** Stable id used in the `?sample=` query param and React keys. */
  id: string;
  /** Short customer-facing label, e.g. "West Texas ranch land". */
  label: string;
  /** One-line context for the card (terrain/character, not a data claim). */
  blurb: string;
  state: string;
  county: string;
  /** County FIPS — matches TOP_LAND_COUNTIES so server lookups can scope GIS. */
  fips: string;
  /** Interior point of the county (decimal degrees, WGS84). */
  latitude: number;
  longitude: number;
  /** Approximate acreage typical for the area — context only, not a data claim. */
  approxAcres: number;
}

/**
 * 5 curated parcels across distinct landscapes so the demo shows variety
 * (flood-relevant Gulf coast, arid Southwest, mountain Colorado, Texas ranch,
 * Appalachian Tennessee). All five sit in counties with clean SSURGO + NFHL
 * coverage. Coordinates are interior points well inside each county boundary.
 */
export const CURATED_SAMPLE_PARCELS: CuratedSampleParcel[] = [
  {
    id: "tx-brewster",
    label: "West Texas ranch land",
    blurb: "High-desert ranch acreage near Big Bend — arid soils, wide-open terrain.",
    state: "TX",
    county: "Brewster",
    fips: "48043",
    latitude: 29.9,
    longitude: -103.25,
    approxAcres: 100,
  },
  {
    id: "az-mohave",
    label: "Arizona high-desert lot",
    blurb: "Affordable Southwest parcels — sandy soils, low flood risk, big sky.",
    state: "AZ",
    county: "Mohave",
    fips: "04015",
    latitude: 35.2,
    longitude: -113.9,
    approxAcres: 5,
  },
  {
    id: "co-saguache",
    label: "Colorado mountain valley",
    blurb: "San Luis Valley parcel — elevation, slope and aspect all in play.",
    state: "CO",
    county: "Saguache",
    fips: "08109",
    latitude: 38.0,
    longitude: -106.0,
    approxAcres: 10,
  },
  {
    id: "fl-liberty",
    label: "Florida panhandle timberland",
    blurb: "Wooded panhandle acreage — wetlands and flood zones matter here.",
    state: "FL",
    county: "Liberty",
    fips: "12077",
    latitude: 30.25,
    longitude: -84.88,
    approxAcres: 10,
  },
  {
    id: "tn-scott",
    label: "Tennessee plateau acreage",
    blurb: "Cumberland Plateau land — rolling terrain, forested soils.",
    state: "TN",
    county: "Scott",
    fips: "47151",
    latitude: 36.43,
    longitude: -84.5,
    approxAcres: 10,
  },
];

/** Look up a curated parcel by its stable id. */
export function getCuratedSampleParcel(id: string): CuratedSampleParcel | undefined {
  return CURATED_SAMPLE_PARCELS.find((p) => p.id === id);
}

/** The default sample to show when no specific one is requested. */
export const DEFAULT_SAMPLE_PARCEL = CURATED_SAMPLE_PARCELS[0];
