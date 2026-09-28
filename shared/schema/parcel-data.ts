/**
 * parcel-data — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - PUBLIC PARCEL REPORTS (Tier 3A — /p/:state/:county/:apn permalinks)
 *   - COUNTY COVERAGE REQUEST (customer-facing "request this county" CTA)
 *   - PARCEL SNAPSHOTS (Centralized Parcel Cache)
 *   - PAID-DATA EVAL RESULTS (Iyari #6 + Lena #3)
 *   - DATA SOURCE CACHE (Cached lookups from free sources)
 *   - DISCOVERED ENDPOINTS (Live GIS Discovery Results)
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, boolean, timestamp, numeric, jsonb, index, uniqueIndex, real, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { countyDiscoveryQueue, dataSources, organizations } from "../schema";

// ============================================
// PUBLIC PARCEL REPORTS (Tier 3A — /p/:state/:county/:apn permalinks)
// ============================================
//
// Saved, shareable public parcel reports (migration 0156, elevation blueprint
// 3A). Each row IS the cache for one permalink: free/government-data parcel
// facts + the honest PARTIAL Land Credit Score computed from those facts only.
// No org linkage by design — these are pre-signup acquisition surfaces.
//
// Honesty + licensing contract:
//  - facts carry only free-tier sources (the generation path is hard-capped to
//    maxTier:"free" through resolveParcel; paid/byok providers are structurally
//    unreachable — see server/services/publicParcelReport.ts).
//  - County-assessor attributes (owner, tax, assessed value) are persisted ONLY
//    when the county's county_gis_endpoints row says redistributable in
//    ('yes','attribution') (Beatrice rule: un-reviewed counties are
//    live-passthrough only — a saved public page is redistribution).
//  - lcs locked dimensions carry score:null, never an invented value.

/** One free-data fact category as rendered on the public report. */
export interface PublicReportFactCategory {
  category: string; // flood_zone | soil | elevation | wetlands
  available: boolean;
  data: unknown; // raw free-source payload (zone, soilType, elevationFeet, …)
  source: string | null; // e.g. "FEMA NFHL" — named even when empty
  sourceAsOf: string | null;
  classification: "authoritative" | "estimate" | "modeled" | "unknown";
  fromCache: boolean;
}

export interface PublicReportFacts {
  parcel: {
    apn: string;
    state: string;
    county: string;
    acres: number | null;
    centroid: { lat: number; lng: number } | null;
    /**
     * included            — county attributes persisted (license allows)
     * not-redistributable — county record exists; terms not yet reviewed →
     *                       attributes intentionally omitted from the page
     * unavailable         — no free county source matched this APN
     */
    countyAttributes: "included" | "not-redistributable" | "unavailable";
    /** Required attribution string when countyAttributes === "included". */
    attribution: string | null;
    /** Present only when countyAttributes === "included". */
    assessorData?: Record<string, unknown> | null;
  };
  categories: PublicReportFactCategory[];
}

export type PublicLcsDimensionKey =
  | "location"
  | "physical"
  | "legal"
  | "financial"
  | "environmental"
  | "market";

export interface PublicLcsDimension {
  key: PublicLcsDimensionKey;
  label: string;
  weight: number; // canonical LCS weight (sums to 100 across all six)
  status: "scored" | "locked";
  /** 0–100 when scored; ALWAYS null when locked (honesty invariant). */
  score: number | null;
  /** Sub-factors actually informed by free government data. */
  coverage: string[];
  /** Sub-factors that need full-AcreOS data — named, never guessed. */
  missing: string[];
  /** Government sources backing the scored sub-factors. */
  sources: string[];
}

export interface PublicLcs {
  kind: "partial";
  basis: "government-data-only";
  scoredDimensions: number;
  totalDimensions: number;
  /**
   * Share of total LCS dimension weight covered by the scored dimensions,
   * 0–100 rounded (sum of scored-dimension weights ÷ total weight × 100).
   * Quantifies HOW partial the partial score is — a 2-of-6 score that covers
   * 30% of scoring weight is honestly different from one that covers 70%.
   */
  weightCoveredPct: number;
  /** 300–850 over scored dimensions only (weights renormalized); null when nothing scored. */
  partialScore: number | null;
  partialGrade: string | null;
  dimensions: PublicLcsDimension[];
  modelVersion: string;
  computedAt: string;
  /**
   * Standing disclaimer legend (L1 liability shield) — the score travels
   * with its "informational analysis, not a consumer credit score" framing
   * wherever the JSON is rendered or forwarded. Optional because rows
   * generated before the legend shipped don't carry it; the public API
   * route also attaches the legend at the response level for those.
   */
  disclaimer?: string;
}

export const publicParcelReports = pgTable("public_parcel_reports", {
  id: serial("id").primaryKey(),

  // Permalink identity: /p/:state/:county/:apn → (state, county_slug, apn_key).
  state: text("state").notNull(), // 2-letter, uppercased
  countySlug: text("county_slug").notNull(), // lowercased, hyphenated, no " county"
  countyLabel: text("county_label").notNull(), // display form, e.g. "Travis"
  apn: text("apn").notNull(), // display form as entered/normalized
  apnKey: text("apn_key").notNull(), // comparison key: uppercase alphanumerics only

  facts: jsonb("facts").$type<PublicReportFacts>().notNull(),
  lcs: jsonb("lcs").$type<PublicLcs>().notNull(),

  // Centroid duplicated out of facts for cheap geo queries / refresh.
  latitude: real("latitude"),
  longitude: real("longitude"),

  // Server-side truth for report consumption (client analytics is supplemental).
  viewCount: integer("view_count").notNull().default(0),
  lastViewedAt: timestamp("last_viewed_at", { withTimezone: true }),

  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  refreshedAt: timestamp("refreshed_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("public_parcel_reports_identity_uq").on(table.state, table.countySlug, table.apnKey),
  // Daily generation-cap counts + sitemap ordering.
  index("public_parcel_reports_created_idx").on(table.createdAt),
  index("public_parcel_reports_refreshed_idx").on(table.refreshedAt),
]);

export const insertPublicParcelReportSchema = createInsertSchema(publicParcelReports).omit({
  id: true,
  createdAt: true,
  refreshedAt: true,
});
export type InsertPublicParcelReport = z.infer<typeof insertPublicParcelReportSchema>;
export type PublicParcelReport = typeof publicParcelReports.$inferSelect;

// ============================================
// COUNTY COVERAGE REQUEST (customer-facing "request this county" CTA)
// ============================================
//
// Captures a customer's explicit (state, county) coverage request on a
// no-endpoint miss. The maps agent renders the CTA that POSTs to the
// request-county API; this is the org-scoped audit trail of who asked for
// what, so we can (a) prioritise discovery against real demand, and
// (b) notify the org when their county comes online later. The actual
// discovery work is tracked in county_discovery_queue (global); this table is
// the per-org request ledger.
export const countyCoverageRequests = pgTable("county_coverage_requests", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  requestedByUserId: text("requested_by_user_id"), // who clicked the CTA
  state: text("state").notNull(),
  county: text("county").notNull(),
  // Mirrors the queue lifecycle so the org can be told "pending" vs "covered".
  status: text("status").notNull().default("pending"), // pending | covered | unavailable
  queueId: integer("queue_id").references(() => countyDiscoveryQueue.id), // link to the global discovery work
  notifiedAt: timestamp("notified_at"), // when we told the org their county came online
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  // Leading-org composite index (L3 shard-readiness lint).
  index("county_coverage_requests_org_created_idx").on(table.organizationId, table.createdAt),
  index("county_coverage_requests_org_state_county_idx").on(table.organizationId, table.state, table.county),
]);

export const insertCountyCoverageRequestSchema = createInsertSchema(countyCoverageRequests).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertCountyCoverageRequest = z.infer<typeof insertCountyCoverageRequestSchema>;
export type CountyCoverageRequest = typeof countyCoverageRequests.$inferSelect;

// ============================================
// PARCEL SNAPSHOTS (Centralized Parcel Cache)
// ============================================

export const parcelSnapshots = pgTable("parcel_snapshots", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared cache
  
  // Parcel identification
  apn: text("apn").notNull(),
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  fipsCode: text("fips_code"),
  
  // Data source
  source: text("source").notNull().default("regrid"), // county_gis, regrid, manual
  sourceId: text("source_id"), // External ID from the source (regrid_id, etc)
  
  // Geometry
  boundary: jsonb("boundary").$type<{
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  }>(),
  centroid: jsonb("centroid").$type<{ lat: number; lng: number }>(),
  
  // Property information
  owner: text("owner"),
  ownerAddress: text("owner_address"),
  mailingAddress: text("mailing_address"),
  siteAddress: text("site_address"),
  
  // Parcel details
  acres: numeric("acres"),
  legalDescription: text("legal_description"),
  zoning: text("zoning"),
  landUse: text("land_use"),
  propertyType: text("property_type"),
  
  // Valuation
  assessedValue: numeric("assessed_value"),
  marketValue: numeric("market_value"),
  taxAmount: numeric("tax_amount"),
  taxYear: integer("tax_year"),
  
  // Sales history
  lastSalePrice: numeric("last_sale_price"),
  lastSaleDate: timestamp("last_sale_date"),
  
  // Raw data from source
  rawData: jsonb("raw_data").$type<Record<string, unknown>>(),
  
  // Cache management
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertParcelSnapshotSchema = createInsertSchema(parcelSnapshots).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertParcelSnapshot = z.infer<typeof insertParcelSnapshotSchema>;
export type ParcelSnapshot = typeof parcelSnapshots.$inferSelect;

// ============================================
// PARCEL OBSERVATION LOG (Iyari — the acorn)
// --------------------------------------------
// Append-only, NEVER updated. Every time any path (lookup, ETL, fusion,
// customer edit) sees a fact about a parcel, we write an immutable row.
// `parcel_snapshots` stays the fast "current best view" cache; observations
// become the longitudinal system-of-record the cache is derived from.
//
// The strategic bet: longitudinal parcel facts (assessed value, owner, tax
// status over time) are the one asset you cannot buy retroactively. Capturing
// them costs one async insert per fact today; backfilling later is impossible.
// Rows are written fire-and-forget via server/services/data-cache/observation-log.ts
// and must never block or fail a parcel response.
// ============================================
export const parcelObservations = pgTable("parcel_observations", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared observation

  // Parcel identity (denormalized — observations outlive any snapshot row)
  apn: text("apn").notNull(),
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),

  // The fact: one row per (field) observed at observedAt
  field: text("field").notNull(), // e.g. "owner", "assessed_value", "tax_status", "acres"
  value: jsonb("value").$type<unknown>(), // text/number/object — whatever the field carries

  // Provenance
  source: text("source").notNull(), // county_gis, regrid, rapidapi, fema, fusion, manual, ...
  confidence: real("confidence"), // 0..1, optional

  // When the fact was observed (defaults to insert time)
  observedAt: timestamp("observed_at").notNull().defaultNow(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is a single
  // index probe. Org-scoped rows scan only this tenant's history.
  index("parcel_observations_org_observed_idx").on(table.organizationId, table.observedAt),
  // Query index for the future owner-change / tax-status delta detector:
  // "latest N observations per (apn, field)" ordered by time.
  index("parcel_observations_apn_field_observed_idx").on(table.apn, table.field, table.observedAt),
]);

export const insertParcelObservationSchema = createInsertSchema(parcelObservations).omit({
  id: true,
  createdAt: true,
});
export type InsertParcelObservation = z.infer<typeof insertParcelObservationSchema>;
export type ParcelObservation = typeof parcelObservations.$inferSelect;

// ============================================
// PARCEL ALERTS (Iyari #5 — owner-change & tax-status delta detector surface)
// --------------------------------------------
// The scheduled diff job (server/services/parcelDeltaDetector.ts) compares the
// latest two observations per (apn, field) in parcel_observations for parcels in
// a customer's pipeline. When a tracked field meaningfully changes — and clears
// the false-positive guard — it writes ONE immutable alert row here and emits the
// matching workflow trigger event (parcel.owner_changed / parcel.tax_status_changed).
//
// This turns the passive observation log into a PROACTIVE lead engine: the
// customer surface ("Owner changed on a parcel in your pipeline") renders from
// this table behind the Today door. Each row carries the before/after values so
// the surface needs no recompute, plus a dedupe key so re-running the job never
// double-fires for the same (apn, field, transition).
//
// Migration 0131. Mirrors scripts/migrate.mjs STATEMENTS.
export const parcelAlerts = pgTable("parcel_alerts", {
  id: serial("id").primaryKey(),
  // Org-scoped — leading-org composite index for shard-readiness.
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),

  // Parcel identity (denormalized — alerts outlive any snapshot/lead row)
  apn: text("apn").notNull(),
  state: text("state").notNull(),
  county: text("county").notNull(),

  // What kind of change this alert represents.
  //   "owner_changed"      — owner / owner_address transitioned
  //   "tax_status_changed" — tax_status / tax_amount transitioned (e.g. delinquent)
  alertType: text("alert_type").notNull(),
  // The underlying observation field that changed (owner, owner_address,
  // tax_status, tax_amount). Disambiguates within an alertType.
  field: text("field").notNull(),

  // Before/after snapshot so the surface renders with zero recompute.
  previousValue: jsonb("previous_value").$type<unknown>(),
  currentValue: jsonb("current_value").$type<unknown>(),

  // Provenance + confidence carried from the observations that produced it.
  source: text("source"), // county_gis, regrid, ...
  confidence: real("confidence"), // 0..1 — false-positive guard score

  // Link back to the pipeline entity that put this parcel on the radar.
  // Either may be null (a parcel can be tracked as a lead and/or a property).
  leadId: integer("lead_id"),
  propertyId: integer("property_id"),

  // Idempotency: stable hash of (apn, field, previous→current transition) so a
  // re-run of the detector never writes a duplicate alert for the same change.
  dedupeKey: text("dedupe_key").notNull(),

  // Read state — customer can mark an alert read.
  isRead: boolean("is_read").notNull().default(false),
  readAt: timestamp("read_at"),

  // When the underlying change was observed, and when we detected it.
  observedAt: timestamp("observed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe;
  // the customer alert list reads this tenant's newest alerts first.
  index("parcel_alerts_org_created_idx").on(table.organizationId, table.createdAt),
  // Unread-first read path for the badge/count and the "new alerts" list.
  index("parcel_alerts_org_unread_idx").on(table.organizationId, table.isRead, table.createdAt),
  // Idempotency lookup so the detector can skip already-emitted transitions.
  uniqueIndex("parcel_alerts_org_dedupe_uk").on(table.organizationId, table.dedupeKey),
]);

export const insertParcelAlertSchema = createInsertSchema(parcelAlerts).omit({
  id: true,
  createdAt: true,
});
export type InsertParcelAlert = z.infer<typeof insertParcelAlertSchema>;
export type ParcelAlert = typeof parcelAlerts.$inferSelect;

// ============================================
// COUNTY MARKET ROLLUPS (Tier 3F — cross-org data co-op)
// --------------------------------------------
// Privacy-preserving county-level market aggregates computed monthly from
// cross-org observations (parcel_observations density, deals/offer_letters
// pricing, land_credit_scores grades) by the `county_market_rollup` worker
// job (server/services/dataCoop/countyRollupJob.ts).
//
// Privacy model — generalized from marketNetworkContributor:
//   - NO organization column AT ALL (structural org-null: a rollup row cannot
//     link back to a tenant because the linkage does not exist in the schema).
//   - cohort_size records the k backing the row; rows below k=5 are NEVER
//     materialized — computeCountyRollup() returns null below the floor, so
//     the gate lives in the aggregation, not the read path.
//   - every price sample is value-bucketed (nearest $500/acre) BEFORE
//     aggregation so no exact deal is recoverable from a percentile.
// Migration 0157. Mirrors scripts/migrate.mjs STATEMENTS.
// ============================================
export const countyMarketRollups = pgTable("county_market_rollups", {
  id: serial("id").primaryKey(),
  state: text("state").notNull(), // 2-letter state code, uppercased
  county: text("county").notNull(),
  period: text("period").notNull(), // calendar month, "YYYY-MM"
  // CountyRollupMetrics (server/services/dataCoop/privacyRollup.ts) — each
  // sub-metric is independently k-gated and null when its own cohort is thin.
  metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull(),
  // Distinct contributing parcels (cross-org APNs observed in the county) —
  // the k that allowed this row to exist. Always >= 5 by construction.
  cohortSize: integer("cohort_size").notNull(),
  computedAt: timestamp("computed_at").notNull().defaultNow(),
}, (table) => [
  // One row per (state, county, period); the monthly job upserts.
  uniqueIndex("county_market_rollups_state_county_period_uk").on(
    table.state, table.county, table.period,
  ),
  // Map-door browse path: all counties for a state, newest period first.
  index("county_market_rollups_state_period_idx").on(table.state, table.period),
]);

export type CountyMarketRollup = typeof countyMarketRollups.$inferSelect;

// Run ledger for the rollup job — the deadman roster proves the job RAN;
// this proves it PRODUCED. Two consecutive zero-rollup runs raise an
// alert-spine warning (the co-op silently producing nothing is the
// "wired but dark" failure mode).
export const countyRollupRuns = pgTable("county_rollup_runs", {
  id: serial("id").primaryKey(),
  period: text("period").notNull(), // the (most recent) period recomputed
  rollupsWritten: integer("rollups_written").notNull().default(0),
  countiesScanned: integer("counties_scanned").notNull().default(0),
  ranAt: timestamp("ran_at").notNull().defaultNow(),
}, (table) => [
  index("county_rollup_runs_ran_at_idx").on(table.ranAt),
]);

export type CountyRollupRun = typeof countyRollupRuns.$inferSelect;

// Quarterly public market report DRAFTS (Tier 3F foundation). Generated
// server-side from county_market_rollups; founder-reviewable at
// /api/founder/market-reports. NEVER auto-published — witnessed-publish is a
// follow-up; status stays 'draft' until a founder-approval path exists.
export const marketReportDrafts = pgTable("market_report_drafts", {
  id: serial("id").primaryKey(),
  quarter: text("quarter").notNull(), // "YYYY-Q#"
  status: text("status").notNull().default("draft"), // draft (publish path not built yet)
  report: jsonb("report").$type<Record<string, unknown>>().notNull(), // structured JSON artifact
  markdown: text("markdown").notNull(), // rendered markdown artifact
  generatedAt: timestamp("generated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("market_report_drafts_quarter_uk").on(table.quarter),
]);

export type MarketReportDraft = typeof marketReportDrafts.$inferSelect;

// ============================================
// LAND INTELLIGENCE REPORTS (Iyari #2 — persist the report; seed the corpus)
// --------------------------------------------
// The LIS report (generateLandIntelligenceReport) is otherwise a cold recompute
// against ~8 external APIs on every view. We persist the computed report + its
// per-field provenance + a staleAfter policy so a re-opened parcel renders from
// our store in <100ms, and we ONLY recompute once the report is stale.
//
// Two payoffs for first customers: (a) speed on revisit (investors revisit
// deals across the pipeline), (b) trust — every field already carries its
// {source, fetchedAt} provenance. This store ALSO quietly becomes the eval
// corpus (Iyari #6): a labeled set of free-data reports to diff against paid
// data when MRR justifies a trial.
//
// IMPORTANT: this table wraps the fusion COMPUTATION (store-read / store-write)
// without changing the fusion math. The report column is the verbatim
// LandIntelligenceReport JSON the fusion produced.
// ============================================
export const landIntelligenceReports = pgTable("land_intelligence_reports", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = global/shared

  // Stable parcel identity / cache key. parcelKey is a normalized hash of the
  // parcel identity (apn+state+county when an apn exists, else rounded
  // lat/lng+acres) so the same parcel maps to one row per org.
  parcelKey: text("parcel_key").notNull(),
  apn: text("apn"),
  state: text("state").notNull(),
  county: text("county").notNull(),
  latitude: numeric("latitude"),
  longitude: numeric("longitude"),
  acres: numeric("acres"),

  // The verbatim computed report (LandIntelligenceReport shape).
  report: jsonb("report").$type<Record<string, unknown>>().notNull(),

  // Per-field provenance lifted from report.fieldProvenance for fast,
  // index-free staleness inspection without parsing the whole report.
  // Shape: { [field]: { source, fetchedAt, classification } }
  fieldProvenance: jsonb("field_provenance").$type<Record<string, {
    source: string;
    fetchedAt: string;
    classification: string;
  }>>(),

  // Composite score snapshot (denormalized for cheap longitudinal queries —
  // "this parcel scored 82 in March and 71 now" without parsing report JSON).
  landIntelligenceScore: integer("land_intelligence_score"),
  recommendation: text("recommendation"),

  // Staleness policy: serve from store while now() < staleAfter; recompute past it.
  computedAt: timestamp("computed_at").notNull().defaultNow(),
  staleAfter: timestamp("stale_after").notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe.
  index("land_intelligence_reports_org_key_idx").on(table.organizationId, table.parcelKey),
  // Longitudinal lookups for a parcel across time (score-over-time / corpus).
  index("land_intelligence_reports_apn_computed_idx").on(table.apn, table.computedAt),
]);

export const insertLandIntelligenceReportSchema = createInsertSchema(landIntelligenceReports).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertLandIntelligenceReport = z.infer<typeof insertLandIntelligenceReportSchema>;
export type LandIntelligenceReportRow = typeof landIntelligenceReports.$inferSelect;

// ============================================
// PAID-DATA EVAL RESULTS (Iyari #6 + Lena #3)
// ============================================
// Persists each run of the paid-data eval harness (server/services/
// paidDataEvalHarness.ts) so the founder buy-decision surface has a history:
// "Regrid would have flipped M decisions across N parcels in the counties our
// customers worked." A run reads the free LIS corpus read-only and produces a
// field-divergence + decision-flip report; this table is the audit trail of
// those runs (mock/sample today; real trial-window runs later). Storing it lets
// the surface show the latest run instantly without recomputing, and lets us
// compare a real Regrid trial against the mock baseline.
export const paidDataEvalRuns = pgTable("paid_data_eval_runs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id), // null = whole corpus

  // Which provider produced the paid view ("mock-paid" today; "regrid" later).
  provider: text("provider").notNull(),
  // "sample" (dry-run / mock) or "trial" (real paid-window run).
  mode: text("mode").notNull(),

  // Corpus scoping for this run.
  stateFilter: text("state_filter"),
  totalParcels: integer("total_parcels").notNull(),
  parcelsCompared: integer("parcels_compared").notNull(),
  errors: integer("errors").notNull().default(0),

  // Headline metrics (denormalized for cheap listing/trend without parsing JSON).
  decisionFlipCount: integer("decision_flip_count").notNull().default(0),
  decisionFlipRate: numeric("decision_flip_rate"), // 0–1
  estTrialCostCents: integer("est_trial_cost_cents").notNull().default(0),

  // The verbatim PaidDataEvalResult (field divergence + flip details + buy rec).
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),

  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (table) => [
  // LEADING-org composite (shard-readiness lint): tenant routing is one probe.
  index("paid_data_eval_runs_org_created_idx").on(table.organizationId, table.createdAt),
]);

export const insertPaidDataEvalRunSchema = createInsertSchema(paidDataEvalRuns).omit({
  id: true,
  createdAt: true,
});
export type InsertPaidDataEvalRun = z.infer<typeof insertPaidDataEvalRunSchema>;
export type PaidDataEvalRunRow = typeof paidDataEvalRuns.$inferSelect;

// ============================================
// DATA SOURCE CACHE (Cached lookups from free sources)
// ============================================

export const dataSourceCache = pgTable("data_source_cache", {
  id: serial("id").primaryKey(),
  dataSourceId: integer("data_source_id").references(() => dataSources.id),
  
  lookupKey: text("lookup_key").notNull(),
  state: text("state"),
  county: text("county"),
  
  data: jsonb("data").$type<Record<string, any>>(),
  
  fetchedAt: timestamp("fetched_at").defaultNow(),
  expiresAt: timestamp("expires_at"),
  
  successfulFetch: boolean("successful_fetch").default(true),
  errorMessage: text("error_message"),
});

export const insertDataSourceCacheSchema = createInsertSchema(dataSourceCache).omit({
  id: true,
  fetchedAt: true,
});
export type InsertDataSourceCache = z.infer<typeof insertDataSourceCacheSchema>;
export type DataSourceCache = typeof dataSourceCache.$inferSelect;

// ============================================
// DISCOVERED ENDPOINTS (Live GIS Discovery Results)
// ============================================

export const discoveredEndpoints = pgTable("discovered_endpoints", {
  id: serial("id").primaryKey(),
  
  // Location info
  state: text("state").notNull(), // 2-letter state code
  county: text("county").notNull(),
  
  // Endpoint info
  baseUrl: text("base_url").notNull(),
  endpointType: text("endpoint_type").notNull().default("arcgis_rest"),
  serviceName: text("service_name"), // Name from discovery source
  
  // Discovery metadata
  discoverySource: text("discovery_source").notNull(), // 'arcgis_online', 'open_data_catalog', 'manual'
  discoveryDate: timestamp("discovery_date").defaultNow().notNull(),
  lastChecked: timestamp("last_checked"),
  
  // Validation
  status: text("status").notNull().default("pending"), // pending, validated, rejected, added
  healthCheckPassed: boolean("health_check_passed"),
  healthCheckMessage: text("health_check_message"),
  confidenceScore: integer("confidence_score"), // 0-100
  
  // Additional metadata from discovery
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDiscoveredEndpointSchema = createInsertSchema(discoveredEndpoints).omit({
  id: true,
  createdAt: true,
});
export type InsertDiscoveredEndpoint = z.infer<typeof insertDiscoveredEndpointSchema>;
export type DiscoveredEndpoint = typeof discoveredEndpoints.$inferSelect;

