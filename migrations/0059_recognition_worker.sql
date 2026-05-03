-- 0059_recognition_worker.sql
-- Lavender Week 10 — Monthly-close pipeline (recognition worker, trial
-- balance, GL-PDF, QBO export) and Olympia Week 10 — 1099 batch generator.
--
-- This migration adds three audit / job tables on top of the chart-of-accounts
-- foundation shipped in 0042:
--
--   recognition_schedules — tracks deferred-revenue amortisation per source
--                           invoice. The recognition worker reads this table
--                           and posts DR Deferred-Revenue / CR Subscription-
--                           Revenue ledger entries on a monthly cadence.
--   recognition_runs      — append-only audit row for every worker tick. We
--                           never delete; operators query this table to
--                           reconstruct what posted on a given month.
--   form_1099_batches     — per-tax-year batch run for Olympia's 1099-INT
--                           generator. `result_blob` carries the FIRE-format
--                           text + PDF manifest so a later GET can return
--                           identical artefacts without re-running.
--
-- All idempotency is keyed via the `unique` indexes below — the worker is
-- safe to retry without double-posting.

-- ── recognition_schedules ─────────────────────────────────────────────────
-- One row per source invoice that has a deferred-revenue component.
-- balance_remaining_cents drains as the worker recognises each period.
CREATE TABLE IF NOT EXISTS "recognition_schedules" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer NOT NULL
        REFERENCES "organizations"("id") ON DELETE CASCADE,
    "source_type" text NOT NULL,           -- 'stripe_invoice' | 'manual'
    "source_id" text NOT NULL,             -- e.g. invoice ID
    "total_cents" bigint NOT NULL,
    "balance_remaining_cents" bigint NOT NULL,
    "period_start" date NOT NULL,
    "period_end" date NOT NULL,
    "months_total" integer NOT NULL,       -- e.g. 12 for annual
    "months_recognised" integer NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'active',  -- active | completed | cancelled
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "recognition_schedules_balance_non_negative"
        CHECK ("balance_remaining_cents" >= 0),
    CONSTRAINT "recognition_schedules_months_valid"
        CHECK ("months_total" > 0 AND "months_recognised" >= 0
               AND "months_recognised" <= "months_total")
);

-- One schedule per (org, source) — we never want two recognition curves
-- racing each other for the same invoice.
CREATE UNIQUE INDEX IF NOT EXISTS "recognition_schedules_source_unique"
    ON "recognition_schedules" ("organization_id", "source_type", "source_id");

CREATE INDEX IF NOT EXISTS "recognition_schedules_active_idx"
    ON "recognition_schedules" ("organization_id", "status")
    WHERE "status" = 'active';

-- ── recognition_runs ──────────────────────────────────────────────────────
-- Append-only audit trail. One row per worker invocation; entries_posted
-- counts the ledger rows written that tick (always even — DR + CR pair).
CREATE TABLE IF NOT EXISTS "recognition_runs" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer
        REFERENCES "organizations"("id") ON DELETE CASCADE,
    "run_started_at" timestamptz NOT NULL DEFAULT now(),
    "run_completed_at" timestamptz,
    "as_of_date" date NOT NULL,
    "schedules_processed" integer NOT NULL DEFAULT 0,
    "entries_posted" integer NOT NULL DEFAULT 0,
    "cents_recognised" bigint NOT NULL DEFAULT 0,
    "status" text NOT NULL DEFAULT 'running',  -- running | success | failure
    "error_message" text
);

CREATE INDEX IF NOT EXISTS "recognition_runs_org_started_idx"
    ON "recognition_runs" ("organization_id", "run_started_at" DESC);

-- ── form_1099_batches ─────────────────────────────────────────────────────
-- Olympia §1 — 1099-INT batch generator. Long-running so the route returns
-- a job ID and the caller polls. result_blob is JSON with PDF manifest +
-- FIRE-format text; null until the worker completes.
CREATE TABLE IF NOT EXISTS "form_1099_batches" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer NOT NULL
        REFERENCES "organizations"("id") ON DELETE CASCADE,
    "tax_year" integer NOT NULL,
    "status" text NOT NULL DEFAULT 'queued',  -- queued | running | success | failure
    "form_count" integer NOT NULL DEFAULT 0,
    "total_interest_cents" bigint NOT NULL DEFAULT 0,
    "result_blob" jsonb,
    "error_message" text,
    "started_at" timestamptz,
    "completed_at" timestamptz,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "form_1099_batches_org_year_idx"
    ON "form_1099_batches" ("organization_id", "tax_year");
