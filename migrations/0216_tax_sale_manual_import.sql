-- ============================================================================
-- 0216 — Tax-sale vertical gets an insert path (Wave D, 2026-07-30)
-- ----------------------------------------------------------------------------
-- The nine-domain competitive benchmark found AcreOS's tax-lien vertical to be
-- the inverse of its competitors: a genuinely strong portfolio/workflow layer
-- sitting on an EMPTY data layer. `tax_sale_auctions` and `tax_sale_listings`
-- had ZERO insert paths anywhere in the repo — `importFromCounty` and
-- `countyAssessorIngest.fetchTaxDelinquentList` are stubs returning empty — so
-- the flagship auction worksheet, courthouse mode, and the county
-- upcoming-auction counts all queried tables nothing on earth could fill.
--
-- The feedstock added in this wave is MANUAL ENTRY + operator-supplied CSV lot
-- lists. County scraping and a comps/parcel data plane remain a separate
-- founder-gated large bet and are deliberately NOT built here.
--
-- Three things need storage or index support:
--
-- 1. session_budget_cents on tax_sale_auctions
--    The number an operator bidding live actually wants: capital left. Founder
--    ruling #15 ("be the rail, not the provider") applies — this is a NOTEBOOK
--    number, not a balance. Auction deposits and certificate purchases move
--    between the operator and the county on the operator's OWN rails; no
--    customer money transits AcreOS, and nothing in this feature touches a
--    processor.
--
-- 2. Org-LEADING composite indexes on both tables
--    Neither table carried ANY index (both sat in the
--    check-org-leading-index.mjs baseline allowlist). Giving a table its first
--    real insert path without its tenant-leading index is the exact defect
--    this program keeps catching, so they land together and both tables come
--    OFF the allowlist in the same commit.
--
-- 3. Nothing for the worksheet columns
--    max_bid_cents / walk_away_above_cents / walk_away_condition /
--    partner_split already exist in the database (added by the TD-4 ALTERs in
--    scripts/migrate.mjs) but were never mirrored into shared/schema.ts. That
--    drift is fixed in the Drizzle schema in this commit; it needs no DDL.
--
-- NO NEW TABLES — scripts/ratchets/table-count.json stays at 753.
--
-- Mirrors shared/schema.ts. Registered in scripts/migrate.mjs.
-- Additive + idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

-- ── 1. Session budget (tracking only; see the doctrine note above) ──────────
ALTER TABLE "tax_sale_auctions"
  ADD COLUMN IF NOT EXISTS "session_budget_cents" bigint;

-- ── 2. Org-leading composite indexes ───────────────────────────────────────
-- Every auction query is "this org's auctions, by date" (the calendar and the
-- worksheet's auction picker) or "this org's auctions in this county" (the
-- county-detail upcoming count).
CREATE INDEX IF NOT EXISTS "tax_sale_auctions_org_date_idx"
  ON "tax_sale_auctions" ("organization_id", "auction_date");

CREATE INDEX IF NOT EXISTS "tax_sale_auctions_org_state_county_idx"
  ON "tax_sale_auctions" ("organization_id", "state", "county");

-- The worksheet loads one auction's lots; the CSV importer reads back this
-- auction's existing APNs to reject duplicates instead of double-inserting.
CREATE INDEX IF NOT EXISTS "tax_sale_listings_org_auction_idx"
  ON "tax_sale_listings" ("organization_id", "auction_id");

-- Natural-key lookups: the county summary counts by (state, county), and the
-- won-bid → certificate handoff resolves a parcel by APN within a county.
CREATE INDEX IF NOT EXISTS "tax_sale_listings_org_state_county_apn_idx"
  ON "tax_sale_listings" ("organization_id", "state", "county", "apn");

CREATE INDEX IF NOT EXISTS "tax_sale_listings_org_status_idx"
  ON "tax_sale_listings" ("organization_id", "status");
