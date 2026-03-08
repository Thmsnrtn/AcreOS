-- Goals table — business targets per organisation
CREATE TABLE IF NOT EXISTS "goals" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "label" text NOT NULL,
  "goal_type" text NOT NULL,   -- deals_closed | notes_deployed | revenue_earned | leads_contacted
  "target_value" numeric(14, 2) NOT NULL,
  "period_start" timestamp NOT NULL,
  "period_end" timestamp NOT NULL,
  "created_at" timestamp DEFAULT now(),
  "updated_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "goals_org_idx" ON "goals" ("organization_id");
CREATE INDEX IF NOT EXISTS "goals_period_idx" ON "goals" ("period_start", "period_end");

-- Portfolio simulations table — Monte Carlo results
CREATE TABLE IF NOT EXISTS "portfolio_simulations" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "description" text,
  "iterations" integer NOT NULL DEFAULT 10000,
  "time_horizon_months" integer NOT NULL,
  "assumptions" jsonb,
  "results" jsonb,
  "status" text NOT NULL DEFAULT 'pending',
  "completed_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "portfolio_simulations_org_idx" ON "portfolio_simulations" ("organization_id");
CREATE INDEX IF NOT EXISTS "portfolio_simulations_status_idx" ON "portfolio_simulations" ("status");

-- Optimization recommendations table — AI portfolio suggestions
CREATE TABLE IF NOT EXISTS "optimization_recommendations" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "recommendation_type" text NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "reasoning" text NOT NULL,
  "priority" text NOT NULL DEFAULT 'medium',
  "estimated_impact" jsonb,
  "action_items" jsonb,
  "status" text NOT NULL DEFAULT 'new',
  "reviewed_at" timestamp,
  "implemented_at" timestamp,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "optimization_recommendations_org_idx" ON "optimization_recommendations" ("organization_id");
CREATE INDEX IF NOT EXISTS "optimization_recommendations_type_idx" ON "optimization_recommendations" ("recommendation_type");
CREATE INDEX IF NOT EXISTS "optimization_recommendations_status_idx" ON "optimization_recommendations" ("status");

-- Push notification subscriptions — web push endpoint registry
CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "user_id" text NOT NULL,
  "endpoint" text NOT NULL UNIQUE,
  "p256dh" text NOT NULL,
  "auth" text NOT NULL,
  "created_at" timestamp DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "push_subscriptions_org_idx" ON "push_subscriptions" ("organization_id");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_idx" ON "push_subscriptions" ("user_id");
