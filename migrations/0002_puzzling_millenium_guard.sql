CREATE TABLE "fix_attempts" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"issue_pattern" text NOT NULL,
	"fix_action" text NOT NULL,
	"attempt_number" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"error_message" text,
	"result" jsonb,
	"source_observation_id" integer,
	"source_ticket_id" integer,
	"escalated_at" timestamp,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "knowledge_base_articles" (
	"id" serial PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"slug" text NOT NULL,
	"content" text NOT NULL,
	"summary" text,
	"category" text NOT NULL,
	"tags" jsonb DEFAULT '[]'::jsonb,
	"keywords" jsonb DEFAULT '[]'::jsonb,
	"related_issues" jsonb DEFAULT '[]'::jsonb,
	"troubleshooting_steps" jsonb,
	"can_auto_fix" boolean DEFAULT false,
	"auto_fix_tool_name" text,
	"auto_fix_parameters" jsonb,
	"view_count" integer DEFAULT 0,
	"helpful_count" integer DEFAULT 0,
	"not_helpful_count" integer DEFAULT 0,
	"is_published" boolean DEFAULT true,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now(),
	CONSTRAINT "knowledge_base_articles_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "sophie_cross_org_learnings" (
	"id" serial PRIMARY KEY NOT NULL,
	"issue_pattern" text NOT NULL,
	"issue_category" text NOT NULL,
	"resolution_approach" text NOT NULL,
	"lesson_learned" text,
	"applicable_categories" jsonb DEFAULT '[]'::jsonb,
	"keywords" jsonb DEFAULT '[]'::jsonb,
	"success_count" integer DEFAULT 0,
	"failure_count" integer DEFAULT 0,
	"success_rate" numeric DEFAULT '0',
	"is_auto_fixable" boolean DEFAULT false,
	"auto_fix_action" text,
	"source_ticket_ids" jsonb DEFAULT '[]'::jsonb,
	"contributing_orgs" integer DEFAULT 0,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sophie_memory" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"memory_type" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"importance" integer DEFAULT 5,
	"expires_at" timestamp,
	"source_ticket_id" integer,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "sophie_observations" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text,
	"type" text NOT NULL,
	"confidence_score" integer NOT NULL,
	"severity" text DEFAULT 'info' NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"metadata" jsonb,
	"status" text DEFAULT 'detected' NOT NULL,
	"detected_at" timestamp DEFAULT now(),
	"acknowledged_at" timestamp,
	"escalated_at" timestamp,
	"resolved_at" timestamp,
	"notification_sent" boolean DEFAULT false,
	"notification_type" text DEFAULT 'none',
	"auto_resolve_attempted" boolean DEFAULT false,
	"auto_resolve_success" boolean DEFAULT false,
	"auto_resolve_details" text,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_resolution_history" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"ticket_id" integer,
	"issue_type" text NOT NULL,
	"issue_pattern" text,
	"variant_name" text,
	"resolution_approach" text NOT NULL,
	"tools_used" jsonb,
	"customer_effort_score" integer,
	"was_successful" boolean NOT NULL,
	"customer_satisfied" boolean,
	"lesson_learned" text,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_ticket_messages" (
	"id" serial PRIMARY KEY NOT NULL,
	"ticket_id" integer NOT NULL,
	"role" text NOT NULL,
	"content" text NOT NULL,
	"agent_name" text,
	"tools_used" jsonb,
	"actions_performed" jsonb,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
CREATE TABLE "support_tickets" (
	"id" serial PRIMARY KEY NOT NULL,
	"organization_id" integer NOT NULL,
	"user_id" text NOT NULL,
	"subject" text NOT NULL,
	"description" text NOT NULL,
	"category" text DEFAULT 'general' NOT NULL,
	"priority" text DEFAULT 'normal' NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"assigned_agent" text,
	"ai_handled" boolean DEFAULT false,
	"ai_confidence_score" numeric,
	"ai_resolution_attempts" integer DEFAULT 0,
	"resolution" text,
	"resolution_type" text,
	"resolved_at" timestamp,
	"resolved_by" text,
	"customer_rating" integer,
	"customer_feedback" text,
	"page_context" text,
	"error_context" jsonb,
	"escalation_bundle" jsonb,
	"source" text DEFAULT 'in_app' NOT NULL,
	"created_at" timestamp DEFAULT now(),
	"updated_at" timestamp DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "proactive_notification_level" varchar(50) DEFAULT 'balanced';--> statement-breakpoint
ALTER TABLE "fix_attempts" ADD CONSTRAINT "fix_attempts_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_attempts" ADD CONSTRAINT "fix_attempts_source_observation_id_sophie_observations_id_fk" FOREIGN KEY ("source_observation_id") REFERENCES "public"."sophie_observations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fix_attempts" ADD CONSTRAINT "fix_attempts_source_ticket_id_support_tickets_id_fk" FOREIGN KEY ("source_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sophie_memory" ADD CONSTRAINT "sophie_memory_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sophie_memory" ADD CONSTRAINT "sophie_memory_source_ticket_id_support_tickets_id_fk" FOREIGN KEY ("source_ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sophie_observations" ADD CONSTRAINT "sophie_observations_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_resolution_history" ADD CONSTRAINT "support_resolution_history_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_resolution_history" ADD CONSTRAINT "support_resolution_history_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_ticket_messages" ADD CONSTRAINT "support_ticket_messages_ticket_id_support_tickets_id_fk" FOREIGN KEY ("ticket_id") REFERENCES "public"."support_tickets"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_tickets" ADD CONSTRAINT "support_tickets_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fix_attempts_org_idx" ON "fix_attempts" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "fix_attempts_pattern_idx" ON "fix_attempts" USING btree ("issue_pattern");--> statement-breakpoint
CREATE INDEX "fix_attempts_status_idx" ON "fix_attempts" USING btree ("status");--> statement-breakpoint
CREATE INDEX "kb_articles_category_idx" ON "knowledge_base_articles" USING btree ("category");--> statement-breakpoint
CREATE INDEX "kb_articles_slug_idx" ON "knowledge_base_articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "cross_org_learnings_category_idx" ON "sophie_cross_org_learnings" USING btree ("issue_category");--> statement-breakpoint
CREATE INDEX "cross_org_learnings_pattern_idx" ON "sophie_cross_org_learnings" USING btree ("issue_pattern");--> statement-breakpoint
CREATE INDEX "sophie_memory_org_user_idx" ON "sophie_memory" USING btree ("organization_id","user_id");--> statement-breakpoint
CREATE INDEX "sophie_memory_type_idx" ON "sophie_memory" USING btree ("memory_type");--> statement-breakpoint
CREATE INDEX "sophie_memory_key_idx" ON "sophie_memory" USING btree ("key");--> statement-breakpoint
CREATE INDEX "sophie_obs_org_idx" ON "sophie_observations" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "sophie_obs_status_idx" ON "sophie_observations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "sophie_obs_type_idx" ON "sophie_observations" USING btree ("type");--> statement-breakpoint
CREATE INDEX "sophie_obs_detected_at_idx" ON "sophie_observations" USING btree ("detected_at");--> statement-breakpoint
CREATE INDEX "resolution_history_issue_type_idx" ON "support_resolution_history" USING btree ("issue_type");--> statement-breakpoint
CREATE INDEX "support_ticket_messages_ticket_idx" ON "support_ticket_messages" USING btree ("ticket_id");--> statement-breakpoint
CREATE INDEX "support_tickets_org_idx" ON "support_tickets" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "support_tickets_status_idx" ON "support_tickets" USING btree ("status");--> statement-breakpoint
CREATE INDEX "support_tickets_user_idx" ON "support_tickets" USING btree ("user_id");