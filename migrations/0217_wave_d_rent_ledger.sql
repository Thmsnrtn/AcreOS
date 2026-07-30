-- ============================================================================
-- 0217 — Rent ledger: multi-charge payment allocation + the security-deposit
--        statutory clock + the itemised disposition letter (Wave D, 2026-07-30)
-- ----------------------------------------------------------------------------
-- Wave D declared these columns in shared/schema/rental.ts and shipped NO
-- migration. That is the same defect class this program has now caught three
-- times (a table with no CREATE, a column with no ALTER): the code reads and
-- writes them, so the first SELECT against the new table 500s on deploy while
-- every local test passes. This migration closes it.
--
-- ── 1. rent_payment_allocations (NEW TABLE) ─────────────────────────────────
-- The money fix. `POST /api/leases/:id/payments` used to take the SINGLE
-- oldest open charge (`.limit(1)`) and credit the whole payment to it:
--
--     paid_cents    = open_charge.paid_cents + amount_cents
--     balance_cents = max(0, amount + late_fee - new_paid)
--
-- The max(0, …) silently swallowed every cent of overpayment. A tenant two
-- months behind who paid BOTH months got one month marked paid and the other
-- still showing a full balance, while the ledger's own totals said the money
-- had arrived. Everything downstream keyed off that wrong number: aging
-- buckets, the late-fee decision, legal_posture, collected-%, and the
-- notice-to-vacate math. A mis-stated balance in landlord/tenant court is not
-- a display bug — it is the exhibit.
--
-- A payment now spreads across EVERY open charge (oldest first, rent before
-- late fees) and each (payment, charge) line is persisted here. Why a table
-- and not a rollup column: in a dispute the question is never "what is the
-- balance", it is "how did you get that balance". A tenant who paid $2,800
-- against three open months is entitled to know which month each dollar cured
-- and how much went to a late fee rather than to rent. That is
-- per-(payment, charge) data with a per-line rent/fee split; no aggregate on
-- rent_charges or rent_payments can reconstruct it after the fact.
--
-- Rows are append-only: written inside the payment transaction, never mutated.
-- The ordering rule is stamped on every line so a ledger read still explains
-- itself if the rule is ever revised.
--
-- Indexes are ORG-LEADING (L3 shard-readiness, scripts/check-org-leading-index.mjs)
-- and mirror the two real reads plus the double-apply guard:
--   _org_payment_idx  (organization_id, payment_id, sequence) — "every line of
--                     this payment, in application order"
--   _org_charge_idx   (organization_id, rent_charge_id)       — "every payment
--                     that touched this charge" (the explain view)
--   _lease_idx        (lease_id)                              — ledger-wide read
--   _payment_charge_uk UNIQUE (payment_id, rent_charge_id)    — a payment may
--                     touch a charge at most once; the index IS the guard, so a
--                     retried/duplicated allocation loses the INSERT instead of
--                     double-crediting a tenant.
--
-- ONE new table — scripts/ratchets/table-count.json 753 -> 754.
--
-- ── 2. rent_payments allocation columns ─────────────────────────────────────
-- allocated_cents + unapplied_cents make the split explicit on the payment
-- row: money that outlived every open charge is held as a stated CREDIT rather
-- than absorbed into a balance or dropped on the floor. allocation_order_rule
-- records which rule produced the lines.
--
-- ── 3. security_deposits statutory clock ────────────────────────────────────
-- statutory_deadline shipped as a column with a comment ("state-driven (Texas
-- 30d)") and no writer — no route in the repo ever set it. Deposit mishandling
-- is the most common landlord/tenant claim there is, and the sanction in most
-- states is not "pay late": it is loss of the right to withhold ANYTHING plus
-- statutory damages (often 2-3x) plus fees. An empty countdown reads to the
-- operator as "no clock is running", which is the worst possible lie for this
-- column. It is now written at move-out from
-- shared/regulatory/depositReturnRules.ts.
--
-- statutory_deadline_unknown_reason is populated INSTEAD of the date where the
-- jurisdiction has no encoded rule, and is surfaced verbatim. AcreOS does not
-- default to 30 days: an invented deposit deadline is the one fabrication that
-- would directly create the liability it claims to track.
--
-- ── 4. security_deposits disposition letter ─────────────────────────────────
-- Every state that lets a landlord withhold anything conditions that right on
-- delivering a WRITTEN, ITEMISED statement inside the statutory window. AcreOS
-- could reconcile deductions and then produced nothing to send. The generated
-- letter is stored here. delivered_at/delivery_method are stamped ONLY when
-- the operator records their own delivery — AcreOS has no send rail for
-- counterparty mail (BYO identity only) and never claims a letter was sent.
--
-- ── 5. rental_leases e-sign join columns ────────────────────────────────────
-- 'pending_signature' existed as a lease status and the HMAC signing rail
-- existed separately; nothing joined them. These columns are that join.
-- Legal signing is a founder/operator-only hard stop — nothing here is ever
-- written by an automation.
--
-- MONEY POSTURE (founder ruling #15, "be the rail, not the provider"): every
-- table touched here is a LEDGER. No processor, no collection, no funds
-- movement, no tenant payment rail. rent_payments records money the landlord
-- already received on their own rails, and a deposit refund is issued by the
-- landlord — AcreOS never holds, transmits or refunds a tenant's money.
--
-- Mirrors shared/schema/rental.ts. Registered in scripts/migrate.mjs (the
-- path that actually runs on deploy as the Fly release_command).
-- ============================================================================

-- ── 1. rent_payment_allocations ─────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "rent_payment_allocations" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "payment_id" varchar NOT NULL,
  "rent_charge_id" varchar NOT NULL,
  "lease_id" varchar NOT NULL,
  "sequence" integer NOT NULL,
  "applied_to_rent_cents" bigint NOT NULL,
  "applied_to_late_fee_cents" bigint NOT NULL,
  "applied_cents" bigint NOT NULL,
  "balance_before_cents" bigint NOT NULL,
  "balance_after_cents" bigint NOT NULL,
  "order_rule" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "rent_payment_allocations_org_payment_idx"
  ON "rent_payment_allocations" ("organization_id", "payment_id", "sequence");
CREATE INDEX IF NOT EXISTS "rent_payment_allocations_org_charge_idx"
  ON "rent_payment_allocations" ("organization_id", "rent_charge_id");
CREATE INDEX IF NOT EXISTS "rent_payment_allocations_lease_idx"
  ON "rent_payment_allocations" ("lease_id");
CREATE UNIQUE INDEX IF NOT EXISTS "rent_payment_allocations_payment_charge_uk"
  ON "rent_payment_allocations" ("payment_id", "rent_charge_id");

-- ── 2. rent_payments allocation columns ─────────────────────────────────────
ALTER TABLE "rent_payments"
  ADD COLUMN IF NOT EXISTS "allocated_cents" bigint NOT NULL DEFAULT 0;
ALTER TABLE "rent_payments"
  ADD COLUMN IF NOT EXISTS "unapplied_cents" bigint NOT NULL DEFAULT 0;
ALTER TABLE "rent_payments"
  ADD COLUMN IF NOT EXISTS "allocation_order_rule" text;

-- ── 3 + 4. security_deposits: statutory clock + disposition letter ──────────
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "move_out_date" date;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "statutory_deadline_days" integer;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "statutory_deadline_citation" text;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "statutory_deadline_unknown_reason" text;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "statutory_deadline_set_at" timestamptz;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "disposition_letter_markdown" text;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "disposition_letter_version" text;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "disposition_letter_generated_at" timestamptz;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "disposition_letter_delivered_at" timestamptz;
ALTER TABLE "security_deposits"
  ADD COLUMN IF NOT EXISTS "disposition_letter_delivery_method" text;

-- Org-LEADING composite for the deposit-countdown read ("every deposit in this
-- org with a live deadline, soonest first"). security_deposits comes OFF the
-- check-org-leading-index.mjs allowlist in the same commit.
CREATE INDEX IF NOT EXISTS "security_deposits_org_deadline_idx"
  ON "security_deposits" ("organization_id", "statutory_deadline");

-- ── 5. rental_leases e-sign join columns ────────────────────────────────────
ALTER TABLE "rental_leases"
  ADD COLUMN IF NOT EXISTS "signing_document_id" integer;
ALTER TABLE "rental_leases"
  ADD COLUMN IF NOT EXISTS "signature_packet_sent_at" timestamptz;
ALTER TABLE "rental_leases"
  ADD COLUMN IF NOT EXISTS "signature_requested_by" text;
ALTER TABLE "rental_leases"
  ADD COLUMN IF NOT EXISTS "executed_at" timestamptz;

CREATE INDEX IF NOT EXISTS "rental_leases_org_signing_doc_idx"
  ON "rental_leases" ("organization_id", "signing_document_id");
