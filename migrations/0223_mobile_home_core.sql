-- ============================================================================
-- 0223 — Mobile-home core: the two home-side capabilities the lot-lease beta lacked
--        (2026-08, mobile_home Stage 0 — schema foundation)
-- ----------------------------------------------------------------------------
-- MOBILE_HOME shipped as a lot-lease beta: a pad is a rental_units row with
-- kind='pad', and the schema modelled a bare ground lease. Two home-side facts
-- of a real park have no home in that model, and each is the input to a Stage-1
-- engine (shared/rental/lotRentSplit.ts, shared/rental/utilityBillback.ts):
--
--   1. The lot-vs-home rent SPLIT + POH/TOH mix. A tenant who owns their home
--      (TOH — tenant-owned-home) rents only the ground; when the park owns the
--      home (POH — park-owned-home) the operator collects lot rent AND a home
--      rent. Modelled with additive NULLABLE columns:
--        • rental_units.home_ownership ('park_owned'|'tenant_owned') — the POH/TOH
--          discriminator, plus chattel-title RECORD columns (chattel_title_type
--          'dmv_vin'|'real_property', chattel_vin, chattel_title_status,
--          chattel_title_notes) that store WHAT THE OPERATOR ASSERTS and nothing
--          more — no DMV/registry verification, no lienholder assertion, no title
--          signing implied.
--        • rent_charges.rent_component ('lot'|'home') — the lot-vs-home
--          discriminator, ADDITIONAL to and orthogonal to charge_type from 0222
--          (a mobile-home lease bills a 'lot' charge AND a 'home' charge in one
--          month). Null for every existing row; presence is the split signal.
--
--   2. Utility PASS-THROUGH billback. A park buys a master utility and passes it
--      to the pads by SUBMETER (each pad metered) or RUBS (allocate the master
--      bill by a recorded basis). Two new tables:
--        • meter_reads    — a submeter reading per pad+utility+date (the raw
--          input; consumption = current − prior).
--        • utility_bills  — the FROZEN billback statement per pad+period+utility
--          (the exhibit behind a pad's proposed charge), snapshotted at
--          generation so a later read/master-bill edit can't rewrite a statement
--          already sent.
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- Nothing here holds, moves, collects or charges a cent. meter_reads records a
-- reading; utility_bills freezes a COMPUTED statement; the rent-split columns
-- record operator-supplied rents. Every *_cents column is a recorded or derived
-- fact, never a balance and never an instruction to pay — the actual charge
-- lands on the operator's OWN rails, elsewhere.
--
-- ── NO RESIDENTIAL COMPS ────────────────────────────────────────────────────
-- The conversion-trade delta the split engine reports compares the operator's
-- OWN recorded POH and TOH rents — never a submarket lot-rent comp. There is no
-- comps data plane here.
--
-- ── NO BACKFILL ─────────────────────────────────────────────────────────────
-- The columns are all nullable and null for every existing row; the two tables
-- ship EMPTY and fill only from real operator entry. Inventing a POH/TOH flag or
-- a seed reading would be exactly the fabrication the schema exists to prevent.
--
-- ── TWO new tables — scripts/ratchets/table-count.json 753 -> 755. ──────────
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command). Idempotent — every
-- statement is safe to re-run on every deploy.
-- ============================================================================

-- ── 1. rental_units — home_ownership (POH/TOH) + chattel-title RECORD columns ─
-- All nullable, all null for existing units. No backfill.
ALTER TABLE "rental_units" ADD COLUMN IF NOT EXISTS "home_ownership" text;
ALTER TABLE "rental_units" ADD COLUMN IF NOT EXISTS "chattel_title_type" text;
ALTER TABLE "rental_units" ADD COLUMN IF NOT EXISTS "chattel_vin" text;
ALTER TABLE "rental_units" ADD COLUMN IF NOT EXISTS "chattel_title_status" text;
ALTER TABLE "rental_units" ADD COLUMN IF NOT EXISTS "chattel_title_notes" text;

-- ── 2. rent_charges — rent_component ('lot'|'home'), additional to charge_type ─
ALTER TABLE "rent_charges" ADD COLUMN IF NOT EXISTS "rent_component" text;

-- ── 3. meter_reads — a submeter reading per pad + utility + date ─────────────
CREATE TABLE IF NOT EXISTS "meter_reads" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "unit_id" varchar NOT NULL REFERENCES "rental_units"("id") ON DELETE CASCADE,
  -- 'water' | 'sewer' | 'trash' | 'electric' | 'gas'
  "utility_kind" text NOT NULL,
  "read_on" date NOT NULL,
  "reading" numeric NOT NULL,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING (L3 shard-readiness) + the dominant read: a pad's reads, newest first.
CREATE INDEX IF NOT EXISTS "meter_reads_org_unit_read_idx"
  ON "meter_reads" ("organization_id", "unit_id", "read_on");
-- One reading per (pad, utility, date): a re-record UPSERTs (a correction).
CREATE UNIQUE INDEX IF NOT EXISTS "meter_reads_unit_utility_read_uk"
  ON "meter_reads" ("unit_id", "utility_kind", "read_on");

-- ── 4. utility_bills — the frozen billback statement per pad + period + utility ─
CREATE TABLE IF NOT EXISTS "utility_bills" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "unit_id" varchar REFERENCES "rental_units"("id") ON DELETE SET NULL,
  -- 'water' | 'sewer' | 'trash' | 'electric' | 'gas'
  "utility_kind" text NOT NULL,
  "period_start" date,
  "period_end" date,
  -- 'submeter' | 'rubs'
  "method" text NOT NULL,
  "master_bill_cents" bigint,
  "allocated_cents" bigint,
  -- RUBS basis: 'equal' | 'occupants' | 'sqft'; null for submeter.
  "basis" text,
  "coverage_complete" boolean,
  "statement_markdown" text,
  "generated_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING + the dominant read: this property's billbacks, by period.
CREATE INDEX IF NOT EXISTS "utility_bills_org_property_period_idx"
  ON "utility_bills" ("organization_id", "property_id", "period_start");
-- One frozen bill per (pad, utility, period): re-generating UPSERTs the snapshot
-- rather than double-billing a pad for the same utility-period.
CREATE UNIQUE INDEX IF NOT EXISTS "utility_bills_unit_utility_period_uk"
  ON "utility_bills" ("unit_id", "utility_kind", "period_start", "period_end");
