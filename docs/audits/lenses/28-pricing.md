# Lens 28 -- Pricing Strategist Audit

**Auditor:** Pricing strategist (Lens 28)
**Date:** 2026-04-15
**Scope:** Subscription tiers, feature gating, billing flows, upgrade/downgrade paths, trial experience, credit system, revenue optimization.

---

## Architecture Overview

AcreOS has a layered billing system:

1. **Tier definitions** -- `shared/schema.ts` defines `SUBSCRIPTION_TIERS` (6 tiers: free, sprout, starter, pro, scale, enterprise) and `CREDIT_PACKS` (4 packs: $10-$100).
2. **Usage limits** -- `server/services/usageLimits.ts` defines `TIER_LIMITS` (5 tiers: free, starter, pro, scale, enterprise -- no sprout).
3. **Credit system** -- `server/services/credits.ts` manages balance, deductions, monthly allowances, and usage metering.
4. **Stripe integration** -- `server/stripeService.ts` wraps Stripe API; `server/webhookHandlers.ts` handles lifecycle events.
5. **Trial system** -- `server/services/trialService.ts` provides a one-time 14-day trial of starter or pro.
6. **Dunning** -- `server/services/dunning.ts` handles failed payments through grace -> warning -> restricted -> suspended -> cancelled.
7. **Client pricing** -- `client/src/pages/pricing.tsx` shows 4 tiers (free/$20/$49/$79); `client/src/components/tier-upgrade-panel.tsx` shows 3 tiers (free/$20/$49).

---

## Findings

### P0 -- Billing Bug Causing Wrong Charges / Data Corruption

#### P0-1: Double-credit monthly allowance -- no idempotency on `UsageMeteringService.applyMonthlyAllowance`

**Files:** `server/services/credits.ts` lines 194-222 vs. 407-448

There are two separate `applyMonthlyAllowance` methods:

- `CreditService.applyMonthlyAllowance(orgId, tier)` (line 194) -- has idempotency check: queries `creditTransactions` for type `"monthly_allowance"` with matching month in metadata before granting. Safe.
- `UsageMeteringService.applyMonthlyAllowance(orgId)` (line 407) -- has NO idempotency check. It unconditionally adds credits to the org balance every time it is called. It also uses a different transaction type (`"allowance"` instead of `"monthly_allowance"`), so even if the CreditService method ran first, the UsageMeteringService method would not detect it.

`processMonthlyAllowances()` (line 451) calls the non-idempotent version. If this batch job runs more than once per month (server restart, cron overlap, manual trigger), every paid org gets duplicate credits. This is free money leaking out of the platform.

#### P0-2: `getAllUsageLimits` called with wrong argument type

**File:** `server/routes-billing.ts` line 697

```typescript
const limits = await getAllUsageLimits(org.id, (org.subscriptionTier || "free") as SubscriptionTier);
```

The function signature is `getAllUsageLimits(organizationId: number, options: UsageLimitOptions = {})` where `UsageLimitOptions` is `{ isFounder?: boolean }`. The code passes a string (tier name) as the second argument. TypeScript should catch this, but with 1,815 type errors already in the codebase and esbuild skipping type checks, this passes to production. The string is treated as a truthy object, so `options.isFounder` is `undefined` and the fallback to the DB value works -- but this is fragile and would break if `UsageLimitOptions` gained a required field.

### P1 -- Missing Upgrade Path / Confusing Pricing

#### P1-1: Massive price discrepancy between sources -- 6 different price lists

Prices displayed to users vary wildly depending on where they look:

| Tier | `schema.ts` SUBSCRIPTION_TIERS | `pricing.tsx` (public page) | `tier-upgrade-panel.tsx` (in-app) | `usageLimits.ts` TIER_LIMITS | `routes-admin.ts` |
|------|------|------|------|------|------|
| Free | $0 | $0 | $0 | (present) | $0 |
| Sprout | $29 | -- (absent) | -- (absent) | -- (absent) | $29 |
| Starter | $59 | $20 | $20 | (present) | $59 |
| Pro | $179 | $49 | $49 | (present) | $179 |
| Scale | $449 | $79 | -- (absent) | (present) | $449 |
| Enterprise | $899 | -- (absent) | -- (absent) | (present) | $899 |

The `SUBSCRIPTION_TIERS` in schema.ts is the authoritative definition, but the client-side pricing pages hardcode completely different prices. A user sees $49/mo for Pro on the pricing page but the schema says $179. Since actual Stripe prices are determined by Stripe product configuration (not these constants), the displayed price might not match what Stripe charges. This is a trust-breaking discrepancy.

#### P1-2: Sprout tier exists in schema but is invisible everywhere

**Files:** `shared/schema.ts` line 2901, `server/services/usageLimits.ts` (absent from `TIER_LIMITS`)

The `sprout` tier ($29/mo) is fully defined in `SUBSCRIPTION_TIERS` with features and limits, but:
- Not in `TIER_LIMITS` (usageLimits.ts) -- so `normalizeTier("sprout")` returns `"free"`, meaning sprout subscribers get free-tier limits (10 leads instead of the 250 they're paying for).
- Not shown on any pricing page.
- Not available as a trial tier (only "starter" | "pro" allowed).
- Referenced in `cancellation-dialog.tsx` (line 119), `GrowthEngine.tsx`, and test files, suggesting it was once a real tier.

If any existing user has `subscriptionTier = "sprout"`, they are paying $29/mo but receiving free-tier limits. This is silent billing fraud from the user's perspective.

#### P1-3: Trial duration inconsistency -- 7 days vs. 14 days

**Files:**
- `server/services/trialService.ts` line 7: `TRIAL_DURATION_DAYS = 14`
- `server/routes-billing.ts` line 303: `const trialDays = org.trialUsed ? undefined : 14` (Stripe checkout)
- `client/src/pages/settings.tsx` line 901: "7-Day Free Trial Available"
- `client/src/pages/settings.tsx` line 904: "Start your subscription with a 7-day free trial"
- `client/src/pages/pricing.tsx` line 106: "Start 14-Day Free Trial" (button text)

The backend grants 14 days. The settings page tells users they get 7 days. The pricing page says 14 days. Users who see the settings page may not start a trial because they think it is too short, or may panic on day 8 thinking it expired when it has not.

#### P1-4: No in-app upgrade path between tiers

There is no API endpoint or UI for directly upgrading from one paid tier to another. The checkout flow (`/api/stripe/checkout`) creates a new subscription but does not cancel or prorate the existing one. The `processSubscriptionUpdated` webhook handler (webhookHandlers.ts line 367) correctly detects tier changes from Stripe product metadata, but the user has no way to trigger a tier change from within the app -- they must go through Stripe's Customer Portal (which is an external redirect).

The `tier-upgrade-panel.tsx` shows a "Start Free Trial" CTA for all paid tiers, even for users already on a paid plan. There is no "Upgrade to Pro" button that handles proration.

#### P1-5: `processMonthlyAllowances` excludes sprout and enterprise tiers

**File:** `server/services/credits.ts` line 460

```sql
subscriptionTier IN ('starter', 'pro', 'scale')
```

This SQL hardcodes only three tiers. Sprout ($29 plan, 500 monthly credits per schema) and Enterprise ($899 plan, 50,000 monthly credits per schema) subscribers never receive their monthly credit allowance. Enterprise users paying $899/mo get zero included credits.

#### P1-6: "Downgrade instead" button in cancellation dialog does nothing

**File:** `client/src/components/cancellation-dialog.tsx` line 120-123

The "Downgrade instead" button calls `handleClose()` which just closes the dialog. There is no actual downgrade flow -- no tier selection, no Stripe subscription modification. The button gives the impression that downgrading is possible but then just dismisses the cancellation flow.

### P2 -- Optimization Opportunities

#### P2-1: Credit packs have zero margin

**File:** `shared/schema.ts` lines 2872-2877

All four credit packs have `amountCents === priceCents`. The $10 pack gives exactly $10 of credits. There is no markup on credit purchases. Larger packs should offer bonus credits to incentivize bulk purchases (e.g., $50 pack gives $55 of credits).

#### P2-2: Auto-top-up checks balance but never actually charges Stripe

**File:** `server/services/credits.ts` line 386

`checkAutoTopUp()` returns `{ shouldTopUp: true, amountCents }` when the balance is below threshold, but:
- It is never called anywhere in the codebase (grep confirms only the definition exists).
- Even if called, it only returns a recommendation -- no code exists to create a Stripe charge or add credits.
- The settings UI lets users configure auto-top-up (threshold and amount), but the feature is entirely non-functional.

#### P2-3: No annual billing discount implemented server-side

**Files:** `client/src/pages/pricing.tsx`, `client/src/components/tier-upgrade-panel.tsx`

Both pricing UIs show an "Annual" toggle with "Save 20%" messaging and calculate annual prices (e.g., Starter: $192/year = $16/mo). However, the checkout flow only sends a `priceId` to Stripe -- there is no logic to select between monthly and annual Stripe prices. The annual toggle is purely cosmetic unless Stripe happens to have separate annual price objects configured. There is no server-side validation that the selected price matches the displayed annual discount.

#### P2-4: Welcome email shows wrong tier limits

**File:** `server/webhookHandlers.ts` lines 198-203

The tier limits in the welcome email are hardcoded and inconsistent with both `SUBSCRIPTION_TIERS` and `TIER_LIMITS`:

| Tier | Welcome email leads | SUBSCRIPTION_TIERS leads | TIER_LIMITS leads |
|------|------|------|------|
| Sprout | 50 | 250 | (absent) |
| Starter | 200 | 500 | 250 |
| Pro | 1,000 | 5,000 | 500 |
| Scale | 5,000 | unlimited | unlimited |

New subscribers receive a welcome email with incorrect plan limits.

#### P2-5: Feature gating is platform-level, not tier-level

**File:** `server/middleware/featureGate.ts`

The `featureGate` middleware checks a global `platform_feature_flags` table (is the feature enabled for everyone?) but does not check the user's subscription tier. There is no middleware that gates routes by tier-specific features. The `SUBSCRIPTION_TIERS[tier].features` array in the schema is never checked server-side. Any authenticated user can access any API endpoint regardless of their tier, as long as they stay under the numeric usage limits.

This means a free-tier user can access AI marketing endpoints, SMS campaigns, marketplace syndication, etc. -- all features that are supposed to be gated to higher tiers per the schema definition.

#### P2-6: No retention offer in cancellation flow

**File:** `server/routes-billing.ts` lines 710-748, `client/src/components/cancellation-dialog.tsx`

The cancellation flow collects a survey reason but never offers:
- A discounted rate (e.g., 50% off for 3 months if reason is "too_expensive")
- A plan downgrade suggestion
- A pause option (Stripe supports subscription pausing, and the webhook handler already handles `customer.subscription.paused`)

The cancellation context endpoint returns usage data but the client does not use it to make a retention argument (e.g., "You've used 450 of 500 leads this month -- are you sure you want to lose that?").

#### P2-7: Pricing page does not connect to checkout

**File:** `client/src/pages/pricing.tsx`

All CTA buttons link to `/auth` (the sign-in page), not to a checkout flow. A visitor who clicks "Start 14-Day Free Trial" on the Pro plan lands on a generic auth page with no context about which plan they selected. The selected tier is lost. After signing up, they land on onboarding with no reference to the plan they wanted.

### P3 -- Backlog

#### P3-1: Scale tier is feature-flagged but visible on public pricing page

**File:** `server/services/usageLimits.ts` line 23-26

`PRICING_FEATURE_FLAGS.pricing_scale_tier_enabled` is `true` server-side, but the Scale tier appears on the public pricing page at $79/mo (hardcoded). There is no coordination between the server feature flag and the client display. If someone subscribes to Scale at $79 but the schema says $449, the price discrepancy compounds P1-1.

#### P3-2: Enterprise tier has no self-serve path

The Enterprise tier ($899/mo) exists in `SUBSCRIPTION_TIERS` but:
- `pricing_enterprise_tier_enabled` is `false` (usageLimits.ts line 25)
- Not shown on any pricing page
- No "Contact Sales" form or flow exists
- The only mention is a mailto link on the pricing page (`hello@acreos.io`)

#### P3-3: Credit system and usage limits are separate enforcement mechanisms

Usage limits (leads, properties, notes, AI requests) are enforced via `checkUsageLimit` which counts rows in the database. Credits are a separate balance system deducted for specific actions (email, SMS, AI chat, etc.). These two systems do not interact:
- A user can exhaust their credit balance but still create leads up to their tier limit.
- A user can exhaust their lead limit but still spend credits on AI chat.

This is not necessarily a bug, but the dual system is confusing for users and creates two different "you've run out" experiences with different upgrade paths.

#### P3-4: No webhook for `checkout.session.expired`

**File:** `server/webhookHandlers.ts`

If a user starts checkout but abandons it, the session expires. The handler does not process `checkout.session.expired`, so there is no way to track abandoned checkouts for follow-up or analytics.

#### P3-5: Stripe customer creation race condition

**File:** `server/routes-billing.ts` lines 148-160, 288-300

The `withTransaction` wrapper is used for Stripe customer creation + org update, which is good. However, `withTransaction` wraps a database transaction -- it does not make the Stripe API call atomic with the DB write. If `stripeService.createCustomer` succeeds but `storage.updateOrganization` fails (e.g., DB timeout), a Stripe customer is created but never linked to the org. The next attempt creates a duplicate Stripe customer.

#### P3-6: No proration handling for mid-cycle upgrades

There is no code that calculates or communicates proration to users. Stripe handles proration automatically when a subscription is updated, but since the app has no in-app upgrade endpoint (P1-4), this entire concern is deferred to the Stripe Portal, which provides a generic and non-branded experience.

---

## Summary of Findings by Severity

| Severity | Count | Key Items |
|----------|-------|-----------|
| P0 | 2 | Double-credit allowance bug; wrong argument type in usage limits call |
| P1 | 6 | Price discrepancy across 6 sources; sprout tier invisible but billable; trial duration mismatch; no in-app upgrade; missing monthly credits for 2 tiers; fake downgrade button |
| P2 | 7 | Zero-margin credit packs; non-functional auto-top-up; cosmetic annual toggle; wrong welcome email limits; no tier-level feature gating; no retention offer; pricing page disconnected from checkout |
| P3 | 6 | Scale flag mismatch; no enterprise self-serve; dual enforcement confusion; missing checkout.session.expired; Stripe customer race; no proration |

---

## Recommended Priority Actions

1. **Fix P0-1 immediately** -- Add idempotency check to `UsageMeteringService.applyMonthlyAllowance` or remove it in favor of the existing `CreditService.applyMonthlyAllowance`. Audit credit transaction logs for duplicate allowances.
2. **Reconcile tier definitions** -- Decide whether `sprout` is a real tier. If yes, add it to `TIER_LIMITS` and pricing pages. If no, remove it from `SUBSCRIPTION_TIERS` and migrate any sprout subscribers.
3. **Create a single source of truth for prices** -- Client pricing pages must read from `SUBSCRIPTION_TIERS` or from Stripe products (via `/api/stripe/products`), not hardcode values.
4. **Fix trial duration display** -- Change settings page from "7-Day" to "14-Day" to match the backend.
5. **Build in-app tier upgrade flow** -- Use Stripe's subscription update API with proration instead of forcing users through the portal.
6. **Implement tier-level feature gating** -- The `features` arrays in `SUBSCRIPTION_TIERS` are defined but never enforced. Build middleware that checks tier features, not just numeric limits.
