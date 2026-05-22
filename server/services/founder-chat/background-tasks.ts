/**
 * Background tasks for Atlas.
 *
 * Long-running tools (audits, deep analyses, weekly letter gen) return
 * a background_task_card immediately and run async via the existing
 * outbox pattern. When the worker finishes, it posts the result
 * artifact back to the thread as a new chat message.
 *
 * parentTaskId allows nesting: an Atlas turn can spawn an explore
 * sub-agent that itself produces sub-tasks. The thread sees the tree.
 */

import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { founderChatBackgroundTasks } from "@shared/schema";

export type BackgroundTaskStatus = "queued" | "running" | "complete" | "failed";

export interface StartBackgroundTaskOpts {
  threadId: number;
  founderUserId: string;
  label: string;
  runnerKey: string;
  payload: Record<string, unknown>;
  estimatedSeconds?: number;
  parentTaskId?: string | null;
}

function makeTaskId(): string {
  return randomBytes(16).toString("hex");
}

export async function startBackgroundTask(opts: StartBackgroundTaskOpts): Promise<{ taskId: string }> {
  const id = makeTaskId();
  await db.insert(founderChatBackgroundTasks).values({
    id,
    threadId: opts.threadId,
    founderUserId: opts.founderUserId,
    label: opts.label,
    runnerKey: opts.runnerKey,
    payload: opts.payload as any,
    status: "queued",
    estimatedSeconds: opts.estimatedSeconds ?? null,
    parentTaskId: opts.parentTaskId ?? null,
  } as any);

  // Worker dispatch: the existing outbox-poller picks up by status='queued'
  // and runnerKey. Phase E adds the actual runner handlers (idor_audit,
  // provider_savings_analysis, weekly_letter_generation, etc.).
  // For now Phase A just records — Phase B's first call site is the
  // primary integration point.
  return { taskId: id };
}

export async function getBackgroundTaskStatus(taskId: string): Promise<{
  status: BackgroundTaskStatus;
  resultArtifact?: unknown;
  error?: string;
  label?: string;
  estimatedSeconds?: number;
} | null> {
  const [row] = await db
    .select()
    .from(founderChatBackgroundTasks)
    .where(eq(founderChatBackgroundTasks.id, taskId));
  if (!row) return null;
  return {
    status: row.status as BackgroundTaskStatus,
    resultArtifact: (row.resultArtifact as unknown) ?? undefined,
    error: row.error ?? undefined,
    label: row.label,
    estimatedSeconds: row.estimatedSeconds ?? undefined,
  };
}

export async function markBackgroundTaskRunning(taskId: string): Promise<void> {
  await db
    .update(founderChatBackgroundTasks)
    .set({ status: "running", startedAt: new Date() as any })
    .where(eq(founderChatBackgroundTasks.id, taskId));
}

export async function completeBackgroundTask(
  taskId: string,
  resultArtifact: unknown,
): Promise<void> {
  await db
    .update(founderChatBackgroundTasks)
    .set({
      status: "complete",
      resultArtifact: resultArtifact as any,
      completedAt: new Date() as any,
    })
    .where(eq(founderChatBackgroundTasks.id, taskId));
}

export async function failBackgroundTask(taskId: string, error: string): Promise<void> {
  await db
    .update(founderChatBackgroundTasks)
    .set({
      status: "failed",
      error,
      completedAt: new Date() as any,
    })
    .where(eq(founderChatBackgroundTasks.id, taskId));
}
