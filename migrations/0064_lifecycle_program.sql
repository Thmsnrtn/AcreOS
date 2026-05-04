-- Phase 4 Week 17-18 — Lifecycle Program + Indigo Win-back + Renoir Welcome-back
--
-- Sigrid §3, Camila §4, Indigo §1-§4, Renoir §1-§2.
--
-- Three tables back the customer-lifecycle program:
--
-- 1. email_templates           — Versioned, channel-aware template registry.
--                                Each template has a stable `key` (one of the
--                                14 lifecycle messages, or one of the 6 Indigo
--                                win-back cells) and a monotonic `version`.
--                                Subject/body are rendered via simple
--                                {placeholder} substitution at send time.
--
-- 2. lifecycle_message_sends   — Per-recipient audit row recording every
--                                lifecycle/winback message dispatched. Used
--                                for:
--                                  • idempotency (don't re-send the same
--                                    template to the same recipient)
--                                  • the 12-month "max 2 win-back touches"
--                                    throttle
--                                  • dashboards & cohort analysis
--                                We index on (organization_id, template_key)
--                                so the throttle check is a single index
--                                lookup, not a table scan.
--
-- 3. reactivation_tokens       — Signed-token rows backing the welcome-back
--                                deep-link in win-back emails. The plaintext
--                                token is sent in the URL; only its SHA-256
--                                hash is persisted (Pelle pattern). Tokens
--                                expire 30d after issue, are single-use, and
--                                are scoped to an organization.

-- ---------------------------------------------------------------------------
-- 1. email_templates
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "email_templates" (
  "id" serial PRIMARY KEY,
  -- Stable identifier for the lifecycle/win-back template (e.g.
  -- "welcome", "winback_price_solo"). See shared/lifecycle/messages.ts
  -- for the canonical key list.
  "key" text NOT NULL,
  -- Monotonic version per key. Bump when copy changes; the registry
  -- always renders the highest active version.
  "version" integer NOT NULL DEFAULT 1,
  -- "email" or "sms". The morning briefing + lifecycle nudges use both.
  "channel" text NOT NULL DEFAULT 'email',
  "subject" text,
  "body" text NOT NULL,
  -- Sigrid §3: every template carries the broad notification category
  -- it belongs to so notification preferences can mute a whole class
  -- without naming individual templates. e.g. "lifecycle.onboarding",
  -- "lifecycle.retention", "lifecycle.winback".
  "category" text NOT NULL DEFAULT 'lifecycle.general',
  -- Inactive templates are kept for audit/replay but never picked up
  -- by the renderer.
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  CONSTRAINT "email_templates_key_version_uq" UNIQUE ("key", "version")
);

CREATE INDEX IF NOT EXISTS "email_templates_key_active_idx"
  ON "email_templates" ("key", "active");
CREATE INDEX IF NOT EXISTS "email_templates_category_idx"
  ON "email_templates" ("category");

-- ---------------------------------------------------------------------------
-- 2. lifecycle_message_sends
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "lifecycle_message_sends" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "user_id" varchar,
  -- Plain template key (denormalized: matches email_templates.key but
  -- doesn't FK to it — templates may be retired while their audit rows
  -- need to live forever).
  "template_key" text NOT NULL,
  "template_version" integer,
  "channel" text NOT NULL DEFAULT 'email',
  "recipient_email" text,
  "recipient_phone" text,
  -- The category at send time (denormalized for stable cohort queries).
  "category" text NOT NULL DEFAULT 'lifecycle.general',
  -- "queued" → enqueued to outbox; "sent" → drainer reported success;
  -- "suppressed" → blocked by suppression list; "skipped" → throttled
  -- (e.g. exceeded 2-touch winback budget).
  "status" text NOT NULL DEFAULT 'queued',
  "outbox_id" integer,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "sent_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_org_template_idx"
  ON "lifecycle_message_sends" ("organization_id", "template_key", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_org_category_idx"
  ON "lifecycle_message_sends" ("organization_id", "category", "sent_at" DESC);
CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_recipient_idx"
  ON "lifecycle_message_sends" ("recipient_email");

-- ---------------------------------------------------------------------------
-- 3. reactivation_tokens
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "reactivation_tokens" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  -- SHA-256 of the URL token. Plaintext lives only in the user's email.
  "token_hash" text NOT NULL UNIQUE,
  "issued_at" timestamp NOT NULL DEFAULT now(),
  "expires_at" timestamp NOT NULL,
  "redeemed_at" timestamp,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS "reactivation_tokens_org_idx"
  ON "reactivation_tokens" ("organization_id");
CREATE INDEX IF NOT EXISTS "reactivation_tokens_expires_idx"
  ON "reactivation_tokens" ("expires_at");
