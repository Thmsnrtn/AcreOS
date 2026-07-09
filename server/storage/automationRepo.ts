// Automation + workflow data layer: automation rules + executions, enhanced
// tasks, notifications, activity feed, and job cursors. Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance.

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import {
  automationRules,
  automationExecutions,
  tasks,
  notifications,
  activityLog,
  jobCursors,
  type AutomationRule,
  type InsertAutomationRule,
  type AutomationExecution,
  type InsertAutomationExecution,
  type Task,
  type Notification,
  type InsertNotification,
  type ActivityLogEntry,
  type JobCursor,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const automationRepo = {
  // AUTOMATION RULES (8.1)
  async getAutomationRules(this: DatabaseStorage, orgId: number): Promise<AutomationRule[]> {
    return await db.select()
      .from(automationRules)
      .where(eq(automationRules.organizationId, orgId))
      .orderBy(desc(automationRules.createdAt));
  },

  async getAutomationRule(this: DatabaseStorage, orgId: number, id: number): Promise<AutomationRule | undefined> {
    const [rule] = await db.select()
      .from(automationRules)
      .where(and(eq(automationRules.organizationId, orgId), eq(automationRules.id, id)));
    return rule;
  },

  async createAutomationRule(this: DatabaseStorage, rule: InsertAutomationRule): Promise<AutomationRule> {
    const [newRule] = await db.insert(automationRules).values(rule).returning();
    return newRule;
  },

  async updateAutomationRule(this: DatabaseStorage, id: number, updates: Partial<InsertAutomationRule>, organizationId?: number): Promise<AutomationRule> {
    const conditions = [eq(automationRules.id, id)];
    if (organizationId) conditions.push(eq(automationRules.organizationId, organizationId));
    const [updated] = await db.update(automationRules)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteAutomationRule(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(automationRules.id, id)];
    if (organizationId) conditions.push(eq(automationRules.organizationId, organizationId));
    await db.delete(automationRules).where(and(...conditions));
  },

  async toggleAutomationRule(this: DatabaseStorage, id: number, enabled: boolean, organizationId?: number): Promise<AutomationRule> {
    const conditions = [eq(automationRules.id, id)];
    if (organizationId) conditions.push(eq(automationRules.organizationId, organizationId));
    const [updated] = await db.update(automationRules)
      .set({ isEnabled: enabled, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  // Automation Executions
  async getAutomationExecutions(this: DatabaseStorage, orgId: number, ruleId?: number, limit: number = 50): Promise<AutomationExecution[]> {
    const conditions = [eq(automationExecutions.organizationId, orgId)];
    if (ruleId !== undefined) {
      conditions.push(eq(automationExecutions.ruleId, ruleId));
    }
    return await db.select()
      .from(automationExecutions)
      .where(and(...conditions))
      .orderBy(desc(automationExecutions.executedAt))
      .limit(limit);
  },

  async createAutomationExecution(this: DatabaseStorage, execution: InsertAutomationExecution): Promise<AutomationExecution> {
    const [newExecution] = await db.insert(automationExecutions).values(execution).returning();

    // Update the rule's execution count and last executed timestamp
    await db.update(automationRules)
      .set({
        executionCount: sql`${automationRules.executionCount} + 1`,
        lastExecutedAt: new Date(),
        updatedAt: new Date()
      })
      .where(eq(automationRules.id, execution.ruleId));

    return newExecution;
  },

  // ENHANCED TASKS (8.2)
  async getMyTasks(this: DatabaseStorage, orgId: number, userId: string): Promise<Task[]> {
    const member = await this.getTeamMember(orgId, userId);
    if (!member) return [];

    return await db.select()
      .from(tasks)
      .where(and(
        eq(tasks.organizationId, orgId),
        eq(tasks.assignedTo, member.id),
        sql`${tasks.status} != 'completed'`,
        sql`${tasks.status} != 'cancelled'`
      ))
      .orderBy(tasks.dueDate, desc(tasks.priority));
  },

  async getTasksByEntity(this: DatabaseStorage, orgId: number, entityType: string, entityId: number): Promise<Task[]> {
    return await db.select()
      .from(tasks)
      .where(and(
        eq(tasks.organizationId, orgId),
        eq(tasks.entityType, entityType),
        eq(tasks.entityId, entityId)
      ))
      .orderBy(desc(tasks.createdAt));
  },

  // NOTIFICATIONS (8.3)
  async getNotifications(this: DatabaseStorage, orgId: number, userId: string, unreadOnly: boolean = false): Promise<Notification[]> {
    const conditions = [
      eq(notifications.organizationId, orgId),
      eq(notifications.userId, userId)
    ];

    if (unreadOnly) {
      conditions.push(eq(notifications.isRead, false));
    }

    return await db.select()
      .from(notifications)
      .where(and(...conditions))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
  },

  async getUnreadNotificationCount(this: DatabaseStorage, orgId: number, userId: string): Promise<number> {
    const [result] = await db.select({ count: count() })
      .from(notifications)
      .where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
    return result?.count || 0;
  },

  async createNotification(this: DatabaseStorage, notification: InsertNotification): Promise<Notification> {
    const [newNotification] = await db.insert(notifications).values(notification).returning();
    return newNotification;
  },

  async markNotificationRead(this: DatabaseStorage, id: number): Promise<Notification> {
    const [updated] = await db.update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(eq(notifications.id, id))
      .returning();
    return updated;
  },

  async markAllNotificationsRead(this: DatabaseStorage, orgId: number, userId: string): Promise<void> {
    await db.update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(
        eq(notifications.organizationId, orgId),
        eq(notifications.userId, userId),
        eq(notifications.isRead, false)
      ));
  },

  // ACTIVITY FEED (8.3)
  async getActivityFeed(this: DatabaseStorage, orgId: number, filters?: { entityType?: string; limit?: number; offset?: number }): Promise<ActivityLogEntry[]> {
    const conditions = [eq(activityLog.organizationId, orgId)];

    if (filters?.entityType) {
      conditions.push(eq(activityLog.entityType, filters.entityType));
    }

    const limit = filters?.limit || 50;
    const offset = filters?.offset || 0;

    return await db.select()
      .from(activityLog)
      .where(and(...conditions))
      .orderBy(desc(activityLog.createdAt))
      .limit(limit)
      .offset(offset);
  },

  // JOB CURSORS (Prevent duplicate processing)
  async getJobCursor(this: DatabaseStorage, jobType: string): Promise<JobCursor | undefined> {
    const [cursor] = await db.select()
      .from(jobCursors)
      .where(eq(jobCursors.jobType, jobType));
    return cursor;
  },

  async updateJobCursor(this: DatabaseStorage, jobType: string, lastProcessedId: number | null, status: string): Promise<JobCursor> {
    const existing = await this.getJobCursor(jobType);

    if (existing) {
      const [updated] = await db.update(jobCursors)
        .set({
          lastProcessedId,
          status,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobCursors.jobType, jobType))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(jobCursors)
        .values({
          jobType,
          lastProcessedId,
          status,
          lastRunAt: new Date(),
        })
        .returning();
      return created;
    }
  },

  async setJobStatus(this: DatabaseStorage, jobType: string, status: string): Promise<JobCursor> {
    const existing = await this.getJobCursor(jobType);

    if (existing) {
      const [updated] = await db.update(jobCursors)
        .set({
          status,
          lastRunAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobCursors.jobType, jobType))
        .returning();
      return updated;
    } else {
      const [created] = await db.insert(jobCursors)
        .values({
          jobType,
          status,
          lastRunAt: new Date(),
        })
        .returning();
      return created;
    }
  },
};

export type AutomationRepo = typeof automationRepo;
