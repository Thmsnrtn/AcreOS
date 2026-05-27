// ============================================================================
// SHARED/SCHEMA/AI-TELEMETRY.TS
// ----------------------------------------------------------------------------
// AI telemetry — request metrics, daily AI spend rollups, platform daily
// budgets by category, eval-gated rollbacks, cascade-focused per-call
// telemetry, cost-optimizer nightly snapshots, map-layer prefs, AI model
// registry, founder API keys, org acquisition targets, persistent job queue.
// Extracted from shared/schema.ts.
// ============================================================================

import {
  pgTable,
  text,
  serial,
  integer,
  boolean,
  timestamp,
  numeric,
  varchar,
  jsonb,
  index,
  uniqueIndex,
  date,
  check,
  primaryKey,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { organizations, dataSources } from "../schema";

// ===========================
// AI TELEMETRY
// ===========================

// Tracks AI request metrics for cost optimization and observability
export const aiTelemetryEvents = pgTable("ai_telemetry_events", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id),
  taskType: text("task_type").notNull(),
  provider: text("provider").notNull(), // openai, openrouter
  model: text("model").notNull(),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  totalTokens: integer("total_tokens"),
  estimatedCostCents: numeric("estimated_cost_cents"),
  latencyMs: integer("latency_ms"),
  cacheHit: boolean("cache_hit").default(false),
  complexity: text("complexity"), // simple, moderate, complex
  success: boolean("success").default(true),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("ai_telemetry_org_idx").on(table.organizationId),
  index("ai_telemetry_created_idx").on(table.createdAt),
  index("ai_telemetry_provider_idx").on(table.provider),
]);

// ─── AI Daily Usage (Phase 3 Week 9) ─────────────────────────────────────────
// Per-org per-day rollup of AI spend. Written from routeAITask after every
// successful (or failed-after-tokens) call. The quota check sums
// totalUsd for (org, today UTC) and compares to organizations.org_ai_quota_daily_usd.
//
// byFeature is a jsonb breakdown of {<taskType>: {usd, calls}} so the founder
// dashboard can show cost-by-feature without re-aggregating telemetry events.
export const aiUsageDaily = pgTable("ai_usage_daily", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "cascade" }).notNull(),
  date: date("date").notNull(), // UTC date (YYYY-MM-DD)
  totalUsd: numeric("total_usd", { precision: 12, scale: 6 }).notNull().default("0"),
  callCount: integer("call_count").notNull().default(0),
  byFeature: jsonb("by_feature").$type<Record<string, { usd: number; calls: number }>>().default({}),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ai_usage_daily_org_date_uniq").on(table.organizationId, table.date),
  index("ai_usage_daily_date_idx").on(table.date),
]);

export type AiUsageDaily = typeof aiUsageDaily.$inferSelect;
export type InsertAiUsageDaily = typeof aiUsageDaily.$inferInsert;

// ─── AI Budget Runs (Frugal Autonomy — Phase 2.1) ────────────────────────────
// Platform-wide daily budget tracking by category. Separate from aiUsageDaily
// (which is per-org for customer billing/quota); this table is the *engine*
// of the cost ceiling — every call into routeAITask checks against it BEFORE
// firing, and recordAiCall increments it AFTER firing.
//
// Category is a coarse routing bucket (executor, briefing, founder_brief,
// nurturing, cmo, analysis, general) — mapped from task_type via
// server/services/intelligence/budget.ts → categoryFor(taskType).
//
// One row per (day, category). Auto-created on first call. capCents reads
// from founder_settings (ai.daily_budget_cents + category share knobs);
// recomputed daily so founder edits take effect next day.
export const aiBudgetRuns = pgTable("ai_budget_runs", {
  id: serial("id").primaryKey(),
  day: date("day").notNull(),            // UTC date (YYYY-MM-DD)
  category: text("category").notNull(),  // executor | briefing | founder_brief | nurturing | cmo | analysis | general
  capCents: integer("cap_cents").notNull(),
  spentCents: numeric("spent_cents", { precision: 12, scale: 4 }).notNull().default("0"),
  calls: integer("calls").notNull().default(0),
  exceededAt: timestamp("exceeded_at"),  // first time spent_cents crossed cap (null if still within)
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("ai_budget_runs_day_category_uniq").on(table.day, table.category),
  index("ai_budget_runs_day_idx").on(table.day),
]);

export type AiBudgetRun = typeof aiBudgetRuns.$inferSelect;
export type InsertAiBudgetRun = typeof aiBudgetRuns.$inferInsert;

// ─── AI Routing Overrides ────────────────────────────────────────────────────
// Wave 8 — eval-gated rollback table. The aiRouter consults this table at
// routing time and prefers the override tier/model when an active row exists
// for the given task_type. The quality-gate hook in evals/run-eval flow
// inserts rows here automatically when a tier change drops match score
// below 95% of the previous run.
export const aiRoutingOverrides = pgTable("ai_routing_overrides", {
  id: varchar("id").primaryKey(),
  taskType: text("task_type").notNull(),
  originalTier: text("original_tier").notNull(),
  overrideTier: text("override_tier").notNull(),
  overrideModel: text("override_model"),
  reason: text("reason").notNull(),
  previousEvalScore: numeric("previous_eval_score", { precision: 5, scale: 4 }),
  newEvalScore: numeric("new_eval_score", { precision: 5, scale: 4 }),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("ai_routing_overrides_active_unique")
    .on(table.taskType)
    .where(sql`${table.active} = true`),
  index("ai_routing_overrides_created_idx").on(table.createdAt),
]);

export type AiRoutingOverride = typeof aiRoutingOverrides.$inferSelect;
export type InsertAiRoutingOverride = typeof aiRoutingOverrides.$inferInsert;

// ─── AI Call Log (Pillar 7 — AI Cascade Telemetry) ───────────────────────────
// Per-call cascade-focused telemetry. Distinct from ai_telemetry_events which
// captures generic provider metrics — this table is designed for cascade
// distribution + prompt-cache adoption analysis (Pillar 7 of the overhead
// reduction plan). Every aiRouter call emits one row here (cache hits AND
// upstream calls), so we can answer:
//   - "what % of last 7d calls went to each model tier?"
//   - "what % of prompt tokens were cache reads vs writes?"
//   - "what fraction of calls came from the in-process cache (no upstream)?"
//
// complexityClass is normalized into a small enum so distribution queries are
// cheap; feature is caller-provided ("pax_chat", "lead_scoring", etc.).
export const aiCallLog = pgTable("ai_call_log", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id, { onDelete: "set null" }),
  model: text("model").notNull(),               // e.g. "anthropic/claude-haiku-4-5-20251001", "cache"
  complexityClass: text("complexity_class").notNull(), // classification | extraction | synthesis | agent_tool | other
  feature: text("feature").notNull(),           // caller-tag: pax_chat | lead_scoring | cmo_script_gen | ...
  promptTokens: integer("prompt_tokens").notNull().default(0),
  cachedInputTokens: integer("cached_input_tokens").notNull().default(0),
  completionTokens: integer("completion_tokens").notNull().default(0),
  costCents: numeric("cost_cents", { precision: 10, scale: 4 }).notNull().default("0"),
  latencyMs: integer("latency_ms").notNull().default(0),
  cacheHit: boolean("cache_hit").notNull().default(false),
  errorClass: text("error_class"),              // rate_limit | timeout | ctx_overflow | ... | null
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("ai_call_log_org_created_idx").on(table.organizationId, table.createdAt),
  index("ai_call_log_model_idx").on(table.model),
  index("ai_call_log_feature_created_idx").on(table.feature, table.createdAt),
]);

export type AiCallLogRow = typeof aiCallLog.$inferSelect;
export type InsertAiCallLogRow = typeof aiCallLog.$inferInsert;

// ─── Cost Optimization Runs (Wave 10) ────────────────────────────────────────
// Nightly meta-job snapshots. Each row is one run of server/jobs/costOptimizer
// and carries the cost / MRR / margin numbers, the structured recommendation
// list, the actions auto-applied (safe ones only), and a plain-English
// summary the founder reads in /founder-home + the weekly digest email.
export interface CostRecommendation {
  id: string;            // stable id so the apply endpoint can find it
  category: "ai_tier" | "ai_quota" | "abuse_review" | "sentry_sampling" | "margin_alert" | "general";
  severity: "info" | "warning" | "critical";
  title: string;
  detail: string;
  estimatedSavingsUsd?: number;
  autoApplied: boolean;
  appliedAt?: string;     // ISO timestamp once founder approves
  appliedBy?: string;     // founder email or "auto"
  metadata?: Record<string, any>;
}

export interface CostAutoAppliedAction {
  id: string;
  kind: "prompt_cache_toggle" | "log_volume_tune" | "sampling_drop" | "other";
  description: string;
  appliedAt: string;
  metadata?: Record<string, any>;
}

export const costOptimizationRuns = pgTable("cost_optimization_runs", {
  id: serial("id").primaryKey(),
  runAt: timestamp("run_at", { withTimezone: true }).defaultNow().notNull(),
  totalAiCostUsd: numeric("total_ai_cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  totalFlyCostUsd: numeric("total_fly_cost_usd", { precision: 12, scale: 4 }).notNull().default("0"),
  customerCount: integer("customer_count").notNull().default(0),
  mrrUsd: numeric("mrr_usd", { precision: 12, scale: 2 }).notNull().default("0"),
  profitMarginPct: numeric("profit_margin_pct", { precision: 6, scale: 2 }).notNull().default("0"),
  recommendations: jsonb("recommendations").$type<CostRecommendation[]>().notNull().default([]),
  autoAppliedActions: jsonb("auto_applied_actions").$type<CostAutoAppliedAction[]>().notNull().default([]),
  summary: text("summary").notNull().default(""),
}, (table) => [
  index("cost_optimization_runs_run_at_idx").on(table.runAt),
]);

export type CostOptimizationRun = typeof costOptimizationRuns.$inferSelect;
export type InsertCostOptimizationRun = typeof costOptimizationRuns.$inferInsert;

// ─── User Map Layer Preferences ──────────────────────────────────────────────
// Persists per-user map layer toggle/opacity settings across devices.
export const userMapLayerPreferences = pgTable("user_map_layer_preferences", {
  id: serial("id").primaryKey(),
  userId: text("user_id").notNull(),
  layerId: integer("layer_id").notNull().references(() => dataSources.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  opacity: numeric("opacity", { precision: 4, scale: 2 }).notNull().default("0.70"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("user_map_layer_prefs_user_idx").on(table.userId),
  index("user_map_layer_prefs_unique_idx").on(table.userId, table.layerId),
]);

// ─── AI Model Configurations ─────────────────────────────────────────────────
// Founder-managed table of available AI models with routing weights per task type.
export const aiModelConfigs = pgTable("ai_model_configs", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().default("openrouter"),
  modelId: text("model_id").notNull(),
  displayName: text("display_name").notNull(),
  costPerMillionInput: numeric("cost_per_million_input", { precision: 10, scale: 4 }),
  costPerMillionOutput: numeric("cost_per_million_output", { precision: 10, scale: 4 }),
  maxTokens: integer("max_tokens").default(4096),
  taskTypes: text("task_types").array().default([]),
  weight: integer("weight").default(50),
  enabled: boolean("enabled").default(true),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("ai_model_configs_enabled_idx").on(table.enabled),
]);

// ─── System API Keys ──────────────────────────────────────────────────────────
// Founder-managed system-wide API keys. Users' BYOK keys override these.
export const systemApiKeys = pgTable("system_api_keys", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull().unique(),
  displayName: text("display_name").notNull(),
  apiKey: text("api_key"),
  isActive: boolean("is_active").default(true),
  lastValidatedAt: timestamp("last_validated_at"),
  validationStatus: text("validation_status").default("pending"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// ─── Goals ───────────────────────────────────────────────────────────────────
// Acquisition / revenue targets for the org.
// current_value is computed dynamically — not stored here.
export const goals = pgTable("goals", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id").references(() => organizations.id).notNull(),
  label: text("label").notNull(),
  goalType: text("goal_type").notNull(), // deals_closed | notes_deployed | revenue_earned | leads_contacted
  targetValue: numeric("target_value", { precision: 14, scale: 2 }).notNull(),
  periodStart: timestamp("period_start").notNull(),
  periodEnd: timestamp("period_end").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

export const insertGoalSchema = createInsertSchema(goals).omit({ id: true, createdAt: true, updatedAt: true });
export type Goal = typeof goals.$inferSelect;

// ─── Background Jobs ──────────────────────────────────────────────────────────
// Persistent backing store for the in-memory JobQueueService.
// Jobs are dual-written here so they survive server restarts.
export const backgroundJobs = pgTable("background_jobs", {
  id: serial("id").primaryKey(),
  type: text("type").notNull(), // email | webhook | payment_sync | notification
  payload: jsonb("payload").$type<Record<string, any>>().notNull(),
  status: text("status").notNull().default("pending"), // pending | processing | completed | failed
  attempts: integer("attempts").notNull().default(0),
  maxAttempts: integer("max_attempts").notNull().default(3),
  scheduledFor: timestamp("scheduled_for").notNull(),
  error: text("error"),
  result: jsonb("result").$type<Record<string, any>>(),
  createdAt: timestamp("created_at").defaultNow(),
  completedAt: timestamp("completed_at"),
});

export const insertBackgroundJobSchema = createInsertSchema(backgroundJobs).omit({
  id: true,
  createdAt: true,
});
export type InsertBackgroundJob = z.infer<typeof insertBackgroundJobSchema>;
export type BackgroundJob = typeof backgroundJobs.$inferSelect;
export type InsertGoal = typeof goals.$inferInsert;

