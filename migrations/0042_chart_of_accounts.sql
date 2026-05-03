-- 0042_chart_of_accounts.sql
-- Lavender §1, Hilda §2 — Phase 2 Week 6 monthly-close foundation.
--
-- Ships the schema + indexes for AcreOS's general-ledger pipeline. The
-- recognition worker, trial-balance generator, GL-PDF, and IIF/QBO export
-- are deferred to Lavender Week 10 (see docs/exhaustive-completion/
-- lavender-week10-todo.md).
--
--   chart_of_accounts        — per-org account tree. accountNumber is
--                              customer-defined (e.g. "1000",
--                              "4000-CASH") so orgs can mirror their
--                              CPA's chart or QuickBooks layout.
--   account_ledger_entries   — single-leg double-entry rows. Every
--                              business event posts ≥2 rows (one debit,
--                              one credit) sharing referenceType +
--                              referenceId. The CHECK constraint enforces
--                              "exactly one side > 0" so no row can be
--                              both legs at once.
--
-- All amounts are bigint cents — never floats.

-- ── chart_of_accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer NOT NULL
        REFERENCES "organizations"("id") ON DELETE CASCADE,
    "account_number" text NOT NULL,
    "account_name" text NOT NULL,
    "account_type" text NOT NULL,
    "parent_account_id" uuid
        REFERENCES "chart_of_accounts"("id") ON DELETE SET NULL,
    "is_active" boolean NOT NULL DEFAULT true,
    "description" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

-- Per-org accountNumber uniqueness — application-level invariant for
-- drilldown reports, GL imports, and trial-balance keying.
CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_org_number_unique"
    ON "chart_of_accounts" ("organization_id", "account_number");

CREATE INDEX IF NOT EXISTS "chart_of_accounts_org_type_idx"
    ON "chart_of_accounts" ("organization_id", "account_type");

-- ── account_ledger_entries ─────────────────────────────────────────────────
-- Append-only journal. We do NOT cascade on account delete — instead the
-- FK is RESTRICT so that an account with history can never be silently
-- removed (UI must mark it inactive). Org-level cascade still applies for
-- full-tenant teardown.
CREATE TABLE IF NOT EXISTS "account_ledger_entries" (
    "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer NOT NULL
        REFERENCES "organizations"("id") ON DELETE CASCADE,
    "account_id" uuid NOT NULL
        REFERENCES "chart_of_accounts"("id") ON DELETE RESTRICT,
    "debit" bigint NOT NULL DEFAULT 0,
    "credit" bigint NOT NULL DEFAULT 0,
    "description" text,
    "reference_type" text,
    "reference_id" text,
    "booking_date" date NOT NULL,
    "posted_at" timestamptz NOT NULL DEFAULT now(),
    -- Database-level invariant: every row is exactly one side of the
    -- double-entry pair. Application code must always insert a matched
    -- pair (or n-tuple summing to zero net) inside a single transaction.
    CONSTRAINT "account_ledger_entries_debit_xor_credit"
        CHECK (
            ("debit" > 0 AND "credit" = 0)
            OR ("debit" = 0 AND "credit" > 0)
        ),
    CONSTRAINT "account_ledger_entries_non_negative"
        CHECK ("debit" >= 0 AND "credit" >= 0)
);

-- Indexes are CONCURRENT-friendly when this migration is run on an
-- already-populated table; CREATE INDEX CONCURRENTLY cannot run inside
-- a transaction block, so we keep the plain form here (the table is new
-- on first apply) and rely on operators to use CONCURRENTLY when
-- backfilling on an existing cluster.
CREATE INDEX IF NOT EXISTS "account_ledger_entries_org_booking_idx"
    ON "account_ledger_entries" ("organization_id", "booking_date" DESC);

CREATE INDEX IF NOT EXISTS "account_ledger_entries_account_booking_idx"
    ON "account_ledger_entries" ("account_id", "booking_date" DESC);

CREATE INDEX IF NOT EXISTS "account_ledger_entries_reference_idx"
    ON "account_ledger_entries" ("reference_type", "reference_id");
