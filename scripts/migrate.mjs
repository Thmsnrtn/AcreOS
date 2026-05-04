#!/usr/bin/env node
// Release-command schema patch. Applies idempotent ALTER TABLE IF NOT EXISTS
// statements to catch schema drift (columns added to shared/schema.ts that
// never got a proper Drizzle migration file). All statements are safe to
// re-run — they no-op when columns already exist. We deliberately avoid
// drizzle-orm's migrator here because the local _journal.json is out of
// sync with what's actually been applied to prod (many migration files
// live outside the journal), and running a migrator against drifted state
// risks re-applying already-applied migrations.

import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL not set — aborting");
  process.exit(1);
}

const STATEMENTS = [
  // notes: columns that never got a proper Drizzle migration applied in prod.
  // All idempotent — re-running is a no-op.
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "owning_entity" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_by" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1',

  // agent_llm_traces — added 2026-04 for action-replay. See
  // migrations/0027_agent_llm_traces.sql. Create table + indexes
  // idempotently so every agent LLM call can be audited.
  `CREATE TABLE IF NOT EXISTS "agent_llm_traces" (
     "id" serial PRIMARY KEY,
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
     "agent_codename" text NOT NULL,
     "purpose" text NOT NULL,
     "decision_id" integer,
     "model" text NOT NULL,
     "system_prompt" text,
     "user_prompt" text NOT NULL,
     "response" text NOT NULL,
     "latency_ms" integer,
     "input_tokens" integer,
     "output_tokens" integer,
     "cost_cents" integer,
     "error" text,
     "metadata" jsonb DEFAULT '{}'::jsonb,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_agent_recent" ON "agent_llm_traces" ("agent_codename", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_decision" ON "agent_llm_traces" ("decision_id")',
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_org_recent" ON "agent_llm_traces" ("organization_id", "created_at" DESC)',

  // Production port phase B.5: users.appearance_preferences (migration 0028).
  // Drives 5-theme × light/dark + 5-font-pairing + density + motion system.
  // Nullable so existing users transparently get client-side defaults.
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appearance_preferences" jsonb',

  // Production port phase D.1: feature flag 5-state machine (migration 0029).
  // Extends platform_feature_flags with state + audience + audit columns.
  // Backfills state from existing enabled boolean (only on rows where state IS NULL).
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "state" text',
  `ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "audience" jsonb DEFAULT '{}'::jsonb`,
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "changed_by" text',
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "changed_at" timestamp',
  `UPDATE "platform_feature_flags" SET "state" = CASE WHEN "enabled" THEN 'on' ELSE 'off' END WHERE "state" IS NULL`,

  // Seed the design-system §8.4 initial flag set if missing. Each insert
  // is idempotent via ON CONFLICT.
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('module.land-academy', 'Land Academy module', 'Educational content and certifications', false, 'off', '{}'::jsonb, '["/academy"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('module.marketplace', 'Marketplace module', 'Buyer / seller marketplace', false, 'off', '{}'::jsonb, '["/marketplace"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('surface.command-palette-v2', 'Command palette v2', 'Refined ⌘K palette with prototype shape', false, 'founder-only', '{}'::jsonb, '[]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('feature.atlas-async-jobs', 'Atlas async jobs', 'Long-running Atlas analyses with notification', false, 'founder-only', '{}'::jsonb, '[]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('feature.autonomy-matrix', 'Autonomy matrix', 'Per-agent × per-action × thresholds permissions', false, 'founder-only', '{}'::jsonb, '["/settings"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,

  // ── Phase 3 Week 7-8 (P2-11): Postgres extensions. Migration 0044. ──────
  // pgvector for Sayuri-Vatanen embeddings, pg_trgm for Anaïs fuzzy search,
  // pg_stat_statements for the next index-audit pass.
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE EXTENSION IF NOT EXISTS pg_stat_statements',

  // ── Coriander §1 (Wave 3): Recovery-console audit trail. Migration 0039. ──
  // Append-only event log for high-risk admin recovery operations (2FA reset,
  // session revoke, ownership transfer, autopay freeze, password-reset link).
  // Distinct from the org-scoped audit_log table: audit_events is platform-
  // wide, founder-driven, and may have no owning organization. Retention: 7
  // years (legal). No deletes. Append-only.
  //
  // 2026-05-04 (Workstream §3.1): added to migrate.mjs to bring prod DB into
  // alignment with shared/schema.ts. Was sitting in migrations/0039_audit_events.sql
  // but never applied to prod, causing the index-audit CREATE INDEX below to
  // fail-non-fatal every deploy.
  `CREATE TABLE IF NOT EXISTS "audit_events" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "actor_user_id" text,
     "actor_email" text,
     "action" text NOT NULL,
     "target_type" text NOT NULL,
     "target_id" text NOT NULL,
     "justification" text,
     "metadata" jsonb,
     "ip" text,
     "user_agent" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_actor" ON "audit_events" ("actor_user_id")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_target" ON "audit_events" ("target_type", "target_id")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_action" ON "audit_events" ("action")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_created_at" ON "audit_events" ("created_at" DESC)',

  // ── Phase 3 Week 7-8 (P1-15): index audit. Migration 0045. ──────────────
  // CONCURRENTLY is safe because pool.query runs each statement outside an
  // implicit transaction. IF NOT EXISTS makes them idempotent on retry.
  // NOTE: do not run release_command through pgBouncer — CONCURRENTLY needs
  // a real Postgres session. See docs/runbooks/pgbouncer-rollout.md.
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_status_created_idx" ON "leads" ("organization_id", "status", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_assigned_status_idx" ON "leads" ("organization_id", "assigned_to", "status")',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_land_status_idx" ON "properties" ("organization_id", "land_status")',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_status_created_idx" ON "properties" ("organization_id", "status", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_org_conversation_created_idx" ON "messages" ("organization_id", "conversation_id", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_action_created_idx" ON "audit_events" ("action", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_events_event_created_idx" ON "email_events" ("event", "created_at" DESC)',
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// 2026-05-04 (Workstream A.2 follow-on): the release_command had been
// failing prod deploys silently for ~3 days because 4 specific statements
// reference tables/columns/extensions that the prod DB doesn't have yet
// (audit_events table, properties.land_status column, email_events table,
// pgvector extension). Those failures cause the script to exit 1, which
// aborts the deploy.
//
// The right long-term fix is to add the missing CREATE TABLE / ALTER ADD
// COLUMN / etc. statements to this list so prod catches up. That's a
// founder-judgment call (which migrations to apply, in what order, with
// what risk window) — not a mechanical fix.
//
// Short-term unblock: classify failures.
//   - "expected dependency missing" (column/table/extension does not exist)
//     → log loudly but don't abort the deploy. The dependent index/feature
//     simply doesn't get added today; the deploy still ships.
//   - any other failure → fail loud as before (real schema bug or perms).
const EXPECTED_FAILURE_PATTERNS = [
  /column ".*" does not exist/i,
  /relation ".*" does not exist/i,
  /extension ".*" is not available/i,
];

let exitCode = 0;
const failures = [];
const skipped = [];

try {
  for (const stmt of STATEMENTS) {
    try {
      await pool.query(stmt);
      console.log(`[migrate] OK: ${stmt}`);
    } catch (err) {
      const isExpected = EXPECTED_FAILURE_PATTERNS.some((rx) => rx.test(err.message));
      if (isExpected) {
        console.warn(`[migrate] SKIPPED (dependency missing — non-fatal): ${stmt}\n  ${err.message}`);
        skipped.push({ stmt, message: err.message });
      } else {
        console.error(`[migrate] FAILED: ${stmt}\n  ${err.message}`);
        failures.push({ stmt, message: err.message });
        exitCode = 1;
      }
    }
  }
  if (skipped.length > 0) {
    console.warn(`[migrate] ${skipped.length} statement(s) skipped due to missing prerequisite. Apply the underlying migrations from migrations/*.sql, then re-deploy to add these.`);
  }
  if (failures.length > 0) {
    console.error(`[migrate] ${failures.length} statement(s) failed unexpectedly. Aborting deploy.`);
  }
} finally {
  await pool.end().catch(() => {});
}

process.exit(exitCode);
