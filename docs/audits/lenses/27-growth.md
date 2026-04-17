# Lens 27 — Growth Engineering Audit

**Auditor Persona:** Growth Engineer
**Date:** 2026-04-15
**Scope:** Activation metrics, conversion funnels, referral mechanics, trial-to-paid flow, growth loops, churn prevention
**Methodology:** Static analysis of pricing page, billing routes, trial service, referral system, onboarding flow, webhook handlers, usage limits, churn engine, growth automation jobs, NPS collection, and email sequences.

---

## Executive Summary

AcreOS has built substantive growth infrastructure: a four-tier pricing page, a 14-day free trial with Stripe integration, a referral program with credit rewards, an onboarding checklist, a churn risk scoring engine, a 5-strategy growth automation job, NPS collection, dunning email sequences, and usage-limit-based upgrade prompts. The foundation is ambitious and largely well-architected.

However, critical gaps exist in the activation funnel. The referral link is never captured during signup; the onboarding email drip sequence exists only as a markdown file and is not wired to any sending logic; pricing data is duplicated and contradictory across four locations; trial expiration has no automated cron job; and there is no product analytics pipeline to measure any of these funnels. Without instrumentation, every growth mechanism is flying blind.

---

## Findings

### F27-01 Referral Code Never Captured at Signup (P1)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P1 — broken conversion path |
| **Evidence** | `client/src/pages/auth-page.tsx` renders `<SignIn>` / `<SignUp>` from Clerk with no `ref=` query parameter handling. The `POST /api/referral/apply` endpoint exists (`server/routes-referral.ts:98`) and expects `{ code, refereeId }`, but nothing in the auth flow reads `?ref=CODE` from the URL and calls this endpoint after registration. |
| **Impact** | The entire referral program is non-functional. Referral links (`/?ref=CODE`) land on the landing page, the user clicks "Get Started," navigates to `/auth`, and the `ref` param is lost. Even if preserved, no client code ever calls `/api/referral/apply`. |
| **Evidence (marketing copy)** | `content/marketing/referral-copy.md` advertises link format `https://app.acreos.com/signup?ref={CODE}` but no `/signup` route exists (auth is at `/auth`). |
| **Evidence (settings page)** | `client/src/pages/settings.tsx:1831` constructs the referral link as `${appUrl}/?ref=${code}` (root URL, not `/signup`). |

### F27-02 Onboarding Email Drip Sequence Not Implemented (P1)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P1 — broken conversion path |
| **Evidence** | `content/emails/onboarding-sequence.md` defines a 7-email, 14-day drip sequence (Day 0, 2, 4, 7, 10, 12, 14). No server code sends these emails. Grep for `onboarding-sequence`, `drip`, `sendOnboardingEmail`, `day_0`, `day_2` across `server/**/*.ts` returns zero hits for any scheduled drip logic. |
| **Impact** | New users receive no lifecycle emails after signup. The Day 12 "trial ending soon" and Day 14 "trial ended" emails that drive conversion never fire. The social proof email (Day 7) and feature discovery email (Day 10) that drive activation never send. |
| **Note** | The `processSubscriptionCheckoutCompleted` webhook handler in `server/webhookHandlers.ts:192` sends a single subscription welcome email, but that fires only after a user has already paid -- not during the trial nurture window. |

### F27-03 Pricing Data Duplicated and Contradictory Across Four Sources (P1)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P1 — broken conversion path |
| **Evidence** | Pricing is defined in four places with conflicting values: |
| | (1) `client/src/pages/pricing.tsx`: Free=10 leads, Starter=$20, Pro=$49, Scale=$79 |
| | (2) `client/src/components/tier-upgrade-panel.tsx`: Free=25 leads, Starter=$20, Pro=$49 (no Scale) |
| | (3) `server/services/usageLimits.ts` TIER_LIMITS: Free=10 leads, Starter=250, Pro=500, Scale=unlimited |
| | (4) `migrations/0008_feature_flags_pricing_growth.sql` pricing_config seed: Starter=$49, Pro=$99, Growth=$199, Enterprise=$499 |
| **Impact** | The pricing page promises one set of limits, the in-app upgrade panel shows different limits (25 vs. 10 free leads), the server enforces yet another set, and the database has a fourth pricing model. Users who see "25 free leads" on the upgrade panel will hit a wall at 10 if the server's `TIER_LIMITS` are what actually gates them. Migration 0008 prices ($49/$99) are 2-3x higher than the pricing page ($20/$49). |
| **Note** | `content/emails/onboarding-sequence.md` also references "90 days of full Pro access" in the Day 0 email, while the actual trial is 14 days (`TRIAL_DURATION_DAYS = 14` in `server/services/trialService.ts:7`). |

### F27-04 Trial Expiration Has No Automated Cron (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | `trialService.expireTrials()` exists in `server/services/trialService.ts:94` and resets expired trials to the free tier. However, grep for `expireTrials` in `server/index.ts` returns zero results. The only caller is `POST /api/trial/expire-check` in `server/routes-billing.ts:622`, which is founder-only and must be triggered manually. |
| **Impact** | Organizations whose 14-day trial ends are never downgraded. They retain paid-tier access indefinitely without paying. This eliminates the urgency that drives trial-to-paid conversion. |
| **Note** | The Stripe `customer.subscription.trial_will_end` webhook is handled (`server/webhookHandlers.ts:448`) and creates a system alert, but this only fires for Stripe-managed trials. The local trial system (start trial without entering a credit card) has no expiration automation. |

### F27-05 No Product Analytics Pipeline (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | `client/src/components/beta-activation-detector.tsx` tracks sessions and page views via `POST /api/analytics/session/start` and `POST /api/analytics/pageview`. However, there is no integration with any analytics platform (Segment, Mixpanel, Amplitude, PostHog). No conversion events are tracked (signup completed, trial started, first lead added, first campaign sent, subscription purchased). |
| **Impact** | Impossible to measure: signup-to-activation rate, activation-to-trial rate, trial-to-paid conversion rate, feature adoption by cohort, or funnel drop-off points. Every growth experiment is unmeasurable. The `server/services/cohortAnalysis.ts` exists but analyzes lead conversion funnels (CRM data), not user activation funnels. |

### F27-06 Pricing Page CTAs All Route to /auth with No Tier Context (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | `client/src/pages/pricing.tsx:180`: every tier's CTA is `<Link href="/auth">{tier.cta}</Link>`. The selected tier, billing period (monthly/annual), and intent (trial vs. free) are not passed as query parameters. |
| **Impact** | After a user selects "Start 14-Day Free Trial" on the Pro tier, they land on `/auth` with no memory of their selection. After signup, they land on `/today` with no prompt to start a trial on the tier they selected. This is a significant funnel leak -- the highest-intent moment (clicking a specific tier's CTA) is wasted. |

### F27-07 Free Tier Has No Upgrade Prompts at Feature Gates (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | `server/middleware/usageLimitGate.ts` returns a 429 JSON response when limits are exceeded, including `upgradeUrl: "/settings#billing"`. On the client, `client/src/components/usage-limit-banner.tsx` shows a banner when usage exceeds 75%. However, feature-gated capabilities (Campaigns=0 on free, Sequences=0 on free, BYOK=false) have no in-app UI that explains the restriction and offers upgrade. When a free user navigates to `/campaigns`, there is no evidence of a paywall component explaining they need Starter to access campaigns. |
| **Impact** | Free users encounter silent blocks rather than conversion opportunities. The limit banner only fires for numeric limits (leads, properties, notes, AI requests), not for boolean feature gates (campaigns, sequences, BYOK). |

### F27-08 Referral Reward is $1.00 -- Insufficient Incentive (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | `server/routes-referral.ts:163`: `const creditAmount = 100; // $1.00 credit`. The comment says "or 1 month free depending on plan" but the code awards 100 cents ($1.00). The marketing copy in `content/marketing/referral-copy.md` promises "you both get a free month of Pro" ($49 value). The settings page copy says "$20 account credit when they subscribe." Three different promises, none matching the actual $1.00 credit. |
| **Impact** | The referral reward is too small to motivate sharing, and the inconsistent messaging undermines trust if users ever investigate their actual credit. |

### F27-09 Onboarding Checklist Progress is localStorage-Only (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `client/src/components/onboarding-checklist.tsx:72-73`: progress is persisted to `localStorage` keys `acreos_onboarding_dismissed` and `acreos_onboarding_checked`. Server has no visibility into onboarding completion rates. |
| **Impact** | Cannot measure onboarding completion rates, identify drop-off steps, or correlate onboarding progress with trial conversion. Cannot remind users who haven't completed onboarding. Progress is lost if user clears browser data or switches devices. |

### F27-10 Win-Back Sequence Not Connected to Cancellation Flow (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `server/jobs/growthAutomation.ts` defines a 3-touch win-back engine (7d, 30d, 60d after cancel). `server/routes-billing.ts:710` handles cancellation by saving a survey and redirecting to Stripe portal. However, there is no evidence the win-back engine queries `cancellationSurveys` to personalize the re-engagement emails based on the stated cancellation reason. |
| **Impact** | A user who cancelled because of "missing_features" gets the same win-back email as one who cancelled because of "too_expensive." Personalization by reason would significantly improve win-back rates. |

### F27-11 Trial Banner Shows in Sidebar Only -- Low Visibility (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `client/src/components/trial-banner.tsx` renders a small banner (likely in sidebar based on `mx-4 mb-2` styling). When trial days remaining <= 3, it shows "Expiring soon" badge but no modal, no email, and no urgency-driving countdown. The CTA links to `/settings?tab=billing` which requires multiple clicks to actually start checkout. |
| **Impact** | Low conversion from trial to paid. Best practice for trial expiration is: prominent in-app modal at 3 days, email at 3 days, email at 1 day, and a one-click upgrade path. Currently only the sidebar banner exists. |

### F27-12 No Activation Metric Defined or Tracked (P2)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P2 — missing growth mechanism |
| **Evidence** | No code defines or tracks an "activated user" event. The onboarding checklist has 7 steps but no concept of "activation" (the moment a user first receives core value). For a land investing CRM, activation likely means "imported first lead + sent first campaign" or "received first AI valuation." The churn engine tracks milestones (`MILESTONES.FIRST_LEAD`, `FIRST_CAMPAIGN_SENT`, etc.) but only for paying orgs -- not free or trialing users, and not as a growth metric that feeds the funnel. |
| **Impact** | Without a defined activation metric, cannot optimize the signup-to-activation funnel, cannot identify users at risk of never activating, and cannot trigger targeted nudges to drive activation. |

### F27-13 Growth Automation Job Has 21-Day Email Cooldown (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `server/jobs/growthAutomation.ts:64`: `MIN_DAYS_BETWEEN_EMAILS: 21`. This applies globally across all growth email types (upsell, win-back, referral activation, re-engagement, expansion). |
| **Impact** | A user who receives an upsell email cannot receive a re-engagement email for 21 days, even if they go inactive. During a 14-day trial, the user could receive at most one growth email. This cooldown is too aggressive for the trial window. |

### F27-14 NPS Survey Trigger Timing Not Correlated with Conversion (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `client/src/components/nps-dialog.tsx` implements a full NPS collection flow. The dialog is dismissible for 7 days via localStorage. However, there is no evidence NPS scores feed into the upgrade prompt logic. High-NPS trial users (promoters, score 9-10) are the most likely to convert and should receive different treatment than passive users (score 7-8). |
| **Impact** | Missed opportunity to use NPS as a conversion signal. Promoters during trial should get a direct upgrade ask; detractors should get support outreach. |

### F27-15 UTM Attribution Columns Exist but No Capture Code (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `migrations/0008_feature_flags_pricing_growth.sql:5-8` adds `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` columns to organizations. No server or client code reads UTM parameters from the URL and stores them during signup. |
| **Impact** | Cannot attribute signups to marketing channels. The growth_campaigns table (same migration) tracks impressions, clicks, signups, and conversions, but without UTM capture, the signups counter cannot be incremented. Ad spend ROI is unmeasurable. |

### F27-16 Churn Engine Only Scores Paying Orgs (P3)

| Attribute | Detail |
|-----------|--------|
| **Severity** | P3 — optimization opportunity |
| **Evidence** | `server/services/churnEngine.ts:280`: `sql\`${organizations.subscriptionStatus} = 'active' AND ${organizations.subscriptionTier} != 'free'\``. Trialing users (`subscriptionStatus = 'trialing'`) are excluded from churn scoring. |
| **Impact** | The trial window is the highest-leverage period for engagement interventions, but the churn engine ignores it entirely. A trialing user who goes inactive for 10 of their 14 trial days receives no rescue email. |

---

## Funnel Map (Current State)

```
Landing Page ──> /auth (Clerk) ──> /today ──> Onboarding Checklist ──> Usage
     |                  |              |                                    |
     |  [BROKEN: no     |  [BROKEN:    |  [P3: localStorage-only,         |
     |   ref= capture]  |   no tier    |   no server tracking]            |
     |                  |   context]   |                                    |
     |                  |              v                                    |
     |                  |        Trial Banner (sidebar)                    |
     |                  |         [P3: low visibility]                     |
     |                  |              |                                    |
     |                  |              v                                    v
     |                  |    /settings?tab=billing ──> Stripe Checkout ──> Paid
     |                  |         [BROKEN: no drip                          |
     |                  |          emails to drive                          |
     |                  |          conversion]                              |
     |                  |                                                   |
     v                  v                                                   v
  Referral Link    Signup Complete                                    Churn Engine
  [BROKEN: code    [BROKEN: no                                       [P3: ignores
   never captured]  UTM capture,                                      trialing orgs]
                    no activation
                    event tracked]
```

---

## Priority Summary

| ID | Finding | Severity | Category |
|----|---------|----------|----------|
| F27-01 | Referral code never captured at signup | P1 | Broken conversion path |
| F27-02 | Onboarding email drip sequence not implemented | P1 | Broken conversion path |
| F27-03 | Pricing data contradictory across 4 sources | P1 | Broken conversion path |
| F27-04 | Trial expiration has no automated cron | P2 | Missing growth mechanism |
| F27-05 | No product analytics pipeline | P2 | Missing growth mechanism |
| F27-06 | Pricing CTAs route to /auth with no tier context | P2 | Missing growth mechanism |
| F27-07 | Free tier has no upgrade prompts at feature gates | P2 | Missing growth mechanism |
| F27-08 | Referral reward is $1.00, marketing promises $49 | P2 | Missing growth mechanism |
| F27-09 | Onboarding checklist progress is localStorage-only | P3 | Optimization |
| F27-10 | Win-back not personalized by cancellation reason | P3 | Optimization |
| F27-11 | Trial banner is sidebar-only, low urgency | P3 | Optimization |
| F27-12 | No activation metric defined or tracked | P2 | Missing growth mechanism |
| F27-13 | Growth email 21-day cooldown too aggressive for trials | P3 | Optimization |
| F27-14 | NPS not correlated with conversion prompts | P3 | Optimization |
| F27-15 | UTM columns exist but no capture code | P3 | Optimization |
| F27-16 | Churn engine ignores trialing orgs | P3 | Optimization |

---

## Key Files Examined

- `client/src/pages/pricing.tsx` — Public pricing page
- `client/src/pages/auth-page.tsx` — Auth/signup page (Clerk)
- `client/src/pages/landing.tsx` — Landing page
- `client/src/components/trial-banner.tsx` — Trial countdown banner
- `client/src/components/tier-upgrade-panel.tsx` — In-app upgrade comparison
- `client/src/components/onboarding-checklist.tsx` — Getting started checklist
- `client/src/components/usage-limit-banner.tsx` — Usage limit warning
- `client/src/components/beta-activation-detector.tsx` — Session/pageview tracking
- `client/src/components/nps-dialog.tsx` — NPS survey dialog
- `server/services/trialService.ts` — Trial start/status/expiration logic
- `server/services/usageLimits.ts` — Tier limits and enforcement
- `server/services/churnEngine.ts` — Churn risk scoring
- `server/services/dunning.ts` — Payment failure email sequences
- `server/routes-billing.ts` — Billing, trial, and cancellation endpoints
- `server/routes-referral.ts` — Referral program endpoints
- `server/webhookHandlers.ts` — Stripe webhook event processing
- `server/middleware/usageLimitGate.ts` — Usage limit enforcement middleware
- `server/jobs/growthAutomation.ts` — 5-strategy growth automation engine
- `server/stripeService.ts` — Stripe checkout/portal session creation
- `content/emails/onboarding-sequence.md` — Unimplemented email drip content
- `content/marketing/referral-copy.md` — Referral program marketing copy
- `migrations/0008_feature_flags_pricing_growth.sql` — UTM, pricing config, growth campaigns
- `migrations/0010_referrals.sql` — Referral program schema
- `migrations/0012_nps_churn_risk.sql` — NPS collection schema
- `docs/architecture/007-three-tier-launch-pricing.md` — Pricing strategy ADR
