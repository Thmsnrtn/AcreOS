// ============================================================================
// SHARED/SCHEMA/ONBOARDING-FUNNEL.TS
// ----------------------------------------------------------------------------
// Phase D2 — signup-to-first-value instrumentation.
//
// `onboarding_funnel_metrics` — one row per (org, measured_date), derived
// from the lifecycle_events firehose (shared/schema.ts → lifecycleEvents,
// Pillar E5). This table is the **read-side analysis surface** for the
// onboarding funnel; it does not duplicate event storage. The
// recordLifecycleEvent emission infrastructure (Rosy River) is left
// untouched — this layer reads it and persists derived metrics.
//
// "First value" = the FIRST lifecycle event per org matching any of:
//   property.created
//   deal.created
//   pax.first_message
//   onboarding.step_5_completed
//
// (See server/services/onboarding/firstValueInstrumentation.ts.)
//
// Phase 0-1 Elevate target: median TTFV < 90 seconds. The summary endpoint
// surfaces `belowNinetySecondThreshold` so we can chart against that bar.
//
// org_id is stored as text here even though lifecycle_events.organization_id
// is integer. This is intentional: the funnel rows are stable analytical
// records that can outlive the FK target row (org churned, hard-deleted,
// merged). We coerce at the service layer.
//
// Mirror in scripts/migrate.mjs.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  date,
  timestamp,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

// ============================================
// ONBOARDING_FUNNEL_METRICS
// ============================================
export const onboardingFunnelMetrics = pgTable(
  "onboarding_funnel_metrics",
  {
    id: serial("id").primaryKey(),

    // Text on purpose — see header comment.
    orgId: text("org_id").notNull(),

    // The day the metric was COMPUTED (not the signup day). One row per
    // org per measurement day — re-running the computation on a later
    // day produces a new snapshot row.
    measuredDate: date("measured_date").notNull(),

    // Signup timestamp from lifecycle_events (signup.created).
    signupAt: timestamp("signup_at", { withTimezone: true }).notNull(),

    // Timestamp of the first qualifying "first value" event. Nullable if
    // the org hasn't hit first value yet.
    firstValueAt: timestamp("first_value_at", { withTimezone: true }),

    // Computed when firstValueAt is set: floor((firstValueAt - signupAt) / 1000).
    timeToFirstValueSeconds: integer("time_to_first_value_seconds"),

    // Which event-type string qualified — preserved for drill-down so
    // founders can see HOW each org reached first value (created a
    // property vs. messaged Pax vs. finished onboarding).
    firstValueAction: text("first_value_action"),

    // Onboarding step completion timestamps, derived from
    // onboarding.step_{N}_completed events.
    step1CompletedAt: timestamp("step_1_completed_at", { withTimezone: true }),
    step2CompletedAt: timestamp("step_2_completed_at", { withTimezone: true }),
    step3CompletedAt: timestamp("step_3_completed_at", { withTimezone: true }),
    step4CompletedAt: timestamp("step_4_completed_at", { withTimezone: true }),
    step5CompletedAt: timestamp("step_5_completed_at", { withTimezone: true }),

    // Set when the org has been incomplete > 7 days. Value is the LAST
    // step they completed before stalling — i.e. they abandoned AT the
    // next step. Null when the funnel is either complete or still in
    // its first week.
    abandonedAtStep: integer("abandoned_at_step"),
    abandonedReason: text("abandoned_reason"),

    // Vertical from pax_user_context (D1) if a row exists. Lets us slice
    // the funnel by vertical (land_investing vs fix_and_flip vs ...).
    vertical: text("vertical"),

    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    // UNIQUE(org_id, measured_date) — upsert key. Re-measurements within
    // the same day update in place; a fresh measurement on a new day
    // creates a new historical row.
    uniqueIndex("onboarding_funnel_org_day_unique").on(
      t.orgId,
      t.measuredDate,
    ),
    // Most-recent-first listing.
    index("onboarding_funnel_measured_date_idx").on(t.measuredDate),
    // Per-org drill-down.
    index("onboarding_funnel_org_idx").on(t.orgId),
    // Partial index for percentile / threshold analysis. Postgres skips
    // NULL-only buckets, but the partial keeps the index hot for the
    // funnel-summary path which only ever filters NOT NULL.
    index("onboarding_funnel_ttfv_idx")
      .on(t.timeToFirstValueSeconds)
      .where(sql`time_to_first_value_seconds IS NOT NULL`),
  ],
);

export type OnboardingFunnelMetricRow =
  typeof onboardingFunnelMetrics.$inferSelect;
export type InsertOnboardingFunnelMetric =
  typeof onboardingFunnelMetrics.$inferInsert;

// ============================================
// QUALIFYING EVENT TYPES
// ============================================

/**
 * The four event-type strings (eventType column on lifecycle_events) that
 * count as "first value". The FIRST one per org chronologically is the
 * winner; ties (same occurredAt) are broken by event-type order below.
 *
 * This list is intentionally kept in the schema module so the service
 * and the test fixtures import the same canonical strings.
 */
export const FIRST_VALUE_EVENT_TYPES = [
  "property.created",
  "deal.created",
  "pax.first_message",
  "onboarding.step_5_completed",
] as const;
export type FirstValueEventType = (typeof FIRST_VALUE_EVENT_TYPES)[number];

/**
 * Phase 0-1 Elevate target for time-to-first-value. The founder dashboard
 * surfaces median TTFV with green/amber/red against this bar.
 */
export const TTFV_TARGET_SECONDS = 90;

/**
 * An org is considered "abandoned" if it hasn't completed onboarding and
 * its most recent step-completion event is older than this window.
 */
export const ABANDONMENT_THRESHOLD_DAYS = 7;
