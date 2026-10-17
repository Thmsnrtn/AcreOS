# Founder decisions — 2026-10-12

**Date:** 2026-10-12

**Source:** the founder's answer, relayed by the coordinating session to the
implementing session on `claude/billing-entitlement-truth`. This record was
written by the implementing session from that relay; it did not see the
original answer.

This is a plan-inclusion decision. It is a founder hard-stop (CLAUDE.md
DO-NOT-DO list; `shared/governance/constitution.ts`,
`hard-stop.pricing-changes`). This page is the explicit founder decision that
hard-stop requires. Only the founder can rescind it.

## Included Pax turns are free

**The question it answers.** Pax chat charged 2¢ of purchased credits for
every platform-key turn and refused the turn when the purchased balance could
not pay. A paid org past its trial, with no own AI key and no purchased
credits, was therefore refused Pax while still inside its plan's included
messages (`TIER_LIMITS.ai_requests`, shown on /pricing) and its shared monthly
AI allowance (decision C of 2026-10-08).

**The decision.**

- Within a paid plan's included Pax, a platform-key turn neither requires nor
  charges purchased credits. "Included" means both:
  - under the plan's monthly message cap (`TIER_LIMITS[*].ai_requests`); and
  - under the shared monthly AI allowance (`TIER_LIMITS[*].aiAllowanceCents`,
    decision C of 2026-10-08).
- Credits, or the org's own AI key, are needed only once the included
  allowance is used up.
- Trial behaviour is unchanged: inside the trial window a turn is paid from
  the org's own balance first, then the trial's free allowance.
- BYOK behaviour is unchanged. What happens past the allowance is set by the
  2026-10-17 answers below.

**Where it lives.**

- One rule: `server/services/paxTurnFunding.ts` (`paxTurnFunding`, lanes
  founder / byok / included / credits). Its allowance test is
  `aiAllowanceRule.isAiAllowanceSpent` — the same predicate the wall
  (`checkAiTurnGate`) and the per-call enforcement
  (`aiAllowance.enforceAiAllowance`) use. Its trial test is
  `credits.isInTrialWindow`, the one the trial credit lane uses.
- Every customer-triggered Pax charge site consults it: `/api/ai/chat`,
  `/api/ai/chat/stream`, `/api/properties/:id/analyze` (deal chat),
  `/realtime/ask` (command palette) and `/api/leads/:id/nurture`.
- Pinned by `tests/unit/paxTurnsIncludedAreFree.test.ts`, which enumerates
  every `ai_chat` credit charge site in `server/` so a new one cannot be added
  without deciding its lane.

Background `ai_chat` work: see 2026-10-17 below.

## 2026-10-17 — past the allowance, credits fund Pax; background AI follows the same rule

**Date:** 2026-10-17

**Source:** the founder's answers to two follow-up questions, relayed by the
coordinating session to the implementing session on
`claude/billing-entitlement-truth`.

### A. Purchased credits fund Pax turns past the allowance

- The 2026-10-12 answer already decided it: credits, or the customer's own
  key, kick in once the allowance is used up. So past the included allowance:
  - purchased credits fund platform-key Pax turns, metered at the existing
    per-turn price (`USAGE_ACTION_TYPES.ai_chat`, 2¢); and
  - the org's own AI key still serves turns, unchanged.
- The allowance wall accepts both:
  - the chat wall (`aiByokThresholdGate`) lets a turn through when the org's
    purchased balance covers one turn; the route's credit lane checks and
    charges it;
  - the per-call enforcement (`aiAllowance.enforceAiAllowance`) lets a
    customer AI call through on the platform key only when it is a Pax turn
    whose route has passed the credit check on the org's own balance. The
    route mounts `paxTurnScope()` and calls `markPaxTurn`
    (`server/services/paxTurnContext.ts`, per-request `AsyncLocalStorage.run`).
  - Other customer AI features past the allowance have no per-call meter of
    their own, so credits do not fund them. They are still refused with the
    own-key path, and their refusal does not offer credits.
- The refusal past the allowance names only what works:
  - "Add credits, or connect your own … key" when the plan allows an own key;
  - "Add credits" alone when it does not.
- **The AI cost ceilings are unchanged and still apply.** The per-org,
  tier-proportional ceiling and the platform-wide ceiling
  (`aiCostCeiling.assertWithinAiCostCeiling`, run by `aiRouter` and
  `aiSpendGuard` for every non-BYOK call) bound credit-funded turns exactly as
  they bound included ones. A turn past a ceiling is refused even with
  credits. Only own-key calls skip them, as before.

### B. Background AI jobs follow the same rule as chat

- `campaignOptimizer` and the `leadNurturer` batch run charge no credits while
  the org is inside its included allowance, and charge per unit after it.
  - Each consults `paxTurnFunding` once per run.
  - Their reported `creditsUsed` counts only units actually charged.
- Every `ai_chat` credit charge site in `server/` now adopts the rule. The
  population test has no "outside the decision" register any more.
- Background work is still not counted toward the allowance
  (`origin = 'background'`, decision C of 2026-10-08), and it is not gated by
  the allowance wall.

**Pinned by** `tests/unit/paxTurnsIncludedAreFree.test.ts`.
