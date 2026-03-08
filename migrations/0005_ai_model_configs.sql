-- AI Model Configurations table
CREATE TABLE IF NOT EXISTS "ai_model_configs" (
  "id" serial PRIMARY KEY,
  "provider" text NOT NULL DEFAULT 'openrouter',
  "model_id" text NOT NULL,
  "display_name" text NOT NULL,
  "cost_per_million_input" numeric(10, 4),
  "cost_per_million_output" numeric(10, 4),
  "max_tokens" integer DEFAULT 4096,
  "task_types" text[],
  "weight" integer DEFAULT 50,
  "enabled" boolean DEFAULT true,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "ai_model_configs_enabled_idx" ON "ai_model_configs" ("enabled");

-- System API Keys table
CREATE TABLE IF NOT EXISTS "system_api_keys" (
  "id" serial PRIMARY KEY,
  "provider" text NOT NULL UNIQUE,
  "display_name" text NOT NULL,
  "api_key" text,
  "is_active" boolean DEFAULT true,
  "last_validated_at" timestamp,
  "validation_status" text DEFAULT 'pending',
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

-- Seed default AI models (all routed through OpenRouter)
INSERT INTO "ai_model_configs" ("provider", "model_id", "display_name", "cost_per_million_input", "cost_per_million_output", "max_tokens", "task_types", "weight", "enabled") VALUES
  ('openrouter', 'anthropic/claude-sonnet-4-5', 'Claude Sonnet 4.5', 3.00, 15.00, 8192, ARRAY['deal_analysis', 'legal_document', 'negotiation_strategy', 'due_diligence', 'contract_review', 'risk_assessment', 'reasoning', 'strategy'], 80, true),
  ('openrouter', 'deepseek/deepseek-chat', 'DeepSeek Chat', 0.14, 0.28, 4096, ARRAY['summarize', 'extract_data', 'draft_email', 'format_text', 'simple_qa', 'categorize', 'lookup', 'list'], 90, true),
  ('openrouter', 'deepseek/deepseek-reasoner', 'DeepSeek Reasoner', 0.55, 2.19, 8192, ARRAY['financial_modeling', 'optimization', 'forecasting', 'planning', 'multi_step'], 70, true),
  ('openrouter', 'openai/gpt-4o', 'GPT-4o', 2.50, 10.00, 4096, ARRAY['deal_analysis', 'vision', 'document_parsing'], 60, true),
  ('openrouter', 'openai/gpt-4o-mini', 'GPT-4o Mini', 0.15, 0.60, 4096, ARRAY['simple_qa', 'categorize', 'draft_email'], 50, true),
  ('openrouter', 'google/gemini-2.0-flash', 'Gemini 2.0 Flash', 0.10, 0.40, 8192, ARRAY['summarize', 'format_text', 'basic_analysis'], 40, true)
ON CONFLICT DO NOTHING;

-- Seed default system API key providers
INSERT INTO "system_api_keys" ("provider", "display_name", "is_active", "validation_status") VALUES
  ('openrouter', 'OpenRouter', true, 'pending'),
  ('regrid', 'Regrid (Parcel Data)', true, 'pending'),
  ('mapbox', 'Mapbox', true, 'pending'),
  ('sendgrid', 'SendGrid (Email)', true, 'pending'),
  ('lob', 'Lob (Direct Mail)', true, 'pending'),
  ('stripe', 'Stripe', true, 'pending')
ON CONFLICT DO NOTHING;
