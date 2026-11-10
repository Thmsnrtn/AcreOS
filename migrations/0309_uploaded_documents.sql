-- 0309 — Deal document store (autonomy gap slice 5, register gap #2):
-- uploaded_documents, the customer's own PDFs attached to a deal, a property or
-- an acquired note. PROVISIONAL NUMBER — renumbered at merge if the slot moves.
CREATE TABLE IF NOT EXISTS "uploaded_documents" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "organization_id" integer NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "deal_id" integer REFERENCES "deals"("id") ON DELETE CASCADE,
  "property_id" integer REFERENCES "properties"("id") ON DELETE CASCADE,
  "acquired_note_id" uuid REFERENCES "acquired_notes"("id") ON DELETE CASCADE,
  "file_name" text NOT NULL CHECK (length(trim("file_name")) > 0),
  "content_type" text NOT NULL,
  "byte_size" integer NOT NULL CHECK ("byte_size" > 0),
  "storage_ref" text NOT NULL CHECK ("storage_ref" LIKE 's3://%'),
  "category" text,
  "uploaded_by" text NOT NULL CHECK (length(trim("uploaded_by")) > 0),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "uploaded_documents_exactly_one_parent"
    CHECK (num_nonnulls("deal_id", "property_id", "acquired_note_id") = 1)
);
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_deal_idx"
  ON "uploaded_documents" ("organization_id", "deal_id", "created_at");
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_property_idx"
  ON "uploaded_documents" ("organization_id", "property_id", "created_at");
CREATE INDEX IF NOT EXISTS "uploaded_documents_org_note_idx"
  ON "uploaded_documents" ("organization_id", "acquired_note_id", "created_at");
