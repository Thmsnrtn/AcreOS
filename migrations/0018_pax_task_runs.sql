-- Migration: 0018_pax_task_runs
-- Adds scheduled task run history log

CREATE TABLE IF NOT EXISTS pax_scheduled_task_runs (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  organization_id INTEGER NOT NULL,
  run_at TIMESTAMP DEFAULT NOW() NOT NULL,
  status TEXT NOT NULL,
  summary TEXT,
  conversation_id INTEGER,
  duration_ms INTEGER
);

CREATE INDEX IF NOT EXISTS pax_task_runs_task_idx ON pax_scheduled_task_runs (task_id);
CREATE INDEX IF NOT EXISTS pax_task_runs_org_idx ON pax_scheduled_task_runs (organization_id);
