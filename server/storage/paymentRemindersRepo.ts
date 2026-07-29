// Finance-agent payment-reminders data layer: delinquent-note sweeps,
// reminder CRUD + sent-marking, upcoming-payment queries, and the portfolio
// health rollup. Extracted from the god-class server/storage.ts in the
// storage refactor. Methods are merged into DatabaseStorage.prototype at
// construction time; `this` refers to the full DatabaseStorage instance.

import { and, count, desc, eq, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../db";
import { unscopedForPlatformOps } from "../utils/orgScopedDb";
import {
  notes,
  paymentReminders,
  type Note,
  type PaymentReminder,
  type InsertPaymentReminder,
} from "@shared/schema";
import type { DatabaseStorage } from "../storage";

/**
 * Statuses a reminder row may sit in while it is still waiting for a rail to
 * accept it. `scheduled` = created by the ladder, not yet attempted.
 * `queued` = attempted, the rail was unavailable for a reason that may clear
 * (no connected identity, warmup quota, frequency cap) so it is retried.
 * See server/services/financeAgent.ts REMINDER_STATUS for the full vocabulary.
 */
const DISPATCHABLE_STATUSES = ["scheduled", "queued"] as const;

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

  /**
   * Reminders that are due for a DISPATCH ATTEMPT.
   *
   * Differs from getPendingReminders in two load-bearing ways:
   *   1. it also returns rows already attempted and left `queued` (rail
   *      unavailable), so an honest non-send is retried instead of being
   *      silently abandoned;
   *   2. it BOUNDS the retry window (`retryWindowDays`), so the ladder
   *      terminates — a reminder whose scheduled moment is older than the
   *      window is never picked up again and must be handled by a human.
   */
  async getDispatchableReminders(
    this: DatabaseStorage,
    limit = 50,
    retryWindowDays = 14,
  ) {
    const now = new Date();
    const windowStart = new Date(now.getTime() - retryWindowDays * 24 * 60 * 60 * 1000);
    // Deliberately cross-org: this is the borrower-reminder ladder's scheduled
    // sweep, which must see every org's due rungs in one pass. Routed through
    // unscopedForPlatformOps rather than raw `db` so the bypass is logged with
    // its reason and appears in the single greppable tenancy-bypass audit
    // surface — the dispatcher re-scopes per reminder before it sends.
    const platformDb = unscopedForPlatformOps(
      "borrower reminder ladder: scheduled cross-org sweep of due reminder rungs",
    );
    return await platformDb.select().from(paymentReminders)
      .where(and(
        inArray(paymentReminders.status, [...DISPATCHABLE_STATUSES]),
        lte(paymentReminders.scheduledFor, now),
        gte(paymentReminders.scheduledFor, windowStart),
      ))
      .orderBy(paymentReminders.scheduledFor)
      .limit(limit);
  },

  /**
   * Idempotency lookup for the borrower reminder ladder.
   *
   * The ladder's natural key is (noteId, stage, period). `scheduledFor` is
   * derived deterministically as `periodDueDate + stageOffsetDays` normalised
   * to UTC midnight, so a [periodStart, periodEnd) window on `scheduledFor`
   * plus `type` uniquely identifies one rung of one period without needing a
   * new column (and therefore without a migration). Any status counts as a
   * hit — a row that was blocked or marked unavailable must NOT be recreated
   * on the next tick.
   */
  async findLadderReminder(
    this: DatabaseStorage,
    noteId: number,
    type: string,
    periodStart: Date,
    periodEnd: Date,
  ): Promise<PaymentReminder | undefined> {
    // Keyed on noteId, which belongs to exactly one org, so this cannot cross
    // tenants — but it runs inside the same cross-org ladder sweep and has no
    // request org to scope to. Routed through the audited hatch rather than
    // raw `db` so the tenancy bypass is deliberate and greppable rather than
    // an oversight the lint had to guess about.
    const platformDb = unscopedForPlatformOps(
      "borrower reminder ladder: per-note idempotency lookup inside the cross-org sweep",
    );
    const rows = await platformDb.select().from(paymentReminders)
      .where(and(
        eq(paymentReminders.noteId, noteId),
        eq(paymentReminders.type, type),
        gte(paymentReminders.scheduledFor, periodStart),
        lt(paymentReminders.scheduledFor, periodEnd),
      ))
      .limit(1);
    return rows[0];
  },

  /**
   * Every org that actually holds a serviced note.
   *
   * The borrower-dunning sweep used to enumerate orgs via
   * getOrganizationsInDunning() — the SUBSCRIPTION dunning list (an AcreOS
   * customer whose own card failed). That meant a healthy customer's late
   * borrowers were never swept at all. This is the correct population:
   * distinct organization_id over active notes.
   */
  async getOrganizationIdsWithActiveNotes(this: DatabaseStorage): Promise<number[]> {
    const rows = await db
      .selectDistinct({ organizationId: notes.organizationId })
      .from(notes)
      .where(eq(notes.status, "active"));
    return rows.map((r) => r.organizationId);
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

  /**
   * @deprecated Marks a row `sent` with no evidence that a rail accepted it —
   * exactly the "recorded as sent but never sent" shape Wave A removed. Use
   * recordReminderOutcome() instead, which can only write `sent` alongside the
   * accepting rail. Retained solely because it is declared on IStorage.
   */
  async markReminderSent(this: DatabaseStorage, id: number, organizationId?: number) {
    const conditions = [eq(paymentReminders.id, id)];
    if (organizationId) conditions.push(eq(paymentReminders.organizationId, organizationId));
    const [updated] = await db.update(paymentReminders)
      .set({ status: "sent", sentAt: new Date() })
      .where(and(...conditions))
      .returning();
    return updated;
  },

  /**
   * Write the HONEST outcome of one dispatch attempt.
   *
   * `sentAt` is stamped ONLY for outcome === "sent", and the caller must pass
   * the rail that accepted it — there is no path here that records a delivery
   * nobody performed. Every non-sent outcome carries a human-readable reason
   * into `failure_reason` so the surface can say why.
   */
  async recordReminderOutcome(
    this: DatabaseStorage,
    id: number,
    outcome: {
      status: "sent" | "queued" | "unavailable" | "blocked" | "failed" | "cancelled";
      reason?: string | null;
      /** Rail that accepted the message. Required when status === "sent". */
      acceptedBy?: string | null;
    },
    organizationId?: number,
  ): Promise<PaymentReminder | undefined> {
    if (outcome.status === "sent" && !outcome.acceptedBy) {
      throw new Error(
        "recordReminderOutcome: refusing to mark a borrower reminder 'sent' without the rail that accepted it",
      );
    }
    const conditions = [eq(paymentReminders.id, id)];
    if (organizationId) conditions.push(eq(paymentReminders.organizationId, organizationId));
    const updates: Partial<InsertPaymentReminder> = {
      status: outcome.status,
      failureReason: outcome.status === "sent" ? null : (outcome.reason ?? null),
    };
    if (outcome.status === "sent") updates.sentAt = new Date();
    const [updated] = await db.update(paymentReminders)
      .set(updates)
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
