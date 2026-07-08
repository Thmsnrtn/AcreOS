# Tegan Osborne — Pricing Audit, AcreOS

**Lens:** 8 years pricing B2B SaaS, ex-ProfitWell. I assume every SaaS has set pricing once at YC and forgotten about it. AcreOS is worse than that — it has set pricing **seven times** and forgotten which one is real.
**Date:** 2026-05-01
**Predecessors I read:** asher-ceo (the 25× landing/pricing-page split), marisol-cfo (six hardcoded tier tables in server code).

---

## 1. One-line verdict

You are leaving **3–5× revenue on the table** with the public `/pricing` page, **2× on the landing page**, and you cannot tell which because the codebase ships **four different plan shapes** with **seven non-matching price tables** — pick the operator-class structure, ship it as one source of truth, and price the top tier at $499–$999, not $79.

---

## 2. Current pricing diagnosis

Marisol counted six conflicting server tables. I went one level deeper and found a **seventh** — and worse, a **fourth completely different plan shape** living in `shared/schema.ts`. Here is the consolidated map:

| Source | Plan shape | Top tier |
|---|---|---|
| `landing/Pricing.tsx` | Solo $199 / Operator $499 / Operation $1,290 (3 tiers) | $1,290 |
| `pages/pricing.tsx` (canonical customer surface) | Free / Starter $20 / Pro $49 / Scale $79 (4 tiers) | $79 |
| `shared/schema.ts:2937` `SUBSCRIPTION_TIERS` | Free / **Sprout $29** / Starter $59 / Pro $179 / Scale $449 (5 tiers) | $449 |
| `server/agents/revenue.ts:14` `TIER_PRICES` | starter $20 / pro $49 / scale $399 / enterprise $799 | $799 |
| `server/services/expansionRadar.ts:59` | starter $20 / pro $49 / scale $79 / enterprise $199 | $199 |
| `server/routes.ts:1443` (feeds /founder-home) | starter $29 / pro $79 / scale $199 | $199 |
| `server/routes-admin.ts:3293` | starter $49 / pro $149 / scale $399 / enterprise $799 | $799 |
| `server/storage.ts:3452` | starter $49 / pro $99 / scale $199 | $199 |
| `server/services/autonomousSalesPipeline.ts:309` | starter $99 / professional $299 / enterprise $999 | $999 |

That is **nine surfaces, four shapes, top-tier prices ranging $79 → $1,290 (16×).** This isn't a discrepancy. This is an organization that ran four pricing experiments simultaneously and shipped all four.

**The four shapes implicit in the code:**

1. **Prosumer SaaS** ($20–$79) — `pages/pricing.tsx`. Looks like Notion or Airtable Personal pricing.
2. **Operator SaaS** ($199–$1,290) — `landing/Pricing.tsx`. Looks like HubSpot Sales Pro or Close.com.
3. **Mid-market SaaS** ($29–$449) — `shared/schema.ts`. Looks like an internal proposal nobody shipped.
4. **Enterprise mid-market** ($99–$999) — `autonomousSalesPipeline.ts`. Looks like a sales-led model.

**Why the prosumer shape is wrong for AcreOS — three falsifiable arguments:**

1. **Customer profile.** Solo-to-small-team Land Investors closing $20K–$80K parcel deals (with pro operators at $400K+). At $79/mo a single $40K deal pays for **42 years** of Scale. That ratio is not a SaaS customer; it's a customer paying you a tip. Real estate investing software historically prices at 0.5%–2% of GMV/year and AcreOS is at ~0.02%.
2. **Stack comparison.** A Land Investor today runs REI Pro ($199–$299/mo) + Pebble/PropStream ($99/mo) + Lob postcards (variable) + a CRM (HubSpot Starter $50/mo) + skip-tracing credits ($0.10–$0.30 each). Their existing monthly software stack is **$400–$700 before mailers.** Pricing AcreOS at $79 isn't competitive — it's *suspicious*. It signals "missing features" to the exact buyer the landing page targets.
3. **Founder voice contradiction.** The landing copy says *"I priced it the way I'd want it priced as a customer."* Thomas closed 200 deals. A 200-deal operator's actual willingness-to-pay for honest software with three named agents is not $79. The $79 price tag actively undercuts the brand promise.

**The 25× discrepancy is not a website bug. It is a positioning identity crisis.**

---

## 3. Recommended tier structure

Five tiers, four billable. I am recommending the **operator-class** shape (closer to the landing page) with one downward modification (a free trial instead of a free tier — explained below).

```
Free trial (14 days, full Pro access, no card)
   ↓
Solo            $79 / mo    1 user        1 county      AI suggest mode
Operator        $249 / mo   3 users       5 counties    AI review-then-send
Pro Operator    $599 / mo   10 users      Unlimited     AI auto-send + Sophie
Operation       $1,490 / mo Unlimited     Unlimited     Custom + dedicated success
```

### Tier-by-tier rationale

**Free trial, not free tier.**
The current `/pricing` Free tier (10 leads / 3 properties / 25 AI requests/day) is a vestigial freemium move. It serves nobody:
- A real Land Investor will hit the limit on day one and bounce frustrated.
- A tire-kicker downloads it, never converts, and shows up forever as "active org" inflating dashboard counts.
- Marisol noted that comp/free accounts have no shadow-MRR tracking, so they distort every metric.

**Replace Free with a 14-day full-access trial.** No card required for the trial — that's already the model on paid tiers. This kills the freemium funnel (which doesn't fit a $50K-AOV customer anyway) and steers everyone to Pro from day one.

**Solo — $79/mo (or $69 annual)**
The on-ramp. One user. One county in the buy-box. Atlas + Pax in *suggest* mode (no auto-send). All the founder's named work shows up; just rate-limited. This tier is for the operator doing 1–3 deals/year while still operating mostly out of a spreadsheet. **The price ceiling is the existing landing's $199 Solo tier; I am recommending $79 because the prosumer surface has set anchor expectations and a bridge tier is needed during migration (see §7).** Within 12 months this should drift up to $99–$129.

**Operator — $249/mo (or $208 annual)**
The volume tier. 3 users. 5 counties. Atlas/Pax in *review-then-send.* Direct-mail integration on (Lob), 1,000 mailers/mo included. Sophie's note-servicing read-only. **This is the price that matches the customer.** Land Investors already pay $400/mo across REI Pro + Pebble + Lob + skip-tracing; AcreOS at $249 *replaces* that stack and lands ~40% cheaper net of credit add-ons. It is the rational buy.

**Pro Operator — $599/mo (or $499 annual)**
The full-platform tier. 10 users. Unlimited counties. *Auto-send* unlocked per-agent (with the autonomy slider Asher flagged in §7.2 of his audit). Sophie note-servicing full. 5,000 mailers included. SMS/voice outreach. BYOK data providers. Dedicated CSM-lite (founder-team email in 24h). **The price test:** at $599, a single sub-$50K parcel flip pays for ~7 years of subscription. That's still a >7,000% ROI and well below industry comparables. HubSpot Sales Pro is $500/seat at the equivalent feature density.

**Operation — $1,490/mo (replaces today's $1,290 + custom)**
Multi-state operations, fund-style deal flow. Unlimited users. Custom integrations. White-glove migration. Quarterly portfolio review. Dedicated success partner (real human, named). 25,000 mailers. **Self-serve sign-up disabled** — this tier requires a sales call (see §6).

### Why no per-seat at the lower tiers
Per-seat pricing punishes the small partnerships AcreOS is supposed to serve ("dad-and-son flipping ten parcels a year"). Charge **flat with a seat ceiling**, then meter overage at $40/seat (Pro) or negotiate at Operation. This is how Notion and Linear do it for the same buyer profile and it removes a known conversion blocker. The current `pages/pricing.tsx` already has the right instinct (Pro = "2 seats included, $20/seat after") — keep the *shape*, raise the floor.

### Why I dropped Scale ($79) and Free
- **Scale at $79 is pricing fiction.** "Growing teams" do not grow at $79/mo. The string of `team member seats: 10` at the $79 tier means the unit economics are *negative* the moment the second seat is invited. Marisol's COGS-per-customer note (§3.1 of her audit) confirms there is no per-customer cost rollup; you are likely losing money on every Scale customer pulling 10K+ AI requests/day.
- **Free is a freemium fantasy.** AcreOS is a high-touch B2B vertical SaaS for a buyer with $40K AOV. Freemium works for horizontal tools (Slack, Notion). It does not work for $50K-deal verticals. Replace with a 14-day trial.

---

## 4. Price-point recommendations — the value-capture math

The framework: at each tier, compute (a) closest competitive stack, (b) implied % of GMV, (c) my recommended price, (d) the multiple of *current* price.

| Tier | Today | Closest competitor stack | Customer GMV/yr | Recommended | Multiple |
|---|---|---|---|---|---|
| Solo | $20–$49 | REI Pro ($199) + skip-tracing ($50) ≈ $249 | $30K–$120K | **$79** | 1.6–4× |
| Operator | $79 | REI Pro+ ($299) + Pebble ($99) + Lob ($150) + HubSpot Starter ($50) ≈ $598 | $200K–$600K | **$249** | 3.2× |
| Pro Operator | (none) | $1,000+/mo equivalent (Salesforce + DealMachine + custom) | $500K–$2M | **$599** | new tier |
| Operation | "Contact us" | Bespoke ($2K–$5K/mo) | $2M+ | **$1,490** | (matches landing) |

### Three willingness-to-pay anchors I trust

1. **REI Pro + Pebble = ~$400/mo for software that does ~30% of what AcreOS does.** AcreOS at $79 is not 4× cheaper-and-better; it is *5× cheaper despite being more complete.* That gap is a value-capture failure, not a generous founder.
2. **PropStream Pro is $99/mo for a stripped-down version of just the data layer.** AcreOS bundles data + CRM + automation + AI agents + payments. Pricing the bundle below the data-only competitor is category malpractice.
3. **Close.com (the closest "operator-class CRM" comp) is $99–$329/seat/mo.** AcreOS Pro at $49 *flat* is ~10% of Close per-seat at the same seat count.

### What about price elasticity and conversion?
The fear with raising prices 3–5× is that conversion craters. Two reasons it won't here:
- **Vertical SaaS price elasticity is much lower than horizontal.** A Land Investor cannot substitute "free Notion template" for AcreOS without losing the data integrations, the agents, and the payments stack. Switching cost is high; price sensitivity is low.
- **The Van Westendorp band for B2B vertical at this complexity is $200–$800/mo.** $79 is *below the floor of acceptability* for half the segment — they read it as "this can't be real software." Raising to $249 actually increases conversion in the cohort that distrusts cheap tools.

The conversion model for the migration should assume **conversion drops 30%, ARPU rises 4×, net MRR rises 2.8×.** That's the typical ProfitWell repricing outcome and AcreOS has more headroom than most.

---

## 5. Expansion revenue — the single biggest miss

Subscription is the floor. Usage-based add-ons are the ceiling. AcreOS has half-built this and shipped none of it as expansion revenue.

**What exists today (good bones, missing the meter):**
- `creditTransactions` table with $10/$25/$50/$100 packs. **Severable from subscription** — Marisol noted credits don't roll into MRR, just one-shot revenue.
- `usageMeteringService` exists. Auto top-up exists. The plumbing is here.

**What's missing — the four expansion vectors that should be built next quarter:**

### 5.1 Direct mail (mailers)
Already metered in the landing tiers (500 / 2,500 / 10,000). **Add overage at $0.85/mailer.** Cost-of-revenue (Lob bulk) is ~$0.65; gross margin per mailer is ~$0.20. Operator tier with 1,000 included → average customer sends 1,400 → $340 expansion/mo on top of the $249 sub. **Expansion >> base for this customer.**

### 5.2 AI calls (Atlas/Pax/Sophie)
The landing copy already brags about confidence percentages and provenance. Meter the API calls underneath. Each tier gets an included monthly bundle; overage is **$0.02–$0.10 per call** depending on agent. Critically: this aligns COGS to revenue (Marisol §3.1) and gives the founder a real gross-margin lever.

### 5.3 Skip-tracing & data lookups
You already have the provider registry (`server/services/providers/`) with priority ordering and cost tracking. Wire it: every premium-provider call deducts credits at a 30% markup. Today this is invisible to the customer; surface it.

### 5.4 E-sign volume (native e-sign, per memory)
Per the project memory, AcreOS ships its own signing stack — don't propose DocuSign. Price native e-sign as **$2/envelope after 10/mo included on Operator, 50/mo on Pro Operator.** DocuSign charges $25/envelope at low volume. AcreOS can be 10× cheaper while gross-margin >90%.

### 5.5 The unified credits ledger (build this once, sell it forever)
Today: $10/$25/$50/$100 packs.
**Build:** a unified credits ledger where mailers, AI, lookups, and e-sign all draw from one balance. Auto-top-up at $50 trigger. Discount tiers ($100 = $110 of credits, $500 = $600 of credits, $1,000 = $1,250 of credits — 25% bonus on the $1K commit ties customers to platform).

**Expansion-revenue target:** 30% of MRR by month-12 post-launch. Industry-leading vertical SaaS hits 50–70% (Toast at 60%, ServiceTitan at 50%). AcreOS has the rails; flip them on.

---

## 6. Enterprise / Operation tier — full spec

Today: a `mailto:support@acreos.io`. This is leaving real money on the table. Fund-style Land Investors and multi-state operators are ready to buy *today;* there is no surface for them to do so.

### 6.1 Replace the mailto with a typed contact form
- Form captures: org size, deal volume/yr, current stack, target launch date, # of users.
- Routes to a real CRM record (HubSpot, Attio, even Linear). Notify Thomas in Slack.
- Auto-reply within 60 seconds: *"Thomas saw this. He'll reach out by [tomorrow morning]."* (founder voice, per Asher's guidance).

### 6.2 The Operation tier spec — what's actually included

- **Pricing floor:** $1,490/mo (matching landing). Real customers will land at $2,500–$5,000/mo.
- **Annual commit only.** No monthly Operation. Locks LTV.
- **Onboarding:** 2-week white-glove migration. Real human. Named contact.
- **Custom integrations:** typed allowlist — Salesforce, HubSpot, REI/CRM-of-record, custom data warehouses. Each integration scoped at $5K one-time.
- **SLA:** 99.9% uptime committed. 4-hour response on P1. Quarterly business review with Thomas.
- **Compliance:** SOC 2 Type II commitment (Asher flagged this is missing — Operation customers will require it; price the audit recovery into this tier).
- **Multi-org / fund structure:** native multi-tenant where one billing account can hold N investing-entity LLCs. This *unlocks* the fund customer; today it's hacked together with manual orgs.

### 6.3 The Note Investor / vertical question

Per the brief: should Note Investors price differently? **Yes — and this is a strategic lever, not a pricing decision.**

- Note investing has **higher AOV** ($100K+ avg note balance) and **lower velocity** (one note ≠ 10 mailers).
- It also has **regulatory complexity** (state-by-state usury law, SAFE Act, Reg AB).
- **Recommendation:** ship Note Investor as a *vertical pack* on top of the Pro Operator tier — $200/mo add-on that unlocks Sophie's note-servicing in full, multi-state compliance reporting, and amortization-aware document gen.

This is the same play Toast runs with restaurant verticals — base platform + per-vertical packs. It also future-proofs the four-vertical roadmap (Land / Notes / Wholesalers / Tax-Delinquent) without forcing four separate pricing pages.

**Wholesalers and Tax-Delinquent are the same play:** vertical packs at $100–$200/mo on top of base, each unlocking the workflows specific to that motion (assignment contracts for wholesalers, tax-sale calendar + redemption tracking for tax-delinquent). Don't build four pricing pages. Build one and meter the verticals.

---

## 7. The pricing migration plan — how to change without breaking trust

The single hardest pricing move: **raising prices on existing customers when half your code says they pay $79 and half says they pay $799.** Done badly, this is the moment customers churn and tweet. Done well, it's actually a trust-builder.

### 7.1 Pre-migration (week 0–2): consolidate the source of truth

This is Marisol's #1 (`shared/billing/tier-pricing.ts`). Until there is one table, you cannot reprice anything. Delete the seven tables. Move `SUBSCRIPTION_TIERS` from `shared/schema.ts` into a billing module, rename it to today's actual prices, sync to Stripe price IDs, and add a CI test that fails if Stripe disagrees with the table.

### 7.2 The grandfathering principle

**Every customer who signed up before the repricing date keeps their current price *forever* on their current tier.** This is the Patrick Campbell rule. Three reasons:
1. **Trust signal.** The landing literally says "I priced it the way I'd want it priced." Yanking that on existing customers reads as betrayal.
2. **Conversion to annual.** Grandfathered customers move to annual at the *new* annual rate — capture upgrade revenue without a rate-change on monthly.
3. **Press optics.** Hacker News will write the post: "AcreOS raises prices but honored every existing customer at original rate." That's a brand asset, not a hit.

### 7.3 The 90-day rollout

**Day 0–14:** Single source of truth shipped. Stripe price IDs synced. Six conflicting tables deleted. CI test passing.

**Day 14–30:** New pricing page goes live with 4 tiers (Solo $79 / Operator $249 / Pro Operator $599 / Operation $1,490). Old customers still see old prices in the customer portal. Free tier removed from public — anyone with a free account converts to a 14-day trial of Pro Operator on day 1 of migration (give them the *bigger* surprise upgrade, not a smaller one).

**Day 30–60:** Public reveal. Founder-voice email from Thomas: *"I'm changing AcreOS pricing. Here's why, here's what changes for you (nothing — your price is locked), and here's where to push back." Reply-to-thomas@acreos.io.* Build a single page at `/pricing-2026` explaining the change in letter voice. Link from the dashboard for 30 days.

**Day 60–90:** Annual upgrade campaign. Email every monthly customer with: *"Move to annual at 20% off, locked at your current price for 12 months."* Goal: 40% of monthly customers convert to annual at grandfathered rate. This *reduces* churn risk during the transition and locks LTV.

**Day 90+:** New customers only see new prices. Grandfathered customers stay forever. Track grandfathered MRR as a separate cohort line on `/founder-home` so the CFO can see the migration drag and the moment the new-cohort revenue overtakes it (typically month 8–12).

### 7.4 What NOT to do

- **Don't raise prices on existing customers.** Even with notice. Even with discounts. Vertical SaaS founder-led products lose ~25% of cohort to a price hike. Grandfather forever.
- **Don't soft-launch.** Two prices live simultaneously confuses prospects more than it converts customers. Ship the new pricing on a single date with a public letter.
- **Don't bundle the repricing with feature changes.** The narrative is "the price is now honest about what you get." Adding three new features in the same week muddles the message.
- **Don't run the operator pricing in beta.** The landing already shows $199–$1,290. The mismatch with `/pricing` is the bug. The fix is committing to operator pricing as canonical, not testing it.

---

## 8. Annual + grandfathering policy

### 8.1 Annual is the default for SaaS — and AcreOS doesn't act like it.

Currently `pages/pricing.tsx` defaults to `annual = false`. **Flip this.** Annual should be the default toggle state, monthly is the deviation. Stripe's own data: defaulting to annual moves 18% more customers to annual without a discount change.

### 8.2 The annual discount math

Today: 20% annual discount (Starter $192 = $16/mo, Pro $470 = $39.16/mo, Scale $758 = $63.16/mo).

**Recommended after repricing:**
- Solo: $79 monthly / $69 annual (12% discount, $828/yr)
- Operator: $249 / $208 (16%, $2,490/yr)
- Pro Operator: $599 / $499 (17%, $5,990/yr)
- Operation: $1,490 / $1,290 (13%, $15,490/yr — matches landing's existing $1,290)

**Why discounts shrink at higher tiers:** higher tiers have lower price sensitivity but higher LTV. A 12% discount captures 80% of the annual conversion lift at half the discount cost. The 20% flat-across-the-board discount is leaving margin on the table at the top tier.

### 8.3 Grandfathering rules (write this as a public policy)

- **Tier + price locked at signup.** Customer keeps their tier and price forever as long as the subscription is continuous (no >30 day lapse).
- **Annual switch keeps the lock.** A grandfathered $79 Scale customer moving to annual gets 20% off the *grandfathered* price ($63.16 × 12), not the new price.
- **Tier downgrade resets the lock.** If a customer downgrades, they re-price at the current published rate for the new tier.
- **Tier upgrade keeps grandfathered % discount.** If a Solo customer upgrades to Operator, they get *Operator at the new published price minus the same % off they had on Solo* (preserves the "founding-customer discount" intuition without writing a SQL query at every checkout).
- **Reactivation after >30 day lapse re-prices at current rates.** Otherwise this becomes a weaponized exit-and-return loop.

### 8.4 Founder/beta comp policy

Marisol noted (§1) that comps have no `comp_reason` / `comp_expires_at` / shadow-MRR. Build this:
- Comp accounts must have a documented reason (Beta cohort, Founder partner, Refund-in-kind, etc.)
- Comp accounts must have an expiry — *every* comp converts to paid at expiry, with a 60-day notice email signed by Thomas. Default expiry is 12 months.
- Shadow MRR = the MRR if the comp converted at current rate. Surface on /founder-home as "Comp leakage: $X/mo we'd be billing if all comps converted." This is the Asher-voice metric: honest about what you're forgoing.

---

## Closing note

The pricing problem at AcreOS is not a number problem. It's an **identity problem** showing up as a number. The product is operator-class — three named agents, autonomy slider, audit log, founder reachable by email. Then it prices like a consumer Notion plan and lies to itself in seven different server files about which price is which.

Resolve the identity question — *operator-class software, priced like operator-class software* — and the pricing falls out of it. The migration is mechanical; the courage is the hard part. Charge what the work is worth and the customer who needs the work will pay it.

The tweet you want is: *"AcreOS raised prices 4×. They told me first, locked my old rate, and the product was already worth the new rate."* That's the version of this where you keep your customers and add 2.8× MRR.

— Tegan
