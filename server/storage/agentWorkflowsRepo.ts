// Agent-workflows data layer: agent memory (usage-tracked), agent feedback
// (+ per-task stats), workflows (CRUD + trigger lookup + toggle), workflow
// runs, and scheduled tasks (incl. the due sweep). Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import {
  agentMemory,
  agentTasks,
  agentFeedback,
  workflows,
  workflowRuns,
  scheduledTasks,
  type AgentMemory,
  type AgentFeedback,
  type Workflow,
  type WorkflowRun,
  type ScheduledTask,
  type InsertAgentMemory,
  type InsertAgentFeedback,
  type InsertWorkflow,
  type InsertWorkflowRun,
  type InsertScheduledTask,
  type AgentTask,
  type InsertAgentTask,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";
import { assertWritablePatch } from "../utils/patch";

export const agentWorkflowsRepo = {
  // Agent Tasks — extracted from the god-class 2026-09-06 alongside the
  // empty-patch guard below. They belong here rather than in storage.ts:
  // this repo already owns agent feedback, and joins agentTasks to it.
  async getAgentTask(this: DatabaseStorage, orgId: number, id: number): Promise<AgentTask | undefined> {
    const [task] = await db.select().from(agentTasks)
      .where(and(eq(agentTasks.organizationId, orgId), eq(agentTasks.id, id)));
    return task;
  },

  async updateAgentTask(
    this: DatabaseStorage,
    id: number,
    updates: Partial<InsertAgentTask>,
    organizationId?: number,
  ): Promise<AgentTask> {
    const conditions = [eq(agentTasks.id, id)];
    if (organizationId) conditions.push(eq(agentTasks.organizationId, organizationId));
    const [updated] = await db.update(agentTasks)
      .set(assertWritablePatch(updates, "agent_tasks.updateAgentTask"))
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Agent Memory
  async createAgentMemory(this: DatabaseStorage, memory: InsertAgentMemory): Promise<AgentMemory> {
    const [created] = await db.insert(agentMemory).values(memory).returning();
    return created;
  },

  async getAgentMemories(this: DatabaseStorage, orgId: number, agentType?: string, limit: number = 50): Promise<AgentMemory[]> {
    let query = db.select().from(agentMemory).where(eq(agentMemory.organizationId, orgId));
    if (agentType) {
      query = db.select().from(agentMemory).where(
        and(eq(agentMemory.organizationId, orgId), eq(agentMemory.agentType, agentType))
      );
    }
    return await query.orderBy(desc(agentMemory.usageCount)).limit(limit);
  },

  async updateAgentMemoryUsage(this: DatabaseStorage, id: number, organizationId?: number): Promise<AgentMemory> {
    const conditions = [eq(agentMemory.id, id)];
    if (organizationId) conditions.push(eq(agentMemory.organizationId, organizationId));
    const [updated] = await db.update(agentMemory)
      .set({
        usageCount: sql`${agentMemory.usageCount} + 1`,
        lastUsedAt: new Date(),
      })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteAgentMemory(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(agentMemory.id, id)];
    if (organizationId) conditions.push(eq(agentMemory.organizationId, organizationId));
    await db.delete(agentMemory).where(and(...conditions));
  },

  // Agent Feedback
  async createAgentFeedback(this: DatabaseStorage, feedback: InsertAgentFeedback): Promise<AgentFeedback> {
    const [created] = await db.insert(agentFeedback).values(feedback).returning();
    return created;
  },

  async getAgentFeedbackStats(this: DatabaseStorage, orgId: number, agentType?: string): Promise<{
    totalFeedback: number;
    averageRating: number;
    helpfulCount: number;
    unhelpfulCount: number;
    byRating: { rating: number; count: number }[];
  }> {
    let feedbackQuery = db.select().from(agentFeedback)
      .innerJoin(agentTasks, eq(agentFeedback.agentTaskId, agentTasks.id))
      .where(eq(agentFeedback.organizationId, orgId));

    if (agentType) {
      feedbackQuery = db.select().from(agentFeedback)
        .innerJoin(agentTasks, eq(agentFeedback.agentTaskId, agentTasks.id))
        .where(and(
          eq(agentFeedback.organizationId, orgId),
          eq(agentTasks.agentType, agentType)
        ));
    }

    const feedbackList = await feedbackQuery;
    
    const totalFeedback = feedbackList.length;
    const avgRating = totalFeedback > 0 
      ? feedbackList.reduce((sum, f) => sum + f.agent_feedback.rating, 0) / totalFeedback 
      : 0;
    const helpfulCount = feedbackList.filter(f => f.agent_feedback.helpful).length;
    const unhelpfulCount = totalFeedback - helpfulCount;

    const ratingCounts = [1, 2, 3, 4, 5].map(rating => ({
      rating,
      count: feedbackList.filter(f => f.agent_feedback.rating === rating).length
    }));

    return {
      totalFeedback,
      averageRating: Number(avgRating.toFixed(2)),
      helpfulCount,
      unhelpfulCount,
      byRating: ratingCounts,
    };
  },

  async getAgentFeedbackByTask(this: DatabaseStorage, taskId: number): Promise<AgentFeedback | undefined> {
    const [feedback] = await db.select().from(agentFeedback).where(eq(agentFeedback.agentTaskId, taskId));
    return feedback;
  },

  // Workflows
  async getWorkflows(this: DatabaseStorage, orgId: number): Promise<Workflow[]> {
    return await db.select().from(workflows)
      .where(eq(workflows.organizationId, orgId))
      .orderBy(desc(workflows.createdAt));
  },

  async getWorkflow(this: DatabaseStorage, orgId: number, id: number): Promise<Workflow | undefined> {
    const [workflow] = await db.select().from(workflows)
      .where(and(eq(workflows.id, id), eq(workflows.organizationId, orgId)));
    return workflow;
  },

  /**
   * Workflow lookup by primary key with NO org scope. Deliberately narrow:
   * the only caller is the durable-delay resume path, which starts from a
   * workflow_runs row (that table carries no organization_id) and needs the
   * workflow's own organizationId to rebuild the execution context. Never
   * expose this to a request handler — org-scoped `getWorkflow` exists for
   * that.
   *
   * The bypass goes through `unscopedForPlatformOps` rather than raw `db` so
   * it is logged with its reason and shows up in the single greppable audit
   * surface for tenancy bypasses (and so the org-scoped-fetch lint can see it
   * is deliberate rather than an oversight).
   */
  async getWorkflowById(this: DatabaseStorage, id: number): Promise<Workflow | undefined> {
    const platformDb = unscopedForPlatformOps(
      "workflow durable-delay resume: workflow_runs carries no organization_id, " +
        "so the parked run's workflow must be read by primary key to recover its org",
    );
    const [workflow] = await platformDb.select().from(workflows).where(eq(workflows.id, id));
    return workflow;
  },

  async getActiveWorkflowsByTrigger(this: DatabaseStorage, orgId: number, event: string): Promise<Workflow[]> {
    const allWorkflows = await db.select().from(workflows)
      .where(and(
        eq(workflows.organizationId, orgId),
        eq(workflows.isActive, true)
      ));
    return allWorkflows.filter(w => w.trigger?.event === event);
  },

  async createWorkflow(this: DatabaseStorage, workflow: InsertWorkflow): Promise<Workflow> {
    const [created] = await db.insert(workflows).values(workflow).returning();
    return created;
  },

  async updateWorkflow(this: DatabaseStorage, id: number, updates: Partial<InsertWorkflow>, organizationId?: number): Promise<Workflow> {
    const conditions = [eq(workflows.id, id)];
    if (organizationId) conditions.push(eq(workflows.organizationId, organizationId));
    const [updated] = await db.update(workflows)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteWorkflow(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(workflows.id, id)];
    if (organizationId) conditions.push(eq(workflows.organizationId, organizationId));
    await db.delete(workflows).where(and(...conditions));
  },

  async toggleWorkflow(this: DatabaseStorage, orgId: number, id: number, isActive: boolean): Promise<Workflow> {
    const [updated] = await db.update(workflows)
      .set({ isActive, updatedAt: new Date() })
      .where(and(eq(workflows.id, id), eq(workflows.organizationId, orgId)))
      .returning();
    return updated;
  },

  // Workflow Runs
  async getWorkflowRuns(this: DatabaseStorage, workflowId: number, limit: number = 50): Promise<WorkflowRun[]> {
    return await db.select().from(workflowRuns)
      .where(eq(workflowRuns.workflowId, workflowId))
      .orderBy(desc(workflowRuns.startedAt))
      .limit(limit);
  },

  async getWorkflowRun(this: DatabaseStorage, id: number): Promise<WorkflowRun | undefined> {
    const [run] = await db.select().from(workflowRuns).where(eq(workflowRuns.id, id));
    return run;
  },

  async createWorkflowRun(this: DatabaseStorage, run: InsertWorkflowRun): Promise<WorkflowRun> {
    const [created] = await db.insert(workflowRuns).values(run as any).returning();
    return created;
  },

  async updateWorkflowRun(this: DatabaseStorage, id: number, updates: Partial<InsertWorkflowRun>): Promise<WorkflowRun> {
    const [updated] = await db.update(workflowRuns)
      .set(assertWritablePatch(updates, "workflow_runs.updateWorkflowRun") as any)
      .where(eq(workflowRuns.id, id))
      .returning();
    return updated;
  },

  // ── Durable `delay` support (Wave B "Wire the engine", 2026-07-29) ────────
  // A run that hits a long `delay` parks with status "waiting" + resume_at.
  // The workflow_delay_resume job sweeps for due parked runs and continues
  // them. See server/services/workflow-engine.ts (executeDelay / resumeRun).

  /** Parked runs whose wake time has passed, oldest wake first. */
  async getDueWaitingWorkflowRuns(this: DatabaseStorage, now: Date, limit: number = 25): Promise<WorkflowRun[]> {
    return await db.select().from(workflowRuns)
      .where(and(
        eq(workflowRuns.status, "waiting"),
        lte(workflowRuns.resumeAt, now),
      ))
      .orderBy(workflowRuns.resumeAt)
      .limit(limit);
  },

  /**
   * Atomically take ownership of a parked run: flips "waiting" → "running" and
   * clears the wake fields, but ONLY if the row is still parked. Returns
   * undefined when another process got there first, so a double-sweep can
   * never execute the same remaining steps twice.
   */
  async claimWaitingWorkflowRun(this: DatabaseStorage, id: number): Promise<WorkflowRun | undefined> {
    const [claimed] = await db.update(workflowRuns)
      .set({ status: "running", resumeAt: null })
      .where(and(eq(workflowRuns.id, id), eq(workflowRuns.status, "waiting")))
      .returning();
    return claimed;
  },

  // Scheduled Tasks CRUD
  async getScheduledTasks(this: DatabaseStorage, orgId: number): Promise<ScheduledTask[]> {
    return await db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.organizationId, orgId))
      .orderBy(desc(scheduledTasks.createdAt));
  },

  async getScheduledTask(this: DatabaseStorage, id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks)
      .where(eq(scheduledTasks.id, id));
    return task;
  },

  async getScheduledTaskByOrg(this: DatabaseStorage, orgId: number, id: number): Promise<ScheduledTask | undefined> {
    const [task] = await db.select().from(scheduledTasks)
      .where(and(eq(scheduledTasks.id, id), eq(scheduledTasks.organizationId, orgId)));
    return task;
  },

  async getDueScheduledTasks(this: DatabaseStorage, now: Date): Promise<ScheduledTask[]> {
    return await db.select().from(scheduledTasks)
      .where(and(
        eq(scheduledTasks.status, "active"),
        lte(scheduledTasks.nextRunAt, now)
      ))
      .orderBy(scheduledTasks.nextRunAt);
  },

  async createScheduledTask(this: DatabaseStorage, task: InsertScheduledTask): Promise<ScheduledTask> {
    const [created] = await db.insert(scheduledTasks).values(task as any).returning();
    return created;
  },

  async updateScheduledTask(this: DatabaseStorage, id: number, updates: Partial<InsertScheduledTask>, organizationId?: number): Promise<ScheduledTask | undefined> {
    const conditions = [eq(scheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(scheduledTasks.organizationId, organizationId));
    const [updated] = await db.update(scheduledTasks)
      .set({ ...updates, updatedAt: new Date() } as any)
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteScheduledTask(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(scheduledTasks.id, id)];
    if (organizationId) conditions.push(eq(scheduledTasks.organizationId, organizationId));
    await db.delete(scheduledTasks).where(and(...conditions));
  },

};

export type AgentWorkflowsRepo = typeof agentWorkflowsRepo;
