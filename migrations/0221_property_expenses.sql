-- ============================================================================
-- 0221 — Property expenses: the operating-cost ledger (2026-08, multifamily → core)
-- ----------------------------------------------------------------------------
-- Net operating income needs two axes and the product only had one. Rent (the
-- income axis) lived in the rent ledger; operating EXPENSE had no store at all.
-- So NOI was not computed, it was ASSUMED: the standing shortcut baked a flat
-- ~40%-of-rent expense guess into every projection ("NOI ≈ 60% of rent"). Under
-- that guess a building with a brand-new roof and one with a failing roof
-- produce the SAME NOI — the operator cannot see the very difference the product
-- exists to help them manage, and a cap rate or DSCR built on a guessed expense
-- ratio is a fabricated number wearing a plausible costume. This table closes
-- that gap: it is the LEDGER of what the operator actually spent, so NOI can be
-- built from recorded facts instead of a constant.
--
-- ── SCHEDULE-E SHAPE ────────────────────────────────────────────────────────
-- `category` is one of the fourteen IRS Schedule E (Form 1040) rental line
-- items enumerated in shared/rental/propertyExpense.ts
-- (PROPERTY_EXPENSE_CATEGORIES): advertising, cleaning_maintenance, repairs,
-- insurance, legal_professional, management_fees, commissions, supplies, taxes,
-- utilities, auto_travel, mortgage_interest, depreciation, other. That is the
-- vocabulary the operator already keeps their books in and files their taxes
-- from, so an expense entered here reconciles against their return rather than
-- becoming a fourth private taxonomy.
--
-- Two of those lines — mortgage_interest and depreciation — are stored for
-- Schedule-E COMPLETENESS but are NON-operating and must NEVER enter NOI.
-- mortgage_interest is a financing cost (NOI is defined above the capital stack
-- so a levered and an unlevered owner compute the same number); depreciation is
-- a non-cash tax allowance (no dollar leaves the account for it). The
-- `is_operating` flag carries that distinction, and it is derived SERVER-SIDE
-- from isOperatingCategory(category) at write time (server/routes-property-
-- expenses.ts) — never accepted from the client, so a financing cost cannot be
-- posted into the operating number. It is STORED rather than recomputed on read
-- so a later reclassification of a category cannot silently rewrite the
-- operating status of history.
--
-- ── THE DEDUP GUARD ─────────────────────────────────────────────────────────
-- A completed maintenance ticket carries an invoice
-- (maintenance_tickets.invoice_cents). Rolling those invoices into this ledger
-- is how a repair reaches NOI, and POST .../expenses/import-maintenance does it
-- in bulk. That roll-in has to be re-runnable without double-charging, so
-- `source` ('manual' | 'maintenance_invoice') and `source_ref` (the ticket id
-- for a rolled-in row) record provenance, and the PARTIAL UNIQUE index
--   (organization_id, source, source_ref) WHERE source_ref IS NOT NULL
-- makes a second roll-in of the same ticket lose the INSERT (onConflictDoNothing)
-- instead of posting the expense twice. It is PARTIAL on purpose: manual rows
-- carry a null source_ref and are deliberately UNconstrained — an operator may
-- legitimately enter two $80 supply runs in the same month, and only the
-- maintenance-derived rows need the guard.
--
-- ── NO BACKFILL ─────────────────────────────────────────────────────────────
-- There is no prior expense data anywhere in the repo to migrate — this is the
-- first store of its kind. Inventing seed rows (e.g. materialising the 40% guess
-- as fake expenses) would be exactly the fabrication this table exists to end,
-- so the table ships empty and fills only from real operator entry and the
-- maintenance roll-in. (The maintenance roll-in is an operator-invoked route,
-- not a migration step: only the operator can say which completed tickets belong
-- on the books.)
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- This is a LEDGER of money the operator ALREADY spent, on their own account,
-- elsewhere. Nothing here moves, holds, collects or charges a cent. `amount_cents`
-- is a recorded fact, not a balance and not an instruction to pay.
--
-- ── ONE new table — scripts/ratchets/table-count.json 748 -> 749. ───────────
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command). Idempotent — every
-- statement is safe to re-run on every deploy.
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "property_expenses" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  -- Unit-level attribution when it exists (a repair in 3B) vs building-level
  -- (the master insurance policy). ON DELETE SET NULL: retiring a unit must not
  -- delete the money already spent on it — the expense outlives the slot.
  "unit_id" varchar REFERENCES "rental_units"("id") ON DELETE SET NULL,
  "category" text NOT NULL,
  "amount_cents" bigint NOT NULL,
  -- The month bucket key. A date, not a timestamp: the operator knows the day
  -- they spent it, not a clock time, and inventing a time is a fabricated
  -- precision.
  "incurred_on" date NOT NULL,
  -- Derived server-side from isOperatingCategory(category); false only for
  -- mortgage_interest and depreciation. Never client-set.
  "is_operating" boolean NOT NULL DEFAULT true,
  "source" text NOT NULL DEFAULT 'manual',
  "source_ref" varchar,
  "description" text,
  "vendor" text,
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- Org-LEADING is mandatory (L3 shard-readiness,
-- scripts/check-org-leading-index.mjs). This one matches the dominant read:
-- "every expense on this property, by month" — the NOI build and the property
-- P&L.
CREATE INDEX IF NOT EXISTS "property_expenses_org_property_month_idx"
  ON "property_expenses" ("organization_id", "property_id", "incurred_on");

-- The org-wide monthly read: "everything I spent across the portfolio this
-- month".
CREATE INDEX IF NOT EXISTS "property_expenses_org_month_idx"
  ON "property_expenses" ("organization_id", "incurred_on");

-- The maintenance roll-in dedup guard. PARTIAL so it binds ONLY rolled-in rows
-- (source_ref IS NOT NULL): a re-run of import-maintenance loses the INSERT via
-- ON CONFLICT DO NOTHING instead of posting a repair twice, while manual rows
-- (null source_ref) stay unconstrained — two like-amounts in a month are a real
-- thing an operator enters.
CREATE UNIQUE INDEX IF NOT EXISTS "property_expenses_org_source_ref_uk"
  ON "property_expenses" ("organization_id", "source", "source_ref")
  WHERE "source_ref" IS NOT NULL;
