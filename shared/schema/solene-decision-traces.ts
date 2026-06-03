// ============================================================================
// SHARED/SCHEMA/SOLENE-DECISION-TRACES.TS
// ----------------------------------------------------------------------------
// Solene — fine-grain decision rationale traces (Layer 3 capability L3.16 of
// the agentic-evolution architecture, feedback_agentic_evolution_north_star.md).
//
// Builds on the L1.4 agent identity ledger (solene_agent_identity_decisions).
// Where L1.4 captures a *summary* of a decision ("chose pgvector — reuses
// pool"), L3.16 captures the full step-by-step reasoning trace that produced
// that decision: the observations, hypotheses, evidence weighed, alternatives
// considered, and the final choice + confidence at each step.
//
// One table:
//   solene_decision_traces — append-only step ledger keyed by decision_id.
//                            step_number is monotonic per decision
//                            (server-side MAX(step_number)+1). Six step kinds:
//                            observation / hypothesis / evidence / alternative
//                            / choice / uncertainty.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
//
// NOTE — tool exposure (handled in a follow-up Solene commit):
//   A future `record_decision_trace` tool will be added to dispatchToolExecutor
//   so agents can persist fine-grain reasoning mid-dispatch. See the service
//   header in server/services/solene/decisionTraces.ts for the full schema.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  numeric,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_DECISION_TRACES
// ============================================
export const soleneDecisionTraces = pgTable(
  "solene_decision_traces",
  {
    id: serial("id").primaryKey(),
    // FK to solene_agent_identity_decisions.id. Not declared as a SQL FK at
    // the drizzle layer (mirrors the agent_claims/identity nullable-by-design
    // convention) — the service layer is the source of truth for existence.
    decisionId: integer("decision_id").notNull(),
    // 1-based monotonic per decisionId; server-side MAX+1 in the service.
    // Unique (decision_id, step_number) declared below + in migrate.mjs.
    stepNumber: integer("step_number").notNull(),
    recordedAt: timestamp("recorded_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // One of DECISION_TRACE_STEP_KINDS.
    stepKind: text("step_kind").notNull(),
    // The reasoning content. Capped at 2000 chars by the service (truncate
    // with `… [truncated]` suffix).
    stepText: text("step_text").notNull(),
    // Optional refs — file paths, URLs, prior decision IDs encoded as
    // strings ("decision:42"), etc.
    evidenceRefs: text("evidence_refs").array(),
    // Other options on the table at this step. Especially useful when
    // step_kind='alternative' or 'choice'.
    alternativesConsidered: text("alternatives_considered").array(),
    // Only meaningful when step_kind='choice' — why this path won.
    chosenPathReason: text("chosen_path_reason"),
    // 0.0–1.0 self-rated confidence at this step. Service clamps to range.
    confidenceAtStep: numeric("confidence_at_step", {
      precision: 5,
      scale: 4,
    }),
  },
  (t) => [
    // Hot path: load full trace for a decision in step order.
    index("solene_decision_traces_decision_step_idx").on(
      t.decisionId,
      t.stepNumber,
    ),
    // Analytics: scan all observations (or uncertainty markers) over time.
    index("solene_decision_traces_kind_recorded_idx").on(
      t.stepKind,
      t.recordedAt,
    ),
    // No duplicate step numbers per decision — enforced both by service
    // (MAX+1) and DB constraint as a belt-and-suspenders.
    uniqueIndex("solene_decision_traces_decision_step_unique").on(
      t.decisionId,
      t.stepNumber,
    ),
  ],
);

export type SoleneDecisionTrace = typeof soleneDecisionTraces.$inferSelect;
export type InsertSoleneDecisionTrace =
  typeof soleneDecisionTraces.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

// The six step kinds capture the reasoning lifecycle:
//   observation  — "I see X."
//   hypothesis   — "Maybe X is caused by Y."
//   evidence     — "Y is supported by file Z line N."
//   alternative  — "I could also do W."
//   choice       — "Going with Y because …"
//   uncertainty  — "I'm not sure about Q."
export const DECISION_TRACE_STEP_KINDS = [
  "observation",
  "hypothesis",
  "evidence",
  "alternative",
  "choice",
  "uncertainty",
] as const;
export type DecisionTraceStepKind = (typeof DECISION_TRACE_STEP_KINDS)[number];

// Step text cap — keeps a single reasoning step compact + scannable in the
// markdown render. Longer-form rationale belongs in chosen_path_reason or in
// the parent L1.4 decision's rationale field.
export const DECISION_TRACE_STEP_TEXT_MAX_CHARS = 2000;

// Suffix appended when a step is truncated. Mirrors agentIdentity's
// truncation suffix for consistency across transcript analyzers.
export const DECISION_TRACE_TRUNCATION_SUFFIX = "… [truncated]";
