# Red Team Review #01: The Angry Enterprise Buyer

**Reviewer Persona:** Karen Westbrook, VP of Operations at Pinnacle Land Acquisitions, a firm with 50+ team members across 8 states, processing 2,000+ leads per month, managing a $40M seller-financed note portfolio.

**Review Date:** 2026-04-18

**Evaluation Context:** Karen is evaluating AcreOS as a potential replacement for the firm's current patchwork of Salesforce, custom spreadsheets, and a legacy servicing tool. She needs a platform that can pass Pinnacle's internal IT security review, support her large distributed team, and integrate with existing enterprise tooling. She has a 45-day evaluation window and zero patience for gaps.

---

## Area 1: Team Management & RBAC

**Verdict: CONCERN**

### What exists

AcreOS provides a four-tier RBAC system (`server/utils/permissions.ts`):

- **owner** -- full access including billing and org deletion
- **admin** -- full operational access, no billing or org deletion
- **member** -- CRUD on core entities, no admin/settings/import/export/delete, viewOnlyAssignedLeads=true
- **viewer** -- read-only, viewOnlyAssignedLeads=true

The system covers 26 discrete permission flags including data-level restrictions (`viewOnlyAssignedLeads`, `canAssignLeads`, `canExportData`). Permission checks are enforced via Express middleware (`requirePermission`, `requireAdminOrAbove`, `requireOwner`) and are actively used in routes:

- `routes-leads.ts` gates delete and bulk-delete behind `canDeleteLeads`, export behind `canExportData`
- `routes-campaigns.ts` gates creation behind `canCreateCampaign`
- `routes-organization.ts` gates team role changes behind `requireAdminOrAbove()`

### Enterprise gaps

1. **No custom roles.** The four roles are hardcoded in `ROLE_PERMISSIONS` with no mechanism to define custom roles or override individual permissions. A 50-person team needs roles like "Acquisitions Manager" (can create deals and assign leads but not delete), "Compliance Officer" (read-only plus export), or "Junior Analyst" (view properties only). The current scheme is too coarse.

2. **No field-level permissions.** There is no mechanism to restrict visibility of specific fields (e.g., hiding financial terms from junior staff). The `viewOnlyAssignedLeads` flag limits row-level scope but there are no column-level controls.

3. **No permission enforcement on billing routes.** `routes-billing.ts` uses only `isAuthenticated` + `getOrCreateOrg` -- any authenticated team member can view credit balances, transaction history, and usage records. The `canManageBilling` permission flag exists but is never checked on billing read routes.

4. **No permission enforcement on finance routes.** `routes-finance.ts` has no `requirePermission` or `requireAdmin` middleware on any route, meaning any team member can access seller-financed note portfolio data.

5. **Seat limits exist but are generous enough.** Enterprise tier: 25 included seats, unlimited max, $50/additional seat. Scale: 10 included, 100 max, $40/seat. This is workable for my team size.

### P1 Finding: DEFECT-ENT-001

**Billing routes lack permission gating.** Any authenticated member of an organization can hit `/api/credits/balance`, `/api/credits/transactions`, `/api/usage/summary`, and `/api/usage/records` without `canManageBilling` being checked. Financial data exposure to unauthorized team members.

- **File:** `server/routes-billing.ts`, lines 21-66
- **Severity:** P1

### P1 Finding: DEFECT-ENT-002

**Finance routes lack permission gating.** No `requirePermission` or `requireAdmin` middleware is applied to any finance route, exposing seller-financed note portfolio data (balances, payment schedules, delinquencies) to every team member including viewers.

- **File:** `server/routes-finance.ts`
- **Severity:** P1

---

## Area 2: SSO/SAML Integration

**Verdict: PASS**

### What exists

AcreOS has a dedicated SSO router (`server/routes-sso.ts`) that:

- Uses the Clerk Admin API (`@clerk/express`) to manage SAML connections
- Gates SSO management behind a tier check: `scale`, `enterprise`, or `isFounder` only
- Supports full SAML lifecycle: list connections, create with IdP metadata (URL, entity ID, SSO URL, certificate), delete
- Handles Clerk enterprise plan limitations gracefully (returns empty list with explanatory message if Clerk SAML is not enabled)

This is a clean implementation. My IT team can configure Okta or Azure AD via the SAML endpoints once we are on the Scale or Enterprise tier.

### Minor concerns

- The connection list endpoint filters with `true` (line 37: `true // Clerk doesn't scope by org`), meaning all SAML connections are visible to any org. In a multi-tenant Clerk setup this could leak connection metadata across orgs. Low risk since connection names/domains are not highly sensitive, but not ideal.
- No SCIM provisioning support for automated user lifecycle management. This is standard for enterprises with 50+ users.

---

## Area 3: Audit Logging

**Verdict: CONCERN**

### What exists

AcreOS has a formal audit log infrastructure:

- **Schema** (`shared/schema.ts:4106`): `audit_log` table with `organizationId`, `userId`, `action`, `entityType`, `entityId`, `changes` (before/after/fields JSONB), `ipAddress`, `userAgent`, `metadata`, `createdAt`
- **Storage layer** (`server/storage.ts`): `createAuditLogEntry`, `getAuditLogs` (with filtering by action, entity type, entity ID, user ID, date range), `getAuditLogCount`, and a purge function
- **API endpoint** (`server/routes-import-export.ts:300`): `GET /api/audit-log` with full query parameter filtering
- **Action types** defined: create, update, delete, login, logout, export, import, consent_granted, consent_revoked, data_purge

### Audit coverage by route file

| Route file | createAuditLogEntry calls | Assessment |
|---|---|---|
| `routes-leads.ts` | 5 calls | Good coverage for CRUD |
| `routes-properties.ts` | 5 calls | Good coverage |
| `routes-deals.ts` | 2 calls | Partial |
| `routes-import-export.ts` | 3 calls (imports + consent) | Covers imports |
| `routes-campaigns.ts` | 1 call | Only creation logged |
| `routes.ts` | 10 calls | Good breadth |
| `routes-billing.ts` | 1 call | Only credit purchase |
| `routes-organization.ts` | 0 explicit calls | Gap |
| `routes-finance.ts` | 0 explicit calls | Gap |
| `routes-communications.ts` | present | Covered |
| `routes-compliance.ts` | present | Covered |
| `routes-crm-extras.ts` | present | Covered |
| `routes-integrations.ts` | present | Covered |

### Enterprise gaps

1. **Inconsistent coverage.** Not every mutation is audit-logged. Organization settings changes, team member additions/removals, role changes, billing mutations (subscription upgrades/downgrades), and finance operations are not systematically audited.

2. **No audit log for authentication events.** Login and logout are defined as action types but there is no evidence they are actually written to the audit log by the auth middleware.

3. **Audit log purge is configurable.** Organizations can set `retentionPolicies.auditLogs` in their settings, but the data retention job (`server/jobs/dataRetention.ts`) does not include the audit_log table in its retention rules. The org-level purge is handled separately. For SOC2, audit logs should have a minimum retention of 1 year that cannot be shortened by the user.

4. **No tamper protection.** Audit log entries are plain database rows with no hash chaining, signing, or append-only enforcement. An admin with database access could modify or delete entries.

5. **Audit log access is not permission-gated.** The `GET /api/audit-log` endpoint requires authentication but does not check `canAccessSettings` or any admin-level permission.

### P1 Finding: DEFECT-ENT-003

**Audit log endpoint has no permission check.** Any authenticated team member (including viewers and members) can read the full organization audit log via `GET /api/audit-log`, potentially exposing sensitive operational data about who did what and when.

- **File:** `server/routes-import-export.ts`, line 300
- **Severity:** P1

---

## Area 4: Data Export

**Verdict: PASS**

### What exists

AcreOS provides comprehensive data export capabilities:

- **Per-entity CSV/JSON export** (`GET /api/export/:entityType`): Supports leads, properties, deals, and notes. Both CSV and JSON formats. Includes date/status/type filters.
- **Full backup** (`GET /api/export/backup`): Creates a complete JSON archive of all organization data with metadata (org name, export timestamp, all entity files).
- **GDPR personal data export** (`POST /api/privacy/export`): Returns a JSON archive of all personal data associated with a user account (leads, deals, properties, tasks, messages, support tickets).
- **Permission gating**: The leads export route checks `canExportData` permission. The main export routes use `isAuthenticated` + `getOrCreateOrg`.

### Minor concerns

- The main export routes (`GET /api/export/:entityType`) do not check `canExportData` permission -- only the duplicate leads export route does. Members and viewers could export data through this route.
- No export in Excel/XLSX format, which some enterprise finance teams prefer.
- The GDPR export caps at 1,000 records per entity type (`LIMIT 1000` in queries). For a large organization this could silently truncate the export.

---

## Area 5: SLA / Uptime Guarantees & Health Monitoring

**Verdict: CONCERN**

### What exists

AcreOS has a thorough health check system (`server/services/healthCheck.ts`):

- Checks 7 services: database, Redis, Stripe, OpenAI, Twilio, email (AWS SES), Lob
- Reports status as healthy/degraded/unavailable/unconfigured with latency metrics
- Database check includes connection pool stats (total, idle, waiting)
- Periodic checks run every 60 seconds by default
- Alerts after 5 consecutive failures (~5 minutes) by creating system alerts
- Critical service distinction (database, Redis, Stripe trigger higher severity alerts)

### Enterprise gaps

1. **No public status page.** There is no externally visible uptime dashboard. Enterprise buyers need a status.example.com to verify SLA compliance independently.

2. **No documented SLA.** The Terms of Service (`client/src/pages/terms.tsx`) describe the service but contain no uptime commitments, credit policies for downtime, or response time guarantees.

3. **No external synthetic monitoring.** Health checks run from within the application itself. If the entire Fly.io instance goes down, the health check system goes down with it.

4. **No documented incident response SLA.** The `docs/incident-response.md` file exists but enterprise customers need contractual commitments (e.g., P1 acknowledgement within 15 minutes, P2 within 1 hour).

---

## Area 6: Multi-Org / Subsidiary Support

**Verdict: FAIL**

### What exists

AcreOS is built as a single-org-per-account system. The `organizations` table provides multi-tenancy, and users can be members of organizations via `team_members`. However:

- There is no parent-org / child-org relationship in the schema.
- There is no concept of organization groups, subsidiaries, or entity hierarchies.
- There is no cross-org data sharing or consolidated reporting.
- No grep matches for `multi_org`, `subsidiary`, `sub_org`, or `parent_org` anywhere in the codebase.

### Enterprise impact

Pinnacle operates through 3 LLCs across different states. Each LLC has its own deals and compliance requirements, but the executive team needs consolidated dashboards. Today this would require 3 separate AcreOS accounts with no data bridge between them. This is a dealbreaker for our organizational structure.

---

## Area 7: API Access

**Verdict: PASS**

### What exists

AcreOS has a public developer API infrastructure:

- **API key management** (`server/services/developerApiService.ts`): SHA-256 hashed keys with `acr_` prefix, 13 granular scopes (properties:read/write, leads:read/write, deals:read/write, market:read, valuations:read, campaigns:read/write, webhooks:read/write, analytics:read)
- **Rate limiting by tier**: Free 1,000/day, Starter 10,000/day, Pro 50,000/day, Scale 500,000/day. Includes per-minute and concurrent request limits.
- **OpenAPI spec** (`server/openapi-spec.ts`): Full OpenAPI 3.0 specification served via Swagger UI at `GET /api/docs` and raw JSON at `GET /api/docs/openapi.json`
- **Webhook system**: Comprehensive webhook event types covering lead, deal, property, payment, campaign, and document lifecycle events with HMAC signature verification

### Minor concerns

- API documentation is auto-generated from the spec but the spec's completeness is unknown without full review.
- No SDK or client library published for any language.
- Enterprise tier API pricing ($1,999+/month) is mentioned in code comments but not surfaced in customer-facing materials.

---

## Area 8: Compliance (SOC2, GDPR, Data Residency)

**Verdict: CONCERN**

### What exists

**GDPR/CCPA:**
- Dedicated GDPR service (`server/services/gdprService.ts`): Implements Article 15 (Right of Access / data export) and Article 17 (Right to Erasure / anonymization)
- GDPR routes (`server/routes-gdpr.ts`): `POST /api/privacy/export`, `POST /api/privacy/delete`, `GET /api/privacy/status`
- Privacy Policy page (`client/src/pages/privacy.tsx`): Comprehensive, last updated March 2026
- TCPA compliance routes with consent tracking
- Data retention job (`server/jobs/dataRetention.ts`): Nightly purge of old logs (30-90 day retention by table)

**Encryption:**
- AES-256-GCM field-level encryption for credentials (`server/services/encryption.ts`) with scrypt key derivation, random per-record salt, auth tag verification
- Key rotation script exists (`server/scripts/rotateEncryptionKey.ts`)

### Enterprise gaps

1. **No SOC2 certification or attestation.** No evidence of SOC2 Type I or Type II audit preparation, controls documentation, or third-party assessment.

2. **No Data Processing Agreement (DPA).** This has been flagged in prior audits (`docs/audits/lenses/31-legal-compliance.md:72`, `docs/audits/lenses/141-150-launch-readiness-meta.md:250`) but remains unresolved. Under GDPR Article 28, AcreOS must offer a DPA to customers, and evidence shows no DPAs are in place with sub-processors like Twilio, Lob, or AWS SES.

3. **No data residency controls.** Only two files in the codebase mention data residency, neither implementing actual region selection. All data resides in a single Fly.io region with no option for EU-only or specific geographic data storage.

4. **PII stored in plaintext.** Lead and property tables store email, phone, and mailing addresses as unencrypted text columns. Only integration credentials use field-level encryption. For enterprise compliance, PII at rest should be encrypted.

5. **GDPR export truncation.** The `exportUserData` function caps each entity type at 1,000 records (`LIMIT 1000`), which would produce an incomplete GDPR export for a large organization -- a potential regulatory violation.

### P0 Finding: DEFECT-ENT-004

**GDPR data export silently truncates results.** `server/services/gdprService.ts:76-81` applies `LIMIT 1000` to every entity query. For a user with 2,000+ assigned leads, the export will silently omit records, producing an incomplete Article 15 response. This is a regulatory compliance violation.

- **File:** `server/services/gdprService.ts`, lines 76-81
- **Severity:** P0

---

## Area 9: Billing Transparency

**Verdict: PASS**

### What exists

AcreOS has a well-structured billing system:

- **Tiered pricing** (`server/services/usageLimits.ts`): Free, Starter, Pro, Scale, Enterprise with clear resource limits per tier
- **Per-seat pricing**: Pro $20/seat, Scale $40/seat, Enterprise $50/seat (negotiable) with defined included seats (2, 10, 25 respectively)
- **Usage-based billing**: Credit system with per-action cost tracking, balance queries, transaction history, usage summaries by month, rate lookup, and cost estimation endpoint
- **Credit packs**: Purchasable via Stripe with idempotency protection against duplicate charges
- **Auto top-up**: Configurable threshold and amount for automatic credit replenishment
- **Transparent metering**: `GET /api/usage/rates` returns all action types with their unit costs, `POST /api/usage/estimate` previews costs before execution

### Minor concerns

- Scale and Enterprise tiers are feature-flagged (`pricing_enterprise_tier_enabled: false`), so a buyer cannot self-serve onto the enterprise plan.
- No documented volume discounts or annual commitment pricing.

---

## Area 10: Contract / Legal

**Verdict: CONCERN**

### What exists

- **Terms of Service** (`client/src/pages/terms.tsx`): Comprehensive document covering acceptance, service description, account responsibilities, data handling, payment terms, disclaimers, liability limitations
- **Privacy Policy** (`client/src/pages/privacy.tsx`): Detailed policy covering data collection, usage, sharing, security measures, user rights (access, correction, deletion, portability)
- **Data breach response runbook** (`docs/runbooks/data-breach-response.md`): Includes supervisory authority notification process

### Enterprise gaps

1. **No DPA available.** As noted in Area 8, this is a known gap flagged in multiple prior audits.

2. **No BAA (Business Associate Agreement).** If any enterprise customer handles property records with health-related liens or disability-related accommodations, HIPAA may apply.

3. **No custom contract support.** Enterprise deals typically require MSAs (Master Service Agreements) with negotiated terms. No evidence of contract flexibility infrastructure.

4. **No insurance documentation.** No evidence of cyber liability insurance, errors & omissions coverage, or professional liability insurance -- standard enterprise vendor requirements.

5. **No sub-processor list published.** While the privacy policy mentions third-party services, there is no formal sub-processor register with update notification mechanism as required by GDPR Article 28.

---

## Summary

| Area | Verdict | Key Issue |
|---|---|---|
| 1. Team Management & RBAC | CONCERN | No custom roles; billing/finance routes unguarded |
| 2. SSO/SAML | PASS | Clean Clerk-based SAML implementation |
| 3. Audit Logging | CONCERN | Inconsistent coverage; no permission gate on audit endpoint |
| 4. Data Export | PASS | CSV, JSON, full backup, GDPR export all available |
| 5. SLA / Uptime | CONCERN | No public status page; no contractual SLA |
| 6. Multi-Org / Subsidiary | FAIL | No parent/child org support at all |
| 7. API Access | PASS | OpenAPI spec, scoped keys, webhooks, rate limits |
| 8. Compliance | CONCERN | No SOC2, no DPA, no data residency, PII unencrypted |
| 9. Billing Transparency | PASS | Clean credit system with estimation and metering |
| 10. Contract / Legal | CONCERN | No DPA, no MSA, no sub-processor list |

**Totals: 4 PASS, 5 CONCERN, 1 FAIL**

---

## Defects Discovered

### P0

| ID | Description | File | Area |
|---|---|---|---|
| DEFECT-ENT-004 | GDPR data export silently truncates at 1,000 records per entity | `server/services/gdprService.ts:76-81` | Compliance |

### P1

| ID | Description | File | Area |
|---|---|---|---|
| DEFECT-ENT-001 | Billing routes lack `canManageBilling` permission check | `server/routes-billing.ts:21-66` | RBAC |
| DEFECT-ENT-002 | Finance routes have zero permission middleware | `server/routes-finance.ts` | RBAC |
| DEFECT-ENT-003 | Audit log endpoint readable by any authenticated user | `server/routes-import-export.ts:300` | Audit |

---

## Enterprise Buyer Verdict

**Not ready for enterprise deployment in its current state.** The platform has strong fundamentals -- the RBAC framework is well-designed, the audit log schema is comprehensive, the API infrastructure is mature, and the billing system is transparent. However, four critical gaps block enterprise adoption:

1. **Multi-org support is absent.** My firm operates through multiple LLCs and needs consolidated management. This is a structural gap that requires schema-level changes.

2. **Permission enforcement is inconsistent.** The RBAC system defines permissions that are not checked on billing, finance, and audit log routes. This would fail our internal security review.

3. **Compliance infrastructure is incomplete.** No SOC2 attestation, no DPA, no data residency options, and PII stored in plaintext. Our legal team would not approve onboarding without at minimum a signed DPA and a compliance roadmap.

4. **The GDPR export bug (DEFECT-ENT-004) is a regulatory risk.** Silently truncating personal data exports is a violation that could result in supervisory authority action.

If these gaps were addressed on a 90-day roadmap with contractual commitments, AcreOS would be a compelling platform for enterprise real estate operations. The underlying architecture is sound -- it just needs the enterprise hardening layer.
