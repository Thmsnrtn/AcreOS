# AcreOS Security Posture

## Infrastructure

- **Hosting:** Fly.io with Docker containerization, deployed to DFW region (configurable)
- **Database:** PostgreSQL with encryption at rest (Fly.io managed)
- **Session store:** Redis with TLS connection
- **Transport:** HTTPS-only with HSTS headers enforced
- **DNS:** Cloudflare CDN with DDoS protection (recommended configuration)

## Application Security

### Input Validation
- **Zod schema validation** on all API inputs — request bodies, query parameters, and path parameters are validated against typed schemas before processing
- **Drizzle ORM parameterized queries** — all database queries use parameterized statements. No raw SQL string concatenation. SQL injection is prevented at the ORM level
- **Prompt injection middleware** — AI input endpoints pass through a prompt injection detection guard that identifies and blocks common injection patterns

### Output Protection
- **React DOM escaping** — all user-generated content rendered through React's built-in XSS protection
- **Content Security Policy headers** — restricts script sources, prevents inline script execution
- **CORS lockdown** — production configuration restricts origins to the application domain only, credentials restricted

### Data Protection
- **Field-level encryption** — AES-256-GCM for sensitive fields (API keys, SSN fragments, financial identifiers) using a dedicated encryption key
- **PII redaction** — Sophie Privacy Guard strips all personally identifiable information from cross-org data aggregation (market intelligence, county statistics)
- **Soft deletes** — lead and entity deletion is reversible, preventing accidental data loss

## Authentication & Authorization

- **Authentication:** Session-based via Clerk/Passport with PostgreSQL session store (connect-pg-simple)
- **2FA support:** Optional two-factor authentication, required for admin operations when enabled
- **Role-based access control:** Four roles — owner, admin, member, viewer — with granular permission checks via `requirePermission()` middleware
- **Session management:** Configurable TTL, automatic expiration, secure cookie attributes (httpOnly, sameSite, secure)

## Rate Limiting

| Endpoint Type | Limit | Window | Purpose |
|--------------|-------|--------|---------|
| Default API | 100 req | 1 min | General abuse prevention |
| Authentication | 10 req | 1 min | Brute force prevention |
| AI endpoints | 50 req | 1 min | Cost control |
| Webhooks | 200 req | 1 min | Burst tolerance |
| Import | 5 req | 1 min | Resource protection |

Rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`) included in all responses.

## Compliance

- **Dodd-Frank:** Real-time checking of seller-financed note terms against state usury limits, balloon restrictions, and ability-to-repay rules. Non-compliant notes are flagged before creation.
- **TCPA:** Pre-send verification on all SMS and phone campaigns. DNC list checking, consent tracking with date and source, opt-out processing within 24 hours.
- **AML:** Pattern monitoring for cash transactions above reporting thresholds. Advisory flags created for review — informational, not blocking.
- **GDPR/Data Export:** Full data export available on demand (leads, deals, properties, notes, payments, documents, activity log). Account deletion removes personal data within 30 days.

## Monitoring

- **Error tracking:** Sentry with environment tagging, user context, and breadcrumb trails
- **Structured logging:** Centralized logger with severity levels, correlation IDs, and contextual metadata
- **Data source health probes:** Automated monitoring of all 18+ data sources with status reporting via operations agent
- **Agent observatory:** All AI agent operations logged with input, output, confidence scores, and decision reasoning

## Security Testing

- **XSS injection tests:** Automated tests inject script tags and event handlers into all user input fields
- **SQL injection tests:** Automated tests attempt SQL injection through API parameters
- **Brute force tests:** Authentication endpoints tested against rapid login attempts
- **Concurrent access tests:** Race condition testing on financial operations (payments, credit deductions)
- **Security middleware verification:** Tests verify CORS, CSP, rate limiting, and session management are correctly configured

## Incident Response

See [docs/incident-response.md](./incident-response.md) for full incident response procedures including severity classification, communication protocols, and remediation timelines.
