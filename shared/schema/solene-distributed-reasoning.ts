// ============================================================================
// SHARED/SCHEMA/SOLENE-DISTRIBUTED-REASONING.TS
// ----------------------------------------------------------------------------
// Solene — distributed reasoning sessions (Phase B L2.7).
//
// A "distributed reasoning session" coordinates N parallel sub-dispatches that
// each tackle a slice of a larger problem, then a synthesizer consolidates
// their outputs. Today multi-agent parallel work happens but the agents don't
// reason as a single distributed system — this layer makes the decomposition,
// contribution stream, and synthesis explicit + auditable.
//
// Two tables:
//   solene_reasoning_sessions       — the open question + decomposition plan
//   solene_reasoning_contributions  — one row per sub-dispatch's slice answer
//
// Lifecycle:
//   open → synthesizing → closed
//   open → abandoned
//
// Four decomposition strategies:
//   map_reduce            — N parallel slices over a dataset/space, reduce
//   divide_and_conquer    — sub-problems shrink the original
//   adversarial_pair      — two opposing slices stress-test a claim
//   parallel_perspectives — same problem viewed through N persona lenses
//
// Mirror in scripts/migrate.mjs.
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
// SOLENE_REASONING_SESSIONS
// ============================================
export const soleneReasoningSessions = pgTable(
  "solene_reasoning_sessions",
  {
    id: serial("id").primaryKey(),
    openedAt: timestamp("opened_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
    openedByAgentRole: text("opened_by_agent_role").notNull(),
    topic: text("topic").notNull(),
    problemStatement: text("problem_statement").notNull(),
    decompositionStrategy: text("decomposition_strategy").notNull(),
    expectedSubDispatchCount: integer("expected_sub_dispatch_count").notNull(),
    status: text("status").notNull().default("open"),
    synthesisOutput: text("synthesis_output"),
    finalConclusion: text("final_conclusion"),
    finalConfidence: numeric("final_confidence", { precision: 5, scale: 4 }),
  },
  (t) => [
    index("solene_reasoning_sessions_status_opened_idx").on(
      t.status,
      t.openedAt,
    ),
    index("solene_reasoning_sessions_opened_by_idx").on(t.openedByAgentRole),
  ],
);

export type ReasoningSessionRow =
  typeof soleneReasoningSessions.$inferSelect;
export type InsertReasoningSessionRow =
  typeof soleneReasoningSessions.$inferInsert;

// ============================================
// SOLENE_REASONING_CONTRIBUTIONS
// ============================================
export const soleneReasoningContributions = pgTable(
  "solene_reasoning_contributions",
  {
    id: serial("id").primaryKey(),
    sessionId: integer("session_id").notNull(),
    contributingDispatchId: integer("contributing_dispatch_id"),
    contributorAgentRole: text("contributor_agent_role").notNull(),
    sliceDescription: text("slice_description").notNull(),
    contributionText: text("contribution_text").notNull(),
    contributedAt: timestamp("contributed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    weight: numeric("weight", { precision: 5, scale: 4 }),
  },
  (t) => [
    index("solene_reasoning_contributions_session_idx").on(
      t.sessionId,
      t.contributedAt,
    ),
  ],
);

export type ReasoningContributionRow =
  typeof soleneReasoningContributions.$inferSelect;
export type InsertReasoningContributionRow =
  typeof soleneReasoningContributions.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const REASONING_STRATEGIES = [
  "map_reduce",
  "divide_and_conquer",
  "adversarial_pair",
  "parallel_perspectives",
] as const;
export type ReasoningStrategy = (typeof REASONING_STRATEGIES)[number];

export const REASONING_SESSION_STATUSES = [
  "open",
  "synthesizing",
  "closed",
  "abandoned",
] as const;
export type ReasoningSessionStatus =
  (typeof REASONING_SESSION_STATUSES)[number];
