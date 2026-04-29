-- Phase B.5 (port directive): user-scoped appearance preferences.
-- Drives the 5-theme × light/dark + 5-font-pairing + density + motion system
-- defined in shared/models/auth.ts AppearancePreferences and client-side
-- ThemeConfig (client/src/contexts/theme-context.tsx).
--
-- NULL in any field falls back to client defaults (homestead / auto / editorial
-- / adaptive / motion honors prefers-reduced-motion). The whole column is
-- nullable so existing users get defaults transparently.

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "appearance_preferences" jsonb;
