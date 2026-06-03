// ============================================================================
// SHARED/SCHEMA/SOLENE-EVIDENCE-WEIGHTS.TS
// ----------------------------------------------------------------------------
// Solene — reasoning over evidence weights (Layer 6 capability L6.30 of
// the agentic-evolution architecture, feedback_agentic_evolution_north_star.md).
//
// When agents face conflicting sources on the same topic (e.g. Beatrice's
// regulatory interpretation vs. an UpCounsel reading vs. the actual
// statute text) we want explicit reasoning about WHICH source to trust
// and WHY — not an opaque "Claude said so". This table is the audit
// trail of that reasoning.
//
// One table:
//   solene_evidence_assessments — one row per assessment call. Captures
//                                 the array of evidence items, the per-
//                                 source weight assignments, the chosen
//                                 winning source (if any), the aggregate
//                                 conclusion, full rationale, and a
//                                 confidence score derived from the
//                                 weight distribution's entropy.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
//
// NOTE — tool exposure (handled in a follow-up Solene commit):
//   A future `assess_evidence` tool will be added to dispatchToolExecutor so
//   agents can persist evidence-weight assessments mid-dispatch. See the
//   service header in server/services/solene/evidenceWeights.ts for the
//   full schema.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  jsonb,
  timestamp,
  numeric,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_EVIDENCE_ASSESSMENTS
// ============================================
export const soleneEvidenceAssessments = pgTable(
  "solene_evidence_assessments",
  {
    id: serial("id").primaryKey(),
    assessedAt: timestamp("assessed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    agentRole: text("agent_role").notNull(), // see DISPATCH_AGENT_ROLES
    // Short identifier for what's being assessed —
    // e.g. "reg-z §1026.41 escrow scope".
    topic: text("topic").notNull(),
    // FK to solene_agent_identity_decisions.id when this assessment
    // supports a specific decision. Not a SQL FK by drizzle convention
    // (service layer is source of truth for existence).
    decisionId: integer("decision_id"),
    // Array of evidence objects — see EvidenceItem shape:
    //   { id, source_kind, source_ref, claim, recency, authority_tier }
    evidenceItems: jsonb("evidence_items").notNull(),
    // The `id` of the winning evidence item, when one source is clearly
    // chosen. null when no source's weight beats the next by >=0.15
    // (genuine conflict requiring manual review).
    chosenSourceId: text("chosen_source_id"),
    // { <source_id>: <weight_0_to_1> } — normalized to sum=1.0.
    weightAssignments: jsonb("weight_assignments").notNull(),
    // The winning claim (verbatim) OR
    // "Sources conflict; manual review required." when no clear winner.
    aggregateConclusion: text("aggregate_conclusion").notNull(),
    // Per-item weight + factor breakdown, plus the conclusion's
    // justification.
    rationale: text("rationale").notNull(),
    // 1.0 - normalized entropy of weight_assignments. Lower entropy
    // (one source dominates) → higher confidence; uniform distribution
    // → ~0.
    confidence: numeric("confidence", {
      precision: 5,
      scale: 4,
    }),
  },
  (t) => [
    // Per-agent walks of recent assessments.
    index("solene_evidence_assessments_role_assessed_idx").on(
      t.agentRole,
      t.assessedAt,
    ),
    // "Have we decided this topic before?" lookups by topic.
    index("solene_evidence_assessments_topic_assessed_idx").on(
      t.topic,
      t.assessedAt,
    ),
    // Join from a decision row to its supporting assessments.
    index("solene_evidence_assessments_decision_idx").on(t.decisionId),
  ],
);

export type SoleneEvidenceAssessmentRow =
  typeof soleneEvidenceAssessments.$inferSelect;
export type InsertSoleneEvidenceAssessmentRow =
  typeof soleneEvidenceAssessments.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

// Source taxonomy — drives the per-kind base weight in the scorer.
//   regulation     — primary statutory / regulatory text (canonical)
//   case_law       — judicial opinions interpreting the regulation
//   internal_doc   — AcreOS internal compliance docs / prior decisions
//   live_data      — runtime data fetched from a current source
//   secondary      — commentaries, treatises, mainstream legal sites
//   expert_opinion — informal expert quotes / blogs / forum posts
export const EVIDENCE_SOURCE_KINDS = [
  "regulation",
  "case_law",
  "secondary",
  "internal_doc",
  "live_data",
  "expert_opinion",
] as const;
export type EvidenceSourceKind = (typeof EVIDENCE_SOURCE_KINDS)[number];

// Per-kind base weight (multiplied by authority + recency factors).
export const EVIDENCE_BASE_WEIGHT_BY_KIND: Record<EvidenceSourceKind, number> =
  {
    regulation: 1.0,
    case_law: 0.9,
    internal_doc: 0.7,
    live_data: 0.8,
    secondary: 0.5,
    expert_opinion: 0.4,
  };

// Authority tier penalty: tier 1 (canonical) = 1.0, tier 5 (informal) = 0.4.
// Linear: 1.0 - (tier - 1) * AUTHORITY_PENALTY_PER_TIER.
export const AUTHORITY_PENALTY_PER_TIER = 0.15;

// Recency stratification (days since recency date relative to now).
//   <= 365 days       → 1.0
//   <= 3 * 365 days   → 0.7
//   > 3 * 365 days    → 0.4
//   'unknown'         → 0.3
export const RECENCY_FACTOR_RECENT = 1.0;
export const RECENCY_FACTOR_MID = 0.7;
export const RECENCY_FACTOR_OLD = 0.4;
export const RECENCY_FACTOR_UNKNOWN = 0.3;
export const RECENCY_DAYS_RECENT = 365;
export const RECENCY_DAYS_MID = 365 * 3;

// Minimum weight gap between top and second source to declare a winner.
// If the gap is <=0.15 we flag as conflict requiring manual review.
export const CHOSEN_SOURCE_MIN_GAP = 0.15;

// Default message when no source wins clearly.
export const CONFLICT_CONCLUSION_MESSAGE =
  "Sources conflict; manual review required.";
