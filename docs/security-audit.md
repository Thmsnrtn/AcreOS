# AcreOS Security Audit — OWASP Top 10 (2021)

**Audit Date:** 2026-03-09
**Auditor:** Internal Engineering
**Application:** AcreOS (SaaS land CRM — Express/TypeScript/PostgreSQL/Drizzle ORM)
**Scope:** Server-side API, authentication layer, database access, third-party integrations

---

## Summary

| # | OWASP Category | Status | Severity |
|---|----------------|--------|----------|
| A01 | Broken Access Control | Partially Mitigated | Medium |
| A02 | Cryptographic Failures | Partially Mitigated | Medium |
| A03 | Injection | Mitigated | — |
| A04 | Insecure Design | In Progress | Low |
| A05 | Security Misconfiguration | Partially Mitigated | Medium |
| A06 | Vulnerable & Outdated Components | In Progress | Medium |
| A07 | Identification & Authentication Failures | Mitigated | — |
| A08 | Software & Data Integrity Failures | Mitigated | — |
| A09 | Security Logging & Monitoring Failures | In Progress | Medium |
| A10 | Server-Side Request Forgery (SSRF) | In Progress | Low |

---

## A01 — Broken Access Control

### Status: Partially Mitigated

### Mitigated
- **Role-based access control (RBAC):** `server/middleware/roleGuard.ts` enforces `owner`, `admin`, `member`, and `viewer` role checks on all sensitive routes. Every API endpoint that modifies data checks the authenticated user's role.
- **Organization scoping:** All database queries filter by `organizationId` extracted from the authenticated session — cross-organization data leakage is prevented at the ORM layer.
- **Session authentication:** All `/api/*` routes (except health and public endpoints) require a valid session cookie. Unauthenticated requests receive HTTP 401.
- **CSRF protection:** `server/middleware/csrf.ts` validates CSRF tokens on all state-changing requests (POST, PUT, PATCH, DELETE) under `/api`.

### Findings / Gaps
- **F-A01-1 (Medium):** Some admin-only routes under `/api/admin/*` rely only on role check middleware but do not validate that the `organizationId` in the URL path matches the authenticated user's org. An `admin` user of Org A could theoretically access Org B resources by guessing IDs.
  - **Remediation:** Add explicit `req.organization.id === parseInt(req.params.orgId)` guard on cross-org admin endpoints.
- **F-A01-2 (Low):** Marketplace listing endpoints currently return `200` for listings belonging to other organizations with `status=public`. Ensure that non-public listings enforce org-scoping.

---

## A02 — Cryptographic Failures

### Status: Partially Mitigated

### Mitigated
- **TLS in production:** Fly.io terminates TLS before traffic reaches the app. `Strict-Transport-Security` (HSTS) header is set with `max-age=31536000; includeSubDomains` in production via `server/middleware/security.ts`.
- **Session cookies:** Sessions use `httpOnly`, `secure` (in production), and `sameSite=strict` cookie flags — credentials cannot be read by JavaScript or sent cross-origin.
- **Password hashing:** User passwords are hashed with bcrypt (cost factor 12) before storage.
- **Field-level encryption:** `server/middleware/fieldEncryption.ts` provides AES-256-GCM encryption for sensitive fields (credit scores, financial projections, SSNs). Uses authenticated encryption — tamper detection built in.

### Findings / Gaps
- **F-A02-1 (Medium):** `FIELD_ENCRYPTION_KEY` rotation process is not formalized. If the key is compromised, there is no automated re-encryption pipeline.
  - **Remediation:** Document and implement a key rotation procedure using `rotateEncryption()` exported from `fieldEncryption.ts`. Schedule annual key rotation.
- **F-A02-2 (Low):** Some older `text` columns in the Drizzle schema store values that may contain PII (e.g., `notes`, `description`) without encryption.
  - **Remediation:** Audit schema columns and apply `encryptFields()` helpers for fields identified as PII-containing.
- **F-A02-3 (Low):** The dev fallback key in `fieldEncryption.ts` (all-0x42 bytes) is deterministic. Ensure `NODE_ENV=development` is never set in staging.

---

## A03 — Injection

### Status: Mitigated

### Mitigated
- **SQL Injection:** All database access goes through **Drizzle ORM** which generates parameterized queries. No raw SQL string interpolation is used in application code. The schema uses typed column definitions — values are never concatenated into SQL strings.
- **NoSQL Injection:** No MongoDB or document store is in use.
- **Command Injection:** No `child_process.exec` calls with user-supplied input. Shell commands (if any) use `execFile` with explicit argument arrays.
- **XSS via query params:** `server/middleware/security.ts::sanitizeQueryParams` rejects query strings containing `<script` or `javascript:` patterns.
- **Content-Security-Policy:** Strict CSP headers are set (see A05). `default-src 'self'` prevents loading of unauthorized scripts.

### Notes
- Drizzle ORM's query builder automatically escapes all values. Developers should avoid `.execute(sql\`...\`)` with user input — this is called out in code review guidelines.

---

## A04 — Insecure Design

### Status: In Progress

### Mitigated
- Threat modeling has been performed at the feature level for voice calls, AI data pipelines, and marketplace transactions.
- Rate limiting is in place for all major feature areas (see `server/middleware/rateLimiting.ts` and `server/index.ts`).
- Idempotency keys are enforced on financial/payment mutations via `server/middleware/idempotency.ts` to prevent double-charges.

### Findings / Gaps
- **F-A04-1 (Medium):** The AI endpoints (`/api/ai/chat`, `/api/atlas`) accept free-form user input and forward it to OpenAI. There is currently no server-side prompt injection guard — malicious prompts could attempt to extract system context.
  - **Remediation:** Add a prompt sanitization layer that detects and strips prompt injection patterns before forwarding to the LLM.
- **F-A04-2 (Low):** The marketplace bidding flow does not have a business-logic check for bid amounts significantly above current listing price (potential money laundering signal).
  - **Remediation:** Add bid amount sanity checks (e.g., flag bids >5x asking price for manual review).

---

## A05 — Security Misconfiguration

### Status: Partially Mitigated

### Mitigated
- **Security headers:** `server/middleware/security.ts` sets:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Referrer-Policy: strict-origin-when-cross-origin`
  - `Permissions-Policy: geolocation=(), microphone=(), camera=()`
  - `Content-Security-Policy` (see A03)
  - `Strict-Transport-Security` (production only)
- **Secrets validation:** `server/middleware/secretsValidation.ts` validates all required environment variables at startup — misconfigured deployments fail fast.
- **Error messages:** Production error handler returns generic `"Internal Server Error"` for 5xx responses — stack traces are not leaked to clients.
- **CORS:** Custom CORS middleware (`corsMiddleware`) only allows listed origins. Wildcard `*` is not used.

### Findings / Gaps
- **F-A05-1 (Medium):** CSP includes `'unsafe-inline'` and `'unsafe-eval'` for `script-src` and `style-src` (required by Vite/React in development). These should be removed in production builds and replaced with nonce-based CSP.
  - **Remediation:** Implement nonce injection in the server-rendered HTML and update CSP to use `'nonce-{value}'` instead of `'unsafe-inline'`.
- **F-A05-2 (Low):** The `/metrics` Prometheus endpoint currently has no authentication. Any client that can reach the server can scrape internal metrics.
  - **Remediation:** Add bearer token authentication on the `/metrics` route, or restrict it to internal network only via Fly.io's private networking.
- **F-A05-3 (Low):** Default Node.js `x-powered-by: Express` header is still emitted.
  - **Remediation:** Add `app.disable('x-powered-by')` in `server/index.ts`.

---

## A06 — Vulnerable & Outdated Components

### Status: In Progress

### Mitigated
- **Automated scanning:** GitHub Actions security workflow (`.github/workflows/security.yml`) runs `npm audit` on every PR, failing on critical/high severity vulnerabilities.
- **Trivy scanning:** Container image and filesystem are scanned for OS and library CVEs on every PR.
- **CodeQL:** Static analysis runs on every PR and weekly.

### Findings / Gaps
- **F-A06-1 (Medium):** No formal SLA for patching high-severity CVEs found by automated scanning. The CI gate blocks merges but does not enforce a resolution deadline.
  - **Remediation:** Define and document a patch SLA (e.g., critical within 24h, high within 7 days). Assign a rotating security on-call.
- **F-A06-2 (Low):** `npm audit` is configured to fail on `high` severity — `moderate` vulnerabilities are not tracked, though many can be exploited in combination.

---

## A07 — Identification & Authentication Failures

### Status: Mitigated

### Mitigated
- **Session-based authentication:** Express sessions with PostgreSQL-backed session store. Sessions expire after configurable inactivity periods.
- **Brute force protection:** Auth routes (`/api/auth`, `/api/login`, `/api/register`) are rate-limited to 20 requests per 15 minutes per IP via express-rate-limit.
- **Password strength:** Minimum password length and complexity rules are enforced at registration.
- **MCP API key:** The MCP endpoint requires a Bearer token matching `MCP_API_KEY`. The endpoint returns 503 if the key is not configured.
- **Secure cookie flags:** Session cookies use `httpOnly=true`, `secure=true` (production), `sameSite=strict`.

### Notes
- Multi-factor authentication (MFA/TOTP) is not currently implemented. This is the main gap for high-value accounts (owner role).
  - **F-A07-1 (Medium):** Implement TOTP-based MFA for owner/admin roles. Consider hardware key (WebAuthn) support as a stretch goal.

---

## A08 — Software & Data Integrity Failures

### Status: Mitigated

### Mitigated
- **Webhook signature verification:** Stripe webhooks validate `stripe-signature` via the Stripe SDK before processing — unsigned webhooks are rejected with HTTP 400.
- **npm ci in CI/CD:** All CI/CD workflows use `npm ci` (not `npm install`) to ensure a reproducible dependency tree locked to `package-lock.json`.
- **No `--no-verify`:** Git hooks are not bypassed in CI — pre-commit and commit-msg hooks run normally.
- **Container image provenance:** Docker images are built from source in CI; no third-party pre-built images are used for the application layer.

### Notes
- **F-A08-1 (Low):** `package-lock.json` integrity is not verified against a known-good hash at deploy time.
  - **Remediation:** Consider adding `npm ci --ignore-scripts` in production containers and auditing any `postinstall` scripts in dependencies.

---

## A09 — Security Logging & Monitoring Failures

### Status: In Progress

### Mitigated
- **Structured request logging:** `server/utils/logger.ts` logs all requests with method, path, status code, and duration. Errors include stack traces in non-production environments.
- **Sentry integration:** `server/utils/sentry.ts` captures unhandled exceptions and sends them to Sentry with user/org context.
- **PII masking:** `server/middleware/piiMasking.ts` masks phone numbers, emails, SSNs, and credit card numbers in log output. Console interceptor is available for installation at startup.
- **Prometheus metrics:** `server/routes-metrics.ts` exposes HTTP error rates, request durations, and business counters in Prometheus format for external scraping.

### Findings / Gaps
- **F-A09-1 (Medium):** Authentication failures (bad password, invalid session) are logged but not aggregated or alerted on. A brute force attack would be detectable only via manual log review.
  - **Remediation:** Add a counter for consecutive auth failures per IP and trigger an alert (Slack/PagerDuty) when the threshold exceeds 50 failures in 5 minutes.
- **F-A09-2 (Medium):** PII masking console interceptor (`installConsoleInterceptor()`) is defined but not called at startup in `server/index.ts`.
  - **Remediation:** Call `installConsoleInterceptor()` early in `server/index.ts` before any logging occurs.
- **F-A09-3 (Low):** Log retention policy is not defined. Application logs are currently shipped to Fly.io's log aggregator with no enforced retention or export to a SIEM.

---

## A10 — Server-Side Request Forgery (SSRF)

### Status: In Progress

### Mitigated
- **External API calls are to known endpoints:** All outbound HTTP calls use hardcoded base URLs (Stripe, Twilio, Mapbox, Regrid). User-supplied URLs are not used directly as fetch targets in most cases.

### Findings / Gaps
- **F-A10-1 (Medium):** The webhook delivery feature (`/api/webhooks`) allows org admins to configure arbitrary webhook URLs. These outbound requests are made server-side and could be used to probe internal network addresses or metadata services.
  - **Remediation:** Implement a URL allowlist/denylist for webhook targets: block RFC 1918 addresses (`10.x`, `172.16-31.x`, `192.168.x`), loopback (`127.x`), and cloud metadata endpoints (`169.254.169.254`).
- **F-A10-2 (Low):** The MCP server tools that fetch public land data APIs (`get_flood_zone`, `get_soil_data`, etc.) use user-supplied coordinates but call fixed API endpoints — SSRF risk is low. No arbitrary URL fetching from MCP tools was found.

---

## Remediation Roadmap

| Priority | Finding | Effort | Target |
|----------|---------|--------|--------|
| P1 | F-A10-1 — Webhook SSRF via RFC 1918 denylist | Small | Sprint 1 |
| P1 | F-A09-2 — Install PII masking interceptor at startup | Trivial | Sprint 1 |
| P1 | F-A05-3 — Remove x-powered-by header | Trivial | Sprint 1 |
| P2 | F-A05-2 — Authenticate /metrics endpoint | Small | Sprint 2 |
| P2 | F-A09-1 — Auth failure alerting | Medium | Sprint 2 |
| P2 | F-A07-1 — MFA for owner/admin roles | Large | Sprint 3 |
| P2 | F-A01-1 — Cross-org path param guard | Small | Sprint 2 |
| P3 | F-A05-1 — CSP nonce in production | Medium | Sprint 3 |
| P3 | F-A04-1 — Prompt injection guard on AI endpoints | Medium | Sprint 3 |
| P3 | F-A02-1 — Key rotation procedure | Medium | Sprint 4 |
| P4 | F-A06-1 — CVE patch SLA definition | Process | Ongoing |
| P4 | F-A09-3 — Log retention policy + SIEM export | Medium | Sprint 4 |

---

## Appendix: Security Controls Matrix

| Control | Location | Coverage |
|---------|----------|----------|
| RBAC / role guard | `server/middleware/roleGuard.ts` | All API routes |
| CSRF protection | `server/middleware/csrf.ts` | All `/api` POST/PUT/PATCH/DELETE |
| Rate limiting (IP) | `server/index.ts` | Auth, AI, webhook, import routes |
| Rate limiting (org) | `server/middleware/rateLimiting.ts` | Feature-area routes |
| Security headers | `server/middleware/security.ts` | All responses |
| Session auth | Express session + PostgreSQL store | All `/api` routes |
| Stripe webhook sig | `server/webhookHandlers.ts` | `/api/stripe/webhook` |
| Field encryption | `server/middleware/fieldEncryption.ts` | Credit scores, projections, SSNs |
| PII log masking | `server/middleware/piiMasking.ts` | Console output (pending install) |
| Dependency audit | `.github/workflows/security.yml` | Every PR + weekly |
| Container scanning | `.github/workflows/security.yml` | Every PR + weekly |
| SAST (CodeQL) | `.github/workflows/security.yml` | Every PR + weekly |
| Secrets validation | `server/middleware/secretsValidation.ts` | Startup |
| Request timeout | `server/middleware/security.ts` | All requests (30s) |
| Error sanitization | `server/index.ts` error handler | All 5xx in production |
