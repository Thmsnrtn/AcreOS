-- TCPA / CAN-SPAM — Evidence-grade consent capture table.
--
-- "Prior express written consent" under 47 CFR § 64.1200(f)(9) requires
-- (i) signature, (ii) clear & conspicuous disclosure naming the seller,
-- (iii) NOT a condition of purchase. Producing those elements at trial
-- means we need: the disclosure text shown, the checkbox state, an
-- IP/UA fingerprint, and an immutable timestamp.
--
-- Same table also captures revocations (STOP keywords, opt-out clicks)
-- with the verbatim inbound text + carrier MessageSid so the chain of
-- custody from "consumer typed STOP" to "doNotContact=true" is testable
-- in deposition.

CREATE TABLE IF NOT EXISTS lead_consent_events (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  event_type TEXT NOT NULL,         -- 'granted' | 'revoked' | 'updated' | 'imported'
  channels JSONB NOT NULL,          -- ['sms','email','phone','direct_mail']

  source TEXT NOT NULL,             -- 'website' | 'phone_ivr' | 'written' | 'sms_double_optin' | 'imported' | 'inbound_stop'

  consent_text TEXT,
  checkbox_checked BOOLEAN,

  ip_address TEXT,
  user_agent TEXT,
  page_url TEXT,

  inbound_message_text TEXT,
  inbound_message_sid TEXT,
  inbound_from_phone TEXT,

  import_batch_id TEXT,
  recorded_by TEXT,
  metadata JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS lead_consent_events_lead_idx
  ON lead_consent_events (lead_id);
CREATE INDEX IF NOT EXISTS lead_consent_events_org_idx
  ON lead_consent_events (organization_id);
CREATE INDEX IF NOT EXISTS lead_consent_events_type_idx
  ON lead_consent_events (event_type);
CREATE INDEX IF NOT EXISTS lead_consent_events_created_at_idx
  ON lead_consent_events (created_at);

COMMENT ON TABLE lead_consent_events IS
  'TCPA / CAN-SPAM evidence chain. Rows are append-only — never UPDATE or DELETE for any reason short of a court order. Every grant/revocation of consent on any channel writes one row here, capturing the exact disclosure shown + checkbox state + IP/UA at grant time, or the verbatim inbound message + Twilio SID at revocation time.';
