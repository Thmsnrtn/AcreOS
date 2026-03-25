# ADR-004: Credit-Based Metering for Premium Lookups

## Context

Premium data providers (Regrid, ATTOM, BatchData) charge per-lookup fees. The platform needs a pricing model that: covers provider costs, incentivizes BYOK adoption (which reduces platform costs), and doesn't surprise users with variable bills.

## Decision

Credit-based metering. Each organization has a credit balance (in cents). Premium lookups deduct credits at defined rates. Credits can be purchased as one-time top-ups or auto-replenished when balance drops below a threshold. BYOK users (Pro tier) who provide their own API keys bypass credit deduction entirely for that provider.

## Consequences

**Positive:** Usage-based pricing aligns cost with value — users who run 50 DD reports per month pay more than users who run 5, but both have predictable costs. BYOK incentive at Pro tier encourages power users to bring their own keys, which eliminates platform-side provider costs for those users. Auto top-up prevents workflow interruptions. Credit transactions are fully auditable.

**Negative:** Credit balance management adds UX complexity (users need to understand credits). Low-balance notifications must be reliable to prevent workflow interruption. Refund policy for unused credits needs to be clear.
