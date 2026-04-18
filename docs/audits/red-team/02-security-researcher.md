# Red Team Audit: Security Researcher

**Persona**: Penetration tester probing for vulnerabilities
**Date**: 2026-04-18
**Auditor**: Security Researcher (Red Team Persona #2)
**Scope**: Full server-side security posture -- authentication, authorization, injection, SSRF, cryptography, session management, rate limiting, secrets, file uploads, CORS/CSP

---

## Executive Summary

AcreOS has addressed its most critical security defects (DEFECT-0001 through DEFECT-0012) from prior audits. SQL injection via `sql.raw()`, unauthenticated founder routes, webhook signature bypasses, and SSRF via missing `await` have all been fixed. The security posture is materially stronger than the initial audit baseline.

However, this audit identifies **3 new P1 findings** and **several concerns** that should be addressed before launch. The most significant are residual IDOR patterns in deal rooms, browser automation, and support tickets; a timing-unsafe API key comparison in the MCP server; and missing CSRF state parameters in the OAuth flow.

---

## Area 1: Authentication Bypass

**Files reviewed**: `server/auth/clerkAuth.ts`, `server/auth/routes.ts`, `server/auth/index.ts`, `server/routes.ts` (middleware chain)

### Verdict: PASS (with one CONCERN)

**Findings**:

1. **Global auth chain is sound.** Clerk middleware runs globally (`routes.ts:399`). The `isAuthenticated` middleware correctly gates API access and falls back to manual JWT verification with RSA-SHA256 signature validation.

2. **JWT grace period reduced.** The prior 5-minute grace period (DEFECT-0014) was reduced to 30 seconds (`clerkAuth.ts:39`), which is appropriate for clock skew.

3. **Unauthenticated route inventory reviewed.** Public routes are limited to:
   - `/api/health`, `/api/health/cached` -- health probes (appropriate)
   - `/api/config/features` -- feature flags (appropriate, no sensitive data)
   - `/api/changelog` -- static file read (appropriate)
   - `/api/status` -- aggregated service status (appropriate)
   - `/api/auth/attribution` -- UTM stub, returns `{ok: true}` (harmless)
   - `/api/borrower/verify` -- borrower portal login (appropriately rate-limited, validates access token + email)
   - `/api/csp-report` -- CSP violation reports (appropriate)

4. **CONCERN: `require2FA` fails open on DB error.** `server/middleware/require2FA.ts:50` catches all errors and calls `next()`, meaning a database outage silently disables 2FA enforcement for all users. While this prevents lockout, it creates a window where sensitive admin operations proceed without MFA verification during database degradation.

   ```typescript
   // server/middleware/require2FA.ts:48-51
   } catch (err: any) {
     logger.error("[require2FA] Error checking 2FA status", err);
     return next(); // Fail open so a DB error doesn't lock all users out
   }
   ```

   **Risk**: Low-Medium. Exploitable only during DB outages.
   **Recommendation**: Log at error level and consider denying access for admin-tier routes during DB failures while allowing read-only access through.

---

## Area 2: Injection Attacks

**Files reviewed**: All `sql.raw()` / `sql` tagged template usages (23+ files), `server/routes-maintenance.ts`, `server/ai/supportAgent.ts`, `client/src/lib/sanitize.ts`, all `dangerouslySetInnerHTML` call sites

### Verdict: PASS

**Findings**:

1. **SQL injection vectors fixed (DEFECT-0002).** The `sql.raw()` string interpolation in maintenance routes and support agent has been remediated. Remaining `sql` tagged template usages all use Drizzle's parameterized template syntax (e.g., `sql\`${table.column} = ${value}\`` which are parameterized, not string-interpolated). No user input flows into raw SQL.

2. **XSS protection is layered.** All four `dangerouslySetInnerHTML` call sites use DOMPurify sanitization:
   - `client/src/pages/inbox.tsx:442` -- `DOMPurify.sanitize(message.bodyHtml)`
   - `client/src/pages/documents.tsx:1039` -- `DOMPurify.sanitize(previewTemplate?.content)`
   - `client/src/components/floating-assistant.tsx:967` -- `DOMPurify.sanitize(processed)`
   - `client/src/components/ui/chart.tsx:81` -- Internal CSS generation, no user input

3. **CSP provides defense-in-depth.** `script-src` uses per-request nonces (`security.ts:25-32`), `object-src 'none'`, `base-uri 'self'`. `unsafe-eval` is only added in development for Vite HMR.

4. **Query parameter sanitization.** `sanitizeQueryParams` middleware (`security.ts:169-186`) blocks `<script>`, `javascript:`, event handlers, and CRLF injection in query strings.

5. **Prompt injection guard active.** `server/middleware/promptInjection.ts` sanitizes 20+ injection patterns across 6 body fields and nested messages arrays.

6. **Command injection.** `browserAutomation.ts:47-48` uses `execSync("which chromium ...")` but only at startup to locate the Chromium binary path. No user input flows into shell commands. Acceptable risk.

---

## Area 3: IDOR / Broken Access Control

**Files reviewed**: `server/storage.ts` (interface), `server/routes-misc.ts`, `server/routes-deal-rooms.ts`, `server/routes-support-tickets.ts`, `server/routes-investor-verification.ts`, `server/middleware/roleGuard.ts`

### Verdict: FAIL -- 3 residual IDOR patterns

**NEW FINDING: SEC-RT-001 (P1)**

**Title**: Deal room endpoints lack organization-scoped access control
**Severity**: P1
**Evidence**: `server/routes-deal-rooms.ts:43-50`

The `getDealRoomOrFail()` helper queries `dealRooms` by `id` only, with no `organizationId` filter:

```typescript
// server/routes-deal-rooms.ts:43-50
async function getDealRoomOrFail(id: number, res: Response) {
  const results = await db.select().from(dealRooms).where(eq(dealRooms.id, id)).limit(1);
  if (results.length === 0) {
    res.status(404).json({ error: 'Deal room not found' });
    return null;
  }
  return results[0];
}
```

This function is called by 6 route handlers (lines 73, 288, 355, 383, 465, 540). An authenticated user from Org A can access, modify participants, upload documents, and send messages in Org B's deal rooms by guessing sequential integer IDs. Deal rooms contain confidential deal terms, NDA content, and financial documents.

The router is behind `isAuthenticated` and `getOrCreateOrg` (`routes.ts:1470`), but the `req.organization` is never passed to or checked by `getDealRoomOrFail`.

**Remediation**: Add `organizationId` parameter to `getDealRoomOrFail` and include it in the WHERE clause. Alternatively, add a participant-membership check.

---

**NEW FINDING: SEC-RT-002 (P1)**

**Title**: Browser automation job fetch and cancel operations lack org-scoping
**Severity**: P1
**Evidence**: `server/routes-misc.ts:153-165` and `server/routes-misc.ts:186-195`

```typescript
// server/routes-misc.ts:153-165
api.get("/api/browser-automation/jobs/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const id = parseInt(req.params.id);
  const job = await browserAutomationService.getJobById(id);  // No org filter
  ...
});

// server/routes-misc.ts:186-195
api.post("/api/browser-automation/jobs/:id/cancel", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const id = parseInt(req.params.id);
  await browserAutomationService.cancelJob(id);  // No org filter
  ...
});
```

`getJobById` (`browserAutomation.ts:243-251`) and `cancelJob` (`browserAutomation.ts:319-327`) query by `id` alone. A user can view any organization's automation job results (which may contain screenshots of competitor research, property data, and credentials) or cancel other orgs' running jobs.

Note: the `getOrganizationJobs` endpoint (line 140) correctly filters by `org.id`. Only the single-job fetch and cancel are vulnerable.

**Remediation**: Add `organizationId` check to `getJobById` and `cancelJob`, or verify `job.organizationId === req.organization.id` in the route handler before returning/acting.

---

**NEW FINDING: SEC-RT-003 (P1)**

**Title**: Support ticket detail endpoint lacks organization-scoping
**Severity**: P1
**Evidence**: `server/routes-support-tickets.ts:66-86`

```typescript
// server/routes-support-tickets.ts:66-86
api.get("/api/support/tickets/:id", isAuthenticated, getOrCreateOrg, async (req, res) => {
  const ticketId = parseInt(req.params.id);
  const [ticket] = await db.select()
    .from(supportTickets)
    .where(eq(supportTickets.id, ticketId));  // No org filter
  ...
});
```

Support tickets may contain sensitive user complaints, account details, billing disputes, and AI agent conversation logs. Any authenticated user can read any other organization's support tickets by ID enumeration.

**Remediation**: Add `.where(and(eq(supportTickets.id, ticketId), eq(supportTickets.organizationId, org.id)))`.

---

**Additional IDOR concern (lower severity)**: `server/routes-investor-verification.ts` queries verifications by `id` alone (lines 49, 61, 79, 92), though the router is behind auth. The `isAdmin` check on line 7-10 uses `req.user.role` which is not the org-scoped team role but a user-level field that may not be set correctly by the Clerk auth chain.

**Positive note**: The core storage layer (`storage.ts`) consistently requires `orgId` for all CRUD operations on leads, properties, deals, notes, and payments (DEFECT-0019 was fixed). The remaining IDOR issues are in route files that bypass the storage layer with direct `db.select()` calls.

---

## Area 4: SSRF

**Files reviewed**: `server/services/browserAutomation.ts`, `server/middleware/fileUploadSecurity.ts`, `server/routes-deal-rooms.ts`

### Verdict: CONCERN

**Findings**:

1. **`browseWeb()` SSRF protection is comprehensive.** The function (`browserAutomation.ts:913+`) validates URLs against private IP ranges (IPv4, IPv6, link-local, CGNAT, cloud metadata), blocks shorthand/octal/hex IP formats, performs DNS resolution checks against private addresses, and blocks known internal hostnames.

2. **`validateUrl()` in file upload security (`fileUploadSecurity.ts:273-296`) is sound.** Protocol whitelist (HTTP/HTTPS only), regex-based private range blocking.

3. **Deal room document upload SSRF fixed (DEFECT-0009).** The `await validateUrl(fileUrl)` call at `routes-deal-rooms.ts:183` is now properly awaited.

4. **CONCERN: `executeStep` navigate action lacks SSRF protection.** `browserAutomation.ts:530-533`:

   ```typescript
   case "navigate":
     if (!interpolatedValue) throw new Error("Navigate action requires a URL");
     await page.goto(interpolatedValue, { waitUntil: "networkidle0", timeout: 30000 });
     break;
   ```

   The URL passed to `page.goto()` comes from template step values interpolated with user-supplied `inputData`. While `browseWeb()` has full SSRF checks, the `executeJob()` path that processes template steps does not call `isBlockedUrl()` or `resolveAndCheckHost()` before navigating. A user could create a job with `inputData.assessorUrl = "http://169.254.169.254/latest/meta-data/"` and the template would navigate Puppeteer to the cloud metadata endpoint.

   **Risk**: Medium-High. Exploitable in cloud environments (AWS, GCP).
   **Recommendation**: Call `isBlockedUrl()` and `resolveAndCheckHost()` before every navigate action in `executeStep()`.

---

## Area 5: Rate Limiting

**Files reviewed**: `server/middleware/rateLimiting.ts`, `server/middleware/rateLimit.ts`, `server/mcp-server.ts`

### Verdict: PASS

**Findings**:

1. **Layered rate limiting.** Two rate limiting systems coexist:
   - **Feature-area limiter** (`rateLimiting.ts`): Per-org, in-process sliding window. Voice 10/min, AI 30/min, general 200/min.
   - **Redis-backed limiter** (`rateLimit.ts`): Fixed-window with Redis INCR + EXPIRE, in-memory fallback. Default 1000/min, strict 50/min, auth 10/min.

2. **MCP server rate limiting.** 100 requests/hour per org (`mcp-server.ts:29`).

3. **Borrower portal rate limiting.** Payment endpoints have dedicated limiters (`routes-borrower.ts:214`, `:286`).

4. **Rate limit abuse monitoring.** `rateLimit.ts:14-33` tracks hit counts with escalating log levels (warn at 20 hits/hour, error at 40, critical at 100).

5. **Minor concern**: In multi-instance deployment without Redis, rate limits are per-instance, effectively doubling the allowed rate. The code documents this explicitly (`rateLimiting.ts:8-9`).

---

## Area 6: Secrets Management

**Files reviewed**: `server/middleware/secretsValidation.ts`, `server/middleware/fieldEncryption.ts`, `server/services/configManager.ts`

### Verdict: PASS

**Findings**:

1. **Startup validation is thorough.** `validateSecrets()` checks 18 environment variables at boot. Production mode enforces required secrets with `process.exit(1)`.

2. **DEFECT-0034 fixed.** Hardcoded fallback secrets (`"dev-secret"`, `"acreos-cert"`, etc.) now throw in production:
   - `routes-deal-rooms.ts:267-269` -- throws if `DOCUMENT_SIGNING_SECRET` missing in production
   - `configManager.ts:29-31` -- throws if no encryption key in production

3. **No hardcoded API keys or secrets found.** Grep for `sk_live`, `sk_test`, and credential patterns returned zero results in server code.

4. **Placeholder detection.** `secretsValidation.ts:99-102` flags values containing "changeme", "your-secret", "xxx", "todo", "placeholder", "example".

5. **Field encryption key management.** `FIELD_ENCRYPTION_KEY` is validated for correct length (64 hex chars = 32 bytes). Dev fallback uses `Buffer.alloc(KEY_BYTES, 0x42)` -- deterministic and clearly insecure, which is appropriate for development.

---

## Area 7: Session Management

**Files reviewed**: `server/auth/clerkAuth.ts`, `server/auth/oauth.ts`, `server/routes-borrower.ts`

### Verdict: CONCERN

**Findings**:

1. **Clerk session management is delegated.** JWT-based sessions via `@clerk/express`. Fallback manual JWT verification uses RSA-SHA256 with a 30-second grace period. Sessions are stateless.

2. **Borrower portal sessions are sound.** 24-hour expiry, 32-byte random session tokens, `httpOnly` + `secure` + `sameSite: 'strict'` cookies (`routes-borrower.ts:90-96`). Session IP and user agent are logged for auditing.

3. **CONCERN: OAuth flows lack CSRF `state` parameter.**
   `server/auth/oauth.ts` -- both Google (line 119-127) and Microsoft (line 180-188) OAuth redirects construct authorization URLs without a `state` parameter:

   ```typescript
   // server/auth/oauth.ts:119-127
   const params = new URLSearchParams({
     client_id: process.env.GOOGLE_CLIENT_ID!,
     redirect_uri: `${appUrl}/api/auth/google/callback`,
     response_type: "code",
     scope: "openid email profile",
     access_type: "offline",
     prompt: "select_account",
     // NOTE: No 'state' parameter
   });
   ```

   The callback handlers (lines 130-172, 194-237) do not verify any state. This enables OAuth CSRF attacks: an attacker can initiate an OAuth flow with their own account, then trick a victim into completing the callback, linking the attacker's OAuth identity to the victim's session.

   **Risk**: Medium. Mitigated by Clerk managing the primary auth flow -- these OAuth routes appear to create DB user records but redirect to `/auth` for Clerk session establishment. The actual exploit scenario depends on how Clerk handles the subsequent login.

   **Recommendation**: Generate a cryptographically random `state` parameter, store it in an `httpOnly` cookie, and verify it in the callback.

---

## Area 8: Cryptography

**Files reviewed**: `server/middleware/fieldEncryption.ts`, `server/services/configManager.ts`, `server/middleware/twilioSignature.ts`, `server/webhookHandlers.ts`, `server/mcp-server.ts`

### Verdict: CONCERN

**Findings**:

1. **AES-256-GCM for field encryption.** Correct choice: authenticated encryption with 96-bit nonces, 128-bit tags. Key rotation support is implemented (`fieldEncryption.ts:322-354`).

2. **Webhook signature verification uses timing-safe comparison.** `crypto.timingSafeEqual()` is correctly used for Twilio signature verification (`twilioSignature.ts:58`). Stripe verification is delegated to `stripe.webhooks.constructEvent()` which handles timing safety internally.

3. **CONCERN: MCP API key comparison is not timing-safe.** `server/mcp-server.ts:69`:

   ```typescript
   if (storedKey && storedKey === bearerToken) {
     return integration.organizationId;
   }
   ```

   String `===` comparison is vulnerable to timing attacks. An attacker can determine API key characters one by one by measuring response times. For API keys stored in the database (not short-lived tokens), this is a real concern.

   **Risk**: Medium. Requires network proximity or many samples to exploit, but API keys are long-lived secrets.

   **Recommendation**: Use `crypto.timingSafeEqual(Buffer.from(storedKey), Buffer.from(bearerToken))` with length checks.

4. **HMAC for document signed URLs.** `routes-deal-rooms.ts:270-273` uses SHA-256 HMAC for signed download URLs with 1-hour expiry. Sound implementation.

---

## Area 9: File Upload

**Files reviewed**: `server/middleware/fileUploadSecurity.ts`

### Verdict: PASS

**Findings**:

1. **Magic byte validation.** Files are validated against known magic byte signatures (`MAGIC_BYTES` array), not just client-provided MIME types. 8 file type signatures are checked.

2. **Dangerous extension blocklist.** 14 executable extensions blocked regardless of claimed MIME type (`.exe`, `.sh`, `.bat`, `.php`, `.js`, `.ts`, etc.).

3. **Filename sanitization.** `path.basename()` strips directory traversal, then non-alphanumeric characters are replaced with underscores (`fileUploadSecurity.ts:83-85`).

4. **Memory-based storage.** Files are stored in memory (`multer.memoryStorage()`), preventing path traversal to the filesystem.

5. **Size limits enforced.** Default 10 MB per file, max 5 files per request.

6. **EXIF metadata stripping.** JPEG files have APP1-APP15 segments (EXIF, XMP, ICC profiles) stripped before storage (`stripJpegExif`). This prevents GPS coordinate and camera serial number leakage. PNG/GIF/WebP are passed through unchanged (noted in comments as acceptable).

---

## Area 10: CORS / CSP

**Files reviewed**: `server/middleware/security.ts`

### Verdict: PASS

**Findings**:

1. **CORS origin whitelist is strict.** Only `localhost` origins in development. Production adds only the `APP_URL` origin. No wildcards. `Access-Control-Allow-Credentials: true` is only set when the origin matches the whitelist.

2. **CSP is comprehensive.** Per-request nonces for scripts, `frame-ancestors 'none'` (prevents clickjacking), `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`, `upgrade-insecure-requests` in production.

3. **HSTS enabled.** `max-age=31536000; includeSubDomains; preload` in production.

4. **CSP violation reporting.** `report-uri /api/csp-report` is configured in production, with a handler at `server/index.ts:399`.

5. **Security headers complete.** `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `X-XSS-Protection: 1; mode=block`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` disables geolocation/microphone/camera/interest-cohort.

6. **Content-Type validation.** `validateContentType` middleware rejects non-JSON/form/multipart bodies on mutating methods, with webhook exemption.

---

## New Findings Summary

| ID | Title | Severity | Status |
|----|-------|----------|--------|
| SEC-RT-001 | Deal room endpoints lack organization-scoped access control | P1 | NEW |
| SEC-RT-002 | Browser automation job fetch/cancel lack org-scoping | P1 | NEW |
| SEC-RT-003 | Support ticket detail endpoint lacks org-scoping | P1 | NEW |

### Concerns (not P0/P1 but should be addressed)

| Area | Issue | Risk |
|------|-------|------|
| Session | OAuth flows lack `state` parameter (CSRF) | Medium |
| Crypto | MCP API key comparison not timing-safe | Medium |
| SSRF | `executeStep` navigate action bypasses SSRF checks | Medium-High |
| Auth | `require2FA` fails open on DB error | Low-Medium |
| IDOR | Investor verification routes query by ID without org filter | Low-Medium |

---

## Previously Fixed Findings Verified

The following previously reported defects were verified as fixed in the current codebase:

| Defect | Title | Verified Fix |
|--------|-------|-------------|
| DEFECT-0001 | 381 founder routes with zero auth | Auth middleware applied to all routes |
| DEFECT-0002 | SQL injection via sql.raw() | Replaced with parameterized Drizzle queries |
| DEFECT-0006 | Webhook TOCTOU race | Atomic INSERT...ON CONFLICT DO NOTHING (`webhookHandlers.ts:34-38`) |
| DEFECT-0008 | Webhook handlers lack signature verification | Stripe uses `constructEvent()`, Twilio uses HMAC-SHA1 |
| DEFECT-0009 | SSRF check broken by missing await | `await validateUrl(fileUrl)` confirmed (`routes-deal-rooms.ts:183`) |
| DEFECT-0013 | CSRF middleware never applied | `csrfProtection` imported and used (`routes.ts:121`) |
| DEFECT-0014 | JWT 5-minute grace period | Reduced to 30 seconds (`clerkAuth.ts:39`) |
| DEFECT-0019 | Storage mutations lack org filter | Core storage methods now require `orgId` |
| DEFECT-0022 | WebSocket cross-org subscriptions | Channel auth added |
| DEFECT-0034 | Hardcoded fallback secrets | Production throws on missing secrets |

---

## Recommendations Priority

1. **Immediate (before launch)**: Fix SEC-RT-001 through SEC-RT-003 (IDOR in deal rooms, browser automation, support tickets). These are the same class of bug as DEFECT-0019 but in route files that use direct DB queries rather than the storage layer.

2. **Short-term**: Add SSRF validation to `executeStep` navigate action. Add `state` parameter to OAuth flows. Replace `===` with `timingSafeEqual` in MCP API key comparison.

3. **Medium-term**: Audit all remaining direct `db.select()` calls in route files for org-scoping gaps. Consider a middleware or wrapper that automatically injects org filtering.

---

## Methodology

- Full source review of 28 middleware files, 4 auth files, and targeted review of 15 route files
- Grep-based analysis of all `sql.raw()`, `dangerouslySetInnerHTML`, `req.params.*` patterns
- Cross-reference against existing defect registry (50+ entries)
- Verification of all previously reported security fixes in current code state
