-- ============================================================================
-- Hartwell title-partner API — Phase 7 Months 7.
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- AcreOS routes title work to partner title companies via a public-facing
-- partner-tier API. Partners receive title-order requests, send back
-- status webhooks, and exchange ALTA-Pillar-2-compliant wire instructions.
--
-- Audit projection: $895/file × 28-32 closings/mo at scale.
--
-- Two new tables:
--
--   • title_partners — registry of partner title companies. Each row holds
--     contact info, territory (states + counties), an API key hash for
--     inbound auth, an HMAC secret (encrypted at rest) for webhook signing,
--     and a volume pricing tier (pilot|standard|volume|enterprise).
--
--   • title_orders — one row per dispatched title order. Holds dealId,
--     property + parties snapshot, status (pending|assigned|in_progress|
--     committed|policy_issued|closed|cancelled), routing partner, and a
--     freeform status_details JSONB plus optional S3 keys for the
--     commitment / Schedule B / policy PDFs.
--
-- ALTA Pillar 2 (Wire Fraud Prevention) — wire-instruction exchange is
-- handled in service code (server/services/wireInstructions.ts) which
-- writes encrypted-PDF S3 keys + HMAC signatures back onto title_orders.
-- See docs/api/title-partners-v1.md for the JSON schema of the
-- commitment / Schedule B / policy documents.
-- ============================================================================

-- ─── Part A — Partner registry ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_partners (
  id SERIAL PRIMARY KEY,
  -- NULL = platform-default partner (any org can route to it).
  organization_id INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
  partner_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  contact_phone TEXT NOT NULL,
  -- Territories — partner accepts orders for these states / counties.
  -- Empty array on either column means "any" for that axis.
  territory_states TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  territory_counties TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  -- bcrypt-style hash of the API key the partner uses on inbound calls.
  api_key_hash TEXT NOT NULL,
  -- Encrypted shared HMAC secret used to verify partner-signed webhooks
  -- and to sign wire-instruction PDFs that AcreOS issues to customers.
  -- Stored via server/services/fieldEncryption.encrypt().
  hmac_secret_encrypted TEXT NOT NULL,
  -- AcreOS POSTs new title-order requests to this URL; partner must verify
  -- the X-Acreos-Signature HMAC header before acting.
  webhook_url TEXT NOT NULL,
  -- pilot | standard | volume | enterprise — drives per-file pricing in
  -- the billing report.
  volume_pricing_tier TEXT NOT NULL DEFAULT 'pilot',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS title_partners_active_idx
  ON title_partners(is_active, volume_pricing_tier);

CREATE INDEX IF NOT EXISTS title_partners_org_idx
  ON title_partners(organization_id) WHERE organization_id IS NOT NULL;

COMMENT ON TABLE title_partners IS
  'Partner title companies that receive routed title orders from AcreOS. organization_id NULL means a platform-default partner available to all orgs (e.g. AcreOS''s national flagship partner). Territory matching is honoured by routeTitleOrder() — empty arrays = wildcard for that axis.';

COMMENT ON COLUMN title_partners.api_key_hash IS
  'bcrypt or sha256 hash of the partner''s inbound API key. Partner sends "Authorization: Bearer <key>"; the verify path hashes the presented key and compares.';

COMMENT ON COLUMN title_partners.hmac_secret_encrypted IS
  'Per-partner shared HMAC secret, encrypted via server/services/fieldEncryption. Used (a) to verify HMAC sigs on inbound status webhooks, (b) to sign wire-instruction PDFs delivered to customers (ALTA Pillar 2).';

COMMENT ON COLUMN title_partners.volume_pricing_tier IS
  'pilot | standard | volume | enterprise. Maps to the per-file price in the billing report. pilot=$895 (default), standard=$795, volume=$695, enterprise=negotiated.';

-- ─── Part B — Title orders ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS title_orders (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  deal_id INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  -- The partner this order was routed to. NULL means "broadcast" (no
  -- specific partner picked yet). Once a partner picks it up, this becomes
  -- non-null and the partner_assigned_at timestamp is set.
  title_partner_id INTEGER REFERENCES title_partners(id) ON DELETE SET NULL,
  -- pending | assigned | in_progress | commitment_issued | schedule_b_issued |
  --   policy_issued | wire_instructions_issued | closed | cancelled
  status TEXT NOT NULL DEFAULT 'pending',
  status_details JSONB NOT NULL DEFAULT '{}'::JSONB,
  -- Snapshot of the parties + property at request time, so a later edit on
  -- the deal record doesn't desync what the partner received.
  property_address JSONB NOT NULL,
  buyer_info JSONB NOT NULL,
  seller_info JSONB NOT NULL,
  sale_price NUMERIC NOT NULL,
  expected_closing_date DATE NOT NULL,
  estimated_delivery_date DATE,
  -- S3 keys for documents the partner uploads to the shared exchange bucket.
  -- See docs/api/title-partners-v1.md for the JSON schema each document must
  -- conform to. AcreOS reads these via signed URLs; the bucket is partner-
  -- write-only / AcreOS-read-only.
  commitment_s3_key TEXT,
  schedule_b_s3_key TEXT,
  policy_s3_key TEXT,
  -- ALTA Pillar 2 wire-instruction surface. The encrypted PDF is stored on
  -- S3; the password is delivered to the customer out-of-band (email + SMS),
  -- and the customer must call the partner's verified phone to confirm the
  -- wire details before sending funds. hmac_signature is the HMAC-SHA256 of
  -- the encrypted PDF bytes signed with the partner's hmac_secret.
  wire_instructions_pdf_s3_key TEXT,
  wire_instructions_password_hint TEXT,
  wire_instructions_hmac TEXT,
  wire_instructions_issued_at TIMESTAMP,
  wire_confirmation_phone TEXT,
  wire_confirmed_at TIMESTAMP,
  partner_assigned_at TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT now(),
  updated_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS title_orders_org_status_idx
  ON title_orders(organization_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS title_orders_partner_idx
  ON title_orders(title_partner_id, status) WHERE title_partner_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS title_orders_deal_idx
  ON title_orders(deal_id);

COMMENT ON TABLE title_orders IS
  'Title orders dispatched to partner title companies. Created via POST /api/title-orders (partner-tier API), updated via inbound webhook POST /api/webhooks/title-orders/:orderId/status (HMAC-verified). Wire-instruction columns realise the ALTA Pillar 2 (Wire Fraud Prevention) surface — see server/services/wireInstructions.ts.';

COMMENT ON COLUMN title_orders.status IS
  'pending → assigned → in_progress → commitment_issued → schedule_b_issued → policy_issued → wire_instructions_issued → closed. cancelled is a terminal short-circuit.';

COMMENT ON COLUMN title_orders.wire_instructions_password_hint IS
  'Hint shown in the customer UI ("we sent the password by SMS to the number ending in NNNN"). The actual password is NEVER stored in this column — only delivered out-of-band.';
