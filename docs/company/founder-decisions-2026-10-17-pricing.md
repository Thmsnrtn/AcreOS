# Founder decisions — 2026-10-17 (pricing and production deploys)

**Date:** 2026-10-17

**Source:** commits the founder pushed to `main` on 2026-10-17, each marked
"founder-approved 2026-10-17" (`05cf5804`, `f9e7f6a5`) or "Approved by Tom
2026-10-17" (`e6824a33`). This record was written afterwards, from those
commits, so the decisions have a dated home like every other pricing ruling.
Only the founder can rescind them.

## Plan prices: $49 / $99 / $199

| Plan | Before | After (monthly) |
|---|---|---|
| Starter | $20 | $49 |
| Pro | $49 | $99 |
| Scale | $79 | $199 |

- Yearly stays at 10× monthly (the "Save 17%" badge).
- Seat add-on prices are unchanged.
- Lives in `shared/billing/tier-pricing.ts` (`TIER_PRICES_CENTS`).
- **Operational follow-up:** Stripe price IDs still resolve from the existing
  env vars (`STRIPE_PRICE_SOLO_*`, `STRIPE_PRICE_OPERATOR_*`,
  `STRIPE_PRICE_EMPIRE_*`). New Stripe prices must be created and the Fly
  secrets updated before checkout charges the new amounts.

## AI allowances scale with price; Free is a taste

- Shared monthly AI allowance: Starter $25, Pro $50, Scale $100 (each still
  strictly below its plan price — pinned by the invariant test).
- Free: 5 AI requests per month (was 75); credit pool 25 (was 50).
- Lives in `shared/billing/tier-limits.ts`.

## Production deploys are manual

- `.github/workflows/deploy.yml` runs on `workflow_dispatch` only (one click in
  the Actions tab). Pushes to `main` no longer deploy production.
- The full pre-deploy gate still runs on every manual dispatch.
- Staging (`staging.yml`) still deploys on push.
- `DEPLOY_FROZEN` remains the emergency brake.
- Reason: a push that turned the gate green would also have deployed
  production in the same run, against the founder-only production rail.
- Consequence to remember: merging to `main` does not change production.
  Someone has to run "Deploy to Fly.io" from the Actions tab.
