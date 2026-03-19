-- Pax deep feature tables: Knowledge Base, Projects, Scheduled Tasks
-- Plus column additions to aiMessages and aiConversations

-- Knowledge Base: org-level files always injected into Pax context
CREATE TABLE IF NOT EXISTS "pax_knowledge_files" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "extracted_content" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "usage_count" integer NOT NULL DEFAULT 0,
  "last_used_at" timestamp,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pax_kb_org_idx" ON "pax_knowledge_files" ("organization_id");
CREATE INDEX IF NOT EXISTS "pax_kb_active_idx" ON "pax_knowledge_files" ("is_active");

-- Projects: scoped workspaces per entity or standalone
CREATE TABLE IF NOT EXISTS "pax_projects" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "description" text,
  "entity_type" text,
  "entity_id" integer,
  "is_active" boolean NOT NULL DEFAULT true,
  "file_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pax_proj_org_idx" ON "pax_projects" ("organization_id");
CREATE INDEX IF NOT EXISTS "pax_proj_entity_idx" ON "pax_projects" ("entity_type", "entity_id");

-- Project files: individual uploaded files within a project
CREATE TABLE IF NOT EXISTS "pax_project_files" (
  "id" serial PRIMARY KEY NOT NULL,
  "project_id" integer NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "extracted_content" text NOT NULL,
  "uploaded_by" text NOT NULL,
  "uploaded_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pax_pf_proj_idx" ON "pax_project_files" ("project_id");

-- Scheduled tasks: background prompts on a cron schedule
CREATE TABLE IF NOT EXISTS "pax_scheduled_tasks" (
  "id" serial PRIMARY KEY NOT NULL,
  "organization_id" integer NOT NULL,
  "user_id" text NOT NULL,
  "name" text NOT NULL,
  "prompt" text NOT NULL,
  "agent_role" text NOT NULL DEFAULT 'executive',
  "schedule" text NOT NULL,
  "timezone" text NOT NULL DEFAULT 'America/New_York',
  "is_active" boolean NOT NULL DEFAULT true,
  "last_run_at" timestamp,
  "next_run_at" timestamp,
  "last_run_conversation_id" integer,
  "last_run_status" text,
  "last_run_summary" text,
  "run_count" integer NOT NULL DEFAULT 0,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "pax_tasks_org_idx" ON "pax_scheduled_tasks" ("organization_id");
CREATE INDEX IF NOT EXISTS "pax_tasks_next_run_idx" ON "pax_scheduled_tasks" ("next_run_at");

-- Add columns to ai_messages
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "mentioned_entities" jsonb;
ALTER TABLE "ai_messages" ADD COLUMN IF NOT EXISTS "thinking_content" text;

-- Add active_project_id to ai_conversations
ALTER TABLE "ai_conversations" ADD COLUMN IF NOT EXISTS "active_project_id" integer;
