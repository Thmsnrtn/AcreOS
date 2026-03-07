-- Migration: add user_map_layer_preferences table for cross-device map layer persistence
CREATE TABLE IF NOT EXISTS "user_map_layer_preferences" (
  "id" serial PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "layer_id" integer NOT NULL REFERENCES "data_sources"("id") ON DELETE CASCADE,
  "enabled" boolean DEFAULT false NOT NULL,
  "opacity" numeric(4,2) DEFAULT '0.70' NOT NULL,
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "user_map_layer_prefs_user_idx" ON "user_map_layer_preferences" ("user_id");
CREATE INDEX IF NOT EXISTS "user_map_layer_prefs_unique_idx" ON "user_map_layer_preferences" ("user_id", "layer_id");
