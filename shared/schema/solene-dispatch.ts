// ============================================================================
// SHARED/SCHEMA/SOLENE-DISPATCH.TS
// ----------------------------------------------------------------------------
// Solene — real agent-dispatch queue + result ledger.
//
// Layer 1 capability #1 of the agentic-evolution architecture
// (feedback_agentic_evolution_north_star.md). Replaces the SIMULATED
// dispatch path in server/services/improvement/autoDispatch.ts with a real
// queue that a worker loop drains, invoking the Anthropic SDK with the
// agent_role brief + a minimal tool executor.
//
// Two tables:
//   solene_dispatch_queue     — one row per dispatch request. Status moves
//                               queued -> in_progress -> completed | failed | cancelled.
//   solene_dispatch_results   — one row per terminal outcome, with cost +
//                               token totals + commits/files touched.
//
// Atomic claim (worker pull):
//   SELECT ... FROM solene_dispatch_queue
//     WHERE status='queued'
//     ORDER BY priority DESC, queued_at ASC
//     FOR UPDATE SKIP LOCKED
//     LIMIT 1
//   UPDATE the claimed row to status='in_progress', started_at=now().
// The SKIP LOCKED clause is the canonical Postgres primitive for safe
// concurrent worker pulls — two workers racing the same queue will never
// claim the same row.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_DISPATCH_QUEUE
// ============================================
export const soleneDispatchQueue = pgTable(
  "solene_dispatch_queue",
  {
    id: serial("id").primaryKey(),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    status: text("status").notNull().default("queued"), // see DISPATCH_STATUSES
    priority: numeric("priority", { precision: 8, scale: 3 }).notNull().default("1.000"),
    sourceType: text("source_type").notNull(), // see DISPATCH_SOURCE_TYPES
    sourceId: text("source_id").notNull(), // free-form ref to the trigger
    agentRole: text("agent_role").notNull(), // see DISPATCH_AGENT_ROLES
    promptText: text("prompt_text").notNull(),
    maxCostUsd: numeric("max_cost_usd", { precision: 10, scale: 2 }).notNull(),
    timeoutMs: integer("timeout_ms").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    resultSummary: text("result_summary"),
    resultFullPath: text("result_full_path"),
    // Optional: who/what enqueued this (e.g. opportunity id, founder user id)
    enqueuedBy: text("enqueued_by"),
  },
  (t) => [
    // Fast worker pull: status + priority + queued_at
    index("solene_dispatch_queue_pull_idx").on(t.status, t.priority, t.queuedAt),
    index("solene_dispatch_queue_queued_idx").on(t.queuedAt),
    index("solene_dispatch_queue_status_idx").on(t.status, t.queuedAt),
    index("solene_dispatch_queue_source_idx").on(t.sourceType, t.sourceId),
  ],
);

export type SoleneDispatchQueueRow = typeof soleneDispatchQueue.$inferSelect;
export type InsertSoleneDispatchQueueRow = typeof soleneDispatchQueue.$inferInsert;

// ============================================
// SOLENE_DISPATCH_RESULTS
// ============================================
export const soleneDispatchResults = pgTable(
  "solene_dispatch_results",
  {
    id: serial("id").primaryKey(),
    dispatchId: integer("dispatch_id").notNull(),
    success: boolean("success").notNull(),
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull().default("0"),
    durationMs: integer("duration_ms").notNull().default(0),
    tokenInput: integer("token_input").notNull().default(0),
    tokenOutput: integer("token_output").notNull().default(0),
    errorMessage: text("error_message"),
    commitsReferenced: jsonb("commits_referenced").$type<string[]>(),
    filesModified: jsonb("files_modified").$type<string[]>(),
    followUpOpportunities: jsonb("follow_up_opportunities")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    recordedAt: timestamp("recorded_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("solene_dispatch_results_dispatch_idx").on(t.dispatchId),
    index("solene_dispatch_results_recorded_idx").on(t.recordedAt),
    index("solene_dispatch_results_success_idx").on(t.success, t.recordedAt),
  ],
);

export type SoleneDispatchResultRow = typeof soleneDispatchResults.$inferSelect;
export type InsertSoleneDispatchResultRow =
  typeof soleneDispatchResults.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const DISPATCH_STATUSES = [
  "queued",
  "in_progress",
  "completed",
  "failed",
  "cancelled",
] as const;
export type SoleneDispatchStatus = (typeof DISPATCH_STATUSES)[number];

export const DISPATCH_SOURCE_TYPES = [
  "auto_dispatch",
  "solene_manual",
  "founder_manual",
  "self_audit_drift",
  "detector",
] as const;
export type SoleneDispatchSourceType = (typeof DISPATCH_SOURCE_TYPES)[number];

export const DISPATCH_AGENT_ROLES = [
  "iris",
  "soren",
  "beatrice",
  "krieger",
  "general-purpose",
] as const;
export type SoleneDispatchAgentRole = (typeof DISPATCH_AGENT_ROLES)[number];

// ============================================
// COST CAP — the hard ceiling per dispatch.
// Above this requires a founder override (which today is "set the row
// directly with a higher cap"; surface a founder UI in a follow-up).
// ============================================
export const DISPATCH_MAX_COST_USD = 100;
export const DISPATCH_DEFAULT_COST_USD = 25;
export const DISPATCH_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const DISPATCH_MAX_TURNS = 50;
