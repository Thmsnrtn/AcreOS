// @ts-nocheck
/**
 * CEO Reminders — Sovereign Company Protocol v6
 *
 * CEO says "remind me to check on Acme Corp Tuesday" → it happens.
 * Reminders surface in the morning briefing and can trigger agent actions.
 */

import { db } from "../db";
import { systemMeta } from "@shared/schema";
import { eq } from "drizzle-orm";

interface CEOReminder {
  id: string;
  message: string;
  dueDate: Date;
  context?: string;           // What prompted this reminder
  relatedAgent?: string;       // Agent to involve
  relatedOrgId?: number;       // Customer reference
  status: "pending" | "fired" | "dismissed";
  createdAt: Date;
}

// In-memory store backed by systemMeta for persistence
let reminders: CEOReminder[] = [];
let loaded = false;

async function loadReminders() {
  if (loaded) return;
  try {
    const meta = await db.query.systemMeta.findFirst({
      where: eq(systemMeta.key, "ceo_reminders"),
    });
    if (meta?.value) {
      reminders = JSON.parse(meta.value).map((r: any) => ({
        ...r,
        dueDate: new Date(r.dueDate),
        createdAt: new Date(r.createdAt),
      }));
    }
  } catch {}
  loaded = true;
}

async function saveReminders() {
  try {
    const existing = await db.query.systemMeta.findFirst({
      where: eq(systemMeta.key, "ceo_reminders"),
    });
    const value = JSON.stringify(reminders);
    if (existing) {
      await db.update(systemMeta)
        .set({ value, updatedAt: new Date() })
        .where(eq(systemMeta.key, "ceo_reminders"));
    } else {
      await db.insert(systemMeta).values({
        key: "ceo_reminders",
        value,
      });
    }
  } catch (err) {
    console.error("[CEOReminders] Failed to persist:", err);
  }
}

/**
 * Create a new reminder.
 */
export async function createReminder(params: {
  message: string;
  dueDate: Date;
  context?: string;
  relatedAgent?: string;
  relatedOrgId?: number;
}): Promise<CEOReminder> {
  await loadReminders();

  const reminder: CEOReminder = {
    id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    message: params.message,
    dueDate: params.dueDate,
    context: params.context,
    relatedAgent: params.relatedAgent,
    relatedOrgId: params.relatedOrgId,
    status: "pending",
    createdAt: new Date(),
  };

  reminders.push(reminder);
  await saveReminders();

  console.log(`[CEOReminders] Created: "${params.message}" due ${params.dueDate.toLocaleDateString()}`);
  return reminder;
}

/**
 * Get reminders that are due (for morning briefing).
 */
export async function getDueReminders(): Promise<CEOReminder[]> {
  await loadReminders();
  const now = new Date();
  return reminders.filter(r => r.status === "pending" && r.dueDate <= now);
}

/**
 * Get all pending reminders.
 */
export async function getPendingReminders(): Promise<CEOReminder[]> {
  await loadReminders();
  return reminders.filter(r => r.status === "pending").sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
}

/**
 * Dismiss a reminder.
 */
export async function dismissReminder(id: string): Promise<boolean> {
  await loadReminders();
  const reminder = reminders.find(r => r.id === id);
  if (!reminder) return false;
  reminder.status = "dismissed";
  await saveReminders();
  return true;
}

/**
 * Mark a reminder as fired (shown to CEO).
 */
export async function markFired(id: string): Promise<void> {
  await loadReminders();
  const reminder = reminders.find(r => r.id === id);
  if (reminder) {
    reminder.status = "fired";
    await saveReminders();
  }
}

/**
 * Parse a natural language date reference.
 * "tomorrow" → tomorrow's date
 * "tuesday" → next Tuesday
 * "next week" → 7 days from now
 * "in 3 days" → 3 days from now
 */
export function parseRelativeDate(text: string): Date {
  const now = new Date();
  const lower = text.toLowerCase();

  if (lower.includes("tomorrow")) {
    return new Date(now.getTime() + 24 * 60 * 60 * 1000);
  }
  if (lower.includes("next week")) {
    return new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  }
  if (lower.includes("next month")) {
    return new Date(now.getFullYear(), now.getMonth() + 1, now.getDate());
  }

  // "in X days"
  const inDays = lower.match(/in (\d+) days?/);
  if (inDays) {
    return new Date(now.getTime() + parseInt(inDays[1]) * 24 * 60 * 60 * 1000);
  }

  // Day of week
  const days = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
  for (let i = 0; i < days.length; i++) {
    if (lower.includes(days[i])) {
      const today = now.getDay();
      let daysUntil = i - today;
      if (daysUntil <= 0) daysUntil += 7;
      return new Date(now.getTime() + daysUntil * 24 * 60 * 60 * 1000);
    }
  }

  // Default: tomorrow
  return new Date(now.getTime() + 24 * 60 * 60 * 1000);
}
