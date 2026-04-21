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
  const commitAt = new Date(Date.now() + windowSeconds * 1000);

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
    while (Date.now() < deadline) {
      await sleep(Math.min(500, deadline - Date.now()));
      const current = await getPreviewStatus(previewId);
      if (current === "cancelled") break;
    }
  }

  const shouldProceed = async (): Promise<boolean> => {
    const status = await getPreviewStatus(previewId);
    return status === "pending";
  };

  const recordResult = async (
    status: "committed" | "failed",
    executionResult?: string,
  ): Promise<void> => {
    await db
      .update(actionPreviews)
      .set({
        status,
        committedAt: status === "committed" ? new Date() : null,
        executionResult: executionResult?.slice(0, 500) ?? null,
      })
      .where(eq(actionPreviews.id, previewId));
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
  const since = new Date(Date.now() - hoursBack * 60 * 60 * 1000);
  return db
    .select()
    .from(actionPreviews)
    .where(gte(actionPreviews.plannedAt, since))
    .orderBy(sql`${actionPreviews.plannedAt} DESC`)
    .limit(limit);
}

export async function cancelPreview(id: number, cancelledBy: string, reason?: string) {
  await db
    .update(actionPreviews)
    .set({
      status: "cancelled",
      cancelledAt: new Date(),
      cancelledBy,
      cancelReason: reason?.slice(0, 500) ?? null,
    })
    .where(and(eq(actionPreviews.id, id), eq(actionPreviews.status, "pending")));
}

/**
 * Sweep orphaned previews — if something was 'pending' past its
 * commit time + 1 hour, the executor crashed mid-wait and the row
 * is stuck. Mark it 'failed' so the founder UI doesn't misleadingly
 * show a pending action.
 */
export async function sweepOrphanedPreviews(): Promise<{ swept: number }> {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000);
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
