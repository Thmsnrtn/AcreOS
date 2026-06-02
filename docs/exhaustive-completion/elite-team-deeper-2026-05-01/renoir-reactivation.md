# Renoir Delacroix — fourteen months gone, came back on a roadmap email, met a wall

I'm Renoir. Forty-four. Baton Rouge. I run a small land book in south Louisiana and east Texas — pine timber tracts, batture lots along the Atchafalaya, a handful of recreational hunting leases in St. Landry Parish. I was an AcreOS Pro customer from late 2024 to March of 2025, then I cancelled. Three months of revenue between the two of you cost me about $147 and you cost me a few weekends I won't get back trying to make the campaigns module do what I needed. **I'm back because Thomas sent me a roadmap update on April 14th and the marketplace headline made me sit up straight.** I want to reactivate today. This document is what happened when I tried.

---

## 1. The thirty-second version

I clicked the "See what's new" button in the win-back email. It dropped me on the marketing site, not on a returning-customer flow. I logged in. My account was *there* — Clerk knew me, my org was intact, my old Pro subscription was cancelled, and I was downgraded to free per `server/webhookHandlers.ts:313` (`subscriptionTier: 'free'`, `subscriptionStatus: 'cancelled'`). My data was — mostly — there. **But the platform treated me as a brand-new free user.** The OnboardingWizard tried to start me at step 0. The pricing page showed me "Start 14-day free trial" buttons that I'm pretty sure aren't honored for a returning paid customer. I had no "welcome back, here's what changed since you left" surface. I had no record of where my old Pro tier limits sat versus the free-tier squeeze I'd just been put into. And the win-back email's vague "we're flexible for the right customers" never resolved into an actual returning-customer offer I could click. **Reactivation is a category your product does not have.**

---

## 2. What actually exists today, by file

I read enough of the code while clicking around to know what's wired and what isn't:

- `server/jobs/growthAutomation.ts:66` — the win-back engine fires three emails: day 7, day 30, day 60 post-cancel. **I cancelled 14 months ago. Touch 3 fired in May 2025 and then there was silence for a year.** The email I got April 14th was a manual roadmap blast, not the automated win-back sequence. The automated sequence has no touch-4, no quarterly check-in, no annual "hey it's been a year, here's the year in review" send. Day 60 and you're done forever, per `WIN_BACK_TOUCH_3_DAYS: 60`.
- `server/webhookHandlers.ts:341` — when my subscription cancelled, AcreOS emailed me "Your data is preserved — re-subscribe any time" with a link to `/settings`. I clicked it 14 months later. **`/settings` is not a re-subscribe page.** It is the in-app settings panel, which on a free tier shows me the same upgrade tiles a brand-new signup sees. There is no "welcome back" header, no "your last plan was Pro at $49/mo, click here to resume," no pre-filled checkout.
- `server/routes-billing.ts:723` — the `/api/subscription/cancellation-context` endpoint exists for *outgoing* cancellation. There is no symmetric `/api/subscription/reactivation-context` for an incoming returning customer that would tell me: your last plan, your tenure, your grandfathered price (if any), what's been added to your tier since.
- `shared/schema.ts:5503` — `subscriptionEvents.eventType` enum includes `'reactivate'`. The string is in the schema. **No code in `server/` writes that event type.** I grepped. `eventType: 'reactivate'` is never inserted. The schema hints at an intention the implementation never delivered.
- `shared/schema.ts:382, 692, 798, 903` — soft-delete `deletedAt` columns exist on leads, properties, deals, and contacts. **Nothing in the data-restoration story tells me which of my old records survive 14 months of inactivity.** Were any of them purged? `server/jobs/dataRetention.ts` (per `server/index.ts:2279`) runs nightly and references org-level `retentionPolicies` (`shared/schema.ts:62-67`). I do not know what defaults applied to my dormant org. I cannot find out without asking support.
- `client/src/components/onboarding/OnboardingWizard.tsx:160` — the wizard fires when `onboardingStatus.completed === false`. My org's `onboarding*` flags from 2024 are still set to completed (per memory: org-scoped, `organizations.onboarding*`). **Good — I didn't get the wizard.** But I also didn't get a *returning-user* equivalent. The product knows I'm back. It does nothing with that knowledge.
- `client/src/pages/changelog.tsx` — there is a public `/changelog` page that pulls from `CHANGELOG.md` and scrubs internal dev-ese at render time (`cleanChangelogItem` at line 30). It exists. **The reactivation flow does not link to it, filter it to "since your last login," or convert it into a digestible "you missed these 12 features" carousel.** I have to scroll a giant list and cross-reference it against my memory of March 2025. I am not going to do that.
- `client/src/pages/pricing.tsx:13-50` — TIERS are `free / starter $20 / pro $49 / scale $79`, all paid plans include "14-day free trial" CTA. **There is no "Welcome back" pricing tile, no loyalty discount, no returning-customer trial extension, no acknowledgment that I have been a paying customer before.** I am priced as a stranger.
- `server/routes-billing.ts:739` — the cancellation endpoint logs a `cancellationSurvey` row. Schema is at `shared/schema.ts:5520`. **My March 2025 survey response is in your database.** I cancelled because of "missing_features" with a free-text note about the campaigns module. *Use that.* The reactivation flow should pull my old survey, surface it back to me, and tell me which of those gaps have been filled. None of that happens.

The picture: every primitive needed to do reactivation right is in the schema. None of them are wired into a coherent flow. The win-back engine and the cancellation pipeline are two halves of a bridge built from opposite banks that don't meet in the middle.

---

## 3. The hour-by-hour, day-by-day

**Day 0 (April 14, 2026), 9:08 AM.** Email lands in my inbox: "AcreOS roadmap update — what we shipped this quarter." I open it on my phone. The headline mentions the peer-to-peer note marketplace, which is the one feature I would have stayed for in March 2025. I click "See what's new."

**Day 0, 9:09 AM.** Lands me on `acreos.io/changelog` (public). I scroll. **It's a wall.** Versions back to 2024, no filter, no "since you cancelled" view, no anchor link to "what's new since April 2025." I scroll for ninety seconds, lose patience, click "Sign in" in the topbar.

**Day 0, 9:11 AM.** Clerk knows me. SSO works. I'm in. The dashboard loads. **It looks completely different from what I remember** — page-topbar, command palette (⌘K), new sidebar layout. Good redesign. *No tour, no "what changed" tooltip, no first-login-after-long-absence callout.* I'm staring at a UI I've never seen, with my own data in it (?), with no map.

**Day 0, 9:14 AM.** I click `/leads`. There are 47 records. I think there used to be more — I had ~60 active leads when I cancelled. I cannot tell from the UI whether the missing 13 were soft-deleted by retention policy, hard-purged, or never existed. There is no "deleted leads" view. There is no audit log link. I check `/parcels`. 8 properties. I had 11. Same gap.

**Day 0, 9:18 AM.** I open `server/storage.ts:4637` in my head — `purgeOldLeads(orgId, beforeDate)` — and realize my org's retention policy might have purged anything older than N days while the org sat dormant. **Nothing in the UI tells me what N is.** Nothing told me, fourteen months ago, that going to free-tier dormant would set a clock running on my data. The cancellation email said "your data is preserved." That was generous.

**Day 0, 9:22 AM.** I want to upgrade. I go to `/settings`. The settings page on free tier shows me upgrade tiles for Starter / Pro / Scale at marketing-site prices. **Nothing acknowledges I was a Pro customer.** No "Resume Pro at your previous price," no "Welcome back — your last plan was $49/mo, here's a one-click resume." I click "Upgrade to Pro." Stripe Checkout loads. **Empty card field. No saved payment method.** My old card was on file. Something purged the Stripe customer linkage when the subscription cancelled (`webhookHandlers.ts:317`: `stripeSubscriptionId: null` — but I check, the `stripeCustomerId` should still be there). Either the Customer object was deleted or the checkout session isn't reusing it. I have to re-enter my Visa.

**Day 0, 9:26 AM.** I get to the trial question. The button still says "Start 14-day free trial." **Am I eligible?** Stripe usually scopes trial eligibility to "no prior subscription on this customer." I'm not new. I don't know whether clicking will give me a trial, refuse the trial silently, or charge me the full $49 immediately. The UI does not tell me. I do not click. I close the tab.

**Day 0, 11:00 AM.** I email `support@acreos.io`. Subject: "Returning customer — what's my pricing?" Auto-reply: 24 business hours. I have a closing on Wednesday. I move on with my day on a Notion doc I never fully migrated off.

**Day 1, 2:00 PM.** Marcus from support replies. Friendly. Tells me "we don't have a formal returning-customer program yet, but I can offer you 20% off for three months as a goodwill gesture." **He typed that out himself.** It is not a pricing tile. It is not a coupon code I can find on the pricing page. It is a one-off concession negotiated in email. I appreciate Marcus. I do not appreciate that the system requires Marcus.

**Day 2.** I accept Marcus's offer by email. He sends me a Stripe coupon link. I redeem it. I'm Pro again. I log in. **Nothing in the UI says "welcome back."** The dashboard is the same dashboard I saw on Day 0. No briefing. No "here's what's new." No tour of the marketplace, which is the feature I came back for.

**Day 3.** I find the marketplace by clicking sidebar items at random. It is in fact good. It is the reason I'm staying. **I almost gave up before I found it.**

**Day 4.** I write this document so Thomas knows.

---

## 4. What I needed and didn't get

### A reactivation flow that knows who I am

The product has my org row. It has my last subscription tier (`subscriptionTier: 'free'` with `subscriptionStatus: 'cancelled'`, plus my historic Pro from `subscriptionEvents`). It has my last cancellation reason. It has my account age. It has my data on disk. **None of this surfaces during the return click.** What I needed:

- **A `/welcome-back` page** triggered when a user with `subscriptionStatus: 'cancelled'` and a non-zero historic `subscriptionEvents` count signs in. Not the OnboardingWizard. A different surface. Header: "Welcome back, Renoir. You were a Pro customer for three months in 2025." Then three panels:
  - **Your data is intact.** N leads, M properties, K deals — with a "view archived/purged" link if anything was lost to retention.
  - **What's new since you left.** A filtered view of `/changelog` clipped to entries dated after the user's `cancelledAt`, summarized into 5–8 bullets, not 200 raw commits.
  - **Your reactivation offer.** A pricing tile that pre-fills your last plan with one of: (a) loyalty discount (20% off three months for ex-customers — make this *automatic*, not a Marcus-issued coupon), (b) trial extension (your prior 14-day trial doesn't apply, but here's a 7-day free re-look), or (c) prior-price grandfathering if your old plan price changed.
- **Write `eventType: 'reactivate'` to `subscriptionEvents`** when the new subscription is created against an org that has a prior `cancel` event. The schema has the slot. Use it. This unlocks lifetime revenue analysis and lets you measure return-rate as a first-class metric.
- **Reuse the Stripe Customer.** When a user reactivates, the checkout session should pass `customer: org.stripeCustomerId` instead of creating a new one or making me re-enter my card. Saved payment methods should appear. This is a Stripe API parameter, not a feature build.

### Trial eligibility, stated plainly

The pricing page CTA says "Start 14-day free trial" indiscriminately. For a returning customer this is at best ambiguous, at worst a dark pattern. The system knows whether I have a prior `subscriptionEvents` row of type `signup`. The CTA should branch:

- New user → "Start 14-day free trial"
- Returning user, no prior paid period → "Restart your 14-day trial"
- Returning user, prior paid period → "Reactivate Pro — $49/mo, no trial" *or* a winback discount surface.

**Tell me what I'm clicking.** Trial silently disabled at Stripe is the worst of all worlds because I learn about it on the receipt.

### A "what changed since you left" briefing

The changelog page is correct as a public artifact. It is the wrong artifact for a returning customer. I need a **diff view** scoped to my account's absence window. The data exists: `org.subscriptionStatus` flipped to `cancelled` at a known timestamp; `CHANGELOG.md` has dated entries. Generate a server-side digest:

- Pull all changelog entries between `org.cancelledAt` and `now()`.
- Bucket into 4 categories: New (Added), Improved (Changed), Fixed, Pricing/plan changes.
- Cap each bucket at 5 items, prioritized by `customerVisibility` weight (you already have `isCustomerVisible` heuristic in `client/src/pages/changelog.tsx:59`).
- Render as a one-page briefing on `/welcome-back`, with a "see full changelog" expand.

This is one query, one cache, one component. Maybe two days of work. It is the difference between "I came back and got lost" and "I came back and felt seen."

### Data restoration transparency

When I cancelled, the email said *"your data is preserved."* When I came back, I had 47 of 60 leads and 8 of 11 properties. **Both of those things can be true** if retention policies pruned dormant records — but I was never told that's how dormancy works. Specific fixes:

- **At cancellation time**, the cancellation confirmation email should include a precise paragraph: *"Your data will be retained for X months at full fidelity. After X months, soft-deleted records older than Y days will be purged per your data retention policy. Your active records will be preserved indefinitely as long as your org row exists."* Right now the email just says "your data is preserved."
- **At reactivation time**, render a data-integrity report: counts of leads/properties/deals/contacts compared to the snapshot at cancellation (you have this — `subscriptionEvents` createdAt + a lightweight stats snapshot would be cheap). Highlight any deltas. Let me see what was purged and offer a CSV export of the purge log if I want it.
- **A 30-day reactivation grace window** during which any data the retention job *would* have purged is instead held in cold storage and restorable on reactivation. Operationally cheap, emotionally enormous.

### A returning-customer pricing program that lives on the pricing page, not in Marcus's inbox

If the policy is "20% off three months for ex-customers," then put it on `/pricing` behind a "I had an account before" link, gate it on a verified email match, and apply it automatically at checkout. The current state — Marcus typing concessions into Zendesk — has three problems: it doesn't scale, it's invisible to ex-customers who don't email support (i.e., almost all of them), and it relies on every CSR to be as generous as Marcus. Codify it.

Tier the offer:

- **0–6 months since cancel:** automatic 15% off three months. Low risk, modest carrot.
- **6–18 months since cancel:** 20% off three months *plus* a 30-day money-back guarantee waiving the 30-day refund-rate-limit at `routes-billing.ts:801`. The user is making a bigger leap, so de-risk it.
- **18+ months since cancel:** treat as a near-new user. Free 14-day trial restored. Plus a "founder call" CTA — an actual 15 minutes with a human (Atlas, in customer-facing language; you and I know it's the founder/Sophie pipeline internally per the persona-architecture memo).

Each tier should be a row in a small `reactivation_offers` table or a constant module, not an in-line negotiation.

### Win-back cadence beyond day 60

`WIN_BACK_TOUCH_3_DAYS: 60` and then silence. Nine months later you ship something I would have killed to have, and I never hear about it because the automation gave up. Add:

- **Quarterly product update emails** to ex-customers, with an unsubscribe (and an actual unsubscribe — `routes-misc.ts:343` shows you have STOP/START handling for SMS, do the equivalent for email cleanly).
- **Annual "year in review" digest** to ex-customers: "It's been a year since you left AcreOS. Here are the 8 things we shipped that you might care about."
- **Trigger-based winback**: when a feature ships that maps to a cancelled customer's *cancellation reason* (their `cancellationSurveys.feedback` text), send them a targeted "you asked for this — we built it" email. This requires light tagging of changelog entries against cancellation themes; do it.

The roadmap email I got on April 14th was a manual blast Thomas sent. **Make it automated and personalized.** I responded to it. So will others.

### Founder briefing on first login

The dashboard I saw on Day 0 was a redesign I had never seen. **A returning user needs a tour, but not the new-user tour.** The new-user tour assumes you don't know what a lead is. The returning-user tour assumes you do, and points at what *moved.* Three tooltips:

1. "The command palette is new — press ⌘K to jump anywhere."
2. "The sidebar reorganized — Marketplace is here, Atlas is here."
3. "The page-topbar is new — your bell, theme toggle, and breadcrumb live up here."

Skip-able. One-shot. Stored in `users.tourFlags.returnTour202604 = true`. Done in an afternoon.

---

## 5. Severity, ranked

1. **No `/welcome-back` surface at all** — the highest-leverage missing screen. A returning user is more valuable and more fragile than a new one and gets less treatment than either. Build this first.
2. **Reactivation event not logged** — the schema has `eventType: 'reactivate'`, no code writes it. This is the prerequisite to measuring everything else. Two-line fix in the subscription-resume code path.
3. **Trial CTA is ambiguous for returning users** — borderline dark-pattern. Branch the CTA copy on prior subscription history.
4. **Win-back stops at day 60** — the day-90 customer who ships a feature you wanted will never hear about it. Add quarterly + annual + trigger-based touches.
5. **Pricing concessions live in support inbox** — not scalable, invisible. Move to `/pricing`, codify the tiers.
6. **No "what's new since you left" digest** — `/changelog` is wrong tool for the job. Build a diff view scoped to absence window.
7. **Data restoration is opaque** — explain retention at cancel-time, show integrity report at return-time, add a 30-day grace window for cold-stored records.
8. **Stripe customer not reused on reactivation** — saved card lost, friction at checkout. One-line API parameter fix.

---

## 6. The thing I want Thomas to know

I came back. That fact alone is more information than 95% of your churned customers ever give you. **Treat it like the gift it is.** A returning customer has already made the hardest decision (to come back) and is asking you only to make the second decision (to stay) easy. Right now you make it hard — not maliciously, just by neglect. The reactivation path is built from leftover pieces of the cancellation path inverted, and it shows.

The five hours between Marcus's coupon and me finding the marketplace were the most precarious five hours of my entire AcreOS lifecycle. If I had bounced in that window, you would have logged it as "winback failed" and never known you'd had me. Build the welcome-back surface, log the reactivate event, branch the trial CTA, ship the absence-window digest, and codify the offer tiers. That's a sprint. Maybe two. The lifetime value math on returning customers is famously good — but only if they reach the second month, and right now your funnel between "click win-back email" and "second-month renewal" is held together by Marcus and luck.

I'm staying because the marketplace is good and because of one CSR's improvisation. **The next Renoir is not guaranteed either.**

— Renoir Delacroix, Baton Rouge
