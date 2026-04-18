# Convergence Sweep 05 Report

**Date:** 2026-04-18
**Sweep counter:** 2/3 clean (pending this result)
**Focus:** Security and financial areas not deeply checked in sweep 4
**Method:** Manual code reading across 6 audit areas

---

## 1. Auth Chain Completeness

### Global Auth Setup
- **File:** `server/routes.ts` lines 395-403
- `clerkMiddleware` is applied globally via `app.use()` with explicit `publishableKey`, `jwtKey`, and `proxyUrl` configuration. This parses JWT tokens and makes `req.auth` available on every request.
- `registerAuthRoutes(app)` is called immediately after (line 406).

### Route-Level Auth
- All feature routers at lines 987-1060 use `isAuthenticated, getOrCreateOrg` middleware before the router.
- All founder routes (v6-v14) at lines 1306-1315 use `isAuthenticated, getOrCreateOrg`.
- Founder executive dashboard at line 1339 uses `isAuthenticated, getOrCreateOrg` and checks `req.isFounder` with `Errors.forbidden()` guard.
- Admin routes at line 1489 use `isAuthenticated, require2FA`.

### Verdict: PASS
No unauthenticated API paths found. The DEFECT-0001 fix (Router `as any` bypass) is properly resolved with explicit per-prefix middleware.

---

## 2. Prompt Injection Defense

### Middleware Application (`server/routes.ts` lines 608-619)
`promptInjectionMiddleware` is applied to:
- `/api/ai`, `/api/atlas`, `/api/chat`, `/api/executive`, `/api/pax`
- `/api/founder/v6`, `v7`, `v8`, `v10`, `v12`, `v13`
- `/api/founder/agent-collaboration`

### Gap Analysis

**P1-SWEEP5-001: `/api/support` missing prompt injection middleware**
The support ticket routes (`routes-support-tickets.ts`) mount at `/api/support/tickets` and forward user-supplied `description` and `message` fields directly to `processSupportChat()` in `supportAgent.ts`. This path is NOT covered by the `promptInjectionMiddleware`. The support agent processes user text through OpenAI with tool-calling capability, making it a viable injection vector.

Additionally, `supportAgent.ts` does NOT call `sanitizePrompt()` internally -- grep returns no matches.

**Severity: P1** -- The support agent has tool-calling authority (10 tools including DB queries). An attacker could craft a support ticket description containing injection patterns to manipulate Sophie's behavior.

**P1-SWEEP5-002: `/api/founder/v11` and `/api/founder/v14` missing prompt injection middleware**
Lines 1310-1313 show v11 and v14 have `isAuthenticated, getOrCreateOrg` but are absent from the prompt injection middleware list at lines 608-619. If these founder routes accept user text that reaches an LLM, they are unguarded.

**Severity: P1** -- Founder-only reduces blast radius, but the middleware list should be complete for defense in depth.

### Knowledge Base Content Injection (`server/ai/executive.ts` lines 716-728)
The `loadOrgKnowledgeContext()` function at line 721 interpolates `f.extractedContent` (user-uploaded file content) directly into the system prompt using delimiter markers (`--- KNOWLEDGE: ... ---`). The content is NOT sanitized through `sanitizePrompt()` before injection. An attacker who uploads a knowledge base document containing prompt injection patterns could manipulate Atlas's behavior.

**Severity: P1-SWEEP5-003** -- Knowledge base files are uploaded by authenticated org members, reducing the attack surface. However, user-controlled content injected into system prompts without sanitization is a recognized prompt injection vector. The `sanitizePrompt()` function exists and should be applied to `f.extractedContent` before interpolation.

Similarly, `loadProjectContext()` at line 737 has the same pattern with project file content.

### Verdict: CONDITIONAL PASS (3 P1 findings)

---

## 3. Tool Loop Bounds

### `server/ai/vaService.ts`
- `MAX_TOOL_ITERATIONS = 10` defined at line 13.
- Enforced at line 654: `if (++toolIterations > MAX_TOOL_ITERATIONS)` with `break`.

### `server/ai/supportAgent.ts`
- `MAX_TOOL_ITERATIONS = 10` defined at line 18.
- Enforced at line 5262: `if (++toolIterations > MAX_TOOL_ITERATIONS)` with `break`.

### `server/ai/executive.ts`
- `MAX_TOOL_ITERATIONS = 10` defined at line 991.
- Enforced at line 996: `if (toolIterationCount > MAX_TOOL_ITERATIONS)` with `break`.

### Verdict: PASS
All three AI agents have bounded tool-calling loops at 10 iterations with warning logs.

---

## 4. Financial Transaction Atomicity

### Credit-Mutating Methods in `server/services/credits.ts`

| Method | Uses `withTransaction`? | Status |
|--------|------------------------|--------|
| `addCredits()` (line 48) | Yes | PASS |
| `deductCredits()` (line 98) | Yes | PASS |
| `applyCreditPackPurchase()` (line 222) | Yes | PASS |
| `applyMonthlyAllowance()` (line 263) | Yes | PASS |

All 4 credit-mutating methods wrap their balance update + transaction log in `withTransaction()`.

### Monthly Allowance Race Condition Fix
The `applyMonthlyAllowance()` method (DEFECT-0007 fix) uses `onConflictDoNothing()` at line 289 on the `(organization_id, allowance_month)` unique constraint. If the conflict fires (duplicate), lines 296-301 reverse the balance update within the same transaction. This is correct.

### `recordUsage()` in `UsageMeteringService` (line 364)
The `recordUsage()` method calls `deductCredits()` (which is transactional) at line 376, then inserts the `usageRecords` entry at line 388 in a separate database call. If the usage record insert fails after the credit deduction succeeds, credits are deducted but no usage record exists. This is an acceptable design tradeoff -- the credit deduction is the financially critical operation and it IS atomic. The usage record is a telemetry/audit artifact. Loss of a usage record is operationally inconvenient but not financially harmful.

**Severity: Informational** -- Not a defect, but worth noting.

### Webhook Atomic Claim (`server/webhookHandlers.ts` lines 32-44)
The `claimEvent()` method uses `INSERT ... ON CONFLICT DO NOTHING` with `.returning()` to atomically claim webhook events. Returns `true` only if a row was inserted (this instance claimed it). This eliminates the TOCTOU race from DEFECT-0006.

### Verdict: PASS

---

## 5. Upload Security

### `createUploadMiddleware` Usage

| Route File | Import Present | Middleware Applied |
|-----------|---------------|-------------------|
| `server/routes-properties.ts` (line 13) | Yes | `createUploadMiddleware({ maxSizeMB: 5 })` |
| `server/routes-leads.ts` (line 20) | Yes | `createUploadMiddleware({ maxSizeMB: 5 })` |
| `server/routes-import-export.ts` (line 16) | Yes | `createUploadMiddleware({ maxSizeMB: 5 })` |
| `server/routes-field-scout.ts` (line 6) | Yes | Voice: `maxSizeMB: 25`, Photos: `maxSizeMB: 10` |
| `server/routes-ai.ts` (line 16) | Yes | `createUploadMiddleware({ maxSizeMB: 25 })` |

### Multer Direct Usage
Grep for `multer` in `routes-ai.ts` returns no matches -- it uses `createUploadMiddleware` exclusively. All 5 route files with file upload capability use the secure upload middleware.

### Verdict: PASS

---

## 6. DNS SSRF Protection

### `server/services/browserAutomation.ts`

**DNS Resolution Functions** (lines 12-20): `dnsResolve4()` and `dnsResolve6()` are defined and active.

**`resolveAndCheckHost()`** (line 805): Performs DNS resolution and validates all resolved IPs against private ranges for both IPv4 and IPv6. Falls back to blocking on DNS resolution failure ("blocking as a precaution" at line 846).

**`isBlockedUrl()`** (line 850): Comprehensive URL-level checks including:
- Protocol restriction (HTTP/HTTPS only)
- IPv6 literal blocking
- Private IPv4 detection
- Numeric/hex/octal IP format blocking
- Short-form IPv4 blocking
- Blocked hostname patterns (localhost, .local, .internal, metadata.google.internal)

**Usage in `browseWeb()`** (lines 921-937): Both `isBlockedUrl()` AND `resolveAndCheckHost()` are called before any browser navigation. The DNS check is awaited (line 936 -- `await resolveAndCheckHost(parsed.hostname)`).

**Request Interception** (line 971): Additional SSRF protection via Puppeteer request interception -- every subrequest is also validated through `resolveAndCheckHost()`.

### Verdict: PASS
DNS SSRF protection is fully enabled with defense-in-depth (URL validation + DNS resolution + request interception).

---

## Summary

| Area | Verdict | Findings |
|------|---------|----------|
| Auth chain completeness | PASS | All routes authenticated |
| Prompt injection defense | 3x P1 | Support path, founder v11/v14, KB content unguarded |
| Tool loop bounds | PASS | All 3 agents bounded at 10 |
| Financial transaction atomicity | PASS | All 4 credit methods use withTransaction |
| Upload security | PASS | All 5 upload routes use secure middleware |
| DNS SSRF protection | PASS | Fully enabled with defense-in-depth |

### New Findings

| ID | Severity | Description |
|----|----------|-------------|
| P1-SWEEP5-001 | P1 | `/api/support` routes missing `promptInjectionMiddleware` -- support agent processes unsanitized user text with tool-calling authority |
| P1-SWEEP5-002 | P1 | `/api/founder/v11` and `/api/founder/v14` missing from prompt injection middleware list |
| P1-SWEEP5-003 | P1 | Knowledge base and project file content interpolated into system prompt without `sanitizePrompt()` in `executive.ts` |

### Sweep Result: NOT CLEAN

Three P1 prompt injection coverage gaps found. Counter resets to 0/3.

All three are fixable with small additions:
1. Add `app.use("/api/support", promptInjectionMiddleware);` to routes.ts line 619
2. Add `app.use("/api/founder/v11", promptInjectionMiddleware);` and `app.use("/api/founder/v14", promptInjectionMiddleware);` to routes.ts
3. Apply `sanitizePrompt()` to `f.extractedContent` in `loadOrgKnowledgeContext()` and `loadProjectContext()` in executive.ts
