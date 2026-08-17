-- ============================================================================
-- 0235_va_tasks.sql — the VA subsystem's persistence layer, finally written.
-- ----------------------------------------------------------------------------
-- WHAT
-- ────
-- `va_tasks`  — one row per task assigned to a virtual assistant.
-- `va_sops`   — the ORG's own standard-operating-procedure library.
--
-- WHY
-- ───
-- `server/services/vaManagement.ts` declared its storage and stopped:
--
--     // IN-MEMORY STORE (replace with DB tables when schema migration is run)
--     const VA_TASKS_KEY = "va_tasks";
--     const SOP_LIBRARY_KEY = "sop_library";
--
-- Neither constant was ever read. `createTask` was a pure function returning its
-- input with an id stamped on; `POST /api/va/tasks` answered 200 with that
-- object and stored nothing. `GET /api/va/metrics` and `/api/va/audit-trail`
-- computed over `organizations.settings.va_tasks` — an array with NO CREATOR
-- anywhere in the repository — so they returned zeros and an empty trail that
-- read as measurements. `POST /api/va/tasks/:id/verify` read-modify-wrote the
-- same array and could never find a task in it.
--
-- BLOCKERS B9 recorded the state; the founder ruled on 2026-08-13: build it.
--
-- WHY TABLES AND NOT THE SETTINGS BLOB IT WAS AIMED AT
-- ───────────────────────────────────────────────────
-- `organizations.settings` is read on nearly every org-scoped request. An
-- unbounded task history inside it grows the hot path for every user forever,
-- and concurrent writers clobber each other — the verify handler already carries
-- a comment recording that exact bug being fixed once with `jsonb_set`. Tasks
-- are a queryable, filterable, paginated collection with per-row lifecycle.
--
-- WHY THE CONTEXT LINKS ARE `ON DELETE SET NULL`
-- ──────────────────────────────────────────────
-- A completed task is a record of work someone did, and it stays true after the
-- lead it was about is deleted. Cascading would delete the VA's logged hours
-- along with the lead. Tenant deletion still cascades through organization_id,
-- so customer-data deletion stays complete.
--
-- `note_id` is deliberately UNCONSTRAINED: two live note families exist
-- (`notes` and `acquired_notes`) and which is canonical is an open founder
-- decision (BLOCKERS B10). A constraint on the wrong one would have to be
-- dropped when that is answered.
--
-- `verified` IS NULLABLE ON PURPOSE: null = not reviewed, false = reviewed and
-- rejected. The endpoint could previously express neither.
--
-- MONEY POSTURE (founder ruling "be the rail, not the provider")
-- ─────────────────────────────────────────────────────────────
-- Nothing here moves, holds, collects or charges a cent.
--
-- MIRRORED
-- ────────
-- Mirrors shared/schema/va-tasks.ts. Registered in scripts/migrate.mjs.
-- Idempotent.
-- ============================================================================

CREATE TABLE IF NOT EXISTS "va_tasks" (
  "id"                    serial PRIMARY KEY,
  "organization_id"       integer NOT NULL
                            REFERENCES "organizations"("id") ON DELETE CASCADE,
  "assigned_to_user_id"   varchar  REFERENCES "users"("id") ON DELETE SET NULL,
  "assigned_by_user_id"   varchar  REFERENCES "users"("id") ON DELETE SET NULL,
  "title"                 text NOT NULL,
  "description"           text NOT NULL DEFAULT '',
  "category"              text NOT NULL DEFAULT 'other',
  "priority"              text NOT NULL DEFAULT 'medium',
  "status"                text NOT NULL DEFAULT 'pending',
  "lead_id"               integer REFERENCES "leads"("id") ON DELETE SET NULL,
  "property_id"           integer REFERENCES "properties"("id") ON DELETE SET NULL,
  "deal_id"               integer REFERENCES "deals"("id") ON DELETE SET NULL,
  "note_id"               integer,
  "sop_id"                text,
  "due_date"              timestamp,
  "estimated_minutes"     integer,
  "actual_minutes"        integer,
  "started_at"            timestamp,
  "completed_at"          timestamp,
  "completion_notes"      text,
  "attachment_urls"       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "loom_url"              text,
  "verified"              boolean,
  "verified_at"           timestamp,
  "verified_by_user_id"   varchar  REFERENCES "users"("id") ON DELETE SET NULL,
  "verification_notes"    text,
  "created_at"            timestamp NOT NULL DEFAULT now(),
  "updated_at"            timestamp NOT NULL DEFAULT now()
);

-- "This VA's queue, newest first" — the task-list read. Org-LEADING per the
-- shard-readiness invariant (scripts/check-org-leading-index.mjs).
CREATE INDEX IF NOT EXISTS "va_tasks_org_assignee_idx"
  ON "va_tasks" ("organization_id", "assigned_to_user_id", "created_at");

-- "This org's tasks in this state" — the metrics and audit-trail reads.
CREATE INDEX IF NOT EXISTS "va_tasks_org_status_idx"
  ON "va_tasks" ("organization_id", "status", "updated_at");

CREATE TABLE IF NOT EXISTS "va_sops" (
  "id"                          serial PRIMARY KEY,
  "organization_id"             integer NOT NULL
                                  REFERENCES "organizations"("id") ON DELETE CASCADE,
  "title"                       text NOT NULL,
  "category"                    text NOT NULL DEFAULT 'other',
  "description"                 text NOT NULL DEFAULT '',
  "steps"                       jsonb NOT NULL DEFAULT '[]'::jsonb,
  "estimated_minutes"           integer NOT NULL DEFAULT 0,
  "derived_from_default_title"  text,
  "created_by_user_id"          varchar REFERENCES "users"("id") ON DELETE SET NULL,
  "created_at"                  timestamp NOT NULL DEFAULT now(),
  "updated_at"                  timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "va_sops_org_category_idx"
  ON "va_sops" ("organization_id", "category", "title");
