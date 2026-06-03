// ============================================================================
// SHARED/SCHEMA/TEAM-IMPROVEMENT.TS
// ----------------------------------------------------------------------------
// Team-improvement opportunity ledger.
//
// The event-driven improvement-opportunity detector (server/services/improvement)
// scans recent state across SEVEN signal patterns every 30 minutes. When a
// pattern fires above threshold, a row is persisted here AND — when the
// auto-dispatch guardrails permit — the development work is dispatched
// automatically (no Solene-in-the-loop). The calendar-cron team-member
// reviews remain as a SAFETY NET that catches anything the detectors missed.
//
// One table: team_improvement_opportunities. Idempotent at the DB layer
// via UNIQUE(team_member, signal_pattern, description) so a recurring gap
// fires once and re-runs don't proliferate duplicates.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// TEAM_IMPROVEMENT_OPPORTUNITIES
// ============================================
//
// One row per (team_member × signal_pattern × description) gap that the
// detector layer surfaced. `evidence` is jsonb so detectors can attach
// links to the source rows (audit findings, decision rationales, capital
// events, commit SHAs, reg events) that triggered the match.
//
// `auto_dispatched` flips true the moment evaluateForAutoDispatch persists
// a dispatch (or — currently — a SIMULATED dispatch, since the actual
// Agent-tool primitive from inside the server doesn't exist yet). When
// false, the opportunity is queued for Solene-in-the-loop via the
// /api/founder/team-improvement/pending endpoint.
//
// `resolved_at` + `resolution_commit` close the loop when the dispatched
// development work lands. The morning brief surfaces unresolved count.
export const teamImprovementOpportunities = pgTable(
  "team_improvement_opportunities",
  {
    id: serial("id").primaryKey(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    teamMember: text("team_member").notNull(), // see TEAM_IMPROVEMENT_MEMBERS
    signalPattern: text("signal_pattern").notNull(), // see TEAM_IMPROVEMENT_SIGNAL_PATTERNS
    description: text("description").notNull(), // ≤500 chars (service-enforced)
    evidence: jsonb("evidence").$type<TeamImprovementEvidence>().notNull().default({}),
    confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(), // 0.000..1.000
    estimatedCostUsd: numeric("estimated_cost_usd", { precision: 10, scale: 2 }),
    severity: text("severity").notNull(), // info | opportunity | urgent
    autoDispatched: boolean("auto_dispatched").notNull().default(false),
    dispatchedAt: timestamp("dispatched_at", { withTimezone: true }),
    dispatchedAgentId: text("dispatched_agent_id"),
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionCommit: text("resolution_commit"),
  },
  (t) => [
    // Idempotency floor: the same (member × pattern × description) gap
    // can never fire twice. Detectors deduplicate at the DB layer.
    uniqueIndex("team_improvement_opportunities_unique").on(
      t.teamMember,
      t.signalPattern,
      t.description,
    ),
    index("team_improvement_opportunities_detected_idx").on(t.detectedAt),
    index("team_improvement_opportunities_member_idx").on(
      t.teamMember,
      t.detectedAt,
    ),
    index("team_improvement_opportunities_severity_idx").on(
      t.severity,
      t.detectedAt,
    ),
    index("team_improvement_opportunities_dispatched_idx").on(
      t.autoDispatched,
      t.detectedAt,
    ),
    index("team_improvement_opportunities_resolved_idx").on(t.resolvedAt),
  ],
);

export type TeamImprovementOpportunity =
  typeof teamImprovementOpportunities.$inferSelect;
export type InsertTeamImprovementOpportunity =
  typeof teamImprovementOpportunities.$inferInsert;

// ============================================
// CONSTANTS — enums (string-text so migrations stay non-breaking).
// ============================================

export const TEAM_IMPROVEMENT_MEMBERS = [
  "iris",
  "soren",
  "beatrice",
  "krieger",
  "solene",
] as const;
export type TeamImprovementMember = (typeof TEAM_IMPROVEMENT_MEMBERS)[number];

export const TEAM_IMPROVEMENT_SIGNAL_PATTERNS = [
  "recurring_gap",
  "pattern_transfer",
  "external_event",
  "recurring_dispatch_flag",
  "successful_pattern",
  "volume_threshold",
  "capital_concentration",
] as const;
export type TeamImprovementSignalPattern =
  (typeof TEAM_IMPROVEMENT_SIGNAL_PATTERNS)[number];

export const TEAM_IMPROVEMENT_SEVERITIES = [
  "info",
  "opportunity",
  "urgent",
] as const;
export type TeamImprovementSeverity =
  (typeof TEAM_IMPROVEMENT_SEVERITIES)[number];

// ============================================
// EVIDENCE SHAPE — opaque jsonb but a typed contract so detectors stay
// honest about what they're persisting.
// ============================================

export interface TeamImprovementEvidence {
  /** Audit findings, decisions, capital events, commits that triggered. */
  sourceRefs?: Array<{
    kind:
      | "solene_audit_finding"
      | "solene_decision"
      | "solene_capital_event"
      | "beatrice_reg_event"
      | "git_commit"
      | "service_path"
      | "team_member_baseline";
    id?: string | number;
    summary?: string;
  }>;
  /** Heuristic counts the detector used (e.g. "saw N matches"). */
  counts?: Record<string, number>;
  /** Free-form notes the detector wants to surface. */
  notes?: string;
}
