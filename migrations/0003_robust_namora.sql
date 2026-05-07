CREATE TABLE "ad_creative_bundles" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_key" text NOT NULL,
	"campaign_id" integer,
	"status" text DEFAULT 'generating' NOT NULL,
	"copies" jsonb,
	"images" jsonb,
	"error" text,
	"generated_at" timestamp DEFAULT now(),
	"model" text DEFAULT 'gpt-4o'
);
--> statement-breakpoint
CREATE TABLE "ai_model_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text DEFAULT 'openrouter' NOT NULL,
	"model_id" text NOT NULL,
	"display_name" text NOT NULL,
	"cost_per_million_input" numeric(10, 4),
	"cost_per_million_output" numeric(10, 4),
	"max_tokens" integer DEFAULT 4096,
	"task_types" text[] DEFAULT '{}',
	"weight" integer DEFAULT 50,
	"enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_telemetry_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"task_type" text NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_tokens" integer,
	"completion_tokens" integer,
	"total_tokens" integer,
	"estimated_cost_cents" numeric,
	"latency_ms" integer,
	"cache_hit" boolean DEFAULT false,
	"complexity" text,
	"success" boolean DEFAULT true,
	"error_message" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "auto_bid_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"states" jsonb,
	"counties" jsonb,
	"min_acres" numeric,
	"max_acres" numeric,
	"property_types" jsonb,
	"max_bid_amount" numeric NOT NULL,
	"bid_strategy" text NOT NULL,
	"bid_percentage" numeric,
	"increment_amount" numeric,
	"min_distress_score" integer,
	"require_tax_delinquent" boolean DEFAULT false,
	"requires_approval" boolean DEFAULT true,
	"approval_threshold" numeric,
	"monthly_budget" numeric,
	"current_month_spent" numeric DEFAULT '0',
	"bids_placed" integer DEFAULT 0,
	"bids_won" integer DEFAULT 0,
	"total_spent" numeric DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "background_check_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"investor_profile_id" integer NOT NULL,
	"provider" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"risk_level" text,
	"report_data" jsonb,
	"checked_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "background_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"max_attempts" integer DEFAULT 3 NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"error" text,
	"result" jsonb,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "borrower_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"org_id" integer NOT NULL,
	"sender_type" text NOT NULL,
	"content" text NOT NULL,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_behavior_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"anonymous_id" text NOT NULL,
	"event_type" text NOT NULL,
	"property_type" text,
	"acreage_range" text,
	"price_range" text,
	"state" text,
	"county" text,
	"event_date" timestamp DEFAULT now() NOT NULL,
	"metadata" jsonb
);
--> statement-breakpoint
CREATE TABLE "campaign_leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"campaign_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"organization_id" integer,
	"status" text DEFAULT 'pending',
	"scheduled_at" timestamp,
	"sent_at" timestamp,
	"touch_number" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_variants" (
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
CREATE TABLE "capital_raises" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"target_amount" numeric NOT NULL,
	"raised_amount" numeric DEFAULT '0',
	"min_investment" numeric NOT NULL,
	"offering_type" text NOT NULL,
	"return_structure" text,
	"target_return" numeric,
	"hold_period" integer,
	"property_ids" jsonb,
	"investor_count" integer DEFAULT 0,
	"investors" jsonb,
	"status" text NOT NULL,
	"start_date" timestamp,
	"end_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "certificate_verification" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"certification_id" integer,
	"recipient_name" text NOT NULL,
	"recipient_email" text,
	"cert_type" text NOT NULL,
	"issued_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"public_url" text,
	"verification_hash" text,
	"is_revoked" boolean DEFAULT false,
	"revoked_at" timestamp,
	"revoked_reason" text,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "certificate_verification_verification_hash_unique" UNIQUE("verification_hash")
);
--> statement-breakpoint
CREATE TABLE "churn_risk_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"risk_score" integer NOT NULL,
	"risk_band" text NOT NULL,
	"login_frequency_score" integer,
	"feature_usage_score" integer,
	"support_ticket_score" integer,
	"dunning_state_score" integer,
	"engagement_trend_score" integer,
	"days_since_last_active" integer,
	"logins_last_14d" integer,
	"tickets_last_30d" integer,
	"dunning_stage" text,
	"feature_usage_trend" text,
	"last_intervention_at" timestamp,
	"last_intervention_type" text,
	"intervention_count" integer DEFAULT 0,
	"next_intervention_at" timestamp,
	"next_intervention_type" text,
	"scored_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"regulatory_change_id" integer,
	"alert_type" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"action_required" text,
	"deadline" timestamp,
	"status" text DEFAULT 'pending',
	"acknowledged_at" timestamp,
	"acknowledged_by" text,
	"resolved_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_checklist_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer,
	"requirement_id" integer,
	"item_title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"due_date" timestamp,
	"completed_at" timestamp,
	"completed_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cost_basis" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"acquisition_date" timestamp,
	"acquisition_price" numeric,
	"acquisition_costs" numeric,
	"improvement_costs" numeric,
	"adjusted_basis" numeric,
	"disposition_date" timestamp,
	"disposition_price" numeric,
	"gain_loss" numeric,
	"holding_period" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "county_markets" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"median_price_per_acre" numeric,
	"recent_sales_count" integer DEFAULT 0,
	"avg_days_on_market" integer,
	"price_change_percent" numeric,
	"investor_demand_score" integer,
	"last_updated" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "course_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" integer NOT NULL,
	"completed_modules" jsonb,
	"progress_percentage" numeric DEFAULT '0',
	"is_completed" boolean DEFAULT false,
	"completed_at" timestamp,
	"certificate_issued" boolean DEFAULT false,
	"certificate_url" text,
	"amount_paid" numeric,
	"payment_status" text,
	"last_accessed_at" timestamp,
	"total_time_minutes" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "course_modules" (
	"id" serial PRIMARY KEY NOT NULL,
	"course_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"content_type" text NOT NULL,
	"video_url" text,
	"content" text,
	"sort_order" integer NOT NULL,
	"duration_minutes" integer,
	"is_preview" boolean DEFAULT false,
	"required_score" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "courses" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"difficulty_level" integer,
	"thumbnail_url" text,
	"preview_video_url" text,
	"module_count" integer DEFAULT 0,
	"total_duration_minutes" integer,
	"price" numeric NOT NULL,
	"discounted_price" numeric,
	"instructor_name" text,
	"instructor_bio" text,
	"is_published" boolean DEFAULT false,
	"published_at" timestamp,
	"enrollment_count" integer DEFAULT 0,
	"completion_rate" numeric,
	"avg_rating" numeric,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scraped_deal_id" integer NOT NULL,
	"auto_bid_rule_id" integer,
	"alert_type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"message" text NOT NULL,
	"action_required" boolean DEFAULT false,
	"action_url" text,
	"sent_at" timestamp,
	"read_at" timestamp,
	"dismissed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_room_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_room_id" integer NOT NULL,
	"uploaded_by" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"version" integer DEFAULT 1 NOT NULL,
	"previous_version_id" integer,
	"access_control" jsonb DEFAULT '{"allowedUserIds":[]}'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_room_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_room_id" integer NOT NULL,
	"sender_id" text NOT NULL,
	"sender_name" text NOT NULL,
	"content" text NOT NULL,
	"message_type" text DEFAULT 'text' NOT NULL,
	"attachment_url" text,
	"is_read" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_rooms" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer,
	"participants" jsonb NOT NULL,
	"deal_type" text,
	"agreed_price" numeric,
	"deal_terms" text,
	"status" text DEFAULT 'active' NOT NULL,
	"shared_documents" jsonb,
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"source_type" text NOT NULL,
	"state" text NOT NULL,
	"county" text,
	"base_url" text NOT NULL,
	"scraping_config" jsonb,
	"is_active" boolean DEFAULT true,
	"last_scraped" timestamp,
	"last_successful" timestamp,
	"consecutive_failures" integer DEFAULT 0,
	"avg_deals_per_scrape" numeric,
	"total_deals_found" integer DEFAULT 0,
	"conversion_rate" numeric,
	"priority" integer DEFAULT 50,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "decisions_inbox_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"item_type" text NOT NULL,
	"risk_level" text DEFAULT 'medium' NOT NULL,
	"urgency_score" integer DEFAULT 50 NOT NULL,
	"estimated_impact_cents" integer,
	"sophie_analysis" text NOT NULL,
	"sophie_confidence_score" integer,
	"recommended_action" text NOT NULL,
	"recommended_action_label" text NOT NULL,
	"action_payload" jsonb,
	"source_ticket_id" integer,
	"source_alert_id" integer,
	"source_feature_request_id" integer,
	"organization_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"deferred_until" timestamp,
	"resolved_at" timestamp,
	"resolved_by" text,
	"founder_override_action" text,
	"context_bundle" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "demand_heatmaps" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"demand_score" integer NOT NULL,
	"view_count" integer DEFAULT 0,
	"inquiry_count" integer DEFAULT 0,
	"bid_count" integer DEFAULT 0,
	"purchase_count" integer DEFAULT 0,
	"avg_bid_to_ask_ratio" numeric,
	"competition_level" text,
	"demand_trend" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "depreciation_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"method" text NOT NULL,
	"land_value" numeric,
	"improvement_value" numeric,
	"total_cost" numeric,
	"useful_life_years" integer,
	"annual_depreciation" numeric,
	"accumulated_depreciation" numeric,
	"remaining_basis" numeric,
	"start_date" timestamp,
	"end_date" timestamp,
	"schedule_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"settlement_id" integer,
	"event_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"balance_before" numeric NOT NULL,
	"balance_after" numeric NOT NULL,
	"metadata" jsonb,
	"performed_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "fee_payout_schedules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"cadence" text NOT NULL,
	"minimum_payout_amount" numeric DEFAULT '0',
	"stripe_connected_account_id" text,
	"next_payout_at" timestamp,
	"last_payout_at" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
-- ============================================================================
-- ⚠ STALE — DO NOT TRUST THIS SHAPE.
-- ============================================================================
-- The two CREATE TABLE statements below (field_scout_photos, field_scout_visits)
-- drifted from shared/schema.ts well before the schema-drift §3 sweep. They are
-- preserved here for historical/journal-integrity reasons but the CANONICAL
-- shape is created by scripts/migrate.mjs (lines 1290-1329 as of 2026-05-06),
-- which is derived directly from shared/schema.ts.
--
-- Specific drifts vs. canonical:
--   field_scout_photos: missing organization_id, url, caption; declares
--     filename/mime_type/size_bytes/captured_at that aren't in schema.ts.
--   field_scout_visits: missing organization_id, status, started_at,
--     completed_at, updated_at; declares duration/checklist_results that
--     aren't in schema.ts. Lat/long types differ (numeric vs real).
--
-- See: shared/schema-migration-guide.md → "Drift catalog" for full context
-- and the cutover plan. Do not edit in place — Drizzle journal records this
-- migration as applied; mutation risks a journal-hash mismatch.
-- ============================================================================
CREATE TABLE "field_scout_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"visit_id" integer,
	"lead_id" integer NOT NULL,
	"filename" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"latitude" numeric,
	"longitude" numeric,
	"captured_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "field_scout_visits" (
	"id" serial PRIMARY KEY NOT NULL,
	"visitor_id" text NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"latitude" numeric NOT NULL,
	"longitude" numeric NOT NULL,
	"duration" integer,
	"notes" text,
	"checklist_results" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "founder_ad_accounts" (
	"id" serial PRIMARY KEY NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"ad_account_id" text NOT NULL,
	"access_token" text NOT NULL,
	"pixel_id" text,
	"app_id" text,
	"app_secret" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "founder_digest_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"digest_date" timestamp NOT NULL,
	"delivered_at" timestamp,
	"delivery_status" text DEFAULT 'pending' NOT NULL,
	"revenue_bullet" text,
	"system_health_bullet" text,
	"support_activity_bullet" text,
	"top_at_risk_bullet" text,
	"recommended_action_bullet" text,
	"data_snapshot" jsonb,
	"mrr_cents" integer,
	"open_decisions" integer,
	"sophie_auto_resolved_24h" integer,
	"job_failures_24h" integer,
	"at_risk_orgs" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"label" text NOT NULL,
	"goal_type" text NOT NULL,
	"target_value" numeric(14, 2) NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "growth_campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"platform" text DEFAULT 'meta' NOT NULL,
	"template_key" text NOT NULL,
	"external_campaign_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"daily_budget_cents" integer DEFAULT 2000 NOT NULL,
	"target_countries" jsonb DEFAULT '["US"]'::jsonb NOT NULL,
	"total_spend_cents" integer DEFAULT 0 NOT NULL,
	"impressions" integer DEFAULT 0 NOT NULL,
	"clicks" integer DEFAULT 0 NOT NULL,
	"signups" integer DEFAULT 0 NOT NULL,
	"conversions" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investor_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"display_name" text NOT NULL,
	"bio" text,
	"location" text,
	"website" text,
	"specialties" jsonb,
	"preferred_states" jsonb,
	"investment_range" jsonb,
	"is_verified" boolean DEFAULT false,
	"verified_at" timestamp,
	"verification_documents" jsonb,
	"deals_closed" integer DEFAULT 0,
	"avg_response_time_hours" numeric,
	"reliability_score" numeric,
	"rating" numeric,
	"review_count" integer DEFAULT 0,
	"last_active_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "investor_profiles_organization_id_unique" UNIQUE("organization_id")
);
--> statement-breakpoint
CREATE TABLE "investor_verification_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"investor_profile_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"file_name" text NOT NULL,
	"file_url" text NOT NULL,
	"file_size" integer,
	"mime_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"rejection_reason" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "investor_verification_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"investor_profile_id" integer NOT NULL,
	"previous_status" text,
	"new_status" text NOT NULL,
	"changed_by" text NOT NULL,
	"reason" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_health_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"run_started_at" timestamp NOT NULL,
	"run_completed_at" timestamp,
	"duration_ms" integer,
	"status" text NOT NULL,
	"error_message" text,
	"run_metrics" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "land_credit_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"liquidity_score" integer NOT NULL,
	"risk_score" integer NOT NULL,
	"development_potential_score" integer NOT NULL,
	"marketability_score" integer NOT NULL,
	"overall_score" integer NOT NULL,
	"grade" text NOT NULL,
	"score_breakdown" jsonb,
	"model_version" text NOT NULL,
	"valid_until" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lender_network" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lender_name" text NOT NULL,
	"lender_type" text NOT NULL,
	"min_loan_amount" numeric,
	"max_loan_amount" numeric,
	"max_ltv" numeric,
	"min_credit_score" integer,
	"interest_rate_range" jsonb,
	"typical_term_months" integer,
	"property_types" jsonb,
	"states" jsonb,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"loans_issued" integer DEFAULT 0,
	"avg_closing_days" integer,
	"approval_rate" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_indicators_temp" (
	"id" serial PRIMARY KEY NOT NULL,
	"indicator_date" timestamp DEFAULT now() NOT NULL,
	"federal_funds_rate" numeric,
	"mortgage_rate_30_yr" numeric,
	"gdp_growth_rate" numeric,
	"inflation_rate" numeric,
	"unemployment_rate" numeric,
	"national_home_price_index" numeric,
	"land_demand_index" numeric,
	"consumer_confidence_index" numeric,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_bids" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"bidder_organization_id" integer NOT NULL,
	"bid_amount" numeric NOT NULL,
	"message" text,
	"proposed_terms" text,
	"bid_type" text DEFAULT 'purchase' NOT NULL,
	"partnership_split" numeric,
	"status" text DEFAULT 'pending' NOT NULL,
	"seller_response" text,
	"counter_offer" numeric,
	"responded_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"seller_organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"listing_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asking_price" numeric NOT NULL,
	"min_acceptable_price" numeric,
	"closing_timeline_days" integer,
	"is_negotiable" boolean DEFAULT true,
	"accepts_partnership" boolean DEFAULT false,
	"partnership_terms" text,
	"visibility" text DEFAULT 'public' NOT NULL,
	"is_premium_placement" boolean DEFAULT false,
	"premium_expires_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"views" integer DEFAULT 0,
	"favorites" integer DEFAULT 0,
	"inquiries" integer DEFAULT 0,
	"exclusivity_period" integer,
	"expires_at" timestamp,
	"sold_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketplace_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"listing_id" integer NOT NULL,
	"seller_organization_id" integer NOT NULL,
	"buyer_organization_id" integer NOT NULL,
	"transaction_type" text NOT NULL,
	"sale_price" numeric NOT NULL,
	"platform_fee_percent" numeric DEFAULT '1.5' NOT NULL,
	"platform_fee_cents" integer NOT NULL,
	"seller_payout_status" text DEFAULT 'pending' NOT NULL,
	"seller_payout_amount" numeric,
	"seller_stripe_transfer_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"closing_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "model_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_type" text NOT NULL,
	"version" text NOT NULL,
	"git_hash" text,
	"trained_at" timestamp,
	"deployed_at" timestamp,
	"retired_at" timestamp,
	"status" text DEFAULT 'training' NOT NULL,
	"training_samples" integer,
	"validation_samples" integer,
	"primary_metric" text,
	"primary_metric_value" numeric,
	"is_active" boolean DEFAULT false,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiation_moves" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"move_number" integer NOT NULL,
	"move_type" text NOT NULL,
	"party" text NOT NULL,
	"offer_amount" numeric,
	"terms" text,
	"reasoning" text,
	"generated_by_ai" boolean DEFAULT false,
	"ai_model" text,
	"ai_confidence" numeric,
	"alternative_strategies" jsonb,
	"response_received" boolean DEFAULT false,
	"response_time" integer,
	"response_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiation_outcomes" (
	"id" serial PRIMARY KEY NOT NULL,
	"thread_id" integer NOT NULL,
	"outcome" text NOT NULL,
	"final_price" numeric,
	"initial_offer" numeric,
	"target_price" numeric,
	"negotiation_discount" numeric,
	"total_days" integer,
	"total_moves" integer,
	"strategy_used" text,
	"strategy_effectiveness" integer,
	"key_factors" jsonb,
	"lessons_learned" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiation_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"strategy_type" text NOT NULL,
	"initial_offer_percentage" numeric,
	"increment_strategy" text,
	"max_moves" integer,
	"times_used" integer DEFAULT 0,
	"success_rate" numeric,
	"avg_discount" numeric,
	"avg_days_to_close" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiation_threads" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"deal_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"current_offer_amount" numeric,
	"target_price" numeric,
	"walkaway_price" numeric,
	"seller_profile" jsonb,
	"overall_sentiment" text,
	"sentiment_trend" text,
	"current_strategy" text,
	"strategy_confidence" numeric,
	"total_exchanges" integer DEFAULT 0,
	"avg_response_time_hours" numeric,
	"days_in_negotiation" integer,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_activity_at" timestamp DEFAULT now(),
	"closed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "note_securities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"principal_amount" numeric NOT NULL,
	"interest_rate" numeric NOT NULL,
	"term_months" integer NOT NULL,
	"monthly_payment" numeric NOT NULL,
	"is_securitized" boolean DEFAULT false,
	"securitization_date" timestamp,
	"investor_id" text,
	"purchase_price" numeric,
	"discount" numeric,
	"payments_received" integer DEFAULT 0,
	"total_payments_due" integer,
	"current_balance" numeric,
	"delinquent_days" integer DEFAULT 0,
	"status" text NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes_receivable" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer,
	"buyer_name" text,
	"original_balance" numeric,
	"remaining_balance" numeric,
	"interest_rate" numeric,
	"monthly_payment" numeric,
	"status" text DEFAULT 'active',
	"start_date" timestamp,
	"maturity_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "opportunity_zone_holdings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"oz_fund_name" text,
	"oz_tract_id" text,
	"investment_date" timestamp,
	"initial_investment" numeric,
	"deferred_gain_rollover" numeric,
	"qualified_opportunity_fund" text,
	"holding_years" integer,
	"step_up_basis" numeric,
	"estimated_tax_savings" numeric,
	"exit_date" timestamp,
	"exit_value" numeric,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "optimization_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"recommendation_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"reasoning" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"estimated_impact" jsonb,
	"action_items" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"reviewed_at" timestamp,
	"implemented_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "org_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"key_hash" text NOT NULL,
	"key_prefix" text NOT NULL,
	"scope" text DEFAULT 'read' NOT NULL,
	"expires_at" timestamp,
	"last_used_at" timestamp,
	"is_revoked" boolean DEFAULT false NOT NULL,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "photo_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"photo_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"detected_features" jsonb,
	"landscape_type" text,
	"building_detected" boolean,
	"road_detected" boolean,
	"water_detected" boolean,
	"photo_quality" text,
	"is_usable_for_marketing" boolean,
	"ai_description" text,
	"estimated_acreage_visible" numeric,
	"vegetation_density" numeric,
	"similar_photos" jsonb,
	"model_version" text,
	"confidence" numeric,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "platform_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"encrypted_value" text,
	"service" text NOT NULL,
	"label" text NOT NULL,
	"is_secret" boolean DEFAULT true NOT NULL,
	"is_required" boolean DEFAULT false NOT NULL,
	"validated_at" timestamp,
	"validation_status" text,
	"validation_message" text,
	"updated_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "platform_config_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "platform_feature_flags" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"controlled_routes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "platform_feature_flags_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "portfolio_simulations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"iterations" integer DEFAULT 10000 NOT NULL,
	"time_horizon_months" integer NOT NULL,
	"assumptions" jsonb,
	"results" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_trends" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"property_type" text NOT NULL,
	"acreage_range" text,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"avg_price_per_acre" numeric NOT NULL,
	"median_price_per_acre" numeric,
	"min_price" numeric,
	"max_price" numeric,
	"transaction_count" integer NOT NULL,
	"total_acres_sold" numeric,
	"avg_days_on_market" integer,
	"price_change" numeric,
	"volume_change" numeric,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "pricing_config" (
	"id" serial PRIMARY KEY NOT NULL,
	"tier" text NOT NULL,
	"display_price_monthly" integer NOT NULL,
	"display_price_yearly" integer NOT NULL,
	"promo_label" text,
	"promo_discount_percent" integer,
	"promo_ends_at" timestamp,
	"stripe_coupon_id" text,
	"allow_promo_codes" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "pricing_config_tier_unique" UNIQUE("tier")
);
--> statement-breakpoint
CREATE TABLE "property_photos" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"url" text NOT NULL,
	"thumbnail_url" text,
	"storage_key" text NOT NULL,
	"filename" text,
	"mime_type" text,
	"size_bytes" integer,
	"width" integer,
	"height" integer,
	"sort_order" integer DEFAULT 0,
	"is_primary" boolean DEFAULT false,
	"category" text,
	"captured_at" timestamp,
	"captured_by" text,
	"gps_coordinates" jsonb,
	"has_analysis" boolean DEFAULT false,
	"analysis_id" integer,
	"uploaded_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "regulatory_changes" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"municipality" text,
	"change_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"impact_level" text,
	"affected_properties" jsonb,
	"effective_date" timestamp,
	"proposed_date" timestamp,
	"source_url" text,
	"source_document" text,
	"status" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "regulatory_requirements" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text,
	"requirement_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"legal_citation" text,
	"effective_date" timestamp,
	"expiration_date" timestamp,
	"jurisdiction_level" text NOT NULL,
	"transaction_types" text[],
	"required_documents" text[],
	"penalties" text,
	"is_active" boolean DEFAULT true,
	"last_verified" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "revenue_protection_interventions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"intervention_type" text NOT NULL,
	"trigger_risk_score" integer NOT NULL,
	"trigger_risk_band" text NOT NULL,
	"executed_by" text DEFAULT 'sophie' NOT NULL,
	"sophie_message_subject" text,
	"sophie_message_body" text,
	"email_sent_at" timestamp,
	"email_delivery_status" text,
	"outcome" text,
	"outcome_recorded_at" timestamp,
	"revenue_recovered_cents" integer,
	"decisions_inbox_item_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "satellite_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"baseline_snapshot_id" integer,
	"comparison_snapshot_id" integer,
	"analysis_date" timestamp NOT NULL,
	"change_score" numeric,
	"vegetation_change_pct" numeric,
	"structure_change_pct" numeric,
	"boundary_change_pct" numeric,
	"detected_changes" jsonb,
	"diff_image_url" text,
	"ndvi_baseline" numeric,
	"ndvi_current" numeric,
	"analysis_metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "satellite_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"image_url" text NOT NULL,
	"provider" text,
	"resolution" numeric,
	"capture_date" timestamp NOT NULL,
	"cloud_coverage" numeric,
	"change_detected" boolean DEFAULT false,
	"change_type" text,
	"change_severity" text,
	"compared_to_snapshot_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scraped_deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"source_id" integer,
	"source_type" text NOT NULL,
	"source_url" text,
	"apn" text,
	"address" text,
	"city" text,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"zip" text,
	"size_acres" numeric,
	"zoning" text,
	"list_price" numeric,
	"assessed_value" numeric,
	"taxes_owed" numeric,
	"minimum_bid" numeric,
	"auction_date" timestamp,
	"auction_status" text,
	"owner_name" text,
	"owner_address" text,
	"owner_type" text,
	"distress_score" integer,
	"distress_factors" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"converted_to_lead_id" integer,
	"converted_to_property_id" integer,
	"scraped_at" timestamp DEFAULT now() NOT NULL,
	"last_verified" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "stripe_processed_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"stripe_event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"processed_at" timestamp DEFAULT now(),
	CONSTRAINT "stripe_processed_events_stripe_event_id_unique" UNIQUE("stripe_event_id")
);
--> statement-breakpoint
CREATE TABLE "system_activity" (
	"id" serial PRIMARY KEY NOT NULL,
	"org_id" integer,
	"job_name" text NOT NULL,
	"action" text NOT NULL,
	"summary" text NOT NULL,
	"entity_type" text,
	"entity_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "system_api_keys" (
	"id" serial PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"display_name" text NOT NULL,
	"api_key" text,
	"is_active" boolean DEFAULT true,
	"last_validated_at" timestamp,
	"validation_status" text DEFAULT 'pending',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "system_api_keys_provider_unique" UNIQUE("provider")
);
--> statement-breakpoint
CREATE TABLE "system_meta" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tax_escrow_payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"property_id" integer,
	"tax_year" integer NOT NULL,
	"installment" text DEFAULT 'annual',
	"amount_paid" numeric NOT NULL,
	"escrow_balance_used" numeric NOT NULL,
	"shortfall" numeric DEFAULT '0',
	"excess_refunded" numeric DEFAULT '0',
	"payment_date" timestamp NOT NULL,
	"county_confirmation_number" text,
	"payment_method" text DEFAULT 'manual',
	"county_tax_portal_url" text,
	"notes" text,
	"receipt_url" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_forecast_scenarios" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"scenario_name" text NOT NULL,
	"hold_years" integer,
	"scenario_type" text NOT NULL,
	"property_ids" integer[],
	"projected_sale_price" numeric,
	"projected_cap_gain" numeric,
	"projected_tax_liability" numeric,
	"projected_net_proceeds" numeric,
	"assumptions" jsonb,
	"yearly_breakdown" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_strategies" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"strategy_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"estimated_tax_savings" numeric,
	"implementation_cost" numeric,
	"timeframe" text,
	"risk_level" text,
	"requirements" jsonb,
	"applicable_properties" integer[],
	"status" text DEFAULT 'recommended' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tenant_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" integer NOT NULL,
	"period_start" timestamp NOT NULL,
	"period_end" timestamp NOT NULL,
	"active_users" integer DEFAULT 0,
	"total_api_calls" integer DEFAULT 0,
	"ai_credits_consumed" numeric DEFAULT '0',
	"storage_used_mb" integer DEFAULT 0,
	"voice_minutes_used" integer DEFAULT 0,
	"revenue_generated" numeric DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "territories" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"states" jsonb,
	"counties" jsonb,
	"assigned_to" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "training_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"model_version_id" integer NOT NULL,
	"metric_name" text NOT NULL,
	"metric_value" numeric NOT NULL,
	"split_type" text NOT NULL,
	"state" text,
	"property_type" text,
	"sample_count" integer,
	"computed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_fee_settlements" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"transaction_id" integer NOT NULL,
	"fee_type" text NOT NULL,
	"fee_amount" numeric NOT NULL,
	"fee_percent" numeric,
	"status" text DEFAULT 'pending' NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_transfer_ids" text[],
	"held_until" timestamp,
	"released_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "transaction_training" (
	"id" serial PRIMARY KEY NOT NULL,
	"transaction_hash" text NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"property_type" text NOT NULL,
	"size_acres" numeric NOT NULL,
	"zoning" text,
	"has_road_access" boolean,
	"has_utilities" boolean,
	"has_water" boolean,
	"flood_zone" text,
	"has_wetlands" boolean,
	"soil_quality" text,
	"county_median_income" numeric,
	"population_density" numeric,
	"distance_to_metro" numeric,
	"sale_price" numeric NOT NULL,
	"price_per_acre" numeric NOT NULL,
	"sale_date" timestamp NOT NULL,
	"data_quality" text NOT NULL,
	"is_outlier" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "transaction_training_transaction_hash_unique" UNIQUE("transaction_hash")
);
--> statement-breakpoint
CREATE TABLE "tutor_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"course_id" integer,
	"topic" text,
	"messages" jsonb,
	"message_count" integer DEFAULT 0,
	"duration_minutes" integer,
	"question_answered" boolean,
	"satisfaction_rating" integer,
	"ended_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "user_map_layer_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"layer_id" integer NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"opacity" numeric(4, 2) DEFAULT '0.70' NOT NULL,
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "valuation_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"predicted_value" numeric NOT NULL,
	"confidence_score" numeric NOT NULL,
	"value_range" jsonb,
	"model_version" text NOT NULL,
	"features_used" jsonb,
	"comparable_count" integer,
	"valid_until" timestamp NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "voice_call_recordings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"voice_call_id" integer NOT NULL,
	"audio_file_url" text,
	"audio_file_bucket" text,
	"audio_file_key" text,
	"duration_seconds" integer,
	"file_size_bytes" integer,
	"mime_type" text,
	"encryption_key_id" text,
	"tcpa_consent_obtained" boolean DEFAULT false,
	"disclosure_played_at" timestamp,
	"recording_started_at" timestamp,
	"transcription_status" text DEFAULT 'pending' NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "voice_calls" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"call_sid" text,
	"direction" text NOT NULL,
	"from_number" text,
	"to_number" text,
	"contact_id" integer,
	"lead_id" integer,
	"property_id" integer,
	"duration_seconds" integer,
	"call_status" text,
	"agent_type" text NOT NULL,
	"agent_objective" text,
	"was_answered" boolean,
	"sentiment_score" numeric,
	"motivation_score" numeric,
	"objective_achieved" boolean,
	"action_items" jsonb,
	"scheduled_appointment" timestamp,
	"recording_url" text,
	"transcript_id" integer,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "voice_calls_call_sid_unique" UNIQUE("call_sid")
);
--> statement-breakpoint
CREATE TABLE "white_label_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"parent_organization_id" integer NOT NULL,
	"brand_name" text NOT NULL,
	"logo_url" text,
	"favicon_url" text,
	"primary_color" text DEFAULT '#2563eb' NOT NULL,
	"accent_color" text DEFAULT '#16a34a' NOT NULL,
	"custom_domain" text,
	"support_email" text NOT NULL,
	"support_phone" text,
	"footer_text" text DEFAULT 'Powered by AcreOS' NOT NULL,
	"features" jsonb NOT NULL,
	"revenue_share" jsonb NOT NULL,
	"limits" jsonb NOT NULL,
	"plan" text DEFAULT 'starter' NOT NULL,
	"billing_email" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "white_label_configs_tenant_id_unique" UNIQUE("tenant_id"),
	CONSTRAINT "white_label_configs_organization_id_unique" UNIQUE("organization_id"),
	CONSTRAINT "white_label_configs_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
CREATE TABLE "whitelabel_tenants" (
	"id" serial PRIMARY KEY NOT NULL,
	"tenant_name" text NOT NULL,
	"subdomain" text NOT NULL,
	"custom_domain" text,
	"logo_url" text,
	"primary_color" text,
	"secondary_color" text,
	"features" jsonb,
	"max_users" integer,
	"max_properties" integer,
	"max_storage" integer,
	"plan" text NOT NULL,
	"monthly_fee" numeric NOT NULL,
	"admin_user_id" text,
	"admin_email" text,
	"is_active" boolean DEFAULT true,
	"suspended_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "whitelabel_tenants_subdomain_unique" UNIQUE("subdomain"),
	CONSTRAINT "whitelabel_tenants_custom_domain_unique" UNIQUE("custom_domain")
);
--> statement-breakpoint
CREATE TABLE "password_reset_tokens" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" varchar NOT NULL,
	"token" varchar(128) NOT NULL,
	"expires_at" timestamp NOT NULL,
	"used_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	CONSTRAINT "password_reset_tokens_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "referrals" (
	"id" serial PRIMARY KEY NOT NULL,
	"referrer_id" varchar NOT NULL,
	"referee_id" varchar,
	"code" varchar(16) NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credit_amount" integer DEFAULT 0 NOT NULL,
	"credited_at" timestamp,
	"created_at" timestamp DEFAULT now() NOT NULL,
	CONSTRAINT "referrals_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "feature_requests" ADD COLUMN "ai_triage" jsonb;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "source_mail_piece_id" integer;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_at" timestamp;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "deleted_by" text;--> statement-breakpoint
ALTER TABLE "mailing_order_pieces" ADD COLUMN "tracking_code" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "tax_escrow_enabled" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "annual_property_tax" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "monthly_tax_escrow" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "tax_escrow_balance" numeric DEFAULT '0';--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "tax_escrow_account_id" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "last_tax_payment_date" timestamp;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "next_tax_due_date" timestamp;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "tax_payment_year" integer;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "county_tax_portal_url" text;--> statement-breakpoint
ALTER TABLE "notes" ADD COLUMN "fallback_payment_accounts" jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "utm_source" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "utm_medium" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "utm_campaign" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "utm_content" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_credits" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "churn_risk_score" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "churn_risk_updated_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "churn_rescue_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "milestones_reached" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "referral_nudge_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "enrichment_data" jsonb;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "enrichment_status" text;--> statement-breakpoint
ALTER TABLE "properties" ADD COLUMN "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "sophie_cross_org_learnings" ADD COLUMN "contributing_org_ids" jsonb DEFAULT '[]'::jsonb;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_hash" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_token" varchar;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "password_reset_expires_at" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "failed_login_attempts" varchar DEFAULT '0';--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "locked_until" timestamp;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "referral_code" varchar(16);--> statement-breakpoint
ALTER TABLE "ad_creative_bundles" ADD CONSTRAINT "ad_creative_bundles_campaign_id_growth_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."growth_campaigns"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_telemetry_events" ADD CONSTRAINT "ai_telemetry_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "auto_bid_rules" ADD CONSTRAINT "auto_bid_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_check_results" ADD CONSTRAINT "background_check_results_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "background_check_results" ADD CONSTRAINT "background_check_results_investor_profile_id_investor_profiles_id_fk" FOREIGN KEY ("investor_profile_id") REFERENCES "public"."investor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_messages" ADD CONSTRAINT "borrower_messages_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_messages" ADD CONSTRAINT "borrower_messages_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_leads" ADD CONSTRAINT "campaign_leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_variants" ADD CONSTRAINT "campaign_variants_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "capital_raises" ADD CONSTRAINT "capital_raises_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "certificate_verification" ADD CONSTRAINT "certificate_verification_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "churn_risk_scores" ADD CONSTRAINT "churn_risk_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_alerts" ADD CONSTRAINT "compliance_alerts_regulatory_change_id_regulatory_changes_id_fk" FOREIGN KEY ("regulatory_change_id") REFERENCES "public"."regulatory_changes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checklist_items" ADD CONSTRAINT "compliance_checklist_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checklist_items" ADD CONSTRAINT "compliance_checklist_items_requirement_id_regulatory_requirements_id_fk" FOREIGN KEY ("requirement_id") REFERENCES "public"."regulatory_requirements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_basis" ADD CONSTRAINT "cost_basis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cost_basis" ADD CONSTRAINT "cost_basis_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_enrollments" ADD CONSTRAINT "course_enrollments_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_alerts" ADD CONSTRAINT "deal_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_alerts" ADD CONSTRAINT "deal_alerts_scraped_deal_id_scraped_deals_id_fk" FOREIGN KEY ("scraped_deal_id") REFERENCES "public"."scraped_deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_alerts" ADD CONSTRAINT "deal_alerts_auto_bid_rule_id_auto_bid_rules_id_fk" FOREIGN KEY ("auto_bid_rule_id") REFERENCES "public"."auto_bid_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_documents" ADD CONSTRAINT "deal_room_documents_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_room_messages" ADD CONSTRAINT "deal_room_messages_deal_room_id_deal_rooms_id_fk" FOREIGN KEY ("deal_room_id") REFERENCES "public"."deal_rooms"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_rooms" ADD CONSTRAINT "deal_rooms_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions_inbox_items" ADD CONSTRAINT "decisions_inbox_items_source_ticket_id_support_tickets_id_fk" FOREIGN KEY ("source_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions_inbox_items" ADD CONSTRAINT "decisions_inbox_items_source_alert_id_system_alerts_id_fk" FOREIGN KEY ("source_alert_id") REFERENCES "public"."system_alerts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions_inbox_items" ADD CONSTRAINT "decisions_inbox_items_source_feature_request_id_feature_requests_id_fk" FOREIGN KEY ("source_feature_request_id") REFERENCES "public"."feature_requests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "decisions_inbox_items" ADD CONSTRAINT "decisions_inbox_items_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "depreciation_schedules" ADD CONSTRAINT "depreciation_schedules_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_audit_log" ADD CONSTRAINT "fee_audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_audit_log" ADD CONSTRAINT "fee_audit_log_settlement_id_transaction_fee_settlements_id_fk" FOREIGN KEY ("settlement_id") REFERENCES "public"."transaction_fee_settlements"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_payout_schedules" ADD CONSTRAINT "fee_payout_schedules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_scout_photos" ADD CONSTRAINT "field_scout_photos_visit_id_field_scout_visits_id_fk" FOREIGN KEY ("visit_id") REFERENCES "public"."field_scout_visits"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_scout_photos" ADD CONSTRAINT "field_scout_photos_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_scout_visits" ADD CONSTRAINT "field_scout_visits_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "field_scout_visits" ADD CONSTRAINT "field_scout_visits_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_profiles" ADD CONSTRAINT "investor_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_verification_documents" ADD CONSTRAINT "investor_verification_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_verification_documents" ADD CONSTRAINT "investor_verification_documents_investor_profile_id_investor_profiles_id_fk" FOREIGN KEY ("investor_profile_id") REFERENCES "public"."investor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_verification_history" ADD CONSTRAINT "investor_verification_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "investor_verification_history" ADD CONSTRAINT "investor_verification_history_investor_profile_id_investor_profiles_id_fk" FOREIGN KEY ("investor_profile_id") REFERENCES "public"."investor_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "land_credit_scores" ADD CONSTRAINT "land_credit_scores_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lender_network" ADD CONSTRAINT "lender_network_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_bids" ADD CONSTRAINT "marketplace_bids_bidder_organization_id_organizations_id_fk" FOREIGN KEY ("bidder_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_seller_organization_id_organizations_id_fk" FOREIGN KEY ("seller_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_listings" ADD CONSTRAINT "marketplace_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_listing_id_marketplace_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."marketplace_listings"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_seller_organization_id_organizations_id_fk" FOREIGN KEY ("seller_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketplace_transactions" ADD CONSTRAINT "marketplace_transactions_buyer_organization_id_organizations_id_fk" FOREIGN KEY ("buyer_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_moves" ADD CONSTRAINT "negotiation_moves_thread_id_negotiation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_outcomes" ADD CONSTRAINT "negotiation_outcomes_thread_id_negotiation_threads_id_fk" FOREIGN KEY ("thread_id") REFERENCES "public"."negotiation_threads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_threads" ADD CONSTRAINT "negotiation_threads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_threads" ADD CONSTRAINT "negotiation_threads_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_threads" ADD CONSTRAINT "negotiation_threads_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_securities" ADD CONSTRAINT "note_securities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_securities" ADD CONSTRAINT "note_securities_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes_receivable" ADD CONSTRAINT "notes_receivable_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_zone_holdings" ADD CONSTRAINT "opportunity_zone_holdings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_zone_holdings" ADD CONSTRAINT "opportunity_zone_holdings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "optimization_recommendations" ADD CONSTRAINT "optimization_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "org_api_keys" ADD CONSTRAINT "org_api_keys_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_analysis" ADD CONSTRAINT "photo_analysis_photo_id_property_photos_id_fk" FOREIGN KEY ("photo_id") REFERENCES "public"."property_photos"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "photo_analysis" ADD CONSTRAINT "photo_analysis_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_simulations" ADD CONSTRAINT "portfolio_simulations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_photos" ADD CONSTRAINT "property_photos_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_protection_interventions" ADD CONSTRAINT "revenue_protection_interventions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "revenue_protection_interventions" ADD CONSTRAINT "revenue_protection_interventions_decisions_inbox_item_id_decisions_inbox_items_id_fk" FOREIGN KEY ("decisions_inbox_item_id") REFERENCES "public"."decisions_inbox_items"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satellite_analysis" ADD CONSTRAINT "satellite_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satellite_analysis" ADD CONSTRAINT "satellite_analysis_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "satellite_snapshots" ADD CONSTRAINT "satellite_snapshots_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_activity" ADD CONSTRAINT "system_activity_org_id_organizations_id_fk" FOREIGN KEY ("org_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_escrow_payments" ADD CONSTRAINT "tax_escrow_payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_escrow_payments" ADD CONSTRAINT "tax_escrow_payments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_escrow_payments" ADD CONSTRAINT "tax_escrow_payments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_forecast_scenarios" ADD CONSTRAINT "tax_forecast_scenarios_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_strategies" ADD CONSTRAINT "tax_strategies_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_metrics" ADD CONSTRAINT "tenant_metrics_tenant_id_whitelabel_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."whitelabel_tenants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "territories" ADD CONSTRAINT "territories_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "training_metrics" ADD CONSTRAINT "training_metrics_model_version_id_model_versions_id_fk" FOREIGN KEY ("model_version_id") REFERENCES "public"."model_versions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fee_settlements" ADD CONSTRAINT "transaction_fee_settlements_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_fee_settlements" ADD CONSTRAINT "transaction_fee_settlements_transaction_id_marketplace_transactions_id_fk" FOREIGN KEY ("transaction_id") REFERENCES "public"."marketplace_transactions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tutor_sessions" ADD CONSTRAINT "tutor_sessions_course_id_courses_id_fk" FOREIGN KEY ("course_id") REFERENCES "public"."courses"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_map_layer_preferences" ADD CONSTRAINT "user_map_layer_preferences_layer_id_data_sources_id_fk" FOREIGN KEY ("layer_id") REFERENCES "public"."data_sources"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "valuation_predictions" ADD CONSTRAINT "valuation_predictions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_call_recordings" ADD CONSTRAINT "voice_call_recordings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_call_recordings" ADD CONSTRAINT "voice_call_recordings_voice_call_id_voice_calls_id_fk" FOREIGN KEY ("voice_call_id") REFERENCES "public"."voice_calls"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "voice_calls" ADD CONSTRAINT "voice_calls_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "white_label_configs" ADD CONSTRAINT "white_label_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "white_label_configs" ADD CONSTRAINT "white_label_configs_parent_organization_id_organizations_id_fk" FOREIGN KEY ("parent_organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referrer_id_users_id_fk" FOREIGN KEY ("referrer_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "referrals" ADD CONSTRAINT "referrals_referee_id_users_id_fk" FOREIGN KEY ("referee_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_model_configs_enabled_idx" ON "ai_model_configs" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "ai_telemetry_org_idx" ON "ai_telemetry_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "ai_telemetry_created_idx" ON "ai_telemetry_events" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "ai_telemetry_provider_idx" ON "ai_telemetry_events" USING btree ("provider");--> statement-breakpoint
CREATE INDEX "auto_bid_rules_org_idx" ON "auto_bid_rules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "auto_bid_rules_active_idx" ON "auto_bid_rules" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "background_checks_org_idx" ON "background_check_results" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "background_checks_profile_idx" ON "background_check_results" USING btree ("investor_profile_id");--> statement-breakpoint
CREATE INDEX "background_checks_status_idx" ON "background_check_results" USING btree ("status");--> statement-breakpoint
CREATE INDEX "buyer_behavior_state_county_idx" ON "buyer_behavior_events" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "buyer_behavior_type_idx" ON "buyer_behavior_events" USING btree ("event_type");--> statement-breakpoint
CREATE INDEX "buyer_behavior_date_idx" ON "buyer_behavior_events" USING btree ("event_date");--> statement-breakpoint
CREATE INDEX "campaign_leads_campaign_idx" ON "campaign_leads" USING btree ("campaign_id");--> statement-breakpoint
CREATE INDEX "campaign_leads_lead_idx" ON "campaign_leads" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "capital_raises_org_idx" ON "capital_raises" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "capital_raises_status_idx" ON "capital_raises" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cert_verification_org_idx" ON "certificate_verification" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cert_verification_hash_idx" ON "certificate_verification" USING btree ("verification_hash");--> statement-breakpoint
CREATE INDEX "cert_verification_recipient_idx" ON "certificate_verification" USING btree ("recipient_email");--> statement-breakpoint
CREATE INDEX "churn_risk_org_idx" ON "churn_risk_scores" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "churn_risk_band_idx" ON "churn_risk_scores" USING btree ("risk_band");--> statement-breakpoint
CREATE INDEX "churn_risk_score_idx" ON "churn_risk_scores" USING btree ("risk_score");--> statement-breakpoint
CREATE INDEX "compliance_alerts_org_idx" ON "compliance_alerts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "compliance_alerts_property_idx" ON "compliance_alerts" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "compliance_alerts_status_idx" ON "compliance_alerts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "compliance_checklist_org_idx" ON "compliance_checklist_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "compliance_checklist_deal_idx" ON "compliance_checklist_items" USING btree ("deal_id");--> statement-breakpoint
CREATE INDEX "compliance_checklist_status_idx" ON "compliance_checklist_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "cost_basis_org_idx" ON "cost_basis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "cost_basis_property_idx" ON "cost_basis" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "county_markets_state_county_idx" ON "county_markets" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "course_enrollments_user_idx" ON "course_enrollments" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "course_enrollments_course_idx" ON "course_enrollments" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "course_modules_course_idx" ON "course_modules" USING btree ("course_id");--> statement-breakpoint
CREATE INDEX "courses_category_idx" ON "courses" USING btree ("category");--> statement-breakpoint
CREATE INDEX "courses_published_idx" ON "courses" USING btree ("is_published");--> statement-breakpoint
CREATE INDEX "deal_alerts_org_idx" ON "deal_alerts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deal_alerts_type_idx" ON "deal_alerts" USING btree ("alert_type");--> statement-breakpoint
CREATE INDEX "deal_alerts_read_idx" ON "deal_alerts" USING btree ("read_at");--> statement-breakpoint
CREATE INDEX "deal_room_documents_room_idx" ON "deal_room_documents" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "deal_room_documents_file_idx" ON "deal_room_documents" USING btree ("deal_room_id","file_name");--> statement-breakpoint
CREATE INDEX "deal_room_messages_room_idx" ON "deal_room_messages" USING btree ("deal_room_id");--> statement-breakpoint
CREATE INDEX "deal_room_messages_created_idx" ON "deal_room_messages" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "deal_sources_state_county_idx" ON "deal_sources" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "deal_sources_active_idx" ON "deal_sources" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "decisions_inbox_status_idx" ON "decisions_inbox_items" USING btree ("status");--> statement-breakpoint
CREATE INDEX "decisions_inbox_urgency_idx" ON "decisions_inbox_items" USING btree ("urgency_score");--> statement-breakpoint
CREATE INDEX "decisions_inbox_org_idx" ON "decisions_inbox_items" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "demand_heatmaps_state_county_idx" ON "demand_heatmaps" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "demand_heatmaps_score_idx" ON "demand_heatmaps" USING btree ("demand_score");--> statement-breakpoint
CREATE INDEX "depreciation_schedules_org_idx" ON "depreciation_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "depreciation_schedules_property_idx" ON "depreciation_schedules" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "fee_audit_log_org_idx" ON "fee_audit_log" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fee_audit_log_settlement_idx" ON "fee_audit_log" USING btree ("settlement_id");--> statement-breakpoint
CREATE INDEX "fee_audit_log_created_idx" ON "fee_audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "fee_payout_schedules_org_idx" ON "fee_payout_schedules" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fee_payout_schedules_next_payout_idx" ON "fee_payout_schedules" USING btree ("next_payout_at");--> statement-breakpoint
CREATE INDEX "field_scout_photos_visit_idx" ON "field_scout_photos" USING btree ("visit_id");--> statement-breakpoint
CREATE INDEX "field_scout_photos_lead_idx" ON "field_scout_photos" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "field_scout_visits_visitor_idx" ON "field_scout_visits" USING btree ("visitor_id");--> statement-breakpoint
CREATE INDEX "field_scout_visits_lead_idx" ON "field_scout_visits" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "founder_digest_date_idx" ON "founder_digest_history" USING btree ("digest_date");--> statement-breakpoint
CREATE INDEX "founder_digest_status_idx" ON "founder_digest_history" USING btree ("delivery_status");--> statement-breakpoint
CREATE INDEX "investor_profiles_verified_idx" ON "investor_profiles" USING btree ("is_verified");--> statement-breakpoint
CREATE INDEX "investor_profiles_org_idx" ON "investor_profiles" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "investor_ver_docs_org_idx" ON "investor_verification_documents" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "investor_ver_docs_profile_idx" ON "investor_verification_documents" USING btree ("investor_profile_id");--> statement-breakpoint
CREATE INDEX "investor_ver_docs_status_idx" ON "investor_verification_documents" USING btree ("status");--> statement-breakpoint
CREATE INDEX "investor_ver_history_org_idx" ON "investor_verification_history" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "investor_ver_history_profile_idx" ON "investor_verification_history" USING btree ("investor_profile_id");--> statement-breakpoint
CREATE INDEX "investor_ver_history_created_idx" ON "investor_verification_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "job_health_job_name_idx" ON "job_health_logs" USING btree ("job_name");--> statement-breakpoint
CREATE INDEX "job_health_status_idx" ON "job_health_logs" USING btree ("status");--> statement-breakpoint
CREATE INDEX "job_health_started_idx" ON "job_health_logs" USING btree ("run_started_at");--> statement-breakpoint
CREATE INDEX "land_credit_scores_property_idx" ON "land_credit_scores" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "land_credit_scores_grade_idx" ON "land_credit_scores" USING btree ("grade");--> statement-breakpoint
CREATE INDEX "lender_network_org_idx" ON "lender_network" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "lender_network_type_idx" ON "lender_network" USING btree ("lender_type");--> statement-breakpoint
CREATE INDEX "marketplace_bids_listing_idx" ON "marketplace_bids" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX "marketplace_bids_bidder_idx" ON "marketplace_bids" USING btree ("bidder_organization_id");--> statement-breakpoint
CREATE INDEX "marketplace_bids_status_idx" ON "marketplace_bids" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketplace_listings_seller_idx" ON "marketplace_listings" USING btree ("seller_organization_id");--> statement-breakpoint
CREATE INDEX "marketplace_listings_status_idx" ON "marketplace_listings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "marketplace_listings_type_idx" ON "marketplace_listings" USING btree ("listing_type");--> statement-breakpoint
CREATE INDEX "marketplace_transactions_seller_idx" ON "marketplace_transactions" USING btree ("seller_organization_id");--> statement-breakpoint
CREATE INDEX "marketplace_transactions_buyer_idx" ON "marketplace_transactions" USING btree ("buyer_organization_id");--> statement-breakpoint
CREATE INDEX "marketplace_transactions_status_idx" ON "marketplace_transactions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "model_versions_type_idx" ON "model_versions" USING btree ("model_type");--> statement-breakpoint
CREATE INDEX "model_versions_status_idx" ON "model_versions" USING btree ("status");--> statement-breakpoint
CREATE INDEX "model_versions_active_idx" ON "model_versions" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "negotiation_moves_thread_idx" ON "negotiation_moves" USING btree ("thread_id");--> statement-breakpoint
CREATE INDEX "negotiation_moves_party_idx" ON "negotiation_moves" USING btree ("party");--> statement-breakpoint
CREATE INDEX "negotiation_outcomes_outcome_idx" ON "negotiation_outcomes" USING btree ("outcome");--> statement-breakpoint
CREATE INDEX "negotiation_threads_org_idx" ON "negotiation_threads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "negotiation_threads_lead_idx" ON "negotiation_threads" USING btree ("lead_id");--> statement-breakpoint
CREATE INDEX "negotiation_threads_status_idx" ON "negotiation_threads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "note_securities_org_idx" ON "note_securities" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "note_securities_investor_idx" ON "note_securities" USING btree ("investor_id");--> statement-breakpoint
CREATE INDEX "note_securities_status_idx" ON "note_securities" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notes_receivable_org_idx" ON "notes_receivable" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "oz_holdings_org_idx" ON "opportunity_zone_holdings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "oz_holdings_property_idx" ON "opportunity_zone_holdings" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "oz_holdings_status_idx" ON "opportunity_zone_holdings" USING btree ("status");--> statement-breakpoint
CREATE INDEX "optimization_recommendations_org_idx" ON "optimization_recommendations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "optimization_recommendations_type_idx" ON "optimization_recommendations" USING btree ("recommendation_type");--> statement-breakpoint
CREATE INDEX "optimization_recommendations_status_idx" ON "optimization_recommendations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "org_api_keys_org_idx" ON "org_api_keys" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "photo_analysis_photo_idx" ON "photo_analysis" USING btree ("photo_id");--> statement-breakpoint
CREATE INDEX "photo_analysis_property_idx" ON "photo_analysis" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "platform_config_key_idx" ON "platform_config" USING btree ("key");--> statement-breakpoint
CREATE INDEX "platform_config_service_idx" ON "platform_config" USING btree ("service");--> statement-breakpoint
CREATE INDEX "portfolio_simulations_org_idx" ON "portfolio_simulations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "portfolio_simulations_status_idx" ON "portfolio_simulations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "price_trends_state_county_idx" ON "price_trends" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "price_trends_type_idx" ON "price_trends" USING btree ("property_type");--> statement-breakpoint
CREATE INDEX "price_trends_period_idx" ON "price_trends" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "property_photos_property_idx" ON "property_photos" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "property_photos_primary_idx" ON "property_photos" USING btree ("is_primary");--> statement-breakpoint
CREATE INDEX "regulatory_changes_location_idx" ON "regulatory_changes" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "regulatory_changes_type_idx" ON "regulatory_changes" USING btree ("change_type");--> statement-breakpoint
CREATE INDEX "regulatory_changes_date_idx" ON "regulatory_changes" USING btree ("effective_date");--> statement-breakpoint
CREATE INDEX "regulatory_requirements_state_idx" ON "regulatory_requirements" USING btree ("state");--> statement-breakpoint
CREATE INDEX "regulatory_requirements_type_idx" ON "regulatory_requirements" USING btree ("requirement_type");--> statement-breakpoint
CREATE INDEX "regulatory_requirements_active_idx" ON "regulatory_requirements" USING btree ("is_active");--> statement-breakpoint
CREATE INDEX "rev_protection_org_idx" ON "revenue_protection_interventions" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "rev_protection_type_idx" ON "revenue_protection_interventions" USING btree ("intervention_type");--> statement-breakpoint
CREATE INDEX "rev_protection_created_idx" ON "revenue_protection_interventions" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "satellite_analysis_org_idx" ON "satellite_analysis" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "satellite_analysis_property_idx" ON "satellite_analysis" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "satellite_analysis_date_idx" ON "satellite_analysis" USING btree ("analysis_date");--> statement-breakpoint
CREATE INDEX "satellite_snapshots_property_idx" ON "satellite_snapshots" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "satellite_snapshots_date_idx" ON "satellite_snapshots" USING btree ("capture_date");--> statement-breakpoint
CREATE INDEX "scraped_deals_state_county_idx" ON "scraped_deals" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "scraped_deals_status_idx" ON "scraped_deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "scraped_deals_auction_date_idx" ON "scraped_deals" USING btree ("auction_date");--> statement-breakpoint
CREATE INDEX "scraped_deals_distress_idx" ON "scraped_deals" USING btree ("distress_score");--> statement-breakpoint
CREATE INDEX "stripe_processed_events_event_id_idx" ON "stripe_processed_events" USING btree ("stripe_event_id");--> statement-breakpoint
CREATE INDEX "IDX_sysact_created" ON "system_activity" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "IDX_sysact_org" ON "system_activity" USING btree ("org_id","created_at");--> statement-breakpoint
CREATE INDEX "IDX_sysact_job" ON "system_activity" USING btree ("job_name","created_at");--> statement-breakpoint
CREATE INDEX "tax_forecast_scenarios_org_idx" ON "tax_forecast_scenarios" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tax_forecast_scenarios_type_idx" ON "tax_forecast_scenarios" USING btree ("scenario_type");--> statement-breakpoint
CREATE INDEX "tax_strategies_org_idx" ON "tax_strategies" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "tax_strategies_type_idx" ON "tax_strategies" USING btree ("strategy_type");--> statement-breakpoint
CREATE INDEX "tax_strategies_status_idx" ON "tax_strategies" USING btree ("status");--> statement-breakpoint
CREATE INDEX "tenant_metrics_tenant_idx" ON "tenant_metrics" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "tenant_metrics_period_idx" ON "tenant_metrics" USING btree ("period_start","period_end");--> statement-breakpoint
CREATE INDEX "territories_org_idx" ON "territories" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "training_metrics_model_version_idx" ON "training_metrics" USING btree ("model_version_id");--> statement-breakpoint
CREATE INDEX "training_metrics_metric_name_idx" ON "training_metrics" USING btree ("metric_name");--> statement-breakpoint
CREATE INDEX "training_metrics_split_type_idx" ON "training_metrics" USING btree ("split_type");--> statement-breakpoint
CREATE INDEX "fee_settlements_org_idx" ON "transaction_fee_settlements" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fee_settlements_transaction_idx" ON "transaction_fee_settlements" USING btree ("transaction_id");--> statement-breakpoint
CREATE INDEX "fee_settlements_status_idx" ON "transaction_fee_settlements" USING btree ("status");--> statement-breakpoint
CREATE INDEX "transaction_training_state_county_idx" ON "transaction_training" USING btree ("state","county");--> statement-breakpoint
CREATE INDEX "transaction_training_type_idx" ON "transaction_training" USING btree ("property_type");--> statement-breakpoint
CREATE INDEX "transaction_training_date_idx" ON "transaction_training" USING btree ("sale_date");--> statement-breakpoint
CREATE INDEX "tutor_sessions_user_idx" ON "tutor_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_map_layer_prefs_user_idx" ON "user_map_layer_preferences" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "user_map_layer_prefs_unique_idx" ON "user_map_layer_preferences" USING btree ("user_id","layer_id");--> statement-breakpoint
CREATE INDEX "valuation_predictions_property_idx" ON "valuation_predictions" USING btree ("property_id");--> statement-breakpoint
CREATE INDEX "valuation_predictions_valid_idx" ON "valuation_predictions" USING btree ("valid_until");--> statement-breakpoint
CREATE INDEX "voice_call_recordings_org_idx" ON "voice_call_recordings" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "voice_call_recordings_call_idx" ON "voice_call_recordings" USING btree ("voice_call_id");--> statement-breakpoint
CREATE INDEX "voice_call_recordings_status_idx" ON "voice_call_recordings" USING btree ("transcription_status");--> statement-breakpoint
CREATE INDEX "voice_calls_org_idx" ON "voice_calls" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "voice_calls_contact_idx" ON "voice_calls" USING btree ("contact_id");--> statement-breakpoint
CREATE INDEX "voice_calls_date_idx" ON "voice_calls" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "whitelabel_tenants_subdomain_idx" ON "whitelabel_tenants" USING btree ("subdomain");--> statement-breakpoint
CREATE INDEX "IDX_prt_token" ON "password_reset_tokens" USING btree ("token");--> statement-breakpoint
CREATE INDEX "IDX_prt_user" ON "password_reset_tokens" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "IDX_prt_expires" ON "password_reset_tokens" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "IDX_referrals_referrer" ON "referrals" USING btree ("referrer_id");--> statement-breakpoint
CREATE INDEX "IDX_referrals_code" ON "referrals" USING btree ("code");--> statement-breakpoint
CREATE INDEX "IDX_referrals_referee" ON "referrals" USING btree ("referee_id");--> statement-breakpoint
CREATE INDEX "leads_deleted_at_idx" ON "leads" USING btree ("deleted_at");--> statement-breakpoint
ALTER TABLE "mailing_order_pieces" ADD CONSTRAINT "mailing_order_pieces_tracking_code_unique" UNIQUE("tracking_code");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_referral_code_unique" UNIQUE("referral_code");