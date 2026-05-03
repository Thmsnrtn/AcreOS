-- Phase 3 Week 7-8 (P1-15): additive-only index audit.
--
-- Every index here is CONCURRENTLY + IF NOT EXISTS so this migration is
-- safe to re-run, never blocks writes, and never drops or recreates an
-- existing index. If you need to rebuild one, do it in a separate
-- migration after confirming the old index is unused via
-- pg_stat_user_indexes (enabled by migration 0044).
--
-- Each index is justified by a real call-site grep against the codebase
-- on 2026-05-03. The composite ordering matches the actual query
-- (selectivity-first, sort-last) so the index can satisfy both filter
-- and ORDER BY without an extra sort step.
--
-- IMPORTANT: CREATE INDEX CONCURRENTLY cannot run inside a transaction.
-- scripts/migrate.mjs splits this file on `;` and runs each statement
-- individually, which is required for CONCURRENTLY to work.

-- ─── leads ───────────────────────────────────────────────────────────────
-- server/storage.ts:1290+ getLeads / getLeadsPaginated filter on
-- (organizationId, status?, deletedAt) and ORDER BY createdAt DESC.
-- Existing per-column indexes force a bitmap-and; the composite below
-- is a single index scan.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_status_created_idx"
  ON "leads" ("organization_id", "status", "created_at" DESC);

-- server/storage.ts:1295,1308 — getLeads filters by assignedTo within an
-- organization, often combined with status (assignment views, "my open
-- leads", round-robin balancing).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_assigned_status_idx"
  ON "leads" ("organization_id", "assigned_to", "status");

-- ─── properties ──────────────────────────────────────────────────────────
-- server/services/acreOSValuation.ts:240, server/routes-data-intelligence.ts:151,
-- assertFeeSimpleOrThrow gates contract auto-doc on landStatus = 'fee'.
-- Filter is always (organizationId, landStatus).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_land_status_idx"
  ON "properties" ("organization_id", "land_status");

-- server/storage.ts:1611,1617,2151 list properties by org with status
-- predicates and sort by createdAt DESC. Existing single-column indexes
-- on org_id and status need a bitmap-and for this hot path.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_status_created_idx"
  ON "properties" ("organization_id", "status", "created_at" DESC);

-- ─── messages ────────────────────────────────────────────────────────────
-- The messages table links to leads via conversation_id (not lead_id).
-- server/storage.ts:2131-2133 reads a conversation thread ordered by
-- createdAt; server/services/sellerIntentPredictor.ts:915-917 reads many
-- conversations at once and orders by createdAt DESC. All these paths
-- want (org → conversation → time).
CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_org_conversation_created_idx"
  ON "messages" ("organization_id", "conversation_id", "created_at" DESC);

-- ─── audit_events (Coriander) ────────────────────────────────────────────
-- audit_events is platform-wide (no organization_id column — see
-- migration 0039 + shared/schema.ts:4343). Founder views filter by
-- action and order by created_at DESC ("show me every 2fa_reset in the
-- last 24h"). Existing single-column indexes require a separate sort.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_action_created_idx"
  ON "audit_events" ("action", "created_at" DESC);

-- ─── email_events ────────────────────────────────────────────────────────
-- Existing index `idx_email_events_email_created` covers per-recipient
-- timelines. The funnel/aggregation queries (delivery rate, bounce rate
-- per day) filter by event type instead of email. Add the symmetric
-- index so those reports stop full-scanning.
CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_events_event_created_idx"
  ON "email_events" ("event", "created_at" DESC);
