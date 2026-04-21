/**
 * Decision Experiments — A/B framework at the agent-decision layer.
 *
 * Until now, the system learns by gradient: prompt-evolution meta-agent
 * tweaks agent prompts based on outcome data. That's powerful but slow
 * and observational — it can only adjust toward what's already
 * happening.
 *
 * This service adds the experimental complement. Instead of "try one
 * strategy and see what happens," the system can deliberately split
 * its decisions across variants and measure which performs better.
 * "Half of past-due customers get 7-day dunning, half get 10-day —
 * which recovers more?"
 *
 * Mechanics:
 *   1. Founder creates an experiment (name, variants with weights,
 *      success metric, itemType hook) via /founder/experiments.
 *   2. When that itemType shows up in the executor, the executor
 *      calls assignVariant() to get a sticky variant for the org.
 *      Assignment is deterministic by hash(experimentId + orgId) so
 *      the same org always gets the same variant in an experiment —
 *      no treatment switching mid-flight.
 *   3. Executor records the variant in contextBundle.experimentVariant
 *      and acts according to that variant's config.
 *   4. When the decision's outcome gets scored (via autonomyHealth),
 *      we copy the score into the assignment row.
 *   5. /founder/experiments/:id shows per-variant results with simple
 *      statistical commentary.
 *   6. Founder picks a winner, which ends the experiment; the winning
 *      variant's config becomes the new default (stored as founder
 *      setting or agent prompt tweak — out of scope for this MVP).
 *
 * What this MVP ships:
 *   - Full schema and CRUD
 *   - assignVariant() with sticky-hash allocation
 *   - Analysis that returns variant → (n, mean outcome, pos-count)
 *   - Integration hook in executor (via contextBundle)
 *   - Founder UI
 *
 * Out of scope (future):
 *   - Auto-ending experiments at statistical significance
 *   - Multi-arm bandits (exploration vs exploitation)
 *   - Baking the winner into a setting automatically
 */

import { db } from "../db";
import {
  decisionExperiments,
  decisionExperimentAssignments,
} from "@shared/schema";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import crypto from "crypto";
import { logger } from "../utils/logger";

export interface Variant {
  key: string;
  label: string;
  weight: number; // 0-100 (all variants' weights sum to 100)
  config: Record<string, any>;
}

export interface ExperimentInput {
  name: string;
  description: string;
  category: string;
  itemType?: string;
  variants: Variant[];
  successMetric: string;
}

/**
 * Called by agents/executor before making a decision for an org.
 * Returns the variant config to use. If no running experiment matches,
 * returns null and the agent proceeds with its default behavior.
 */
export async function assignVariant(
  itemType: string,
  organizationId: number,
): Promise<{ experimentId: number; variantKey: string; config: Record<string, any> } | null> {
  // Find any running experiment hooked into this itemType.
  const [experiment] = await db
    .select()
    .from(decisionExperiments)
    .where(
      and(
        eq(decisionExperiments.status, "running"),
        eq(decisionExperiments.itemType, itemType),
      ),
    )
    .orderBy(desc(decisionExperiments.startedAt))
    .limit(1);
  if (!experiment) return null;

  const variants = (experiment.variants ?? []) as Variant[];
  if (variants.length === 0) return null;

  // Reuse sticky assignment if it exists.
  const [existing] = await db
    .select()
    .from(decisionExperimentAssignments)
    .where(
      and(
        eq(decisionExperimentAssignments.experimentId, experiment.id),
        eq(decisionExperimentAssignments.organizationId, organizationId),
      ),
    )
    .limit(1);
  if (existing) {
    const v = variants.find((x) => x.key === existing.variantKey);
    if (v) {
      return {
        experimentId: experiment.id,
        variantKey: existing.variantKey,
        config: v.config ?? {},
      };
    }
  }

  // Otherwise pick a variant by deterministic hash.
  const variantKey = pickVariantByHash(experiment.id, organizationId, variants);
  const v = variants.find((x) => x.key === variantKey)!;

  try {
    await db
      .insert(decisionExperimentAssignments)
      .values({
        experimentId: experiment.id,
        organizationId,
        variantKey,
      })
      .onConflictDoNothing(); // idempotent under races
  } catch (err: any) {
    logger.warn("[decisionExperiments] assignment insert failed", {
      metadata: { error: err?.message },
    });
  }

  return { experimentId: experiment.id, variantKey, config: v.config ?? {} };
}

/**
 * Called by the outcome grader after a decision has been scored.
 * Copies the score into any matching experiment assignment that
 * doesn't yet have an outcome.
 */
export async function recordExperimentOutcome(
  organizationId: number,
  itemType: string,
  outcomeScore: number,
): Promise<void> {
  // Find running experiments on this itemType with an unrecorded
  // assignment for this org.
  const experiments = await db
    .select()
    .from(decisionExperiments)
    .where(
      and(
        eq(decisionExperiments.status, "running"),
        eq(decisionExperiments.itemType, itemType),
      ),
    );
  for (const exp of experiments) {
    await db
      .update(decisionExperimentAssignments)
      .set({
        outcomeRecorded: true,
        outcomeValue: outcomeScore,
        outcomeAt: new Date(),
      })
      .where(
        and(
          eq(decisionExperimentAssignments.experimentId, exp.id),
          eq(decisionExperimentAssignments.organizationId, organizationId),
          eq(decisionExperimentAssignments.outcomeRecorded, false),
        ),
      );
  }
}

/**
 * Deterministic variant selection by hash. Same org always gets the
 * same variant for a given experiment id. Weight-aware: higher-weight
 * variants catch proportionally more of the hash space.
 */
function pickVariantByHash(experimentId: number, orgId: number, variants: Variant[]): string {
  const hash = crypto
    .createHash("sha256")
    .update(`${experimentId}:${orgId}`)
    .digest();
  // Use the first 4 bytes as a uniform 0..99 integer.
  const bucket = hash.readUInt32BE(0) % 100;
  let acc = 0;
  for (const v of variants) {
    acc += Math.max(0, v.weight);
    if (bucket < acc) return v.key;
  }
  return variants[variants.length - 1].key;
}

// ── Analysis ────────────────────────────────────────────────────────

export interface VariantResult {
  key: string;
  label: string;
  n: number;
  outcomesRecorded: number;
  meanOutcome: number | null;
  positiveCount: number;
  positiveRate: number | null;
}

export interface ExperimentAnalysis {
  experimentId: number;
  experimentName: string;
  status: string;
  totalAssignments: number;
  totalOutcomes: number;
  variants: VariantResult[];
  leader: string | null;
  commentary: string;
}

export async function analyzeExperiment(experimentId: number): Promise<ExperimentAnalysis | null> {
  const [experiment] = await db
    .select()
    .from(decisionExperiments)
    .where(eq(decisionExperiments.id, experimentId))
    .limit(1);
  if (!experiment) return null;
  const variantDefs = (experiment.variants ?? []) as Variant[];

  const assignments = await db
    .select()
    .from(decisionExperimentAssignments)
    .where(eq(decisionExperimentAssignments.experimentId, experimentId));

  const results: VariantResult[] = variantDefs.map((v) => {
    const mine = assignments.filter((a) => a.variantKey === v.key);
    const withOutcome = mine.filter((a) => a.outcomeRecorded && a.outcomeValue != null);
    const mean = withOutcome.length > 0
      ? withOutcome.reduce((s, a) => s + (a.outcomeValue ?? 0), 0) / withOutcome.length
      : null;
    const positive = withOutcome.filter((a) => (a.outcomeValue ?? 0) > 0).length;
    const positiveRate = withOutcome.length > 0 ? positive / withOutcome.length : null;
    return {
      key: v.key,
      label: v.label,
      n: mine.length,
      outcomesRecorded: withOutcome.length,
      meanOutcome: mean != null ? Math.round(mean * 100) / 100 : null,
      positiveCount: positive,
      positiveRate: positiveRate != null ? Math.round(positiveRate * 1000) / 10 : null,
    };
  });

  // Simple leader: highest meanOutcome with at least 3 outcomes recorded.
  const scored = results.filter((r) => r.meanOutcome != null && r.outcomesRecorded >= 3);
  scored.sort((a, b) => (b.meanOutcome ?? -99) - (a.meanOutcome ?? -99));
  const leader = scored[0]?.key ?? null;

  const totalAssignments = assignments.length;
  const totalOutcomes = assignments.filter((a) => a.outcomeRecorded).length;

  let commentary: string;
  if (totalOutcomes < 6) {
    commentary = `Only ${totalOutcomes} graded outcomes so far — too early to declare a winner. Let the experiment run longer.`;
  } else if (scored.length < 2) {
    commentary = `Not enough variant-level data yet.`;
  } else {
    const top = scored[0]!;
    const runnerUp = scored[1]!;
    const gap =
      top.meanOutcome != null && runnerUp.meanOutcome != null
        ? top.meanOutcome - runnerUp.meanOutcome
        : 0;
    if (Math.abs(gap) < 0.3) {
      commentary = `"${top.label}" is leading but the gap vs "${runnerUp.label}" is small (${gap.toFixed(2)}) — not yet conclusive.`;
    } else {
      commentary = `"${top.label}" is outperforming "${runnerUp.label}" by ${gap.toFixed(2)} mean outcome. Consider ending the experiment and promoting the winner.`;
    }
  }

  return {
    experimentId,
    experimentName: experiment.name,
    status: experiment.status,
    totalAssignments,
    totalOutcomes,
    variants: results,
    leader,
    commentary,
  };
}

// ── Experiment CRUD ─────────────────────────────────────────────────

export async function listExperiments() {
  return db
    .select()
    .from(decisionExperiments)
    .orderBy(desc(decisionExperiments.createdAt))
    .limit(50);
}

export async function createExperiment(input: ExperimentInput): Promise<number> {
  const sum = input.variants.reduce((s, v) => s + v.weight, 0);
  if (Math.abs(sum - 100) > 1) {
    throw new Error(`Variant weights must sum to 100 (got ${sum})`);
  }
  const [row] = await db
    .insert(decisionExperiments)
    .values({
      name: input.name,
      description: input.description,
      category: input.category,
      itemType: input.itemType ?? null,
      variants: input.variants,
      successMetric: input.successMetric,
      status: "draft",
    })
    .returning({ id: decisionExperiments.id });
  return row?.id ?? 0;
}

export async function startExperiment(id: number) {
  await db
    .update(decisionExperiments)
    .set({ status: "running", startedAt: new Date(), updatedAt: new Date() })
    .where(eq(decisionExperiments.id, id));
}

export async function pauseExperiment(id: number) {
  await db
    .update(decisionExperiments)
    .set({ status: "paused", updatedAt: new Date() })
    .where(eq(decisionExperiments.id, id));
}

export async function completeExperiment(id: number, winningVariant: string, notes?: string) {
  await db
    .update(decisionExperiments)
    .set({
      status: "completed",
      winningVariant,
      founderNotes: notes?.slice(0, 2000) ?? null,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(decisionExperiments.id, id));
}

export async function abortExperiment(id: number, notes?: string) {
  await db
    .update(decisionExperiments)
    .set({
      status: "aborted",
      founderNotes: notes?.slice(0, 2000) ?? null,
      endedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(decisionExperiments.id, id));
}
