// ============================================================================
// SHARED/SCHEMA/SOLENE-CAPITAL.TS
// ----------------------------------------------------------------------------
// Solene (COO) — capital event ledger.
//
// Tracks per-session + per-day token consumption + agent dispatch cost +
// cumulative Anthropic spend. Surfaces in the daily pulse so the bootstrap
// envelope ($50/mo per charter, override via SOLENE_MONTHLY_ENVELOPE_USD)
// is a number Solene reasons against, not a vibe.
//
// One table: solene_capital_events. Fire-and-forget writes from
// recordCapitalEvent — must never throw + must never block the underlying
// operation (a missed write is preferable to a broken dispatch).
//
// Read-side: getSpendSummary(windowHours) for rolling windows,
// getMonthlyEnvelopeStatus() for the morning-pulse one-liner.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_CAPITAL_EVENTS
// ============================================
// `event_type` is one of: agent_dispatch | inline_tool_call | anthropic_api |
//                        fly_deploy | other.
// `cost_usd` is NUMERIC(10,4) so sub-cent precision survives 30-day rollups.
// `context_summary` is the ≤500 char gist of what the spend was for.
// `session_token` is an opaque per-session identifier (uuid-ish) so we can
// roll up cost-per-session without leaking PII or session-state details.
export const soleneCapitalEvents = pgTable(
  "solene_capital_events",
  {
    id: serial("id").primaryKey(),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull().defaultNow(),
    eventType: text("event_type").notNull(), // see SOLENE_CAPITAL_EVENT_TYPES
    costUsd: numeric("cost_usd", { precision: 10, scale: 4 }).notNull(),
    contextSummary: text("context_summary").notNull(),
    sessionToken: text("session_token"),
  },
  (t) => [
    index("solene_capital_events_occurred_idx").on(t.occurredAt),
    index("solene_capital_events_type_occurred_idx").on(t.eventType, t.occurredAt),
    index("solene_capital_events_session_idx").on(t.sessionToken, t.occurredAt),
  ],
);

export type SoleneCapitalEvent = typeof soleneCapitalEvents.$inferSelect;
export type InsertSoleneCapitalEvent = typeof soleneCapitalEvents.$inferInsert;

export const SOLENE_CAPITAL_EVENT_TYPES = [
  "agent_dispatch",
  "inline_tool_call",
  "anthropic_api",
  "fly_deploy",
  "other",
] as const;
export type SoleneCapitalEventType = (typeof SOLENE_CAPITAL_EVENT_TYPES)[number];

// Charter default — overridable via SOLENE_MONTHLY_ENVELOPE_USD env.
export const DEFAULT_MONTHLY_ENVELOPE_USD = 50;

// Envelope thresholds — surfaced in the morning pulse status badge.
export const ENVELOPE_THRESHOLDS = {
  amberPercent: 70, // amber at 70% used
  redPercent: 90, // red at 90% used
} as const;

export type EnvelopeStatus = "green" | "amber" | "red";
