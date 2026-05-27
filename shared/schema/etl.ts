// ============================================================================
// SHARED/SCHEMA/ETL.TS
// ----------------------------------------------------------------------------
// Migration in/out parity — import/export jobs, ETL orchestrator (etl_jobs,
// etl_runs), brand profiles, CMO scripts/ad renders, agent rejection notes.
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
import { organizations } from "../schema";

// ============================================================================
// MIGRATION IN/OUT PARITY — Phase 4 Week 15-16 (Magdalena §1, Tobiah §1)
// ----------------------------------------------------------------------------
// Backed by migrations/0069_import_export_jobs.sql.
//
// import_jobs powers the 50K-row CSV import flow + communications/document
// history imports. The worker (server/services/migrationJobs.ts) processes
// rows in chunks of 500 and updates processed_count after each chunk so the
// UI can show a progress bar.
//
// export_jobs powers the consolidated /api/export/everything endpoint which
// emits a single ZIP per job (replacing the 4 legacy export systems).
// ============================================================================

export const importJobs = pgTable("import_jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  userId: text("user_id").notNull(),
  // 'leads' | 'properties' | 'deals' | 'notes' | 'communications' | 'documents'
  kind: text("kind").notNull(),
  // 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  status: text("status").notNull().default("queued"),
  filename: text("filename"),
  payloadRef: text("payload_ref"),
  fieldMap: jsonb("field_map").$type<Record<string, string>>(),
  totalRows: integer("total_rows").notNull().default(0),
  processedCount: integer("processed_count").notNull().default(0),
  successCount: integer("success_count").notNull().default(0),
  errorCount: integer("error_count").notNull().default(0),
  duplicatesSkipped: integer("duplicates_skipped").notNull().default(0),
  errors: jsonb("errors").$type<Array<{ row: number; error: string }>>().notNull().default([]),
  result: jsonb("result").$type<Record<string, unknown>>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
}, (table) => [
  index("import_jobs_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("import_jobs_status_created_idx").on(table.status, table.createdAt),
]);

export const insertImportJobSchema = createInsertSchema(importJobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});
export type ImportJob = typeof importJobs.$inferSelect;
export type InsertImportJob = z.infer<typeof insertImportJobSchema>;

export const exportJobs = pgTable("export_jobs", {
  id: serial("id").primaryKey(),
  organizationId: integer("organization_id")
    .references(() => organizations.id, { onDelete: "cascade" })
    .notNull(),
  userId: text("user_id").notNull(),
  kind: text("kind").notNull().default("everything"),
  status: text("status").notNull().default("queued"),
  params: jsonb("params").$type<{
    entityTypes?: string[];
    dateRange?: { from?: string; to?: string };
    includeAttachments?: boolean;
  }>().notNull().default({}),
  archivePath: text("archive_path"),
  archiveSizeBytes: integer("archive_size_bytes"),
  entityCounts: jsonb("entity_counts").$type<Record<string, number>>(),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  expiresAt: timestamp("expires_at"),
}, (table) => [
  index("export_jobs_org_status_idx").on(table.organizationId, table.status, table.createdAt),
  index("export_jobs_status_created_idx").on(table.status, table.createdAt),
]);

export const insertExportJobSchema = createInsertSchema(exportJobs).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  completedAt: true,
});
export type ExportJob = typeof exportJobs.$inferSelect;
export type InsertExportJob = z.infer<typeof insertExportJobSchema>;
// ETL ORCHESTRATOR — Phase 8 Months 11 (Wenzeslaus pattern)
// ============================================================================
// Backed by migrations/0070_etl_orchestrator.sql. Every external pull (Regrid
// boundary updates, FEMA flood-zone updates, etc.) flows through one
// orchestrator that maintains a watermark per job, dead-letters per-record
// failures into `outbox_dlq`, and propagates upstream soft-deletes locally.
// See server/services/etlOrchestrator.ts for the runtime.

export const etlJobs = pgTable("etl_jobs", {
  id: serial("id").primaryKey(),
  jobName: text("job_name").notNull().unique(),
  providerName: text("provider_name").notNull(),
  sourceUrl: text("source_url"),
  watermarkColumn: text("watermark_column"),
  watermarkValue: text("watermark_value"),
  schedule: text("schedule").notNull().default("*/15 * * * *"),
  isActive: boolean("is_active").notNull().default(true),
  softDeleteOnMissing: boolean("soft_delete_on_missing").notNull().default(false),
  lastSuccessAt: timestamp("last_success_at"),
  lastErrorAt: timestamp("last_error_at"),
  lastError: text("last_error"),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
}, (table) => [
  index("etl_jobs_provider_idx").on(table.providerName),
  index("etl_jobs_active_idx").on(table.isActive, table.lastSuccessAt),
]);

export const insertEtlJobSchema = createInsertSchema(etlJobs).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type EtlJob = typeof etlJobs.$inferSelect;
export type InsertEtlJob = z.infer<typeof insertEtlJobSchema>;

export const etlRuns = pgTable("etl_runs", {
  id: serial("id").primaryKey(),
  jobId: integer("job_id").notNull().references(() => etlJobs.id, { onDelete: "cascade" }),
  startedAt: timestamp("started_at").notNull().defaultNow(),
  completedAt: timestamp("completed_at"),
  status: text("status").notNull().default("running"), // running | success | failure
  recordsRead: integer("records_read").notNull().default(0),
  recordsInserted: integer("records_inserted").notNull().default(0),
  recordsUpdated: integer("records_updated").notNull().default(0),
  recordsDeleted: integer("records_deleted").notNull().default(0),
  recordsFailed: integer("records_failed").notNull().default(0),
  errorMessage: text("error_message"),
  watermarkBefore: text("watermark_before"),
  watermarkAfter: text("watermark_after"),
}, (table) => [
  index("etl_runs_job_started_idx").on(table.jobId, table.startedAt),
  index("etl_runs_status_idx").on(table.status),
]);

export const insertEtlRunSchema = createInsertSchema(etlRuns).omit({
  id: true,
  startedAt: true,
});
export type EtlRun = typeof etlRuns.$inferSelect;
export type InsertEtlRun = z.infer<typeof insertEtlRunSchema>;

// ─── FW-THEO-1 + FW-INDIRA-1 (push-forward 2026-05-08): eval harness + ──
// AI cost ceiling + model lifecycle.
//
// Theo-Okuda + Indira-Lockwood + Marisol-Vega + Ashok-Bhatt + Harlowe-Stone
// converged: Pax draft + Pax executive + complianceAI disclosure generator
// have customer-facing blast radius and zero deterministic post-check.
// Theo frames as cost discipline, Indira frames as governance-mandatory.
//
// Three new tables. ai_models tracks the lifecycle of each model we
// support — when it was added, when Anthropic/OpenAI deprecated it,
// when we plan to retire it. ai_test_cases is the eval harness corpus
// — named scenarios that the harness runs after each prompt change.
// ai_cost_ceiling_overrides lets the founder set a per-org daily cap
// in cents that overrides the global default; the runaway-job runbook
// pages when an org hits the cap.

export const aiModels = pgTable(
  "ai_models",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    modelKey: text("model_key").notNull().unique(), // 'claude-opus-4-7', 'gpt-4o', etc
    provider: text("provider").notNull(), // 'anthropic' | 'openai' | 'openrouter'
    family: text("family"), // 'opus' | 'sonnet' | 'haiku' | 'gpt-4' | etc
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
    deprecatedAt: timestamp("deprecated_at", { withTimezone: true }),
    retiredAt: timestamp("retired_at", { withTimezone: true }),
    inputTokenCostCents: numeric("input_token_cost_cents"), // per 1M tokens
    outputTokenCostCents: numeric("output_token_cost_cents"), // per 1M tokens
    notes: text("notes"),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_models_provider_idx").on(table.provider),
    index("ai_models_deprecated_idx").on(table.deprecatedAt),
  ],
);
export type AiModel = typeof aiModels.$inferSelect;
export type InsertAiModel = typeof aiModels.$inferInsert;

export const aiTestCases = pgTable(
  "ai_test_cases",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    surface: text("surface").notNull(), // 'pax_inbox' | 'pax_executive' | 'compliance_disclosure'
    name: text("name").notNull(),
    description: text("description"),
    inputPrompt: text("input_prompt").notNull(),
    expectedTraits: jsonb("expected_traits").$type<string[]>().notNull().default([] as any), // bullet-list of must-haves
    forbiddenTraits: jsonb("forbidden_traits").$type<string[]>().notNull().default([] as any), // bullet-list of must-NOT-haves
    severity: text("severity").notNull().default("major"), // critical | major | minor
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("ai_test_cases_surface_idx").on(table.surface),
    index("ai_test_cases_active_idx").on(table.isActive),
  ],
);
export type AiTestCase = typeof aiTestCases.$inferSelect;
export type InsertAiTestCase = typeof aiTestCases.$inferInsert;

export const aiTestRuns = pgTable(
  "ai_test_runs",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    testCaseId: varchar("test_case_id").notNull(),
    modelKey: text("model_key").notNull(),
    runAt: timestamp("run_at", { withTimezone: true }).notNull().defaultNow(),
    passed: boolean("passed").notNull(),
    output: text("output"),
    failureReason: text("failure_reason"),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    costCents: numeric("cost_cents"),
  },
  (table) => [
    index("ai_test_runs_case_run_idx").on(table.testCaseId, table.runAt),
    index("ai_test_runs_model_run_idx").on(table.modelKey, table.runAt),
  ],
);
export type AiTestRun = typeof aiTestRuns.$inferSelect;
export type InsertAiTestRun = typeof aiTestRuns.$inferInsert;

export const aiCostCeilingOverrides = pgTable(
  "ai_cost_ceiling_overrides",
  {
    organizationId: integer("organization_id").primaryKey(),
    dailyCeilingCents: integer("daily_ceiling_cents").notNull(),
    monthlyCeilingCents: integer("monthly_ceiling_cents"),
    setBy: text("set_by"), // founder user_id who set it
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
);
export type AiCostCeilingOverride = typeof aiCostCeilingOverrides.$inferSelect;
export type InsertAiCostCeilingOverride = typeof aiCostCeilingOverrides.$inferInsert;

// ─── FW-DIEGO-1 (push-forward 2026-05-08): founder-letter infrastructure ──
// Diego-Marchetti's lead recommendation: founder-led community as the SMB
// acquisition flywheel. Weekly cadence, async (not Slack/Discord), one
// hour/week of founder time forever. Each row is one published letter:
// subject, body (HTML), public slug, sent_at, recipient_count, archive_url.
// Customer-facing /letters page reads from `published_at` desc.
export const communityLetters = pgTable(
  "community_letters",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    subject: text("subject").notNull(),
    htmlBody: text("html_body").notNull(),
    plainBody: text("plain_body"),
    publishedAt: timestamp("published_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    recipientCount: integer("recipient_count").notNull().default(0),
    senderUserId: text("sender_user_id"),
    senderEmail: text("sender_email"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("community_letters_published_idx").on(table.publishedAt),
  ],
);
export type CommunityLetter = typeof communityLetters.$inferSelect;
export type InsertCommunityLetter = typeof communityLetters.$inferInsert;

// ─── RS-5 (post-may1-resweep): email-on-new-location detector ─────────────
// Asher-takeover §3 root cause: "no email-on-new-location, no exfil alarm".
// One row per (user, ip-prefix, ua-family) tuple. First time we see a new
// tuple, we email the user and write an audit row. Subsequent sign-ins
// from the same tuple just update lastSeenAt — no email spam.
//
// ipPrefix: /24 for IPv4, first 4 hextets for IPv6. Covers home/office
// roaming on the same network without spamming on minor IP rotation.
// uaFamily: "Chrome/macOS" coarse bucket. Same browser-OS combo on the
// same network is "this is still me." A new combo is "alert me."
export const userSignInLocations = pgTable(
  "user_sign_in_locations",
  {
    id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
    userId: varchar("user_id").notNull(),
    ipPrefix: text("ip_prefix").notNull(),
    uaFamily: text("ua_family").notNull(),
    country: text("country"),
    region: text("region"),
    firstSeenAt: timestamp("first_seen_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    sessionCount: integer("session_count").notNull().default(1),
  },
  (table) => [
    uniqueIndex("user_sign_in_locations_unique").on(
      table.userId,
      table.ipPrefix,
      table.uaFamily,
    ),
    index("user_sign_in_locations_user_last_seen_idx").on(
      table.userId,
      table.lastSeenAt,
    ),
  ],
);
export type UserSignInLocation = typeof userSignInLocations.$inferSelect;

// (feedback_submissions table is unified above near the in-app widget definition;
//  duplicate declaration removed 2026-05-11.)
export type InsertUserSignInLocation = typeof userSignInLocations.$inferInsert;

// ─── CMO Ad Engine — Native ad generation, approval, broadcast (2026-05-20) ───
//
// Replaces Creatify with an owned pipeline: script (OpenRouter Haiku) → voice
// (ElevenLabs cloned founder voice) → assets (Pexels + Pixabay, deduped) →
// Remotion render (9:16 + 1:1 + 16:9) → founder approval via decisionsInbox →
// broadcast to Meta + TikTok via outbox.
//
// The learning loop is the long-term value: every render, approval, rejection
// note, and CTR/ROAS data point flows into structured columns here so the
// engine compounds over months. Cross-temporal queries (e.g. "which hook
// archetype performs best in retargeting at $40/day on TikTok 9:16") must
// be one query, not a research project.

export const brandProfiles = pgTable("brand_profiles", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  oneLiner: text("one_liner").notNull(),
  audiencePrimary: text("audience_primary").notNull(),
  audienceSecondary: text("audience_secondary"),
  toneDescriptors: text("tone_descriptors").array().notNull().default(sql`'{}'::text[]`),
  usps: text("usps").array().notNull().default(sql`'{}'::text[]`),
  bannedPhrases: text("banned_phrases").array().notNull().default(sql`'{}'::text[]`),
  complianceRules: jsonb("compliance_rules").$type<Array<{ name: string; pattern: string; reason: string }>>().notNull().default([]),
  brandKit: jsonb("brand_kit").$type<{
    primaryColor: string;
    secondaryColor: string;
    accentColor?: string;
    logoPath?: string;
    fonts: { display: string; body: string };
  }>().notNull(),
  voice: jsonb("voice").$type<{
    provider: "elevenlabs";
    voiceId: string | null;
    stability: number;
    similarityBoost: number;
    sampleScripts?: string[];
  }>().notNull(),
  funnelStages: jsonb("funnel_stages").$type<Record<string, { hookStyle: string; ctaLabel: string; ctaUrl: string }>>().notNull().default({}),
  founderVoiceSamples: text("founder_voice_samples").array().notNull().default(sql`'{}'::text[]`),
  referenceAds: jsonb("reference_ads").$type<Array<{ url: string; angle: string; notes: string }>>().notNull().default([]),
  autoGenerationEnabled: boolean("auto_generation_enabled").notNull().default(false),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("brand_profiles_slug_idx").on(table.slug),
]);

export type BrandProfile = typeof brandProfiles.$inferSelect;
export type InsertBrandProfile = typeof brandProfiles.$inferInsert;

export const cmoScripts = pgTable("cmo_scripts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  brandProfileId: integer("brand_profile_id").references(() => brandProfiles.id, { onDelete: "cascade" }).notNull(),
  intent: text("intent").notNull(),
  funnelStage: text("funnel_stage").notNull(),
  hookArchetype: text("hook_archetype").notNull(),
  hook: text("hook").notNull(),
  body: text("body").notNull(),
  cta: text("cta").notNull(),
  lengthTargetSec: integer("length_target_sec").notNull(),
  brollQueries: text("broll_queries").array().notNull(),
  scriptJson: jsonb("script_json").$type<Record<string, unknown>>().notNull(),
  // Voice the script generator selected from the brand profile's voice pool.
  // Persisted at script-time (not render-time) so the script is written to
  // match the narrator's vibe — sharp scripts for a deadpan voice, warm
  // scripts for a casual narrator. Renderer reads this to know which voice
  // ID to send to ElevenLabs.
  voiceId: text("voice_id"),
  voiceName: text("voice_name"),
  status: text("status").notNull().default("draft"),
  qualityScore: integer("quality_score"),
  scoreBreakdown: jsonb("score_breakdown").$type<{
    brandVoice: number; hookStrength: number; compliance: number; novelty: number;
    notes: string;
  }>(),
  rejectionReason: text("rejection_reason"),
  generationCostCents: integer("generation_cost_cents").notNull().default(0),
  scoringCostCents: integer("scoring_cost_cents").notNull().default(0),
  model: text("model").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  index("cmo_scripts_brand_status_idx").on(table.brandProfileId, table.status),
  index("cmo_scripts_archetype_idx").on(table.hookArchetype),
  index("cmo_scripts_created_at_idx").on(table.createdAt),
]);

export type CmoScript = typeof cmoScripts.$inferSelect;
export type InsertCmoScript = typeof cmoScripts.$inferInsert;

export const cmoAdRenders = pgTable("cmo_ad_renders", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  scriptId: varchar("script_id").references(() => cmoScripts.id, { onDelete: "cascade" }).notNull(),
  brandProfileId: integer("brand_profile_id").references(() => brandProfiles.id, { onDelete: "cascade" }).notNull(),
  trackingId: varchar("tracking_id").notNull().unique(),
  aspectRatio: text("aspect_ratio").notNull(),
  durationSec: integer("duration_sec").notNull(),
  storagePath: text("storage_path").notNull(),
  manifestJson: jsonb("manifest_json").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull().default("queued"),
  bundleId: varchar("bundle_id"),
  costBreakdown: jsonb("cost_breakdown").$type<{
    scriptCents: number;
    scoringCents: number;
    voiceCents: number;
    assetsCents: number;
    renderCents: number;
    totalCents: number;
  }>().notNull(),
  voicePath: text("voice_path"),
  brollAssetIds: text("broll_asset_ids").array(),
  approvedAt: timestamp("approved_at"),
  approvedBy: text("approved_by"),
  rejectedAt: timestamp("rejected_at"),
  rejectionNoteId: integer("rejection_note_id"),
  broadcastAt: timestamp("broadcast_at"),
  errorMessage: text("error_message"),
  createdAt: timestamp("created_at").defaultNow(),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  index("cmo_ad_renders_status_idx").on(table.status),
  index("cmo_ad_renders_bundle_idx").on(table.bundleId),
  index("cmo_ad_renders_script_idx").on(table.scriptId),
  uniqueIndex("cmo_ad_renders_tracking_id_idx").on(table.trackingId),
]);

export type CmoAdRender = typeof cmoAdRenders.$inferSelect;
export type InsertCmoAdRender = typeof cmoAdRenders.$inferInsert;

export const cmoAssetUsage = pgTable("cmo_asset_usage", {
  id: serial("id").primaryKey(),
  provider: text("provider").notNull(),
  externalId: text("external_id").notNull(),
  url: text("url").notNull(),
  query: text("query").notNull(),
  categoryTags: text("category_tags").array().notNull().default(sql`'{}'::text[]`),
  durationSec: integer("duration_sec"),
  dimensions: jsonb("dimensions").$type<{ width: number; height: number }>(),
  firstUsedAt: timestamp("first_used_at").defaultNow(),
  lastUsedAt: timestamp("last_used_at").defaultNow(),
  useCount: integer("use_count").notNull().default(1),
  shippedInRenderIds: text("shipped_in_render_ids").array().notNull().default(sql`'{}'::text[]`),
}, (table) => [
  uniqueIndex("cmo_asset_usage_provider_external_idx").on(table.provider, table.externalId),
  index("cmo_asset_usage_last_used_idx").on(table.lastUsedAt),
]);

export type CmoAssetUsage = typeof cmoAssetUsage.$inferSelect;

export const cmoHookArchetypes = pgTable("cmo_hook_archetypes", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  displayName: text("display_name").notNull(),
  description: text("description").notNull(),
  examplePrompt: text("example_prompt").notNull(),
  rollingCtrPpm: integer("rolling_ctr_ppm"),
  rollingRoasBps: integer("rolling_roas_bps"),
  spendCentsLast30d: integer("spend_cents_last_30d").notNull().default(0),
  rendersLast30d: integer("renders_last_30d").notNull().default(0),
  generationWeight: integer("generation_weight").notNull().default(100),
  active: boolean("active").notNull().default(true),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("cmo_hook_archetypes_slug_idx").on(table.slug),
]);

export type CmoHookArchetype = typeof cmoHookArchetypes.$inferSelect;

export const cmoAdPerformance = pgTable("cmo_ad_performance", {
  id: serial("id").primaryKey(),
  renderId: varchar("render_id").references(() => cmoAdRenders.id, { onDelete: "cascade" }).notNull(),
  platform: text("platform").notNull(),
  externalAdId: text("external_ad_id").notNull(),
  date: timestamp("date").notNull(),
  spendCents: integer("spend_cents").notNull().default(0),
  impressions: integer("impressions").notNull().default(0),
  clicks: integer("clicks").notNull().default(0),
  conversions: integer("conversions").notNull().default(0),
  ctrPpm: integer("ctr_ppm"),
  cpmCents: integer("cpm_cents"),
  roasBps: integer("roas_bps"),
  ingestedAt: timestamp("ingested_at").defaultNow(),
}, (table) => [
  uniqueIndex("cmo_ad_performance_unique_idx").on(table.renderId, table.platform, table.date),
  index("cmo_ad_performance_render_idx").on(table.renderId),
  index("cmo_ad_performance_date_idx").on(table.date),
]);

export type CmoAdPerformance = typeof cmoAdPerformance.$inferSelect;

export const cmoRejectionNotes = pgTable("cmo_rejection_notes", {
  id: serial("id").primaryKey(),
  scriptId: varchar("script_id").references(() => cmoScripts.id, { onDelete: "cascade" }),
  renderId: varchar("render_id").references(() => cmoAdRenders.id, { onDelete: "cascade" }),
  brandProfileId: integer("brand_profile_id").references(() => brandProfiles.id, { onDelete: "cascade" }).notNull(),
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  note: text("note"),
  rejectedAt: timestamp("rejected_at").defaultNow(),
  rejectedBy: text("rejected_by").notNull(),
  appliedToProfileAt: timestamp("applied_to_profile_at"),
}, (table) => [
  index("cmo_rejection_notes_brand_idx").on(table.brandProfileId, table.rejectedAt),
]);

export type CmoRejectionNote = typeof cmoRejectionNotes.$inferSelect;

export const cmoBudget = pgTable("cmo_budget", {
  id: serial("id").primaryKey(),
  brandProfileId: integer("brand_profile_id").references(() => brandProfiles.id, { onDelete: "cascade" }).notNull(),
  dailyCapCents: integer("daily_cap_cents").notNull().default(2000),
  weeklyCapCents: integer("weekly_cap_cents").notNull().default(10000),
  monthlyCapCents: integer("monthly_cap_cents").notNull().default(35000),
  spendTodayCents: integer("spend_today_cents").notNull().default(0),
  spendWeekCents: integer("spend_week_cents").notNull().default(0),
  spendMonthCents: integer("spend_month_cents").notNull().default(0),
  resetTodayAt: timestamp("reset_today_at"),
  resetWeekAt: timestamp("reset_week_at"),
  resetMonthAt: timestamp("reset_month_at"),
  updatedAt: timestamp("updated_at").defaultNow(),
}, (table) => [
  uniqueIndex("cmo_budget_brand_idx").on(table.brandProfileId),
]);

export type CmoBudget = typeof cmoBudget.$inferSelect;

// ─── Founder Redesign — Platform settings substrate + Audit + Rejection notes (Phase A) ─
//
// The unified backbone for the four-canonical-surface founder redesign.
// Every magic number that today requires a deploy moves to `platform_settings`;
// every founder-visible mutation lands in `founder_audit`; every agent's
// proposal generation reads the last N relevant rejections from
// `agent_rejection_notes` (generalizing the CMO-only pattern shipped 2026-05-20).
//
// Naming note: this is `platform_settings`, not `founder_settings` — there
// is a pre-existing `founder_settings` table (shared/schema.ts line 12973)
// with a simpler key/value/text shape used by the legacy /founder/settings
// page. The new substrate needs scope hierarchy (global / org / agent /
// skill) + JSON values + validRange metadata, so it lives as its own table.
//
// See /Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md for the
// full design context.

export const platformSettings = pgTable("platform_settings", {
  id: serial("id").primaryKey(),
  // Dotted-key namespace. Examples:
  //   trust.tier_breakpoints
  //   cost.per_org_daily_cap_cents
  //   autonomy.gate.sophie
  //   autonomy.gate.sophie.send_retention_email
  //   churn.intervention_rules
  key: text("key").notNull(),
  // Scope this row applies to. 'global' is the platform-wide default;
  // 'org' / 'agent' / 'skill' narrow to a specific entity via scopeRef.
  scope: text("scope").notNull().default("global"),
  scopeRef: text("scope_ref"),
  value: jsonb("value").$type<unknown>().notNull(),
  defaultValue: jsonb("default_value").$type<unknown>().notNull(),
  validRange: jsonb("valid_range").$type<{
    type?: "number" | "string" | "array" | "object" | "boolean" | "enum";
    min?: number;
    max?: number;
    oneOf?: unknown[];
    schema?: Record<string, unknown>;
  } | null>(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  lastChangedBy: text("last_changed_by"),
  lastChangedAt: timestamp("last_changed_at"),
  lastChangedNote: text("last_changed_note"),
  createdAt: timestamp("created_at").defaultNow(),
}, (table) => [
  uniqueIndex("platform_settings_scope_key_idx").on(table.scope, table.scopeRef, table.key),
  index("platform_settings_category_idx").on(table.category),
  index("platform_settings_key_idx").on(table.key),
]);

export type PlatformSetting = typeof platformSettings.$inferSelect;
export type InsertPlatformSetting = typeof platformSettings.$inferInsert;

export const founderAudit = pgTable("founder_audit", {
  id: serial("id").primaryKey(),
  founderId: text("founder_id"),
  area: text("area").notNull(),
  action: text("action").notNull(),
  // Optional pointers to the affected entity. Free-form so any future
  // mutation can plug in without schema migration.
  targetType: text("target_type"),
  targetId: text("target_id"),
  before: jsonb("before").$type<unknown>(),
  after: jsonb("after").$type<unknown>(),
  note: text("note"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => [
  index("founder_audit_area_created_idx").on(table.area, table.createdAt),
  index("founder_audit_target_idx").on(table.targetType, table.targetId),
  index("founder_audit_created_idx").on(table.createdAt),
]);

export type FounderAuditRow = typeof founderAudit.$inferSelect;
export type InsertFounderAuditRow = typeof founderAudit.$inferInsert;

export const agentRejectionNotes = pgTable("agent_rejection_notes", {
  id: serial("id").primaryKey(),
  // Which agent the rejection applies to. Allows targeted retrieval when
  // building proposal context for a specific agent's next batch.
  agentCodename: text("agent_codename").notNull(),
  // The proposal/decision that was rejected, if there is one in the
  // decisions_inbox lineage. Optional because some rejections come from
  // surfaces that don't go through decisions_inbox (direct override, etc.).
  decisionsInboxItemId: integer("decisions_inbox_item_id"),
  // Optional taxonomy that lets retrieval narrow by topic. Mirrors the
  // CMO rejection tags shape (tone_off / hook_weak / footage_mismatch / ...).
  tags: text("tags").array().notNull().default(sql`'{}'::text[]`),
  note: text("note"),
  rejectedBy: text("rejected_by").notNull(),
  rejectedAt: timestamp("rejected_at").defaultNow().notNull(),
  // When the next-batch retrieval has consumed this note as context. Lets
  // observability tools answer "did the agent see this feedback?" without
  // having to reconstruct from logs.
  consumedAt: timestamp("consumed_at"),
}, (table) => [
  index("agent_rejection_notes_agent_idx").on(table.agentCodename, table.rejectedAt),
  index("agent_rejection_notes_rejected_at_idx").on(table.rejectedAt),
]);

export type AgentRejectionNote = typeof agentRejectionNotes.$inferSelect;
export type InsertAgentRejectionNote = typeof agentRejectionNotes.$inferInsert;

