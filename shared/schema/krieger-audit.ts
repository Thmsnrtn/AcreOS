// ============================================================================
// SHARED/SCHEMA/KRIEGER-AUDIT.TS
// ----------------------------------------------------------------------------
// Krieger (Mobile UX & customer-surface specialist) — continuous-audit ledger.
//
// Detection-only. Persists every (detector × tick) run of the mobile-feel
// audit so the founder-visibility surface + the dispatch-queue auto-enqueue
// path have a uniform shape regardless of which detector fired.
//
// Six detectors (KRIEGER_DETECTOR_NAMES):
//
//   1. touch_target_drift
//      Heuristic scan of recent commits touching client/src/pages or
//      client/src/components. Flags additions of interactive elements that
//      may lack an `active:` companion class. False positives expected —
//      severity defaults to medium so they aren't auto-enqueued unless a
//      reviewer escalates.
//
//   2. cross_device_matrix_red
//      Reads the most-recent failure from tests/e2e-mobile/*. The CI mobile
//      matrix is the canonical "did this break on iPhone 12 / Galaxy S20 /
//      iPad mini" signal. Severity is taken from the failure metadata.
//
//   3. mobile_error_boundary_trip
//      Queries solene_dispatch_queue for source_ids related to mobile error
//      boundaries in the last 24h. Trip count proportional to severity.
//
//   4. theme_contract_drift  (TODO — Playwright instrumentation pending)
//      Will compare hex tokens used in DOM vs the design-system token
//      registry. Empty stub for now.
//
//   5. pwa_install_regression  (TODO — analytics integration pending)
//      Will compare install-prompt acceptance + standalone-mode usage week-
//      over-week. Empty stub for now.
//
//   6. real_device_gap  (TODO — manual-test-driven)
//      Will surface device classes that haven't been touched in the
//      manual-test ledger for >14d. Empty stub for now.
//
// Auto-enqueue gate: severity in ['high', 'critical'] auto-enqueues a fix
// dispatch (sourceType='detector', sourceId='krieger-audit:<findingId>',
// agentRole='krieger', $18 cap, priority 1.6 [high] / 2.5 [critical]).
// Idempotency by sourceId tuple so a re-running cron is a no-op.
//
// Review lifecycle (review_status):
//   open       — new finding, no human action yet
//   reviewed   — a reviewer has looked but not classified
//   fixed      — a downstream commit/dispatch resolved the issue
//   wont_fix   — accepted as known limitation
//   duplicate  — same root cause as an earlier open finding
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
// KRIEGER_AUDIT_FINDINGS
// ============================================
// One row per (detector × hit). The (severity, detected_at) index drives the
// founder-visibility surface ("show me critical/high findings today"). The
// (review_status, detected_at) index drives the triage queue.
//
// fix_dispatch_id is the back-pointer to solene_dispatch_queue when a finding
// auto-enqueued a fix dispatch; null until that wire-up fires.
export const kriegerAuditFindings = pgTable(
  "krieger_audit_findings",
  {
    id: serial("id").primaryKey(),
    detectedAt: timestamp("detected_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    detectorName: text("detector_name").notNull(), // see KRIEGER_DETECTOR_NAMES
    severity: text("severity").notNull(), // see KRIEGER_SEVERITIES
    targetRoute: text("target_route"),
    targetViewport: text("target_viewport"),
    findingText: text("finding_text").notNull(),
    evidenceSnippet: text("evidence_snippet"),
    recommendedAction: text("recommended_action"),
    reviewStatus: text("review_status").notNull().default("open"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    reviewedBy: text("reviewed_by"),
    fixDispatchId: integer("fix_dispatch_id"),
  },
  (t) => [
    index("krieger_audit_findings_severity_idx").on(t.severity, t.detectedAt),
    index("krieger_audit_findings_detector_idx").on(
      t.detectorName,
      t.detectedAt,
    ),
    index("krieger_audit_findings_route_idx").on(t.targetRoute),
    index("krieger_audit_findings_review_idx").on(
      t.reviewStatus,
      t.detectedAt,
    ),
  ],
);

export type KriegerAuditFinding = typeof kriegerAuditFindings.$inferSelect;
export type InsertKriegerAuditFinding = typeof kriegerAuditFindings.$inferInsert;

// ============================================
// ENUMS
// ============================================

export const KRIEGER_DETECTOR_NAMES = [
  "touch_target_drift",
  "cross_device_matrix_red",
  "mobile_error_boundary_trip",
  "theme_contract_drift",
  "pwa_install_regression",
  "real_device_gap",
  // Phase D3 — scope expansion to desktop. Heuristic scan of recent
  // client/src/pages/*.tsx commits for raw <div onClick> patterns
  // without keyboard handlers / focus-visible. Severity high for raw
  // divs (likely a11y gap on desktop), medium for shadcn-wrapped
  // patterns (worth verifying), skipped on pages/founder/* routes.
  "desktop_keyboard_nav_drift",
] as const;
export type KriegerDetectorName = (typeof KRIEGER_DETECTOR_NAMES)[number];

export const KRIEGER_SEVERITIES = [
  "critical",
  "high",
  "medium",
  "low",
  "informational",
] as const;
export type KriegerSeverity = (typeof KRIEGER_SEVERITIES)[number];

export const KRIEGER_REVIEW_STATUSES = [
  "open",
  "reviewed",
  "fixed",
  "wont_fix",
  "duplicate",
] as const;
export type KriegerReviewStatus = (typeof KRIEGER_REVIEW_STATUSES)[number];

/**
 * Severities that auto-enqueue a fix dispatch. The runMobileFeelAudit
 * orchestrator gates on this set + an idempotency check; anything else
 * persists to the ledger only.
 */
export const KRIEGER_AUTO_ENQUEUE_SEVERITIES = new Set<KriegerSeverity>([
  "critical",
  "high",
]);

/**
 * Priority assignment for the auto-enqueued dispatch — critical jumps the
 * queue (2.5), high is above the 1.0 baseline (1.6).
 */
export const KRIEGER_DISPATCH_PRIORITY = {
  critical: 2.5,
  high: 1.6,
} as const;

/**
 * Per-dispatch cost cap for auto-enqueued Krieger fixes. Below the $25
 * default; the work is targeted UX patches, not multi-file refactors.
 */
export const KRIEGER_DISPATCH_MAX_COST_USD = 18;

/**
 * Per-dispatch timeout for auto-enqueued Krieger fixes. 10 minutes.
 */
export const KRIEGER_DISPATCH_TIMEOUT_MS = 10 * 60 * 1000;
