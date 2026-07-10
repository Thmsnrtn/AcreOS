// Agent-workflows data layer: agent memory (usage-tracked), agent feedback
// (+ per-task stats), workflows (CRUD + trigger lookup + toggle), workflow
// runs, and scheduled tasks (incl. the due sweep). Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, desc, eq, lte, sql } from "drizzle-orm";
import { db } from "../db";
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
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const agentWorkflowsRepo = {
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
      .set(updates as any)
      .where(eq(workflowRuns.id, id))
      .returning();
    return updated;
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
