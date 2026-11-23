-- 0314 — CG-1: Cause Giving data foundation (spec §2; founder calls
-- FC-CG-1/2/3 all DECIDED 2026-11-20).
--
-- Twelve new tables for the program that donates 1% of quarterly Net
-- Operating Profit to a curated charity ballot, allocated by member tally.
-- The program's only money is AcreOS's own: NO table here stores, moves, or
-- references member funds. Member identity appears only on tally-
-- attribution rows (selections, selection events, nominations) — never on
-- a money row (allocations/disbursements reference causes + quarters only).
--
-- Seeds: the 6 spec §8 categories and the 13 approved ballot charities,
-- every charity as status 'candidate' with agreement 'none' — a cause
-- reaches 'ballot' only via a complete passing vetting record AND an
-- executed agreement (spec §1.6), so the seed deliberately does NOT mark
-- any charity ballot. The `cause_giving` feature flag is seeded OFF
-- (enabled=false, state='off'): nothing in this feature is reachable,
-- founder included, until the §5 activation checklist completes.
--
-- All additive + idempotent; no existing table is touched. Mirrored
-- statement for statement in scripts/migrate.mjs.

CREATE TABLE IF NOT EXISTS "cause_categories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "key" text NOT NULL,
  "display_name" text NOT NULL,
  "sort_order" integer NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_categories_key_unique" UNIQUE ("key"),
  CONSTRAINT "cause_categories_key_check" CHECK (length(trim(key)) > 0)
);

CREATE TABLE IF NOT EXISTS "causes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "legal_name" text NOT NULL,
  "display_name" text,
  "ein" text NOT NULL,
  "category_id" uuid NOT NULL REFERENCES "cause_categories"("id"),
  "display_blurb" text,
  "status" text NOT NULL DEFAULT 'candidate',
  "status_reason" text,
  "removal_trigger_code" text,
  "agreement_state" text NOT NULL DEFAULT 'none',
  "added_via" text NOT NULL DEFAULT 'seed',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "causes_ein_unique" UNIQUE ("ein"),
  CONSTRAINT "causes_status_check" CHECK (status IN ('candidate', 'vetted', 'ballot', 'suspended', 'removed')),
  CONSTRAINT "causes_agreement_state_check" CHECK (agreement_state IN ('none', 'sent', 'executed')),
  CONSTRAINT "causes_added_via_check" CHECK (added_via IN ('seed', 'nomination')),
  CONSTRAINT "causes_removal_trigger_check" CHECK (removal_trigger_code IS NULL OR removal_trigger_code IN ('loss_of_tax_exempt_status', 'auto_revocation', 'fraud_finding', 'sanctions_listing'))
);
CREATE INDEX IF NOT EXISTS "causes_category_idx" ON "causes" ("category_id");
CREATE INDEX IF NOT EXISTS "causes_status_idx" ON "causes" ("status");

CREATE TABLE IF NOT EXISTS "cause_vetting_records" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "cause_id" uuid NOT NULL REFERENCES "causes"("id"),
  "teos_checked_at" timestamp with time zone,
  "teos_result" text,
  "teos_snapshot_ref" text,
  "form990_period" text,
  "form990_reviewed_at" timestamp with time zone,
  "solicitation_check_result" text,
  "sanctions_check_result" text,
  "reviewed_by" text NOT NULL,
  "outcome" text NOT NULL,
  "notes" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_vetting_records_outcome_check" CHECK (outcome IN ('pass', 'fail', 'incomplete'))
);
CREATE INDEX IF NOT EXISTS "cause_vetting_records_cause_idx" ON "cause_vetting_records" ("cause_id", "created_at");

CREATE TABLE IF NOT EXISTS "member_cause_selections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "member_user_id" text NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "cause_id" uuid NOT NULL REFERENCES "causes"("id"),
  "set_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "member_cause_selections_member_unique" UNIQUE ("organization_id", "member_user_id")
);
CREATE INDEX IF NOT EXISTS "member_cause_selections_cause_idx" ON "member_cause_selections" ("cause_id");
CREATE INDEX IF NOT EXISTS "member_cause_selections_org_cause_idx" ON "member_cause_selections" ("organization_id", "cause_id");

CREATE TABLE IF NOT EXISTS "member_cause_selection_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "member_user_id" text NOT NULL,
  "from_cause_id" uuid REFERENCES "causes"("id"),
  "to_cause_id" uuid REFERENCES "causes"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "member_cause_selection_events_member_idx" ON "member_cause_selection_events" ("organization_id", "member_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "cause_nominations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "nominator_user_id" text NOT NULL,
  "charity_legal_name" text NOT NULL,
  "ein" text,
  "website" text,
  "note" text,
  "status" text NOT NULL DEFAULT 'pending',
  "decline_reason" text,
  "decided_by" text,
  "decided_at" timestamp with time zone,
  "resulting_cause_id" uuid REFERENCES "causes"("id"),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_nominations_status_check" CHECK (status IN ('pending', 'approved', 'declined'))
);
CREATE INDEX IF NOT EXISTS "cause_nominations_status_idx" ON "cause_nominations" ("status", "created_at");
CREATE INDEX IF NOT EXISTS "cause_nominations_org_status_idx" ON "cause_nominations" ("organization_id", "status", "created_at");

CREATE TABLE IF NOT EXISTS "cause_giving_quarters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "year" integer NOT NULL,
  "quarter" integer NOT NULL,
  "period_start" date NOT NULL,
  "period_end" date NOT NULL,
  "status" text NOT NULL DEFAULT 'open',
  "revenue_cents" integer,
  "expense_cents" integer,
  "definition_version" text,
  "founder_call_treatment" text,
  "computed_base_cents" integer,
  "pool_cents" integer,
  "snapshot_taken_at" timestamp with time zone,
  "paying_members_at_snapshot" integer,
  "members_with_selection_at_snapshot" integer,
  "published_entry_id" uuid,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_giving_quarters_period_unique" UNIQUE ("year", "quarter"),
  CONSTRAINT "cause_giving_quarters_quarter_check" CHECK (quarter BETWEEN 1 AND 4),
  CONSTRAINT "cause_giving_quarters_status_check" CHECK (status IN ('open', 'snapshotted', 'allocated', 'disbursing', 'reported')),
  CONSTRAINT "cause_giving_quarters_base_check" CHECK (computed_base_cents IS NULL OR computed_base_cents >= 0),
  CONSTRAINT "cause_giving_quarters_pool_check" CHECK (pool_cents IS NULL OR pool_cents >= 0)
);

CREATE TABLE IF NOT EXISTS "cause_quarter_snapshots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quarter_id" uuid NOT NULL REFERENCES "cause_giving_quarters"("id"),
  "cause_id" uuid NOT NULL REFERENCES "causes"("id"),
  "votes" integer NOT NULL,
  "share_pct" numeric(7,4) NOT NULL DEFAULT 0,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_quarter_snapshots_quarter_cause_unique" UNIQUE ("quarter_id", "cause_id"),
  CONSTRAINT "cause_quarter_snapshots_votes_check" CHECK (votes >= 0)
);

CREATE TABLE IF NOT EXISTS "cause_allocations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quarter_id" uuid NOT NULL REFERENCES "cause_giving_quarters"("id"),
  "cause_id" uuid NOT NULL REFERENCES "causes"("id"),
  "allocated_cents" integer NOT NULL DEFAULT 0,
  "carryforward_in_cents" integer NOT NULL DEFAULT 0,
  "disbursable_cents" integer NOT NULL DEFAULT 0,
  "carryforward_out_cents" integer NOT NULL DEFAULT 0,
  "disposition" text,
  "redistribution_from_cause_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "redistribution_to_cause_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_allocations_quarter_cause_unique" UNIQUE ("quarter_id", "cause_id"),
  CONSTRAINT "cause_allocations_disposition_check" CHECK (disposition IS NULL OR disposition IN ('disbursed', 'rolled', 'redistributed-out', 'redistributed-in', 'unpayable-held')),
  CONSTRAINT "cause_allocations_amounts_check" CHECK (allocated_cents >= 0 AND carryforward_in_cents >= 0 AND disbursable_cents >= 0 AND carryforward_out_cents >= 0)
);
CREATE INDEX IF NOT EXISTS "cause_allocations_cause_idx" ON "cause_allocations" ("cause_id");

CREATE TABLE IF NOT EXISTS "cause_disbursements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "allocation_id" uuid NOT NULL REFERENCES "cause_allocations"("id"),
  "amount_cents" integer NOT NULL,
  "disbursed_on" date NOT NULL,
  "method" text NOT NULL,
  "external_ref" text,
  "ack_state" text NOT NULL DEFAULT 'pending',
  "ack_document_ref" text,
  "unpayable_attempt_log" jsonb,
  "ledger_event_ref" text,
  "recorded_by" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "cause_disbursements_amount_check" CHECK (amount_cents > 0),
  CONSTRAINT "cause_disbursements_method_check" CHECK (method IN ('ach', 'check', 'dafy-grant')),
  CONSTRAINT "cause_disbursements_ack_check" CHECK (ack_state IN ('pending', 'received'))
);
CREATE INDEX IF NOT EXISTS "cause_disbursements_allocation_idx" ON "cause_disbursements" ("allocation_id");

CREATE TABLE IF NOT EXISTS "cause_report_entries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "quarter_id" uuid NOT NULL REFERENCES "cause_giving_quarters"("id"),
  "published_at" timestamp with time zone NOT NULL DEFAULT now(),
  "published_by" text NOT NULL,
  "content" jsonb NOT NULL,
  "rendered_body" text NOT NULL,
  "definition_version" text NOT NULL,
  "disclosure_version" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cause_report_entries_quarter_idx" ON "cause_report_entries" ("quarter_id");

CREATE TABLE IF NOT EXISTS "cause_report_corrections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "entry_id" uuid NOT NULL REFERENCES "cause_report_entries"("id"),
  "published_at" timestamp with time zone NOT NULL DEFAULT now(),
  "published_by" text NOT NULL,
  "text" text NOT NULL,
  "reason" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "cause_report_corrections_entry_idx" ON "cause_report_corrections" ("entry_id");

-- Seeds: the 6 spec §8 categories.
INSERT INTO "cause_categories" ("key", "display_name", "sort_order") VALUES
  ('housing_homelessness', 'Housing & homelessness', 1),
  ('disaster_relief', 'Disaster relief', 2),
  ('veterans_housing', 'Veterans'' housing', 3),
  ('financial_literacy_first_home', 'Financial literacy / first-home access', 4),
  ('community_development', 'Community development', 5),
  ('environment', 'Environment', 6)
ON CONFLICT ("key") DO NOTHING;

-- Seeds: the 13 §8 ballot charities (FC-CG-3, approved as drafted) — all
-- 'candidate', agreement 'none', added via 'seed'. National parent EINs only.
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Habitat for Humanity International Inc', NULL, '91-1914868', (SELECT "id" FROM "cause_categories" WHERE "key" = 'housing_homelessness'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Rebuilding Together Inc', NULL, '52-1585880', (SELECT "id" FROM "cause_categories" WHERE "key" = 'housing_homelessness'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('National Alliance to End Homelessness', NULL, '52-1299641', (SELECT "id" FROM "cause_categories" WHERE "key" = 'housing_homelessness'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Team Rubicon Inc', NULL, '27-1720480', (SELECT "id" FROM "cause_categories" WHERE "key" = 'disaster_relief'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Direct Relief', NULL, '95-1831116', (SELECT "id" FROM "cause_categories" WHERE "key" = 'disaster_relief'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Homes For Our Troops Inc', NULL, '54-2143612', (SELECT "id" FROM "cause_categories" WHERE "key" = 'veterans_housing'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Gary Sinise Foundation', NULL, '80-0587086', (SELECT "id" FROM "cause_categories" WHERE "key" = 'veterans_housing'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Neighborhood Reinvestment Corporation', 'NeighborWorks America', '52-1148078', (SELECT "id" FROM "cause_categories" WHERE "key" = 'financial_literacy_first_home'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('National Foundation for Credit Counseling Inc', NULL, '53-0132493', (SELECT "id" FROM "cause_categories" WHERE "key" = 'financial_literacy_first_home'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Local Initiatives Support Corporation', 'LISC', '13-3030229', (SELECT "id" FROM "cause_categories" WHERE "key" = 'community_development'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('Enterprise Community Partners Inc', NULL, '52-1231931', (SELECT "id" FROM "cause_categories" WHERE "key" = 'community_development'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('The Nature Conservancy', NULL, '53-0242652', (SELECT "id" FROM "cause_categories" WHERE "key" = 'environment'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;
INSERT INTO "causes" ("legal_name", "display_name", "ein", "category_id", "status", "agreement_state", "added_via") VALUES ('National Arbor Day Foundation', NULL, '23-7169265', (SELECT "id" FROM "cause_categories" WHERE "key" = 'environment'), 'candidate', 'none', 'seed') ON CONFLICT ("ein") DO NOTHING;

-- Seed the feature flag OFF. ON CONFLICT DO NOTHING — a row the founder
-- has since flipped stays as the founder left it.
INSERT INTO "platform_feature_flags" ("key", "label", "description", "enabled", "state", "audience", "controlled_routes")
 VALUES ('cause_giving', 'Cause Giving', 'Quarterly donation of 1% of Net Operating Profit to the curated charity ballot, allocated by member tally. OFF until the activation checklist completes and the founder flips it.', false, 'off', '{}'::jsonb, '[]'::jsonb)
 ON CONFLICT ("key") DO NOTHING;
