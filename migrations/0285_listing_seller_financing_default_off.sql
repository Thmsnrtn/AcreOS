-- 0285 — a new listing offers seller financing only when the seller says so.
-- property_listings.seller_financing_available defaulted to TRUE, so any
-- listing created without the field (an API call, an import, a form that
-- omitted it) told every channel "seller financing available". Existing rows
-- keep the value they hold: whether a published listing offered terms is the
-- seller's record, not ours to rewrite.
ALTER TABLE "property_listings" ALTER COLUMN "seller_financing_available" SET DEFAULT false;
