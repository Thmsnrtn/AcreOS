/**
 * Rosy River C7 — Decision-log retrieval (v0).
 *
 * Find past founder decisions on similar proposals so future agent
 * proposals can carry a "founder previously rejected this for X" note,
 * and the codebase monitor (or any future planner) can avoid re-proposing
 * what was already declined.
 *
 * v0 is intentionally simple — no LLM embedding, no vector store, just
 * lexical similarity over title + target_files. Good enough to surface
 * obvious repeats ("we rejected drizzle-orm major bumps three times
 * already, here's the most recent reason"). A future iteration can
 * replace `scoreSimilarity` with an embedding-based call.
 *
 * Reads from agent_tasks (the proposal itself) joined to
 * decisions_inbox_items (the founder's verdict + notes).
 */

import { db } from "../db";
import { agentTasks, decisionsInboxItems } from "@shared/schema";
import { and, eq, inArray, sql, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface SimilarDecision {
  agentTaskId: number;
  agentType: string;
  title: string;
  targetFiles: string[];
  riskTier: string | undefined;
  founderDecision: string | undefined; // approved | rejected | deferred
  founderNotes: string | null;
  decidedAt: string | null;
  similarityScore: number; // 0..1
}

export interface FindSimilarInput {
  title: string;
  targetFiles: string[];
  agentType?: string;
  excludeAgentTaskId?: number;
}

/**
 * Score the lexical similarity between two proposals on a 0..1 scale.
 *
 * Weights:
 *   - 0.6: overlap in target files (exact file path match)
 *   - 0.4: overlap in title-token set
 *
 * Both components use simple Jaccard-style overlap. Cheap, deterministic,
 * sufficient for v0.
 */
function scoreSimilarity(
  a: { title: string; targetFiles: string[] },
  b: { title: string; targetFiles: string[] },
): number {
  // Target file overlap
  const aFiles = new Set(a.targetFiles);
  const bFiles = new Set(b.targetFiles);
  const fileInter = [...aFiles].filter((f) => bFiles.has(f)).length;
  const fileUnion = new Set([...aFiles, ...bFiles]).size;
  const fileScore = fileUnion > 0 ? fileInter / fileUnion : 0;

  // Title token overlap (lowercase, word-split, drop short tokens)
  const tokens = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s./-]/g, " ")
        .split(/\s+/)
        .filter((t) => t.length >= 3),
    );
  const aTokens = tokens(a.title);
  const bTokens = tokens(b.title);
  const tokenInter = [...aTokens].filter((t) => bTokens.has(t)).length;
  const tokenUnion = new Set([...aTokens, ...bTokens]).size;
  const titleScore = tokenUnion > 0 ? tokenInter / tokenUnion : 0;

  return 0.6 * fileScore + 0.4 * titleScore;
}

/**
 * Find the K most similar past founder decisions for this proposal.
 * Only returns proposals whose paired decisionsInboxItem has a non-pending
 * status (i.e. the founder actually decided).
 *
 * Default K=3. Returns sorted by similarityScore desc.
 */
export async function findSimilarPastDecisions(
  input: FindSimilarInput,
  k = 3,
): Promise<SimilarDecision[]> {
  // Pull the last 200 decided proposals — bounded so this stays fast even
  // as the decision log grows. The lexical scorer is O(n) over the result.
  // Future LLM-embedding version can use vector similarity for unbounded
  // recall.
  const rows = await db
    .select({
      agentTaskId: agentTasks.id,
      agentType: agentTasks.agentType,
      output: agentTasks.output,
      input: agentTasks.input,
      reviewNotes: agentTasks.reviewNotes,
      reviewedAt: agentTasks.reviewedAt,
      inboxStatus: decisionsInboxItems.status,
      inboxFounderModification: decisionsInboxItems.founderModification,
    })
    .from(agentTasks)
    .innerJoin(
      decisionsInboxItems,
      sql`(${decisionsInboxItems.actionPayload}->>'agentTaskId')::int = ${agentTasks.id}`,
    )
    .where(
      and(
        eq(decisionsInboxItems.itemType, "agent_code_proposal"),
        input.agentType
          ? eq(agentTasks.agentType, input.agentType)
          : sql`true`,
        inArray(decisionsInboxItems.status, ["approved", "rejected", "deferred"]),
      ),
    )
    .orderBy(desc(agentTasks.createdAt))
    .limit(200);

  const candidates: SimilarDecision[] = [];
  for (const row of rows) {
    if (input.excludeAgentTaskId && row.agentTaskId === input.excludeAgentTaskId) continue;
    const output = (row.output ?? {}) as {
      title?: string;
      targetFiles?: string[];
      riskTier?: string;
    };
    const title = output.title ?? "";
    const targetFiles = output.targetFiles ?? [];
    const score = scoreSimilarity(
      { title: input.title, targetFiles: input.targetFiles },
      { title, targetFiles },
    );
    if (score === 0) continue;
    candidates.push({
      agentTaskId: row.agentTaskId,
      agentType: row.agentType,
      title,
      targetFiles,
      riskTier: output.riskTier,
      founderDecision: row.inboxStatus ?? undefined,
      founderNotes: row.inboxFounderModification ?? row.reviewNotes ?? null,
      decidedAt: row.reviewedAt?.toISOString() ?? null,
      similarityScore: Number(score.toFixed(3)),
    });
  }

  candidates.sort((a, b) => b.similarityScore - a.similarityScore);
  const top = candidates.slice(0, k);

  if (top.length > 0) {
    logger.info("[decision-rag] returned similar decisions", {
      source: "decision-rag",
      metadata: {
        targetFiles: input.targetFiles,
        agentType: input.agentType,
        top: top.map((t) => ({ id: t.agentTaskId, score: t.similarityScore, decision: t.founderDecision })),
      },
    });
  }

  return top;
}

/**
 * Convenience: would the founder probably reject this? Returns true if
 * the K nearest decisions are predominantly rejects above a confidence
 * threshold. Use to skip proposing what we know will get rejected.
 */
export async function isLikelyRejection(
  input: FindSimilarInput,
  opts: { k?: number; minSimilarity?: number; minRejectFraction?: number } = {},
): Promise<{ likely: boolean; reason?: string; precedents: SimilarDecision[] }> {
  const k = opts.k ?? 5;
  const minSimilarity = opts.minSimilarity ?? 0.5;
  const minRejectFraction = opts.minRejectFraction ?? 0.6;

  const precedents = await findSimilarPastDecisions(input, k);
  const strong = precedents.filter((p) => p.similarityScore >= minSimilarity);
  if (strong.length === 0) {
    return { likely: false, precedents };
  }
  const rejects = strong.filter((p) => p.founderDecision === "rejected").length;
  const fraction = rejects / strong.length;
  if (fraction >= minRejectFraction) {
    return {
      likely: true,
      reason:
        `${rejects} of ${strong.length} similar past proposals were rejected ` +
        `(threshold ${Math.round(minRejectFraction * 100)}%).`,
      precedents: strong,
    };
  }
  return { likely: false, precedents: strong };
}
