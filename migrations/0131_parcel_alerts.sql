-- ============================================================================
-- 0131 — Iyari (Chief of Future) #5 — Parcel Alerts
--   (owner-change & tax-status delta detector surface)
-- ----------------------------------------------------------------------------
-- The scheduled diff job (server/services/parcelDeltaDetector.ts, wired into
-- runScheduledJobs.ts via withJobLock) compares the latest two observations per
-- (apn, field) in the append-only parcel_observations log (migration 0121) for
-- parcels in a customer's pipeline (properties + leads). When a TRACKED field
--   (owner, owner_address, tax_status, tax_amount)
-- meaningfully changes AND clears the false-positive guard, the job writes ONE
-- immutable alert row here and emits the matching workflow trigger event
--   (parcel.owner_changed / parcel.tax_status_changed).
--
-- This turns the passive observation log into a PROACTIVE lead engine — the
-- exact owner-change / tax-delinquency signal land investors pay
-- PropStream/PropGrid for, derived FREE from county GIS we already crawl.
--
-- The customer-facing list ("Owner changed on a parcel in your pipeline")
-- renders from this table behind the Today door. Each row carries the
-- before/after values so the surface needs no recompute; dedupe_key makes the
-- detector idempotent so a re-run never double-fires for the same transition.
--
-- Indexes:
--   * (organization_id, created_at)            — LEADING-org composite
--     (shard-readiness, per scripts/check-org-leading-index.mjs); newest-first
--     read for the customer alert list.
--   * (organization_id, is_read, created_at)   — unread-first badge/count path.
--   * UNIQUE (organization_id, dedupe_key)     — idempotency for the detector.
--
-- Mirrors shared/schema.ts (parcelAlerts) + scripts/migrate.mjs STATEMENTS.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "parcel_alerts" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "apn" text NOT NULL,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "alert_type" text NOT NULL,
  "field" text NOT NULL,
  "previous_value" jsonb,
  "current_value" jsonb,
  "source" text,
  "confidence" real,
  "lead_id" integer,
  "property_id" integer,
  "dedupe_key" text NOT NULL,
  "is_read" boolean NOT NULL DEFAULT false,
  "read_at" timestamp,
  "observed_at" timestamp,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "parcel_alerts_org_created_idx"
  ON "parcel_alerts" ("organization_id", "created_at");
CREATE INDEX IF NOT EXISTS "parcel_alerts_org_unread_idx"
  ON "parcel_alerts" ("organization_id", "is_read", "created_at");
CREATE UNIQUE INDEX IF NOT EXISTS "parcel_alerts_org_dedupe_uk"
  ON "parcel_alerts" ("organization_id", "dedupe_key");
