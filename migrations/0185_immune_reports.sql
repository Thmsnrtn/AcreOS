-- 0185 — Immune-system run reports (step-away gap #4).
-- One append-only row per daily immune-response run: parsed audit counts, the
-- gated repair plan (auto/witnessed/skip), and what the motor half actually
-- did (self-patch attempt, founder ask). The board report + Control door read
-- this instead of the plan evaporating at process exit. Additive + idempotent.
CREATE TABLE IF NOT EXISTS "autopilot_immune_reports" (
  "id" serial PRIMARY KEY,
  "ran_at" timestamptz NOT NULL DEFAULT now(),
  "advisories_total" integer NOT NULL DEFAULT 0,
  "by_severity" jsonb NOT NULL DEFAULT '{}',
  "auto_count" integer NOT NULL DEFAULT 0,
  "witnessed_count" integer NOT NULL DEFAULT 0,
  "skip_count" integer NOT NULL DEFAULT 0,
  "plan_items" jsonb NOT NULL DEFAULT '[]',
  "line" text NOT NULL,
  "auto_merge_earned" boolean NOT NULL DEFAULT false,
  "self_patch_ran" boolean NOT NULL DEFAULT false,
  "self_patch_reason" text,
  "self_patch_pr_url" text,
  "ask_created" boolean NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "autopilot_immune_reports_ran_idx"
  ON "autopilot_immune_reports" ("ran_at");
