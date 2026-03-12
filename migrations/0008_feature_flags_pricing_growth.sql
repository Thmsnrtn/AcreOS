-- Migration: Feature Flags, Pricing Config, Growth / Ad Marketing
-- Adds platform-level feature flags, dynamic pricing config, and growth campaign infrastructure

-- ─── UTM attribution columns on organizations ────────────────────────────────
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS utm_source TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS utm_medium TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS utm_campaign TEXT;
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS utm_content TEXT;

-- ─── Platform Feature Flags ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform_feature_flags (
  id SERIAL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  description TEXT NOT NULL,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  controlled_routes JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed default feature flags (ambitious features start DISABLED)
INSERT INTO platform_feature_flags (key, label, description, enabled, controlled_routes) VALUES
  ('feature_academy',            'Academy',               'Land investment education & course library',         FALSE, '["/academy"]'),
  ('feature_marketplace',        'Marketplace',           'Buy and sell deals with other investors',            FALSE, '["/marketplace"]'),
  ('feature_vision_ai',          'Vision AI',             'AI photo and satellite image analysis',              FALSE, '["/vision-ai"]'),
  ('feature_capital_markets',    'Capital Markets',       'Note securitization and institutional lenders',      FALSE, '["/capital-markets"]'),
  ('feature_deal_hunter',        'Deal Hunter',           'Automated AI deal sourcing engine',                  FALSE, '["/deal-hunter"]'),
  ('feature_acquisition_radar',  'Acquisition Radar',     'AI-scored deal opportunities radar',                 FALSE, '["/radar"]'),
  ('feature_land_credit',        'Land Credit Score',     'Proprietary 300–850 land scoring system',            FALSE, '["/land-credit"]'),
  ('feature_negotiation_copilot','Negotiation Copilot',   'AI negotiation assistant and copilot',               FALSE, '["/negotiation"]'),
  ('feature_tax_researcher',     'Tax Researcher',        'Tax lien auctions and delinquent properties',        FALSE, '["/tax-researcher"]'),
  ('feature_compliance',         'Compliance',            'Regulatory monitoring and compliance tools',          FALSE, '["/compliance"]'),
  ('feature_document_intel',     'Document Intelligence', 'AI contract parsing and document analysis',          FALSE, '["/document-intelligence"]'),
  ('feature_market_intelligence','Market Intelligence',   'Market analysis and land price trend data',          FALSE, '["/market-intelligence"]'),
  ('feature_portfolio_optimizer','Portfolio Optimizer',   'Monte Carlo simulation and portfolio optimization',  FALSE, '["/portfolio-optimizer"]'),
  ('feature_avm',                'AVM™ Valuation',        'AcreOS Valuation Model – automated property AVM',   FALSE, '["/avm"]')
ON CONFLICT (key) DO NOTHING;

-- ─── Pricing Config ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS pricing_config (
  id SERIAL PRIMARY KEY,
  tier TEXT NOT NULL UNIQUE,
  display_price_monthly INTEGER NOT NULL,
  display_price_yearly INTEGER NOT NULL,
  promo_label TEXT,
  promo_discount_percent INTEGER,
  promo_ends_at TIMESTAMP,
  stripe_coupon_id TEXT,
  allow_promo_codes BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Seed with current pricing (monthly price in cents, yearly = monthly * 12 shown as per-month)
INSERT INTO pricing_config (tier, display_price_monthly, display_price_yearly) VALUES
  ('starter',    4900,  3900),
  ('pro',        9900,  7900),
  ('growth',    19900, 15900),
  ('enterprise',49900, 39900)
ON CONFLICT (tier) DO NOTHING;

-- ─── Founder Ad Accounts ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS founder_ad_accounts (
  id SERIAL PRIMARY KEY,
  platform TEXT NOT NULL DEFAULT 'meta',
  ad_account_id TEXT NOT NULL,
  access_token TEXT NOT NULL,
  pixel_id TEXT,
  app_id TEXT,
  app_secret TEXT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- ─── Growth Campaigns ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS growth_campaigns (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  platform TEXT NOT NULL DEFAULT 'meta',
  template_key TEXT NOT NULL,
  external_campaign_id TEXT,
  status TEXT NOT NULL DEFAULT 'draft',
  daily_budget_cents INTEGER NOT NULL DEFAULT 2000,
  target_countries JSONB NOT NULL DEFAULT '["US"]',
  total_spend_cents INTEGER NOT NULL DEFAULT 0,
  impressions INTEGER NOT NULL DEFAULT 0,
  clicks INTEGER NOT NULL DEFAULT 0,
  signups INTEGER NOT NULL DEFAULT 0,
  conversions INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
