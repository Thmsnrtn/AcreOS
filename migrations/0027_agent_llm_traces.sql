-- 0027_agent_llm_traces.sql
-- Raw LLM input/output capture for agent action-replay. Every agent
-- decision that's grounded in an LLM call gets a trace row so the
-- founder can audit "what exactly did Sophie see and say when she
-- recommended X?" — the answer to every "why did the system do that?"
-- question now lives in one table.
--
-- Keep separate from the existing agent_action_log / founder_briefs
-- payloads because raw prompts can be long and we want TOAST-heavy
-- content out of the hot query path.

CREATE TABLE IF NOT EXISTS "agent_llm_traces" (
    "id" serial PRIMARY KEY,
    "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
    "agent_codename" text NOT NULL,
    -- What call-site produced this trace. Free text so new services
    -- don't need a schema migration — e.g. "customer_monthly_letter",
    -- "support_chat", "negotiation_script", "prompt_evolution".
    "purpose" text NOT NULL,
    -- Optional link to a decision row (founder_briefs/brief_type='decision'
    -- has a corresponding id, or the decisionsInbox item id). Null if
    -- this trace isn't tied to a single recorded decision.
    "decision_id" integer,
    "model" text NOT NULL,
    "system_prompt" text,
    "user_prompt" text NOT NULL,
    "response" text NOT NULL,
    "latency_ms" integer,
    "input_tokens" integer,
    "output_tokens" integer,
    "cost_cents" integer,
    "error" text,
    "metadata" jsonb DEFAULT '{}'::jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL
);

-- "Show me the last N traces for this agent" — the main founder query.
CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_agent_recent"
    ON "agent_llm_traces" ("agent_codename", "created_at" DESC);

-- Drill from a decision into its trace.
CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_decision"
    ON "agent_llm_traces" ("decision_id");

-- Org-scoped browsing.
CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_org_recent"
    ON "agent_llm_traces" ("organization_id", "created_at" DESC);
