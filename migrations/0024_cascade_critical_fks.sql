-- Fix: Add ON DELETE CASCADE/SET NULL to critical foreign keys (P0)
-- Strategy: CASCADE for child records, SET NULL for optional references
-- Only the most critical relationships — bulk migration for all 400 FKs is too risky

-- ─── Organization-owned entities: CASCADE ────────────────────────────────
-- When an org is deleted, all its data should go with it

ALTER TABLE "team_members" DROP CONSTRAINT IF EXISTS "team_members_organization_id_organizations_id_fk";
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_organization_id_organizations_id_fk";
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "properties" DROP CONSTRAINT IF EXISTS "properties_organization_id_organizations_id_fk";
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_organization_id_organizations_id_fk";
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_organization_id_organizations_id_fk";
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "campaigns" DROP CONSTRAINT IF EXISTS "campaigns_organization_id_organizations_id_fk";
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

ALTER TABLE "credit_transactions" DROP CONSTRAINT IF EXISTS "credit_transactions_organization_id_organizations_id_fk";
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk"
  FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE;

-- ─── Child records: CASCADE with parent ──────────────────────────────────

-- Payments belong to notes — if note deleted, payments are meaningless
ALTER TABLE "payments" DROP CONSTRAINT IF EXISTS "payments_note_id_notes_id_fk";
ALTER TABLE "payments" ADD CONSTRAINT "payments_note_id_notes_id_fk"
  FOREIGN KEY ("note_id") REFERENCES "notes"("id") ON DELETE CASCADE;

-- Lead activities belong to leads
ALTER TABLE "lead_activities" DROP CONSTRAINT IF EXISTS "lead_activities_lead_id_leads_id_fk";
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk"
  FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE CASCADE;

-- Campaign responses belong to campaigns
ALTER TABLE "campaign_responses" DROP CONSTRAINT IF EXISTS "campaign_responses_campaign_id_campaigns_id_fk";
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_campaign_id_campaigns_id_fk"
  FOREIGN KEY ("campaign_id") REFERENCES "campaigns"("id") ON DELETE CASCADE;

-- Messages belong to conversations
ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "messages_conversation_id_conversations_id_fk";
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE;

-- AI messages belong to AI conversations
ALTER TABLE "ai_messages" DROP CONSTRAINT IF EXISTS "ai_messages_conversation_id_ai_conversations_id_fk";
ALTER TABLE "ai_messages" ADD CONSTRAINT "ai_messages_conversation_id_ai_conversations_id_fk"
  FOREIGN KEY ("conversation_id") REFERENCES "ai_conversations"("id") ON DELETE CASCADE;

-- ─── Optional references: SET NULL ───────────────────────────────────────

-- Notes may reference a property — if property deleted, note remains
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_property_id_properties_id_fk";
ALTER TABLE "notes" ADD CONSTRAINT "notes_property_id_properties_id_fk"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE SET NULL;

-- Notes may reference a borrower (lead) — if lead deleted, note remains
ALTER TABLE "notes" DROP CONSTRAINT IF EXISTS "notes_borrower_id_leads_id_fk";
ALTER TABLE "notes" ADD CONSTRAINT "notes_borrower_id_leads_id_fk"
  FOREIGN KEY ("borrower_id") REFERENCES "leads"("id") ON DELETE SET NULL;

-- Deals require property — prevent property deletion if deals exist
ALTER TABLE "deals" DROP CONSTRAINT IF EXISTS "deals_property_id_properties_id_fk";
ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_properties_id_fk"
  FOREIGN KEY ("property_id") REFERENCES "properties"("id") ON DELETE RESTRICT;
