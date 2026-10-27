/**
 * Tennessee parcel sources for the W2 showcase — and which one may be used
 * for what (terms read 2026-10-10).
 *
 * 1. The TNMap "Tennessee Property Boundaries
 *    Public Use" feature service (2,141,289 features, 86 counties). Its item
 *    description: "This service is not intended for commercial use. For
 *    commercial purposes, we recommend that you download the data at the
 *    Tennessee Comptroller of the Treasury's webpage." So AcreOS never stores
 *    or re-serves anything from it. Founder decision 2026-10-11: it is not
 *    used at all any more — every outbound fetch refuses its URL
 *    (server/services/providers/blockedOutboundSources.ts).
 *
 * 2. TN_COMPTROLLER_DOWNLOAD — the Comptroller's per-county shapefile
 *    download: "The shapefile data can be used in a commercial application",
 *    updated weekly, with an Assessment_Data_##.dbf joined on GISLINK that
 *    carries owner, property, land-use and assessment fields. It is offered
 *    through a request form and "we do not offer … any recurring extracts or
 *    other automated downloads", so a person downloads each county and the
 *    loader ingests the file. That is the ONLY source the showcase may store.
 *
 * Nine counties maintain their own data and are in neither source: Chester,
 * Davidson, Hamilton, Hickman, Knox, Montgomery, Rutherford, Shelby and
 * Williamson — their status lives in the county source census.
 */

import { unresolvedDossier, type SourceDossier } from "@shared/openData/sourcePolicy";

export const TN_COMPTROLLER_DOWNLOAD = {
  licenseSource: "TN Comptroller parcel download",
  pageUrl:
    "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
  termsQuote: "The shapefile data can be used in a commercial application.",
  automatedDownload: false,
  joinField: "GISLINK",
  mayStore: true,
} as const;

/**
 * The Comptroller download's use-class dossier — what UPLOADING a copy (to the
 * open-data bucket, where it is redistributable) needs. Every class is
 * unresolved: the 2026-10-10 quote ("can be used in a commercial
 * application") supports keeping the county's parcels for AcreOS's own
 * product, which the loader still does, but says nothing on display,
 * redistribution or resale, and D2h §B2 found its cadence wording conflicting.
 * Until a person re-reads the page and records each finding here, no TN
 * artifact is uploaded (docs/land-data/dossiers/TN.md).
 */
export const TN_COMPTROLLER_DOSSIER: SourceDossier = unresolvedDossier(
  TN_COMPTROLLER_DOWNLOAD.pageUrl,
  "the 2026-10-10 terms quote covers commercial use of the shapefile, not storing, displaying, redistributing or reselling a copy — re-read the page and record each use class (D2h §B2)",
);

/** Counties the Comptroller does not maintain (from the download page). */
export const TN_SELF_MAINTAINED_COUNTIES = [
  "Chester",
  "Davidson",
  "Hamilton",
  "Hickman",
  "Knox",
  "Montgomery",
  "Rutherford",
  "Shelby",
  "Williamson",
] as const;

/**
 * Field mapping for the Comptroller download. The parcel-layer fields are the
 * ones the public service exposes (same Comptroller schema, verified live:
 * GISLINK, PARCELID, DEEDAC, SUBDIV, LOT, COUNTY_NAME). The Assessment_Data
 * owner-mailing-state field is NOT verified here — the download's own field
 * dictionary names it — so it is a required loader argument, never a guess.
 */
export const TN_PARCEL_FIELDS = {
  gisLink: "GISLINK",
  parcelId: "PARCELID",
  deededAcres: "DEEDAC",
  subdivision: "SUBDIV",
  lot: "LOT",
  countyName: "COUNTY_NAME",
} as const;
