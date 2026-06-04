/**
 * SOLENE — session-task persistence (Phase 1 / shared-persistence layer).
 *
 * Replaces the in-memory TaskCreate/TaskUpdate task list with persisted
 * rows so both CLI Claude Code and AcreOS Solene chat see the same task
 * queue. blockedBy preserves the dependency graph.
 */

import { and, asc, eq } from "drizzle-orm";
import { db } from "../../db";
import {
  soleneSessionTasks,
  SESSION_TASK_STATUSES,
  type SessionTaskStatus,
  type SoleneSessionTaskRow,
} from "@shared/schema/solene-session-tasks";

// ============================================
// Types
// ============================================

export interface CreateTaskInput {
  subject: string;
  description: string;
  activeForm?: string;
  conversationId?: number;
  owner?: string;
  blockedBy?: number[];
  metadata?: Record<string, unknown>;
}

export interface CreateTaskResult {
  taskId: number;
}

export interface UpdateTaskPatch {
  status?: SessionTaskStatus;
  subject?: string;
  description?: string;
  activeForm?: string;
  owner?: string;
  blockedBy?: number[];
  metadata?: Record<string, unknown>;
}

export interface ListTasksOpts {
  conversationId?: number;
  status?: SessionTaskStatus;
  owner?: string;
}

// ============================================
// Helpers
// ============================================

function isKnownStatus(s: string): s is SessionTaskStatus {
  return (SESSION_TASK_STATUSES as readonly string[]).includes(s);
}

// ============================================
// createTask
// ============================================

export async function createTask(
  input: CreateTaskInput,
): Promise<CreateTaskResult> {
  if (!input.subject || input.subject.trim().length === 0) {
    throw new Error("createTask: subject must be non-empty");
  }
  if (!input.description || input.description.trim().length === 0) {
    throw new Error("createTask: description must be non-empty");
  }
  if (input.blockedBy !== undefined && !Array.isArray(input.blockedBy)) {
    throw new Error("createTask: blockedBy must be an int[] when provided");
  }
  if (
    input.blockedBy !== undefined &&
    input.blockedBy.some((n) => !Number.isInteger(n) || n <= 0)
  ) {
    throw new Error("createTask: blockedBy ids must be positive integers");
  }

  const [inserted] = await db
    .insert(soleneSessionTasks)
    .values({
      subject: input.subject,
      description: input.description,
      activeForm: input.activeForm ?? null,
      conversationId: input.conversationId ?? null,
      owner: input.owner ?? null,
      blockedBy: input.blockedBy ?? [],
      metadata: input.metadata ?? {},
    })
    .returning({ id: soleneSessionTasks.id });

  if (!inserted) {
    throw new Error("createTask: insert returned no id");
  }
  return { taskId: inserted.id };
}

// ============================================
// updateTask
// ============================================

export async function updateTask(
  taskId: number,
  patch: UpdateTaskPatch,
): Promise<void> {
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new Error(`updateTask: invalid taskId=${taskId}`);
  }
  if (!patch || typeof patch !== "object") {
    throw new Error("updateTask: patch must be an object");
  }
  if (patch.status !== undefined && !isKnownStatus(patch.status)) {
    throw new Error(`updateTask: invalid status=${String(patch.status)}`);
  }
  if (patch.blockedBy !== undefined) {
    if (!Array.isArray(patch.blockedBy)) {
      throw new Error("updateTask: blockedBy must be an int[] when provided");
    }
    if (patch.blockedBy.some((n) => !Number.isInteger(n) || n <= 0)) {
      throw new Error("updateTask: blockedBy ids must be positive integers");
    }
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (patch.status !== undefined) set.status = patch.status;
  if (patch.subject !== undefined) set.subject = patch.subject;
  if (patch.description !== undefined) set.description = patch.description;
  if (patch.activeForm !== undefined) set.activeForm = patch.activeForm;
  if (patch.owner !== undefined) set.owner = patch.owner;
  if (patch.blockedBy !== undefined) set.blockedBy = patch.blockedBy;
  if (patch.metadata !== undefined) set.metadata = patch.metadata;

  // If the only key is updatedAt, the patch was empty — no-op to avoid an
  // unnecessary write (and to keep updated_at honest).
  if (Object.keys(set).length === 1) return;

  await db
    .update(soleneSessionTasks)
    .set(set)
    .where(eq(soleneSessionTasks.id, taskId));
}

// ============================================
// listTasks
// ============================================

export async function listTasks(
  opts: ListTasksOpts = {},
): Promise<SoleneSessionTaskRow[]> {
  if (opts.status !== undefined && !isKnownStatus(opts.status)) {
    throw new Error(`listTasks: invalid status=${String(opts.status)}`);
  }

  const conditions = [];
  if (opts.conversationId !== undefined) {
    conditions.push(
      eq(soleneSessionTasks.conversationId, opts.conversationId),
    );
  }
  if (opts.status !== undefined) {
    conditions.push(eq(soleneSessionTasks.status, opts.status));
  }
  if (opts.owner !== undefined) {
    conditions.push(eq(soleneSessionTasks.owner, opts.owner));
  }

  const where =
    conditions.length === 0
      ? undefined
      : conditions.length === 1
        ? conditions[0]
        : and(...conditions);

  const q = db.select().from(soleneSessionTasks);
  const rows = await (where ? q.where(where) : q).orderBy(
    asc(soleneSessionTasks.createdAt),
  );
  return rows;
}

// ============================================
// getTask
// ============================================

export async function getTask(
  taskId: number,
): Promise<SoleneSessionTaskRow | null> {
  if (!Number.isFinite(taskId) || taskId <= 0) {
    throw new Error(`getTask: invalid taskId=${taskId}`);
  }
  const [row] = await db
    .select()
    .from(soleneSessionTasks)
    .where(eq(soleneSessionTasks.id, taskId))
    .limit(1);
  return row ?? null;
}

export type { SoleneSessionTaskRow };
