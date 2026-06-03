// ============================================================================
// SHARED/SCHEMA/IRIS-PERF.TS
// ----------------------------------------------------------------------------
// Iris (CTO) — continuous p95 baseline + regression-detection ledger.
//
// One table: `iris_perf_samples`. Each row is a (route × window) summary —
// p50 / p95 / p99 + sample_count, with the window's start/end timestamps.
//
// The sampler (server/services/iris/perfMonitor.ts) writes one row per
// tracked endpoint per cron tick. The regression detector reads the last
// 7d of rows for an endpoint to derive the rolling baseline, then compares
// the most-recent window's p95 against (2× baseline) and the 1000ms
// absolute ceiling.
//
// Conservative shape — endpoint_path + method are the natural key for
// trending; we keep them as plain text so adding/removing instrumented
// routes is config-only (no migration). The (endpoint_path, window_started_at)
// index is the only critical-path read.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  numeric,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

// ============================================
// IRIS_PERF_SAMPLES
// ============================================
// One row per (endpoint × sampling window). Window length is service-side
// configurable; default = 30 minutes (matches cron cadence). sample_count
// is the number of observations that fed the p50/p95/p99 — used by the
// detector to require a minimum sample size before flagging regressions
// (a single slow request shouldn't trip a 2× threshold).
export const irisPerfSamples = pgTable(
  "iris_perf_samples",
  {
    id: serial("id").primaryKey(),
    endpointPath: text("endpoint_path").notNull(),
    method: text("method").notNull(), // GET | POST | ...
    p50Ms: numeric("p50_ms", { precision: 10, scale: 2 }).notNull(),
    p95Ms: numeric("p95_ms", { precision: 10, scale: 2 }).notNull(),
    p99Ms: numeric("p99_ms", { precision: 10, scale: 2 }).notNull(),
    sampleCount: integer("sample_count").notNull(),
    windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull(),
    windowEndedAt: timestamp("window_ended_at", { withTimezone: true }).notNull(),
    insertedAt: timestamp("inserted_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("iris_perf_samples_path_window_idx").on(t.endpointPath, t.windowStartedAt),
    index("iris_perf_samples_window_idx").on(t.windowStartedAt),
  ],
);

export type IrisPerfSample = typeof irisPerfSamples.$inferSelect;
export type InsertIrisPerfSample = typeof irisPerfSamples.$inferInsert;

/**
 * Tracked endpoints — the initial set. Adding to this list is config-only
 * (no migration). Order is irrelevant; the sampler iterates them per tick.
 *
 * Held deliberately small. Iris expands the list as new critical-path
 * routes ship — each addition should be paired with a baseline burn-in
 * window of ~7 days before regression alerts get trusted.
 */
export const IRIS_TRACKED_ENDPOINTS: ReadonlyArray<{
  path: string;
  method: string;
}> = [
  { path: "/api/today", method: "GET" },
  { path: "/api/healthz", method: "GET" },
  { path: "/api/auth/user", method: "GET" },
  { path: "/api/dashboard/stats", method: "GET" },
];

/**
 * Regression detection thresholds. A finding fires when the latest window's
 * p95 satisfies EITHER condition:
 *   - p95 > BASELINE_MULTIPLIER × rolling_7d_p95
 *   - p95 > ABSOLUTE_CEILING_MS
 *
 * Plus a minimum sample-count guard so a single slow request can't trip a
 * regression. The 7d baseline window matches the typical traffic cycle
 * (weekly business patterns); shorter windows are too noisy.
 */
export const IRIS_REGRESSION_THRESHOLDS = {
  baselineMultiplier: 2,
  absoluteCeilingMs: 1000,
  minSampleCountForAlert: 5,
  baselineWindowHours: 7 * 24,
} as const;
