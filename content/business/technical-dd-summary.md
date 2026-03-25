# AcreOS — Technical Due Diligence Summary

## Architecture

```
Client (React 18 + Vite + TypeScript + Tailwind + shadcn/ui)
  ↓ REST API + WebSocket
Server (Express + TypeScript + Drizzle ORM)
  ↓ SQL (parameterized)
PostgreSQL (276 tables)
  + Redis (session store, caching)
  + AWS SES (email)
  + Stripe (billing)
  + Twilio/Telnyx (SMS)
  + Capacitor (mobile shell)
```

**Monolith architecture** — single deployable unit. Server handles API, WebSocket, and background jobs. Suitable for the current scale (< 10K users); would need service extraction for high-scale scenarios.

## Code Quality

- **TypeScript strict mode** across client and server
- **AuthenticatedRequest typed infrastructure** — eliminated 895 unsafe `(req as any)` casts
- **Standardized error handling** via `Errors.*` helpers (notFound, badRequest, validationFailed, unauthorized, forbidden, limitExceeded, internal) — consistent `{ error, message, details?, statusCode }` response shape
- **Structured logging** via centralized logger — replaced 93 `console.log` calls with contextual structured logs
- **Voice-passed quality refinement** — 7-pass review removed 6,776 lines of mechanical code across 317 files
- **CLAUDE.md engineering standards** document enforced across all development — defines request types, error responses, logging, UI patterns, accessibility, and data provider conventions

## Test Coverage

- **4,875+ tests** across 151 test files
- **Unit tests:** individual services, utilities, scoring algorithms
- **Integration tests:** API routes, database operations, middleware chains
- **E2E tests:** Playwright browser tests for critical user flows (onboarding, deal creation, payment)
- **Chaos tests:** XSS injection, SQL injection attempts, brute force authentication, concurrent access patterns
- **LLM exploratory testing:** AI-driven test generation that probes for unexpected behavior

## Security Posture

| Layer | Implementation |
|-------|---------------|
| Transport | HTTPS-only, HSTS headers |
| CORS | Production domain lockdown, credentials restricted |
| CSP | Content Security Policy headers |
| Input Validation | Zod schema validation on all API inputs |
| SQL Injection | Drizzle ORM parameterized queries (no raw SQL) |
| XSS | React DOM escaping + CSP |
| Field Encryption | AES-256 for sensitive fields (API keys, SSN fragments) |
| Authentication | Clerk / Passport session-based, 2FA support |
| Authorization | Role-based access control (owner, admin, member, viewer) |
| Rate Limiting | Per-tier limits on API, auth, AI, webhook, and import endpoints |
| Session Management | PostgreSQL-backed sessions with configurable TTL |
| Compliance | Dodd-Frank real-time checking, TCPA pre-send verification, AML pattern monitoring |
| PII Protection | Sophie Privacy Guard strips all PII from cross-org data |
| Prompt Injection | Middleware guard on all AI input endpoints |

## AI Architecture

- **Primary provider:** OpenRouter (access to Claude, GPT-4, DeepSeek)
- **Fallback provider:** Direct OpenAI API
- **24 agent skills:** deal analysis, offer generation, negotiation coaching, campaign optimization, compliance checking, due diligence interpretation, market prediction, and more
- **Autonomous decision executor:** with guardrails (confidence thresholds, human-in-the-loop for high-impact), circuit breaker (3 failures = pause), and rollback capability
- **5 founder agents:** customer success, growth, revenue, operations, and daily digest — autonomous background agents that handle operational tasks
- **Evolution pipeline:** 3-model adversarial review (Claude + GPT-4 + DeepSeek) with circuit breaker to prevent single-model blind spots
- **Voice learning:** all AI output personalized to user communication style via embedding-based style matching

## Data Architecture

- **Provider registry:** category-based registration with priority ordering, tier-gated access (free sources available to all, premium requires credits or BYOK keys), circuit breaking (3 failures in 5 min = skip)
- **18 free government data sources:** FEMA, USGS, USDA (3), Census (2), EPA (2), USFWS (2), BLM, NLCD, NOAA, OSM, NREL, USFS, SSURGO
- **3 BYOK premium providers:** Regrid (parcels), ATTOM (property data), BatchData (skip tracing)
- **Land Credit Score:** 300-850 scale, 6-dimension weighted scoring (flood, soil, access, utilities, topography, environmental) with outcome-based weight calibration
- **Market network:** anonymized cross-org data aggregation with minimum cohort of 5 before serving, Sophie PII redaction, and user opt-out
- **Caching:** provider_cache table with TTL-based invalidation, reduces API calls by ~60%

## Deployment

- **Target:** Fly.io with Docker containerization
- **Database:** Fly.io Managed PostgreSQL
- **Session store:** Redis (Fly.io or external)
- **Email:** AWS SES with verified sender domains
- **Payments:** Stripe (subscriptions, metering, Connect)
- **SMS:** Twilio (primary) + Telnyx (fallback)
- **Error monitoring:** Sentry
- **CI/CD:** GitHub-based deployment pipeline

## Known Technical Debt

1. **Schema breadth:** 276 tables is comprehensive but some may be underutilized or could be consolidated. A schema audit would identify unused tables from exploratory feature development.

2. **Service stubs:** Some services (particularly in newer pipelines like community intelligence and data portability) may have stub implementations that need production hardening — error handling, retry logic, and edge case coverage.

3. **Mobile testing:** Capacitor shell is built and configured but needs TestFlight (iOS) and internal testing track (Android) deployment and real-device testing before App Store submission.

4. **Rate limiting thresholds:** Current rate limits are set to reasonable defaults but haven't been tuned against production traffic patterns. May need adjustment after observing real usage.

5. **Background job infrastructure:** Background jobs (sequence processor, founder agents, deal feed scanner) use a polling + database lock pattern. At scale (1000+ orgs), this should migrate to a proper job queue (Bull/BullMQ with Redis).
