# Reliability Audit — AcreOS, Pre-100 Customers

**Author:** Ines Travers, SRE / Reliability Lead (ex-Stripe payments infra)
**Date:** 2026-05-01
**Lens:** "Every system is one mistake from cascading failure. The Apple-stock-app feel
is just how well you hide that mistake when it happens."

I read CLAUDE.md, server/index.ts, server/db.ts, server/auth/clerkAuth.ts, server/webhookHandlers.ts, server/middleware/idempotency.ts, server/middleware/rateLimit.ts surface, client/src/lib/queryClient.ts, client/src/lib/error-utils.ts, server/routes-billing.ts, server/routes-campaigns.ts, server/routes-public-sign.ts, server/routes-ai-draft.ts, server/services/eSigningService.ts, and walked the services/ tree (350+ services, 40+ trackInterval timers in index.ts).

Bottom line: the foundation is more solid than I expected for pre-100 (idempotency middleware exists, Stripe webhook claim is atomic, JWT fallback is sound, DB pool is tuned, statement timeout is set). But there are real footguns that will hurt the day a single Stripe outage or Postgres failover happens. The tape-the-mouth-shut item is the **client-side mutation retry**.

---

## 1. Top 5 paths most likely to lose customer trust under real load

### 1.1 — Client `mutations.retry` is on by default
**File:** `client/src/lib/queryClient.ts:329-339` + `client/src/lib/error-utils.ts:57-72`
**Why this is bad:** every `useMutation` in the app retries once on 500/timeout/network errors. Mutations include "send campaign," "send for signature," "purchase credits," "create checkout session," "borrower portal payment." A single hung 30 s request followed by a retry creates two server-side executions of the same intent.
- Server idempotency middleware *only* fires when the client sends an `Idempotency-Key` header. The client does **not** send one. Grep result: zero references to `Idempotency-Key` in `client/src/`.
- This means: on a flaky 502 from the Fly proxy, customers get *two* charges, *two* signature requests, *two* SMS sends.
**Mitigation (P0):**
1. Default `mutations.retry: false`. Opt in per-mutation only for proven-idempotent reads-as-writes (PUT /preferences, etc.).
2. For mutations that *must* retry, generate a UUID idempotency key in the client and have `apiRequest` attach it as `Idempotency-Key` automatically when the method is POST/PATCH and a flag opt-in is passed.

### 1.2 — Stripe checkout creation has no client idempotency key
**File:** `server/routes-billing.ts:131,278` (server has `idempotencyMiddleware`, client doesn't send the header)
**Why:** middleware on the server is correct. The client-side gap means a user double-clicking "Subscribe" or hitting a stalled fetch + auto-retry creates two Stripe Checkout sessions, two `customer.subscription.created` webhooks, two `trialUsed = true` writes, and a billing-support ticket. This is the canonical Stripe footgun.
**Mitigation (P0):** wire the idempotency key from the React mutation through `apiRequest` to the server. Trivial change; high-leverage.

### 1.3 — E-sign send (`server/services/eSigningService.ts`)
**File:** `server/services/eSigningService.ts:39-178` — `sendForSignature` posts a multipart upload to the e-sign provider and updates the document row. There's no idempotency check before the external POST. If the function is called twice (retry, double-click, agent re-trigger), the customer's counterparty gets two "please sign" emails with two separate request IDs.
**Mitigation (P0):**
1. Wrap the external POST in a check: `SELECT signature_request_id FROM generated_documents WHERE id = $1 FOR UPDATE` — if non-null and not expired, return the existing one.
2. Pass the `documentId` as the e-sign provider's idempotency key (most providers honor it).

### 1.4 — Campaign send path lacks dedup contract
**File:** `server/routes-campaigns.ts:48-79` (create), and the actual send path lives in `services/campaigns/` (not auto-applied with idempotency middleware per the comment at `server/middleware/idempotency.ts:18-19` — only `/api/billing/*`, `/api/finance/notes`, `/api/offers/batch` get auto-coverage).
**Why:** if a campaign of 1,000 leads is triggered twice (retry, ⌘K accidental double-fire), every recipient gets two SMS/emails. TCPA exposure, deliverability damage, customer trust gone.
**Mitigation (P0):** require `Idempotency-Key` on `/api/campaigns/:id/send` and on every per-recipient enqueue. Gate on `(campaign_id, recipient_id, scheduled_at_minute)` unique key in the queue table.

### 1.5 — Auth path has a 30 s grace for expired JWTs that recently shrank from 5 min, but no clock-skew telemetry
**File:** `server/auth/clerkAuth.ts:38-43`
**Why:** the comment says "SEC-005 reduced from 5 min — 30s is sufficient." On a Fly.io instance with NTP drift > 30 s (rare but happens), every authenticated request 401s, the client refreshSessionCookie loop kicks in, fails again, and the user sees a "Session expired" toast on every action. There's no metric counting "auth grace expiry" hits.
**Mitigation (P1):** instrument `auth.jwt_grace_used_total{instance}` and `auth.clock_skew_seconds` histograms; alert on > 0.1% of requests using the grace.

---

## 2. Idempotency gaps — table

| Path | Mutation | Server idempotency | Client sends key? | Risk |
|---|---|---|---|---|
| `POST /api/stripe/checkout` | Subscribe / upgrade | yes (middleware applied) | **no** | Double subscription, double trial-burn |
| `POST /api/credits/purchase` | One-time charge | yes (middleware applied) | **no** | Double credit purchase |
| `POST /api/stripe/webhook` | Stripe → us | yes (`claimEvent` ON CONFLICT) | n/a | Solid. `webhookHandlers.ts:32` |
| `POST /api/campaigns` | Create campaign | none | no | Duplicate campaign drafts |
| `POST /api/campaigns/:id/send` (wherever it lives in services/) | Mass send | **none confirmed** | no | **Mass duplicate sends** |
| `eSigningService.sendForSignature` | E-sign | **none** | n/a (server-internal) | Duplicate counterparty emails |
| `POST /api/responses` | Inbound campaign reply | none | n/a | Duplicate response rows |
| `POST /api/public/sign/:docId` | Counterparty signing | unknown — public route | n/a | Double-sign / double-finalize |
| `storage.createPayment` (borrower portal) | Loan payment | partial — `transactionId = session.id` dedup at `webhookHandlers.ts:609-613` | n/a | Solid for Stripe path; bare HTTP path unprotected |
| `POST /api/leads` (from import) | Bulk insert | importLimiter only | no | Duplicate lead rows from retried CSV |

**Note:** the comment at `server/middleware/idempotency.ts:18-19` claims auto-coverage of `/api/billing/*`, but reading routes-billing.ts I only see explicit middleware on `credits/purchase` and `stripe/checkout`. There is no global path matcher; "auto-applies" is misleading. Audit this comment.

---

## 3. Background job reliability inventory

`server/index.ts` registers 40+ `trackInterval` background jobs at startup. They use `withJobLock` (`server/index.ts:113-168`) for multi-instance safety — Postgres-backed lock with TTL — which is solid.

What's good:
- `withJobLock` records start, end, duration, status to `jobHealthLogs` (sampled 1×/hr success, always-on failure).
- Failures publish to event mesh for real-time alerting (`server/index.ts:160-163`).
- `jobSupervisor.checkHealth()` runs every 2 min (`server/index.ts:1270`).
- SIGTERM clears all tracked intervals.

Gaps:
- **No bounded concurrency**. If a job takes longer than its interval (e.g. `valuationModelRetrain`, `dataIngestJob`), `setInterval` will fire again. Lock prevents double-execution, but the queued promise leaks. Switch to a self-rescheduling pattern (`setTimeout` after completion) or guard with `if (running) skip`.
- **No backpressure signal**. If `db` is slow, jobs queue up; nothing reports "we are X minutes behind."
- **Interval-only, no cron**. Hour-aligned digests / weekly emails drift relative to wall-clock. For founder/customer-visible cadences (weekly digest at Mon 9am Pacific), use a cron expression, not `trackInterval(fn, 7 * 24 * 3600 * 1000)`.
- **350+ services in `server/services/`**. I cannot certify any individual service is idempotent without reading each. The volume itself is a reliability concern: any one of them holding a DB connection, swallowing an exception, or never `release()`ing a transaction will degrade everything. Recommend a service inventory + ownership table.
- **`leadNurturerService`, `realtimeAlertsService`, `wsServer`** all start on import. If any throws synchronously, server boot fails silently in production (uncaught at module-load is fatal pre-Sentry-init in some paths).

Job health observability score: **B−.** Jobs report status, but no SLO-style "X% of cron jobs ran on time, on instance, in last 24h" dashboard.

---

## 4. Auth + session edge cases

- **Cross-tab login state:** Clerk handles this, but `refreshSessionCookie` (queryClient.ts:187-207) fires per-fetch on 401. If the user has 5 tabs open and the JWT expires, all 5 refresh in parallel and hit the Clerk touch endpoint simultaneously. Clerk's rate limit is generous, but consider a `BroadcastChannel` to coordinate one refresh across tabs.
- **`apiRequest` retries 401 *exactly once*** (queryClient.ts:249-252). If the second attempt also 401s, the user sees "Session expired" toast and the query throws. Good — no infinite loop.
- **JWT fallback (`clerkAuth.ts:25-48`)** verifies signature locally via `CLERK_JWT_KEY`. Sound. But if Clerk rotates their JWKS and the env var isn't updated, *every request* falls back to "no session" and the entire app 401s without any actionable error. Add a startup probe that fetches a known good JWT and verifies it, fail-fast at boot if invalid.
- **`hydrateUser` race** (clerkAuth.ts:64-95) was already correctly fixed with `ON CONFLICT DO NOTHING + reSELECT`. Good.
- **30 s JWT grace** is the right call but undocumented to ops. If Fly.io clock drift exceeds 30 s on one instance, only that instance 401s users → very hard to debug. Add `X-Server-Time` response header in dev/staging.
- **`isAuthenticated` doesn't validate `req.user.organizationId` matches the org being accessed** — that's `getOrCreateOrg`'s job. If a route forgets to apply `getOrCreateOrg`, a logged-in user with org A could read org B data. Static-check in CI: every `isAuthenticated` route must also have `getOrCreateOrg` (or be explicitly listed as exempt).

---

## 5. Rate-limit + abuse-protection gaps

What's in place (server/index.ts:282-342):
- `/api/auth*`, `/api/login`, `/api/register`: 20 / 15 min / IP — fine.
- `/api/ai`, `/api/pax`, `/api/chat`, `/api/executive`, `/api/document-generation`: 60 / min / IP — borderline. A single power user with auto-typing in ⌘K can exhaust this.
- `/api/webhooks`: 200 / min / IP — Stripe's IPs are well-known, this can be loosened with an allowlist.
- `/api/import`: 10 / 15 min / IP — good.
- `/api`: 300 / min / **session-or-IP**. Good fallback, but `keyGenerator: req.auth?.userId || req.ip` will key on IP for unauthenticated, meaning a corporate NAT at a co-working space hits the cap for everyone behind it.

Gaps:
- **⌘K typing endpoint** is presumably under `/api/search` or `/api/ai`. 60 req/min is **too loose** — a user typing for 10 s sends 30+ requests. Recommend client-side debounce 300 ms + server-side per-user 30/min.
- **AI draft endpoint (`server/routes-ai-draft.ts:56`)** has no extra limiter. Each request likely costs 5-50 cents in OpenAI. A logged-in attacker on Free tier can burn $50/min before hitting `apiLimiter`. Add per-org daily spend cap (you have `usageLimits.ts` — wire it here).
- **Per-org rate limits** are missing entirely. One org with 50 seats can't be capped distinctly from a 1-seat org. Add `keyGenerator: req.organization?.id || req.auth?.userId || req.ip` for `/api/ai` family.
- **No global "panic button"**: if a runaway customer sends 10k requests/sec, only the 300/min IP cap stops them. Add an easily-flippable `EMERGENCY_RATE_LIMIT` env that drops everyone to 10/min while you investigate.
- **Twilio inbound webhook** signature check exists (`middleware/twilioSignature.ts`) — good. Confirm replay protection: same `MessageSid` should not be processed twice. Worth a unit test.

---

## 6. SLO recommendation

Commit publicly to:

| SLO | Target | How to measure |
|---|---|---|
| API availability (5xx rate) | 99.9% over 30 d | `metrics.http_5xx_total / metrics.http_requests_total`, exclude `/api/admin` |
| API latency (p95) | < 800 ms for `GET /api/*` excluding analytics endpoints | Prometheus histogram already collected (`metricsMiddleware`) |
| Stripe webhook processing | 100% claim-or-skip; > 99.5% dispatch success | Count `stripeProcessedEvents` rows + dispatch logs; alert on > 0.5% logger.error from `webhookHandlers` |
| E-sign send success | > 99% within 60 s | New metric; `eSigningService` durations |
| Campaign send delivery | > 95% delivered within scheduled window + 5 min | Per-row `campaign_delivery_events` |
| Background job timeliness | > 99% of jobs complete within 2× their interval | `jobHealthLogs.durationMs` vs interval |
| Auth | < 0.1% requests use JWT grace; 401 rate < 0.5% on `/api/*` excluding `/auth/*` | Already-instrumented requestId logs + new counter |

Do not commit to anything you cannot already measure. The critical missing instrument: per-endpoint p95 latency export. Confirm `metricsMiddleware` emits histograms (not just counters); if not, that's a 4-hour fix.

Publish a `/status` page (Statuspage.io or Better Uptime) at v1. It's the highest-trust-per-dollar move you can make.

---

## 7. Pre-100-customer hardening sprint (2 weeks, 8-10 items)

**Week 1 — kill the Stripe-grade footguns:**

1. **Default `mutations.retry: false`** in `client/src/lib/queryClient.ts`. Audit every `useMutation` in the codebase; whitelist retries for proven-idempotent ones via per-mutation override. *(P0, ½ day)*
2. **Wire `Idempotency-Key` from client to server** for: stripe/checkout, credits/purchase, e-sign send, campaign send, public/sign. Generate a UUID per mutation invocation in the React layer. *(P0, 1.5 days)*
3. **Make `eSigningService.sendForSignature` idempotent at the row level** — `FOR UPDATE` on `generated_documents`, return existing `signatureRequestId` if non-expired. *(P0, ½ day)*
4. **Campaign send dedup**: unique constraint on `(campaign_id, recipient_id, scheduled_minute_bucket)` in the delivery queue. *(P0, 1 day)*
5. **Per-org rate limit on `/api/ai*`** keyed by `organizationId`, with daily spend cap derived from tier. *(P1, 1 day)*

**Week 2 — observability + abuse protection:**

6. **Prometheus histograms for HTTP latency, e-sign send duration, webhook dispatch duration.** Confirm `metricsMiddleware` exports them. Add Grafana dashboards for top 20 endpoints. *(P1, 1.5 days)*
7. **Statuspage** wired to Prometheus alerts: webhook dispatch failure rate, 5xx rate, DB pool saturation, job-health failures. *(P1, 1 day)*
8. **JWKS startup probe**: fail fast if `CLERK_JWT_KEY` rotation desync. *(P1, ¼ day)*
9. **Bounded concurrency on background jobs**: switch the heavy ones (`valuationModelRetrain`, `dataIngestJob`, `featureEngineeringJob`) from `setInterval` to self-rescheduling `setTimeout`. *(P1, 1 day)*
10. **EMERGENCY_RATE_LIMIT env switch** that clamps every limiter to 10/min when set. Document the runbook for activating it. *(P1, ¼ day)*

**Stretch (week 2 if time):**
- BroadcastChannel for cross-tab session refresh coordination.
- Per-route SLO budget tracker (consume X% of error budget → page on-call).
- Replay protection unit test for Twilio inbound webhook.

---

## Closing note

The system is closer to production-ready than the file count suggests. The webhook claim is correct, the DB pool is tuned, the JWT grace is bounded, idempotency *infrastructure* exists. What's missing is the **last mile from infrastructure to invocation site**: the client doesn't send keys, the e-sign service doesn't check the row, the campaign send path isn't gated. That last mile is two weeks of focused work, and it's the difference between "we had a Stripe outage and our customers never noticed" and "we charged 8 customers twice on Wednesday afternoon."

— Ines Travers
