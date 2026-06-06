# Pricing Alternatives — 2026-06-06

**Author:** Lena Volkova, CFO/CIO
**Status:** Research + decision support. Pre-decisional. No code changes ship from this doc.
**Audience:** Tom (founder); Solene + Maren when activated.
**Companion:** `shared/billing/tier-limits.ts`, `shared/billing/tier-pricing.ts`, `shared/billing/credit-weights.ts`, `server/services/aiCostRates.ts`, `client/src/pages/pricing.tsx`, `client/src/pages/landing/copy.ts`, `docs/internal/marketing-os/00-blueprint.md`.

This document does **one** thing: present three concrete alternative tier structures with unit economics so Tom can pick one in a future session. It does **not** propose code changes. It does **not** propose customer-facing copy changes. Bug-fix work for the two P0 unit-economics defects (Starter daily/monthly confusion; Scale negative-margin-at-cap) is called out separately in §5 and ships **regardless** of which pricing structure is picked.

All dollar and percentage figures cite either:
- `shared/billing/tier-pricing.ts` (price source of truth),
- `shared/billing/tier-limits.ts` (quota source of truth),
- `server/services/aiCostRates.ts` (provider COGS source of truth),
- `shared/billing/credit-weights.ts` (per-action cents-to-us source of truth),
- or a clearly-flagged assumption with the sensitivity below it.

No competitor pricing benchmarks. No invented numbers. Mechanics-first voice.

---

## 1. Current state

### 1.1 What the tiers look like today

Source: `shared/billing/tier-pricing.ts` lines 69–111 + `shared/billing/tier-limits.ts` lines 58–130.

| Tier | Monthly | Annual | Annual / 12 | Seats incl. | Extra seat / mo | Leads | Properties | Notes | AI requests | Credit pool | BYOK |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|:-:|
| Free | $0 | $0 | $0 | 1 | — | 50 | 3 | 2 | 25 | 50 | no |
| Starter | $20 | $200 | $16.67 | 1 | (n/a) | 250 | 50 | 25 | 500 | 750 | no |
| Pro | $49 | $490 | $40.83 | 2 | $20 | 500 | 100 | 50 | 1,000 | 2,500 | yes |
| Scale | $79 | $790 | $65.83 | 10 | $40 | ∞ | ∞ | ∞ | ∞ | 8,000 | yes |
| Enterprise (gated off) | — | — | — | 25 | $50 | ∞ | ∞ | ∞ | ∞ | 25,000 | yes |

Customer-facing landing copy headline: `LANDING_COPY.pricing.sub` — *"Pro at $41/mo (billed annually) unlocks the full Pax assistant, unlimited counties, and bring-your-own-key…"* (Pro annual / 12 = $40.83, rounded to "$41" for display.)

Annual discount: ~16–17% across paid tiers (10× monthly).

### 1.2 Provider COGS — the raw numbers driving margin

Source: `server/services/aiCostRates.ts` lines 40–60.

| Model | $/M input | $/M output | $/M cached input |
|---|---:|---:|---:|
| Haiku 4.5 | $0.80 | $4.00 | $0.08 |
| Sonnet 4.6 | $3.00 | $15.00 | $0.30 |
| Opus 4.6 | $15.00 | $75.00 | $1.50 |
| gpt-4o-mini | $0.15 | $0.60 | — |
| deepseek-chat | $0.14 | $0.28 | — |

Per `shared/billing/credit-weights.ts` lines 49–59, the **internal blended cost-to-us per "ai_turn_avg"** is **1.5 credits ≈ $0.015** (Haiku-classify + Sonnet-synthesize mix). This is the calibrated 90th-percentile figure used by the credit-pool math.

Per-action cost-to-us reference (from `credit-weights.ts`):

| Action | Cost-to-us |
|---|---:|
| SMS outbound | $0.010 |
| Email outbound | $0.0002 |
| Postcard — EDDM | $0.31 |
| Postcard — PostGrid | $0.55 |
| Postcard — Lob fallback | $0.75 |
| Letter — presort | $0.32 |
| Letter — Lob fallback | $1.20 |
| Skip trace | $0.30 (effective ~$0.05 after cache share) |
| AI turn — blended | $0.015 |

### 1.3 Two confirmed P0 unit-economics bugs (Lena findings)

These are bugs to be fixed regardless of the pricing reset. They are described here so the alternatives in §2 can be compared against an **honest** current state — not the apparent current state.

#### 1.3.1 Bug: Starter "ai_requests: 500" is enforced daily, not monthly

**Code path:** `server/services/usageLimits.ts` lines 89–105 — `getDailyAiRequestCount` filters `usageEvents` by `createdAt >= midnight today`. The same `TIER_LIMITS[tier].ai_requests` value is then compared against today's count only. There is no monthly variant.

**What customers think they get:** The pricing page row (`client/src/pages/pricing.tsx` line 113) renders the row label **"AI requests / day"** for all tiers. So Starter is effectively advertised as 500/day.

**What the unit economics assume:** Credit pool of 750 credits/mo. At 1.5 credits/turn, the implicit AI-turn budget is **500 turns / month** — not per day.

**The leak:** A Starter customer who hits the daily cap of 500 turns × 30 days = **15,000 turns/mo** would consume 15,000 × 1.5 = **22,500 credits/mo** — 30× the credit pool. At ~$0.015/turn cost-to-us, that's **$225/mo of AI COGS** against a **$20 sticker** (or **$16.67 effective on annual**).

A "patient zero" Starter on annual at 80% of the daily cap (400 turns/day × 30 = 12,000 turns/mo) costs $180/mo against $16.67 revenue. Gross margin = **−$163.33 = −980%**.

**Why it likely isn't blowing up yet:** Customer count is small (Phase 0, sub-$200 MRR), and most users don't hit anything close to 400 turns/day in practice. But the gate is not protecting margin; nothing is. Bug fix recommendation: §5.

#### 1.3.2 Bug: Scale tier has `ai_requests: null` (unlimited) — no margin floor

**Code path:** `shared/billing/tier-limits.ts` line 107 — `ai_requests: null`. The 8,000-credit pool is **not** the gate (the daily AI-request gate is what `checkUsageLimit("ai_requests")` checks; the credit pool is `creditPool` and the deduction handlers are described in `credit-weights.ts` line 30 as **"foundation-only … wiring happens in the enforcement task."**)

**What this means today:** Scale customers can run unlimited AI turns at $0.015/turn cost-to-us, with no cap.

**Cost ceiling at heavy use:** A Scale customer running Pax overnight with a 2,000-turn/day workflow (heavy direct-mail reply drafting + comp triage) → 60,000 turns/mo × $0.015 = **$900/mo of AI COGS** against **$79 sticker** ($65.83 effective on annual). Gross margin = **−$821 = −1,247%**.

Even at a moderate 500 turns/day × 30 = 15,000 turns/mo × $0.015 = $225/mo → still negative ($225 cost vs. $79 revenue = **−185% margin**).

**At what utilization does Scale break even on AI alone?** $79 / $0.015 = **5,267 turns/mo** = ~175 turns/day. Any Scale customer above 175 turns/day is cash-flow negative on AI alone — before adding direct mail, skip trace, seats, support, or the 25%-tax/10%-refund/5%-profit/5%-owner-draw allocation reserve from `shared/billing/allocation-policy.ts`.

After allocation policy: only 55% of revenue reaches `opex_available` (the bucket spend posts against). Effective AI-budget per Scale customer is **$79 × 0.55 = $43.45/mo monthly, or $36.21/mo annual**. Break-even drops to ~80–95 turns/day. Anyone above that is **negative-contribution at the company-policy level.**

This is the "Scale neg-margin-at-cap" bug. Bug fix recommendation: §5.

### 1.3.3 Bug interaction — what this combo means in practice

The Starter daily/monthly bug + the Scale unlimited bug together mean **AcreOS does not currently enforce a margin floor on either tier above Free.** Free has a real 25-turn/day cap. Starter and Scale don't. Pro at 1,000/day × 30 × $0.015 = $450/mo against $49 sticker = **−818% margin** — Pro has the same defect as Scale at the unit-economics level, just with a smaller blast radius.

**The "what the bugs actually do at expected usage volume" answer:** At Phase 0 volumes (sub-$200 MRR, <20 paid customers), the loss is bounded by sheer customer count — maybe **$50–$300/mo of unbilled AI COGS** depending on who happens to be heavy. At Phase 2 ($1k MRR) the same bug pattern with ~25–50 paid customers and one or two heavy Pax users is **$500–$2,000/mo of unbilled AI COGS** — easily exceeds gross revenue. The bugs become existential between Phase 1 and Phase 2.

### 1.4 What today's pricing does well

1. **Honest sticker prices.** $20/$49/$79 are on the page (`client/src/pages/pricing.tsx` lines 37–60). No "contact us" wall. No dark pattern.
2. **Annual discount disclosed.** 16–17% off, shown via toggle, with the "save 17%" badge (line 240–244 of pricing.tsx). ACH discount mentioned (line 246–250).
3. **Free tier is generous enough to evaluate.** 50 leads + 25 AI requests/day; comment in `tier-limits.ts` lines 60–64 explains why (sample-data flow seeds 35+ leads).
4. **Pro is the highlighted tier.** Sticker $49/mo or $40.83 effective annual; landing copy says "$41/mo." Most-popular badge on line 270.
5. **BYOK on Pro+ correctly shifts data-vendor COGS off-balance-sheet.** Pro and Scale both have `byokSupport: true` (lines 97, 110 of tier-limits.ts). For the parcel + skip-trace data side, this is the right design.
6. **One canonical price source.** `tier-pricing.ts` is imported everywhere — Lens 3 (Pricing Coherence) closed the previous drift.

### 1.5 What today's pricing does poorly

1. **The "daily AI requests" gate doesn't match how operators experience the product.** Pax does multi-turn synthesis on most actions — a single "draft reply to this seller" is 3–6 internal turns. 500/day for Starter is not a customer-meaningful number; it's an internal compute budget that customers can't model.
2. **No overage / hard-cap behavior is spec'd.** Today the limit just returns 429 (UsageLimitError, lines 206–227 of usageLimits.ts) — the customer is blocked, but there's no graceful path to "spend $5 more this month."
3. **Scale (the highest self-serve tier) has the worst unit economics.** Unlimited AI at $79/mo + 10 included seats is a structural margin trap (§1.3.2).
4. **The credit pool exists but isn't enforced.** `credit-weights.ts` line 30: *"foundation-only. Action handlers do not yet draw from the pool."* So the visible 750/2,500/8,000 credit pools are decorative, not active.
5. **No vertical pack is launched.** `tier-pricing.ts` lines 119–196 defines a `VERTICAL_PACKS` table (note_investor, buy_and_hold, fix_and_flipper, subdivision, wholesale at $100–$200/mo) but none of this is on the customer-facing pricing page or Stripe checkout today. The substrate is there; the surface is not.
6. **Starter at $20/mo doesn't have a defensible margin story** at high AI use; the credit pool of 750 (≈$7.50 of cost-to-us at face value) leaves ~$12.50/mo for everything else (Stripe fee, infra, support, allocation reserves). At 55% opex_available that's **$11 of budget vs. $7.50 of theoretical AI cost** — fine on paper, **but the 500/day daily-gate bug breaks the paper math entirely.**
7. **"Pro" sticker is $49 month / $40.83 annual / "$41 in the landing sub" — three numbers for one tier.** The annual-default toggle on `/pricing` line 178 keeps it consistent within the page, but a prospect who sees the landing first and then toggles monthly on /pricing sees a $8/mo jump with no on-page reconciliation.
8. **No quota that meaningfully gates seats from gating AI.** Pro at 2 included seats + $20/extra is decoupled from AI use — a 5-seat team and a 2-seat team get the same AI budget. At Phase 2+ this becomes "the cheap-team arbitrage": invite teammates onto Pro instead of paying for Scale because Scale's seat math is only ~$4/seat vs. Pro's $24.50/seat blended at 2 seats.

---

## 2. Three alternative tier structures

For each option I model COGS at 20% / 50% / 80% of quota utilization. The assumed mix of how a customer spends their quota is:

- **AI:** 60% of credit pool (the dominant cost-to-us category in Phase 0 because BYOK shifts data costs off-platform)
- **Direct mail:** 20% of pool (EDDM-weighted at $0.31)
- **SMS + email:** 10% of pool (SMS-weighted at $0.01)
- **Skip trace:** 10% of pool (at effective $0.05 with cache share)

Assumption flag — if Tom believes the AI-dominant mix is wrong, the breakeven math in each option shifts; sensitivity called out per option.

Allocation policy applied on revenue side: 55% reaches `opex_available` per `shared/billing/allocation-policy.ts` line 53. All "contribution margin" figures use the 55% effective revenue, not the sticker.

Stripe processing fee assumed at **2.9% + $0.30 / charge** for monthly card; **0.8% capped at $5 / charge** for ACH on annual. ACH only available on annual at $200+; Stripe fee on $200 annual ACH = $1.60. Modeled as $1.60 amortized over 12 months = **$0.13/mo** for annual-ACH. Monthly card on $49: fee = **$1.72/mo (3.5%)**. Phase 0 mostly card; assume **monthly card** for the modeling. Tom can refine when ACH share grows.

---

### 2.1 Option A — Tighten + simplify (3 tiers, hard quotas, no overage)

**Positioning (1-liner):** Predictable, defendable margins; lower headline price ceiling; no surprise bills for the operator.

#### Tiers + prices

| Tier | Monthly | Annual | Annual/mo equiv | Seats incl. | Extra seat/mo |
|---|---:|---:|---:|---:|---:|
| **Free** | $0 | $0 | $0 | 1 | — |
| **Starter** | $29 | $290 | $24.17 | 1 | (n/a — upgrade) |
| **Pro** | $79 | $790 | $65.83 | 2 | $25 |
| **Scale** | $199 | $1,990 | $165.83 | 5 | $35 |

Annual discount stays at ~16% (10× monthly). Compared to today:
- Starter +$9/mo ($20 → $29) — closes the unit-economics gap.
- Pro +$30/mo ($49 → $79) — buys a real Pax budget; honest BYOK-only path.
- Scale +$120/mo ($79 → $199) — the **only** option in this set where Scale is actually contribution-positive at heavy use. Drops included seats from 10 → 5 (today's 10 was a structural margin trap).

#### Quotas per tier (hard caps; on-block, return 429 + upgrade prompt)

| Quota | Free | Starter | Pro | Scale |
|---|---:|---:|---:|---:|
| Counties tracked | 1 | 3 | unlimited | unlimited |
| Leads (stored, lifetime) | 50 | 500 | 5,000 | unlimited |
| Comp lookups / month | 10 | 200 | 2,000 | 10,000 |
| Pax messages / month (1 turn = 1 message) | 25 | 500 | 3,000 | 12,000 |
| Skip traces / month | 0 | 25 | 200 | 1,000 |
| Direct-mail sends / month (any class) | 0 | 100 | 1,500 | 8,000 |
| SMS sends / month | 0 | 100 | 1,000 | 5,000 |
| Email sends / month | 100 | 2,000 | 20,000 | 100,000 |
| BYOK data providers | no | no | yes | yes |
| Seats | 1 | 1 | 2 incl. | 5 incl. |

Pax messages = the **AI-turn** customer-facing equivalent. **Always monthly, never daily.** Replaces the broken `ai_requests` daily gate.

#### Soft-cap behavior

- **Block on hard cap, with no overage.** Customer sees: "You've used 100% of this month's Pax messages. Resets in N days, or upgrade to Pro for N× the budget."
- **Warning at 75% + 90%** in the dashboard (matches existing 75% banner pattern).
- **No surprise bills.** Customer can never get a charge >their sticker.

#### Unit economics modeling — COGS per customer per month

Cost model per Pax message at $0.015 blended; direct-mail at $0.31 (EDDM); SMS at $0.01; skip trace at $0.05 effective.

**Starter @ $29 monthly card ($27.28 net after Stripe), $24.17 annual card ($23.62 net):**

| Util | Pax | DM | SMS | Skip | Email | Total COGS | Net (mo) | Contrib | Margin% |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20% | $1.50 | $6.20 | $0.20 | $0.25 | $0.08 | **$8.23** | $27.28 | $19.05 | 70% |
| 50% | $3.75 | $15.50 | $0.50 | $0.63 | $0.20 | **$20.58** | $27.28 | $6.70 | 25% |
| 80% | $6.00 | $24.80 | $0.80 | $1.00 | $0.32 | **$32.92** | $27.28 | −$5.64 | **−21%** |

Starter goes negative at ~70% utilization assuming the customer maxes direct mail. **In practice, mail at 100 pieces/mo is a heavy outreach starter** — most Starters will be at <50% DM. The 80% case is the heavy-mail Starter, not the average Starter. If Tom wants Starter to never go negative even at 100% utilization, drop DM cap to 60/mo (would put 100% util at ~$26 COGS = $1.28 contribution).

**Pro @ $79 monthly ($75.04 net), $65.83 annual ($62.36 net):**

| Util | Pax | DM | SMS | Skip | Email | Total COGS | Net (mo) | Contrib | Margin% |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20% | $9.00 | $93.00 | $2.00 | $2.00 | $0.80 | **$106.80** | $75.04 | **−$31.76** | **−42%** |

Stop. Pro at 20% utilization is **already negative.** That's a problem — the **1,500 direct-mail-pieces-per-month** quota at $0.31/piece is the math killer ($465 of mail COGS at 100% util before any AI).

**Pro fix: drop DM cap to 300/mo (Pro is the BYOK tier; the assumption is most mail is sent off-platform via the customer's own Lob/PostGrid keys).** Re-running:

| Util | Pax (3,000) | DM (300) | SMS (1,000) | Skip (200) | Email (20K) | Total COGS | Net (mo) | Contrib | Margin% |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20% | $9.00 | $18.60 | $2.00 | $2.00 | $0.80 | **$32.40** | $75.04 | $42.64 | 57% |
| 50% | $22.50 | $46.50 | $5.00 | $5.00 | $2.00 | **$81.00** | $75.04 | **−$5.96** | **−8%** |
| 80% | $36.00 | $74.40 | $8.00 | $8.00 | $3.20 | **$129.60** | $75.04 | **−$54.56** | **−73%** |

Even with DM reduced, Pro breaks at ~46% utilization on monthly card. On annual ACH ($62.36 net less Stripe), break-even drops to ~38%.

**Pro fix #2: require BYOK for direct mail at the Pro tier — i.e. only AcreOS-routed DM is the 300/mo cap; BYOK DM is uncapped because it doesn't touch our COGS.** With BYOK-only mail above 300, average DM cost-to-us is 30% of the modeled figure (assume 30% of customers use platform DM at any volume). New numbers:

| Util | Total COGS (DM × 0.3) | Contrib | Margin% |
|---:|---:|---:|---:|
| 20% | $19.20 | $55.84 | 74% |
| 50% | $52.05 | $22.99 | 31% |
| 80% | $83.60 | −$8.56 | −11% |

This is the realistic operating envelope. Pro turns negative around 75% utilization — acceptable, because at 75% util the customer should be visibly upgrading.

**Scale @ $199 monthly ($192.97 net), $165.83 annual ($159.70 net):**

| Util | Pax (12K) | DM (8K) | SMS (5K) | Skip (1K) | Email | Total COGS | Net (mo) | Contrib | Margin% |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 20% | $36 | $32 | $10 | $10 | $4 | **$92** | $192.97 | $100.97 | 52% |
| 50% | $90 | $80 | $25 | $25 | $10 | **$230** | $192.97 | **−$37** | **−19%** |
| 80% | $144 | $128 | $40 | $40 | $16 | **$368** | $192.97 | **−$175** | **−91%** |

Apply the same BYOK-DM assumption (Scale is BYOK-on): DM × 0.3.

| Util | Total COGS (BYOK-DM adj) | Contrib | Margin% |
|---:|---:|---:|---:|
| 20% | $69.60 | $123.37 | 64% |
| 50% | $174.00 | $18.97 | 10% |
| 80% | $278.40 | −$85.43 | −44% |

Scale turns negative at ~55% utilization with BYOK assumption. **Better than today's −1,247% at full Scale use, but still uncomfortable.** To make Scale defensible at heavy use, cut the Pax message quota to 6,000/mo (50% of proposed). That moves the 80% mark to ~$206 COGS = −$13 contrib (just barely red).

#### Target customer per tier
- **Free:** evaluator running 1 county in trial mode. Sample data + a real first 10 comps. Cannot send mail.
- **Starter ($29):** solo land investor doing 1–3 counties of acquisition, mostly cold-mail outreach at 50–100 pieces/mo. No team. Replaces a spreadsheet + a list-tool + a CRM.
- **Pro ($79):** serious solo or 2-person operator, multi-county, full Pax-overnight workflow with BYOK keys for mail + parcel data. 80%+ of revenue probably comes from this tier.
- **Scale ($199):** funded operator or 3–5 person team, multi-state, high-volume Pax use, owns BYOK on every external service. Note-portfolio operators with active servicing live here.

#### What makes this different from B and C
**Tradeoff:** highest price floor ($29 minimum to start paying), lowest pricing complexity, lowest revenue ceiling per customer. Trades upside for predictability. Easiest to ship — only requires (a) raising the price, (b) replacing the daily AI gate with a monthly Pax-message gate, (c) capping Scale's previously-unlimited AI.

#### Risk / sensitivity
- **Headline price increase from $20 → $29 Starter** may slow trial-to-paid conversion. Sensitivity: if conversion drops 25%, Starter MRR/customer = $24.17 × 0.75 conversion-relative = need ~33% more trial volume to net flat. Marketable as "Starter now includes BYOK-eligible quotas + monthly Pax messages instead of daily" — frames the increase as a feature.
- **DM-heavy Starters break first.** Mitigation: cap DM at 60/mo on Starter; raise to 100/mo on Pro.
- **Scale customers at >55% utilization erode margin** even with BYOK-DM adjustment. Acceptable if the population is <20% of Scale customers; problematic if it's >40%.

#### Conversion implications vs. today
- Trial-to-paid: today's Starter at $20 → A's Starter at $29 = **45% increase**. Standard SaaS sensitivity: 5–15% conversion drop per 50% price increase. Estimate **3–10% trial conversion drop** as the marketable mid-range.
- Pro is the highlighted tier today and stays highlighted at $79 (vs. today's $49 = **61% increase**). This is the bigger risk. **Conversion math:** if Pro is the workhorse at 70% of paying customers, and price goes up 61% but conversion drops 15%, MRR per trial = $79 × 0.85 = $67.15 vs. today's $49 × 1.0 = $49. **MRR per trial up 37%** even after the conversion drop. The math defends the increase if the assumption holds.

---

### 2.2 Option B — Usage-based hybrid (base tier + metered overages on AI)

**Positioning (1-liner):** Low base price for predictable surface, metered upside for AI heavy users — captures actual cost-to-us when customers use Pax heavily.

#### Tiers + prices

| Tier | Monthly | Annual | Annual/mo equiv | Seats incl. | Included Pax messages | Overage price |
|---|---:|---:|---:|---:|---:|---:|
| **Free** | $0 | $0 | $0 | 1 | 25 | — (blocked) |
| **Starter** | $19 | $190 | $15.83 | 1 | 300 | $0.05 / msg above |
| **Pro** | $49 | $490 | $40.83 | 2 | 1,500 | $0.04 / msg above |
| **Scale** | $99 | $990 | $82.50 | 5 | 5,000 | $0.03 / msg above |

Overage prices are the **margin floor:** each Pax message costs us ~$0.015 (credit-weights.ts ai_turn_avg). Charging $0.03 at the high tier = 2× cost; $0.05 at Starter = 3.3× cost. These margins are designed to absorb the rest of the workflow (DM, SMS, etc.) on a blended basis without raising the base.

Other quotas (counties, leads, DM/SMS sends) match today's tier-limits.ts numbers but reduced 50% across the board to push heavy mail/SMS users to upgrade rather than overage. (DM overages get **infinitely** complicated — postage, paper, USPS routing — so we don't meter them; only Pax meters.)

#### Soft-cap behavior

- **Included quota exhausted → switch to overage mode** (UI banner: "You've used your included 1,500 Pax messages. Continuing costs $0.04 per message. Set a monthly spending cap?")
- **Customer-set monthly spending cap** with default at $50 above base price.
- **Hard stop** when the cap is reached; customer must raise the cap or wait for reset.
- **Disclosed surcharge model.** Stripe usage-based pricing handles the metering at month-close.

#### Unit economics modeling

**Starter @ $19 monthly ($16.74 net), included 300 Pax messages:**

Included quota cost-to-us: 300 × $0.015 = $4.50 + DM ($15.50 modeled) + SMS ($0.50) + skip ($0.63) + email ($0.20) = **$21.33** baseline at 50% utilization.

At 50% util base (no overage): net $16.74 − $21.33 = **−$4.59** contribution. Negative even before overage kicks in.

**This is the structural problem with Option B at Starter:** the base price is too low to cover the bundled non-AI workflow costs (DM, SMS). The included Pax-message budget is fine, but the bundled DM/SMS at any reasonable utilization breaks margin.

**Fix:** drop included DM to 30/mo + SMS to 30/mo. Re-run at 50% util:
- DM: 15 × $0.31 = $4.65
- SMS: 15 × $0.01 = $0.15
- Pax: $2.25 (50% of 300)
- Skip: $0.63
- Email: $0.20
- **Total: $7.88. Contribution: $8.86 (53% margin).**

That works, but the customer is now paying $19/mo for **30 DM pieces** — that's worse than today's Starter on raw quotas.

**Overage upside on Starter:** customer who uses 600 Pax messages = 300 included + 300 overage × $0.05 = **+$15 of overage revenue.** At cost $4.50 to us, that's **70% margin overage.** This is what Option B is supposed to capture.

**Pro @ $49 monthly ($45.85 net), included 1,500 Pax messages:**

Base 50% util (assuming reduced DM/SMS quotas similar to A): 750 Pax × $0.015 = $11.25 + DM (300/mo cap, 50% = 150 × $0.31 × 0.3 BYOK adj = $13.95) + SMS ($2.50) + skip ($5) + email ($2) = **$34.70**.

Contribution at 50% util: $45.85 − $34.70 = **$11.15 (24% margin).**

At 80% util: $34.70 × 1.6 = $55.52. Contribution **−$9.67 (−21%).**

Overage above 1,500 Pax messages: $0.04/msg × cost $0.015/msg = 62% overage margin. A Pro who uses 4,000 Pax/mo = 2,500 overage × $0.04 = **+$100 of overage revenue.** Cost: 2,500 × $0.015 = $37.50. **Net overage contribution: $62.50.** Combined Pro MRR: $49 base + $100 overage = $149 effective; net $137.50 effective; cost ~$72 (base ops + overage); **contribution ~$65 (47%).**

**The overage rescues margin at heavy use. That's the design.**

**Scale @ $99 monthly ($95.91 net), included 5,000 Pax messages:**

Base 50% util: 2,500 Pax × $0.015 = $37.50 + DM (BYOK-adj 50% × 8K = $124 → × 0.3 = $37.20) + SMS ($25) + skip ($25) + email ($10) = **$134.70**.

Contribution at 50%: $95.91 − $134.70 = **−$38.79 (−40%).** Same Scale problem as today.

**Fix:** drop included DM/SMS quotas at Scale by 50% (and rely on BYOK). And require overage-cap default at $100 (covering a 50% margin in expectation). At 50% util with halved DM/SMS:
- Pax: $37.50, DM: $18.60, SMS: $12.50, Skip: $25, Email: $10. **Total: $103.60.**
- Contribution: −$7.69 (−8%). Still negative.

Even with halved bundled quotas, Scale at $99 doesn't carry a 5,000-Pax-message included quota safely. **Either raise Scale base to $129 (parity with B's spirit but more honest), or drop included Pax to 3,000 + push the rest to overage.** Picking the latter: 3,000 included = 1,500 × $0.015 at 50% util = $22.50 → total $88.60 → contribution $7.31 (8%). Tight, but positive.

#### Target customer per tier
- **Free:** evaluator.
- **Starter ($19 + overages):** prefer-low-base, predictable-Pax-spend operator. Probably the smallest segment because the moment they hit the overage they're paying real money.
- **Pro ($49 + overages):** the workhorse. Most operators land here and pay $49–$90/mo blended.
- **Scale ($99 + overages):** heavy team or multi-state operators where the included 3,000 messages don't go far. Effective ARPU $99–$200/mo.

#### What makes this different from A and C
**Tradeoff:** lower headline prices (preserves $19/$49/$99 sticker familiarity) but operating revenue is consumption-driven and harder to forecast. Requires Stripe usage-based pricing wiring (Stripe Meters) + a spending-cap UI + customer comms about a fundamentally different pricing model. **More complex billing infra. Higher revenue ceiling per heavy customer.** Has the worst trial-to-paid optics because prospects may fear bill surprises even with caps.

#### Risk / sensitivity
- **Bill-shock risk** is the biggest. Even with caps + warnings, the first customer who gets a surprise $40 overage on top of $49 base writes the blog post that costs the next 50 trials.
- **Forecasting harder.** MRR vs. expansion-revenue vs. usage-revenue lines split.
- **Overage prices are the margin floor.** If $0.05/msg at Starter is too high, customers throttle their Pax usage → product value drops. Sensitivity: at $0.03/msg Starter overage, margin drops from 70% to 50% but customer-friendliness rises. Worth testing.
- **Stripe metering infra** is non-trivial: Meters + Events ingestion + invoice-line items + customer-portal cap controls.

#### Conversion implications vs. today
- Starter at $19 (vs. $20 today): **flat to slightly easier conversion.** $1/mo down.
- Pro at $49 (vs. $49 today): **identical sticker conversion.** Net wallet share grows as heavy users get billed overages.
- Scale at $99 (vs. $79 today): **25% sticker increase**, partially offset by the upsell story ("you used to need Scale at $79 with no margin floor; now Pro at $49 stretches further with overage when needed").
- **Expansion revenue** is the real upside: a Pro customer at $49 + average $30/mo overage = $79 effective = unit economics that today's Pro can't reach.
- **Estimated effect on MRR per trial:** if 30% of paying customers exceed included quota by an average of $25/mo, blended MRR/customer rises 15–20% vs. today.

---

### 2.3 Option C — Outcome-based add-on (flat base + closed-deal SKU)

**Positioning (1-liner):** AcreOS at a low flat price, plus an opt-in "Pax Pro+" SKU priced on closed-deal volume — price tracks customer success.

#### Tiers + prices

**Base platform tiers:**

| Tier | Monthly | Annual | Annual/mo equiv | Seats incl. | Quotas |
|---|---:|---:|---:|---:|---|
| **Free** | $0 | $0 | $0 | 1 | Same as today (50/3/2/25). |
| **Starter** | $29 | $290 | $24.17 | 1 | Same as Option A. |
| **Pro** | $79 | $790 | $65.83 | 2 | Same as Option A. |
| **Scale** | $149 | $1,490 | $124.17 | 5 | Same as Option A. |

Base tiers behave like Option A: hard caps, no overage, Pax monthly not daily, BYOK on Pro+.

**Plus the add-on SKU:**

**"Pax Pro+"** — opt-in, separately billed.
- **Setup fee:** $0 (no friction to enable).
- **Monthly platform fee:** $0.
- **Closed-deal fee:** **$99 per closed land transaction** (closed = purchase or assignment recorded in AcreOS with a closing date in the past 30 days), capped at **$500/mo** to prevent a 10-deal month from feeling like extortion. Customer opt-in is a one-time toggle per org.
- **In exchange:** unlimited Pax messages, unlimited skip traces, white-glove onboarding, named CSM (when Phase 2+).

The add-on is the upside-capture vehicle. Base tiers are the floor.

#### Soft-cap behavior on base tiers
Same as Option A: hard caps, 75%/90% warning, upgrade prompt at 100%. **Add-on customers see no Pax cap.**

#### Unit economics modeling

**Base tiers behave identically to Option A — refer to §2.1 for full math.** Summary at 50% util: Starter 25% margin, Pro 31% margin (BYOK-DM adj), Scale 30%+ margin (after Scale-cap-tightening from §2.1).

**Pax Pro+ add-on economics:**

Assumption: a customer who turns on Pax Pro+ runs 4,000–8,000 Pax messages/mo (heavy use). Cost to us: $60–$120/mo of AI COGS + ~$30 of skip-trace + ~$20 misc. **Total cost to AcreOS: ~$110–$170/mo.**

Closed-deal revenue: a typical land investor closes 1–4 deals/mo at scale. At $99/deal:
- 1 deal/mo = $99 add-on revenue. Cost $110. **Margin −$11 (loss leader).**
- 2 deals/mo = $198 add-on. Cost $130. **Margin +$68.**
- 4 deals/mo = $396 add-on. Cost $170. **Margin +$226 (57%).**
- 5+ deals/mo = $500 cap. Cost ~$200. **Margin +$300 (60%).**

**The unit economics of Pax Pro+ depend on customers actually closing 2+ deals/mo.** A 1-deal customer is a loss; a 4-deal customer is the model. We can only sell Pax Pro+ to customers we **believe** will close 2+ deals/mo, which is a real qualification problem at trial signup.

**Trigger-mechanism nuance:** the close-deal-recorded event is in the existing schema; we'd add a billing hook. Refunding if a customer accidentally records a closed deal becomes a real ops problem (dispute resolution).

#### Target customer per tier
- **Free / Starter / Pro:** as in Option A.
- **Scale ($149):** funded teams who want predictable cost; same as A but lower price because the heavy-user upsell is the add-on.
- **Pax Pro+ add-on:** the closing-machine operator — closes 2–5 deals/mo, doesn't mind paying a success fee, values the unlimited-Pax + named-CSM upgrade.

#### What makes this different from A and B
**Tradeoff:** the **add-on aligns price with value** at the closing event — psychologically defensible ("pay only when you make money"). But:
1. Closing-event billing is **trust-loaded** — customers may delay marking deals closed, dispute the fee, or claim a deal was AcreOS-aided when it wasn't.
2. **Revenue is lumpy** — a slow month for the customer is a slow month for us.
3. **Pax Pro+ at the loss-leader 1-deal customer is structurally underwater** without lifetime payback.
4. **Margin is highest in this option at the top end** ($500/mo cap = $5,500/yr ARPU for the heaviest add-on subscribers, plus the $149 base = $6,200/yr) — but only for customers who close consistently.

**Constitutional question:** charging per-deal could be read as AcreOS taking a cut of the customer's transaction. The native-e-sign + product-architecture positioning says AcreOS is a tool, not a broker. A per-deal fee may legally and ethically be re-readable as a brokerage/finder's fee in some states (CA, NY, TX have prohibitions). **This requires Beatrice (CRO) sign-off before it ships.** See §5.

#### Risk / sensitivity
- **Legal risk on per-deal billing** — Beatrice review required before customer comms.
- **Customer-trust risk** — a closing-event-driven invoice that the customer disputes erodes the relationship.
- **Adverse selection** — the customers most likely to opt into Pax Pro+ are the ones who think they'll close cheap; they're the loss-leaders. The high-volume closers may avoid it because the cap suggests it's expensive.
- **Forecasting hardest of the three** — closes are seasonal, lumpy, and operator-driven.

#### Conversion implications vs. today
- **Base-tier conversion** matches Option A (already analyzed: Pro +37% MRR/trial after a 15% conversion drop).
- **Add-on attach rate** is the unknown. If 10% of Pros opt in and average 2 closes/mo, that's an additional $20/mo blended per Pro customer = +25% MRR on Pro customer base.
- **Risk: the add-on becomes nobody's choice** because it's structurally different from how SaaS is bought. Predictable monthly cost is what operators want. The add-on may simply not move.

---

## 3. Lena's recommended pick

**Pick: Option A — tighten + simplify.**

**1-line reasoning:** Today's pricing has two confirmed structural margin defects (Starter daily-cap and Scale unlimited-AI) and zero margin-protective enforcement around the credit pool; Option A is the only one of the three that fixes both defects with the least new infrastructure, the most predictable unit economics, and a customer comms story that's defensible in one sentence ("we replaced the confusing daily AI gate with a monthly Pax-message budget; higher prices reflect real product cost").

**Honest downsides:**
1. **Revenue per heavy user is capped** by the tier sticker — we leave money on the table at the top end.
2. **Pro at $79** is a 61% sticker increase — the bet is that the trial→Pro pipeline is product-loved enough to absorb it. If we're wrong by more than ~15% on conversion sensitivity, this is a worse business than today.
3. **No upside-capture vehicle** for the 5%–10% of customers who would gladly pay $300/mo for unlimited Pax. We capture them at $199 Scale and leave the upside.
4. **Doesn't ship the vertical packs** — the substrate at `tier-pricing.ts` VERTICAL_PACKS sits unused. That's deferred to a follow-on (or Phase 2 layered on top of Option A).

**Why not B:** Stripe metering + cap UI + customer comms is a real build (estimated 2–3 weeks of engineering). The bill-shock risk at trial conversion is the single biggest threat to Phase 0 → Phase 1 expansion. The math says B might win at steady state; the path-dependent risk says A is the safer bet for the next $200 → $1,000 MRR ladder.

**Why not C:** legal + customer-trust risk on the per-deal fee. The model only works if Beatrice clears it AND if 10%+ of Pros opt in AND if the typical opt-in closes 2+ deals/mo. Three conditional yeses to get to upside. Too many.

---

## 4. Sequencing if Tom picks Option A

### 4.1 Order of shipping

1. **Bug fixes first (independent of pricing reset)** — see §5. Fix the Starter daily/monthly gate and the Scale unlimited AI gate **before** any price change. These ship first because they protect margin on existing customers regardless of what the new structure looks like.
2. **Monthly-Pax-message quota substrate** — replace the `ai_requests` (daily) gate with a `pax_messages_monthly` quota in `tier-limits.ts` and the corresponding monthly-window counter in `usageLimits.ts`. Old field stays read-side for back-compat for 1 cycle.
3. **New tier prices in `tier-pricing.ts` behind a feature flag** — `pricing_v2_enabled` defaulted off. Existing customers stay on grandfathered prices via a `pricing_version` column on `organizations`.
4. **Pricing page + landing copy updated** — only after (1)+(2)+(3) land. Landing copy.ts pricing.sub gets the new "$65/mo Pro" reference.
5. **Stripe price IDs created + env vars wired** — new ladder, new IDs. Old IDs stay live for grandfathered customers.
6. **Existing-customer comms** — see 4.2.

### 4.2 Pre-launch dependencies

- **Bug fixes (§5)** must land.
- **`pax_messages_monthly` counter** (new) implemented + tested.
- **75%/90%/100% usage banner** updated for new quota.
- **Credit-pool enforcement** is **not** a dependency for Option A — Option A's hard caps live in `tier-limits.ts`, not `credit-weights.ts`. The credit-pool substrate can stay foundation-only for now; Option B and C would need it activated.
- **Annual-vs-monthly toggle copy** updated to show new effective monthly figures.
- **Pricing-page A11y** — the `<table>` already has scope+role; just verify when the row labels change.
- **Customer-comms email template** — drafted by Soren + Beatrice review, queued for send 7 days before flag flip.

### 4.3 Migration path for existing trial users

- **Trial customers on the old free trial:** finish their trial at old prices. On conversion, see new tier ladder.
- **Trial customers within last 7 days of trial:** Tom's call — either honor old prices for 12 months (grandfather), or let them choose at trial end with no surprise. **Lena recommends grandfather for 12 months** because the alternative reads as a switch-and-bait.
- **Paid customers on old tiers:** grandfather indefinitely; new sign-ups only land on new tiers. The MRR math gets a one-time blend (grandfathered cohort + new cohort) which is fine because Stripe carries both price IDs cleanly.
- **At month 13 post-flip:** grandfathered customers get a 60-day-notice migration email. They can stay on the old tier (decision: do we keep old SKUs live forever or sunset?) — recommend **keep old SKUs live for 24 months total**, then a forced migration with 90-day-notice and a 1-month price-match for cooperation.

---

## 5. Open questions for Tom

These are the things that block the choice or that Lena cannot answer alone:

1. **Conversion-rate sensitivity.** Lena's recommendation depends on Pro sticker going $49 → $79 absorbing <15% trial-conversion drop. We have no live A/B data. Decision: is Tom comfortable shipping the change and measuring, or does he want a paid-prospect study first? My take: ship; measure; revert if conversion falls >25% in the first 30 days post-flip.

2. **Closing-event SKU constitutional / legal question.** If Option C is in play at all, Beatrice (CRO) sign-off is required on whether per-deal billing reads as brokerage/finder's-fee in any of CA/NY/TX/FL. **Lena cannot answer this; legal must.**

3. **Vertical-pack rollout.** `tier-pricing.ts` lines 119–196 defines packs ($100–$200/mo addons for Note Investor, Property Management, Fix-and-Flip, Subdivision, Wholesale). None of the three options above launches them. Question: does Tom want packs as a Phase 1.5 add-on after the pricing reset stabilizes, or does he want pack-pricing folded into the option-A ladder (e.g. Pro = base, Pro+NotePack = $179)?

4. **Annual discount rate.** Today is ~16–17%. Option A's $290 Starter annual is 16.7% off; Pro $790 is 17.3%. Question: hold at current depth, or sharpen to 20% to push annual adoption + reduce Stripe processing fees? My take: hold.

5. **Grandfather window.** §4.3 recommends 24 months total (12 silent + 60-day notice). Question: shorter (12 months total), longer (36 months), or pick on the comms tone Tom wants to set?

6. **BYOK-DM enforcement.** Option A's Pro math assumes 70% of mail goes BYOK. If we're wrong, the realistic operating envelope at Pro is worse than modeled. Question: do we require BYOK-mail-keys-or-pay-overage at Pro, or trust the natural mix? My take: require BYOK on Pro+, with platform-DM as a hard cap (e.g. 300 platform pieces/mo on Pro, BYOK unlimited).

7. **The two confirmed bugs ship independently — yes or no?** §5 recommendation is to fix them **before** any pricing decision lands. Tom's signoff to ship those as a separate small PR (one for the Starter daily-monthly gate, one for the Scale AI cap) is the precondition for everything else in this doc.

8. **Founder + enterprise tier handling.** The Founder synthetic tier (`FOUNDER_TIER_LIMITS`) and the gated Enterprise tier (`pricing_enterprise_tier_enabled: false`) don't change in any of the three options. Confirmation that these stay as-is.

---

## Appendix — quick reference

- **AI blended cost per turn (cost-to-us):** $0.015 (`credit-weights.ts` ai_turn_avg = 1.5).
- **Allocation policy:** 25% tax / 10% refund / 5% profit / 5% draw / **55% opex** (`allocation-policy.ts` line 48–54).
- **Effective monthly revenue reaching opex_available:** sticker × 0.55.
- **Stripe processing assumption:** 2.9% + $0.30 (monthly card); 0.8% capped $5 (annual ACH).
- **DM-BYOK adjustment used in Pro/Scale math:** platform-DM cost × 0.30 (assumes 30% of customers route mail through AcreOS at any volume; rest BYOK).
- **Mix assumption (revisitable):** AI 60% / DM 20% / SMS+email 10% / skip 10% of credit-pool spend.

---

*End of document.*
