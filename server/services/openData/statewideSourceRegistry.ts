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
 *
 * LOOKUP. Separately, each entry carries its live point-lookup clearance
 * (LOOKUP_CLEARANCE below, founder decision 2026-11-03). parcel.ts reads it
 * before querying any statewide row. Today every state is gated.
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

/**
 * POINT-LOOKUP CLEARANCE (founder decision 2026-11-03).
 *
 * A seeded statewide source may answer a live point lookup ONLY when its
 * register state is cleared for lookup. Until then it is GATED: the lookup
 * path treats the row as if it were not seeded, and the lookup falls through
 * to the next source or to Regrid. The dossier above governs bulk ingest; this
 * record governs the second surface, live point lookup. Of the two contradictory
 * postures the legal audit found, this is the one that had no gate.
 *
 * Mirrors the reconciled per-state register in the LQ-12/14 dossier register,
 * §8.4 (2026-11-03). TODAY NO STATE IS CLEARED.
 *
 * To clear a state, replace its entry with `status: "cleared"` and fill
 * every evidence field. The fields are the ones `license_reviewed` requires:
 * a determination, the deciding words quoted, a URL and a date. Then add the
 * state to CLEARED_FOR_LOOKUP in tests/unit/statewideLookupClearance.test.ts.
 * That pin is deliberate: a clearance is a reviewed code change, never a
 * side effect. An entry with an empty evidence field does not count as
 * cleared (isClearedForLookup).
 */
export type LookupClearance =
  | {
      status: "gated";
      /** The state's reconciled state as the register records it (§8.4). */
      registerState: string;
    }
  | {
      status: "cleared";
      /** What was decided, and by whom: the dossier display finding, or counsel's/founder's lookup determination. */
      determination: string;
      /** The deciding words, quoted, never paraphrased into a yes. */
      evidence: string;
      /** Where those words live. */
      evidenceUrl: string;
      /** ISO date of the determination. */
      decidedOn: string;
    };

const REG_84 = "LQ-12/14 register §8.4 (2026-11-03)";
const gated = (registerState: string): LookupClearance => ({ status: "gated", registerState: `${REG_84}: ${registerState}` });

/**
 * One explicit entry per seeded statewide row. Not derived from the seeds:
 * a new seed without an entry here resolves to NO_LOOKUP_ENTRY, which is gated
 * at runtime (fail-closed) and fails the ratchet
 * (statewideLookupClearance.test.ts).
 */
const LOOKUP_CLEARANCE: Readonly<Record<string, LookupClearance>> = Object.freeze({
  FL: gated("UNRESOLVED — all use classes unresolved; owner name (OWN_NAME) mapped; GIO carve-out open (LQ-13)"),
  MT: gated("UNRESOLVED — all use classes unresolved; owner name mapped; DOR-ORION / county layer open (§9.3)"),
  NC: gated("UNRESOLVED — all use classes unresolved; owner name mapped; bulk BLOCKED in research (B4, §9.1)"),
  WA: gated("UNRESOLVED — all use classes unresolved; no owner field; RCW 42.56.070 list restriction recorded"),
  NJ: gated("UNRESOLVED — all use classes unresolved; owner name mapped"),
  AR: gated("UNRESOLVED — all use classes unresolved; owner name mapped"),
  NY: gated("UNRESOLVED — owner name mapped; seeded on a pipeline determination the dossier does not adopt"),
  WI: gated("UNRESOLVED — owner name mapped; seeded on an item line its own dossier says resolves nothing"),
  MD: gated("UNRESOLVED — no owner-name field; item-license evidence recorded in the seed only"),
});

export interface StatewideSourceEntry {
  state: string;
  /** null = the program documents no cadence. Never guessed. */
  cadence: DocumentedCadence | null;
  cadenceSource: string | null;
  dossier: SourceDossier;
  /** Derived from the dossier — never set by hand. */
  policy: SourcePolicy;
  /** Live point-lookup clearance (founder decision 2026-11-03). Gated unless cleared on evidence. */
  lookup: LookupClearance;
}

/** What a statewide row with no LOOKUP_CLEARANCE entry gets: gated. */
const NO_LOOKUP_ENTRY: LookupClearance = Object.freeze({
  status: "gated",
  registerState: "no lookup-clearance entry for this state — gated (fail-closed)",
});

/**
 * May this statewide source answer a live point lookup? True ONLY for an entry
 * explicitly cleared with every evidence field filled. A missing entry, a gated
 * entry, or a "cleared" entry with a blank field is false.
 */
export function isClearedForLookup(entry: StatewideSourceEntry | undefined): boolean {
  const c = entry?.lookup;
  if (!c || c.status !== "cleared") return false;
  return [c.determination, c.evidence, c.evidenceUrl, c.decidedOn].every((f) => typeof f === "string" && f.trim().length > 0);
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
    lookup: LOOKUP_CLEARANCE[ep.state] ?? NO_LOOKUP_ENTRY,
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
  const elapsedMs = now.getTime() - lastEditAt.getTime();
  switch (cadence.kind) {
    case "monthly":
      return elapsedMs > (31 + 7) * DAY_MS;
    case "semi_annual":
      return elapsedMs > (183 + 7) * DAY_MS;
    case "annual":
      return elapsedMs > (366 + 31) * DAY_MS;
  }
}
