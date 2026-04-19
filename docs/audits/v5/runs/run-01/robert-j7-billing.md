# Robert J7 -- Settings / Billing (Upgrade Path)

**Persona:** Robert, 68, retired, tablet (iPad), 3G cellular, wants to see all 5 of his parcels.
**Task:** Robert is on the free tier (3-property limit) and owns 5 parcels. He needs to upgrade. Can he find the path? Does he understand what he is paying for?
**Date:** 2026-04-18 | AcreOS v5 | Run 01

---

## Pre-conditions

- Robert is logged in on his iPad.
- Free tier account, 3-property limit.
- He has tried to add a 4th and 5th property and presumably hit a limit message.
- He wants to "see all his parcels" -- meaning he needs to upgrade to a plan that allows 5+ properties.

---

## Step-by-step transcript

### Step 1 -- Encounter the property limit

Robert is on the Properties page and attempts to add his 4th property.

**Expected behavior:** The usage limits system (`usageLimits.ts`) enforces property counts per tier. When Robert tries to create a property beyond his limit, the system should return a 429 or show a usage-limit toast.

**Result:** The usage data is visible in Settings > General under "Usage & Limits." The properties progress bar shows `3 / 3` (100%). There is an amber warning banner: "You're approaching your limits -- You've used 80%+ of your properties allowance. Upgrade your plan to unlock higher limits."

A "View Upgrade Options" button (data-testid: `button-upgrade-from-usage`) scrolls to the pricing section.

**Friction: LOW.** The limit message is clear and the upgrade CTA is present. However, Robert may not realize he needs to go to Settings first -- the error he sees when trying to add a property should itself link to the upgrade path.

### Step 2 -- Navigate to Settings

Robert taps on "Settings" in the navigation.

**Result:** The Settings page loads with tabs: General, Team, Payments, Communications, Notifications, AI, Data, Appearance, Integrations, Developer, Goals, Security, Refer & Earn, Automations, AI Tasks.

**Friction: MEDIUM -- SEVERITY P2.** There are 15 tabs in the settings page. On an iPad, the TabsList uses `overflow-x-auto` with horizontal scrolling. Robert must scroll horizontally to find the right tab. The tab he needs is "General" (which is the default, so it loads first), but the pricing section is below the fold and requires vertical scrolling. The "Payments" tab exists but contains Stripe Connect configuration (for receiving payments from buyers), not the subscription upgrade flow.

> Robert thinks: "There are a lot of tabs here. Where do I go to upgrade?"

### Step 3 -- See the Organization Details card

The General tab shows:
- Organization Name
- Subscription Tier: Badge showing "Free" with a crown icon
- Subscription Status badge

Since Robert is on the free tier with no active Stripe subscription, he sees:
- "7-Day Free Trial Available" banner (if `trialUsed` is false) with the message "Start your subscription with a 7-day free trial. No charge until the trial ends."
- Or "Upgrade below to unlock more features!" (if trial was used)

**Friction: LOW.** The free trial banner is clear and encouraging.

### Step 4 -- View Usage & Limits

Below the organization card is the "Usage & Limits" card showing:
- Leads: current / limit
- Properties: 3 / 3 (100% -- red progress bar with `[&>div]:bg-red-500`)
- Notes: current / limit
- AI Requests: current / limit (daily)

The amber warning appears: "You're approaching your limits" with "View Upgrade Options" button.

**Friction: LOW.** The usage display is clear. Robert can see that his properties are at 100% and understand why he cannot add more. The button to scroll to pricing is helpful.

### Step 5 -- Scroll to "Available Plans"

Robert taps "View Upgrade Options" or scrolls down past:
1. Organization Details card
2. Seat Management card
3. Usage & Limits card
4. Usage & Credits (UsageDashboard component)
5. Pricing Guide section
6. Help & Tips card
7. **Available Plans** section (id: `pricing-section`)

**Friction: HIGH -- SEVERITY P1.** Robert must scroll past 6 sections to reach the pricing plans. On a tablet over 3G, each of these sections makes API calls (seats, usage, credits, pricing guide), all of which must load before the pricing section is even visible. The vertical distance is significant. The "View Upgrade Options" button uses `scrollIntoView({ behavior: "smooth" })`, which helps, but if sections above are still loading (showing Skeletons), the scroll target may jump as content renders.

> Robert thinks: "The page is still loading and jumping around. Where are the plans?"

### Step 6 -- Read the plan cards

The Available Plans section renders a grid of cards (`grid-cols-1 md:grid-cols-3`). Each card shows:
- Product name (e.g., "Starter", "Pro", "Scale")
- Price per interval (e.g., "$29/month")
- Description
- Feature list (from Stripe product metadata, keys starting with `feature_`)
- "Upgrade to [Plan Name]" button

On iPad (medium viewport), this renders as a 3-column grid.

**Friction: MEDIUM -- SEVERITY P2.** The critical question for Robert is: "How many properties does each plan allow?" This information is only present if the Stripe product metadata includes a `feature_` key describing the property limit. If the metadata does not explicitly state "Up to X properties," Robert has no way to know which plan accommodates his 5 parcels. The pricing cards pull from Stripe product data, not from the `TIER_LIMITS` configuration used by the server's usage limits system. There is a disconnect: the server knows the exact limits per tier (from `usageLimits.ts`), but the pricing UI shows only whatever text Stripe product metadata contains.

> Robert thinks: "Which plan lets me have 5 properties? None of these cards say."

### Step 7 -- Decide and upgrade

Robert guesses and taps "Upgrade to Starter" (or whichever plan looks right).

**Action:** Triggers `handleUpgrade(price.id)` which calls `checkoutMutation.mutateAsync(priceId)`.

**Result:** The mutation hits `POST /api/stripe/checkout`, which creates a Stripe Checkout session. Robert is redirected to Stripe's hosted checkout page.

**Friction: MEDIUM.** On 3G, the redirect to Stripe takes several seconds. The Stripe checkout page itself is well-optimized for mobile, so once loaded, Robert can complete payment. However, he has left AcreOS entirely and is now on stripe.com -- this may be confusing for someone unfamiliar with online payments.

If the organization is eligible for a free trial (14 days, per the `trialDays` logic), the checkout session includes the trial. This is good -- Robert gets to try before committing. But the Settings UI said "7-Day Free Trial" while the server code says `14` days. This is a discrepancy.

**Friction: LOW-MEDIUM (trial discrepancy) -- SEVERITY P3.** The UI says 7-day trial; the server grants 14 days. This is in Robert's favor but creates a trust issue if he later sees a different trial length on his invoice.

### Step 8 -- Return from Stripe

After completing checkout, Robert is redirected back to `/settings?subscription=success`.

**Result:** A toast appears: "Subscription activated! Your subscription has been successfully activated."

**Friction: LOW.** The success state is clear.

### Step 9 -- Verify properties limit increased

Robert navigates back to Properties and attempts to add his 4th and 5th properties.

**Expected behavior:** The usage limits now reflect the new tier's property cap. Robert can add his remaining parcels.

**Friction: NONE if the subscription sync is immediate.** The Stripe webhook updates the organization's `subscriptionTier`, and subsequent API calls use the new limits.

---

## Friction inventory

| # | Event | Severity | Component |
|---|-------|----------|-----------|
| F1 | Must scroll past 6 sections to reach pricing plans | P1 | `settings.tsx` General tab layout |
| F2 | Plan cards may not show property limits explicitly | P2 | `settings.tsx` plan card metadata rendering |
| F3 | 15 tabs in settings causes horizontal scrolling on tablet | P2 | `settings.tsx` TabsList |
| F4 | "Payments" tab name is misleading -- it contains Stripe Connect, not subscription billing | P2 | `settings.tsx` tab naming |
| F5 | Trial duration discrepancy: UI says 7 days, server grants 14 | P3 | `settings.tsx` line ~901 vs `routes-billing.ts` line ~304 |
| F6 | Layout shift during loading causes scroll target to jump | P2 | `settings.tsx` skeleton loading |
| F7 | PlanComparisonModal component is imported but only shown on `#billing` hash, not surfaced from the usage limit warning | P3 | `settings.tsx` showPlanComparison logic |

---

## Verdict

**CONDITIONAL PASS.** Robert can find and complete the upgrade, but the path has unnecessary friction. The pricing section is buried deep in the General tab behind multiple loading sections. The plan cards may not clearly state property limits, forcing Robert to guess which plan he needs. The "Payments" tab name is a red herring (it is about receiving payments, not paying for a subscription). The experience is functional but not optimized for a non-technical user on a slow connection.

---

## Recommendations

1. **Move the plan/subscription section higher in the General tab**, or create a dedicated "Subscription" or "Billing" tab that is distinct from the "Payments" (Stripe Connect) tab. Rename "Payments" to "Payment Collection" or "Receive Payments" to avoid confusion.

2. **Display tier limits on plan cards.** Each plan card should show the concrete limits: "Up to X properties, Y leads, Z AI requests/day." Pull from `TIER_LIMITS` on the server and include in the Stripe products API response, rather than relying solely on Stripe metadata fields.

3. **Surface the PlanComparisonModal from the usage warning.** The "View Upgrade Options" button should open the `PlanComparisonModal` (which already exists and is imported) rather than scrolling to the plan cards. The modal provides a side-by-side comparison that is easier to evaluate.

4. **Fix the trial duration discrepancy.** Align the UI text ("7-Day Free Trial") with the server logic (`trialDays = 14`). Either change the server to 7 or the UI to 14.

5. **Reduce the number of settings tabs.** Consider grouping related tabs (e.g., merge AI + AI Tasks, merge Data + Developer) to reduce tab count below 10, which is more manageable on tablet.
