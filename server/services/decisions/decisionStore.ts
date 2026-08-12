/**
 * DecisionStore — persistence for Decision Memory.
 *
 * The one thing this module must guarantee is what it does NOT expose: there is
 * no update and no delete. A snapshot is written once and read forever. Later
 * evidence and later outcomes reference it; nothing edits it. That is canonical
 * law 6 (historical decisions preserve what was known at the time) enforced
 * structurally rather than by convention — the failure mode it prevents is not
 * malice, it is an ordinary `UPDATE ... SET rationale = ...` written by someone
 * fixing a typo two years from now, silently changing what the record says a
 * customer believed.
 *
 * The flow it exists to complete:
 *
 *   property → evidence (resolved through the deterministic policy)
 *            → decision (frozen here, with its evidence and its unknowns)
 *            → …later… outcome (appended, never merged back)
 */

import { and, asc, eq, desc, isNotNull, lte, ne, notInArray } from "drizzle-orm";
import { db } from "../../db";
import { decisionSnapshots, outcomes } from "@shared/schema";
import {
  freezeDecision,
  type DecisionSnapshotBody,
  type DecisionSnapshotInput,
  type DecisionSubjectType,
} from "@shared/decisions/snapshot";
import { resolveSubject } from "../evidence/evidenceStore";
import { freezeScenarioRefs } from "../economics/scenarioStore";
import type { ResolvedValue } from "@shared/evidence/claim";

/** Read cap — a subject with more decisions than this has a runaway writer. */
const DECISION_READ_CAP = 500;

function rowToBody(
  row: typeof decisionSnapshots.$inferSelect,
): DecisionSnapshotBody {
  return {
    snapshotVersion: row.snapshotVersion,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    choice: row.choice,
    rationale: row.rationale,
    actorType: row.actorType,
    actorRef: row.actorRef,
    authority: row.authority,
    strategyPackId: row.strategyPackId,
    strategyPackVersion: row.strategyPackVersion,
    evidenceAsOf: row.evidenceAsOf,
    resolutionPolicyVersion: row.resolutionPolicyVersion,
    evidence: row.evidence,
    assumptions: row.assumptions,
    alternatives: row.alternatives,
    unknowns: row.unknowns,
    scenarios: row.scenarios,
    reviewDueAt: row.reviewDueAt,
  };
}

export interface RecordedDecision {
  id: number;
  decidedAt: Date;
  body: DecisionSnapshotBody;
}

/**
 * Record a decision, freezing the evidence that was in force.
 *
 * The evidence is gathered HERE rather than supplied by the caller. That is
 * deliberate: a caller that assembles its own evidence list can omit the
 * inconvenient parts, and the unknowns — the honest half of the record — are
 * exactly what a hurried caller would leave out. Reading it from the Evidence
 * Fabric at a single `asOf` makes the frozen state a fact about the system
 * rather than a claim by the caller.
 *
 * For a `property` or `opportunity` subject, both the property-scoped and
 * parcel-scoped facts are gathered, since cadastral facts (acreage, owner,
 * legal description) are claimed against the parcel subject.
 */
export async function recordDecision(
  organizationId: number,
  input: DecisionSnapshotInput,
  evidenceAsOf: Date = new Date(),
  /**
   * Scenarios whose economics justified this choice. Resolved to frozen
   * references HERE rather than accepted pre-frozen, for the same reason the
   * evidence is gathered here: a caller that hands over pre-computed numbers
   * can hand over any numbers at all.
   *
   * An id this org cannot read — another tenant's, or simply wrong — raises
   * `UnavailableScenarioError` rather than being dropped. The decision must
   * never freeze another tenant's economics AND must never quietly record fewer
   * scenarios than it was told it rested on; see freezeScenarioRefs for why
   * those are not in tension.
   */
  scenarioIds: readonly number[] = [],
): Promise<RecordedDecision> {
  const resolved: ResolvedValue[] = [];

  if (input.subjectType === "property" || input.subjectType === "opportunity") {
    const [propertyFacts, parcelFacts] = await Promise.all([
      resolveSubject(organizationId, "property", input.subjectId, evidenceAsOf),
      resolveSubject(organizationId, "parcel", input.subjectId, evidenceAsOf),
    ]);
    resolved.push(...propertyFacts.values(), ...parcelFacts.values());
  }
  // A `deal` subject carries no direct evidence claims today — evidence is
  // claimed against the property. Rather than guess which property a deal
  // refers to, the snapshot records zero evidence and the unknowns list stays
  // honestly empty. When Opportunity and Holding become canonical objects and
  // the deal→property edge is a typed relationship, this reads through it.

  const scenarioRefs = await freezeScenarioRefs(organizationId, scenarioIds);
  const body = freezeDecision(input, resolved, evidenceAsOf, scenarioRefs);

  const [row] = await db
    .insert(decisionSnapshots)
    .values({
      organizationId,
      snapshotVersion: body.snapshotVersion,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      kind: body.kind,
      choice: body.choice,
      rationale: body.rationale,
      actorType: body.actorType,
      actorRef: body.actorRef,
      authority: body.authority,
      strategyPackId: body.strategyPackId,
      strategyPackVersion: body.strategyPackVersion,
      evidenceAsOf: body.evidenceAsOf,
      resolutionPolicyVersion: body.resolutionPolicyVersion,
      evidence: body.evidence,
      assumptions: body.assumptions,
      alternatives: body.alternatives,
      unknowns: body.unknowns,
      scenarios: body.scenarios,
      reviewDueAt: body.reviewDueAt,
    })
    .returning();

  return { id: row.id, decidedAt: row.decidedAt, body: rowToBody(row) };
}

/** One snapshot by id, tenant-scoped. Null when it does not exist for this org. */
export async function getDecision(
  organizationId: number,
  id: number,
): Promise<RecordedDecision | null> {
  const [row] = await db
    .select()
    .from(decisionSnapshots)
    .where(
      and(
        eq(decisionSnapshots.organizationId, organizationId),
        eq(decisionSnapshots.id, id),
      ),
    )
    .limit(1);
  return row ? { id: row.id, decidedAt: row.decidedAt, body: rowToBody(row) } : null;
}

/** A subject's decision history, newest first. */
export async function decisionsForSubject(
  organizationId: number,
  subjectType: DecisionSubjectType,
  subjectId: number,
): Promise<RecordedDecision[]> {
  const rows = await db
    .select()
    .from(decisionSnapshots)
    .where(
      and(
        eq(decisionSnapshots.organizationId, organizationId),
        eq(decisionSnapshots.subjectType, subjectType),
        eq(decisionSnapshots.subjectId, subjectId),
      ),
    )
    .orderBy(desc(decisionSnapshots.decidedAt))
    .limit(DECISION_READ_CAP);
  return rows.map((row) => ({
    id: row.id,
    decidedAt: row.decidedAt,
    body: rowToBody(row),
  }));
}

/** Cap on one due sweep. A tenant past this has a different problem. */
const DUE_READ_CAP = 200;

export interface DecisionDueForOutcome {
  id: number;
  decidedAt: Date;
  reviewDueAt: Date;
  subjectType: DecisionSubjectType;
  subjectId: number;
  kind: string;
  choice: string;
  /** How many interim `still_open` observations have already been recorded. */
  interimObservations: number;
}

/**
 * Decisions whose review date has passed and which have no RESOLVED outcome.
 *
 * This is the missing end of the canonical loop. Every layer below it works, and
 * until now nothing ever ASKED for an outcome — so the loop closed only when
 * someone spontaneously chose to close it. That is not merely incomplete; it
 * silently biases everything built on top, because the outcomes a person
 * volunteers are the memorable ones, and memorable usually means extreme. A
 * calibration computed over volunteered outcomes measures what someone
 * remembers, not how they forecast.
 *
 * THE HONEST PARTS
 * ----------------
 * · A decision with NO review date never appears. Null means the decision-maker
 *   expected no moment of knowing, and inventing one for them would be the
 *   nagging that makes a prompt worth ignoring.
 * · Only a TERMINAL outcome closes it. A `still_open` observation is a real
 *   answer to "what happened?" — it just is not the last one — so it is counted
 *   and shown rather than treated as silence.
 * · Ordered by the OLDEST due date first, so the longest-unanswered question is
 *   the one asked, not the newest and freshest in mind.
 * · Nothing here writes. Being asked for an outcome must never create one, and a
 *   sweep that could would be a fabrication engine pointed at the learning layer.
 */
export async function decisionsDueForOutcome(
  organizationId: number,
  asOf: Date = new Date(),
): Promise<DecisionDueForOutcome[]> {
  // Decisions this org has already RESOLVED. `still_open` is deliberately not
  // in this set: an interim observation does not answer the question.
  const resolved = db
    .select({ id: outcomes.decisionSnapshotId })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.organizationId, organizationId),
        ne(outcomes.kind, "still_open"),
      ),
    );

  const rows = await db
    .select()
    .from(decisionSnapshots)
    .where(
      and(
        eq(decisionSnapshots.organizationId, organizationId),
        isNotNull(decisionSnapshots.reviewDueAt),
        lte(decisionSnapshots.reviewDueAt, asOf),
        notInArray(decisionSnapshots.id, resolved),
      ),
    )
    .orderBy(asc(decisionSnapshots.reviewDueAt))
    .limit(DUE_READ_CAP);

  if (rows.length === 0) return [];

  // How many interim observations each already carries, so the prompt can say
  // "checked twice, still open" instead of asking as though never answered.
  const interim = await db
    .select({ id: outcomes.decisionSnapshotId })
    .from(outcomes)
    .where(
      and(
        eq(outcomes.organizationId, organizationId),
        eq(outcomes.kind, "still_open"),
      ),
    )
    .limit(DUE_READ_CAP * 10);
  const interimCount = new Map<number, number>();
  for (const o of interim) {
    interimCount.set(o.id, (interimCount.get(o.id) ?? 0) + 1);
  }

  return rows.map((row) => ({
    id: row.id,
    decidedAt: row.decidedAt,
    // Non-null by the isNotNull predicate above; the assertion states that
    // rather than defaulting to a date nobody chose.
    reviewDueAt: row.reviewDueAt!,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    choice: row.choice,
    interimObservations: interimCount.get(row.id) ?? 0,
  }));
}
