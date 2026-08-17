/**
 * OutcomeStore — persistence for the learning layer.
 *
 * The guarantee, as everywhere else in this chain: no update, no delete. An
 * outcome is written once. And critically, this module has NO WRITE PATH to
 * `decisionSnapshots` — canonical law 9 says outcomes APPEND learning and do not
 * rewrite history, and the cleanest way to honour that is for the outcome writer
 * to be unable to reach the decision writer at all.
 *
 * It does READ decisions, and must: a variance is meaningless without the
 * forecast it grades. The header used to claim this module "never touches
 * decisionSnapshots at all", which stopped being true when calibration landed —
 * corrected rather than left as a comfortable overstatement, because the real
 * invariant (no write) is the one worth defending and an inflated claim makes it
 * harder to see which part is load-bearing. `outcomeVariance.test.ts` pins the
 * write ban directly.
 *
 * Variance is not stored. `outcomeWithVariance` computes it on read, as a pure
 * projection over the scenario references the decision already froze. A stored
 * variance would be a third number that can drift from the two it derives from.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { decisionSnapshots, outcomes } from "@shared/schema";
import {
  computeCalibration,
  type CalibrationReport,
} from "@shared/outcomes/calibration";
import type { FrozenScenarioRef } from "@shared/economics/scenario";
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

/**
 * Read cap for the org-wide calibration sweep. Higher than the per-decision cap
 * because this is deliberately a whole-history question, and bounded anyway
 * because an unbounded scan is how a read path becomes an outage. Newest first,
 * so the window that survives the cap is the recent behaviour — which is the
 * one a calibration is about.
 */
const CALIBRATION_OUTCOME_CAP = 5000;

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

/**
 * Calibration across every outcome this organization has recorded.
 *
 * The variance for ONE decision says a forecast missed. This is the layer above
 * it (Master Audit Section VII D): the pattern across many, which is the part
 * that is actionable and the part that is about the process rather than luck.
 *
 * TWO QUERIES, NOT N+1. Outcomes come first, then the decisions they cite are
 * fetched in a single `inArray` — a per-outcome decision read would issue one
 * query per outcome and get slower exactly as an org accumulates the history
 * that makes calibration worth computing.
 *
 * Both queries are org-scoped, and the decision fetch is scoped INDEPENDENTLY
 * rather than trusting the ids carried on the outcome rows. Those ids came from
 * this org's own outcomes so they should already be this org's decisions — but
 * "should" is not an isolation boundary, and the cost of asking again is one
 * predicate.
 */
export async function calibrationForOrganization(
  organizationId: number,
): Promise<CalibrationReport> {
  const outcomeRows = await db
    .select()
    .from(outcomes)
    .where(eq(outcomes.organizationId, organizationId))
    .orderBy(desc(outcomes.observedAt))
    .limit(CALIBRATION_OUTCOME_CAP);

  if (outcomeRows.length === 0) return computeCalibration([]);

  const decisionIds = [...new Set(outcomeRows.map((r) => r.decisionSnapshotId))];
  const decisionRows = await db
    .select({
      id: decisionSnapshots.id,
      scenarios: decisionSnapshots.scenarios,
    })
    .from(decisionSnapshots)
    .where(
      and(
        eq(decisionSnapshots.organizationId, organizationId),
        inArray(decisionSnapshots.id, decisionIds),
      ),
    );

  const frozenById = new Map<number, FrozenScenarioRef[]>(
    decisionRows.map((d) => [d.id, d.scenarios]),
  );

  // An outcome whose decision is unreadable contributes NOTHING rather than an
  // empty prediction set. Treating it as "predicted nothing" would quietly
  // inflate the unpredicted count and make coverage look worse than it is.
  const perOutcome = outcomeRows
    .filter((row) => frozenById.has(row.decisionSnapshotId))
    .map((row) =>
      computeVariance(rowToBody(row), frozenById.get(row.decisionSnapshotId)!),
    );

  return computeCalibration(perOutcome);
}
