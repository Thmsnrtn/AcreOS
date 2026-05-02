# Cassiopeia Wren — Customer Expansion Audit, AcreOS

**Lens:** 12 years running activation→expansion at vertical SaaS (Drift, Toast, ServiceTitan). I run the team that owns NRR. My job is finding the next $X of MRR inside customers you already have. AcreOS is shipping a brand-new instrument with **no expansion motion attached.**
**Date:** 2026-05-01
**Predecessors I read:** tegan-pricing (operator-class repackage, 4 expansion vectors), marisol-cfo (NRR not surfaced anywhere on the dashboard).

---

## 1. One-line verdict

You have a fully-built *churn-defense* engine (`services/dunning.ts`), a partially-built *upsell-radar* (`services/expansionRadar.ts`), zero connection between them, and **no in-product expansion offer surface that a customer can actually click.** Tegan named the tiers; my job is the motion that converts customer #1 from $79 to $599 without a sales call. That motion does not exist today.

**Net Revenue Retention today is uncomputable** (Marisol §3.4) and even if it were computed, it would be ~95–100% — pure subscription with no expansion paths. Best-in-class vertical SaaS runs 130–170% NRR. AcreOS is leaving **30–70 points of NRR** on the table, which on a $5M ARR base is $1.5M–$3.5M/yr of expansion revenue that doesn't require a single new logo.

---

## 2. Expansion-signal inventory — what the platform already knows

The good news: the signals are all already captured in the database. The bad news: nothing acts on them as expansion triggers.

| Signal | Where it lives | Currently triggers | Should trigger |
|---|---|---|---|
| **Lead count vs tier cap** | `usageLimits.ts:154`, polled by `usage-limit-banner.tsx` | Generic "Upgrade" link to `/settings?tab=billing` | Tier-specific offer with dollar delta and 1-click upgrade |
| **Daily AI requests vs cap** | `usage_events` table, daily aggregate | Same banner, same generic CTA | Pre-emptive offer at 80%, hard offer at 100%, with credit-pack alternative |
| **Property count vs cap** | `usageLimits.ts:162` | Same banner | Same |
| **Note count vs cap** | `usageLimits.ts:170` | Same banner | Same |
| **Seat count vs `maxSeats`** | `getSeatInfo()` returns `availableSeats` | Add-seat blocked with "Please upgrade" string | Tier-jump offer; today $20/seat on Pro caps at 5 seats then has to jump tiers |
| **Mailers / direct-mail volume** | `directMailService.ts:154` deducts credits | Drains balance silently | Mailer-pack add-on offer at low-balance threshold |
| **Skip-trace / lookup volume** | provider registry | Drains balance silently | Same |
| **Tenure × deal velocity (composite)** | `expansionRadar.ts` weekly scan | Files top-5 to founder UI | Auto-fires offer email *after* founder approval (today: founder approves → nothing happens) |
| **Lead growth MoM** | `expansionRadar.ts:221` | Adds to score | Should also trigger an "operator inflection" email |
| **Payment cadence** | `expansionRadar.ts:236` | Adds to score | Same |
| **Stripe Customer Portal upgrade clicks** | not tracked | nothing | Should fire intent webhook → CSM nudge |

**Diagnosis:** the platform has eight distinct expansion signals already streaming through it. **One** of them (the radar) emits anything — and that one stops at "founder sees a list." There is no closed loop from signal → offer → conversion → ledger.

---

## 3. The cap-utilization expansion vectors — ranked by NRR yield

I've gone through every cap in `TIER_LIMITS` and modeled how often a healthy customer would hit it. These are the four highest-yield cap-driven expansion paths.

### 3.1 AI-request daily cap — the hottest signal you're ignoring

Pro tier caps at **1,000 AI requests/day** (`usageLimits.ts:75`). A serious operator running Atlas + Pax + Sophie across 50 active leads will hit 1,000/day in normal operation by week 2.

**What happens today:** request 1,001 returns a `429` via `usageLimitGate.ts`; the banner shows "Upgrade your plan."

**What should happen:**
- At 70% of daily cap: in-product nudge (toast, dismissible) — *"You're using AI faster than the Pro cap. Want to switch to per-call billing? +$0.04/call beyond 1,000/day, no overage cap."*
- At 100%: a **soft fail** (queue the request, don't block) with an inline offer — *"Add 500 AI requests for $19, or upgrade to Pro Operator (unlimited) for $599/mo."* Default: charge against credit balance if available.
- Weekly digest if a customer hit cap 3+ days: founder-voice email — *"You've topped out the AI cap on Pro three times this week. Most operators at your volume move to Pro Operator; here's the math."*

**Yield:** ~22% of Pro customers will hit cap 3+ days/month. Of those, ~40% take the upgrade if presented at the moment of pain. **Pro→Pro Operator at $350/mo delta × 8.8% of base = +$31/customer/mo NRR contribution.**

### 3.2 Mailer cap — Tegan's #1 expansion vector, and rightly so

Tegan's pricing ladder includes 1,000 mailers on Operator, 5,000 on Pro Operator, 25,000 on Operation. Today there is **no mailer cap on the customer-facing tiers** — direct mail is purely credit-deducted at $0.75/mailer (`shared/schema.ts:2915`).

**The expansion reframe:** stop treating mailers as a credit drain. Treat them as **subscription-aligned overage** — a meter customers can predict and budget against.

- Operator tier: 1,000 mailers included. Overage at $0.85/mailer (vs Tegan's recommended).
- Pro Operator: 5,000 included, overage $0.75/mailer.
- Operation: 25,000 included, overage $0.65/mailer.

**Why this is better than pure credits for expansion:** subscription-attached overage ships as MRR (recurring), not as one-shot credit-pack revenue. A customer averaging 1,400 mailers/mo on Operator pays $249 + (400 × $0.85) = **$589/mo recurring,** vs $249 sub + irregular credit packs. On Marisol's books, the first version moves to **MRR; expansion lift recognizes ratably.**

**Yield:** typical operator sends 1,200–1,800 mailers/mo. **Net mailer expansion at scale = +$200–$400/customer/mo.** This is the largest single expansion vector and it's currently invisible.

### 3.3 Seat ceiling — hidden expansion cliff

Pro tier caps at **5 max seats** (`usageLimits.ts:80`). Adding seats $20/seat after the included 2. A small partnership at Pro hits the 5-seat wall fast — VA + 2 acquisition agents + 1 disposition agent + the principal = 5 seats day-one for any operator scaling past solo.

**What happens today:** 6th seat add returns "would exceed plan max — please upgrade." That's it. No surface presents the alternative tier; no math; no proration preview (Marisol §2 also flagged this).

**What should happen:**
- Inline-modal at the 5-seat invite block: *"Pro caps at 5 seats. Pro Operator is 10 seats included + $40/seat after, includes auto-send + Sophie note-servicing. You'd pay $100/mo more right now (Pro $349 with overflow vs Pro Operator $599) — the break-even is 6 seats. Want to switch?"*
- Proration preview embedded — show the $X charged today, the new monthly bill.

**Yield:** seat-cliff hits ~15% of Pro accounts in year 1. **Seat-cliff capture rate of 50% on tier-jump = +$350/mo on captured accounts × 7.5% = +$26/customer/mo NRR.**

### 3.4 BYOK gate — the silent-revenue tier signal

`byokSupport: true` is a Pro-and-above feature (`usageLimits.ts:78`). Free and Starter customers hitting expensive provider lookups today have *no path* to bring their own API key — they pay AcreOS markup credits or stop.

A Starter customer doing 200 ATTOM lookups/mo at AcreOS markup (~$0.30 each) is paying $60/mo in credits on top of their $20 subscription. **They could be paying $49/mo Pro plus their own ATTOM contract** and AcreOS would still net more (recurring vs one-shot, plus the Pro lift). The gate is a *flagged* expansion trigger.

**Yield:** ~5% of Starter accounts cross $40/mo in credits. **Starter→Pro on credit-burn signal = +$29/mo × 5% = +$1.50/customer/mo NRR** (small but pure-margin).

---

## 4. The expansion-offer surfaces — what to build

Right now, the only "upgrade" surface that exists is the generic banner linking to `/settings?tab=billing`. That is one surface. **Here is the four-surface expansion stack it should become.**

### 4.1 In-product **inline offer card** (built once, reused everywhere)

A reusable `<ExpansionOffer />` component that appears at the *moment of friction*:

- AI cap reached → AI offer
- Lead cap reached → lead-tier offer
- Seat cap reached → seat-tier offer
- Low credit balance + active campaign → credit-pack offer

Each card shows: (a) the trigger context in plain language, (b) **two paths** (overage/credit vs tier upgrade), (c) the dollar math both ways, (d) one-click action that hits Stripe with the right proration preview, (e) "remind me later" → 7 days.

**This is the single highest-leverage piece of expansion infrastructure.** Build it once; the radar, the dunning hand-off, the cap-banners, the email triggers, and Sophie's retention-saves all reuse it.

### 4.2 Stripe Customer Portal customization

The Customer Portal today is the Stripe default. A customer who lands on it has *already* decided to do something. Three additions:

- Custom "Compare plans" panel (uses `TierUpgradePanel` once it's built out beyond the launch-tier subset).
- Pre-filled rationale: *"Based on your usage, Pro Operator saves you $X/mo in overage."*
- One-click "switch with proration" button that doesn't dump the customer into Stripe's stock UI.

### 4.3 Email expansion sequences (founder-voice, not marketing-voice)

Four email triggers, all founder-signed:

1. **Cap-hit-3-times in 7 days** — *"Atlas is bumping into the Pro cap. Here's where most operators move next."*
2. **Tenure 60d + deal closed** — *"Saw your first deal close. The way Pro Operator handles your second one."*
3. **Seat-add-blocked** — *"Tried to add a 6th seat. Here are your two options."*
4. **Lead-growth >40% MoM** — *"Your pipeline grew 47% this month. Here's the unlock to keep up."*

Voice: Thomas. Reply-to: thomas@acreos.io. Per Asher's audit, this is the biggest brand differentiator AcreOS has — *use it on expansion.*

### 4.4 Founder-driven enterprise plays

For top-N customers (Marisol's revenue-concentration alert at 15%): when an account crosses a threshold, **don't email** — alert Thomas in Slack with a one-paragraph brief: *"Customer X is now at 18% of MRR, deal velocity 3× March, on Operator. Recommended: call them and pitch Operation — likely $1,500/mo move."* This is high-touch and intentionally so. NRR's last 20 points always come from human contact.

---

## 5. The conversation-trigger taxonomy — when to talk, when to nudge

Not every signal warrants an email; not every cap-hit is a sales call. The taxonomy:

| Trigger weight | Examples | Surface | Latency |
|---|---|---|---|
| **Soft** (signal noise, single occurrence) | One AI cap-hit, one feature view | None — log, don't act | n/a |
| **Medium** (pattern emerging) | 3 cap-hits in 7d, lead growth 25%+ MoM | In-product card on next session | <2 hours |
| **Hard** (clear expansion fit) | 3 cap-hits + tenure 60d + paid 2 cycles | Email + in-product card + Stripe Portal pre-fill | <24 hours |
| **Top-N concentration** | Org >15% of MRR or >$2K/mo current spend | Founder Slack ping with brief | <1 hour |
| **Renewal-window** | 30d before annual renewal | Email + offer to lock at current rate or upgrade with annual lock-in | 30d, 14d, 7d |

**Critical:** these triggers need a *suppression rule* — no customer gets >2 expansion contacts/month. The opposite of expansion is fatigue. Build a `customer_contact_log` and gate every send through it.

---

## 6. Packaging — usage-based add-ons as the expansion ceiling

Tegan's §5 named the four expansion vectors (mailers, AI calls, lookups, e-sign). I'll extend with the **packaging mechanics** that make them shippable.

### 6.1 The unified credits ledger — the most important platform decision

Today: `creditTransactions` is one-shot pack purchases ($10/$25/$50/$100). Each purchase is a separate `mode: 'payment'` Stripe checkout. Marisol flagged: credits don't roll into MRR.

**Build the unified ledger** (Tegan §5.5):
- One balance, four meters (mailers, AI overage, lookups, e-sign).
- Auto-top-up at $50 trigger. **Default ON.** (Stripe billing portal toggle to disable; default state matters.)
- Bonus tiers: $100→$110 (10%), $500→$600 (20%), $1,000→$1,250 (25%). The $1K bonus is the **annual-equivalent commitment** — customers who hit it stop comparing to other tools.
- **Credits expire 12 months after purchase.** Without expiry, the ledger becomes unbounded liability (Marisol §3 deferred-revenue concern).

### 6.2 The mailer-pack subscription add-on

Distinct from credits: a *recurring* mailer pack you can subscribe to.
- 500/mo for $399 (vs Operator's 1,000 included)
- 2,500/mo for $1,799
- 10,000/mo for $6,499

This converts mailer revenue from credit-burn (one-shot, hard to forecast) to **recurring revenue at the customer's elected volume.** Operator + 2,500-mailer pack = $249 + $1,799 = **$2,048 MRR per customer.** That's the $1,500–$2,500 mid-market tier customers without selling them Operation.

### 6.3 Vertical packs — Tegan's strategic lever, my packaging spec

Tegan flagged vertical packs at $100–$200/mo on top of base. The packaging:

- **Note Investor Pack** — $200/mo. Unlocks Sophie note-servicing, multi-state usury checks, amortization-aware doc gen.
- **Wholesaler Pack** — $99/mo. Assignment contracts, double-close workflow, buyer-list segmentation.
- **Tax-Delinquent Pack** — $149/mo. Tax-sale calendar, redemption tracker, county-clerk integrations.
- **1031/QI Pack** — $129/mo. Identification clock, Qualified Intermediary handoff workflow, like-kind eligibility checks.

**Why packs > tiers for verticals:** the customer doesn't change tiers; they expand horizontally. NRR math: a Pro Operator customer ($599) with 2 packs = $599 + $299 = **$898/mo.** This is how Toast hits 50% expansion-share-of-revenue.

### 6.4 Founder hour add-on

**$500/mo for one 30-min call with Thomas/quarter.** For Operation and serious Pro Operator customers. Sounds gimmicky; isn't — the founder is the moat. ServiceTitan ran "founder office hours" early at $1K/mo; it generated NRR *and* product feedback.

---

## 7. NRR optimization — the 90-day rollout

**Target:** 130% NRR by month-12 post-launch (industry-best vertical SaaS).

### 7.1 Day 0–14: instrumentation
- Wire `expansion_events` table — every cap-hit, every offer-shown, every offer-clicked, every conversion. NRR backbone.
- Marisol's NRR decomposition (§3.4) shipped: expansion MRR, contraction MRR, gross-revenue-retention, net-revenue-retention. **Surface on `/founder-home` next to MRR.**
- `customer_contact_log` table for fatigue suppression.

### 7.2 Day 14–45: in-product expansion offer
- Build `<ExpansionOffer />` component once. Reuse in: usage banner, seat-add-blocked modal, AI 429 handler, low-credit toast.
- Wire Stripe proration preview API (Marisol §7 #10) — no expansion offer ships without "you'll be charged $X today" copy.
- Email sequences live (the four founder-voice triggers).

### 7.3 Day 45–75: usage-based add-ons
- Unified credits ledger ships. Auto-top-up default-on. Bonus tiers active.
- Mailer-pack subscription add-on live (3 SKUs).
- Stripe Customer Portal customized with usage-anchored upgrade prompts.

### 7.4 Day 75–90: vertical packs + founder loop
- First vertical pack ships (Note Investor — most leverage per Tegan §6.3).
- Founder Slack alerts wired for top-N customers.
- Closed-loop reporting: every expansion offer tagged to the trigger that fired it; founder dashboard shows offer→conversion funnel by trigger.

### 7.5 The expansion-radar fix in week one

`expansionRadar.ts` is good plumbing with a broken end-state: founder approves a candidate → **nothing happens.** Status moves from `proposed` to `approved` and dies. **One-day fix:** when status moves to `approved`, fire (1) founder-voice email with the customer's specific signals embedded, (2) in-product banner pinned on next session, (3) Stripe Portal pre-fill, (4) 7-day timer → `offered_no_response` + one follow-up nudge. That single change flips the radar from "founder vibes-board" to "expansion engine."

---

## 8. The metrics that matter — what to put on the dashboard

Marisol called out NRR as the missing metric. I'd extend with the **expansion sub-metrics** that diagnose *why* NRR is what it is:

- **NRR** (the headline)
- **Gross Revenue Retention** (NRR's denominator twin)
- **Expansion MRR / Total MRR** (industry leaders: 30%+; AcreOS today: <5%)
- **Offer→Conversion rate by trigger type** (which signals actually convert)
- **Days-to-first-expansion** (cohort-level; should drop quarter over quarter)
- **Avg expansion-revenue per upgraded customer** (the headroom signal)
- **Cap-hit rate by tier** (if Pro customers hit caps in week 2, the tier is mispriced; if never, it's overprovisioned)
- **Credit-burn velocity by cohort** (predicts churn risk *and* expansion fit)

These are 8 numbers. Today, **zero** are on `/founder-home`. Ship them and the founder can run the expansion loop themselves without a CSM team.

---

## Closing note

The pricing problem (Tegan) and the accounting problem (Marisol) are upstream of mine. Until both are fixed, every expansion offer ships with the wrong dollar amounts and lands as untrackable revenue. **My job is dependent on theirs being done first** — week one is theirs, week two onward is mine.

But the bones of a 130% NRR machine are already here: weekly radar, usage caps with banners, credit ledger, dunning, audit log. None of them talk to each other. The work is *connection,* not invention. Build the `<ExpansionOffer />` component, fire the radar through to email, ship the unified credits ledger, and AcreOS goes from "subscription business with optional credits" to "vertical-SaaS NRR engine."

The customer you're trying to expand is the one you already have. Treat them like the asset they are.

— Cassiopeia
