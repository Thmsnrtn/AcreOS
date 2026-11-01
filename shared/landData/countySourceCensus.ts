/**
 * Free county parcel-source census (W2 task 3).
 *
 * Which counties publish parcels for free, where, and on what terms. Built by
 * scripts/land-data/build-county-source-census.ts from live checks; the
 * Tennessee seed is countySourceCensus.tn.json. A source is only "verified"
 * when a live query answered in the build run; terms are only "read" when the
 * build recorded the terms text. Everything else is labelled unverified — the
 * coverage map shows the label, never a guess. This module carries the census
 * DATA; the browser imports ./countyCoverage (types, labels, the rule) instead.
 */

import tnCensus from "./countySourceCensus.tn.json";

export * from "./countyCoverage";
import { deriveCoverage, type StateCensus, type CensusRow } from "./countyCoverage";

/**
 * The census as served. Each row's coverage is RE-DERIVED from its sources
 * on load (deriveCoverage), so a hand-edited JSON row can never claim more
 * coverage than its own sources prove.
 */
export const COUNTY_SOURCE_CENSUS: readonly StateCensus[] = [tnCensus as StateCensus].map((c) => ({
  ...c,
  rows: c.rows.map((r) => ({ ...r, coverage: deriveCoverage(r.sources) })),
}));

export function censusRowFor(state: string, county: string): CensusRow | undefined {
  const st = state.toUpperCase();
  const name = county.toLowerCase().replace(/ county$/, "").trim();
  return COUNTY_SOURCE_CENSUS.find((c) => c.state === st)?.rows.find((r) => r.county.toLowerCase() === name);
}
