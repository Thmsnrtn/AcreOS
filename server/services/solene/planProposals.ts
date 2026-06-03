/**
 * SOLENE — plan-then-execute proposal service (Phase B L2.6).
 *
 * Agents propose plans; Solene/Tom approve or reject; approval (when paired
 * with enqueueOptions) materializes the plan as a real dispatch via
 * enqueueDispatch() and links the proposal forward via executed_dispatch_id.
 *
 * Why this exists:
 *   The cheapest place to catch a wrong assumption or missing context is
 *   BEFORE we pay for the dispatch. Plans are roughly a few hundred tokens;
 *   a wasted dispatch is dollars. Plan-then-execute trades a small upfront
 *   review cost for large downstream savings + higher decision quality.
 *
 * Surface:
 *   proposePlan         — validate + insert; returns id.
 *   listPendingPlans    — filter by agentRole + limit; default status=proposed.
 *   approvePlan         — set status to 'approved' (or 'executed' if
 *                         enqueueOptions provided + enqueueDispatch succeeds).
 *                         If enqueueDispatch THROWS (cap exceeded, validation),
 *                         the proposal stays at 'approved' and the caller can
 *                         retry — we do NOT rethrow.
 *   rejectPlan          — set status to 'rejected' + persist rationale.
 *   getProposal         — single row lookup; null when missing.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  planProposals,
  PLAN_PROPOSAL_SUMMARY_MAX,
  type PlanProposalRow,
} from "@shared/schema/solene-plan-proposals";
import {
  DISPATCH_AGENT_ROLES,
  type SoleneDispatchAgentRole,
  type SoleneDispatchSourceType,
} from "@shared/schema/solene-dispatch";
import { enqueueDispatch } from "./dispatchQueue";
import { logger } from "../../utils/logger";

// ----------------------------------------------------------------------------
// proposePlan
// ----------------------------------------------------------------------------

export interface ProposePlanInput {
  agentRole: SoleneDispatchAgentRole;
  triggeringDispatchId?: number;
  summary: string;
  planBody: string;
  estimatedCostUsd: number;
  estimatedDurationMinutes: number;
  riskAssessment?: string;
}

export async function proposePlan(
  input: ProposePlanInput,
): Promise<{ proposalId: number }> {
  if (!DISPATCH_AGENT_ROLES.includes(input.agentRole)) {
    throw new Error(
      `proposePlan: invalid agentRole=${input.agentRole}`,
    );
  }
  if (
    typeof input.summary !== "string" ||
    input.summary.trim().length === 0
  ) {
    throw new Error("proposePlan: summary must be non-empty");
  }
  if (input.summary.length > PLAN_PROPOSAL_SUMMARY_MAX) {
    throw new Error(
      `proposePlan: summary length ${input.summary.length} exceeds max ${PLAN_PROPOSAL_SUMMARY_MAX}`,
    );
  }
  if (
    typeof input.planBody !== "string" ||
    input.planBody.trim().length === 0
  ) {
    throw new Error("proposePlan: planBody must be non-empty");
  }
  if (
    !Number.isFinite(input.estimatedCostUsd) ||
    input.estimatedCostUsd <= 0
  ) {
    throw new Error(
      `proposePlan: estimatedCostUsd=${input.estimatedCostUsd} must be > 0`,
    );
  }
  if (
    !Number.isFinite(input.estimatedDurationMinutes) ||
    input.estimatedDurationMinutes <= 0 ||
    !Number.isInteger(input.estimatedDurationMinutes)
  ) {
    throw new Error(
      `proposePlan: estimatedDurationMinutes=${input.estimatedDurationMinutes} must be a positive integer`,
    );
  }

  const [inserted] = await db
    .insert(planProposals)
    .values({
      agentRole: input.agentRole,
      triggeringDispatchId: input.triggeringDispatchId ?? null,
      summary: input.summary,
      planBody: input.planBody,
      estimatedCostUsd: input.estimatedCostUsd.toFixed(4),
      estimatedDurationMinutes: input.estimatedDurationMinutes,
      riskAssessment: input.riskAssessment ?? null,
      status: "proposed",
    })
    .returning({ id: planProposals.id });

  if (!inserted) {
    throw new Error("proposePlan: insert returned no id");
  }

  logger.info(
    `[planProposals] proposed id=${inserted.id} role=${input.agentRole} estCost=$${input.estimatedCostUsd} estMin=${input.estimatedDurationMinutes}`,
  );

  return { proposalId: inserted.id };
}

// ----------------------------------------------------------------------------
// listPendingPlans
// ----------------------------------------------------------------------------

export async function listPendingPlans(opts?: {
  agentRole?: SoleneDispatchAgentRole;
  limit?: number;
}): Promise<PlanProposalRow[]> {
  const limit = Math.min(Math.max(1, Math.floor(opts?.limit ?? 50)), 200);

  const where = opts?.agentRole
    ? and(
        eq(planProposals.status, "proposed"),
        eq(planProposals.agentRole, opts.agentRole),
      )
    : eq(planProposals.status, "proposed");

  return db
    .select()
    .from(planProposals)
    .where(where)
    .orderBy(desc(planProposals.proposedAt))
    .limit(limit);
}

// ----------------------------------------------------------------------------
// approvePlan
// ----------------------------------------------------------------------------

export interface ApprovePlanEnqueueOptions {
  sourceType: SoleneDispatchSourceType;
  sourceId: string;
  promptText: string;
  maxCostUsd?: number;
  timeoutMs?: number;
  priority?: number;
}

export interface ApprovePlanOpts {
  decidedBy: "solene" | "tom" | "auto-policy";
  decisionRationale?: string;
  enqueueOptions?: ApprovePlanEnqueueOptions;
}

export async function approvePlan(
  proposalId: number,
  opts: ApprovePlanOpts,
): Promise<{ executedDispatchId?: number }> {
  const existing = await getProposal(proposalId);
  if (!existing) {
    throw new Error(`approvePlan: proposal id=${proposalId} not found`);
  }
  if (existing.status !== "proposed") {
    throw new Error(
      `approvePlan: proposal id=${proposalId} is status=${existing.status}; only 'proposed' can be approved`,
    );
  }

  const now = new Date();

  // If no enqueueOptions: just record the approval. Execution is deferred.
  if (!opts.enqueueOptions) {
    await db
      .update(planProposals)
      .set({
        status: "approved",
        decidedAt: now,
        decidedBy: opts.decidedBy,
        decisionRationale: opts.decisionRationale ?? null,
      })
      .where(eq(planProposals.id, proposalId));

    logger.info(
      `[planProposals] approved id=${proposalId} by=${opts.decidedBy} (execution deferred)`,
    );
    return {};
  }

  // Record approval FIRST so that even if enqueue throws, we keep the
  // decision durable + the caller can retry without re-approving.
  await db
    .update(planProposals)
    .set({
      status: "approved",
      decidedAt: now,
      decidedBy: opts.decidedBy,
      decisionRationale: opts.decisionRationale ?? null,
    })
    .where(eq(planProposals.id, proposalId));

  let executedDispatchId: number | undefined;
  try {
    executedDispatchId = await enqueueDispatch({
      sourceType: opts.enqueueOptions.sourceType,
      sourceId: opts.enqueueOptions.sourceId,
      agentRole: existing.agentRole as SoleneDispatchAgentRole,
      promptText: opts.enqueueOptions.promptText,
      maxCostUsd: opts.enqueueOptions.maxCostUsd,
      timeoutMs: opts.enqueueOptions.timeoutMs,
      priority: opts.enqueueOptions.priority,
      enqueuedBy: `plan-proposal:${proposalId}`,
    });
  } catch (err) {
    logger.warn(
      `[planProposals] approved id=${proposalId} but enqueueDispatch failed: ${
        err instanceof Error ? err.message : String(err)
      } — proposal remains at 'approved' for retry`,
    );
    return {};
  }

  // Enqueue succeeded → mark executed + link forward.
  await db
    .update(planProposals)
    .set({
      status: "executed",
      executedDispatchId,
    })
    .where(eq(planProposals.id, proposalId));

  logger.info(
    `[planProposals] executed id=${proposalId} → dispatch id=${executedDispatchId}`,
  );

  return { executedDispatchId };
}

// ----------------------------------------------------------------------------
// rejectPlan
// ----------------------------------------------------------------------------

export interface RejectPlanOpts {
  decidedBy: "solene" | "tom" | "auto-policy";
  decisionRationale: string;
}

export async function rejectPlan(
  proposalId: number,
  opts: RejectPlanOpts,
): Promise<void> {
  if (
    typeof opts.decisionRationale !== "string" ||
    opts.decisionRationale.trim().length === 0
  ) {
    throw new Error("rejectPlan: decisionRationale required");
  }
  const existing = await getProposal(proposalId);
  if (!existing) {
    throw new Error(`rejectPlan: proposal id=${proposalId} not found`);
  }
  if (existing.status !== "proposed") {
    throw new Error(
      `rejectPlan: proposal id=${proposalId} is status=${existing.status}; only 'proposed' can be rejected`,
    );
  }

  const now = new Date();
  await db
    .update(planProposals)
    .set({
      status: "rejected",
      decidedAt: now,
      decidedBy: opts.decidedBy,
      decisionRationale: opts.decisionRationale,
    })
    .where(eq(planProposals.id, proposalId));

  logger.info(
    `[planProposals] rejected id=${proposalId} by=${opts.decidedBy}`,
  );
}

// ----------------------------------------------------------------------------
// getProposal
// ----------------------------------------------------------------------------

export async function getProposal(
  proposalId: number,
): Promise<PlanProposalRow | null> {
  const [row] = await db
    .select()
    .from(planProposals)
    .where(eq(planProposals.id, proposalId))
    .limit(1);
  return row ?? null;
}
