-- Task #59: Add composite indexes on (organizationId, status) and (organizationId, createdAt)
-- for all major tables to optimize multi-tenant filtered queries.
-- All CREATE INDEX statements use IF NOT EXISTS for idempotency.

-- ── Leads ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "leads_org_status_idx"
  ON "leads" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "leads_org_created_idx"
  ON "leads" ("organization_id", "created_at" DESC);

-- ── Deals ────────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "deals_org_status_idx"
  ON "deals" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "deals_org_created_idx"
  ON "deals" ("organization_id", "created_at" DESC);

-- ── Properties ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "properties_org_status_idx"
  ON "properties" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "properties_org_created_idx"
  ON "properties" ("organization_id", "created_at" DESC);

-- ── Notes (seller finance) ───────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "notes_org_status_idx"
  ON "notes" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "notes_org_created_idx"
  ON "notes" ("organization_id", "created_at" DESC);

-- ── Campaigns ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "campaigns_org_status_idx"
  ON "campaigns" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "campaigns_org_created_idx"
  ON "campaigns" ("organization_id", "created_at" DESC);

-- ── Marketplace Listings ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "marketplace_listings_org_status_idx"
  ON "marketplace_listings" ("organization_id", "status");

CREATE INDEX IF NOT EXISTS "marketplace_listings_status_created_idx"
  ON "marketplace_listings" ("status", "created_at" DESC);

-- ── Payments (note payments) ─────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "note_payments_org_due_date_idx"
  ON "note_payments" ("note_id", "due_date");

-- Task #61: Audit log createdAt index for retention queries
CREATE INDEX IF NOT EXISTS "audit_logs_created_at_idx"
  ON "audit_logs" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_logs_org_created_idx"
  ON "audit_logs" ("organization_id", "created_at" DESC);

-- ── AI Conversations (task #48) ───────────────────────────────────────────────
-- Ensure AI conversation data is scoped by org (prevent cross-tenant leakage)
CREATE INDEX IF NOT EXISTS "ai_conversations_org_idx"
  ON "ai_conversations" ("organization_id");

CREATE INDEX IF NOT EXISTS "ai_conversations_org_created_idx"
  ON "ai_conversations" ("organization_id", "created_at" DESC);

-- ── Team Members ──────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "team_members_org_user_idx"
  ON "team_members" ("organization_id", "user_id");

-- ── Support Tickets ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "support_tickets_org_status_idx"
  ON "support_tickets" ("organization_id", "status");

-- ── Job Health Logs ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "job_health_logs_name_started_idx"
  ON "job_health_logs" ("job_name", "run_started_at" DESC);
