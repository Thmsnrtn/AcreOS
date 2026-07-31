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
--       (organization_id, property_id, TRIM(unit_label)) appearing on any
--       lease with a non-blank label;
--   (b) an SFR lease (NULL or empty unit_label) gets a whole-property label —
--       normally the literal 'Whole property'. Giving the whole-property
--       tenancy a real unit row means occupancy math is UNIFORM across SFR
--       and multi-unit instead of forking on null — which is the shape that
--       produced defect (1). Every blank-label lease at one property shares
--       that one row, which is intended: a '' label and a NULL label are the
--       same tenancy shape, not two rentable slots;
--   (c) `rental_leases.unit_id` is then set by matching back on
--       (organization_id, property_id, label).
--
-- ── (b) AND THE COLLISION: 'Whole property' is a string a human can type ────
-- 'Whole property' is not a reserved token — an operator really can have typed
-- it into `unit_label`. If a property has BOTH a blank-label lease and a lease
-- genuinely labelled 'Whole property', naively folding the blank one onto that
-- literal merges two distinct tenancies into one unit row and UNDERSTATES the
-- unit count — the same class of quiet undercount this migration exists to
-- kill, and it would ride straight into the §92.019 4+-unit late-fee branch.
--
-- DECISION: keep the human-readable literal, DETECT the collision, and
-- disambiguate. Step (b) picks the FIRST candidate label not already typed by
-- the operator at that property: 'Whole property', then 'Whole property (2)',
-- '(3)' … '(99)', then — only if an operator has somehow typed all 100 — a
-- uuid-suffixed label that cannot collide. The alternative (a sentinel no
-- human would type, e.g. a control character or a uuid) was rejected because
-- `label` is not an internal key: it is the operator's own vocabulary, shown
-- on the rent roll, the ledger row and the work order, and a slot the landlord
-- cannot read is its own defect. Disambiguation is per (organization_id,
-- property_id), so the common case is untouched and reads 'Whole property'.
--
-- What it deliberately does NOT do: invent units that have never been leased.
-- Those are exactly the vacancies the product could not see, and this
-- migration cannot know they exist — only the operator or the rent-roll
-- importer can add them. The backfill makes the table TRUE about what we
-- already knew; it does not pretend to know more.
--
-- ── WHY THE BACKFILL IS A ONE-SHOT AND NOT "IDEMPOTENT" ────────────────────
-- This is the part nobody should simplify back. `scripts/migrate.mjs` — the
-- migrator that ACTUALLY runs on deploy, as the Fly release_command — is not
-- tracked: it has no applied-migrations table and executes every statement in
-- its array on EVERY deploy. So "idempotent" here does not mean "runs once",
-- it means "runs again next Tuesday, and the Tuesday after that".
--
-- The earlier version of this backfill was guarded only by ON CONFLICT DO
-- NOTHING on (org, property, label) plus `WHERE unit_id IS NULL`. Under
-- re-run-every-deploy that is not a guard, and two ordinary operator actions
-- break it:
--
--   FAILURE 1 — PHANTOM DUPLICATE UNIT. An operator renames a unit's label
--   from '3B' to 'Unit 3B' (a rename is a normal correction). The lease still
--   carries `unit_label = '3B'`, because `unit_label` is now a denormalised
--   display copy. On the next deploy the INSERT derives '3B' from the lease,
--   finds NO conflicting row (the real row now says 'Unit 3B'), and creates a
--   SECOND unit at that property. Both sit in `rental_units` forever, and
--   every occupancy denominator — and the §92.019 unit count — is inflated by
--   one, permanently, with no error anywhere.
--
--   FAILURE 2 — RESURRECTED DELETED UNIT. An operator DELETES a unit. Its
--   leases go to `unit_id = NULL` by the ON DELETE SET NULL below — which is
--   exactly the state the UPDATE looks for. On the next deploy the INSERT
--   re-creates the unit from the lease's surviving `unit_label` and the UPDATE
--   re-links the leases to it. The operator's deletion is silently undone by a
--   deploy they had nothing to do with.
--
-- The route layer narrows both — PATCH /api/rentals/units/:id now syncs
-- `rental_leases.unit_label` on a rename, and DELETE refuses while the unit
-- still has leases attached (server/routes-rentals.ts). Neither closes the
-- hole, and a migrator must not lean on either: a label corrected by any path
-- that does not sync (a direct SQL fix, a restore, a future writer) reproduces
-- FAILURE 1 exactly, and a lease already unlinked from its unit still carries
-- its old `unit_label`, so deleting that now-lease-free unit passes the
-- refusal check and reproduces FAILURE 2 exactly. This file runs against the
-- DATABASE, not the API, and it does not get to assume route code it does not
-- own.
--
-- Neither is fixable by tightening ON CONFLICT: in both cases the conflicting
-- row genuinely is not there. The backfill has to run ONCE, so it is wrapped
-- in a DO block with two guards, and both are checked and set inside that one
-- statement (one implicit transaction — it cannot half-apply):
--
--   GUARD 1 (the marker) — a token in the `rental_units` table comment,
--   '[0219-backfill:done]'. Present ⇒ return immediately. It is written by
--   this block itself, in the same transaction as the rows, so the marker and
--   the data land together or neither does. A table comment is used rather
--   than a marker table because this change is allowed exactly ONE new table
--   (scripts/ratchets/table-count.json) and a bookkeeping table is not the one
--   worth spending it on.
--
--   GUARD 2 (virgin table) — the block refuses to run if `rental_units` holds
--   ANY row, and stamps the marker on its way out. This covers a database
--   where the table was populated by the app or the rent-roll importer before
--   this block first ran, and it means neither failure above is reachable:
--   both require an existing unit row, and an existing unit row closes the
--   guard.
--
-- The UPDATE is inside the same one-shot block deliberately. Left outside it
-- would re-link on every deploy any lease an operator had deliberately
-- unlinked from its unit — a third quiet resurrection.
--
-- The ON CONFLICT DO NOTHING on the INSERT stays, but it is now a redundant
-- assertion (the table is provably empty when the INSERT runs), NOT the guard.
-- Do not delete the DO block and keep the ON CONFLICT: that is precisely the
-- shape this comment exists to stop coming back.
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
-- idempotency guard for the rent-roll importer and the find-or-create path in
-- server/routes-rentals.ts: a re-import loses the INSERT instead of creating a
-- duplicate "3B" that would then be double-counted in every occupancy
-- denominator. It is NOT what makes step 4's backfill safe — a renamed or
-- deleted unit produces no conflict at all, which is why step 4 is a one-shot
-- DO block. See the "WHY THE BACKFILL IS A ONE-SHOT" note above.
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

-- ── 4. Backfill (a)+(b)+(c), ONE SHOT ───────────────────────────────────────
-- Read the "WHY THE BACKFILL IS A ONE-SHOT" block at the top before touching
-- this. Short version: migrate.mjs re-runs every statement on every deploy, so
-- ON CONFLICT DO NOTHING is not a guard — a renamed unit produces a phantom
-- duplicate that inflates every occupancy denominator forever, and a deleted
-- unit gets resurrected and re-linked. Both need the block to run only once.
DO $backfill_0219$
DECLARE
  -- Substring searched for in the table comment. No LIKE metacharacters.
  v_marker    CONSTANT text := '[0219-backfill:done]';
  v_comment   CONSTANT text :=
    'Rentable slots: one row per unit / pad / suite at a property. '
    || 'A unit exists whether or not anyone has leased it — that is the point '
    || 'of the table (see migrations/0219_rental_units.sql). '
    || 'The token below records that the 0219 lease-label backfill has already '
    || 'run; it MUST survive, or a redeploy will re-run a one-shot backfill. '
    || v_marker;
  v_units     integer := 0;
  v_leases    integer := 0;
BEGIN
  -- GUARD 1: the marker this block writes for itself.
  IF COALESCE(obj_description('public.rental_units'::regclass, 'pg_class'), '')
       LIKE '%' || v_marker || '%' THEN
    RAISE NOTICE '0219 backfill: marker present — already applied, skipping';
    RETURN;
  END IF;

  -- GUARD 2: only a virgin table can be backfilled. Any existing row means a
  -- human or the importer owns this data now; stamp the marker and stand down.
  IF EXISTS (SELECT 1 FROM "rental_units") THEN
    EXECUTE format('COMMENT ON TABLE public."rental_units" IS %L', v_comment);
    RAISE NOTICE '0219 backfill: rental_units is non-empty — NOT backfilling; marker set';
    RETURN;
  END IF;

  -- (b) The whole-property label per (org, property), collision-aware.
  -- `candidates` is tried in order and the first one the operator has NOT
  -- already typed at that property wins, so a genuine 'Whole property' lease
  -- never absorbs the blank-label tenancy.
  DROP TABLE IF EXISTS pg_temp."_0219_whole_label";
  CREATE TEMP TABLE "_0219_whole_label" ON COMMIT DROP AS
  WITH typed AS (
    SELECT DISTINCT
      l."organization_id" AS org,
      l."property_id"     AS prop,
      TRIM(l."unit_label") AS label
    FROM "rental_leases" l
    WHERE l."organization_id" IS NOT NULL
      AND l."property_id" IS NOT NULL
      AND NULLIF(TRIM(l."unit_label"), '') IS NOT NULL
  ),
  blank AS (
    SELECT DISTINCT
      l."organization_id" AS org,
      l."property_id"     AS prop
    FROM "rental_leases" l
    WHERE l."organization_id" IS NOT NULL
      AND l."property_id" IS NOT NULL
      AND NULLIF(TRIM(l."unit_label"), '') IS NULL
  ),
  candidates AS (
    SELECT 'Whole property' AS label, 0 AS ord
    UNION ALL
    SELECT 'Whole property (' || s.n || ')', s.n FROM generate_series(2, 99) AS s(n)
  )
  SELECT
    b.org,
    b.prop,
    COALESCE(
      (SELECT c.label
         FROM candidates c
        WHERE NOT EXISTS (
                SELECT 1 FROM typed t
                 WHERE t.org = b.org AND t.prop = b.prop AND t.label = c.label)
        ORDER BY c.ord
        LIMIT 1),
      -- 100 typed collisions at one property is not a real world we plan for,
      -- but a NOT NULL column may never receive a NULL. Cannot collide.
      'Whole property (' || gen_random_uuid()::text || ')'
    ) AS label
  FROM blank b;

  -- (a) + (b): one row per distinct label already on a lease. ON CONFLICT is a
  -- redundant assertion here, not the guard — guard 2 proved the table empty.
  INSERT INTO "rental_units" ("organization_id", "property_id", "label")
  SELECT src.org, src.prop, src.label
  FROM (
    SELECT DISTINCT
      l."organization_id" AS org, l."property_id" AS prop, TRIM(l."unit_label") AS label
    FROM "rental_leases" l
    WHERE l."organization_id" IS NOT NULL
      AND l."property_id" IS NOT NULL
      AND NULLIF(TRIM(l."unit_label"), '') IS NOT NULL
    UNION
    SELECT w.org, w.prop, w.label FROM "_0219_whole_label" w
  ) src
  ON CONFLICT ("organization_id", "property_id", "label") DO NOTHING;
  GET DIAGNOSTICS v_units = ROW_COUNT;

  -- (c) Point each lease at its unit, using the SAME derived label as (b).
  UPDATE "rental_leases" l
  SET "unit_id" = u."id"
  FROM "rental_units" u
  WHERE l."unit_id" IS NULL
    AND u."organization_id" = l."organization_id"
    AND u."property_id"     = l."property_id"
    AND u."label" = COALESCE(
          NULLIF(TRIM(l."unit_label"), ''),
          (SELECT w.label FROM "_0219_whole_label" w
            WHERE w.org = l."organization_id" AND w.prop = l."property_id")
        );
  GET DIAGNOSTICS v_leases = ROW_COUNT;

  -- Same transaction as the rows above: marker and data land together.
  EXECUTE format('COMMENT ON TABLE public."rental_units" IS %L', v_comment);
  RAISE NOTICE '0219 backfill: created % unit row(s), linked % lease(s)', v_units, v_leases;
END
$backfill_0219$;
