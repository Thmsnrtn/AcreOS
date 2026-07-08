-- 0193 — Contract assignments (roadmap W6.1, 2026-07).
-- The wholesaler vertical's defining mechanic: the record linking the
-- original contract (deal) → end buyer → assignment fee → generated
-- assignment document. The dashboard previously proxied assignment revenue
-- with analysisResults.netProfit. Fee in INTEGER CENTS (W3.3 money rule).
-- Additive + idempotent.
CREATE TABLE IF NOT EXISTS "contract_assignments" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL,
  "deal_id" integer NOT NULL,
  "end_buyer_profile_id" integer,
  "end_buyer_name" text,
  "assignment_fee_cents" bigint NOT NULL DEFAULT 0,
  "original_contract_date" date,
  "generated_document_id" integer,
  "status" text NOT NULL DEFAULT 'draft',
  "notes" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "contract_assignments_org_deal_idx" ON "contract_assignments" ("organization_id", "deal_id");
CREATE INDEX IF NOT EXISTS "contract_assignments_status_idx" ON "contract_assignments" ("organization_id", "status");
