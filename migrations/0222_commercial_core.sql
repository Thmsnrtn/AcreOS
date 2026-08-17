-- ============================================================================
-- 0222 — Commercial → core: the four records the commercial vertical lacked
--        (2026-08, Wave 4 Stage 1 — schema foundation)
-- ----------------------------------------------------------------------------
-- The buy-and-hold schema modelled a RESIDENTIAL lease: one tenant, one flat
-- monthly rent (rental_leases.monthly_rent_cents), a statutory-cap late fee. A
-- commercial lease is a different animal, and four of its core facts have no
-- home on rental_leases as rollup columns — because each is a HISTORY or a
-- frozen SNAPSHOT, not a current value:
--
--   • cam_expense_pools        — the operator's DEFINITION of a recoverable
--     expense pool for a property + period (which Schedule-E categories are
--     recoverable, the gross-up, the admin fee, caps). A definition that
--     outlives any one reconciliation → a record, not a column on a lease.
--   • cam_reconciliations      — the FROZEN year-end CAM true-up statement per
--     lease. A tenant billed a delta is owed the exact inputs behind it, and
--     recomputing on read would let a later pool edit silently rewrite a
--     statement already sent. Immutable snapshot → its own table.
--   • commercial_sales_reports — the tenant's reported gross sales per period,
--     the input to percentage rent. Auditable per-period HISTORY (a tenant
--     amends a prior quarter); a single "last sales" column cannot answer "what
--     did they report, from what source, and when".
--   • lease_rent_schedule      — the rent-escalation steps (fixed bumps, fixed
--     %, CPI with a collar). The rent for any month is COMPUTED from the
--     applicable step — not a single current rent, which cannot express "3%
--     every year, then CPI bounded 2%/6%".
--
-- ── ADDITIVE COLUMNS ON rental_leases ───────────────────────────────────────
-- Fifteen nullable commercial-term columns join the lease row (rentable area,
-- lease type, CAM pro-rata/estimate/base-year stop, percentage-rent terms,
-- commercial late-fee shape). Every one is NULL for every existing lease and
-- every residential lease — a residential SFR lease has no rentable-area
-- pro-rata and no per-diem late fee, so the PRESENCE of a value is the
-- commercial signal; a `commercial` boolean inferred from absence would be a
-- lie. No backfill.
--
-- ── rent_charges.charge_type + the widened month key ────────────────────────
-- rent_charges carried a UNIQUE (lease_id, charged_for_month): one charge per
-- lease-month. A commercial lease posts SIBLING charges in the same month —
-- base rent AND a percentage-rent overage AND a CAM true-up — so the key widens
-- to (lease_id, charged_for_month, charge_type). `charge_type` defaults to
-- 'base_rent', which is the only kind that existed before this change, so every
-- historical row carries it and the widened key is IDENTICAL for existing data:
-- no collision, no backfill. The widen is a DROP + re-CREATE of the same index
-- name, both guarded, so it is safe to re-run on every deploy.
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- None of these four tables holds, moves, collects or charges a cent.
-- cam_expense_pools is a DEFINITION; cam_reconciliations is a computed
-- STATEMENT; commercial_sales_reports RECORDS what a tenant reported;
-- lease_rent_schedule is a COMPUTABLE schedule. Every *_cents column is a
-- recorded or derived fact, never a balance and never an instruction to pay.
-- The actual rent/CAM charges land on the existing rent_charges ledger (now
-- charge_type-tagged), on the operator's OWN account, elsewhere.
--
-- ── NO BACKFILL ─────────────────────────────────────────────────────────────
-- There is no prior commercial data to migrate — this is the first store of its
-- kind. The four tables ship EMPTY and fill only from real operator entry in
-- later stages of this wave. Inventing seed rows would be exactly the
-- fabrication the schema exists to prevent.
--
-- ── STAGE 1 = SCHEMA + OPERATOR-ENTRY FOUNDATION ────────────────────────────
-- Stage 1 ships these four tables WITH their operator data-entry reader+writer
-- (CRUD in server/routes-rent-ledger.ts — each table has a real reader and a
-- real writer, so reachability's tables-no-reader/no-writer stay flat). What is
-- NOT here yet are the DERIVATION ENGINES: the CAM-reconciliation engine, the
-- percentage-rent engine and the escalation-aware rent computation are later
-- stages, and every engine-computed column ships null until its engine lands.
-- This migration is purely additive and idempotent.
--
-- ── FOUR new tables — scripts/ratchets/table-count.json 749 -> 753. ─────────
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command). Idempotent — every
-- statement is safe to re-run on every deploy.
-- ============================================================================

-- ── 1. cam_expense_pools — the recoverable-pool definition ──────────────────
CREATE TABLE IF NOT EXISTS "cam_expense_pools" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  -- 'cam' | 'property_tax' | 'insurance' | 'all_in'
  "pool_kind" text NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  -- The subset of PROPERTY_EXPENSE_CATEGORIES the operator ASSERTS is
  -- recoverable — recoverability is an explicit assertion, never inferred.
  "recoverable_categories" jsonb NOT NULL,
  -- The building's total rentable area — the DENOMINATOR of every lease's share.
  "total_rentable_sqft" integer,
  "admin_fee_bps" integer,
  "gross_up_pct" numeric,
  "cap_note" text,
  "exclusion_note" text,
  -- 'draft' | 'reconciling' | 'reconciled'
  "status" text NOT NULL DEFAULT 'draft',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING (L3 shard-readiness) + the dominant read: pools on a property, by period.
CREATE INDEX IF NOT EXISTS "cam_expense_pools_org_property_period_idx"
  ON "cam_expense_pools" ("organization_id", "property_id", "period_start");
-- One pool of a given kind per property per period.
CREATE UNIQUE INDEX IF NOT EXISTS "cam_expense_pools_org_property_kind_period_uk"
  ON "cam_expense_pools" ("organization_id", "property_id", "pool_kind", "period_start", "period_end");

-- ── `lease_id` corrected varchar → uuid, 2026-08-17 ─────────────────────────
-- The three tables below referenced "rental_leases"("id") with a varchar
-- column. `rental_leases.id` is created as uuid (scripts/migrate.mjs, the only
-- place that table is created anywhere in this repository), and Postgres
-- cannot implement a varchar → uuid foreign key. All three CREATE TABLEs
-- therefore failed with "foreign key constraint cannot be implemented".
--
-- Editing a numbered migration is normally wrong. It is correct here because
-- these three statements have never successfully executed on any database:
-- migrate.mjs does not run migrations/*.sql at all, and on a clean rebuild
-- this file aborts earlier still (rental_leases does not exist yet, since
-- nothing in migrations/ creates it). There is no applied history to preserve.
-- Verified against a real Postgres 16 rebuild before and after.
--
-- Pinned by tests/unit/migrateForeignKeyTypes.test.ts.

-- ── 2. cam_reconciliations — the frozen year-end CAM true-up statement ──────
-- FK to cam_expense_pools (above) — created after it so the reference resolves.
CREATE TABLE IF NOT EXISTS "cam_reconciliations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "pool_id" varchar NOT NULL REFERENCES "cam_expense_pools"("id") ON DELETE CASCADE,
  "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
  "period_start" date,
  "period_end" date,
  -- Frozen snapshot (all written once at generation, never recomputed on read).
  "pro_rata_bps_used" integer,
  "pro_rata_basis" text,
  "leased_sqft_used" integer,
  "total_rentable_sqft_used" integer,
  "pool_actual_cents" bigint,
  "by_category_cents" jsonb,
  "recoverable_share_cents" bigint,
  "estimated_billed_cents" bigint,
  "estimated_billed_basis" text,
  "delta_cents" bigint,
  "coverage_months" integer,
  "coverage_complete" boolean,
  "statement_markdown" text,
  "statement_version" text,
  "generated_at" timestamptz,
  "generated_by" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING + the dominant read: every lease's reconciliation for a pool.
CREATE INDEX IF NOT EXISTS "cam_reconciliations_org_pool_idx"
  ON "cam_reconciliations" ("organization_id", "pool_id");
-- One reconciliation per (pool, lease): re-generating a statement UPSERTs
-- rather than stacking duplicate true-ups.
CREATE UNIQUE INDEX IF NOT EXISTS "cam_reconciliations_pool_lease_uk"
  ON "cam_reconciliations" ("pool_id", "lease_id");

-- ── 3. commercial_sales_reports — the tenant's reported gross sales ─────────
CREATE TABLE IF NOT EXISTS "commercial_sales_reports" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "gross_sales_cents" bigint NOT NULL,
  "reported_by" text,
  -- 'tenant_statement' | 'operator_entered' | 'amended'
  "report_source" text,
  "received_at" timestamptz,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING + the dominant read: a lease's sales history, by period.
CREATE INDEX IF NOT EXISTS "commercial_sales_reports_org_lease_period_idx"
  ON "commercial_sales_reports" ("organization_id", "lease_id", "period_start");
-- One report per (lease, period): a re-report UPSERTs (an amendment) instead of
-- double-counting sales into percentage rent.
CREATE UNIQUE INDEX IF NOT EXISTS "commercial_sales_reports_lease_period_uk"
  ON "commercial_sales_reports" ("lease_id", "period_start", "period_end");

-- ── 4. lease_rent_schedule — the rent-escalation steps ──────────────────────
CREATE TABLE IF NOT EXISTS "lease_rent_schedule" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
  "effective_month" date NOT NULL,
  -- 'fixed_amount' | 'fixed_pct' | 'cpi'
  "step_type" text NOT NULL,
  "amount_cents" bigint,
  "pct_bps" integer,
  "cpi_index_base" numeric,
  "cpi_index_current" numeric,
  "cpi_index_name" text,
  "cpi_index_published_on" date,
  "floor_pct_bps" integer,
  "ceiling_pct_bps" integer,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING + the dominant read: a lease's steps in effective order.
CREATE INDEX IF NOT EXISTS "lease_rent_schedule_org_lease_month_idx"
  ON "lease_rent_schedule" ("organization_id", "lease_id", "effective_month");
-- One step per (lease, effective_month): the schedule is unambiguous at every point in time.
CREATE UNIQUE INDEX IF NOT EXISTS "lease_rent_schedule_lease_month_uk"
  ON "lease_rent_schedule" ("lease_id", "effective_month");

-- ── 5. rental_leases — fifteen nullable commercial-term columns ─────────────
-- All nullable, all null for existing/residential leases. No backfill.
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "rentable_sqft" integer;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "lease_type" text;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "cam_pro_rata_bps" integer;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "cam_estimate_monthly_cents" bigint;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "cam_base_year_stop_cents" bigint;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "pct_rent_bps" integer;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "pct_rent_breakpoint_type" text;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "pct_rent_artificial_breakpoint_cents" bigint;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "pct_rent_frequency" text;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_type" text;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_flat_cents" bigint;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_pct_bps" integer;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_grace_days" integer;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_max_cents" bigint;
ALTER TABLE "rental_leases" ADD COLUMN IF NOT EXISTS "late_fee_per_day_cents" bigint;

-- ── 6. rent_charges.charge_type + the widened month uniqueness ──────────────
ALTER TABLE "rent_charges" ADD COLUMN IF NOT EXISTS "charge_type" text NOT NULL DEFAULT 'base_rent';
-- Widen (lease_id, charged_for_month) -> (lease_id, charged_for_month, charge_type)
-- so a commercial lease's percentage_rent / cam / late_fee charge can coexist
-- with the same month's base_rent. Existing rows all carry 'base_rent', so the
-- widened key is identical for them. DROP + re-CREATE, both guarded.
DROP INDEX IF EXISTS "rent_charges_lease_month_uk";
CREATE UNIQUE INDEX IF NOT EXISTS "rent_charges_lease_month_uk"
  ON "rent_charges" ("lease_id", "charged_for_month", "charge_type");
