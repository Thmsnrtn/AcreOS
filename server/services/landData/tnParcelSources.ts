/**
 * Tennessee parcel sources for the W2 showcase — and which one may be used
 * for what (terms read 2026-10-10).
 *
 * 1. TN_PUBLIC_PARCEL_SERVICE — the TNMap "Tennessee Property Boundaries
 *    Public Use" feature service (2,141,289 features, 86 counties). Its item
 *    description: "This service is not intended for commercial use. For
 *    commercial purposes, we recommend that you download the data at the
 *    Tennessee Comptroller of the Treasury's webpage." So AcreOS never stores
 *    or re-serves anything from it. It is used for (a) the existing live
 *    point lookup (a pre-W2 decision — flagged to the founder) and (b) small,
 *    labelled verification samples for the accuracy gate.
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

export const TN_PUBLIC_PARCEL_SERVICE = {
  licenseSource: "TN Property Boundaries Public Use service",
  layerUrl:
    "https://services1.arcgis.com/YuVBSS7Y1of2Qud1/arcgis/rest/services/Tennessee_Property_Boundaries_Public_Use/FeatureServer/0",
  itemUrl: "https://www.arcgis.com/home/item.html?id=e356f1a241844d6f9025f2fa4e977df3",
  termsQuote: "This service is not intended for commercial use.",
  mayStore: false,
} as const;

export const TN_COMPTROLLER_DOWNLOAD = {
  licenseSource: "TN Comptroller parcel download",
  pageUrl:
    "https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html",
  termsQuote: "The shapefile data can be used in a commercial application.",
  automatedDownload: false,
  joinField: "GISLINK",
  mayStore: true,
} as const;

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
