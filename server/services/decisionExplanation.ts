/**
 * Decision Explanation — Lens 46 trust-loop legibility.
 *
 * Joins the four tables that together describe WHY an autonomous action
 * happened, into a single shape the founder UI (DecisionsInbox expandable,
 * audit-log/explain endpoint) and customer UI (PaxWhyExplainer) can render.
 *
 *   agent_action_log         — what the agent did + its reasoning
 *   agent_llm_traces         — exact prompt + response the model returned
 *   decisions_inbox_items    — the inbox row that requested the action
 *   pax_observations         — the upstream signal that triggered the chain
 *
 * The "explain" verb is deliberate: this is not the audit log itself
 * (which is append-only and tamper-evident). It's a derived read view.
 * If any underlying row is missing (deleted observation, expired trace),
 * we return what we have rather than throwing. The whole point of
 * legibility is degrading gracefully, not failing closed.
 */

import { db } from "../db";
import {
  agentActionLog,
  agentLlmTraces,
  decisionsInboxItems,
  paxObservations,
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { logger } from "../utils/logger";

export interface DecisionExplanation {
  // What did the agent do?
  action: {
    id: number;
    agentCodename: string;
    actionName: string;
    actionType: string;
    outcome: string;
    reasoning: string | null;
    confidence: number | null;
    durationMs: number | null;
    createdAt: Date | null;
  };
  // What inputs did the agent see?
  inputs: Record<string, unknown> | null;
  // What did the agent produce?
  output: Record<string, unknown> | null;
  // What alternatives did the model weigh?
  alternativesConsidered: Array<{
    action: string;
    rejectedBecause: string;
    confidence?: number;
  }> | null;
  // Which model tiers were tried — captures the cascade trail.
  tiersTried: Array<"haiku" | "sonnet" | "opus"> | null;
  modelUsed: string | null;
  // The exact LLM prompt + response, if a trace exists for this action.
  llmTrace: {
    id: number;
    purpose: string;
    model: string;
    systemPrompt: string | null;
    userPrompt: string;
    response: string;
    latencyMs: number | null;
    inputTokens: number | null;
    outputTokens: number | null;
    costCents: number | null;
    error: string | null;
  } | null;
  // The decisions-inbox row that requested this action (if any).
  inboxItem: {
    id: number;
    itemType: string;
    sophieAnalysis: string;
    sophieConfidenceScore: number | null;
    recommendedAction: string;
    urgencyScore: number;
    riskLevel: string;
    estimatedImpactCents: number | null;
  } | null;
  // The upstream observation that triggered the chain (if any).
  triggerObservation: {
    id: number;
    type: string;
    title: string;
    description: string;
    severity: string;
    detectedAt: Date | null;
  } | null;
  // Failure-mode legibility — if the action failed, surface enough to
  // debug without re-running. Verification evidence if present.
  failureMode: {
    outcome: "success" | "failure" | "escalated" | "pending";
    error: string | null;
  };
  // Reversal path — does this action have a registered undo?
  reversal: {
    available: boolean;
    note: string;
  };
}

/**
 * Resolve a full explanation for an action_log id.
 *
 * Lookup order:
 *   1. Load the action_log row (system of record).
 *   2. Join the related decisions_inbox row via relatedDecisionId.
 *   3. Join the LLM trace via traces.decisionId or recent traces for the
 *      same agent (best-effort — older code paths logged traces without
 *      the decisionId fk).
 *   4. Join the upstream observation via triggeredByObservationId.
 */
export async function explainAction(
  actionLogId: number,
): Promise<DecisionExplanation | null> {
  const [action] = await db
    .select()
    .from(agentActionLog)
    .where(eq(agentActionLog.id, actionLogId))
    .limit(1);

  if (!action) return null;

  let inboxItem: DecisionExplanation["inboxItem"] = null;
  if (action.relatedDecisionId) {
    try {
      const [row] = await db
        .select({
          id: decisionsInboxItems.id,
          itemType: decisionsInboxItems.itemType,
          sophieAnalysis: decisionsInboxItems.sophieAnalysis,
          sophieConfidenceScore: decisionsInboxItems.sophieConfidenceScore,
          recommendedAction: decisionsInboxItems.recommendedAction,
          urgencyScore: decisionsInboxItems.urgencyScore,
          riskLevel: decisionsInboxItems.riskLevel,
          estimatedImpactCents: decisionsInboxItems.estimatedImpactCents,
        })
        .from(decisionsInboxItems)
        .where(eq(decisionsInboxItems.id, action.relatedDecisionId))
        .limit(1);
      inboxItem = row ?? null;
    } catch (err) {
      logger.warn("[explain] inbox join failed", {
        metadata: { actionLogId, err: String(err) },
      });
    }
  }

  let llmTrace: DecisionExplanation["llmTrace"] = null;
  try {
    // Prefer the decision-linked trace; fall back to a recent trace from the
    // same agent within a small window of the action timestamp.
    if (action.relatedDecisionId) {
      const [row] = await db
        .select()
        .from(agentLlmTraces)
        .where(eq(agentLlmTraces.decisionId, action.relatedDecisionId))
        .orderBy(desc(agentLlmTraces.createdAt))
        .limit(1);
      if (row) {
        llmTrace = {
          id: row.id,
          purpose: row.purpose,
          model: row.model,
          systemPrompt: row.systemPrompt,
          userPrompt: row.userPrompt,
          response: row.response,
          latencyMs: row.latencyMs,
          inputTokens: row.inputTokens,
          outputTokens: row.outputTokens,
          costCents: row.costCents,
          error: row.error,
        };
      }
    }
  } catch (err) {
    logger.warn("[explain] llm_trace join failed", {
      metadata: { actionLogId, err: String(err) },
    });
  }

  let triggerObservation: DecisionExplanation["triggerObservation"] = null;
  if (action.triggeredByObservationId) {
    try {
      const [row] = await db
        .select({
          id: paxObservations.id,
          type: paxObservations.type,
          title: paxObservations.title,
          description: paxObservations.description,
          severity: paxObservations.severity,
          detectedAt: paxObservations.detectedAt,
        })
        .from(paxObservations)
        .where(eq(paxObservations.id, action.triggeredByObservationId))
        .limit(1);
      triggerObservation = row ?? null;
    } catch (err) {
      logger.warn("[explain] observation join failed", {
        metadata: { actionLogId, err: String(err) },
      });
    }
  }

  // Reversal path heuristic — undoRegistry registers undos by action_log id.
  // We avoid importing the registry directly to keep this service free of
  // side-effect deps; instead we read the agent_action_undo_log if present.
  let reversal: DecisionExplanation["reversal"] = {
    available: false,
    note: "No undo registered for this action class. Forward-only.",
  };
  try {
    const undoMod = await import("./undoRegistry");
    const undoFn = (undoMod as any).isUndoAvailable;
    if (typeof undoFn === "function") {
      const available = await undoFn(actionLogId);
      reversal = {
        available: Boolean(available),
        note: available
          ? "Undo available via POST /api/founder/intelligence/undo/:actionLogId."
          : "No undo registered. Reversal requires a manual fix.",
      };
    }
  } catch {
    // undoRegistry shape varies — keep the default note.
  }

  return {
    action: {
      id: action.id,
      agentCodename: action.agentCodename,
      actionName: action.actionName,
      actionType: action.actionType,
      outcome: action.outcome,
      reasoning: action.reasoning,
      confidence: action.confidence,
      durationMs: action.durationMs,
      createdAt: action.createdAt,
    },
    inputs: (action.input as Record<string, unknown>) ?? null,
    output: (action.output as Record<string, unknown>) ?? null,
    alternativesConsidered:
      (action.alternativesConsidered as DecisionExplanation["alternativesConsidered"]) ??
      null,
    tiersTried:
      (action.tiersTried as DecisionExplanation["tiersTried"]) ?? null,
    modelUsed: action.modelUsed ?? null,
    llmTrace,
    inboxItem,
    triggerObservation,
    failureMode: {
      outcome: action.outcome as DecisionExplanation["failureMode"]["outcome"],
      error:
        action.outcome === "failure" && action.output
          ? String((action.output as any).detail ?? (action.output as any).error ?? "")
          : null,
    },
    reversal,
  };
}

/**
 * Customer-facing flavour: explain a Pax observation in the same shape.
 * Customers can't see the founder-only action_log, so we trim the response
 * to fields suitable for an end-user surface.
 */
export interface PaxObservationExplanation {
  observation: {
    id: number;
    title: string;
    description: string;
    severity: string;
    detectedAt: Date | null;
  };
  reasoning: string | null;
  inputs: Record<string, unknown> | null;
  alternativesConsidered: Array<{
    action: string;
    rejectedBecause: string;
  }> | null;
  modelUsed: string | null;
  // Confidence is integer 0-100 on observations.
  confidenceScore: number;
  // What did Pax do (or recommend) as a result?
  suggestedAction: string | null;
}

export async function explainPaxObservation(
  observationId: number,
  organizationId: number,
): Promise<PaxObservationExplanation | null> {
  const [obs] = await db
    .select()
    .from(paxObservations)
    .where(
      and(
        eq(paxObservations.id, observationId),
        eq(paxObservations.organizationId, organizationId),
      ),
    )
    .limit(1);

  if (!obs) return null;

  return {
    observation: {
      id: obs.id,
      title: obs.title,
      description: obs.description,
      severity: obs.severity,
      detectedAt: obs.detectedAt,
    },
    reasoning: obs.reasoning ?? null,
    inputs: (obs.inputs as Record<string, unknown>) ?? null,
    alternativesConsidered:
      (obs.alternativesConsidered as PaxObservationExplanation["alternativesConsidered"]) ??
      null,
    modelUsed: obs.modelUsed ?? null,
    confidenceScore: obs.confidenceScore,
    suggestedAction:
      (obs.metadata as any)?.suggestedAction ?? null,
  };
}
