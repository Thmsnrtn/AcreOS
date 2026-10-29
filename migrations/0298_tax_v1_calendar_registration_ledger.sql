-- 0298 — V-Tax-1 T3b: the auction calendar in the county's own time zone, the
-- bidder-registration stage gate, and the certificate ledger. Columns and a
-- widened CHECK only; no table is added (founder decision 2026-10-28).
--
-- tax_sale_auctions.calendar: the county's IANA time zone AS STATED by the
-- operator with its source (AcreOS holds no county→zone map), the local start
-- time, the registration deadline in local time, and the funds requirement.
-- Shape in shared/tax/auctionCalendar.ts.
ALTER TABLE "tax_sale_auctions" ADD COLUMN IF NOT EXISTS "calendar" jsonb;

-- tax_sale_auctions.registration: the bidder-registration checklist (deposit,
-- funds, entity documents, W-9, registered). Bidding on a lot in the auction is
-- refused until every item is done or stated not required with its source.
ALTER TABLE "tax_sale_auctions" ADD COLUMN IF NOT EXISTS "registration" jsonb;

-- tax_events gains the ledger's event types: a subsequent tax the operator
-- paid, a redemption notice the operator sent (outside AcreOS — a record, not
-- a send), and the foreclosure-filing deadline with the rule it rests on. The
-- CHECK is replaced in one statement so the table is never without one.
DO $$
BEGIN
  IF to_regclass('public.tax_events') IS NOT NULL THEN
    ALTER TABLE "tax_events" DROP CONSTRAINT IF EXISTS "tax_events_event_type_check";
    ALTER TABLE "tax_events" ADD CONSTRAINT "tax_events_event_type_check"
      CHECK ("event_type" IN ('redemption_expiry', 'quiet_title_filed', 'subsequent_tax_paid', 'redemption_notice_recorded', 'foreclosure_filing_deadline'));
  END IF;
END
$$;
