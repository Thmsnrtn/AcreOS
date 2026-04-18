# Lenses 141--150 -- Launch-Readiness Meta Audit

**Auditor persona:** Launch-readiness reviewer (documentation, operations, disaster recovery, regulatory, incident management)
**Date:** 2026-04-18
**Scope:** Documentation completeness, runbook coverage, disaster recovery, data-loss recovery, key leak recovery, incident communication, status page, data portability, regulatory audit readiness, post-mortem framework
**Tier:** 3

---

## Executive Summary

AcreOS has significantly more operational documentation than a typical early-stage SaaS: a 59 KB Owner's Manual, 10 ADRs, 9 dedicated runbooks, a disaster recovery plan with RTO/RPO targets, an incident response plan, a security hardening guide with key rotation procedures, and a launch-day checklist. The material quantity is strong. The gaps are in accuracy (README describes wrong auth system, docs contradict each other on table counts and rate limits), completeness (GDPR export truncates at 1000 records, anonymization misses several tables), regulatory formality (missing CCPA-specific disclosures, placeholder address in legal pages, no DPA for customers), and operational infrastructure that is referenced but does not exist (status.acreos.com, PagerDuty, Slack #incidents channel). Most findings are P2/P3 (missing ops artifacts that should exist before scaling). P1 findings are reserved for legally-required items and data-loss risks.

---

## Lens 141 -- Documentation Completeness

### F141-01 -- README describes wrong auth system (P2, cross-ref Lens 47-P1-01)

**Files:** `/README.md` lines 73, 88
**Evidence:** README states "Passport-local with bcrypt password hashing" and "express-session (PostgreSQL-backed via connect-pg-simple)." Actual auth is Clerk with Google OAuth (`server/auth/clerkAuth.ts`). A new developer following the README would never configure Clerk and would be unable to authenticate.
**Cross-ref:** Lens 47-P1-01 already captured this as P1 from a developer-experience perspective. From a launch-readiness standpoint this is P2 because the live product is not affected -- only developer onboarding suffers.

### F141-02 -- README omits Clerk and Redis from required dependencies (P2, cross-ref Lens 47-P1-02/03)

**Files:** `/README.md` lines 53--60
**Evidence:** Required env vars section lists only `DATABASE_URL`, `SESSION_SECRET`, `FOUNDER_EMAILS`. Missing: `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`, `REDIS_URL` -- all marked REQUIRED in `.env.example`.
**Impact:** Fresh checkout will not boot. Docker compose partially works (includes Redis) but still misses Clerk.

### F141-03 -- API documentation covers ~3% of surface (P3)

**Files:** `/server/openapi-spec.ts`, `/docs/api-reference.md`
**Evidence:** OpenAPI spec defines 29 path entries. Orientation doc counts 926 endpoints. The Swagger UI at `/api/docs` gives a false sense of completeness. The `api-reference.md` also references "Replit OAuth" which is stale.
**Impact:** Partner integrations, support, and internal debugging are hampered. Not a launch blocker but a scaling problem.

### F141-04 -- Owner's Manual references defunct "Continue with Replit" auth flow (P3, cross-ref Lens 47-P1-05)

**Files:** `/docs/OWNERS-MANUAL.md` lines 39, 1331
**Evidence:** User-facing manual instructs users to authenticate via Replit. Actual flow is Clerk/Google OAuth.
**Impact:** End-user confusion, support load increase.

### F141-05 -- Architecture docs and developer guide contradict orientation on table count (P3)

**Files:** `/docs/developer-guide.md` line 68
**Evidence:** Developer guide says "~220 tables." Orientation doc counts 429.
**Impact:** Misleading for capacity planning and DB migration estimation.

---

## Lens 142 -- Runbook Completeness

### F142-01 -- Runbook suite is substantially complete (No Finding)

**Files:** `/docs/operations-runbook.md`, `/docs/rollback.md`, `/docs/deployment.md`, `/docs/deployment-checklist.md`, `/docs/LAUNCH-DAY-CHECKLIST.md`, `/docs/runbooks/`
**Evidence:** The runbook library covers:
- Deployment procedure with rolling strategy
- Rollback (3 methods: image rollback, git revert, DB migration rollback)
- Post-rollback health verification
- Database migrations
- Stripe product seeding
- Agent management
- Data source health monitoring
- Payment processing failure
- Email delivery issues
- High CPU/memory
- Data breach response (with GDPR 72-hour notification)
- DB migration failure
- Stripe webhook failure
- Redis connection loss
- Runaway background jobs
- AI quota exceeded
- Valuation model drift
- Deal hunter blocked

This is a strong set. Most early-stage startups have zero runbooks.

### F142-02 -- Runbook references non-existent PagerDuty integration (P3)

**Files:** `/docs/disaster-recovery.md` line 41, `/docs/rollback.md` line 155
**Evidence:** DR plan says "Alert on-call engineer via PagerDuty." Rollback doc says "On-call engineer: PagerDuty." No PagerDuty configuration, integration code, or account setup is documented or present in the codebase. Currently a single-founder operation with no on-call rotation.
**Impact:** Aspirational reference, not misleading in practice. Should be updated to reflect reality (founder is the sole responder) or PagerDuty should be set up before scaling the team.

### F142-03 -- No runbook for Clerk auth outage or key rotation (P2)

**Files:** `/docs/runbooks/` (no Clerk-specific runbook)
**Evidence:** Clerk is the auth provider and a critical dependency. If Clerk is down or keys are compromised, no documented procedure exists for fallback. The security guide covers rotation of Stripe, OpenAI, session, and encryption keys but does not cover Clerk key rotation.
**Impact:** Auth outage would require ad-hoc debugging. Clerk proxy configuration (`/__clerk` via Cloudflare) adds another failure mode that is undocumented.

### F142-04 -- Key rotation runbook is comprehensive but untested (P3)

**Files:** `/docs/security.md` lines 48--77, 80--98
**Evidence:** Field encryption key rotation has a scripted procedure (`rotateEncryptionKey.ts`) with step-by-step instructions. Database credential rotation, session secret rotation, and API key rotation are all documented. The rotation log table is empty ("first rotation due"). No evidence any rotation has ever been performed.
**Impact:** Theoretical coverage without validation. The rotation script may have bugs that surface only during a real rotation under pressure.

---

## Lens 143 -- Disaster Recovery

### F143-01 -- DR plan exists with RTO/RPO targets (No Finding -- Strong)

**Files:** `/docs/disaster-recovery.md`
**Evidence:** Defined RTO of 4 hours and RPO of 1 hour. Backup strategy: daily Fly.io Postgres snapshots with 7-day retention. S3 replication for object storage. Recovery procedure with exact commands. Communication plan defined (internal via Slack, external via status page, customer email within 2 hours for data-impacting incidents).
**Assessment:** Good for the company's stage. RTO/RPO targets are reasonable.

### F143-02 -- DR plan references non-existent status.acreos.com (P3)

**Files:** `/docs/disaster-recovery.md` line 60
**Evidence:** Communication plan says "Status page update at status.acreos.com within 30 min of SEV1." There is no external status page at that domain. The internal `/status` page exists in the app but requires authentication context and is part of the app itself -- if the app is down, the status page is also down.
**Impact:** During a real SEV1, there would be no public communication channel. Users would have no way to check whether the outage is known and being worked on.

### F143-03 -- No DR testing evidence (P3)

**Files:** `/docs/disaster-recovery.md` lines 63--66
**Evidence:** The DR plan specifies a recovery testing schedule: monthly backup restore to staging, quarterly full DR drill, annual pentest + recovery simulation. No evidence (logs, reports, test results) that any of these have been performed. This is expected for a pre-launch product but should be addressed before the first customer data is at risk.

---

## Lens 144 -- Data-Loss Recovery

### F144-01 -- Soft deletes provide first line of defense (No Finding -- Strong)

**Files:** `/docs/security-posture.md` line 27, `/docs/incident-response.md` lines 139--157
**Evidence:** Leads and entities use soft deletes (`deletedAt`), making accidental deletion reversible. The incident response document has a detailed "User Reports Data Loss" section with diagnosis steps (check activity log, check soft-delete state, check audit log) and resolution procedures including Fly.io backup restoration with selective data copy.

### F144-02 -- Fly.io backup retention is only 7 days (P2)

**Files:** `/docs/disaster-recovery.md` line 17
**Evidence:** Database snapshots are retained for 7 days. If a data-loss event is not detected within 7 days, there is no backup to restore from. For a CRM holding years of deal and lead data, 7 days is insufficient. Subtle data corruption (wrong values written rather than deleted data) may take weeks to notice.
**Recommendation:** Extend backup retention to at least 30 days. Consider weekly snapshots retained for 90 days and monthly snapshots retained for 1 year.

### F144-03 -- No point-in-time recovery (PITR) is configured (P3)

**Files:** `/docs/disaster-recovery.md` line 28
**Evidence:** The DR plan shows a `flyctl postgres restore --restore-time` command suggesting PITR capability, but Fly.io's managed Postgres at the shared-cpu-2x tier may not support PITR -- it depends on WAL archiving being configured. No documentation confirms PITR is actually enabled and functional.
**Recommendation:** Verify PITR is active with `flyctl postgres config show`. If not available at the current tier, upgrade or implement daily `pg_dump` exports to S3 with longer retention.

---

## Lens 145 -- Key Leak Recovery

### F145-01 -- Comprehensive key rotation procedures documented (No Finding -- Strong)

**Files:** `/docs/security.md` lines 80--104, `/docs/runbooks/data-breach-response.md` lines 133--148
**Evidence:** Security guide covers rotation for: database credentials, session secret, field encryption key (with re-encryption script), and third-party API keys (Stripe, OpenAI, Twilio). Data breach runbook includes an "Emergency Rotate All Secrets" section. Launch-day checklist includes pre-launch secret rotation.

### F145-02 -- No automated secret scanning or leak detection (P2)

**Files:** No `.github/workflows/` with secret scanning, no pre-commit hooks for secret detection
**Evidence:** While `.gitignore` excludes `.env`, there is no automated check to prevent accidental secret commits. No integration with GitHub Secret Scanning, GitGuardian, or TruffleHog. A leaked key would only be detected reactively.
**Recommendation:** Enable GitHub Advanced Security secret scanning (free for public repos, paid for private). Add a pre-commit hook using `detect-secrets` or `gitleaks`.

### F145-03 -- Clerk key leak scenario is undocumented (P2, cross-ref F142-03)

**Evidence:** If `CLERK_SECRET_KEY` or `VITE_CLERK_PUBLISHABLE_KEY` leak, the recovery procedure is not documented. The publishable key is embedded in the client bundle by design (it is public), but the secret key controls user management. No documentation covers how to rotate Clerk keys without downtime.

---

## Lens 146 -- Incident Communication

### F146-01 -- Incident communication plan exists but references non-existent channels (P2)

**Files:** `/docs/disaster-recovery.md` lines 59--61, `/docs/INCIDENT_RESPONSE.md` lines 50--57
**Evidence:** DR plan specifies:
- Internal: Slack #incidents channel, PagerDuty escalation
- External: Status page update at status.acreos.com within 30 min of SEV1
- Customer: Email to affected orgs within 2 hours

Neither the Slack channel, PagerDuty, nor status.acreos.com currently exist. The INCIDENT_RESPONSE.md has a breach notification template, severity-based response times, and a data breach checklist, all of which are well-structured.
**Impact:** During a real incident, the founder would have to improvise communication channels rather than following documented procedures.

### F146-02 -- Customer notification template exists (No Finding -- Strong)

**Files:** `/docs/runbooks/data-breach-response.md` lines 97--110, `/docs/incident-response.md` lines 49--52, 123--128, 159--160
**Evidence:** Multiple notification templates are provided for different scenarios: security breach, outage, and data loss. The templates are clear, empathetic, and actionable. The breach response runbook includes GDPR-compliant notification content requirements.

### F146-03 -- No escalation to legal counsel is actually configured (P3)

**Files:** `/docs/INCIDENT_RESPONSE.md` line 72
**Evidence:** Emergency contacts table shows "Legal Counsel: TBD" and "Cyber Insurance: [Contact]" as placeholders. In a real breach requiring legal notification within 72 hours, there is no identified legal counsel.
**Recommendation:** Retain a technology attorney and cyber insurance policy before launch. Add their contact information to the incident response plan.

---

## Lens 147 -- Status Page

### F147-01 -- Internal status page exists but has no public-facing counterpart (P2)

**Files:** `client/src/pages/status.tsx`
**Evidence:** An internal status page exists at `/status` that polls `/api/status` every 30 seconds and displays service health (database, Stripe, OpenAI, etc.). However, this page is part of the main application -- if the app is down, the status page is also down. The DR plan references `status.acreos.com` as a public status page, but this domain/subdomain does not exist.
**Recommendation:** Set up a third-party status page (Statuspage.io, Instatus, or Betteruptime) at `status.acreos.com` that is hosted independently from the main application. This is table-stakes for any SaaS product with paying customers.

### F147-02 -- Status page lacks incident history and uptime display (P3, cross-ref Lens 29-F29-11)

**Files:** `client/src/pages/status.tsx`
**Evidence:** The current status page shows only live service status. It has no incident history, no uptime percentage, no way to subscribe to status updates, and cannot distinguish between "all services down" and "the status page itself failed to load" (as noted in Lens 29).
**Impact:** Users have no historical context during or after incidents.

---

## Lens 148 -- Data Portability

### F148-01 -- Data export functionality exists at both user and org level (No Finding -- Strong)

**Files:** `server/routes-gdpr.ts`, `server/services/gdprService.ts`, `server/services/dataPortability.ts`, `server/routes-import-export.ts`, `server/services/export.ts`
**Evidence:** Two export mechanisms exist:
1. GDPR user-level export (`POST /api/privacy/export`) -- exports all personal data for the current user as JSON download.
2. Organization-level export (`server/services/dataPortability.ts`) -- exports leads, deals, properties, notes, and campaigns for an organization.
Additionally, CSV export is available for leads and properties via `server/routes-import-export.ts`.
The data privacy doc confirms "Full data export is available at any time via Settings > Data > Export All."

### F148-02 -- GDPR export truncates at 1000 records per table (P1)

**Files:** `server/services/gdprService.ts` lines 76--81
**Evidence:** The `exportUserData()` function applies `.limit(1000)` to leads, deals, properties, and tasks queries. GDPR Article 15 (Right of Access) requires providing a copy of ALL personal data. A user with more than 1000 leads receives an incomplete export with no indication of truncation. The organization-level export in `dataPortability.ts` uses `.limit(10000)`, which is higher but still a hard cap.
**Cross-ref:** Lens 31-P1-04 already captured this.
**Recommendation:** Remove hard limits or implement paginated/streaming export. Add a record count verification.

### F148-03 -- No data import interoperability standard (P3)

**Evidence:** CSV import exists for leads (`server/services/import.ts`), but there is no documented standard format for importing data from other CRMs. No RETS/IDX integration for MLS data portability. This is a competitive feature concern, not a compliance issue.

---

## Lens 149 -- Regulatory Audit Readiness

### F149-01 -- Privacy Policy and Terms of Service pages exist (No Finding -- Partial)

**Files:** `client/src/pages/privacy.tsx`, `client/src/pages/terms.tsx`
**Evidence:** Both legal pages exist as React components, rendered at `/privacy` and `/terms`. Last updated: March 2026. They cover standard sections (data collection, usage, sharing, rights, etc.).

### F149-02 -- Legal pages contain placeholder address (P1, cross-ref Lens 31-P0-01)

**Files:** `client/src/pages/terms.tsx:206`, `client/src/pages/privacy.tsx:223`
**Evidence:** Both documents display `[Company Address]` as a literal string. CCPA requires a physical mailing address in privacy policies (Cal. Civ. Code 1798.130(a)(2)). GDPR Article 13(1)(a) requires the identity and contact details of the data controller. Launching with placeholder legal contact information is a compliance violation.
**Recommendation:** Replace with actual registered business address before launch. This is a 5-minute fix with legal consequence.

### F149-03 -- Privacy Policy missing required CCPA disclosures (P1, cross-ref Lens 31-P0-04)

**Files:** `client/src/pages/privacy.tsx`
**Evidence:** Missing: (a) "Do Not Sell or Share My Personal Information" statement (CCPA/CPRA Cal. Civ. Code 1798.120); (b) CCPA-specific consumer rights enumeration; (c) CCPA category mapping; (d) 12-month lookback.
**Recommendation:** Add a dedicated CCPA/CPRA section. Even if AcreOS does not sell data, an affirmative statement to that effect is legally required.

### F149-04 -- Privacy Policy does not list all sub-processors (P1, cross-ref Lens 31-P0-05)

**Files:** `client/src/pages/privacy.tsx`
**Evidence:** Omits disclosure of: OpenRouter, DeepSeek, Twilio/Telnyx, AWS SES, Sentry (including session replay), Clerk, and Fly.io. GDPR Article 13(1)(e) requires disclosure of recipients of personal data.

### F149-05 -- No Data Processing Agreement available for customers (P2, cross-ref Lens 31-P1-06)

**Evidence:** No DPA template exists. Under GDPR Article 28, AcreOS (as a data processor for its customers' lead/contact data) must offer a DPA. Enterprise and compliance-conscious customers will require one before signing.

### F149-06 -- Cookie consent banner is cosmetic only (P1, cross-ref Lens 31-P0-02)

**Files:** `client/src/components/cookie-consent-banner.tsx`, `client/src/lib/sentry.ts`
**Evidence:** Stores consent choice in localStorage but nothing reads it. Sentry session replay initializes unconditionally. Under GDPR/ePrivacy, non-essential tracking requires prior consent.
**Recommendation:** Gate Sentry replay on consent status. When declined, suppress all non-essential tracking.

### F149-07 -- GDPR anonymization misses several tables (P1, cross-ref Lens 31-P1-05)

**Files:** `server/services/gdprService.ts` lines 101--168
**Evidence:** `anonymizeUser()` does not cover: deals, properties assigned to user, payments, activity log entries with PII in metadata, campaign records containing sent emails/SMS, audit log entries. Notes are acknowledged as retained for legal compliance but PII in those records is not anonymized.
**Recommendation:** Extend anonymization to all PII-bearing tables. For legally-retained records, anonymize PII fields while preserving financial data.

### F149-08 -- GDPR routes do not use standard error helpers or type safety (P2, cross-ref Lens 31-P1-01)

**Files:** `server/routes-gdpr.ts` lines 15--17
**Evidence:** Uses raw `res.status(500).json()` instead of `Errors.*` helpers. `getUser(req)` returns `req.user` with no null check. Missing `AuthenticatedRequest` typing. Does not apply `getOrCreateOrg` middleware.

---

## Lens 150 -- Post-Mortem Framework

### F150-01 -- Post-mortem template exists (No Finding -- Strong)

**Files:** `/docs/incident-response.md` lines 167--191
**Evidence:** A structured post-mortem template is provided with fields for: date, severity, duration, affected users, timeline (detection through resolution), root cause, resolution, and prevention measures. This template is referenced from multiple runbooks.

### F150-02 -- No post-mortem archive or tracking system (P3)

**Evidence:** The post-mortem template exists but there is no designated location for storing completed post-mortems (e.g., `/docs/incidents/` directory, a GitHub issue label, or an external incident tracker). No evidence that any post-mortem has been conducted, which is expected for a pre-launch product.
**Recommendation:** Create a `/docs/incidents/` directory with an `_index.md` file. After launch, every SEV1/SEV2 incident should produce a post-mortem stored there. Consider using GitHub Issues with an "incident" label for tracking.

### F150-03 -- Post-mortem template lacks blameless framing (P3)

**Files:** `/docs/incident-response.md` lines 167--191
**Evidence:** The template focuses on Root Cause, Resolution, and Prevention, which are the right sections. However, it does not explicitly adopt a blameless post-mortem culture -- no "What went well?" section, no "Contributing factors" (vs. single root cause), no action items with owners and deadlines. The template is functional but could be more structured for a growing team.
**Recommendation:** Add sections for "What went well?", "Contributing factors", and "Action items (with owner + deadline)". Add a note at the top: "This is a blameless post-mortem. We focus on systems and processes, not individuals."

---

## Summary Table

| ID | Finding | Severity | Lens | Cross-ref |
|----|---------|----------|------|-----------|
| F141-01 | README describes wrong auth system | P2 | 141 | 47-P1-01 |
| F141-02 | README omits Clerk and Redis from required deps | P2 | 141 | 47-P1-02/03 |
| F141-03 | API documentation covers ~3% of surface | P3 | 141 | 47-P2-01 |
| F141-04 | Owner's Manual references defunct Replit auth | P3 | 141 | 47-P1-05 |
| F141-05 | Architecture docs contradict on table count | P3 | 141 | 47-P2-04 |
| F142-02 | Runbooks reference non-existent PagerDuty | P3 | 142 | -- |
| F142-03 | No runbook for Clerk auth outage/key rotation | P2 | 142 | -- |
| F142-04 | Key rotation runbook untested | P3 | 142 | -- |
| F143-02 | DR plan references non-existent status.acreos.com | P3 | 143 | -- |
| F143-03 | No DR testing evidence | P3 | 143 | -- |
| F144-02 | Fly.io backup retention only 7 days | P2 | 144 | -- |
| F144-03 | PITR not confirmed active | P3 | 144 | -- |
| F145-02 | No automated secret scanning | P2 | 145 | -- |
| F145-03 | Clerk key leak scenario undocumented | P2 | 145 | F142-03 |
| F146-01 | Incident comms reference non-existent channels | P2 | 146 | -- |
| F146-03 | Legal counsel contact is TBD | P3 | 146 | -- |
| F147-01 | No public-facing status page | P2 | 147 | 29-F29-11 |
| F147-02 | Status page lacks incident history/uptime | P3 | 147 | 29-F29-11 |
| F148-02 | GDPR export truncates at 1000 records | P1 | 148 | 31-P1-04 |
| F148-03 | No data import interoperability standard | P3 | 148 | -- |
| F149-02 | Placeholder address in legal pages | P1 | 149 | 31-P0-01 |
| F149-03 | Privacy Policy missing CCPA disclosures | P1 | 149 | 31-P0-04 |
| F149-04 | Privacy Policy omits sub-processors | P1 | 149 | 31-P0-05 |
| F149-05 | No DPA available for customers | P2 | 149 | 31-P1-06 |
| F149-06 | Cookie consent banner is cosmetic only | P1 | 149 | 31-P0-02 |
| F149-07 | GDPR anonymization misses several tables | P1 | 149 | 31-P1-05 |
| F149-08 | GDPR routes lack type safety/error helpers | P2 | 149 | 31-P1-01 |
| F150-02 | No post-mortem archive or tracking system | P3 | 150 | -- |
| F150-03 | Post-mortem template lacks blameless framing | P3 | 150 | -- |

**Totals:** 6 P1, 11 P2, 12 P3

**P1 items are all legally required (GDPR/CCPA compliance).** Specifically: GDPR export truncation, placeholder legal address, missing CCPA disclosures, undisclosed sub-processors, non-functional cookie consent, and incomplete GDPR anonymization. These must be resolved before launch.

**P2 items are operationally important** but the product can launch without them for a small initial user base. They should be addressed within the first 30 days post-launch: public status page, extended backup retention, Clerk runbook, secret scanning, incident communication channels, and DPA availability.

**P3 items are aspirational improvements** suitable for the backlog: DR testing, post-mortem archive, PagerDuty setup, API documentation expansion, legal counsel retention, and import interoperability.
