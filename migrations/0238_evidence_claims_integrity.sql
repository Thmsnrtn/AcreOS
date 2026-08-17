-- ============================================================================
-- 0238 — evidence_claims: make the contract a constraint
--        (2026-08-17)
-- ----------------------------------------------------------------------------
-- shared/schema/evidence.ts declares "APPEND-ONLY BY CONTRACT" and argues it
-- exactly right: "a row that can be updated is a row whose history can be
-- rewritten." Nothing enforced it. The table shipped (0227) with ZERO
-- constraints: `subject_type`, `predicate`, `value_kind` and `authority` are
-- bare `text`, so `authority = 'guess'` inserted cleanly, and the only thing
-- standing behind the immutability promise was the ABSENCE of an `updated_at`
-- column — a convention, not a rule.
--
-- That promise is load-bearing. shared/evidence/claim.ts stakes Law 6
-- (historical decisions preserve what was known at the time) on these rows
-- never changing, and decisionStore.ts freezes RESOLUTION_POLICY_VERSION into
-- snapshots on the same assumption. An UPDATE would silently rewrite the
-- evidentiary basis of a decision already made and already defended.
--
-- The vocabularies below are copied from the TypeScript, which stays the source
-- of truth: EVIDENCE_SUBJECT_TYPES, EvidenceAuthority and EvidenceValueKind in
-- shared/evidence/claim.ts. evidenceClaimsIntegrity.test.ts fails if the two
-- ever drift, so this cannot rot into a stale second definition.

-- ── Closed vocabularies ─────────────────────────────────────────────────────
-- NOT VALID on purpose: the constraint binds every future write immediately,
-- but does not re-scan existing rows. No session has had DATABASE_URL, so no
-- one can say what is already in the table; a plain ADD CONSTRAINT would
-- validate on deploy and take the release down if a single legacy row
-- disagreed. Run `VALIDATE CONSTRAINT` later, once the existing rows have
-- actually been looked at. Enforcing forwards is the part that cannot wait.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_claims_subject_type_chk') THEN
    ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_subject_type_chk"
      CHECK ("subject_type" IN ('property', 'parcel', 'party')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_claims_authority_chk') THEN
    ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_authority_chk"
      CHECK ("authority" IN ('authoritative', 'estimate', 'modeled', 'unknown')) NOT VALID;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_claims_value_kind_chk') THEN
    ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_value_kind_chk"
      CHECK ("value_kind" IN ('string', 'number', 'boolean', 'enum')) NOT VALID;
  END IF;
END $$;

-- ── Value coherence ─────────────────────────────────────────────────────────
-- Derived from the READER (evidenceStore.ts:89-93), which selects the column by
-- value_kind, and checked against the WRITER (:73-76).
--
-- Note what this deliberately does NOT say: "exactly one value column is
-- populated". The writer sets `value_text = String(v)` ALONGSIDE value_number /
-- value_bool as a human-readable rendering, so an exactly-one rule would refuse
-- the live write path on its very next insert. The real invariant is weaker and
-- true: whichever column value_kind names must carry the assertion.
--
-- All three NULL stays legal and is not an oversight — it is evidence of
-- ABSENCE, the record that a source was asked and returned nothing, which
-- Law 3 requires be preserved rather than collapsed to zero or false.

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'evidence_claims_value_coherence_chk') THEN
    ALTER TABLE "evidence_claims" ADD CONSTRAINT "evidence_claims_value_coherence_chk"
      CHECK (
        ("value_text" IS NULL AND "value_number" IS NULL AND "value_bool" IS NULL)
        OR ("value_kind" = 'number'  AND "value_number" IS NOT NULL)
        OR ("value_kind" = 'boolean' AND "value_bool"   IS NOT NULL)
        OR ("value_kind" IN ('string', 'enum') AND "value_text" IS NOT NULL)
      ) NOT VALID;
  END IF;
END $$;

-- ── Append-only, enforced ───────────────────────────────────────────────────
-- UPDATE is refused. DELETE is NOT, and that asymmetry is the whole design:
--
--   * UPDATE rewrites history in place. There is no legitimate caller — a
--     correction is a NEWER claim that out-ranks the old one under the
--     resolution policy, which is the mechanism the fabric is built on.
--     Measured: zero UPDATE call sites against this table anywhere in server/.
--
--   * DELETE is erasure, which is a different act and a lawful one.
--     evidence_claims.organization_id carries ON DELETE CASCADE, so refusing
--     DELETE would make deleting an organization impossible, and would put the
--     table permanently out of reach of a GDPR erasure path. Foundry's
--     equivalent ledger blocks both; AcreOS must not, and copying it wholesale
--     would have created an unerasable store of third-party personal data.
--
-- Forgetting a fact and rewriting it are not the same operation.

CREATE OR REPLACE FUNCTION "evidence_claims_refuse_update"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION
    'evidence_claims is append-only: UPDATE refused on claim id=%. Record a NEW claim; the resolution policy in shared/evidence/claim.ts ranks it above the older one. (Law 6: a decision already made must keep the evidence it was made on.)',
    OLD."id";
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "evidence_claims_no_update" ON "evidence_claims";
CREATE TRIGGER "evidence_claims_no_update"
  BEFORE UPDATE ON "evidence_claims"
  FOR EACH ROW EXECUTE FUNCTION "evidence_claims_refuse_update"();
