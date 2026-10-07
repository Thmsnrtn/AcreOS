/**
 * billing-platform — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - DUNNING & PAYMENT RECOVERY
 *   - DEFERRED REVENUE (Phase 3 Week 10)
 *   - CANCELLATION SURVEYS & REFUND REQUESTS
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, bigint, boolean, timestamp, jsonb, index, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "../db/createInsertSchema";
import { z } from "zod";
import { organizations } from "../schema";

// ============================================
// DUNNING & PAYMENT RECOVERY
// ============================================

// Dunning stages for progressive enforcement
export const DUNNING_STAGES = {
  none: { name: "Active", accessLevel: "full" },
  grace_period: { name: "Grace Period", accessLevel: "full" },
  warning: { name: "Payment Warning", accessLevel: "full" },
  restricted: { name: "Restricted", accessLevel: "limited" },
  suspended: { name: "Suspended", accessLevel: "none" },
  cancelled: { name: "Cancelled", accessLevel: "none" },
} as const;

export type DunningStage = keyof typeof DUNNING_STAGES;

// Dunning events track each payment failure and recovery attempt
export const dunningEvents = pgTable("dunning_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  
  // Stripe references
  stripeSubscriptionId: text("stripe_subscription_id"),
  stripeInvoiceId: text("stripe_invoice_id"),
  stripeCustomerId: text("stripe_customer_id"),
  
  // Event details
  eventType: text("event_type").notNull(), // payment_failed, payment_succeeded, subscription_cancelled, etc.
  attemptNumber: integer("attempt_number").notNull().default(1),
  amountDueCents: integer("amount_due_cents"),
  amountPaidCents: integer("amount_paid_cents"),
  
  // Status tracking
  status: text("status").notNull().default("pending"), // pending, scheduled_retry, resolved, failed_final, escalated
  dunningStage: text("dunning_stage").notNull().default("grace_period"), // current stage at time of event
  
  // Retry scheduling
  nextRetryAt: timestamp("next_retry_at"),
  retryCount: integer("retry_count").default(0),
  maxRetries: integer("max_retries").default(4),
  
  // Notifications
  notificationsSent: jsonb("notifications_sent").$type<Array<{
    type: string;
    sentAt: string;
    channel: string;
  }>>(),
  
  // Resolution
  resolvedAt: timestamp("resolved_at"),
  resolutionType: text("resolution_type"), // auto_recovered, manual_payment, subscription_cancelled, escalated

  // Phase 3 W10 — SMS leg throttle. Set the first time a dunning SMS is
  // dispatched in a sequence; checked before sending again so we never spam.
  smsSentAt: timestamp("sms_sent_at"),

  // Metadata
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  errorMessage: text("error_message"),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertDunningEventSchema = createInsertSchema(dunningEvents).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertDunningEvent = z.infer<typeof insertDunningEventSchema>;
export type DunningEvent = typeof dunningEvents.$inferSelect;

// Default dunning configuration per tier
export const DUNNING_CONFIG = {
  retryScheduleDays: [3, 5, 7, 14], // Days after initial failure to retry
  // D1 (founder decision 2026-07-11): unattended auto-retry ladder — the
  // dunning sweeper attempts the outstanding invoice itself on these days
  // after the initial failure (distinct from retryScheduleDays, which
  // mirrors Stripe's own smart-retry schedule for stage math). Every
  // attempt is Letter-visible via the activity log.
  autoRetryScheduleDays: [1, 3, 7],
  gracePeriodDays: 3, // Full access for first 3 days
  warningPeriodDays: 7, // Warning stage days 4-7
  restrictedPeriodDays: 14, // Restricted access days 8-14
  finalCancellationDays: 21, // Cancel subscription after 21 days
  notificationSchedule: [
    { dayOffset: 0, type: "payment_failed", channel: "email" },
    { dayOffset: 2, type: "reminder", channel: "email" },
    // Phase 3 W10 — SMS leg fires on day 3 (after grace period). Throttled to
    // exactly one SMS per dunning sequence via dunning_events.sms_sent_at,
    // and respects the per-org notification-prefs override at billing.dunning_sms.
    { dayOffset: 3, type: "dunning_sms", channel: "sms" },
    { dayOffset: 6, type: "warning", channel: "email" },
    { dayOffset: 13, type: "final_notice", channel: "email" },
  ],
} as const;

// ============================================
// DEFERRED REVENUE (Phase 3 Week 10)
// ============================================
// Period-by-period accrual rows. The recognition worker (Week 10+, out of
// scope here) will increment recognized_cents over time. One row per
// (organization, invoice/subscription period). Currency tracked for future
// multi-currency support; defaults to USD.

export const deferredRevenue = pgTable("deferred_revenue", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  subscriptionId: text("subscription_id"), // sub_xxx; null for one-time invoices
  invoiceId: text("invoice_id"),           // in_xxx; useful for recon
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
  recognizedCents: bigint("recognized_cents", { mode: "number" }).notNull().default(0),
  asOfDate: timestamp("as_of_date").defaultNow().notNull(),
  currency: text("currency").notNull().default("usd"),
  metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertDeferredRevenueSchema = createInsertSchema(deferredRevenue).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertDeferredRevenue = z.infer<typeof insertDeferredRevenueSchema>;
export type DeferredRevenueRow = typeof deferredRevenue.$inferSelect;

// ============================================
// CANCELLATION SURVEYS & REFUND REQUESTS
// ============================================

// ── 0198 — Reactivation surveys (win-back "what brought you back") ──────────
// Written by POST /api/subscription/reactivation-survey (welcome-back page).
// Best-effort growth signal — the client swallows failures — but the store
// itself is durable (the 90-day activity_log retention would erase it).
// Mirrors scripts/migrate.mjs STATEMENTS + migrations/0198_reactivation_surveys.sql.
export const reactivationSurveys = pgTable("reactivation_surveys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  userId: text("user_id"),
  // e.g. "missed_features" | "new_deals" | "pricing" | "other" — free string,
  // the client owns the vocabulary.
  returnReason: text("return_reason").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => ({
  byOrgCreated: index("reactivation_surveys_org_created_idx").on(table.organizationId, table.createdAt),
}));

export type ReactivationSurvey = typeof reactivationSurveys.$inferSelect;

export const cancellationSurveys = pgTable("cancellation_surveys", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"),
  reason: text("reason").notNull(), // too_expensive, not_using, missing_features, switching_competitor, other
  feedback: text("feedback"), // optional free-text
  previousTier: text("previous_tier"),
  offeredDowngrade: boolean("offered_downgrade").default(false),
  acceptedDowngrade: boolean("accepted_downgrade").default(false),
  // Tahoe E11: 4th-rung pause flow. `offeredPause` is true any time the
  // cancellation dialog presented the pause option (we always do, but the
  // column is kept for future A/B variants that hide it). `acceptedPause`
  // is true when the user clicked Pause instead of Confirm cancellation,
  // and `pauseDays` records the 30/60/90 choice. When acceptedPause is
  // true the row represents a SAVE — no actual cancellation happened.
  offeredPause: boolean("offered_pause").default(false),
  acceptedPause: boolean("accepted_pause").default(false),
  pauseDays: integer("pause_days"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type CancellationSurvey = typeof cancellationSurveys.$inferSelect;
export type InsertCancellationSurvey = typeof cancellationSurveys.$inferInsert;

export const refundRequests = pgTable("refund_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  userId: text("user_id"),
  stripeChargeId: text("stripe_charge_id"),
  stripePaymentIntentId: text("stripe_payment_intent_id"),
  amountCents: integer("amount_cents").notNull(),
  reason: text("reason"),
  status: text("status").notNull().default("pending"), // pending, approved, denied, processed
  autoApproved: boolean("auto_approved").default(false),
  processedAt: timestamp("processed_at"),
  processedBy: text("processed_by"), // 'auto' or founder user id
  stripeRefundId: text("stripe_refund_id"),
  createdAt: timestamp("created_at").defaultNow(),
});

export type RefundRequest = typeof refundRequests.$inferSelect;
export type InsertRefundRequest = typeof refundRequests.$inferInsert;

