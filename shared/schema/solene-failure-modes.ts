// ============================================================================
// SHARED/SCHEMA/SOLENE-FAILURE-MODES.TS
// ----------------------------------------------------------------------------
// Solene — failure-mode library (Layer 3 capability L3.12 of the
// agentic-evolution architecture, feedback_agentic_evolution_north_star.md).
//
// A structurally consulted ledger of every past failure pattern. Today's
// failure modes live in scattered feedback memories — they're never
// structurally checked against new work. This table + the disk-backed
// docs/internal/failure-modes/ ledger fix that.
//
// Source of truth = the disk markdown files (one entry per slug). The DB
// table is a query-friendly mirror that `seedFailureModesFromDisk` upserts
// from disk on startup. The dispatchRunner reads from disk (with a 60-second
// in-process cache) when building the per-dispatch failure-mode preamble.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================
// SOLENE_FAILURE_MODES
// ============================================
export const soleneFailureModes = pgTable(
  "solene_failure_modes",
  {
    id: serial("id").primaryKey(),
    slug: text("slug").notNull(), // stable identifier — matches the disk filename stem
    title: text("title").notNull(),
    severity: text("severity").notNull(), // see FAILURE_MODE_SEVERITIES
    category: text("category").notNull(), // see FAILURE_MODE_CATEGORIES
    description: text("description").notNull(),
    // File-path / keyword patterns whose presence in a planned dispatch
    // should surface this failure mode. Used by loadFailureModePreambleFor()
    // when plannedFiles is provided.
    triggerPatterns: text("trigger_patterns")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    prevention: text("prevention").notNull(),
    // git SHAs, memory-file names, or any other archival ref.
    exampleIncidentRefs: text("example_incident_refs")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    // Tier 2D — 'published' (disk-backed, agent-consulted) | 'draft'
    // (auto-drafted from an incident's lessonsLearned; review-gated). The
    // dispatch preamble reads ONLY the disk ledger, so a draft never reaches
    // an agent until a human promotes it to a docs/internal/failure-modes/
    // entry (at which point seedFailureModesFromDisk flips it to published).
    status: text("status").notNull().default("published"),
    // incidents.id when the row was auto-drafted from an incident resolution.
    // Makes the auto-draft idempotent per incident.
    sourceIncidentId: text("source_incident_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    // When set, the failure mode is retired and should no longer appear in
    // the preamble. Slugs are never deleted — historical reference matters.
    retiredAt: timestamp("retired_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("solene_failure_modes_slug_unique").on(t.slug),
    index("solene_failure_modes_severity_idx").on(t.severity, t.retiredAt),
    index("solene_failure_modes_category_idx").on(t.category, t.retiredAt),
    index("solene_failure_modes_status_idx").on(t.status),
  ],
);

export type SoleneFailureMode = typeof soleneFailureModes.$inferSelect;
export type InsertSoleneFailureMode = typeof soleneFailureModes.$inferInsert;

// ============================================
// ENUMS / CONSTANTS
// ============================================

export const FAILURE_MODE_SEVERITIES = [
  "low",
  "medium",
  "high",
  "critical",
] as const;
export type SoleneFailureModeSeverity =
  (typeof FAILURE_MODE_SEVERITIES)[number];

export const FAILURE_MODE_STATUSES = ["published", "draft"] as const;
export type SoleneFailureModeStatus = (typeof FAILURE_MODE_STATUSES)[number];

export const FAILURE_MODE_CATEGORIES = [
  "credential_handling",
  "dispatch_collision",
  "scope_drift",
  "regression_class",
  "ux_regression",
  "other",
] as const;
export type SoleneFailureModeCategory =
  (typeof FAILURE_MODE_CATEGORIES)[number];

// Render budget for the preamble block (matches identity + team-state caps).
export const FAILURE_MODE_PREAMBLE_MAX_BYTES = 6 * 1024;

// In-process disk-read cache lifetime — keep hot-path reads cheap without
// pinning stale content too long.
export const FAILURE_MODE_DISK_CACHE_MS = 60_000;
