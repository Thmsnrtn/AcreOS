-- ============================================================================
-- Index Audit Migration
-- Adds missing indexes on foreign keys, timestamp columns, and status/enum
-- columns that are commonly used in WHERE, ORDER BY, and JOIN clauses.
-- All statements are idempotent (CREATE INDEX IF NOT EXISTS).
-- ============================================================================

-- ============================================================================
-- SECTION 1: Core Business Tables — Foreign Keys & Filters
-- ============================================================================

-- ── leads ───────────────────────────────────────────────────────────────────
-- leads.assignedTo — used in WHERE filters for permission-scoped queries
CREATE INDEX IF NOT EXISTS "leads_assigned_to_idx"
  ON "leads" ("assigned_to");

-- leads.type — used in filtering seller vs buyer leads
CREATE INDEX IF NOT EXISTS "leads_type_idx"
  ON "leads" ("type");

-- leads.deletedAt — soft delete queries filter on IS NULL / IS NOT NULL
CREATE INDEX IF NOT EXISTS "leads_deleted_at_idx"
  ON "leads" ("deleted_at");

-- leads.nurturingStage — used for pipeline filtering
CREATE INDEX IF NOT EXISTS "leads_nurturing_stage_idx"
  ON "leads" ("nurturing_stage");

-- leads.nextFollowUpAt — used by follow-up due queries
CREATE INDEX IF NOT EXISTS "leads_next_follow_up_idx"
  ON "leads" ("next_follow_up_at");

-- Composite: org + assignedTo for permission-scoped list queries
CREATE INDEX IF NOT EXISTS "leads_org_assigned_idx"
  ON "leads" ("organization_id", "assigned_to");

-- Composite: org + deletedAt for soft-delete scoped lists (covers getLeads)
CREATE INDEX IF NOT EXISTS "leads_org_deleted_idx"
  ON "leads" ("organization_id", "deleted_at");

-- ── properties ──────────────────────────────────────────────────────────────
-- properties.sellerId — FK used in joins (deals -> properties -> seller lead)
CREATE INDEX IF NOT EXISTS "properties_seller_id_idx"
  ON "properties" ("seller_id");

-- properties.buyerId — FK used in joins
CREATE INDEX IF NOT EXISTS "properties_buyer_id_idx"
  ON "properties" ("buyer_id");

-- properties.county + state — used in geographic filtering
CREATE INDEX IF NOT EXISTS "properties_county_state_idx"
  ON "properties" ("county", "state");

-- properties.deletedAt — soft delete filter
CREATE INDEX IF NOT EXISTS "properties_deleted_at_idx"
  ON "properties" ("deleted_at");

-- ── deals ───────────────────────────────────────────────────────────────────
-- deals.propertyId — FK used in joins
CREATE INDEX IF NOT EXISTS "deals_property_id_idx"
  ON "deals" ("property_id");

-- deals.type — acquisition vs disposition filtering
CREATE INDEX IF NOT EXISTS "deals_type_idx"
  ON "deals" ("type");

-- deals.assignedTo — filtered in queries
CREATE INDEX IF NOT EXISTS "deals_assigned_to_idx"
  ON "deals" ("assigned_to");

-- deals.deletedAt — soft delete
CREATE INDEX IF NOT EXISTS "deals_deleted_at_idx"
  ON "deals" ("deleted_at");

-- deals.closingDate — used for pipeline/timeline queries
CREATE INDEX IF NOT EXISTS "deals_closing_date_idx"
  ON "deals" ("closing_date");

-- ============================================================================
-- SECTION 2: Campaign & Outreach Tables
-- ============================================================================

-- ── campaign_responses ──────────────────────────────────────────────────────
-- campaignResponses.campaignId — FK, used in campaign analytics joins
CREATE INDEX IF NOT EXISTS "campaign_responses_campaign_id_idx"
  ON "campaign_responses" ("campaign_id");

-- campaignResponses.leadId — FK
CREATE INDEX IF NOT EXISTS "campaign_responses_lead_id_idx"
  ON "campaign_responses" ("lead_id");

-- campaignResponses.organizationId — tenant scoping
CREATE INDEX IF NOT EXISTS "campaign_responses_org_idx"
  ON "campaign_responses" ("organization_id");

-- ── campaign_delivery_events ────────────────────────────────────────────────
-- campaignDeliveryEvents.campaignId — FK, analytics lookups
CREATE INDEX IF NOT EXISTS "campaign_delivery_campaign_idx"
  ON "campaign_delivery_events" ("campaign_id");

-- campaignDeliveryEvents.leadId — FK
CREATE INDEX IF NOT EXISTS "campaign_delivery_lead_idx"
  ON "campaign_delivery_events" ("lead_id");

-- campaignDeliveryEvents.status — filtering by delivery status
CREATE INDEX IF NOT EXISTS "campaign_delivery_status_idx"
  ON "campaign_delivery_events" ("status");

-- Composite: campaignId + status for per-campaign delivery breakdown
CREATE INDEX IF NOT EXISTS "campaign_delivery_campaign_status_idx"
  ON "campaign_delivery_events" ("campaign_id", "status");

-- ── campaign_optimizations ──────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "campaign_optimizations_campaign_idx"
  ON "campaign_optimizations" ("campaign_id");

CREATE INDEX IF NOT EXISTS "campaign_optimizations_org_idx"
  ON "campaign_optimizations" ("organization_id");

-- ============================================================================
-- SECTION 3: High-Volume Event/Log Tables
-- ============================================================================

-- ── activity_log ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "activity_log_org_idx"
  ON "activity_log" ("organization_id");

CREATE INDEX IF NOT EXISTS "activity_log_entity_idx"
  ON "activity_log" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "activity_log_created_at_idx"
  ON "activity_log" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "activity_log_org_created_idx"
  ON "activity_log" ("organization_id", "created_at" DESC);

-- ── agent_events ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "agent_events_org_idx"
  ON "agent_events" ("organization_id");

CREATE INDEX IF NOT EXISTS "agent_events_type_idx"
  ON "agent_events" ("event_type");

CREATE INDEX IF NOT EXISTS "agent_events_created_at_idx"
  ON "agent_events" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "agent_events_org_created_idx"
  ON "agent_events" ("organization_id", "created_at" DESC);

-- ── ai_telemetry_events ─────────────────────────────────────────────────────
-- (already has org, created_at, provider indexes from schema)
-- Add task_type index for filtering analytics by task
CREATE INDEX IF NOT EXISTS "ai_telemetry_task_type_idx"
  ON "ai_telemetry_events" ("task_type");

-- Composite: org + taskType for per-org cost breakdown queries
CREATE INDEX IF NOT EXISTS "ai_telemetry_org_task_idx"
  ON "ai_telemetry_events" ("organization_id", "task_type");

-- ── usage_events ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "usage_events_org_idx"
  ON "usage_events" ("organization_id");

CREATE INDEX IF NOT EXISTS "usage_events_type_idx"
  ON "usage_events" ("event_type");

CREATE INDEX IF NOT EXISTS "usage_events_created_at_idx"
  ON "usage_events" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "usage_events_org_created_idx"
  ON "usage_events" ("organization_id", "created_at" DESC);

-- ── usage_records ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "usage_records_org_idx"
  ON "usage_records" ("organization_id");

CREATE INDEX IF NOT EXISTS "usage_records_billing_month_idx"
  ON "usage_records" ("billing_month");

CREATE INDEX IF NOT EXISTS "usage_records_org_billing_idx"
  ON "usage_records" ("organization_id", "billing_month");

-- ── credit_transactions ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "credit_transactions_org_idx"
  ON "credit_transactions" ("organization_id");

CREATE INDEX IF NOT EXISTS "credit_transactions_created_at_idx"
  ON "credit_transactions" ("created_at" DESC);

-- ── outcome_telemetry ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "outcome_telemetry_org_idx"
  ON "outcome_telemetry" ("organization_id");

CREATE INDEX IF NOT EXISTS "outcome_telemetry_type_idx"
  ON "outcome_telemetry" ("outcome_type");

CREATE INDEX IF NOT EXISTS "outcome_telemetry_created_at_idx"
  ON "outcome_telemetry" ("created_at" DESC);

-- ── audit_log ───────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "audit_log_org_idx"
  ON "audit_log" ("organization_id");

CREATE INDEX IF NOT EXISTS "audit_log_entity_idx"
  ON "audit_log" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "audit_log_created_at_idx"
  ON "audit_log" ("created_at" DESC);

CREATE INDEX IF NOT EXISTS "audit_log_user_idx"
  ON "audit_log" ("user_id");

-- ── activity_events ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "activity_events_org_idx"
  ON "activity_events" ("organization_id");

CREATE INDEX IF NOT EXISTS "activity_events_entity_idx"
  ON "activity_events" ("entity_type", "entity_id");

CREATE INDEX IF NOT EXISTS "activity_events_event_date_idx"
  ON "activity_events" ("event_date" DESC);

CREATE INDEX IF NOT EXISTS "activity_events_org_entity_idx"
  ON "activity_events" ("organization_id", "entity_type", "entity_id");

-- ============================================================================
-- SECTION 4: Notifications
-- ============================================================================

-- ── notifications ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "notifications_org_idx"
  ON "notifications" ("organization_id");

CREATE INDEX IF NOT EXISTS "notifications_user_idx"
  ON "notifications" ("user_id");

CREATE INDEX IF NOT EXISTS "notifications_is_read_idx"
  ON "notifications" ("is_read");

CREATE INDEX IF NOT EXISTS "notifications_created_at_idx"
  ON "notifications" ("created_at" DESC);

-- Most common query: user's unread notifications, sorted by recency
CREATE INDEX IF NOT EXISTS "notifications_user_unread_idx"
  ON "notifications" ("user_id", "is_read", "created_at" DESC);

-- ============================================================================
-- SECTION 5: Conversation & Messaging Tables
-- ============================================================================

-- ── conversations ───────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "conversations_org_idx"
  ON "conversations" ("organization_id");

CREATE INDEX IF NOT EXISTS "conversations_lead_idx"
  ON "conversations" ("lead_id");

CREATE INDEX IF NOT EXISTS "conversations_status_idx"
  ON "conversations" ("status");

-- ── messages ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "messages_conversation_idx"
  ON "messages" ("conversation_id");

CREATE INDEX IF NOT EXISTS "messages_org_idx"
  ON "messages" ("organization_id");

CREATE INDEX IF NOT EXISTS "messages_created_at_idx"
  ON "messages" ("created_at" DESC);

-- ============================================================================
-- SECTION 6: Lead Sub-Tables (FK indexes)
-- ============================================================================

-- ── lead_activities ─────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "lead_activities_lead_idx"
  ON "lead_activities" ("lead_id");

CREATE INDEX IF NOT EXISTS "lead_activities_org_idx"
  ON "lead_activities" ("organization_id");

CREATE INDEX IF NOT EXISTS "lead_activities_created_at_idx"
  ON "lead_activities" ("created_at" DESC);

-- ── lead_score_history ──────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "lead_score_history_lead_idx"
  ON "lead_score_history" ("lead_id");

CREATE INDEX IF NOT EXISTS "lead_score_history_org_idx"
  ON "lead_score_history" ("organization_id");

-- ── lead_conversions ────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "lead_conversions_lead_idx"
  ON "lead_conversions" ("lead_id");

CREATE INDEX IF NOT EXISTS "lead_conversions_org_idx"
  ON "lead_conversions" ("organization_id");

-- ============================================================================
-- SECTION 7: Finance Tables
-- ============================================================================

-- ── notes (seller finance) — notes.propertyId FK
CREATE INDEX IF NOT EXISTS "notes_property_idx"
  ON "notes" ("property_id");

-- ── payments — payments.organizationId for tenant scoping
CREATE INDEX IF NOT EXISTS "payments_org_idx"
  ON "note_payments" ("organization_id");

-- ── tax_escrow_payments ─────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "tax_escrow_payments_note_idx"
  ON "tax_escrow_payments" ("note_id");

CREATE INDEX IF NOT EXISTS "tax_escrow_payments_org_idx"
  ON "tax_escrow_payments" ("organization_id");

-- ── payment_reminders ───────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "payment_reminders_note_idx"
  ON "payment_reminders" ("note_id");

CREATE INDEX IF NOT EXISTS "payment_reminders_org_idx"
  ON "payment_reminders" ("organization_id");

-- ============================================================================
-- SECTION 8: Other Multi-Tenant Tables Missing org_id Indexes
-- ============================================================================

-- ── team_members ────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "team_members_org_idx"
  ON "team_members" ("organization_id");

-- ── organization_integrations ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "org_integrations_org_idx"
  ON "organization_integrations" ("organization_id");

-- ── borrower_payment_profiles ───────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "borrower_profiles_org_idx"
  ON "borrower_payment_profiles" ("organization_id");

CREATE INDEX IF NOT EXISTS "borrower_profiles_lead_idx"
  ON "borrower_payment_profiles" ("lead_id");

-- ── sequence_enrollments ────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS "sequence_enrollments_org_idx"
  ON "sequence_enrollments" ("organization_id");

CREATE INDEX IF NOT EXISTS "sequence_enrollments_lead_idx"
  ON "sequence_enrollments" ("lead_id");

-- ============================================================================
-- SECTION 9: Schema Consolidation Notes (comments only, no drops)
-- ============================================================================

-- FINDING: The following tables are defined in the schema but have ZERO
-- references in server code. They should be reviewed for potential removal
-- in a future migration after confirming no client code depends on them:
--
--   1. model_calibration_log   — defined as modelCalibrationLog, never queried
--   2. maintenance_requests    — defined as maintenanceRequests, never queried
--   3. shared_deal_links       — defined as sharedDealLinks, never queried
--   4. webhook_deliveries      — defined as webhookDeliveries, never queried
--   5. market_indicators_temp  — defined as marketIndicatorsDuplicate, never queried
--                                (name itself suggests it was a temporary copy)
--
-- FINDING: Near-duplicate logging tables that track overlapping concepts:
--
--   activity_log     — general activity log (who did what to which entity)
--   activity_events  — unified timeline for leads/properties/deals
--   audit_log        — compliance audit trail with IP/user-agent
--
--   These three tables have similar schemas (org_id, entity_type, entity_id,
--   action/event_type, metadata, created_at). Consider consolidating into a
--   single unified event table with a "category" or "source" discriminator.
--
--   Similarly:
--   - agent_events + outcome_telemetry overlap in tracking AI system outcomes
--   - usage_events + usage_records both track billable actions (usage_records
--     adds cost info; usage_events may be redundant)
--
-- ACTION: No tables are dropped. These findings are documented for future
-- schema consolidation planning.
