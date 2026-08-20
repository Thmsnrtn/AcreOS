/**
 * DecisionSnapshot — the durable boundary of the canonical loop (BI20).
 *
 * WHAT A SNAPSHOT IS
 * ------------------
 * When a consequential investment decision is made, this freezes WHAT WAS
 * KNOWN at that moment: the resolved evidence and the exact claims behind it,
 * the assumptions in force, the alternatives considered, the unknowns accepted,
 * who decided and under what authority, and which Strategy Pack version shaped
 * the criteria. Later evidence and later outcomes APPEND context; they never
 * rewrite what was believed (Law 6, Law 9).
 *
 * WHY IT IS NEEDED
 * ----------------
 * Without it, every recorded decision reads against live rows, so a decision
 * silently changes meaning when the data behind it changes. That was the only
 * fitness function in shared/architecture/canon.ts classified `unenforced`
 * other than infrastructure-restraint, and BL3 names its failure precisely:
 * "A prior decision changes meaning when current data or Pack rules change."
 *
 * It is also the moat. BL2 lists DecisionSnapshots as one of the ten strongest
 * repeated conclusions across a hundred audit lenses, "because they preserve
 * what was known, assumed and chosen" — a competitor can copy a screen, but not
 * a customer's accumulated reasoning.
 *
 * WHAT THIS FILE IS
 * -----------------
 * The pure half: types, the freezing function, and the reconstruction contract.
 * No I/O, no clock, no database — isomorphic and deterministic, so a snapshot
 * built in a test is byte-identical to one built in production from the same
 * inputs. Persistence lives in server/services/decisions/decisionStore.ts.
 *
 * THE HONEST PART
 * ---------------
 * `unknowns` is not decoration. A decision made without knowing the flood zone
 * is a DIFFERENT decision from one made knowing it, and the difference is
 * invisible six months later unless it was recorded at the time. Freezing the
 * unknowns is what carries Law 3 forward into Decision Memory: an unknown at
 * decision time stays an unknown in the record, and cannot be retroactively
 * filled in by data that arrived afterwards.
 */

import {
  RESOLUTION_POLICY_VERSION,
  type ResolvedConfidence,
  type ResolutionState,
  type ResolvedValue,
} from "../evidence/claim";
import type { FrozenScenarioRef } from "../economics/scenario";
import type { StrategyPackId } from "../business-types";

/** Bump when the FROZEN SHAPE changes, so old snapshots stay readable as-written. */
export const DECISION_SNAPSHOT_VERSION = 1 as const;

// ── What a decision is about ──────────────────────────────────────────────

export const DECISION_SUBJECT_TYPES = ["property", "deal", "opportunity"] as const;
export type DecisionSubjectType = (typeof DECISION_SUBJECT_TYPES)[number];

/**
 * The consequential investment decisions AcreOS records.
 *
 * Deliberately a closed set. An open string would let every feature invent its
 * own decision kind, and Decision Memory would stop being comparable across
 * time — which is the entire source of its value.
 */
export const DECISION_KINDS = [
  "pursue", // take this opportunity forward
  "pass", // decline it (the most under-recorded and most valuable decision)
  "offer", // make an offer at a stated price
  "acquire", // commit to buying
  "hold", // keep an owned position rather than dispose
  "dispose", // sell / exit
  "price", // set or change an asking/offer price
  "finance", // choose a financing structure
] as const;
export type DecisionKind = (typeof DECISION_KINDS)[number];

/** Who decided, and under what authority (BI72: capability-specific authority). */
export const DECISION_ACTOR_TYPES = ["user", "pax", "automation"] as const;
export type DecisionActorType = (typeof DECISION_ACTOR_TYPES)[number];

// ── Frozen evidence ───────────────────────────────────────────────────────

/**
 * One fact as it stood at decision time.
 *
 * Note what is stored: the resolved answer AND the ids of the claims that
 * produced it. The ids make the snapshot verifiable — an auditor can re-read
 * those exact claims and re-run the resolution policy at the recorded `asOf`
 * and `policyVersion` to confirm the frozen answer follows from them. The
 * resolved answer itself is stored so reconstruction does not DEPEND on the
 * claims still being reachable.
 */
export interface FrozenFact {
  predicate: string;
  state: ResolutionState;
  /** Present only when state === "known" — mirrors ResolvedValue exactly. */
  value?: string | number | boolean | null;
  confidence: ResolvedConfidence;
  stale: boolean;
  /** The claim ids that produced this answer, best-first. */
  claimIds: number[];
  /** The sources behind the winning value, for a human reading the record. */
  sources: string[];
}

/**
 * An input the decision relied on that was NOT observed evidence.
 *
 * `origin` matters more than the value: a rent assumption the customer typed is
 * a different kind of thing from one a Strategy Pack defaulted, and only the
 * first is the customer's own judgement. Conflating them is how a platform
 * default silently becomes "what the customer believed".
 */
export interface FrozenAssumption {
  key: string;
  value: string | number | boolean;
  unit?: string;
  origin: "user" | "strategy-pack-default" | "derived" | "platform-default";
  /** Free-text note on where a derived value came from. */
  basis?: string;
}

/** An option considered and not taken. Recording these is what makes a
 *  decision reconstructable as a CHOICE rather than as an event. */
export interface FrozenAlternative {
  choice: string;
  /** Why it lost. An alternative with no reason is not a considered option. */
  reason: string;
}

/**
 * Something material that was NOT known when the decision was made.
 *
 * Populated automatically from evidence that resolved to `unknown` or
 * `conflict`, and extendable by the caller for non-evidence unknowns
 * ("seller's motivation", "whether the neighbour will sell").
 */
export interface FrozenUnknown {
  /** Predicate id when the unknown is an evidence gap; free text otherwise. */
  subject: string;
  /** "unknown" (never observed) or "conflict" (sources disagreed). */
  kind: "unknown" | "conflict" | "unmeasured";
  note?: string;
}

// ── The snapshot ──────────────────────────────────────────────────────────

export interface DecisionSnapshotInput {
  subjectType: DecisionSubjectType;
  subjectId: number;
  kind: DecisionKind;
  /** What was chosen, in the customer's terms. e.g. "Offer $42,000 cash". */
  choice: string;
  /** Why. Free text — this is the sentence a human reads two years later. */
  rationale: string;

  actorType: DecisionActorType;
  /** team_members.id for a user; the capability/job name for automation. */
  actorRef: string;
  /**
   * How this was authorised. For a user decision that is the role that acted;
   * for automation it must name the capability grant that permitted it, never
   * a global "autonomous mode" flag (BI72).
   */
  authority: string;

  /**
   * Which Strategy Pack shaped the criteria (BI91). Null when none applied —
   * recorded as null rather than omitted, so "no pack" is explicit.
   *
   * TYPED AGAINST THE CANONICAL REGISTRY, not `string`. A strategy pack IS a
   * business type (see `StrategyPackId` in shared/business-types.ts); typing it
   * loosely is what let every vertical surface write `null` unnoticed while the
   * column sat unread. An invented id is now a compile error.
   */
  strategyPackId: StrategyPackId | null;
  strategyPackVersion: string | null;

  assumptions: FrozenAssumption[];
  alternatives: FrozenAlternative[];
  /** Non-evidence unknowns. Evidence unknowns are derived automatically. */
  additionalUnknowns?: FrozenUnknown[];

  /**
   * When the decision-maker expects to KNOW whether this worked.
   *
   * Null is a real and common answer, recorded rather than implied. Supplying it
   * is what later lets the loop ASK for an outcome, which nothing otherwise does
   * — so a decision with no review date simply never prompts, which is correct
   * for the many that have no natural one.
   *
   * REQUIRED-nullable, like `strategyPackId` above and for the same reason.
   * It was `?:` until 2026-08-18, which quietly defeated the promise the frozen
   * record makes about this very field: `DecisionSnapshotBody.reviewDueAt` is
   * documented as "recorded explicitly, so a decision that will never be
   * reviewed is distinguishable from one whose review was forgotten" — and
   * `freeze()` collapsed an omitted input to `null`, making those two exactly
   * indistinguishable. A caller must now say which one it means.
   *
   * The HTTP boundary in `routes-decisions.ts` keeps the field optional for
   * back-compat and normalises there, so the decision is made in one visible
   * place rather than inside `freeze()`.
   */
  reviewDueAt: Date | null;
}

/** The frozen record. Every field is immutable once written. */
export interface DecisionSnapshotBody {
  snapshotVersion: number;
  subjectType: DecisionSubjectType;
  subjectId: number;
  kind: DecisionKind;
  choice: string;
  rationale: string;

  actorType: DecisionActorType;
  actorRef: string;
  authority: string;

  strategyPackId: StrategyPackId | null;
  strategyPackVersion: string | null;

  /** The moment the evidence was resolved AT — replaying with this date and
   *  `resolutionPolicyVersion` must reproduce `evidence`. */
  evidenceAsOf: Date;
  resolutionPolicyVersion: number;

  evidence: FrozenFact[];
  assumptions: FrozenAssumption[];
  alternatives: FrozenAlternative[];
  unknowns: FrozenUnknown[];
  /**
   * The economics that justified the choice (BI12, BK24).
   *
   * Without this, a decision records "offer $42,000" and the arithmetic behind
   * the number lives nowhere — you can reconstruct what the investor believed
   * about the PARCEL and not what they believed about the DEAL. Each reference
   * carries the engine version and every metric the engine predicted, so the
   * record stays
   * readable even if the scenario row later becomes unreachable — the same
   * reasoning that makes a frozen fact store its resolved value alongside its
   * claim ids.
   *
   * Empty is a valid and common state: many decisions (a `pass` on a parcel
   * that failed a hard filter) are made without running economics at all, and
   * recording an empty list says exactly that.
   */
  scenarios: FrozenScenarioRef[];

  /**
   * When the decision-maker expected to know whether this worked. Null when no
   * natural review date exists — recorded explicitly, so a decision that will
   * never be reviewed is distinguishable from one whose review was forgotten.
   */
  reviewDueAt: Date | null;
}

/**
 * Freeze a decision.
 *
 * DETERMINISTIC: the same inputs always produce the same body. `decidedAt` is
 * NOT part of this function — the store stamps it — so a snapshot built in a
 * test is byte-identical to one built in production.
 *
 * The unknowns list is derived, not asked for. A caller cannot forget to record
 * that the flood zone was unknown, because the function reads it out of the
 * resolved evidence itself. That is deliberate: the honest part of a decision
 * record is exactly the part a hurried caller would omit.
 */
export function freezeDecision(
  input: DecisionSnapshotInput,
  resolvedEvidence: ReadonlyMap<string, ResolvedValue> | readonly ResolvedValue[],
  evidenceAsOf: Date,
  scenarios: readonly FrozenScenarioRef[] = [],
): DecisionSnapshotBody {
  const resolved: ResolvedValue[] = Array.isArray(resolvedEvidence)
    ? [...resolvedEvidence]
    : [...(resolvedEvidence as ReadonlyMap<string, ResolvedValue>).values()];

  const evidence: FrozenFact[] = resolved.map((r) => ({
    predicate: r.predicate,
    state: r.state,
    ...(r.state === "known" ? { value: r.value } : {}),
    confidence: r.confidence,
    stale: r.stale,
    claimIds: r.candidates[0]?.claims.map((c) => c.id) ?? [],
    sources: [...new Set(r.candidates[0]?.claims.map((c) => c.source) ?? [])],
  }));

  // Every evidence gap becomes a recorded unknown, automatically.
  const evidenceUnknowns: FrozenUnknown[] = resolved
    .filter((r) => r.state !== "known")
    .map((r) => ({
      subject: r.predicate,
      kind: r.state === "conflict" ? "conflict" : "unknown",
      note: r.factors[0],
    }));

  // A stale-but-known fact is not an unknown, but it IS a caveat the record
  // must carry — otherwise a decision made on two-year-old zoning reads later
  // as if it were made on current zoning.
  const staleCaveats: FrozenUnknown[] = resolved
    .filter((r) => r.state === "known" && r.stale)
    .map((r) => ({
      subject: r.predicate,
      kind: "unmeasured",
      note: `known but past its freshness horizon at decision time`,
    }));

  // Policy version comes from the evidence that was actually resolved; if no
  // evidence was consulted at all, the current version is recorded so the
  // snapshot still states which policy governed it.
  const resolutionPolicyVersion =
    resolved[0]?.policyVersion ?? RESOLUTION_POLICY_VERSION;

  return {
    snapshotVersion: DECISION_SNAPSHOT_VERSION,
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    kind: input.kind,
    choice: input.choice,
    rationale: input.rationale,
    actorType: input.actorType,
    actorRef: input.actorRef,
    authority: input.authority,
    strategyPackId: input.strategyPackId,
    strategyPackVersion: input.strategyPackVersion,
    evidenceAsOf,
    resolutionPolicyVersion,
    evidence,
    assumptions: input.assumptions,
    alternatives: input.alternatives,
    unknowns: [
      ...evidenceUnknowns,
      ...staleCaveats,
      ...(input.additionalUnknowns ?? []),
    ],
    scenarios: [...scenarios],
    reviewDueAt: input.reviewDueAt,
  };
}

// ── Reading a frozen decision ─────────────────────────────────────────────

/**
 * What a snapshot says about one fact — the reconstruction primitive.
 *
 * Returns the FROZEN answer, never the current one. A caller asking "what did
 * we think the zoning was when we made this offer?" must receive the answer
 * from then, even if a newer claim has since superseded it. Returns `null` when
 * the predicate was not part of the decision's evidence at all, which is
 * itself the honest answer: we did not consider it.
 */
export function factAtDecision(
  body: DecisionSnapshotBody,
  predicate: string,
): FrozenFact | null {
  return body.evidence.find((f) => f.predicate === predicate) ?? null;
}

/** Was this fact unknown or conflicting when the decision was made? */
export function wasUnknownAtDecision(
  body: DecisionSnapshotBody,
  subject: string,
): boolean {
  return body.unknowns.some((u) => u.subject === subject);
}

/**
 * A one-line honest summary of the decision's epistemic footing, for the
 * decision-history UI and for Pax to quote.
 *
 * It leads with what was NOT known, because that is the part a reader
 * reconstructing a past decision most needs and is least likely to be told.
 */
export function describeFooting(body: DecisionSnapshotBody): string {
  const known = body.evidence.filter((f) => f.state === "known").length;
  const conflicts = body.unknowns.filter((u) => u.kind === "conflict").length;
  const unknowns = body.unknowns.filter((u) => u.kind === "unknown").length;
  const stale = body.evidence.filter((f) => f.stale).length;

  const parts: string[] = [];
  if (unknowns > 0) parts.push(`${unknowns} unknown`);
  if (conflicts > 0) parts.push(`${conflicts} conflicting`);
  if (stale > 0) parts.push(`${stale} stale`);
  parts.push(`${known} known`);

  const packNote =
    body.strategyPackId !== null
      ? ` under ${body.strategyPackId}@${body.strategyPackVersion ?? "unversioned"}`
      : "";
  // Naming the ABSENCE of economics matters as much as naming its presence: a
  // decision made without running the numbers is a different decision, and
  // silence would read as "the numbers were fine".
  const econNote =
    body.scenarios.length > 0
      ? `; ${body.scenarios.length} scenario(s)`
      : "; no scenario computed";
  return `${parts.join(", ")} fact(s) at decision time${packNote}${econNote}`;
}
