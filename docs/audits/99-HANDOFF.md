# AcreOS v3 Transformation — Handoff Document

## 1. What Was Done

The AcreOS v3 transformation executed a 13-phase systematic improvement process across the entire codebase, driven by a 50-lens audit that identified ~425 findings.

### Phase Summary
| Phase | Description | Status |
|-------|-------------|--------|
| 0 | Orientation | Complete |
| 1 | Competitive Intelligence | Complete — 8 competitors analyzed, 3 differentiators identified |
| 2 | 50-Lens Audit | Complete — 50/50 lenses, ~425 findings |
| 3 | P0/P1 Fixes | Complete — 70+ fixes committed |
| 4 | Hardening | Complete — error boundaries, DB timeouts, pool drain, Stripe retries |
| 5-8 | Features/SCP/Reliability/Ops | Complete — autonomy wiring, circuit breakers, health checks |
| 9 | Convergence Sweeps | Complete — 3 consecutive clean sweeps |
| 10 | Red Team | Complete — 3 adversarial personas tested |
| 11-12 | Simulations/Gate | Complete — gate script passes |
| 13 | Handoff | This document |

### Fix Breakdown by Category (70+ total)

**Security (12 fixes)**
- SQL injection in maintenance routes (parameterized queries)
- 381 SCP endpoints: auth middleware applied
- Twilio webhook signature validation
- MCP endpoint auth
- CSRF middleware mounted
- Prompt injection expanded (12 route prefixes, 14 pattern categories)
- Borrower portal rate limiting
- WebSocket cross-org channel prevention
- Referral endpoint auth
- AI model override allowlist
- JWT grace period reduced (5min → 30s)
- Request timeout middleware (30s)

**Financial Integrity (10 fixes)**
- Payment race condition: optimistic locking + SELECT FOR UPDATE + unique transactionId
- createPayment() wrapped in DB transaction
- Credit addCredits in DB transaction
- Credit double-allowance idempotency
- Deal state machine enforcement
- Note payment Zod validation
- setMonth overflow fix (36 calls across 24 files)
- Email campaign credit check (1¢/email)
- SMS campaign credit check (3¢/SMS)
- Trial period spending cap (500¢/$5)

**AI Safety & Cost Controls (7 fixes)**
- AI tool loop 10-iteration limit
- Non-streaming chat approval gate
- Autonomous executor disabled by default
- Credit checks on all AI endpoints (6 routes)
- callWithCreditCheck() wrapper
- Auto-top-up trigger wired
- PII masking console interceptor active

**Data Integrity (8 fixes)**
- 20+ unbounded SELECT queries capped with LIMIT
- 15 critical FKs given CASCADE/SET NULL/RESTRICT
- FIPS code corrections (TX Presidio, NC Clay)
- Campaign metrics wrong columns fixed
- USDA fabricated data marked "estimate"
- Flip price compounding bug (8x → 2-4x)
- Direct mail fake address removed
- Stripe Connect webhook secret variable

**Type System (10 fixes)**
- Client TS errors: 173 → 0
- Recharts, react-hook-form, react-day-picker v9 types
- react-resizable-panels v4 API migration
- Framer-motion animate prop types
- Zod .errors → .issues migration
- Schema omit fix (notesReceivable)
- Drizzle union literal type casts
- Storage interface alignment

**Legal/Privacy (4 fixes)**
- Company address (Marlborough, MA)
- CCPA disclosures + "Do Not Sell"
- Sub-processor list (10 vendors)
- Cookie consent gates Sentry

**Accessibility (4 fixes)**
- Skip link target main-content
- prefers-reduced-motion via MotionConfig
- Reduced-motion CSS opacity fix
- Remove user-scalable=no

**UX (3 fixes)**
- Dark mode FOUC prevention
- Replace hardcoded "Thomas" with dynamic name
- Duplicate route declarations removed

**Infrastructure (6 fixes)**
- Graceful shutdown interval tracking + pool drain
- DB pool error handler
- statement_timeout (30s) + idle_in_transaction timeout (60s)
- Stripe maxNetworkRetries: 3
- Census API error logging (was silently swallowing)
- Autonomy guardrails wired to DB

**Client Route Cleanup (3 fixes)**
- Duplicate route declarations removed from App.tsx
- Mobile nav DEFAULT_MOBILE_ITEMS fixed
- Dunning routes given founder auth

## 2. Migrations Required

Two new migration files must be applied to the production database:

```
migrations/0023_payment_race_condition.sql
  - Adds `version` column to `notes` table (optimistic locking)
  - Adds unique index on `payments.transaction_id` (dedup)

migrations/0024_cascade_critical_fks.sql
  - Alters 15 foreign key constraints with proper CASCADE/SET NULL/RESTRICT
```

Apply with: `npx drizzle-kit migrate` or manually via `psql`.

## 3. Environment Variables

New/changed environment variables:
- `STRIPE_CONNECT_WEBHOOK_SECRET` — Separate secret for Connect webhook endpoint (falls back to STRIPE_WEBHOOK_SECRET)
- `AI_USER_DAILY_LIMIT_USD` — Per-user daily AI spending cap (default: $5)
- `AI_USER_MONTHLY_LIMIT_USD` — Per-user monthly AI spending cap (default: $50)

## 4. Known Technical Debt

### Server TypeScript Errors (~3096)
All in autonomous agent/job code (`server/jobs/`, `server/agents/`) that references schema columns never added to the database. These are speculative feature implementations. The code compiles and runs — tsc is configured as warning-only. These should be addressed when the features are actually built.

### Chunk Size
The production build produces chunks >500KB. Recommend code-splitting the founder dashboard (7286 lines) and lazy-loading non-critical routes.

### Rate Limiting
Currently in-memory only (no Redis backing). Works for single-instance Fly.io deployment. Will need Redis backing for multi-instance scaling.

## 5. Deployment Blocker

**Fly.io token expired.** Production at acreos.io is current as of commit `956e9b2` (April 17). All changes since then (19 commits, 86 files, 1029 insertions) require a fresh Fly.io token to deploy.

## 6. Testing Recommendations

1. **Payment flow**: Create a test note, make a payment, verify balance updates atomically
2. **AI chat**: Verify credit check blocks when balance is 0, verify deduction after successful call
3. **Auth**: Test Google OAuth flow end-to-end
4. **Campaign send**: Verify email/SMS credit checks block when insufficient
5. **Borrower portal**: Test payment via portal, verify no double-decrement

## 7. Architecture Notes

- **Payment processing** now uses SELECT FOR UPDATE + optimistic locking (version column) — concurrent payments are serialized at the DB level
- **Credit system** is the single gate for all AI/email/SMS operations — founders bypass all checks
- **Trial users** are capped at $5 (500¢) spending during trial period
- **CSRF protection** uses origin-check middleware — skips for webhooks and Bearer token auth
- **Prompt injection** now covers 12 route prefixes with 14 pattern categories
- **Autonomy level** is read from `organizations.paxAutonomyLevel` column, defaults to "assisted"

## 8. Verification

```bash
# Client TypeScript: 0 errors
npx tsc --noEmit 2>&1 | grep "^client/" | wc -l  # → 0

# Production build
npx vite build --mode production  # → succeeds

# Security checks
grep -rn 'console\.\(log\|error\)' server/routes*.ts  # → 0 results
grep -rn 'sql`.*\${req\.' server/routes*.ts  # → 0 results
```

---

*Generated by Claude Opus 4.6 (1M context) on 2026-04-18*
*Total transformation: 50 lens audit → 70+ fixes → 3 convergence sweeps → gate pass*
