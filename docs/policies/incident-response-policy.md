# Incident Response Policy

**Policy owner:** Founder
**Last reviewed:** 2026-05-27
**Review cadence:** Annual + after every Sev-1/2 incident
**Audience:** SOC 2 Type II (CC7.3, CC7.4, CC7.5), cyber underwriting.

The *procedure* lives in `docs/incident-response.md` and the 30+ runbooks in
`docs/runbooks/`. This document is the *policy* that authorizes them and
defines roles, severities, and timelines.

---

## 1. Purpose

Defines how AcreOS detects, declares, investigates, communicates, and
remediates security and availability incidents.

## 2. Scope

Any unplanned event that affects (or threatens) the confidentiality,
integrity, or availability of customer data or production systems.

## 3. Severity classifications

| Sev | Definition | Page founder? | Customer notification |
|---|---|---|---|
| Sev-1 | Confirmed data breach OR core platform unavailable OR active attack | Yes, immediately | Within 72 hours of confirmation |
| Sev-2 | Significant degradation (>10% of traffic affected) OR suspected breach | Yes, within 1h | If material to customers |
| Sev-3 | Localized degradation OR security finding without active exploitation | Next business day | If material |
| Sev-4 | Operational anomaly worth investigating | Next business day | Usually no |

## 4. Roles

- **Incident Commander (IC):** founder by default; first responder named
  if founder is unavailable. Owns the call, makes the rollback/escalate
  decision, owns customer comms.
- **Scribe:** records the timeline in the incident channel (or
  `docs/runbooks/incident-YYYY-MM-DD-<slug>.md` if no channel exists).
- **Subject-matter experts:** drawn from the affected runbook owners.

Today the founder fills all three roles. See `docs/separation-of-duties.md`
for the material-weakness acknowledgement and `runbooks/08-founder-out-of-office.md`
for the founder-unavailable path.

## 5. Lifecycle

1. **Detect** — Sentry, Datadog, customer report, or a runbook-driven check.
2. **Declare** — assign severity, name an IC, open an incident timeline.
3. **Stabilize** — execute the relevant runbook(s); rollback before
   debugging when possible.
4. **Investigate** — root-cause analysis once stable.
5. **Communicate** — internal updates on a documented cadence (15 min for
   Sev-1, 1h for Sev-2, daily for Sev-3); customer notifications per §3.
6. **Resolve** — declare resolution when production is stable and the
   underlying root cause is identified.
7. **Postmortem** — produce a postmortem within 5 business days using
   `docs/runbooks/_postmortem-template.md`. Sev-1/2 postmortems are
   reviewed at the next access-review window.

## 6. Customer notification

For confirmed data breaches involving customer PII, notification is sent
within **72 hours** of confirmation, in compliance with:

- AcreOS's customer-facing DPA commitment (72-hour window)
- GDPR Article 33 (72-hour window for the supervisory authority)
- US state laws (some are more restrictive — California is 72 hours;
  some are immediate). We default to the strictest applicable timeline.

Notification template lives at `docs/runbooks/data-breach-response.md`.

## 7. Evidence

Every Sev-1/2 incident produces:

- A timestamped timeline (logs + Sentry events + manual notes).
- One or more `audit_events` rows tagged `incident.*`.
- A postmortem document committed to the repo.
- A `deployments` row if a deploy was used for remediation.

Retained for 7 years (regulatory minimum for some breach-notification
laws). Stored in source control + S3 backup, both encrypted.

## 8. Training and tabletop

Tabletop exercises happen annually using
`docs/policies/incident-response-tabletop-template.md`. Founder runs
solo until headcount > 1.

## 9. Related documents

- `docs/incident-response.md` (operational procedure)
- `docs/runbooks/_postmortem-template.md`
- `docs/runbooks/data-breach-response.md`
- `docs/policies/incident-response-tabletop-template.md`
