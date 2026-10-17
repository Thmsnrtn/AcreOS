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
- The allowance wall and BYOK behaviour are unchanged. Past the allowance
  without a key, the existing recoverable 429 `byok_required` applies and
  names the way forward (add your own key in Settings → Your provider keys).

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

**Not changed (out of this decision's scope).** Background jobs that charge
`ai_chat` credits without a customer turn (`campaignOptimizer`,
`leadNurturer` batch runs) keep their existing credit behaviour; they are
registered as such in the test.
