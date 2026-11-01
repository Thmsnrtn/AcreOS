/**
 * The browser-safe half of the county parcel-source census: its types, the
 * coverage labels and the derivation rule — with NO import of the census
 * data. The client renders coverage it gets from the API, so it imports
 * this module; importing countySourceCensus.ts instead would ship the whole
 * 95-county census JSON (about 68 KB) into the maps chunk, because the
 * census is built at module load and a bundler cannot prove that pure.
 * tests/unit/clientNeverBundlesCensusData.test.ts pins it.
 */

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

export const COVERAGE_LABELS: Record<CountyCoverage, string> = {
  storable_with_manual_download: "Free source, terms allow storing (manual download)",
  lookup_only: "Free source, live lookups only",
  unverified_candidates: "Possible sources found, not verified",
  no_source_found: "No free source found",
};

/** The coverage a row may honestly claim, derived from its sources. */
export function deriveCoverage(sources: CensusSource[]): CountyCoverage {
  if (sources.some((s) => s.mayStore && s.verification !== "unverified")) return "storable_with_manual_download";
  // A service whose terms prohibit commercial use is not a lookup AcreOS makes
  // (founder decision 2026-10-11), however live it is.
  if (sources.some((s) => s.verification === "verified_live" && s.commercialUse !== "prohibited")) return "lookup_only";
  if (sources.length > 0) return "unverified_candidates";
  return "no_source_found";
}
