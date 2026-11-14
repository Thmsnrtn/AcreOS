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
 * DOSSIER. A state's use classes are UNRESOLVED unless RESOLVED_DOSSIERS below
 * records findings read from the terms' own words, never from a seed note.
 * The D1 build could not reach the state hosts, so D1 left every state
 * unresolved; the first-party ingest package (2026-11-03) resolves WI, the
 * Wave A pilot, from its publisher's schema documentation, re-read live. Every
 * other state stays restrictive. The re-verification radar (reverifyBy) is
 * applied each time an entry is read (statewideSource), so a lapsed dossier
 * is restrictive everywhere without anyone editing this file.
 *
 * INGEST vs LOOKUP. A resolved dossier admits a source to BULK ingest
 * (ingestAdmission, consulted before any fetch). It does NOT clear the source
 * for live point lookup: that is LOOKUP_CLEARANCE, a separate decision,
 * separately recorded. WI is admitted to ingest and remains GATED for lookup.
 *
 * LOOKUP. Separately, each entry carries its live point-lookup clearance
 * (LOOKUP_CLEARANCE below, founder decision 2026-11-03). parcel.ts reads it
 * before querying any statewide row. Today every state is gated.
 */

import { STATEWIDE_PARCEL_ENDPOINTS } from "../statewideParcelEndpoints";
import {
  effectiveDossier,
  ingestAdmission,
  policyFromDossier,
  unresolvedDossier,
  type IngestAdmission,
  type SourceDossier,
  type SourcePolicy,
} from "@shared/openData/sourcePolicy";
import { clock } from "../../utils/clock";
import {
  PARCEL_FIELD_GROUPS,
  PARCEL_FIELD_GROUP_LABELS,
  type FieldClearanceAnswer,
  type LookupUseClass,
  type ParcelFieldGroup,
} from "@shared/openData/fieldClearance";

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
      /**
       * Field-level serving (I-6): the field groups this clearance lets the
       * lookup serve. Absent = every group the source publishes (the
       * determination cleared the source as published). A reviewed clearance
       * whose determination trims fields (owner names excluded, geometry
       * only) names the servable groups here, and parcel.ts strips the rest
       * post-fetch, pre-response. Widening this list is the same reviewed
       * code change as the clearance itself.
       */
      servableFields?: readonly ParcelFieldGroup[];
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

/**
 * A suppression the PUBLISHER applied upstream (a statute or a local opt-out),
 * visible only as literal values in the layer. Ingest stores these values AS
 * PUBLISHED; nothing may "repair" them from another source or an older
 * vintage (first-party ingest package §5).
 */
export interface PublishedSuppression {
  /** The layer fields that carry the suppression. */
  fields: string[];
  /** The literal values that mean "suppressed upstream". */
  values: string[];
  basis: string;
}

export interface StatewideSourceEntry {
  state: string;
  /** null = the program documents no cadence. Never guessed. */
  cadence: DocumentedCadence | null;
  cadenceSource: string | null;
  /** The dossier as recorded (what a person read). */
  recordedDossier: SourceDossier;
  /** The dossier as the re-verification radar lets it stand when the entry was read. */
  dossier: SourceDossier;
  /** Derived from the effective dossier — never set by hand. */
  policy: SourcePolicy;
  /** Owner (or other) values the publisher suppressed upstream; null when none is recorded. */
  suppression: PublishedSuppression | null;
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

/**
 * The gate's FIELD-LEVEL answer for a statewide source (I-6): the same
 * clearance, expressed per field group. A source that is not cleared for
 * lookup serves NO field group — the refused-whole posture is unchanged,
 * and today every statewide entry is gated, so today this answers empty for
 * every state. A cleared source serves exactly its clearance's
 * `servableFields` (every group when the clearance names none), and each
 * withheld group carries its reason. parcel.ts consumes this answer: the
 * boolean gate is now "does the answer serve geometry + identifiers", and
 * the mask is applied to whatever a cleared source returns.
 */
export function statewideFieldAnswer(
  entry: StatewideSourceEntry | undefined,
  surface: LookupUseClass,
): FieldClearanceAnswer {
  if (!isClearedForLookup(entry) || !entry || entry.lookup.status !== "cleared") {
    const why = entry
      ? `The statewide source for ${entry.state} is not cleared for lookup, so it serves no field group on any surface.`
      : "No register entry exists for this state, and a source the register does not clear serves nothing.";
    return {
      surface,
      servableFields: [],
      withheldFields: PARCEL_FIELD_GROUPS.map((field) => ({ field, why })),
      basis: null,
    };
  }
  const clearance = entry.lookup;
  const servable = new Set<ParcelFieldGroup>(clearance.servableFields ?? PARCEL_FIELD_GROUPS);
  return {
    surface,
    servableFields: PARCEL_FIELD_GROUPS.filter((f) => servable.has(f)),
    withheldFields: PARCEL_FIELD_GROUPS.filter((f) => !servable.has(f)).map((field) => ({
      field,
      why: `The lookup clearance for ${entry.state} does not clear the ${PARCEL_FIELD_GROUP_LABELS[field].toLowerCase()} group for serving.`,
    })),
    basis: {
      state: entry.state,
      county: "*",
      objectScope: `Statewide source for ${entry.state} (live point-lookup clearance)`,
      evidence: clearance.evidence,
      evidenceSource: clearance.evidenceUrl,
      recordedOn: clearance.decidedOn,
      conditions: [],
    },
  };
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

/**
 * RESOLVED DOSSIERS — findings read from each source's own terms. A state
 * absent here is unresolved in every use class. Every determination is DRAFT —
 * PREPARED FOR ATTORNEY REVIEW (dossier program 2026-11); reliance rides the
 * attorney review at LLC / first customer. A resolved dossier admits BULK
 * ingest only — it never clears live point lookup (LOOKUP_CLEARANCE).
 */
const WI_SCHEMA_DOC = "https://sco.wisc.edu/parcels/data/assets/V12/V12_Wisconsin_Statewide_Parcels_Schema_Documentation.pdf";
const WI_WORDS =
  '"The data is in the public domain." "There are no use restrictions." — V12 Wisconsin Statewide Parcels Schema Documentation (SCO / WLIP, Dept. of Administration), re-read 2026-11-03. Corroborated by the layer item\'s licenseInfo: "This data free for public consumption as of: 06/30/2026".';
const wiAllowed = { status: "allowed" as const, evidence: WI_WORDS, readOn: "2026-11-03" };

const RESOLVED_DOSSIERS: Readonly<Record<string, SourceDossier>> = Object.freeze({
  // Wave A pilot (first-party ingest package §1, A1). Permitted, all classes.
  WI: {
    termsUrl: WI_SCHEMA_DOC,
    termsReadOn: "2026-11-03",
    useClasses: { internal: wiAllowed, display: wiAllowed, redistribution: wiAllowed, resale: wiAllowed },
    // "There are no requirements for citing the Wisconsin statewide parcel layers within any reporting derived from this GIS layer" (same document).
    attributionRequired: false,
    restrictions: [
      'Owner-name redaction is applied upstream and published as the literal "NOT AVAILABLE" in OWNERNME1/OWNERNME2 (the publisher describes Kenosha County as complete and eight other counties as partial — measured 2026-11-03: 64,144 of the 68,499 Kenosha rows; Wis. Stat. §757.07 judicial-privacy shielding per the WI pack). Stored as published; NEVER backfilled from any other source or vintage.',
      "Determination is DRAFT — prepared for attorney review (dossier program 2026-11); mail use is not covered (counsel Q-12.3).",
    ],
    // The schema documentation: "The next release of the statewide parcel layer, V13, is tentatively scheduled for June 30, 2027."
    reverifyBy: "2027-06-30",
    reverifyTriggers: ["the V13 release (tentatively 2027-06-30) — a new layer is a new terms read", "any change to the schema documentation's terms or the item's licenseInfo"],
  },
});

/** Publisher-side suppressions, per state (data, not comments). */
const PUBLISHED_SUPPRESSION: Readonly<Record<string, PublishedSuppression>> = Object.freeze({
  WI: {
    fields: ["OWNERNME1", "OWNERNME2"],
    values: ["NOT AVAILABLE"],
    basis:
      'V12 schema documentation: redacted owner names "should be attributed as \u201cNOT AVAILABLE\u201d within each redacted record\'s OWNERNME1 and/or OWNERNME2 field" (publisher: Kenosha complete, eight counties partial). Measured live 2026-11-03: 90,652 statewide, 64,144 of Kenosha\'s 68,499.',
  },
});

interface RecordedEntry {
  state: string;
  cadence: DocumentedCadence | null;
  cadenceSource: string | null;
  recordedDossier: SourceDossier;
  suppression: PublishedSuppression | null;
  lookup: LookupClearance;
}

const STATEWIDE_SOURCE_REGISTRY: readonly RecordedEntry[] = STATEWIDE_PARCEL_ENDPOINTS.map((ep) => {
  const recordedDossier = RESOLVED_DOSSIERS[ep.state] ?? unresolvedDossier(ep.termsUrl ?? null, NOT_READ, RESTRICTIONS[ep.state] ?? []);
  const c = CADENCES[ep.state];
  return {
    state: ep.state,
    cadence: c?.cadence ?? null,
    cadenceSource: c?.source ?? null,
    recordedDossier,
    suppression: PUBLISHED_SUPPRESSION[ep.state] ?? null,
    lookup: LOOKUP_CLEARANCE[ep.state] ?? NO_LOOKUP_ENTRY,
  };
});

/** The recorded entry as the radar lets it stand at `now`. */
function standing(e: RecordedEntry, now: Date): StatewideSourceEntry {
  const dossier = effectiveDossier(e.recordedDossier, now);
  return { ...e, dossier, policy: policyFromDossier(dossier) };
}

/** A state's registry entry, with the re-verification radar applied at `now`. */
export function statewideSource(state: string, now: Date = clock.now()): StatewideSourceEntry | undefined {
  const e = STATEWIDE_SOURCE_REGISTRY.find((x) => x.state === state.toUpperCase());
  return e ? standing(e, now) : undefined;
}

/**
 * May the statewide bulk build fetch this state at all? Only a seeded state
 * whose effective dossier allows internal use. Checked BEFORE any request —
 * an unseeded state, an unresolved one, or one whose re-verification lapsed
 * is refused without a single fetch.
 */
export function statewideIngestAdmission(state: string, now: Date = clock.now(), entry?: StatewideSourceEntry): IngestAdmission {
  const st = state.toUpperCase();
  const e = entry ?? statewideSource(st, now);
  if (!e) return { admitted: false, reasons: [`${st}: no seeded statewide source and no dossier — "unclear" = unshipped`] };
  return ingestAdmission(st, e.dossier, now);
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
