// ============================================================================
// SHARED/SCHEMA/TEAM-SYSTEM-AUDIT.TS
// ----------------------------------------------------------------------------
// Solene v3 — TEAM-SYSTEM audit ledger.
//
// Distinct from per-member audits (Beatrice's Pax audit, Iris's perf monitor,
// Solene's self-audit). This ledger captures the OVERARCHING perspective:
// the team-as-a-system has an elite bar that is distinct from any single
// member's bar, and Solene owns it. Findings expose drift across six
// system-level dimensions:
//
//   cross_team_handoff      — Iris ships money-touching code → did Beatrice fire?
//   coordination_quality    — two agents collide on the same file in the same hour
//   anti_fragmentation      — member B ships ¬X two weeks after member A shipped X
//   outside_in_benchmark    — Stripe/Linear/Collison practice AcreOS should import
//   team_synergy            — cross-functional commit volume trending down
//   elite_bar_trajectory    — a member's elite bar hasn't closed an item in 90d
//
// Two tables:
//   1. team_system_audit_runs     — one row per (cron tick × scope) execution
//   2. team_system_audit_findings — one row per (run × dimension × description)
//
// Idempotency: UNIQUE(run_id, dimension, description) so re-runs over the
// same window are a no-op at the DB layer. Mirror in scripts/migrate.mjs.
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

export const TEAM_SYSTEM_AUDIT_DIMENSIONS = [
  "cross_team_handoff",
  "coordination_quality",
  "anti_fragmentation",
  "outside_in_benchmark",
  "team_synergy",
  "elite_bar_trajectory",
] as const;
export type TeamSystemAuditDimension =
  (typeof TEAM_SYSTEM_AUDIT_DIMENSIONS)[number];

export const TEAM_SYSTEM_AUDIT_SEVERITIES = [
  "info",
  "warn",
  "fail",
  "critical",
] as const;
export type TeamSystemAuditSeverity =
  (typeof TEAM_SYSTEM_AUDIT_SEVERITIES)[number];

// ============================================
// TEAM_SYSTEM_AUDIT_RUNS
// ============================================
// One row per cron tick. `dimensions_scanned` is jsonb so a partial run
// (e.g. only `outside_in_benchmark` on the weekly schedule) is auditable
// without ambiguity. `finding_count` + `drift_signal_emitted` are the
// headline counters; per-finding detail lives in team_system_audit_findings.
export const teamSystemAuditRuns = pgTable(
  "team_system_audit_runs",
  {
    id: serial("id").primaryKey(),
    runStartedAt: timestamp("run_started_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    runEndedAt: timestamp("run_ended_at", { withTimezone: true }),
    dimensionsScanned: jsonb("dimensions_scanned")
      .$type<TeamSystemAuditDimension[]>()
      .notNull()
      .default([]),
    findingCount: integer("finding_count").notNull().default(0),
    driftSignalEmitted: boolean("drift_signal_emitted")
      .notNull()
      .default(false),
    skipReason: text("skip_reason"),
  },
  (t) => [
    index("team_system_audit_runs_started_idx").on(t.runStartedAt),
  ],
);

export type TeamSystemAuditRun = typeof teamSystemAuditRuns.$inferSelect;
export type InsertTeamSystemAuditRun =
  typeof teamSystemAuditRuns.$inferInsert;

// ============================================
// TEAM_SYSTEM_AUDIT_FINDINGS
// ============================================
// One row per (run × dimension × description) match. `dimension` is the
// system-level scanner that fired (enum-checked at the service layer);
// `description` is ≤500 chars (service-enforced). `evidence` is jsonb so
// each scanner can attach the proof (commit SHAs, file paths, RSS URLs,
// last-closed dates) without a schema migration per scanner.
export const teamSystemAuditFindings = pgTable(
  "team_system_audit_findings",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => teamSystemAuditRuns.id, { onDelete: "cascade" })
      .notNull(),
    dimension: text("dimension").notNull(),
    severity: text("severity").notNull(),
    description: text("description").notNull(),
    evidence: jsonb("evidence")
      .$type<Record<string, unknown>>()
      .notNull()
      .default({}),
    firedAt: timestamp("fired_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    uniqueIndex("team_system_audit_findings_unique").on(
      t.runId,
      t.dimension,
      t.description,
    ),
    index("team_system_audit_findings_run_idx").on(t.runId),
    index("team_system_audit_findings_dim_idx").on(t.dimension, t.firedAt),
    index("team_system_audit_findings_severity_idx").on(
      t.severity,
      t.firedAt,
    ),
  ],
);

export type TeamSystemAuditFinding =
  typeof teamSystemAuditFindings.$inferSelect;
export type InsertTeamSystemAuditFinding =
  typeof teamSystemAuditFindings.$inferInsert;
