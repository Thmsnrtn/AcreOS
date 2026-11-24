-- ============================================================================
-- Devon Park (FF vertical) — hardening pass on the rehab+contractor stack.
-- ============================================================================
--
-- What this fixes
-- ───────────────
-- 1. The shared/schema.ts copies of rehab_line_items.rehab_id,
--    contractor_payments.rehab_id, construction_draws.rehab_id,
--    bid_estimates.rehab_id / contractor_id, and arv_calculations.rehab_id
--    were declared as soft (no .references()) FKs. Production already has
--    the hard FKs because scripts/migrate.mjs creates the tables with the
--    correct REFERENCES … ON DELETE … clauses (see migrate.mjs §775-947),
--    but any environment that bootstrapped from Drizzle alone is missing
--    them. That's the orphan-row vector for the 1099-NEC summation: if a
--    rehab is deleted, payment rows would persist with a dead rehab_id
--    and STILL be summed into a contractor's YTD total.
--
--    Lens 11 + Lens 20 both flagged this. We add IF NOT EXISTS-style
--    constraints in idempotent DO blocks so prod (where the constraints
--    already exist) is a no-op and dev (where they don't) gets healed.
--
-- 2. contractors.license_expires_at — column to mirror what insurance has.
--    Required so the daily expiry job can flag both license + insurance
--    in one sweep.
-- ============================================================================

-- ── license_expires_at on contractors ──────────────────────────────────────
ALTER TABLE contractors
  ADD COLUMN IF NOT EXISTS license_expires_at date;

-- ── Idempotent FK adds. Postgres has no ADD CONSTRAINT IF NOT EXISTS; we
--    consult pg_constraint by conname before each ALTER. Cascade policies
--    match scripts/migrate.mjs and Devon's instruction:
--      rehab_line_items.rehab_id      → CASCADE
--      contractor_payments.rehab_id   → SET NULL (payment outlives the rehab)
--      contractor_payments.contractor_id → CASCADE (already exists in prod)
--      construction_draws.rehab_id    → CASCADE
--      bid_estimates.rehab_id         → CASCADE
--      bid_estimates.contractor_id    → CASCADE
--      arv_calculations.rehab_id      → SET NULL
-- ───────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'rehab_line_items_rehab_id_fkey') THEN
    ALTER TABLE rehab_line_items
      ADD CONSTRAINT rehab_line_items_rehab_id_fkey
      FOREIGN KEY (rehab_id) REFERENCES rehabs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_payments_rehab_id_fkey') THEN
    -- First null out rehab_id values that no longer point at an existing rehab
    -- so the FK add succeeds even on drifted dev DBs with orphans.
    UPDATE contractor_payments cp
       SET rehab_id = NULL
     WHERE cp.rehab_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM rehabs r WHERE r.id = cp.rehab_id);

    ALTER TABLE contractor_payments
      ADD CONSTRAINT contractor_payments_rehab_id_fkey
      FOREIGN KEY (rehab_id) REFERENCES rehabs(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'contractor_payments_contractor_id_fkey') THEN
    ALTER TABLE contractor_payments
      ADD CONSTRAINT contractor_payments_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'construction_draws_rehab_id_fkey') THEN
    ALTER TABLE construction_draws
      ADD CONSTRAINT construction_draws_rehab_id_fkey
      FOREIGN KEY (rehab_id) REFERENCES rehabs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bid_estimates_rehab_id_fkey') THEN
    ALTER TABLE bid_estimates
      ADD CONSTRAINT bid_estimates_rehab_id_fkey
      FOREIGN KEY (rehab_id) REFERENCES rehabs(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bid_estimates_contractor_id_fkey') THEN
    ALTER TABLE bid_estimates
      ADD CONSTRAINT bid_estimates_contractor_id_fkey
      FOREIGN KEY (contractor_id) REFERENCES contractors(id) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'arv_calculations_rehab_id_fkey') THEN
    -- Same orphan-defang as above before the FK add.
    UPDATE arv_calculations ac
       SET rehab_id = NULL
     WHERE ac.rehab_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM rehabs r WHERE r.id = ac.rehab_id);

    ALTER TABLE arv_calculations
      ADD CONSTRAINT arv_calculations_rehab_id_fkey
      FOREIGN KEY (rehab_id) REFERENCES rehabs(id) ON DELETE SET NULL;
  END IF;
END$$;
