-- JC#14: promote per-agent autonomy matrix out of users.appearance_preferences
-- into its own users.autonomy_preferences jsonb column.
--
-- Why: appearance_preferences is theme/font/density/motion — visual preference.
-- Autonomy is operational policy (per-agent levels, monetary thresholds, time
-- guards). Coupling the two forced every appearance write to round-trip the
-- autonomy blob and vice-versa, and the type definitions drifted apart.
-- Splitting the column lets each domain evolve independently and gives agents
-- a narrower read surface at action time.
--
-- Backfill copies existing autonomy data into the new column, then strips the
-- key from appearance_preferences. Migration is idempotent — re-running on a
-- row that's already split is a no-op.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "autonomy_preferences" jsonb;

UPDATE "users"
   SET "autonomy_preferences" = "appearance_preferences"->'autonomy'
 WHERE "appearance_preferences" ? 'autonomy'
   AND "autonomy_preferences" IS NULL;

UPDATE "users"
   SET "appearance_preferences" = "appearance_preferences" - 'autonomy'
 WHERE "appearance_preferences" ? 'autonomy';
