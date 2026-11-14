/**
 * Field-clearance registry — the transcription of the written determinations
 * the dossier program already holds into per-field / per-class records
 * (register I-6; conceptual-gap sweep (e) §§1a, 2b, 2c).
 *
 * WHAT THIS IS. One record per data object with a written determination:
 * the 14 counties display-green in writing (5 fully green, 9 with limits,
 * compiled 2026-11-12 in hidden_files/display-green-counties-2026-11-12.md)
 * plus the state-level objects the same program recorded. Each record is a
 * transcription of a determination already made, never new legal work: its
 * evidence, source and conditions are the dossier program's own words.
 *
 * WHAT THIS IS NOT. No record here is a live clearance. Every record carries
 * the program's DRAFT-for-attorney-review posture, and nothing in this file
 * is read by the live lookup gate to widen what serves today:
 * LOOKUP_CLEARANCE (statewideSourceRegistry.ts) still clears no state, and
 * the per-county live-query GIS seam is unchanged by this package. The
 * registry is the machinery the reviewed per-source enablement will consume —
 * fieldClearanceAnswer() answers what a determination permits, per field and
 * per class, and the passport's partial assembly is proven against it in
 * tests. Enabling any record for live serving stays a reviewed code change
 * per source, pinned by tests/unit/fieldLevelServing.test.ts: widening a
 * record's servableFields or a class without changing that pin fails CI.
 */

import {
  fieldClearanceAnswer,
  type FieldClearanceAnswer,
  type FieldClearanceRecord,
  type LookupUseClass,
} from "@shared/openData/fieldClearance";

const DRAFT = "draft_for_attorney_review" as const;
const ALL_FIELDS = ["geometry", "identifiers", "assessment", "situs", "ownerName", "ownerMailing"] as const;
const NO_OWNER_FIELDS = ["geometry", "identifiers", "assessment", "situs"] as const;
const PERMITTED_ALL = {
  internal: "permitted",
  display: "permitted",
  redistribution: "permitted",
  resale: "permitted",
  lookupDisplay: "permitted",
} as const;

const COUNTY_RECORDS: readonly FieldClearanceRecord[] = [
  {
    state: "TX",
    county: "Harris",
    objectScope: "HCAD parcel layer (produced entirely by the District)",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: 'HCAD IT answered "Yes, this is permissible" to all four classes; no licence required; no third-party copyrights.',
    evidenceSource: "licensing-threads.md (Kellum relaying HCAD IT, 2026-11-10); recorded in dossier pack TX.md",
    recordedOn: "2026-11-10",
    conditions: [],
  },
  {
    state: "IN",
    county: "Delaware",
    objectScope: "Open-data portal parcel data",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: 'Portal data "for use for any purpose"; no fees, no licence; the county afterwards confirmed the per-class summary in writing ("your summary looks correct") — the only county-confirmed recording in the program.',
    evidenceSource: "licensing-threads.md (Johnson, 2026-11-12, confirmed 2026-11-12); pack W4C-IN-Delaware.md",
    recordedOn: "2026-11-12",
    conditions: [],
  },
  {
    state: "GA",
    county: "Madison",
    objectScope: "qPublic information only",
    objectKey: "qpublic",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: "All four classes permitted for the qPublic information, on the Deputy Chief Appraiser's stated understanding; bulk CAMA export / GIS shapefiles unresolved (the $150 export was standard-declined).",
    evidenceSource: "licensing-threads.md (Kappeler, 2026-11-10); pack W4C-GA-Madison.md",
    recordedOn: "2026-11-10",
    conditions: ["The determination is a Deputy Chief Appraiser's stated understanding with an express \"not an attorney\" caveat."],
  },
  {
    state: "GA",
    county: "Paulding",
    objectScope: "Board of Assessors parcel data only",
    objectKey: "assessors",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: 'Board of Assessors: "No restrictions" to all four classes for its parcel data. The county GIS Division\'s data is a DIFFERENT object with the opposite answer (redistribution/resale prohibited, licence-only) — it has no record here and serves nothing.',
    evidenceSource: "Pack W4C-GA-Paulding.md (Stokes, Board of Assessors, 2026-11-09; McCracken, GIS Division, 2026-11-09)",
    recordedOn: "2026-11-09",
    conditions: ["The 108.7 MB Assessor dataset is held, not loaded; this record transcribes the determination, it does not ingest anything."],
  },
  {
    state: "CA",
    county: "Sacramento",
    objectScope: "Parcels layer as published",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: NO_OWNER_FIELDS,
    evidence: "The layer as published carries a CC0 Public Domain Dedication in its own licenseInfo. Owner names are absent from every online surface, so no owner field group is servable — there is nothing to serve and nothing is backfilled.",
    evidenceSource: "COUNTY-QUEUE.md Tranche 2 index; pack W3C-CA-Sacramento.md",
    recordedOn: "2026-11-12",
    conditions: [
      "Badge defect: the badge image links CC BY 4.0 while the licenseInfo says CC0. Worst-case (CC BY) reading still permits all classes with attribution; the county has been asked to confirm CC0.",
    ],
  },
  {
    state: "IL",
    county: "DuPage",
    objectScope: "County parcel data under the Board-approved Open Geo-Spatial Data License v1.0",
    posture: DRAFT,
    classes: { internal: "permitted", display: "permitted", redistribution: "permitted", resale: "unresolved", lookupDisplay: "permitted" },
    servableFields: ["geometry", "identifiers", "assessment", "situs", "ownerName"],
    evidence: "Internal / display / redistribution / per-parcel lookup permitted under the county's Open Geo-Spatial Data License v1.0, including commercial purposes; billing owner names are in the data. Raw/bulk resale is unresolved — \"sell\" is not an enumerated verb in the licence. Owner mailing was not separately stated, so the ownerMailing group is not transcribed as servable.",
    evidenceSource: "COUNTY-QUEUE.md Tranche 2 index; pack W3C-IL-DuPage.md",
    recordedOn: "2026-11-12",
    conditions: [],
  },
  {
    state: "CA",
    county: "Los Angeles",
    objectScope: "County Parcels item as published on the open-data portal",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "permitted_with_conditions",
      resale: "unresolved",
      lookupDisplay: "unresolved",
    },
    servableFields: NO_OWNER_FIELDS,
    evidence: "Internal / display / redistribution permitted-with-conditions under the LA County Open Data Terms §3 grant. Resale and paid lookup-display are unresolved (four-text conflict). Owner names are absent from the public layer.",
    evidenceSource: "COUNTY-QUEUE.md Tranche 1 index; pack W3C-CA-LosAngeles.md",
    recordedOn: "2026-11-12",
    conditions: [
      "Condition precedent: the Parcels item's own licenseInfo was never read. If counsel requires item-level attachment, this record drops to unresolved in every class.",
    ],
  },
  {
    state: "CA",
    county: "San Francisco",
    objectScope: "Published DataSF parcel datasets",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "permitted_with_conditions",
      resale: "permitted_with_conditions",
      lookupDisplay: "permitted_with_conditions",
    },
    servableFields: NO_OWNER_FIELDS,
    evidence: "All classes permitted-with-conditions under the Public Domain Dedication and License (PDDL) for the published DataSF datasets. Owner names are not in the published data and owner-name uses are unresolved (the purchase / in-person channel is a founder blocker), so no owner group is servable.",
    evidenceSource: "Pack W4C-CA-SanFrancisco.md; licensing-threads.md (2026-11-09)",
    recordedOn: "2026-11-12",
    conditions: ["PDDL §VI: no re-identification of individuals from the data."],
  },
  {
    state: "IL",
    county: "Hamilton",
    objectScope: "Published county parcel data (live display only)",
    posture: DRAFT,
    classes: { internal: "unresolved", display: "permitted", redistribution: "prohibited", resale: "permitted", lookupDisplay: "permitted" },
    servableFields: ALL_FIELDS,
    evidence: "Display (including live lookup) and resale/commercial use permitted; redistribution PROHIBITED; internal use unresolved (the GIS data purchase channel, $1,000, was not purchased — founder blocker).",
    evidenceSource: "licensing-threads.md (Hopfinger, 2026-11-09); pack W4C-IL-Hamilton.md",
    recordedOn: "2026-11-09",
    conditions: ["Internal unresolved means no warehouse copy: live display only, no caching of this source's parcels."],
  },
  {
    state: "KY",
    county: "McCracken",
    objectScope: "PVA parcel data",
    posture: DRAFT,
    classes: { internal: "permitted", display: "permitted", redistribution: "prohibited", resale: "permitted", lookupDisplay: "permitted" },
    servableFields: ALL_FIELDS,
    evidence: 'Internal / display / resale permitted — resale resolved by the PVA\'s later reply: "you\'d be permitted to selling the data to customers inside a paid product". Redistribution PROHIBITED (the licence is for our use).',
    evidenceSource: "licensing-threads.md (Dunn, 2026-11-12, both replies); pack W4C-KY-McCracken.md",
    recordedOn: "2026-11-12",
    conditions: ["The data sits under the KY DOR contract/fee schedule channel (founder blocker) — the determination is recorded, acquisition is not authorised by this record."],
  },
  {
    state: "IL",
    county: "Shelby",
    objectScope: "The one office-provided CSV file only",
    objectKey: "office-csv",
    posture: DRAFT,
    classes: { internal: "unresolved", display: "permitted", redistribution: "permitted", resale: "permitted", lookupDisplay: "permitted" },
    servableFields: ALL_FIELDS,
    evidence: "Display / lookup-display / redistribution / resale permitted for the office-provided CSV file only; internal use was not individually addressed and stays unresolved. Every other county object has no determination and serves nothing.",
    evidenceSource: "licensing-threads.md (Dunaway, 2026-11-09, incl. confirmation); pack W4C-IL-Shelby.md",
    recordedOn: "2026-11-09",
    conditions: ["The file itself is HELD unused; this record transcribes the determination, it does not load the file."],
  },
  {
    state: "GA",
    county: "Union",
    objectScope: "GIS parcel geometry only",
    objectKey: "gis-geometry",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ["geometry"],
    evidence: 'GIS parcel geometry provided "without restrictions to use however you like" (with the county accuracy disclaimer to end users). Attribute / CAMA data is unresolved — the Assessor\'s Office holds it and a separate inquiry is owed — so no attribute field group is servable.',
    evidenceSource: "licensing-threads.md (Seabolt, 2026-11-09); pack W4C-GA-Union.md",
    recordedOn: "2026-11-09",
    conditions: ["County accuracy disclaimer travels with the geometry."],
  },
  {
    state: "WA",
    county: "Ferry",
    objectScope: "The free shapefile only (parcel number + acreage, no owner names)",
    objectKey: "free-shapefile",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ["identifiers", "assessment"],
    evidence: "All classes permitted for the free shapefile object, whose only fields are parcel number and acreage. The full database is unresolved (vendor channel + county authorisation form — founder blocker) and serves nothing.",
    evidenceSource: "licensing-threads.md (Siracuse, 2026-11-10); pack W4C-WA-Ferry.md",
    recordedOn: "2026-11-10",
    conditions: [],
  },
  {
    state: "WA",
    county: "Grays Harbor",
    objectScope: "Publicly downloadable parcel data",
    posture: DRAFT,
    classes: { internal: "permitted", display: "permitted", redistribution: "unresolved", resale: "unresolved", lookupDisplay: "permitted" },
    servableFields: NO_OWNER_FIELDS,
    evidence: "Internal / display / lookup-display / commercial use in a paid product permitted for the publicly downloadable data. Redistribution and resale of the data itself are unresolved (not separately confirmed). Owner names were removed from the downloadable datasets, so no owner group is servable.",
    evidenceSource: "licensing-threads.md (Lindgren, 2026-11-09); pack W4C-WA-GraysHarbor.md",
    recordedOn: "2026-11-09",
    conditions: ["List restrictions under RCW 42.56.070(8) apply."],
  },
];

const STATE_RECORDS: readonly FieldClearanceRecord[] = [
  {
    state: "WI",
    county: "*",
    objectScope: "Wisconsin Statewide Parcels layer (V12)",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: "Permitted, all classes (public domain; §757.07 shielding condition is applied upstream by the publisher).",
    evidenceSource: "Dossier pack WI.md; statewideSourceRegistry.ts RESOLVED_DOSSIERS (WI)",
    recordedOn: "2026-11-03",
    conditions: ["Publisher-redacted owner names are stored as published (\"NOT AVAILABLE\") and never backfilled."],
  },
  {
    state: "MA",
    county: "*",
    objectScope: "MassGIS statewide parcels",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: "Permitted, all classes (MassGIS policy).",
    evidenceSource: "Dossier pack W3-MA.md",
    recordedOn: "2026-11-12",
    conditions: [],
  },
  {
    state: "CT",
    county: "*",
    objectScope: "Connecticut statewide parcels (current item)",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ALL_FIELDS,
    evidence: "CC0 verified on the current item; all classes permitted.",
    evidenceSource: "Dossier pack W3-CT.md",
    recordedOn: "2026-11-12",
    conditions: [],
  },
  {
    state: "MS",
    county: "*",
    objectScope: "MARIS statewide parcels",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "permitted_with_conditions",
      resale: "permitted_with_conditions",
      lookupDisplay: "permitted_with_conditions",
    },
    servableFields: ALL_FIELDS,
    evidence: 'Permitted / permitted-with-conditions, all classes (MARIS "no access and use limitations"; written public-domain confirmation recorded).',
    evidenceSource: "Dossier pack W4-MS.md",
    recordedOn: "2026-11-12",
    conditions: ["Gate posture unchanged pending attorney review, per the pack record."],
  },
  {
    state: "DE",
    county: "*",
    objectScope: "Delaware statewide layer — PIN / acres only by design",
    posture: DRAFT,
    classes: { ...PERMITTED_ALL },
    servableFields: ["identifiers", "assessment"],
    evidence: "Permitted, all classes (29 Del. C. §9144 public domain) — but the layer is PIN/acres only and carries no owner or situs data, so no other field group exists to serve.",
    evidenceSource: "Dossier pack W3-DE.md",
    recordedOn: "2026-11-12",
    conditions: [],
  },
  {
    state: "UT",
    county: "*",
    objectScope: "Utah statewide parcels (CC BY 4.0; no owner names by design)",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "permitted_with_conditions",
      resale: "permitted_with_conditions",
      lookupDisplay: "permitted_with_conditions",
    },
    servableFields: NO_OWNER_FIELDS,
    evidence: "Permitted-with-conditions, all classes (CC BY 4.0). The layer carries no owner names by design, so no owner group is servable.",
    evidenceSource: "Dossier pack W3-UT.md",
    recordedOn: "2026-11-12",
    conditions: ["CC BY 4.0 attribution required."],
  },
  {
    state: "CO",
    county: "*",
    objectScope: "State compilation — 44 of 64 counties only",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "prohibited",
      resale: "permitted_with_conditions",
      lookupDisplay: "permitted_with_conditions",
    },
    servableFields: ALL_FIELDS,
    evidence: "44 of 64 counties: permitted-with-conditions; redistribution PROHIBITED. The other 20 counties are not in the compilation's determination and serve nothing under this record.",
    evidenceSource: "Dossier pack W3-CO.md",
    recordedOn: "2026-11-12",
    conditions: ["County membership in the 44 must be checked per county before this record is applied to a parcel."],
  },
  {
    state: "MN",
    county: "*",
    objectScope: "plan_parcels_open — the 59 opt-in counties only",
    posture: DRAFT,
    classes: {
      internal: "permitted_with_conditions",
      display: "permitted_with_conditions",
      redistribution: "permitted_with_conditions",
      resale: "permitted_with_conditions",
      lookupDisplay: "permitted_with_conditions",
    },
    servableFields: ALL_FIELDS,
    evidence: "The 59 opt-in counties in plan_parcels_open: permitted / permitted-with-conditions (judicial-official conditions on display/lookup). The other 28 counties are PROHIBITED — a state-compilation determination, not 59 county answers.",
    evidenceSource: "Dossier pack W3-MN.md",
    recordedOn: "2026-11-12",
    conditions: ["Applies only to a parcel in one of the 59 opt-in counties; a parcel in any other MN county has no servable record."],
  },
  {
    state: "AR",
    county: "*",
    objectScope: "Arkansas statewide layer — display only",
    posture: DRAFT,
    classes: { internal: "unresolved", display: "permitted_with_conditions", redistribution: "unresolved", resale: "unresolved", lookupDisplay: "unresolved" },
    servableFields: ALL_FIELDS,
    evidence: "Display only, permitted-with-conditions. Every other class — including paid lookup-display — is unresolved, so this record answers on the display surface only.",
    evidenceSource: "Dossier pack (state-level context, display-green compilation 2026-11-12)",
    recordedOn: "2026-11-12",
    conditions: [],
  },
];

/** Every transcribed field-clearance record: 14 counties + the state objects. */
export const FIELD_CLEARANCE_REGISTRY: readonly FieldClearanceRecord[] = Object.freeze([...COUNTY_RECORDS, ...STATE_RECORDS]);

function normalizeCounty(county: string): string {
  return county.replace(/ county$/i, "").trim().toLowerCase();
}

/**
 * The record for one data object, or undefined — and undefined serves
 * nothing. Matching is exact on (state, county): no wildcard widening, no
 * neighbouring-county inference. When the caller names an object key, a
 * record carrying a different key does not match (Paulding's GIS Division
 * object is not the Board of Assessors object); when the caller names none,
 * the county's single record answers with its objectScope attached.
 */
export function fieldClearanceRecordFor(state: string, county: string, objectKey?: string): FieldClearanceRecord | undefined {
  const st = state.toUpperCase();
  const co = normalizeCounty(county);
  return FIELD_CLEARANCE_REGISTRY.find((r) => {
    if (r.state !== st || normalizeCounty(r.county) !== co) return false;
    if (objectKey !== undefined && r.objectKey !== objectKey) return false;
    return true;
  });
}

/** The per-field answer for one data object on one surface, straight from the registry. */
export function fieldClearanceFor(state: string, county: string, surface: LookupUseClass, objectKey?: string): FieldClearanceAnswer {
  return fieldClearanceAnswer(fieldClearanceRecordFor(state, county, objectKey), surface);
}
