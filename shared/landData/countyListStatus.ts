/**
 * County list status — the vocabulary for what AcreOS can honestly do with a
 * geography's parcel data when BUILDING A LIST (roadmap W10.3; the 2026-09-29
 * quality-directive reconciliation queued "county status vocabulary
 * (endpoint / lookup / list-ready / rights-qualified)" for the list builder).
 *
 * A ladder: each rung needs every rung below it, so a status never claims a
 * rung whose precondition is missing.
 *
 *   none             — no parcel source is known for the geography in this layer;
 *   endpoint         — a verified source is known, nothing more;
 *   lookup           — the source is cleared to answer live lookups (for the
 *                      free statewide sources, the lookup gate of founder
 *                      decision 2026-11-03);
 *   list_ready       — a county list query is built for the source, a pulled
 *                      list has a path into leads, and the pull's cost is known;
 *   rights_qualified — the source's terms are established for the list's use:
 *                      showing the records, keeping them as leads and
 *                      addressing mail to the owners.
 *
 * A list is quoted or pulled ONLY at rights_qualified. Pure and browser-safe.
 */

const STATUSES = ["none", "endpoint", "lookup", "list_ready", "rights_qualified"] as const;
export type CountyListStatus = (typeof STATUSES)[number];

export interface CountyListRungs {
  endpoint: boolean;
  lookup: boolean;
  listReady: boolean;
  rightsQualified: boolean;
}

/** The highest rung whose every lower rung also holds. */
export function countyListStatus(r: CountyListRungs): CountyListStatus {
  if (!r.endpoint) return STATUSES[0];
  if (!r.lookup) return STATUSES[1];
  if (!r.listReady) return STATUSES[2];
  if (!r.rightsQualified) return STATUSES[3];
  return STATUSES[4];
}
