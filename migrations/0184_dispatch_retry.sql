-- 0184 — Dispatch retry + DLQ (step-away gap #3).
-- Bounded, side-effect-aware retry for the Solene dispatch queue. attempts is
-- incremented at CLAIM time so it counts runs actually started; not_before_at
-- is the backoff gate the worker pull respects (NULL = claimable now). Only
-- failures proven to have occurred BEFORE any tool executed are requeued —
-- everything else stays terminal (at-most-once for outward effects).
-- Additive + idempotent.
ALTER TABLE "solene_dispatch_queue"
  ADD COLUMN IF NOT EXISTS "attempts" integer NOT NULL DEFAULT 0;
ALTER TABLE "solene_dispatch_queue"
  ADD COLUMN IF NOT EXISTS "not_before_at" timestamptz;
