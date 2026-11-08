-- 0304 (renumbered from 0301 on 2026-11-08; #461 holds 0301) — Subdivision V1 Leg 1: subdivision_screen_runs (the buildability
-- screen's append-only run record). Founder decision 2026-11-05 (Tom): +1
-- table approved, the package §9.1 fence lifted for this table only.
-- APPEND-ONLY: UPDATE is refused in the database. DELETE is left to
-- organization erasure (the organization_id FK cascades; deleteOrganization
-- sweeps every organization_id table); no product path deletes a run.
-- parent_parcel_id is deliberately not a foreign key: a run survives its parcel.
CREATE TABLE IF NOT EXISTS "subdivision_screen_runs" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "parent_parcel_id" integer NOT NULL,
  "rule_version" text NOT NULL,
  "inputs" jsonb NOT NULL,
  "yield_estimate" jsonb NOT NULL,
  "result" jsonb NOT NULL,
  "triggered_count" integer NOT NULL,
  "not_determinable_count" integer NOT NULL,
  "actor_ref" text NOT NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "subdivision_screen_runs_org_parent_idx"
  ON "subdivision_screen_runs" ("organization_id", "parent_parcel_id", "created_at");

CREATE OR REPLACE FUNCTION subdivision_screen_runs_deny_update()
RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'subdivision_screen_runs is append-only (UPDATE denied) — re-run the screen to record a new run'
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS subdivision_screen_runs_no_update ON "subdivision_screen_runs";
CREATE TRIGGER subdivision_screen_runs_no_update
  BEFORE UPDATE ON "subdivision_screen_runs"
  FOR EACH ROW
  EXECUTE FUNCTION subdivision_screen_runs_deny_update();
