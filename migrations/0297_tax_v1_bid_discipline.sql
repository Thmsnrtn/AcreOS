-- 0297 — V-Tax-1 T3a: bid discipline. Columns only; no table is added
-- (founder decision 2026-10-28: the tax vertical's table count is unchanged).
--
-- tax_sale_listings.max_bid_basis: the decision record behind a max bid — the
-- rights-stack lines the operator recorded (each with its source and as-of),
-- what they derived, who recorded it and when. A max bid with no basis is the
-- operator's bare number and is shown as one.
ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "max_bid_basis" jsonb;

-- tax_sale_listings.discard: "lots, ditches and few gems" — a lot discarded
-- before bidding, with the reason recorded. Reopening keeps the discard on
-- record (it gains a `reopened` entry); bidding on a discarded lot is refused.
ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "discard" jsonb;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'tax_sale_listings_discard_reason_check') THEN
    ALTER TABLE "tax_sale_listings" ADD CONSTRAINT "tax_sale_listings_discard_reason_check"
      CHECK ("discard" IS NULL OR ("discard"->>'reason') IN ('unbuildable', 'landlocked', 'contaminated', 'other'));
  END IF;
END
$$;

-- auction_bid_log: the max in force when the action was logged, and the
-- operator's stated reason for going over it. A reason can only exist beside
-- the snapshot it explains, on an amount that actually exceeded it.
ALTER TABLE "auction_bid_log" ADD COLUMN IF NOT EXISTS "max_bid_cents_at_action" bigint;
ALTER TABLE "auction_bid_log" ADD COLUMN IF NOT EXISTS "over_max_reason" text;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'auction_bid_log_over_max_reason_check') THEN
    ALTER TABLE "auction_bid_log" ADD CONSTRAINT "auction_bid_log_over_max_reason_check"
      CHECK ("over_max_reason" IS NULL OR (
        length(trim("over_max_reason")) > 0
        AND "max_bid_cents_at_action" IS NOT NULL
        AND "amount_cents" IS NOT NULL
        AND "amount_cents" > "max_bid_cents_at_action"
      ));
  END IF;
END
$$;
