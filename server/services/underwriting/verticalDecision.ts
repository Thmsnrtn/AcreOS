/**
 * The vertical underwriting kit — one call that closes a vertical's canonical
 * loop: SCENARIO (deterministic, versioned arithmetic) → DECISION (frozen
 * evidence + assumptions, citing that scenario) with an operator-chosen review
 * date, so the Today door can later ask what actually happened.
 *
 * WHY ONE CALL. Every vertical's decision route needs the same three
 * guarantees the flip analyzer and the blind-offer commit each wrote out by
 * hand. First, the arithmetic is recomputed HERE from the inputs, never accepted
 * pre-computed. Second, the decision cites the scenario that justified it.
 * Third, the scenario and the decision carry the SAME strategy pack. Written 13
 * more times, one of them would drift. Written once, the guarantees are tested
 * once (tests/unit/verticalDecision.test.ts).
 *
 * THE OWNERSHIP GUARD (evidence rule v2,
 * decision-memos/2026-10-04-vertical-program.md §3). A decision counts for a
 * vertical only when its scenario came from an engine that DECLARES that
 * vertical. That is enforced here at runtime, not just read by a test: a route
 * that asks to record a buy-and-hold decision on the flip engine is refused
 * before anything is written.
 *
 * Failure order is deliberate: the scenario is written first, then the
 * decision. If the decision fails, an orphaned scenario is inert arithmetic.
 * The alternative is a decision citing a scenario that does not exist. Both
 * stores are org-scoped.
 */

import {
  computeScenario,
  engineById,
  ScenarioEngineError,
  type ScenarioAssumption,
  type ScenarioMetric,
  type ScenarioSubjectType,
} from "@shared/economics/scenario";
import type { DecisionKind, FrozenAlternative } from "@shared/decisions/snapshot";
import type { StrategyPackId } from "@shared/business-types";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { properties } from "@shared/schema";
import { ALL_ENGINES } from "../economics/engines";
import { recordScenario } from "../economics/scenarioStore";
import { recordDecision } from "../decisions/decisionStore";

export interface UnderwrittenDecisionInput {
  subjectType: ScenarioSubjectType;
  subjectId: number;
  /** The engine that computes this vertical's decision. Must declare `strategyPackId`. */
  engineId: string;
  /** The vertical. Must be a string literal at the call site (evidence rule v2). */
  strategyPackId: StrategyPackId;
  inputs: Record<string, number | string>;
  /** Judgements the operator supplied, with their origin. Engine-made assumptions are added by the engine. */
  assumptions?: ScenarioAssumption[];
  /** Human name for the scenario — "Offer $42,000 at a 70% rule". */
  scenarioLabel: string;
  kind: DecisionKind;
  /** What was chosen, in the customer's terms. */
  choice: string;
  /** Why — the sentence a human reads two years later. */
  rationale: string;
  /** team_members / users id of the operator who decided. */
  actorRef: string;
  /** The real authority this route grants, e.g. "org_member:wholesale_underwrite". Never "system". */
  authority: string;
  alternatives?: FrozenAlternative[];
  /** The operator's answer to "when will you know?" — null is an answer ("no set date"). Never defaulted. */
  reviewDueAt: Date | null;
}

export interface UnderwrittenDecision {
  scenarioId: number;
  decisionId: number;
  metrics: ScenarioMetric[];
  assumptions: ScenarioAssumption[];
}

/** Refuse an engine that is unknown or does not underwrite this vertical. */
function assertEngineUnderwrites(engineId: string, pack: StrategyPackId): void {
  const engine = engineById(engineId, ALL_ENGINES);
  if (!engine) throw new ScenarioEngineError(`Unknown scenario engine "${engineId}"`);
  if (!(engine.verticals ?? []).includes(pack)) {
    throw new ScenarioEngineError(
      `Engine "${engineId}" does not underwrite ${pack} decisions — a decision counts for a ` +
        `vertical only on that vertical's own economics.`,
    );
  }
}

/**
 * Compute without persisting — what the workbench shows while the operator is
 * still typing. Same registry, same arithmetic, same engine-made assumptions as
 * the recorded scenario, so what they see is what gets frozen.
 */
export function previewUnderwriting(engineId: string, inputs: Record<string, number | string>) {
  const engine = engineById(engineId, ALL_ENGINES);
  if (!engine || !(engine.verticals ?? []).length) {
    throw new ScenarioEngineError(`"${engineId}" is not a vertical underwriting engine`);
  }
  const body = computeScenario(
    { subjectType: "property", subjectId: 1, label: "preview", engineId, inputs },
    ALL_ENGINES,
  );
  return {
    engineId: body.engineId,
    engineVersion: body.engineVersion,
    metrics: body.metrics,
    assumptions: body.assumptions,
    inputs: body.inputs,
  };
}

export async function recordUnderwrittenDecision(
  organizationId: number,
  input: UnderwrittenDecisionInput,
): Promise<UnderwrittenDecision> {
  assertEngineUnderwrites(input.engineId, input.strategyPackId);

  const scenario = await recordScenario(organizationId, {
    subjectType: input.subjectType,
    subjectId: input.subjectId,
    label: input.scenarioLabel,
    engineId: input.engineId,
    inputs: input.inputs,
    assumptions: input.assumptions ?? [],
    strategyPackId: input.strategyPackId,
    strategyPackVersion: null,
  });

  const decision = await recordDecision(
    organizationId,
    {
      subjectType: input.subjectType,
      subjectId: input.subjectId,
      kind: input.kind,
      choice: input.choice,
      rationale: input.rationale,
      actorType: "user",
      actorRef: input.actorRef,
      authority: input.authority,
      strategyPackId: input.strategyPackId,
      // Unversioned until a versioned pack artifact exists; the renderer prints
      // "@unversioned", which is honest. "1.0" would be a version nobody cut.
      strategyPackVersion: null,
      // The operator's judgements live on the SCENARIO, where they shaped the
      // numbers; the decision cites it rather than copying them.
      assumptions: [],
      alternatives: input.alternatives ?? [],
      reviewDueAt: input.reviewDueAt,
    },
    new Date(),
    [scenario.id],
  );

  return {
    scenarioId: scenario.id,
    decisionId: decision.id,
    metrics: scenario.body.metrics,
    assumptions: scenario.body.assumptions,
  };
}


/**
 * The body every vertical decision route accepts — what UnderwritingWorkbench
 * sends. `reviewDueAt` is REQUIRED-nullable: the operator must answer, and
 * "no set date" (null) is an answer. A missing field is refused rather than
 * silently treated as "never review", which is how a loop stops closing.
 */
/**
 * Engine inputs as they arrive over the wire, bounded. No engine takes more
 * than a couple of dozen keys, and a scenario's inputs are frozen into an
 * append-only row, so an unbounded record is a storage and parse cost a caller
 * chooses. Preview and record share it, so they accept the same thing.
 */
export const underwritingInputsSchema = z
  .record(z.string().min(1).max(64), z.union([z.number().finite(), z.string().max(200)]))
  .refine((r) => Object.keys(r).length <= 40, { message: "Too many inputs" });

export function underwriteBodySchema<K extends readonly [DecisionKind, ...DecisionKind[]]>(kinds: K) {
  return z.object({
    propertyId: z.number().int().positive(),
    inputs: underwritingInputsSchema,
    kind: z.enum(kinds),
    choice: z.string().trim().min(1).max(300),
    rationale: z.string().trim().min(10).max(2000),
    // Required, though nullable: null is the answer "no set date", and a
    // missing key is refused rather than read as "never review". A past date
    // would be due the instant it was recorded.
    reviewDueAt: z
      .string()
      .datetime()
      .nullable()
      .refine((d) => d === null || new Date(d).getTime() > Date.now(), {
        message: "A review date must be in the future.",
      }),
  });
}

/** The org's property, or null — never another tenant's. */
export async function loadOrgProperty(organizationId: number, propertyId: number) {
  const [row] = await db
    .select({ id: properties.id, address: properties.address, county: properties.county, state: properties.state, apn: properties.apn })
    .from(properties)
    .where(and(eq(properties.id, propertyId), eq(properties.organizationId, organizationId)));
  return row ?? null;
}

/** "123 Main St" / "Pima County, AZ" / "property 42" — for choice and label text. */
export function describeProperty(p: { id: number; address: string | null; county: string | null; state: string | null }): string {
  return p.address || [p.county && `${p.county} County`, p.state].filter(Boolean).join(", ") || `property ${p.id}`;
}
