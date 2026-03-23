CREATE TABLE IF NOT EXISTS "campaign_delivery_events" (
  "id" serial PRIMARY KEY,
  "campaign_id" integer NOT NULL REFERENCES "campaigns"("id"),
  "lead_id" integer NOT NULL REFERENCES "leads"("id"),
  "channel" text NOT NULL,
  "status" text NOT NULL DEFAULT 'sent',
  "sent_at" timestamp DEFAULT now(),
  "status_updated_at" timestamp DEFAULT now(),
  "metadata" jsonb
);

CREATE INDEX IF NOT EXISTS "idx_delivery_events_campaign" ON "campaign_delivery_events" ("campaign_id");
CREATE INDEX IF NOT EXISTS "idx_delivery_events_lead" ON "campaign_delivery_events" ("lead_id");
CREATE INDEX IF NOT EXISTS "idx_delivery_events_status" ON "campaign_delivery_events" ("status");
