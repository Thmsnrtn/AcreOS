/**
 * OutcomeStore — persistence for the learning layer.
 *
 * The guarantee, as everywhere else in this chain: no update, no delete. An
 * outcome is written once. And critically, this module never touches
 * `decisionSnapshots` at all — canonical law 9 says outcomes APPEND learning
 * and do not rewrite history, and the cleanest way to honour that is for the
 * outcome writer to have no path to the decision writer.
 *
 * Variance is not stored. `outcomeWithVariance` computes it on read, as a pure
 * projection over the scenario references the decision already froze. A stored
 * variance would be a third number that can drift from the two it derives from.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import { outcomes } from "@shared/schema";
import {
  buildOutcome,
  computeVariance,
  describeVariance,
  type MetricVariance,
  type OutcomeBody,
  type OutcomeKind,
} from "@shared/outcomes/outcome";
import { getDecision } from "../decisions/decisionStore";

/** Read cap — a decision with more outcomes than this has a runaway writer. */
const OUTCOME_READ_CAP = 200;

export interface StoredOutcome {
  id: number;
  observedAt: Date;
  recordedAt: Date;
  body: OutcomeBody;
}

/** An outcome plus the variance derived from the decision it graded. */
export interface OutcomeWithVariance extends StoredOutcome {
  variance: MetricVariance[];
  /** One honest line. Never says whether the decision was good (BI178). */
  varianceSummary: string;
}

function rowToBody(row: typeof outcomes.$inferSelect): OutcomeBody {
  return {
    shapeVersion: row.shapeVersion,
    decisionSnapshotId: row.decisionSnapshotId,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    kind: row.kind,
    summary: row.summary,
    actuals: row.actuals,
  };
}

export interface RecordOutcomeInput {
  decisionSnapshotId: number;
  kind: OutcomeKind;
  summary: string;
  actuals: Array<{ id: string; value: number | null }>;
  /** When it was OBSERVED, which is not when it was recorded. */
  observedAt: Date;
}

/** Raised when an outcome cites a decision that is not this org's. */
export class UnknownDecisionError extends Error {
  constructor(id: number) {
    super(`Decision ${id} does not exist for this organization.`);
  }
}

/**
 * Record an outcome against a decision.
 *
 * The subject is read FROM THE DECISION rather than accepted from the caller.
 * An outcome that claims to be about a different property than the decision it
 * grades is not a variance — it is two unrelated facts filed together, and the
 * comparison it produces would be meaningless.
 */
export async function recordOutcome(
  organizationId: number,
  input: RecordOutcomeInput,
): Promise<StoredOutcome> {
  const decision = await getDecision(organizationId, input.decisionSnapshotId);
  if (!decision) throw new UnknownDecisionError(input.decisionSnapshotId);

  const body = buildOutcome({
    decisionSnapshotId: input.decisionSnapshotId,
    subjectType: decision.body.subjectType,
    subjectId: decision.body.subjectId,
    kind: input.kind,
    summary: input.summary,
    actuals: input.actuals,
  });

  const [row] = await db
    .insert(outcomes)
    .values({
      organizationId,
      shapeVersion: body.shapeVersion,
      decisionSnapshotId: body.decisionSnapshotId,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      kind: body.kind,
      summary: body.summary,
      actuals: body.actuals,
      observedAt: input.observedAt,
    })
    .returning();

  return {
    id: row.id,
    observedAt: row.observedAt,
    recordedAt: row.recordedAt,
    body: rowToBody(row),
  };
}

/**
 * Every outcome recorded against one decision, with variance computed against
 * the scenarios that decision FROZE — never against a live scenario row, which
 * would let a later recomputation change how a past decision looks.
 */
export async function outcomesForDecision(
  organizationId: number,
  decisionSnapshotId: number,
): Promise<OutcomeWithVariance[]> {
  const decision = await getDecision(organizationId, decisionSnapshotId);
  if (!decision) return [];

  const rows = await db
    .select()
    .from(outcomes)
    .where(
      and(
        eq(outcomes.organizationId, organizationId),
        eq(outcomes.decisionSnapshotId, decisionSnapshotId),
      ),
    )
    .orderBy(desc(outcomes.observedAt))
    .limit(OUTCOME_READ_CAP);

  return rows.map((row) => {
    const body = rowToBody(row);
    const variance = computeVariance(body, decision.body.scenarios);
    return {
      id: row.id,
      observedAt: row.observedAt,
      recordedAt: row.recordedAt,
      body,
      variance,
      varianceSummary: describeVariance(variance),
    };
  });
}
