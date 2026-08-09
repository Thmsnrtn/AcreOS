-- ============================================================================
-- 0224 — Short-term-rental (STR) reservations: the nightly-stay primitive the
--        SHORT_TERM_RENTAL vertical never had (2026-08, STR Wave A).
-- ----------------------------------------------------------------------------
-- SHORT_TERM_RENTAL shipped riding the MONTHLY-lease stack: a "rental" was a
-- rental_leases row with a monthly_rent_cents and a charged_for_month grain. A
-- nightly stay has neither — its unit of account is a GUEST STAY with a check-in
-- and a check-out, its revenue is a per-booking figure net of channel + cleaning
-- fees, and the metric an operator manages to is occupancy / ADR / RevPAR, none
-- of which the monthly ledger can express. Modelling a two-night Airbnb booking
-- as a one-twelfth-of-a-month lease charge is the same category error the units
-- table fixed for vacancy: the fact has nowhere honest to live.
--
--   reservations — one row per booked stay, keyed on (check_in, check_out),
--     attributable to a PROPERTY and optionally a unit/pad (an operator with
--     multiple listings at one property). The input to the pure STR metrics
--     engine (shared/rental/strMetrics.ts), which turns a window of reservations
--     into booked-nights / occupancy / room-revenue / ADR / RevPAR — and REFUSES
--     (null) rather than divide by zero or invent a rate.
--
-- ── MONEY POSTURE (founder ruling "be the rail, not the provider") ──────────
-- RECORD-ONLY. Nothing here holds, moves, collects or charges a cent. Every
-- *_cents column is a figure the operator RECORDS off their OWN channel payout
-- (or their own CSV export) — gross booking, the channel's fee, the cleaning
-- fee, taxes, the net payout — never a balance and never an instruction to pay.
-- AcreOS is not a party to the guest's money; it moved on Airbnb/VRBO/the
-- operator's own processor, elsewhere.
--
-- ── NO OTA VENDOR API, NO CHANNEL SYNC, NO SUGGESTED NIGHTLY RATE ────────────
-- channel is a recorded LABEL ('airbnb'|'vrbo'|'booking'|'direct'|'other'), NOT
-- a live integration — there is no OTA API here and integrations stays []. And
-- there is NO market/dynamic "suggested nightly rate": that would touch the
-- residential-comps data plane (a standing hard-stop) AND require a vendor.
-- ADR/RevPAR are computed ONLY from the operator's OWN recorded amounts.
--
-- ── NO BACKFILL ─────────────────────────────────────────────────────────────
-- The table ships EMPTY and fills only from real operator entry or the operator's
-- OWN channel CSV export. Inventing a seed stay is exactly the fabrication this
-- table exists to prevent.
--
-- ── ONE new table — scripts/ratchets/table-count.json 755 -> 756. ───────────
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the path
-- that actually runs on deploy as the Fly release_command). Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "reservations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
  "unit_id" varchar REFERENCES "rental_units"("id") ON DELETE SET NULL,
  "guest_name" text,
  -- 'airbnb' | 'vrbo' | 'booking' | 'direct' | 'other' — a recorded LABEL, not a live sync.
  "channel" text,
  "check_in" date NOT NULL,
  "check_out" date NOT NULL,
  "nights" integer,
  "gross_booking_cents" bigint,
  "channel_fee_cents" bigint,
  "cleaning_fee_cents" bigint,
  "taxes_cents" bigint,
  "payout_cents" bigint,
  -- 'booked' | 'checked_in' | 'checked_out' | 'cancelled'
  "status" text NOT NULL DEFAULT 'booked',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
-- Org-LEADING (L3 shard-readiness) + the dominant read: a property's stays by check-in.
CREATE INDEX IF NOT EXISTS "reservations_org_property_check_in_idx"
  ON "reservations" ("organization_id", "property_id", "check_in");
-- The channel-CSV importer's idempotency guard: a re-upload loses the INSERT
-- rather than double-listing a stay. (Null unit_id rows are additionally deduped
-- in-app by the importer, since a NULL is distinct in a unique index.)
CREATE UNIQUE INDEX IF NOT EXISTS "reservations_org_unit_check_in_channel_uk"
  ON "reservations" ("organization_id", "unit_id", "check_in", "channel");
