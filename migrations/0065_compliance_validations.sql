-- ============================================================================
-- 0065_compliance_validations.sql
-- Phase 4 Week 21-22 — AI compliance post-validator + prompt versioning A/B
-- harness + injection-attempt rate limiting (Theo §8, Sayuri §2.3, Nadia-AI §2.A).
-- ============================================================================
--
-- This migration introduces three small, narrowly-scoped tables that together
-- harden customer-facing AI surfaces:
--
--   1. compliance_validations
--      Every customer-facing AI response that touches a regulated domain
--      (real-estate offer wording, contract language, lender disclosure,
--      tax advice) is post-validated by Claude Opus 4.7 in extended-thinking
--      mode. The validator returns either PASS or a list of missing
--      disclosure phrases. We log every check — verdict, prepended
--      disclosures, latency, model — so the founder can audit what we
--      blocked and what we let through.
--
--   2. prompt_versions
--      Pax / Atlas / agent prompts now flow through a registry. Each prompt
--      has 1..N versions, each with a weight (0-100). The registry rolls
--      weighted dice at request time and returns one version. Eval scores
--      from evals/run-eval.ts are written back here so the founder UI at
--      /founder/prompt-versions can show A/B deltas + a "promote candidate"
--      button. Shadow-test mode = candidate at 5% weight; auto-promote when
--      its 7-day eval score is ≥ 5% better than production.
--
--   3. ai_injection_attempts
--      Per-user counter of detected prompt-injection attempts. Used by the
--      injection rate limiter — > 3 attempts in 1 hour flags the user in
--      audit_events and blocks further AI calls for a cool-down window.
--
-- All three tables are designed to be append-only (no UPDATE on
-- compliance_validations or ai_injection_attempts; prompt_versions does
-- accept UPDATE for weight/eval-score adjustments).

-- ── compliance_validations ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "compliance_validations" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "organization_id" integer,
    "surface" text NOT NULL,
    "domain" text NOT NULL,
    "input_hash" text NOT NULL,
    "verdict" text NOT NULL,
    "missing_phrases" jsonb,
    "prepended_disclosure" text,
    "validator_model" text NOT NULL,
    "thinking_budget" integer,
    "latency_ms" integer,
    "rationale" text,
    "metadata" jsonb,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "compliance_validations_verdict_check"
        CHECK ("verdict" IN ('pass', 'block', 'amend', 'error'))
);

CREATE INDEX IF NOT EXISTS "compliance_validations_org_idx"
    ON "compliance_validations" ("organization_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "compliance_validations_surface_idx"
    ON "compliance_validations" ("surface", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "compliance_validations_verdict_idx"
    ON "compliance_validations" ("verdict", "created_at" DESC);

-- ── prompt_versions ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "prompt_versions" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "prompt_name" text NOT NULL,
    "version" text NOT NULL,
    "system" text NOT NULL,
    "tier" text NOT NULL DEFAULT 'standard',
    "hash" text NOT NULL,
    "weight" integer NOT NULL DEFAULT 0,
    "eval_score" numeric(5,4),
    "eval_run_at" timestamptz,
    "active" boolean NOT NULL DEFAULT true,
    "is_candidate" boolean NOT NULL DEFAULT false,
    "promoted_from" varchar,
    "notes" text,
    "created_at" timestamptz NOT NULL DEFAULT now(),
    "updated_at" timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT "prompt_versions_tier_check"
        CHECK ("tier" IN ('critical', 'standard', 'background')),
    CONSTRAINT "prompt_versions_weight_check"
        CHECK ("weight" >= 0 AND "weight" <= 100)
);

CREATE UNIQUE INDEX IF NOT EXISTS "prompt_versions_name_version_unique"
    ON "prompt_versions" ("prompt_name", "version");
CREATE INDEX IF NOT EXISTS "prompt_versions_active_idx"
    ON "prompt_versions" ("prompt_name", "active") WHERE "active" = true;

-- ── ai_injection_attempts ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "ai_injection_attempts" (
    "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
    "user_id" text,
    "organization_id" integer,
    "surface" text NOT NULL,
    "matched_patterns" jsonb,
    "input_preview" text,
    "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_injection_attempts_user_idx"
    ON "ai_injection_attempts" ("user_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "ai_injection_attempts_org_idx"
    ON "ai_injection_attempts" ("organization_id", "created_at" DESC);
