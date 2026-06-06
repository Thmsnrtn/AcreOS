-- 0112_tenant_theme_and_ui_state.sql
-- Tahoe E5 + E6 (Krieger horizon recs)
--
-- E5 — per-tenant theming on organizations. First-party org-level brand
-- affordances (distinct from white_label_configs reseller tenants): an accent
-- color, a logo URL, and a density preference. Applied client-side by
-- TenantThemeProvider as CSS custom properties / data-attributes — never
-- hardcoded colors. All nullable so legacy orgs render the default theme.
--
-- E6 — server-backed UI state. Durable home for per-user UI preferences
-- (collapsed panels, view toggles, dismissed banners) keyed by
-- (organization_id, user_id, key) so they follow a user across devices.

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand_accent_color" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand_logo_url" text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "brand_density" text;

CREATE TABLE IF NOT EXISTS "ui_state" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "key" text NOT NULL,
  "value" jsonb NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL
);

-- Leading-org composite uniqueness — one row per (org, user, key). The
-- useUiState hook upserts on this constraint; the leading org column also
-- satisfies the L3 shard-readiness lint (check-org-leading-index.mjs).
CREATE UNIQUE INDEX IF NOT EXISTS "ui_state_org_user_key_idx"
  ON "ui_state" ("organization_id", "user_id", "key");
