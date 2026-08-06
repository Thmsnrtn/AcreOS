// Automation + workflow data layer: enhanced tasks, notifications, activity
// feed, and job cursors. Extracted from the god-class server/storage.ts in
// the storage refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance.
//
// The automation-rules + automation-executions methods that used to live
// here were REMOVED (Wave A "Nothing lies", 2026-07-29): they backed a dead
// parallel /automation surface with no execution engine —
// createAutomationExecution had zero call sites, so authored rules could
// never run. The real automation data layer is the workflows/workflow_runs
// tables (server/services/workflow-engine.ts). See
// docs/company/deletion-ledger.md.

import { and, count, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { wsServer } from "../websocket";
import { logger } from "../utils/logger";
import {
  tasks,
  notifications,
  activityLog,
  jobCursors,
  type Task,
  type Notification,
  type InsertNotification,
  type ActivityLogEntry,
  type JobCursor,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const automationRepo = {
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

    // Cohesion Wave-1: push the new row to its recipient in real-time so the
    // notification center updates live instead of waiting on its 5-min poll.
    // Scoped strictly to the recipient's own `user:{id}` channel — never the
    // org channel — so one user's notification is never delivered to another.
    // Fail-safe: a WS hiccup must never fail notification creation; the poll
    // remains the fallback.
    if (newNotification?.userId) {
      try {
        wsServer.sendToUser(newNotification.userId, "notification.new", {
          id: newNotification.id,
          type: newNotification.type,
        });
      } catch (err) {
        logger.error(
          "[notifications] failed to publish notification.new over WebSocket (poll fallback remains)",
          err instanceof Error ? err : undefined,
        );
      }
    }

    return newNotification;
  },

  async markNotificationRead(this: DatabaseStorage, id: number, organizationId?: number): Promise<Notification> {
    // When organizationId is supplied the update is tenant-scoped so a caller
    // cannot flip another org's notification by guessing its id (audit F-23-4).
    const conditions = [eq(notifications.id, id)];
    if (organizationId !== undefined) {
      conditions.push(eq(notifications.organizationId, organizationId));
    }
    const [updated] = await db.update(notifications)
      .set({ isRead: true, readAt: new Date() })
      .where(and(...conditions))
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
