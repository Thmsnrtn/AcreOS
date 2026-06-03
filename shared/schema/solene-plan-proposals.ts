// ============================================================================
// SHARED/SCHEMA/SOLENE-PLAN-PROPOSALS.TS
// ----------------------------------------------------------------------------
// Solene — plan-then-execute proposal layer (Phase B L2.6).
//
// Agents propose a full multi-step plan + cost/duration estimate + risk
// assessment BEFORE Solene/Tom dispatches the work. The reviewer reads the
// plan, then either approves (optionally with an enqueueOptions payload that
// causes the proposal to immediately materialize as a solene_dispatch_queue
// row) or rejects with a rationale.
//
// Reduces re-work: the plan is the cheapest place to catch wrong assumptions,
// missing context, or scope-creep before paying for the actual dispatch.
//
// Lifecycle:
//   proposed → approved   (decision made; execution deferred)
//   proposed → approved → executed   (approve included enqueueOptions →
//                                     dispatch enqueued + linked back via
//                                     executed_dispatch_id)
//   proposed → rejected   (terminal; rationale required)
//   proposed → superseded (terminal; a newer proposal replaces this one)
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
// PLAN_PROPOSALS
// ============================================
export const planProposals = pgTable(
  "plan_proposals",
  {
    id: serial("id").primaryKey(),
    proposedAt: timestamp("proposed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    agentRole: text("agent_role").notNull(),
    triggeringDispatchId: integer("triggering_dispatch_id"),
    summary: text("summary").notNull(),
    planBody: text("plan_body").notNull(),
    estimatedCostUsd: numeric("estimated_cost_usd", {
      precision: 10,
      scale: 4,
    }).notNull(),
    estimatedDurationMinutes: integer("estimated_duration_minutes").notNull(),
    riskAssessment: text("risk_assessment"),
    status: text("status").notNull().default("proposed"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionRationale: text("decision_rationale"),
    executedDispatchId: integer("executed_dispatch_id"),
  },
  (t) => [
    index("plan_proposals_status_proposed_idx").on(t.status, t.proposedAt),
    index("plan_proposals_role_proposed_idx").on(t.agentRole, t.proposedAt),
    index("plan_proposals_triggering_idx").on(t.triggeringDispatchId),
  ],
);

export type PlanProposalRow = typeof planProposals.$inferSelect;
export type InsertPlanProposalRow = typeof planProposals.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const PLAN_PROPOSAL_STATUSES = [
  "proposed",
  "approved",
  "rejected",
  "superseded",
  "executed",
] as const;
export type PlanProposalStatus = (typeof PLAN_PROPOSAL_STATUSES)[number];

export const PLAN_PROPOSAL_DECIDERS = [
  "solene",
  "tom",
  "auto-policy",
] as const;
export type PlanProposalDecider = (typeof PLAN_PROPOSAL_DECIDERS)[number];

// Validation bound — keeps `summary` cheap to render in lists.
export const PLAN_PROPOSAL_SUMMARY_MAX = 500;
