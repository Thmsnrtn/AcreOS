// ============================================================================
// SHARED/SCHEMA/SOLENE-CAPABILITY-PROPOSALS.TS
// ----------------------------------------------------------------------------
// Solene — capability discovery (Phase B L5.24).
//
// A "capability proposal" is an agent saying "I noticed I do X often + there's
// no tool for it; here's what a tool for X would look like." Solene reviews +
// decides to build (accepted), defer, or reject. Once built, the proposal is
// linked to the implementing dispatch and marked 'implemented'.
//
// Two tables:
//   solene_capability_proposals       — the proposals themselves (lifecycle)
//   solene_capability_introspections  — per-agent snapshots of available tools
//                                       and observed gap signals
//
// Lifecycle:
//   proposed → accepted → implemented
//   proposed → deferred
//   proposed → rejected
//
// Mirror in scripts/migrate.mjs.
// ============================================================================
//
// eslint-disable no-restricted-syntax

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_CAPABILITY_PROPOSALS
// ============================================
export const soleneCapabilityProposals = pgTable(
  "solene_capability_proposals",
  {
    id: serial("id").primaryKey(),
    proposedAt: timestamp("proposed_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    proposingAgentRole: text("proposing_agent_role").notNull(),
    proposedCapabilityName: text("proposed_capability_name").notNull(),
    problemStatement: text("problem_statement").notNull(),
    proposedToolSignature: text("proposed_tool_signature").notNull(),
    expectedValueUsd: numeric("expected_value_usd", { precision: 10, scale: 4 }),
    expectedInvocationsPerWeek: integer("expected_invocations_per_week"),
    estimatedBuildCostUsd: numeric("estimated_build_cost_usd", {
      precision: 10,
      scale: 4,
    }),
    referencesExistingTools: text("references_existing_tools").array(),
    status: text("status").notNull().default("proposed"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    decidedBy: text("decided_by"),
    decisionRationale: text("decision_rationale"),
    implementingDispatchId: integer("implementing_dispatch_id"),
  },
  (t) => [
    index("solene_capability_proposals_status_idx").on(t.status),
    index("solene_capability_proposals_agent_decided_idx").on(
      t.proposingAgentRole,
      t.decidedAt,
    ),
  ],
);

export type CapabilityProposalRow =
  typeof soleneCapabilityProposals.$inferSelect;
export type InsertCapabilityProposalRow =
  typeof soleneCapabilityProposals.$inferInsert;

// ============================================
// SOLENE_CAPABILITY_INTROSPECTIONS
// ============================================
export const soleneCapabilityIntrospections = pgTable(
  "solene_capability_introspections",
  {
    id: serial("id").primaryKey(),
    introspectedAt: timestamp("introspected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    agentRole: text("agent_role").notNull(),
    availableTools: jsonb("available_tools").notNull(),
    gapSignals: jsonb("gap_signals").notNull(),
  },
  (t) => [
    index("solene_capability_introspections_agent_idx").on(
      t.agentRole,
      t.introspectedAt,
    ),
  ],
);

export type CapabilityIntrospectionRow =
  typeof soleneCapabilityIntrospections.$inferSelect;
export type InsertCapabilityIntrospectionRow =
  typeof soleneCapabilityIntrospections.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

export const CAPABILITY_PROPOSAL_STATUSES = [
  "proposed",
  "accepted",
  "deferred",
  "rejected",
  "implemented",
] as const;
export type CapabilityProposalStatus =
  (typeof CAPABILITY_PROPOSAL_STATUSES)[number];

export const CAPABILITY_DECIDER_KINDS = [
  "solene",
  "tom",
  "auto-policy",
] as const;
export type CapabilityDeciderKind = (typeof CAPABILITY_DECIDER_KINDS)[number];

// snake_case identifier: starts with a-z, then a-z/0-9/_, 3..50 chars total.
export const CAPABILITY_NAME_PATTERN = /^[a-z][a-z0-9_]{2,49}$/;

export const PROBLEM_STATEMENT_MAX_CHARS = 2000;
export const TOOL_SIGNATURE_MAX_CHARS = 1000;
export const TRUNCATION_SUFFIX = "… [truncated]";

// Jaccard similarity threshold for findDuplicateProposals.
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.6;
