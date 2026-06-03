/**
 * SOLENE — distributed reasoning sessions (Phase B L2.7).
 *
 * A reasoning session coordinates N parallel sub-dispatches that each tackle
 * a slice of a larger problem. Each sub-dispatch records a contribution; once
 * all (or enough) are in, the synthesizer consolidates them into a unified
 * conclusion with a confidence score.
 *
 * Lifecycle: open → synthesizing → closed | abandoned.
 *
 * Pure helpers (weightedAggregate, buildSynthesizerPrompt) are exported for
 * testability and for synthesizer code paths that want to reuse them without
 * touching the DB.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneReasoningSessions,
  soleneReasoningContributions,
  REASONING_STRATEGIES,
  REASONING_SESSION_STATUSES,
  type ReasoningStrategy,
  type ReasoningSessionRow,
  type ReasoningContributionRow,
} from "@shared/schema/solene-distributed-reasoning";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";

// ============================================================================
// openSession
// ============================================================================

export interface OpenSessionInput {
  openedByAgentRole: SoleneDispatchAgentRole;
  topic: string;
  problemStatement: string;
  decompositionStrategy: ReasoningStrategy;
  expectedSubDispatchCount: number;
}

export async function openSession(
  input: OpenSessionInput,
): Promise<{ sessionId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.openedByAgentRole)) {
    throw new Error(
      `openSession: invalid openedByAgentRole=${input.openedByAgentRole}`,
    );
  }
  if (typeof input.topic !== "string" || input.topic.trim().length === 0) {
    throw new Error("openSession: topic must be non-empty");
  }
  if (
    typeof input.problemStatement !== "string" ||
    input.problemStatement.trim().length === 0
  ) {
    throw new Error("openSession: problemStatement must be non-empty");
  }
  if (!REASONING_STRATEGIES.includes(input.decompositionStrategy)) {
    throw new Error(
      `openSession: invalid decompositionStrategy=${input.decompositionStrategy}`,
    );
  }
  if (
    !Number.isInteger(input.expectedSubDispatchCount) ||
    input.expectedSubDispatchCount <= 0
  ) {
    throw new Error(
      `openSession: expectedSubDispatchCount=${input.expectedSubDispatchCount} must be a positive integer`,
    );
  }

  const [inserted] = await db
    .insert(soleneReasoningSessions)
    .values({
      openedByAgentRole: input.openedByAgentRole,
      topic: input.topic,
      problemStatement: input.problemStatement,
      decompositionStrategy: input.decompositionStrategy,
      expectedSubDispatchCount: input.expectedSubDispatchCount,
      status: "open",
    })
    .returning({ id: soleneReasoningSessions.id });

  if (!inserted) {
    throw new Error("openSession: insert returned no id");
  }

  logger.info(
    `[distributedReasoning] opened session id=${inserted.id} role=${input.openedByAgentRole} strategy=${input.decompositionStrategy} N=${input.expectedSubDispatchCount}`,
  );

  return { sessionId: inserted.id };
}

// ============================================================================
// recordContribution
// ============================================================================

export interface RecordContributionInput {
  sessionId: number;
  contributingDispatchId?: number;
  contributorAgentRole: SoleneDispatchAgentRole;
  sliceDescription: string;
  contributionText: string;
  weight?: number;
}

export async function recordContribution(
  input: RecordContributionInput,
): Promise<{ contributionId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.contributorAgentRole)) {
    throw new Error(
      `recordContribution: invalid contributorAgentRole=${input.contributorAgentRole}`,
    );
  }
  if (
    typeof input.sliceDescription !== "string" ||
    input.sliceDescription.trim().length === 0
  ) {
    throw new Error("recordContribution: sliceDescription must be non-empty");
  }
  if (
    typeof input.contributionText !== "string" ||
    input.contributionText.trim().length === 0
  ) {
    throw new Error("recordContribution: contributionText must be non-empty");
  }

  const session = await getSession(input.sessionId);
  if (!session) {
    throw new Error(
      `recordContribution: session id=${input.sessionId} not found`,
    );
  }
  if (session.status === "closed" || session.status === "abandoned") {
    throw new Error(
      `recordContribution: session id=${input.sessionId} is terminal (status=${session.status})`,
    );
  }

  // Default weight = 1.0 / expectedSubDispatchCount; clamp to [0,1].
  let weight: number;
  if (input.weight !== undefined) {
    if (
      !Number.isFinite(input.weight) ||
      input.weight < 0 ||
      input.weight > 1
    ) {
      throw new Error(
        `recordContribution: weight=${input.weight} must be in [0,1]`,
      );
    }
    weight = input.weight;
  } else {
    weight = 1.0 / Math.max(1, session.expectedSubDispatchCount);
  }

  const [inserted] = await db
    .insert(soleneReasoningContributions)
    .values({
      sessionId: input.sessionId,
      contributingDispatchId: input.contributingDispatchId ?? null,
      contributorAgentRole: input.contributorAgentRole,
      sliceDescription: input.sliceDescription,
      contributionText: input.contributionText,
      weight: weight.toFixed(4),
    })
    .returning({ id: soleneReasoningContributions.id });

  if (!inserted) {
    throw new Error("recordContribution: insert returned no id");
  }

  logger.info(
    `[distributedReasoning] contribution id=${inserted.id} sessionId=${input.sessionId} role=${input.contributorAgentRole} weight=${weight.toFixed(4)}`,
  );

  return { contributionId: inserted.id };
}

// ============================================================================
// synthesizeSession — close the loop with a unified output.
// ============================================================================

export interface SynthesizeSessionInput {
  synthesisOutput: string;
  finalConclusion: string;
  finalConfidence: number;
}

export async function synthesizeSession(
  sessionId: number,
  opts: SynthesizeSessionInput,
): Promise<void> {
  if (
    typeof opts.synthesisOutput !== "string" ||
    opts.synthesisOutput.trim().length === 0
  ) {
    throw new Error("synthesizeSession: synthesisOutput must be non-empty");
  }
  if (
    typeof opts.finalConclusion !== "string" ||
    opts.finalConclusion.trim().length === 0
  ) {
    throw new Error("synthesizeSession: finalConclusion must be non-empty");
  }
  if (
    !Number.isFinite(opts.finalConfidence) ||
    opts.finalConfidence < 0 ||
    opts.finalConfidence > 1
  ) {
    throw new Error(
      `synthesizeSession: finalConfidence=${opts.finalConfidence} must be in [0,1]`,
    );
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`synthesizeSession: session id=${sessionId} not found`);
  }
  if (session.status !== "open" && session.status !== "synthesizing") {
    throw new Error(
      `synthesizeSession: session id=${sessionId} is terminal (status=${session.status}); only 'open' or 'synthesizing' can be synthesized`,
    );
  }

  const now = new Date();
  await db
    .update(soleneReasoningSessions)
    .set({
      status: "closed",
      closedAt: now,
      synthesisOutput: opts.synthesisOutput,
      finalConclusion: opts.finalConclusion,
      finalConfidence: opts.finalConfidence.toFixed(4),
    })
    .where(eq(soleneReasoningSessions.id, sessionId));

  logger.info(
    `[distributedReasoning] synthesized session id=${sessionId} conf=${opts.finalConfidence.toFixed(4)}`,
  );
}

// ============================================================================
// abandonSession — terminal with reason.
// ============================================================================

export async function abandonSession(
  sessionId: number,
  reason: string,
): Promise<void> {
  if (typeof reason !== "string" || reason.trim().length === 0) {
    throw new Error("abandonSession: reason must be non-empty");
  }

  const session = await getSession(sessionId);
  if (!session) {
    throw new Error(`abandonSession: session id=${sessionId} not found`);
  }
  if (session.status === "closed" || session.status === "abandoned") {
    throw new Error(
      `abandonSession: session id=${sessionId} is already terminal (status=${session.status})`,
    );
  }

  const now = new Date();
  await db
    .update(soleneReasoningSessions)
    .set({
      status: "abandoned",
      closedAt: now,
      finalConclusion: "abandoned",
      synthesisOutput: reason,
    })
    .where(eq(soleneReasoningSessions.id, sessionId));

  logger.info(
    `[distributedReasoning] abandoned session id=${sessionId} reason="${reason.slice(0, 80)}"`,
  );
}

// ============================================================================
// getSession / getSessionWithContributions / listOpenSessions
// ============================================================================

export async function getSession(
  sessionId: number,
): Promise<ReasoningSessionRow | null> {
  const [row] = await db
    .select()
    .from(soleneReasoningSessions)
    .where(eq(soleneReasoningSessions.id, sessionId))
    .limit(1);
  return row ?? null;
}

export async function getSessionWithContributions(
  sessionId: number,
): Promise<{
  session: ReasoningSessionRow;
  contributions: ReasoningContributionRow[];
} | null> {
  const session = await getSession(sessionId);
  if (!session) return null;
  const contributions = await db
    .select()
    .from(soleneReasoningContributions)
    .where(eq(soleneReasoningContributions.sessionId, sessionId));
  return { session, contributions };
}

export async function listOpenSessions(
  limit = 50,
): Promise<ReasoningSessionRow[]> {
  const bounded = Math.min(Math.max(1, Math.floor(limit)), 200);
  return db
    .select()
    .from(soleneReasoningSessions)
    .where(eq(soleneReasoningSessions.status, "open"))
    .orderBy(desc(soleneReasoningSessions.openedAt))
    .limit(bounded);
}

// ============================================================================
// PURE HELPERS — exported for testability + synthesizer reuse.
// ============================================================================

/**
 * Weighted-average aggregator. Useful when contributions include a numeric
 * score (e.g., risk estimates) and the synthesizer wants the weighted mean.
 *
 * Returns 0 for empty input. If all weights are 0, returns the simple mean
 * (degenerate case avoidance — never NaN).
 */
export function weightedAggregate<T extends { weight: number; value: number }>(
  items: T[],
): number {
  if (items.length === 0) return 0;
  let weightedSum = 0;
  let totalWeight = 0;
  for (const item of items) {
    weightedSum += item.value * item.weight;
    totalWeight += item.weight;
  }
  if (totalWeight === 0) {
    // Fall back to simple mean so callers never see NaN.
    let sum = 0;
    for (const item of items) sum += item.value;
    return sum / items.length;
  }
  return weightedSum / totalWeight;
}

/**
 * Build a system-prompt-style block for the synthesizer model. Lists the
 * topic + problem statement + all contributions with attribution + asks the
 * model to produce a unified synthesis.
 */
export function buildSynthesizerPrompt(
  session: ReasoningSessionRow,
  contributions: ReasoningContributionRow[],
): string {
  const lines: string[] = [];
  lines.push("# Distributed Reasoning Synthesis");
  lines.push("");
  lines.push(`Session ID: ${session.id}`);
  lines.push(`Topic: ${session.topic}`);
  lines.push(`Opened by: ${session.openedByAgentRole}`);
  lines.push(`Decomposition strategy: ${session.decompositionStrategy}`);
  lines.push(
    `Expected sub-dispatch count: ${session.expectedSubDispatchCount}`,
  );
  lines.push(`Actual contributions received: ${contributions.length}`);
  lines.push("");
  lines.push("## Problem Statement");
  lines.push(session.problemStatement);
  lines.push("");
  lines.push("## Contributions");
  if (contributions.length === 0) {
    lines.push("(none recorded)");
  } else {
    contributions.forEach((c, idx) => {
      const weight = c.weight !== null ? Number(c.weight).toFixed(4) : "n/a";
      lines.push("");
      lines.push(`### Contribution ${idx + 1}`);
      lines.push(`- Contributor: ${c.contributorAgentRole}`);
      lines.push(`- Slice: ${c.sliceDescription}`);
      lines.push(`- Weight: ${weight}`);
      if (c.contributingDispatchId !== null) {
        lines.push(`- Dispatch ID: ${c.contributingDispatchId}`);
      }
      lines.push("");
      lines.push(c.contributionText);
    });
  }
  lines.push("");
  lines.push("## Your Task");
  lines.push(
    "Consolidate the above contributions into a single unified synthesis. " +
      "Apply the decomposition strategy in reverse: for map_reduce, reduce; " +
      "for divide_and_conquer, recombine; for adversarial_pair, identify " +
      "which side prevails or where they reconcile; for parallel_perspectives, " +
      "find the consensus and call out tensions. Produce:",
  );
  lines.push("  1. A unified synthesis (synthesis_output)");
  lines.push("  2. A final conclusion (final_conclusion)");
  lines.push("  3. A confidence score in [0,1] (final_confidence)");
  return lines.join("\n");
}

// No-op references to keep imports tree-shaken consistently with siblings.
void and;
void REASONING_SESSION_STATUSES;
