// ============================================================================
// SHARED/SCHEMA/SOLENE-AUDIT.TS
// ----------------------------------------------------------------------------
// Solene (COO) — self-audit ledger.
//
// Detection-only. Persists per-session + per-week sweeps that score Solene's
// own behavioural patterns against the operating-discipline memories
// (feedback_coo_authority, feedback_credential_value_handling,
// feedback_verify_before_dispatch, feedback_elite_multi_dimensional,
// feedback_solene_self_development).
//
// Three tables:
//   1. `solene_decisions`       — every Solene-initiated dispatch / hold /
//                                 propose / defer / escalate is logged here
//                                 the moment it's taken (fire-and-forget).
//   2. `solene_audit_runs`      — one row per (cron tick × scope) execution
//                                 of runSoleneAudit.
//   3. `solene_audit_findings`  — one row per (decision × detector) failure.
//
// Idempotency: UNIQUE(run_id, decision_id, pattern) so a per-week re-sweep
// over the same decision window is a no-op at the DB layer.
//
// The schema is the floor. Drift signal (logger.error + Sentry capture)
// fires from the service layer when the per-run finding budget is breached.
// Remediation comes from Solene's discipline + memory updates downstream.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";

// ============================================
// SOLENE_DECISIONS
// ============================================
// One row per Solene-initiated action. `decision_type` describes what kind
// of action (dispatch / hold / propose / defer / escalate). `context_summary`
// is the ≤500 char gist of what the moment was. `rationale` is Solene's
// stated reason. `outcome` is populated post-hoc when the dispatch lands
// (or fails). `capital_impact_usd` is filled from the capital tracker
// when an associated cost event ties back to this decision.
//
// recordSoleneDecision() inserts here. The audit walks rows ordered by
// decided_at DESC and runs each through the eight detectors.
export const soleneDecisions = pgTable(
  "solene_decisions",
  {
    id: serial("id").primaryKey(),
    decidedAt: timestamp("decided_at", { withTimezone: true }).notNull().defaultNow(),
    decisionType: text("decision_type").notNull(), // dispatch | hold | propose | defer | escalate
    contextSummary: text("context_summary").notNull(), // ≤500 chars (service-enforced)
    rationale: text("rationale").notNull(),
    responseText: text("response_text"), // optional snapshot of what Solene actually said
    outcome: text("outcome"), // post-hoc: shipped | failed | redirected | null
    capitalImpactUsd: numeric("capital_impact_usd", { precision: 10, scale: 4 }),
  },
  (t) => [
    index("solene_decisions_decided_idx").on(t.decidedAt),
    index("solene_decisions_type_idx").on(t.decisionType, t.decidedAt),
  ],
);

export type SoleneDecision = typeof soleneDecisions.$inferSelect;
export type InsertSoleneDecision = typeof soleneDecisions.$inferInsert;

// ============================================
// SOLENE_AUDIT_RUNS
// ============================================
// One row per execution of runSoleneAudit(). `scope` is per-session
// (60min cron proxy), per-week (Sunday 23:00 UTC), or ad-hoc (manual).
// `decisions_examined` + `drift_count` + `finding_count` are the headline
// counters; the per-finding detail lives in solene_audit_findings.
export const soleneAuditRuns = pgTable(
  "solene_audit_runs",
  {
    id: serial("id").primaryKey(),
    runStartedAt: timestamp("run_started_at", { withTimezone: true }).notNull().defaultNow(),
    runEndedAt: timestamp("run_ended_at", { withTimezone: true }),
    scope: text("scope").notNull(), // per-session | per-week | ad-hoc
    decisionsExamined: integer("decisions_examined").notNull().default(0),
    driftCount: integer("drift_count").notNull().default(0),
    findingCount: integer("finding_count").notNull().default(0),
    driftSignalEmitted: boolean("drift_signal_emitted").notNull().default(false),
    skipReason: text("skip_reason"),
  },
  (t) => [
    index("solene_audit_runs_started_idx").on(t.runStartedAt),
    index("solene_audit_runs_scope_idx").on(t.scope, t.runStartedAt),
  ],
);

export type SoleneAuditRun = typeof soleneAuditRuns.$inferSelect;
export type InsertSoleneAuditRun = typeof soleneAuditRuns.$inferInsert;

// ============================================
// SOLENE_AUDIT_FINDINGS
// ============================================
// One row per (decision × detector) match. `pattern` is the detector name
// (menu_handing | permission_seeking | credential_value_in_output | ...).
// `severity` is one of info | warn | fail | critical (service-enforced).
// `citation` names the feedback memory the finding implicates.
// `decision_id` is nullable so detectors that fire against responses
// outside a recorded decision (e.g. session-wide brief-staleness) can
// still persist.
export const soleneAuditFindings = pgTable(
  "solene_audit_findings",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => soleneAuditRuns.id, { onDelete: "cascade" })
      .notNull(),
    decisionId: integer("decision_id").references(() => soleneDecisions.id, {
      onDelete: "set null",
    }),
    pattern: text("pattern").notNull(),
    severity: text("severity").notNull(), // info | warn | fail | critical
    citation: text("citation").notNull(),
    excerpt: text("excerpt").notNull(),
    matchedPatterns: jsonb("matched_patterns").$type<string[]>().notNull().default([]),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotent re-runs: a given (run, decision, pattern) can only produce
    // one finding. decision_id NULL still uniques via NULLS NOT DISTINCT
    // semantics — see migrate.mjs note.
    uniqueIndex("solene_audit_findings_unique").on(
      t.runId,
      t.decisionId,
      t.pattern,
    ),
    index("solene_audit_findings_run_idx").on(t.runId),
    index("solene_audit_findings_severity_idx").on(t.severity, t.firedAt),
    index("solene_audit_findings_pattern_idx").on(t.pattern, t.firedAt),
  ],
);

export type SoleneAuditFinding = typeof soleneAuditFindings.$inferSelect;
export type InsertSoleneAuditFinding = typeof soleneAuditFindings.$inferInsert;

export const SOLENE_AUDIT_SEVERITIES = ["info", "warn", "fail", "critical"] as const;
export type SoleneAuditSeverity = (typeof SOLENE_AUDIT_SEVERITIES)[number];

export const SOLENE_DECISION_TYPES = [
  "dispatch",
  "hold",
  "propose",
  "defer",
  "escalate",
] as const;
export type SoleneDecisionType = (typeof SOLENE_DECISION_TYPES)[number];

export const SOLENE_AUDIT_SCOPES = ["per-session", "per-week", "ad-hoc"] as const;
export type SoleneAuditScope = (typeof SOLENE_AUDIT_SCOPES)[number];
