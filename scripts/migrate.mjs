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

  // ── Phase 3 Week 7-8 (Wave 7): outbox + DLQ + job_runs. Migration 0046. ─
  // §3 Batch 1 (CANARY) — fixes worker hot-loop. The worker process polls
  // outbox every 5 seconds; without this table it logs `[worker] poll
  // cycle failed` ~12 times/min. After this batch lands the canary signal
  // is: those errors stop. If they don't, the migration didn't take and
  // we need to investigate before continuing the §3 sweep.
  `CREATE TABLE IF NOT EXISTS "outbox" (
     "id" serial PRIMARY KEY,
     "event_type" text NOT NULL,
     "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "status" text NOT NULL DEFAULT 'pending',
     "attempts" integer NOT NULL DEFAULT 0,
     "last_error_at" timestamp,
     "last_error_message" text,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "sent_at" timestamp
   )`,
  'CREATE INDEX IF NOT EXISTS "outbox_status_created_idx" ON "outbox" ("status", "created_at")',
  'CREATE INDEX IF NOT EXISTS "outbox_event_type_idx" ON "outbox" ("event_type")',
  `CREATE TABLE IF NOT EXISTS "outbox_dlq" (
     "id" serial PRIMARY KEY,
     "original_outbox_id" integer,
     "event_type" text NOT NULL,
     "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "status" text NOT NULL DEFAULT 'failed',
     "attempts" integer NOT NULL DEFAULT 0,
     "last_error_at" timestamp,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "failed_at" timestamp NOT NULL DEFAULT now(),
     "failure_reason" text NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS "outbox_dlq_event_type_idx" ON "outbox_dlq" ("event_type")',
  'CREATE INDEX IF NOT EXISTS "outbox_dlq_failed_at_idx" ON "outbox_dlq" ("failed_at" DESC)',
  `CREATE TABLE IF NOT EXISTS "job_runs" (
     "id" serial PRIMARY KEY,
     "job_name" text NOT NULL,
     "started_at" timestamp NOT NULL DEFAULT now(),
     "completed_at" timestamp,
     "status" text NOT NULL DEFAULT 'running',
     "error_message" text,
     "records_processed" integer
   )`,
  'CREATE INDEX IF NOT EXISTS "job_runs_job_name_started_idx" ON "job_runs" ("job_name", "started_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "job_runs_status_idx" ON "job_runs" ("status")',

  // ── §3 Batch 2 — compliance + audit tables ──────────────────────────────
  // Migrations 0049 (dsar_requests, data_processing_agreements),
  // 0053 (critical_alert_acks — support_saved_replies deferred to a later
  // batch as out-of-domain), 0057 (legal_holds), 0060 (ai_routing_overrides),
  // 0065 (compliance_validations, prompt_versions, ai_injection_attempts).
  //
  // Excluded from this batch: the audit_events lockdown triggers/view in
  // 0049 part 3. audit_events table already exists in prod (Batch 1 / §3.1);
  // the append-only enforcement is a separate compliance-posture decision
  // and is a behavioural change, not a missing-schema fix. Will be added in
  // a follow-on commit if/when the founder authorizes.
  //
  // FK prereqs (verified present in prod): organizations, users, notifications.
  // gen_random_uuid() requires PG ≥ 13 (we're on 16); no extension needed.

  // legal_holds — 0057
  `CREATE TABLE IF NOT EXISTS "legal_holds" (
     "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id"  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
     "case_ref"         TEXT NOT NULL,
     "scope"            TEXT NOT NULL,
     "scope_ids"        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
     "placed_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "placed_by"        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
     "released_at"      TIMESTAMPTZ,
     "release_reason"   TEXT,
     "notes"            TEXT,
     "status"           TEXT NOT NULL DEFAULT 'active',
     "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT legal_holds_scope_chk CHECK (scope IN ('org_wide','lead_specific','property_specific','user_specific')),
     CONSTRAINT legal_holds_status_chk CHECK (status IN ('active','released'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_legal_holds_org_active ON legal_holds (organization_id) WHERE status = 'active'`,
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_status ON legal_holds(status)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_placed_at ON legal_holds(placed_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_case_ref ON legal_holds(case_ref)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_scope_ids ON legal_holds USING GIN (scope_ids)',

  // dsar_requests — 0049
  `CREATE TABLE IF NOT EXISTS "dsar_requests" (
     "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "request_type"    TEXT NOT NULL CHECK (request_type IN ('access','erasure','portability','rectification')),
     "email"           TEXT NOT NULL,
     "full_name"       TEXT NOT NULL,
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
     "organization"    TEXT,
     "justification"   TEXT,
     "status"          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','verified','fulfilling','completed','denied')),
     "verification_token"   TEXT,
     "verified_at"     TIMESTAMPTZ,
     "completed_at"    TIMESTAMPTZ,
     "denied_reason"   TEXT,
     "ip"              TEXT,
     "user_agent"      TEXT,
     "metadata"        JSONB DEFAULT '{}'::jsonb,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_email ON dsar_requests(email)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_status ON dsar_requests(status)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_created_at ON dsar_requests(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_org ON dsar_requests(organization_id)',

  // data_processing_agreements — 0049 (incl. 8-row seed; ON CONFLICT idempotent)
  `CREATE TABLE IF NOT EXISTS "data_processing_agreements" (
     "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "vendor_name"     TEXT NOT NULL UNIQUE,
     "status"          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','negotiating','signed','expired')),
     "signed_date"     DATE,
     "expires_at"      DATE,
     "contact_email"   TEXT,
     "scope"           TEXT,
     "evidence_url"    TEXT,
     "notes"           TEXT,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_dpa_status ON data_processing_agreements(status)',
  `INSERT INTO data_processing_agreements (vendor_name, status, scope, contact_email) VALUES
     ('Stripe',    'pending', 'Billing PII, payment methods, invoices, tax identity', 'privacy@stripe.com'),
     ('Twilio',    'pending', 'Phone numbers, SMS bodies, voice-call recordings & transcripts', 'privacy@twilio.com'),
     ('SendGrid',  'pending', 'Email addresses, message bodies, delivery events', 'privacy@sendgrid.com'),
     ('Clerk',     'pending', 'Auth identities, sessions, MFA factors, email/phone', 'privacy@clerk.com'),
     ('Anthropic', 'pending', 'Prompt content (incl. lead/property text), Claude completions', 'privacy@anthropic.com'),
     ('OpenAI',    'pending', 'Prompt content for embeddings + completions', 'privacy@openai.com'),
     ('Lob',       'pending', 'Recipient mailing addresses, postcard imagery', 'privacy@lob.com'),
     ('AWS',       'pending', 'All at-rest customer data (S3, RDS, KMS-encrypted)', 'aws-privacy@amazon.com')
   ON CONFLICT (vendor_name) DO NOTHING`,

  // compliance_validations — 0065
  `CREATE TABLE IF NOT EXISTS "compliance_validations" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer,
     "surface" text NOT NULL,
     "domain" text NOT NULL,
     "input_hash" text NOT NULL,
     "verdict" text NOT NULL,
     "missing_phrases" jsonb,
     "prepended_disclosure" text,
     "validator_model" text NOT NULL,
     "thinking_budget" integer,
     "latency_ms" integer,
     "rationale" text,
     "metadata" jsonb,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "compliance_validations_verdict_check" CHECK ("verdict" IN ('pass', 'block', 'amend', 'error'))
   )`,
  'CREATE INDEX IF NOT EXISTS "compliance_validations_org_idx" ON "compliance_validations" ("organization_id", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "compliance_validations_surface_idx" ON "compliance_validations" ("surface", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "compliance_validations_verdict_idx" ON "compliance_validations" ("verdict", "created_at" DESC)',

  // prompt_versions — 0065
  `CREATE TABLE IF NOT EXISTS "prompt_versions" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "prompt_name" text NOT NULL,
     "version" text NOT NULL,
     "system" text NOT NULL,
     "tier" text NOT NULL DEFAULT 'standard',
     "hash" text NOT NULL,
     "weight" integer NOT NULL DEFAULT 0,
     "eval_score" numeric(5,4),
     "eval_run_at" timestamptz,
     "active" boolean NOT NULL DEFAULT true,
     "is_candidate" boolean NOT NULL DEFAULT false,
     "promoted_from" varchar,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "prompt_versions_tier_check" CHECK ("tier" IN ('critical', 'standard', 'background')),
     CONSTRAINT "prompt_versions_weight_check" CHECK ("weight" >= 0 AND "weight" <= 100)
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "prompt_versions_name_version_unique" ON "prompt_versions" ("prompt_name", "version")',
  `CREATE INDEX IF NOT EXISTS "prompt_versions_active_idx" ON "prompt_versions" ("prompt_name", "active") WHERE "active" = true`,

  // ai_injection_attempts — 0065
  `CREATE TABLE IF NOT EXISTS "ai_injection_attempts" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "user_id" text,
     "organization_id" integer,
     "surface" text NOT NULL,
     "matched_patterns" jsonb,
     "input_preview" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "ai_injection_attempts_user_idx" ON "ai_injection_attempts" ("user_id", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "ai_injection_attempts_org_idx" ON "ai_injection_attempts" ("organization_id", "created_at" DESC)',

  // ai_routing_overrides — 0060
  `CREATE TABLE IF NOT EXISTS "ai_routing_overrides" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "task_type" text NOT NULL,
     "original_tier" text NOT NULL,
     "override_tier" text NOT NULL,
     "override_model" text,
     "reason" text NOT NULL,
     "previous_eval_score" numeric(5,4),
     "new_eval_score" numeric(5,4),
     "active" boolean NOT NULL DEFAULT true,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "expires_at" timestamptz,
     CONSTRAINT "ai_routing_overrides_tier_check" CHECK ("override_tier" IN ('critical', 'standard', 'background')),
     CONSTRAINT "ai_routing_overrides_orig_tier_check" CHECK ("original_tier" IN ('critical', 'standard', 'background'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ai_routing_overrides_active_unique" ON "ai_routing_overrides" ("task_type") WHERE "active" = true`,
  'CREATE INDEX IF NOT EXISTS "ai_routing_overrides_created_idx" ON "ai_routing_overrides" ("created_at" DESC)',

  // critical_alert_acks — 0053
  `CREATE TABLE IF NOT EXISTS "critical_alert_acks" (
     "id"              SERIAL PRIMARY KEY,
     "notification_id" INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
     "severity"        TEXT NOT NULL CHECK (severity IN ('P0','P1')),
     "fired_at"        TIMESTAMPTZ NOT NULL,
     "ack_deadline_at" TIMESTAMPTZ NOT NULL,
     "acked_at"        TIMESTAMPTZ,
     "acked_by"        TEXT,
     "escalated_at"    TIMESTAMPTZ,
     "escalation_target" TEXT,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_unacked ON critical_alert_acks (ack_deadline_at) WHERE acked_at IS NULL AND escalated_at IS NULL`,
  'CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_notification ON critical_alert_acks (notification_id)',

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
