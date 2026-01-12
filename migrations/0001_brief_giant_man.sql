CREATE TABLE "ad_postings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"platform" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"headline" text,
	"story_content" text,
	"listing_price" numeric NOT NULL,
	"terms_price" numeric,
	"down_payment" numeric,
	"monthly_payment" numeric,
	"image_urls" text[],
	"video_url" text,
	"external_listing_id" text,
	"external_url" text,
	"views" integer DEFAULT 0,
	"inquiries" integer DEFAULT 0,
	"clicks" integer DEFAULT 0,
	"ai_generated" boolean DEFAULT false,
	"posted_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"event_source" text NOT NULL,
	"payload" jsonb NOT NULL,
	"related_entity_type" text,
	"related_entity_id" integer,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_feedback" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_task_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"rating" integer NOT NULL,
	"helpful" boolean NOT NULL,
	"feedback" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"memory_type" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"confidence" numeric DEFAULT '0.5',
	"usage_count" integer DEFAULT 0,
	"last_used_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"agent_name" text NOT NULL,
	"status" text DEFAULT 'idle' NOT NULL,
	"last_run_at" timestamp,
	"next_run_at" timestamp,
	"processed_count" integer DEFAULT 0,
	"error_count" integer DEFAULT 0,
	"last_error" text,
	"metadata" jsonb,
	CONSTRAINT "agent_runs_agent_name_unique" UNIQUE("agent_name")
);
--> statement-breakpoint
CREATE TABLE "agent_session_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"session_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"step_number" integer NOT NULL,
	"agent_type" text NOT NULL,
	"skill_used" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb,
	"output" jsonb,
	"error" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"execution_time_ms" integer,
	"depends_on_steps" integer[],
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"session_type" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"shared_context" jsonb DEFAULT '{}'::jsonb,
	"config" jsonb,
	"initiated_by" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "api_usage_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"service" text NOT NULL,
	"action" text NOT NULL,
	"count" integer DEFAULT 1,
	"estimated_cost_cents" integer DEFAULT 0,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_executions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"rule_id" integer NOT NULL,
	"trigger" text NOT NULL,
	"trigger_data" jsonb,
	"conditions_met" boolean DEFAULT true,
	"conditions_result" jsonb,
	"actions_executed" jsonb,
	"status" text DEFAULT 'completed' NOT NULL,
	"error" text,
	"executed_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "automation_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" text NOT NULL,
	"conditions" jsonb,
	"actions" jsonb NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"execution_count" integer DEFAULT 0,
	"last_executed_at" timestamp,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "autopay_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"borrower_name" text NOT NULL,
	"borrower_email" text,
	"payment_method" text NOT NULL,
	"stripe_customer_id" text,
	"stripe_payment_method_id" text,
	"amount" numeric NOT NULL,
	"day_of_month" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_payment_date" timestamp,
	"next_payment_date" timestamp,
	"failure_count" integer DEFAULT 0,
	"last_failure_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "borrower_payment_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"note_id" integer,
	"stripe_customer_id" text NOT NULL,
	"stripe_connect_account_id" text NOT NULL,
	"default_payment_method_id" text,
	"payment_method_type" text,
	"payment_method_last4" text,
	"payment_method_brand" text,
	"autopay_enabled" boolean DEFAULT false,
	"autopay_day" integer,
	"email" text,
	"phone" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "borrower_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"note_id" integer NOT NULL,
	"session_token" text NOT NULL,
	"email" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	"last_accessed_at" timestamp DEFAULT now(),
	CONSTRAINT "borrower_sessions_session_token_unique" UNIQUE("session_token")
);
--> statement-breakpoint
CREATE TABLE "browser_automation_jobs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer,
	"name" text NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"priority" integer DEFAULT 5,
	"input_data" jsonb,
	"output_data" jsonb,
	"screenshots" jsonb,
	"error" text,
	"error_details" jsonb,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"started_at" timestamp,
	"completed_at" timestamp,
	"execution_time_ms" integer,
	"triggered_by_agent_task_id" integer,
	"triggered_by_user_id" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "browser_automation_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"target_domain" text,
	"steps" jsonb,
	"input_schema" jsonb,
	"output_schema" jsonb,
	"requires_auth" boolean DEFAULT false,
	"estimated_duration_ms" integer,
	"is_public" boolean DEFAULT false,
	"is_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "browser_session_credentials" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"domain" text NOT NULL,
	"name" text NOT NULL,
	"encrypted_data" text,
	"last_validated_at" timestamp,
	"is_valid" boolean DEFAULT true,
	"validation_error" text,
	"last_used_at" timestamp,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_prequalifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"intended_use" text,
	"budget_min" numeric,
	"budget_max" numeric,
	"prefers_cash" boolean DEFAULT false,
	"prefers_terms" boolean DEFAULT false,
	"down_payment_available" numeric,
	"monthly_payment_capacity" numeric,
	"employment_status" text,
	"credit_range_reported" text,
	"qualification_score" integer,
	"score_factors" jsonb,
	"last_contact_at" timestamp,
	"next_follow_up_at" timestamp,
	"follow_up_notes" text,
	"ai_assessment" text,
	"ai_recommendation" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"profile_type" text DEFAULT 'individual' NOT NULL,
	"preferences" jsonb,
	"financial_info" jsonb,
	"intent" jsonb,
	"engagement" jsonb,
	"qualification_score" integer,
	"match_confidence" integer,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_property_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"buyer_profile_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"match_score" integer NOT NULL,
	"match_factors" jsonb,
	"match_reasons" jsonb,
	"potential_concerns" jsonb,
	"suggested_pitch" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"presented_at" timestamp,
	"buyer_response" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_qualifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"buyer_profile_id" integer NOT NULL,
	"checks" jsonb,
	"financing_readiness" jsonb,
	"assessment" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"qualified_at" timestamp,
	"qualified_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "buyer_reservations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"buyer_id" integer,
	"buyer_name" text NOT NULL,
	"buyer_email" text,
	"buyer_phone" text,
	"reservation_amount" numeric,
	"reservation_date" timestamp DEFAULT now(),
	"expiration_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"payment_method" text,
	"stripe_payment_intent_id" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "call_transcripts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"deal_id" integer,
	"call_id" text,
	"direction" text NOT NULL,
	"call_type" text NOT NULL,
	"caller_phone" text,
	"duration" integer,
	"call_started_at" timestamp,
	"call_ended_at" timestamp,
	"transcript_raw" text,
	"transcript_formatted" jsonb,
	"transcription_provider" text,
	"transcription_confidence" numeric,
	"summary" text,
	"sentiment" text,
	"sentiment_score" numeric,
	"action_items" jsonb,
	"extracted_data" jsonb,
	"coaching_insights" jsonb,
	"crm_updates_applied" jsonb,
	"audio_url" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "cash_flow_forecasts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer,
	"property_id" integer,
	"forecast_date" timestamp NOT NULL,
	"forecast_period_months" integer DEFAULT 12 NOT NULL,
	"projected_income" jsonb,
	"projected_expenses" jsonb,
	"total_projected_income" numeric,
	"total_projected_expenses" numeric,
	"net_cash_flow" numeric,
	"payment_risk_score" integer,
	"risk_factors" jsonb,
	"payment_health" jsonb,
	"insights" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "closing_packets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"type" text NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collection_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sequence_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"payment_id" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0,
	"started_at" timestamp DEFAULT now() NOT NULL,
	"last_step_at" timestamp,
	"next_step_at" timestamp,
	"completed_at" timestamp,
	"outcome" text,
	"amount_recovered" numeric DEFAULT '0',
	"step_history" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "collection_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"is_default" boolean DEFAULT false,
	"steps" jsonb NOT NULL,
	"auto_start" boolean DEFAULT true,
	"pause_on_payment" boolean DEFAULT true,
	"pause_on_contact" boolean DEFAULT false,
	"total_enrolled" integer DEFAULT 0,
	"payments_recovered" integer DEFAULT 0,
	"total_recovered_amount" numeric DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_checks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"rule_id" integer,
	"check_type" text NOT NULL,
	"check_description" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"findings" jsonb,
	"resolved_at" timestamp,
	"resolution_notes" text,
	"last_checked_at" timestamp,
	"next_check_due" timestamp,
	"checked_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text,
	"municipality" text,
	"rule_type" text NOT NULL,
	"rule_name" text NOT NULL,
	"rule_description" text,
	"requirements" jsonb,
	"triggers" jsonb,
	"penalties" jsonb,
	"source_url" text,
	"last_verified" timestamp,
	"effective_date" timestamp,
	"expiration_date" timestamp,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "county_gis_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"fips_code" text,
	"endpoint_type" text DEFAULT 'arcgis_rest' NOT NULL,
	"base_url" text NOT NULL,
	"layer_id" text,
	"apn_field" text DEFAULT 'APN',
	"owner_field" text DEFAULT 'OWNER',
	"geometry_field" text,
	"additional_params" jsonb,
	"field_mappings" jsonb,
	"is_verified" boolean DEFAULT false,
	"last_verified" timestamp,
	"is_active" boolean DEFAULT true,
	"error_count" integer DEFAULT 0,
	"last_error" text,
	"source_url" text,
	"notes" text,
	"contributed_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "county_redemption_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"year" integer NOT NULL,
	"sale_type" text NOT NULL,
	"total_sales" integer,
	"total_redemptions" integer,
	"redemption_rate" numeric,
	"average_redemption_months" numeric,
	"average_tax_amount" numeric,
	"average_property_value" numeric,
	"data_source" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "county_research" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"assessor_phone" text,
	"assessor_email" text,
	"assessor_website" text,
	"recorder_phone" text,
	"recorder_email" text,
	"recorder_website" text,
	"treasurer_phone" text,
	"treasurer_email" text,
	"treasurer_website" text,
	"gis_portal_url" text,
	"gis_api_endpoint" text,
	"has_online_maps" boolean DEFAULT false,
	"transfer_tax" numeric,
	"recording_fee" numeric,
	"title_search_cost" numeric,
	"closing_process" text,
	"median_land_price" numeric,
	"avg_days_on_market" integer,
	"sales_volume_last_12mo" integer,
	"market_notes" text,
	"investor_friendly" boolean,
	"competition_level" text,
	"last_updated_at" timestamp DEFAULT now(),
	"data_source" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "data_source_cache" (
	"id" serial PRIMARY KEY NOT NULL,
	"data_source_id" integer,
	"lookup_key" text NOT NULL,
	"state" text,
	"county" text,
	"data" jsonb,
	"fetched_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"successful_fetch" boolean DEFAULT true,
	"error_message" text
);
--> statement-breakpoint
CREATE TABLE "data_sources" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"title" text NOT NULL,
	"category" text NOT NULL,
	"subcategory" text,
	"description" text,
	"portal_url" text,
	"api_url" text,
	"coverage" text,
	"access_level" text DEFAULT 'free' NOT NULL,
	"auth_requirements" text,
	"rate_limit_notes" text,
	"cost_per_call" integer DEFAULT 0,
	"data_types" text[],
	"endpoint_type" text,
	"query_params" jsonb,
	"field_mappings" jsonb,
	"is_enabled" boolean DEFAULT true,
	"is_verified" boolean DEFAULT false,
	"last_verified_at" timestamp,
	"last_status" text,
	"last_status_message" text,
	"freshness_days" integer DEFAULT 30,
	"priority" integer DEFAULT 100,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "data_sources_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "dd_assignments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"assignee_type" text NOT NULL,
	"assignee_id" integer,
	"vendor_name" text,
	"vendor_email" text,
	"task_type" text NOT NULL,
	"due_date" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'normal',
	"cost" numeric,
	"result" text,
	"result_notes" text,
	"attachments" jsonb DEFAULT '[]'::jsonb,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_pattern_matches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"target_property_id" integer,
	"target_deal_id" integer,
	"pattern_id" integer NOT NULL,
	"similarity_score" numeric NOT NULL,
	"matched_dimensions" jsonb,
	"insights" jsonb,
	"insights_applied" boolean DEFAULT false,
	"actual_outcome" text,
	"insight_helpful" boolean,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_patterns" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"fingerprint" jsonb,
	"outcome" text NOT NULL,
	"profit_amount" numeric,
	"roi_percent" numeric,
	"days_to_complete" integer,
	"success_factors" jsonb,
	"challenges_faced" jsonb,
	"lessons_learned" jsonb,
	"times_matched" integer DEFAULT 0,
	"match_success_rate" numeric,
	"embedding_vector" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "delinquency_escalations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"days_delinquent" integer NOT NULL,
	"escalation_level" integer DEFAULT 1 NOT NULL,
	"amount_due" numeric NOT NULL,
	"last_contact_date" timestamp,
	"last_contact_method" text,
	"next_action_date" timestamp,
	"next_action" text,
	"status" text DEFAULT 'active' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "discovered_endpoints" (
	"id" serial PRIMARY KEY NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"base_url" text NOT NULL,
	"endpoint_type" text DEFAULT 'arcgis_rest' NOT NULL,
	"service_name" text,
	"discovery_source" text NOT NULL,
	"discovery_date" timestamp DEFAULT now() NOT NULL,
	"last_checked" timestamp,
	"status" text DEFAULT 'pending' NOT NULL,
	"health_check_passed" boolean,
	"health_check_message" text,
	"confidence_score" integer,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "disposition_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"strategy" text NOT NULL,
	"confidence" integer NOT NULL,
	"pricing" jsonb,
	"channels" jsonb,
	"timing" jsonb,
	"target_buyer" jsonb,
	"owner_finance_terms" jsonb,
	"roi_analysis" jsonb,
	"alternatives" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_analysis" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"deal_id" integer,
	"document_type" text NOT NULL,
	"document_name" text NOT NULL,
	"file_url" text,
	"file_hash" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"processed_at" timestamp,
	"raw_text" text,
	"ocr_confidence" numeric,
	"extracted_data" jsonb,
	"key_terms" jsonb,
	"risk_flags" jsonb,
	"version" integer DEFAULT 1,
	"previous_version_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_packages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"deal_id" integer,
	"property_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"documents" jsonb DEFAULT '[]'::jsonb,
	"created_by" text,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer NOT NULL,
	"document_type" text NOT NULL,
	"version" integer NOT NULL,
	"content" text NOT NULL,
	"variables" jsonb,
	"changes" text,
	"created_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "due_diligence_dossiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"requested_by" integer,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'queued' NOT NULL,
	"started_at" timestamp,
	"completed_at" timestamp,
	"agents_assigned" jsonb,
	"findings" jsonb,
	"investability_score" integer,
	"risk_score" integer,
	"score_breakdown" jsonb,
	"recommendation" text,
	"recommendation_reasoning" text,
	"red_flags" jsonb,
	"green_flags" jsonb,
	"executive_summary" text,
	"detailed_report" text,
	"api_costs_incurred" numeric,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "email_sender_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"team_member_id" integer,
	"type" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text NOT NULL,
	"reply_to_email" text,
	"reply_routing_mode" text DEFAULT 'in_app' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"verification_token" text,
	"verified_at" timestamp,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"dns_records" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "escalation_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"conversation_id" integer,
	"property_id" integer,
	"alert_type" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"suggested_action" text,
	"suggested_response" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by" text,
	"action_taken" text,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "escrow_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"title" text NOT NULL,
	"items" jsonb DEFAULT '[]'::jsonb,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"target_close_date" timestamp,
	"actual_close_date" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "event_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"subscriber_type" text NOT NULL,
	"subscriber_id" text NOT NULL,
	"event_type" text NOT NULL,
	"event_filter" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"last_triggered_at" timestamp,
	"trigger_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "feature_requests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"priority" text DEFAULT 'medium',
	"status" text DEFAULT 'submitted',
	"founder_notes" text,
	"upvotes" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "go_nogo_memos" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"deal_id" integer,
	"decision" text NOT NULL,
	"decision_date" timestamp DEFAULT now(),
	"decision_by" text,
	"max_offer_price" numeric,
	"target_profit" numeric,
	"risk_level" text,
	"key_findings" jsonb DEFAULT '[]'::jsonb,
	"conditions" jsonb DEFAULT '[]'::jsonb,
	"attached_reports" jsonb DEFAULT '[]'::jsonb,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "inbox_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sender_email" text NOT NULL,
	"sender_name" text,
	"recipient_email" text NOT NULL,
	"subject" text,
	"body_text" text,
	"body_html" text,
	"lead_id" integer,
	"conversation_id" integer,
	"in_reply_to_message_id" text,
	"message_id" text,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"read_by" text,
	"is_archived" boolean DEFAULT false,
	"is_starred" boolean DEFAULT false,
	"forwarded_to_email" text,
	"forwarded_at" timestamp,
	"raw_headers" jsonb,
	"attachments" jsonb,
	"received_at" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "job_cursors" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_type" text NOT NULL,
	"last_processed_id" integer,
	"last_run_at" timestamp,
	"status" text DEFAULT 'idle',
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "job_cursors_job_type_unique" UNIQUE("job_type")
);
--> statement-breakpoint
CREATE TABLE "job_locks" (
	"id" serial PRIMARY KEY NOT NULL,
	"job_name" text NOT NULL,
	"locked_by" text NOT NULL,
	"locked_at" timestamp DEFAULT now(),
	"expires_at" timestamp NOT NULL,
	CONSTRAINT "job_locks_job_name_unique" UNIQUE("job_name")
);
--> statement-breakpoint
CREATE TABLE "lead_conversions" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"conversion_type" text NOT NULL,
	"score_at_conversion" integer,
	"campaign_id" integer,
	"campaign_type" text,
	"touch_number" integer,
	"days_from_first_touch" integer,
	"days_from_score" integer,
	"deal_value" integer,
	"profit_margin" integer,
	"converted_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_qualification_signals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"conversation_id" integer,
	"signal_type" text NOT NULL,
	"confidence" numeric NOT NULL,
	"extracted_text" text,
	"intent_score" integer,
	"metadata" jsonb,
	"detected_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_score_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"profile_id" integer,
	"score" integer NOT NULL,
	"previous_score" integer,
	"factors" jsonb,
	"enrichment_data" jsonb,
	"trigger_source" text,
	"scored_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_scoring_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"is_active" boolean DEFAULT true,
	"ownership_duration_weight" integer DEFAULT 15,
	"tax_delinquency_weight" integer DEFAULT 20,
	"absentee_owner_weight" integer DEFAULT 15,
	"property_size_weight" integer DEFAULT 10,
	"assessed_value_weight" integer DEFAULT 10,
	"corporate_owner_weight" integer DEFAULT 10,
	"multiple_properties_weight" integer DEFAULT 10,
	"inheritance_indicator_weight" integer DEFAULT 15,
	"out_of_state_weight" integer DEFAULT 15,
	"flood_zone_weight" integer DEFAULT 10,
	"market_activity_weight" integer DEFAULT 15,
	"development_potential_weight" integer DEFAULT 10,
	"response_recency_weight" integer DEFAULT 25,
	"email_engagement_weight" integer DEFAULT 15,
	"campaign_touches_weight" integer DEFAULT 10,
	"hot_threshold" integer DEFAULT 70,
	"warm_threshold" integer DEFAULT 40,
	"cold_threshold" integer DEFAULT 20,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mail_sender_identities" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"company_name" text NOT NULL,
	"address_line_1" text NOT NULL,
	"address_line_2" text,
	"city" text NOT NULL,
	"state" text NOT NULL,
	"zip_code" text NOT NULL,
	"country" text DEFAULT 'US' NOT NULL,
	"lob_address_id" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"verification_details" jsonb,
	"verified_at" timestamp,
	"is_default" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mailing_order_pieces" (
	"id" serial PRIMARY KEY NOT NULL,
	"mailing_order_id" integer NOT NULL,
	"lead_id" integer,
	"recipient_name" text NOT NULL,
	"recipient_address_line_1" text NOT NULL,
	"recipient_address_line_2" text,
	"recipient_city" text NOT NULL,
	"recipient_state" text NOT NULL,
	"recipient_zip_code" text NOT NULL,
	"lob_mail_id" text,
	"lob_url" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"tracking_events" jsonb,
	"expected_delivery_date" timestamp,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "mailing_orders" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"campaign_id" integer,
	"mail_sender_identity_id" integer,
	"return_address_snapshot" jsonb,
	"mail_type" text NOT NULL,
	"template_id" text,
	"total_pieces" integer DEFAULT 0 NOT NULL,
	"sent_pieces" integer DEFAULT 0 NOT NULL,
	"failed_pieces" integer DEFAULT 0 NOT NULL,
	"cost_per_piece" integer DEFAULT 0 NOT NULL,
	"total_cost" integer DEFAULT 0 NOT NULL,
	"credits_used" integer DEFAULT 0 NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"lob_job_ids" jsonb,
	"error_message" text,
	"started_at" timestamp,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_metrics" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"metric_date" timestamp NOT NULL,
	"period_type" text DEFAULT 'monthly' NOT NULL,
	"sales_volume" integer,
	"average_days_on_market" numeric,
	"median_days_on_market" numeric,
	"inventory_count" integer,
	"absorption_rate" numeric,
	"median_price_per_acre" numeric,
	"average_price_per_acre" numeric,
	"median_sale_price" numeric,
	"average_sale_price" numeric,
	"price_change_percent" numeric,
	"year_over_year_change_percent" numeric,
	"new_listings_count" integer,
	"price_reductions_count" integer,
	"withdrawn_listings_count" integer,
	"expired_listings_count" integer,
	"permit_data" jsonb,
	"population_data" jsonb,
	"infrastructure_data" jsonb,
	"economic_data" jsonb,
	"market_health_score" integer,
	"growth_potential_score" integer,
	"investment_score" integer,
	"market_status" text,
	"data_sources" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "market_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"prediction_type" text NOT NULL,
	"prediction_date" timestamp DEFAULT now() NOT NULL,
	"target_date" timestamp NOT NULL,
	"horizon_months" integer NOT NULL,
	"predicted_value" numeric,
	"predicted_direction" text,
	"predicted_change_percent" numeric,
	"predicted_market_status" text,
	"confidence_score" integer,
	"prediction_factors" jsonb,
	"model_version" text DEFAULT 'v1',
	"algorithm_used" text,
	"actual_value" numeric,
	"actual_direction" text,
	"actual_change_percent" numeric,
	"prediction_error" numeric,
	"accuracy_score" integer,
	"status" text DEFAULT 'active' NOT NULL,
	"verified_at" timestamp,
	"alert_triggered" boolean DEFAULT false,
	"alert_triggered_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "marketing_lists" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"source" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"total_records" integer DEFAULT 0,
	"valid_records" integer DEFAULT 0,
	"duplicates_removed" integer DEFAULT 0,
	"invalid_addresses" integer DEFAULT 0,
	"filters" jsonb,
	"uploaded_file_name" text,
	"scrub_settings" jsonb,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "negotiation_sessions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"deal_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_offer_amount" numeric,
	"seller_ask_amount" numeric,
	"last_counter_amount" numeric,
	"negotiation_round" integer DEFAULT 1,
	"objections" jsonb,
	"suggested_responses" jsonb,
	"counter_offer_history" jsonb,
	"sentiment_history" jsonb,
	"outcome" text,
	"final_amount" numeric,
	"profit_margin" numeric,
	"lessons_learned" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text,
	"entity_type" text,
	"entity_id" integer,
	"is_read" boolean DEFAULT false,
	"read_at" timestamp,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offer_batches" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"pricing_matrix" jsonb NOT NULL,
	"terms_config" jsonb,
	"source_list_id" integer,
	"lead_filters" jsonb,
	"total_offers" integer DEFAULT 0,
	"offers_generated" integer DEFAULT 0,
	"offers_sent" integer DEFAULT 0,
	"offers_accepted" integer DEFAULT 0,
	"generated_at" timestamp,
	"sent_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"batch_id" integer,
	"lead_id" integer,
	"property_id" integer,
	"status" text DEFAULT 'draft' NOT NULL,
	"cash_offer" numeric,
	"terms_offer" numeric,
	"down_payment" numeric,
	"monthly_payment" numeric,
	"interest_rate" numeric,
	"term_months" integer,
	"estimated_market_value" numeric,
	"offer_percentage" numeric,
	"counter_offer" numeric,
	"seller_notes" text,
	"responded_at" timestamp,
	"sent_at" timestamp,
	"viewed_at" timestamp,
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "opportunity_scores" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"radar_config_id" integer,
	"property_id" integer,
	"apn" text,
	"county" text,
	"state" text,
	"opportunity_type" text NOT NULL,
	"score" integer NOT NULL,
	"previous_score" integer,
	"score_change" integer,
	"rank" integer,
	"score_factors" jsonb,
	"explanation" text,
	"data_sources" jsonb,
	"enrichment_data" jsonb,
	"status" text DEFAULT 'new' NOT NULL,
	"alert_sent" boolean DEFAULT false,
	"alert_sent_at" timestamp,
	"due_diligence_triggered" boolean DEFAULT false,
	"reviewed_by" text,
	"reviewed_at" timestamp,
	"review_notes" text,
	"expires_at" timestamp,
	"is_stale" boolean DEFAULT false,
	"scored_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "outcome_telemetry" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"outcome_type" text NOT NULL,
	"outcome" jsonb NOT NULL,
	"contributing_factors" jsonb,
	"related_lead_id" integer,
	"related_property_id" integer,
	"related_deal_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "parcel_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"apn" text NOT NULL,
	"state" text NOT NULL,
	"county" text NOT NULL,
	"fips_code" text,
	"source" text DEFAULT 'regrid' NOT NULL,
	"source_id" text,
	"boundary" jsonb,
	"centroid" jsonb,
	"owner" text,
	"owner_address" text,
	"mailing_address" text,
	"site_address" text,
	"acres" numeric,
	"legal_description" text,
	"zoning" text,
	"land_use" text,
	"property_type" text,
	"assessed_value" numeric,
	"market_value" numeric,
	"tax_amount" numeric,
	"tax_year" integer,
	"last_sale_price" numeric,
	"last_sale_date" timestamp,
	"raw_data" jsonb,
	"fetched_at" timestamp DEFAULT now(),
	"expires_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payoff_quotes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"requested_by" text,
	"principal_balance" numeric NOT NULL,
	"accrued_interest" numeric NOT NULL,
	"fees" numeric DEFAULT '0',
	"total_payoff" numeric NOT NULL,
	"good_through_date" timestamp NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"paid_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "playbook_instances" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" text NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"linked_deal_id" integer,
	"linked_property_id" integer,
	"linked_lead_id" integer,
	"completed_steps" jsonb DEFAULT '[]'::jsonb,
	"step_data" jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "portfolio_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"alert_type" text NOT NULL,
	"severity" text DEFAULT 'medium' NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"triggered_by" text,
	"trigger_data" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"acknowledged_at" timestamp,
	"acknowledged_by" integer,
	"resolved_at" timestamp,
	"resolution" text,
	"suggested_actions" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "price_recommendations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"recommendation_type" text NOT NULL,
	"recommended_price" numeric NOT NULL,
	"price_range_min" numeric NOT NULL,
	"price_range_max" numeric NOT NULL,
	"confidence" numeric NOT NULL,
	"comparables_summary" jsonb,
	"adjustments" jsonb,
	"strategy" jsonb,
	"reasoning" text,
	"actual_price" numeric,
	"price_accepted" boolean,
	"outcome_recorded_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "radar_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text DEFAULT 'Default' NOT NULL,
	"is_active" boolean DEFAULT true,
	"weights" jsonb DEFAULT '{"priceVsAssessed":25,"daysOnMarket":15,"sellerMotivation":20,"marketVelocity":15,"comparableSpreads":15,"environmentalRisk":-10,"ownerSignals":20}'::jsonb,
	"thresholds" jsonb DEFAULT '{"hotOpportunity":80,"goodOpportunity":60,"minimumScore":40,"maxDaysOnMarket":365,"minPriceDiscount":10,"maxFloodRisk":50}'::jsonb,
	"target_criteria" jsonb,
	"alert_settings" jsonb DEFAULT '{"enabled":true,"topNPerMarket":10,"autoTriggerDueDiligence":false,"notifyOnHotOnly":false,"digestFrequency":"daily"}'::jsonb,
	"scanner_settings" jsonb DEFAULT '{"batchSize":100,"scanIntervalMinutes":60}'::jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "scheduled_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"config" jsonb NOT NULL,
	"schedule" text NOT NULL,
	"next_run_at" timestamp,
	"last_run_at" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"max_retries" integer DEFAULT 3 NOT NULL,
	"retry_delay_minutes" integer DEFAULT 5 NOT NULL,
	"last_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "seller_communications" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"offer_id" integer,
	"channel" text NOT NULL,
	"direction" text NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"call_duration" integer,
	"call_notes" text,
	"call_outcome" text,
	"tracking_number" text,
	"delivery_status" text,
	"sentiment" text,
	"urgency_score" integer,
	"ai_generated" boolean DEFAULT false,
	"ai_agent_id" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "seller_intent_predictions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"intent_score" integer NOT NULL,
	"intent_level" text NOT NULL,
	"confidence" numeric NOT NULL,
	"signals" jsonb,
	"actual_outcome" text,
	"outcome_recorded_at" timestamp,
	"prediction_accurate" boolean,
	"recommended_approach" text,
	"approach_reasoning" text,
	"suggested_offer_range" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_performance" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"sequence_id" integer,
	"sequence_name" text NOT NULL,
	"channel" text NOT NULL,
	"message_position" integer NOT NULL,
	"template_content" text,
	"subject_line" text,
	"total_sent" integer DEFAULT 0,
	"delivered" integer DEFAULT 0,
	"opened" integer DEFAULT 0,
	"clicked" integer DEFAULT 0,
	"replied" integer DEFAULT 0,
	"converted" integer DEFAULT 0,
	"unsubscribed" integer DEFAULT 0,
	"bounced" integer DEFAULT 0,
	"open_rate" numeric,
	"click_rate" numeric,
	"reply_rate" numeric,
	"conversion_rate" numeric,
	"variant" text,
	"is_winner" boolean,
	"optimization_suggestions" jsonb,
	"best_performing_segments" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "signatures" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"document_id" integer,
	"signer_name" text NOT NULL,
	"signer_email" text,
	"signer_role" text DEFAULT 'signer' NOT NULL,
	"signature_data" text NOT NULL,
	"signature_type" text DEFAULT 'drawn' NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"consent_given" boolean DEFAULT true NOT NULL,
	"consent_text" text,
	"signed_at" timestamp DEFAULT now(),
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "subscription_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"event_type" text NOT NULL,
	"from_tier" text,
	"to_tier" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "swot_reports" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb,
	"weaknesses" jsonb DEFAULT '[]'::jsonb,
	"opportunities" jsonb DEFAULT '[]'::jsonb,
	"threats" jsonb DEFAULT '[]'::jsonb,
	"overall_score" integer,
	"recommendation" text,
	"ai_generated" boolean DEFAULT false,
	"generated_by" text,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_sale_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_active" boolean DEFAULT true,
	"criteria" jsonb,
	"notification_preferences" jsonb,
	"last_triggered_at" timestamp,
	"trigger_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_sale_auctions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"auction_type" text NOT NULL,
	"auction_date" timestamp NOT NULL,
	"auction_end_date" timestamp,
	"registration_deadline" timestamp,
	"auction_format" text DEFAULT 'in_person' NOT NULL,
	"auction_url" text,
	"venue_address" text,
	"venue_name" text,
	"minimum_bid" numeric,
	"deposit_required" numeric,
	"premium_rate" numeric,
	"interest_rate" numeric,
	"redemption_period_months" integer,
	"parcel_count" integer,
	"total_tax_owed" numeric,
	"contact_info" jsonb,
	"requirements" jsonb,
	"source_url" text,
	"last_scraped_at" timestamp,
	"scrape_status" text DEFAULT 'pending',
	"status" text DEFAULT 'scheduled' NOT NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tax_sale_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"auction_id" integer,
	"property_id" integer,
	"apn" text NOT NULL,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"address" text,
	"city" text,
	"zip" text,
	"legal_description" text,
	"sale_type" text NOT NULL,
	"tax_years_delinquent" text[],
	"total_tax_owed" numeric NOT NULL,
	"penalties" numeric,
	"interest" numeric,
	"fees" numeric,
	"total_amount_due" numeric,
	"minimum_bid" numeric,
	"opening_bid" numeric,
	"winning_bid" numeric,
	"assessed_value" numeric,
	"market_value" numeric,
	"acreage" numeric,
	"property_type" text,
	"zoning" text,
	"owner_name" text,
	"owner_address" text,
	"owner_is_out_of_state" boolean,
	"owner_is_corporate" boolean,
	"redemption_period_months" integer,
	"redemption_deadline" timestamp,
	"interest_rate" numeric,
	"redemption_risk_score" integer,
	"redemption_risk_level" text,
	"redemption_factors" jsonb,
	"estimated_roi" numeric,
	"roi_calculation" jsonb,
	"opportunity_score" integer,
	"opportunity_factors" jsonb,
	"status" text DEFAULT 'available' NOT NULL,
	"watchlist_added_at" timestamp,
	"bid_amount" numeric,
	"bid_date" timestamp,
	"source_url" text,
	"certificate_number" text,
	"latitude" numeric,
	"longitude" numeric,
	"notes" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "trust_ledger" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer,
	"entry_type" text NOT NULL,
	"amount" numeric NOT NULL,
	"running_balance" numeric NOT NULL,
	"description" text,
	"reference_id" text,
	"reference_type" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workflow_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"workflow_id" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"trigger_data" jsonb,
	"execution_log" jsonb,
	"started_at" timestamp,
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "workflows" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"trigger" jsonb NOT NULL,
	"actions" jsonb NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "workspace_presets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"layout" jsonb NOT NULL,
	"icon" text,
	"color" text,
	"is_default" boolean DEFAULT false,
	"sort_order" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "writing_style_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"name" text DEFAULT 'Default Style' NOT NULL,
	"is_default" boolean DEFAULT true,
	"tone_analysis" jsonb,
	"patterns" jsonb,
	"sample_messages" jsonb,
	"preferences" jsonb,
	"total_samples" integer DEFAULT 0,
	"last_trained_at" timestamp,
	"confidence_score" numeric DEFAULT '0',
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "enrichment_data" jsonb;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "enrichment_status" text;--> statement-breakpoint
ALTER TABLE "deals" ADD COLUMN "enriched_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "lead_id" integer;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "signed_at" timestamp;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD COLUMN "generated_by" text;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "is_founder" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_started_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_ends_at" timestamp;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_used" boolean DEFAULT false;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_tokens" integer DEFAULT 5;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "trial_tokens_granted_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "ad_postings" ADD CONSTRAINT "ad_postings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ad_postings" ADD CONSTRAINT "ad_postings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_feedback" ADD CONSTRAINT "agent_feedback_agent_task_id_agent_tasks_id_fk" FOREIGN KEY ("agent_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_memory" ADD CONSTRAINT "agent_memory_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_steps" ADD CONSTRAINT "agent_session_steps_session_id_agent_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."agent_sessions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_session_steps" ADD CONSTRAINT "agent_session_steps_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_sessions" ADD CONSTRAINT "agent_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_usage_logs" ADD CONSTRAINT "api_usage_logs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_executions" ADD CONSTRAINT "automation_executions_rule_id_automation_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."automation_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_rules" ADD CONSTRAINT "automation_rules_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopay_enrollments" ADD CONSTRAINT "autopay_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "autopay_enrollments" ADD CONSTRAINT "autopay_enrollments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_payment_profiles" ADD CONSTRAINT "borrower_payment_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_payment_profiles" ADD CONSTRAINT "borrower_payment_profiles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "borrower_sessions" ADD CONSTRAINT "borrower_sessions_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_automation_jobs" ADD CONSTRAINT "browser_automation_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_automation_jobs" ADD CONSTRAINT "browser_automation_jobs_template_id_browser_automation_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."browser_automation_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_automation_jobs" ADD CONSTRAINT "browser_automation_jobs_triggered_by_agent_task_id_agent_tasks_id_fk" FOREIGN KEY ("triggered_by_agent_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "browser_session_credentials" ADD CONSTRAINT "browser_session_credentials_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_prequalifications" ADD CONSTRAINT "buyer_prequalifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_prequalifications" ADD CONSTRAINT "buyer_prequalifications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_prequalifications" ADD CONSTRAINT "buyer_prequalifications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_profiles" ADD CONSTRAINT "buyer_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_profiles" ADD CONSTRAINT "buyer_profiles_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_property_matches" ADD CONSTRAINT "buyer_property_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_property_matches" ADD CONSTRAINT "buyer_property_matches_buyer_profile_id_buyer_profiles_id_fk" FOREIGN KEY ("buyer_profile_id") REFERENCES "public"."buyer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_property_matches" ADD CONSTRAINT "buyer_property_matches_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_qualifications" ADD CONSTRAINT "buyer_qualifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_qualifications" ADD CONSTRAINT "buyer_qualifications_buyer_profile_id_buyer_profiles_id_fk" FOREIGN KEY ("buyer_profile_id") REFERENCES "public"."buyer_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "buyer_reservations" ADD CONSTRAINT "buyer_reservations_buyer_id_leads_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "call_transcripts" ADD CONSTRAINT "call_transcripts_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_forecasts" ADD CONSTRAINT "cash_flow_forecasts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_forecasts" ADD CONSTRAINT "cash_flow_forecasts_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cash_flow_forecasts" ADD CONSTRAINT "cash_flow_forecasts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_packets" ADD CONSTRAINT "closing_packets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "closing_packets" ADD CONSTRAINT "closing_packets_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_enrollments" ADD CONSTRAINT "collection_enrollments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_enrollments" ADD CONSTRAINT "collection_enrollments_sequence_id_collection_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."collection_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_enrollments" ADD CONSTRAINT "collection_enrollments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "collection_sequences" ADD CONSTRAINT "collection_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_checks" ADD CONSTRAINT "compliance_checks_rule_id_compliance_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."compliance_rules"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "data_source_cache" ADD CONSTRAINT "data_source_cache_data_source_id_data_sources_id_fk" FOREIGN KEY ("data_source_id") REFERENCES "public"."data_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dd_assignments" ADD CONSTRAINT "dd_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dd_assignments" ADD CONSTRAINT "dd_assignments_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pattern_matches" ADD CONSTRAINT "deal_pattern_matches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pattern_matches" ADD CONSTRAINT "deal_pattern_matches_target_property_id_properties_id_fk" FOREIGN KEY ("target_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pattern_matches" ADD CONSTRAINT "deal_pattern_matches_target_deal_id_deals_id_fk" FOREIGN KEY ("target_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_pattern_matches" ADD CONSTRAINT "deal_pattern_matches_pattern_id_deal_patterns_id_fk" FOREIGN KEY ("pattern_id") REFERENCES "public"."deal_patterns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_patterns" ADD CONSTRAINT "deal_patterns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_patterns" ADD CONSTRAINT "deal_patterns_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delinquency_escalations" ADD CONSTRAINT "delinquency_escalations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "delinquency_escalations" ADD CONSTRAINT "delinquency_escalations_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_recommendations" ADD CONSTRAINT "disposition_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "disposition_recommendations" ADD CONSTRAINT "disposition_recommendations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_analysis" ADD CONSTRAINT "document_analysis_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_analysis" ADD CONSTRAINT "document_analysis_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_analysis" ADD CONSTRAINT "document_analysis_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_packages" ADD CONSTRAINT "document_packages_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_dossiers" ADD CONSTRAINT "due_diligence_dossiers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_dossiers" ADD CONSTRAINT "due_diligence_dossiers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sender_identities" ADD CONSTRAINT "email_sender_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "email_sender_identities" ADD CONSTRAINT "email_sender_identities_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escalation_alerts" ADD CONSTRAINT "escalation_alerts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_checklists" ADD CONSTRAINT "escrow_checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "escrow_checklists" ADD CONSTRAINT "escrow_checklists_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "event_subscriptions" ADD CONSTRAINT "event_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "feature_requests" ADD CONSTRAINT "feature_requests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "go_nogo_memos" ADD CONSTRAINT "go_nogo_memos_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "go_nogo_memos" ADD CONSTRAINT "go_nogo_memos_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "go_nogo_memos" ADD CONSTRAINT "go_nogo_memos_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inbox_messages" ADD CONSTRAINT "inbox_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversions" ADD CONSTRAINT "lead_conversions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_conversions" ADD CONSTRAINT "lead_conversions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification_signals" ADD CONSTRAINT "lead_qualification_signals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification_signals" ADD CONSTRAINT "lead_qualification_signals_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_qualification_signals" ADD CONSTRAINT "lead_qualification_signals_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_history" ADD CONSTRAINT "lead_score_history_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_history" ADD CONSTRAINT "lead_score_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_score_history" ADD CONSTRAINT "lead_score_history_profile_id_lead_scoring_profiles_id_fk" FOREIGN KEY ("profile_id") REFERENCES "public"."lead_scoring_profiles"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_scoring_profiles" ADD CONSTRAINT "lead_scoring_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mail_sender_identities" ADD CONSTRAINT "mail_sender_identities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_order_pieces" ADD CONSTRAINT "mailing_order_pieces_mailing_order_id_mailing_orders_id_fk" FOREIGN KEY ("mailing_order_id") REFERENCES "public"."mailing_orders"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_order_pieces" ADD CONSTRAINT "mailing_order_pieces_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_orders" ADD CONSTRAINT "mailing_orders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_orders" ADD CONSTRAINT "mailing_orders_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mailing_orders" ADD CONSTRAINT "mailing_orders_mail_sender_identity_id_mail_sender_identities_id_fk" FOREIGN KEY ("mail_sender_identity_id") REFERENCES "public"."mail_sender_identities"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_metrics" ADD CONSTRAINT "market_metrics_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "market_predictions" ADD CONSTRAINT "market_predictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "marketing_lists" ADD CONSTRAINT "marketing_lists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_sessions" ADD CONSTRAINT "negotiation_sessions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_sessions" ADD CONSTRAINT "negotiation_sessions_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "negotiation_sessions" ADD CONSTRAINT "negotiation_sessions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_batches" ADD CONSTRAINT "offer_batches_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_batches" ADD CONSTRAINT "offer_batches_source_list_id_marketing_lists_id_fk" FOREIGN KEY ("source_list_id") REFERENCES "public"."marketing_lists"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_batch_id_offer_batches_id_fk" FOREIGN KEY ("batch_id") REFERENCES "public"."offer_batches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offers" ADD CONSTRAINT "offers_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_radar_config_id_radar_configs_id_fk" FOREIGN KEY ("radar_config_id") REFERENCES "public"."radar_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "opportunity_scores" ADD CONSTRAINT "opportunity_scores_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_telemetry" ADD CONSTRAINT "outcome_telemetry_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_telemetry" ADD CONSTRAINT "outcome_telemetry_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_telemetry" ADD CONSTRAINT "outcome_telemetry_related_property_id_properties_id_fk" FOREIGN KEY ("related_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outcome_telemetry" ADD CONSTRAINT "outcome_telemetry_related_deal_id_deals_id_fk" FOREIGN KEY ("related_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parcel_snapshots" ADD CONSTRAINT "parcel_snapshots_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payoff_quotes" ADD CONSTRAINT "payoff_quotes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payoff_quotes" ADD CONSTRAINT "payoff_quotes_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_instances" ADD CONSTRAINT "playbook_instances_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_instances" ADD CONSTRAINT "playbook_instances_linked_deal_id_deals_id_fk" FOREIGN KEY ("linked_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_instances" ADD CONSTRAINT "playbook_instances_linked_property_id_properties_id_fk" FOREIGN KEY ("linked_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "playbook_instances" ADD CONSTRAINT "playbook_instances_linked_lead_id_leads_id_fk" FOREIGN KEY ("linked_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_alerts" ADD CONSTRAINT "portfolio_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "portfolio_alerts" ADD CONSTRAINT "portfolio_alerts_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recommendations" ADD CONSTRAINT "price_recommendations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "price_recommendations" ADD CONSTRAINT "price_recommendations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "radar_configs" ADD CONSTRAINT "radar_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "scheduled_tasks" ADD CONSTRAINT "scheduled_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_communications" ADD CONSTRAINT "seller_communications_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_communications" ADD CONSTRAINT "seller_communications_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_communications" ADD CONSTRAINT "seller_communications_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_communications" ADD CONSTRAINT "seller_communications_offer_id_offers_id_fk" FOREIGN KEY ("offer_id") REFERENCES "public"."offers"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_communications" ADD CONSTRAINT "seller_communications_ai_agent_id_va_agents_id_fk" FOREIGN KEY ("ai_agent_id") REFERENCES "public"."va_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_intent_predictions" ADD CONSTRAINT "seller_intent_predictions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_intent_predictions" ADD CONSTRAINT "seller_intent_predictions_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "seller_intent_predictions" ADD CONSTRAINT "seller_intent_predictions_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_performance" ADD CONSTRAINT "sequence_performance_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signatures" ADD CONSTRAINT "signatures_document_id_generated_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."generated_documents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swot_reports" ADD CONSTRAINT "swot_reports_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "swot_reports" ADD CONSTRAINT "swot_reports_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_sale_alerts" ADD CONSTRAINT "tax_sale_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_sale_auctions" ADD CONSTRAINT "tax_sale_auctions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_sale_listings" ADD CONSTRAINT "tax_sale_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_sale_listings" ADD CONSTRAINT "tax_sale_listings_auction_id_tax_sale_auctions_id_fk" FOREIGN KEY ("auction_id") REFERENCES "public"."tax_sale_auctions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_sale_listings" ADD CONSTRAINT "tax_sale_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_ledger" ADD CONSTRAINT "trust_ledger_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trust_ledger" ADD CONSTRAINT "trust_ledger_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflow_runs" ADD CONSTRAINT "workflow_runs_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_presets" ADD CONSTRAINT "workspace_presets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "writing_style_profiles" ADD CONSTRAINT "writing_style_profiles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_presets_org_idx" ON "workspace_presets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "workspace_presets_user_idx" ON "workspace_presets" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_tasks_org_idx" ON "agent_tasks" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "agent_tasks_status_idx" ON "agent_tasks" USING btree ("status");--> statement-breakpoint
CREATE INDEX "agent_tasks_created_at_idx" ON "agent_tasks" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "campaigns_org_idx" ON "campaigns" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "campaigns_status_idx" ON "campaigns" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_org_idx" ON "deals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "deals_status_idx" ON "deals" USING btree ("status");--> statement-breakpoint
CREATE INDEX "deals_created_at_idx" ON "deals" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_org_idx" ON "leads" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "leads_status_idx" ON "leads" USING btree ("status");--> statement-breakpoint
CREATE INDEX "leads_created_at_idx" ON "leads" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "leads_email_idx" ON "leads" USING btree ("email");--> statement-breakpoint
CREATE INDEX "notes_org_idx" ON "notes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "notes_status_idx" ON "notes" USING btree ("status");--> statement-breakpoint
CREATE INDEX "notes_borrower_idx" ON "notes" USING btree ("borrower_id");--> statement-breakpoint
CREATE INDEX "payments_note_idx" ON "payments" USING btree ("note_id");--> statement-breakpoint
CREATE INDEX "payments_status_idx" ON "payments" USING btree ("status");--> statement-breakpoint
CREATE INDEX "payments_due_date_idx" ON "payments" USING btree ("due_date");--> statement-breakpoint
CREATE INDEX "properties_org_idx" ON "properties" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "properties_status_idx" ON "properties" USING btree ("status");--> statement-breakpoint
CREATE INDEX "properties_apn_idx" ON "properties" USING btree ("apn");--> statement-breakpoint
CREATE INDEX "properties_created_at_idx" ON "properties" USING btree ("created_at");