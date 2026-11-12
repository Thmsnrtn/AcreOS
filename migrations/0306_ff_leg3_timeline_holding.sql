-- 0306 — Fix-and-Flip Leg 3: rehab timeline truth — kickoff baselines, the
-- status-transition log, and recorded holding-cost entries.
--
-- All three tables pre-named and approved 2026-11-09 (founder §9.3 approval,
-- recorded in docs/company/next-moves.md). Append-only: baselines are revised
-- by new rows that supersede, never by edits; transitions and holding entries
-- are facts, never edited.
--
-- UPDATE and TRUNCATE are refused by trigger; a DELETE is allowed only inside
-- the organization's ON DELETE CASCADE, so an organization stays erasable
-- while its timeline cannot be rewritten.
CREATE TABLE IF NOT EXISTS "rehab_baselines" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
  "supersedes_id" uuid REFERENCES "rehab_baselines"("id"),
  "planned_start_date" date,
  "planned_listing_date" date,
  "planned_hold_months" integer,
  "planned_holding_monthly_cents" bigint,
  "phase_plans" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "recorded_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "rehab_baselines_org_rehab_created_idx" ON "rehab_baselines" ("organization_id", "rehab_id", "created_at");

CREATE OR REPLACE FUNCTION rehab_baselines_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
      RAISE EXCEPTION 'rehab_baselines rows leave only with their organization (record a superseding baseline instead)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'rehab_baselines is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rehab_baselines_no_update ON "rehab_baselines";
CREATE TRIGGER rehab_baselines_no_update BEFORE UPDATE ON "rehab_baselines"
  FOR EACH ROW EXECUTE FUNCTION rehab_baselines_guard();
DROP TRIGGER IF EXISTS rehab_baselines_delete_with_org ON "rehab_baselines";
CREATE TRIGGER rehab_baselines_delete_with_org BEFORE DELETE ON "rehab_baselines"
  FOR EACH ROW EXECUTE FUNCTION rehab_baselines_guard();
DROP TRIGGER IF EXISTS rehab_baselines_no_truncate ON "rehab_baselines";
CREATE TRIGGER rehab_baselines_no_truncate BEFORE TRUNCATE ON "rehab_baselines"
  FOR EACH STATEMENT EXECUTE FUNCTION rehab_baselines_guard();

CREATE TABLE IF NOT EXISTS "rehab_status_transitions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
  "from_status" text,
  "to_status" text NOT NULL,
  "transitioned_at" timestamptz NOT NULL DEFAULT now(),
  "recorded_by" text
);
CREATE INDEX IF NOT EXISTS "rehab_status_transitions_org_rehab_at_idx" ON "rehab_status_transitions" ("organization_id", "rehab_id", "transitioned_at");

CREATE OR REPLACE FUNCTION rehab_status_transitions_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
      RAISE EXCEPTION 'rehab_status_transitions rows leave only with their organization (a transition is a fact, never rewritten)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'rehab_status_transitions is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rehab_status_transitions_no_update ON "rehab_status_transitions";
CREATE TRIGGER rehab_status_transitions_no_update BEFORE UPDATE ON "rehab_status_transitions"
  FOR EACH ROW EXECUTE FUNCTION rehab_status_transitions_guard();
DROP TRIGGER IF EXISTS rehab_status_transitions_delete_with_org ON "rehab_status_transitions";
CREATE TRIGGER rehab_status_transitions_delete_with_org BEFORE DELETE ON "rehab_status_transitions"
  FOR EACH ROW EXECUTE FUNCTION rehab_status_transitions_guard();
DROP TRIGGER IF EXISTS rehab_status_transitions_no_truncate ON "rehab_status_transitions";
CREATE TRIGGER rehab_status_transitions_no_truncate BEFORE TRUNCATE ON "rehab_status_transitions"
  FOR EACH STATEMENT EXECUTE FUNCTION rehab_status_transitions_guard();

CREATE TABLE IF NOT EXISTS "rehab_holding_cost_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
  "entry_date" date NOT NULL,
  "category" text NOT NULL CONSTRAINT "rehab_holding_cost_entries_category_check"
    CHECK ("category" IN ('taxes', 'insurance', 'utilities', 'interest', 'hoa', 'other')),
  "amount_cents" bigint NOT NULL CONSTRAINT "rehab_holding_cost_entries_amount_nonzero"
    CHECK ("amount_cents" <> 0),
  "note" text,
  "recorded_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "rehab_holding_cost_entries_org_rehab_date_idx" ON "rehab_holding_cost_entries" ("organization_id", "rehab_id", "entry_date");

CREATE OR REPLACE FUNCTION rehab_holding_cost_entries_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
      RAISE EXCEPTION 'rehab_holding_cost_entries rows leave only with their organization (record a correcting entry instead)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'rehab_holding_cost_entries is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rehab_holding_cost_entries_no_update ON "rehab_holding_cost_entries";
CREATE TRIGGER rehab_holding_cost_entries_no_update BEFORE UPDATE ON "rehab_holding_cost_entries"
  FOR EACH ROW EXECUTE FUNCTION rehab_holding_cost_entries_guard();
DROP TRIGGER IF EXISTS rehab_holding_cost_entries_delete_with_org ON "rehab_holding_cost_entries";
CREATE TRIGGER rehab_holding_cost_entries_delete_with_org BEFORE DELETE ON "rehab_holding_cost_entries"
  FOR EACH ROW EXECUTE FUNCTION rehab_holding_cost_entries_guard();
DROP TRIGGER IF EXISTS rehab_holding_cost_entries_no_truncate ON "rehab_holding_cost_entries";
CREATE TRIGGER rehab_holding_cost_entries_no_truncate BEFORE TRUNCATE ON "rehab_holding_cost_entries"
  FOR EACH STATEMENT EXECUTE FUNCTION rehab_holding_cost_entries_guard();
