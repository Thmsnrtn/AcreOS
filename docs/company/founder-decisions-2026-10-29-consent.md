# Founder decision — 2026-10-29 (consent evidence)

Recorded in the repository on 2026-11-03, from the G8 messaging proof pass
(§B1 nuance, "DECIDED 2026-10-29"). Tom chose the recommended option at
17:48 EDT. Implementation waited behind the Tax lane until T4b (#425) merged.

1. **Consent grants are recorded per channel.** A grant writes one
   `lead_consent_events` row for each channel it actually grants. It never
   writes one bundled row claiming channels that were not separately
   captured. The decision changes only how grants are recorded, not who may
   be contacted: no send gate changes. Historical bundled rows are evidence
   and stay as written.

## Implementation readings (not founder decisions — open to overrule)

- **What a `tcpaConsent` grant covers.** Every current grant writer has one
  piece of consent evidence: the `tcpaConsent` boolean. Those writers are
  lead create, the consent PATCH and the SMS opt-in keyword. That boolean is
  consent to be texted or called. It is not consent to email (decision
  2026-10-20 #2) and not to direct mail, which needs no consent. So each
  writer records `sms` and `phone` rows only (`TCPA_CONSENT_CHANNELS`, pinned
  equal to `requiresTcpaConsent`). Recording all four channels as four rows
  is a one-line change if that reading is overruled.
- **Revocations stay bundled.** A STOP revokes every channel (open question
  from 2026-10-20). Revocation rows are untouched.
