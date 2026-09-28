/**
 * Parcel-identity dedupe for lead imports (DEFECT-0140).
 *
 * A parcel is APN + state + county. Keyed on the APN alone, or on state + APN,
 * the same number in two counties is one lead and the second import is
 * silently skipped. Where EITHER side has no county (a legacy lead, or a file
 * without a county column) the county is unknown, and the match falls back to
 * state + APN rather than guessing two rows apart.
 *
 * One rule, used by both import paths: POST /api/leads/csv-import
 * (server/routes-leads.ts) and importLeads (server/services/importExport.ts).
 */
export interface ParcelDedupeIndex {
  add(state: string | null | undefined, county: string | null | undefined, apn: string): void;
  has(state: string | null | undefined, county: string | null | undefined, apn: string): boolean;
}

const norm = (v: string | null | undefined): string => (v ?? "").trim().toUpperCase();

export function createParcelDedupeIndex(): ParcelDedupeIndex {
  const full = new Set<string>();
  const countyless = new Set<string>();
  const anyCounty = new Set<string>();
  const stateApn = (state: string | null | undefined, apn: string) => `${norm(state)}|${norm(apn)}`;
  const withCounty = (state: string | null | undefined, county: string, apn: string) =>
    `${norm(state)}|${norm(county)}|${norm(apn)}`;
  return {
    add(state, county, apn) {
      anyCounty.add(stateApn(state, apn));
      if (norm(county)) full.add(withCounty(state, county!, apn));
      else countyless.add(stateApn(state, apn));
    },
    has(state, county, apn) {
      return norm(county)
        ? full.has(withCounty(state, county!, apn)) || countyless.has(stateApn(state, apn))
        : anyCounty.has(stateApn(state, apn));
    },
  };
}
