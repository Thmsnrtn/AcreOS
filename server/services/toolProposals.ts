/**
 * Tool Proposals — the capability-growth layer.
 *
 * Agents can identify gaps in their own tooling and propose new
 * integrations, data sources, capabilities, or rubrics that would
 * materially help them do their jobs. Unlike strategic proposals
 * (which are business moves), tool proposals are engineering work
 * the founder decides to take on.
 *
 * Sources:
 *   1. Monthly strategic-synthesis pass — when the synthesis LLM sees
 *      recurring "I didn't have the data to act" signals across agent
 *      proposals, it can emit a tool proposal describing the gap.
 *   2. Prompt-evolution meta-agent — when multiple agents' negative
 *      outcomes cluster around a missing capability, the meta-agent
 *      can surface a tool proposal.
 *   3. Manual — the founder can ask an agent directly for a tool
 *      proposal via the agent chat.
 *
 * Review flow: all proposals land with status='proposed' in the
 * tool_proposals table. Founder approves/rejects from /founder/tools.
 * Approved proposals become engineering backlog — the founder decides
 * where they get built (inside this codebase or as MCP servers, etc).
 */

import { db } from "../db";
import { toolProposals } from "@shared/schema";
import { and, desc, eq, sql } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface ToolProposalInput {
  proposedBy: string;
  title: string;
  description: string;
  category: "integration" | "data_source" | "capability" | "rubric";
  capabilityGap: string;
  expectedBenefit: string;
  estimatedComplexity?: "low" | "medium" | "high";
  estimatedImpactCents?: number | null;
  supportingEvidence?: Record<string, any>;
}

export async function proposeTool(input: ToolProposalInput): Promise<number> {
  // De-duplicate: don't re-file a near-identical proposal within 30 days.
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const existing = await db
    .select({ id: toolProposals.id })
    .from(toolProposals)
    .where(
      and(
        eq(toolProposals.title, input.title),
        sql`${toolProposals.createdAt} >= ${since}`,
      ),
    )
    .limit(1);
  if (existing.length > 0) {
    logger.info(
      `[toolProposals] skipping duplicate proposal "${input.title}" (recent match id=${existing[0].id})`,
    );
    return existing[0].id;
  }

  const [row] = await db
    .insert(toolProposals)
    .values({
      proposedBy: input.proposedBy,
      title: input.title.slice(0, 200),
      description: input.description.slice(0, 2000),
      category: input.category,
      capabilityGap: input.capabilityGap.slice(0, 1000),
      expectedBenefit: input.expectedBenefit.slice(0, 1000),
      estimatedComplexity: input.estimatedComplexity ?? "medium",
      estimatedImpactCents: input.estimatedImpactCents ?? null,
      supportingEvidence: input.supportingEvidence ?? {},
    })
    .returning({ id: toolProposals.id });
  return row?.id ?? 0;
}

export async function listToolProposals(
  status?: "proposed" | "approved" | "rejected" | "building" | "shipped",
) {
  const q = db.select().from(toolProposals);
  if (status) {
    return q.where(eq(toolProposals.status, status)).orderBy(desc(toolProposals.createdAt)).limit(50);
  }
  return q.orderBy(desc(toolProposals.createdAt)).limit(50);
}

export async function resolveToolProposal(
  id: number,
  status: "approved" | "rejected" | "building" | "shipped",
  founderNotes: string | undefined,
  resolvedBy: string,
) {
  await db
    .update(toolProposals)
    .set({
      status,
      founderNotes: founderNotes?.slice(0, 2000) ?? null,
      resolvedAt: new Date(),
      resolvedBy,
    })
    .where(eq(toolProposals.id, id));
}
