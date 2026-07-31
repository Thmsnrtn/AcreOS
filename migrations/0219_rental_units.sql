-- ============================================================================
-- 0219 — Rental units: the rentable slot becomes a row (2026-07-31)
-- ----------------------------------------------------------------------------
-- The buy-and-hold vertical modelled a unit as `rental_leases.unit_label` — a
-- free-text string on a LEASE — and nothing else. There is no units table
-- anywhere in the repo. That means a unit only exists once somebody has
-- leased it, and three real, verified defects follow directly from it:
--
--   1. VACANCY IS INVISIBLE. GET /api/rent-roll/occupancy
--      (server/routes-rentals.ts) divides distinct
--      (property_id, COALESCE(unit_label,'')) pairs holding an ACTIVE lease by
--      the same set of pairs that have EVER held a lease. A unit nobody has
--      rented yet contributes 0 to the numerator AND 0 to the denominator, so
--      a half-empty building reports 100% occupied. The single number a
--      landlord opens the rent roll to check was structurally incapable of
--      showing the condition it exists to show.
--
--   2. THE RENT-ROLL IMPORTER THREW VACANCIES AWAY. server/routes-rent-roll-
--      import.ts does `if (u.isVacant) continue;`. It is handed the building's
--      complete unit list and discards exactly the rows the landlord most
--      needs — not out of carelessness, but because there was nowhere to put a
--      unit that has no lease.
--
--   3. A STATUTORY LATE-FEE CAP RODE ON A GUESS. Tex. Prop. Code §92.019 sets
--      a different cap at 4+ units, and `knownUnitCountFloor`
--      (server/routes-rent-ledger.ts) says so in its own comment: "`properties`
--      has no unit_count column, so the only ground truth we hold is the number
--      of DISTINCT units this org has ever put on a lease at the property — a
--      floor on the true count." proposeLateFee therefore computes BOTH
--      branches and charges the LOWER, deliberately under-charging rather than
--      risk an unlawful fee against a tenant. A floor is not a count.
--
-- ── ONE new table. There is deliberately NO `rental_buildings`. ─────────────
-- `properties` already IS the building: one row per parcel, carrying
-- `square_feet` and a `structure_type` whose own comment enumerates sfr,
-- duplex, triplex, fourplex, condo, townhouse, commercial, mixed_use,
-- vacant_land. A second building table would restate all of that and begin
-- drifting from it the same week, against this repo's stated north star of a
-- SMALLER schema (scripts/ratchets/table-count.json). A unit belongs to a
-- property; the property is the building. Do not add the second table.
--
-- `kind` (unit | pad | suite) is the discriminator that keeps this to one
-- table: a mobile-home park's rentable slot is a PAD (the tenant owns the
-- home and rents the ground), a commercial centre's is a SUITE. Three tables
-- for three words would drift on every column they share.
--
-- `status` (active | offline | retired) exists so the two occupancy
-- denominators stay separable. An `offline` unit — fire damage, mid-renovation
-- — belongs in "units I own" and must NOT sit in "units I could have leased".
-- Conflating those is how an occupancy number starts lying in both directions:
-- a construction schedule reads as a leasing failure, or a genuinely empty
-- unit gets quietly excused.
--
-- `market_rent_cents` is the ASKING rent, independent of what a sitting tenant
-- pays. It is what makes loss-to-lease (asking minus in-place) and the dollar
-- cost of a vacant day computable — the number a multifamily operator actually
-- manages to. With rent living only on leases, an empty unit has no rent at
-- all and the cost of it sitting empty is literally unrepresentable.
--
-- ── THIS ONE DOES GET A BACKFILL, and why that is safe ──────────────────────
-- 0218 shipped NO backfill on purpose, because inferring "which period was
-- satisfied" from a payment date would have been INVENTING A FACT the ledger
-- does not hold. Nothing of the sort happens here. This backfill COPIES A
-- LABEL THAT IS ALREADY ON THE ROW: `rental_leases.unit_label` is the
-- operator's own string, already stored, already displayed, already the de
-- facto unit identity. Moving it to a row it can be keyed by adds no claim.
--
-- Three steps:
--   (a) one `rental_units` row per distinct
--       (organization_id, property_id, COALESCE(unit_label, '')) appearing on
--       any lease;
--   (b) an SFR lease (NULL or empty unit_label) gets the label
--       'Whole property'. Giving the whole-property tenancy a real unit row
--       means occupancy math is UNIFORM across SFR and multi-unit instead of
--       forking on null — which is the shape that produced defect (1);
--   (c) `rental_leases.unit_id` is then set by matching back on
--       (organization_id, property_id, label).
--
-- What it deliberately does NOT do: invent units that have never been leased.
-- Those are exactly the vacancies the product could not see, and this
-- migration cannot know they exist — only the operator or the rent-roll
-- importer can add them. The backfill makes the table TRUE about what we
-- already knew; it does not pretend to know more.
--
-- Idempotent throughout: the insert is guarded by ON CONFLICT DO NOTHING
-- against `rental_units_org_property_label_uk`, and the UPDATE only touches
-- leases whose `unit_id` is still NULL. Re-running changes nothing.
--
-- `rental_leases.unit_label` STAYS. It is read in 20+ places including raw SQL
-- in two route files, so dropping it in the same change that adds `unit_id`
-- would break pages nobody thought to test. It is now a denormalised display
-- copy; retiring it is a later, separate slice once every reader joins.
--
-- MONEY POSTURE (founder ruling #15): `market_rent_cents` is a QUOTE, not a
-- balance. Nothing here moves, holds, collects or charges money.
--
-- ONE new table — scripts/ratchets/table-count.json 754 -> 755.
--
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command).
-- ============================================================================

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rental_units" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "kind" text NOT NULL DEFAULT 'unit',
  "bedrooms" integer,
  "bathrooms" numeric(3,1),
  "square_feet" integer,
  "market_rent_cents" bigint,
  "status" text NOT NULL DEFAULT 'active',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

-- ── 2. Indexes ──────────────────────────────────────────────────────────────
-- A label identifies a unit within its building. This unique index IS the
-- idempotency guard for both the rent-roll importer and step 4 below: a re-run
-- loses the INSERT instead of creating a duplicate "3B" that would then be
-- double-counted in every occupancy denominator.
CREATE UNIQUE INDEX IF NOT EXISTS "rental_units_org_property_label_uk"
  ON "rental_units" ("organization_id", "property_id", "label");

-- Org-LEADING is mandatory (L3 shard-readiness,
-- scripts/check-org-leading-index.mjs) and matches the dominant read: "every
-- unit at this property" — the rent roll, the occupancy math, and the §92.019
-- unit count.
CREATE INDEX IF NOT EXISTS "rental_units_org_property_idx"
  ON "rental_units" ("organization_id", "property_id");

-- ── 3. The lease → unit join ────────────────────────────────────────────────
-- ON DELETE SET NULL, not CASCADE: a lease can outlive its unit row (units get
-- combined, buildings get re-platted) and losing the LEASE would be far worse
-- than losing the link.
ALTER TABLE "rental_leases"
  ADD COLUMN IF NOT EXISTS "unit_id" varchar REFERENCES "rental_units"("id") ON DELETE SET NULL;

-- ── 4. Backfill (a)+(b): a unit row per distinct label already on a lease ────
INSERT INTO "rental_units" ("organization_id", "property_id", "label")
SELECT DISTINCT
  l."organization_id",
  l."property_id",
  CASE
    WHEN COALESCE(NULLIF(TRIM(l."unit_label"), ''), '') = '' THEN 'Whole property'
    ELSE TRIM(l."unit_label")
  END AS label
FROM "rental_leases" l
WHERE l."organization_id" IS NOT NULL
  AND l."property_id" IS NOT NULL
ON CONFLICT ("organization_id", "property_id", "label") DO NOTHING;

-- ── 5. Backfill (c): point each lease at its unit ───────────────────────────
-- Only rows still NULL, so a re-run is a no-op and any unit_id an operator has
-- since corrected by hand is never overwritten.
UPDATE "rental_leases" l
SET "unit_id" = u."id"
FROM "rental_units" u
WHERE l."unit_id" IS NULL
  AND u."organization_id" = l."organization_id"
  AND u."property_id" = l."property_id"
  AND u."label" = CASE
    WHEN COALESCE(NULLIF(TRIM(l."unit_label"), ''), '') = '' THEN 'Whole property'
    ELSE TRIM(l."unit_label")
  END;
