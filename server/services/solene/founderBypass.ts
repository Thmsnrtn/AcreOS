/**
 * SOLENE — L6.31 founder-mode bypass.
 *
 * Tom's direct-dispatch surface. Bypasses two normal guardrails:
 *
 *   1. The per-dispatch cost ceiling (DISPATCH_MAX_COST_USD, currently $25) —
 *      founderOverride=true lifts it when the requested maxCostUsd exceeds it.
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
import {
  solenePreCallDecisions,
  PRECALL_PROMPT_SUMMARY_MAX_CHARS,
} from "@shared/schema/solene-pre-call-decisions";
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
// recordFounderBypassMarker
// ----------------------------------------------------------------------------

/**
 * Write the canonical founder-bypass accountability row.
 *
 * Every founderDispatch IS a sovereign bypass by construction (it enqueues
 * with sourceType="founder_bypass" / enqueued_by="founder" and skips the
 * propose/approve stage). The public /transparency `founderBypassCount` and
 * the founder-bypass alignment detector both key on this row's
 * `is_founder_bypass = true` boolean — replacing the dead reasoning-regex that
 * NOTHING ever wrote, which kept the published count permanently 0.
 *
 * HONESTY: this row is written ONLY here, on a real founder bypass, so the
 * published number is true — never inflated. Fire-and-forget: a marker-write
 * failure must never crash the founder's dispatch. We log loudly so a gap is
 * still observable out-of-band, matching the auditLog posture.
 */
async function recordFounderBypassMarker(opts: {
  dispatchId: number;
  agentRole: string;
  reason: string | null;
  promptText: string;
}): Promise<void> {
  try {
    await db.insert(solenePreCallDecisions).values({
      dispatchId: opts.dispatchId,
      agentRole: opts.agentRole,
      // Credential discipline: never store the full prompt — truncate to the
      // same window the pre-call checker uses.
      promptSummary: opts.promptText.slice(0, PRECALL_PROMPT_SUMMARY_MAX_CHARS),
      // A founder bypass deliberately skips the upstream constitutional screen;
      // the row records that the dispatch was ALLOWED via sovereign authority,
      // not screened. The bypass IS the point.
      allowed: true,
      immutableNumber: null,
      immutableText: null,
      reasoning: "founder bypass: sovereign dispatch (constitutional pre-call screen skipped)",
      modelUsed: "n/a (founder bypass)",
      latencyMs: 0,
      costUsd: "0.000000",
      violationEventId: null,
      isFounderBypass: true,
      founderBypassReason: opts.reason,
    });
  } catch (err) {
    logger.error(
      "[founderBypass] failed to record bypass accountability marker",
      err instanceof Error ? err : undefined,
      { metadata: { dispatchId: opts.dispatchId } },
    );
  }
}

// ----------------------------------------------------------------------------
// founderDispatch
// ----------------------------------------------------------------------------

/**
 * Founder direct-dispatch with full authority. Enqueues via the canonical
 * dispatchQueue with sourceType='founder_bypass'. Priority defaults to 3.0
 * (ahead of auto-dispatch + code-review). founderOverride=true lifts the
 * cost ceiling whenever maxCostUsd > DISPATCH_MAX_COST_USD (currently $25).
 *
 * The bypass surfaces structured audit info for the activity feed:
 *   - bypassedCostCeiling: true when maxCostUsd > DISPATCH_MAX_COST_USD
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

  // Honesty surface: record the canonical founder-bypass accountability marker.
  // This row's is_founder_bypass=true is the SINGLE source of truth the public
  // /transparency founderBypassCount + the founder-bypass alignment detector
  // count. Fire-and-forget — never blocks or crashes the founder's dispatch.
  await recordFounderBypassMarker({
    dispatchId,
    agentRole: input.agentRole,
    reason: input.reason ?? null,
    promptText: input.promptText,
  });

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
