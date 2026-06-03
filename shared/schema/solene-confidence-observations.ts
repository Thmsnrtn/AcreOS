// ============================================================================
// SHARED/SCHEMA/SOLENE-CONFIDENCE-OBSERVATIONS.TS
// ----------------------------------------------------------------------------
// Solene — confidence-calibrated outputs (L3.11 of the agentic-evolution
// architecture, feedback_agentic_evolution_north_star.md).
//
// Every dispatched agent's final text gets parsed for confidence signals
// ("I'm 90% sure", "confidence: high", "I'm uncertain about X"). We persist
// the signal here, then — once the dispatch's code-review outcome is known
// (review_status -> passed | flagged) — correlate the stated confidence
// against the actual outcome to compute a [0, 1] calibration_score.
//
// Over time the per-agentRole calibration distribution is the load-bearing
// input to the implicit-trust dimension Solene already self-monitors. An
// agent that says "high confidence" and is right 90% of the time gets more
// autonomy; one that says "high confidence" and is wrong 50% of the time
// gets dialed back.
//
// One table:
//   solene_confidence_observations — one row per parsed final text whose
//                                    kind != 'no_signal'.
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
// SOLENE_CONFIDENCE_OBSERVATIONS
// ============================================
export const soleneConfidenceObservations = pgTable(
  "solene_confidence_observations",
  {
    id: serial("id").primaryKey(),
    observedAt: timestamp("observed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // FK to solene_dispatch_queue.id. Kept as a plain integer (no FK
    // constraint) to mirror the sibling solene_dispatch_results pattern —
    // dispatch rows are referenced by id only.
    dispatchId: integer("dispatch_id").notNull(),
    agentRole: text("agent_role").notNull(), // see DISPATCH_AGENT_ROLES
    // Extracted confidence as 0.0000 - 1.0000. Nullable: explicit-band /
    // hedged kinds always populate, but a future kind may not.
    statedConfidence: numeric("stated_confidence", {
      precision: 5,
      scale: 4,
    }),
    // The matched text excerpt, sanitized for credentials, <=500 chars.
    confidencePhrase: text("confidence_phrase"),
    // See CONFIDENCE_KINDS — the detection bucket.
    confidenceKind: text("confidence_kind").notNull(),
    // Stamped later by correlateWithReviewOutcome() once the review verdict
    // is known. null until then.
    correlatedReviewStatus: text("correlated_review_status"),
    // 1.0 = stated confidence matched outcome; 0.0 = opposite; partial
    // values for intermediate states (underconfidence, mid-band). null
    // when review_status is 'skipped' (no signal) or before correlation.
    calibrationScore: numeric("calibration_score", {
      precision: 5,
      scale: 4,
    }),
  },
  (t) => [
    // Per-agent calibration walks (getCalibrationSummary).
    index("solene_confidence_obs_agent_observed_idx").on(
      t.agentRole,
      t.observedAt,
    ),
    // Fast correlate-by-dispatch lookup.
    index("solene_confidence_obs_dispatch_idx").on(t.dispatchId),
    // Kind-by-time for trend analysis ("does Iris hedge more this week?").
    index("solene_confidence_obs_kind_observed_idx").on(
      t.confidenceKind,
      t.observedAt,
    ),
  ],
);

export type SoleneConfidenceObservationRow =
  typeof soleneConfidenceObservations.$inferSelect;
export type InsertSoleneConfidenceObservationRow =
  typeof soleneConfidenceObservations.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

// Detection buckets in priority order — explicit_percentage wins when
// multiple match. See server/services/solene/confidenceParser.ts.
export const CONFIDENCE_KINDS = [
  "explicit_percentage",
  "explicit_band",
  "uncertainty_marker",
  "hedged_confidence",
  "no_signal",
] as const;
export type SoleneConfidenceKind = (typeof CONFIDENCE_KINDS)[number];

// Mirrors solene_dispatch_queue.review_status values that we correlate against.
export const CONFIDENCE_REVIEW_STATUSES = [
  "passed",
  "flagged",
  "skipped",
] as const;
export type SoleneConfidenceReviewStatus =
  (typeof CONFIDENCE_REVIEW_STATUSES)[number];

// Max length for the persisted phrase excerpt (post-sanitization).
export const CONFIDENCE_PHRASE_MAX_LEN = 500;

// Band -> numeric confidence used by both the parser and the correlation
// scorer. Kept here so the migration mirror, the parser, and the service
// all reference one source of truth.
export const CONFIDENCE_BAND_VALUES = {
  high: 0.85,
  medium: 0.55,
  low: 0.25,
} as const;

// Calibration thresholds used by getCalibrationSummary() bucketing.
export const CALIBRATION_OVERCONFIDENT_MAX = 0.3;
export const CALIBRATION_WELL_CALIBRATED_MIN = 0.7;
