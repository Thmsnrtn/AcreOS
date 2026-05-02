# Magnolia Harthgrove — AcreOS through the renewal-manager lens (deeper pass)

I'm Magnolia Harthgrove. Forty-four. Ran the renewal-manager program at Stripe before that — the team that touched every Enterprise customer in the 90 days before their anniversary, sorted them into "expand," "hold," "save," or "concede," and was responsible for the gross-retention number on the dashboard the CFO read every Monday. I came into AcreOS expecting the usual SaaS startup posture — annual contracts hadn't been built yet, renewal mechanics hadn't been thought through, churn was a vibe rather than a forecast. I was half right. The churn-detection plumbing here is genuinely better than I expected from a company at this stage. The renewal *motion* doesn't exist yet.

I'm going to be specific.

---

## 1. There is no annual contract — and that's not a small thing

`shared/schema.ts:11361` defines `displayPriceYearly` as cents-per-month-billed-annually. The intent is there. But when I trace it forward into the actual subscription flow — `server/routes-billing.ts:274-338`, the Stripe checkout endpoint — the only thing that hits Stripe is a `priceId` the client picked. There is no logic that prefers annual, no upgrade prompt to annual at month nine, no "save 17% by switching to annual" CTA anywhere in the settings page I could find.

`shared/schema.ts:2937-3136` defines `SUBSCRIPTION_TIERS` — free / sprout / starter / pro / scale — and every tier carries a single `price` integer. No `priceMonthly` / `priceYearly` split. The yearly price exists in the pricing-config table but it does not exist in the canonical tier definition. That's a tell: the *engineering* model thinks of plans as monthly. The *pricing* model thinks of them as offering both. When those two disagree, the renewal motion can't be built on top of either.

This matters because of the math. SaaS companies at AcreOS's stage that ship annual contracts get 60-70% of paying customers onto annual within 18 months. Their gross retention runs 8-12 points higher than monthly-only peers. Their LTV/CAC is meaningfully better. Their forecast is more believable to the next investor. AcreOS is leaving that on the table, and the longer the codebase calcifies around month-to-month, the harder it is to retrofit.

The work here is not small but it is bounded:

1. Add `priceYearly` to `SUBSCRIPTION_TIERS` as a peer of `price`. Make `price` an alias for `priceMonthly` in a deprecation window.
2. Wire a `billingInterval` field onto `organizations` so we know what cadence each customer is on.
3. In Stripe, create yearly Price objects for every active product, mark them with `metadata.interval = "year"`, and surface them on `/api/stripe/products`.
4. Build the upgrade-to-annual prompt. Place it at month 4 (after the relationship is sticky), at month 9 (before renewal anxiety sets in), and at month 11 (last-chance save). Discount: 17% off — i.e., 12 months for the price of 10. This is the standard ratio; don't be clever.
5. Add a `subscription_anniversary_date` denormalized onto `organizations` so the renewal cron has something to query without round-tripping Stripe every night.

Do this before you raise. The diligence question *"what percent of ARR is annual?"* will be asked, and *"zero, we don't sell annual"* is the wrong answer. The follow-up question — *"what percent of those annuals auto-renewed last cycle?"* — will be asked too, and you can't answer it if every customer is monthly because you don't have a renewal cycle to measure against.

One more thing on this. The free-trial implementation at `server/routes-billing.ts:303-304` defaults trials to 14 days. That's fine. But there is no anti-trial-abuse logic — the flag is a single boolean (`trialUsed`) on the organization, which means a customer who signs up, abuses the trial, cancels, and creates a new org gets another 14 days. Stripe-side, you'd want to also flag the customer's *email* and *card fingerprint* as trial-used; today that's enforced at the org level only. Not a renewal issue per se but it's the same column on the same table and a hostile pattern your renewal-manager will see in the data once you start looking.

---

## 2. The churn engine is genuinely good — and it's looking the wrong direction

`server/services/churnEngine.ts` is the most pleasant surprise of this pass. It scores every paying org on a 0-100 scale across five weighted signals (inactivity 30, feature breadth 25, data depth 20, payment health 15, support load 10), runs nightly at 6am, auto-sends a re-engagement email at score ≥85, creates a `systemAlert` at ≥80, and broadcasts a summary to the `customer_signals` agent channel. That's better instrumentation than 80% of the Series-A SaaS companies I looked at in my Stripe years.

Here's where it falls short for renewals specifically:

**The model has no time dimension relative to renewal.** A customer at month 11 with a churn score of 62 is materially more dangerous than the same customer at month 3. The model doesn't know that. It doesn't load `org.subscriptionAnniversaryDate` (because the field doesn't exist yet — see §1) and it doesn't apply a renewal-proximity multiplier. In renewal-manager language: the engine detects *churn risk* but not *renewal risk*, and they are not the same thing.

Concretely, in `scoreOrg()` at `server/services/churnEngine.ts:100-144`, I would add a sixth signal — **renewal proximity** — worth 0-20 points, layered on top of the existing 100. Days-to-renewal under 7 → 20pts. Under 30 → 12pts. Under 60 → 6pts. Over 90 → 0pts. The total then runs 0-120, and the rescue threshold lifts to 95. This way the same idle behavior triggers a different intervention depending on whether they're three months in or three weeks out.

**The rescue email is a single template.** `server/services/churnEngine.ts:240-264` sends one templated message — *"We noticed you haven't been around lately"* — regardless of tier, tenure, or renewal proximity. A scale-tier customer at month 11 should not get the same email as a sprout-tier customer at month 2. The email service supports `templateData`; use it. At minimum, branch on three buckets: pre-90-day-newbie, mid-tenure quiet, and renewal-window-quiet. The renewal-window-quiet template should name the renewal date explicitly and offer to set up a 15-minute call with a human.

**The detection is binary.** Score ≥85, send email. Score 84, do nothing. Real renewal motions run a *playbook* — at 60 days out, every paying customer (regardless of risk) gets a touch. At 30 days out, an exec-sponsored email. At 7 days out, a phone call for the top-tier orgs. The churn engine is the engine for the *exception path* (we should reach out because something is wrong); it's not the engine for the *standard path* (we reach out because they're approaching renewal). You need both, and you have one.

**The signal weights need tier-aware tuning.** Inactivity at 30 points is correct for self-serve. For scale-tier customers paying meaningfully more per month, *feature breadth* and *team-member count* are stronger renewal predictors than login frequency — a sales-ops user who logs in twice a month but has built three campaigns and onboarded four teammates is not at risk. Today the same weights apply to a $0 free user and a $500/mo scale customer. At least add a `tier` parameter to `scoreOrg()` and let it scale the inactivity weight down for higher tiers. This is a one-day refactor and it stops the engine from over-flagging your most valuable accounts.

**Milestone detection is tied to referral nudges, not renewal nudges.** `detectMilestones()` at line 146 is good logic — it tracks first lead, 50 leads, first note, etc. — and `sendMilestoneReferralNudge()` at line 186 fires a referral CTA when a low-risk customer hits a milestone. That's the right *referral* motion. But milestones are also the right moments for *expansion* nudges. A customer who just hit `leads_50` on the starter plan is the right person to upsell to pro. Add a parallel `sendMilestoneExpansionNudge()` that triggers when the customer is at 80%+ of their tier limit, hits a milestone, and is within 90 days of renewal.

---

## 3. The cancellation flow has a survey but no save motion

`server/routes-billing.ts:723-777` is the cancellation flow. It does two things right and one thing very wrong.

Right: it captures a structured cancellation survey before redirecting to Stripe portal — reason enum (too_expensive / not_using / missing_features / switching_competitor / other), free-text feedback, previous tier, persisted to `cancellationSurveys`. This is correct instrumentation. Right: it pulls usage stats into a `/api/subscription/cancellation-context` endpoint at line 723-736, which a save-page surface could in theory use to remind the customer what they're about to lose.

Wrong: there is no save page between the survey and the Stripe portal. Once the customer hits "submit cancellation," they go straight to Stripe's hosted portal and cancel. The retention offer is never made. The customer never sees *"you've created 247 leads, closed 8 deals, saved roughly $14k in commissions per your settings"*. The discount-to-stay is never offered. The pause-instead-of-cancel option doesn't exist.

This is the single highest-ROI change in the renewal stack and it is maybe two days of work:

1. Build a `<CancellationFlow>` client component that consumes `/api/subscription/cancellation-context` and renders three steps: (a) survey, (b) personalized retention offer based on `reason`, (c) confirm-or-stay.
2. The retention offers branch on the reason: *too_expensive* → "30% off for 3 months" + downgrade option; *not_using* → "pause for 60 days, no charge" + onboarding call CTA; *missing_features* → roadmap surface + "talk to founder" CTA; *switching_competitor* → free-text "what are they doing better?" with a 10% retention discount.
3. Track offer-accept rate in a new `cancellationOffers` table. Every renewal motion's value is its save rate; you can't improve what you don't measure.
4. The Stripe portal redirect becomes the *terminal* state, not the next-after-survey state.

Industry baselines: a well-built save flow recovers 18-25% of cancellation intents. AcreOS at scale is leaving that money in the parking lot.

A note on the refund flow at `server/routes-billing.ts:783-928`. It auto-approves refunds under $50 and downgrades the org to free, cancelling the Stripe subscription synchronously. That's customer-friendly and correct for self-serve scale, and the rate-limit (no second auto-refund within 30 days) is the right guard. *But* — and this is a renewal-manager observation, not an engineering one — auto-refund-and-cancel is the most expensive save you can offer, because you're doing it after they've already decided to leave, not before. The cancellation save flow in the bullets above intervenes earlier, when a partial refund or a discount might have kept them. Keep the auto-refund as the courtesy backstop; build the save page as the primary flow.

The cancellation survey reasons enum at line 745 is also too coarse for diagnostic value at scale. *not_using* covers three different failures: (a) couldn't onboard, (b) onboarded but didn't form the habit, (c) habit formed but business moved on. Each has a different intervention. When you build the save page, split that one bucket into three; the founder's roadmap clarity in 18 months will thank you.

---

## 4. The dunning ladder exists but the renewal ladder doesn't

`server/services/churnEngine.ts:128-137` references a `dunningStage` field on organizations with values *none / grace_period / warning / restricted / suspended / cancelled*. That's a payment-failure ladder — what happens when a card declines. It's the right shape and I assume there's a service somewhere that walks customers up it (I didn't trace it for this pass).

What doesn't exist is the equivalent ladder for *upcoming renewals*. The signals a renewal manager wants to see at 60/30/7 days out — touch logged, exec sponsor assigned, save attempted, expansion-pitched, multi-year-discussed — are not modeled. Compare what you have to what you need:

| Stage | Day | What exists | What's missing |
|---|---|---|---|
| Awareness | T-90 | nothing | "renewal_approaching" alert into customer_signals channel |
| First touch | T-60 | nothing | templated email + log to org timeline |
| Health check | T-45 | churn engine runs nightly (good) | health summary surfaced to founder dashboard with renewal context |
| Exec sponsor | T-30 | nothing | for tier ≥ pro: queue a "founder reach-out" task |
| Expansion pitch | T-21 | nothing | usage-based expansion recommendation (you've used 89% of your seat cap, upgrade?) |
| Multi-year offer | T-14 | nothing | 2yr commit at 25% off, 3yr at 35% off, surfaced in-app |
| Last call | T-7 | nothing | for at-risk: phone call task; for healthy: confirmation email |
| Renewal | T-0 | Stripe auto-renews | post-renewal NPS survey trigger |
| Win-back | T+30 | nothing | for non-renewers: 50%-off-for-3-months win-back campaign |

You don't need to build all nine stages tomorrow. You need to model them as a state machine on `organizations` (call the field `renewalStage`), let the churn engine cron advance the state daily, and let each state-transition emit an event that the comms / task / email systems subscribe to. That decouples the *renewal cadence* from the *renewal artifacts* and lets you iterate on each independently.

---

## 5. Multi-year contracts: an incentive structure that doesn't exist

I searched the codebase for "multi-year," "two-year," "three-year," "biennial," and any combination thereof. Nothing. The pricing model is single-year-or-monthly. That is fine for self-serve at this stage. It is not fine for the top decile of accounts — the scale-tier customers, the founder's-personal-network customers, the customers whose ARR is meaningful enough that you want them locked in past the 18-month "I'll try a competitor" window.

What I'd build: in the Stripe checkout flow, when a customer selects a yearly price for the **scale** tier (and only that tier — don't dilute the offer), surface a multi-year option:

- 1 year: list price, no discount.
- 2 years: 12% off, paid annually but contract-locked.
- 3 years: 22% off, paid annually but contract-locked.

Mechanically, in Stripe, this is a coupon + a custom contract field on the subscription, not a separate product. `server/routes-billing.ts:307-322` already has the promo-coupon plumbing for tier-level promotions; multi-year is the same plumbing with a different lookup. You'd extend `pricingConfig` to carry `multiYearCouponId2y` / `multiYearCouponId3y`, surface them in the checkout component, and apply on selection.

Why bother at this stage? Because the diligence narrative changes. *"32% of scale-tier ARR is on multi-year contracts averaging 2.4 years"* is a different forecast than *"100% of ARR turns over annually."* Investors price the difference. The customers who self-select into multi-year are also the ones who refer others — they've made the strategic bet and want to be right.

There's a secondary benefit I'd flag for the founder. The land-investor customer base is unusually long-cycle for SaaS — the deals these customers are working on close in 6-18 months, not 30 days, and the value of the platform compounds across deals. Annual-and-multi-year fits that customer's mental model better than monthly does. Monthly is the wrong unit of value for what AcreOS actually does. The pricing should match the rhythm of the business it serves.

---

## 6. The billing-system renewal flow itself

The actual mechanics, traced through the code:

- Stripe is configured for auto-renewal by default (correct — `cancel_at_period_end` is not being set anywhere I found).
- Webhook handling at `server/routes-billing.ts:637-716` is solid: signature verified, idempotency table prevents double-processing (`stripeProcessedEvents`), errors logged. This is production-grade.
- What's missing: *renewal-specific* webhook handlers. Stripe emits `invoice.upcoming` (T-7 by default), `customer.subscription.updated` on renewal, `invoice.payment_succeeded` on renewal charge. None of these are wired to renewal-stage transitions in the org table because the renewal-stage column doesn't exist (§4). When you build the renewal-stage state machine, these webhooks become the canonical advance-state triggers, not a cron.
- The 14-day free trial logic at `server/routes-billing.ts:303-304` (`const trialDays = org.trialUsed ? undefined : 14`) is fine but `trialUsed` is a single boolean — there's no concept of trial *extension*. A renewal manager occasionally wants to extend a trial when a deal is nearly done. Today, that's a Stripe-portal manual override; it should be an API endpoint that audits the extension.
- The `creditPurchase` flow at `server/routes-billing.ts:131-182` is well-instrumented (idempotency middleware, atomic customer creation), but credit purchases are not currently factored into the churn model. A customer who topped up credits twice in the last month is *engaged*; the engine should treat that as an inactivity-counterweight signal. Today the only inactivity proxy is the activityLog, which doesn't capture credit purchases distinctly.
- `ChurnIntelligence.tsx` on the founder dashboard surfaces at-risk orgs and a churn rate vs. industry benchmark. The component is good — accessible, properly skeletoned, recommendations rendered. What it's missing is a *renewal calendar* surface: "8 paying orgs renew in the next 30 days; 3 of them are at risk." That single sentence on the founder dashboard is what turns a passive tool into an action-driver.

---

## 7. The 30-day priorities

If I were running this team for a quarter:

1. **Week 1-2**: Add `subscriptionAnniversaryDate` and `renewalStage` to `organizations`. Backfill from Stripe. Wire `invoice.upcoming` and `customer.subscription.updated` webhooks to advance `renewalStage`.
2. **Week 2-3**: Build the cancellation save page. Three branches by reason. Measure offer-accept rate. This is the highest-ROI single deliverable in the whole stack.
3. **Week 3-4**: Add renewal-proximity to the churn engine score. Branch the rescue email template by tier and proximity. Add a `customer_signals` broadcast at T-60 and T-30.
4. **Week 4**: Surface annual-vs-monthly choice in checkout with a 17% discount on annual. Add a "switch to annual" prompt in settings for monthly customers past month 4.
5. **Backlog (next quarter)**: Multi-year contract option for scale tier. Win-back campaign for non-renewers at T+30. Health-score-based renewal-touch playbook. NPS survey post-renewal (you have churn-risk telemetry; you should have post-renewal sentiment too — the migration `migrations/0012_nps_churn_risk.sql` suggests the table exists; wire the trigger).

None of this is novel. All of it is standard renewal-motion mechanics that AcreOS will need by the time it has 500 paying customers, and is much cheaper to build now at 50 than then at 500.

---

## 8. The expansion-at-renewal opportunity nobody's modeling

One thing I want to call out separately because it doesn't fit cleanly anywhere above. Renewal moments are also *expansion* moments — historically, the highest-converting upsell opportunity in any SaaS company's calendar is the 30-day window before renewal. The customer is already mentally evaluating value. A well-priced expansion offer at that moment converts at 3-5x the rate of a random-Tuesday upsell.

AcreOS has the raw signal for this. `getAllUsageLimits()` at `server/services/usageLimits.ts` (referenced from the cancellation-context endpoint) computes per-tier usage. A customer at 85% of their lead cap, 90% of their property cap, and 100% of their AI-request cap is the textbook case for a tier upgrade — and they're going to feel it most acutely in the renewal week when they're already evaluating.

The work: add an `/api/subscription/expansion-recommendation` endpoint that returns a structured recommendation when (a) the customer is within 30 days of renewal AND (b) any limit is over 80% utilized. Surface it in the renewal email AND on the dashboard. Track recommendation-to-upgrade conversion. This is the second-highest-ROI item after the cancellation save page, and it shares ~70% of the implementation work.

---

## 9. What I'd say to the founder, off-camera

The churn engine tells me someone here cares about retention as a system, not a vibe. The cancellation survey table tells me someone wanted to learn from departures. The dunning ladder tells me someone thought about payment-failure recovery. These are good instincts.

The renewal motion isn't built because nobody has owned it yet. That's normal — at this stage the founder owns it, and the founder is busy. The two-day investment in the cancellation save page returns more revenue than any single feature on the roadmap, and I would do that one this week. The fourteen-day investment in the renewal-stage state machine sets you up for the rest. Everything else is iteration.

I'm available for the next pass. Bring me the cancellation-offers data and the renewal-stage state machine and I can tell you what to build at month six.

— M.H.
