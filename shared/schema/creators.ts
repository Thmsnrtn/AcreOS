/**
 * Creator revenue share (W3 acquisition engine) — two tables, both platform
 * records about AcreOS's OWN money, never a tenant's data.
 *
 *   creators             — who may share a ?ref=CODE link. Founder-managed.
 *   creator_conversions  — one row per PAID invoice of a customer whose signup
 *                          arrived with a creator's code; the commission (when
 *                          the founder has set a rate) and the payout trail.
 *
 * Attribution itself is NOT a third table: the code is captured at signup in
 * users.acquisition_utm.ref (write-once, first touch — routes-acquisition-utm)
 * and resolved against `creators` when an invoice is paid. No customer
 * organization id is stored here; the Stripe invoice id is the key, so a
 * refund can void its conversion. Rules: shared/billing/creatorProgram.ts.
 * Migration: migrations/0273_acquisition_engine.sql (+ scripts/migrate.mjs).
 */
import { pgTable, text, serial, integer, timestamp, index, uniqueIndex } from "drizzle-orm/pg-core";

export const creators = pgTable(
  "creators",
  {
    id: serial("id").primaryKey(),
    /** Upper-case, [A-Z0-9_-]{4,16}; shared in links as ?ref=CODE. */
    code: text("code").notNull(),
    displayName: text("display_name").notNull(),
    /** How the founder reaches them to pay (internal only, never public). */
    contact: text("contact"),
    status: text("status").notNull().default("active"), // active | paused
    createdBy: text("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("creators_code_uq").on(t.code)],
);

export const creatorConversions = pgTable(
  "creator_conversions",
  {
    id: serial("id").primaryKey(),
    creatorId: integer("creator_id")
      .notNull()
      .references(() => creators.id),
    /** The paid invoice — one conversion per invoice, ever. */
    stripeInvoiceId: text("stripe_invoice_id").notNull(),
    amountPaidCents: integer("amount_paid_cents").notNull(),
    currency: text("currency").notNull().default("usd"),
    paidAt: timestamp("paid_at", { withTimezone: true }).notNull(),
    /** The rate in force when recorded; null while the founder has set none. */
    commissionBps: integer("commission_bps"),
    commissionCents: integer("commission_cents"),
    /** rate_unset | owed | approved | paid | void */
    status: text("status").notNull(),
    /** Payout trail — set by the founder; AcreOS moves no money itself. */
    payoutBatch: text("payout_batch"),
    approvedBy: text("approved_by"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    paidReference: text("paid_reference"),
    payoutPaidAt: timestamp("payout_paid_at", { withTimezone: true }),
    voidReason: text("void_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("creator_conversions_invoice_uq").on(t.stripeInvoiceId),
    index("creator_conversions_creator_status_idx").on(t.creatorId, t.status),
  ],
);

export type Creator = typeof creators.$inferSelect;
export type CreatorConversion = typeof creatorConversions.$inferSelect;
