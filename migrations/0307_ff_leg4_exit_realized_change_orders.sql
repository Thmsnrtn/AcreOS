-- 0307 — Fix-and-Flip Leg 4: change orders (§4.2) and realized economics (§6.2).
--
--   §4.2  rehab_change_orders — a priced change to a line item's scope,
--         proposed and then decided (approved / rejected).
--   §6.2  the realized-economics columns on "rehabs" — what the exit actually
--         produced (sale price, selling costs, closing date, who recorded it
--         and when). All nullable; no table added.
--
-- The new table was pre-named and approved 2026-11-09 (founder §9.3 approval,
-- recorded in docs/company/next-moves.md). 0307 is a PROVISIONAL number —
-- renumbered at merge if another migration lands first.
--
-- A change order is a fact once recorded. The guard permits exactly ONE
-- UPDATE shape: the decision (OLD.status = 'proposed' → 'approved'/'rejected',
-- decided_by and decided_at stamped, every other column unchanged). Any other
-- UPDATE and TRUNCATE are refused; a DELETE is allowed only inside the
-- organization's ON DELETE CASCADE, so an organization stays erasable.
CREATE TABLE IF NOT EXISTS "rehab_change_orders" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
  "line_item_id" uuid NOT NULL REFERENCES "rehab_line_items"("id") ON DELETE CASCADE,
  "description" text NOT NULL,
  "amount_cents" bigint NOT NULL CONSTRAINT "rehab_change_orders_amount_nonzero"
    CHECK ("amount_cents" <> 0),
  "schedule_impact_days" integer NOT NULL DEFAULT 0,
  "status" text NOT NULL DEFAULT 'proposed' CONSTRAINT "rehab_change_orders_status_check"
    CHECK ("status" IN ('proposed', 'approved', 'rejected')),
  "decided_by" text,
  "decided_at" timestamptz,
  "recorded_by" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "rehab_change_orders_org_rehab_created_idx" ON "rehab_change_orders" ("organization_id", "rehab_id", "created_at");
CREATE INDEX IF NOT EXISTS "rehab_change_orders_org_line_item_idx" ON "rehab_change_orders" ("organization_id", "line_item_id");

CREATE OR REPLACE FUNCTION rehab_change_orders_guard()
RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF EXISTS (SELECT 1 FROM "organizations" WHERE "id" = OLD."organization_id") THEN
      RAISE EXCEPTION 'rehab_change_orders rows leave only with their organization (a change order is a fact, never deleted)'
        USING ERRCODE = 'foreign_key_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF OLD."status" = 'proposed'
       AND NEW."status" IN ('approved', 'rejected')
       AND NEW."decided_by" IS NOT NULL
       AND NEW."decided_at" IS NOT NULL
       AND NEW."id" IS NOT DISTINCT FROM OLD."id"
       AND NEW."organization_id" IS NOT DISTINCT FROM OLD."organization_id"
       AND NEW."rehab_id" IS NOT DISTINCT FROM OLD."rehab_id"
       AND NEW."line_item_id" IS NOT DISTINCT FROM OLD."line_item_id"
       AND NEW."description" IS NOT DISTINCT FROM OLD."description"
       AND NEW."amount_cents" IS NOT DISTINCT FROM OLD."amount_cents"
       AND NEW."schedule_impact_days" IS NOT DISTINCT FROM OLD."schedule_impact_days"
       AND NEW."recorded_by" IS NOT DISTINCT FROM OLD."recorded_by"
       AND NEW."created_at" IS NOT DISTINCT FROM OLD."created_at" THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'rehab_change_orders permits only the decision update (proposed to approved/rejected, decided_by and decided_at set, nothing else changed)'
      USING ERRCODE = 'restrict_violation';
  END IF;
  RAISE EXCEPTION 'rehab_change_orders is append-only (% denied)', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS rehab_change_orders_no_update ON "rehab_change_orders";
CREATE TRIGGER rehab_change_orders_no_update BEFORE UPDATE ON "rehab_change_orders"
  FOR EACH ROW EXECUTE FUNCTION rehab_change_orders_guard();
DROP TRIGGER IF EXISTS rehab_change_orders_delete_with_org ON "rehab_change_orders";
CREATE TRIGGER rehab_change_orders_delete_with_org BEFORE DELETE ON "rehab_change_orders"
  FOR EACH ROW EXECUTE FUNCTION rehab_change_orders_guard();
DROP TRIGGER IF EXISTS rehab_change_orders_no_truncate ON "rehab_change_orders";
CREATE TRIGGER rehab_change_orders_no_truncate BEFORE TRUNCATE ON "rehab_change_orders"
  FOR EACH STATEMENT EXECUTE FUNCTION rehab_change_orders_guard();

ALTER TABLE "rehabs" ADD COLUMN IF NOT EXISTS "realized_sale_price_cents" bigint;
ALTER TABLE "rehabs" ADD COLUMN IF NOT EXISTS "realized_selling_costs_cents" bigint;
ALTER TABLE "rehabs" ADD COLUMN IF NOT EXISTS "realized_closing_date" date;
ALTER TABLE "rehabs" ADD COLUMN IF NOT EXISTS "realized_recorded_by" text;
ALTER TABLE "rehabs" ADD COLUMN IF NOT EXISTS "realized_recorded_at" timestamptz;
