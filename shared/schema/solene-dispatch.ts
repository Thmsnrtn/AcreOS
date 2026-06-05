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
    // L2.8 — multi-agent code review
    // When a code-producing dispatch completes, completeDispatch() auto-enqueues
    // a sibling review-dispatch (agentRole='code-reviewer'). The columns below
    // wire the two rows together so reviews are observable + non-recursive.
    //   review_status        — pending | passed | flagged | skipped (null when the
    //                          dispatch produced no commits or hasn't completed yet)
    //   reviewed_by_dispatch_id — id of the review dispatch reviewing THIS row
    //   original_dispatch_id    — when THIS row IS a review, points back at the
    //                             reviewed dispatch. Used as a recursion guard
    //                             (reviews never trigger reviews of themselves).
    reviewStatus: text("review_status"),
    reviewedByDispatchId: integer("reviewed_by_dispatch_id"),
    originalDispatchId: integer("original_dispatch_id"),
    // 2026-06-05 cost audit (batch 5) — optional per-dispatch model override.
    // When NULL, dispatchRunner.selectModelForDispatch() picks based on role +
    // sourceType (strategic → Opus, everything else → Sonnet). When set,
    // wins outright. Lets escalations, architecture reviews, and founder-mode
    // bypasses pin Opus without changing the role-default heuristic.
    model: text("model"),
  },
  (t) => [
    // Fast worker pull: status + priority + queued_at
    index("solene_dispatch_queue_pull_idx").on(t.status, t.priority, t.queuedAt),
    index("solene_dispatch_queue_queued_idx").on(t.queuedAt),
    index("solene_dispatch_queue_status_idx").on(t.status, t.queuedAt),
    index("solene_dispatch_queue_source_idx").on(t.sourceType, t.sourceId),
    // L2.8 — review lookups: find the review for an original; list pending reviews.
    index("solene_dispatch_queue_original_idx").on(t.originalDispatchId),
    index("solene_dispatch_queue_review_status_idx").on(
      t.reviewStatus,
      t.completedAt,
    ),
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
  "code_review",
  // L3.13 — self-debugging. When a code-review flags a dispatch, we enqueue a
  // sibling self-debug dispatch back to the original agent. sourceId is
  // 'flagged:<originalId>:by:<reviewId>' for idempotency lookups.
  "self_debug",
  // L3.15 — adversarial self-testing. When a dispatch completes successfully
  // an adversary dispatch can be enqueued to try to break its work. sourceId
  // is 'adversarial:<testId>:original:<originalId>'.
  "adversarial_test",
  // L6.31 — founder-mode bypass. Tom directly invokes an agent role with
  // full authority via the founderDispatch service. sourceId is
  // 'founder:<timestamp>'. Always priority 3.0 by default; jumps the queue
  // ahead of auto-dispatched work. founderOverride=true is set when the
  // requested maxCostUsd exceeds the normal $100 ceiling.
  "founder_bypass",
] as const;
export type SoleneDispatchSourceType = (typeof DISPATCH_SOURCE_TYPES)[number];

export const DISPATCH_AGENT_ROLES = [
  "iris",
  "soren",
  "beatrice",
  "krieger",
  "general-purpose",
  "code-reviewer",
] as const;
export type SoleneDispatchAgentRole = (typeof DISPATCH_AGENT_ROLES)[number];

// L2.8 — review_status lifecycle for solene_dispatch_queue.review_status.
//   pending  — review dispatch was enqueued; the worker hasn't completed it yet.
//   passed   — review concluded VERDICT: passed.
//   flagged  — review concluded VERDICT: flagged (findings present).
//   skipped  — original dispatch produced no commits; no review was enqueued.
export const DISPATCH_REVIEW_STATUSES = [
  "pending",
  "passed",
  "flagged",
  "skipped",
] as const;
export type SoleneDispatchReviewStatus =
  (typeof DISPATCH_REVIEW_STATUSES)[number];

// ============================================
// COST CAP — the hard ceiling per dispatch.
// Above this requires a founder override (which today is "set the row
// directly with a higher cap"; surface a founder UI in a follow-up).
// ============================================
// Lowered by the 2026-06-05 cost audit. Old caps allowed a single
// dispatch to spend up to $25 (default) or $100 (founder override), and
// the cap check is "soft" — a turn already in flight that crosses the
// cap is allowed to complete. With prompt cache not yet wired into the
// dispatch path, a 50-turn Opus dispatch could realistically burn the
// whole cap on input tokens alone. New floor: $5 default, $25 max
// override. Combined with AI_PLATFORM_DAILY_CEILING_CENTS the worst
// case is bounded.
export const DISPATCH_MAX_COST_USD = 25;
export const DISPATCH_DEFAULT_COST_USD = 5;
export const DISPATCH_DEFAULT_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
export const DISPATCH_MAX_TURNS = 50;
