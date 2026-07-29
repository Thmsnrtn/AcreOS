// ============================================================================
// SHARED/SCHEMA/ACH-AUTOPAY.TS
// ----------------------------------------------------------------------------
// Borrower ACH autopay — the NACHA authorization record and the per-period
// debit attempt ledger.
//
// WHY THIS EXISTS (Wave C "Money moves", founder ruling #12(c), 2026-07-29)
// ────────────────────────────────────────────────────────────────────────
// The borrower portal shipped an autopay Switch that wrote exactly one
// boolean — `notes.auto_pay_enabled` — and nothing else. No debit was ever
// scheduled; the only reader of the flag was cashFlowForecaster, which used
// it to *predict* money that would never be collected. The toggle told the
// borrower "Autopay is on — we'll collect this payment automatically" and
// then did nothing at all.
//
// Making the toggle real requires two things a boolean cannot carry:
//
//   1. AUTHORIZATION (`ach_mandates`). NACHA Operating Rules §2.3 require the
//      Originator to obtain and RETAIN the Receiver's authorization for every
//      consumer debit, and to be able to produce it on demand (2 years past
//      revocation). A boolean is not an authorization. This table stores the
//      exact text the borrower agreed to, when, from which IP/UA, the dollar
//      ceiling and frequency authorized, and the processor's own corroborating
//      mandate id — so a debit is defensible rather than merely intended.
//
//   2. IDEMPOTENCY (`ach_debit_attempts`). One row per (note, period,
//      attempt). The unique index IS the double-charge guard: a duplicate job
//      run, a double-click, or a crash-and-retry all collide on
//      (note_id, period_key, attempt_number) and lose the insert BEFORE any
//      money moves. The same key is replayed to the processor as its
//      idempotency key, and the resulting PaymentIntent id becomes the
//      `payments.transaction_id` — three independent layers, so no single
//      failure can produce two debits.
//
// PII discipline: full bank account and routing numbers NEVER land here. The
// processor holds the instrument; we hold a last-4, a bank name, and opaque
// processor handles.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import type { z } from "zod";
import { organizations, notes, leads, payments } from "../schema";

/**
 * The rails a mandate can be held on. Only `stripe_us_bank_account` is
 * implemented; `actum` is listed because the ACH return-code taxonomy in
 * server/services/actumProcessing.ts predates this table and a future Actum
 * merchant account would store mandates in the same shape.
 */
export const ACH_MANDATE_RAILS = ["stripe_us_bank_account", "actum"] as const;
export type AchMandateRail = (typeof ACH_MANDATE_RAILS)[number];

/**
 * Mandate lifecycle.
 *  pending     — borrower agreed to our text; the instrument is not yet
 *                confirmed by the processor. NEVER debitable.
 *  active      — agreed AND confirmed. The only debitable state.
 *  revoked     — borrower (or an R05/R07/R08/R10/R29 return) withdrew
 *                authorization. NACHA requires we stop immediately.
 *  invalid     — the bank account itself is unusable (R02/R03/R04/R13/R20).
 *                Needs new bank info, not a retry.
 *  superseded  — replaced by a newer mandate on the same note.
 */
export const ACH_MANDATE_STATUSES = [
  "pending",
  "active",
  "revoked",
  "invalid",
  "superseded",
] as const;
export type AchMandateStatus = (typeof ACH_MANDATE_STATUSES)[number];

export const achMandates = pgTable(
  "ach_mandates",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    noteId: integer("note_id")
      .references(() => notes.id, { onDelete: "cascade" })
      .notNull(),
    // The borrower of record. SET NULL: losing the lead row must never
    // destroy the authorization we are legally required to retain.
    borrowerLeadId: integer("borrower_lead_id").references(() => leads.id, {
      onDelete: "set null",
    }),

    rail: text("rail").notNull().default("stripe_us_bank_account"),

    // ── Processor handles (opaque; no bank credentials) ──────────────────
    // Nullable while status='pending' — we record the borrower's agreement
    // BEFORE the redirect so an abandoned setup is visible instead of lost.
    processorAccountId: text("processor_account_id"), // acct_… (connected account)
    processorCustomerId: text("processor_customer_id"), // cus_…
    processorPaymentMethodId: text("processor_payment_method_id"), // pm_…
    processorMandateId: text("processor_mandate_id"), // mandate_… (processor's own record)
    processorSetupIntentId: text("processor_setup_intent_id"), // seti_…
    /** Checkout/session handle used to complete setup — the confirm key. */
    setupReference: text("setup_reference"),

    // ── Instrument display only ─────────────────────────────────────────
    bankName: text("bank_name"),
    accountLast4: text("account_last4"),
    accountType: text("account_type"), // checking | savings

    // ── The authorization record itself (NACHA §2.3) ────────────────────
    /** VERBATIM text the borrower was shown and agreed to. Never a summary. */
    authorizationText: text("authorization_text").notNull(),
    /** Version stamp of that text, so we can prove which revision applied. */
    authorizationTextVersion: text("authorization_text_version").notNull(),
    /** web | phone | paper — how authorization was obtained. */
    authorizationMethod: text("authorization_method").notNull().default("web"),
    agreedAt: timestamp("agreed_at").notNull(),
    agreedIpAddress: text("agreed_ip_address"),
    agreedUserAgent: text("agreed_user_agent"),
    /** The verified session email that agreed — who, not just when. */
    agreedByEmail: text("agreed_by_email").notNull(),

    // ── Terms authorized (a debit outside these is NOT authorized) ───────
    debitType: text("debit_type").notNull().default("recurring"), // recurring | single
    /**
     * Ceiling per debit, in cents. A scheduled amount above this is REFUSED
     * rather than silently debited — an over-authorization is the single most
     * common source of an unauthorized-debit claim.
     */
    maxAmountCents: integer("max_amount_cents").notNull(),
    frequency: text("frequency").notNull().default("monthly"),
    /** Human schedule the borrower agreed to, e.g. "on the 1st of each month". */
    scheduleDescription: text("schedule_description").notNull(),

    status: text("status").notNull().default("pending"),
    confirmedAt: timestamp("confirmed_at"),
    revokedAt: timestamp("revoked_at"),
    revokedReason: text("revoked_reason"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    index("ach_mandates_note_status_idx").on(table.noteId, table.status),
    // Org-leading composite, not a bare organizationId index: every read of
    // this table is "the mandate(s) for THIS note in THIS org, by status" —
    // notably the supersede-on-confirm sweep. A single-column org index can't
    // serve that, and this is an authorization record on a debit path, so the
    // tenant key belongs at the front of the index and of the query.
    index("ach_mandates_org_note_status_idx").on(
      table.organizationId,
      table.noteId,
      table.status,
    ),
    // The confirm callback looks the pending mandate up by this handle.
    uniqueIndex("ach_mandates_setup_reference_uidx").on(table.setupReference),
  ],
);

/**
 * Debit attempt lifecycle. ACH is not card: `submitted` means the file went
 * out, not that money arrived. Only `succeeded` is settlement, and even a
 * settled debit can be RETURNED days later.
 */
export const ACH_DEBIT_STATUSES = [
  "created",
  "submitted",
  "processing",
  "succeeded",
  "returned",
  "failed",
  "canceled",
] as const;
export type AchDebitStatus = (typeof ACH_DEBIT_STATUSES)[number];

export const achDebitAttempts = pgTable(
  "ach_debit_attempts",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    noteId: integer("note_id")
      .references(() => notes.id, { onDelete: "cascade" })
      .notNull(),
    mandateId: integer("mandate_id")
      .references(() => achMandates.id, { onDelete: "restrict" })
      .notNull(),

    // ── Idempotency ──────────────────────────────────────────────────────
    /** The billing period, as the due date's UTC day (YYYY-MM-DD). */
    periodKey: text("period_key").notNull(),
    /** 1 = first presentment. NACHA permits at most 2 re-presentments. */
    attemptNumber: integer("attempt_number").notNull().default(1),
    /**
     * `ach:note:<noteId>:<periodKey>:a<attemptNumber>` — replayed to the
     * processor as its idempotency key so a crash between our INSERT and the
     * processor's response cannot mint a second debit.
     */
    idempotencyKey: text("idempotency_key").notNull(),

    amountCents: integer("amount_cents").notNull(),
    dueDate: timestamp("due_date").notNull(),

    status: text("status").notNull().default("created"),
    processorPaymentIntentId: text("processor_payment_intent_id"),
    processorChargeId: text("processor_charge_id"),

    // ── Return handling ──────────────────────────────────────────────────
    returnCode: text("return_code"), // R01 … R29
    returnCategory: text("return_category"),
    returnedAt: timestamp("returned_at"),
    failureReason: text("failure_reason"),
    /** Set when the return was re-presented; null = terminal. */
    nextRetryAt: timestamp("next_retry_at"),
    retryOfAttemptId: integer("retry_of_attempt_id"),

    // ── Ledger linkage (written once, after the posting tx commits) ───────
    paymentId: integer("payment_id").references(() => payments.id, {
      onDelete: "set null",
    }),
    /** The reversal row posted when an already-posted debit is returned. */
    reversalPaymentId: integer("reversal_payment_id").references(
      () => payments.id,
      { onDelete: "set null" },
    ),

    submittedAt: timestamp("submitted_at"),
    settledAt: timestamp("settled_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => [
    // THE double-charge guard. One presentment per (note, period, attempt).
    uniqueIndex("ach_debit_attempts_period_uidx").on(
      table.noteId,
      table.periodKey,
      table.attemptNumber,
    ),
    uniqueIndex("ach_debit_attempts_idem_uidx").on(table.idempotencyKey),
    uniqueIndex("ach_debit_attempts_pi_uidx").on(table.processorPaymentIntentId),
    index("ach_debit_attempts_status_idx").on(table.status),
    index("ach_debit_attempts_retry_idx").on(table.nextRetryAt),
    index("ach_debit_attempts_org_note_idx").on(
      table.organizationId,
      table.noteId,
    ),
  ],
);

export const insertAchMandateSchema = createInsertSchema(achMandates).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertAchMandate = z.infer<typeof insertAchMandateSchema>;
export type AchMandate = typeof achMandates.$inferSelect;

export const insertAchDebitAttemptSchema = createInsertSchema(
  achDebitAttempts,
).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAchDebitAttempt = z.infer<typeof insertAchDebitAttemptSchema>;
export type AchDebitAttempt = typeof achDebitAttempts.$inferSelect;
