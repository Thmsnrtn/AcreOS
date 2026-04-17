# Lens 35 -- Fraud & Abuse Audit

**Auditor persona:** Fraud/Abuse Specialist
**Date:** 2026-04-15
**Codebase snapshot:** commit ff7b154 (main)

---

## Executive Summary

AcreOS has significant fraud and abuse exposure across its credit system, rate limiting, referral program, free tier, and campaign send paths. The most critical finding is a **duplicate monthly credit allowance bug**: two separate `applyMonthlyAllowance` methods exist on `CreditService` and `UsageMeteringService` -- the latter (which is called by `processMonthlyAllowances()`) has **no idempotency guard** and uses a different transaction type (`allowance` vs `monthly_allowance`), meaning credits can be stacked indefinitely by re-triggering the batch job. The in-memory rate limiter is trivially bypassed in multi-instance Fly.io deployments because Redis is reported missing in production. The referral apply endpoint is unauthenticated, enabling unlimited referral linkage. The email campaign send path deducts credits **after** sending, creating a race window for free sends. Free tier accounts receive monthly credit allowances and a 7-day trial that grants unlimited AI chat, enabling cheap multi-account farming.

---

## Findings

### FRAUD-001: Duplicate Monthly Credit Allowance -- No Idempotency on Batch Path
**Severity: P0**

Two `applyMonthlyAllowance` methods exist:

1. `CreditService.applyMonthlyAllowance()` (line 194 of `server/services/credits.ts`) -- checks for existing `monthly_allowance` type transaction with matching month in metadata. This is idempotent.
2. `UsageMeteringService.applyMonthlyAllowance()` (line 407 of `server/services/credits.ts`) -- **no duplicate check whatsoever**. Directly adds credits to `organizations.creditBalance` and inserts a transaction with type `allowance` (not `monthly_allowance`).

The batch job `processMonthlyAllowances()` (line 451) calls the **non-idempotent** version (method 2). Every invocation adds the full tier allowance again. Even if the idempotent method were called, it checks for type `monthly_allowance`, while the batch method writes type `allowance` -- so the duplicate check would never match.

**Impact:** If the monthly batch job runs more than once (cron retry, manual trigger, deployment restart), every paid organization receives duplicated credits. At scale tier ($250/month allowance), a single duplicate run grants $250 in free credits per org.

**Evidence:**
- `server/services/credits.ts:407-448` -- no duplicate check before `db.update`
- `server/services/credits.ts:435` -- uses type `allowance`, not `monthly_allowance`
- `server/services/credits.ts:194-222` -- checks for type `monthly_allowance` only
- `server/services/credits.ts:466` -- `processMonthlyAllowances` calls `this.applyMonthlyAllowance(org.id)` which resolves to the UsageMeteringService method

---

### FRAUD-002: Rate Limiting Ineffective in Production -- Redis Missing
**Severity: P0**

The orientation doc reports Redis is missing in production ("Cannot find package 'redis'"). All three rate limiting implementations fail open when Redis is unavailable:

1. `server/middleware/rateLimit.ts:243-248` -- catches Redis errors, calls `next()` (allows request)
2. `server/middleware/redisRateLimit.ts:62-64` -- returns `allowed: true` when no Redis client
3. `server/middleware/redisRateLimit.ts:111-113` -- catches errors, returns `allowed: true`

The fallback in-memory sliding window store (`server/middleware/rateLimit.ts`, `server/middleware/rateLimiting.ts`) is per-process. Fly.io runs 2 machines, so each instance enforces its own window independently -- effectively doubling the actual limit.

Additionally, `server/middleware/redisRateLimit.ts:158` explicitly skips all rate limiting for founder accounts (`if (!orgId || isFounder) return next()`), and the `featureRateLimiter` in `rateLimiting.ts` is exported but **never imported or applied** to any route in the application -- grep confirms zero usage outside its own file.

**Impact:** In production with Redis missing, all rate limiting falls back to per-instance in-memory enforcement. An attacker can send 2x the configured limit by distributing requests across both Fly.io instances. Campaign send endpoints, AI endpoints, and billing endpoints are all effectively soft-limited at best.

**Evidence:**
- `server/middleware/rateLimit.ts:243-248` -- fail-open catch block
- `server/middleware/redisRateLimit.ts:62-64` -- `return { allowed: true }` on no redis
- `server/middleware/rateLimiting.ts:164-176` -- `voiceCallsLimiter`, `valuationLimiter`, `marketplaceLimiter`, `aiFeatureLimiter`, `generalLimiter` are exported but never applied to routes
- Orientation doc item #4: "Redis package missing" in production

---

### FRAUD-003: Email Campaign Credits Deducted After Sending (Race Window)
**Severity: P1**

The email send endpoint (`server/routes-campaigns.ts:1571-1663`) performs a credit sufficiency check at line 1601 (`hasEnoughCredits`), then iterates through all leads sending emails in a loop (lines 1613-1640), and only deducts credits **after** all sends complete (line 1643-1644).

Between the check and the deduction, there is no lock or atomic reservation. A user can:
1. Trigger two concurrent email campaign sends against the same credit balance
2. Both pass the `hasEnoughCredits` check
3. Both send all emails
4. Only one deduction may succeed (or both may, causing negative balance)

The `deductCredits` method (line 92-121 of `credits.ts`) does use an atomic SQL `WHERE balance >= amount`, so double-deduction to negative is prevented -- but the emails are already sent by that point.

**Impact:** A user with 100 credits can send 200 credits worth of emails by issuing two concurrent requests. Emails are sent before credit deduction, so the platform eats the cost.

**Evidence:**
- `server/routes-campaigns.ts:1601` -- `hasEnoughCredits` check (non-locking read)
- `server/routes-campaigns.ts:1613-1640` -- send loop executes before deduction
- `server/routes-campaigns.ts:1643-1644` -- `deductCredits` called post-send
- No mutex, advisory lock, or atomic reservation between check and send

---

### FRAUD-004: SMS Campaign Has No Credit Check At All
**Severity: P1**

The SMS send endpoint (`server/routes-campaigns.ts:1665-1742`) sends SMS messages via Twilio but performs **no credit check and no credit deduction**. There is no call to `hasEnoughCredits`, `deductCredits`, or `recordUsage` anywhere in the handler. Any authenticated user on any tier can send unlimited SMS (limited only by Twilio credentials being configured).

**Impact:** If Twilio credentials are configured, any authenticated user can send unlimited SMS at the platform's expense. The `USAGE_ACTION_TYPES` defines `sms_sent` at $0.03 each, but this cost is never enforced.

**Evidence:**
- `server/routes-campaigns.ts:1665-1742` -- complete handler, no credit references
- `shared/schema.ts:2858` -- `sms_sent: { name: "SMS Sent", defaultCostCents: 3 }` defined but unused in SMS path

---

### FRAUD-005: Referral Apply Endpoint Is Unauthenticated
**Severity: P1**

`POST /api/referral/apply` (line 98 of `server/routes-referral.ts`) has **no `isAuthenticated` middleware**. It accepts `{ code, refereeId }` from any caller. An attacker can:

1. Obtain any user's referral code (they are 8-char alphanumeric, enumerable)
2. Call `/api/referral/apply` with arbitrary `refereeId` values to inflate the referrer's signup count
3. Each `signed_up` referral can later be activated to grant credits

The self-referral check (`referrer.id === refereeId`) only prevents exact self-match. The attacker can use fabricated user IDs.

**Impact:** Referral signup counts can be arbitrarily inflated. If `POST /api/referral/activate` is later triggered (which does require auth but only checks if a referral exists for the current user), credits are issued to both parties.

**Evidence:**
- `server/routes-referral.ts:98` -- `app.post("/api/referral/apply", async (req, res) => {` -- no auth middleware
- `server/routes-referral.ts:101` -- accepts `refereeId` from request body, no validation that caller owns this ID
- `server/routes-referral.ts:146-199` -- `/activate` rewards credits based on referral existence

---

### FRAUD-006: Free Tier Multi-Account Farming
**Severity: P1**

Free tier accounts receive meaningful resources without payment:

1. **Monthly credit allowance:** 100 cents ($1.00) per month (`SUBSCRIPTION_TIERS.free.limits.monthlyCredits = 100` at `shared/schema.ts:2897`)
2. **7-day trial with unlimited AI chat:** `hasEnoughCredits()` returns `true` for any org with an active trial (`server/services/credits.ts:134`)
3. **25 AI requests/day** (`server/services/usageLimits.ts:53`)
4. **Trial tokens** for premium AI skills (initial allotment per org)

An attacker can create unlimited Clerk accounts (Google OAuth sign-up has no CAPTCHA or proof-of-humanity gate), each auto-provisioned with a free org via `getOrCreateOrg` middleware. Each account receives $1.00 in credits monthly, a 7-day trial with unlimited AI chat, and trial tokens.

**Impact:** Systematic account farming yields free credits and AI access at scale. 100 accounts = $100/month in credits + 2,500 daily AI requests.

**Evidence:**
- `server/middleware/getOrCreateOrg.ts:48-69` -- auto-creates org with 7-day trial for any authenticated user
- `server/services/credits.ts:133-135` -- trial period bypasses all credit checks
- `shared/schema.ts:2886-2898` -- free tier gets `monthlyCredits: 100`

---

### FRAUD-007: Founder Check Uses String Match on Clerk User ID
**Severity: P1**

Several AI route handlers determine founder status via string comparison against the user ID or `stripeCustomerId`:

```typescript
const isFounder = user?.id === 'founder' || user?.claims?.sub === 'founder';
```
(line 860, 886 of `server/routes-ai.ts`)

```typescript
const isFounder = user?.id === 'founder' || org?.stripeCustomerId?.includes('founder');
```
(lines 1118, 1151, 1206, 1270 of `server/routes-ai.ts`)

The `stripeCustomerId?.includes('founder')` check is particularly dangerous -- if a Stripe customer ID ever contains the substring "founder" (e.g., `cus_founderxyz123`), the user gets unlimited access. The literal `user?.id === 'founder'` checks are inconsistent with the canonical `isFounderEmail()` check used in `getOrCreateOrg.ts`.

**Impact:** Inconsistent founder detection creates both false positives (granting illegitimate founder access) and privilege confusion across the codebase.

**Evidence:**
- `server/routes-ai.ts:860,886` -- `user?.id === 'founder'`
- `server/routes-ai.ts:1118,1151,1206,1270` -- `org?.stripeCustomerId?.includes('founder')`
- `server/middleware/getOrCreateOrg.ts:19-21` -- canonical check uses `FOUNDER_EMAILS` env var

---

### FRAUD-008: Auto-Top-Up Has No Maximum Cap or Velocity Limit
**Severity: P1**

The auto-top-up settings endpoint (`server/routes-billing.ts:198-240`) accepts `thresholdCents` and `amountCents` with only `z.number().int().min(0)` validation -- no maximum. The `checkAutoTopUp()` method (`server/services/credits.ts:386-404`) uses these user-supplied values directly.

If auto-top-up is connected to a stored Stripe payment method, an attacker who compromises an account could set `thresholdCents: 999999999` and `amountCents: 999999999` to trigger massive charges. There is no per-day or per-month cap on auto-top-up frequency or amount.

**Impact:** Account takeover combined with auto-top-up configuration could trigger unlimited charges to the victim's payment method.

**Evidence:**
- `server/routes-billing.ts:198-202` -- `z.number().int().min(0)` with no max
- `server/services/credits.ts:396-397` -- defaults are low (200/2500) but user-set values have no ceiling
- No velocity check (e.g., max top-ups per day)

---

### FRAUD-009: Campaign Send Endpoints Lack Per-Endpoint Rate Limiting
**Severity: P1**

Campaign send endpoints (`send-email`, `send-sms`, `send-direct-mail`) have no rate limiter middleware. The global 1000 req/min rate limiter applies, but these expensive operations should have much stricter limits:

- `POST /api/campaigns/:id/send-email` -- no rate limiter
- `POST /api/campaigns/:id/send-sms` -- no rate limiter
- `POST /api/campaigns/:id/send-direct-mail` -- no rate limiter

A user can fire rapid concurrent requests to multiply sends before credit deductions are processed (see FRAUD-003).

**Evidence:**
- `server/routes-campaigns.ts:1571` -- `api.post("/api/campaigns/:id/send-email", isAuthenticated, getOrCreateOrg, async ...)`
- `server/routes-campaigns.ts:1666` -- `api.post("/api/campaigns/:id/send-sms", isAuthenticated, getOrCreateOrg, async ...)`
- `server/routes-campaigns.ts:616` -- `api.post("/api/campaigns/:id/send-direct-mail", isAuthenticated, getOrCreateOrg, async ...)`
- No `createRateLimiter`, `strictRateLimit`, or `featureRateLimiter` in middleware chain

---

### FRAUD-010: AI Support Bot Can Issue Unlimited Courtesy Credits
**Severity: P1**

The AI support brain (`server/services/supportBrain.ts:288-301`) can issue courtesy credits via `creditService.addCredits()`. The cap is `Math.min(maxCents, 200)` (200 cents = $2.00) per invocation. However, there is no per-org daily or monthly cap on courtesy credits. A user who repeatedly opens support cases and triggers the "issue_courtesy_credit" action can farm credits indefinitely at $2.00 per case.

**Evidence:**
- `server/services/supportBrain.ts:289-293` -- per-invocation cap of 200 cents
- `server/services/supportBrain.ts:295-300` -- calls `creditService.addCredits` with type `support_credit`
- No aggregate limit (daily, monthly, or lifetime) on support credits per organization

---

### FRAUD-011: Trial Period Bypasses All Credit Checks
**Severity: P1**

`CreditService.hasEnoughCredits()` (line 124-143 of `server/services/credits.ts`) returns `true` for **any** required amount if the organization has an active trial (`trialEndsAt > now`). This means trial users can consume expensive operations (AI image generation at $0.25, comps analysis at $0.10, direct mail at $0.75) without any credit balance.

The trial check does not distinguish between operation types or have any per-trial spending cap. Combined with the 7-day auto-trial on signup (FRAUD-006), every new account gets 7 days of unlimited spending on any credit-gated operation.

**Evidence:**
- `server/services/credits.ts:133-135` -- `if (org?.trialEndsAt && new Date(org.trialEndsAt) > new Date()) { return true; }`
- No per-operation or aggregate spending cap during trial
- `server/middleware/getOrCreateOrg.ts:53` -- 7-day trial auto-provisioned

---

### FRAUD-012: Agent-Triggered Trial Extension Without Governance
**Severity: P2**

The `forge_revenue` agent executor (`server/services/agentActionExecutors.ts:376-384`) can extend any organization's trial by arbitrary duration. The `durationDays` parameter defaults to 14 and has no maximum cap. If the agent is compromised or its inputs are manipulated, it could extend trials indefinitely.

**Evidence:**
- `server/services/agentActionExecutors.ts:377` -- `const { orgId, durationDays = 14 } = ctx.input`
- No max cap on `durationDays`
- Trial extension is a direct `db.update` with no audit trail beyond the agent's own logging

---

### FRAUD-013: Referral Activation Can Be Self-Triggered
**Severity: P2**

`POST /api/referral/activate` (line 146 of `server/routes-referral.ts`) is called when a referred user reaches a "deal_won" activation event. However, the endpoint only checks that a referral row exists for the current user as referee -- it does not verify that a real deal was won. Any referred user can call this endpoint directly to trigger the credit reward.

**Evidence:**
- `server/routes-referral.ts:146-199` -- no verification of actual deal_won event
- `server/routes-referral.ts:162` -- credit amount is hardcoded at 100 cents ($1.00)
- Credits are applied to both referrer and referee orgs

---

## Summary Table

| ID | Title | Severity | Category |
|----|-------|----------|----------|
| FRAUD-001 | Duplicate monthly credit allowance (no idempotency on batch) | P0 | Credit system |
| FRAUD-002 | Rate limiting ineffective in production (Redis missing) | P0 | Rate limiting |
| FRAUD-003 | Email credits deducted after sending (race window) | P1 | Credit system |
| FRAUD-004 | SMS campaign has no credit check at all | P1 | Credit system |
| FRAUD-005 | Referral apply endpoint unauthenticated | P1 | Referral abuse |
| FRAUD-006 | Free tier multi-account farming | P1 | Free tier exploitation |
| FRAUD-007 | Founder check uses string match on Clerk user ID | P1 | Privilege escalation |
| FRAUD-008 | Auto-top-up has no maximum cap or velocity limit | P1 | Billing abuse |
| FRAUD-009 | Campaign send endpoints lack per-endpoint rate limiting | P1 | Rate limiting |
| FRAUD-010 | AI support bot can issue unlimited courtesy credits | P1 | Credit system |
| FRAUD-011 | Trial period bypasses all credit checks | P1 | Free tier exploitation |
| FRAUD-012 | Agent-triggered trial extension without governance | P2 | Credit system |
| FRAUD-013 | Referral activation can be self-triggered | P2 | Referral abuse |
