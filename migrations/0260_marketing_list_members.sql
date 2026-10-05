-- 0260 — which leads a marketing list holds (W10.3 list builder behind the
-- Map door). A marketing_lists row carried only import metadata, so nothing
-- could say who was on a list. A county list saved from the list builder
-- links each parcel it holds to a lead (existing live lead, or one created
-- for it). One membership per (list, lead); deleting a list or hard-erasing
-- a lead removes its memberships. Org-leading index for the per-tenant reads.
CREATE TABLE IF NOT EXISTS "marketing_list_members" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id"),
  "list_id" integer NOT NULL REFERENCES "marketing_lists"("id") ON DELETE CASCADE,
  "lead_id" integer NOT NULL REFERENCES "leads"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "marketing_list_members_list_lead_uidx" ON "marketing_list_members" ("list_id", "lead_id");
CREATE INDEX IF NOT EXISTS "marketing_list_members_org_list_idx" ON "marketing_list_members" ("organization_id", "list_id");
