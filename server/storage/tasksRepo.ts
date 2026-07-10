// Task-management data layer: task CRUD, completion, and the recurring-task
// engine (due sweep + next-occurrence creation). Extracted from the
// god-class server/storage.ts in the storage refactor. Methods are merged
// into DatabaseStorage.prototype at construction time; `this` refers to the
// full DatabaseStorage instance (this.logActivity resolves against the
// composed prototype). calculateNextOccurrence moved from a private class
// method to a module-level pure function.

import { and, desc, eq, lte } from "drizzle-orm";
import { db } from "../db";
import { addMonths } from "../utils/dateUtils";
import {
  tasks,
  type Task,
  type InsertTask,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

function calculateNextOccurrence(date: Date | null, rule: string): Date {
  const baseDate = date ? new Date(date) : new Date();
  const nextDate = new Date(baseDate);
  
  switch (rule) {
    case "daily":
      nextDate.setDate(nextDate.getDate() + 1);
      break;
    case "weekly":
      nextDate.setDate(nextDate.getDate() + 7);
      break;
    case "monthly": {
      const monthly = addMonths(nextDate, 1);
      nextDate.setTime(monthly.getTime());
      break;
    }
    case "yearly":
      nextDate.setFullYear(nextDate.getFullYear() + 1);
      break;
  }
  
  return nextDate;
}

export const tasksRepo = {
  // Tasks (17.1, 17.2)
  async getTasks(this: DatabaseStorage, orgId: number, filters?: { status?: string; priority?: string; assignedTo?: number; entityType?: string; entityId?: number }): Promise<Task[]> {
    let conditions = [eq(tasks.organizationId, orgId)];
    
    if (filters?.status) {
      conditions.push(eq(tasks.status, filters.status));
    }
    if (filters?.priority) {
      conditions.push(eq(tasks.priority, filters.priority));
    }
    if (filters?.assignedTo !== undefined) {
      conditions.push(eq(tasks.assignedTo, filters.assignedTo));
    }
    if (filters?.entityType) {
      conditions.push(eq(tasks.entityType, filters.entityType));
    }
    if (filters?.entityId !== undefined) {
      conditions.push(eq(tasks.entityId, filters.entityId));
    }
    
    return await db.select().from(tasks)
      .where(and(...conditions))
      .orderBy(desc(tasks.dueDate), desc(tasks.priority));
  },

  async getTask(this: DatabaseStorage, orgId: number, id: number): Promise<Task | undefined> {
    const [task] = await db.select().from(tasks)
      .where(and(eq(tasks.organizationId, orgId), eq(tasks.id, id)));
    return task;
  },

  async createTask(this: DatabaseStorage, task: InsertTask): Promise<Task> {
    const [newTask] = await db.insert(tasks).values(task).returning();
    await this.logActivity({
      organizationId: task.organizationId,
      action: "created",
      entityType: "task",
      entityId: newTask.id,
      description: `Task "${newTask.title}" created`,
    });
    return newTask;
  },

  async updateTask(this: DatabaseStorage, id: number, updates: Partial<InsertTask>, organizationId?: number): Promise<Task> {
    const conditions = [eq(tasks.id, id)];
    if (organizationId) conditions.push(eq(tasks.organizationId, organizationId));
    const [updated] = await db.update(tasks)
      .set({ ...updates, updatedAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async deleteTask(this: DatabaseStorage, id: number, organizationId?: number): Promise<void> {
    const conditions = [eq(tasks.id, id)];
    if (organizationId) conditions.push(eq(tasks.organizationId, organizationId));
    await db.delete(tasks).where(and(...conditions));
  },

  async completeTask(this: DatabaseStorage, id: number, organizationId?: number): Promise<Task> {
    const conditions = [eq(tasks.id, id)];
    if (organizationId) conditions.push(eq(tasks.organizationId, organizationId));
    const [completed] = await db.update(tasks)
      .set({
        status: "completed",
        completedAt: new Date(),
        updatedAt: new Date()
      })
      .where(and(...conditions))
      .returning();
    
    await this.logActivity({
      organizationId: completed.organizationId,
      action: "completed",
      entityType: "task",
      entityId: completed.id,
      description: `Task "${completed.title}" completed`,
    });
    
    return completed;
  },

  async getRecurringTasksDue(this: DatabaseStorage): Promise<Task[]> {
    return await db.select().from(tasks)
      .where(and(
        eq(tasks.isRecurring, true),
        eq(tasks.status, "completed"),
        lte(tasks.nextOccurrence, new Date())
      ));
  },

  async createNextRecurringTask(this: DatabaseStorage, parentTask: Task): Promise<Task> {
    const nextDueDate = calculateNextOccurrence(parentTask.dueDate, parentTask.recurrenceRule as string);
    const nextNextOccurrence = calculateNextOccurrence(nextDueDate, parentTask.recurrenceRule as string);
    
    const newTask: InsertTask = {
      organizationId: parentTask.organizationId,
      title: parentTask.title,
      description: parentTask.description,
      dueDate: nextDueDate,
      priority: parentTask.priority as "low" | "medium" | "high" | "urgent",
      status: "pending",
      assignedTo: parentTask.assignedTo,
      createdBy: parentTask.createdBy,
      entityType: parentTask.entityType as "lead" | "property" | "deal" | "none",
      entityId: parentTask.entityId,
      isRecurring: true,
      recurrenceRule: parentTask.recurrenceRule,
      nextOccurrence: nextNextOccurrence,
      parentTaskId: parentTask.id,
    };
    
    const [created] = await db.insert(tasks).values(newTask).returning();
    
    await db.update(tasks)
      .set({ nextOccurrence: null })
      .where(eq(tasks.id, parentTask.id));
    
    return created;
  },

};

export type TasksRepo = typeof tasksRepo;
