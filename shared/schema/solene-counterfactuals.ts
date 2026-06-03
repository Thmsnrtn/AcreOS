// ============================================================================
// SHARED/SCHEMA/SOLENE-COUNTERFACTUALS.TS
// ----------------------------------------------------------------------------
// Solene — counterfactual reasoning on past decisions (Phase B L4.21).
//
// For each decision in `solene_agent_identity_decisions`, an agent can record
// one or more counterfactual analyses — explorations of "what if we'd chosen
// the OTHER option?". Each row ties an alternative path back to the original
// decision, predicts the outcome that alternative would have produced, and
// compares it to what actually happened. Optionally extracts a lesson.
//
// Surfaces deeper insight than after-the-fact "we did X, it worked." — an
// agent that can reason about the road not taken can stress-test its own
// decision-making, not just confirm it.
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
// SOLENE_COUNTERFACTUAL_ANALYSES
// ============================================
export const soleneCounterfactualAnalyses = pgTable(
  "solene_counterfactual_analyses",
  {
    id: serial("id").primaryKey(),
    analyzedAt: timestamp("analyzed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    sourceDecisionId: integer("source_decision_id").notNull(),
    analyzingAgentRole: text("analyzing_agent_role").notNull(),
    alternativePath: text("alternative_path").notNull(),
    alternativeRationale: text("alternative_rationale").notNull(),
    predictedOutcome: text("predicted_outcome").notNull(),
    comparisonToActual: text("comparison_to_actual").notNull(),
    lessonLearned: text("lesson_learned"),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
  },
  (t) => [
    index("solene_counterfactuals_source_decision_idx").on(t.sourceDecisionId),
    index("solene_counterfactuals_role_analyzed_idx").on(
      t.analyzingAgentRole,
      t.analyzedAt,
    ),
  ],
);

export type CounterfactualAnalysisRow =
  typeof soleneCounterfactualAnalyses.$inferSelect;
export type InsertCounterfactualAnalysisRow =
  typeof soleneCounterfactualAnalyses.$inferInsert;
