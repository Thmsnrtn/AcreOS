# Founder Nav Consolidation — Plan (for approval)

**Date:** 2026-06-23 · **Status:** PLAN ONLY — no execution until founder approves.
**Author:** systems-architect pass.

## The problem, precisely

The founder surface is governed by a four-door doctrine (`FOUNDER_DOORS`: The Letter `/founder`, Decisions `/founder/decisions`, Controls `/founder/autopilot/control`, Story `/founder/autopilot/story`) plus a `/founder/admin/*` instrument namespace. But a **parallel `FOUNDER_NAV_DEEP_DIVES` list (~31 pages, rendered in `layout-sidebar.tsx:642-704`)** runs alongside the doors. The `founderFourDoors.test.ts` ratchet counts **88** `/founder/*` routes total.

The key finding: **this is not ~31 needed surfaces — it's ~5 real surfaces wearing ~30 routes.** The sprawl is duplication, not breadth. Every audited page is real and works (zero dead code); the issue is organization.

## The duplication, named

| Cluster | Routes today | Reality |
|---|---|---|
| **Cost/economics** | `/founder/cost`, `ai-costs`, `cost-optimizer`, `unit-economics`, `observability-cost`, `providers`, `paid-data-eval` (7) | One "Costs" instrument with tabs. All read cost/spend data. |
| **Traces/internals** | `pax-traces`, `traces`, `event-log`, `dispatches`, `agent-queue`, `prompt-evolutions`, `prompt-history`, `memory`, `pax-calibration` (9) | One "Machine Story" explorer with filters. All "what the machines did + why". |
| **Attention/decisions** | `decisions` (door), `asks`, `preview`, `feedback`, `feed`, `appeals`, `recourse` (7) | The Decisions door with tabs. All "things needing your attention". |
| **Overview/strategy** | The Letter (door), `strategy`, `trends`, `letter`, `expansion`, `steering`, `command`, `bridge`, `preview` (8) | The Letter door with sections. Heavy overlap with the daily brief. |
| **Controls/dials** | Control Center (door), `studio`, `keys`, `settings`, `governance`, `trust-graduation`, `readiness`, `legal-readiness` (8) | The Controls door. `studio` ("every dial") directly overlaps the Control Center. |
| **Customer-ops** | `customers`, `customers/health`, `onboarding-funnel`, `onboarding`, `cmo`, `growth/campaigns` (6) | `/founder/admin/customers` instrument with tabs. |
| **Deep instruments** | `telemetry`, `inspector`, `recovery-console`, `experiments`, `tools`, `scenarios`, `ai-observatory`, `compliance-ops`, `market-reports`, `features` (10) | `/founder/admin/*` — deliberate-visit panels. |

## Target architecture (the four doors, each absorbing its cluster)

- **The Letter (`/founder`)** — the daily brief IS the overview. Strategy/trends/expansion/steering become sections or the weekly view; `letter` (monthly) and `bridge`/`command` duplicates retire.
- **Decisions (`/founder/decisions`)** — tabs: Pending asks · Decision log · Action preview · Feedback · Appeals/Recourse.
- **Controls (`/founder/autopilot/control`)** — absorb `studio` (the dials already overlap), `keys`, `settings`, `governance`, `trust-graduation`, readiness checklists.
- **Story (`/founder/autopilot/story`)** — the glass-box, extended with the unified trace/internals explorer (traces · pax · dispatches · prompts · memory · event log as filters).
- **`/founder/admin/*`** — one admin index linking the deliberate instruments: **Costs** (the 7→1 merge), **Customers** (the 6→1 merge), telemetry, inspector, recovery, experiments, scenarios, ai-observatory, compliance-ops, market-reports, paid-data-eval.

## Q1 decision (already approved: audit→recommend) — RESULT
The 4 orphan live pages are all **real, working, non-duplicated — zero deletes.** Action: link all four under `/founder/admin/*` (and relocate `market-reports`' existing top-level sidebar link there too). Folded into Phase 1 below.

## Sequencing (each phase ships gated; ratchet lowered as routes merge away)

1. **Phase 1 — `/founder/admin` index + relocate instruments (low risk).** Stand up the admin index; move the 10 deep instruments + 4 orphans' links under it. No page logic changes, just nav home + route prefix. Removes top-level clutter; baseline drops as old top-level routes redirect→admin then retire.
2. **Phase 2 — the Costs merge (7→1, high value, low risk).** One `/founder/admin/costs` with tabs; the 7 cost pages become tab panels (reuse existing components as tab bodies). Retire 6 routes.
3. **Phase 3 — the Machine-Story merge (9→~2).** Fold trace/internals viewers into the Story door as a filtered explorer. Retire ~7 routes.
4. **Phase 4 — Decisions + Controls tabs.** Fold attention surfaces into Decisions; resolve the `studio`↔Control-Center overlap (merge dials). Retire ~10 routes.
5. **Phase 5 — The Letter sections.** Fold overview/strategy surfaces; retire true duplicates.
6. **Each phase:** lower `FOUNDER_ROUTE_BASELINE` to the new count; keep smoke-tested redirects (`production-smoke.spec.ts`, `sim-founder-journey.spec.ts`) resolving (redirect old→new, don't 404).

**Projected end state:** ~88 → ~20-25 `/founder/*` routes (4 doors + ~1 admin index + a handful of param/instrument routes), with the same surfaces reachable as tabs/sections. The founder sees four doors + one admin drawer, not 31 sidebar links.

## Risks & guardrails
- **It's your daily tooling.** Every merge preserves the existing component as a tab body — no functionality lost, just re-homed. Done incrementally so any phase is independently revertable.
- **Redirects stay.** Old URLs (bookmarks, smoke tests) redirect to their new home; nothing 404s.
- **One phase per PR**, each gated (tsc + full lints + the four-door ratchet lowered to match).

## Recommendation
Start with **Phase 1 + Phase 2** — they're the highest value-to-risk (admin index + the 7→1 Costs merge), purely re-homing working components, and they prove the pattern before touching the doors themselves. Await approval to begin.
