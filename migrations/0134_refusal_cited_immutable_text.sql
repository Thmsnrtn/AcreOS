-- ============================================================================
-- 0133 — Quinn (Chief of Alignment) — refusal payload plain-language snapshot.
-- ----------------------------------------------------------------------------
-- Adds `cited_immutable_text` to pax_refusal_payloads: the PLAIN-LANGUAGE
-- wording of the cited immutable, snapshotted at write time.
--
-- Why (alignment lens): the refusal payload is the substrate the customer
-- appeals against (EU AI Act Art. 86 — the right to a clear, meaningful
-- explanation). Today a refusal stores only the canonical id ("customer:N").
-- The future appeal UI would have to re-derive the wording from the id at
-- render time — and a later constitutional amendment that changes the wording
-- would then retroactively alter what a PAST refusal appears to have told the
-- customer. Snapshotting the text at write time freezes the explanation the
-- customer actually received, so the appeal record stays faithful forever.
--
-- Nullable: the id may not resolve to a known immutable (defensive), and
-- legacy rows predate the column.
--
-- Mirrors shared/schema/pax-refusal-payloads.ts + scripts/migrate.mjs.
-- Additive + idempotent.
-- ============================================================================

ALTER TABLE "pax_refusal_payloads"
  ADD COLUMN IF NOT EXISTS "cited_immutable_text" text;
