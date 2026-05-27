// ============================================================================
// SHARED/SCHEMA/ACCOUNTING-OPS.TS
// ----------------------------------------------------------------------------
// Accounting + ops bucket — chart of accounts / GL, recognition worker / 1099
// batches, outbox + DLQ + job runs, support saved replies, critical alert
// acks, VM resource usage, lifecycle program, team readiness, property vision
// snapshots, Hartwell title-partner API.
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  bigint,
  bigserial,
  boolean,
  timestamp,
  numeric,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  date,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import {
  organizations,
  properties,
  deals,
  offers,
  notifications,
  systemAlerts,
} from "../schema";

// ============================================
// CHART OF ACCOUNTS / GENERAL LEDGER (Lavender §1, Hilda §2)
// ============================================
//
// Foundation for AcreOS's monthly-close pipeline. This PR ships the schema
// + seed only — recognition worker, trial-balance generator, GL-PDF, and
// IIF/QBO export are scheduled for Lavender Week 10 (see
// docs/exhaustive-completion/lavender-week10-todo.md).
//
//   * `chartOfAccounts`        — per-org tree of accounts. Customer-defined
//                                accountNumber so orgs can mirror their CPA
//                                or QBO chart. parentAccountId enables
//                                hierarchy (e.g. 1500-Property → 1510-Land).
//   * `accountLedgerEntries`   — single-leg double-entry rows: every
//                                business event posts ≥2 rows (one debit,
//                                one credit) referencing the same source.
//                                The CHECK constraint enforces "exactly one
//                                side > 0" so no row can be both sides at
//                                once. Aggregating debits − credits per
//                                account gives the running balance.
//
// All amounts are bigint cents — never floats. UUIDs (varchar +
// gen_random_uuid()) follow the project convention used by email_events
// and friends.

export const chartOfAccounts = pgTable(
  "chart_of_accounts",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    accountNumber: text("account_number").notNull(), // e.g. "1000", "4000-CASH"
    accountName: text("account_name").notNull(),
    accountType: text("account_type").notNull(), // asset|liability|equity|revenue|expense|contra_asset|contra_revenue
    parentAccountId: varchar("parent_account_id"),
    isActive: boolean("is_active").default(true).notNull(),
    description: text("description"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    orgNumberUnique: uniqueIndex("chart_of_accounts_org_number_unique").on(
      table.organizationId,
      table.accountNumber,
    ),
    byOrgType: index("chart_of_accounts_org_type_idx").on(
      table.organizationId,
      table.accountType,
    ),
  }),
);

export const accountLedgerEntries = pgTable(
  "account_ledger_entries",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    accountId: varchar("account_id")
      .references(() => chartOfAccounts.id, { onDelete: "restrict" })
      .notNull(),
    // bigint mode "number" — JS numbers safely represent values up to
    // 2^53 cents (~$90 trillion). We never expect a single ledger row
    // to exceed that, and "number" keeps arithmetic (debit − credit
    // aggregation) ergonomic without BigInt coercion.
    debit: bigint("debit", { mode: "number" }).default(0).notNull(),
    credit: bigint("credit", { mode: "number" }).default(0).notNull(),
    description: text("description"),
    referenceType: text("reference_type"), // invoice | payment | manual | stripe_charge | ...
    referenceId: text("reference_id"),
    bookingDate: date("booking_date").notNull(),
    postedAt: timestamp("posted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    // Database-level invariant: every row is exactly one side of the
    // double-entry pair. Application code must always insert a matched
    // pair (or n-tuple) inside a single transaction.
    debitXorCredit: check(
      "account_ledger_entries_debit_xor_credit",
      sql`(${table.debit} > 0 AND ${table.credit} = 0) OR (${table.debit} = 0 AND ${table.credit} > 0)`,
    ),
    nonNegative: check(
      "account_ledger_entries_non_negative",
      sql`${table.debit} >= 0 AND ${table.credit} >= 0`,
    ),
    byOrgBookingDate: index("account_ledger_entries_org_booking_idx").on(
      table.organizationId,
      table.bookingDate,
    ),
    byAccountBookingDate: index("account_ledger_entries_account_booking_idx").on(
      table.accountId,
      table.bookingDate,
    ),
    byReference: index("account_ledger_entries_reference_idx").on(
      table.referenceType,
      table.referenceId,
    ),
  }),
);

export const chartOfAccountsRelations = relations(chartOfAccounts, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [chartOfAccounts.organizationId],
    references: [organizations.id],
  }),
  parent: one(chartOfAccounts, {
    fields: [chartOfAccounts.parentAccountId],
    references: [chartOfAccounts.id],
    relationName: "chart_of_accounts_parent",
  }),
  children: many(chartOfAccounts, { relationName: "chart_of_accounts_parent" }),
  entries: many(accountLedgerEntries),
}));

export const accountLedgerEntriesRelations = relations(accountLedgerEntries, ({ one }) => ({
  organization: one(organizations, {
    fields: [accountLedgerEntries.organizationId],
    references: [organizations.id],
  }),
  account: one(chartOfAccounts, {
    fields: [accountLedgerEntries.accountId],
    references: [chartOfAccounts.id],
  }),
}));

export const insertChartOfAccountSchema = createInsertSchema(chartOfAccounts).omit({
  id: true,
  createdAt: true,
});
export type ChartOfAccount = typeof chartOfAccounts.$inferSelect;
export type InsertChartOfAccount = z.infer<typeof insertChartOfAccountSchema>;

export const insertAccountLedgerEntrySchema = createInsertSchema(accountLedgerEntries).omit({
  id: true,
  postedAt: true,
});
export type AccountLedgerEntry = typeof accountLedgerEntries.$inferSelect;
export type InsertAccountLedgerEntry = z.infer<typeof insertAccountLedgerEntrySchema>;

export type AccountType =
  | "asset"
  | "liability"
  | "equity"
  | "revenue"
  | "expense"
  | "contra_asset"
  | "contra_revenue";

// ============================================================================
// RECOGNITION WORKER + 1099 BATCHES — Lavender / Olympia Week 10
// ----------------------------------------------------------------------------
// Backed by migrations/0059_recognition_worker.sql. The recognition worker
// drains `recognitionSchedules` on a monthly cadence and posts a
// matched-pair into `accountLedgerEntries` (DR Deferred Revenue / CR
// Subscription Revenue). `recognitionRuns` is an append-only audit trail
// for the worker. `form1099Batches` powers Olympia's batch 1099-INT
// generator — the route returns a jobId, the worker fills in result_blob.
// ============================================================================

export const recognitionSchedules = pgTable(
  "recognition_schedules",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    sourceType: text("source_type").notNull(), // 'stripe_invoice' | 'manual'
    sourceId: text("source_id").notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    balanceRemainingCents: bigint("balance_remaining_cents", { mode: "number" }).notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    monthsTotal: integer("months_total").notNull(),
    monthsRecognised: integer("months_recognised").notNull().default(0),
    status: text("status").notNull().default("active"), // active | completed | cancelled
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => ({
    sourceUnique: uniqueIndex("recognition_schedules_source_unique").on(
      table.organizationId,
      table.sourceType,
      table.sourceId,
    ),
  }),
);

export const recognitionRuns = pgTable("recognition_runs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  runStartedAt: timestamp("run_started_at", { withTimezone: true }).defaultNow().notNull(),
  runCompletedAt: timestamp("run_completed_at", { withTimezone: true }),
  asOfDate: date("as_of_date").notNull(),
  schedulesProcessed: integer("schedules_processed").notNull().default(0),
  entriesPosted: integer("entries_posted").notNull().default(0),
  centsRecognised: bigint("cents_recognised", { mode: "number" }).notNull().default(0),
  status: text("status").notNull().default("running"),
  errorMessage: text("error_message"),
});

export const form1099Batches = pgTable("form_1099_batches", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  taxYear: integer("tax_year").notNull(),
  status: text("status").notNull().default("queued"), // queued | running | success | failure
  formCount: integer("form_count").notNull().default(0),
  totalInterestCents: bigint("total_interest_cents", { mode: "number" }).notNull().default(0),
  resultBlob: jsonb("result_blob").$type<{
    forms?: Array<{ noteId: number; recipientName: string; box1Cents: number }>;
    fireFile?: string;
    pdfPaths?: string[];
    summary?: string;
  } | null>(),
  errorMessage: text("error_message"),
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export type RecognitionSchedule = typeof recognitionSchedules.$inferSelect;
export type InsertRecognitionSchedule = typeof recognitionSchedules.$inferInsert;
export type RecognitionRun = typeof recognitionRuns.$inferSelect;
export type Form1099Batch = typeof form1099Batches.$inferSelect;
export type InsertForm1099Batch = typeof form1099Batches.$inferInsert;

// ============================================================================
// OUTBOX + DLQ + JOB RUNS — Phase 3 Week 7-8
// ----------------------------------------------------------------------------
// Backed by migrations/0046_outbox_jobs.sql. See server/jobs/scheduler.ts for
// the helper that drives `job_runs` + routes terminal failures into
// `outbox_dlq`. The `outbox` table exists so producers can stage outbound
// effects (webhooks, emails, billing events) inside the same DB transaction
// as the state change — eliminating the dual-write problem.
// ============================================================================

export const outbox = pgTable("outbox", {
  id: serial("id").primaryKey(),
  eventType: text("event_type").notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("pending"), // pending | sent | failed
  attempts: integer("attempts").notNull().default(0),
  lastErrorAt: timestamp("last_error_at"),
  lastErrorMessage: text("last_error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  sentAt: timestamp("sent_at"),
}, (table) => [
  index("outbox_status_created_idx").on(table.status, table.createdAt),
  index("outbox_event_type_idx").on(table.eventType),
]);

export const insertOutboxSchema = createInsertSchema(outbox).omit({
  id: true,
  createdAt: true,
  sentAt: true,
});
export type Outbox = typeof outbox.$inferSelect;
export type InsertOutbox = z.infer<typeof insertOutboxSchema>;

export const outboxDlq = pgTable("outbox_dlq", {
  id: serial("id").primaryKey(),
  originalOutboxId: integer("original_outbox_id"),
  eventType: text("event_type").notNull(),
  // Pillar 9.1 — keep the canonical column name for parity with the spec's
  // `jobType` while the rest of the codebase reads `event_type`. Same
  // column; both Drizzle field names point here.
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
  status: text("status").notNull().default("failed"),
  attempts: integer("attempts").notNull().default(0),
  lastErrorAt: timestamp("last_error_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  failedAt: timestamp("failed_at").notNull().defaultNow(),
  failureReason: text("failure_reason").notNull(),
  // Pillar 9.1 — explicit DLQ provenance columns. `lastError` mirrors
  // failureReason but is kept distinct so that callers re-running a row
  // can see the most-recent error after a retry-discard round-trip.
  lastError: text("last_error"),
  failureCount: integer("failure_count").notNull().default(0),
  firstFailedAt: timestamp("first_failed_at"),
  lastFailedAt: timestamp("last_failed_at"),
  movedToDlqAt: timestamp("moved_to_dlq_at").notNull().defaultNow(),
}, (table) => [
  index("outbox_dlq_event_type_idx").on(table.eventType),
  index("outbox_dlq_failed_at_idx").on(table.failedAt),
  index("outbox_dlq_moved_at_idx").on(table.movedToDlqAt),
]);

export const insertOutboxDlqSchema = createInsertSchema(outboxDlq).omit({
  id: true,
  createdAt: true,
  failedAt: true,
});
export type OutboxDlq = typeof outboxDlq.$inferSelect;
export type InsertOutboxDlq = z.infer<typeof insertOutboxDlqSchema>;

export const jobRuns = pgTable("job_runs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull(),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("running"), // running | success | failure | timeout
  errorMessage: text("error_message"),
  recordsProcessed: integer("records_processed"),
}, (table) => [
  index("job_runs_job_name_started_idx").on(table.jobName, table.startedAt),
  index("job_runs_status_idx").on(table.status),
]);

export const insertJobRunSchema = createInsertSchema(jobRuns).omit({
  id: true,
  startedAt: true,
});
export type JobRun = typeof jobRuns.$inferSelect;
export type InsertJobRun = z.infer<typeof insertJobRunSchema>;

// ============================================
// SUPPORT SAVED REPLIES (operator pre-canned responses)
// ============================================
// Pre-canned operator responses for the customer-support inbox.
// `organizationId` is nullable: NULL = globally available reply curated by
// the founder/ops team. Non-null = scoped to a specific customer org so
// VIP-specific phrasing can live alongside the generic library.
export const supportSavedReplies = pgTable("support_saved_replies", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  body: text("body").notNull(),
  createdBy: text("created_by").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSupportSavedReplySchema = createInsertSchema(supportSavedReplies).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type SupportSavedReply = typeof supportSavedReplies.$inferSelect;
export type InsertSupportSavedReply = z.infer<typeof insertSupportSavedReplySchema>;

// ============================================
// CRITICAL ALERT ACKS (P0/P1 ack-timer tracking)
// ============================================
// Per-notification ack tracking driving the founder-bell "Critical alerts"
// view. We track ack state ourselves; actual paging integrations
// (PagerDuty/Opsgenie) plug in later by reading this table.
export const criticalAlertAcks = pgTable("critical_alert_acks", {
  id: serial("id").primaryKey(),
  notificationId: integer("notification_id").references(() => notifications.id, { onDelete: "cascade" }),
  severity: text("severity").notNull(), // 'P0' | 'P1'
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull(),
  ackDeadlineAt: timestamp("ack_deadline_at", { withTimezone: true }).notNull(),
  ackedAt: timestamp("acked_at", { withTimezone: true }),
  ackedBy: text("acked_by"),
  escalatedAt: timestamp("escalated_at", { withTimezone: true }),
  escalationTarget: text("escalation_target"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertCriticalAlertAckSchema = createInsertSchema(criticalAlertAcks).omit({
  id: true,
  createdAt: true,
});
export type CriticalAlertAck = typeof criticalAlertAcks.$inferSelect;
export type InsertCriticalAlertAck = z.infer<typeof insertCriticalAlertAckSchema>;

// ============================================
// VM RESOURCE USAGE (Fly.io rightsizing tracker — migration 0061)
// ============================================
// 5-minute samples of memory + CPU utilisation per Fly machine. Powers the
// founder's "is the 2× performance / 4GB box right-sized?" review. Auto-
// flipping VM size is intentionally NOT done off this table — an operator
// reviews 7+ days of data first.
export const vmResourceUsage = pgTable("vm_resource_usage", {
  id: bigserial("id", { mode: "number" }).primaryKey(),
  machineId: text("machine_id").notNull(),
  region: text("region"),
  processGroup: text("process_group"), // 'app' | 'worker'
  capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
  rssBytes: bigint("rss_bytes", { mode: "number" }).notNull(),
  heapUsedBytes: bigint("heap_used_bytes", { mode: "number" }).notNull(),
  heapTotalBytes: bigint("heap_total_bytes", { mode: "number" }).notNull(),
  externalBytes: bigint("external_bytes", { mode: "number" }).notNull(),
  arrayBuffersBytes: bigint("array_buffers_bytes", { mode: "number" }).notNull(),
  cpuUserUs: bigint("cpu_user_us", { mode: "number" }).notNull(),
  cpuSystemUs: bigint("cpu_system_us", { mode: "number" }).notNull(),
  cpuPercent: numeric("cpu_percent", { precision: 5, scale: 2 }).notNull(),
  cpuCount: integer("cpu_count").notNull(),
  loadAvg1m: numeric("load_avg_1m", { precision: 6, scale: 2 }),
  eventLoopLagMs: numeric("event_loop_lag_ms", { precision: 8, scale: 2 }),
  totalMemoryBytes: bigint("total_memory_bytes", { mode: "number" }),
  uptimeSeconds: integer("uptime_seconds").notNull(),
  nodeVersion: text("node_version"),
  appVersion: text("app_version"),
});

export type VmResourceUsage = typeof vmResourceUsage.$inferSelect;
export type InsertVmResourceUsage = typeof vmResourceUsage.$inferInsert;

// ============================================================================
// LIFECYCLE PROGRAM — Phase 4 Week 17-18
// ----------------------------------------------------------------------------
// Backed by migrations/0064_lifecycle_program.sql. See
// server/services/lifecycleProgram.ts for the dispatcher and
// shared/lifecycle/messages.ts for the canonical key registry.
// ============================================================================

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: serial("id").primaryKey(),
    key: text("key").notNull(),
    version: integer("version").notNull().default(1),
    channel: text("channel").notNull().default("email"), // email | sms
    subject: text("subject"),
    body: text("body").notNull(),
    category: text("category").notNull().default("lifecycle.general"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (table) => [
    index("email_templates_key_active_idx").on(table.key, table.active),
    index("email_templates_category_idx").on(table.category),
  ],
);

export type EmailTemplate = typeof emailTemplates.$inferSelect;
export type InsertEmailTemplate = typeof emailTemplates.$inferInsert;

export const lifecycleMessageSends = pgTable(
  "lifecycle_message_sends",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    userId: varchar("user_id"),
    templateKey: text("template_key").notNull(),
    templateVersion: integer("template_version"),
    channel: text("channel").notNull().default("email"),
    recipientEmail: text("recipient_email"),
    recipientPhone: text("recipient_phone"),
    category: text("category").notNull().default("lifecycle.general"),
    status: text("status").notNull().default("queued"), // queued | sent | suppressed | skipped
    outboxId: integer("outbox_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    sentAt: timestamp("sent_at").notNull().defaultNow(),
  },
  (table) => [
    index("lifecycle_message_sends_org_template_idx").on(
      table.organizationId,
      table.templateKey,
      table.sentAt,
    ),
    index("lifecycle_message_sends_org_category_idx").on(
      table.organizationId,
      table.category,
      table.sentAt,
    ),
    index("lifecycle_message_sends_recipient_idx").on(table.recipientEmail),
  ],
);

export type LifecycleMessageSend = typeof lifecycleMessageSends.$inferSelect;
export type InsertLifecycleMessageSend = typeof lifecycleMessageSends.$inferInsert;

export const reactivationTokens = pgTable(
  "reactivation_tokens",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    issuedAt: timestamp("issued_at").notNull().defaultNow(),
    expiresAt: timestamp("expires_at").notNull(),
    redeemedAt: timestamp("redeemed_at"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
  },
  (table) => [
    index("reactivation_tokens_org_idx").on(table.organizationId),
    index("reactivation_tokens_expires_idx").on(table.expiresAt),
  ],
);

export type ReactivationToken = typeof reactivationTokens.$inferSelect;
export type InsertReactivationToken = typeof reactivationTokens.$inferInsert;

// ─── Compliance Validations (Phase 4 W21-22 — Theo §8 / Sayuri §2.3) ─────────
// Append-only log of every post-validator run on a customer-facing AI surface
// that touches a regulated domain. See server/services/complianceValidator.ts.
export const complianceValidations = pgTable("compliance_validations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  organizationId: integer("organization_id"),
  surface: text("surface").notNull(),
  domain: text("domain").notNull(),
  inputHash: text("input_hash").notNull(),
  verdict: text("verdict").notNull(), // 'pass' | 'block' | 'amend' | 'error'
  missingPhrases: jsonb("missing_phrases").$type<string[]>(),
  prependedDisclosure: text("prepended_disclosure"),
  validatorModel: text("validator_model").notNull(),
  thinkingBudget: integer("thinking_budget"),
  latencyMs: integer("latency_ms"),
  rationale: text("rationale"),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("compliance_validations_org_idx").on(table.organizationId, table.createdAt),
  index("compliance_validations_surface_idx").on(table.surface, table.createdAt),
  index("compliance_validations_verdict_idx").on(table.verdict, table.createdAt),
]);

export type ComplianceValidation = typeof complianceValidations.$inferSelect;
export type InsertComplianceValidation = typeof complianceValidations.$inferInsert;

// ─── Prompt Versions (Phase 4 W21-22 — Nadia-AI §2.A) ────────────────────────
// One row per (prompt_name, version). The promptRegistry rolls weighted dice
// at request time and stamps the chosen version onto every response.
export const promptVersions = pgTable("prompt_versions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  promptName: text("prompt_name").notNull(),
  version: text("version").notNull(),
  system: text("system").notNull(),
  tier: text("tier").notNull().default("standard"),
  hash: text("hash").notNull(),
  weight: integer("weight").notNull().default(0),
  evalScore: numeric("eval_score", { precision: 5, scale: 4 }),
  evalRunAt: timestamp("eval_run_at", { withTimezone: true }),
  active: boolean("active").notNull().default(true),
  isCandidate: boolean("is_candidate").notNull().default(false),
  promotedFrom: varchar("promoted_from"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("prompt_versions_name_version_unique").on(table.promptName, table.version),
  index("prompt_versions_active_idx").on(table.promptName, table.active),
]);

export type PromptVersionRow = typeof promptVersions.$inferSelect;
export type InsertPromptVersion = typeof promptVersions.$inferInsert;

// ─── AI Injection Attempts (Phase 4 W21-22 — Sayuri §2.3 hardening) ──────────
// Per-user log of detected indirect-prompt-injection attempts. The rate
// limiter scans the last hour and blocks new AI calls when a user crosses
// the threshold.
export const aiInjectionAttempts = pgTable("ai_injection_attempts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: text("user_id"),
  organizationId: integer("organization_id"),
  surface: text("surface").notNull(),
  matchedPatterns: jsonb("matched_patterns").$type<string[]>(),
  inputPreview: text("input_preview"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("ai_injection_attempts_user_idx").on(table.userId, table.createdAt),
  index("ai_injection_attempts_org_idx").on(table.organizationId, table.createdAt),
]);

export type AiInjectionAttempt = typeof aiInjectionAttempts.$inferSelect;
export type InsertAiInjectionAttempt = typeof aiInjectionAttempts.$inferInsert;

// ============================================================================
// TEAM READINESS — Phase 5 §5
// ============================================================================
// Per-seat pricing, round-robin lead assignment, Slack/Teams webhooks, and
// offer-approval queue. See migrations/0066_team_readiness.sql for the
// rationale and schema definitions.

export const leadAssignmentRules = pgTable("lead_assignment_rules", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  name: text("name").notNull(),
  // round_robin | territory | random
  ruleType: text("rule_type").notNull(),
  // Lower number = higher priority. First match in priority order wins.
  priority: integer("priority").notNull().default(100),
  territoryFilter: jsonb("territory_filter").$type<{
    states?: string[];
    counties?: string[];
  }>(),
  weightedAssignees: jsonb("weighted_assignees").$type<Array<{ teamMemberId: number; weight: number }>>(),
  isDefault: boolean("is_default").notNull().default(false),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("lead_assignment_rules_org_idx").on(table.organizationId, table.isActive, table.priority),
]);

export type LeadAssignmentRule = typeof leadAssignmentRules.$inferSelect;
export type InsertLeadAssignmentRule = typeof leadAssignmentRules.$inferInsert;

export const orgAssignmentCursor = pgTable("org_assignment_cursor", {
  ruleId: integer("rule_id").primaryKey().references(() => leadAssignmentRules.id, { onDelete: "cascade" }),
  cursorIndex: integer("cursor_index").notNull().default(0),
  lastAssignedTo: integer("last_assigned_to"),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export type OrgAssignmentCursor = typeof orgAssignmentCursor.$inferSelect;
export type InsertOrgAssignmentCursor = typeof orgAssignmentCursor.$inferInsert;

export const orgIntegrationsSlack = pgTable("org_integrations_slack", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  // slack | teams
  provider: text("provider").notNull().default("slack"),
  webhookUrl: text("webhook_url").notNull(),
  channelName: text("channel_name"),
  eventTypes: text("event_types").array().notNull().default(sql`ARRAY['deal_closed','big_lead_arrived']::TEXT[]`),
  isActive: boolean("is_active").notNull().default(true),
  lastDispatchedAt: timestamp("last_dispatched_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("org_integrations_slack_org_provider_idx").on(table.organizationId, table.provider),
]);

export type OrgIntegrationSlack = typeof orgIntegrationsSlack.$inferSelect;
export type InsertOrgIntegrationSlack = typeof orgIntegrationsSlack.$inferInsert;

export const offerApprovals = pgTable("offer_approvals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  offerId: integer("offer_id").references(() => offers.id, { onDelete: "cascade" }).notNull(),
  submittedBy: text("submitted_by").notNull(),
  // pending | approved | declined
  status: text("status").notNull().default("pending"),
  reviewerId: text("reviewer_id"),
  reviewerNotes: text("reviewer_notes"),
  thresholdAmount: numeric("threshold_amount").notNull(),
  offerAmount: numeric("offer_amount").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  decidedAt: timestamp("decided_at"),
}, (table) => [
  index("offer_approvals_org_status_idx").on(table.organizationId, table.status, table.createdAt),
]);

export type OfferApproval = typeof offerApprovals.$inferSelect;
export type InsertOfferApproval = typeof offerApprovals.$inferInsert;

// =================================================================
// PROPERTY VISION SNAPSHOTS — Ingrid §1 Vision-AI scheduled re-imaging
// =================================================================
// Periodic aerial/satellite imagery capture per property with vision-AI
// change detection. Distinct from satelliteSnapshots (raw imagery feed):
// these rows represent scheduled vision-AI runs that compare against the
// prior snapshot for the same property and raise system_alerts when the
// changeDetectionScore exceeds the configured threshold.
//
// Re-imaging cadence defaults to 90 days, override via env
// VISION_REIMAGING_INTERVAL_DAYS (per-org override is a future iteration).
export const propertyVisionSnapshots = pgTable("property_vision_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  propertyId: integer("property_id")
    .references(() => properties.id, { onDelete: "cascade" })
    .notNull(),

  // Capture metadata
  capturedAt: timestamp("captured_at").notNull().defaultNow(),
  imageS3Key: text("image_s3_key").notNull(),
  imageUrl: text("image_url"), // optional public/signed URL
  provider: text("provider"), // mapbox, google_earth, sentinel, mock
  resolution: numeric("resolution"), // metres per pixel

  // Vision-AI analysis
  analysisJsonb: jsonb("analysis_jsonb").$type<{
    detectedFeatures?: Array<{
      label: string;
      confidence: number;
      bbox?: [number, number, number, number];
    }>;
    structureCount?: number;
    vegetationCoveragePct?: number;
    notableChanges?: string[];
    rawModelResponse?: Record<string, any>;
  }>(),

  // Change detection (vs. prior snapshot for same property)
  priorSnapshotId: integer("prior_snapshot_id"),
  changeDetectionScore: numeric("change_detection_score"), // 0-100
  changeSummary: text("change_summary"),

  // Alerting
  alertedToOrg: boolean("alerted_to_org").notNull().default(false),
  systemAlertId: integer("system_alert_id").references(() => systemAlerts.id, {
    onDelete: "set null",
  }),

  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("property_vision_snapshots_org_idx").on(table.organizationId),
  index("property_vision_snapshots_property_idx").on(table.propertyId),
  index("property_vision_snapshots_captured_idx").on(table.capturedAt),
]);

export const insertPropertyVisionSnapshotSchema = createInsertSchema(propertyVisionSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertPropertyVisionSnapshot = z.infer<typeof insertPropertyVisionSnapshotSchema>;
export type PropertyVisionSnapshot = typeof propertyVisionSnapshots.$inferSelect;

// ============================================
// HARTWELL TITLE-PARTNER API — Phase 7 Months 7
// ============================================
// Partner-tier API: title companies receive title-order requests, send back
// title-status webhooks, and exchange ALTA-Pillar-2-compliant wire
// instructions. See migrations/0068_title_partners.sql + docs/api/
// title-partners-v1.md for the exchange schema.

export const titlePartners = pgTable("title_partners", {
  id: serial("id").primaryKey(),
  // NULL = platform-default partner (any org can route to it).
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }),
  partnerName: text("partner_name").notNull(),
  contactEmail: text("contact_email").notNull(),
  contactPhone: text("contact_phone").notNull(),
  territoryStates: text("territory_states").array().notNull().default(sql`ARRAY[]::TEXT[]`),
  territoryCounties: text("territory_counties").array().notNull().default(sql`ARRAY[]::TEXT[]`),
  apiKeyHash: text("api_key_hash").notNull(),
  hmacSecretEncrypted: text("hmac_secret_encrypted").notNull(),
  webhookUrl: text("webhook_url").notNull(),
  // pilot | standard | volume | enterprise
  volumePricingTier: text("volume_pricing_tier").notNull().default("pilot"),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  index("title_partners_active_idx").on(table.isActive, table.volumePricingTier),
]);

export type TitlePartner = typeof titlePartners.$inferSelect;
export type InsertTitlePartner = typeof titlePartners.$inferInsert;
export const insertTitlePartnerSchema = createInsertSchema(titlePartners).omit({
  id: true,
  createdAt: true,
});

export const titleOrders = pgTable("title_orders", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  dealId: integer("deal_id").references(() => deals.id, { onDelete: "cascade" }).notNull(),
  titlePartnerId: integer("title_partner_id").references(() => titlePartners.id, { onDelete: "set null" }),
  // pending | assigned | in_progress | commitment_issued | schedule_b_issued |
  //   policy_issued | wire_instructions_issued | closed | cancelled
  status: text("status").notNull().default("pending"),
  statusDetails: jsonb("status_details").$type<Record<string, unknown>>().notNull().default({}),
  propertyAddress: jsonb("property_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    state: string;
    county?: string;
    zip: string;
  }>().notNull(),
  buyerInfo: jsonb("buyer_info").$type<{
    name: string;
    email?: string;
    phone?: string;
    entityType?: string;
  }>().notNull(),
  sellerInfo: jsonb("seller_info").$type<{
    name: string;
    email?: string;
    phone?: string;
    entityType?: string;
  }>().notNull(),
  salePrice: numeric("sale_price").notNull(),
  expectedClosingDate: date("expected_closing_date").notNull(),
  estimatedDeliveryDate: date("estimated_delivery_date"),
  commitmentS3Key: text("commitment_s3_key"),
  scheduleBS3Key: text("schedule_b_s3_key"),
  policyS3Key: text("policy_s3_key"),
  wireInstructionsPdfS3Key: text("wire_instructions_pdf_s3_key"),
  wireInstructionsPasswordHint: text("wire_instructions_password_hint"),
  wireInstructionsHmac: text("wire_instructions_hmac"),
  wireInstructionsIssuedAt: timestamp("wire_instructions_issued_at"),
  wireConfirmationPhone: text("wire_confirmation_phone"),
  wireConfirmedAt: timestamp("wire_confirmed_at"),
  partnerAssignedAt: timestamp("partner_assigned_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("title_orders_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("title_orders_partner_idx").on(table.titlePartnerId, table.status),
  index("title_orders_deal_idx").on(table.dealId),
]);

export type TitleOrder = typeof titleOrders.$inferSelect;
export type InsertTitleOrder = typeof titleOrders.$inferInsert;
export const insertTitleOrderSchema = createInsertSchema(titleOrders).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
