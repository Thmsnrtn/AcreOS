/**
 * CEO Reminders — Sovereign Company Protocol v6
 *
 * CEO says "remind me to check on Acme Corp Tuesday" → it happens.
 * Reminders surface in the morning briefing and can trigger agent actions.
 *
 * Features:
 * - Recurring reminders (daily/weekly/monthly)
 * - Smart escalation with snooze tracking
 * - Context-aware entity linking
 */

import { db } from "../db";
import { systemMeta } from "@shared/schema";
import { eq } from "drizzle-orm";
import { addMonths } from "../utils/dateUtils";
import { logger } from "../utils/logger";

interface CEOReminder {
  id: string;
  message: string;
  dueDate: Date;
  context?: string;           // What prompted this reminder
  relatedAgent?: string;       // Agent to involve
  relatedOrgId?: number;       // Customer reference
  status: "pending" | "fired" | "dismissed";
  createdAt: Date;

  // Recurring reminders
  recurrence?: {
    type: "daily" | "weekly" | "monthly";
    dayOfWeek?: number;   // 0-6 for weekly
    dayOfMonth?: number;  // 1-31 for monthly
    endAfter?: number;    // stop after N occurrences
    occurrenceCount?: number; // how many times it has fired
  };

  // Smart escalation
  snoozeCount?: number;
  maxSnoozes?: number;        // default 3

  // Context capture
  entityType?: "org" | "deal" | "lead" | "property";
  entityId?: number;
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
    logger.error("[CEOReminders] Failed to persist", err);
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
  recurrence?: {
    type: "daily" | "weekly" | "monthly";
    dayOfWeek?: number;
    dayOfMonth?: number;
    endAfter?: number;
  };
  entityType?: "org" | "deal" | "lead" | "property";
  entityId?: number;
  maxSnoozes?: number;
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
    recurrence: params.recurrence
      ? { ...params.recurrence, occurrenceCount: 0 }
      : undefined,
    snoozeCount: 0,
    maxSnoozes: params.maxSnoozes ?? 3,
    entityType: params.entityType,
    entityId: params.entityId,
  };

  reminders.push(reminder);
  await saveReminders();

  logger.info(`[CEOReminders] Created: "${params.message}" due ${params.dueDate.toLocaleDateString()}`);
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
 * Snooze a reminder — smart escalation.
 *
 * Increments snoozeCount, reschedules 2 days out, keeps status "pending".
 * Returns false if the reminder has exhausted its snooze budget.
 */
export async function snoozeReminder(id: string): Promise<boolean> {
  await loadReminders();
  const reminder = reminders.find(r => r.id === id);
  if (!reminder) return false;

  const max = reminder.maxSnoozes ?? 3;
  const current = reminder.snoozeCount ?? 0;

  if (current >= max) {
    // No more snoozes — leave it in whatever state it's in
    return false;
  }

  reminder.snoozeCount = current + 1;
  reminder.dueDate = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000); // 2 days from now
  reminder.status = "pending";

  await saveReminders();
  logger.info(`[CEOReminders] Snoozed "${reminder.message}" (${reminder.snoozeCount}/${max}), ` +
    `next due ${reminder.dueDate.toLocaleDateString()}`);
  return true;
}

/**
 * Process recurring reminders.
 *
 * For every reminder that has fired and has a recurrence rule, create the
 * next occurrence instead of leaving it dead.  Increments occurrenceCount
 * and stops when endAfter is reached.
 */
export async function processRecurringReminders(): Promise<CEOReminder[]> {
  await loadReminders();

  const created: CEOReminder[] = [];

  for (const reminder of reminders) {
    if (reminder.status !== "fired") continue;
    if (!reminder.recurrence) continue;

    const rec = reminder.recurrence;
    const count = (rec.occurrenceCount ?? 0) + 1;

    // Stop if we've reached the occurrence cap
    if (rec.endAfter !== undefined && count >= rec.endAfter) {
      continue;
    }

    const nextDue = computeNextOccurrence(reminder.dueDate, rec);

    const next: CEOReminder = {
      id: `rem_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      message: reminder.message,
      dueDate: nextDue,
      context: reminder.context,
      relatedAgent: reminder.relatedAgent,
      relatedOrgId: reminder.relatedOrgId,
      status: "pending",
      createdAt: new Date(),
      recurrence: {
        ...rec,
        occurrenceCount: count,
      },
      snoozeCount: 0,
      maxSnoozes: reminder.maxSnoozes ?? 3,
      entityType: reminder.entityType,
      entityId: reminder.entityId,
    };

    reminders.push(next);
    created.push(next);

    logger.info(`[CEOReminders] Recurring "${next.message}" occurrence #${count}, ` +
      `next due ${nextDue.toLocaleDateString()}`);
  }

  if (created.length > 0) {
    await saveReminders();
  }

  return created;
}

/**
 * Compute the next occurrence date based on recurrence type.
 */
function computeNextOccurrence(
  lastDue: Date,
  rec: NonNullable<CEOReminder["recurrence"]>,
): Date {
  const d = new Date(lastDue);

  switch (rec.type) {
    case "daily":
      d.setDate(d.getDate() + 1);
      break;

    case "weekly": {
      // Advance 7 days; then snap to dayOfWeek if provided
      d.setDate(d.getDate() + 7);
      if (rec.dayOfWeek !== undefined) {
        const current = d.getDay();
        let diff = rec.dayOfWeek - current;
        if (diff < 0) diff += 7;
        d.setDate(d.getDate() + diff);
      }
      break;
    }

    case "monthly": {
      const monthly = addMonths(d, 1);
      d.setTime(monthly.getTime());
      if (rec.dayOfMonth !== undefined) {
        // Clamp to valid day for the target month
        const maxDay = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
        d.setDate(Math.min(rec.dayOfMonth, maxDay));
      }
      break;
    }
  }

  return d;
}

/**
 * Get fresh context for an entity-linked reminder.
 *
 * Queries the relevant table (organizations, deals, leads, properties)
 * and returns a brief status string for the CEO briefing.
 */
export async function getContextForReminder(reminder: CEOReminder): Promise<string | null> {
  if (!reminder.entityType || !reminder.entityId) {
    return null;
  }

  try {
    switch (reminder.entityType) {
      case "org": {
        const { organizations } = await import("@shared/schema");
        const org = await db.query.organizations.findFirst({
          where: eq(organizations.id, reminder.entityId),
        });
        if (!org) return `Organization #${reminder.entityId}: not found`;
        const name = org.name ?? `Org #${reminder.entityId}`;
        const parts = [name];
        if (org.churnRisk !== undefined && org.churnRisk !== null) {
          parts.push(`Churn risk ${org.churnRisk}/100`);
        }
        if (org.lastLoginAt) {
          const days = Math.floor(
            (Date.now() - new Date(org.lastLoginAt).getTime()) / (24 * 60 * 60 * 1000),
          );
          parts.push(`last login ${days} day${days !== 1 ? "s" : ""} ago`);
        }
        return parts.join(": ");
      }

      case "deal": {
        const { deals } = await import("@shared/schema");
        const deal = await db.query.deals.findFirst({
          where: eq(deals.id, reminder.entityId),
        });
        if (!deal) return `Deal #${reminder.entityId}: not found`;
        const title = deal.title ?? deal.name ?? `Deal #${reminder.entityId}`;
        const parts = [title];
        if (deal.stage) parts.push(`stage: ${deal.stage}`);
        if (deal.value !== undefined && deal.value !== null) parts.push(`value: $${deal.value}`);
        return parts.join(", ");
      }

      case "lead": {
        const { leads } = await import("@shared/schema");
        const lead = await db.query.leads.findFirst({
          where: eq(leads.id, reminder.entityId),
        });
        if (!lead) return `Lead #${reminder.entityId}: not found`;
        const name = lead.name ?? lead.email ?? `Lead #${reminder.entityId}`;
        const parts = [name];
        if (lead.status) parts.push(`status: ${lead.status}`);
        if (lead.score !== undefined && lead.score !== null) parts.push(`score: ${lead.score}`);
        return parts.join(", ");
      }

      case "property": {
        const { properties } = await import("@shared/schema");
        const prop = await db.query.properties.findFirst({
          where: eq(properties.id, reminder.entityId),
        });
        if (!prop) return `Property #${reminder.entityId}: not found`;
        const label = prop.name ?? prop.address ?? `Property #${reminder.entityId}`;
        const parts = [label];
        if (prop.status) parts.push(`status: ${prop.status}`);
        return parts.join(", ");
      }

      default:
        return null;
    }
  } catch (err) {
    logger.error(`[CEOReminders] Context lookup failed for ${reminder.entityType}#${reminder.entityId}`, err);
    return `${reminder.entityType} #${reminder.entityId}: context unavailable`;
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
