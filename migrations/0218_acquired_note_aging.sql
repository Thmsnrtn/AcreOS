-- ============================================================================
-- 0218 — Acquired notes: the aging columns (when money is actually due)
--        (2026-07-30)
-- ----------------------------------------------------------------------------
-- `acquired_notes` carried `payment_due_day` (a bare 1-31) and `maturity_date`
-- and NOTHING that says which period is outstanding. The note-investor
-- vertical therefore had no aging, no dunning, no delinquency derivation, and
-- its Reg-Z §1026.41 periodic statement printed "the 1st of next month" for
-- every borrower on the book — the same sentence whether the borrower was
-- current or four periods down. A periodic statement is a representation the
-- holder is bound by; a wrong "next payment due" on one is not a display bug.
--
-- These columns make aging DERIVABLE from stored facts:
--
--   first_payment_date  The schedule's own anchor. Acquired notes are bought
--                       mid-life — origination is routinely years earlier and
--                       the note may have been modified since — so deriving
--                       the schedule from origination puts period 1 in the
--                       past and every later period off by the modification.
--   next_payment_date   Server truth, replacing a per-render browser guess
--                       that let the statement, the reminder and the detail
--                       page each show a different date and survived nothing.
--   paid_through_date   The last period FULLY satisfied — NOT "date of last
--                       payment". A borrower who sends half a payment has paid
--                       recently and is still a period behind; without this a
--                       partial payment silently resets the clock.
--   grace_period_days   Without it aging calls a borrower delinquent the day
--                       after the due date, which contradicts nearly every
--                       note instrument. Default 10 matches the seller-finance
--                       book (`notes.grace_period_days`) so the two books do
--                       not disagree about one borrower's standing.
--   late_fee_cents      CONFIG ONLY. No code path in this build assesses,
--                       accrues, invoices or collects it — founder ruling #15
--                       ("be the rail, not the provider") keeps AcreOS out of
--                       customer money movement, so lateness is surfaced as an
--                       ADVISORY and any fee is charged by the operator on
--                       their own rails. Stored because a payoff quote or a
--                       periodic statement that omits the borrower's stated
--                       fee terms is an incomplete disclosure. 0 = no fee.
--   days_delinquent /   Derived aging depth + its bucket, recomputed daily so
--   delinquency_status  "everything 60+ days down" is one indexed org query
--                       rather than a full-book re-derivation, and so the
--                       loss-mit case, the dunning ladder and the Letter all
--                       quote the same number. The status vocabulary is
--                       deliberately IDENTICAL to `notes.delinquency_status`
--                       (current / early_delinquent / delinquent /
--                       seriously_delinquent / default_candidate): an org
--                       holding both originated and acquired paper reads one
--                       delinquency list, and two spellings of "60 days down"
--                       would split it into two half-truths.
--
-- ── BACKFILL — deliberately conservative ────────────────────────────────────
-- paid_through_date: set to MAX(note_payments.payment_date) for notes that
--   have payment history. Notes with no posted payments stay NULL. This is the
--   one value the ledger can state from facts it already holds.
--
-- first_payment_date: left NULL on purpose. We do not know it for imported
--   paper, and a guessed origination-plus-one-month would print a wrong date
--   on a legal statement. The schedule service falls back to origination when
--   this is null; that fallback is deliberate and documented there.
--
-- next_payment_date: left NULL on purpose. The daily aging job computes it on
--   its first run from real facts. DO NOT "helpfully" add the computation to
--   this file: the derivation carries maturity caps, month-end clamping (a
--   due-day of 31 in February) and paid-through semantics, and those belong in
--   exactly ONE place. A second implementation in SQL is precisely how two
--   engines come to disagree — the payoff engine already did this once, which
--   is why note_payoff_quotes now stores its full input snapshot.
--
-- MONEY POSTURE (founder ruling #15): every column here is LEDGER + ADVISORY.
-- Nothing added by this migration moves, holds, collects or charges money.
--
-- NO new tables — scripts/ratchets/table-count.json unchanged.
--
-- Mirrors shared/schema/notes-vertical.ts. Registered in scripts/migrate.mjs
-- (the path that actually runs on deploy as the Fly release_command).
-- ============================================================================

-- ── Columns ─────────────────────────────────────────────────────────────────
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "first_payment_date" date;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "next_payment_date" date;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "paid_through_date" date;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "grace_period_days" integer NOT NULL DEFAULT 10;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "late_fee_cents" bigint NOT NULL DEFAULT 0;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "days_delinquent" integer NOT NULL DEFAULT 0;
ALTER TABLE "acquired_notes"
  ADD COLUMN IF NOT EXISTS "delinquency_status" text NOT NULL DEFAULT 'current';

-- ── Index ───────────────────────────────────────────────────────────────────
-- The "what is due / what is late" read the daily aging job runs across the
-- book. Org-LEADING is mandatory (L3 shard-readiness,
-- scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "acquired_notes_org_next_payment_idx"
  ON "acquired_notes" ("organization_id", "next_payment_date");

-- ── Backfill: paid_through_date only ────────────────────────────────────────
-- Idempotent by construction: it only fills rows still NULL, and it restates
-- the same MAX() from the same ledger rows on every re-run.
UPDATE "acquired_notes" AS n
SET "paid_through_date" = p."last_payment_date"
FROM (
  SELECT "note_id", MAX("payment_date") AS "last_payment_date"
  FROM "note_payments"
  GROUP BY "note_id"
) AS p
WHERE p."note_id" = n."id"
  AND n."paid_through_date" IS NULL;
