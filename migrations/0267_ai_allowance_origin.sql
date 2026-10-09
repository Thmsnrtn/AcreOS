-- 0267 — one shared monthly AI allowance per plan, measured in cents
-- (founder decision 2026-10-08, docs/company/founder-decisions-2026-10-08.md).
--
-- ai_telemetry_events.origin records who triggered each call:
--   'customer'   counts toward the org's monthly allowance;
--   'background' serves the org but was not triggered by it — never counted;
--   NULL         platform-internal, or recorded before this column — never counted.
-- Purely additive.
ALTER TABLE "ai_telemetry_events" ADD COLUMN IF NOT EXISTS "origin" text;
CREATE INDEX IF NOT EXISTS "ai_telemetry_org_origin_created_idx" ON "ai_telemetry_events" ("organization_id", "origin", "created_at");
