# Lens 43 -- Direct Mail / Lob Integration Audit

Generated: 2026-04-15
Auditor: Claude (automated)
Scope: Direct mail campaign workflow, template creation, address verification, Lob API integration, cost management, test vs live mode, tracking and attribution

---

## Executive Summary

AcreOS has a surprisingly mature direct mail subsystem spanning **three** Lob service files (`lobService.ts`, `directMail.ts`, `directMailService.ts`), a multi-provider mail abstraction (`mailProvider.ts`), an address verification service (`addressValidation.ts`), a dedicated schema for mailing orders and individual mail pieces, and a full sender identity management system. The architecture supports BYOK (Bring Your Own Key) for Lob credentials, test/live mode switching, per-piece credit deduction with refunds for failures, and A/B variant testing for campaigns.

However, the system contains **critical data-integrity bugs** where mail can be sent with wrong or fabricated data. The three Lob service files duplicate logic with divergent behavior, the `sendDirectMail` path in `sequenceProcessor.ts` is a stub that only logs (never calls Lob), no pre-send address verification is enforced, and the `communications.ts` service hardcodes a fallback sender address of `123 Main St, Austin TX 78701`. There are no Lob webhooks for delivery tracking, meaning piece status never updates past "sent."

**Overall direct mail confidence: MEDIUM-LOW.** The data model and credit system are well-designed, but the sending paths have P0 bugs that can result in real mail going out with incorrect content, fake return addresses, or to unverified addresses.

---

## 1. Architecture Overview

### 1.1 Service Files (Four Overlapping Implementations)

| File | Lines | Purpose | Used By |
|------|-------|---------|---------|
| `server/services/lobService.ts` | 263 | Low-level Lob wrapper with typed errors, retry classification | `communications.ts` |
| `server/services/directMail.ts` | 358 | Higher-level service with cost estimation, address verification, BYOK, test/live mode | `routes-campaigns.ts` (send-direct-mail endpoint) |
| `server/services/directMailService.ts` | 322 | Alternative service with credit checking, sender identity, address verification | `routes-campaigns.ts` (verify-address endpoints) |
| `server/services/mailProvider.ts` | 425 | Multi-provider abstraction (Lob + PCM), org-level credential lookup | Not called from any route directly found |

**Finding:** Four files implement Lob integration with overlapping but divergent behavior. The campaign send route imports from `directMail.ts` for sending but from `directMailService.ts` for address verification. `lobService.ts` is used only by `communications.ts`. `mailProvider.ts` adds a PCM provider but appears orphaned from the main workflows.

### 1.2 Schema (Well-Designed)

- **`mail_sender_identities`**: Return address management with Lob verification status, IDOR protection
- **`mailing_orders`**: Campaign-level order records with cost tracking, credit usage, Lob job IDs
- **`mailing_order_pieces`**: Per-recipient records with tracking codes, Lob mail IDs, delivery status tracking events, expected delivery dates
- **`campaign_delivery_events`**: Channel-agnostic delivery event tracking
- **`api_usage_logs`**: Lob API cost tracking by org

### 1.3 Credential Management

Three environment variables supported: `LOB_API_KEY`, `LOB_TEST_API_KEY`, `LOB_LIVE_API_KEY`. Organizations can also store encrypted Lob credentials via the integration settings table (`organization_integrations`), enabling BYOK. When org credentials are present, platform credit deduction is skipped.

---

## 2. Findings

### P0 -- Mail Sent with Wrong Data

#### P0-1: `communications.ts` hardcodes a fake return address

**File:** `server/services/communications.ts:303-309`

When `sendDirectMailWithRetry` is called (via the sequence processor or direct lead communication), it builds the sender address as:

```typescript
const fromAddress = {
  name: org?.name || 'AcreOS',
  addressLine1: org?.settings?.companyAddress || '123 Main St',
  city: 'Austin',
  state: 'TX',
  zip: '78701',
};
```

If the organization has no `companyAddress` setting (which is the default for new orgs), **real mail is sent with "123 Main St, Austin, TX 78701" as the return address**. The city, state, and zip are always hardcoded regardless of the org's actual location. This means any response mail is returned to a nonexistent address. Worse, this path does NOT use the `mail_sender_identities` table at all -- it ignores the verified return address the user configured.

**Impact:** Physical mail sent to landowners with a fabricated return address. Responses lost. Potential legal liability for misleading return address on commercial solicitation mail.

#### P0-2: No template personalization in campaign send route

**File:** `server/routes-campaigns.ts:766-768`

When sending postcards, the content is:

```typescript
front: campaign.content || '<html><body><h1>Special Offer!</h1></body></html>',
back: `<html><body><p>Dear ${lead.firstName || 'Property Owner'},</p>
       <p>${campaign.subject || 'We are interested in your property.'}</p></body></html>`,
```

The front content is used raw from `campaign.content` with **zero** merge-field substitution. The UI template input shows placeholders like `[OWNER_NAME]` and `[PROPERTY_ADDRESS]` but these are never replaced in the send path. Only the back of the postcard gets a bare `firstName` injection. Similarly, for letters (line 780), `campaign.content` is passed as-is to Lob with no personalization.

Meanwhile, the `sequenceProcessor.ts` (line 270-279) has a `personalizeContent()` method that replaces `{{firstName}}`, `{{lastName}}`, `{{address}}`, etc., but this is never called from the campaign send route.

**Impact:** Postcards and letters sent to hundreds of recipients with unsubstituted template variables like `[OWNER_NAME]` in the body, or a generic "Special Offer!" front for postcards with no campaign content.

#### P0-3: Sequence processor `sendDirectMail` is a logging stub

**File:** `server/services/sequenceProcessor.ts:327-339`

```typescript
async sendDirectMail(lead: Lead, subject: string, content: string) {
    // ... address and TCPA checks ...
    logger.info("[sequence-processor] Direct mail sent", { metadata: { ... } });
}
```

This method only logs "Direct mail sent" -- it never calls Lob, `lobService`, `directMailService`, or any other mail sending function. A delivery event is recorded in `campaign_delivery_events` with status "sent" (line 252) despite no mail actually being sent.

**Impact:** Drip sequence steps configured as `direct_mail` appear to execute successfully but send nothing. Credits are not deducted, but the lead's sequence advances as if mail was delivered. Users see "sent" status for mail that was never created.

#### P0-4: `directMailService.ts` inconsistency in address field access for bulk verify

**File:** `server/routes-campaigns.ts:1285-1298`

The bulk-verify endpoint accesses `lead.mailingAddress` and `lead.zipCode`:

```typescript
if (!lead.mailingAddress || !lead.city || !lead.state || !lead.zipCode) { ... }
const verificationResult = await verifyAddress({
    line1: lead.mailingAddress,
    ...
    zip: lead.zipCode,
});
```

But the campaign send route (line 682) checks `lead.address` and `lead.zip`:

```typescript
const validLeads = leadsData.filter(l => l && l.address && l.city && l.state && l.zip);
```

The schema has both `address` (line 4354 `mailing_address` mapped as `mailingAddress` in some places, `address` in the leads table) fields. If a lead has `address` populated but not `mailingAddress` (or vice versa), the verification pass says "incomplete" while the send goes through, or verification passes but the send skips the lead.

**Impact:** Address verification results may not correspond to the address actually used for sending. Verified leads may be excluded from sends; unverified leads may be included.

### P1 -- Missing Address Verification Before Send

#### P1-1: No pre-send address verification in campaign send flow

**File:** `server/routes-campaigns.ts:679-686`

The send-direct-mail endpoint filters leads by whether they have non-null address fields:

```typescript
const validLeads = leadsData.filter(l => l && l.address && l.city && l.state && l.zip);
```

This checks for non-null but does not verify deliverability via Lob's US Verification API. Addresses like "asdfasdf, XX, 00000" pass this check. Address verification endpoints exist (`/api/direct-mail/verify-address`, `/api/direct-mail/bulk-verify-addresses`) but are entirely optional -- the send route does not call them or check any cached verification status.

**Impact:** Mail pieces sent to undeliverable addresses waste credits and Lob charges. USPS returns are not tracked.

#### P1-2: No Lob webhook integration for delivery tracking

There is no webhook endpoint for Lob delivery events anywhere in the codebase. The `mailingOrderPieces` schema has a `trackingEvents` JSONB column and status values including `in_transit`, `delivered`, `returned`, but these are never populated after the initial `sent` status is set.

The `expectedDeliveryDate` is recorded from the Lob API response, but actual delivery confirmation never arrives. The system has no mechanism to detect returned mail, re-mailed pieces, or delivery failures.

**Impact:** Mailing order piece status is permanently stuck at "sent." Response rate metrics cannot accurately correlate against delivered mail. Returned mail is undetectable.

#### P1-3: No idempotency protection on the send endpoint

**File:** `server/routes-campaigns.ts:616`

The `POST /api/campaigns/:id/send-direct-mail` endpoint has no idempotency key or duplicate-send guard. If a user clicks "Send" twice, or a network retry occurs, the same `leadIds` array will generate duplicate Lob mail pieces. Credits are deducted twice, and recipients receive duplicate mail.

The endpoint does update `campaign.totalSent` but does not check whether a mailing order already exists for this campaign or whether these specific leads already have `mailingOrderPieces` records.

**Impact:** Double-sends waste credits, damage sender reputation, and confuse recipients.

#### P1-4: Cost inconsistencies across services

| Service | Postcard 4x6 | Letter 1-page |
|---------|-------------|---------------|
| `directMail.ts` (DIRECT_MAIL_COSTS) | 75 cents | 125 cents |
| `directMail.ts` (logLobApiUsage) | 80 cents | 150 cents |
| `mailProvider.ts` (LOB_LETTER_COST) | 45 cents | 85 cents |
| `directMailService.ts` | Uses `usageMeteringService.calculateCost()` | Same |

The `DIRECT_MAIL_COSTS` constants used for credit deduction (75 cents for 4x6) differ from the cost logged to `api_usage_logs` via `logLobApiUsage` (80 cents for 4x6). The `mailProvider.ts` uses yet another set of costs ($0.45 for postcard, $0.85 for letter). Users are charged one amount but the system logs a different amount.

**Impact:** Financial reporting discrepancies. Users may be over- or under-charged relative to what is logged.

#### P1-5: `mailProvider.ts` silently succeeds when unconfigured

**File:** `server/services/mailProvider.ts:349-357`

When no mail provider credentials are configured:

```typescript
if (!credentials) {
    logger.info(`[Mail] No provider configured - would send letter to ${options.to.name}`);
    return {
      success: true,
      mailingId: `mock-letter-${Date.now()}`,
      isTestMode: true,
      provider: MailProvider.LOB,
    };
}
```

This returns `success: true` with a mock ID, which downstream code treats as a successful send. Any caller using this provider path will deduct credits and record "sent" status for mail that was never actually submitted to any API.

**Impact:** If this code path is reached in production, credits are consumed and "sent" status is recorded for phantom mail.

### P2 -- Optimization Opportunities

#### P2-1: Four overlapping Lob service files should be consolidated

`lobService.ts`, `directMail.ts`, `directMailService.ts`, and `mailProvider.ts` all implement Lob letter/postcard sending with slight variations. This creates maintenance burden and divergent behavior (see P0-1, P1-4). Consolidate into a single canonical `DirectMailService` that handles:
- Lob client construction (platform vs org credentials)
- Test/live mode
- Credit checking
- Address verification
- Sending with error classification and retry

#### P2-2: Batch sending is sequential, not parallelized

**File:** `server/routes-campaigns.ts:758`

The campaign send loop iterates over `validLeads` sequentially with `for...of`, making one Lob API call per lead. For a 500-piece campaign, this could take several minutes of synchronous execution in the request handler. There is no background job queue for batch sends -- the entire send happens inline in the HTTP request.

Consider: move batch sends to a background job (the `apiQueue` infrastructure already exists), use `Promise.allSettled` with concurrency limits, and return a mailing order ID immediately so the client can poll for status.

#### P2-3: Address verification uses sequential processing with artificial delay

**File:** `server/services/addressValidation.ts:151-159`

`validateAddressBatch` processes addresses one-by-one with a 20ms delay between calls. Lob's live API supports 150 req/s. For 100 addresses, this takes 2 seconds unnecessarily. Use concurrent batches of 10-20 with proper rate limiting instead.

#### P2-4: Template system is primitive

The UI offers `[OWNER_NAME]` and `[PROPERTY_ADDRESS]` placeholders but the send route does not substitute them. The sequence processor uses `{{firstName}}` style variables. There is no unified template engine, no template preview with sample data, and no validation that required merge fields have data for all recipients.

Consider: implement a `renderTemplate(template, lead)` function used by all send paths, with a preview endpoint, and pre-send validation that flags leads with missing merge field data.

#### P2-5: No send confirmation or dry-run mode

Users can send a campaign to hundreds of recipients with a single click. There is no confirmation dialog data on the server side (e.g., "You are about to send 347 postcards at $0.75 each, totaling $260.25. 12 leads have incomplete addresses and will be skipped."). The test mode exists but is a global org setting rather than a per-send toggle.

#### P2-6: `lob` npm package version concern

The project uses `lob@^7.1.0`. The Lob Node SDK v7 is a significant API change from earlier versions. The type declaration in `server/types/lob.d.ts` defines a constructor API (`new Lob({ apiKey })`) that matches v7, but the SDK's actual API surface may have drifted. The type file only covers `postcards`, `letters`, and `usVerifications` -- other Lob resources (checks, self-mailers, templates, address objects) are not typed, limiting future feature development.

#### P2-7: No tracking code on front/back of mail piece

Tracking codes are generated and stored in `mailingOrderPieces.trackingCode` (line 797), but they are not injected into the postcard/letter content sent to Lob. The recipient has no way to provide this code when responding, making attribution rely entirely on manual matching.

#### P2-8: `verifyAddress` in `directMail.ts` returns normalized Lob response fields that do not exist

**File:** `server/services/directMail.ts:334-339`

The `verifyAddress` method maps `result.primary_line` and `result.secondary_line` into the normalized address, but the Lob US Verification API returns these as `result.primary_line` at the top level and components in `result.components`. The `result.secondary_line` may be undefined, and the fallback is not handled, potentially yielding an address with missing line data.

---

## 3. Route Inventory

| Endpoint | Method | Description | Issues |
|----------|--------|-------------|--------|
| `/api/campaigns/:id/send-direct-mail` | POST | Send mail to specified leads | P0-2, P1-1, P1-3, P2-2 |
| `/api/campaigns/:id/estimate-cost` | GET | Cost estimate for campaign | None significant |
| `/api/direct-mail/status` | GET | Check Lob configuration and mode | None |
| `/api/direct-mail/mode` | PATCH | Toggle test/live mode | None |
| `/api/direct-mail/estimate` | POST | Batch cost estimate with credit check | None |
| `/api/direct-mail/verify-address` | POST | Single address verification | None |
| `/api/direct-mail/bulk-verify-addresses` | POST | Batch address verification (max 100) | P0-4 |
| `/api/mail-identities` | CRUD | Mail sender identity management | None (IDOR protected) |
| `/api/mail-identities/:id/verify` | POST | Lob address verification for identity | None |
| `/api/mailing-orders` | GET | List mailing orders | None |
| `/api/mailing-orders/:id` | GET | Get order with pieces | None |
| `/api/pricing/rates` | GET | Pricing information | None |

---

## 4. Test Coverage

No dedicated test file exists for `lobService.ts`, `directMail.ts`, `directMailService.ts`, or `mailProvider.ts`. The `campaignLifecycle.test.ts` references `direct_mail` as a campaign type string but does not test Lob API calls. Attribution and cohort tests reference `direct_mail` as a channel label only.

**Test confidence for direct mail: ZERO.** No unit, integration, or E2E test verifies that Lob is called correctly, addresses are formatted properly, credits are deducted accurately, or error paths behave as expected.

---

## 5. Summary Scoreboard

| Area | Grade | Key Issue |
|------|-------|-----------|
| Data model | B+ | Well-designed schema for orders, pieces, identities, tracking |
| Credential management | B | BYOK support, test/live switching, multiple env var patterns |
| Address verification | C- | Exists but not enforced pre-send, field name mismatch |
| Template/content | F | No merge field substitution in campaign send path |
| Sending reliability | D | Stub in sequence processor, hardcoded fake return address |
| Delivery tracking | F | No webhooks, status frozen at "sent" |
| Cost management | C | Credit system works but costs inconsistent across files |
| Duplicate protection | F | No idempotency on send endpoint |
| Code organization | D | Four overlapping service files with divergent behavior |
| Test coverage | F | Zero tests for any Lob-related code |

---

## 6. Recommended Fix Order

1. **P0-1**: Replace hardcoded return address in `communications.ts` with `getDefaultMailSenderIdentity()` lookup
2. **P0-2**: Add template personalization (merge field substitution) to the campaign send route
3. **P0-3**: Wire `sequenceProcessor.sendDirectMail` to actually call the Lob service
4. **P0-4**: Standardize address field access (`address`/`zip` vs `mailingAddress`/`zipCode`)
5. **P1-1**: Add optional pre-send verification with cached results
6. **P1-2**: Implement Lob webhook endpoint for delivery event tracking
7. **P1-3**: Add idempotency key or duplicate-send guard to campaign send
8. **P1-4**: Consolidate cost constants into a single source of truth
9. **P2-1**: Merge four Lob service files into one canonical service
10. **P2-2**: Move batch sends to background job queue
