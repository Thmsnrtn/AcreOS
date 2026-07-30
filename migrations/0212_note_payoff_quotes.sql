-- ============================================================================
-- 0212 — Wave C "Money moves": the payoff quote ledger
-- ----------------------------------------------------------------------------
-- A payoff statement is a representation the note holder is bound by. AcreOS
-- computed payoff quotes in three different places (with three different
-- day-count behaviours) and PERSISTED NONE OF THEM. When a closer wires the
-- quoted figure and the ledger disagrees, there was no record of what was
-- quoted, as of what date, or from which inputs — so no way to establish
-- which side moved. Wave C unified the arithmetic into one engine
-- (server/services/notePaymentMath.ts :: computePayoffQuote) and this table
-- makes each quote provable after the fact.
--
-- One row per quote issued. Rows are immutable by convention: a quote is
-- never updated, only superseded by a later quote on the same note.
--
-- Spans BOTH note books deliberately — note_system + note_ref address either
-- an acquired_notes row (uuid) or a notes row (integer id as text). No FK to
-- either book: an audit artifact must outlive the row it describes, and
-- deleting a note must never destroy the evidence of what was quoted on it.
--
-- Mirrors shared/schema/notes-vertical.ts + scripts/migrate.mjs.
-- Additive + idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "note_payoff_quotes" (
  "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,

  -- Which book the quoted note lives in ('acquired_note' | 'serviced_note')
  -- and its key there.
  "note_system" text NOT NULL,
  "note_ref" text NOT NULL,
  -- Human-facing identifiers snapshotted at quote time.
  "note_number" text,
  "payer_name" text,

  -- Provenance: who asked, through which channel, when.
  "quoted_by_user_id" text,
  "channel" text NOT NULL DEFAULT 'operator_api',
  "quoted_at" timestamp with time zone NOT NULL DEFAULT now(),

  -- ── The inputs the quoted number was computed FROM ────────────────────────
  -- The engine accrues interest THROUGH payoff_date, so the quote is good
  -- only through that date; extending it costs per_diem_interest_cents/day.
  "payoff_date" date NOT NULL,
  "good_through_date" date NOT NULL,
  "principal_balance_cents" bigint NOT NULL,
  -- Rate in HUNDREDTHS of a basis point: 9.875% = 987.5 bps = 98750. The
  -- decimal servicing book can express sub-basis-point rates; an integer bps
  -- column would silently round them and move the quoted total.
  "annual_rate_bps_hundredths" integer NOT NULL,
  "accrual_start_date" date NOT NULL,
  "days_accrued" integer NOT NULL,
  -- 'actual/365_fixed' — recorded per row so a convention change is visible
  -- in the audit trail instead of retroactively re-explaining old quotes.
  "day_count_convention" text NOT NULL,

  -- ── The outputs ──────────────────────────────────────────────────────────
  "per_diem_interest_cents" bigint NOT NULL,
  "accrued_interest_cents" bigint NOT NULL,
  "unapplied_credit_cents" bigint NOT NULL DEFAULT 0,
  "late_fees_outstanding_cents" bigint NOT NULL DEFAULT 0,
  "payoff_fee_cents" bigint NOT NULL DEFAULT 0,
  "total_payoff_cents" bigint NOT NULL,

  -- Which engine produced it, plus the verbatim input snapshot, so the number
  -- can be recomputed and defended years later.
  "engine_version" text NOT NULL,
  "engine_input_json" jsonb NOT NULL,

  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- "every quote ever issued on this note, newest first"
CREATE INDEX IF NOT EXISTS "note_payoff_quotes_note_quoted_idx"
  ON "note_payoff_quotes" ("note_system", "note_ref", "quoted_at");

-- Org-scoped audit read.
CREATE INDEX IF NOT EXISTS "note_payoff_quotes_org_quoted_idx"
  ON "note_payoff_quotes" ("organization_id", "quoted_at");
