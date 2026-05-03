-- Phase 3 Week 11: DSAR pipeline + audit-log lockdown + sub-processor DPA tracking.
--
-- Three concerns, one migration (they ship together as the compliance posture
-- baseline): GDPR/CCPA Data Subject Access Request intake + operator workflow,
-- append-only enforcement on audit_events, and a Data Processing Agreement
-- registry for the eight known sub-processors (Stripe, Twilio, SendGrid,
-- Clerk, Anthropic, OpenAI, Lob, AWS).

-- ─── 1. dsar_requests ───────────────────────────────────────────────────────
-- Public DSAR intake; rows are operator-driven once received.
-- Status lifecycle: pending → verified → fulfilling → completed | denied
CREATE TABLE IF NOT EXISTS dsar_requests (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  request_type    TEXT NOT NULL CHECK (request_type IN ('access','erasure','portability','rectification')),
  email           TEXT NOT NULL,
  full_name       TEXT NOT NULL,
  organization_id INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
  organization    TEXT,                                     -- free-text org name as supplied by requester
  justification   TEXT,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','verified','fulfilling','completed','denied')),
  verification_token   TEXT,                                -- single-use email-loop token
  verified_at     TIMESTAMPTZ,
  completed_at    TIMESTAMPTZ,
  denied_reason   TEXT,
  ip              TEXT,
  user_agent      TEXT,
  metadata        JSONB DEFAULT '{}'::jsonb,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dsar_requests_email ON dsar_requests(email);
CREATE INDEX IF NOT EXISTS idx_dsar_requests_status ON dsar_requests(status);
CREATE INDEX IF NOT EXISTS idx_dsar_requests_created_at ON dsar_requests(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_dsar_requests_org ON dsar_requests(organization_id);

-- ─── 2. data_processing_agreements ─────────────────────────────────────────
-- Registry of every sub-processor that ever touches customer data. Founder
-- maintains the negotiation/signed/expired status; vendor outreach is a
-- manual workstream tracked in /founder/sub-processors.
CREATE TABLE IF NOT EXISTS data_processing_agreements (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name     TEXT NOT NULL UNIQUE,
  status          TEXT NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','negotiating','signed','expired')),
  signed_date     DATE,
  expires_at      DATE,
  contact_email   TEXT,
  scope           TEXT,                                     -- what data they touch (e.g. "billing PII", "voice recordings")
  evidence_url    TEXT,                                     -- S3 key / drive link to the executed DPA
  notes           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dpa_status ON data_processing_agreements(status);

-- Seed the eight known sub-processors. ON CONFLICT DO NOTHING so a re-run
-- of the migration never resets manually-edited rows.
INSERT INTO data_processing_agreements (vendor_name, status, scope, contact_email)
VALUES
  ('Stripe',    'pending', 'Billing PII, payment methods, invoices, tax identity', 'privacy@stripe.com'),
  ('Twilio',    'pending', 'Phone numbers, SMS bodies, voice-call recordings & transcripts', 'privacy@twilio.com'),
  ('SendGrid',  'pending', 'Email addresses, message bodies, delivery events', 'privacy@sendgrid.com'),
  ('Clerk',     'pending', 'Auth identities, sessions, MFA factors, email/phone', 'privacy@clerk.com'),
  ('Anthropic', 'pending', 'Prompt content (incl. lead/property text), Claude completions', 'privacy@anthropic.com'),
  ('OpenAI',    'pending', 'Prompt content for embeddings + completions', 'privacy@openai.com'),
  ('Lob',       'pending', 'Recipient mailing addresses, postcard imagery', 'privacy@lob.com'),
  ('AWS',       'pending', 'All at-rest customer data (S3, RDS, KMS-encrypted)', 'aws-privacy@amazon.com')
ON CONFLICT (vendor_name) DO NOTHING;

-- ─── 3. audit_events lockdown ──────────────────────────────────────────────
-- audit_events shipped in 0039 as an append-only event log. Postgres can't
-- enforce "append-only" from table grants alone (the table owner can always
-- DELETE), so we install a trigger that raises on UPDATE/DELETE for every
-- session except a privileged migration role (which doesn't exist in
-- production runtime — only DBAs would assume it).
CREATE OR REPLACE FUNCTION audit_events_deny_mutation()
RETURNS TRIGGER AS $$
BEGIN
  -- Allow the trigger to be silenced during DBA-driven retention pruning
  -- by setting a session GUC. If unset (default), every UPDATE/DELETE
  -- raises. Production Fly.io runtime never sets this.
  IF current_setting('acreos.allow_audit_mutation', true) = 'on' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;
  RAISE EXCEPTION 'audit_events is append-only (UPDATE/DELETE denied)';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS audit_events_no_update ON audit_events;
CREATE TRIGGER audit_events_no_update
  BEFORE UPDATE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_deny_mutation();

DROP TRIGGER IF EXISTS audit_events_no_delete ON audit_events;
CREATE TRIGGER audit_events_no_delete
  BEFORE DELETE ON audit_events
  FOR EACH ROW
  EXECUTE FUNCTION audit_events_deny_mutation();

-- An immutable view over audit_events. Founder dashboards SELECT from this
-- view rather than the underlying table; if the table ever grows mutation
-- code paths, the view continues to expose only the read surface.
CREATE OR REPLACE VIEW audit_events_immutable_view AS
SELECT
  id,
  actor_user_id,
  actor_email,
  action,
  target_type,
  target_id,
  justification,
  metadata,
  ip,
  user_agent,
  created_at
FROM audit_events;
