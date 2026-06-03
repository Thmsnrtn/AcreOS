// ============================================================================
// SHARED/SCHEMA/SOLENE-TOKEN-ECONOMY.TS
// ----------------------------------------------------------------------------
// Solene (COO) — token-economy decision scoring.
//
// L5.27 of the agentic-evolution architecture. Every prospective dispatch
// decision gets a `marginalCost` vs `marginalValue` score so Solene reasons
// against the number, not vibes. Integrates with capitalTracker's envelope
// awareness so dispatches deferred when the bootstrap envelope is amber/red.
//
// One table: solene_decision_score_events. Fire-and-forget INSERTs from
// scoreDispatchProposal — must never throw + must never block the decision
// path (a missed scoring write is preferable to a broken dispatch).
//
// Read-side: listRecentScores(limit) for the audit UI,
// getDailyScoringSummary() for the daily pulse Decision Scoring sub-section.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_DECISION_SCORE_EVENTS
// ============================================
// `dispatch_id` is nullable — scoring runs BEFORE enqueue, so the row may
//                exist before there's an associated queue row. When a
//                proceed-rated proposal is actually enqueued, downstream
//                writers may UPDATE this column to backfill the link.
// `prompt_summary` is the ≤500 char gist of the prompt being scored.
// `estimated_cost_usd` is NUMERIC(10,4) so sub-cent precision survives.
// `historical_success_rate` is NUMERIC(5,4) — bounded [0.0000, 1.0000].
// `envelope_status_at_decision` snapshots the capitalTracker envelope at
// scoring time so a later analysis can isolate scoring-time pressure.
// `score` is NUMERIC(5,4) — bounded [0.0000, 1.0000] after clamp.
// `recommendation` is one of: proceed | defer | reject.
export const soleneDecisionScoreEvents = pgTable(
  "solene_decision_score_events",
  {
    id: serial("id").primaryKey(),
    scoredAt: timestamp("scored_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    dispatchId: integer("dispatch_id"),
    agentRole: text("agent_role").notNull(),
    promptSummary: text("prompt_summary").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 4,
    }).notNull(),
    estimatedValueUsd: numeric("estimated_value_usd", {
      precision: 10,
      scale: 4,
    }),
    historicalSuccessRate: numeric("historical_success_rate", {
      precision: 5,
      scale: 4,
    }).notNull(),
    envelopeStatusAtDecision: text("envelope_status_at_decision").notNull(),
    score: numeric("score", { precision: 5, scale: 4 }).notNull(),
    recommendation: text("recommendation").notNull(),
    rationale: text("rationale").notNull(),
  },
  (t) => [
    index("solene_decision_score_events_role_scored_idx").on(
      t.agentRole,
      t.scoredAt,
    ),
    index("solene_decision_score_events_rec_scored_idx").on(
      t.recommendation,
      t.scoredAt,
    ),
    index("solene_decision_score_events_dispatch_idx").on(t.dispatchId),
  ],
);

export type SoleneDecisionScoreEvent =
  typeof soleneDecisionScoreEvents.$inferSelect;
export type InsertSoleneDecisionScoreEvent =
  typeof soleneDecisionScoreEvents.$inferInsert;

export const DECISION_SCORE_RECOMMENDATIONS = [
  "proceed",
  "defer",
  "reject",
] as const;
export type SoleneDecisionScoreRecommendation =
  (typeof DECISION_SCORE_RECOMMENDATIONS)[number];

// Thresholds for translating numeric score → recommendation.
export const DECISION_SCORE_THRESHOLDS = {
  proceedAtOrAbove: 0.6,
  rejectBelow: 0.3,
} as const;

// Envelope weights — applied to the score so envelope pressure penalizes
// marginal dispatches without disabling them outright.
export const ENVELOPE_WEIGHTS = {
  green: 1.0,
  amber: 0.7,
  red: 0.4,
} as const;

// Per-role default expected value (USD) when the caller doesn't pass an
// explicit estimate. Educated guesses, documented per role:
//   iris          — engineering ships have high downstream value
//   beatrice      — compliance ships are high-leverage
//   soren         — marketing iterations compound
//   krieger       — UX fixes compound
//   code-reviewer — catches a bug ~30% of the time at this value
//   general-purpose — generic baseline
export const PER_ROLE_DEFAULT_VALUE_USD: Record<string, number> = {
  iris: 50,
  beatrice: 40,
  soren: 30,
  krieger: 25,
  "code-reviewer": 15,
  "general-purpose": 20,
};

// Default historical success rate when no history exists for the role —
// don't penalize new roles into the floor.
export const DEFAULT_HISTORICAL_SUCCESS_RATE = 0.8;
