-- NPS Response Collection
CREATE TABLE IF NOT EXISTS nps_responses (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id),
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
  feedback TEXT,
  trigger TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_nps_org ON nps_responses(organization_id);
CREATE INDEX idx_nps_trigger ON nps_responses(organization_id, trigger);
