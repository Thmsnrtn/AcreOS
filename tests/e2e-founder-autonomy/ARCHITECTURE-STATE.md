# AcreOS platform — architecture state

**Date:** 2026-04-21 (end of extended session)

This document is the navigation reference for all autonomous-platform work shipped across the session. It captures the full 8-layer model, every new surface, the schedule, and where to look when something needs debugging.

## The 8-layer model

| Layer | Concern | Status |
|---|---|---|
| 0 | Foundation (schema, auth, kill-switch, hard caps) | ✅ Rock solid |
| 1 | Signals in (Stripe, email, support, churn → inbox) | ✅ Working |
| 2 | Reasoning (12 agents, executor, Company Mind) | ✅ Cross-wing context live |
| 3 | Actions out (sim-mode wrappers + action preview checkpoint) | ✅ Preview + audit trail |
| 4 | Outcomes (grader, trust, safety-rail trips) | ✅ Wired; experiments tapped |
| 5 | Learning loop (outcomes → trust → prompts → calibration → experiments) | ✅ Full loop |
| 6 | Strategy/proaction (proposals + tools + expansion radar) | ✅ Live |
| 7 | Interface (letter, health, trends, customization, palette, preview) | ✅ Narrative-first + navigable |
| 8 | Meta/self-awareness (calibration Brier + overconfidence bias) | ✅ Live |

## All shipped features

### Foundation (structural moves)
- **Company Mind** (`server/services/companyMind.ts`) — cross-wing context at decision time
- **Prompt Evolution Meta-Agent** (`server/services/promptEvolutionMetaAgent.ts`) — monthly LLM-driven prompt revisions
- **Founder Letter** (`server/services/founderNarrative.ts`) — monthly narrative synthesis

### Founder-side features (F-series)
- **F-1 Strategic Proposals** (`strategicProposals.ts`) — weekly + monthly synthesis pass feeding the letter
- **F-2 Calibration** (`calibration.ts`) — Brier score + overconfidence bias
- **F-3 Customization Center** (`founderSettings.ts`) — live-apply knobs at `/founder/settings`
- **F-4 Command Palette** (`founder-command-palette.tsx`) — ⌘⇧K global search
- **F-5 Action Preview** (`actionPreview.ts`) — before-commit checkpoint with cancel window
- **F-6 Tool Proposals** (`toolProposals.ts`) — capability-growth queue
- **F-7 Approval UIs** — `/founder/prompt-evolutions` and `/founder/strategy`

### Platform-level features (P-series)
- **P-1 Customer Monthly Letter** (`customerNarrative.ts`) — per-org Sophie letter at `/my-letter`
- **P-2 Decision Experiments** (`decisionExperiments.ts`) — A/B testing at decision layer
- **P-3 Onboarding Autonomy** (`onboardingAutonomy.ts`) — Sophie's 30-day scripted journey
- **P-4 Expansion Radar** (`expansionRadar.ts`) — weekly upsell-ready candidates
- **P-5 System Trends** (`systemTrends.ts`) — 90-day trust-gauge charts
- **P-6 Provider Intelligence** (`providerIntelligence.ts`) — per-provider success tracking

## Founder page map

| Page | Purpose |
|---|---|
| `/founder` | Autonomy-health card + business metrics |
| `/founder/letter` | Monthly Chief-of-Staff letter |
| `/founder/decisions` | Autonomous decision audit log |
| `/founder/preview` | Actions about to commit (with cancel) |
| `/founder/settings` | Operational knobs (hard cap, thresholds) |
| `/founder/tools` | Tool-proposal approval queue |
| `/founder/prompt-evolutions` | Prompt-revision approvals |
| `/founder/strategy` | Strategic-proposal approvals |
| `/founder/onboarding` | Customer activation journeys |
| `/founder/expansion` | Upsell-ready customers |
| `/founder/experiments` | A/B tests on decision playbooks |
| `/founder/trends` | 90-day system-improvement charts |
| `/founder/providers` | Data-layer cost + quality |
| ⌘⇧K | Global search across all of the above |

## Customer-facing page map

| Page | Purpose |
|---|---|
| `/my-letter` | Monthly Sophie letter |

## New tables this session

| Table | Purpose |
|---|---|
| `founder_letters` | Monthly founder-side letter storage |
| `customer_letters` | Monthly customer-side letter storage |
| `strategic_proposals` | Weekly + synthesized strategic moves |
| `founder_settings` | Live-tunable operational knobs |
| `action_previews` | Before-commit audit + cancel |
| `tool_proposals` | Capability-growth queue |
| `onboarding_journeys` | Per-org 30-day activation tracking |
| `onboarding_steps` | Per-step schedule + outcome |
| `expansion_candidates` | Weekly upsell-ready list |
| `decision_experiments` | A/B experiment definitions |
| `decision_experiment_assignments` | Per-(exp, org) variant assignments |
| `provider_lookup_log` | Per-lookup telemetry for data providers |

All bootstrapped via `CREATE TABLE IF NOT EXISTS` at startup. No migration required.

## Cron schedule (full)

| Job | Schedule | File |
|---|---|---|
| Morning briefing pre-generation | Daily 06:45am CT | `companyBriefingGenerator` |
| Onboarding step sweeper | Hourly | `onboardingAutonomy.sweepAndFireDueSteps` |
| Action-preview orphan sweep | Hourly | `actionPreview.sweepOrphanedPreviews` |
| Outcome grader | Daily | `autonomyHealth.gradeRecentDecisions` |
| Expansion radar | Monday 08:00 UTC | `expansionRadar.runWeeklyExpansionScan` |
| Strategic proposals — weekly | Sunday 00:00 UTC | `strategicProposals.runWeeklyProposals` |
| Strategic proposals — synthesis | 1st of month 10:00 UTC | `strategicProposals.runMonthlySynthesis` |
| Prompt-evolution meta-agent | 1st of month 09:00 UTC | `promptEvolutionMetaAgent` |
| Founder letter | 1st of month 12:00 UTC | `founderNarrative.generateMonthlyLetter` |
| Customer letters | 1st of month 15:00 UTC | `customerNarrative.runMonthlyCustomerLetters` |
| Financial approval TTL sweep | On-demand + on load | `financialAuthorityGate.sweepStaleApprovals` |

## Cost profile (updated)

| Frequency | Cost per run | Total |
|---|---|---|
| Daily operations (grader, briefing) | ~$0.05 | ~$1.50/mo |
| Weekly strategic proposals | ~$0.15 | ~$0.60/mo |
| Weekly expansion scan | $0 (pure SQL) | $0 |
| Monthly synthesis + tools | ~$0.20 | ~$0.20/mo |
| Monthly prompt-evolution | ~$0.30 | ~$0.30/mo |
| Monthly founder letter | ~$0.10 | ~$0.10/mo |
| Monthly customer letters (25 orgs × $0.08) | $2.00/run | ~$2.00/mo |
| Onboarding journey steps | $0 (no LLM for MVP) | $0 |
| Per-decision cross-wing context | ~$0.0015 × 20/day | ~$0.90/mo |
| Provider intelligence | $0 (SQL) | $0 |
| Experiments | $0 (SQL) | $0 |

**Total estimated: ~$5–7/month.**

## Commit reference

Full session commit log:

```
06d17f9 feat(mind): shared cross-wing context
0e27f02 feat(evolution): prompt-evolution meta-agent
55f2490 feat(letter): monthly founder letter
7b5d738 feat(strategy): F-1 proactive strategic proposals
00d15f8 feat(calibration): F-2 self-awareness
4630e86 feat(settings): F-3 customization center
9c7ee45 feat(nav): F-4 founder command palette
cbe6fd0 feat(preview): F-5 action preview
1d3d90a feat(tools): F-6 tool proposal pipeline
cde3a61 feat(founder): F-7 approval UIs
c3f1605 docs: architecture-state snapshot
1e661d5 fix(strategy): payments column hotfix
7c539af feat(trends): P-5 system-improvement meta-dashboard
2317595 feat(customer): P-1 customer monthly letter
2eeb7ee feat(onboarding): P-3 30-day activation journey
19fb929 feat(growth): P-4 expansion radar
2323f63 feat(experiments): P-2 decision A/B framework
0a847aa feat(providers): P-6 data-provider intelligence
```

## Safety invariants (still held)

- `SIMULATION_MODE=true` short-circuits every external side effect
- Financial hard cap blocks autonomous spend above the configured ceiling
- Prompt revisions NEVER auto-apply — always founder-gated
- Strategic proposals NEVER auto-execute — always founder-gated
- Tool proposals NEVER auto-build — always founder-gated
- Expansion upgrades NEVER auto-send — always founder-gated
- Experiments NEVER change existing behavior without explicit start+running status
- Action previews: commit contingent on `status = 'pending'` at commit time
- Onboarding: sim orgs opt out of real journeys to keep test state clean

## What would be next (judgment-calls)

Further work past this session needs founder input on direction:

- **Inter-agent negotiation** — agents debate proposals before escalating to founder
- **Compound-signal synthesis** — cluster related decisions into one
- **Per-customer rules engine** — "white-glove this customer" DSL
- **Memory consolidation** — weekly per-agent memory notes (overlaps with Company Mind; worth discussion)
- **Auto-statistical-significance** for experiments (auto-end + promote)
- **Multi-arm bandit routing** (explore vs exploit on experiments)
- **Real email delivery** for customer letters (currently in-app only)
- **Per-agent run() functions** (agents can proactively act in their domain without executor mediation)
- **Auto-baked experiment winners** (winning variant config → founder settings automatically)
