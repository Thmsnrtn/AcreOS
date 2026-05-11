#!/usr/bin/env node
// Release-command schema patch. Applies idempotent ALTER TABLE IF NOT EXISTS
// statements to catch schema drift (columns added to shared/schema.ts that
// never got a proper Drizzle migration file). All statements are safe to
// re-run — they no-op when columns already exist. We deliberately avoid
// drizzle-orm's migrator here because the local _journal.json is out of
// sync with what's actually been applied to prod (many migration files
// live outside the journal), and running a migrator against drifted state
// risks re-applying already-applied migrations.

import pg from "pg";

if (!process.env.DATABASE_URL) {
  console.error("[migrate] DATABASE_URL not set — aborting");
  process.exit(1);
}

const STATEMENTS = [
  // notes: columns that never got a proper Drizzle migration applied in prod.
  // All idempotent — re-running is a no-op.
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "owning_entity" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_at" timestamp',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "deleted_by" text',
  'ALTER TABLE "notes" ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 1',

  // agent_llm_traces — added 2026-04 for action-replay. See
  // migrations/0027_agent_llm_traces.sql. Create table + indexes
  // idempotently so every agent LLM call can be audited.
  `CREATE TABLE IF NOT EXISTS "agent_llm_traces" (
     "id" serial PRIMARY KEY,
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
     "agent_codename" text NOT NULL,
     "purpose" text NOT NULL,
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
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_agent_recent" ON "agent_llm_traces" ("agent_codename", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_decision" ON "agent_llm_traces" ("decision_id")',
  'CREATE INDEX IF NOT EXISTS "idx_agent_llm_traces_org_recent" ON "agent_llm_traces" ("organization_id", "created_at" DESC)',

  // Production port phase B.5: users.appearance_preferences (migration 0028).
  // Drives 5-theme × light/dark + 5-font-pairing + density + motion system.
  // Nullable so existing users transparently get client-side defaults.
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "appearance_preferences" jsonb',

  // 2026-05-07 — incident patch. The users-hydration query was 500-ing
  // every ~3s in prod for any authenticated request because Drizzle's
  // .select() includes all 17 declared columns, but prod only had 14.
  // The §3 schema-drift sweep missed the users table; surfaced when
  // running F.1/F.2 path. Reconciles `users` with shared/models/auth.ts.
  //
  //   autonomy_preferences  (jsonb, nullable) — migration 0030 (Per-agent
  //     autonomy matrix, split from appearance_preferences).
  //   persona               (text NOT NULL DEFAULT 'land_investor') —
  //     JC#7 / VERTICAL-EXPANSION-PLAN. Drives onboarding routing,
  //     vocabulary substitution, persona-gated surfaces. Existing rows
  //     back-fill to the default; PG11+ does not rewrite the table for
  //     ADD COLUMN with non-volatile DEFAULT.
  //   notification_prefs    (jsonb, nullable) — JC#11 (Per-user
  //     notification matrix). Null = service applies category defaults.
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "autonomy_preferences" jsonb',
  `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "persona" text NOT NULL DEFAULT 'land_investor'`,
  'ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "notification_prefs" jsonb',

  // 2026-05-08 — Note Investor servicing-ledger discipline (PR-2 of the
  // vertical completion sweep). Adds the columns the partial / unapplied /
  // extra-principal / payoff / NSF-reversal flow needs to record correctly
  // per Linnea's persona walkthrough ("partial payments don't reduce
  // principal — they sit in unapplied funds until the next payment makes
  // them whole").
  `ALTER TABLE "note_payments" ADD COLUMN IF NOT EXISTS "payment_type" text NOT NULL DEFAULT 'regular'`,
  'ALTER TABLE "note_payments" ADD COLUMN IF NOT EXISTS "unapplied_cents" bigint NOT NULL DEFAULT 0',
  'ALTER TABLE "note_payments" ADD COLUMN IF NOT EXISTS "original_payment_id" varchar',
  'CREATE INDEX IF NOT EXISTS "note_payments_note_created_idx" ON "note_payments" ("note_id", "created_at")',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "unapplied_balance_cents" bigint NOT NULL DEFAULT 0',

  // 2026-05-08 — Note Investor acquisition pipeline (PR-6 of the vertical
  // completion sweep). Pre-book diligence stages: sourcing → BPO →
  // diligence → offer → escrow → funded → on_book.
  `CREATE TABLE IF NOT EXISTS "note_acquisitions" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "payer_name" text NOT NULL,
     "property_address" jsonb,
     "sourced_from" text,
     "proposed_face_value_cents" bigint,
     "proposed_acquisition_price_cents" bigint,
     "bpo_value_cents" bigint,
     "bpo_ordered_at" timestamptz,
     "bpo_received_at" timestamptz,
     "interest_rate_bps" integer,
     "term_months" integer,
     "diligence_checklist" jsonb,
     "stage" text NOT NULL DEFAULT 'sourcing',
     "internal_notes" text,
     "promoted_to_note_id" varchar,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "note_acquisitions_org_stage_idx" ON "note_acquisitions" ("organization_id", "stage")',
  'CREATE INDEX IF NOT EXISTS "note_acquisitions_org_updated_idx" ON "note_acquisitions" ("organization_id", "updated_at")',

  // Note Investor — assignment paperwork (Allonge + Assignment of Mortgage)
  // for note sales / transfers (PR-7).
  // Note: acquired_notes.id is `uuid` in prod (Drizzle's varchar+gen_random_uuid()
  // default created the column as uuid). FK columns must match — same for
  // note_payments.note_id which is uuid.
  `CREATE TABLE IF NOT EXISTS "note_assignments" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "note_id" uuid NOT NULL REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
     "assignee_name" text NOT NULL,
     "assignee_address" jsonb,
     "state" text,
     "template_variant" text NOT NULL DEFAULT 'generic',
     "sale_price_cents" bigint,
     "sale_date" date,
     "pdf_s3_key" text,
     "status" text NOT NULL DEFAULT 'generated',
     "signed_at" timestamptz,
     "recorded_at" timestamptz,
     "recording_number" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "note_assignments_org_note_idx" ON "note_assignments" ("organization_id", "note_id")',
  'CREATE INDEX IF NOT EXISTS "note_assignments_org_status_idx" ON "note_assignments" ("organization_id", "status")',

  // Note Investor — pool / fractional ownership splits (PR-9). One row per
  // investor per note; percentageBps for a note must sum to <= 10000.
  // note_id is uuid (matches acquired_notes.id prod-inferred type).
  `CREATE TABLE IF NOT EXISTS "note_ownership_splits" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "note_id" uuid NOT NULL REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
     "investor_lead_id" integer REFERENCES "leads"("id") ON DELETE SET NULL,
     "investor_name" text NOT NULL,
     "investor_email" text,
     "role" text NOT NULL DEFAULT 'lp',
     "percentage_bps" integer NOT NULL,
     "effective_from" date,
     "effective_to" date,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "note_splits_org_note_idx" ON "note_ownership_splits" ("organization_id", "note_id")',
  'CREATE INDEX IF NOT EXISTS "note_splits_org_investor_idx" ON "note_ownership_splits" ("organization_id", "investor_lead_id")',

  // Note Investor — compliance tracking on acquired_notes (PR-11). Hazard
  // insurance status + property-tax escrow with disbursement-due workflow.
  `ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "insurance_status" text NOT NULL DEFAULT 'verified'`,
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "insurance_carrier" text',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "insurance_policy_number" text',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "insurance_expires_at" date',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "insurance_annual_premium_cents" bigint',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "tax_escrow_enabled" boolean NOT NULL DEFAULT false',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "tax_escrow_balance_cents" bigint NOT NULL DEFAULT 0',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "tax_disbursement_due_date" date',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "tax_disbursement_amount_cents" bigint',
  'ALTER TABLE "acquired_notes" ADD COLUMN IF NOT EXISTS "tax_authority_name" text',
  // Indexes for the watch-list queries.
  'CREATE INDEX IF NOT EXISTS "acquired_notes_org_insurance_idx" ON "acquired_notes" ("organization_id", "insurance_status")',
  'CREATE INDEX IF NOT EXISTS "acquired_notes_org_tax_due_idx" ON "acquired_notes" ("organization_id", "tax_disbursement_due_date")',

  // Note Investor — loss-mit case files (PR-12). One case per delinquent
  // note + an actions log per case. note_id is uuid (matches acquired_notes
  // prod-inferred type).
  `CREATE TABLE IF NOT EXISTS "note_loss_mit_cases" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "note_id" uuid NOT NULL REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
     "status" text NOT NULL DEFAULT 'open',
     "state" text,
     "days_past_due_at_open" integer,
     "scra_checked_at" timestamptz,
     "scra_active_duty" boolean,
     "opened_at" timestamptz NOT NULL DEFAULT now(),
     "closed_at" timestamptz,
     "summary" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "loss_mit_org_status_idx" ON "note_loss_mit_cases" ("organization_id", "status")',
  'CREATE INDEX IF NOT EXISTS "loss_mit_org_note_idx" ON "note_loss_mit_cases" ("organization_id", "note_id")',

  `CREATE TABLE IF NOT EXISTS "note_loss_mit_actions" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "case_id" uuid NOT NULL REFERENCES "note_loss_mit_cases"("id") ON DELETE CASCADE,
     "action_type" text NOT NULL,
     "performed_at" timestamptz NOT NULL DEFAULT now(),
     "notes" text,
     "performed_by_user_id" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "loss_mit_actions_case_idx" ON "note_loss_mit_actions" ("case_id", "performed_at")',
  'CREATE INDEX IF NOT EXISTS "loss_mit_actions_org_type_idx" ON "note_loss_mit_actions" ("organization_id", "action_type")',

  // Tax-Delinquent vertical TD-2 — tax_certificates table for the
  // redemption-clock dashboard. Marcus's deal-killer surface.
  `CREATE TABLE IF NOT EXISTS "tax_certificates" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "listing_id" integer REFERENCES "tax_sale_listings"("id") ON DELETE SET NULL,
     "property_id" integer REFERENCES "properties"("id") ON DELETE SET NULL,
     "state" text NOT NULL,
     "county" text NOT NULL,
     "apn" text NOT NULL,
     "certificate_number" text,
     "sale_type" text NOT NULL,
     "sale_date" date NOT NULL,
     "purchase_amount_cents" bigint NOT NULL,
     "bid_down_rate_bps" integer,
     "owner_name" text,
     "owner_address" jsonb,
     "redemption_deadline" date NOT NULL,
     "owner_occupied_at_sale" boolean,
     "scra_tolling_applied" boolean,
     "status" text NOT NULL DEFAULT 'active',
     "redeemed_at" date,
     "redeemed_amount_cents" bigint,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "tax_certificates_org_status_deadline_idx" ON "tax_certificates" ("organization_id", "status", "redemption_deadline")',
  'CREATE INDEX IF NOT EXISTS "tax_certificates_org_state_county_idx" ON "tax_certificates" ("organization_id", "state", "county")',
  'CREATE UNIQUE INDEX IF NOT EXISTS "tax_certificates_natural_key_uk" ON "tax_certificates" ("organization_id", "state", "county", "apn", "sale_date")',

  // Tax-Delinquent vertical TD-3 — per-state redemption + statutory rules.
  // Replaces in-memory STATE_REDEMPTION_RULES const for states the DB has;
  // const stays as fallback for unreviewed states. Marcus: "you need all 50,
  // not eight."
  `CREATE TABLE IF NOT EXISTS "tax_jurisdiction_rules" (
     "state" text PRIMARY KEY,
     "sale_type" text NOT NULL,
     "interest_model" text NOT NULL,
     "redemption_period_months" integer NOT NULL,
     "redemption_period_months_owner_occupied" integer,
     "default_rate_bps" integer NOT NULL,
     "first_period_months" integer,
     "first_period_rate_bps" integer,
     "second_period_rate_bps" integer,
     "yearly_add_on_bps" integer,
     "deadline_anchor" text NOT NULL DEFAULT 'sale_date',
     "citation" text,
     "notice_requirements" text,
     "quiet_title_procedure" text,
     "foreclosure_procedure" text,
     "attorney_reviewed_at" timestamptz,
     "attorney_reviewed_by" text,
     "notes" text,
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  // Seed data — top tax-sale states. Marcus called out TN/MS/AL specifically
  // missing; the seed covers them plus the big-name FL/TX/GA. attorney_reviewed_at
  // stays NULL — the data is paralegal-quality, not counsel-reviewed. The UI
  // surfaces the gap. Updating these rows in prod doesn't require a deploy.
  `INSERT INTO "tax_jurisdiction_rules"
     ("state","sale_type","interest_model","redemption_period_months","redemption_period_months_owner_occupied","default_rate_bps","first_period_months","first_period_rate_bps","second_period_rate_bps","yearly_add_on_bps","deadline_anchor","citation","notice_requirements","quiet_title_procedure","foreclosure_procedure")
     VALUES
     ('TX','deed','flat_first_period',6,24,2500,6,2500,5000,NULL,'sale_date','Tex. Tax Code §34.21','Statutory notice-to-redeem within 30 days of deed; redemption period 6 mo non-homestead / 24 mo homestead/agricultural','Quiet title under Tex. Civ. Prac. & Rem. Code §16.024; service of process on prior owner + lienholders + heirs','Tax sale held by sheriff; redemption with 25% statutory premium first 6 mo')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation","notice_requirements","quiet_title_procedure","foreclosure_procedure")
     VALUES ('FL','lien','bid_down',24,1800,'sale_date','Fla. Stat. §197.472','Pre-deed-application 30-day notice to owner + lienholders','Quiet title not required for tax-deed buyer; deed itself confirms title','Bid-down rate sale; certificate holder applies for tax deed at month 22 (24-mo redemption then deed sale)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","yearly_add_on_bps","deadline_anchor","citation","notice_requirements","quiet_title_procedure")
     VALUES ('GA','redeemable_deed','tiered_yearly',12,2000,1000,'sale_date','O.C.G.A. §48-4-42','Notice to redeem 30 days minimum; barment notice required to terminate redemption','Quiet title or barment under §48-4-46')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation","notice_requirements","quiet_title_procedure")
     VALUES ('AL','lien','simple_annual',36,1200,'sale_date','Code of Ala. §40-10-83','Statutory notice required before quiet-title; super-priority interest after 3 years','Quiet title under §40-10-180 et seq')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation","notice_requirements")
     VALUES ('TN','deed','simple_annual',12,1200,'sale_date','Tenn. Code Ann. §67-5-2701','Notice to delinquent owner + lienholders; 1-year redemption (owner-occupied) or shorter for vacant (Tenn. Code Ann. §67-5-2702)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation","notice_requirements")
     VALUES ('MS','lien','simple_annual',24,1800,'sale_date','Miss. Code Ann. §27-45-3','Notice to redeem to all interested parties of record')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('SC','lien','simple_annual',12,1200,'sale_date','S.C. Code §12-51-90')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('NC','deed','no_redemption',0,0,'sale_date','N.C. Gen. Stat. §105-374')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('AZ','lien','bid_down',36,1600,'sale_date','A.R.S. §42-18152')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('IA','lien','monthly',21,200,'sale_date','Iowa Code §447.1')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('OH','lien','simple_annual',12,1800,'sale_date','Ohio Rev. Code §5721.30')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('IL','lien','flat_first_period',30,1800,'sale_date','35 ILCS 200/21-310 (3% per 6 months for first 24 mo, then 6%/6mo)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('NJ','lien','bid_down',24,1800,'sale_date','N.J. Stat. §54:5-32 (bid-down to as low as 0%)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('CA','deed','no_redemption',0,0,'sale_date','Cal. Rev. & Tax. Code §3691 et seq (no post-sale redemption)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('NV','deed','no_redemption',0,0,'sale_date','Nev. Rev. Stat. §361.585 (post-sale; pre-sale 2-year redemption period)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('CO','lien','simple_annual',36,900,'sale_date','C.R.S. §39-12-103 (rate is 9% above federal funds rate)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('OK','deed','simple_annual',12,800,'sale_date','Okla. Stat. tit. 68 §3105')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('AR','deed','simple_annual',24,1000,'sale_date','Ark. Code Ann. §26-37-101')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('LA','lien','simple_annual',36,1200,'sale_date','La. R.S. §47:2241 (3-year redemption)')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('IN','lien','simple_annual',12,1000,'sale_date','Ind. Code §6-1.1-25-1')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "tax_jurisdiction_rules" ("state","sale_type","interest_model","redemption_period_months","default_rate_bps","deadline_anchor","citation")
     VALUES ('MO','lien','simple_annual',12,1000,'sale_date','Mo. Rev. Stat. §140.260')
     ON CONFLICT (state) DO NOTHING`,

  // Tax-Delinquent vertical TD-4 — auction worksheet + bid-log.
  // Per-listing pre-auction worksheet fields + day-of bid action log.
  // Marcus: "Today this is paper."
  'ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "max_bid_cents" bigint',
  'ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "walk_away_above_cents" bigint',
  'ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "walk_away_condition" text',
  // partner_split is jsonb storing array of { investorName, splitBps }
  'ALTER TABLE "tax_sale_listings" ADD COLUMN IF NOT EXISTS "partner_split" jsonb',
  `CREATE TABLE IF NOT EXISTS "auction_bid_log" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "listing_id" integer NOT NULL REFERENCES "tax_sale_listings"("id") ON DELETE CASCADE,
     "action" text NOT NULL,
     "amount_cents" bigint,
     "performed_at" timestamptz NOT NULL DEFAULT now(),
     "performed_by_user_id" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "auction_bid_log_listing_idx" ON "auction_bid_log" ("listing_id", "performed_at")',
  'CREATE INDEX IF NOT EXISTS "auction_bid_log_org_idx" ON "auction_bid_log" ("organization_id", "performed_at")',

  // Tax-Delinquent vertical TD-5 — clerk profile per county. Marcus:
  // "Putting them on the county detail page — searchable, mine, private —
  // is a feature I'd notice within a week."
  'ALTER TABLE "target_counties" ADD COLUMN IF NOT EXISTS "clerk_profile" jsonb',

  // Tax-Delinquent vertical TD-6 — quiet-title workflow + steps.
  // Marcus: "AcheOS could be the first platform to actually run that
  // workflow. […] 90-day-to-build feature that 100% of Tier-2 buyers
  // would pay $30/mo more for."
  `CREATE TABLE IF NOT EXISTS "quiet_title_cases" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "certificate_id" uuid NOT NULL,
     "state" text NOT NULL,
     "county" text NOT NULL,
     "apn" text NOT NULL,
     "status" text NOT NULL DEFAULT 'open',
     "deed_recordation_date" date,
     "attorney_name" text,
     "attorney_contact" text,
     "petition_filed_at" date,
     "court_case_number" text,
     "hearing_scheduled_at" timestamptz,
     "judgment_entered_at" date,
     "judgment_recorded_at" date,
     "summary" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "quiet_title_org_status_idx" ON "quiet_title_cases" ("organization_id", "status")',
  'CREATE INDEX IF NOT EXISTS "quiet_title_org_cert_idx" ON "quiet_title_cases" ("organization_id", "certificate_id")',
  `CREATE TABLE IF NOT EXISTS "quiet_title_steps" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "case_id" uuid NOT NULL REFERENCES "quiet_title_cases"("id") ON DELETE CASCADE,
     "step_key" text NOT NULL,
     "required_by_date" date,
     "completed_at" timestamptz,
     "completed_by_user_id" text,
     "document_s3_key" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "quiet_title_steps_case_step_uk" ON "quiet_title_steps" ("case_id", "step_key")',
  'CREATE INDEX IF NOT EXISTS "quiet_title_steps_org_idx" ON "quiet_title_steps" ("organization_id", "required_by_date")',

  // Wholesaler vertical W-1 — per-state assignment-legality rules.
  // Trey's deal-killer §7. Replaces a hardcoded JSON file so paralegals
  // can update without deploys.
  `CREATE TABLE IF NOT EXISTS "wholesaler_state_rules" (
     "state" text PRIMARY KEY,
     "status" text NOT NULL,
     "license_required" boolean NOT NULL DEFAULT false,
     "advertising_restricted" boolean NOT NULL DEFAULT false,
     "recommendation" text NOT NULL DEFAULT 'unrestricted',
     "citation" text,
     "summary" text,
     "detail" text,
     "attorney_reviewed_at" timestamptz,
     "attorney_reviewed_by" text,
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  // Seed the states Trey explicitly called out + a few additional
  // commonly-cited restrictions. attorney_reviewed_at NULL for now —
  // UI marks them preliminary.
  `INSERT INTO "wholesaler_state_rules"
     ("state","status","license_required","advertising_restricted","recommendation","citation","summary","detail")
     VALUES
     ('IL','license_required',true,true,'double_close_only','225 ILCS 454/10-5; 765 ILCS 605/3','Illinois requires a real-estate license to assign a contract for a fee. Marketing a property you do not own is also restricted.','HB 2398 (effective 2019) added wholesale assignment to the licensed-activities list. Penalty: misdemeanor + administrative fine.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary","detail")
     VALUES ('OK','license_required',true,true,'double_close_only','OK ST 59 §858-102 (as amended by HB 2496, eff. 2021)','Oklahoma added wholesaling to licensed activities. Marketing properties under contract for assignment requires a license.','License-required state. The legal-safe path is double-close (you take title, sell title) — see /double-close.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary","detail")
     VALUES ('SC','advertising_restricted',false,true,'consult_counsel','S.C. Code §40-57-30','South Carolina restricts marketing of properties you do not own; assignment for a fee may trigger licensing requirements.','Advertising restrictions are particular to SC: cannot market a property in which you do not hold title or an enforceable contract.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary","detail")
     VALUES ('PA','pending_legislation',false,false,'consult_counsel','PA HB 1158 (2025 session)','Pennsylvania has pending legislation that would require wholesaler licensing. Bill not yet enacted as of 2026.','Watch list. Confirm current status with PA Real Estate Commission before relying on assignment-for-fee in PA.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('AZ','unrestricted',false,false,'unrestricted','A.R.S. §32-2122','Arizona permits assignment-for-fee without licensing.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('TX','unrestricted',false,false,'unrestricted','Tex. Occ. Code §1101.0045','Texas permits wholesaling but requires the wholesaler to disclose equitable interest, not the property itself, when marketing.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('FL','unrestricted',false,false,'unrestricted','Fla. Stat. §475.011','Florida permits assignment-for-fee without licensing.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('GA','unrestricted',false,false,'unrestricted','O.C.G.A. §43-40-29','Georgia permits assignment-for-fee.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('CA','advertising_restricted',false,true,'consult_counsel','Cal. Bus. & Prof. Code §10131','California advertising restrictions can apply to wholesale marketing in some configurations.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('NV','unrestricted',false,false,'unrestricted','Nev. Rev. Stat. §645.0445','Nevada permits assignment-for-fee.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('OH','unrestricted',false,false,'unrestricted','Ohio Rev. Code §4735.01','Ohio permits wholesaling.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('NC','unrestricted',false,false,'unrestricted','N.C. Gen. Stat. §93A-2','North Carolina permits assignment-for-fee with disclosure.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "wholesaler_state_rules" ("state","status","license_required","advertising_restricted","recommendation","citation","summary")
     VALUES ('TN','unrestricted',false,false,'unrestricted','Tenn. Code Ann. §62-13-103','Tennessee permits assignment-for-fee.')
     ON CONFLICT (state) DO NOTHING`,

  // Wholesaler vertical W-2 — EMD inspection-period state machine.
  // Trey: "Saves me $1,000 per blown deal."
  `CREATE TABLE IF NOT EXISTS "earnest_money_holds" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "deal_id" integer,
     "property_id" integer REFERENCES "properties"("id") ON DELETE SET NULL,
     "amount_cents" bigint NOT NULL,
     "title_company" text,
     "reference_number" text,
     "deposited_at" date NOT NULL,
     "inspection_period_days" integer NOT NULL DEFAULT 7,
     "refundable_until_at" date NOT NULL,
     "status" text NOT NULL DEFAULT 'pending',
     "status_changed_at" timestamptz,
     "final_disposition_amount_cents" bigint,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "emd_org_status_refundable_idx" ON "earnest_money_holds" ("organization_id", "status", "refundable_until_at")',
  'CREATE INDEX IF NOT EXISTS "emd_org_deal_idx" ON "earnest_money_holds" ("organization_id", "deal_id")',

  // Wholesaler vertical W-3 — double-close primitive (A→B + B→C).
  // Trey: "I have to buy at 9 AM and sell at 9:01 AM through a transactional
  // funder. […] That's a missing primitive."
  `CREATE TABLE IF NOT EXISTS "double_close_deals" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer REFERENCES "properties"("id") ON DELETE SET NULL,
     "reason" text NOT NULL DEFAULT 'operator_choice',
     "a_seller_name" text NOT NULL,
     "a_side_purchase_price_cents" bigint NOT NULL,
     "a_side_contract_date" date,
     "a_side_closing_date" date,
     "a_side_title_company" text,
     "bc_buyer_name" text,
     "bc_side_purchase_price_cents" bigint,
     "bc_side_contract_date" date,
     "bc_side_closing_date" date,
     "bc_side_title_company" text,
     "transactional_funder_name" text,
     "transactional_funder_fee_cents" bigint,
     "transactional_funder_rate_bps" integer,
     "status" text NOT NULL DEFAULT 'planned',
     "state" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "double_close_org_status_idx" ON "double_close_deals" ("organization_id", "status")',
  'CREATE INDEX IF NOT EXISTS "double_close_org_property_idx" ON "double_close_deals" ("organization_id", "property_id")',

  // Wholesaler vertical W-4 — push-to-buyer-list. Trey: "the single feature
  // that flips me from $20 trial to $49/mo paying."
  `CREATE TABLE IF NOT EXISTS "buyer_blasts" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "subject" text NOT NULL,
     "body_snapshot" text,
     "channel" text NOT NULL DEFAULT 'email',
     "status" text NOT NULL DEFAULT 'queued',
     "recipient_count" integer NOT NULL DEFAULT 0,
     "sent_count" integer NOT NULL DEFAULT 0,
     "failed_count" integer NOT NULL DEFAULT 0,
     "replied_count" integer NOT NULL DEFAULT 0,
     "sent_by_user_id" text,
     "completed_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "buyer_blasts_org_idx" ON "buyer_blasts" ("organization_id", "created_at")',
  'CREATE INDEX IF NOT EXISTS "buyer_blasts_property_idx" ON "buyer_blasts" ("property_id")',
  `CREATE TABLE IF NOT EXISTS "buyer_blast_recipients" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "blast_id" uuid NOT NULL REFERENCES "buyer_blasts"("id") ON DELETE CASCADE,
     "buyer_profile_id" integer NOT NULL REFERENCES "buyer_profiles"("id") ON DELETE CASCADE,
     "match_score" integer,
     "email" text,
     "status" text NOT NULL DEFAULT 'queued',
     "sent_at" timestamptz,
     "responded_at" timestamptz,
     "response_notes" text,
     "failure_reason" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "buyer_blast_recipients_blast_buyer_uk" ON "buyer_blast_recipients" ("blast_id", "buyer_profile_id")',
  'CREATE INDEX IF NOT EXISTS "buyer_blast_recipients_status_idx" ON "buyer_blast_recipients" ("organization_id", "status")',

  // ── Subdivider vertical SD-1 — Brigid's deal-killer fix ─────────────────
  // "One parent parcel becomes many child lots, and AcreOS does not know
  // that." (brigid-subdivider.md §7) Adds parent/child link on properties +
  // 7 supporting tables (plans, permits, basis allocations, pricing, county
  // timelines, CC&R templates).
  `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "parent_parcel_id" integer REFERENCES "properties"("id") ON DELETE SET NULL`,
  `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "child_lot_number" text`,
  `ALTER TABLE "properties" ADD COLUMN IF NOT EXISTS "subdivision_plan_id" uuid`,
  'CREATE INDEX IF NOT EXISTS "properties_parent_parcel_idx" ON "properties" ("parent_parcel_id") WHERE "parent_parcel_id" IS NOT NULL',
  'CREATE INDEX IF NOT EXISTS "properties_org_parent_idx" ON "properties" ("organization_id", "parent_parcel_id")',

  `CREATE TABLE IF NOT EXISTS "subdivision_plans" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "parent_parcel_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "name" text NOT NULL,
     "version_number" integer NOT NULL DEFAULT 1,
     "status" text NOT NULL DEFAULT 'draft',
     "geojson" jsonb,
     "lot_count" integer,
     "total_road_feet" integer,
     "total_acres" numeric,
     "notes" text,
     "created_by" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "subdivision_plans_org_parent_idx" ON "subdivision_plans" ("organization_id", "parent_parcel_id")',
  'CREATE INDEX IF NOT EXISTS "subdivision_plans_status_idx" ON "subdivision_plans" ("organization_id", "status")',

  `CREATE TABLE IF NOT EXISTS "permit_checklists" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "parent_parcel_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "county_state" text NOT NULL,
     "county_name" text NOT NULL,
     "template_key" text,
     "title" text,
     "notes" text,
     "completed_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "permit_checklists_org_parent_idx" ON "permit_checklists" ("organization_id", "parent_parcel_id")',
  'CREATE INDEX IF NOT EXISTS "permit_checklists_county_idx" ON "permit_checklists" ("county_state", "county_name")',

  `CREATE TABLE IF NOT EXISTS "permit_gates" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "checklist_id" uuid NOT NULL REFERENCES "permit_checklists"("id") ON DELETE CASCADE,
     "sequence" integer NOT NULL,
     "gate_key" text NOT NULL,
     "label" text NOT NULL,
     "status" text NOT NULL DEFAULT 'not_started',
     "submitted_at" date,
     "expected_return_at" date,
     "completed_at" date,
     "fee_cents" bigint,
     "contact_name" text,
     "contact_email" text,
     "contact_phone" text,
     "reference_number" text,
     "notes" text,
     "document_version_id" integer,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "permit_gates_org_checklist_idx" ON "permit_gates" ("organization_id", "checklist_id", "sequence")',
  'CREATE INDEX IF NOT EXISTS "permit_gates_status_idx" ON "permit_gates" ("organization_id", "status", "expected_return_at")',

  `CREATE TABLE IF NOT EXISTS "lot_basis_allocations" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "parent_parcel_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "child_parcel_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "method" text NOT NULL DEFAULT 'acreage',
     "denominator" numeric NOT NULL,
     "numerator" numeric NOT NULL,
     "share_pct" numeric NOT NULL,
     "allocated_basis_cents" bigint NOT NULL,
     "override_share" numeric,
     "notes" text,
     "realized_at" timestamptz,
     "realized_sale_price_cents" bigint,
     "realized_cogs_cents" bigint,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "lot_basis_alloc_parent_child_uk" ON "lot_basis_allocations" ("parent_parcel_id", "child_parcel_id")',
  'CREATE INDEX IF NOT EXISTS "lot_basis_alloc_org_parent_idx" ON "lot_basis_allocations" ("organization_id", "parent_parcel_id")',

  `CREATE TABLE IF NOT EXISTS "lot_pricing_rules" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "parent_parcel_id" integer REFERENCES "properties"("id") ON DELETE CASCADE,
     "name" text NOT NULL,
     "is_default" boolean NOT NULL DEFAULT false,
     "base_price_source" text NOT NULL DEFAULT 'avm_per_acre',
     "fixed_per_acre_cents" bigint,
     "rules" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "locked_grid" jsonb,
     "locked_at" timestamptz,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "lot_pricing_rules_org_parent_idx" ON "lot_pricing_rules" ("organization_id", "parent_parcel_id")',
  `CREATE UNIQUE INDEX IF NOT EXISTS "lot_pricing_rules_org_default_uk" ON "lot_pricing_rules" ("organization_id") WHERE is_default = true`,

  `CREATE TABLE IF NOT EXISTS "county_subdivision_timelines" (
     "id" serial PRIMARY KEY,
     "state" text NOT NULL,
     "county_name" text NOT NULL,
     "p50_total_days" integer,
     "p90_total_days" integer,
     "pre_application_lead_days" integer,
     "sketch_plan_lead_days" integer,
     "preliminary_plat_lead_days" integer,
     "percolation_lead_days" integer,
     "final_plat_lead_days" integer,
     "recording_lead_days" integer,
     "percolation_season_note" text,
     "typical_revision_rounds" integer,
     "contact_name" text,
     "contact_phone" text,
     "contact_email" text,
     "planner_site_url" text,
     "source" text,
     "source_updated_at" date,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "county_timelines_state_county_uk" ON "county_subdivision_timelines" ("state", "county_name")',

  // Brigid §7 seed: TN counties she actually works.
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","pre_application_lead_days","sketch_plan_lead_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","percolation_season_note","typical_revision_rounds","source")
     VALUES ('TN','Williamson',420,540,14,30,45,90,45,21,'TDEC tester April-May and Sept-Oct only — frozen / saturated ground blocks tests',3,'Williamson Co Planning + Brigid historicals 2024-2026')
     ON CONFLICT ("state","county_name") DO NOTHING`,
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","pre_application_lead_days","sketch_plan_lead_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","percolation_season_note","typical_revision_rounds","source")
     VALUES ('TN','Hickman',120,180,7,14,21,120,21,14,'One TDEC tester serves three counties — queue is the bottleneck',2,'Hickman Co Planning')
     ON CONFLICT ("state","county_name") DO NOTHING`,
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","pre_application_lead_days","sketch_plan_lead_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","percolation_season_note","typical_revision_rounds","source")
     VALUES ('TN','Maury',180,240,14,21,30,90,30,21,'TDEC seasonal window applies',2,'Maury Co Planning')
     ON CONFLICT ("state","county_name") DO NOTHING`,
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","pre_application_lead_days","sketch_plan_lead_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","percolation_season_note","typical_revision_rounds","source")
     VALUES ('TN','Davidson',null,null,30,45,60,null,60,30,'Davidson restricts residential subdivisions in some districts — confirm zoning before bidding',4,'Metro Nashville Planning Dept')
     ON CONFLICT ("state","county_name") DO NOTHING`,
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","typical_revision_rounds","source")
     VALUES ('TN','Rutherford',300,420,45,90,45,21,3,'Rutherford Co Planning — Brigid expansion estimate')
     ON CONFLICT ("state","county_name") DO NOTHING`,
  `INSERT INTO "county_subdivision_timelines"
     ("state","county_name","p50_total_days","p90_total_days","preliminary_plat_lead_days","percolation_lead_days","final_plat_lead_days","recording_lead_days","typical_revision_rounds","source")
     VALUES ('TN','Marshall',150,210,30,90,30,14,2,'Marshall Co Planning estimate')
     ON CONFLICT ("state","county_name") DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS "cc_r_templates" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
     "kind" text NOT NULL,
     "name" text NOT NULL,
     "state" text,
     "body_markdown" text NOT NULL,
     "merge_fields" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "attorney_reviewed_at" timestamptz,
     "attorney_reviewed_by" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "ccr_templates_org_kind_idx" ON "cc_r_templates" ("organization_id", "kind")',
  'CREATE INDEX IF NOT EXISTS "ccr_templates_state_kind_idx" ON "cc_r_templates" ("state", "kind")',

  // Subdivider SD-8 seed: two generic CC&R templates. Org-null = visible to
  // every org. Brigid: "no AI here, please" — these are pure merge-field
  // templates. Run them past your attorney; we do not ship legally
  // reviewed templates by default. Operators can clone & edit org-scoped.
  // Idempotent via (organization_id IS NULL, name) uniqueness — but the
  // schema's index is non-unique, so we only insert if no global with
  // that name exists yet.
  `INSERT INTO "cc_r_templates" ("organization_id", "kind", "name", "body_markdown", "merge_fields", "notes")
     SELECT NULL, 'restrictive_covenants', 'Generic restrictive covenants v1',
       E'# DECLARATION OF RESTRICTIVE COVENANTS\\n\\nFOR {{project_name}}\\n\\nRecorded in {{recording_county}} County, {{state}}\\n\\n## 1. Purpose\\n\\nThe undersigned {{declarant_name}}, owner of {{lot_count}} lot{{s_or_blank}} in {{project_name}}, hereby declares the following covenants run with the land.\\n\\n## 2. Use restrictions\\n\\n2.1 Each lot shall be used solely for residential purposes.\\n\\n2.2 No manufactured home, mobile home, or modular structure shall be placed on any lot.\\n\\n2.3 Minimum heated square footage of any primary residence: {{min_square_feet}} sq ft.\\n\\n## 3. Architectural review\\n\\n3.1 An Architectural Review Board ("ARB") composed of {{arb_committee_size}} member(s) shall review and approve all plans before construction.\\n\\n## 4. Assessments\\n\\n4.1 Each lot owner shall pay an annual assessment of {{annual_assessment}} for road and common-area maintenance.\\n\\n## 5. Term\\n\\nThese covenants shall run for thirty (30) years and automatically renew for successive ten-year periods.\\n\\nDated: {{recording_date}}\\n\\n_______________________________\\n{{declarant_name}}',
       '[
         {"key":"project_name","label":"Project name","type":"string","required":true},
         {"key":"recording_county","label":"Recording county","type":"string","required":true},
         {"key":"state","label":"State","type":"string","required":true},
         {"key":"declarant_name","label":"Declarant","type":"string","required":true},
         {"key":"lot_count","label":"Number of lots","type":"number","required":true},
         {"key":"s_or_blank","label":"Plural ''s'' (or blank)","type":"string","required":false,"placeholder":"s"},
         {"key":"min_square_feet","label":"Minimum sq ft","type":"number","required":true},
         {"key":"arb_committee_size","label":"ARB committee size","type":"number","required":true},
         {"key":"annual_assessment","label":"Annual assessment (cents)","type":"currency_cents","required":true},
         {"key":"recording_date","label":"Recording date","type":"date","required":true}
       ]'::jsonb,
       'GENERIC TEMPLATE — review with a licensed attorney before recording. AcreOS does not warrant fitness for any specific jurisdiction.'
   WHERE NOT EXISTS (SELECT 1 FROM "cc_r_templates" WHERE organization_id IS NULL AND name = 'Generic restrictive covenants v1')`,
  `INSERT INTO "cc_r_templates" ("organization_id", "kind", "name", "body_markdown", "merge_fields", "notes")
     SELECT NULL, 'road_maintenance_agreement', 'Generic road maintenance agreement v1',
       E'# ROAD MAINTENANCE AGREEMENT\\n\\nProject: {{project_name}} | County: {{recording_county}}, {{state}}\\n\\nEach lot owner served by the private road known as {{road_name}} shall contribute pro-rata to the cost of grading, gravel resurfacing, drainage, and snow clearing.\\n\\n## Cost share\\n\\nCosts are split equally among the {{lot_count}} lots served by {{road_name}}.\\n\\nAnnual contribution: {{annual_contribution}} per lot.\\n\\n## Special assessments\\n\\nIn the event of a major repair (washout, culvert replacement, repaving) costing more than {{special_threshold}}, all lot owners shall vote and a majority shall bind the minority.\\n\\nDated: {{recording_date}}',
       '[
         {"key":"project_name","label":"Project name","type":"string","required":true},
         {"key":"recording_county","label":"Recording county","type":"string","required":true},
         {"key":"state","label":"State","type":"string","required":true},
         {"key":"road_name","label":"Road name","type":"string","required":true},
         {"key":"lot_count","label":"Number of lots served","type":"number","required":true},
         {"key":"annual_contribution","label":"Annual contribution (cents)","type":"currency_cents","required":true},
         {"key":"special_threshold","label":"Special-assessment threshold (cents)","type":"currency_cents","required":true},
         {"key":"recording_date","label":"Recording date","type":"date","required":true}
       ]'::jsonb,
       'GENERIC TEMPLATE — review with a licensed attorney before recording.'
   WHERE NOT EXISTS (SELECT 1 FROM "cc_r_templates" WHERE organization_id IS NULL AND name = 'Generic road maintenance agreement v1')`,

  // ── Fix-and-flip vertical FF-1 ──────────────────────────────────────────
  // Devon's deal-killer: rehab budget + contractor management advertised
  // but missing. Eight tables back the rehab + contractor + draw + bid +
  // ARV stack.
  `CREATE TABLE IF NOT EXISTS "rehabs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "name" text NOT NULL,
     "status" text NOT NULL DEFAULT 'planning',
     "started_at" date,
     "planned_listing_date" date,
     "actual_listing_date" date,
     "closed_at" date,
     "purchase_price_cents" bigint,
     "purchase_closing_cents" bigint,
     "budget_total_cents" bigint,
     "spent_total_cents" bigint NOT NULL DEFAULT 0,
     "holding_cost_monthly_cents" bigint,
     "arv_cents" bigint,
     "target_margin_cents" bigint,
     "lender_name" text,
     "lender_loan_cents" bigint,
     "lender_rate_bps" integer,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "rehabs_property_uk" ON "rehabs" ("organization_id", "property_id")',
  'CREATE INDEX IF NOT EXISTS "rehabs_org_status_idx" ON "rehabs" ("organization_id", "status")',

  `CREATE TABLE IF NOT EXISTS "rehab_line_items" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
     "sequence" integer NOT NULL DEFAULT 0,
     "category" text NOT NULL,
     "scope" text NOT NULL,
     "contractor_id" uuid,
     "budget_cents" bigint NOT NULL DEFAULT 0,
     "committed_cents" bigint NOT NULL DEFAULT 0,
     "spent_cents" bigint NOT NULL DEFAULT 0,
     "started_at" date,
     "completed_at" date,
     "photo_count" integer NOT NULL DEFAULT 0,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "rehab_line_items_rehab_idx" ON "rehab_line_items" ("rehab_id", "sequence")',
  'CREATE INDEX IF NOT EXISTS "rehab_line_items_org_category_idx" ON "rehab_line_items" ("organization_id", "category")',

  `CREATE TABLE IF NOT EXISTS "contractors" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "name" text NOT NULL,
     "business_name" text,
     "email" text,
     "phone" text,
     "address" jsonb,
     "license_number" text,
     "insurance_expires_at" date,
     "trades" jsonb DEFAULT '[]'::jsonb,
     "tax_id_encrypted" text,
     "tax_id_type" text,
     "legal_entity_name" text,
     "w9_document_id" uuid,
     "ytd_paid_cents" bigint NOT NULL DEFAULT 0,
     "lifetime_paid_cents" bigint NOT NULL DEFAULT 0,
     "active_status" text NOT NULL DEFAULT 'active',
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "contractors_org_idx" ON "contractors" ("organization_id", "active_status")',
  'CREATE INDEX IF NOT EXISTS "contractors_org_name_idx" ON "contractors" ("organization_id", "name")',

  `CREATE TABLE IF NOT EXISTS "contractor_w9_documents" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "contractor_id" uuid NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
     "storage_path" text NOT NULL,
     "file_size_bytes" integer,
     "mime_type" text,
     "uploaded_by" text,
     "received_at" date,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "contractor_w9_org_contractor_idx" ON "contractor_w9_documents" ("organization_id", "contractor_id")',

  `CREATE TABLE IF NOT EXISTS "contractor_payments" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "contractor_id" uuid NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
     "rehab_id" uuid REFERENCES "rehabs"("id") ON DELETE SET NULL,
     "rehab_line_item_id" uuid REFERENCES "rehab_line_items"("id") ON DELETE SET NULL,
     "amount_cents" bigint NOT NULL,
     "paid_at" date NOT NULL,
     "method" text,
     "reference_number" text,
     "memo" text,
     "tax_year" integer NOT NULL,
     "excluded_from_1099" boolean NOT NULL DEFAULT false,
     "qbo_transaction_id" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "contractor_payments_org_year_idx" ON "contractor_payments" ("organization_id", "tax_year")',
  'CREATE INDEX IF NOT EXISTS "contractor_payments_contractor_year_idx" ON "contractor_payments" ("contractor_id", "tax_year")',
  'CREATE INDEX IF NOT EXISTS "contractor_payments_rehab_idx" ON "contractor_payments" ("rehab_id")',

  `CREATE TABLE IF NOT EXISTS "construction_draws" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
     "sequence" integer NOT NULL,
     "label" text NOT NULL,
     "pct_of_loan" numeric NOT NULL,
     "amount_cents" bigint NOT NULL,
     "status" text NOT NULL DEFAULT 'planned',
     "requested_at" date,
     "inspection_at" date,
     "funded_at" date,
     "inspector_name" text,
     "inspector_contact" text,
     "rejection_reason" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "construction_draws_rehab_seq_uk" ON "construction_draws" ("rehab_id", "sequence")',
  'CREATE INDEX IF NOT EXISTS "construction_draws_org_status_idx" ON "construction_draws" ("organization_id", "status")',

  `CREATE TABLE IF NOT EXISTS "bid_estimates" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "rehab_id" uuid NOT NULL REFERENCES "rehabs"("id") ON DELETE CASCADE,
     "contractor_id" uuid NOT NULL REFERENCES "contractors"("id") ON DELETE CASCADE,
     "total_cents" bigint NOT NULL,
     "submitted_at" date,
     "valid_until" date,
     "category_breakdown" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "document_path" text,
     "notes" text,
     "is_accepted" boolean NOT NULL DEFAULT false,
     "rejected_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "bid_estimates_rehab_idx" ON "bid_estimates" ("rehab_id")',
  'CREATE INDEX IF NOT EXISTS "bid_estimates_org_idx" ON "bid_estimates" ("organization_id", "is_accepted")',

  `CREATE TABLE IF NOT EXISTS "arv_calculations" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "rehab_id" uuid REFERENCES "rehabs"("id") ON DELETE SET NULL,
     "comps_used" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "subject_sqft" integer,
     "price_per_sqft_low_cents" bigint,
     "price_per_sqft_mid_cents" bigint,
     "price_per_sqft_high_cents" bigint,
     "arv_low_cents" bigint NOT NULL,
     "arv_mid_cents" bigint NOT NULL,
     "arv_high_cents" bigint NOT NULL,
     "confidence" text,
     "methodology" text,
     "is_current" boolean NOT NULL DEFAULT true,
     "notes" text,
     "created_by" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "arv_calculations_property_idx" ON "arv_calculations" ("property_id", "is_current")',
  'CREATE INDEX IF NOT EXISTS "arv_calculations_org_idx" ON "arv_calculations" ("organization_id")',

  // ── Buy-and-hold vertical BH-1 ──────────────────────────────────────────
  // Imelda's deal-killer: no tenant entity, no lease entity, no rent ledger,
  // no maintenance ticketing.
  `CREATE TABLE IF NOT EXISTS "tenants" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "first_name" text NOT NULL,
     "last_name" text NOT NULL,
     "email" text,
     "phone" text,
     "sms_consent" boolean NOT NULL DEFAULT false,
     "sms_consent_at" timestamptz,
     "date_of_birth" date,
     "government_id_last4" text,
     "status" text NOT NULL DEFAULT 'applicant',
     "source_channel" text,
     "screening_completed_at" timestamptz,
     "screening_credit_score" integer,
     "screening_has_prior_eviction" boolean,
     "screening_has_criminal_record" boolean,
     "screening_income_monthly_cents" bigint,
     "screening_criteria_met" boolean,
     "adverse_action_notice_sent_at" timestamptz,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "tenants_org_status_idx" ON "tenants" ("organization_id", "status")',
  'CREATE INDEX IF NOT EXISTS "tenants_org_email_idx" ON "tenants" ("organization_id", "email")',

  // BH-1 uses `rental_leases` as the table name to avoid colliding with a
  // pre-existing thin `leases` stub.
  `CREATE TABLE IF NOT EXISTS "rental_leases" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "unit_label" text,
     "parent_lease_id" uuid,
     "version_number" integer NOT NULL DEFAULT 1,
     "status" text NOT NULL DEFAULT 'draft',
     "liability_model" text NOT NULL DEFAULT 'joint_and_several',
     "start_date" date NOT NULL,
     "end_date" date,
     "monthly_rent_cents" bigint NOT NULL,
     "rent_due_day_of_month" integer NOT NULL DEFAULT 1,
     "security_deposit_cents" bigint NOT NULL DEFAULT 0,
     "pet_deposit_cents" bigint NOT NULL DEFAULT 0,
     "is_section_8" boolean NOT NULL DEFAULT false,
     "hap_portion_cents" bigint,
     "tenant_portion_cents" bigint,
     "state" text NOT NULL,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "rental_leases_org_status_idx" ON "rental_leases" ("organization_id", "status")',
  'CREATE INDEX IF NOT EXISTS "rental_leases_property_idx" ON "rental_leases" ("property_id", "status")',
  'CREATE INDEX IF NOT EXISTS "rental_leases_parent_idx" ON "rental_leases" ("parent_lease_id")',

  `CREATE TABLE IF NOT EXISTS "lease_tenants" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
     "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
     "rent_share_pct" numeric NOT NULL DEFAULT 1,
     "is_primary" boolean NOT NULL DEFAULT true,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "lease_tenants_lease_tenant_uk" ON "lease_tenants" ("lease_id", "tenant_id")',
  'CREATE INDEX IF NOT EXISTS "lease_tenants_org_idx" ON "lease_tenants" ("organization_id")',

  `CREATE TABLE IF NOT EXISTS "lease_addendums" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
     "kind" text NOT NULL,
     "title" text NOT NULL,
     "body_markdown" text,
     "document_path" text,
     "signed_at" timestamptz,
     "effective_date" date,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "lease_addendums_lease_idx" ON "lease_addendums" ("lease_id", "kind")',

  `CREATE TABLE IF NOT EXISTS "rent_charges" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
     "charged_for_month" date NOT NULL,
     "due_date" date NOT NULL,
     "amount_cents" bigint NOT NULL,
     "hap_portion_cents" bigint,
     "tenant_portion_cents" bigint,
     "paid_cents" bigint NOT NULL DEFAULT 0,
     "balance_cents" bigint NOT NULL,
     "late_fee_cents" bigint NOT NULL DEFAULT 0,
     "late_fee_applied_at" timestamptz,
     "legal_posture" text NOT NULL DEFAULT 'ok',
     "legal_posture_at" timestamptz,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "rent_charges_lease_month_uk" ON "rent_charges" ("lease_id", "charged_for_month")',
  'CREATE INDEX IF NOT EXISTS "rent_charges_org_balance_idx" ON "rent_charges" ("organization_id", "balance_cents", "due_date")',

  `CREATE TABLE IF NOT EXISTS "rent_payments" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
     "rent_charge_id" uuid REFERENCES "rent_charges"("id") ON DELETE SET NULL,
     "payor_type" text NOT NULL DEFAULT 'tenant',
     "payor_tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
     "amount_cents" bigint NOT NULL,
     "received_at" date NOT NULL,
     "method" text,
     "reference_number" text,
     "stripe_payment_intent_id" text,
     "is_partial" boolean NOT NULL DEFAULT false,
     "accepted_despite_partial" boolean,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "rent_payments_lease_idx" ON "rent_payments" ("lease_id", "received_at")',
  'CREATE INDEX IF NOT EXISTS "rent_payments_charge_idx" ON "rent_payments" ("rent_charge_id")',
  'CREATE INDEX IF NOT EXISTS "rent_payments_org_received_idx" ON "rent_payments" ("organization_id", "received_at")',

  `CREATE TABLE IF NOT EXISTS "late_fee_rules" (
     "state" text PRIMARY KEY,
     "cap_pct_small_property" numeric,
     "cap_pct_large_property" numeric,
     "cap_flat_cents" bigint,
     "grace_days" integer NOT NULL DEFAULT 0,
     "initial_fee_cents" bigint,
     "per_day_cents" bigint,
     "citation" text,
     "summary" text,
     "attorney_reviewed_at" timestamptz,
     "attorney_reviewed_by" text,
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,

  // Late-fee rule seeds — Imelda §2.4. Verify with state counsel before
  // shipping. Numbers below are public-statute summaries as of 2024-2026.
  `INSERT INTO "late_fee_rules" ("state","cap_pct_small_property","cap_pct_large_property","grace_days","citation","summary")
     VALUES ('TX', 0.10, 0.12, 2, 'Tex. Prop. Code §92.019', 'Cap 10% small / 12% 4+ unit; 2-day grace; partial-rent acceptance after notice voids the notice.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "late_fee_rules" ("state","cap_pct_small_property","cap_pct_large_property","grace_days","citation","summary")
     VALUES ('CA', 0.06, 0.06, 5, 'Cal. Civ. Code §1671 (reasonable estimate doctrine)', 'No statutory cap, but courts enforce ''reasonable'' — 6% of monthly rent is the safe ceiling. 3-day notice to pay or quit standard.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "late_fee_rules" ("state","cap_pct_small_property","cap_pct_large_property","grace_days","citation","summary")
     VALUES ('NY', 0.05, 0.05, 5, 'N.Y. RPL §238-a(2) (HSTPA 2019)', 'Cap 5% of monthly rent or \$50, whichever less. Mandatory 5-day grace. 14-day notice before nonpayment proceeding.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "late_fee_rules" ("state","cap_pct_small_property","cap_pct_large_property","grace_days","citation","summary")
     VALUES ('FL', null, null, 0, 'Fla. Stat. §83.43-83.595', 'No statutory cap. Late-fee enforceable per lease terms. 3-day notice to pay or vacate.')
     ON CONFLICT (state) DO NOTHING`,
  `INSERT INTO "late_fee_rules" ("state","cap_pct_small_property","cap_pct_large_property","grace_days","citation","summary")
     VALUES ('GA', null, null, 0, 'O.C.G.A. §44-7 (no specific cap)', 'No statutory cap but lease-stated fee enforceable if reasonable. No statutory grace period.')
     ON CONFLICT (state) DO NOTHING`,

  `CREATE TABLE IF NOT EXISTS "maintenance_tickets" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "lease_id" uuid REFERENCES "rental_leases"("id") ON DELETE SET NULL,
     "submitted_by_tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
     "title" text NOT NULL,
     "description" text,
     "category" text,
     "severity" text NOT NULL DEFAULT 'standard',
     "status" text NOT NULL DEFAULT 'open',
     "submitted_at" timestamptz NOT NULL DEFAULT now(),
     "triaged_at" timestamptz,
     "dispatched_at" timestamptz,
     "completed_at" timestamptz,
     "assigned_contractor_id" uuid REFERENCES "contractors"("id") ON DELETE SET NULL,
     "repair_notes" text,
     "invoice_cents" bigint,
     "invoice_paid_at" timestamptz,
     "photos" jsonb DEFAULT '[]'::jsonb,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "maintenance_tickets_org_status_idx" ON "maintenance_tickets" ("organization_id", "status", "severity")',
  'CREATE INDEX IF NOT EXISTS "maintenance_tickets_property_idx" ON "maintenance_tickets" ("property_id", "status")',
  'CREATE INDEX IF NOT EXISTS "maintenance_tickets_contractor_idx" ON "maintenance_tickets" ("assigned_contractor_id")',

  `CREATE TABLE IF NOT EXISTS "move_inspections" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "property_id" integer NOT NULL REFERENCES "properties"("id") ON DELETE CASCADE,
     "lease_id" uuid REFERENCES "rental_leases"("id") ON DELETE SET NULL,
     "tenant_id" uuid REFERENCES "tenants"("id") ON DELETE SET NULL,
     "kind" text NOT NULL,
     "inspection_date" date NOT NULL,
     "conducted_by" text,
     "checklist" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "photos" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "tenant_signed_at" timestamptz,
     "landlord_signed_at" timestamptz,
     "signing_packet_id" uuid,
     "damages_total_cents" bigint,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "move_inspections_property_idx" ON "move_inspections" ("property_id", "kind")',
  'CREATE INDEX IF NOT EXISTS "move_inspections_lease_idx" ON "move_inspections" ("lease_id")',

  `CREATE TABLE IF NOT EXISTS "security_deposits" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "lease_id" uuid NOT NULL REFERENCES "rental_leases"("id") ON DELETE CASCADE,
     "tenant_id" uuid NOT NULL REFERENCES "tenants"("id") ON DELETE CASCADE,
     "held_cents" bigint NOT NULL,
     "received_at" date,
     "move_out_inspection_id" uuid REFERENCES "move_inspections"("id") ON DELETE SET NULL,
     "deductions" jsonb DEFAULT '[]'::jsonb,
     "deductions_total_cents" bigint DEFAULT 0,
     "refund_cents" bigint,
     "refunded_at" date,
     "statutory_deadline" date,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "security_deposits_lease_uk" ON "security_deposits" ("lease_id")',

  // Production port phase D.1: feature flag 5-state machine (migration 0029).
  // Extends platform_feature_flags with state + audience + audit columns.
  // Backfills state from existing enabled boolean (only on rows where state IS NULL).
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "state" text',
  `ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "audience" jsonb DEFAULT '{}'::jsonb`,
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "changed_by" text',
  'ALTER TABLE "platform_feature_flags" ADD COLUMN IF NOT EXISTS "changed_at" timestamp',
  `UPDATE "platform_feature_flags" SET "state" = CASE WHEN "enabled" THEN 'on' ELSE 'off' END WHERE "state" IS NULL`,

  // Seed the design-system §8.4 initial flag set if missing. Each insert
  // is idempotent via ON CONFLICT.
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('module.land-academy', 'Land Academy module', 'Educational content and certifications', false, 'off', '{}'::jsonb, '["/academy"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('module.marketplace', 'Marketplace module', 'Buyer / seller marketplace', false, 'off', '{}'::jsonb, '["/marketplace"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('surface.command-palette-v2', 'Command palette v2', 'Refined ⌘K palette with prototype shape', false, 'founder-only', '{}'::jsonb, '[]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('feature.atlas-async-jobs', 'Atlas async jobs', 'Long-running Atlas analyses with notification', false, 'founder-only', '{}'::jsonb, '[]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,
  `INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
   VALUES ('feature.autonomy-matrix', 'Autonomy matrix', 'Per-agent × per-action × thresholds permissions', false, 'founder-only', '{}'::jsonb, '["/settings"]'::jsonb)
   ON CONFLICT ("key") DO NOTHING`,

  // ── Phase 3 Week 7-8 (P2-11): Postgres extensions. Migration 0044. ──────
  // pgvector for Sayuri-Vatanen embeddings, pg_trgm for Anaïs fuzzy search,
  // pg_stat_statements for the next index-audit pass.
  'CREATE EXTENSION IF NOT EXISTS vector',
  'CREATE EXTENSION IF NOT EXISTS pg_trgm',
  'CREATE EXTENSION IF NOT EXISTS pg_stat_statements',

  // ── Coriander §1 (Wave 3): Recovery-console audit trail. Migration 0039. ──
  // Append-only event log for high-risk admin recovery operations (2FA reset,
  // session revoke, ownership transfer, autopay freeze, password-reset link).
  // Distinct from the org-scoped audit_log table: audit_events is platform-
  // wide, founder-driven, and may have no owning organization. Retention: 7
  // years (legal). No deletes. Append-only.
  //
  // 2026-05-04 (Workstream §3.1): added to migrate.mjs to bring prod DB into
  // alignment with shared/schema.ts. Was sitting in migrations/0039_audit_events.sql
  // but never applied to prod, causing the index-audit CREATE INDEX below to
  // fail-non-fatal every deploy.
  `CREATE TABLE IF NOT EXISTS "audit_events" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "actor_user_id" text,
     "actor_email" text,
     "action" text NOT NULL,
     "target_type" text NOT NULL,
     "target_id" text NOT NULL,
     "justification" text,
     "metadata" jsonb,
     "ip" text,
     "user_agent" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_actor" ON "audit_events" ("actor_user_id")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_target" ON "audit_events" ("target_type", "target_id")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_action" ON "audit_events" ("action")',
  'CREATE INDEX IF NOT EXISTS "idx_audit_events_created_at" ON "audit_events" ("created_at" DESC)',

  // ── Phase 3 Week 7-8 (Wave 7): outbox + DLQ + job_runs. Migration 0046. ─
  // §3 Batch 1 (CANARY) — fixes worker hot-loop. The worker process polls
  // outbox every 5 seconds; without this table it logs `[worker] poll
  // cycle failed` ~12 times/min. After this batch lands the canary signal
  // is: those errors stop. If they don't, the migration didn't take and
  // we need to investigate before continuing the §3 sweep.
  `CREATE TABLE IF NOT EXISTS "outbox" (
     "id" serial PRIMARY KEY,
     "event_type" text NOT NULL,
     "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "status" text NOT NULL DEFAULT 'pending',
     "attempts" integer NOT NULL DEFAULT 0,
     "last_error_at" timestamp,
     "last_error_message" text,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "sent_at" timestamp
   )`,
  'CREATE INDEX IF NOT EXISTS "outbox_status_created_idx" ON "outbox" ("status", "created_at")',
  'CREATE INDEX IF NOT EXISTS "outbox_event_type_idx" ON "outbox" ("event_type")',
  `CREATE TABLE IF NOT EXISTS "outbox_dlq" (
     "id" serial PRIMARY KEY,
     "original_outbox_id" integer,
     "event_type" text NOT NULL,
     "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "status" text NOT NULL DEFAULT 'failed',
     "attempts" integer NOT NULL DEFAULT 0,
     "last_error_at" timestamp,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "failed_at" timestamp NOT NULL DEFAULT now(),
     "failure_reason" text NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS "outbox_dlq_event_type_idx" ON "outbox_dlq" ("event_type")',
  'CREATE INDEX IF NOT EXISTS "outbox_dlq_failed_at_idx" ON "outbox_dlq" ("failed_at" DESC)',
  `CREATE TABLE IF NOT EXISTS "job_runs" (
     "id" serial PRIMARY KEY,
     "job_name" text NOT NULL,
     "started_at" timestamp NOT NULL DEFAULT now(),
     "completed_at" timestamp,
     "status" text NOT NULL DEFAULT 'running',
     "error_message" text,
     "records_processed" integer
   )`,
  'CREATE INDEX IF NOT EXISTS "job_runs_job_name_started_idx" ON "job_runs" ("job_name", "started_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "job_runs_status_idx" ON "job_runs" ("status")',

  // ── §3 Batch 2 — compliance + audit tables ──────────────────────────────
  // Migrations 0049 (dsar_requests, data_processing_agreements),
  // 0053 (critical_alert_acks — support_saved_replies deferred to a later
  // batch as out-of-domain), 0057 (legal_holds), 0060 (ai_routing_overrides),
  // 0065 (compliance_validations, prompt_versions, ai_injection_attempts).
  //
  // Excluded from this batch: the audit_events lockdown triggers/view in
  // 0049 part 3. audit_events table already exists in prod (Batch 1 / §3.1);
  // the append-only enforcement is a separate compliance-posture decision
  // and is a behavioural change, not a missing-schema fix. Will be added in
  // a follow-on commit if/when the founder authorizes.
  //
  // FK prereqs (verified present in prod): organizations, users, notifications.
  // gen_random_uuid() requires PG ≥ 13 (we're on 16); no extension needed.

  // legal_holds — 0057
  `CREATE TABLE IF NOT EXISTS "legal_holds" (
     "id"               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id"  INTEGER NOT NULL REFERENCES organizations(id) ON DELETE RESTRICT,
     "case_ref"         TEXT NOT NULL,
     "scope"            TEXT NOT NULL,
     "scope_ids"        TEXT[] NOT NULL DEFAULT '{}'::TEXT[],
     "placed_at"        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "placed_by"        VARCHAR REFERENCES users(id) ON DELETE SET NULL,
     "released_at"      TIMESTAMPTZ,
     "release_reason"   TEXT,
     "notes"            TEXT,
     "status"           TEXT NOT NULL DEFAULT 'active',
     "created_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT legal_holds_scope_chk CHECK (scope IN ('org_wide','lead_specific','property_specific','user_specific')),
     CONSTRAINT legal_holds_status_chk CHECK (status IN ('active','released'))
   )`,
  `CREATE INDEX IF NOT EXISTS idx_legal_holds_org_active ON legal_holds (organization_id) WHERE status = 'active'`,
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_status ON legal_holds(status)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_placed_at ON legal_holds(placed_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_case_ref ON legal_holds(case_ref)',
  'CREATE INDEX IF NOT EXISTS idx_legal_holds_scope_ids ON legal_holds USING GIN (scope_ids)',

  // dsar_requests — 0049
  `CREATE TABLE IF NOT EXISTS "dsar_requests" (
     "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "request_type"    TEXT NOT NULL CHECK (request_type IN ('access','erasure','portability','rectification')),
     "email"           TEXT NOT NULL,
     "full_name"       TEXT NOT NULL,
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE SET NULL,
     "organization"    TEXT,
     "justification"   TEXT,
     "status"          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','verified','fulfilling','completed','denied')),
     "verification_token"   TEXT,
     "verified_at"     TIMESTAMPTZ,
     "completed_at"    TIMESTAMPTZ,
     "denied_reason"   TEXT,
     "ip"              TEXT,
     "user_agent"      TEXT,
     "metadata"        JSONB DEFAULT '{}'::jsonb,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_email ON dsar_requests(email)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_status ON dsar_requests(status)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_created_at ON dsar_requests(created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_dsar_requests_org ON dsar_requests(organization_id)',

  // data_processing_agreements — 0049 (incl. 8-row seed; ON CONFLICT idempotent)
  `CREATE TABLE IF NOT EXISTS "data_processing_agreements" (
     "id"              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "vendor_name"     TEXT NOT NULL UNIQUE,
     "status"          TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','negotiating','signed','expired')),
     "signed_date"     DATE,
     "expires_at"      DATE,
     "contact_email"   TEXT,
     "scope"           TEXT,
     "evidence_url"    TEXT,
     "notes"           TEXT,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_dpa_status ON data_processing_agreements(status)',
  `INSERT INTO data_processing_agreements (vendor_name, status, scope, contact_email) VALUES
     ('Stripe',    'pending', 'Billing PII, payment methods, invoices, tax identity', 'privacy@stripe.com'),
     ('Twilio',    'pending', 'Phone numbers, SMS bodies, voice-call recordings & transcripts', 'privacy@twilio.com'),
     ('SendGrid',  'pending', 'Email addresses, message bodies, delivery events', 'privacy@sendgrid.com'),
     ('Clerk',     'pending', 'Auth identities, sessions, MFA factors, email/phone', 'privacy@clerk.com'),
     ('Anthropic', 'pending', 'Prompt content (incl. lead/property text), Claude completions', 'privacy@anthropic.com'),
     ('OpenAI',    'pending', 'Prompt content for embeddings + completions', 'privacy@openai.com'),
     ('Lob',       'pending', 'Recipient mailing addresses, postcard imagery', 'privacy@lob.com'),
     ('AWS',       'pending', 'All at-rest customer data (S3, RDS, KMS-encrypted)', 'aws-privacy@amazon.com')
   ON CONFLICT (vendor_name) DO NOTHING`,

  // compliance_validations — 0065
  `CREATE TABLE IF NOT EXISTS "compliance_validations" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer,
     "surface" text NOT NULL,
     "domain" text NOT NULL,
     "input_hash" text NOT NULL,
     "verdict" text NOT NULL,
     "missing_phrases" jsonb,
     "prepended_disclosure" text,
     "validator_model" text NOT NULL,
     "thinking_budget" integer,
     "latency_ms" integer,
     "rationale" text,
     "metadata" jsonb,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "compliance_validations_verdict_check" CHECK ("verdict" IN ('pass', 'block', 'amend', 'error'))
   )`,
  'CREATE INDEX IF NOT EXISTS "compliance_validations_org_idx" ON "compliance_validations" ("organization_id", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "compliance_validations_surface_idx" ON "compliance_validations" ("surface", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "compliance_validations_verdict_idx" ON "compliance_validations" ("verdict", "created_at" DESC)',

  // prompt_versions — 0065
  `CREATE TABLE IF NOT EXISTS "prompt_versions" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "prompt_name" text NOT NULL,
     "version" text NOT NULL,
     "system" text NOT NULL,
     "tier" text NOT NULL DEFAULT 'standard',
     "hash" text NOT NULL,
     "weight" integer NOT NULL DEFAULT 0,
     "eval_score" numeric(5,4),
     "eval_run_at" timestamptz,
     "active" boolean NOT NULL DEFAULT true,
     "is_candidate" boolean NOT NULL DEFAULT false,
     "promoted_from" varchar,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "prompt_versions_tier_check" CHECK ("tier" IN ('critical', 'standard', 'background')),
     CONSTRAINT "prompt_versions_weight_check" CHECK ("weight" >= 0 AND "weight" <= 100)
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "prompt_versions_name_version_unique" ON "prompt_versions" ("prompt_name", "version")',
  `CREATE INDEX IF NOT EXISTS "prompt_versions_active_idx" ON "prompt_versions" ("prompt_name", "active") WHERE "active" = true`,

  // ai_injection_attempts — 0065
  `CREATE TABLE IF NOT EXISTS "ai_injection_attempts" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "user_id" text,
     "organization_id" integer,
     "surface" text NOT NULL,
     "matched_patterns" jsonb,
     "input_preview" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "ai_injection_attempts_user_idx" ON "ai_injection_attempts" ("user_id", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "ai_injection_attempts_org_idx" ON "ai_injection_attempts" ("organization_id", "created_at" DESC)',

  // ai_routing_overrides — 0060
  `CREATE TABLE IF NOT EXISTS "ai_routing_overrides" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "task_type" text NOT NULL,
     "original_tier" text NOT NULL,
     "override_tier" text NOT NULL,
     "override_model" text,
     "reason" text NOT NULL,
     "previous_eval_score" numeric(5,4),
     "new_eval_score" numeric(5,4),
     "active" boolean NOT NULL DEFAULT true,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "expires_at" timestamptz,
     CONSTRAINT "ai_routing_overrides_tier_check" CHECK ("override_tier" IN ('critical', 'standard', 'background')),
     CONSTRAINT "ai_routing_overrides_orig_tier_check" CHECK ("original_tier" IN ('critical', 'standard', 'background'))
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "ai_routing_overrides_active_unique" ON "ai_routing_overrides" ("task_type") WHERE "active" = true`,
  'CREATE INDEX IF NOT EXISTS "ai_routing_overrides_created_idx" ON "ai_routing_overrides" ("created_at" DESC)',

  // critical_alert_acks — 0053
  `CREATE TABLE IF NOT EXISTS "critical_alert_acks" (
     "id"              SERIAL PRIMARY KEY,
     "notification_id" INTEGER REFERENCES notifications(id) ON DELETE CASCADE,
     "severity"        TEXT NOT NULL CHECK (severity IN ('P0','P1')),
     "fired_at"        TIMESTAMPTZ NOT NULL,
     "ack_deadline_at" TIMESTAMPTZ NOT NULL,
     "acked_at"        TIMESTAMPTZ,
     "acked_by"        TEXT,
     "escalated_at"    TIMESTAMPTZ,
     "escalation_target" TEXT,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_unacked ON critical_alert_acks (ack_deadline_at) WHERE acked_at IS NULL AND escalated_at IS NULL`,
  'CREATE INDEX IF NOT EXISTS idx_critical_alert_acks_notification ON critical_alert_acks (notification_id)',

  // ── §3 Batch 3 — email/lifecycle/team (14 tables) ───────────────────────
  // Migrations 0053 (support_saved_replies), 0054 (org_co_owners),
  // 0056 (org_email_identities, email_warmup_state, unsubscribe_tokens,
  // email_reputation_snapshot), 0064 (email_templates, lifecycle_message_sends,
  // reactivation_tokens), 0066 (lead_assignment_rules, org_assignment_cursor,
  // org_integrations_slack, offer_approvals). cancellation_surveys derived
  // from shared/schema.ts (no canonical migration — pre-existing schema gap).
  //
  // FK prereqs verified present in prod (organizations, users, offers,
  // lead_assignment_rules added in this batch — order-dependent: rules
  // must come before assignment_cursor).
  //
  // Excluded:
  //   - 0054 parts 1+2 (UPDATE team_members.role, ALTER TABLE ADD COLUMN
  //     view_only_assigned_leads) — column ALTERs land in Batch 8.
  //   - 0056 part 4 (email_suppressions ADD COLUMN bounce_category etc.)
  //     — same reason; Batch 8.
  //   - 0066 Part A (organizations seat_count + requires_approval_offers_over)
  //     — same reason; Batch 8.

  // support_saved_replies — 0053 part 1 (folded in from Batch 2 deferral)
  `CREATE TABLE IF NOT EXISTS "support_saved_replies" (
     "id"              SERIAL PRIMARY KEY,
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
     "name"            TEXT NOT NULL,
     "body"            TEXT NOT NULL,
     "created_by"      TEXT NOT NULL,
     "created_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"      TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  `CREATE INDEX IF NOT EXISTS idx_support_saved_replies_org ON support_saved_replies (organization_id) WHERE organization_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_support_saved_replies_global ON support_saved_replies (created_at DESC) WHERE organization_id IS NULL`,

  // org_co_owners — 0054 part 3
  `CREATE TABLE IF NOT EXISTS "org_co_owners" (
     "id"              SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id"         TEXT NOT NULL,
     "added_at"        TIMESTAMP NOT NULL DEFAULT NOW(),
     "added_by"        TEXT NOT NULL
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS idx_org_co_owners_org_user ON org_co_owners (organization_id, user_id)',
  'CREATE INDEX IF NOT EXISTS idx_org_co_owners_org ON org_co_owners (organization_id)',

  // org_email_identities — 0056 part 1
  `CREATE TABLE IF NOT EXISTS "org_email_identities" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "from_address" text NOT NULL,
     "dkim_domain" text NOT NULL,
     "dkim_selector" text NOT NULL DEFAULT 'acreos1',
     "dkim_public_key" text NOT NULL,
     "dkim_private_key_encrypted" text NOT NULL,
     "spf_record" text NOT NULL,
     "dmarc_record" text NOT NULL,
     "status" text NOT NULL DEFAULT 'provisioning',
     "sendgrid_domain_id" text,
     "verification_error" text,
     "verified_at" timestamptz,
     "created_at" timestamptz DEFAULT now() NOT NULL,
     "updated_at" timestamptz DEFAULT now() NOT NULL
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "idx_org_email_identities_org_domain" ON "org_email_identities" ("organization_id", "dkim_domain")',
  'CREATE INDEX IF NOT EXISTS "idx_org_email_identities_status" ON "org_email_identities" ("status")',

  // email_warmup_state — 0056 part 2
  `CREATE TABLE IF NOT EXISTS "email_warmup_state" (
     "organization_id" integer PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
     "first_send_at" timestamptz,
     "days_since_first_send" integer NOT NULL DEFAULT 0,
     "daily_send_limit" integer NOT NULL DEFAULT 50,
     "current_day_used" integer NOT NULL DEFAULT 0,
     "current_day_reset_at" timestamptz NOT NULL DEFAULT now(),
     "warmup_complete" boolean NOT NULL DEFAULT false,
     "updated_at" timestamptz DEFAULT now() NOT NULL
   )`,

  // unsubscribe_tokens — 0056 part 3
  `CREATE TABLE IF NOT EXISTS "unsubscribe_tokens" (
     "token" text PRIMARY KEY,
     "email" text NOT NULL,
     "organization_id" integer REFERENCES organizations(id) ON DELETE CASCADE,
     "created_at" timestamptz DEFAULT now() NOT NULL,
     "used_at" timestamptz
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_unsubscribe_tokens_email" ON "unsubscribe_tokens" ("email")',

  // email_reputation_snapshot — 0056 part 5
  `CREATE TABLE IF NOT EXISTS "email_reputation_snapshot" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "window_days" integer NOT NULL DEFAULT 30,
     "sent_count" integer NOT NULL DEFAULT 0,
     "bounce_count" integer NOT NULL DEFAULT 0,
     "complaint_count" integer NOT NULL DEFAULT 0,
     "bounce_rate" numeric(5, 4) NOT NULL DEFAULT 0,
     "complaint_rate" numeric(5, 4) NOT NULL DEFAULT 0,
     "deliverability_score" integer NOT NULL DEFAULT 100,
     "health_status" text NOT NULL DEFAULT 'healthy',
     "computed_at" timestamptz DEFAULT now() NOT NULL
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_email_reputation_org_computed" ON "email_reputation_snapshot" ("organization_id", "computed_at" DESC)',

  // email_templates — 0064 part 1
  `CREATE TABLE IF NOT EXISTS "email_templates" (
     "id" serial PRIMARY KEY,
     "key" text NOT NULL,
     "version" integer NOT NULL DEFAULT 1,
     "channel" text NOT NULL DEFAULT 'email',
     "subject" text,
     "body" text NOT NULL,
     "category" text NOT NULL DEFAULT 'lifecycle.general',
     "active" boolean NOT NULL DEFAULT true,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "updated_at" timestamp NOT NULL DEFAULT now(),
     CONSTRAINT "email_templates_key_version_uq" UNIQUE ("key", "version")
   )`,
  'CREATE INDEX IF NOT EXISTS "email_templates_key_active_idx" ON "email_templates" ("key", "active")',
  'CREATE INDEX IF NOT EXISTS "email_templates_category_idx" ON "email_templates" ("category")',

  // lifecycle_message_sends — 0064 part 2
  `CREATE TABLE IF NOT EXISTS "lifecycle_message_sends" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL,
     "user_id" varchar,
     "template_key" text NOT NULL,
     "template_version" integer,
     "channel" text NOT NULL DEFAULT 'email',
     "recipient_email" text,
     "recipient_phone" text,
     "category" text NOT NULL DEFAULT 'lifecycle.general',
     "status" text NOT NULL DEFAULT 'queued',
     "outbox_id" integer,
     "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "sent_at" timestamp NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_org_template_idx" ON "lifecycle_message_sends" ("organization_id", "template_key", "sent_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_org_category_idx" ON "lifecycle_message_sends" ("organization_id", "category", "sent_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "lifecycle_message_sends_recipient_idx" ON "lifecycle_message_sends" ("recipient_email")',

  // reactivation_tokens — 0064 part 3
  `CREATE TABLE IF NOT EXISTS "reactivation_tokens" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL,
     "token_hash" text NOT NULL UNIQUE,
     "issued_at" timestamp NOT NULL DEFAULT now(),
     "expires_at" timestamp NOT NULL,
     "redeemed_at" timestamp,
     "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb
   )`,
  'CREATE INDEX IF NOT EXISTS "reactivation_tokens_org_idx" ON "reactivation_tokens" ("organization_id")',
  'CREATE INDEX IF NOT EXISTS "reactivation_tokens_expires_idx" ON "reactivation_tokens" ("expires_at")',

  // lead_assignment_rules — 0066 Part B (must precede org_assignment_cursor)
  `CREATE TABLE IF NOT EXISTS "lead_assignment_rules" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "name" TEXT NOT NULL,
     "rule_type" TEXT NOT NULL,
     "priority" INTEGER NOT NULL DEFAULT 100,
     "territory_filter" JSONB,
     "weighted_assignees" JSONB,
     "is_default" BOOLEAN NOT NULL DEFAULT false,
     "is_active" BOOLEAN NOT NULL DEFAULT true,
     "created_at" TIMESTAMP DEFAULT now(),
     "updated_at" TIMESTAMP DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS lead_assignment_rules_org_idx ON lead_assignment_rules(organization_id, is_active, priority)',

  // org_assignment_cursor — 0066 Part B (FK→lead_assignment_rules)
  `CREATE TABLE IF NOT EXISTS "org_assignment_cursor" (
     "rule_id" INTEGER PRIMARY KEY REFERENCES lead_assignment_rules(id) ON DELETE CASCADE,
     "cursor_index" INTEGER NOT NULL DEFAULT 0,
     "last_assigned_to" INTEGER,
     "updated_at" TIMESTAMP DEFAULT now()
   )`,

  // org_integrations_slack — 0066 Part D
  `CREATE TABLE IF NOT EXISTS "org_integrations_slack" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "provider" TEXT NOT NULL DEFAULT 'slack',
     "webhook_url" TEXT NOT NULL,
     "channel_name" TEXT,
     "event_types" TEXT[] NOT NULL DEFAULT ARRAY['deal_closed','big_lead_arrived']::TEXT[],
     "is_active" BOOLEAN NOT NULL DEFAULT true,
     "last_dispatched_at" TIMESTAMP,
     "last_error" TEXT,
     "created_at" TIMESTAMP DEFAULT now(),
     "updated_at" TIMESTAMP DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS org_integrations_slack_org_provider_idx ON org_integrations_slack(organization_id, provider)',

  // offer_approvals — 0066 Part E (FK→offers, present in prod)
  `CREATE TABLE IF NOT EXISTS "offer_approvals" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "offer_id" INTEGER NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
     "submitted_by" TEXT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'pending',
     "reviewer_id" TEXT,
     "reviewer_notes" TEXT,
     "threshold_amount" NUMERIC NOT NULL,
     "offer_amount" NUMERIC NOT NULL,
     "created_at" TIMESTAMP DEFAULT now(),
     "decided_at" TIMESTAMP
   )`,
  'CREATE INDEX IF NOT EXISTS offer_approvals_org_status_idx ON offer_approvals(organization_id, status, created_at)',

  // cancellation_surveys — derived from shared/schema.ts (no canonical migration)
  `CREATE TABLE IF NOT EXISTS "cancellation_surveys" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id),
     "user_id" TEXT,
     "reason" TEXT NOT NULL,
     "feedback" TEXT,
     "previous_tier" TEXT,
     "offered_downgrade" BOOLEAN DEFAULT false,
     "accepted_downgrade" BOOLEAN DEFAULT false,
     "created_at" TIMESTAMP DEFAULT now()
   )`,

  // ── §3 Batch 4 — finance + economics + recognition (10 tables) ──────────
  // Migrations 0042 (chart_of_accounts, account_ledger_entries),
  // 0047 (ai_usage_daily), 0048 (customer_concentration, deferred_revenue),
  // 0059 (recognition_schedules, recognition_runs, form_1099_batches),
  // 0062 (cost_optimization_runs), 0063 (customer_unit_economics).
  //
  // Order: chart_of_accounts first (self-referencing FK + base for ledger).
  //
  // Excluded: 0047 ALTER organizations ADD org_ai_quota_daily_usd, 0048
  // ALTER dunning_events ADD sms_sent_at — column ALTERs deferred to B8.

  // chart_of_accounts — 0042 (self-FK on parent_account_id, idempotent in same statement)
  `CREATE TABLE IF NOT EXISTS "chart_of_accounts" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "account_number" text NOT NULL,
     "account_name" text NOT NULL,
     "account_type" text NOT NULL,
     "parent_account_id" uuid REFERENCES chart_of_accounts(id) ON DELETE SET NULL,
     "is_active" boolean NOT NULL DEFAULT true,
     "description" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "chart_of_accounts_org_number_unique" ON "chart_of_accounts" ("organization_id", "account_number")',
  'CREATE INDEX IF NOT EXISTS "chart_of_accounts_org_type_idx" ON "chart_of_accounts" ("organization_id", "account_type")',

  // account_ledger_entries — 0042 (FK→chart_of_accounts)
  `CREATE TABLE IF NOT EXISTS "account_ledger_entries" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "account_id" uuid NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
     "debit" bigint NOT NULL DEFAULT 0,
     "credit" bigint NOT NULL DEFAULT 0,
     "description" text,
     "reference_type" text,
     "reference_id" text,
     "booking_date" date NOT NULL,
     "posted_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "account_ledger_entries_debit_xor_credit"
       CHECK (("debit" > 0 AND "credit" = 0) OR ("debit" = 0 AND "credit" > 0)),
     CONSTRAINT "account_ledger_entries_non_negative" CHECK ("debit" >= 0 AND "credit" >= 0)
   )`,
  'CREATE INDEX IF NOT EXISTS "account_ledger_entries_org_booking_idx" ON "account_ledger_entries" ("organization_id", "booking_date" DESC)',
  'CREATE INDEX IF NOT EXISTS "account_ledger_entries_account_booking_idx" ON "account_ledger_entries" ("account_id", "booking_date" DESC)',
  'CREATE INDEX IF NOT EXISTS "account_ledger_entries_reference_idx" ON "account_ledger_entries" ("reference_type", "reference_id")',

  // ai_usage_daily — 0047
  `CREATE TABLE IF NOT EXISTS "ai_usage_daily" (
     "id"              serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "date"            date NOT NULL,
     "total_usd"       numeric(12, 6) NOT NULL DEFAULT 0,
     "call_count"      integer NOT NULL DEFAULT 0,
     "by_feature"      jsonb DEFAULT '{}'::jsonb,
     "updated_at"      timestamp DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "ai_usage_daily_org_date_uniq" ON "ai_usage_daily" ("organization_id", "date")',
  'CREATE INDEX IF NOT EXISTS "ai_usage_daily_date_idx" ON "ai_usage_daily" ("date")',

  // customer_concentration — 0048
  `CREATE TABLE IF NOT EXISTS "customer_concentration" (
     "id"                    SERIAL PRIMARY KEY,
     "computed_at"           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "top_mrr_pct_single"    NUMERIC(5,2) NOT NULL DEFAULT 0,
     "top_mrr_pct_top3"      NUMERIC(5,2) NOT NULL DEFAULT 0,
     "total_mrr_cents"       BIGINT NOT NULL DEFAULT 0,
     "active_org_count"      INTEGER NOT NULL DEFAULT 0,
     "snapshot"              JSONB NOT NULL DEFAULT '{}'::jsonb,
     "alert_triggered"       BOOLEAN NOT NULL DEFAULT FALSE,
     "alert_severity"        TEXT,
     "created_at"            TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_customer_concentration_computed_at" ON "customer_concentration" ("computed_at" DESC)',
  `CREATE INDEX IF NOT EXISTS "idx_customer_concentration_alert" ON "customer_concentration" ("alert_triggered", "computed_at" DESC) WHERE "alert_triggered" = TRUE`,

  // deferred_revenue — 0048
  `CREATE TABLE IF NOT EXISTS "deferred_revenue" (
     "id"                  SERIAL PRIMARY KEY,
     "organization_id"     INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "subscription_id"     TEXT,
     "invoice_id"          TEXT,
     "period_start"        TIMESTAMPTZ NOT NULL,
     "period_end"          TIMESTAMPTZ NOT NULL,
     "amount_cents"        BIGINT NOT NULL,
     "recognized_cents"    BIGINT NOT NULL DEFAULT 0,
     "as_of_date"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "currency"            TEXT NOT NULL DEFAULT 'usd',
     "metadata"            JSONB NOT NULL DEFAULT '{}'::jsonb,
     "created_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "updated_at"          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT "deferred_revenue_period_chk" CHECK ("period_end" >= "period_start"),
     CONSTRAINT "deferred_revenue_recognized_chk" CHECK ("recognized_cents" >= 0 AND "recognized_cents" <= "amount_cents")
   )`,
  'CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_org" ON "deferred_revenue" ("organization_id", "period_start" DESC)',
  `CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_subscription" ON "deferred_revenue" ("subscription_id") WHERE "subscription_id" IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "idx_deferred_revenue_unrecognized" ON "deferred_revenue" ("period_end") WHERE "recognized_cents" < "amount_cents"`,

  // customer_unit_economics — 0063
  `CREATE TABLE IF NOT EXISTS "customer_unit_economics" (
     "id"                          SERIAL PRIMARY KEY,
     "organization_id"             INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "computed_at"                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "computed_date"               DATE        NOT NULL DEFAULT CURRENT_DATE,
     "window_days"                 INTEGER     NOT NULL DEFAULT 30,
     "mrr_usd"                     NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "ai_cost_usd"                 NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "direct_mail_cost_usd"        NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "sms_cost_usd"                NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "email_cost_usd"              NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "skip_trace_cost_usd"         NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "fixed_cost_share_usd"        NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "total_cogs_usd"              NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "profit_margin_usd"           NUMERIC(12, 6) NOT NULL DEFAULT 0,
     "profit_margin_pct"           NUMERIC(7,  2) NOT NULL DEFAULT 0,
     "ai_call_count"               INTEGER NOT NULL DEFAULT 0,
     "sms_count"                   INTEGER NOT NULL DEFAULT 0,
     "email_count"                 INTEGER NOT NULL DEFAULT 0,
     "direct_mail_pieces"          INTEGER NOT NULL DEFAULT 0,
     "skip_trace_count"            INTEGER NOT NULL DEFAULT 0,
     "breakdown"                   JSONB NOT NULL DEFAULT '{}'::jsonb,
     "consecutive_unprofitable_days" INTEGER NOT NULL DEFAULT 0,
     CONSTRAINT customer_unit_economics_window_positive CHECK (window_days > 0),
     CONSTRAINT customer_unit_economics_costs_non_negative CHECK (
       ai_cost_usd >= 0 AND direct_mail_cost_usd >= 0 AND sms_cost_usd >= 0
       AND email_cost_usd >= 0 AND skip_trace_cost_usd >= 0
       AND fixed_cost_share_usd >= 0
     )
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS customer_unit_economics_org_date_uniq ON customer_unit_economics (organization_id, computed_date)',
  'CREATE INDEX IF NOT EXISTS customer_unit_economics_org_computed_idx ON customer_unit_economics (organization_id, computed_at DESC)',
  'CREATE INDEX IF NOT EXISTS customer_unit_economics_computed_date_idx ON customer_unit_economics (computed_date DESC)',
  'CREATE INDEX IF NOT EXISTS customer_unit_economics_margin_idx ON customer_unit_economics (profit_margin_usd ASC)',

  // cost_optimization_runs — 0062
  `CREATE TABLE IF NOT EXISTS "cost_optimization_runs" (
     "id" SERIAL PRIMARY KEY,
     "run_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
     "total_ai_cost_usd" NUMERIC(12, 4) NOT NULL DEFAULT 0,
     "total_fly_cost_usd" NUMERIC(12, 4) NOT NULL DEFAULT 0,
     "customer_count" INTEGER NOT NULL DEFAULT 0,
     "mrr_usd" NUMERIC(12, 2) NOT NULL DEFAULT 0,
     "profit_margin_pct" NUMERIC(6, 2) NOT NULL DEFAULT 0,
     "recommendations" JSONB NOT NULL DEFAULT '[]'::jsonb,
     "auto_applied_actions" JSONB NOT NULL DEFAULT '[]'::jsonb,
     "summary" TEXT NOT NULL DEFAULT ''
   )`,
  'CREATE INDEX IF NOT EXISTS "cost_optimization_runs_run_at_idx" ON "cost_optimization_runs" ("run_at" DESC)',

  // recognition_schedules — 0059
  `CREATE TABLE IF NOT EXISTS "recognition_schedules" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "source_type" text NOT NULL,
     "source_id" text NOT NULL,
     "total_cents" bigint NOT NULL,
     "balance_remaining_cents" bigint NOT NULL,
     "period_start" date NOT NULL,
     "period_end" date NOT NULL,
     "months_total" integer NOT NULL,
     "months_recognised" integer NOT NULL DEFAULT 0,
     "status" text NOT NULL DEFAULT 'active',
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now(),
     CONSTRAINT "recognition_schedules_balance_non_negative" CHECK ("balance_remaining_cents" >= 0),
     CONSTRAINT "recognition_schedules_months_valid"
       CHECK ("months_total" > 0 AND "months_recognised" >= 0 AND "months_recognised" <= "months_total")
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "recognition_schedules_source_unique" ON "recognition_schedules" ("organization_id", "source_type", "source_id")',
  `CREATE INDEX IF NOT EXISTS "recognition_schedules_active_idx" ON "recognition_schedules" ("organization_id", "status") WHERE "status" = 'active'`,

  // recognition_runs — 0059
  `CREATE TABLE IF NOT EXISTS "recognition_runs" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer REFERENCES organizations(id) ON DELETE CASCADE,
     "run_started_at" timestamptz NOT NULL DEFAULT now(),
     "run_completed_at" timestamptz,
     "as_of_date" date NOT NULL,
     "schedules_processed" integer NOT NULL DEFAULT 0,
     "entries_posted" integer NOT NULL DEFAULT 0,
     "cents_recognised" bigint NOT NULL DEFAULT 0,
     "status" text NOT NULL DEFAULT 'running',
     "error_message" text
   )`,
  'CREATE INDEX IF NOT EXISTS "recognition_runs_org_started_idx" ON "recognition_runs" ("organization_id", "run_started_at" DESC)',

  // form_1099_batches — 0059
  `CREATE TABLE IF NOT EXISTS "form_1099_batches" (
     "id" varchar PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "tax_year" integer NOT NULL,
     "status" text NOT NULL DEFAULT 'queued',
     "form_count" integer NOT NULL DEFAULT 0,
     "total_interest_cents" bigint NOT NULL DEFAULT 0,
     "result_blob" jsonb,
     "error_message" text,
     "started_at" timestamptz,
     "completed_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "form_1099_batches_org_year_idx" ON "form_1099_batches" ("organization_id", "tax_year")',

  // ── §3 Batch 5 — SCP memory + activation/retention + observability ──────
  // 0022 (5 SCP tables — semantic_facts, procedures, golden_cases,
  // shared_memory, evolution_metrics), 0055 (activation_events,
  // retention_events, cohort_assignments, churn_reasons), 0061 (vm_resource_usage).
  // No inter-batch FKs; all org_id refs use INTEGER (no FK constraint in source).

  // scp_semantic_facts — 0022
  `CREATE TABLE IF NOT EXISTS "scp_semantic_facts" (
     "id" SERIAL PRIMARY KEY,
     "fact_id" TEXT NOT NULL UNIQUE,
     "agent_codename" TEXT NOT NULL,
     "subject" TEXT NOT NULL,
     "predicate" TEXT NOT NULL,
     "object" TEXT NOT NULL,
     "natural_language" TEXT NOT NULL,
     "source_episode_ids" JSONB NOT NULL DEFAULT '[]',
     "confidence" INTEGER NOT NULL DEFAULT 50,
     "valid_from" TIMESTAMP NOT NULL DEFAULT NOW(),
     "valid_until" TIMESTAMP,
     "version" INTEGER NOT NULL DEFAULT 1,
     "previous_version_id" TEXT,
     "category" TEXT NOT NULL DEFAULT 'domain_knowledge',
     "tags" JSONB NOT NULL DEFAULT '[]',
     "org_id" INTEGER,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS ssf_agent_idx ON scp_semantic_facts(agent_codename)',
  'CREATE INDEX IF NOT EXISTS ssf_subject_idx ON scp_semantic_facts(subject)',
  'CREATE INDEX IF NOT EXISTS ssf_category_idx ON scp_semantic_facts(category)',
  'CREATE INDEX IF NOT EXISTS ssf_confidence_idx ON scp_semantic_facts(confidence)',
  'CREATE INDEX IF NOT EXISTS ssf_valid_idx ON scp_semantic_facts(valid_until)',

  // scp_procedures — 0022
  `CREATE TABLE IF NOT EXISTS "scp_procedures" (
     "id" SERIAL PRIMARY KEY,
     "procedure_id" TEXT NOT NULL UNIQUE,
     "agent_codename" TEXT NOT NULL,
     "name" TEXT NOT NULL,
     "description" TEXT NOT NULL,
     "trigger" TEXT NOT NULL,
     "steps" JSONB NOT NULL DEFAULT '[]',
     "preconditions" JSONB NOT NULL DEFAULT '[]',
     "postconditions" JSONB NOT NULL DEFAULT '[]',
     "parameters" JSONB NOT NULL DEFAULT '{}',
     "source_episode_ids" JSONB NOT NULL DEFAULT '[]',
     "success_count" INTEGER NOT NULL DEFAULT 0,
     "failure_count" INTEGER NOT NULL DEFAULT 0,
     "last_used_at" TIMESTAMP,
     "confidence" INTEGER NOT NULL DEFAULT 50,
     "version" INTEGER NOT NULL DEFAULT 1,
     "org_id" INTEGER,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS sp_agent_idx ON scp_procedures(agent_codename)',
  'CREATE INDEX IF NOT EXISTS sp_name_idx ON scp_procedures(name)',
  'CREATE INDEX IF NOT EXISTS sp_confidence_idx ON scp_procedures(confidence)',

  // scp_golden_cases — 0022
  `CREATE TABLE IF NOT EXISTS "scp_golden_cases" (
     "id" SERIAL PRIMARY KEY,
     "case_id" TEXT NOT NULL UNIQUE,
     "agent_codename" TEXT NOT NULL,
     "description" TEXT NOT NULL,
     "lesson" TEXT NOT NULL,
     "session_id" TEXT NOT NULL,
     "context" JSONB NOT NULL DEFAULT '{}',
     "org_id" INTEGER,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS sgc_agent_idx ON scp_golden_cases(agent_codename)',
  'CREATE INDEX IF NOT EXISTS sgc_session_idx ON scp_golden_cases(session_id)',

  // scp_shared_memory — 0022
  `CREATE TABLE IF NOT EXISTS "scp_shared_memory" (
     "id" SERIAL PRIMARY KEY,
     "memory_id" TEXT NOT NULL UNIQUE,
     "written_by_agent" TEXT NOT NULL,
     "category" TEXT NOT NULL,
     "subject" TEXT NOT NULL,
     "content" TEXT NOT NULL,
     "confidence" INTEGER NOT NULL DEFAULT 70,
     "validated_at" TIMESTAMP,
     "validation_gates_passed" JSONB NOT NULL DEFAULT '[]',
     "read_by_agents" JSONB NOT NULL DEFAULT '[]',
     "org_id" INTEGER,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS ssm_agent_idx ON scp_shared_memory(written_by_agent)',
  'CREATE INDEX IF NOT EXISTS ssm_category_idx ON scp_shared_memory(category)',

  // scp_evolution_metrics — 0022
  `CREATE TABLE IF NOT EXISTS "scp_evolution_metrics" (
     "id" SERIAL PRIMARY KEY,
     "agent_codename" TEXT NOT NULL,
     "total_sessions" INTEGER NOT NULL DEFAULT 0,
     "success_rate" INTEGER NOT NULL DEFAULT 0,
     "correction_rate" INTEGER NOT NULL DEFAULT 0,
     "override_rate" INTEGER NOT NULL DEFAULT 0,
     "escalation_accuracy" INTEGER NOT NULL DEFAULT 0,
     "golden_suite_size" INTEGER NOT NULL DEFAULT 0,
     "current_version" INTEGER NOT NULL DEFAULT 1,
     "evolution_cadence" TEXT NOT NULL DEFAULT 'aggressive',
     "last_evolved_at" TIMESTAMP,
     "last_rollback_at" TIMESTAMP,
     "rollback_count" INTEGER NOT NULL DEFAULT 0,
     "org_id" INTEGER,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS sem_agent_idx ON scp_evolution_metrics(agent_codename)',

  // activation_events — 0055
  `CREATE TABLE IF NOT EXISTS "activation_events" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" TEXT,
     "event_name" TEXT NOT NULL,
     "event_value" JSONB DEFAULT '{}'::jsonb,
     "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT activation_events_org_event_unique UNIQUE (organization_id, event_name)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_activation_events_org ON activation_events(organization_id)',
  'CREATE INDEX IF NOT EXISTS idx_activation_events_event ON activation_events(event_name)',
  'CREATE INDEX IF NOT EXISTS idx_activation_events_occurred_at ON activation_events(occurred_at DESC)',

  // retention_events — 0055
  `CREATE TABLE IF NOT EXISTS "retention_events" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" TEXT,
     "event_type" TEXT NOT NULL,
     "cohort_name" TEXT,
     "metadata" JSONB DEFAULT '{}'::jsonb,
     "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_retention_events_org ON retention_events(organization_id)',
  'CREATE INDEX IF NOT EXISTS idx_retention_events_type ON retention_events(event_type)',
  'CREATE INDEX IF NOT EXISTS idx_retention_events_cohort ON retention_events(cohort_name)',
  'CREATE INDEX IF NOT EXISTS idx_retention_events_occurred_at ON retention_events(occurred_at DESC)',

  // cohort_assignments — 0055
  `CREATE TABLE IF NOT EXISTS "cohort_assignments" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" TEXT,
     "cohort_name" TEXT NOT NULL,
     "variant" TEXT NOT NULL DEFAULT 'control',
     "attributes" JSONB DEFAULT '{}'::jsonb,
     "assigned_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT cohort_assignments_org_cohort_unique UNIQUE (organization_id, cohort_name)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_cohort_assignments_org ON cohort_assignments(organization_id)',
  'CREATE INDEX IF NOT EXISTS idx_cohort_assignments_user ON cohort_assignments(user_id)',
  'CREATE INDEX IF NOT EXISTS idx_cohort_assignments_name ON cohort_assignments(cohort_name)',
  'CREATE INDEX IF NOT EXISTS idx_cohort_assignments_variant ON cohort_assignments(cohort_name, variant)',

  // churn_reasons — 0055
  `CREATE TABLE IF NOT EXISTS "churn_reasons" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" TEXT,
     "churned_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     "primary_reason" TEXT NOT NULL,
     "free_text" TEXT,
     "survey_response" JSONB DEFAULT '{}'::jsonb,
     "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_churn_reasons_org ON churn_reasons(organization_id)',
  'CREATE INDEX IF NOT EXISTS idx_churn_reasons_primary ON churn_reasons(primary_reason)',
  'CREATE INDEX IF NOT EXISTS idx_churn_reasons_churned_at ON churn_reasons(churned_at DESC)',

  // vm_resource_usage — 0061
  `CREATE TABLE IF NOT EXISTS "vm_resource_usage" (
     "id"                   bigserial PRIMARY KEY,
     "machine_id"           text        NOT NULL,
     "region"               text,
     "process_group"        text,
     "captured_at"          timestamptz NOT NULL DEFAULT now(),
     "rss_bytes"            bigint      NOT NULL,
     "heap_used_bytes"      bigint      NOT NULL,
     "heap_total_bytes"     bigint      NOT NULL,
     "external_bytes"       bigint      NOT NULL,
     "array_buffers_bytes"  bigint      NOT NULL,
     "cpu_user_us"          bigint      NOT NULL,
     "cpu_system_us"        bigint      NOT NULL,
     "cpu_percent"          numeric(5,2) NOT NULL,
     "cpu_count"            integer     NOT NULL,
     "load_avg_1m"          numeric(6,2),
     "event_loop_lag_ms"    numeric(8,2),
     "total_memory_bytes"   bigint,
     "uptime_seconds"       integer     NOT NULL,
     "node_version"         text,
     "app_version"          text
   )`,
  'CREATE INDEX IF NOT EXISTS "vm_resource_usage_machine_time_idx" ON "vm_resource_usage" ("machine_id", "captured_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "vm_resource_usage_time_idx" ON "vm_resource_usage" ("captured_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "vm_resource_usage_process_group_idx" ON "vm_resource_usage" ("process_group", "captured_at" DESC)',

  // ── §3 Batch 6 — features (10 tables) ───────────────────────────────────
  // 0058 (ml_training_snapshots), 0067 (property_vision_snapshots), 0068
  // (title_partners, title_orders), 0069 (import_jobs, export_jobs),
  // 0070 (etl_jobs, etl_runs), 0073 (acquired_notes, note_payments).
  //
  // Order: title_partners before title_orders, etl_jobs before etl_runs,
  // acquired_notes before note_payments (FK chains).
  // FK targets verified present: organizations, properties, deals,
  // system_alerts, leads.
  // Excluded: 0070 etl_jobs INSERT seed (orchestrator credentials are
  // operator-set; seeding stub rows when the worker hasn't been wired up
  // adds noise to the founder /etl UI). Excluded: 0073 part A
  // (organizations.investor_type ALTER) — column → B8.

  // ml_training_snapshots — 0058
  `CREATE TABLE IF NOT EXISTS "ml_training_snapshots" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "snapshot_type" TEXT NOT NULL,
     "subject_type" TEXT NOT NULL,
     "subject_id" TEXT NOT NULL,
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
     "labels" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "features" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "decision_at" TIMESTAMPTZ NOT NULL,
     "outcome_at" TIMESTAMPTZ,
     "metadata" JSONB NOT NULL DEFAULT '{}'::jsonb,
     "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
     CONSTRAINT ml_training_snapshots_unique UNIQUE (snapshot_type, subject_type, subject_id, decision_at)
   )`,
  'CREATE INDEX IF NOT EXISTS idx_ml_snapshots_type_org_created ON ml_training_snapshots (snapshot_type, organization_id, created_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_ml_snapshots_type_decision ON ml_training_snapshots (snapshot_type, decision_at DESC)',
  'CREATE INDEX IF NOT EXISTS idx_ml_snapshots_subject ON ml_training_snapshots (subject_type, subject_id)',
  `CREATE INDEX IF NOT EXISTS idx_ml_snapshots_outcome_at ON ml_training_snapshots (outcome_at) WHERE outcome_at IS NOT NULL`,

  // property_vision_snapshots — 0067 (FK→system_alerts, properties, organizations)
  `CREATE TABLE IF NOT EXISTS "property_vision_snapshots" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "property_id" INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
     "captured_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "image_s3_key" TEXT NOT NULL,
     "image_url" TEXT,
     "provider" TEXT,
     "resolution" NUMERIC,
     "analysis_jsonb" JSONB,
     "prior_snapshot_id" INTEGER,
     "change_detection_score" NUMERIC,
     "change_summary" TEXT,
     "alerted_to_org" BOOLEAN NOT NULL DEFAULT FALSE,
     "system_alert_id" INTEGER REFERENCES system_alerts(id) ON DELETE SET NULL,
     "created_at" TIMESTAMP DEFAULT NOW(),
     "updated_at" TIMESTAMP DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS property_vision_snapshots_org_idx ON property_vision_snapshots(organization_id)',
  'CREATE INDEX IF NOT EXISTS property_vision_snapshots_property_idx ON property_vision_snapshots(property_id)',
  'CREATE INDEX IF NOT EXISTS property_vision_snapshots_captured_idx ON property_vision_snapshots(captured_at)',

  // title_partners — 0068 (must precede title_orders)
  `CREATE TABLE IF NOT EXISTS "title_partners" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER REFERENCES organizations(id) ON DELETE CASCADE,
     "partner_name" TEXT NOT NULL,
     "contact_email" TEXT NOT NULL,
     "contact_phone" TEXT NOT NULL,
     "territory_states" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
     "territory_counties" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
     "api_key_hash" TEXT NOT NULL,
     "hmac_secret_encrypted" TEXT NOT NULL,
     "webhook_url" TEXT NOT NULL,
     "volume_pricing_tier" TEXT NOT NULL DEFAULT 'pilot',
     "is_active" BOOLEAN NOT NULL DEFAULT true,
     "created_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS title_partners_active_idx ON title_partners(is_active, volume_pricing_tier)',
  `CREATE INDEX IF NOT EXISTS title_partners_org_idx ON title_partners(organization_id) WHERE organization_id IS NOT NULL`,

  // title_orders — 0068 (FK→title_partners, deals, organizations)
  `CREATE TABLE IF NOT EXISTS "title_orders" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "deal_id" INTEGER NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
     "title_partner_id" INTEGER REFERENCES title_partners(id) ON DELETE SET NULL,
     "status" TEXT NOT NULL DEFAULT 'pending',
     "status_details" JSONB NOT NULL DEFAULT '{}'::JSONB,
     "property_address" JSONB NOT NULL,
     "buyer_info" JSONB NOT NULL,
     "seller_info" JSONB NOT NULL,
     "sale_price" NUMERIC NOT NULL,
     "expected_closing_date" DATE NOT NULL,
     "estimated_delivery_date" DATE,
     "commitment_s3_key" TEXT,
     "schedule_b_s3_key" TEXT,
     "policy_s3_key" TEXT,
     "wire_instructions_pdf_s3_key" TEXT,
     "wire_instructions_password_hint" TEXT,
     "wire_instructions_hmac" TEXT,
     "wire_instructions_issued_at" TIMESTAMP,
     "wire_confirmation_phone" TEXT,
     "wire_confirmed_at" TIMESTAMP,
     "partner_assigned_at" TIMESTAMP,
     "created_at" TIMESTAMP NOT NULL DEFAULT now(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS title_orders_org_status_idx ON title_orders(organization_id, status, created_at DESC)',
  `CREATE INDEX IF NOT EXISTS title_orders_partner_idx ON title_orders(title_partner_id, status) WHERE title_partner_id IS NOT NULL`,
  'CREATE INDEX IF NOT EXISTS title_orders_deal_idx ON title_orders(deal_id)',

  // import_jobs — 0069
  `CREATE TABLE IF NOT EXISTS "import_jobs" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" text NOT NULL,
     "kind" text NOT NULL,
     "status" text NOT NULL DEFAULT 'queued',
     "filename" text,
     "payload_ref" text,
     "field_map" jsonb,
     "total_rows" integer NOT NULL DEFAULT 0,
     "processed_count" integer NOT NULL DEFAULT 0,
     "success_count" integer NOT NULL DEFAULT 0,
     "error_count" integer NOT NULL DEFAULT 0,
     "duplicates_skipped" integer NOT NULL DEFAULT 0,
     "errors" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "result" jsonb,
     "error_message" text,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "started_at" timestamp,
     "completed_at" timestamp
   )`,
  'CREATE INDEX IF NOT EXISTS "import_jobs_org_status_idx" ON "import_jobs" ("organization_id", "status", "created_at")',
  'CREATE INDEX IF NOT EXISTS "import_jobs_status_created_idx" ON "import_jobs" ("status", "created_at")',

  // export_jobs — 0069
  `CREATE TABLE IF NOT EXISTS "export_jobs" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "user_id" text NOT NULL,
     "kind" text NOT NULL DEFAULT 'everything',
     "status" text NOT NULL DEFAULT 'queued',
     "params" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "archive_path" text,
     "archive_size_bytes" integer,
     "entity_counts" jsonb,
     "error_message" text,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "started_at" timestamp,
     "completed_at" timestamp,
     "expires_at" timestamp
   )`,
  'CREATE INDEX IF NOT EXISTS "export_jobs_org_status_idx" ON "export_jobs" ("organization_id", "status", "created_at")',
  'CREATE INDEX IF NOT EXISTS "export_jobs_status_created_idx" ON "export_jobs" ("status", "created_at")',

  // etl_jobs — 0070 (must precede etl_runs)
  `CREATE TABLE IF NOT EXISTS "etl_jobs" (
     "id" serial PRIMARY KEY,
     "job_name" text NOT NULL UNIQUE,
     "provider_name" text NOT NULL,
     "source_url" text,
     "watermark_column" text,
     "watermark_value" text,
     "schedule" text NOT NULL DEFAULT '*/15 * * * *',
     "is_active" boolean NOT NULL DEFAULT true,
     "soft_delete_on_missing" boolean NOT NULL DEFAULT false,
     "last_success_at" timestamp,
     "last_error_at" timestamp,
     "last_error" text,
     "config" jsonb NOT NULL DEFAULT '{}'::jsonb,
     "created_at" timestamp NOT NULL DEFAULT now(),
     "updated_at" timestamp NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "etl_jobs_provider_idx" ON "etl_jobs" ("provider_name")',
  'CREATE INDEX IF NOT EXISTS "etl_jobs_active_idx" ON "etl_jobs" ("is_active", "last_success_at")',

  // etl_runs — 0070 (FK→etl_jobs)
  `CREATE TABLE IF NOT EXISTS "etl_runs" (
     "id" serial PRIMARY KEY,
     "job_id" integer NOT NULL REFERENCES etl_jobs(id) ON DELETE CASCADE,
     "started_at" timestamp NOT NULL DEFAULT now(),
     "completed_at" timestamp,
     "status" text NOT NULL DEFAULT 'running',
     "records_read" integer NOT NULL DEFAULT 0,
     "records_inserted" integer NOT NULL DEFAULT 0,
     "records_updated" integer NOT NULL DEFAULT 0,
     "records_deleted" integer NOT NULL DEFAULT 0,
     "records_failed" integer NOT NULL DEFAULT 0,
     "error_message" text,
     "watermark_before" text,
     "watermark_after" text
   )`,
  'CREATE INDEX IF NOT EXISTS "etl_runs_job_started_idx" ON "etl_runs" ("job_id", "started_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "etl_runs_status_idx" ON "etl_runs" ("status")',

  // acquired_notes — 0073 part B (must precede note_payments)
  `CREATE TABLE IF NOT EXISTS "acquired_notes" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "property_id" INTEGER REFERENCES properties(id) ON DELETE SET NULL,
     "borrower_id" INTEGER REFERENCES leads(id) ON DELETE SET NULL,
     "note_number" TEXT NOT NULL,
     "original_principal_cents" BIGINT NOT NULL,
     "current_balance_cents" BIGINT NOT NULL,
     "interest_rate_bps" INTEGER NOT NULL,
     "term_months" INTEGER NOT NULL,
     "payment_amount_cents" BIGINT NOT NULL,
     "payment_due_day" INTEGER NOT NULL,
     "origination_date" DATE NOT NULL,
     "maturity_date" DATE NOT NULL,
     "acquisition_date" DATE NOT NULL,
     "acquisition_price_cents" BIGINT NOT NULL,
     "status" TEXT NOT NULL DEFAULT 'performing',
     "payer_name" TEXT NOT NULL,
     "payer_address" JSONB,
     "payer_encrypted_tin" TEXT,
     "payer_tin_type" TEXT,
     "original_lender" TEXT,
     "assignment_doc_s3_key" TEXT,
     "notes" TEXT,
     "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
     "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS acquired_notes_org_status_maturity_idx ON acquired_notes(organization_id, status, maturity_date)',
  'CREATE INDEX IF NOT EXISTS acquired_notes_org_acquisition_idx ON acquired_notes(organization_id, acquisition_date)',
  'CREATE INDEX IF NOT EXISTS acquired_notes_property_idx ON acquired_notes(property_id)',
  'CREATE UNIQUE INDEX IF NOT EXISTS acquired_notes_org_number_uk ON acquired_notes(organization_id, note_number)',

  // note_payments — 0073 part C (FK→acquired_notes)
  `CREATE TABLE IF NOT EXISTS "note_payments" (
     "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
     "note_id" UUID NOT NULL REFERENCES acquired_notes(id) ON DELETE CASCADE,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
     "payment_date" DATE NOT NULL,
     "principal_cents" BIGINT NOT NULL DEFAULT 0,
     "interest_cents" BIGINT NOT NULL DEFAULT 0,
     "escrow_cents" BIGINT NOT NULL DEFAULT 0,
     "late_fee_cents" BIGINT NOT NULL DEFAULT 0,
     "payment_method" TEXT NOT NULL DEFAULT 'ach',
     "reference_number" TEXT,
     "notes" TEXT,
     "created_at" TIMESTAMPTZ NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS note_payments_note_date_idx ON note_payments(note_id, payment_date)',
  'CREATE INDEX IF NOT EXISTS note_payments_org_date_idx ON note_payments(organization_id, payment_date)',

  // ── §3 Batch 7 — derived + legacy (7 tables) ────────────────────────────
  // 4 derived from shared/schema.ts (no canonical migration):
  //   adjacent_verticals_waitlist, feedback_submissions, integration_status,
  //   refund_requests
  // 3 legacy: nps_responses (0012), field_scout_visits + field_scout_photos
  //   (0003 + 0072 — migrations have drifted from shared/schema.ts shape;
  //   built from schema.ts as authoritative).

  // adjacent_verticals_waitlist — derived
  `CREATE TABLE IF NOT EXISTS "adjacent_verticals_waitlist" (
     "id" SERIAL PRIMARY KEY,
     "email" TEXT NOT NULL,
     "vertical" TEXT NOT NULL,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,

  // feedback_submissions — unified table serving both the in-app signed-in
  // feedback widget (legacy: user_id + user_email) AND the public landing
  // support/feedback/question form (name + email, no auth). 2026-05-11 made
  // user_id + user_email nullable to support anonymous public submissions.
  `CREATE TABLE IF NOT EXISTS "feedback_submissions" (
     "id" SERIAL PRIMARY KEY,
     "user_id" TEXT,
     "user_email" TEXT,
     "name" TEXT,
     "email" TEXT,
     "category" TEXT NOT NULL,
     "message" TEXT NOT NULL,
     "source" TEXT,
     "allow_follow_up" BOOLEAN NOT NULL DEFAULT TRUE,
     "page_url" TEXT,
     "user_agent" TEXT,
     "ip_address" TEXT,
     "status" TEXT NOT NULL DEFAULT 'new',
     "read_at" TIMESTAMP,
     "replied_at" TIMESTAMP,
     "founder_notes" TEXT,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  // Make legacy user_id + user_email nullable on existing prod tables, and
  // add the public-form columns that the original schema lacked.
  `ALTER TABLE "feedback_submissions" ALTER COLUMN "user_id" DROP NOT NULL`,
  `ALTER TABLE "feedback_submissions" ALTER COLUMN "user_email" DROP NOT NULL`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "name" TEXT`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "email" TEXT`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "source" TEXT`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "ip_address" TEXT`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "read_at" TIMESTAMP`,
  `ALTER TABLE "feedback_submissions" ADD COLUMN IF NOT EXISTS "replied_at" TIMESTAMP`,

  // integration_status — derived
  `CREATE TABLE IF NOT EXISTS "integration_status" (
     "id" SERIAL PRIMARY KEY,
     "integration_key" TEXT NOT NULL UNIQUE,
     "display_name" TEXT NOT NULL,
     "is_configured" BOOLEAN NOT NULL DEFAULT FALSE,
     "is_critical" BOOLEAN NOT NULL DEFAULT FALSE,
     "last_verified_at" TIMESTAMP,
     "last_verification_status" TEXT NOT NULL DEFAULT 'never_tested',
     "setup_docs_url" TEXT,
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,

  // refund_requests — derived
  `CREATE TABLE IF NOT EXISTS "refund_requests" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id),
     "user_id" TEXT,
     "stripe_charge_id" TEXT,
     "stripe_payment_intent_id" TEXT,
     "amount_cents" INTEGER NOT NULL,
     "reason" TEXT,
     "status" TEXT NOT NULL DEFAULT 'pending',
     "auto_approved" BOOLEAN DEFAULT FALSE,
     "processed_at" TIMESTAMP,
     "processed_by" TEXT,
     "stripe_refund_id" TEXT,
     "created_at" TIMESTAMP DEFAULT NOW()
   )`,

  // nps_responses — 0012
  `CREATE TABLE IF NOT EXISTS "nps_responses" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL REFERENCES organizations(id),
     "user_id" TEXT NOT NULL,
     "score" INTEGER NOT NULL CHECK (score >= 0 AND score <= 10),
     "feedback" TEXT,
     "trigger" TEXT NOT NULL,
     "created_at" TIMESTAMP DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS idx_nps_org ON nps_responses(organization_id)',
  'CREATE INDEX IF NOT EXISTS idx_nps_trigger ON nps_responses(organization_id, trigger)',

  // field_scout_visits — derived from shared/schema.ts (0003 migration drifted)
  `CREATE TABLE IF NOT EXISTS "field_scout_visits" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL,
     "visitor_id" VARCHAR(255) NOT NULL,
     "lead_id" INTEGER,
     "property_id" INTEGER,
     "latitude" REAL,
     "longitude" REAL,
     "notes" TEXT,
     "status" VARCHAR(50) DEFAULT 'completed',
     "started_at" TIMESTAMP,
     "completed_at" TIMESTAMP,
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
     "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS fsv_org_idx ON field_scout_visits(organization_id)',
  'CREATE INDEX IF NOT EXISTS fsv_visitor_idx ON field_scout_visits(visitor_id)',

  // field_scout_photos — derived from shared/schema.ts (0003+0072 drifted)
  `CREATE TABLE IF NOT EXISTS "field_scout_photos" (
     "id" SERIAL PRIMARY KEY,
     "organization_id" INTEGER NOT NULL,
     "visit_id" INTEGER NOT NULL,
     "lead_id" INTEGER,
     "url" TEXT NOT NULL,
     "caption" TEXT,
     "latitude" REAL,
     "longitude" REAL,
     "image_hash" VARCHAR(64),
     "thumbnail_url" TEXT,
     "card_url" TEXT,
     "full_url" TEXT,
     "bytes" INTEGER,
     "mime" VARCHAR(64),
     "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
   )`,
  'CREATE INDEX IF NOT EXISTS fsp_visit_idx ON field_scout_photos(visit_id)',
  'CREATE INDEX IF NOT EXISTS fsp_lead_idx ON field_scout_photos(lead_id)',
  'CREATE INDEX IF NOT EXISTS fsp_org_hash_idx ON field_scout_photos(organization_id, image_hash)',

  // ── §3 Batch 8 — column ALTERs (25 columns) ─────────────────────────────
  // organizations (13 cols), email_suppressions (4), leads (3), team_members,
  // signatures, deal_patterns, dunning_events.
  // ADD COLUMN IF NOT EXISTS is idempotent. Each statement runs standalone.

  // organizations: tax / 1099 identity (0035)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS ein text`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_id_type text`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS tax_address jsonb`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS legal_entity_name text`,
  // organizations: billing interval (0037)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS billing_interval TEXT NOT NULL DEFAULT 'monthly'`,
  // organizations: autopay-frozen (0040)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS autopay_frozen BOOLEAN NOT NULL DEFAULT FALSE`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS autopay_frozen_at TIMESTAMPTZ`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS autopay_frozen_reason TEXT`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS autopay_frozen_until TIMESTAMPTZ`,
  // organizations: AI quota cap (0047)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS org_ai_quota_daily_usd numeric(10, 2) NOT NULL DEFAULT 50.00`,
  // organizations: team-readiness (0066 Part A)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS seat_count INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS requires_approval_offers_over NUMERIC`,
  // organizations: investor-type fork (0073 Part A)
  `ALTER TABLE organizations ADD COLUMN IF NOT EXISTS investor_type TEXT NOT NULL DEFAULT 'land'`,

  // email_suppressions: deliverability extensions (0056 Part 4)
  `ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS bounce_category text`,
  `ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS organization_id integer REFERENCES organizations(id) ON DELETE SET NULL`,
  `ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS soft_bounce_count integer NOT NULL DEFAULT 0`,
  `ALTER TABLE email_suppressions ADD COLUMN IF NOT EXISTS last_soft_bounce_at timestamptz`,
  `CREATE INDEX IF NOT EXISTS idx_email_suppressions_org ON email_suppressions (organization_id)`,
  `CREATE INDEX IF NOT EXISTS idx_email_suppressions_category ON email_suppressions (bounce_category)`,

  // leads: tax identity (0035)
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS tax_id text`,
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS tax_id_type text`,
  // leads: phone normalization (0051) — GENERATED column requires pg_trgm
  // for the gin_trgm_ops index. If pg_trgm absent, the index will be
  // SKIPPED non-fatally.
  `ALTER TABLE leads ADD COLUMN IF NOT EXISTS phone_normalized text
     GENERATED ALWAYS AS (regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g')) STORED`,
  `CREATE INDEX IF NOT EXISTS leads_phone_normalized_trgm_idx ON leads USING GIN (phone_normalized gin_trgm_ops)`,

  // team_members: VA flag (0054 part 2)
  `ALTER TABLE team_members ADD COLUMN IF NOT EXISTS view_only_assigned_leads BOOLEAN NOT NULL DEFAULT FALSE`,

  // signatures: tamper-evidence (0033)
  `ALTER TABLE signatures ADD COLUMN IF NOT EXISTS document_content_hash text`,

  // dunning_events: SMS throttle (0048 part 3)
  `ALTER TABLE dunning_events ADD COLUMN IF NOT EXISTS sms_sent_at TIMESTAMPTZ`,
  `CREATE INDEX IF NOT EXISTS idx_dunning_events_sms_sent ON dunning_events (organization_id, sms_sent_at) WHERE sms_sent_at IS NOT NULL`,

  // deal_patterns: embedding refresh tracker (0052) — pgvector column-type
  // change + IVFFlat index intentionally excluded; pgvector unavailable
  // on the current Fly Postgres image. Only the timestamp + btree ship.
  `ALTER TABLE deal_patterns ADD COLUMN IF NOT EXISTS embedding_refreshed_at timestamp`,
  `CREATE INDEX IF NOT EXISTS deal_patterns_embedding_refreshed_at_idx ON deal_patterns (embedding_refreshed_at NULLS FIRST)`,

  // properties: land_status fork (0038) — automation blocker for tribal/trust
  `ALTER TABLE properties ADD COLUMN IF NOT EXISTS land_status TEXT NOT NULL DEFAULT 'unknown'`,

  // ── §3 Batch 9 — extensions ─────────────────────────────────────────────
  // unaccent only. pgvector deferred (image upgrade required).
  `CREATE EXTENSION IF NOT EXISTS unaccent`,

  // ── Phase 3 Week 7-8 (P1-15): index audit. Migration 0045. ──────────────
  // CONCURRENTLY is safe because pool.query runs each statement outside an
  // implicit transaction. IF NOT EXISTS makes them idempotent on retry.
  // NOTE: do not run release_command through pgBouncer — CONCURRENTLY needs
  // a real Postgres session. See docs/runbooks/pgbouncer-rollout.md.
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_status_created_idx" ON "leads" ("organization_id", "status", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "leads_org_assigned_status_idx" ON "leads" ("organization_id", "assigned_to", "status")',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_land_status_idx" ON "properties" ("organization_id", "land_status")',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "properties_org_status_created_idx" ON "properties" ("organization_id", "status", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "messages_org_conversation_created_idx" ON "messages" ("organization_id", "conversation_id", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_events_action_created_idx" ON "audit_events" ("action", "created_at" DESC)',
  'CREATE INDEX CONCURRENTLY IF NOT EXISTS "email_events_event_created_idx" ON "email_events" ("event", "created_at" DESC)',

  // ── P0-10 (master findings): Dropbox Sign webhook event-level idempotency ──
  // Mirrors stripe_processed_events. Atomic claim via INSERT ON CONFLICT
  // DO NOTHING so duplicate Dropbox Sign deliveries (the spec retries on
  // 5xx) never double-process.
  `CREATE TABLE IF NOT EXISTS "esign_webhook_events" (
     "id" serial PRIMARY KEY,
     "provider" text NOT NULL DEFAULT 'dropbox_sign',
     "event_id" text NOT NULL UNIQUE,
     "event_type" text NOT NULL,
     "signature_request_id" text,
     "processed_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "esign_webhook_events_event_id_idx" ON "esign_webhook_events" ("event_id")',
  'CREATE INDEX IF NOT EXISTS "esign_webhook_events_sig_req_idx" ON "esign_webhook_events" ("signature_request_id")',

  // ── RS-1 (post-may1-resweep): FCRA permissible-purpose attestation tables ──
  // Cordelia §3 + Imelda §3.5: per-lookup attestation BEFORE screening fields
  // can be updated; org-level annual click-through stamps fcra_attestations.
  `CREATE TABLE IF NOT EXISTS "tenant_screenings" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "tenant_id" uuid NOT NULL,
     "property_id" integer REFERENCES "properties"("id") ON DELETE SET NULL,
     "purpose_of_use" text NOT NULL,
     "purpose_justification" text,
     "requesting_user_id" text NOT NULL,
     "attestation_version" text NOT NULL,
     "attested_at" timestamptz NOT NULL DEFAULT now(),
     "outcome" text,
     "credit_score" integer,
     "has_prior_eviction" boolean,
     "has_criminal_record" boolean,
     "income_monthly_cents" bigint,
     "criteria_met" boolean,
     "cra_used" text,
     "cra_report_id" text,
     "adverse_action_notice_sent_at" timestamptz,
     "adverse_action_template_version" text,
     "adverse_action_delivery_status" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "tenant_screenings_org_tenant_idx" ON "tenant_screenings" ("organization_id", "tenant_id")',
  'CREATE INDEX IF NOT EXISTS "tenant_screenings_org_attested_idx" ON "tenant_screenings" ("organization_id", "attested_at")',
  'CREATE INDEX IF NOT EXISTS "tenant_screenings_outcome_idx" ON "tenant_screenings" ("organization_id", "outcome")',

  `CREATE TABLE IF NOT EXISTS "fcra_attestations" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "user_id" text NOT NULL,
     "attestation_version" text NOT NULL,
     "attested_at" timestamptz NOT NULL DEFAULT now(),
     "ip_address" text,
     "user_agent" text
   )`,
  'CREATE INDEX IF NOT EXISTS "fcra_attestations_org_user_idx" ON "fcra_attestations" ("organization_id", "user_id")',
  'CREATE INDEX IF NOT EXISTS "fcra_attestations_attested_idx" ON "fcra_attestations" ("organization_id", "attested_at")',

  // FW-SAM-1 (push-forward 2026-05-08): audit_events tamper-resistance.
  // Defense-in-depth: a BEFORE-trigger that blocks UPDATE / DELETE on
  // audit_events, no matter how the write arrives (route, ad-hoc DB
  // session, future migration, ORM bypass). Inserts remain freely
  // permitted — the table is append-only by design. Combined with the
  // existing route-level audit middleware, this closes the "rogue
  // operator can erase their tracks" surface that Sam-Reyes flagged.
  `CREATE OR REPLACE FUNCTION acreos_block_audit_event_mutation()
   RETURNS trigger AS $$
   BEGIN
     RAISE EXCEPTION
       'audit_events is append-only — % blocked on row id=%',
       TG_OP, COALESCE(OLD.id, NEW.id)
       USING ERRCODE = 'restrict_violation';
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS acreos_block_audit_event_update ON "audit_events"`,
  `CREATE TRIGGER acreos_block_audit_event_update
     BEFORE UPDATE ON "audit_events"
     FOR EACH ROW
     EXECUTE FUNCTION acreos_block_audit_event_mutation()`,
  `DROP TRIGGER IF EXISTS acreos_block_audit_event_delete ON "audit_events"`,
  `CREATE TRIGGER acreos_block_audit_event_delete
     BEFORE DELETE ON "audit_events"
     FOR EACH ROW
     EXECUTE FUNCTION acreos_block_audit_event_mutation()`,

  // FW-HARLOWE-1 (push-forward 2026-05-08): ESIGN integrity layer Phase 2.
  // Defense-in-depth Postgres-level immutability guard. The route-level
  // check in PUT /api/generated-documents/:id (R2) stops API mutations,
  // but ad-hoc DB writes / ORM bypasses / future routes could still
  // mutate a signed document's content, breaking the SHA-256 hash
  // captured on the signature row. This BEFORE-trigger raises at the
  // database level, so the protection holds no matter how the write
  // arrives.
  `CREATE OR REPLACE FUNCTION acreos_block_signed_doc_mutation()
   RETURNS trigger AS $$
   BEGIN
     IF OLD.status IN ('signed', 'partially_signed', 'final') THEN
       IF (NEW.content IS DISTINCT FROM OLD.content)
          OR (NEW.variables IS DISTINCT FROM OLD.variables)
          OR (NEW.signers IS DISTINCT FROM OLD.signers) THEN
         RAISE EXCEPTION
           'generated_documents % is in immutable status %; content/variables/signers cannot be modified',
           OLD.id, OLD.status
           USING ERRCODE = 'restrict_violation';
       END IF;
     END IF;
     RETURN NEW;
   END;
   $$ LANGUAGE plpgsql`,
  `DROP TRIGGER IF EXISTS acreos_block_signed_doc_mutation_trigger ON "generated_documents"`,
  `CREATE TRIGGER acreos_block_signed_doc_mutation_trigger
     BEFORE UPDATE ON "generated_documents"
     FOR EACH ROW
     EXECUTE FUNCTION acreos_block_signed_doc_mutation()`,

  // FW-DIEGO-1 (push-forward 2026-05-08): founder-letter infrastructure.
  // Async (not Slack/Discord), weekly cadence, top-of-funnel acquisition.
  `CREATE TABLE IF NOT EXISTS "community_letters" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "slug" text NOT NULL UNIQUE,
     "subject" text NOT NULL,
     "html_body" text NOT NULL,
     "plain_body" text,
     "published_at" timestamptz,
     "sent_at" timestamptz,
     "recipient_count" integer NOT NULL DEFAULT 0,
     "sender_user_id" text,
     "sender_email" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "community_letters_published_idx" ON "community_letters" ("published_at")',

  // Panel-300 #30 — CMA reports + auction-readiness + lien-search.
  `CREATE TABLE IF NOT EXISTS "cma_reports" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "property_id" integer,
     "subject_address" text,
     "subject_acres" numeric,
     "comp_ids" jsonb,
     "subject_attributes" jsonb,
     "valuation_low_cents" integer,
     "valuation_mid_cents" integer,
     "valuation_high_cents" integer,
     "methodology_notes" text,
     "prepared_by" text,
     "domain_expert_reviewed_at" timestamptz,
     "domain_expert_reviewer" text,
     "status" text NOT NULL DEFAULT 'draft',
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "cma_reports_org_idx" ON "cma_reports" ("organization_id", "created_at")',
  'CREATE INDEX IF NOT EXISTS "cma_reports_property_idx" ON "cma_reports" ("property_id")',

  `CREATE TABLE IF NOT EXISTS "auction_readiness_checklists" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "property_id" integer,
     "auction_date" timestamptz,
     "title_search_complete" boolean NOT NULL DEFAULT false,
     "lien_search_complete" boolean NOT NULL DEFAULT false,
     "occupancy_verified" boolean NOT NULL DEFAULT false,
     "bid_strategy_documented" boolean NOT NULL DEFAULT false,
     "funds_confirmed_cents" integer,
     "redemption_risk_assessed" boolean NOT NULL DEFAULT false,
     "domain_expert_signoff_at" timestamptz,
     "domain_expert_signoff_by" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "auction_readiness_property_unique_idx" ON "auction_readiness_checklists" ("organization_id", "property_id")',

  `CREATE TABLE IF NOT EXISTS "lien_search_records" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "property_id" integer,
     "lien_type" text NOT NULL,
     "lien_holder" text,
     "lien_amount_cents" integer,
     "recorded_at" timestamptz,
     "release_status" text NOT NULL DEFAULT 'active',
     "source_system" text,
     "raw_data" jsonb,
     "notes" text,
     "discovered_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "lien_search_property_type_idx" ON "lien_search_records" ("property_id", "lien_type")',
  'CREATE INDEX IF NOT EXISTS "lien_search_org_idx" ON "lien_search_records" ("organization_id")',
  'CREATE INDEX IF NOT EXISTS "lien_search_status_idx" ON "lien_search_records" ("release_status")',

  // Panel-300 #25 — vendor adoption telemetry.
  `CREATE TABLE IF NOT EXISTS "vendor_adoption_metrics" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "vendor" text NOT NULL,
     "metric_key" text NOT NULL,
     "period_key" text NOT NULL,
     "value" numeric NOT NULL,
     "unit" text,
     "notes" text,
     "captured_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "vendor_metrics_unique_idx" ON "vendor_adoption_metrics" ("vendor", "metric_key", "period_key")',
  'CREATE INDEX IF NOT EXISTS "vendor_metrics_vendor_period_idx" ON "vendor_adoption_metrics" ("vendor", "period_key")',

  // Panel-300 #26 — GDPR DSAR tracking.
  `CREATE TABLE IF NOT EXISTS "dsar_requests_lifecycle" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "request_type" text NOT NULL,
     "requester_email" text NOT NULL,
     "requester_identity_verified" boolean NOT NULL DEFAULT false,
     "received_at" timestamptz NOT NULL DEFAULT now(),
     "sla_deadline_at" timestamptz NOT NULL,
     "fulfilled_at" timestamptz,
     "delivery_method" text,
     "bytes_delivered" integer,
     "audit_notes" text,
     "is_self_test" boolean NOT NULL DEFAULT false
   )`,
  'CREATE INDEX IF NOT EXISTS "dsar_lifecycle_received_idx" ON "dsar_requests_lifecycle" ("received_at")',
  'CREATE INDEX IF NOT EXISTS "dsar_lifecycle_unfulfilled_idx" ON "dsar_requests_lifecycle" ("fulfilled_at")',

  // Panel-300 #27 — pricing-elasticity A/B test.
  `CREATE TABLE IF NOT EXISTS "pricing_experiments" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "experiment_key" text NOT NULL,
     "variant_key" text NOT NULL,
     "organization_id" integer,
     "visitor_id" text,
     "assigned_at" timestamptz NOT NULL DEFAULT now(),
     "converted_at" timestamptz,
     "amount_paid_cents" integer,
     "conversion_event" text
   )`,
  'CREATE INDEX IF NOT EXISTS "pricing_experiments_key_variant_idx" ON "pricing_experiments" ("experiment_key", "variant_key")',
  'CREATE INDEX IF NOT EXISTS "pricing_experiments_org_idx" ON "pricing_experiments" ("organization_id")',
  'CREATE INDEX IF NOT EXISTS "pricing_experiments_visitor_idx" ON "pricing_experiments" ("visitor_id")',

  // Panel-300 #34 — fair-lending audit + RESPA referral-fee transparency.
  `CREATE TABLE IF NOT EXISTS "fair_lending_audit_runs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "period_key" text NOT NULL,
     "sample_size" integer NOT NULL,
     "approval_rate_overall" numeric,
     "approval_rate_by_category" jsonb,
     "max_divergence_pct" numeric,
     "status" text NOT NULL,
     "run_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "fair_lending_org_period_idx" ON "fair_lending_audit_runs" ("organization_id", "period_key")',

  `CREATE TABLE IF NOT EXISTS "vendor_referral_fees" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "vendor" text NOT NULL,
     "relationship_kind" text NOT NULL,
     "fee_structure" text NOT NULL,
     "fee_amount_cents" integer,
     "fee_pct" numeric,
     "public_disclosed" boolean NOT NULL DEFAULT false,
     "disclosed_at" timestamptz,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "vendor_referral_fees_vendor_idx" ON "vendor_referral_fees" ("vendor")',
  'CREATE INDEX IF NOT EXISTS "vendor_referral_fees_disclosed_idx" ON "vendor_referral_fees" ("public_disclosed")',

  // Panel-300 #9 — reconciliation rules + run history.
  `CREATE TABLE IF NOT EXISTS "reconciliation_rules" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "source_system" text NOT NULL,
     "entity_type" text NOT NULL,
     "aggregation_key" text NOT NULL,
     "expected_query" text,
     "tolerance_dollars" numeric NOT NULL DEFAULT 1.00,
     "enabled" boolean NOT NULL DEFAULT true,
     "last_run_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "reconciliation_rules_key_idx" ON "reconciliation_rules" ("source_system", "entity_type", "aggregation_key")',

  `CREATE TABLE IF NOT EXISTS "reconciliation_runs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "rule_id" uuid NOT NULL,
     "run_at" timestamptz NOT NULL DEFAULT now(),
     "source_total" numeric,
     "acreos_total" numeric,
     "difference_dollars" numeric,
     "status" text NOT NULL,
     "error_message" text
   )`,
  'CREATE INDEX IF NOT EXISTS "reconciliation_runs_rule_run_idx" ON "reconciliation_runs" ("rule_id", "run_at")',
  'CREATE INDEX IF NOT EXISTS "reconciliation_runs_status_idx" ON "reconciliation_runs" ("status")',

  // Panel-300 #10 + #20 — statutory_forms + disclosure_timing_scheduled.
  `CREATE TABLE IF NOT EXISTS "statutory_forms" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "state" text NOT NULL,
     "form_key" text NOT NULL,
     "statute_citation" text,
     "version" text NOT NULL,
     "body" text NOT NULL,
     "attorney_reviewed_at" timestamptz,
     "attorney_reviewer" text,
     "enabled" boolean NOT NULL DEFAULT false,
     "expires_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "statutory_forms_state_key_version_idx" ON "statutory_forms" ("state", "form_key", "version")',
  'CREATE INDEX IF NOT EXISTS "statutory_forms_enabled_idx" ON "statutory_forms" ("enabled")',

  `CREATE TABLE IF NOT EXISTS "disclosure_timing_scheduled" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "deal_id" integer,
     "property_id" integer,
     "statutory_form_id" uuid NOT NULL,
     "closing_date" timestamptz NOT NULL,
     "send_date" timestamptz NOT NULL,
     "sent_at" timestamptz,
     "status" text NOT NULL DEFAULT 'scheduled',
     "send_error_message" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "disclosure_timing_send_date_idx" ON "disclosure_timing_scheduled" ("send_date", "status")',
  'CREATE INDEX IF NOT EXISTS "disclosure_timing_org_idx" ON "disclosure_timing_scheduled" ("organization_id")',

  // Panel-300 G3 — auth-fail lockout tracker.
  `CREATE TABLE IF NOT EXISTS "auth_fail_attempts" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "ip" text,
     "email" text,
     "attempted_at" timestamptz NOT NULL DEFAULT now(),
     "failure_reason" text,
     "user_agent" text
   )`,
  'CREATE INDEX IF NOT EXISTS "auth_fail_attempts_ip_idx" ON "auth_fail_attempts" ("ip", "attempted_at")',
  'CREATE INDEX IF NOT EXISTS "auth_fail_attempts_email_idx" ON "auth_fail_attempts" ("email", "attempted_at")',

  // FW-OLU-2 (push-forward 2026-05-08): synthetic checks (180-5).
  `CREATE TABLE IF NOT EXISTS "synthetic_check_runs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "check_key" text NOT NULL,
     "run_at" timestamptz NOT NULL DEFAULT now(),
     "status" text NOT NULL,
     "latency_ms" integer,
     "error_message" text,
     "metadata" jsonb
   )`,
  'CREATE INDEX IF NOT EXISTS "synthetic_check_runs_key_run_idx" ON "synthetic_check_runs" ("check_key", "run_at")',

  // FW-WYNNE-3 (push-forward 2026-05-08): data-retention policy.
  `CREATE TABLE IF NOT EXISTS "retention_policies" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "table_key" text NOT NULL,
     "retention_kind" text NOT NULL,
     "retention_days" integer NOT NULL,
     "legal_basis" text,
     "enabled" boolean NOT NULL DEFAULT true,
     "last_run_at" timestamptz,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "retention_policies_table_idx" ON "retention_policies" ("table_key")',

  // FW-CAMILA-2 (push-forward 2026-05-08): D7 NPS micro-survey.
  `CREATE TABLE IF NOT EXISTS "nps_micro_surveys" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "user_id" text,
     "score" integer NOT NULL,
     "comment" text,
     "survey_trigger" text NOT NULL DEFAULT 'd7',
     "submitted_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "nps_micro_org_idx" ON "nps_micro_surveys" ("organization_id", "submitted_at")',

  // FW-CAMILA-3 (push-forward 2026-05-08): pre-churn ladder.
  `CREATE TABLE IF NOT EXISTS "pre_churn_rungs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "rung" text NOT NULL,
     "fired_at" timestamptz NOT NULL DEFAULT now(),
     "status" text NOT NULL DEFAULT 'fired',
     "notes" text
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "pre_churn_rungs_org_rung_idx" ON "pre_churn_rungs" ("organization_id", "rung")',
  'CREATE INDEX IF NOT EXISTS "pre_churn_rungs_status_idx" ON "pre_churn_rungs" ("status")',

  // FW-WYNNE-2 (push-forward 2026-05-08): substantive FCRA attestation form.
  'ALTER TABLE "fcra_attestations" ADD COLUMN IF NOT EXISTS "substantive_form" jsonb',

  // FW-TEGAN-1 + FW-ASHOK-1 (push-forward 2026-05-08): vertical packs.
  // One row per (org, pack_key). Org has a pack active when status='active'
  // AND (cancel_at IS NULL OR cancel_at > now()).
  `CREATE TABLE IF NOT EXISTS "org_vertical_packs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "pack_key" text NOT NULL,
     "status" text NOT NULL DEFAULT 'active',
     "activated_at" timestamptz NOT NULL DEFAULT now(),
     "cancel_at" timestamptz,
     "cancelled_at" timestamptz,
     "billing_interval" text NOT NULL DEFAULT 'monthly',
     "price_cents" integer NOT NULL,
     "stripe_subscription_item_id" text,
     "activated_by" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "org_vertical_packs_org_pack_idx" ON "org_vertical_packs" ("organization_id", "pack_key")',
  'CREATE INDEX IF NOT EXISTS "org_vertical_packs_status_idx" ON "org_vertical_packs" ("status")',

  // FW-THEO-1 + FW-INDIRA-1 (push-forward 2026-05-08): eval harness +
  // AI cost ceiling + model lifecycle.
  `CREATE TABLE IF NOT EXISTS "ai_models" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "model_key" text NOT NULL UNIQUE,
     "provider" text NOT NULL,
     "family" text,
     "added_at" timestamptz NOT NULL DEFAULT now(),
     "deprecated_at" timestamptz,
     "retired_at" timestamptz,
     "input_token_cost_cents" numeric,
     "output_token_cost_cents" numeric,
     "notes" text,
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "ai_models_provider_idx" ON "ai_models" ("provider")',
  'CREATE INDEX IF NOT EXISTS "ai_models_deprecated_idx" ON "ai_models" ("deprecated_at")',

  `CREATE TABLE IF NOT EXISTS "ai_test_cases" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "surface" text NOT NULL,
     "name" text NOT NULL,
     "description" text,
     "input_prompt" text NOT NULL,
     "expected_traits" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "forbidden_traits" jsonb NOT NULL DEFAULT '[]'::jsonb,
     "severity" text NOT NULL DEFAULT 'major',
     "is_active" boolean NOT NULL DEFAULT true,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "ai_test_cases_surface_idx" ON "ai_test_cases" ("surface")',
  'CREATE INDEX IF NOT EXISTS "ai_test_cases_active_idx" ON "ai_test_cases" ("is_active")',

  `CREATE TABLE IF NOT EXISTS "ai_test_runs" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "test_case_id" uuid NOT NULL,
     "model_key" text NOT NULL,
     "run_at" timestamptz NOT NULL DEFAULT now(),
     "passed" boolean NOT NULL,
     "output" text,
     "failure_reason" text,
     "latency_ms" integer,
     "input_tokens" integer,
     "output_tokens" integer,
     "cost_cents" numeric
   )`,
  'CREATE INDEX IF NOT EXISTS "ai_test_runs_case_run_idx" ON "ai_test_runs" ("test_case_id", "run_at")',
  'CREATE INDEX IF NOT EXISTS "ai_test_runs_model_run_idx" ON "ai_test_runs" ("model_key", "run_at")',

  `CREATE TABLE IF NOT EXISTS "ai_cost_ceiling_overrides" (
     "organization_id" integer PRIMARY KEY,
     "daily_ceiling_cents" integer NOT NULL,
     "monthly_ceiling_cents" integer,
     "set_by" text,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now(),
     "updated_at" timestamptz NOT NULL DEFAULT now()
   )`,

  // FW-MARISOL-2 (push-forward 2026-05-08): ASC 606 revenue recognition.
  // One row per (org, period_key, source). Idempotent — re-running the
  // recognition cron updates rows rather than duplicating them.
  `CREATE TABLE IF NOT EXISTS "revenue_recognition_periods" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "organization_id" integer NOT NULL,
     "period_key" text NOT NULL,
     "period_start" timestamptz NOT NULL,
     "period_end" timestamptz NOT NULL,
     "source" text NOT NULL,
     "tier" text,
     "billing_interval" text,
     "recognized_cents" integer NOT NULL DEFAULT 0,
     "deferred_cents" integer NOT NULL DEFAULT 0,
     "notes" text,
     "created_at" timestamptz NOT NULL DEFAULT now()
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "rev_recog_org_period_source_idx" ON "revenue_recognition_periods" ("organization_id", "period_key", "source")',
  'CREATE INDEX IF NOT EXISTS "rev_recog_period_idx" ON "revenue_recognition_periods" ("period_key")',

  // FW-MIREILLE-1 (push-forward 2026-05-08): deal-room growth-loop retrofit.
  // Adds public share slug + view counter so deal-rooms can serve as
  // unauthenticated acquisition surface. Loop conversion measured weekly.
  'ALTER TABLE "deal_rooms" ADD COLUMN IF NOT EXISTS "public_share_slug" text',
  'CREATE UNIQUE INDEX IF NOT EXISTS "deal_rooms_public_share_slug_idx" ON "deal_rooms" ("public_share_slug") WHERE "public_share_slug" IS NOT NULL',
  'ALTER TABLE "deal_rooms" ADD COLUMN IF NOT EXISTS "public_share_enabled_at" timestamptz',
  'ALTER TABLE "deal_rooms" ADD COLUMN IF NOT EXISTS "public_view_count" integer NOT NULL DEFAULT 0',

  // FW-WYNNE-1 (push-forward 2026-05-08): skip-trace permissible-purpose
  // gate. Adds purpose_of_use / justification / attesting_user_id /
  // attestation_version to skip_traces. Persisted for class-action defense
  // audit trail (FCRA §1681b(a)(3)).
  'ALTER TABLE "skip_traces" ADD COLUMN IF NOT EXISTS "purpose_of_use" text',
  'ALTER TABLE "skip_traces" ADD COLUMN IF NOT EXISTS "justification" text',
  'ALTER TABLE "skip_traces" ADD COLUMN IF NOT EXISTS "attesting_user_id" text',
  'ALTER TABLE "skip_traces" ADD COLUMN IF NOT EXISTS "attestation_version" text',

  // RS-5 (post-may1-resweep): email-on-new-location detector.
  // One row per (user, ipPrefix, uaFamily). Insert-on-conflict-bumps
  // last_seen_at; the first insert per tuple triggers an alert email.
  `CREATE TABLE IF NOT EXISTS "user_sign_in_locations" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "user_id" text NOT NULL,
     "ip_prefix" text NOT NULL,
     "ua_family" text NOT NULL,
     "country" text,
     "region" text,
     "first_seen_at" timestamptz NOT NULL DEFAULT now(),
     "last_seen_at" timestamptz NOT NULL DEFAULT now(),
     "notified_at" timestamptz,
     "session_count" integer NOT NULL DEFAULT 1
   )`,
  'CREATE UNIQUE INDEX IF NOT EXISTS "user_sign_in_locations_unique" ON "user_sign_in_locations" ("user_id", "ip_prefix", "ua_family")',
  'CREATE INDEX IF NOT EXISTS "user_sign_in_locations_user_last_seen_idx" ON "user_sign_in_locations" ("user_id", "last_seen_at")',

  // 2026-05-10 audit — autonomous_decisions audit-trail table. Promised
  // by server/jobs/autonomousHealthMonitor.ts:23 but never defined in
  // shared/schema.ts or any migrations/*.sql file. Without it the
  // documented "complete audit trail of what the system did on its own"
  // has no destination — self-healing actions silently no-op.
  // See migrations/0074_schema_drift_fix.sql for full context.
  `CREATE TABLE IF NOT EXISTS "autonomous_decisions" (
     "id"             serial PRIMARY KEY,
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE SET NULL,
     "actor"          text NOT NULL,
     "decision_type"  text NOT NULL,
     "subject_type"   text,
     "subject_id"     text,
     "rationale"      text NOT NULL,
     "input"          jsonb DEFAULT '{}'::jsonb NOT NULL,
     "outcome"        text NOT NULL DEFAULT 'pending',
     "outcome_detail" text,
     "reverted_at"    timestamp,
     "reverted_by"    text,
     "metadata"       jsonb DEFAULT '{}'::jsonb NOT NULL,
     "created_at"     timestamp NOT NULL DEFAULT now()
   )`,
  'CREATE INDEX IF NOT EXISTS "autonomous_decisions_org_created_idx" ON "autonomous_decisions" ("organization_id", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "autonomous_decisions_actor_created_idx" ON "autonomous_decisions" ("actor", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "autonomous_decisions_type_created_idx" ON "autonomous_decisions" ("decision_type", "created_at" DESC)',
  'CREATE INDEX IF NOT EXISTS "autonomous_decisions_outcome_idx" ON "autonomous_decisions" ("outcome") WHERE "outcome" IN (\'pending\', \'failure\')',

  // 2026-05-11 — campaigns.media_urls (migration 0075). MMS attachments
  // for SMS campaigns. text[] so we can stash multiple URLs even though
  // the UI gates to one for now.
  'ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "media_urls" text[]',

  // 2026-05-11 — migration-consolidation sweep. The following CREATE TABLE
  // blocks were previously executed by inline `pool.query()` calls in
  // server/index.ts at boot on every app/worker process. That created a
  // race condition (2 app machines + 1 worker firing the same DDL
  // concurrently against pgBouncer) and meant DDL ran on every restart
  // rather than per-release. Migrated here so this script is the single
  // authoritative migration path (Fly release_command). All are idempotent.

  // Cycle 12: organization_invitations + email deliverability tables.
  `CREATE TABLE IF NOT EXISTS "organization_invitations" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "email" text NOT NULL,
     "role" text NOT NULL DEFAULT 'member',
     "token" text UNIQUE,
     "invite_token_hash" text,
     "invite_token_last4" text,
     "invited_by_user_id" text,
     "status" text NOT NULL DEFAULT 'pending',
     "created_at" timestamp DEFAULT now() NOT NULL,
     "expires_at" timestamp NOT NULL,
     "accepted_at" timestamp,
     "accepted_by_user_id" text
   )`,
  `ALTER TABLE "organization_invitations" ADD COLUMN IF NOT EXISTS "invite_token_hash" text`,
  `ALTER TABLE "organization_invitations" ADD COLUMN IF NOT EXISTS "invite_token_last4" text`,
  `ALTER TABLE "organization_invitations" ALTER COLUMN "token" DROP NOT NULL`,
  `CREATE INDEX IF NOT EXISTS "idx_org_invitations_org_id" ON "organization_invitations" ("organization_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_org_invitations_email_status" ON "organization_invitations" ("email", "status")`,
  `CREATE INDEX IF NOT EXISTS "idx_org_invitations_token" ON "organization_invitations" ("token")`,
  `CREATE INDEX IF NOT EXISTS "idx_org_invitations_token_hash" ON "organization_invitations" ("invite_token_hash")`,

  `CREATE TABLE IF NOT EXISTS "email_events" (
     "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
     "email" text NOT NULL,
     "event" text NOT NULL,
     "sg_event_id" text UNIQUE,
     "sg_message_id" text,
     "timestamp" timestamptz,
     "reason" text,
     "status" text,
     "response" text,
     "metadata" jsonb,
     "created_at" timestamptz DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_email_events_email_created" ON "email_events" ("email", "created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_email_events_sg_event_id" ON "email_events" ("sg_event_id")`,

  `CREATE TABLE IF NOT EXISTS "email_suppressions" (
     "email" text PRIMARY KEY,
     "reason" text NOT NULL,
     "suppressed_at" timestamptz DEFAULT now() NOT NULL,
     "source" text
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_email_suppressions_source" ON "email_suppressions" ("source")`,

  // Renoir §1-§2: subscription_history (mirrors 0042_subscription_history.sql).
  `CREATE TABLE IF NOT EXISTS "subscription_history" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "event_type" text NOT NULL,
     "tier" text,
     "billing_interval" text,
     "price_cents" integer,
     "event_at" timestamp DEFAULT now() NOT NULL,
     "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_subscription_history_org_event_at" ON "subscription_history" ("organization_id", "event_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "idx_subscription_history_event_type" ON "subscription_history" ("event_type")`,

  // Phase A.0: simulated_actions (SIMULATION_MODE side-effect ledger).
  `CREATE TABLE IF NOT EXISTS "simulated_actions" (
     "id" serial PRIMARY KEY,
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
     "category" text NOT NULL,
     "action" text NOT NULL,
     "payload" jsonb,
     "simulated_id" text NOT NULL UNIQUE,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "idx_sim_actions_org_id" ON "simulated_actions" ("organization_id")`,
  `CREATE INDEX IF NOT EXISTS "idx_sim_actions_category_created" ON "simulated_actions" ("category", "created_at")`,

  // Founder letters — monthly narrative.
  `CREATE TABLE IF NOT EXISTS "founder_letters" (
     "id" serial PRIMARY KEY,
     "month_key" text NOT NULL UNIQUE,
     "letter_markdown" text NOT NULL,
     "summary_json" jsonb NOT NULL,
     "pending_founder_decision" text,
     "generated_at" timestamp DEFAULT now() NOT NULL,
     "delivered_at" timestamp,
     "status" text NOT NULL DEFAULT 'draft'
   )`,
  `CREATE INDEX IF NOT EXISTS "founder_letters_month_idx" ON "founder_letters" ("month_key")`,
  `CREATE INDEX IF NOT EXISTS "founder_letters_status_idx" ON "founder_letters" ("status")`,

  // Agent memory notes — weekly per-agent consolidation.
  `CREATE TABLE IF NOT EXISTS "agent_memory_notes" (
     "id" serial PRIMARY KEY,
     "agent_codename" text NOT NULL,
     "week_key" text NOT NULL,
     "patterns_learned" text NOT NULL,
     "wins" jsonb DEFAULT '[]'::jsonb,
     "losses" jsonb DEFAULT '[]'::jsonb,
     "self_recommendations" text,
     "decisions_analyzed" integer NOT NULL DEFAULT 0,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "agent_memory_notes_agent_idx" ON "agent_memory_notes" ("agent_codename", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "agent_memory_notes_week_idx" ON "agent_memory_notes" ("week_key")`,

  // Provider lookup log — per-lookup telemetry.
  `CREATE TABLE IF NOT EXISTS "provider_lookup_log" (
     "id" serial PRIMARY KEY,
     "provider_name" text NOT NULL,
     "category" text NOT NULL,
     "input_type" text NOT NULL,
     "success" boolean NOT NULL,
     "cached" boolean NOT NULL DEFAULT false,
     "latency_ms" integer,
     "cost_cents" integer DEFAULT 0,
     "error_code" text,
     "organization_id" integer REFERENCES "organizations"("id") ON DELETE CASCADE,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "provider_lookup_provider_idx" ON "provider_lookup_log" ("provider_name", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "provider_lookup_category_idx" ON "provider_lookup_log" ("category", "created_at")`,
  `CREATE INDEX IF NOT EXISTS "provider_lookup_created_idx" ON "provider_lookup_log" ("created_at")`,

  // Decision experiments — A/B framework at decision-policy layer.
  `CREATE TABLE IF NOT EXISTS "decision_experiments" (
     "id" serial PRIMARY KEY,
     "name" text NOT NULL UNIQUE,
     "description" text NOT NULL,
     "category" text NOT NULL,
     "item_type" text,
     "variants" jsonb NOT NULL,
     "success_metric" text NOT NULL,
     "status" text NOT NULL DEFAULT 'draft',
     "winning_variant" text,
     "founder_notes" text,
     "started_at" timestamp,
     "ended_at" timestamp,
     "created_at" timestamp DEFAULT now() NOT NULL,
     "updated_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "decision_experiments_status_idx" ON "decision_experiments" ("status")`,
  `CREATE INDEX IF NOT EXISTS "decision_experiments_category_idx" ON "decision_experiments" ("category")`,
  `CREATE INDEX IF NOT EXISTS "decision_experiments_item_type_idx" ON "decision_experiments" ("item_type")`,
  `CREATE TABLE IF NOT EXISTS "decision_experiment_assignments" (
     "id" serial PRIMARY KEY,
     "experiment_id" integer NOT NULL REFERENCES "decision_experiments"("id") ON DELETE CASCADE,
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "variant_key" text NOT NULL,
     "assigned_at" timestamp DEFAULT now() NOT NULL,
     "outcome_recorded" boolean NOT NULL DEFAULT false,
     "outcome_value" integer,
     "outcome_at" timestamp
   )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS "dea_experiment_org_unique" ON "decision_experiment_assignments" ("experiment_id", "organization_id")`,
  `CREATE INDEX IF NOT EXISTS "dea_experiment_idx" ON "decision_experiment_assignments" ("experiment_id")`,
  `CREATE INDEX IF NOT EXISTS "dea_variant_idx" ON "decision_experiment_assignments" ("variant_key")`,

  // Expansion candidates — weekly computed upsell-ready list.
  `CREATE TABLE IF NOT EXISTS "expansion_candidates" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "week_key" text NOT NULL,
     "current_tier" text NOT NULL,
     "proposed_tier" text NOT NULL,
     "score" integer NOT NULL,
     "signals" jsonb NOT NULL,
     "reasoning" text NOT NULL,
     "estimated_mrr_lift_cents" integer,
     "status" text NOT NULL DEFAULT 'proposed',
     "founder_notes" text,
     "resolved_at" timestamp,
     "resolved_by" text,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "expansion_candidates_week_idx" ON "expansion_candidates" ("week_key")`,
  `CREATE INDEX IF NOT EXISTS "expansion_candidates_status_idx" ON "expansion_candidates" ("status")`,
  `CREATE INDEX IF NOT EXISTS "expansion_candidates_org_idx" ON "expansion_candidates" ("organization_id")`,
  `CREATE INDEX IF NOT EXISTS "expansion_candidates_score_idx" ON "expansion_candidates" ("score")`,

  // Onboarding journeys + steps — Sophie's 30-day scripted activation sequence.
  `CREATE TABLE IF NOT EXISTS "onboarding_journeys" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL UNIQUE REFERENCES "organizations"("id") ON DELETE CASCADE,
     "started_at" timestamp DEFAULT now() NOT NULL,
     "current_step_key" text NOT NULL DEFAULT 'day0_welcome',
     "activation_status" text NOT NULL DEFAULT 'pending',
     "activation_determined_at" timestamp,
     "first_deal_at" timestamp,
     "first_lead_added_at" timestamp,
     "founder_flag" text,
     "notes" jsonb DEFAULT '{}'::jsonb,
     "created_at" timestamp DEFAULT now() NOT NULL,
     "updated_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "onboarding_journeys_status_idx" ON "onboarding_journeys" ("activation_status")`,
  `CREATE INDEX IF NOT EXISTS "onboarding_journeys_started_at_idx" ON "onboarding_journeys" ("started_at")`,
  `CREATE TABLE IF NOT EXISTS "onboarding_steps" (
     "id" serial PRIMARY KEY,
     "journey_id" integer NOT NULL REFERENCES "onboarding_journeys"("id") ON DELETE CASCADE,
     "step_key" text NOT NULL,
     "scheduled_at" timestamp NOT NULL,
     "fired_at" timestamp,
     "status" text NOT NULL DEFAULT 'scheduled',
     "outcome" jsonb DEFAULT '{}'::jsonb,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "onboarding_steps_journey_idx" ON "onboarding_steps" ("journey_id")`,
  `CREATE INDEX IF NOT EXISTS "onboarding_steps_scheduled_at_idx" ON "onboarding_steps" ("scheduled_at")`,
  `CREATE INDEX IF NOT EXISTS "onboarding_steps_status_idx" ON "onboarding_steps" ("status")`,

  // Customer letters — per-org monthly narrative (Sophie's voice).
  `CREATE TABLE IF NOT EXISTS "customer_letters" (
     "id" serial PRIMARY KEY,
     "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
     "month_key" text NOT NULL,
     "letter_markdown" text NOT NULL,
     "summary_json" jsonb NOT NULL,
     "recommended_action" text,
     "generated_at" timestamp DEFAULT now() NOT NULL,
     "delivered_at" timestamp,
     "opened_at" timestamp,
     "status" text NOT NULL DEFAULT 'draft'
   )`,
  `CREATE INDEX IF NOT EXISTS "customer_letters_org_month_idx" ON "customer_letters" ("organization_id", "month_key")`,
  `CREATE INDEX IF NOT EXISTS "customer_letters_status_idx" ON "customer_letters" ("status")`,

  // Tool proposals — agent-requested integrations / capabilities (founder-gated).
  `CREATE TABLE IF NOT EXISTS "tool_proposals" (
     "id" serial PRIMARY KEY,
     "proposed_by" text NOT NULL,
     "title" text NOT NULL,
     "description" text NOT NULL,
     "category" text NOT NULL,
     "capability_gap" text NOT NULL,
     "expected_benefit" text NOT NULL,
     "estimated_complexity" text NOT NULL DEFAULT 'medium',
     "estimated_impact_cents" integer,
     "supporting_evidence" jsonb,
     "status" text NOT NULL DEFAULT 'proposed',
     "founder_notes" text,
     "resolved_at" timestamp,
     "resolved_by" text,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "tool_proposals_status_idx" ON "tool_proposals" ("status")`,
  `CREATE INDEX IF NOT EXISTS "tool_proposals_category_idx" ON "tool_proposals" ("category")`,
  `CREATE INDEX IF NOT EXISTS "tool_proposals_proposed_by_idx" ON "tool_proposals" ("proposed_by")`,

  // Action previews — audit trail of auto-approved actions w/ cancel window.
  `CREATE TABLE IF NOT EXISTS "action_previews" (
     "id" serial PRIMARY KEY,
     "decision_id" integer,
     "agent_codename" text NOT NULL,
     "item_type" text NOT NULL,
     "action_summary" text NOT NULL,
     "action_reasoning" text,
     "action_payload" jsonb,
     "estimated_impact_cents" integer,
     "confidence" integer,
     "planned_at" timestamp DEFAULT now() NOT NULL,
     "commit_at" timestamp NOT NULL,
     "committed_at" timestamp,
     "cancelled_at" timestamp,
     "cancelled_by" text,
     "cancel_reason" text,
     "status" text NOT NULL DEFAULT 'pending',
     "execution_result" text
   )`,
  `CREATE INDEX IF NOT EXISTS "action_previews_status_idx" ON "action_previews" ("status")`,
  `CREATE INDEX IF NOT EXISTS "action_previews_commit_at_idx" ON "action_previews" ("commit_at")`,
  `CREATE INDEX IF NOT EXISTS "action_previews_decision_idx" ON "action_previews" ("decision_id")`,
  `CREATE INDEX IF NOT EXISTS "action_previews_agent_idx" ON "action_previews" ("agent_codename")`,

  // Founder settings — key-value operational knobs.
  `CREATE TABLE IF NOT EXISTS "founder_settings" (
     "id" serial PRIMARY KEY,
     "key" text NOT NULL UNIQUE,
     "value" text NOT NULL,
     "value_type" text NOT NULL DEFAULT 'string',
     "description" text,
     "category" text NOT NULL DEFAULT 'general',
     "updated_at" timestamp DEFAULT now() NOT NULL,
     "updated_by" text
   )`,
  `CREATE INDEX IF NOT EXISTS "founder_settings_key_idx" ON "founder_settings" ("key")`,
  `CREATE INDEX IF NOT EXISTS "founder_settings_category_idx" ON "founder_settings" ("category")`,

  // Strategic proposals — weekly per-agent + monthly synthesis.
  `CREATE TABLE IF NOT EXISTS "strategic_proposals" (
     "id" serial PRIMARY KEY,
     "proposed_by" text NOT NULL,
     "week_key" text NOT NULL,
     "month_key" text,
     "title" text NOT NULL,
     "rationale" text NOT NULL,
     "estimated_impact_cents" integer,
     "confidence" integer NOT NULL DEFAULT 50,
     "category" text NOT NULL,
     "supporting_data_keys" jsonb DEFAULT '[]'::jsonb,
     "status" text NOT NULL DEFAULT 'proposed',
     "founder_feedback" text,
     "resolved_at" timestamp,
     "resolved_by" text,
     "created_at" timestamp DEFAULT now() NOT NULL
   )`,
  `CREATE INDEX IF NOT EXISTS "strategic_proposals_week_idx" ON "strategic_proposals" ("week_key")`,
  `CREATE INDEX IF NOT EXISTS "strategic_proposals_month_idx" ON "strategic_proposals" ("month_key")`,
  `CREATE INDEX IF NOT EXISTS "strategic_proposals_status_idx" ON "strategic_proposals" ("status")`,
  `CREATE INDEX IF NOT EXISTS "strategic_proposals_proposed_by_idx" ON "strategic_proposals" ("proposed_by")`,

  // 2026-05-11 — feedback_submissions indexes (CREATE TABLE was unified
  // with the earlier in-app-widget definition above; only indexes needed
  // for the public-form triage flow).
  `CREATE INDEX IF NOT EXISTS "feedback_submissions_status_idx" ON "feedback_submissions" ("status")`,
  `CREATE INDEX IF NOT EXISTS "feedback_submissions_created_at_idx" ON "feedback_submissions" ("created_at" DESC)`,
  `CREATE INDEX IF NOT EXISTS "feedback_submissions_category_idx" ON "feedback_submissions" ("category")`,
];

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });

// 2026-05-04 (Workstream A.2 follow-on): the release_command had been
// failing prod deploys silently for ~3 days because 4 specific statements
// reference tables/columns/extensions that the prod DB doesn't have yet
// (audit_events table, properties.land_status column, email_events table,
// pgvector extension). Those failures cause the script to exit 1, which
// aborts the deploy.
//
// The right long-term fix is to add the missing CREATE TABLE / ALTER ADD
// COLUMN / etc. statements to this list so prod catches up. That's a
// founder-judgment call (which migrations to apply, in what order, with
// what risk window) — not a mechanical fix.
//
// Short-term unblock: classify failures.
//   - "expected dependency missing" (column/table/extension does not exist)
//     → log loudly but don't abort the deploy. The dependent index/feature
//     simply doesn't get added today; the deploy still ships.
//   - any other failure → fail loud as before (real schema bug or perms).
const EXPECTED_FAILURE_PATTERNS = [
  /column ".*" does not exist/i,
  /relation ".*" does not exist/i,
  /extension ".*" is not available/i,
];

let exitCode = 0;
const failures = [];
const skipped = [];

try {
  for (const stmt of STATEMENTS) {
    try {
      await pool.query(stmt);
      console.log(`[migrate] OK: ${stmt}`);
    } catch (err) {
      const isExpected = EXPECTED_FAILURE_PATTERNS.some((rx) => rx.test(err.message));
      if (isExpected) {
        console.warn(`[migrate] SKIPPED (dependency missing — non-fatal): ${stmt}\n  ${err.message}`);
        skipped.push({ stmt, message: err.message });
      } else {
        console.error(`[migrate] FAILED: ${stmt}\n  ${err.message}`);
        failures.push({ stmt, message: err.message });
        exitCode = 1;
      }
    }
  }
  if (skipped.length > 0) {
    console.warn(`[migrate] ${skipped.length} statement(s) skipped due to missing prerequisite. Apply the underlying migrations from migrations/*.sql, then re-deploy to add these.`);
  }
  if (failures.length > 0) {
    console.error(`[migrate] ${failures.length} statement(s) failed unexpectedly. Aborting deploy.`);
  }
} finally {
  await pool.end().catch(() => {});
}

process.exit(exitCode);
