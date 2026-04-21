# Founder-side infrastructure — architecture state

**Date:** 2026-04-21 (end of session)

This document captures the current shape of the founder-side infrastructure after building the three foundation moves (Mind / Self-improvement / Narrative) and the six follow-up moves (F-1 through F-6). It's written for future sessions — what exists, where it lives, and how the pieces fit.

## The 8-layer model

| Layer | Concern | Status | Lead file(s) |
|---|---|---|---|
| 0 | Foundation (schema, auth, kill-switch, hard caps) | ✅ Rock solid | `shared/schema.ts`, `server/utils/simulationMode.ts` |
| 1 | Signals in (Stripe, email, support, churn → inbox) | ✅ Working | `server/services/decisionsInbox.ts` |
| 2 | Reasoning (12 agents, executor, Company Mind) | ✅ Company Mind live | `server/services/companyMind.ts`, `autonomousDecisionExecutor.ts` |
| 3 | Actions out (sim-mode wrappers + preview checkpoint) | ✅ F-5 live | `server/services/actionPreview.ts` |
| 4 | Outcomes (grader, trust, safety-rail trips) | ✅ Wired | `server/services/autonomyHealth.ts` |
| 5 | Learning loop (outcomes → trust → prompts → calibration) | ✅ F-2 live | `promptEvolutionMetaAgent.ts`, `calibration.ts` |
| 6 | Strategy/proaction (weekly/monthly proposals + tools) | ✅ F-1 + F-6 live | `strategicProposals.ts`, `toolProposals.ts` |
| 7 | Interface (letter, health, customization, palette) | ✅ F-3 + F-4 live | `founderNarrative.ts`, `founder-command-palette.tsx`, `founder-settings.tsx` |
| 8 | Meta/self-awareness (calibration, "I don't know") | ✅ F-2 live | `calibration.ts` |

## Session timeline

### Foundation (moves 1–3 earlier in the session)

1. **Company Mind** — `server/services/companyMind.ts`. Cross-wing context assembled at decision time from founder reversals, strategic priorities, high-priority agent broadcasts, recent negative outcomes, and same-org activity. Prepended to every executor decision prompt.
2. **Prompt-evolution meta-agent** — `server/services/promptEvolutionMetaAgent.ts`. Monthly pass reads per-agent performance slices (outcome scores, override rate, negative patterns, calibration), asks Opus to propose surgical prompt revisions, files them in `agentPromptEvolutions` for founder approval.
3. **Monthly Founder Letter** — `server/services/founderNarrative.ts`. One-page monthly narrative written by the "Chief of Staff" in a single voice. Pulls synthesized strategic moves, pending founder decisions, team trends, highlights, lowlights, calibration. Renders at `/founder/letter`.

### F-1 through F-6

4. **F-1 Proactive Strategic Proposals** — `server/services/strategicProposals.ts`. Weekly per-agent proposals (Sunday 00:00 UTC) + monthly synthesis pass (1st 10:00 UTC) into 3-5 company moves. Feeds the letter's "Next month's focus" section.
5. **F-2 Calibration & self-awareness** — `server/services/calibration.ts`. Measures Brier score + overconfidence bias per agent. No new table — piggy-backs on `decisionsInboxItems.contextBundle.executorConfidence` (now written by executor) paired with `outcomeScore`. Feeds the prompt-evolution meta-agent as an eligibility trigger.
6. **F-3 Customization Center** — `server/services/founderSettings.ts` + `/founder/settings`. Key-value settings table with 6 tunable knobs (hard cap, TTL, thresholds, preview window, etc.). Live-apply — 30s cache, next decision uses the new value.
7. **F-4 Command Palette** — `client/src/components/founder-command-palette.tsx` + `GET /api/founder/intelligence/search`. ⌘⇧K (not ⌘K — that's the operator palette) searches decisions, agents, orgs, letters, proposals. Keyboard-first nav.
8. **F-5 Action Preview** — `server/services/actionPreview.ts` + `/founder/preview`. Every auto-approved action writes a preview row BEFORE committing. Optional cancel window (founder-tunable, 0s default = audit-only). Live countdown UI.
9. **F-6 Tool Proposal pipeline** — `server/services/toolProposals.ts` + `/founder/tools`. Monthly strategic-synthesis pass now emits tool proposals as a side output. Founder approves/rejects/marks build progress. Capability-growth queue.

## Entry points by founder task

| If the founder wants to… | Go to |
|---|---|
| …read the one monthly summary | `/founder/letter` |
| …know if the system needs them today | `/founder` (autonomy-health card) |
| …review every autonomous action, live | `/founder/preview` |
| …review the decision audit trail | `/founder/decisions` |
| …review proposed prompt-revisions | (UI page pending — API at `/api/founder/intelligence/prompt-evolutions`) |
| …review strategic proposals | (via Founder Letter "Next month's focus" + API) |
| …review new tool/integration proposals | `/founder/tools` |
| …change operational knobs | `/founder/settings` |
| …find something specific | ⌘⇧K |

## Cron schedule

| Job | Schedule | File |
|---|---|---|
| Morning briefing pre-generation | Daily 06:45am CT (11:45 UTC) | `companyBriefingGenerator` |
| Outcome grader | Daily | `autonomyHealth.gradeRecentDecisions` |
| Strategic proposals — weekly | Sundays 00:00 UTC | `strategicProposals.runWeekly` |
| Strategic proposals — synthesis | 1st of month 10:00 UTC | `strategicProposals.runSynthesis` |
| Prompt-evolution meta-agent | 1st of month 09:00 UTC | `promptEvolutionMetaAgent` |
| Founder letter | 1st of month 12:00 UTC | `founderNarrative.generateMonthlyLetter` |
| Action-preview orphan sweep | Hourly | `actionPreview.sweepOrphanedPreviews` |
| Financial approval TTL sweep | On-demand + on load | `financialAuthorityGate.sweepStaleApprovals` |

## Cost profile

Roughly:
- Daily operations: ~$0.05 (grader, briefing)
- Weekly strategic proposals: ~$0.15 (single Opus call)
- Monthly synthesis + tool extraction: ~$0.20
- Monthly prompt-evolution: ~$0.30 (~1 Opus call per flagged agent)
- Monthly founder letter: ~$0.10
- Per-decision cross-wing context: ~$0.0015
- Calibration: free (no LLM call)

**Total: ~$3–5/month at 20 decisions/day.** An avoided founder reversal per month pays for the whole stack.

## What's NOT built yet (open future work)

- **UI for prompt-evolution approvals** — API exists, UI page pending. Would go at `/founder/prompt-evolutions`.
- **UI for strategic proposal approvals** — API exists, proposals show up in the Founder Letter body. Dedicated `/founder/strategy` page would give inline approve/reject.
- **Inter-agent negotiation** — the 12 agents broadcast via `agentCommsService` but don't debate proposals. Could add a "the board votes" layer on top of strategic proposals.
- **Compound-signal synthesis** — if multiple related decisions arrive in a short window, the system still processes them independently. Real synthesis would cluster them into one decision.
- **Per-customer rules engine** — "this customer gets white-glove treatment" isn't yet expressible outside of code. Extending founderSettings to per-org overrides would close this.
- **Memory consolidation** — `agentMemory` table exists but isn't populated by the executor. A weekly cron could summarize what worked / what didn't into agent-specific memory notes.

## Safety invariants

All of these are held even after this session's expansion:

- `SIMULATION_MODE=true` still short-circuits every external side effect.
- Financial hard cap still blocks autonomous spend above the configured ceiling.
- Prompt revisions NEVER auto-apply — always founder-gated via `agentEvolutionEngine.applyPromptChange`.
- Strategic proposals NEVER auto-execute — always founder-gated via `strategic-proposals/:id/approve`.
- Tool proposals NEVER auto-build — always founder-gated.
- Action preview rows are the single source of truth for "did this happen?" — if cancelled, the action is not committed.

## Commit reference

This session shipped:

```
1d3d90a feat(tools): F-6 Tool Proposal pipeline
cbe6fd0 feat(preview): F-5 Action Preview
9c7ee45 feat(nav): F-4 Founder Command Palette
4630e86 feat(settings): F-3 Customization Center
00d15f8 feat(calibration): F-2 self-awareness
7b5d738 feat(strategy): F-1 proactive strategic proposals
55f2490 feat(letter): monthly founder letter
0e27f02 feat(evolution): prompt-evolution meta-agent
06d17f9 feat(mind): shared cross-wing context
```

## Tests and validation

The cycle-2 suite (`tests/e2e-founder-autonomy/`) is the regression suite. After this session's work, a cycle-3 run should:

1. Re-run `seed-cohort.ts` + seed all 15 scenarios + trigger executor.
2. Confirm the executor emits action-preview rows before each approve.
3. Confirm cross-wing context appears in the executor's prompt (visible in logs).
4. Manually trigger the monthly synthesis + prompt-evolution passes via `/run-weekly`, `/run-synthesis`, `/prompt-evolutions/run-now`.
5. Generate the founder letter and verify strategic moves appear.
6. Visit `/founder/settings`, edit a knob, verify the change is picked up on the next decision.
7. Press ⌘⇧K, confirm search returns results across all entity types.
