# ADR-007: Three-Tier Launch Pricing ($0/$20/$49)

## Context

Pricing needs to balance three goals: low barrier to adoption (land investors are cost-sensitive and skeptical of new tools), sustainable unit economics (AI and data provider costs must be covered), and upgrade incentive (free users should want to pay for the full experience).

## Decision

Three tiers at launch: Free ($0/mo), Starter ($20/mo), Pro ($49/mo). Free includes basic CRM with 100 lead limit. Starter adds Deal Feed, DD reports, and campaigns. Pro adds full AI, compliance, note management, team features, and BYOK. Two additional tiers ($99 Scale, $199 Enterprise) are feature-flagged and available but not promoted at launch.

$20/$49 was chosen over the typical SaaS pattern of $29/$59/$179 because: (1) the zero-API-cost advantage from 18 free data sources means AcreOS's marginal cost is lower than competitors; (2) a $20 entry point is below the threshold where most land investors need to "think about it"; (3) $49 for the full Pro experience undercuts every competitor while delivering more; (4) BYOK at Pro tier means power users self-serve their own data costs.

## Consequences

**Positive:** Low price point removes adoption friction. Free tier drives viral growth (land investing communities share tools). $20 Starter is impulse-purchase territory. $49 Pro is cheaper than Pebble's cheapest plan ($49) while offering 10x the features. BYOK at Pro eliminates per-lookup costs for the most active users.

**Negative:** Low prices may signal low quality to some buyers. Revenue per user is lower, requiring higher volume to reach meaningful MRR. Price increases later will face resistance. Free tier users consume infrastructure without paying — need to monitor and manage.
