# Overhead operating costs — a fresh, honest model

_Prepared 2026-07-15. What it actually costs to RUN AcreOS live, post-reshape.
Every figure is a labelled ESTIMATE with its assumptions stated — treat as a
planning model, not a quote. Money/pricing decisions remain founder
hard-stops; this only sizes the cost side._

## The headline

After the reshape, AcreOS has **one meaningful variable cost: AI.** The rails
(SMS, mail, email, skip-trace) left the P&L with the customer. Data is free
open-data until you switch on paid providers. Infra is small and mostly
fixed. So the whole cost question reduces to: _how much AI does the platform
burn — on your side (Solene + autopilots) and on the user side (Pax) — and how
much of the user side does BYOK push back onto customers?_

Estimated total overhead lands at roughly **4–8% of MRR** once there's a
paying base, dominated by AI, with a fixed floor of **~$100–350/mo** that
exists even at zero customers (Solene runs the company regardless).

## 1 · The fixed floor (independent of customer count)

These come from the minimal live-key set (`live-operation-keys.md`). Early
tiers are mostly free; here's the realistic monthly floor as you cross their
free limits:

| Line | Early (0–25 cust.) | Growing (100–500) | Notes |
|---|---|---|---|
| Hosting (app + worker) | $0–40 | $40–150 | Fly.io / similar; scales with instances |
| Postgres (managed) | $0–25 | $25–120 | Neon/Supabase free → paid as data grows |
| Clerk (auth) | $0 | $25–100+ | Free to ~10k MAU, then per-MAU |
| Voyage (embeddings) | ~$1–10 | $10–40 | $0.18/M tokens; small unless heavy RAG |
| Mapbox | $0 | $0–50 | Generous free map-load tier |
| Sentry / monitoring | $0 | $0–26 | Optional |
| Stripe | % of revenue | % of revenue | 2.9%+30¢ per charge — a revenue cost, not overhead |
| **Fixed floor** | **~$0–120/mo** | **~$100–500/mo** | before AI |

Stripe fees are a transaction cost on revenue you're collecting, not
platform overhead — keep them out of the "overhead %" but in the P&L.

## 2 · Founder-side AI (Solene + autopilots) — your cost, always

This is the one cost the reshape does NOT shift — there's no customer to bring
a key. Solene runs the back office (the Letter, decision scoring, autopilot
cognition, memory retrieval). It scales with _how hard Solene works_, not
linearly with customers.

**Assumptions:** Solene does a morning-pulse pass + intraday cognition +
decision scoring. Model mix via the aiRouter tiers (SIMPLE→DeepSeek,
MODERATE→Haiku, COMPLEX→Sonnet, CRITICAL→Opus), with prompt caching on the big
system context. Estimate **~$3–8/day** of blended AI at launch, rising to
**~$8–20/day** as the platform operates more autonomously and holds more
memory.

- Launch (0–25 cust.): **~$90–240/mo.**
- Growing (100–500 cust.): **~$240–600/mo.** (Solene's work grows sub-linearly
  — more customers add some load, but the daily-cadence cognition is the bulk.)

This is the "cost of the AI COO." It's real, it's yours, and it's the reason
the subscription has to price in AI.

## 3 · User-side AI (Pax) — your cost within allowance, offset by BYOK

Each active customer's Pax usage draws on your Anthropic key **within their
tier's included allowance**; past the `aiTurnsByokThreshold`, they must bring
their own AI key (or stop), which moves their heavy usage off your P&L.

**Assumptions:** an active customer runs ~15–40 Pax turns/day; most turns are
MODERATE (Haiku ~$1/$5 per M) with a minority COMPLEX (Sonnet) and rare
CRITICAL (Opus); heavy context is cached. Blended **~$0.004–0.012 per turn**
→ **~$2–9 per active customer per month** _before_ BYOK offset. The threshold
caps your exposure: power users cross it and self-fund; light users stay
cheap.

| Active customers | User-side Pax AI (your cost, after BYOK offset) |
|---|---|
| 25 | ~$40–160/mo |
| 100 | ~$150–600/mo |
| 500 | ~$600–2,500/mo |

The range is wide because it depends on engagement + how many power users
cross the BYOK threshold. The optimization work already shipped (DeepSeek for
simple tasks, Haiku/Sonnet tiering, prompt caching, cascade-escalation only
when needed, the BYOK threshold) is what keeps the low end reachable.

## 4 · Data & rails — ~$0 early, by design

- **Property data:** free open-data (FEMA/USDA/USGS/Census) costs nothing.
  Paid providers (ATTOM/Regrid/BatchData) are deferred "until MRR clears" and
  are then largely BYO (R1d) — customer-keyed lookups are platform-COGS $0.
- **Comms rails (SMS/email/mail/skip-trace):** customer-owned. **$0 to the
  platform.**

## 5 · Putting it together (blended estimate)

| Scale | Fixed floor | Founder AI (Solene) | User AI (Pax, net) | **Total overhead/mo** | As % of MRR* |
|---|---|---|---|---|---|
| 25 cust. | ~$50 | ~$150 | ~$100 | **~$300** | ~7–12% |
| 100 cust. | ~$150 | ~$350 | ~$350 | **~$850** | ~4–8% |
| 500 cust. | ~$400 | ~$500 | ~$1,500 | **~$2,400** | ~3–6% |

\*MRR assumed at a blended ~$40–50/customer (Pro-weighted). The % _falls_ with
scale because the founder-AI floor amortizes and BYOK offsets more of the user
side — healthy operating leverage.

## The levers (already in place, and next)

**Shipped:** model tiering (DeepSeek/Haiku/Sonnet/Opus by task), prompt
caching (1024-char threshold, cascade-escalation stamps cache), corrected
rates, Pax cost ceilings + degrade-to-Haiku on thin budget, BYOK threshold on
AI.

**Available next (founder decision, per the pricing proposal):** the phased
usage-rail sunset (pure subscription), a data-tier gate after MRR, and
lowering the AI-BYOK threshold to push more heavy usage to customer keys.

## The one-sentence version

Post-reshape, running AcreOS is **cheap and mostly fixed** — a small infra
floor plus the AI that IS the product; total overhead ~4–8% of MRR at scale,
and the only line that grows with success (user-side Pax) is the one BYOK is
built to cap.
