-- ============================================================================
-- 0136 — Quinn (Chief of Alignment) + Rafe (CCO) — appeal customer-facing outcome.
-- ----------------------------------------------------------------------------
-- Adds `customer_message` to pax_decision_appeals: the PLAIN-LANGUAGE outcome
-- wording surfaced back to the CUSTOMER when an appeal is resolved (upheld |
-- reversed) — shown in their Pax thread and the close-the-loop email.
--
-- Why (the "appeal the AI" loop close, EU AI Act Art. 86): the recourse loop
-- is only honest if it closes back to the customer. `review_notes` already
-- holds the reviewer's INTERNAL rationale; that text is not written for the
-- customer and may name internal process. `customer_message` keeps the two
-- separate so the internal reasoning and the customer-facing wording can never
-- blur into each other — a reviewer can be candid in review_notes while the
-- customer always receives a calm, plain-language outcome.
--
-- Nullable: only set on resolution; open / under_review rows leave it NULL.
--
-- Mirrors shared/schema/pax-decision-appeals.ts + scripts/migrate.mjs.
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE "pax_decision_appeals"
  ADD COLUMN IF NOT EXISTS "customer_message" text;
