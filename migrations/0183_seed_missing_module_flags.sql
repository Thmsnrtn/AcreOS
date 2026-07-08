-- 0183 — Seed the four module flags that featureGate() checks but 0008 never
-- inserted (feature_white_label, feature_voice_ai, feature_territories,
-- feature_deal_rooms). A missing row fails closed in requireFlag (good) but is
-- invisible in the founder flags panel, so it can't be audited or toggled.
-- Seeding them as explicit 'off' makes the module freeze visible and
-- operable. Additive + idempotent.
INSERT INTO platform_feature_flags (key, label, description, enabled, state, controlled_routes) VALUES
  ('feature_white_label',  'White Label',   'Reseller branding and custom domains',            FALSE, 'off', '["/white-label"]'),
  ('feature_voice_ai',     'Voice AI',      'AI voice calls, recordings, and transcription',   FALSE, 'off', '["/voice"]'),
  ('feature_territories',  'Territories',   'Sales territory management and assignment',       FALSE, 'off', '["/territories"]'),
  ('feature_deal_rooms',   'Deal Rooms',    'Shared diligence rooms for marketplace deals',    FALSE, 'off', '["/deal-rooms"]')
ON CONFLICT (key) DO NOTHING;
