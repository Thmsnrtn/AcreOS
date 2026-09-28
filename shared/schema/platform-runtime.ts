/**
 * platform-runtime — extracted from the shared/schema.ts monolith on 2026-09-28
 * (DEFECT-0048) and re-exported through that barrel, so every
 * `import { … } from "@shared/schema"` is unchanged. Sections, verbatim:
 *   - PROVIDER CACHE
 *   - TEMPORAL SPINE — OPEN-DATA CHANGE EVENTS
 *   - PILLAR 6 — CROSS-CUSTOMER DATA CACHE
 *   - API JOB QUEUE
 *   - JOB CURSORS (Prevent duplicate processing on restart)
 *   - JOB LOCKS (Prevent duplicate execution in multi-instance deployment)
 *   - CIRCUIT BREAKER STATE (Tier 1G — persisted provider-registry breaker)
 *   - DEADMAN PAGE STATE (Tier 1H — persisted re-page throttle)
 *   - API USAGE LOGS (Cost Tracking)
 *   - SCHEDULED TASKS (Automation with Retry Logic)
 *
 * Monolith tables are imported from "../schema" and used only lazily
 * (inside references(() => …)); the barrel's `export *` is hoisted, so this
 * module evaluates before the monolith's body and must never read one eagerly.
 */
import { pgTable, text, serial, integer, timestamp, varchar, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations } from "../schema";

// ============================================
// PROVIDER CACHE
// ============================================

export const providerCache = pgTable("provider_cache", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  category: text("category").notNull(),
  cacheKey: text("cache_key").notNull().unique(),
  responseData: jsonb("response_data").notNull(),
  costCents: integer("cost_cents").notNull().default(0),
  expiresAt: timestamp("expires_at").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("idx_provider_cache_key").on(table.cacheKey),
  index("idx_provider_cache_expires").on(table.expiresAt),
  index("idx_provider_cache_provider_category").on(table.provider, table.category),
]);

export type ProviderCache = typeof providerCache.$inferSelect;

// ============================================
// TEMPORAL SPINE — OPEN-DATA CHANGE EVENTS
// ============================================
//
// Ruling #9 wave 3 (docs/company/founder-decisions-2026-07-28.md): open data
// becomes EVENTS. When a refreshed lookup materially differs from what we
// previously knew for the same place, that change is itself intelligence
// ("FEMA redrew the map under this parcel") and is durably recorded here.
//
// scopeType/scopeRef contract (siblings build against exactly this):
//   point  → scopeRef = "lat,lng" rounded to 4 decimal places
//   county → scopeRef = "ST/countyslug"
// previousValue/newValue are always REAL previously-observed values —
// null→value (first sight) and value→null (lookup gap) are never recorded
// as changes. narrative is one plain-words sentence built only from the two
// real values. Diff/materiality rules live in
// server/services/openData/changeDetection.ts.
export const openDataChangeEvents = pgTable("open_data_change_events", {
  id: serial("id").primaryKey(),
  // LookupCategory value (e.g. "flood_zone") or county-signal key.
  category: text("category").notNull(),
  scopeType: text("scope_type").notNull(), // "point" | "county"
  scopeRef: text("scope_ref").notNull(),
  field: text("field").notNull(),
  previousValue: text("previous_value").notNull(),
  newValue: text("new_value").notNull(),
  // When the PREVIOUS knowledge was as-of (source freshness if known, else
  // when we cached it). Null when neither is known.
  previousAsOf: timestamp("previous_as_of"),
  detectedAt: timestamp("detected_at").defaultNow().notNull(),
  // The instrument name, e.g. "FEMA NFHL", "USDA SSURGO".
  source: text("source").notNull(),
  severity: text("severity").notNull(), // "info" | "notable"
  narrative: text("narrative").notNull(),
}, (table) => [
  index("idx_odce_scope_detected").on(table.scopeType, table.scopeRef, table.detectedAt),
]);

export type OpenDataChangeEvent = typeof openDataChangeEvents.$inferSelect;
export type InsertOpenDataChangeEvent = typeof openDataChangeEvents.$inferInsert;

// ============================================
// PILLAR 6 — CROSS-CUSTOMER DATA CACHE
// ============================================
//
// Shared cache for paid third-party data lookups (skip-trace, parcel
// ownership, AVM, flood-zone, liens, …). When customer A pays the provider
// to look up a record, customer B looking up the same record gets the
// cached result for free (cost-cents-charged = 0) until freshnessHours
// expires. The per-org savings are summed via cachedLookupHits.
//
// The query is identified by a deterministic SHA-256 fingerprint of the
// normalized input (lowercased addresses, trimmed names, …) so the same
// physical fact lookup collapses to a single cache row regardless of
// caller. UNIQUE(provider, entityType, queryFingerprint) prevents
// duplicate rows.

export const cachedLookups = pgTable("cached_lookups", {
  id: serial("id").primaryKey(),
  // Provider that originally produced the result. Examples:
  //   "batch_skiptrace", "reiskip", "regrid", "attom", "batchdata",
  //   "county_gis_<county>", "fema_nfhl", "usfws_nwi", "census".
  provider: text("provider").notNull(),
  // Type of fact cached. See TTL_BY_ENTITY_TYPE in
  // server/services/data-cache/lookup-cache.ts for the canonical list.
  entityType: text("entity_type").notNull(),
  // SHA-256 of normalized query payload. See normalizeQuery().
  queryFingerprint: text("query_fingerprint").notNull(),
  // The provider response, stored verbatim so any consumer can re-parse.
  resultJson: jsonb("result_json").notNull(),
  // TTL in hours used to compute freshness. Stored per-row so the policy
  // can evolve without invalidating historical rows.
  freshnessHours: integer("freshness_hours").notNull(),
  // First fetch — origin of truth.
  firstFetchedAt: timestamp("first_fetched_at").notNull().defaultNow(),
  firstFetchedBy: integer("first_fetched_by").references(() => organizations.id),
  // Hit counter — incremented on every cache-served read (across orgs).
  hits: integer("hits").notNull().default(0),
  lastHitAt: timestamp("last_hit_at"),
  // Original cost in cents. Used for "you saved $X" analytics.
  costCents: integer("cost_cents").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  uniqueIndex("cached_lookups_fingerprint_uidx").on(
    table.provider,
    table.entityType,
    table.queryFingerprint,
  ),
  index("cached_lookups_entity_type_idx").on(table.entityType),
  index("cached_lookups_first_fetched_at_idx").on(table.firstFetchedAt),
]);

export type CachedLookup = typeof cachedLookups.$inferSelect;
export type InsertCachedLookup = typeof cachedLookups.$inferInsert;

// Per-hit log. Same org hitting the same cache row twice writes TWO rows
// (it's a counter, not a dedupe). Drives "you saved $X this month" + the
// cross-customer cache-hit-rate dashboard.
export const cachedLookupHits = pgTable("cached_lookup_hits", {
  id: serial("id").primaryKey(),
  cachedLookupId: integer("cached_lookup_id")
    .references(() => cachedLookups.id, { onDelete: "cascade" })
    .notNull(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  hitAt: timestamp("hit_at").notNull().defaultNow(),
}, (table) => [
  index("cached_lookup_hits_lookup_hit_at_idx").on(table.cachedLookupId, table.hitAt),
  index("cached_lookup_hits_org_hit_at_idx").on(table.organizationId, table.hitAt),
]);

export type CachedLookupHit = typeof cachedLookupHits.$inferSelect;
export type InsertCachedLookupHit = typeof cachedLookupHits.$inferInsert;

// ============================================
// API JOB QUEUE
// ============================================

export const apiJobs = pgTable("api_jobs", {
  id: varchar("id", { length: 255 }).primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  type: text("type").notNull(), // openai, stripe, lob, sendgrid, twilio
  operation: text("operation").notNull(),
  payload: jsonb("payload"),
  status: text("status").notNull().default("pending"), // pending, processing, retrying, completed, failed
  retries: integer("retries").default(0),
  maxRetries: integer("max_retries").default(3),
  nextRetryAt: timestamp("next_retry_at"),
  result: jsonb("result"),
  error: text("error"),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertApiJobSchema = createInsertSchema(apiJobs).omit({ createdAt: true, completedAt: true });
export type InsertApiJob = z.infer<typeof insertApiJobSchema>;
export type ApiJob = typeof apiJobs.$inferSelect;

// ============================================
// JOB CURSORS (Prevent duplicate processing on restart)
// ============================================

export const jobCursors = pgTable("job_cursors", {
  id: serial("id").primaryKey(),
  jobType: text("job_type").notNull().unique(),
  lastProcessedId: integer("last_processed_id"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").default('idle'),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertJobCursorSchema = createInsertSchema(jobCursors).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertJobCursor = z.infer<typeof insertJobCursorSchema>;
export type JobCursor = typeof jobCursors.$inferSelect;

// ============================================
// JOB LOCKS (Prevent duplicate execution in multi-instance deployment)
// ============================================

export const jobLocks = pgTable("job_locks", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull().unique(),
  lockedBy: text("locked_by").notNull(),
  lockedAt: timestamp("locked_at").defaultNow(),
  expiresAt: timestamp("expires_at").notNull(),
});

export const insertJobLockSchema = createInsertSchema(jobLocks).omit({
  id: true,
  lockedAt: true,
});
export type InsertJobLock = z.infer<typeof insertJobLockSchema>;
export type JobLock = typeof jobLocks.$inferSelect;

// ============================================
// CIRCUIT BREAKER STATE (Tier 1G — persisted provider-registry breaker)
// ============================================
// One row per provider. Persists trip state across deploys so a hard-down
// provider isn't re-hammered with a fresh failure budget per machine per
// deploy. state: 'closed' | 'open' | 'half_open'. half_open_probe_at records
// the single-probe claim taken after the cooloff window.

export const circuitBreakerState = pgTable("circuit_breaker_state", {
  providerName: text("provider_name").primaryKey(),
  state: text("state").notNull().default("closed"),
  failures: integer("failures").notNull().default(0),
  openedAt: timestamp("opened_at"),
  lastFailureAt: timestamp("last_failure_at"),
  halfOpenProbeAt: timestamp("half_open_probe_at"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type CircuitBreakerStateRow = typeof circuitBreakerState.$inferSelect;

// ============================================
// DEADMAN PAGE STATE (Tier 1H — persisted re-page throttle)
// ============================================
// One row per roster job. server/jobs/deadmanCheck.ts throttles on-call
// re-pages to once/hour per dark job; this table persists the last-paged
// timestamp so a deploy mid-incident doesn't reset the throttle and re-page
// every still-dark job.

export const deadmanPageState = pgTable("deadman_page_state", {
  jobName: text("job_name").primaryKey(),
  lastPagedAt: timestamp("last_paged_at").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});
export type DeadmanPageStateRow = typeof deadmanPageState.$inferSelect;

// ============================================
// API USAGE LOGS (Cost Tracking)
// ============================================

export const apiUsageLogs = pgTable("api_usage_logs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  service: text("service").notNull(), // lob, regrid, openai
  action: text("action").notNull(), // e.g., "send_postcard", "parcel_lookup", "chat_completion"
  count: integer("count").default(1),
  estimatedCostCents: integer("estimated_cost_cents").default(0),
  metadata: jsonb("metadata").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertApiUsageLogSchema = createInsertSchema(apiUsageLogs).omit({ id: true, createdAt: true });
export type InsertApiUsageLog = z.infer<typeof insertApiUsageLogSchema>;
export type ApiUsageLog = typeof apiUsageLogs.$inferSelect;

// ============================================
// SCHEDULED TASKS (Automation with Retry Logic)
// ============================================

// Task types
export const SCHEDULED_TASK_TYPES = ["workflow", "agent_skill", "custom"] as const;
export type ScheduledTaskType = typeof SCHEDULED_TASK_TYPES[number];

// Task statuses
export const SCHEDULED_TASK_STATUSES = ["active", "paused", "failed"] as const;
export type ScheduledTaskStatus = typeof SCHEDULED_TASK_STATUSES[number];

// Simple schedule types
export const SIMPLE_SCHEDULE_TYPES = ["hourly", "daily", "weekly", "monthly"] as const;
export type SimpleScheduleType = typeof SIMPLE_SCHEDULE_TYPES[number];

// Scheduled tasks table
export const scheduledTasks = pgTable("scheduled_tasks", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  name: text("name").notNull(),
  type: text("type").$type<ScheduledTaskType>().notNull(), // workflow, agent_skill, custom
  config: jsonb("config").$type<{
    workflowId?: number;
    skillId?: string;
    skillParams?: Record<string, any>;
    customHandler?: string;
    customParams?: Record<string, any>;
  }>().notNull(),
  schedule: text("schedule").notNull(), // cron expression or simple: daily, weekly, hourly, monthly
  nextRunAt: timestamp("next_run_at"),
  lastRunAt: timestamp("last_run_at"),
  status: text("status").$type<ScheduledTaskStatus>().notNull().default("active"),
  retryCount: integer("retry_count").notNull().default(0),
  maxRetries: integer("max_retries").notNull().default(3),
  retryDelayMinutes: integer("retry_delay_minutes").notNull().default(5),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertScheduledTaskSchema = createInsertSchema(scheduledTasks).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertScheduledTask = z.infer<typeof insertScheduledTaskSchema>;
export type ScheduledTask = typeof scheduledTasks.$inferSelect;

