# Lenses 091-095 -- Operations & Business Audit

Auditor: Claude Opus 4.6 (1M context)
Date: 2026-04-18
Tier: 2

---

## Lens 091 -- Analytics Event Taxonomy

**Distinct-value declaration:** AcreOS has a client-side telemetry library and a server-side telemetry ingestion endpoint, but the telemetry endpoint is a no-op in production (events are logged only in development). There is no analytics backend, no event taxonomy document, and key business-critical actions (signup, first payment, churn) are not tracked.

### Evidence

**Client telemetry library** (`client/src/lib/telemetry.ts`):
- Defines 6 event helpers: `page_view`, `feature_used`, `action_completed`, `ai_used`, `error`, `session_start`.
- Events are batched in a 5-second debounce queue and flushed via `navigator.sendBeacon` to `/api/telemetry`.
- No event naming convention document or taxonomy schema exists.

**Server telemetry endpoint** (`server/routes-dashboard.ts:323`):
- The `/api/telemetry` POST handler only logs events in `development` mode.
- In production, events are acknowledged with `{ success: true }` but discarded. Comments suggest "you could send to PostHog / Mixpanel / your own analytics database" -- none are integrated.

**Actual usage across client codebase** (11 call sites found):
| Call site | Event |
|-----------|-------|
| `App.tsx` | `session_start` |
| `deals.tsx` | `action_completed('deal_created')` |
| `properties.tsx` | `action_completed('property_created')` |
| `leads.tsx` | `action_completed('lead_updated')`, `action_completed('lead_created')` |
| `property-analysis-chat.tsx` | `ai_used('property_analysis')` |
| `command-palette.tsx` | `action_completed('command_palette_*')`, `feature_used('command_palette')` |

**Separate system -- Beta Analytics** (`server/services/betaAnalytics.ts`):
- A server-side activation tracking system records milestone events: `first_lead_created`, `first_lead_imported`, `first_campaign_created`, `first_deal_created`, `first_note_created`, `first_pax_message`, `first_enrichment_run`.
- Stores in `user_activation_events` table. This is a separate system from the client telemetry and has no integration with it.

**Server-side AI telemetry** (`server/services/telemetryOptimizer.ts`):
- A third, separate telemetry system records AI model performance in `aiTelemetryEvents` table (latency, cost, error rate).
- Runs nightly to optimize model weights. This is well-built but only covers AI routing, not user behavior.

### Gaps

| # | Gap | Severity |
|---|-----|----------|
| 1 | Production telemetry endpoint is a no-op -- all client events are silently discarded | CRITICAL |
| 2 | No analytics backend (PostHog, Mixpanel, BigQuery, or custom) is integrated | CRITICAL |
| 3 | No event taxonomy document defining naming conventions, required properties, or categories | HIGH |
| 4 | Key business actions not tracked: signup, onboarding completion, first payment, subscription upgrade/downgrade, churn, CSV import, campaign launch | HIGH |
| 5 | Three separate telemetry systems (client events, beta activation, AI telemetry) with no unification | MEDIUM |
| 6 | No funnel analysis possible: cannot measure signup-to-activation or lead-to-deal conversion at the user behavior level | HIGH |
| 7 | `page_view` helper exists but is never called from any component | MEDIUM |
| 8 | No consent mechanism for telemetry collection (GDPR/CCPA consideration) | MEDIUM |

---

## Lens 092 -- PII Data Flow Mapper

**Distinct-value declaration:** PII flows through the system in plaintext storage (email, phone, mailing address in leads/properties tables are unencrypted text columns). A PII masking middleware exists for log output, but the Express request-body masking middleware is defined but never mounted via `app.use()`. PII is sent to third-party services (OpenRouter/AI, Twilio, Lob, SES) with no documented data processing agreements or field-level minimization.

### PII Storage Map

| Table | PII Fields | Encrypted? |
|-------|-----------|------------|
| `leads` | `email`, `phone`, `mailingAddress`, `firstName`, `lastName` | No -- plaintext `text` columns |
| `properties` | Owner name, address (in property data) | No |
| `organizations` | `supportEmail`, `supportPhone`, `billingEmail` | No |
| `team_members` | `email`, `displayName` | No |
| `provisioned_phone_numbers` | `phoneNumber` | No |
| `platform_config` | API keys/credentials | Yes -- AES-256-GCM via `encrypted_value` column |
| `org_integrations` | Third-party credentials | Yes -- `credentials_encrypted` column |
| `vendor_portal_logins` | Login credentials | Yes -- `encrypted_data` column |

**Key finding:** Sensitive credential data IS encrypted at rest, but customer/lead PII is stored as plaintext. The schema has 429 tables; PII-bearing tables store email/phone/address as raw `text` columns with no column-level encryption.

### PII in Logs

**Console interceptor** (`server/middleware/piiMasking.ts`):
- Patches `console.log/info/warn/error/debug` at startup to mask SSN, credit card, phone, and email patterns.
- `installConsoleInterceptor()` is called at server startup in `server/index.ts:42`.
- The structured `logger` from `server/utils/logger.ts` is the standard logging mechanism, but the console interceptor only patches raw `console.*` calls. If `logger` writes directly to a transport (not through `console`), PII could bypass masking.

**Express middleware** (`piiMaskingMiddleware`):
- Creates `req.maskedBody` and `req.maskedQuery` for safe logging -- does NOT modify the actual request body.
- **Never mounted** -- `app.use(piiMaskingMiddleware)` does not appear anywhere. Only the `installConsoleInterceptor()` is active.

### PII Sent to Third Parties

| Service | PII Sent | Documented DPA? |
|---------|----------|-----------------|
| OpenRouter/AI (via `aiRouter.ts`) | Prompts may contain lead names, addresses, property details embedded in context | No |
| Twilio (SMS) | Phone numbers, message content | No evidence of DPA |
| Lob (Direct Mail) | Full mailing addresses, names | No evidence of DPA |
| AWS SES (Email) | Email addresses, email content | No evidence of DPA |
| Stripe (Billing) | Customer email, payment info | Stripe has standard DPA |
| Clerk (Auth) | User email, name, OAuth tokens | Clerk has standard DPA |

### Gaps

| # | Gap | Severity |
|---|-----|----------|
| 1 | Lead/contact PII (email, phone, address, name) stored as plaintext in DB -- no column-level encryption | HIGH |
| 2 | `piiMaskingMiddleware` defined but never mounted on Express app | HIGH |
| 3 | AI prompts may include lead PII (names, addresses, phone) with no field-level redaction before sending to OpenRouter | HIGH |
| 4 | No Data Processing Agreements documented for Twilio, Lob, SES | MEDIUM |
| 5 | `activityLogger` stores raw PII in event descriptions (e.g., "Email sent to john@example.com") | MEDIUM |
| 6 | Structured logger transport chain not verified to flow through the console interceptor -- PII may leak to log aggregators | MEDIUM |
| 7 | No data retention policy or automated PII purge mechanism | MEDIUM |
| 8 | CSV export endpoint (`/api/leads/export`) outputs all PII fields with no field-level filtering | LOW |

---

## Lens 093 -- Audit Log Completeness

**Distinct-value declaration:** AcreOS has an `activity_events` table with 16 event types and an `ActivityLoggerService`, but audit logging is invoked in only 10 locations across the server. Critical operations -- lead creation, lead deletion, deal CRUD, settings changes, permission changes, user invitations, billing events, and AI agent actions -- are not audit-logged. The audit log UI exists but covers only a fraction of operations.

### Audit Infrastructure

**Schema** (`shared/schema.ts:3660-3721`):
- `ACTIVITY_EVENT_TYPES`: 16 types defined (email_sent, sms_sent, mail_sent, call_made, call_received, note_added, stage_changed, payment_received, document_uploaded, task_created, task_updated, task_completed, plus email_opened, email_clicked, sms_delivered, mail_delivered).
- `activity_events` table: `organizationId`, `entityType`, `entityId`, `eventType`, `description`, `metadata` (JSONB), `userId`, `campaignId`, `eventDate`.

**Logger service** (`server/services/activityLogger.ts`):
- Provides typed helpers: `logEmailSent`, `logSMSSent`, `logDirectMailSent`, `logCallMade`, `logCallReceived`, `logNoteAdded`, `logStageChanged`, `logPaymentReceived`, `logDocumentUploaded`, `logTaskCreated`, `logTaskUpdated`, `logTaskCompleted`.

**Actual invocations** (10 call sites):

| Location | Events Logged |
|----------|--------------|
| `routes.ts` | `logTaskCreated`, `logTaskUpdated`, `logTaskCompleted` |
| `routes-organization.ts` | 3x generic `logEvent` calls (org-level events) |
| `routes-crm-extras.ts` | `logTaskCreated`, `logTaskUpdated`, `logTaskCompleted` |
| `inboundEmailService.ts` | `logEmailSent` |

**Audit log UI** (`client/src/pages/audit-log.tsx`):
- Table view with search, entity type filter, pagination, CSV export.
- Queries `/api/activity` with offset/limit/entityType/search.

### Coverage Matrix

| Operation | Audit Logged? |
|-----------|--------------|
| Lead created | NO |
| Lead updated | NO |
| Lead deleted (bulk soft-delete) | Partially -- `bulk_soft_delete` action logged via separate audit mechanism in `routes.ts:886` but NOT via `activityLogger` |
| Lead imported (CSV) | NO |
| Deal created | NO |
| Deal updated | NO |
| Deal deleted | NO |
| Property created | NO |
| Property updated | NO |
| Property deleted | NO |
| Campaign created | NO |
| Campaign launched | NO |
| Email sent | YES (via `inboundEmailService`) |
| SMS sent | NO (helper exists but not called from SMS routes) |
| Direct mail sent | NO (helper exists but not called from mail routes) |
| Task CRUD | YES |
| Note added | NO (helper exists but not called from note routes) |
| Stage changed | NO (helper exists but not called) |
| Payment received | NO (helper exists but not called from billing routes) |
| Settings changed | NO |
| Permission/role changed | NO |
| User invited/removed | NO |
| Billing: subscription change | NO |
| AI agent action taken | NO |
| Login/logout | NO (Clerk handles auth but no audit event emitted) |
| Data export | NO |

### Gaps

| # | Gap | Severity |
|---|-----|----------|
| 1 | Lead CRUD (create, update, delete) not audit-logged despite being the core entity | CRITICAL |
| 2 | Deal CRUD not audit-logged | CRITICAL |
| 3 | Billing/subscription events not audit-logged | HIGH |
| 4 | Permission changes and team management not audit-logged | HIGH |
| 5 | Settings changes not audit-logged | HIGH |
| 6 | Campaign send operations (SMS, direct mail) have logger helpers but no call sites | MEDIUM |
| 7 | No IP address or user agent captured in activity events (present in audit-log UI interface but not populated) | MEDIUM |
| 8 | No tamper protection on audit log (records can be deleted/modified by anyone with DB access) | MEDIUM |
| 9 | Data export operations not logged | MEDIUM |
| 10 | AI agent autonomous actions not logged to audit trail | MEDIUM |

---

## Lens 094 -- SOC2 Readiness

**Distinct-value declaration:** AcreOS has foundational security controls (RBAC, security headers, rate limiting, encrypted credentials, CSP, HSTS) but lacks the operational maturity required for SOC2 Type II. The critical gaps are: no CI/CD pipeline, no running test suite, no change management process, incomplete audit logging, plaintext PII storage, and no formal access review procedures.

### SOC2 Trust Service Criteria Assessment

#### CC1 -- Control Environment

| Control | Status | Notes |
|---------|--------|-------|
| Defined roles and responsibilities | PARTIAL | `permissions.ts` defines 4 roles (owner, admin, member, viewer) with 26 granular permissions. However, no documented org chart or role assignment policy. |
| Code of conduct / security policy | MISSING | No documented security policy. |
| Board/management oversight | N/A | Early-stage startup; single founder. |

#### CC2 -- Communication and Information

| Control | Status | Notes |
|---------|--------|-------|
| Internal security communication | MISSING | No evidence of security training, awareness program, or internal security docs for team. |
| Incident communication plan | PARTIAL | `docs/incident-response.md` covers communication for users but not formal internal escalation (mentions PagerDuty in DR doc but no config). |

#### CC3 -- Risk Assessment

| Control | Status | Notes |
|---------|--------|-------|
| Risk assessment process | MISSING | No risk register, threat model, or risk assessment document. |
| Vulnerability management | MISSING | No evidence of `npm audit` in CI, no dependency scanning, no scheduled pen tests. |

#### CC4 -- Monitoring Activities

| Control | Status | Notes |
|---------|--------|-------|
| System monitoring | PARTIAL | OpenTelemetry tracing middleware (`server/middleware/telemetry.ts`) with 500-span ring buffer. Health endpoints exist. |
| Anomaly detection | PARTIAL | Rate limiter tracks abuse patterns with escalating alerts. No dedicated SIEM or anomaly detection. |
| Audit logging | PARTIAL | See Lens 093 -- covers ~20% of critical operations. |

#### CC5 -- Control Activities

| Control | Status | Notes |
|---------|--------|-------|
| Access controls (authentication) | GOOD | Clerk authentication with JWT fallback, session management, Google OAuth. |
| Access controls (authorization) | GOOD | RBAC with 26 granular permissions, `requirePermission` middleware used on delete/export/campaign routes. |
| Encryption in transit | GOOD | HSTS header set in production, Fly.io terminates TLS. `upgrade-insecure-requests` in CSP. |
| Encryption at rest (credentials) | GOOD | AES-256-GCM for API keys, integration credentials, platform config (`platform_config.encrypted_value`). |
| Encryption at rest (PII) | MISSING | Lead/contact PII stored as plaintext (see Lens 092). |
| Change management | MISSING | No CI pipeline (orientation doc item #18), no PR review requirements, no deployment approval process. Manual `flyctl deploy`. |
| Security headers | GOOD | CSP with per-request nonce, X-Frame-Options DENY, X-Content-Type-Options nosniff, Referrer-Policy, Permissions-Policy, HSTS in prod. |

#### CC6 -- Logical and Physical Access Controls

| Control | Status | Notes |
|---------|--------|-------|
| MFA | PARTIAL | Clerk supports MFA but no evidence it is enforced for org admins. |
| Session management | GOOD | Clerk-managed sessions with JWT verification. |
| Access reviews | MISSING | No periodic access review process documented. |
| Secrets management | GOOD | Fly.io secrets vault for env vars, encrypted DB columns for integration credentials. |

#### CC7 -- System Operations

| Control | Status | Notes |
|---------|--------|-------|
| Backup and recovery | PARTIAL | Daily automated snapshots via Fly.io Postgres (7-day retention). DR plan documented in `docs/disaster-recovery.md` with RTO 4h / RPO 1h. Monthly restore testing scheduled but no evidence of execution. |
| Incident response | GOOD | `docs/incident-response.md` covers 5 incident types with diagnosis, resolution, and communication steps. Includes post-incident template. |
| Capacity planning | PARTIAL | 2 machines (performance-2x, 4GB RAM). Scale commands documented. No auto-scaling. |

#### CC8 -- Change Management

| Control | Status | Notes |
|---------|--------|-------|
| SDLC process | MISSING | No documented SDLC. No PR templates, no required reviewers, no staging environment. |
| Testing | MISSING | Orientation doc item #3: "No tests running -- no unit, integration, or e2e tests in CI." |
| Deployment controls | MISSING | Manual `flyctl deploy` with rolling strategy. No deployment approval gate. |

### SOC2 Readiness Score: ~35%

### Gaps

| # | Gap | Severity |
|---|-----|----------|
| 1 | No CI/CD pipeline -- code deploys without automated tests, linting, or approval | CRITICAL |
| 2 | No running test suite (1,815 TypeScript errors, no passing tests) | CRITICAL |
| 3 | No change management process (PR reviews, deployment approvals) | CRITICAL |
| 4 | PII stored as plaintext in database | HIGH |
| 5 | Audit logging covers ~20% of critical operations | HIGH |
| 6 | No risk assessment or threat modeling process | HIGH |
| 7 | No vulnerability scanning (npm audit, dependency alerts, pen testing) | HIGH |
| 8 | No formal access review procedures | MEDIUM |
| 9 | No security awareness training or documentation | MEDIUM |
| 10 | DR plan documented but no evidence of testing | MEDIUM |

---

## Lens 095 -- Incident Postmortem Framework

**Distinct-value declaration:** AcreOS has a well-structured incident response document covering 5 incident types with severity classification, and a disaster recovery plan with RTO/RPO targets. A postmortem template exists. However, there are no actual postmortem records, no blameless postmortem culture artifacts, no incident tracking system, and no runbook automation. The framework is documented but has never been exercised with evidence.

### What Exists

**Incident Response** (`docs/incident-response.md`, 191 lines):
- Severity classification: Critical / High / Medium / Low with response time targets (Immediate to 48h).
- Five incident playbooks:
  1. App is down (Fly.io diagnosis/resolution)
  2. Data source outage (circuit breaker, graceful degradation)
  3. Payment processing error (Stripe dunning, webhook debugging)
  4. Security incident (triage, resolution timeline by severity, 72h notification)
  5. User reports data loss (activity log check, soft-delete restoration, backup restore)
- Communication templates for each scenario.
- Post-incident report template with: Date, Severity, Duration, Affected users, Timeline, Root Cause, Resolution, Prevention.

**Operations Runbook** (`docs/operations-runbook.md`, 168 lines):
- Quick reference table for service health checks and restart commands.
- Environment variables inventory (required + optional).
- Common operations: DB migrations, Stripe seeding, trial management, agent management, data source health.
- Incident response section covering: payment processing, email delivery, data source outage, high CPU/memory.
- Monitoring endpoints listed.
- Backup/recovery basics (pg_dump, Stripe webhook replay).

**Disaster Recovery Plan** (`docs/disaster-recovery.md`, 66 lines):
- RTO/RPO targets: 4h / 1h (all services), 24h / 4h (non-critical).
- Backup strategy: daily automated snapshots (7-day retention), S3 replication, GitHub code.
- DB restore procedure with commands.
- SEV1/SEV2/SEV3 runbooks.
- Recovery testing schedule: monthly DB restore, quarterly full DR drill, annual pen test.
- Communication plan: Slack, PagerDuty, status page, customer email.

**Sovereign Protocol Runbooks** (`sovereign-protocol/agents/sentinel/runbooks.md`):
- AI agent-specific runbooks for the Sentinel agent (exists as a file but not evaluated in detail).

### What is Missing

| # | Gap | Severity |
|---|-----|----------|
| 1 | No actual postmortem records exist -- the template has never been filled out | MEDIUM |
| 2 | No incident tracking system (no JIRA incidents, no PagerDuty integration configured, no on-call rotation) | HIGH |
| 3 | No blameless postmortem culture artifacts (retrospective process, action item tracking) | MEDIUM |
| 4 | No automated runbook execution (e.g., Fly.io restart on health check failure is manual) | MEDIUM |
| 5 | No status page configured (status.acreos.com referenced in DR doc but not deployed) | HIGH |
| 6 | No alerting pipeline -- health endpoints exist but nothing monitors them and triggers alerts | HIGH |
| 7 | Recovery testing schedule documented but no evidence any test has been executed | MEDIUM |
| 8 | No incident severity auto-detection from monitoring data | LOW |
| 9 | Runbook references PagerDuty but no evidence of PagerDuty configuration | MEDIUM |

### Assessment

The documentation quality is good -- the incident response, operations runbook, and DR plan are well-written and actionable. The postmortem template follows industry best practices. However, this is entirely aspirational infrastructure. Without an alerting pipeline, incident tracking system, or status page, the documented procedures cannot be triggered or tracked. The gap is not in knowledge but in operationalization.

---

## Cross-Lens Summary

| Lens | Score | Top Issue |
|------|-------|-----------|
| 091 - Analytics Events | 2/10 | Telemetry endpoint is a no-op in production; events are silently discarded |
| 092 - PII Data Flow | 4/10 | Lead PII stored as plaintext; PII masking middleware defined but never mounted |
| 093 - Audit Logs | 3/10 | Only ~20% of critical operations are audit-logged; no coverage for core CRUD |
| 094 - SOC2 Readiness | 3.5/10 | No CI/CD, no tests, no change management process; strong on auth/headers |
| 095 - Postmortem Framework | 5/10 | Good documentation exists but zero operational tooling (alerting, tracking, status page) |

### Priority Remediation Order

1. **Mount `piiMaskingMiddleware`** on Express app and verify structured logger flows through console interceptor (092, quick win).
2. **Integrate an analytics backend** (PostHog self-hosted or Mixpanel) and route `/api/telemetry` events to it (091).
3. **Add `activityLogger` calls** to lead CRUD, deal CRUD, billing webhooks, settings changes, and permission changes (093).
4. **Establish CI pipeline** with `npm run check`, basic smoke tests, and deployment gates (094).
5. **Set up alerting** on health endpoints (Fly.io checks or Uptime Robot) and configure PagerDuty or equivalent (095).
6. **Encrypt PII columns** at rest or implement application-level field encryption for email/phone/address in leads table (092/094).
7. **Document event taxonomy** with naming conventions, required properties, and categorization rules (091).
