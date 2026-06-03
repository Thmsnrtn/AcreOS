// ============================================================================
// SHARED/SCHEMA/SOLENE-ADVERSARIAL-TESTS.TS
// ----------------------------------------------------------------------------
// Solene — adversarial self-testing (Phase B L3.15).
//
// Builds on L2.8 multi-agent code-review but more aggressive. When a dispatch
// completes successfully, an adversarial test can be enqueued — a sibling
// dispatch whose explicit job is to TRY TO BREAK the original's work.
//
// Distinct from code-review (which checks correctness against the brief):
// adversarial-testing actively probes for edge cases, security issues, race
// conditions, mis-specified requirements, and behavioral regressions.
//
// Five strategies — each shapes a distinct attack-oriented system prompt:
//   edge_case_hunter         — boundary conditions, empty/max inputs, off-by-one
//   security_red_team        — injection, auth bypass, side-channels, supply chain
//   race_condition_prober    — concurrency assumptions, double-claim, TOCTOU
//   spec_misinterpretation   — gap between what spec required vs what was built
//   regression_predictor     — what existing behavior might this break?
//
// Status lifecycle:
//   pending → enqueued → running → found_issues | clean | inconclusive
//
// Severity grading mirrors the conventional CVSS-shape ladder, but applies to
// any finding (not just security):
//   critical | high | medium | low | informational
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
// SOLENE_ADVERSARIAL_TESTS
// ============================================
export const soleneAdversarialTests = pgTable(
  "solene_adversarial_tests",
  {
    id: serial("id").primaryKey(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // FK by convention to solene_dispatch_queue.id — the dispatch whose work
    // is under attack. Not enforced at the DB level to keep the test row
    // recoverable if the original row is purged.
    originalDispatchId: integer("original_dispatch_id").notNull(),
    // Set when the adversary dispatch is actually enqueued (see
    // enqueueAdversaryDispatch). Null while the test row is still 'pending'.
    adversarialDispatchId: integer("adversarial_dispatch_id"),
    originalAgentRole: text("original_agent_role").notNull(),
    adversaryStrategy: text("adversary_strategy").notNull(),
    // One-line description of what the adversary should attack. Rendered into
    // the system prompt verbatim.
    testFocus: text("test_focus").notNull(),
    status: text("status").notNull().default("pending"),
    findings: text("findings"),
    severity: text("severity"),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
  },
  (t) => [
    index("solene_adversarial_tests_original_idx").on(t.originalDispatchId),
    index("solene_adversarial_tests_status_idx").on(t.status, t.createdAt),
    index("solene_adversarial_tests_severity_idx").on(
      t.severity,
      t.reportedAt,
    ),
  ],
);

export type AdversarialTestRow = typeof soleneAdversarialTests.$inferSelect;
export type InsertAdversarialTestRow =
  typeof soleneAdversarialTests.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

export const ADVERSARY_STRATEGIES = [
  "edge_case_hunter",
  "security_red_team",
  "race_condition_prober",
  "spec_misinterpretation",
  "regression_predictor",
] as const;
export type AdversaryStrategy = (typeof ADVERSARY_STRATEGIES)[number];

export const ADVERSARIAL_TEST_STATUSES = [
  "pending",
  "enqueued",
  "running",
  "found_issues",
  "clean",
  "inconclusive",
] as const;
export type AdversarialTestStatus =
  (typeof ADVERSARIAL_TEST_STATUSES)[number];

export const ADVERSARIAL_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;
export type AdversarialSeverity = (typeof ADVERSARIAL_SEVERITIES)[number];
