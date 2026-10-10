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
| Scale | — (see 2026-10-09 below) | 4,500¢ ($45.00 / month) |
| Free, Enterprise | — | no allowance wall (as before) |

Scale's derived allowance of $90 was above its $79 price. The founder replaced
it on 2026-10-09 (below).

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

## 2026-10-09 — Scale's AI allowance is $45.00 / month

**Date:** 2026-10-09

**Source:** the founder's picker answer in the coordinating session, relayed
the same way as the decisions above.

- Scale's shared monthly AI allowance is **4,500¢ ($45.00)**, replacing the
  turn-derived $90.
- Starter stays at $11.25 and Pro at $22.50.
- The allowances are now explicit per-tier cent values (`AI_ALLOWANCE_CENTS`
  in `shared/billing/tier-limits.ts`), not derived from the turn threshold.
- Rule: an allowance stays below its plan's monthly price. $45 is 57% of $79.
  `aiAllowanceBelowPrice` in `tests/unit/founderDecisions20261008.test.ts`
  fails if any tier's allowance reaches or exceeds its price.
- **Not changed:** the Scale chat turn threshold (6,000). It no longer gates
  anything by itself, because the gate measures cents. At the documented
  1.5¢ blended cost per turn, Scale chat reaches the $45 cap at about 3,000
  turns, roughly half the 6,000 threshold. The cents cap is the operative
  wall.

## 2026-10-09 — mail-credit recharges are granted

**Date:** 2026-10-09

**Source:** relayed by the coordinating session.

- Paid mail-credit recharges now grant at 1.5¢ per credit, on the amount
  actually paid and rounded down, exactly once per checkout session.
- Credits go to the purchased-credit balance. Mail sends spend that balance
  after the included monthly pool is exhausted, and it never resets.
- Historical payments are **not** auto-granted.
  `scripts/billing/list-ungranted-mail-recharges.sql` (read-only) lists how
  to find the customers to make whole.

## 2026-10-09 — routine support is answered without a per-ticket tap

**Date:** 2026-10-09

**Source:** relayed by the coordinating session.

- Routine support tickets from AcreOS's own customers are answered by the
  support agent (Solene) without the founder tapping each one:
  - how-to questions;
  - account questions;
  - refunds of $50 or less (the existing `REFUND_CEILING_CENTS`).
- Still held for the founder:
  - anything legal (the legal-intake classifier);
  - money above $50;
  - an angry or upset customer;
  - anything the policy cannot classify. It fails closed.
- A held ticket is assigned to the founder and asked once, never repeatedly.
- Every automatic release is recorded in the Story door as `support_auto_answer`
  or `support_auto_refund`, and every hold as `support_held`. Each release goes
  through the witnessed-send kernel under the named delegation
  `policy:routine-support-2026-10-09`, so the drift sentinel and the panic stop
  still see it.
- **Scope.** This covers AcreOS answering its own customers. Pax acting *for* a
  customer is unchanged: every customer-facing send still waits for a human
  tap (`ai.customer-sends-are-witnessed`).
- **Where it lives:**
  - `server/services/support/routineSupportPolicy.ts` and
    `routineSupportSweep.ts`;
  - registry entry `ai.routine-support-released-within-policy`;
  - ratchet `tests/unit/routineSupportAutonomy.test.ts`.
- **Target:** under 24 founder minutes a week across a simulated year, with no
  dropped tickets. The measured result is in `roadmap-2026-10.md` (wave W1a).

## 2026-10-09 — Tennessee is the showcase state

**Date:** 2026-10-09

**Source:** relayed by the coordinating session.

- The data-foundation wave preloads Tennessee: vacant and rural parcels from
  the verified statewide source, with per-fact source and confidence.
- Every other county is processed on demand. Where no free source exists,
  the customer sees a refusal and a "request this county" option.
- Nothing is shown to customers until a hand-checked sample passes.
- Scheduled as wave W2 in `roadmap-2026-10.md`.

## 2026-10-09 — giving: $1 per paying member per month

**Date:** 2026-10-09

**Source:** relayed by the coordinating session.

- AcreOS gives **$1 per paying member per month**, from its own revenue, to a
  food bank serving the member's area, matched by county.
- The member page shows only real, receipted totals. No projected or
  "pledged" amounts are shown as given.
- Recurring donations run under a founder-set cap. A spend above $500 stays a
  founder-only hard stop.
- This is AcreOS's own money on AcreOS's own account. It is not customer money
  and does not touch the money-custody ban.
- Not built yet: scheduled as wave W5.

## 2026-10-09 — strategy docs move to a private repo

**Date:** 2026-10-09

**Source:** relayed by the coordinating session.

- `docs/company/` moves to a private repository once the founder creates it.
  Engineering then removes it here and leaves a pointer.
- **Caveat:** git history keeps every earlier copy public. Removing the
  directory hides only future edits. The past is hidden only by making this
  repository private, or by rewriting public history, which is not
  recommended.
- **Founder action:** create the private repository.

## 2026-10-10 — support autonomy raised to execute_gated

**Date:** 2026-10-10

**Source:** the founder's picker answer in the coordinating session.

- The support domain's autonomy level defaults to **execute_gated**
  (`DEFAULT_DOMAIN_LEVEL` in `server/services/autopilot/domainAutonomy.ts`).
  - This is the existing autonomy-level mechanism; no gate is bypassed.
  - Before this, the support domain sat at DRAFT, so the founder had to
    approve each triage pass before a single reply was drafted. In the
    simulated year that cost 106 of 232 approval asks, and 71 of them timed
    out while tickets aged.
- Every drafted reply or refund still passes the 2026-10-09 routine-support
  policy, one at a time:
  - routine tickets only;
  - refunds of $50 or less;
  - legal, angry and unclear tickets held for the founder.
- The earned-autonomy circuit breaker is unchanged:
  - a failed action demotes the domain one level;
  - the panic stop quarantines every domain to observe.
- **Founder action:** confirm the level in production with Controls → Trust
  levels → support → execute_gated. Seeding only applies to a domain with no
  row yet.

## 2026-10-10 — routine reversible autopilot moves run and are digested

**Date:** 2026-10-10

**Source:** the founder's picker answer in the coordinating session. This is
plan item W1-4.4.

- Ops and deploy default to **execute_gated** (`DEFAULT_DOMAIN_LEVEL`). A
  routine, reversible move there that passes every gate runs without a
  per-move ask.
- The founder sees what ran in a weekly digest behind the **Decisions** door
  (`/founder/decisions`, "Ran on its own this week"; no new route). The
  weekly founder email summarises the same items.
- Every item has an **undo**:
  - if the work has not finished, undo cancels it;
  - if it already ran, its effect is not reversed. The undo records a
    declined verdict and drops the domain to DRAFT, so the next move asks
    first. The page and the toast say which of the two happened.
- Still asked first, even when every gate passes (`digestLaneRefusal` in
  `act.ts`):
  - a move that cannot be undone;
  - a move that reaches a customer without a per-effect witness;
  - a new kind of move;
  - every hard stop: pricing, legal signing, spend over $500,
    customer-data deletion.
- Retention moves run through the support domain. Each send they draft is
  still witnessed one at a time.
- **Enforced by:**
  - registry entry `ai.digest-lane-runs-only-reversible-work`;
  - the ratchet `tests/unit/digestLaneRunsOnlyReversibleWork.test.ts`.
- **Founder action:** confirm ops and deploy at execute_gated in production
  (Controls).
