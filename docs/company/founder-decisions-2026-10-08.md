# Founder decisions — 2026-10-08

**Date:** 2026-10-08

**Source:** the founder's answers to a decision picker in the coordinating
session of 2026-10-08. The coordinating session relayed the answers to the
implementing session, which built them on `claude/cost-efficiency`. This
record was written by the implementing session from that relay; it did not
see the picker itself.

These are pricing, plan-inclusion and allowance changes. They are founder
hard-stops (CLAUDE.md DO-NOT-DO list; `shared/governance/constitution.ts`,
`hard-stop.pricing-changes`). This page is the explicit founder decision that
hard-stop requires. Only the founder can rescind it.

## A. Scale credit pool: 8,000 → 3,000 for new Scale customers

- New Scale customers get **3,000** credits per month
  (`TIER_LIMITS.scale.creditPool`).
- Orgs already on Scale keep **8,000 until their next renewal**:
  - Migration 0266 marks each of them once
    (`organizations.credit_pool_grandfather`). A `founder_settings` marker row
    guards the backfill, because `migrate.mjs` re-runs every statement on
    every deploy. No table was added.
  - The Stripe webhook stamps the end date from the subscription's current
    period, and a renewal (`invoice.paid`, `subscription_cycle`) ends it.
  - Org ids are never hardcoded.
- There is one rule: `creditPool.creditPoolFor()`. The debit gate, the
  pool snapshot, the mail-credits gauge and the "what costs what" card all
  read through it. The pricing page reads `TIER_LIMITS.scale.creditPool`.
- Pinned by `tests/unit/founderDecisions20261008.test.ts`.

## B. Top-up credit packs: 1.5¢ per credit (was 1¢)

| Pack price | Credits granted |
|---|---|
| $10 | 666 |
| $25 | 1,666 |
| $50 | 3,333 |
| $100 | 6,666 |

- Prices are unchanged. Credits are `floor(price ÷ 1.5)` and always rounded
  down.
- Credits already purchased keep their value; only new purchases grant the
  new counts.
- `shared/billing/credit-packs.ts` is the one catalogue. The schema's
  `CREDIT_PACKS` (checkout and webhook grant), the purchase modal and the
  mail-credit recharge cards read it.
- Checkout builds the Stripe line item inline (`price_data`, `unit_amount` =
  the unchanged price), so **no Stripe price id changes**. The line item's
  product name now states the credit count.

## C. One shared monthly AI allowance per plan, measured in cents

Each plan's allowance is its existing turn threshold priced at the documented
per-turn cost (1.5¢, `credit-weights.ts` `ai_turn_avg`):

| Plan | Turns × 1.5¢ | Allowance |
|---|---|---|
| Starter | 750 × 1.5¢ | 1,125¢ ($11.25 / month) |
| Pro | 1,500 × 1.5¢ | 2,250¢ ($22.50 / month) |
| Scale | 6,000 × 1.5¢ | 9,000¢ ($90.00 / month) |
| Free, Enterprise | — | no allowance wall (as before) |

**Note for the founder:** Scale's derived allowance ($90) is above its $79
price. That is the arithmetic the decision specified, recorded as computed
and not adjusted.

**What counts.** Every production AI call the org triggers:

- chat;
- document intelligence;
- due diligence;
- negotiation, valuation and compliance;
- voice learning;
- agent skills;
- the rest.

These are recorded in `ai_telemetry_events` with `origin = 'customer'`.

**Past the allowance.** The org's own AI key serves the call, exactly as chat
works. With no key, the call is refused recoverably: a 429 `byok_required`
pointing at `/settings/byok`. It is never a dead end and never silent metered
overage.

**Rule for work the org did not trigger.** Background autopilot work that
serves an org but that the org did not trigger (`origin = 'background'`):

- is not counted toward the allowance;
- is never gated by it;
- is bounded instead by the per-org tier cost ceilings, and shows on the
  founder's cost-to-serve view.

`routeAITask` defaults to `background` when `skipQuota` is set, which is the
existing cron convention. Platform-internal and founder AI (Solene, autopilot
ops for AcreOS itself) has no org and is never a customer's allowance.

**Enforcement.** `usageLimits.checkAiTurnGate()` makes the decision.
`aiAllowance.enforceAiAllowance()` applies it to every metered call. The chat
route gate and the gateway therefore agree on one number.

**Transition.** Telemetry rows written before migration 0267 carry no origin
and are not counted. In the deploy month, the allowance therefore counts only
spend after the deploy, which errs in the customer's favour.

## Founder actions outside code

- **Stripe product descriptions** (live Starter/Pro/Scale products) may still
  carry the seeded copy: "500 AI requests", "1000 AI requests", "Unlimited …
  AI". Under decision C, AI is a shared monthly allowance with BYOK past it.
  Update the descriptions in the Stripe dashboard (Products → each tier →
  Description). Code cannot change live Stripe products, and
  `server/seed-products.ts` is quarantined.
- **No Stripe price changes** are needed for A, B or C.
