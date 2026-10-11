// ============================================================================
// SHARED/SCHEMA/FORECASTING.TS — W4 forecasting's three append-only stores.
// ----------------------------------------------------------------------------
// Migration 0272. Mirrors scripts/migrate.mjs STATEMENTS.
//
// WHY THREE NEW TABLES (table-count 727 -> 730, a conscious "yes we need this")
// ---------------------------------------------------------------------------
// Each is a record of what was KNOWN at a moment, and nothing existing keeps
// that, checked against code:
//   - `market_indicators_temp` holds one latest row of national indicators with
//     no series, observation date or vintage; `market_metrics` and
//     `market_predictions` are per-county rows UPDATED in place when actuals
//     arrive (marketIntelligence.ts) — the overwrite a vintage store forbids.
//   - `decision_snapshots` is a CUSTOMER's decision with a NOT NULL tenant key;
//     a platform forecast filed there would need a made-up organisation.
//   - `outcomes` requires a decision snapshot; `deals`/`offers` are mutable
//     (updated_at), so the price a deal closed at today can be edited tomorrow
//     and the as-known value is lost. `activity_events` renders into the
//     customer's own timeline.
// IMMUTABLE BY CONTRACT: no updated_at column, no UPDATE path in the stores
// (server/services/forecasting/*). Inserts use ON CONFLICT DO NOTHING.
// ============================================================================

import {
  pgTable,
  serial,
  integer,
  text,
  timestamp,
  jsonb,
  date,
  doublePrecision,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { organizations } from "../schema";
import type { FrozenForecast, ForecastScore } from "../forecasting/frozenForecast";
import type { OutcomeField, OutcomeKind } from "../forecasting/models";

/**
 * A public series value AS KNOWN on `vintage_date`. A revision is a new row
 * under a later vintage; the earlier row stays (shared/forecasting/vintage.ts).
 * Platform-global public data — no tenant key.
 */
export const publicSeriesVintages = pgTable(
  "public_series_vintages",
  {
    id: serial("id").primaryKey(),
    seriesId: text("series_id").notNull(),
    /** PUBLIC_SERIES family id (shared/forecasting/publicSeries.ts). */
    family: text("family").notNull(),
    observationDate: date("observation_date", { mode: "string" }).notNull(),
    vintageDate: date("vintage_date", { mode: "string" }).notNull(),
    value: doublePrecision("value").notNull(),
    /** Data-licence register key the value came under. */
    source: text("source").notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("public_series_vintages_series_obs_vintage_uk").on(table.seriesId, table.observationDate, table.vintageDate),
    index("public_series_vintages_family_vintage_idx").on(table.family, table.vintageDate),
  ],
);

/**
 * The scored registry: an `issued` entry freezes a forecast before its outcome
 * exists; a `scored` entry appends the outcome against it. Never edited.
 */
export const forecastLedger = pgTable(
  "forecast_ledger",
  {
    id: serial("id").primaryKey(),
    entryKind: text("entry_kind").$type<"issued" | "scored">().notNull(),
    forecastKey: text("forecast_key").notNull(),
    engineId: text("engine_id").notNull(),
    engineVersion: text("engine_version").notNull(),
    subject: text("subject").notNull(),
    targetDate: date("target_date", { mode: "string" }).notNull(),
    issuedAsOf: date("issued_as_of", { mode: "string" }).notNull(),
    body: jsonb("body").$type<FrozenForecast | ForecastScore>().notNull(),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("forecast_ledger_kind_key_uk").on(table.entryKind, table.forecastKey),
    index("forecast_ledger_engine_kind_issued_idx").on(table.engineId, table.entryKind, table.issuedAsOf),
  ],
);

/**
 * A customer outcome AS KNOWN when the monthly recorder saw it: a closed deal,
 * an accepted or declined offer, a response to outreach. Only the fields in
 * OUTCOME_FIELDS (prices, timings, results, channels — never a person).
 */
export const customerOutcomeObservations = pgTable(
  "customer_outcome_observations",
  {
    id: serial("id").primaryKey(),
    organizationId: integer("organization_id")
      .references(() => organizations.id, { onDelete: "cascade" })
      .notNull(),
    kind: text("kind").$type<OutcomeKind>().notNull(),
    /** The table the outcome was read from ("deals", "offers", "campaign_responses"). */
    subjectTable: text("subject_table").notNull(),
    subjectId: integer("subject_id").notNull(),
    state: text("state"),
    county: text("county"),
    observedAt: timestamp("observed_at").notNull(),
    values: jsonb("values").$type<Partial<Record<OutcomeField, number | string>>>().notNull().default({}),
    recordedAt: timestamp("recorded_at").notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("customer_outcome_obs_org_kind_subject_uk").on(table.organizationId, table.kind, table.subjectTable, table.subjectId),
    index("customer_outcome_obs_org_observed_idx").on(table.organizationId, table.observedAt),
  ],
);

export type PublicSeriesVintageRow = typeof publicSeriesVintages.$inferSelect;
export type ForecastLedgerRow = typeof forecastLedger.$inferSelect;
export type CustomerOutcomeObservationRow = typeof customerOutcomeObservations.$inferSelect;
