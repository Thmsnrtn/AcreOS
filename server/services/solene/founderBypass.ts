/**
 * SOLENE — L6.31 founder-mode bypass.
 *
 * Tom's direct-dispatch surface. Bypasses two normal guardrails:
 *
 *   1. The $100 per-dispatch cost ceiling — founderOverride=true lifts it
 *      when the requested maxCostUsd exceeds DISPATCH_MAX_COST_USD.
 *   2. The plan-proposal staging — founder invocations skip the propose/
 *      approve dance entirely; they enqueue straight to the worker.
 *
 * Default priority is 3.0 (auto-dispatch is 1.0, code-review is ~2.0), so
 * founder work jumps the queue ahead of all automated dispatches.
 *
 * Every invocation logs a structured audit entry (who, what, when, cost
 * cap, reason) at logger.info — that's what the activity feed consumes.
 *
 * HONEST CONSTRAINTS:
 *  - bypassedCostCeiling is computed against the canonical
 *    DISPATCH_MAX_COST_USD constant; it's not stored on the row.
 *  - bypassedPlanProposalStage is always true for this surface — the
 *    bypass IS the point. Returning it explicitly is for audit clarity.
 *  - founderCancelDispatch can cancel non-queued (in_progress) dispatches
 *    via direct DB update; the worker reads the status flag every turn
 *    and exits cooperatively when it sees 'cancelled'.
 */

import { desc, eq, sql } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneDispatchQueue,
  DISPATCH_MAX_COST_USD,
  type SoleneDispatchAgentRole,
} from "@shared/schema/solene-dispatch";
import { logger } from "../../utils/logger";
import { enqueueDispatch, cancelQueuedDispatch } from "./dispatchQueue";

export interface FounderBypassInput {
  agentRole: SoleneDispatchAgentRole;
  promptText: string;
  /** Founder-set cost cap — can exceed the normal $100 ceiling via founderOverride. */
  maxCostUsd: number;
  timeoutMs?: number;
  /** Default 3.0 — founder invocations jump the queue. */
  priority?: number;
  /** Founder's stated reason; useful for audit. */
  reason?: string;
}

export interface FounderBypassResult {
  dispatchId: number;
  bypassedCostCeiling: boolean;
  bypassedPlanProposalStage: boolean;
  recordedAt: Date;
}

export interface FounderInvocationSummary {
  dispatchId: number;
  agentRole: SoleneDispatchAgentRole;
  /** First 200 chars of the original prompt. */
  promptPreview: string;
  maxCostUsd: number;
  priority: number;
  reason: string | null;
  status: string;
  enqueuedAt: Date;
}

const FOUNDER_DEFAULT_PRIORITY = 3.0;
const PROMPT_PREVIEW_LIMIT = 200;

// ----------------------------------------------------------------------------
// founderDispatch
// ----------------------------------------------------------------------------

/**
 * Founder direct-dispatch with full authority. Enqueues via the canonical
 * dispatchQueue with sourceType='founder_bypass'. Priority defaults to 3.0
 * (ahead of auto-dispatch + code-review). founderOverride=true lifts the
 * $100 ceiling whenever maxCostUsd > DISPATCH_MAX_COST_USD.
 *
 * The bypass surfaces structured audit info for the activity feed:
 *   - bypassedCostCeiling: true when maxCostUsd > $100
 *   - bypassedPlanProposalStage: always true (the bypass IS the point)
 */
export async function founderDispatch(
  input: FounderBypassInput,
): Promise<FounderBypassResult> {
  if (!Number.isFinite(input.maxCostUsd) || input.maxCostUsd <= 0) {
    throw new Error(
      `founderDispatch: invalid maxCostUsd=${input.maxCostUsd} (must be > 0)`,
    );
  }
  if (!input.promptText || input.promptText.trim().length === 0) {
    throw new Error("founderDispatch: promptText must be non-empty");
  }

  const priority = input.priority ?? FOUNDER_DEFAULT_PRIORITY;
  const bypassedCostCeiling = input.maxCostUsd > DISPATCH_MAX_COST_USD;
  const ts = Date.now();
  const sourceId = `founder:${ts}`;

  const dispatchId = await enqueueDispatch({
    sourceType: "founder_bypass",
    sourceId,
    agentRole: input.agentRole,
    promptText: input.promptText,
    maxCostUsd: input.maxCostUsd,
    timeoutMs: input.timeoutMs,
    priority,
    enqueuedBy: "founder",
    founderOverride: bypassedCostCeiling,
  });

  const recordedAt = new Date();

  // Structured audit log — consumed by the founder activity feed. Always
  // info-level because founder actions are first-class operational signal.
  logger.info("[founderBypass] dispatch enqueued", {
    dispatchId,
    agentRole: input.agentRole,
    maxCostUsd: input.maxCostUsd,
    priority,
    bypassedCostCeiling,
    bypassedPlanProposalStage: true,
    reason: input.reason ?? null,
    promptPreview: input.promptText.slice(0, PROMPT_PREVIEW_LIMIT),
    recordedAt: recordedAt.toISOString(),
  });

  return {
    dispatchId,
    bypassedCostCeiling,
    bypassedPlanProposalStage: true,
    recordedAt,
  };
}

// ----------------------------------------------------------------------------
// founderCancelDispatch
// ----------------------------------------------------------------------------

/**
 * Cancel any in-flight dispatch via founder authority, regardless of its
 * current status. For queued rows we delegate to cancelQueuedDispatch
 * (which performs the prior-status check + writes the cancellation
 * summary). For in_progress rows the worker checks the status flag every
 * turn and exits cooperatively — we update the row directly.
 *
 * Terminal-state dispatches (completed/failed/cancelled) are a no-op:
 * cancelling something already done would be confusing in the audit log.
 */
export async function founderCancelDispatch(
  dispatchId: number,
  reason: string,
): Promise<void> {
  const [existing] = await db
    .select({
      id: soleneDispatchQueue.id,
      status: soleneDispatchQueue.status,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.id, dispatchId))
    .limit(1);

  if (!existing) {
    throw new Error(
      `founderCancelDispatch: no dispatch with id=${dispatchId}`,
    );
  }

  if (
    existing.status === "completed" ||
    existing.status === "failed" ||
    existing.status === "cancelled"
  ) {
    logger.info("[founderBypass] cancel skipped (terminal state)", {
      dispatchId,
      priorStatus: existing.status,
      reason,
    });
    return;
  }

  const summary = reason && reason.trim().length > 0
    ? `cancelled by founder: ${reason}`.slice(0, 4000)
    : "cancelled by founder";

  if (existing.status === "queued") {
    // Delegate to the existing helper for queued rows — keeps the audit
    // shape consistent with non-founder cancellations.
    await cancelQueuedDispatch(dispatchId, reason);
  } else {
    // in_progress: direct update. The worker reads the status flag every
    // turn and exits cooperatively when it sees 'cancelled'. We set
    // completed_at + summary now so the founder UI can show the
    // cancellation immediately even though the worker may not have
    // observed it yet.
    await db
      .update(soleneDispatchQueue)
      .set({
        status: "cancelled",
        completedAt: new Date(),
        resultSummary: summary,
      })
      .where(eq(soleneDispatchQueue.id, dispatchId));
  }

  logger.info("[founderBypass] dispatch cancelled", {
    dispatchId,
    priorStatus: existing.status,
    reason: reason ?? null,
  });
}

// ----------------------------------------------------------------------------
// listFounderInvocations
// ----------------------------------------------------------------------------

/**
 * Read recent founder-bypass invocations. The activity feed reads from this
 * surface to render Tom's recent direct-dispatches. Filters strictly on
 * enqueued_by='founder' (the canonical marker) — sourceType is secondary
 * because we may add other founder-issued source types later.
 *
 * Default limit 20; capped at 100 to keep response size bounded.
 */
export async function listFounderInvocations(
  limit: number = 20,
): Promise<FounderInvocationSummary[]> {
  const safeLimit = Math.min(Math.max(1, Math.floor(limit)), 100);

  const rows = await db
    .select({
      id: soleneDispatchQueue.id,
      agentRole: soleneDispatchQueue.agentRole,
      promptText: soleneDispatchQueue.promptText,
      maxCostUsd: soleneDispatchQueue.maxCostUsd,
      priority: soleneDispatchQueue.priority,
      status: soleneDispatchQueue.status,
      queuedAt: soleneDispatchQueue.queuedAt,
      resultSummary: soleneDispatchQueue.resultSummary,
    })
    .from(soleneDispatchQueue)
    .where(eq(soleneDispatchQueue.enqueuedBy, "founder"))
    .orderBy(desc(soleneDispatchQueue.queuedAt))
    .limit(safeLimit);

  return rows.map((r) => ({
    dispatchId: r.id,
    agentRole: r.agentRole as SoleneDispatchAgentRole,
    promptPreview: r.promptText.slice(0, PROMPT_PREVIEW_LIMIT),
    maxCostUsd: Number(r.maxCostUsd),
    priority: Number(r.priority),
    // The DB doesn't have a dedicated 'reason' column; founder reasons are
    // captured in the audit log + resultSummary. We surface null here and
    // let the UI fall back to the audit feed for reason text.
    reason: null,
    status: r.status,
    enqueuedAt: r.queuedAt,
  }));
}
