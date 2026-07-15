# Pricing & Usage-Rail Sunset — proposal for founder decision

_Prepared 2026-07-15 ("Prep sunset + proposal"). This is a PROPOSAL. Pricing
is a permanent hard-stop: every number here is a placeholder for a founder
decision card — nothing in this doc sets a price. Companion to
`home-base-reshape.md` (rule 6: price reflects owned value)._

## The current model

- **Subscription**: Free $0 · Starter $20/mo · Pro $49/mo ($490/yr) ·
  Scale $79/mo (+per-seat on Pro/Scale). Vertical packs (Note Register
  $100/mo, etc.) on top.
- **Usage credit pool**: each tier includes a monthly pool (Free 50 · Starter
  750 · Pro 1,500 · Scale 6,000 credits, 1 credit ≈ $0.01 of provider COGS).
  Metered actions (SMS, email, mail, paid data, AI turns) debit the pool.
- **BYOK already bypasses the pool** — a connected key makes that channel's
  spend bill to the customer, platform COGS $0.

The structural problem the pool creates: it puts **provider COGS on our P&L**.
The margin notes in `tier-limits.ts` are explicit — Starter runs ~$11.25 COGS
against $20 (≈56% of revenue, thin), Pro ~$15.50 against $49. Reselling
postage/SMS/data is a thin, liability-bearing line.

## What the reshape already changed

The AI rail is the template: past a monthly turn threshold, Starter+ **must**
BYO an AI key (`aiTurnsByokThreshold`). It's shipped, battle-tested, and it
moves AI COGS off the P&L at scale without a hard wall. R1/R1d extended the
same BYOK bypass to comms and data. The question is only **how far to push it**
and **how price should follow**.

## Three options

**Option A — Hybrid retained (status quo+).** Keep platform rails; keep the
pool; BYOK stays optional. Simplest; changes nothing. Keeps the thin-margin
COGS line and the associated liability (sender-of-record on our keys). Weakest
on the reshape thesis.

**Option B — BYO-only sunset.** Retire platform rails entirely; pure
subscription; every send/lookup runs on the customer's own connected account.
Cleanest liability posture and 80–90% subscription margins (home-base-reshape
§"safer AND more profitable"). Cost: onboarding friction — a user can't send
until they connect a rail (SMS still gates on A2P regardless). Free data
(open-data) stays the instant-value hook so first-run value survives.

**Option C — Phased threshold (RECOMMENDED).** Generalize the AI model to
every rail: platform rails are the "first taste" inside a capped included
allowance; past the per-rail threshold (or at Pro+), BYO is required. Value
before friction — a new user sends their first mailers / runs their first
lookups on our rails, then graduates to their own key exactly when volume
makes their own account cheaper anyway. Moves COGS off the P&L at scale,
preserves the activation wedge, and reuses a proven mechanism. It is the
smallest step from where the code already is.

## Why C

It's the reshape's own logic applied consistently: keep the intelligence and
the instant-value data free/included, move the *usage COGS* to the customer at
the point where they're a real operator. It doesn't gamble the activation
wedge (the free-first-send, the first parcel check) and it doesn't strand the
liability posture in the hybrid middle. B is the destination; C is the ramp to
it that a launching product can actually run.

## The decision cards you set (I never set a price)

1. **Direction** — adopt A, B, or C. (Recommend C.)
2. **Per-rail BYOK thresholds** (if C) — the included allowance before BYO is
   required, per rail (SMS, email, mail, data), mirroring `aiTurnsByokThreshold`.
   You set each number.
3. **Subscription prices** — if the value proposition shifts (COGS leaves the
   P&L, data becomes a paid tier post-MRR), the tier prices may re-rate. Every
   price is yours. `tier-pricing.ts` is the single source of truth.
4. **Data-tier timing** — home-base-reshape defers paid-data gating to "after a
   little MRR." You set the MRR trigger and which data surfaces move behind the
   paid tier.
5. **D4 free-first-send form** — keep the capped free first send, convert it to
   a "your first Lob invoice on us" credit, or replace it with the free-analysis
   hook. Your call.

## Next step (mechanical, on your pick)

Once you pick a direction, I seed these as real founder **decision cards**
(the `seedCostDecisionCards` marker-guarded pattern) so you approve the actual
numbers in-app — no pricing change ships until you do. Nothing here is
auto-executed.
