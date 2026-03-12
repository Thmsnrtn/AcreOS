# Changelog

All notable changes to AcreOS are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).

---

## [1.1.0] — 2026-03-10

### Security (OWASP Top 10 Full Remediation)

- **F-A10-1 FIXED:** Webhook SSRF protection — RFC 1918, loopback, link-local, and cloud metadata IP ranges are now blocked before any outbound webhook delivery (`server/services/agentOrchestration.ts`)
- **F-A09-2 FIXED:** PII masking console interceptor (`installConsoleInterceptor()`) is now called at server startup, masking phone numbers, emails, SSNs, and credit cards in all log output
- **F-A05-3 FIXED:** `x-powered-by: Express` header suppressed via `app.disable('x-powered-by')`
- **F-A05-2 FIXED:** Prometheus `/metrics` endpoint now requires `Authorization: Bearer <METRICS_TOKEN>` — returns 503 if token not configured
- **F-A09-1 FIXED:** Brute-force detection added to login endpoint — rolling per-IP failure counter fires Sentry alert at ≥50 failures in 5 minutes (`server/auth/routes.ts`)
- **F-A07-1 FIXED:** 2FA enforcement middleware added (`server/middleware/require2FA.ts`) — users with TOTP enabled must verify each session before accessing `/api/admin` routes. Full TOTP implementation in `server/routes-2fa.ts` + `server/services/twoFactorAuth.ts`
- **F-A01-1 FIXED:** Cross-org admin route guard validates URL `:orgId` parameter against authenticated session org (`server/routes-admin.ts`)
- **F-A01-2 FIXED:** Marketplace non-public listings now return `null` to orgs that don't own them (`server/services/marketplace.ts`)
- **F-A05-1 FIXED:** Per-request CSP nonce generated in production — `unsafe-inline`/`unsafe-eval` removed from production Content-Security-Policy; nonce injected into HTML shell at serve time (`server/middleware/security.ts`, `server/static.ts`)
- **F-A04-1 FIXED:** Prompt injection guard middleware (`server/middleware/promptInjection.ts`) — 15 regex patterns detect and redact injection attempts before forwarding to OpenAI. Applied to `/api/ai`, `/api/atlas`, `/api/chat`, `/api/executive`
- **F-A04-2 FIXED:** Bid sanity check in marketplace — bids exceeding 5× the asking price are automatically flagged with `status="flagged_for_review"` and logged
- **F-A02-1 FIXED:** Field encryption key rotation CLI script (`server/scripts/rotateEncryptionKey.ts`) — re-encrypts all AES-256-GCM protected DB fields from old key to new key. Procedure documented in `docs/security.md`
- **F-A06-1 FIXED:** CVE patch SLA defined in `docs/security.md` (critical ≤24h, high ≤7d, moderate ≤30d) with rotating on-call model
- **F-A06-2 FIXED:** `security.yml` npm audit now reports moderate-severity findings as CI warnings (previously silent)
- **F-A08-1 FIXED:** Dockerfile build stage uses `npm ci --audit` to validate dependencies at image build time
- **F-A09-3 FIXED:** Log retention policy documented in `docs/security.md` with per-log-type retention periods and Fly.io log drain setup instructions
- **F-A02-3 FIXED:** Dev fallback encryption key already throws at production startup — confirmed in `server/middleware/fieldEncryption.ts:48`

### Added

- `server/middleware/promptInjection.ts` — Prompt injection guard with 15 pattern matchers, sanitizes `message`, `prompt`, `content`, `query`, `input`, `text` body fields and nested `messages[].content`
- `server/middleware/require2FA.ts` — MFA enforcement middleware for admin routes; checks `session.twoFactorVerified` for users with TOTP enabled
- `server/scripts/rotateEncryptionKey.ts` — Key rotation CLI script; processes encrypted DB tables in 100-row batches
- `CHANGELOG.md` — This file

### Changed

- `server/middleware/security.ts` — CSP now generates per-request nonce in production; removes `unsafe-inline`/`unsafe-eval` from production builds
- `server/static.ts` — HTML shell served with nonce attributes injected into `<script>` and `<style>` tags in production
- `server/routes.ts` — Prompt injection middleware applied to all AI paths; 2FA enforcement on `/api/admin`
- `server/auth/routes.ts` — Brute-force failure counter added to login failure path
- `server/services/agentOrchestration.ts` — Webhook SSRF protection: URL scheme + IP range denylist
- `server/services/marketplace.ts` — Non-public listing access control; bid amount sanity check (>5× asking price flagging)
- `server/routes-metrics.ts` — Bearer token authentication on Prometheus scrape endpoint
- `Dockerfile` — `npm ci --audit` in build stage
- `.github/workflows/security.yml` — Moderate vulnerability reporting in npm audit step
- `docs/security.md` — CVE SLA, log retention policy, and key rotation procedure added
- `docs/security-audit.md` — All findings marked resolved (2026-03-10)

---

## [1.0.0] — 2026-03-09

### Added — Phase 1: Intelligence Amplification

- Market Prediction Service with 30/90/365-day county-level price forecasting
- Deal Hunter: autonomous tax auction, foreclosure, and probate deal sourcing with configurable alert rules
- Negotiation Orchestrator with OpenAI function calling (5 tools: `get_property_valuation`, `get_comparable_sales`, `get_negotiation_thread`, `select_negotiation_tactic`, `build_negotiation_plan`)

### Added — Phase 2: Network Effects & Marketplace

- Full P2P marketplace with listings, bidding, matchmaking, investor verification
- Buyer Intelligence Network for demand pattern analysis
- Transaction fee processing (1.5% on wholesale deals)

### Added — Phase 3: Financial Intelligence

- Portfolio Optimizer with Monte Carlo simulation
- Capital Markets: note securitization and lender network
- Tax Optimization Engine with 1031 exchange detection

### Added — Phase 4: Operational Excellence

- Voice AI (Twilio integration): call routing, real-time transcription, recordings
- Vision AI: satellite imagery analysis and property condition assessment
- Browser Automation Engine (Puppeteer) for county research and document downloads

### Added — Phase 5: Industry Domination

- AcreOS Academy: courses, modules, enrollments, AI tutor, certification system
- Regulatory Intelligence Service with change tracking
- White-Label Platform infrastructure ($50k–$500k enterprise tier)

### Added — Phase 6: Data Moat

- Proprietary AcreOS Valuation Model (custom TypeScript GBRT, <1ms inference)
- Land Credit Scoring — "FICO for land" with gradient boosting + SHAP explainability
- Python XGBoost weekly retraining pipeline with Bayesian hyperparameter optimization

### Added — Infrastructure

- WebSocket server for real-time collaboration (org/deal/listing/negotiation channels)
- Redis Pub/Sub for horizontal scaling across multiple instances
- Full-text search with PostgreSQL `tsvector` / GIN index
- 234-table schema (10,232 lines), 95+ route files, 166 service files
- 1,658 passing unit/integration tests across 75 test files
- Playwright E2E tests, k6 load tests
- GitHub Actions CI/CD (lint, type-check, unit, integration, E2E, security scan, Docker build)
- Multi-platform: PWA (Workbox), iOS/Android (Capacitor), Desktop (Tauri)
- Fly.io deployment with auto-scaling, health checks, Redis, PostgreSQL 16
- Sophie AI support agent (95–99% autonomous resolution target) with self-learning
- MCP server integration for programmatic platform access

---

*AcreOS is the definitive SaaS platform for land investors.*
*Subscription tiers: Free · Starter $99 · Pro $299 · Scale $599 · Enterprise $799*
