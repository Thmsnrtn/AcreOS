/**
 * Action Preview — the supervise-in-real-time layer.
 *
 * Until now, the founder reviewed actions AFTER they happened, via
 * the decision log. This service adds a before-commit checkpoint:
 * every auto-approved action writes a preview row, and the executor
 * waits ACTION_PREVIEW_WINDOW_SECONDS (tunable from /founder/settings)
 * before actually committing. During the window, the founder can
 * cancel the action from /founder/preview.
 *
 * Default window is 0s — audit-only. Preview rows still get written
 * so the founder has a permanent record of what was autonomously
 * decided and why, independent of the decision inbox itself. Raise
 * the window to 10-60s when the founder wants to actively supervise
 * (e.g. during a release, or when testing a new scenario pattern).
 *
 * Safety properties:
 *   - Commit is contingent on `status` still being 'pending' at the
 *     commit time. If the founder sets status='cancelled' inside the
 *     window, the executor short-circuits and skips the action.
 *   - Expired previews (status still 'pending' after commitAt + 1h)
 *     are a system bug — the executor crashed mid-wait. A sweeper
 *     runs hourly to mark them as 'failed' so they don't accumulate.
 *   - The preview row is the single source of truth for "did this
 *     happen?" — executed actions always end in 'committed' status
 *     with executionResult set.
 */

import { db } from "../db";
import { actionPreviews } from "@shared/schema";
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { logger } from "../utils/logger";
import { getNumberSetting } from "./founderSettings";
import { clock } from "../utils/clock";

export interface PreviewInput {
  decisionId: number;
  agentCodename: string;
  itemType: string;
  actionSummary: string;
  actionReasoning?: string;
  actionPayload?: Record<string, any> | null;
  estimatedImpactCents?: number | null;
  confidence?: number | null;
}

export interface PreviewCheckpoint {
  previewId: number;
  commitAt: Date;
  shouldProceed: () => Promise<boolean>;
  recordResult: (status: "committed" | "failed", executionResult?: string) => Promise<void>;
}

/**
 * Open a preview for an about-to-execute action. Returns a checkpoint
 * object the executor awaits. If the preview window is > 0, this
 * function blocks until commitAt, checking for cancellation along
 * the way.
 */
export async function beginActionPreview(
  input: PreviewInput,
): Promise<PreviewCheckpoint> {
  const windowSeconds = await getNumberSetting("ACTION_PREVIEW_WINDOW_SECONDS", 0);
  const commitAt = new Date(clock.nowMs() + windowSeconds * 1000);

  const [row] = await db
    .insert(actionPreviews)
    .values({
      decisionId: input.decisionId,
      agentCodename: input.agentCodename,
      itemType: input.itemType,
      actionSummary: input.actionSummary.slice(0, 500),
      actionReasoning: input.actionReasoning?.slice(0, 2000) ?? null,
      actionPayload: input.actionPayload ?? null,
      estimatedImpactCents: input.estimatedImpactCents ?? null,
      confidence: input.confidence ?? null,
      commitAt,
      status: "pending",
    })
    .returning({ id: actionPreviews.id });

  const previewId = row?.id ?? 0;

  // If there's a window, poll every 500ms for cancellation.
  if (windowSeconds > 0) {
    const deadline = commitAt.getTime();
    while (clock.nowMs() < deadline) {
      await sleep(Math.min(500, deadline - clock.nowMs()));
      const current = await getPreviewStatus(previewId);
      if (current === "cancelled") break;
    }
  }

  // CLAIM, not read (DEFECT-0134). Reading 'pending' and then executing left
  // a gap in which the founder's cancel succeeded — the UI said "cancelled
  // before it committed" — and the action ran anyway. The executor now moves
  // the row pending → executing in one statement; a cancel after that finds
  // no pending row and is refused, and a cancel before it wins the claim.
  const shouldProceed = async (): Promise<boolean> => {
    const claimed = await db
      .update(actionPreviews)
      .set({ status: "executing" })
      .where(and(eq(actionPreviews.id, previewId), eq(actionPreviews.status, "pending")))
      .returning({ id: actionPreviews.id });
    return claimed.length > 0;
  };

  // Only the claimed (executing) row takes a result, so a cancelled row
  // stays cancelled and is never overwritten as "failed" or "committed".
  const recordResult = async (
    status: "committed" | "failed",
    executionResult?: string,
  ): Promise<void> => {
    await db
      .update(actionPreviews)
      .set({
        status,
        committedAt: status === "committed" ? clock.now() : null,
        executionResult: executionResult?.slice(0, 500) ?? null,
      })
      .where(and(eq(actionPreviews.id, previewId), eq(actionPreviews.status, "executing")));
  };

  return { previewId, commitAt, shouldProceed, recordResult };
}

async function getPreviewStatus(id: number): Promise<string> {
  const [row] = await db
    .select({ status: actionPreviews.status })
    .from(actionPreviews)
    .where(eq(actionPreviews.id, id))
    .limit(1);
  return row?.status ?? "pending";
}

function sleep(ms: number) {
  return new Promise<void>((res) => setTimeout(res, Math.max(0, ms)));
}

// ── Founder-facing queries ──────────────────────────────────────────

export async function listPendingPreviews(limit: number = 20) {
  return db
    .select()
    .from(actionPreviews)
    .where(eq(actionPreviews.status, "pending"))
    .orderBy(actionPreviews.commitAt)
    .limit(limit);
}

export async function listRecentPreviews(hoursBack: number = 48, limit: number = 50) {
  const since = new Date(clock.nowMs() - hoursBack * 60 * 60 * 1000);
  return db
    .select()
    .from(actionPreviews)
    .where(gte(actionPreviews.plannedAt, since))
    .orderBy(sql`${actionPreviews.plannedAt} DESC`)
    .limit(limit);
}

/** True only when a still-pending preview was cancelled by this call. */
export async function cancelPreview(id: number, cancelledBy: string, reason?: string): Promise<boolean> {
  const cancelled = await db
    .update(actionPreviews)
    .set({
      status: "cancelled",
      cancelledAt: clock.now(),
      cancelledBy,
      cancelReason: reason?.slice(0, 500) ?? null,
    })
    .where(and(eq(actionPreviews.id, id), eq(actionPreviews.status, "pending")))
    .returning({ id: actionPreviews.id });
  return cancelled.length > 0;
}

/**
 * Sweep orphaned previews — if something was 'pending' past its
 * commit time + 1 hour, the executor crashed mid-wait and the row
 * is stuck. Mark it 'failed' so the founder UI doesn't misleadingly
 * show a pending action.
 */
export async function sweepOrphanedPreviews(): Promise<{ swept: number }> {
  const cutoff = new Date(clock.nowMs() - 60 * 60 * 1000);
  const updated = await db
    .update(actionPreviews)
    .set({ status: "failed", executionResult: "orphaned: executor did not commit" })
    .where(
      and(
        eq(actionPreviews.status, "pending"),
        lt(actionPreviews.commitAt, cutoff),
      ),
    )
    .returning({ id: actionPreviews.id });
  if (updated.length > 0) {
    logger.warn(`[actionPreview] swept ${updated.length} orphaned previews`);
  }
  return { swept: updated.length };
}
