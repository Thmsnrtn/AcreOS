// ============================================================================
// SHARED/SCHEMA/SOLENE-MODEL-UPGRADE.TS
// ----------------------------------------------------------------------------
// L4.18 — model-upgrade path. Builds on L4.17 (anthropic-watch shipped in
// cd290f4c) which already pulls Anthropic release-notes items into
// external_watch_events. This schema persists the *decisions* the team makes
// in response to each ingested release-note: classification +
// recommendation + (when acted on) the action summary.
//
// One row per source_event_id (UNIQUE when not null) so re-running the
// classifier never produces duplicate recommendation rows for the same
// upstream changelog item. Rows without a source_event_id are reserved for
// manual / out-of-band recommendations the COO files directly.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_MODEL_UPGRADE_RECOMMENDATIONS
// ============================================
export const soleneModelUpgradeRecommendations = pgTable(
  "solene_model_upgrade_recommendations",
  {
    id: serial("id").primaryKey(),
    // FK to external_watch_events.id. Nullable so manual / out-of-band
    // recommendations (e.g. founder-filed) can land in the same ledger.
    sourceEventId: integer("source_event_id"),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    eventKind: text("event_kind").notNull(), // MODEL_UPGRADE_EVENT_KINDS
    affectedModel: text("affected_model").notNull(),
    currentModelInUse: text("current_model_in_use").notNull(),
    recommendation: text("recommendation").notNull(), // MODEL_UPGRADE_RECOMMENDATIONS
    rationale: text("rationale").notNull(),
    evaluationResults: jsonb("evaluation_results"),
    actedOn: boolean("acted_on").notNull().default(false),
    actedAt: timestamp("acted_at", { withTimezone: true }),
    actionSummary: text("action_summary"),
  },
  (t) => [
    index("solene_model_upgrade_recommendation_idx").on(
      t.recommendation,
      t.detectedAt,
    ),
    index("solene_model_upgrade_acted_idx").on(t.actedOn, t.detectedAt),
    // Unique on source_event_id WHEN NOT NULL — Postgres treats NULLs as
    // distinct so the partial unique-index intent is achieved by a plain
    // uniqueIndex (NULL rows are allowed in unlimited number).
    uniqueIndex("solene_model_upgrade_source_event_uk").on(t.sourceEventId),
  ],
);

export type SoleneModelUpgradeRecommendation =
  typeof soleneModelUpgradeRecommendations.$inferSelect;
export type InsertSoleneModelUpgradeRecommendation =
  typeof soleneModelUpgradeRecommendations.$inferInsert;

export const MODEL_UPGRADE_EVENT_KINDS = [
  "new_model_available",
  "model_deprecated",
  "pricing_change",
  "feature_added",
  "rate_limit_change",
] as const;
export type ModelUpgradeEventKind = (typeof MODEL_UPGRADE_EVENT_KINDS)[number];

export const MODEL_UPGRADE_RECOMMENDATIONS = [
  "adopt_now",
  "schedule_eval",
  "flag_only",
] as const;
export type ModelUpgradeRecommendation =
  (typeof MODEL_UPGRADE_RECOMMENDATIONS)[number];
