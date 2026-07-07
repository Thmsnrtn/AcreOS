# Iolanda Quiroga — Salesforce ISV Partner Engineering Lens

**Reviewer:** Iolanda Quiroga, 44, Partner Engineering, Salesforce ISV Team
**Date:** 2026-05-01
**Wave:** 3 (Ecosystem + channel partners)
**Scope:** AcreOS as a Salesforce-integrable surface for Penelope-tier Land Investors who run their book of record in Sales Cloud and want AcreOS data flowing in as either a managed package or via a connected app.

---

## Executive Summary

Penelope-tier Land Investors (5+ users, multi-state pipelines, often part of a family office or fund-adjacent shop) standardize on Salesforce because their CFO already pays the per-seat tax. They will not migrate their CRM to AcreOS. Their ask is the inverse: keep AcreOS as the parcel/deal/loan system of record, but stream a normalized projection into Salesforce so reporting, forecasting, and territory management stay where finance already lives.

AcreOS today has the *seeds* of an integration story — a generic `organization_integrations` table, a thin SAML SSO router that proxies Clerk, an outbound webhook handler class, and a `routes-data-api.ts` keyed by `x-api-key`. None of it is shaped for Salesforce. There is zero Salesforce-specific code in the repo (`grep -r salesforce` returns nothing in `server/` or `client/`). To be AppExchange-listable in 2026-Q4, AcreOS needs a deliberate ISV track: a connected app, a managed package skeleton, named-credentials-friendly OAuth, and SOQL-shaped projection endpoints. The good news is that the data model (`leads`, `properties`, `deals`, `payments`, `notes`, `campaigns`) maps cleanly to standard SObjects with a thin Apex shim.

---

## What Exists Today

### Integration Surface
- `/Users/user/AcreOS/AcreOS/server/routes-integrations.ts` (1,732 lines) — generic per-provider CRUD: SendGrid, Twilio, Lob, Stripe Connect. No Salesforce slot in the `provider` enum (`shared/schema.ts:212`).
- `/Users/user/AcreOS/AcreOS/server/routes-data-api.ts` (289 lines) — `x-api-key` gated read endpoints for benchmarks, price trends, demand. Read-only, no per-record CRUD, no delta cursor.
- `/Users/user/AcreOS/AcreOS/server/webhookHandlers.ts` (752 lines) — class-based outbound webhook dispatcher.
- `/Users/user/AcreOS/AcreOS/server/routes-import-export.ts` (534 lines) — CSV-shaped, not Bulk API 2.0 shaped.
- `/Users/user/AcreOS/AcreOS/server/openapi-spec.ts` + `openapi-reflector.ts` — present, useful for ISV documentation if kept current.

### SSO
- `/Users/user/AcreOS/AcreOS/server/routes-sso.ts` (108 lines) proxies Clerk's SAML connection API and gates it behind `scale`/`enterprise` tier.
- It does not currently advertise SP metadata at a stable URL, expose ACS/SLO endpoints by tenant, or support IdP-initiated flows from Salesforce-as-IdP. Clerk does the heavy lifting but the AcreOS façade is too thin to claim "Salesforce SSO" on a listing page.

### Schema Hooks
- `organization_integrations.credentials` is a permissive `jsonb` (`shared/schema.ts:214–226`) — fine for adding OAuth refresh tokens but currently only types fields for Twilio/SendGrid/Stripe. Salesforce instance URL, OAuth refresh token, API version, and named-credential alias need first-class type slots.

---

## Gap Analysis — AppExchange Readiness

### 1. Connected App + OAuth 2.0 Web Server Flow
**Status:** Missing entirely.
**Need:**
- Register an AcreOS Connected App in a packaging org with consumer key/secret stored in Fly secrets (not in `organization_integrations.credentials.encrypted` — those are *customer* creds).
- Implement `/api/integrations/salesforce/oauth/authorize` (302 to Salesforce login) and `/api/integrations/salesforce/oauth/callback` (PKCE, exchange code for `access_token` + `refresh_token` + `instance_url`).
- Persist `refresh_token` per-org, encrypted via the same envelope used elsewhere. Refresh on 401 with backoff.
- Support both production (`login.salesforce.com`) and sandbox (`test.salesforce.com`) — Penelope-tier shops always test in sandbox first.

**Why it matters for AppExchange:** AppExchange security review requires OAuth, never username/password. PKCE is now mandatory for new listings (Spring '25 enforcement).

### 2. Managed Package vs. Connected App-Only
**Recommendation:** Start with a *Connected App + lightweight unmanaged extension package* and graduate to a managed 1GP/2GP package only when the field-mapping UI lives inside Salesforce.

**Reasoning:** A managed package implies Apex code, custom objects, Lightning components, and an annual security review (~6–12 weeks lead time). Penelope-tier customers in 2026 will accept a connected-app-only listing if the field mapping happens on the AcreOS side and they install nothing more than a permission set + named credential pointer. Iolanda's team has shipped 30+ ISV partners in this shape; it is the fastest path to an AppExchange tile.

### 3. Real-Time vs. Batch Sync
**Today:** Neither exists for Salesforce.
**Target architecture:**
- **Outbound (AcreOS → Salesforce):** Use Salesforce Bulk API 2.0 for the initial backfill (per-org, paged by `properties.updatedAt`), then Composite Graph API for sub-second deltas triggered off the existing `webhookHandlers.ts` event bus. Add a `salesforce` sink alongside the current providers.
- **Inbound (Salesforce → AcreOS):** Salesforce Platform Events or Change Data Capture (CDC) subscribed via CometD/Pub-Sub API; AcreOS consumes and reconciles. Penelope-tier finance teams *will* edit deal stages in Salesforce and expect AcreOS to reflect.
- **Conflict policy:** Last-writer-wins is unacceptable for `deals.stage` and `payments.status`. Use field-level `updatedAt` + a per-field "system of record" map (default: AcreOS owns `parcel`/`property`/`payment`; Salesforce owns `opportunity stage`/`forecast category`/`account owner`).

### 4. Field Mapping
The natural object mapping is:

| AcreOS table | Salesforce SObject | Notes |
|---|---|---|
| `leads` | `Lead` (until conversion), `Contact` + `Account` (after) | Mirror `leadConversions` to fire `Database.LeadConvert` server-side. |
| `properties` | Custom object `acr__Parcel__c` | Holds APN, acreage, county, FIPS, geometry as `Geolocation` + `LongTextArea`. |
| `deals` | `Opportunity` with `acr__Parcel__c` lookup | Stage map needs explicit picklist alignment. |
| `payments` + `taxEscrowPayments` | `acr__Payment__c` child of `Opportunity` | Penelope tier wants amortization visible in forecasts. |
| `notes` | `Task`/`Note` (polymorphic `WhatId`) | Type-coerce AcreOS rich text to Salesforce-safe HTML. |
| `campaigns` + `campaignResponses` | `Campaign` + `CampaignMember` | Direct mapping; AcreOS has the better attribution model so flow it *into* SF. |
| `organizations` | n/a (one Salesforce org = one AcreOS org) | Multi-tenant linkage via Connected App. |

**Custom field translation:** The `custom_fields/definitions` endpoints already in `routes-integrations.ts:1298+` are the right surface to drive a mapping wizard — exposed today as AcreOS-internal, must also project to Salesforce custom fields with namespace prefix `acr__`.

### 5. SOQL-Friendly Data Shapes
AcreOS' current API responses are nested JSON with embedded relations. Salesforce ISV pattern wants **flat, indexable, ID-stable projections**:
- Stable external IDs: every record needs an `External_Id__c` populated with `acr_<tenant>_<table>_<id>` (e.g., `acr_org42_property_8891`). This becomes the upsert key for Bulk API 2.0.
- Predictable column names: snake_case → PascalCase translation must be deterministic; no runtime field renames.
- Pagination by `SystemModstamp`-equivalent: AcreOS already has `updatedAt` on every relevant table — expose `?since=<iso>&cursor=<id>` on a dedicated `/api/v1/sync/<entity>` route. The existing `routes-data-api.ts` is read-only-aggregate and unsuitable; this is a new router.
- Hard 200-record page caps mirroring SOQL governor friendliness.

### 6. Conflict Resolution
Today: no conflict story exists. Recommended:
- Per-record `revision` integer that bumps on every write (already implicit via `updatedAt` but not strictly monotonic across replicas).
- `If-Match: <revision>` header on the sync endpoints; 412 on mismatch with current server state in body so the SF Apex callout can resolve.
- Per-field `LastModifiedBySystem__c` (`acreos` | `salesforce` | `user_<id>`) so the merge UI can show provenance.

### 7. Custom Object Support (Iolanda's Specific Concern)
Penelope-tier shops typically have ≥3 Salesforce custom objects already (`Investment__c`, `Capital_Call__c`, `LP__c`). AcreOS must:
- Let the customer map any AcreOS custom field to *their* existing custom object/field, not just to AcreOS-suggested objects. The mapping wizard must read `/services/data/v60.0/sobjects/<Object>/describe` and present field pickers.
- Round-trip relationships: if the customer has a `LP__c` lookup on `Opportunity`, AcreOS must let them tag a deal with an LP and have it carry across.

---

## Critical Findings

### F1 — No Salesforce-shaped sync endpoints
**Severity:** Blocker for Penelope-tier sale.
**Evidence:** `routes-data-api.ts` exposes only aggregate analytics; no per-record listing with delta cursor. Bulk backfill of 50k parcels is impossible without a new route.
**Fix:** Add `server/routes-sync.ts` exposing `/api/v1/sync/{leads,properties,deals,payments}` with cursor pagination, hard caps, and external-ID stamping.

### F2 — `organization_integrations.credentials` typing too narrow
**Severity:** Medium.
**Evidence:** `shared/schema.ts:214–226` types only Twilio/SendGrid/Stripe fields. A Salesforce row would need `instanceUrl`, `refreshToken`, `apiVersion`, `connectedAppId`, `sandboxMode`.
**Fix:** Extend the `$type<>` union — additive, no migration.

### F3 — SAML SSO does not advertise SP metadata
**Severity:** Medium for Salesforce-as-IdP scenarios.
**Evidence:** `routes-sso.ts` only manages connections via Clerk's API; no `/sso/sp-metadata.xml` endpoint, no per-tenant ACS URL, no SLO.
**Fix:** Either expose Clerk's SP metadata directly under an AcreOS-branded URL, or add a thin proxy. AppExchange listings that claim "SAML SSO" but do not publish SP metadata fail security review.

### F4 — No connected-app credential separation
**Severity:** Architectural.
**Evidence:** `organization_integrations.credentials` is the same blob for AcreOS-platform-secrets and per-tenant secrets. Salesforce ISV pattern requires the consumer key/secret to be platform-owned (Fly secret) while only the refresh token is per-tenant.
**Fix:** New `platform_integration_keys` table (or env-only) for ISV-owned creds; keep `organization_integrations` for tenant tokens.

### F5 — No outbound webhook signing for Salesforce inbound
**Severity:** Medium.
**Evidence:** `webhookHandlers.ts` is outbound-only. Salesforce Apex callouts into AcreOS need an HMAC scheme AcreOS validates; nothing in `middleware/` currently signs/verifies inbound webhooks for non-Stripe sources.
**Fix:** Generic HMAC-SHA256 verifier middleware keyed by integration, mirroring the Stripe pattern.

### F6 — No AppExchange listing artifacts
**Severity:** Sales-blocking when Iolanda goes to bring AcreOS to her ISV pipeline.
**Evidence:** Repo has no `/sfdx-project.json`, no `force-app/`, no install link, no security-review documentation, no Trust report URL.
**Fix:** Stand up a sibling repo `acreos-sf-package/` (sfdx 2GP). Even an empty package with a permission set and named credential template is enough to claim a tile.

### F7 — Tier gating mismatch
**Severity:** Low but commercially relevant.
**Evidence:** `routes-sso.ts:24` gates SSO behind `scale`/`enterprise`. Salesforce-the-CRM-customer is almost always Penelope-tier (which I assume maps to `scale`). The mapping is correct but undocumented; nothing on the pricing page connects "Salesforce sync" to a tier.
**Fix:** Add `salesforceSync` capability flag to the tier matrix, surface in `/billing` UI.

### F8 — No retry/dead-letter for sync failures
**Severity:** Medium.
**Evidence:** No bull/agenda-style queue for outbound integration jobs visible in `server/jobs/`. Salesforce will throw `REQUEST_LIMIT_EXCEEDED` and `STORAGE_LIMIT_EXCEEDED` and AcreOS must back off, not drop.
**Fix:** Add a `salesforce_sync_jobs` queue table with status, attempt count, next-retry-at, last error.

---

## Recommendations — Sequenced

### Sprint 1 (2 weeks)
1. New `salesforce` provider slot in `organization_integrations.provider` enum + extended credential typing (F2).
2. `/api/integrations/salesforce/oauth/{authorize,callback}` with PKCE (F1 prerequisite).
3. Platform vs. tenant credential separation (F4).
4. Sandbox toggle persisted on the integration row.

### Sprint 2 (2 weeks)
5. `server/routes-sync.ts` exposing `/api/v1/sync/{leads,properties,deals,payments}` with `since`/`cursor` (F1).
6. External-ID stamping on outbound; per-field `lastModifiedBySystem` on inbound writes (F1, conflict policy).
7. HMAC-verifying inbound webhook middleware (F5).
8. Sync job queue with backoff (F8).

### Sprint 3 (3 weeks)
9. Sibling sfdx 2GP package with a permission set, named credential template, and a "Verify Connection" Lightning component (F6).
10. Field-mapping wizard UI in AcreOS reading SF describe API (custom-object support).
11. Documentation pack for AppExchange security review (Trust URL, data-handling diagram, SOC 2 letter).

### Sprint 4 (2 weeks)
12. Platform Events / CDC subscriber for inbound real-time.
13. Conflict UI surfacing the `If-Match: 412` collisions to a human queue.
14. List on AppExchange as "Connected App" tier; defer managed-package security review to v2.

---

## What I'd Tell My ISV Pipeline Today

If a Penelope-tier prospect asked me whether AcreOS is Salesforce-ready in 2026-05, I would say: *the data model is the cleanest land-investor schema I've seen and maps to standard SObjects without violence, but the integration plumbing is six to ten weeks of focused work away from being demoable in a partner sandbox.* The team has not made the architectural mistakes that usually torpedo ISV partnerships (no shared-secret-only auth, no monolithic sync-everything-on-cron, no proprietary ID scheme that ignores `External_Id__c` semantics). What's missing is the deliberate Salesforce-shaped surface — and that's a roadmap item, not a rewrite.

The single highest-leverage move: ship F1 + F2 in Sprint 1 and let me put AcreOS in front of three pilot Penelope shops who already asked me about land-CRM integration.

---

## File References
- `/Users/user/AcreOS/AcreOS/server/routes-sso.ts` — SAML proxy via Clerk
- `/Users/user/AcreOS/AcreOS/server/routes-integrations.ts` — generic provider CRUD
- `/Users/user/AcreOS/AcreOS/server/routes-data-api.ts` — public read API
- `/Users/user/AcreOS/AcreOS/server/webhookHandlers.ts` — outbound webhook dispatcher
- `/Users/user/AcreOS/AcreOS/server/routes-import-export.ts` — CSV import/export
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:209–255` — `organization_integrations` table
- `/Users/user/AcreOS/AcreOS/shared/schema.ts:328+` — `leads`, `properties`, `deals`, `payments` tables
- `/Users/user/AcreOS/AcreOS/server/openapi-spec.ts` — OpenAPI surface (useful for ISV listing docs)

— **Iolanda Quiroga**, Salesforce ISV Partner Engineering
