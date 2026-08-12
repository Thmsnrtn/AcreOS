/**
 * ScenarioStore — persistence for the economics layer.
 *
 * Like `decisionStore`, the guarantee is what it does NOT expose: there is no
 * update and no delete. Re-running the maths INSERTs a new scenario; a stored
 * one never changes. Canonical law 4 requires financial truth to be
 * deterministic, tested AND versioned, and a mutable scenario would let
 * improving a formula silently rewrite the meaning of every number the old one
 * produced — the economics equivalent of the mutable-decision failure law 6
 * forbids.
 *
 * The computation itself is pure and lives in shared/economics/scenario.ts.
 * This module does the I/O and nothing else, so the arithmetic stays testable
 * without a database and identical in every environment.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../../db";
import { scenarios } from "@shared/schema";
import { ALL_ENGINES } from "./engines";
import {
  computeScenario,
  freezeScenarioRef,
  type ComputeScenarioRequest,
  type FrozenScenarioRef,
  type ScenarioBody,
  type ScenarioSubjectType,
} from "@shared/economics/scenario";

/** Read cap — a subject with more scenarios than this has a runaway writer. */
const SCENARIO_READ_CAP = 500;

export interface StoredScenario {
  id: number;
  computedAt: Date;
  body: ScenarioBody;
}

function rowToBody(row: typeof scenarios.$inferSelect): ScenarioBody {
  return {
    shapeVersion: row.shapeVersion,
    subjectType: row.subjectType,
    subjectId: row.subjectId,
    label: row.label,
    engineId: row.engineId,
    engineVersion: row.engineVersion,
    strategyPackId: row.strategyPackId,
    strategyPackVersion: row.strategyPackVersion,
    inputs: row.inputs,
    assumptions: row.assumptions,
    metrics: row.metrics,
  };
}

/**
 * Compute a scenario and persist it.
 *
 * The computation happens HERE rather than being supplied by the caller, for
 * the same reason `recordDecision` gathers its own evidence: a caller that
 * hands over pre-computed numbers can hand over any numbers at all, and the
 * stored `engine_version` would then be a claim rather than a fact.
 */
export async function recordScenario(
  organizationId: number,
  req: ComputeScenarioRequest,
): Promise<StoredScenario> {
  // The FULL registry — core (shared) engines plus the server-side ones. See
  // ./engines/index.ts for why the note engine cannot live in shared/.
  const body = computeScenario(req, ALL_ENGINES);

  const [row] = await db
    .insert(scenarios)
    .values({
      organizationId,
      shapeVersion: body.shapeVersion,
      subjectType: body.subjectType,
      subjectId: body.subjectId,
      label: body.label,
      engineId: body.engineId,
      engineVersion: body.engineVersion,
      strategyPackId: body.strategyPackId,
      strategyPackVersion: body.strategyPackVersion,
      inputs: body.inputs,
      assumptions: body.assumptions,
      metrics: body.metrics,
    })
    .returning();

  return { id: row.id, computedAt: row.computedAt, body: rowToBody(row) };
}

/** A subject's scenarios, newest first. */
export async function scenariosForSubject(
  organizationId: number,
  subjectType: ScenarioSubjectType,
  subjectId: number,
): Promise<StoredScenario[]> {
  const rows = await db
    .select()
    .from(scenarios)
    .where(
      and(
        eq(scenarios.organizationId, organizationId),
        eq(scenarios.subjectType, subjectType),
        eq(scenarios.subjectId, subjectId),
      ),
    )
    .orderBy(desc(scenarios.computedAt))
    .limit(SCENARIO_READ_CAP);
  return rows.map((row) => ({
    id: row.id,
    computedAt: row.computedAt,
    body: rowToBody(row),
  }));
}

/**
 * Build the frozen references a DecisionSnapshot stores.
 *
 * Silently skips ids that do not belong to this org — a decision must never
 * freeze a reference to another tenant's economics, and refusing loudly here
 * would leak the existence of a foreign row.
 */
export async function freezeScenarioRefs(
  organizationId: number,
  scenarioIds: readonly number[],
): Promise<FrozenScenarioRef[]> {
  if (scenarioIds.length === 0) return [];
  const rows = await db
    .select()
    .from(scenarios)
    .where(
      and(
        eq(scenarios.organizationId, organizationId),
        inArray(scenarios.id, [...scenarioIds]),
      ),
    )
    .limit(SCENARIO_READ_CAP);
  return rows.map((row) => freezeScenarioRef(row.id, rowToBody(row)));
}
