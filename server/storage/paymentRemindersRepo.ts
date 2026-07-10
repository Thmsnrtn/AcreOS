// Finance-agent payment-reminders data layer: delinquent-note sweeps,
// reminder CRUD + sent-marking, upcoming-payment queries, and the portfolio
// health rollup. Extracted from the god-class server/storage.ts in the
// storage refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance.

import { and, count, desc, eq, gte, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import {
  notes,
  paymentReminders,
  type Note,
  type PaymentReminder,
  type InsertPaymentReminder,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

export const paymentRemindersRepo = {
  // Payment Reminders (Finance Agent)
  async getDelinquentNotes(this: DatabaseStorage, orgId: number) {
    const now = new Date();
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        lte(notes.nextPaymentDate, now)
      ))
      .orderBy(notes.nextPaymentDate);
  },

  async getPendingReminders(this: DatabaseStorage, limit = 50) {
    const now = new Date();
    return await db.select().from(paymentReminders)
      .where(and(
        eq(paymentReminders.status, "scheduled"),
        lte(paymentReminders.scheduledFor, now)
      ))
      .orderBy(paymentReminders.scheduledFor)
      .limit(limit);
  },

  async getRemindersForNote(this: DatabaseStorage, noteId: number) {
    return await db.select().from(paymentReminders)
      .where(eq(paymentReminders.noteId, noteId))
      .orderBy(desc(paymentReminders.createdAt));
  },

  async createPaymentReminder(this: DatabaseStorage, reminder: InsertPaymentReminder) {
    const [newReminder] = await db.insert(paymentReminders).values(reminder).returning();
    return newReminder;
  },

  async updatePaymentReminder(this: DatabaseStorage, id: number, updates: Partial<InsertPaymentReminder>, organizationId?: number) {
    const conditions = [eq(paymentReminders.id, id)];
    if (organizationId) conditions.push(eq(paymentReminders.organizationId, organizationId));
    const [updated] = await db.update(paymentReminders)
      .set(updates)
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async markReminderSent(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(paymentReminders.id, id)];
    if (organizationId) conditions.push(eq(paymentReminders.organizationId, organizationId));
    const [updated] = await db.update(paymentReminders)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  async getNotesNeedingReminders(this: DatabaseStorage, orgId: number) {
    const now = new Date();
    const threeDaysFromNow = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
    
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        lte(notes.nextPaymentDate, threeDaysFromNow),
        or(
          sql`${notes.lastReminderSentAt} IS NULL`,
          lte(notes.lastReminderSentAt, threeDaysAgo)
        )
      ))
      .orderBy(notes.nextPaymentDate);
  },

  async getNotesWithUpcomingPayments(this: DatabaseStorage, orgId: number, daysAhead: number) {
    const now = new Date();
    const futureDate = new Date(now.getTime() + daysAhead * 24 * 60 * 60 * 1000);
    
    return await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active"),
        gte(notes.nextPaymentDate, now),
        lte(notes.nextPaymentDate, futureDate)
      ))
      .orderBy(notes.nextPaymentDate);
  },

  async getFinancePortfolioHealth(this: DatabaseStorage, orgId: number) {
    const activeNotes = await db.select().from(notes)
      .where(and(
        eq(notes.organizationId, orgId),
        eq(notes.status, "active")
      ));
    
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);
    
    const remindersSent = await db.select({ count: count() })
      .from(paymentReminders)
      .where(and(
        eq(paymentReminders.organizationId, orgId),
        eq(paymentReminders.status, "sent"),
        gte(paymentReminders.sentAt, startOfMonth)
      ));
    
    const stats = {
      totalActiveNotes: activeNotes.length,
      totalBalance: activeNotes.reduce((sum, n) => sum + Number(n.currentBalance || 0), 0),
      currentNotes: 0,
      earlyDelinquent: 0,
      delinquent: 0,
      seriouslyDelinquent: 0,
      defaultCandidates: 0,
      remindersSentThisMonth: remindersSent[0]?.count || 0,
      collectionsThisMonth: 0,
    };
    
    for (const note of activeNotes) {
      const delinquencyStatus = note.delinquencyStatus || "current";
      switch (delinquencyStatus) {
        case "current":
          stats.currentNotes++;
          break;
        case "early_delinquent":
          stats.earlyDelinquent++;
          break;
        case "delinquent":
          stats.delinquent++;
          break;
        case "seriously_delinquent":
          stats.seriouslyDelinquent++;
          break;
        case "default_candidate":
          stats.defaultCandidates++;
          stats.collectionsThisMonth++;
          break;
      }
    }
    
    return stats;
  },
};

export type PaymentRemindersRepo = typeof paymentRemindersRepo;
