// ============================================================================
// SHARED/SCHEMA/PAX-AUDIT.TS
// ----------------------------------------------------------------------------
// Beatrice (CRO) — Pax continuous-audit ledger.
//
// Detection-only. Persists the daily sample-and-check runs that verify Pax
// outputs against the constitution (immutables §1, §2, §7, §11, §12) +
// the Pax-only persona-architecture rule.
//
// Two tables:
//   1. `pax_audit_runs`     — one row per (cron tick × org) execution
//   2. `pax_audit_findings` — one row per (sampled output × check) failure
//
// Idempotency: UNIQUE(run_id, source_table, source_row_id, check_name) so
// re-running the audit over the same window is a no-op. Drift signal +
// remediation are downstream (logger.error + Sentry capture + the founder
// read endpoints); the schema is the ledger floor.
//
// Beatrice doctrine: every finding cites the constitutional or regulatory
// section it violates. The `citation` column makes this enforceable — the
// service layer cannot insert a finding without naming the rule.
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
import { organizations } from "../schema";

// ============================================
// PAX_AUDIT_RUNS
// ============================================
// One row per execution of runPaxAudit(). When the cron tick is a
// platform-wide pass, the row's organizationId is the org being walked at
// that step (we write one runs row per org). When runPaxAudit is invoked
// ad-hoc with no orgId (smoke tests, founder self-test), organizationId is
// null and the run examined the most-recent N outputs across all orgs.
export const paxAuditRuns = pgTable(
  "pax_audit_runs",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id").references(() => organizations.id, {
      onDelete: "cascade",
    }),
    runStartedAt: timestamp("run_started_at", { withTimezone: true }).notNull().defaultNow(),
    runEndedAt: timestamp("run_ended_at", { withTimezone: true }),
    samplesExamined: integer("samples_examined").notNull().default(0),
    samplesFailed: integer("samples_failed").notNull().default(0),
    driftSignalEmitted: boolean("drift_signal_emitted").notNull().default(false),
    // windowHours + sampleSize captured so a finding can be reproduced from
    // the run row alone (Beatrice's "every finding reconstructable" rule).
    windowHours: integer("window_hours").notNull().default(24),
    sampleSize: integer("sample_size").notNull().default(20),
    // Reason a per-org pass was skipped (e.g. "no outputs in window"). Null
    // when the run actually examined samples.
    skipReason: text("skip_reason"),
  },
  (t) => [
    index("pax_audit_runs_started_idx").on(t.runStartedAt),
    index("pax_audit_runs_org_started_idx").on(t.organizationId, t.runStartedAt),
  ],
);

export type PaxAuditRun = typeof paxAuditRuns.$inferSelect;
export type InsertPaxAuditRun = typeof paxAuditRuns.$inferInsert;

// ============================================
// PAX_AUDIT_FINDINGS
// ============================================
// One row per (sampled output × failed check). `severity` is enforced at
// the service layer to one of: info | warn | fail | critical. `citation`
// names the constitutional section (Immutable §N) or regulatory section
// (e.g. "§1026.36(c)") the finding implicates.
//
// content_excerpt is the first 500 chars of the offending output so an
// examiner can reproduce the finding without a join to the source table.
// Source columns let us join back to the canonical record on demand.
export const paxAuditFindings = pgTable(
  "pax_audit_findings",
  {
    id: serial("id").primaryKey(),
    runId: integer("run_id")
      .references(() => paxAuditRuns.id, { onDelete: "cascade" })
      .notNull(),
    sourceTable: text("source_table").notNull(), // e.g. "ai_messages"
    sourceRowId: text("source_row_id").notNull(), // serialized PK
    persona: text("persona"), // land_investor | note_investor | ... | null
    audienceScope: text("audience_scope"), // customer | founder | null
    contentExcerpt: text("content_excerpt").notNull(),
    checkName: text("check_name").notNull(),
    severity: text("severity").notNull(), // info | warn | fail | critical
    citation: text("citation").notNull(),
    matchedPatterns: jsonb("matched_patterns").$type<string[]>().notNull().default([]),
    firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // Idempotent re-runs: a given (run, source row, check) can only produce
    // one finding. The cron is safe to re-fire on the same window.
    uniqueIndex("pax_audit_findings_unique").on(
      t.runId,
      t.sourceTable,
      t.sourceRowId,
      t.checkName,
    ),
    index("pax_audit_findings_run_idx").on(t.runId),
    index("pax_audit_findings_severity_idx").on(t.severity, t.firedAt),
    index("pax_audit_findings_check_idx").on(t.checkName, t.firedAt),
  ],
);

export type PaxAuditFinding = typeof paxAuditFindings.$inferSelect;
export type InsertPaxAuditFinding = typeof paxAuditFindings.$inferInsert;

export const PAX_AUDIT_SEVERITIES = ["info", "warn", "fail", "critical"] as const;
export type PaxAuditSeverity = (typeof PAX_AUDIT_SEVERITIES)[number];
