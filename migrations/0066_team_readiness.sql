-- ============================================================================
-- Team-of-3 / team-of-10 readiness — Phase 5 §5.
-- ============================================================================
--
-- Why this exists
-- ───────────────
-- Wave 8 shipped the bones of multi-user (VA role + co-owners +
-- viewOnlyAssignedLeads). This migration finishes the work needed to onboard
-- an actual team without bespoke hand-holding:
--
--   • Per-seat pricing — orgs declare seat_count and Stripe charges $20/$30
--     per extra seat above the tier's bundled 1 seat.
--   • Round-robin lead assignment — incoming leads are auto-distributed to
--     reps via configurable rules (round_robin / territory / random).
--   • Manager dashboard — per-rep performance metrics.
--   • Slack / Teams webhooks — fire on deal-closed and big-lead-arrived.
--   • Per-record ownership + offer-approval — offers above a configurable
--     threshold route to admin/owner before they leave the building.
--
-- The migration is additive only; no destructive changes. Every column is
-- nullable or has a sensible default so existing rows boot unchanged.
-- ============================================================================

-- ─── Part A — Per-seat pricing ───────────────────────────────────────────────
ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS requires_approval_offers_over NUMERIC;

COMMENT ON COLUMN organizations.seat_count IS
  'Number of paid seats on the active subscription. Tier includes 1 seat; each additional seat is billed via the per-seat add-on subscription on Stripe.';
COMMENT ON COLUMN organizations.requires_approval_offers_over IS
  'When non-null, offers with cashOffer or termsOffer above this dollar amount are routed to the offer-approval queue instead of being sent directly. NULL means no approval required.';

-- ─── Part B — Round-robin lead assignment ────────────────────────────────────
CREATE TABLE IF NOT EXISTS lead_assignment_rules (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  rule_type TEXT NOT NULL,           -- round_robin | territory | random
  priority INTEGER NOT NULL DEFAULT 100,
  territory_filter JSONB,            -- { states?: string[], counties?: string[] }
  weighted_assignees JSONB,          -- [{ teamMemberId, weight }]
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lead_assignment_rules_org_idx
  ON lead_assignment_rules(organization_id, is_active, priority);

COMMENT ON TABLE lead_assignment_rules IS
  'Per-org rules that drive auto-assignment when /api/leads is called without an explicit assignedTo. Rules are applied in priority order (low number = high priority); the first match wins. round_robin ignores territory_filter; territory uses lead.state / lead.county; random picks weighted_assignees uniformly.';

-- Round-robin cursor — one row per rule, advances by one each assignment.
CREATE TABLE IF NOT EXISTS org_assignment_cursor (
  rule_id INTEGER PRIMARY KEY REFERENCES lead_assignment_rules(id) ON DELETE CASCADE,
  cursor_index INTEGER NOT NULL DEFAULT 0,
  last_assigned_to INTEGER,
  updated_at TIMESTAMP DEFAULT now()
);

COMMENT ON TABLE org_assignment_cursor IS
  'Per-rule round-robin cursor. cursor_index modulo the assignee list length determines the next assignee. Updated atomically inside the assignLead() transaction.';

-- ─── Part D — Slack / Teams integration ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS org_integrations_slack (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  provider TEXT NOT NULL DEFAULT 'slack',  -- slack | teams
  webhook_url TEXT NOT NULL,
  channel_name TEXT,
  event_types TEXT[] NOT NULL DEFAULT ARRAY['deal_closed','big_lead_arrived']::TEXT[],
  is_active BOOLEAN NOT NULL DEFAULT true,
  last_dispatched_at TIMESTAMP,
  last_error TEXT,
  created_at TIMESTAMP DEFAULT now(),
  updated_at TIMESTAMP DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS org_integrations_slack_org_provider_idx
  ON org_integrations_slack(organization_id, provider);

COMMENT ON TABLE org_integrations_slack IS
  'Slack / Teams webhook destinations. provider="slack" uses Slack Incoming Webhook payload format; provider="teams" uses MS Teams MessageCard format. event_types is a postgres TEXT[] of subscribed event keys (deal_closed, big_lead_arrived, ...).';

-- ─── Part E — Offer approval queue ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS offer_approvals (
  id SERIAL PRIMARY KEY,
  organization_id INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  offer_id INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
  submitted_by TEXT NOT NULL,         -- userId of the rep who submitted
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | approved | declined
  reviewer_id TEXT,
  reviewer_notes TEXT,
  threshold_amount NUMERIC NOT NULL,  -- snapshot of org.requiresApprovalOffersOver at time of submit
  offer_amount NUMERIC NOT NULL,      -- max(cashOffer, termsOffer)
  created_at TIMESTAMP DEFAULT now(),
  decided_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS offer_approvals_org_status_idx
  ON offer_approvals(organization_id, status, created_at);

COMMENT ON TABLE offer_approvals IS
  'Approval queue for offers above org.requires_approval_offers_over. Created automatically when a rep submits a qualifying offer; resolved by an admin/owner clicking approve or decline. Every transition is mirrored to audit_log.';

-- ─── Done ────────────────────────────────────────────────────────────────────
-- Smoke check (run manually):
--   SELECT seat_count, requires_approval_offers_over FROM organizations LIMIT 1;
--   SELECT count(*) FROM lead_assignment_rules;
--   SELECT count(*) FROM org_integrations_slack;
--   SELECT count(*) FROM offer_approvals;
