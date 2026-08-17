/**
 * The Evidence Fabric — claim vocabulary and the deterministic resolution
 * policy that turns a set of source-backed claims into a current answer.
 *
 * WHY THIS EXISTS
 * ---------------
 * Three of the fifteen canonical laws (shared/architecture/canon.ts) are
 * unsatisfiable without this file:
 *
 *   Law 2  Every material assertion should know its evidence, provenance,
 *          freshness and uncertainty.
 *   Law 3  Unknown and conflict are valid states and must not be silently
 *          converted into certainty.
 *   Law 6  Historical decisions preserve what was known and assumed at the time.
 *
 * At HEAD the ACQUISITION side is already strong: `LookupResult`
 * (server/services/providers/types.ts) carries provider, source, confidence,
 * classification, fetchedAt and sourceAsOf, and DATA_LICENSE_REGISTER carries
 * per-source rights. None of it is PERSISTED per field —
 * `propertyEnrichment.savePropertyEnrichment()` collapses an entire enrichment
 * into one `properties.enrichmentData` JSONB blob and OVERWRITES the previous
 * one. Provenance survives the fetch and dies at the write. There is no
 * observation history, no conflict representation, and no as-of reconstruction,
 * so a decision recorded today silently changes meaning tomorrow.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The pure half of the fix: vocabulary + policy, no I/O, no database, no Node
 * builtins. It is isomorphic (shared/ is bundled into the client) and every
 * function here is deterministic — same claims in, same answer out, forever.
 * That determinism is the point: BI14 requires the canonical resolved value to
 * be a RECOMPUTABLE PROJECTION over claims, not the only surviving
 * representation.
 *
 * The impure half — persisting claims and reading them back — lives in
 * server/services/evidence/evidenceStore.ts.
 *
 * DESIGN RULES THIS FILE OBEYS
 * ----------------------------
 *  - No arbitrary confidence percentages. BI140: confidence must describe
 *    evidence quality, not simulate certainty. Resolution returns a CATEGORICAL
 *    confidence plus the explaining factors that produced it.
 *  - Absence is never coerced. Zero claims resolves to `unknown`, never to
 *    false, 0 or "". (Law 3.)
 *  - Dissent is preserved. When two sources of equal standing disagree, the
 *    result is `conflict` carrying BOTH candidates — the UI and Pax must show
 *    the disagreement rather than silently pick a winner. (BI139.)
 *  - Staleness downgrades, it does not delete. A claim past its freshness
 *    horizon still resolves, marked stale, at reduced confidence. (AI18.)
 *  - The policy is VERSIONED. A DecisionSnapshot records which version resolved
 *    its evidence, so changing the policy later cannot rewrite what a past
 *    decision was based on. (Law 6.)
 */

// ── Policy version ────────────────────────────────────────────────────────

/**
 * Bump when the resolution ALGORITHM changes in a way that could produce a
 * different answer from the same claims. Never bump for comments or refactors.
 * DecisionSnapshots persist this value so historical resolutions stay
 * reproducible under the policy that actually produced them.
 */
export const RESOLUTION_POLICY_VERSION = 1 as const;

// ── Authority ─────────────────────────────────────────────────────────────

/**
 * How much standing a claim's source has for the thing it asserts.
 *
 * Deliberately the same four values as `DataClassification` in
 * server/services/providers/types.ts, so the provider adapter maps 1:1 with no
 * translation loss. Re-declared here (rather than imported) because shared/
 * must not import server/ — see scripts/check-boundaries.mjs rule S1.
 *
 *  - authoritative  a system-of-record fact (county assessor, federal layer)
 *  - estimate       derived/heuristic but data-backed (comp-based valuation)
 *  - modeled        output of a computed score/model — NEVER presentable as fact
 *  - unknown        the source returned no value; recorded so we know we asked
 */
export type EvidenceAuthority =
  | "authoritative"
  | "estimate"
  | "modeled"
  | "unknown";

/** Higher wins. `unknown` never wins anything — it only records that we asked. */
const AUTHORITY_RANK: Record<EvidenceAuthority, number> = {
  authoritative: 3,
  estimate: 2,
  modeled: 1,
  unknown: 0,
};

export function authorityRank(a: EvidenceAuthority): number {
  return AUTHORITY_RANK[a];
}

// ── Subjects ──────────────────────────────────────────────────────────────

/**
 * What a claim is ABOUT. Deliberately narrow: a claim attaches to a canonical
 * entity, never to a view or a feature-specific record.
 *
 * `parcel` is listed even though Parcel has no table of its own yet (it is
 * conflated into `properties` — see CANONICAL_OBJECTS in
 * shared/architecture/canon.ts). Claims about cadastral facts should carry the
 * parcel subject from day one so that separating Parcel from Property later is
 * a backfill, not a re-interpretation of history.
 */
export const EVIDENCE_SUBJECT_TYPES = ["property", "parcel", "party"] as const;
export type EvidenceSubjectType = (typeof EVIDENCE_SUBJECT_TYPES)[number];

// ── Predicate registry (the controlled vocabulary) ────────────────────────

/**
 * What kind of value a predicate carries. Determines how two claims are
 * compared for agreement.
 */
export type EvidenceValueKind = "string" | "number" | "boolean" | "enum";

export interface PredicateSpec {
  /** Stable id — never renamed, never reused. Appears in persisted rows. */
  id: string;
  /** Which canonical entity this predicate describes. */
  subjectType: EvidenceSubjectType;
  kind: EvidenceValueKind;
  /** Plain-language meaning, shown in evidence-lineage UI. */
  label: string;
  /**
   * How long an observation of this fact stays decision-usable. Field-level,
   * because facts age at wildly different rates: a legal description is stable
   * for years, a tax-delinquency status for months, a listing price for days.
   * `null` means the fact does not stale (e.g. recorded legal description).
   */
  freshnessHorizonDays: number | null;
  /**
   * For `number` predicates: two observations within this absolute tolerance
   * count as AGREEING rather than conflicting. Acreage from two GIS sources
   * differing by 0.01 is not a conflict worth showing a human.
   */
  numericTolerance?: number;
  /** SI/domain unit, when the value is dimensional. Required for `number`. */
  unit?: string;
}

/**
 * The controlled predicate vocabulary (AW67).
 *
 * EVERY entry here corresponds to a field some provider adapter genuinely
 * returns today — they are read off `EnrichmentResult` in
 * server/services/propertyEnrichment.ts, not invented. An aspirational
 * vocabulary would be worse than none: it would imply coverage that does not
 * exist. Add a predicate when a real source starts producing it.
 */
export const PREDICATES: readonly PredicateSpec[] = [
  // ── Cadastral / parcel identity (slow-moving) ──
  {
    id: "parcel.apn",
    subjectType: "parcel",
    kind: "string",
    label: "Assessor's parcel number",
    freshnessHorizonDays: null,
  },
  {
    id: "parcel.legal_description",
    subjectType: "parcel",
    kind: "string",
    label: "Legal description",
    freshnessHorizonDays: null,
  },
  {
    id: "parcel.acreage",
    subjectType: "parcel",
    kind: "number",
    label: "Parcel acreage",
    freshnessHorizonDays: 730,
    numericTolerance: 0.02,
    unit: "acres",
  },
  {
    id: "parcel.owner_name",
    subjectType: "parcel",
    kind: "string",
    label: "Owner of record",
    freshnessHorizonDays: 180,
  },

  // ── Assessment / tax (annual cadence) ──
  {
    id: "property.assessed_value",
    subjectType: "property",
    kind: "number",
    label: "Assessed value",
    freshnessHorizonDays: 400,
    numericTolerance: 1,
    unit: "usd",
  },
  {
    id: "property.tax_amount",
    subjectType: "property",
    kind: "number",
    label: "Annual property tax",
    freshnessHorizonDays: 400,
    numericTolerance: 1,
    unit: "usd",
  },

  // ── Regulatory / zoning ──
  {
    id: "property.zoning",
    subjectType: "property",
    kind: "string",
    label: "Zoning designation",
    freshnessHorizonDays: 365,
  },

  // ── Hazard layers (federal, effective-dated) ──
  {
    id: "property.flood_zone",
    subjectType: "property",
    kind: "enum",
    label: "FEMA flood zone",
    freshnessHorizonDays: 365,
  },
  {
    id: "property.wetlands_present",
    subjectType: "property",
    kind: "boolean",
    label: "Wetlands present",
    freshnessHorizonDays: 730,
  },
  {
    id: "property.wetlands_percentage",
    subjectType: "property",
    kind: "number",
    label: "Share of parcel in wetlands",
    freshnessHorizonDays: 730,
    numericTolerance: 0.5,
    unit: "percent",
  },
  {
    id: "property.wildfire_hazard_class",
    subjectType: "property",
    kind: "enum",
    label: "USFS wildfire hazard potential",
    freshnessHorizonDays: 730,
  },

  // ── Soil / environment ──
  {
    id: "property.soil_type",
    subjectType: "property",
    kind: "string",
    label: "Dominant soil type",
    freshnessHorizonDays: null,
  },
  {
    id: "property.septic_rating",
    subjectType: "property",
    kind: "string",
    label: "USDA septic absorption-field rating",
    freshnessHorizonDays: null,
  },

  // ── Access / services ──
  {
    id: "property.broadband_served",
    subjectType: "property",
    kind: "boolean",
    label: "Fixed broadband available",
    freshnessHorizonDays: 180,
  },
  {
    id: "property.broadband_max_down_mbps",
    subjectType: "property",
    kind: "number",
    label: "Maximum advertised download speed",
    freshnessHorizonDays: 180,
    numericTolerance: 0,
    unit: "mbps",
  },
] as const;

const PREDICATE_BY_ID = new Map(PREDICATES.map((p) => [p.id, p]));

export function predicateById(id: string): PredicateSpec | undefined {
  return PREDICATE_BY_ID.get(id);
}

export function isKnownPredicate(id: string): boolean {
  return PREDICATE_BY_ID.has(id);
}

// ── The claim ─────────────────────────────────────────────────────────────

/**
 * A single source-backed assertion. This is the atomic truth primitive (BI13):
 * AcreOS does not store "the zoning" — it stores "source X observed zoning=R-1
 * at time T, under license L, and we fetched it at time F".
 *
 * Claims are APPEND-ONLY. Re-observing a fact writes a new claim; it never
 * updates an old one. That is what makes as-of reconstruction possible.
 */
export interface EvidenceClaimInput {
  subjectType: EvidenceSubjectType;
  subjectId: number;
  /** Must be a registered predicate id. */
  predicate: string;
  /**
   * The asserted value, already normalised to the predicate's kind. `null`
   * means the source was asked and returned NOTHING — a genuinely useful fact
   * (it distinguishes "we never looked" from "we looked and there is no
   * answer") and the reason `unknown` is a first-class authority level.
   */
  value: string | number | boolean | null;
  /** Machine routing name of the adapter, e.g. "open-data", "attom". */
  provider: string;
  /** Human-readable authoritative source, e.g. "FEMA NFHL". */
  source: string;
  authority: EvidenceAuthority;
  /**
   * When the SOURCE says the fact was true/current (FEMA effective date, county
   * tax year). Null when the source exposes no such metadata — in which case
   * `fetchedAt` is the best available observation time and staleness is
   * measured from it, conservatively.
   */
  observedAt: Date | null;
  /** When WE pulled it. Always known. */
  fetchedAt: Date;
  /** 0–100 as reported by the adapter. Used only to break ties. */
  providerConfidence: number | null;
  /** License id from the data-license register, when the source is registered. */
  license: string | null;
  /** Cost of acquiring this claim, for cost-per-outcome attribution (Law 13). */
  costCents: number;
}

/** A persisted claim: an input plus the identity the store assigned it. */
export interface EvidenceClaim extends EvidenceClaimInput {
  id: number;
  organizationId: number;
}

// ── Resolution ────────────────────────────────────────────────────────────

export type ResolutionState = "known" | "unknown" | "conflict";

/** Categorical, explainable — never an invented percentage (BI140). */
export type ResolvedConfidence = "high" | "medium" | "low";

export interface ResolutionCandidate {
  value: string | number | boolean | null;
  /** Every claim that asserted this value, best-first. */
  claims: EvidenceClaim[];
  bestAuthority: EvidenceAuthority;
  /** The most recent observation time backing this value. */
  observedAt: Date | null;
  stale: boolean;
}

export interface ResolvedValue {
  predicate: string;
  state: ResolutionState;
  /** Present only when state === "known". */
  value?: string | number | boolean | null;
  confidence: ResolvedConfidence;
  /**
   * Why the answer is what it is, in plain language. This is what the evidence
   * chip renders and what Pax must quote — never a bare number.
   */
  factors: string[];
  /**
   * Every distinct value under consideration, best-first. On `conflict` this
   * carries the dissent that must stay visible (BI139). On `known` it carries
   * the winner plus any superseded alternatives, so the lineage is inspectable.
   */
  candidates: ResolutionCandidate[];
  /** True when the winning claim is past its predicate's freshness horizon. */
  stale: boolean;
  /** The policy that produced this answer — frozen into DecisionSnapshots. */
  policyVersion: number;
}

/**
 * Normalised comparison key so "R-1" and "r-1 " group together.
 *
 * The null sentinel is written as the ESCAPE `\u0000`, never as a literal NUL
 * byte. It used to be a literal one, and the runtime value is identical — but a
 * raw NUL makes the whole file BINARY to text tooling. `grep` answered "binary
 * file matches" with no lines, and ripgrep traversing a directory skipped the
 * file completely: `rg -l valueKey shared/` found nothing at all.
 *
 * This repository audits itself almost entirely by grep, and this file carries
 * the Evidence Fabric's canonical laws. One byte made the most consequential
 * file in the subsystem invisible to every search that did not name it
 * explicitly — a blind spot of exactly the kind the ratchets exist to prevent,
 * sitting in the code that defines what counts as evidence.
 *
 * Keep the escape. A literal NUL here also cannot survive a round trip through
 * a Postgres `text` column or a `jsonb` document, so it must never widen from a
 * comparison key into anything persisted.
 */
function valueKey(value: string | number | boolean | null): string {
  // Distinct from the STRING "null", which must not group with a real null.
  if (value === null) return "\u0000null";
  if (typeof value === "string") return value.trim().toLowerCase();
  return String(value);
}

/** The observation time to age a claim from: the source's, else our fetch. */
function effectiveObservedAt(claim: EvidenceClaim): Date {
  return claim.observedAt ?? claim.fetchedAt;
}

function isStale(claim: EvidenceClaim, spec: PredicateSpec, asOf: Date): boolean {
  if (spec.freshnessHorizonDays === null) return false;
  const ageMs = asOf.getTime() - effectiveObservedAt(claim).getTime();
  return ageMs > spec.freshnessHorizonDays * 24 * 60 * 60 * 1000;
}

/**
 * Two numeric observations that differ by less than the predicate's tolerance
 * are the SAME answer, not a conflict. Groups are merged into the group whose
 * representative is closest.
 */
function mergeNumericGroups(
  groups: Map<string, EvidenceClaim[]>,
  tolerance: number,
): Map<string, EvidenceClaim[]> {
  if (tolerance <= 0) return groups;
  const entries = [...groups.entries()]
    .map(([k, claims]) => ({ k, claims, n: Number(claims[0].value) }))
    .filter((e) => Number.isFinite(e.n))
    .sort((a, b) => a.n - b.n);
  if (entries.length <= 1) return groups;

  const merged = new Map<string, EvidenceClaim[]>();
  // Preserve any non-numeric groups (e.g. a null observation) untouched.
  for (const [k, claims] of groups) {
    if (!Number.isFinite(Number(claims[0]?.value))) merged.set(k, claims);
  }

  let bucketKey = entries[0].k;
  let bucketAnchor = entries[0].n;
  let bucket: EvidenceClaim[] = [];
  for (const e of entries) {
    if (Math.abs(e.n - bucketAnchor) <= tolerance) {
      bucket.push(...e.claims);
    } else {
      merged.set(bucketKey, bucket);
      bucketKey = e.k;
      bucketAnchor = e.n;
      bucket = [...e.claims];
    }
  }
  merged.set(bucketKey, bucket);
  return merged;
}

/** Best-first claim ordering: authority, then recency, then provider confidence. */
function compareClaims(a: EvidenceClaim, b: EvidenceClaim): number {
  const byAuthority = authorityRank(b.authority) - authorityRank(a.authority);
  if (byAuthority !== 0) return byAuthority;
  const byRecency =
    effectiveObservedAt(b).getTime() - effectiveObservedAt(a).getTime();
  if (byRecency !== 0) return byRecency;
  return (b.providerConfidence ?? 0) - (a.providerConfidence ?? 0);
}

/**
 * Resolve the current answer for one predicate from its claims.
 *
 * DETERMINISTIC: given the same claims and the same `asOf`, this returns the
 * same answer forever. It performs no I/O and reads no clock — `asOf` is
 * injected, which is also what makes as-of reconstruction ("what did we believe
 * on 3 March?") a matter of passing a different date rather than a different
 * code path.
 *
 * @param predicate registered predicate id
 * @param claims    every claim for this (subject, predicate), in any order
 * @param asOf      the moment to resolve AT; claims fetched after it are ignored
 */
export function resolveClaims(
  predicate: string,
  claims: readonly EvidenceClaim[],
  asOf: Date,
): ResolvedValue {
  const spec = predicateById(predicate);
  const base = {
    predicate,
    candidates: [] as ResolutionCandidate[],
    stale: false,
    policyVersion: RESOLUTION_POLICY_VERSION,
  };

  if (!spec) {
    // An unregistered predicate is a bug, not a fact. Refuse rather than guess
    // — the no-fabrication rule applies to schema as much as to numbers.
    return {
      ...base,
      state: "unknown",
      confidence: "low",
      factors: [`"${predicate}" is not a registered predicate`],
    };
  }

  // Resolve ONLY claims about the predicate that was asked for.
  //
  // The caller is expected to have filtered already (`claimsForPredicate` does),
  // so this is belt-and-braces — but the failure mode it removes is the worst
  // kind available here. Handed a mixed claim set, the grouping below would read
  // an APN and an acreage as two rival answers for the flood zone and return
  // `conflict`: a confident, user-visible, entirely FABRICATED disagreement
  // between sources that never disagreed. A safety property that depends on
  // every caller remembering a convention is not a safety property, and
  // "no fabrication" is not a rule a pure function should delegate upward.
  //
  // Filtering is the right response rather than throwing: it yields the CORRECT
  // answer for the predicate asked about, where a throw would turn a caller's
  // extra rows into a 500 on a read path.
  const forPredicate = claims.filter((c) => c.predicate === predicate);

  // Never resolve using claims we had not fetched yet at `asOf`. This is the
  // whole of as-of reconstruction.
  const visible = forPredicate.filter((c) => c.fetchedAt.getTime() <= asOf.getTime());

  // A `null` value means "the source was asked and had no answer". Those claims
  // are evidence OF ABSENCE and must not become a candidate value.
  const asserted = visible.filter(
    (c) => c.value !== null && c.authority !== "unknown",
  );
  const nullObservations = visible.length - asserted.length;

  if (asserted.length === 0) {
    const factors =
      visible.length === 0
        ? ["no source has been consulted for this fact"]
        : [
            `${nullObservations} source${nullObservations === 1 ? "" : "s"} consulted; none returned a value`,
          ];
    // Law 3: absence stays absence. Never false, never zero.
    return { ...base, state: "unknown", confidence: "low", factors };
  }

  // Group by value.
  let groups = new Map<string, EvidenceClaim[]>();
  for (const c of asserted) {
    const k = valueKey(c.value);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  if (spec.kind === "number" && spec.numericTolerance) {
    groups = mergeNumericGroups(groups, spec.numericTolerance);
  }

  const candidates: ResolutionCandidate[] = [...groups.values()]
    .map((g) => {
      const sorted = [...g].sort(compareClaims);
      const best = sorted[0];
      return {
        value: best.value,
        claims: sorted,
        bestAuthority: best.authority,
        observedAt: effectiveObservedAt(best),
        stale: isStale(best, spec, asOf),
      };
    })
    .sort((a, b) => compareClaims(a.claims[0], b.claims[0]));

  const winner = candidates[0];
  const runnerUp = candidates[1];
  const factors: string[] = [];

  factors.push(
    `${winner.claims.length} claim${winner.claims.length === 1 ? "" : "s"} from ` +
      `${new Set(winner.claims.map((c) => c.source)).size} source(s); ` +
      `best is ${winner.bestAuthority} (${winner.claims[0].source})`,
  );

  // CONFLICT: a rival value of EQUAL authority that is not itself stale. Two
  // authoritative sources disagreeing is the case a human must see; an
  // authoritative source beating a modeled guess is not.
  const rivalTies =
    runnerUp !== undefined &&
    authorityRank(runnerUp.bestAuthority) === authorityRank(winner.bestAuthority) &&
    !runnerUp.stale;

  if (rivalTies) {
    factors.push(
      `conflicting ${runnerUp.bestAuthority} claim: ` +
        `${String(runnerUp.value)} from ${runnerUp.claims[0].source}`,
    );
    return {
      ...base,
      state: "conflict",
      confidence: "low",
      factors,
      candidates,
      stale: winner.stale,
    };
  }

  if (winner.stale && spec.freshnessHorizonDays !== null) {
    factors.push(
      `observation is older than the ${spec.freshnessHorizonDays}-day freshness horizon for this fact`,
    );
  }
  if (candidates.length > 1) {
    factors.push(
      `${candidates.length - 1} lower-authority alternative(s) retained for lineage`,
    );
  }
  if (nullObservations > 0) {
    factors.push(
      `${nullObservations} source(s) returned no value and are recorded as such`,
    );
  }

  // Confidence is derived from the factors above, never asserted.
  let confidence: ResolvedConfidence;
  if (winner.stale) {
    confidence = "low";
  } else if (winner.bestAuthority === "authoritative") {
    confidence = "high";
  } else if (winner.bestAuthority === "estimate") {
    confidence = "medium";
  } else {
    // `modeled` never reaches better than low — a model output is not a fact.
    confidence = "low";
  }

  return {
    ...base,
    state: "known",
    value: winner.value,
    confidence,
    factors,
    candidates,
    stale: winner.stale,
  };
}

/**
 * Resolve every predicate present in a claim set, keyed by predicate id.
 *
 * Note what this deliberately does NOT do: it does not fill in predicates that
 * have no claims. A caller wanting "is this fact known?" must ask for the
 * predicate explicitly and receive `unknown` — there is no silent default.
 */
export function resolveAll(
  claims: readonly EvidenceClaim[],
  asOf: Date,
): Map<string, ResolvedValue> {
  const byPredicate = new Map<string, EvidenceClaim[]>();
  for (const c of claims) {
    const g = byPredicate.get(c.predicate);
    if (g) g.push(c);
    else byPredicate.set(c.predicate, [c]);
  }
  const out = new Map<string, ResolvedValue>();
  for (const [predicate, group] of byPredicate) {
    out.set(predicate, resolveClaims(predicate, group, asOf));
  }
  return out;
}
