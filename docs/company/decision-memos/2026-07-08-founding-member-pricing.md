# Decision memo — Founding-member pricing + seat restructure (2026-07-08)

**Decider:** Founder (explicit, via structured decision in session).
**Status:** DECIDED — seat + surfacing changes shipped; price raise is a
scheduled future action with a trigger, not a today action.

## Context

Pricing review during launch week (competitive anchors: PropStream $99
single tier, DealMachine $99–$399, REISift $49–$149). Structure judged
sound (3 tiers + credit pool + BYOK relief valve); the ceiling judged
low for a product whose promise is an autopilot that does the work, sold
to customers transacting $30k+ deals.

## Decisions

1. **Launch at current prices as explicit founding-member pricing.**
   $20 / $49 / $79 stand through launch. The first ~25 customers keep
   their price for as long as they stay subscribed. Mechanism: Stripe
   subscriptions retain their price when list prices change later — no
   migration needed, the promise is the default behavior. The pricing
   page now says this out loud (founding-member note, /pricing).
   **Future list targets when the founding cohort fills (≥25 paying
   customers): Pro $79/mo, Scale $149/mo, Starter unchanged $20.**
   Re-run the margin math against observed usage before executing;
   raising is itself a founder hard-stop decision at that time.

2. **Seat restructure — fix the inversion at the margin.** The marginal
   Scale seat cost $40 while the marginal Pro seat cost $20 — the tier
   built for teams taxed team growth double. Scale extra seats are now
   **$25/seat** (tier-limits.ts, tier-pricing.ts, Stripe setup script;
   yearly $250). Included seats stay: Pro 2 (max 5), Scale 10 (max 100).
   *Correction recorded for honesty:* the analysis presented to the
   founder assumed 1 included seat per tier; the codebase already
   included 2/10, which is BETTER than the "bundle 3 seats into Scale"
   option chosen — so included counts were left alone and only the
   marginal price moved. Also fixed: tier-pricing.ts seat comments had
   drifted from tier-limits.ts ("after the first" vs includedSeats).
   KNOWN residual drift, deliberately not touched in a pricing commit:
   tier-pricing.ts `maxSeats: null` vs tier-limits.ts `maxSeats: 5/100`
   — enforcement reads TIER_LIMITS; reconcile in a coherence pass.

3. **Starter included turns stay 750 — watch, don't cut.** The 56%
   worst-case COGS bound ($11.25 of $20) is a bound, not an observation.
   Trigger to revisit: cockpit usage data showing real Starter orgs
   approaching the 750-turn BYOK threshold. If it bites, cut included
   turns (750 → 500) rather than raising the $20 price.

4. **Credits surfaced as tier value.** The pricing table now shows
   "Data & mail credits / month" per tier (creditPool). Long-term
   revenue posture: subscription priced for adoption, credits carry
   variable value and expansion revenue.

## Explicitly rejected (for now)

- Raising any list price during launch week (no usage data; the low
  price is the founding-member story).
- Per-deal success fees (broker-licensing exposure in some states —
  any future outcome pricing must be framed as usage pricing).

## Follow-ups

- [ ] When paying customers ≥ 25: founder decision memo for the list
      raise (Pro $79, Scale $149), with observed margin math attached.
- [ ] Coherence pass: reconcile tier-pricing.ts vs tier-limits.ts
      maxSeats fields into one source.
- [ ] When Stripe keys land: run setup-stripe-subscription-products.ts
      so the $25 Scale-seat price exists; archive the $40 price.
