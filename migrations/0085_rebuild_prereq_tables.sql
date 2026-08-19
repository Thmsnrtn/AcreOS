-- One-pass rebuild prerequisites — 2026-08-18
--
-- WHY THIS FILE EXISTS
-- --------------------
-- The DR runbook (docs/reliability/dr-runbook-postgres-restore.md) required
-- TWO passes of `migrations/*.sql` + `scripts/migrate.mjs` to stand the schema
-- up from source, and documented the reason as a circular dependency between
-- the two halves.
--
-- Measured against PostgreSQL 16 on 2026-08-18, the cycle is exactly TWO
-- TABLES wide, not the broad circularity the note implied:
--
--   pass 1 + migrate.mjs -> 755 tables, 44 statements skipped
--   pass 2 + migrate.mjs -> 757 tables,  2 statements skipped
--   tables ONLY the second pass creates: earnest_money_events, rehab_photos
--
-- and each of those two has a single unmet edge:
--
--   0086_earnest_money_events.sql  REFERENCES earnest_money_holds(id)
--   0089_rehab_photos.sql          REFERENCES rehabs(id)
--                                  AND rehab_line_items(id)
--
-- (The rehab_line_items edge only became visible after the rehabs edge was
-- closed — the first ERROR in a file masks the ones behind it. Measured, not
-- reasoned about: adding rehabs alone moved the count 755 -> 756 and left
-- rehab_photos still absent.)
--
-- Both parent tables are created by `scripts/migrate.mjs`, which runs AFTER
-- the SQL files — so on a first pass the children have no parent to point at,
-- and everything migrate.mjs then wants to hang off the children (the EMD
-- append-only trigger, the rehab photo indexes) skips in turn.
--
-- Creating the two parents here, numbered before their dependants, closes the
-- cycle. Both definitions are copied VERBATIM from scripts/migrate.mjs
-- (earnest_money_holds ~line 703, rehabs ~line 1012) and both sides use
-- CREATE TABLE IF NOT EXISTS, so whichever runs first wins and the other is a
-- no-op. `migrationDefinitionParity.test.ts` pins the two definitions against
-- each other so they cannot drift apart silently.
--
-- Numbered 0085 rather than appended at the end deliberately: an ordering fix
-- has to sort before what it unblocks, and 0085 is the last free slot before
-- 0086.

CREATE TABLE IF NOT EXISTS "earnest_money_holds" (
   "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
   "deal_id" integer,
   "property_id" integer REFERENCES "properties"("id") ON DELETE SET NULL,
   "amount_cents" bigint NOT NULL,
   "title_company" text,
   "reference_number" text,
   "deposited_at" date NOT NULL,
   "inspection_period_days" integer NOT NULL DEFAULT 7,
   "refundable_until_at" date NOT NULL,
   "status" text NOT NULL DEFAULT 'pending',
   "status_changed_at" timestamptz,
   "final_disposition_amount_cents" bigint,
   "notes" text,
   "created_at" timestamptz NOT NULL DEFAULT now(),
   "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "rehabs" (
   "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
   "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
   "name" text NOT NULL,
   "status" text NOT NULL DEFAULT 'planning',
   "started_at" date,
   "planned_listing_date" date,
   "actual_listing_date" date,
   "closed_at" date,
   "purchase_price_cents" bigint,
   "purchase_closing_cents" bigint,
   "budget_total_cents" bigint,
   "spent_total_cents" bigint NOT NULL DEFAULT 0,
   "holding_cost_monthly_cents" bigint,
   "arv_cents" bigint,
   "target_margin_cents" bigint,
   "lender_name" text,
   "lender_loan_cents" bigint,
   "lender_rate_bps" integer,
   "notes" text,
   "created_at" timestamptz NOT NULL DEFAULT now(),
   "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "rehab_line_items" (
   "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
   "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
   "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
   "sequence" integer NOT NULL DEFAULT 0,
   "category" text NOT NULL,
   "scope" text NOT NULL,
   "contractor_id" uuid,
   "budget_cents" bigint NOT NULL DEFAULT 0,
   "committed_cents" bigint NOT NULL DEFAULT 0,
   "spent_cents" bigint NOT NULL DEFAULT 0,
   "started_at" date,
   "completed_at" date,
   "photo_count" integer NOT NULL DEFAULT 0,
   "notes" text,
   "created_at" timestamptz NOT NULL DEFAULT now(),
   "updated_at" timestamptz NOT NULL DEFAULT now()
);
