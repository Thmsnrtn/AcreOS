// ============================================================================
// SHARED/SCHEMA/SOLENE-PIPELINE.TS
// ----------------------------------------------------------------------------
// Solene — Discovery → Decision → Dispatch → Delivery pipeline (Phase B L2.9).
//
// A "pipeline" is a single tracking row that links the already-existing
// stage tables (improvement_opportunities, plan_proposals, solene_dispatch_queue,
// code_review_queue) by foreign key + tags a current_stage so that
// "where in the lifecycle is this work?" becomes queryable in one shot.
//
// We do NOT duplicate state owned by the underlying tables. The pipeline row
// is the lightweight join row.
//
// Stages:
//   discovery   — detector / improvement opportunity / external watch surfaced a need
//   decision    — a plan proposal records the chosen approach (optional)
//   dispatch    — a solene_dispatch_queue row is doing the work
//   delivery    — dispatch completed; code-review (L2.8) fires if applicable
//   completed   — terminal: final_outcome recorded
//   abandoned   — terminal: explicit abandon with reason
//
// Allowed transitions:
//   discovery → decision
//   discovery → dispatch         (skip-decision shortcut for auto-dispatch)
//   decision  → dispatch
//   dispatch  → delivery
//   delivery  → completed
//   any-non-terminal → abandoned
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// PIPELINES
// ============================================
export const solenePipelines = pgTable(
  "solene_pipelines",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    pipelineKind: text("pipeline_kind").notNull(),
    currentStage: text("current_stage").notNull().default("discovery"),
    triggeringSourceKind: text("triggering_source_kind"),
    triggeringSourceId: text("triggering_source_id"),
    improvementOpportunityId: integer("improvement_opportunity_id"),
    planProposalId: integer("plan_proposal_id"),
    dispatchId: integer("dispatch_id"),
    reviewDispatchId: integer("review_dispatch_id"),
    finalOutcome: text("final_outcome"),
    finalOutcomeNotes: text("final_outcome_notes"),
    durationMsDiscoveryToDecision: integer("duration_ms_discovery_to_decision"),
    durationMsDecisionToDispatch: integer("duration_ms_decision_to_dispatch"),
    durationMsDispatchToDelivery: integer("duration_ms_dispatch_to_delivery"),
  },
  (t) => [
    index("solene_pipelines_kind_stage_idx").on(t.pipelineKind, t.currentStage),
    index("solene_pipelines_stage_updated_idx").on(
      t.currentStage,
      t.updatedAt,
    ),
    index("solene_pipelines_opportunity_idx").on(t.improvementOpportunityId),
    index("solene_pipelines_dispatch_idx").on(t.dispatchId),
  ],
);

export type SolenePipelineRow = typeof solenePipelines.$inferSelect;
export type InsertSolenePipelineRow = typeof solenePipelines.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const PIPELINE_KINDS = [
  "improvement",
  "external_watch",
  "founder_request",
  "self_initiated",
  "code_review_loop",
  "self_debug_loop",
] as const;
export type PipelineKind = (typeof PIPELINE_KINDS)[number];

export const PIPELINE_STAGES = [
  "discovery",
  "decision",
  "dispatch",
  "delivery",
  "completed",
  "abandoned",
] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const PIPELINE_OUTCOMES = [
  "shipped",
  "flagged_and_recovered",
  "abandoned",
  "superseded",
] as const;
export type PipelineOutcome = (typeof PIPELINE_OUTCOMES)[number];

export const PIPELINE_TRIGGERING_SOURCE_KINDS = [
  "team_improvement_opportunity",
  "external_watch_event",
  "founder_endpoint",
  "solene_internal",
] as const;
export type PipelineTriggeringSourceKind =
  (typeof PIPELINE_TRIGGERING_SOURCE_KINDS)[number];
