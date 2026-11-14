-- 0311 — Settlement & Documents Rail (P1-3 core): money_events + recording_statuses.
--
-- WHAT CHANGES: two new org-scoped tables, the rail's shared records:
--   money_events        — the common payment-event ledger shape (sweep S-3)
--                         for money that arrives OUTSIDE the note ledger
--                         (assignment fees, redemptions, flip/lot proceeds).
--                         One shape instead of four bespoke received-records,
--                         so "money actually received this month" is one
--                         query across verticals. The rail RECORDS money
--                         that moved elsewhere (the user's own accounts,
--                         title/escrow, the county) — AcreOS custodies and
--                         moves no funds here or anywhere on the rail.
--   recording_statuses  — the recording-status component (sweep S-2): one
--                         status workflow (prepared → sent_for_recording →
--                         recorded / rejected) for every recordable
--                         instrument (lien release, deed, partial release),
--                         with the recorder's instrument number required by
--                         the service before a row may read `recorded`.
--
-- WHAT DOES NOT CHANGE: notes' own ledger (payments / payment_applications)
-- is untouched and does not write here. No existing table gains a column.
--
-- NUMBER NOTE: 0309 is claimed by two in-flight branches (uploaded_documents
-- on the doc-store branch #543, refund_requests on the refund-automation
-- branch #550); whichever lands second renumbers into 0310. The rail
-- therefore takes 0311 — the next number free under every landing order of
-- the Phase-0 queue. Renumbering at merge is normal if the queue moves.
--
-- SHAPE: flat idempotent statements (IF NOT EXISTS), as 0293/0305/0308.
CREATE TABLE IF NOT EXISTS "money_events" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('assignment_fee_received', 'redemption_received', 'flip_proceeds_received', 'lot_proceeds_received', 'note_payoff_received', 'other_received')),
  "vertical" text NOT NULL,
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "amount_cents" bigint NOT NULL CHECK ("amount_cents" > 0),
  "received_date" date NOT NULL,
  "source_name" text,
  "source_reference" text,
  "reconciles_against_type" text,
  "reconciles_against_id" text,
  "expected_amount_cents" bigint,
  "proof_document_ref" text,
  "notes" text,
  "recorded_by_user_id" varchar(255),
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "money_events_org_received_idx" ON "money_events" ("organization_id", "received_date");
CREATE INDEX IF NOT EXISTS "money_events_org_subject_idx" ON "money_events" ("organization_id", "subject_type", "subject_id");

CREATE TABLE IF NOT EXISTS "recording_statuses" (
  "id" serial PRIMARY KEY,
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "subject_kind" text NOT NULL CHECK ("subject_kind" IN ('lien_release', 'deed', 'partial_release', 'other_instrument')),
  "subject_type" text NOT NULL,
  "subject_id" text NOT NULL,
  "status" text NOT NULL DEFAULT 'prepared' CHECK ("status" IN ('prepared', 'sent_for_recording', 'recorded', 'rejected')),
  "county" text,
  "state" text,
  "instrument_number" text,
  "document_ref" text,
  "rejection_reason" text,
  "prepared_at" timestamptz NOT NULL DEFAULT now(),
  "sent_at" timestamptz,
  "recorded_at" timestamptz,
  "created_by_user_id" varchar(255),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "recording_statuses_org_subject_idx" ON "recording_statuses" ("organization_id", "subject_type", "subject_id");
CREATE INDEX IF NOT EXISTS "recording_statuses_org_status_idx" ON "recording_statuses" ("organization_id", "status");
