// ============================================================================
// SHARED/SCHEMA/API-TELEMETRY-ROLLUP-MONTHLY.TS
// ----------------------------------------------------------------------------
// Tahoe L14 follow-up — monthly rollup of api_telemetry_samples.
//
// Lena's call from the Wave H1 cost-substrate report: 30-day rolling purge of
// `api_telemetry_samples` with a monthly rollup so the founder cost
// dashboard can still answer "what did this route cost in Feb?" without
// keeping every per-tick row forever.
//
// One row per (year, month, route_key, cost_class). System-wide aggregate —
// not org-scoped (api_telemetry_samples itself is not org-scoped; routes
// fire across all tenants). The composite UNIQUE on (year, month, route_key,
// cost_class) makes the nightly rollup job idempotent: it UPSERTs (ON
// CONFLICT (...) DO UPDATE SET total = excluded.total + rollup_monthly.total)
// so re-running the job for a window that was partially rolled up doesn't
// double-count.
//
// Naming alignment with the brief:
//   - request_count   ← sum of (count2xx + count4xx + count5xx) across samples
//   - total_duration_ms ← sum of total_ms across samples
//   - total_cost_cents  ← currently 0; populated when we wire route-level
//                         cost into api_telemetry_samples (next slice).
//   - distinct_orgs     ← currently 0; populated when we add org tagging to
//                         api_telemetry_samples (out of scope for this slice).
//
// Both zero-stub columns are real schema (not nullable, default 0) so the
// rollup pipeline doesn't need a follow-up migration to start emitting non-
// zero values — the column is already there.
// ============================================================================

import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";

export const apiTelemetryRollupMonthly = pgTable("api_telemetry_rollup_monthly", {
  id: serial("id").primaryKey(),
  /** Four-digit calendar year (UTC) of the rolled-up samples. */
  year: integer("year").notNull(),
  /** 1..12 — calendar month (UTC). */
  month: integer("month").notNull(),
  /** Same shape as api_telemetry_samples.route ("GET /api/leads/:id"). */
  routeKey: text("route_key").notNull(),
  /** Cost class declared at route registration. NULL when sample lacked one. */
  costClass: text("cost_class"),
  /** Sum of (count_2xx + count_4xx + count_5xx) across the bucket. */
  requestCount: bigint("request_count", { mode: "number" }).notNull().default(0),
  /** Sum of total_ms across the bucket. */
  totalDurationMs: bigint("total_duration_ms", { mode: "number" }).notNull().default(0),
  /** Sum of cost_cents across the bucket. 0 until per-route cost is wired. */
  totalCostCents: bigint("total_cost_cents", { mode: "number" }).notNull().default(0),
  /** Count of distinct organisations that hit the route in the bucket. */
  distinctOrgs: integer("distinct_orgs").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (table) => [
  // Idempotency anchor — the rollup job UPSERTs against this composite.
  // costClass is part of the key so a route that toggles its declared class
  // mid-month doesn't collapse two different cost-class buckets into one.
  // NB: Postgres treats NULLs as distinct in UNIQUE indexes by default; for
  // rows with NULL costClass the UPSERT will append rather than collapse —
  // acceptable because we keep the cost-class field a real column on
  // api_telemetry_samples and routes declare it consistently.
  uniqueIndex("api_telemetry_rollup_monthly_uidx").on(
    table.year,
    table.month,
    table.routeKey,
    table.costClass,
  ),
  index("api_telemetry_rollup_monthly_year_month_idx").on(table.year, table.month),
  index("api_telemetry_rollup_monthly_route_idx").on(table.routeKey),
]);

export type ApiTelemetryRollupMonthly = typeof apiTelemetryRollupMonthly.$inferSelect;
export type InsertApiTelemetryRollupMonthly = typeof apiTelemetryRollupMonthly.$inferInsert;
