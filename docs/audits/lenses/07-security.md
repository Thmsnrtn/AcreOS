# Lens 7 -- Security Audit

**Auditor persona:** Security Engineer
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has solid security *infrastructure* -- CSP nonces, field-level AES-256-GCM encryption, CORS whitelisting, secrets validation at startup, SSRF protection, file upload magic-byte validation, and structured rate-limiting tiers. However, the app has a **catastrophic authentication gap**: eight `routes-founder-v*` files (354+ endpoints) plus `routes-scp-v2.ts` and `routes-sovereign-integration.ts` are registered with **zero authentication middleware**, exposing internal agent orchestration, decision engines, and job-triggering APIs to any anonymous HTTP client. Additionally, the `routes-maintenance.ts` file contains a textbook SQL injection via unsanitized `req.body` values interpolated into `sql.raw()`. The CSRF middleware (`server/middleware/csrf.ts`) is defined but never imported or applied anywhere in the application. These issues must be resolved before any production traffic.

---

## Findings

### SEC-001: 370+ Founder/SCP Endpoints Exposed Without Authentication
**Severity: P0**

Eight route files are registered in `server/routes.ts` (lines 1253-1302) without any `isAuthenticated`, `requireFounder`, or `getOrCreateOrg` middleware:

| File | Endpoint count |
|------|---------------|
| `server/routes-founder-v6.ts` | 23 |
| `server/routes-founder-v7.ts` | 23 |
| `server/routes-founder-v8.ts` | 14 |
| `server/routes-founder-v10.ts` | 51 |
| `server/routes-founder-v11.ts` | 59 |
| `server/routes-founder-v12.ts` | 60 |
| `server/routes-founder-v13.ts` | 68 |
| `server/routes-founder-v14.ts` | 56 |
| `server/routes-scp-v2.ts` | 16 |
| `server/routes-sovereign-integration.ts` | 11 |

**Evidence:**
- `server/routes-founder-v11.ts:29` -- `app.post("/api/founder/v11/negotiations", async (req, res) => {` -- no middleware at all.
- Grep confirms zero matches for `isAuthenticated`, `requireFounder`, or `isFounderAdmin` in all eight v6-v14 files.
- `routes-sovereign-integration.ts:25` -- `app.get("/api/founder/job-health", async (req: Request, res: Response) => {` -- returns all job health logs to any caller.
- Registration in `routes.ts:1253-1302` -- each file is called as `registerFounderVXRoutes(app)` with no wrapping middleware.

**Impact:** Any unauthenticated user can invoke agent orchestration, negotiate on behalf of agents, trigger delegation tokens, manipulate trust scores, pause/resume evolution engines, and access full job health data. This is a complete auth bypass for the founder subsystem.

**Remediation:** Either (a) wrap each registration call with `app.use('/api/founder', isAuthenticated, requireFounder)` before the v* routes, or (b) add `isAuthenticated` + `requireFounder` to every handler inside each file.

---

### SEC-002: SQL Injection in Maintenance Route via sql.raw()
**Severity: P0**

`server/routes-maintenance.ts:78-86` -- user-supplied `req.body.status`, `req.body.cost`, and `req.body.priority` are string-interpolated directly into `sql.raw()`:

```typescript
if (status) updates.push(`status = '${status}'`);
if (cost !== undefined) updates.push(`cost = '${cost}'`);
if (priority) updates.push(`priority = '${priority}'`);
// ...
const result = await db.execute(sql`
  UPDATE maintenance_requests SET ${sql.raw(updates.join(", "))}
  WHERE id = ${id} AND organization_id = ${org.id}
  RETURNING *
`);
```

A malicious `status` value like `'; DROP TABLE maintenance_requests; --` will execute arbitrary SQL.

**Evidence:** `server/routes-maintenance.ts` lines 75-89. No Zod schema or validation is applied to `req.body` before interpolation.

**Remediation:** Use parameterized Drizzle `.update().set()` instead of `sql.raw()`. Alternatively, validate inputs with Zod and use `sql` template parameter binding.

---

### SEC-003: SQL Injection Risk in Support Agent via sql.raw() with User-Derived Types
**Severity: P1**

`server/ai/supportAgent.ts:4507` constructs an SQL `ANY(ARRAY[...])` clause by interpolating `types` (a string array) directly:

```typescript
sql`${paxMemory.memoryType} = ANY(ARRAY[${sql.raw(types.map((t: string) => `'${t}'`).join(','))}])`
```

If `types` originates from user/AI input, a value like `foo'); DROP TABLE pax_memory; --` injects arbitrary SQL.

**Evidence:** `server/ai/supportAgent.ts:4507`. The `types` variable derives from the AI support agent's tool execution context, which processes user-facing queries.

**Remediation:** Use Drizzle's `inArray()` operator instead of hand-building SQL array literals.

---

### SEC-004: CSRF Middleware Defined But Never Applied
**Severity: P1**

`server/middleware/csrf.ts` implements a double-submit cookie CSRF protection pattern, but it is never imported or used in `server/index.ts`, `server/routes.ts`, or any route file.

**Evidence:**
- Grep for `csrfProtection` across all server files returns only hits in `csrf.ts` itself and `sentry.ts` (which strips the header for privacy, but never enforces it).
- `server/index.ts` middleware chain: `securityHeaders`, `metricsMiddleware`, `corsMiddleware`, `requestTimeout`, `sanitizeQueryParams` -- no CSRF.

**Impact:** All state-mutating endpoints (POST/PUT/PATCH/DELETE) are vulnerable to cross-site request forgery attacks. An attacker can craft a page that submits forms to AcreOS while a victim is logged in, since auth relies solely on cookies.

**Remediation:** Add `app.use(csrfProtection)` to the middleware chain in `server/index.ts` after `cookieParser()`, with appropriate exemptions for webhook endpoints.

---

### SEC-005: JWT Fallback Accepts Tokens Up to 5 Minutes Past Expiry
**Severity: P1**

`server/auth/clerkAuth.ts:38` -- the manual JWT verification fallback accepts tokens with `exp` up to 5 minutes in the past:

```typescript
const GRACE_PERIOD_MS = 5 * 60 * 1000;
if (isValid && payload.sub && payload.exp * 1000 > Date.now() - GRACE_PERIOD_MS) {
```

**Evidence:** `server/auth/clerkAuth.ts` lines 37-40.

**Impact:** A stolen/leaked JWT token remains valid for 5 minutes after it should have expired. Combined with the lack of CSRF protection, this extends the attack window. The 5-minute grace is overly generous for what should be a clock-skew tolerance (30 seconds is standard).

**Remediation:** Reduce `GRACE_PERIOD_MS` to 30 seconds (30000 ms). If Clerk session refresh lag is a concern, address it at the Clerk configuration level rather than weakening token expiry.

---

### SEC-006: WebSocket Channel Authorization Allows Cross-Org Deal/Listing Subscriptions
**Severity: P1**

`server/websocket.ts:222-232` -- the `isAllowedChannel()` method permits any authenticated user to subscribe to `deal:*`, `listing:*`, `negotiation:*`, `market:*`, and `founder:activity` channels regardless of org membership:

```typescript
if (channel.startsWith('deal:')) return true;
if (channel.startsWith('listing:')) return true;
if (channel.startsWith('negotiation:')) return true;
if (channel === 'founder:activity') return true;
```

The comment says "data is filtered server-side" but the broadcast method (`broadcast()` at line 263) sends to all subscribers on a channel without org filtering.

**Evidence:** `server/websocket.ts` lines 222-232 and broadcast method at line 263.

**Impact:** Any authenticated user from any organization can receive real-time deal updates, negotiation coaching data, and listing changes from other organizations.

**Remediation:** Validate that `deal:`, `listing:`, and `negotiation:` channels belong to the client's organization before allowing subscription. `founder:activity` should require founder status.

---

### SEC-007: No Input Validation on Majority of Route Handlers
**Severity: P1**

While `validateBody` middleware exists and some routes (notably `routes-admin.ts`, `routes-leads.ts`) define Zod schemas, the vast majority of route files access `req.body` properties directly without any validation.

**Evidence (sample):**
- `server/routes-finance.ts:52-85` -- `req.body.interestRate`, `req.body.propertyId`, `req.body.monthlyPayment`, `req.body.originalPrincipal`, `req.body.termMonths`, `req.body.startDate` all accessed raw. Financial calculations (loan amortization, usury checks) run on unvalidated inputs.
- `server/routes-founder-v11.ts:31-37` -- `req.body.initiatorAgent`, `req.body.respondentAgent`, etc. passed directly to service layer.
- Total: ~231 direct `req.body.*` accesses across 28 route files vs. ~140 validated accesses (schema parse/safeParse) across 24 files. Roughly 62% of body access is unvalidated.

**Remediation:** Add Zod schemas to all POST/PUT/PATCH handlers, especially financial routes (`routes-finance.ts`, `routes-billing.ts`).

---

### SEC-008: Unscoped Borrower Portal Endpoints
**Severity: P1**

`server/routes-borrower.ts:373-475` -- the `/api/portal/:accessToken/verify-payment` and `/api/portal/:accessToken/autopay` endpoints are public (no auth) and use only the `accessToken` URL parameter for authorization. If access tokens are predictable or leaked, anyone can verify payments or toggle autopay.

**Evidence:** `server/routes-borrower.ts` lines 52, 373, 478 -- all public endpoints with `async (req, res) => {` and no auth middleware. The access token is a user-generated value stored on the note record.

**Impact:** If tokens are short, guessable, or exposed in logs/URLs, attackers can manipulate payment records and autopay settings for any loan.

**Remediation:** (a) Ensure access tokens are cryptographically random (>= 32 bytes), (b) add rate limiting to these endpoints (currently only the deprecated payment endpoint has it), (c) consider requiring email verification on every payment operation, not just initial login.

---

### SEC-009: sql.raw() with Non-User-Controlled But Fragile Inputs
**Severity: P2**

Several files use `sql.raw()` with values that are not directly user-controlled but are still risky:

- `server/jobs/dataRetention.ts:34` -- `DELETE FROM ${rule.table} WHERE ${rule.column} < '${cutoff.toISOString()}'` -- table/column names from config, date from `new Date()`. Safe today but fragile; a config typo could cause data loss.
- `server/jobs/indexAnalyzer.ts:299` -- `db.execute(sql.raw(s.suggestedSql))` -- executes auto-generated SQL when `OTEL_AUTO_INDEX=true`. The SQL comes from an internal analyzer, but any bug in suggestion logic could execute destructive DDL.
- `server/routes-leases.ts:115` -- `sql.raw(sets.map(...).join(", "))` -- column names are hardcoded, values use positional params. Reasonably safe but unnecessarily complex.
- `server/routes-admin.ts:2324` -- `sql.raw('category')` -- a string literal, harmless.

**Evidence:** Files and lines listed above.

**Remediation:** Replace `sql.raw()` with Drizzle ORM's typed query builder wherever possible. For the index analyzer, add a strict whitelist check on generated SQL (e.g., must match `^CREATE INDEX` pattern) before execution.

---

### SEC-010: Role-Based Access Control (RBAC) Guards Used on Only 5 Route Files
**Severity: P2**

The `requireRole` / `roleGuard` middleware (`server/middleware/roleGuard.ts`) is well-designed with owner/admin/acquisitions/marketing/finance/member roles and pre-built guards. However, it is imported in only 5 files with 20 total usages:

- `server/routes-leads.ts` (4 uses)
- `server/routes-campaigns.ts` (2 uses)
- `server/routes.ts` (4 uses)
- `server/utils/permissions.ts` (1 definition)
- `server/middleware/roleGuard.ts` (9 -- self)

**Evidence:** Grep for `requirePermission|requireRole|roleGuard|financeGuard|acquisitionsGuard|marketingGuard|adminGuard|ownerGuard|anyRoleGuard` returns 20 hits across 5 files.

**Impact:** Finance routes (`routes-finance.ts`), billing routes (`routes-billing.ts`), deal routes (`routes-deals.ts`), and property routes (`routes-properties.ts`) have no role-based guards. Any authenticated user in an org (even `member` role) can create notes, modify payments, update deals, and access financial data.

**Remediation:** Apply `financeGuard` to note/payment routes, `acquisitionsGuard` to deal/property routes, and `marketingGuard` to campaign routes.

---

### SEC-011: 66 (req as any) Unsafe Casts Bypass Type Safety
**Severity: P2**

66 occurrences of `(req as any)` across 21 server files bypass the `AuthenticatedRequest` type, hiding missing auth middleware at compile time.

**Evidence:** Grep count: 66 occurrences in `server/routes-admin.ts` (16), `server/routes-2fa.ts` (8), `server/routes-borrower.ts` (5), `server/middleware/roleGuard.ts` (3), and 17 other files.

**Impact:** When a handler casts `(req as any).user`, TypeScript cannot detect that `isAuthenticated` middleware is missing. This contributed to SEC-001.

**Remediation:** Use `AuthenticatedRequest` from `server/types/request.ts` and the helper functions `getOrganization(req)`, `getUserId(req)`, `getOrganizationId(req)` which throw if auth is missing.

---

### SEC-012: WebSocket Auth Validates Old Passport Sessions, Not Clerk
**Severity: P2**

`server/websocket.ts:38-72` -- `validateWsSession()` looks up `connect.sid` cookie and reads `passport.user` from the `session` table. The app migrated from Passport to Clerk, so this validation checks a session store that may no longer be populated.

**Evidence:** `server/websocket.ts` lines 43-66. The session table and Passport auth strategy were the old auth system; Clerk uses `__session` cookies.

**Impact:** WebSocket connections may fail to authenticate entirely (if old session table is empty), or succeed for old sessions that should have been invalidated during migration. Either way, the auth check is non-functional.

**Remediation:** Update `validateWsSession()` to verify Clerk's `__session` JWT cookie using the same logic as `hydrateUser()` in `clerkAuth.ts`.

---

### SEC-013: console.warn Used in Auth Hot Path
**Severity: P3**

`server/auth/clerkAuth.ts:44` uses `console.warn()` instead of the structured `logger`:

```typescript
console.warn("[hydrateUser] JWT fallback failed:", jwtErr.message);
```

**Evidence:** `server/auth/clerkAuth.ts:44`.

**Impact:** Auth failure details bypass PII masking and structured logging. JWT error messages could contain sensitive token fragments.

**Remediation:** Replace with `logger.warn("[hydrateUser] JWT fallback failed", { metadata: { error: jwtErr.message } })`.

---

### SEC-014: CSP img-src Allows All HTTP/HTTPS Origins
**Severity: P3**

`server/middleware/security.ts:44`:
```
"img-src 'self' data: blob: https: http:",
```

This allows images from any origin, which can be used for tracking pixels and exfiltrating data via URL parameters in image src attributes.

**Evidence:** `server/middleware/security.ts` line 44.

**Remediation:** Restrict to known image CDN domains (e.g., `https://img.clerk.com`, `https://api.mapbox.com`, `https://*.stripe.com`).

---

### SEC-015: connect-src Allows All WebSocket Origins
**Severity: P3**

`server/middleware/security.ts:45`:
```
"connect-src 'self' ... wss: ws:",
```

The blanket `wss:` and `ws:` directives allow the client to open WebSocket connections to any origin.

**Evidence:** `server/middleware/security.ts` line 45.

**Remediation:** Restrict to `wss://${APP_DOMAIN}` in production.

---

## Embarrassment Test

Three things about the current security posture that would embarrass a security engineer:

1. **354+ founder-only endpoints are completely unauthenticated.** These endpoints control agent orchestration, trust scores, delegation tokens, and CEO cognitive models. Any anonymous internet user can POST to `/api/founder/v11/negotiations` or `/api/founder/v14/confidence-cascade`. This is the single largest auth bypass the auditor has seen in a production codebase -- it is not a single forgotten route, it is *eight entire files* spanning 370+ handlers.

2. **A textbook SQL injection exists in a shipped route.** `routes-maintenance.ts` concatenates `req.body.status` directly into a SQL string via `sql.raw()`. This is the canonical example used in every SQL injection tutorial. It sits behind authentication and org scoping, but any authenticated user can exploit it to read or destroy data across all organizations.

3. **The CSRF middleware was carefully written and then never plugged in.** The double-submit cookie pattern in `csrf.ts` is correct and complete. But no file imports it. The middleware chain in `index.ts` skips it entirely. This suggests the security work was done as a checklist exercise without integration testing.

---

## Pride Test

Three things about the current security posture that a security engineer would be proud of:

1. **Content Security Policy is strong and properly nonce-based.** Per-request nonces via `crypto.randomBytes(16)`, strict `script-src` that avoids `'unsafe-inline'` in production, `object-src 'none'`, `frame-ancestors 'none'`, `base-uri 'self'`, HSTS with preload, and a CSP violation reporting endpoint. This is genuinely well-implemented.

2. **Field-level AES-256-GCM encryption for PII.** The `fieldEncryption.ts` module uses authenticated encryption with proper IV generation, format versioning for future rotation, and domain-specific helpers for land records and contact records (SSNs, tax IDs, bank accounts). It fails hard in production if the key is missing, and has a rotation helper. This exceeds what most SaaS platforms implement.

3. **Defense-in-depth security middleware ecosystem.** The codebase has SSRF protection with comprehensive private IP range blocking, magic-byte file upload validation, EXIF stripping, prompt injection guards, PII masking on log output, secrets validation at startup, query parameter XSS sanitization, and both DOMPurify (client) and a custom sanitizer for user HTML. The infrastructure for doing security right is present -- it just needs to be consistently applied.
