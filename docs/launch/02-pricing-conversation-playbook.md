# Pricing Conversation Playbook — What to Say When

**Audience:** AcreOS founder, sales partner (if hired).  
**Context:** These conversations happen after the customer has seen their aha moment and are asking "okay, what's the real cost?"  
**Goal:** Land them on the right tier without discounting + set up expansion revenue path (vertical packs, per-seat scaling in Year 2).

---

## The 3-Tier System (What They Hear)

All tiers reference the enum in `shared/billing/tier-pricing.ts` and map to actual Stripe Price objects.

### **Tier 1: Solo — $49/month**

> "You're one person. You get all the tools: deal-finder, offer-writer, note-ledger, team-deal-rooms, everything. You're the only person who logs in, and you manage your own data."

**Use for:** Cold-start customer, solopreneur, operator testing the waters.

**Expansion path:** "If you bring a VA or partner in later, you upgrade to Operator."

### **Tier 2: Operator — $99/month**

> "You and your team — 2-5 people. Everyone sees the same deals, notes, and contracts. You can assign leads to a VA, invite a co-investor to a deal-room, run bulk actions together. Think: a team that moves as one unit."

**Use for:** Operator with 1-2 team members, partnership with a co-buyer, wholesaler with a virtual assistant.

**Expansion path:** "Later, if you scale to 10 people, we can talk about per-seat pricing ($X/seat/mo)."

### **Tier 3: Pro Operator — $199/month**

> "You're the operator running multiple teams or multiple verticals. You get unlimited seats, API access, custom reporting, and priority support. Think: you're running a machine that's doing $500K+ ARR, and you need both Land and Notes and Wholesale active at the same time."

**Use for:** Operator with 5+ team members, multi-vertical player, operationalization goal.

**Expansion path:** "At this tier, you also unlock vertical packs (below)."

---

## Vertical Packs — $100–$200/month each

**This is the expansion narrative:** Base tier + packs.

All packs sit on top of Solo/Operator/Pro Operator. A customer starts with Land ($0 add-on base), and can add:

- **Notes Investor Pack** — $150/mo
  - Note-ledger escalation (early warning on at-risk borrowers, yield calculations, 1098-INT generation)
  - Portfolio-upside modeling (tax-loss harvesting, reinvestment tracking)
  - This is not a "second vertical"; it's "deep on notes if you also do land."

- **Wholesaler Pack** — $100/mo
  - Contract-assignment flow (double closing, side-by-side closing math)
  - Co-wholesaler collaboration (invite partners, split fees atomically)
  - Mailer integration (send blind offers at scale)

- **Broker-Hub Pack** — $200/mo
  - Tenant-screening (credit, criminal, eviction history; BH feature set)
  - Portfolio tracking (rent roll, maintenance reserve, cap-rate monitoring)
  - Underwriting dashboard (evaluate new properties as rental vs flip vs hold)

- **Commercial Pack** — $150/mo
  - Commercial comps (office, retail, industrial; different cap-rate benchmarks)
  - 1031-exchange modeling (defer capital gains on like-kind swaps)
  - Entity-structuring (LLC vs S-Corp for commercial deals)

**Pitch sequence for packs:**

1. **After they pick their wedge vertical:**
   - Land investor: "$49 Solo gets you full Land. If you're also buying notes as a side income stream, the Notes Pack is $150/mo. Most of my land investors pick it up by month-3."
   - Note investor: "$49 Solo gets you Notes. If you want to also flip the occasional land parcel, the Land access is included; no pack needed."
   - Wholesaler: "$49 Solo gets you Wholesaler. If you're also buying rentals for hold, the Broker-Hub Pack is $200/mo and gives you cap-rate tracking."

2. **During Year-1 CS calls:**
   - "You mentioned wanting to get into [adjacent vertical]. We have a pack for that. It's $[price]/mo and takes 30 min to set up."
   - **Never force it.** "Let me know if you want to explore it."

---

## Founder-Comp Accounts (Free for X months in exchange for Y)

**When to offer:** Operator-realism reference customers (like Wendell Hart), advisors, launch-phase champions.

**The deal:**

> "Here's what I want to offer: you get Pro Operator free for 6 months ($199/mo value = $1,194 value). In exchange, I want three things: one, you let me call you once a month to understand how you're using it and what's broken. Two, you introduce me to three other operators like you. Three, if something goes wrong, you tell me before you tell the world."

**Why this structure?**

- It's a 6-month runway, not indefinite free-tier prison.
- It's reciprocal (you give intel and intros, we give software).
- It has an exit ramp: "After 6 months, it's either $199/mo or we find another arrangement."

**Do not offer:**
- Lifetime free. (Sets bad precedent.)
- Discount codes. (Erodes pricing power; breeds reseller expectations.)
- Equity in exchange for beta usage. (This is venture debt, not pricing.)

---

## Annual vs Monthly Framing

**When to use annual:**
- After they commit to 3 months of paid usage.
- When they ask "can I lock in a lower rate?"
- During the annual budget planning season (January, September).

**The math (example for Solo):**

Monthly: $49/mo × 12 = $588/year
Annual: $492/year (15% discount)
**"You save $96/year if you pay upfront. That's like two months free."**

**When NOT to push annual:**
- Cold-start month-1 (they haven't felt the value yet).
- Month-2 if they're not logging in regularly (they'll churn; annual prepay = bad faith).
- Ever if cash-flow matters to them. (They'll resent you if they need a refund in month-9.)

**Script for annual pitch (after month-3):**

> "You've been using Solo for three months and you're logging in 4 times a week. The question is: want to lock in a rate? If you go annual, it's $492/year instead of $49/month. Saves you $96. How does that feel?"

---

## When to Walk Away

**Do not sell to (red flags):**

1. **"I want to see if you'd give me [30–50%] off."**
   - Response: *"I appreciate the ask. But I don't do custom pricing for the first 12 months. If you're on Solo and you hit $50K ARR in land deals, we talk about a higher tier at a better price. Does that make sense?"*
   - If they push: *"Then this probably isn't the right time. Let's reconnect in 6 months and see where you are."*
   - **Walk away.** Customers who need a discount before they've tried the product will resent you at month-6 when they realize it costs money.

2. **"I need to be free forever so I can prove ROI before I pay."**
   - Response: *"I get it. You want to test it risk-free. Here's the deal: 14-day free trial, you use it without a credit card. If it works, you pay $49/month on day 15. If it doesn't, you don't. Fair?"*
   - If they say *"I need 30 days"*: *"Okay, 30 days. But on day 31, if you're using it, you're on paid. If you're not using it, we're done. Agreed?"*
   - If they keep asking for longer: **Walk away.**

3. **"I want to use it for [use-case we don't support] and I want you to build it for free."**
   - Response: *"We built this for Land / Notes / Wholesale. If you want to use it for [other], it'll work for part of it, but not the core. If you're serious about [other] long-term, let's talk about a custom roadmap in month-6. But right now, I'd start with your main use-case."*
   - If they insist: **Walk away.** They want a custom product for a retail price.

4. **"I'll sign up if you give me lifetime access / free tier with one team member / perpetual license."**
   - Response: *"I can't do perpetual or lifetime. But I can do 14-day free trial, then $49/month SaaS, month-to-month. You can cancel anytime. That's the deal."*
   - If they won't budge: **Walk away.** Lifetime-deal customers become support nightmares; their expectations are misaligned.

**When you walk away, say:**

> "I appreciate your interest. But I think right now we're not aligned on value. Let's revisit in 6 months after you've had time to think about it."

**Then move on.** Don't negotiate in the moment. The customer who walks away at pricing might boomerang in 3 months and pay full price.

---

## The "$49 for a spreadsheet" Objection (3 scripts)

### Script #1: The Feature Diff

> "I understand. A spreadsheet is $0. Here's what we offer: one, we integrate with the county (tax-delinquent scan runs every night, you wake up to new leads). Two, we write offer letters for you (Pax analyzes comps, borrower profile, yields, drafts a 1–2 page letter in 5 minutes). Three, we track payments on notes (you input or upload; we calculate yields, flag at-risk borrowers, generate 1098-INT). A spreadsheet doesn't do those three things. That's why it's $49, not free."

**Use this when:** They understand spreadsheets but haven't seen the integration benefit yet.

### Script #2: The Time Savings

> "Let's do the math. You spend 3–5 hours a week on admin: scanning sites for deals, writing offers, tracking payments. At $50/hour of your time, that's $150–250/week you're spending on something AcreOS does. So $49/month is actually saving you $600–1000/month. It's not an expense; it's leverage."

**Use this when:** They're a working operator with billable time.

### Script #3: The Boring-Spreadsheet Honesty

> "You're right, it sounds expensive for a spreadsheet. Here's the reality: you could definitely build a better spreadsheet than what you have today and spend zero dollars. But after 3–6 months, you'll get tired of maintaining it, you'll have version drift with your co-investor, and you'll go back to doing it by hand. AcreOS is the opposite: it gets better the more you use it because we learn your patterns, we flag problems before you see them, and your team syncs automatically. So it's not $49 for a spreadsheet; it's $49 for you to never have to maintain this again."

**Use this when:** They've built their own tools before and know the hidden cost of maintenance.

---

## Discount Objections (What NOT to do)

**Objection:** "Your competitor gives me 50% off if I commit to annual."

**What NOT to say:** 
- "Okay, I'll match 40% off." (You've now set a bad precedent; they'll expect discounts forever.)

**What to say:**
> "I hear you. Different companies have different strategies. Mine is: transparent pricing, no haggling, same price for everyone. If you feel like [competitor] is a better fit, I get it. But I think the reason to pick AcreOS isn't the discount — it's the product. Let's talk about what you're actually trying to solve."

Then: Walk back to the product benefits (integration, automation, compliance). If they still want the competitor: **Let them go.** You're better off without discount-driven customers.

---

## Expansion Revenue Conversation (Month-3 check-in)

After they've been on Solo for 3 months, ask during a CS call:

> "So you've been using AcreOS for three months. I want to understand: are you doing more with [vertical] or are you starting to do [adjacent vertical]?"

**If they say "I'm branching into [adjacent]":**

> "That's great. We have a pack for that — [Pack Name] at $[price]/mo. It brings in [3 features specific to that vertical]. Want to explore it, or is it too early?"

**If they say "I'm scaling Land":**

> "Perfect. So you've got you + one VA now. Want to upgrade to Operator ($99/mo) so you both have logins and can work together? Otherwise you're doing everything and delegating it, which limits your scaling."

**Do not hard-sell.** Frame it as "here's what I'm seeing; does this fit?" They'll ask for it if they need it.

---

## Common Pricing Conversations (Cheat Sheet)

| Scenario | What they said | Your response |
|----------|---|---|
| "Can I get annual pricing?" (month-1) | "I want the best rate." | "Let's use monthly for 3 months so you feel the value. Then we'll switch to annual and you save money. Deal?" |
| "What's the difference between Operator and Pro?" | "Do I need Pro?" | "Do you have 5+ team members? If yes, Pro. If you're under 5, Operator is way cheaper and has everything you need." |
| "Can I just use the notes part without paying for land?" | "I only need [one vertical]." | "Land is included in the base price. You only pay extra for add-on packs like Notes Pack ($150). Solo gives you Land for free." |
| "Do you price by revenue or volume?" | "How does this scale?" | "Flat-fee tiers until month-12. After that, we'll look at per-seat pricing. But right now, Solo is Solo, regardless of whether you're doing $10K or $100K deals." |
| "Will the price go up after the trial?" | "Is this a bait-and-switch?" | "No. Trial is 14 days. Then it's $49/mo if you want to stay. If you don't use it, you don't pay. That's it." |

---

## Messaging on Pricing Page

This is what appears at `/pricing` (reference `client/src/pages/pricing.tsx` or equivalent):

**Headline:** "Simple, transparent pricing. Same for everyone."

**Subheading:** "No hidden fees. No discounts. Pick your tier, use it for 14 days free, then pay if it works for you."

**Under each tier:**
- The monthly price (large, bold)
- List of features (5–7 bullets per tier)
- "What's included" section
- "Add a pack" section if this is Solo/Operator (link to pack pricing)

**At the bottom:**
- FAQ: "Can I change tiers?" (Yes, anytime. Pro-rated monthly billing.)
- FAQ: "What's a pack?" (Add-on vertical or feature set. Click to see all packs.)
- FAQ: "Do you have non-profit pricing?" (Not yet. Email us; we might waive it case-by-case.)

---

**Version:** 2026-05-08  
**Owner:** Founder / Sales  
**Dependency:** `shared/billing/tier-pricing.ts` finalized, Stripe Price objects live, `/pricing` page live

