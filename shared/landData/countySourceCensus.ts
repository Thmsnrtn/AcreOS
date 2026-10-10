/**
 * Free county parcel-source census (W2 task 3).
 *
 * Which counties publish parcels for free, where, and on what terms. Built by
 * scripts/land-data/build-county-source-census.ts from live checks; the
 * Tennessee seed is countySourceCensus.tn.json. A source is only "verified"
 * when a live query answered in the build run; terms are only "read" when the
 * build recorded the terms text. Everything else is labelled unverified — the
 * coverage map shows the label, never a guess. Browser-safe.
 */

import tnCensus from "./countySourceCensus.tn.json";

export type CensusSourceKind = "state_download" | "state_public_service" | "county_service";
export type CommercialUse = "permitted" | "prohibited" | "unstated";
export type SourceVerification = "verified_live" | "terms_read" | "unverified";

/**
 * Coverage, worst-to-best for a land buyer:
 *  - no_source_found:               nothing found;
 *  - unverified_candidates:         services found by search, none verified;
 *  - lookup_only:                   a verified source, but its terms do not
 *                                   (or do not yet) let AcreOS store a copy;
 *  - storable_with_manual_download: a source whose terms permit storing,
 *                                   fetched by a person (no automated pulls).
 */
export type CountyCoverage =
  | "no_source_found"
  | "unverified_candidates"
  | "lookup_only"
  | "storable_with_manual_download";

export interface CensusSource {
  kind: CensusSourceKind;
  publisher: string;
  url: string;
  licenseSource?: string;
  commercialUse: CommercialUse;
  mayStore: boolean;
  automatedDownload: boolean;
  terms: string;
  verification: SourceVerification;
  liveParcelCount?: number;
  checkedOn: string;
}

export interface CensusRow {
  state: string;
  countyFips: string;
  county: string;
  maintainedBy: "state" | "county";
  coverage: CountyCoverage;
  sources: CensusSource[];
}

export interface StateCensus {
  state: string;
  builtOn: string;
  rows: CensusRow[];
}

export const COUNTY_SOURCE_CENSUS: readonly StateCensus[] = [tnCensus as StateCensus];

export const COVERAGE_LABELS: Record<CountyCoverage, string> = {
  storable_with_manual_download: "Free source, terms allow storing (manual download)",
  lookup_only: "Free source, live lookups only",
  unverified_candidates: "Possible sources found, not verified",
  no_source_found: "No free source found",
};

/** The coverage a row may honestly claim, derived from its sources. */
export function deriveCoverage(sources: CensusSource[]): CountyCoverage {
  if (sources.some((s) => s.mayStore && s.verification !== "unverified")) return "storable_with_manual_download";
  if (sources.some((s) => s.verification === "verified_live")) return "lookup_only";
  if (sources.length > 0) return "unverified_candidates";
  return "no_source_found";
}

export function censusRowFor(state: string, county: string): CensusRow | undefined {
  const st = state.toUpperCase();
  const name = county.toLowerCase().replace(/ county$/, "").trim();
  return COUNTY_SOURCE_CENSUS.find((c) => c.state === st)?.rows.find((r) => r.county.toLowerCase() === name);
}
