-- Migration 0009: AI ad creative bundles
-- Stores GPT-4o copy variants + DALL-E 3 images generated before campaign deployment

CREATE TABLE IF NOT EXISTS "ad_creative_bundles" (
  "id"           varchar PRIMARY KEY DEFAULT gen_random_uuid(),
  "template_key" text NOT NULL,
  "campaign_id"  integer REFERENCES "growth_campaigns"("id") ON DELETE SET NULL,
  "status"       text NOT NULL DEFAULT 'generating',
  "copies"       jsonb,
  "images"       jsonb,
  "error"        text,
  "generated_at" timestamp DEFAULT now(),
  "model"        text DEFAULT 'gpt-4o'
);
