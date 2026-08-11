-- 0230 — tracked_parcels (Wave 2.3: click-to-identify → "Track this parcel")
--
-- A parcel an org watches from the Map door before it is anything else: not
-- yet a property in inventory, not yet a lead, not yet a deal. One row per
-- (org, normalized state, normalized county, apn).
--
-- Idempotency is a DATABASE guarantee here, not a service convention: the
-- unique index below is what makes a double-tap a no-op, so the optimistic
-- client mutation can be honest about what it promises.
--
-- parcel_snapshot_id is NULLABLE on purpose — an org may track a parcel in a
-- county whose snapshot we do not hold yet, and the snapshot cache is
-- expiry-swept, so it is ON DELETE SET NULL: losing a cache row must never
-- silently drop what a customer chose to watch.

CREATE TABLE IF NOT EXISTS "tracked_parcels" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "state" text NOT NULL,
  "county" text NOT NULL,
  "apn" text NOT NULL,
  "parcel_snapshot_id" integer REFERENCES "parcel_snapshots"("id") ON DELETE SET NULL,
  "tracked_by_user_id" text,
  "note" text,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "tracked_parcels_org_parcel_key"
  ON "tracked_parcels" ("organization_id", "state", "county", "apn");

CREATE INDEX IF NOT EXISTS "tracked_parcels_org_created_idx"
  ON "tracked_parcels" ("organization_id", "created_at");
