// ============================================================================
// SHARED/SCHEMA/SOLENE-FOUNDER-COLLAB.TS
// ----------------------------------------------------------------------------
// L6.32 — real-time collaboration between dispatched agents and Tom.
//
// A "founder ask" is a record of an agent asking Tom a specific question,
// with a timeout for the answer. The pager service (solene_page_events) is
// the *delivery* mechanism — this is the *question-answer state machine +
// answer-collection surface*.
//
// One table: solene_founder_asks.
//
// Lifecycle:
//   open       — asked, awaiting Tom's answer.
//   answered   — Tom responded; answer_text + (optional) chosen_option_id set.
//   timed_out  — daily sweeper flipped status when timeout_at passed.
//   superseded — situation changed; ask no longer relevant.
//
// 4 answer formats: free_text / multi_choice / yes_no / numeric, each with
// validation enforced in the service layer.
//
// Default timeout: 24h. Urgency 'low' persists without paging; 'normal' fires
// a normal-priority page; 'urgent' fires an urgent page.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

export const soleneFounderAsks = pgTable(
  "solene_founder_asks",
  {
    id: serial("id").primaryKey(),
    askedAt: timestamp("asked_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    askingAgentRole: text("asking_agent_role").notNull(),
    // Nullable — an ask can originate outside a dispatch (manual ad-hoc).
    askingDispatchId: integer("asking_dispatch_id"),
    // Short summary that appears in the pager Title (≤200 chars enforced by
    // service layer — DB takes the full text in case truncation logic ever
    // changes).
    questionSummary: text("question_summary").notNull(),
    // Full question + context. Markdown-OK.
    questionBody: text("question_body").notNull(),
    // For multi_choice answer_format: array of { id, label, description? }.
    options: jsonb("options").$type<
      Array<{ id: string; label: string; description?: string }>
    >(),
    answerFormat: text("answer_format").notNull(), // see FOUNDER_ASK_FORMATS
    status: text("status").notNull().default("open"), // see FOUNDER_ASK_STATUSES
    answeredAt: timestamp("answered_at", { withTimezone: true }),
    answerText: text("answer_text"),
    answerChosenOptionId: text("answer_chosen_option_id"),
    // FK to solene_page_events.id when the urgency dispatched a pager.
    pagerEventId: integer("pager_event_id"),
    // Default ask_at + 24h, set explicitly by service.
    timeoutAt: timestamp("timeout_at", { withTimezone: true }),
    urgency: text("urgency").notNull().default("normal"), // see FOUNDER_ASK_URGENCIES
  },
  (t) => [
    // Founder-inbox surface: list open asks newest-first.
    index("solene_founder_asks_status_asked_idx").on(t.status, t.askedAt),
    // Per-agent history view.
    index("solene_founder_asks_agent_asked_idx").on(t.askingAgentRole, t.askedAt),
    // Sweeper: find overdue open asks fast.
    index("solene_founder_asks_timeout_idx").on(t.timeoutAt),
  ],
);

export type SoleneFounderAsk = typeof soleneFounderAsks.$inferSelect;
export type InsertSoleneFounderAsk = typeof soleneFounderAsks.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const FOUNDER_ASK_STATUSES = [
  "open",
  "answered",
  "timed_out",
  "superseded",
] as const;
export type SoleneFounderAskStatus = (typeof FOUNDER_ASK_STATUSES)[number];

export const FOUNDER_ASK_FORMATS = [
  "free_text",
  "multi_choice",
  "yes_no",
  "numeric",
] as const;
export type SoleneFounderAskFormat = (typeof FOUNDER_ASK_FORMATS)[number];

export const FOUNDER_ASK_URGENCIES = ["urgent", "normal", "low"] as const;
export type SoleneFounderAskUrgency = (typeof FOUNDER_ASK_URGENCIES)[number];

// Default timeout when the caller doesn't override.
export const FOUNDER_ASK_DEFAULT_TIMEOUT_HOURS = 24;
// Max length of question_summary before truncation in the service.
export const FOUNDER_ASK_SUMMARY_MAX_CHARS = 200;
