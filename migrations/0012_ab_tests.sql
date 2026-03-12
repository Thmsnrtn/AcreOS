-- Migration: 0012_ab_tests.sql
-- Adds campaign_variants table for lightweight A/B split testing directly on campaigns.
-- Note: the heavier ab_tests / ab_test_variants tables were created in 0000.

CREATE TABLE IF NOT EXISTS "campaign_variants" (
  "id" serial PRIMARY KEY NOT NULL,
  "campaign_id" integer NOT NULL,
  "name" text NOT NULL,
  "subject" text,
  "body" text,
  "traffic_split" integer DEFAULT 50,
  "sent_count" integer DEFAULT 0,
  "open_count" integer DEFAULT 0,
  "click_count" integer DEFAULT 0,
  "response_count" integer DEFAULT 0,
  "is_winner" boolean DEFAULT false,
  "created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "campaign_variants"
  ADD CONSTRAINT "campaign_variants_campaign_id_campaigns_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id")
  ON DELETE cascade ON UPDATE no action;
