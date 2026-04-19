---
id: settings-billing-tier-change
name: Settings Billing Tier Change
title: Settings Billing Tier Change
goal: Navigate to billing settings, upgrade to a higher subscription tier, and verify that tier-locked features are unlocked.
description: Subscription tier upgrade through Settings and verification of feature unlocking.
start_url: /
max_steps: 100
timeout_minutes: 20
estimated_duration_minutes: 15
starting_state: Authenticated user on the Free or Starter tier with access to the Settings page.
success_criteria:
  - User navigates to Settings and finds the billing/subscription section
  - Current tier is clearly displayed with a comparison to available tiers
  - Tier comparison shows features included at each level with clear differentiation
  - User can initiate an upgrade flow (Stripe checkout or in-app upgrade)
  - After upgrade, previously locked features become accessible
  - Billing page reflects the new tier, next billing date, and payment method
success_conditions:
  - Billing settings page loads and shows current tier
  - Tier comparison or pricing table is visible
  - Upgrade action is available and clickable
  - Feature access changes after tier change
abandonment_criteria:
  - Settings page has no billing or subscription section
  - Current tier is not displayed, leaving the user unsure what plan they are on
  - Upgrade button leads to an external page with no context about what they are buying
  - Tier comparison does not explain what features are locked at the current tier
  - After upgrade, the UI still shows features as locked or the tier display does not update
common_failure_modes:
  - Stripe checkout session creation fails, leaving the user on a broken payment page
  - Webhook from Stripe does not arrive, so the tier is not updated even after payment
  - Feature gates check a cached tier value that does not refresh after upgrade
  - Downgrade path is hidden or unavailable, trapping users on a higher tier
  - Tier-specific credit allocations are not applied immediately after upgrade
---

# Journey Context

Billing is where product value converts to revenue. This journey tests whether a real estate professional can understand the tier structure, see what they are getting (and what they are missing), and upgrade confidently. It also verifies that the upgrade actually takes effect — features that were previously gated become accessible.

The persona starts on the Free or Starter tier. They have been using AcreOS for some time and have hit a limit — maybe they ran out of AI analysis credits, maybe they tried to access the autonomous executor and found it locked, or maybe they simply want the full feature set. They navigate to Settings to explore upgrade options.

The Settings page should have a clear Billing or Subscription section. The persona sees their current tier (e.g., "Starter — $20/month"), the next billing date, and the payment method on file. Below that, a tier comparison table shows what each tier includes: Free ($0 — basic CRM, 5 AI analyses/month), Starter ($20 — 50 analyses, direct mail, skip tracing), Pro ($49 — unlimited analyses, autonomous executor, API access), Scale ($79 — multi-user, white-label, priority support).

The critical design question is whether the persona can understand the value difference between tiers in under 30 seconds. A good tier comparison highlights what the persona is missing at their current level — not just a feature list, but a contextual explanation: "Upgrade to Pro to unlock the autonomous executor, which reviews your pipeline every 30 minutes and recommends actions based on your deal criteria."

The persona clicks "Upgrade to Pro" and enters the payment flow. If AcreOS uses Stripe Checkout, the persona is redirected to a Stripe-hosted page where they enter payment details. If it uses an in-app payment form (Stripe Elements), the form appears inline. Either way, the experience should feel secure and professional — no broken layouts, no missing SSL indicators, no confusing form fields.

After completing payment, the persona returns to AcreOS. The tier display should update immediately — "Pro — $49/month." The persona then navigates to a feature that was previously locked (e.g., the autonomous executor, the AI Hub's advanced features, or the data export tool) and verifies that it is now accessible. If the feature still shows as locked, the persona's confidence in the platform drops sharply.

What "good" looks like: the persona understands the tier structure in one glance, upgrades in under 3 minutes, and verifies the upgrade by accessing a previously locked feature — all without confusion, errors, or ambiguity. The billing page is a source of clarity, not anxiety. The persona knows exactly what they are paying for and what they are getting.

Variations include: the persona downgrades instead of upgrading (testing the reverse flow), the persona is on a trial and the trial is expiring, or the Stripe webhook is delayed and the persona needs to refresh before the tier updates. Another variation is the persona exploring the tier comparison without intending to upgrade — the page should be informative even for window-shoppers.
