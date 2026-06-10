// ============================================================================
// SHARED/SCHEMA/CALIBRATION-THRESHOLD-ADJUSTMENTS.TS
// ----------------------------------------------------------------------------
// Tier 2D (elevation blueprint) — bounded, audited threshold adjustment for
// the Pax support auto-resolve calibration grader.
//
// The daily grader (server/services/andrei/supportResolverCalibration.ts)
// measures Brier-style calibration on the ONE path Pax acts on a customer
// unsupervised. When it detects drift it records a domain-audit finding AND
// applies a BOUNDED offset to the auto-resolve confidence threshold — every
// adjustment lands here as an append-only audit row. The active offset is the
// latest row's new_offset; hard clamps live in
// server/services/andrei/resolverThresholdAdjustment.ts.
//
// Platform-level (one autonomous path) — no organization_id by design.
// DISTINCT from any Tier 2A `model_calibration_log` (LCS calibrator weights):
// different loop, different consumers; the two coexist.
//
// Mirror in scripts/migrate.mjs (0155).
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const supportResolverThresholdAdjustments = pgTable(
  "support_resolver_threshold_adjustments",
  {
    id: serial("id").primaryKey(),
    /** Which autonomous surface the offset applies to. Only 'support_resolve' today. */
    surface: text("surface").notNull().default("support_resolve"),
    previousOffset: integer("previous_offset").notNull(),
    newOffset: integer("new_offset").notNull(),
    /** 'raise' | 'lower' — see THRESHOLD_ADJUSTMENT_DIRECTIONS. */
    direction: text("direction").notNull(),
    /** Human-readable why (drift detected / calibration recovered / …). */
    reason: text("reason").notNull(),
    brierScore: numeric("brier_score", { precision: 6, scale: 4 }),
    overconfidenceBias: numeric("overconfidence_bias", { precision: 6, scale: 2 }),
    gradedDecisions: integer("graded_decisions").notNull().default(0),
    /** True when the requested step saturated against a hard clamp. */
    clamped: boolean("clamped").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("srta_surface_created_idx").on(t.surface, t.createdAt)],
);

export type SupportResolverThresholdAdjustment =
  typeof supportResolverThresholdAdjustments.$inferSelect;
export type InsertSupportResolverThresholdAdjustment =
  typeof supportResolverThresholdAdjustments.$inferInsert;

export const THRESHOLD_ADJUSTMENT_DIRECTIONS = ["raise", "lower"] as const;
export type ThresholdAdjustmentDirection =
  (typeof THRESHOLD_ADJUSTMENT_DIRECTIONS)[number];

export const THRESHOLD_ADJUSTMENT_SURFACE_SUPPORT_RESOLVE =
  "support_resolve" as const;
