# `signing_consent_audit` — leading-index review

**Reviewer:** Beatrice (CRO) — compliance, legal, security, AI safety
**Date:** 2026-06-06
**Trigger:** Tahoe wave E2/E9 — Quinn flagged that `signing_consent_audit`
appears in the L3 lint baseline allowlist (its current indexes lead on
`user_id` and `signer_email`, not `organization_id`).

## Recommendation

**Defer for now; add `(organization_id, consented_at)` as an additive index
when the next signing-consent-touching wave ships.** The current indexes
are correctly tuned for the dominant read pattern (regulator lookup by
`signer_email + document_id`, and per-user consent retrieval by `user_id`).
Adding a leading-org composite would be a purely-additive change — no
existing query plan would degrade — but doing it in isolation buys little
because no current query joins consent rows by `(organization_id, ...)`.

The right time to add it: when the customer-facing transparency surface or
the per-org compliance dashboard ships and needs to enumerate "every
signing consent my org has captured this quarter." At that point the new
`(organization_id, consented_at)` index becomes the dominant query path and
the lint ratchet can tighten by removing `signing_consent_audit` from
`BASELINE_OFFENDERS`.

## Posture notes for next reviewer

- The table's regulatory function is per-signer, not per-org — a regulator
  subpoenas a single signer's consent trail, not "every consent in org X."
  That's WHY the existing indexes lead on `user_id` and `signer_email`, and
  it remains correct for the regulatory path.
- The `(signer_email, document_id)` composite already gives us the external-
  signer lookup at index speed. The `(user_id)` composite gives us the
  authenticated-user lookup.
- The Tahoe shard-readiness posture is about routability under tenant
  isolation. For `signing_consent_audit`, every row's `organization_id` is
  also recoverable via a single JOIN (consent → document → org), so the
  routability argument is weaker here than for tables where org isolation
  is the only access vector.

## Action

- Keep `signing_consent_audit` in `BASELINE_OFFENDERS` of
  `scripts/check-org-leading-index.mjs`.
- When the next signing-consent-touching wave ships, add the additive
  `(organization_id, consented_at)` index in the same PR and remove from
  the allowlist.
- This document remains the audit trail for the deferral so a future
  reviewer doesn't re-litigate from scratch.

— Beatrice
