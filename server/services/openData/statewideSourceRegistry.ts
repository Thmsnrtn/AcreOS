/**
 * Statewide parcel source registry — cadence + dossier + policy per source
 * (D1c cadence registry; D1 amendment A2 policy blocks; design §12 use classes).
 *
 * One entry per row of STATEWIDE_PARCEL_ENDPOINTS, keyed by state; a test
 * pins the population both ways, so a statewide row cannot be added without a
 * registry entry (or an entry outlive its row).
 *
 * CADENCE. The documented refresh cadence of each state's program, with an
 * honest null where none is documented — corporaManifest.ts discipline: a
 * guessed cadence would make the poller's "overdue" report a fabrication.
 * The three documented cadences are the ones the D1 package names
 * (2026-10-22, design §5): FL annual (published each August), MT monthly,
 * AR semi-annual.
 *
 * DOSSIER. Every use class is UNRESOLVED today. The terms pages were not read
 * for this registry: the D1 build ran in a container whose network policy
 * does not reach the state hosts, and a use class is resolved only from the
 * terms' own words, never from a seed note. So every policy block is the
 * restrictive default, and the FL build ships dry-run-only (D1 license gate).
 */

import { STATEWIDE_PARCEL_ENDPOINTS } from "../statewideParcelEndpoints";
import {
  policyFromDossier,
  unresolvedDossier,
  type SourceDossier,
  type SourcePolicy,
} from "@shared/openData/sourcePolicy";

export type DocumentedCadence =
  | { kind: "monthly" }
  | { kind: "semi_annual" }
  | { kind: "annual"; publishedMonth: number };

export interface StatewideSourceEntry {
  state: string;
  /** null = the program documents no cadence. Never guessed. */
  cadence: DocumentedCadence | null;
  cadenceSource: string | null;
  dossier: SourceDossier;
  /** Derived from the dossier — never set by hand. */
  policy: SourcePolicy;
}

const D1_SPEC = "D1 data-sourcing package 2026-10-22 (design §5)";
const NOT_READ =
  "terms not read for this dossier — the D1 build container's network policy does not reach the state host; resolve from the terms' own words";

const CADENCES: Record<string, { cadence: DocumentedCadence; source: string }> = {
  FL: { cadence: { kind: "annual", publishedMonth: 8 }, source: D1_SPEC },
  MT: { cadence: { kind: "monthly" }, source: D1_SPEC },
  AR: { cadence: { kind: "semi_annual" }, source: D1_SPEC },
};

const RESTRICTIONS: Record<string, string[]> = {
  // Design §8 records a Revised Code of Washington restriction on providing
  // owner names for commercial purposes. The section is not cited in this
  // repo and was not read here, so it is recorded as named by the design,
  // not paraphrased into a rule. The WA composite layer carries no owner field.
  WA: ["Owner names: design §8 records an RCW restriction on commercial use of owner-name lists — read the statute before any WA owner-name use."],
};

const STATEWIDE_SOURCE_REGISTRY: readonly StatewideSourceEntry[] = STATEWIDE_PARCEL_ENDPOINTS.map((ep) => {
  const dossier = unresolvedDossier(ep.termsUrl ?? null, NOT_READ, RESTRICTIONS[ep.state] ?? []);
  const c = CADENCES[ep.state];
  return {
    state: ep.state,
    cadence: c?.cadence ?? null,
    cadenceSource: c?.source ?? null,
    dossier,
    policy: policyFromDossier(dossier),
  };
});

export function statewideSource(state: string): StatewideSourceEntry | undefined {
  return STATEWIDE_SOURCE_REGISTRY.find((e) => e.state === state.toUpperCase());
}

const DAY_MS = 86_400_000;

/**
 * Has the source gone longer than its documented cadence without an edit?
 * null when it cannot be said honestly: no documented cadence, or no
 * lastEditDate observed. A small grace (a month for annual, a week otherwise)
 * keeps a publication landing a few days late from reading as drift.
 */
export function overdueVsCadence(cadence: DocumentedCadence | null, lastEditAt: Date | null, now: Date): boolean | null {
  if (!cadence || !lastEditAt) return null;
  const age = now.getTime() - lastEditAt.getTime();
  switch (cadence.kind) {
    case "monthly":
      return age > (31 + 7) * DAY_MS;
    case "semi_annual":
      return age > (183 + 7) * DAY_MS;
    case "annual":
      return age > (366 + 31) * DAY_MS;
  }
}
