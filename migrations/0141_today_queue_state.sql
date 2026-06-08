-- ============================================================================
-- 0141 — Maren (CPO) #2 "Make /today a habit loop, not a digest"
--   Durable resolution ledger for the derived Decision Queue.
-- ----------------------------------------------------------------------------
-- The /today Decision Queue is computed each request from leads / deals /
-- observations / tasks (server/routes-today.ts) — its items are SYNTHETIC, with
-- no row to flip "done" on. To let the operator resolve an item *in place* and
-- shrink the queue toward the rewarding "you're clear for today" zero-state, we
-- persist resolutions here, one row per (organization_id, item_id):
--
--   * status "done"      — handled in place; hide permanently.
--   * status "dismissed" — not relevant; hide permanently.
--   * status "snoozed"   — hide until snoozed_until, then re-surface.
--
-- `item_id` is the SAME synthetic string the queue builder emits
-- (e.g. "stale-lead-42", "priority-follow-up"). It is intentionally NOT a FK —
-- the underlying object may be a lead, deal, observation, task, or a purely
-- computed priority with no row at all.
--
-- Unique (organization_id, item_id) so PATCH upserts cleanly and the GET
-- subtract is a single per-tenant index probe (Tahoe shard-readiness /
-- scripts/check-org-leading-index.mjs).
--
-- Mirrors shared/schema.ts (todayQueueState) + scripts/migrate.mjs STATEMENTS.
-- Idempotent (IF NOT EXISTS) — safe to re-run.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "today_queue_state" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations" ("id") ON DELETE CASCADE,
  "item_id" text NOT NULL,
  "status" text NOT NULL,
  "snoozed_until" timestamp,
  "resolved_by" text,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "today_queue_state_org_item_idx"
  ON "today_queue_state" ("organization_id", "item_id");
