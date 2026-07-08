-- 0194 — Hot-path indexes (2026-07 platform sweep).
-- The org-leading-index lint froze 149 offenders at baseline; these are the
-- worst of them: org-scoped, customer-facing list/timeline/aggregation
-- queries on tables with ZERO indexes (or missing the exact composite the
-- query needs). All additive + idempotent.

-- Polymorphic customer timeline — read on every lead/deal/property detail,
-- and now the /api/deals/:id/track union. Was completely unindexed.
CREATE INDEX IF NOT EXISTS "activity_events_org_entity_idx"
  ON "activity_events" ("organization_id", "entity_type", "entity_id", "created_at");

-- Hottest per-lead activity feed. Was completely unindexed.
CREATE INDEX IF NOT EXISTS "lead_activities_lead_created_idx"
  ON "lead_activities" ("lead_id", "created_at");
CREATE INDEX IF NOT EXISTS "lead_activities_org_idx"
  ON "lead_activities" ("organization_id");

-- Financial hot path: no org index, no (note, status) composite.
CREATE INDEX IF NOT EXISTS "payments_org_idx"
  ON "payments" ("organization_id");
CREATE INDEX IF NOT EXISTS "payments_note_status_idx"
  ON "payments" ("note_id", "status");

-- Per-org AI cost aggregation (cost ceilings, quotas, telemetry rollups)
-- sums by org + createdAt; only separate single-column indexes existed.
CREATE INDEX IF NOT EXISTS "ai_telemetry_events_org_created_idx"
  ON "ai_telemetry_events" ("organization_id", "created_at");

-- Org-scoped list surfaces with zero indexes.
CREATE INDEX IF NOT EXISTS "notifications_org_created_idx"
  ON "notifications" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "tasks_org_status_idx"
  ON "tasks" ("organization_id", "status");
CREATE INDEX IF NOT EXISTS "inbox_messages_org_received_idx"
  ON "inbox_messages" ("organization_id", "received_at");
CREATE INDEX IF NOT EXISTS "usage_events_org_created_idx"
  ON "usage_events" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "api_usage_logs_org_created_idx"
  ON "api_usage_logs" ("organization_id", "created_at");
