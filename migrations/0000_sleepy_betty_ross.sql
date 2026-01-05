CREATE TABLE "ab_test_variants" (
	"id" serial PRIMARY KEY NOT NULL,
	"test_id" integer NOT NULL,
	"name" text NOT NULL,
	"is_control" boolean DEFAULT false,
	"subject" text,
	"content" text,
	"offer_amount" numeric,
	"sample_size" integer DEFAULT 0,
	"sent" integer DEFAULT 0,
	"delivered" integer DEFAULT 0,
	"opened" integer DEFAULT 0,
	"clicked" integer DEFAULT 0,
	"responded" integer DEFAULT 0,
	"converted" integer DEFAULT 0,
	"delivery_rate" numeric,
	"open_rate" numeric,
	"click_rate" numeric,
	"response_rate" numeric,
	"conversion_rate" numeric,
	"confidence_level" numeric,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ab_tests" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"name" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"test_type" text NOT NULL,
	"sample_size_percent" integer DEFAULT 20,
	"winning_metric" text DEFAULT 'response_rate' NOT NULL,
	"min_sample_size" integer DEFAULT 100,
	"started_at" timestamp,
	"completed_at" timestamp,
	"auto_complete_on_significance" boolean DEFAULT true,
	"winner_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "activity_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"user_id" text,
	"campaign_id" integer,
	"event_date" timestamp DEFAULT now() NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "activity_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text,
	"team_member_id" integer,
	"agent_type" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer NOT NULL,
	"description" text,
	"changes" jsonb,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_configs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"config" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "agent_tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_config_id" integer,
	"agent_type" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" integer DEFAULT 5,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"related_lead_id" integer,
	"related_property_id" integer,
	"related_deal_id" integer,
	"started_at" timestamp,
	"completed_at" timestamp,
	"execution_time_ms" integer,
	"requires_review" boolean DEFAULT false,
	"reviewed_by" integer,
	"reviewed_at" timestamp,
	"review_notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_agent_profiles" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"system_prompt" text NOT NULL,
	"capabilities" text[] NOT NULL,
	"icon" text NOT NULL,
	"is_active" boolean DEFAULT true
);
--> statement-breakpoint
CREATE TABLE "ai_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"title" text NOT NULL,
	"agent_role" text DEFAULT 'executive' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_execution_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"conversation_id" integer,
	"agent_role" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"tool_calls" jsonb,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "ai_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"memory_type" text NOT NULL,
	"content" text NOT NULL,
	"source" text,
	"created_at" timestamp DEFAULT now(),
	"expires_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "ai_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"tool_calls" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "ai_tool_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_name" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"parameters" jsonb NOT NULL,
	"requires_approval" boolean DEFAULT false,
	"agent_roles" text[],
	CONSTRAINT "ai_tool_definitions_name_unique" UNIQUE("name")
);
--> statement-breakpoint
CREATE TABLE "api_jobs" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"type" text NOT NULL,
	"operation" text NOT NULL,
	"payload" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"retries" integer DEFAULT 0,
	"max_retries" integer DEFAULT 3,
	"next_retry_at" timestamp,
	"result" jsonb,
	"error" text,
	"created_at" timestamp DEFAULT now(),
	"completed_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" integer,
	"changes" jsonb,
	"ip_address" text,
	"user_agent" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_optimizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"campaign_id" integer NOT NULL,
	"type" text NOT NULL,
	"suggestion" text NOT NULL,
	"reasoning" text NOT NULL,
	"priority" text DEFAULT 'medium' NOT NULL,
	"implemented" boolean DEFAULT false,
	"implemented_at" timestamp,
	"result_delta" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_responses" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"campaign_id" integer,
	"channel" text NOT NULL,
	"response_date" timestamp DEFAULT now() NOT NULL,
	"content" text,
	"tracking_code" text,
	"is_attributed" boolean DEFAULT false,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaign_sequences" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true,
	"enrollment_trigger" text DEFAULT 'manual' NOT NULL,
	"enrollment_criteria" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "campaigns" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"tracking_code" text,
	"target_criteria" jsonb,
	"subject" text,
	"content" text,
	"template_id" text,
	"scheduled_date" timestamp,
	"completed_date" timestamp,
	"total_sent" integer DEFAULT 0,
	"total_delivered" integer DEFAULT 0,
	"total_opened" integer DEFAULT 0,
	"total_clicked" integer DEFAULT 0,
	"total_responded" integer DEFAULT 0,
	"budget" numeric,
	"spent" numeric DEFAULT '0',
	"last_optimized_at" timestamp,
	"optimization_score" integer,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "campaigns_tracking_code_unique" UNIQUE("tracking_code")
);
--> statement-breakpoint
CREATE TABLE "checklist_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"deal_type" text DEFAULT 'all' NOT NULL,
	"items" jsonb NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"property_id" integer,
	"channel" text NOT NULL,
	"external_id" text,
	"status" text DEFAULT 'active' NOT NULL,
	"assigned_agent_id" integer,
	"assigned_human_id" integer,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "credit_transactions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"amount_cents" integer NOT NULL,
	"balance_after_cents" integer NOT NULL,
	"description" text NOT NULL,
	"stripe_payment_intent_id" text,
	"stripe_checkout_session_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "custom_field_definitions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"field_name" text NOT NULL,
	"field_label" text NOT NULL,
	"field_type" text NOT NULL,
	"options" jsonb,
	"is_required" boolean DEFAULT false,
	"display_order" integer DEFAULT 0,
	"placeholder" text,
	"help_text" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "custom_field_values" (
	"id" serial PRIMARY KEY NOT NULL,
	"definition_id" integer NOT NULL,
	"entity_id" integer NOT NULL,
	"value" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deal_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"deal_id" integer NOT NULL,
	"template_id" integer,
	"items" jsonb NOT NULL,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "deals" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"type" text NOT NULL,
	"status" text DEFAULT 'negotiating' NOT NULL,
	"offer_amount" numeric,
	"offer_date" timestamp,
	"counter_amount" numeric,
	"accepted_amount" numeric,
	"closing_date" timestamp,
	"closing_costs" numeric,
	"title_company" text,
	"escrow_number" text,
	"documents" jsonb,
	"analysis_results" jsonb,
	"notes" text,
	"assigned_to" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "digest_subscriptions" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" varchar(255) NOT NULL,
	"organization_id" integer,
	"frequency" text DEFAULT 'weekly' NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"last_sent_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "document_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"category" text DEFAULT 'closing' NOT NULL,
	"content" text NOT NULL,
	"variables" jsonb,
	"is_system_template" boolean DEFAULT false,
	"is_active" boolean DEFAULT true,
	"version" integer DEFAULT 1,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "due_diligence_checklists" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"completed_percent" integer DEFAULT 0,
	"items" jsonb,
	"flood_zone" jsonb,
	"wetlands" jsonb,
	"tax_info" jsonb,
	"hoa_info" jsonb,
	"deed_restrictions" jsonb,
	"access_info" jsonb,
	"utilities_info" jsonb,
	"assigned_to" integer,
	"started_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "due_diligence_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"property_id" integer NOT NULL,
	"template_id" integer,
	"item_name" text NOT NULL,
	"category" text NOT NULL,
	"completed" boolean DEFAULT false NOT NULL,
	"completed_by" text,
	"completed_at" timestamp,
	"notes" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "due_diligence_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"items" jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "dunning_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"stripe_subscription_id" text,
	"stripe_invoice_id" text,
	"stripe_customer_id" text,
	"event_type" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"amount_due_cents" integer,
	"amount_paid_cents" integer,
	"status" text DEFAULT 'pending' NOT NULL,
	"dunning_stage" text DEFAULT 'grace_period' NOT NULL,
	"next_retry_at" timestamp,
	"retry_count" integer DEFAULT 0,
	"max_retries" integer DEFAULT 4,
	"notifications_sent" jsonb,
	"resolved_at" timestamp,
	"resolution_type" text,
	"metadata" jsonb,
	"error_message" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "generated_documents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"template_id" integer,
	"deal_id" integer,
	"property_id" integer,
	"name" text NOT NULL,
	"type" text NOT NULL,
	"content" text,
	"pdf_url" text,
	"variables" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"signers" jsonb,
	"esign_provider" text,
	"esign_envelope_id" text,
	"esign_status" text,
	"sent_at" timestamp,
	"completed_at" timestamp,
	"expires_at" timestamp,
	"created_by" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "lead_activities" (
	"id" serial PRIMARY KEY NOT NULL,
	"lead_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text NOT NULL,
	"description" text,
	"metadata" jsonb,
	"performed_by" integer,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"type" text DEFAULT 'seller' NOT NULL,
	"first_name" text NOT NULL,
	"last_name" text NOT NULL,
	"email" text,
	"phone" text,
	"address" text,
	"city" text,
	"state" text,
	"zip" text,
	"status" text DEFAULT 'new' NOT NULL,
	"source" text,
	"campaign_id" integer,
	"notes" text,
	"tags" jsonb,
	"assigned_to" integer,
	"last_contacted_at" timestamp,
	"source_tracking_code" text,
	"source_campaign_id" integer,
	"score" integer,
	"score_factors" jsonb,
	"last_score_at" timestamp,
	"email_opens" integer DEFAULT 0,
	"email_clicks" integer DEFAULT 0,
	"responses" integer DEFAULT 0,
	"nurturing_stage" text DEFAULT 'new',
	"next_follow_up_at" timestamp,
	"last_ai_message_at" timestamp,
	"tcpa_consent" boolean DEFAULT false,
	"consent_date" timestamp,
	"consent_source" text,
	"opt_out_date" timestamp,
	"opt_out_reason" text,
	"do_not_contact" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"organization_id" integer NOT NULL,
	"direction" text NOT NULL,
	"sender" text NOT NULL,
	"content" text NOT NULL,
	"generated_by_agent" boolean DEFAULT false,
	"agent_task_id" integer,
	"status" text DEFAULT 'sent' NOT NULL,
	"external_id" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer,
	"borrower_id" integer,
	"original_principal" numeric NOT NULL,
	"current_balance" numeric NOT NULL,
	"interest_rate" numeric NOT NULL,
	"term_months" integer NOT NULL,
	"monthly_payment" numeric NOT NULL,
	"service_fee" numeric DEFAULT '0',
	"late_fee" numeric DEFAULT '0',
	"grace_period_days" integer DEFAULT 10,
	"start_date" timestamp NOT NULL,
	"first_payment_date" timestamp NOT NULL,
	"next_payment_date" timestamp,
	"maturity_date" timestamp,
	"status" text DEFAULT 'active' NOT NULL,
	"down_payment" numeric DEFAULT '0',
	"down_payment_received" boolean DEFAULT false,
	"payment_method" text,
	"payment_account_id" text,
	"auto_pay_enabled" boolean DEFAULT false,
	"amortization_schedule" jsonb,
	"access_token" text,
	"pending_checkout_session_id" text,
	"last_reminder_sent_at" timestamp,
	"reminder_count" integer DEFAULT 0,
	"days_delinquent" integer DEFAULT 0,
	"delinquency_status" text DEFAULT 'current',
	"notes_text" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "notes_access_token_unique" UNIQUE("access_token")
);
--> statement-breakpoint
CREATE TABLE "notification_preferences" (
	"id" serial PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"organization_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"email_enabled" boolean DEFAULT true,
	"push_enabled" boolean DEFAULT false,
	"in_app_enabled" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offer_letters" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"property_id" integer,
	"offer_amount" numeric NOT NULL,
	"offer_percent" numeric,
	"assessed_value" numeric,
	"expiration_days" integer DEFAULT 30,
	"expiration_date" timestamp,
	"template_id" text,
	"letter_content" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"delivery_method" text DEFAULT 'direct_mail',
	"lob_mailing_id" text,
	"tracking_number" text,
	"sent_at" timestamp,
	"delivered_at" timestamp,
	"responded_at" timestamp,
	"response_notes" text,
	"batch_id" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "offer_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"type" text DEFAULT 'blind_offer' NOT NULL,
	"subject" text,
	"content" text NOT NULL,
	"is_default" boolean DEFAULT false,
	"variables" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organization_integrations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"provider" text NOT NULL,
	"is_enabled" boolean DEFAULT true,
	"credentials" jsonb,
	"settings" jsonb,
	"last_validated_at" timestamp,
	"validation_error" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "organizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"owner_id" text NOT NULL,
	"subscription_tier" text DEFAULT 'free' NOT NULL,
	"subscription_status" text DEFAULT 'active' NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"credit_balance" numeric DEFAULT '0',
	"dunning_stage" text DEFAULT 'none',
	"dunning_started_at" timestamp,
	"last_payment_failed_at" timestamp,
	"auto_top_up_enabled" boolean DEFAULT false,
	"auto_top_up_threshold_cents" integer DEFAULT 200,
	"auto_top_up_amount_cents" integer DEFAULT 2500,
	"additional_seats" integer DEFAULT 0,
	"onboarding_completed" boolean DEFAULT false,
	"onboarding_step" integer DEFAULT 0,
	"onboarding_data" jsonb,
	"settings" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "organizations_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "payment_reminders" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"borrower_id" integer,
	"type" text NOT NULL,
	"scheduled_for" timestamp NOT NULL,
	"sent_at" timestamp,
	"channel" text DEFAULT 'email' NOT NULL,
	"content" text,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"failure_reason" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"note_id" integer NOT NULL,
	"amount" numeric NOT NULL,
	"principal_amount" numeric NOT NULL,
	"interest_amount" numeric NOT NULL,
	"fee_amount" numeric DEFAULT '0',
	"late_fee_amount" numeric DEFAULT '0',
	"payment_date" timestamp NOT NULL,
	"due_date" timestamp NOT NULL,
	"payment_method" text,
	"transaction_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"failure_reason" text,
	"processed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "properties" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"apn" text NOT NULL,
	"legal_description" text,
	"county" text NOT NULL,
	"state" text NOT NULL,
	"address" text,
	"city" text,
	"zip" text,
	"subdivision" text,
	"lot_number" text,
	"size_acres" numeric NOT NULL,
	"zoning" text,
	"terrain" text,
	"road_access" text,
	"utilities" jsonb,
	"status" text DEFAULT 'prospect' NOT NULL,
	"assessed_value" numeric,
	"market_value" numeric,
	"purchase_price" numeric,
	"purchase_date" timestamp,
	"list_price" numeric,
	"sold_price" numeric,
	"sold_date" timestamp,
	"seller_id" integer,
	"buyer_id" integer,
	"due_diligence_status" text DEFAULT 'pending',
	"due_diligence_data" jsonb,
	"description" text,
	"highlights" jsonb,
	"photos" jsonb,
	"virtual_tour_url" text,
	"latitude" numeric,
	"longitude" numeric,
	"parcel_boundary" jsonb,
	"parcel_centroid" jsonb,
	"parcel_data" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "property_listings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"property_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"asking_price" numeric NOT NULL,
	"minimum_price" numeric,
	"seller_financing_available" boolean DEFAULT true,
	"down_payment_min" numeric,
	"monthly_payment_min" numeric,
	"interest_rate" numeric,
	"term_months" integer,
	"photos" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"syndication_targets" jsonb,
	"view_count" integer DEFAULT 0,
	"inquiry_count" integer DEFAULT 0,
	"published_at" timestamp,
	"expires_at" timestamp,
	"sold_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "provisioned_phone_numbers" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"phone_number" text NOT NULL,
	"twilio_sid" text,
	"friendly_name" text,
	"capabilities" jsonb,
	"status" text DEFAULT 'active' NOT NULL,
	"is_default" boolean DEFAULT false,
	"monthly_rental_cost" numeric,
	"purchased_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "saved_views" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"entity_type" text NOT NULL,
	"name" text NOT NULL,
	"filters" jsonb,
	"sort_by" text,
	"sort_order" text DEFAULT 'desc',
	"columns" jsonb,
	"is_default" boolean DEFAULT false,
	"is_shared" boolean DEFAULT false,
	"created_by" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_enrollments" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer NOT NULL,
	"lead_id" integer NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"current_step" integer DEFAULT 0 NOT NULL,
	"enrolled_at" timestamp DEFAULT now(),
	"last_step_sent_at" timestamp,
	"next_step_scheduled_at" timestamp,
	"pause_reason" text,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sequence_steps" (
	"id" serial PRIMARY KEY NOT NULL,
	"sequence_id" integer NOT NULL,
	"step_number" integer NOT NULL,
	"delay_days" integer DEFAULT 0 NOT NULL,
	"channel" text NOT NULL,
	"template_id" text,
	"subject" text,
	"content" text NOT NULL,
	"condition_type" text DEFAULT 'always' NOT NULL,
	"condition_days" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "skip_traces" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"lead_id" integer,
	"input_data" jsonb,
	"results" jsonb,
	"provider" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"cost_cents" integer,
	"requested_at" timestamp DEFAULT now(),
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"message_id" integer,
	"action_type" text NOT NULL,
	"action_details" jsonb,
	"success" boolean NOT NULL,
	"error_message" text,
	"result_details" jsonb,
	"performed_by" text NOT NULL,
	"approved_by" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"category" text DEFAULT 'other' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"priority" integer DEFAULT 1 NOT NULL,
	"ai_classification" jsonb,
	"resolved_at" timestamp,
	"resolution_summary" text,
	"resolution_type" text,
	"escalated_at" timestamp,
	"escalation_reason" text,
	"assigned_to" text,
	"ai_attempts" integer DEFAULT 0,
	"user_satisfaction" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"case_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"ai_model" text,
	"ai_confidence" numeric,
	"playbook_used" text,
	"actions_attempted" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_playbooks" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"description" text,
	"category" text NOT NULL,
	"trigger_patterns" jsonb,
	"trigger_conditions" jsonb,
	"steps" jsonb,
	"initial_response" text,
	"success_response" text,
	"failure_response" text,
	"escalation_response" text,
	"max_credit_adjustment" integer,
	"requires_approval" boolean DEFAULT false,
	"can_escalate" boolean DEFAULT true,
	"times_used" integer DEFAULT 0,
	"success_rate" numeric,
	"is_active" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "support_playbooks_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "system_alerts" (
	"id" serial PRIMARY KEY NOT NULL,
	"type" varchar(255) NOT NULL,
	"alert_type" text,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"organization_id" integer,
	"related_entity_type" text,
	"related_entity_id" integer,
	"status" text DEFAULT 'new' NOT NULL,
	"acknowledged_at" timestamp,
	"resolved_at" timestamp,
	"auto_resolvable" boolean DEFAULT false,
	"auto_resolve_action" text,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "target_counties" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"state" text NOT NULL,
	"fips_code" text,
	"population" integer,
	"median_home_value" numeric,
	"average_lot_price" numeric,
	"status" text DEFAULT 'researching' NOT NULL,
	"priority" integer DEFAULT 1,
	"notes" text,
	"data_sources" jsonb,
	"metrics" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"due_date" timestamp,
	"priority" text DEFAULT 'medium' NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"assigned_to" integer,
	"created_by" text NOT NULL,
	"entity_type" text DEFAULT 'none' NOT NULL,
	"entity_id" integer,
	"is_recurring" boolean DEFAULT false,
	"recurrence_rule" text,
	"next_occurrence" timestamp,
	"parent_task_id" integer,
	"completed_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_conversations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text,
	"is_direct" boolean DEFAULT true NOT NULL,
	"created_by" text NOT NULL,
	"participant_ids" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"last_message_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "team_member_presence" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"status" text DEFAULT 'offline' NOT NULL,
	"last_seen_at" timestamp DEFAULT now(),
	"device_info" text
);
--> statement-breakpoint
CREATE TABLE "team_members" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"email" text,
	"display_name" text,
	"role" text DEFAULT 'member' NOT NULL,
	"permissions" jsonb,
	"is_active" boolean DEFAULT true NOT NULL,
	"invited_at" timestamp DEFAULT now(),
	"joined_at" timestamp
);
--> statement-breakpoint
CREATE TABLE "team_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"conversation_id" integer NOT NULL,
	"sender_id" text NOT NULL,
	"body" text NOT NULL,
	"attachments" jsonb,
	"read_by" jsonb DEFAULT '[]'::jsonb,
	"is_deleted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"event_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"metadata" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "usage_rates" (
	"id" serial PRIMARY KEY NOT NULL,
	"action_type" text NOT NULL,
	"display_name" text NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "usage_rates_action_type_unique" UNIQUE("action_type")
);
--> statement-breakpoint
CREATE TABLE "usage_records" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"unit_cost_cents" integer NOT NULL,
	"total_cost_cents" integer NOT NULL,
	"metadata" jsonb,
	"billing_month" text NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "va_actions" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_id" integer NOT NULL,
	"action_type" text NOT NULL,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"status" text DEFAULT 'proposed' NOT NULL,
	"priority" integer DEFAULT 5 NOT NULL,
	"input" jsonb NOT NULL,
	"output" jsonb,
	"error" text,
	"related_lead_id" integer,
	"related_property_id" integer,
	"related_note_id" integer,
	"related_campaign_id" integer,
	"requires_approval" boolean DEFAULT true NOT NULL,
	"approved_by" text,
	"approved_at" timestamp,
	"rejection_reason" text,
	"scheduled_for" timestamp,
	"executed_at" timestamp,
	"execution_time_ms" integer,
	"reasoning" text,
	"confidence" numeric,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "va_agents" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_type" text NOT NULL,
	"name" text NOT NULL,
	"avatar" text,
	"description" text,
	"is_enabled" boolean DEFAULT true NOT NULL,
	"is_active" boolean DEFAULT false NOT NULL,
	"last_active_at" timestamp,
	"autonomy_level" text DEFAULT 'supervised' NOT NULL,
	"config" jsonb,
	"metrics" jsonb,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "va_briefings" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"briefing_type" text NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"sections" jsonb,
	"metrics" jsonb,
	"recommendations" jsonb,
	"read_at" timestamp,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "va_calendar_events" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"agent_id" integer,
	"event_type" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"start_time" timestamp NOT NULL,
	"end_time" timestamp,
	"all_day" boolean DEFAULT false,
	"recurring" boolean DEFAULT false,
	"recurrence_rule" text,
	"related_lead_id" integer,
	"related_property_id" integer,
	"related_action_id" integer,
	"status" text DEFAULT 'scheduled' NOT NULL,
	"completed_at" timestamp,
	"reminder_minutes" integer DEFAULT 30,
	"reminded" boolean DEFAULT false,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "va_templates" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"name" text NOT NULL,
	"category" text NOT NULL,
	"agent_types" text[],
	"subject" text,
	"content" text NOT NULL,
	"variables" jsonb,
	"is_active" boolean DEFAULT true,
	"usage_count" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "verified_email_domains" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"domain" text NOT NULL,
	"sendgrid_domain_id" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"dns_records" jsonb,
	"from_email" text,
	"from_name" text,
	"is_default" boolean DEFAULT false,
	"verified_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"sid" varchar PRIMARY KEY NOT NULL,
	"sess" jsonb NOT NULL,
	"expire" timestamp NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" varchar PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" varchar,
	"first_name" varchar,
	"last_name" varchar,
	"profile_image_url" varchar,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "ab_test_variants" ADD CONSTRAINT "ab_test_variants_test_id_ab_tests_id_fk" FOREIGN KEY ("test_id") REFERENCES "public"."ab_tests"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ab_tests" ADD CONSTRAINT "ab_tests_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_events" ADD CONSTRAINT "activity_events_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "activity_log" ADD CONSTRAINT "activity_log_team_member_id_team_members_id_fk" FOREIGN KEY ("team_member_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_configs" ADD CONSTRAINT "agent_configs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_agent_config_id_agent_configs_id_fk" FOREIGN KEY ("agent_config_id") REFERENCES "public"."agent_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_related_property_id_properties_id_fk" FOREIGN KEY ("related_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_tasks" ADD CONSTRAINT "agent_tasks_related_deal_id_deals_id_fk" FOREIGN KEY ("related_deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "api_jobs" ADD CONSTRAINT "api_jobs_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_optimizations" ADD CONSTRAINT "campaign_optimizations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_optimizations" ADD CONSTRAINT "campaign_optimizations_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_responses" ADD CONSTRAINT "campaign_responses_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_sequences" ADD CONSTRAINT "campaign_sequences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checklist_templates" ADD CONSTRAINT "checklist_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_agent_id_agent_configs_id_fk" FOREIGN KEY ("assigned_agent_id") REFERENCES "public"."agent_configs"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_assigned_human_id_team_members_id_fk" FOREIGN KEY ("assigned_human_id") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "credit_transactions" ADD CONSTRAINT "credit_transactions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_definitions" ADD CONSTRAINT "custom_field_definitions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "custom_field_values" ADD CONSTRAINT "custom_field_values_definition_id_custom_field_definitions_id_fk" FOREIGN KEY ("definition_id") REFERENCES "public"."custom_field_definitions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_checklists" ADD CONSTRAINT "deal_checklists_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deal_checklists" ADD CONSTRAINT "deal_checklists_template_id_checklist_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."checklist_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deals" ADD CONSTRAINT "deals_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "digest_subscriptions" ADD CONSTRAINT "digest_subscriptions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checklists" ADD CONSTRAINT "due_diligence_checklists_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_checklists" ADD CONSTRAINT "due_diligence_checklists_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_items" ADD CONSTRAINT "due_diligence_items_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_items" ADD CONSTRAINT "due_diligence_items_template_id_due_diligence_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."due_diligence_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "due_diligence_templates" ADD CONSTRAINT "due_diligence_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dunning_events" ADD CONSTRAINT "dunning_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_template_id_document_templates_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."document_templates"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_deal_id_deals_id_fk" FOREIGN KEY ("deal_id") REFERENCES "public"."deals"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "generated_documents" ADD CONSTRAINT "generated_documents_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lead_activities" ADD CONSTRAINT "lead_activities_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_agent_task_id_agent_tasks_id_fk" FOREIGN KEY ("agent_task_id") REFERENCES "public"."agent_tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_borrower_id_leads_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_letters" ADD CONSTRAINT "offer_letters_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "offer_templates" ADD CONSTRAINT "offer_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "organization_integrations" ADD CONSTRAINT "organization_integrations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_reminders" ADD CONSTRAINT "payment_reminders_borrower_id_leads_id_fk" FOREIGN KEY ("borrower_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_seller_id_leads_id_fk" FOREIGN KEY ("seller_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_buyer_id_leads_id_fk" FOREIGN KEY ("buyer_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provisioned_phone_numbers" ADD CONSTRAINT "provisioned_phone_numbers_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_views" ADD CONSTRAINT "saved_views_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_sequence_id_campaign_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."campaign_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_enrollments" ADD CONSTRAINT "sequence_enrollments_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sequence_steps" ADD CONSTRAINT "sequence_steps_sequence_id_campaign_sequences_id_fk" FOREIGN KEY ("sequence_id") REFERENCES "public"."campaign_sequences"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_traces" ADD CONSTRAINT "skip_traces_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skip_traces" ADD CONSTRAINT "skip_traces_lead_id_leads_id_fk" FOREIGN KEY ("lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_actions" ADD CONSTRAINT "support_actions_message_id_support_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."support_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_messages" ADD CONSTRAINT "support_messages_case_id_support_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."support_cases"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "system_alerts" ADD CONSTRAINT "system_alerts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "target_counties" ADD CONSTRAINT "target_counties_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assigned_to_team_members_id_fk" FOREIGN KEY ("assigned_to") REFERENCES "public"."team_members"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_conversations" ADD CONSTRAINT "team_conversations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_member_presence" ADD CONSTRAINT "team_member_presence_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_members" ADD CONSTRAINT "team_members_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "team_messages" ADD CONSTRAINT "team_messages_conversation_id_team_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."team_conversations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_records" ADD CONSTRAINT "usage_records_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_agent_id_va_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."va_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_related_property_id_properties_id_fk" FOREIGN KEY ("related_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_related_note_id_notes_id_fk" FOREIGN KEY ("related_note_id") REFERENCES "public"."notes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_actions" ADD CONSTRAINT "va_actions_related_campaign_id_campaigns_id_fk" FOREIGN KEY ("related_campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_agents" ADD CONSTRAINT "va_agents_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_briefings" ADD CONSTRAINT "va_briefings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_calendar_events" ADD CONSTRAINT "va_calendar_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_calendar_events" ADD CONSTRAINT "va_calendar_events_agent_id_va_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."va_agents"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_calendar_events" ADD CONSTRAINT "va_calendar_events_related_lead_id_leads_id_fk" FOREIGN KEY ("related_lead_id") REFERENCES "public"."leads"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_calendar_events" ADD CONSTRAINT "va_calendar_events_related_property_id_properties_id_fk" FOREIGN KEY ("related_property_id") REFERENCES "public"."properties"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_calendar_events" ADD CONSTRAINT "va_calendar_events_related_action_id_va_actions_id_fk" FOREIGN KEY ("related_action_id") REFERENCES "public"."va_actions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "va_templates" ADD CONSTRAINT "va_templates_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verified_email_domains" ADD CONSTRAINT "verified_email_domains_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "IDX_session_expire" ON "sessions" USING btree ("expire");