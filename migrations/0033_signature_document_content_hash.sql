-- R2: Tamper-evidence for native e-signatures
-- Adds a SHA-256 hash of the document content at signing time so that
-- any later mutation of `generated_documents.content` is detectable.
-- See server/routes-doc-system.ts (POST /api/signatures) and the
-- companion immutability guard on PUT /api/generated-documents/:id.

ALTER TABLE "signatures"
  ADD COLUMN IF NOT EXISTS "document_content_hash" text;
