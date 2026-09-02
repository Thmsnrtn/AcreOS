-- 0250 — Pax controls (customer autonomy clarity program, 2026-09-02).
-- Spec: docs/autonomous/AUTONOMY_SPEC.md §4.1 (numbered 0248 there; 0248 and
-- 0249 were taken by the time it shipped). Authoritative copy runs from
-- scripts/migrate.mjs (Fly release_command); this file is the mirror that a
-- rebuild from migrations/*.sql applies. Every statement is idempotent.

-- organizations.pax_controls — the customer's stance + three switches.
-- NULL reads as the defaults in shared/pax-controls.ts (equal to today's live
-- behaviour), so this deploy changes nothing silently.
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "pax_controls" jsonb;

-- pending_actions gains where-from and why. Nullable; older rows have none.
ALTER TABLE "pending_actions" ADD COLUMN IF NOT EXISTS "origin" text;
ALTER TABLE "pending_actions" ADD COLUMN IF NOT EXISTS "source_ref" jsonb;
ALTER TABLE "pending_actions" ADD COLUMN IF NOT EXISTS "reason" text;

-- Backfill: an org that had switched Inbox drafts OFF under the old
-- aiSettings.paxDraftEnabled keeps them off. Only rows still NULL are touched.
UPDATE "organizations"
   SET "pax_controls" = jsonb_build_object(
         'stance', 'ask_before_sending',
         'leadScoring', true,
         'borrowerReminders', true,
         'inboxDrafts', false)
 WHERE "pax_controls" IS NULL
   AND "settings"->'aiSettings'->>'paxDraftEnabled' = 'false';

-- The "autonomy matrix" flag (seeded by 0029) gated a founder-only panel whose
-- fields had no server reader; the panel is deleted by this program (spec §3d).
DELETE FROM "platform_feature_flags" WHERE "key" = 'feature.autonomy-matrix';

-- users.autonomy_preferences narrows to the pause alone (shared/models/auth.ts).
-- pax.pausedUntil is kept exactly as stored — it is the live kill switch.
UPDATE "users"
   SET "autonomy_preferences" = jsonb_strip_nulls(
         jsonb_build_object('pax', jsonb_build_object(
           'pausedUntil', "autonomy_preferences"->'pax'->'pausedUntil'))),
       "updated_at" = now()
 WHERE "autonomy_preferences" IS NOT NULL
   AND (
     "autonomy_preferences" ?| ARRAY['atlas', 'sophie', 'timeGuards']
     OR COALESCE("autonomy_preferences"->'pax', '{}'::jsonb)
          ?| ARRAY['level', 'perAction', 'thresholdsCents']
   );
