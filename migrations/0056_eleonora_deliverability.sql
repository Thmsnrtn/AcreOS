-- 0056_eleonora_deliverability.sql
-- Eleonora full deliverability foundation (Phase 1 §10 / Week 7-8).
--
-- Five concerns landed in one migration because they comprise a single
-- deliverability pillar — pulling any one out leaves the system in a
-- half-deliverability state where outbound mail still leans on the
-- platform-default identity.
--
--   1. org_email_identities         — per-org DKIM/SPF/DMARC identities,
--                                      keypair persisted with private key
--                                      encrypted via fieldEncryption.
--   2. email_warmup_state            — per-org IP-warmup ramp + daily limit
--                                      enforcement.
--   3. unsubscribe_tokens            — token-based one-click List-Unsubscribe
--                                      handler. Tokens are unique opaque
--                                      strings; `/u/:token` resolves them
--                                      and writes to email_suppressions.
--   4. email_suppressions extension  — adds bounce_category + soft-bounce
--                                      strike tracking + organizationId for
--                                      per-org reputation isolation.
--   5. email_reputation_snapshot     — per-org rolling bounce/complaint
--                                      rate + computed deliverability score.

-- ── org_email_identities ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "org_email_identities" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "from_address" text NOT NULL,
    "dkim_domain" text NOT NULL,
    "dkim_selector" text NOT NULL DEFAULT 'acreos1',
    "dkim_public_key" text NOT NULL,
    "dkim_private_key_encrypted" text NOT NULL,
    "spf_record" text NOT NULL,
    "dmarc_record" text NOT NULL,
    "status" text NOT NULL DEFAULT 'provisioning',
    "sendgrid_domain_id" text,
    "verification_error" text,
    "verified_at" timestamptz,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_email_identities_org_domain"
    ON "org_email_identities" ("organization_id", "dkim_domain");
CREATE INDEX IF NOT EXISTS "idx_org_email_identities_status"
    ON "org_email_identities" ("status");

-- ── email_warmup_state ──────────────────────────────────────────────────────
-- Day-based ramp: day 1=50, day 2=100, day 3=500, day 4=1000, day 5=5000,
-- day 7=10000. Limit enforced at send time; if currentDayUsed >= limit the
-- send is queued (transactional) or rejected (campaign).
CREATE TABLE IF NOT EXISTS "email_warmup_state" (
    "organization_id" integer PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
    "first_send_at" timestamptz,
    "days_since_first_send" integer NOT NULL DEFAULT 0,
    "daily_send_limit" integer NOT NULL DEFAULT 50,
    "current_day_used" integer NOT NULL DEFAULT 0,
    "current_day_reset_at" timestamptz NOT NULL DEFAULT now(),
    "warmup_complete" boolean NOT NULL DEFAULT false,
    "updated_at" timestamptz DEFAULT now() NOT NULL
);

-- ── unsubscribe_tokens ──────────────────────────────────────────────────────
-- One-click List-Unsubscribe: every outbound campaign/transactional email
-- carries a per-recipient token. /u/:token → suppress + redirect to friendly
-- confirmation page. Tokens never expire (RFC 8058 expects the URL to be
-- valid as long as the recipient might receive a message).
CREATE TABLE IF NOT EXISTS "unsubscribe_tokens" (
    "token" text PRIMARY KEY,
    "email" text NOT NULL,
    "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
    "created_at" timestamptz DEFAULT now() NOT NULL,
    "used_at" timestamptz
);

CREATE INDEX IF NOT EXISTS "idx_unsubscribe_tokens_email"
    ON "unsubscribe_tokens" ("email");

-- ── email_suppressions: bounce_category + per-org isolation ─────────────────
ALTER TABLE "email_suppressions"
    ADD COLUMN IF NOT EXISTS "bounce_category" text;
ALTER TABLE "email_suppressions"
    ADD COLUMN IF NOT EXISTS "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL;
ALTER TABLE "email_suppressions"
    ADD COLUMN IF NOT EXISTS "soft_bounce_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "email_suppressions"
    ADD COLUMN IF NOT EXISTS "last_soft_bounce_at" timestamptz;

CREATE INDEX IF NOT EXISTS "idx_email_suppressions_org"
    ON "email_suppressions" ("organization_id");
CREATE INDEX IF NOT EXISTS "idx_email_suppressions_category"
    ON "email_suppressions" ("bounce_category");

-- ── email_reputation_snapshot ───────────────────────────────────────────────
-- Per-org rolling deliverability score. Updated nightly by a job (or on
-- demand from /founder/deliverability). Score in [0,100]; healthy ≥ 90,
-- at-risk 70-89, critical < 70. Computed from bounce_rate + complaint_rate
-- over the last 30 days of email_events.
CREATE TABLE IF NOT EXISTS "email_reputation_snapshot" (
    "id" serial PRIMARY KEY,
    "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
    "window_days" integer NOT NULL DEFAULT 30,
    "sent_count" integer NOT NULL DEFAULT 0,
    "bounce_count" integer NOT NULL DEFAULT 0,
    "complaint_count" integer NOT NULL DEFAULT 0,
    "bounce_rate" numeric(5, 4) NOT NULL DEFAULT 0,
    "complaint_rate" numeric(5, 4) NOT NULL DEFAULT 0,
    "deliverability_score" integer NOT NULL DEFAULT 100,
    "health_status" text NOT NULL DEFAULT 'healthy',
    "computed_at" timestamptz DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_email_reputation_org_computed"
    ON "email_reputation_snapshot" ("organization_id", "computed_at" DESC);
