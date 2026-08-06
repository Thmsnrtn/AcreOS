# Founder Routes Audit — V-numbered file consolidation

**Date:** 2026-05-27
**Trigger:** Lens 10 flagged versioned `routes-founder-v{6..14}.ts` files coexisting on `main` as a code smell.

> **⚠ UPDATE 2026-08-06 (audit F-17-1):** the "None are dead" rationale below is
> **no longer true for V6/V7/V8.** Those three routers (renamed to
> `routes-founder-{sovereign-company,learning-company,living-organization}.ts`)
> and their 17 client components (WarRoom, ScenarioEngine, StrategicCompass, …)
> were verified DEAD (zero live client importers) and **DELETED**. Their backing
> services stay live via `ceoCommandBridge` + the worker jobs. **V10–V14 remain
> live** — they back the refit founder pages (`/founder/scenarios`,
> `/founder/governance`, `/founder/memory`) and the `use-sovereign-dashboard`
> hook. See the corrected row in `docs/company/deletion-ledger.md` for the full
> reachability map. Rows 10–12 and the Rationale are kept below as the
> 2026-05-27 record.

## Inventory

| File | Codename | Endpoints | Client references | Decision |
|------|----------|-----------|-------------------|----------|
| `routes-founder-v6.ts` | Sovereign Company Protocol v6 (workflows, war rooms, initiatives, performance reviews, playbooks, CEO absence) | 23 | `PerformanceReviews.tsx`, `AbsenceMode.tsx`, `PlaybookManager.tsx`, `WorkflowMonitor.tsx`, `WarRoom.tsx`, `InitiativeBoard.tsx` | **Rename** → `routes-founder-sovereign-company.ts` |
| `routes-founder-v7.ts` | The Learning Company (decision autopilot, scenarios, agent self-improvement, founder twin, attention optimizer, institutional memory) | 23 | `InstitutionalMemory.tsx`, `FounderTwin.tsx`, `AgentGrowth.tsx`, `DecisionAutopilot.tsx`, `FocusCard.tsx`, `ScenarioEngine.tsx` | **Rename** → `routes-founder-learning-company.ts` |
| `routes-founder-v8.ts` | The Living Organization (strategic compass, agent debates, founder wellbeing, seasons, synergy map, company chronicle) | 14 | `StrategicCompass.tsx`, `AgentDebatePanel.tsx`, `SynergyMap.tsx`, `FounderWellbeingCard.tsx`, `CompanyChronicle.tsx` | **Rename** → `routes-founder-living-organization.ts` |
| `routes-founder-v9.ts` | N/A | — | — | **Does not exist** (Lens 10 miscounted; file was never created) |
| `routes-founder-v10.ts` | The Conscious Organization (scenario war room, closed-loop learning, org heartbeat, agent self-calibration, CEO decision replay, resilience testing, realtime nervous system, adaptive surface) | 51 | `conscious-organization.tsx` | **Rename** → `routes-founder-conscious-organization.ts` |
| `routes-founder-v11.ts` | The Anticipatory Enterprise (agent negotiation, revenue attribution, CEO cognitive model, temporal knowledge decay, agent resource governor, decision causality, delegation tokens, predictive orchestration) | 59 | `use-sovereign-dashboard.ts`, `board-of-directors.tsx`, `anticipatory-enterprise.tsx` | **Rename** → `routes-founder-anticipatory-enterprise.ts` |
| `routes-founder-v12.ts` | The Real Runtime (agent lifecycle runtime, event mesh, outcome verification, saga orchestrator, agent version control, trust enforcement, integration framework, tenant fabric) | 60 | `use-sovereign-dashboard.ts` | **Rename** → `routes-founder-real-runtime.ts` |
| `routes-founder-v13.ts` | The Sentient Enterprise (cognitive memory, adaptive strategy, collaboration protocol, self-healing mesh, governance brain, founder intelligence) | 68 | `use-sovereign-dashboard.ts`, `sovereign-v13.tsx`, `memory-browser.tsx` | **Rename** → `routes-founder-sentient-enterprise.ts` |
| `routes-founder-v14.ts` | The Self-Running Company (reactive orchestration, feedback loop, confidence cascade, founder intent, autonomy score) | 57 | `use-sovereign-dashboard.ts` | **Rename** → `routes-founder-self-running-company.ts` |

## Rationale

Every v-N file is wired to active client code. None are dead. The version numbers in filenames are a holdover from sequential "Sovereign Company Protocol vN" design iterations — but the protocols are not versioned implementations of the same surface; each one introduces a distinct functional category that lives alongside the others. Renaming each file to its functional category eliminates the misleading "version" sequencing while keeping every endpoint at the same URL (the `/api/founder/vN/...` paths are kept verbatim to avoid a client-side migration).

Note: the URL prefixes (`/api/founder/v6` ... `/api/founder/v14`) are retained for now to keep the change purely a file rename. A follow-up could rename the URL prefixes to functional categories, but that requires touching every client component and is out of scope for this consolidation pass.

## Action plan

1. **Inventory commit** (this file).
2. **8 rename commits**, one per file: `git mv` + update of the import path in `server/routes.ts`. The exported function name (e.g., `registerFounderV6Routes`) is kept for now — renaming the function is cosmetic and would not alter behaviour. After all renames, a follow-up could rename the functions and the URL prefixes together.
3. After each commit: `npm run check`.
