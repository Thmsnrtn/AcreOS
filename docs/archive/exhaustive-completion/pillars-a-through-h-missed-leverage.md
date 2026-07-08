# Pillars A–H — missed-leverage audit

The Rosy River campaign's original pillars (A through H) shipped most
of their slate. This audit walks the gaps that remained as of
2026-05-14, what session work this week closed, and what's still
queued.

The scope of "what's left" shrinks faster than the doc count suggests
because Pillars K–Q this session indirectly closed several A–H items
(persona vocabulary expansion, workflow templates, schema additions,
reliability infra). Each line below tracks status.

---

## Pillar A — UI/UX to Linear/Stripe tier

| Item | Status | Notes |
|---|---|---|
| Motion vocabulary (`motion-tokens.ts`) | ✅ shipped earlier | |
| Storybook / visual regression | 🟡 partial | Playwright visual baseline shipped; Storybook deferred |
| Loading skeleton audit | 🟡 partial | DecisionQueue + several pages converted; not fully swept |
| Empty-state audit | 🟡 partial | `EmptyState` exists; many pages still bare lists |
| **Density pass on 5 high-traffic pages** | 🔴 **queued** | `founder-dashboard.tsx` is a 7,379-line monolith (deferred 2026-05-06 — date hit); `settings.tsx` is 3,078 lines, only the `SettingsQuickFind` band-aid shipped |
| Focus state coherence | ✅ shipped | `tests/e2e/focus-state.spec.ts` |
| Dark mode parity | ✅ shipped | DIRTPASS theme + dark variants verified |
| Performance pass (Lighthouse + bundle) | ✅ shipped | `tests/e2e/perf.spec.ts` |

**Highest remaining leverage:** founder-dashboard.tsx extraction (7,379 lines). The CLAUDE.md note says "before adding ≥100 lines to any panel, extract it first" — the dashboard has only grown since. Each extraction is 1-2 days, 5-7 panels still in scope.

---

## Pillar B — Open-source data / Regrid nullification

| Item | Status | Notes |
|---|---|---|
| MapLibre migration | ✅ shipped | Verified end-to-end this session |
| County GIS bulk import | ✅ shipped | + autonomous discovery cron (B-3) |
| Measurement overlay | ✅ shipped | |
| Multi-layer toggle | ✅ shipped | |
| Parcel comparison | 🟡 partial | Surface exists, depth limited |
| 3D terrain | ✅ shipped | |
| Property report PDF | ✅ shipped | |
| Regrid demotion | ✅ shipped | tier-4 fallback |
| **`findComparables` AVM logic** | 🔴 **queued** | `acreOSValuation.ts:493` silently fails on schema misalignment — every AVM call returns empty comparable list. Fix requires either rewiring to a different table or extending `transactionTraining` with lat/lng + `sizeAcres` |

**Highest remaining leverage:** fixing `findComparables`. The AVM is degraded today; users don't see it because the catch swallows the error. Real fix recovers a major feature.

---

## Pillar C — Self-evolution

| Item | Status | Notes |
|---|---|---|
| C1 — proposed_changes table | ✅ shipped | |
| C2 — codebase monitor | ✅ shipped | + schema-column scanner (Pillar Q this session) |
| C3 — PR generation | ✅ shipped | (`GH_TOKEN` helper this session unblocked) |
| C4 — founder review dashboard | ✅ shipped | `/founder/agent-queue` |
| C5 — telemetry collectors | ✅ shipped | |
| C6 — multi-week planner | 🟡 partial | Weekly digest cron exists; no planning agent reading it |
| C7 — decision-log RAG | 🔴 queued | Tracked in Pillar Q follow-ups |
| C8 — sim→live promotion gate | 🟡 partial | Per-category sim mode exists; ≥20-decision threshold not enforced |

**Highest remaining leverage:** C7 (decision-log RAG). Founder review load grows with proposal volume; RAG makes proposals self-aligning.

---

## Pillar D — Founder cockpit

(Subsumed into Rosy River + the work in `routes-founder-*` ; no separate pillar slate. The 14 bug fixes this session were largely D surface.)

---

## Pillar E — Customer health / lifecycle

| Item | Status | Notes |
|---|---|---|
| E1 — trial expiry | ✅ shipped | |
| E2 — lifecycle dashboard | ✅ shipped | `/founder/customers/health` |
| E4 + E9 — health scoring | ✅ shipped | |
| E6 — expansion | 🟡 partial | Endpoint exists; UI surface limited |
| E7 — winback A/B | 🟡 partial | Schema exists; no A/B controller |
| E8 — onboarding nudges | ✅ shipped | |
| E11 — onboarding scheduler | ✅ shipped | |

**Highest remaining leverage:** E7 (winback A/B). Treating churn as an experimentable surface, not a manual outreach push.

---

## Pillar F — Pax personality + quality

| Item | Status | Notes |
|---|---|---|
| F3 — personality drift sampler | ✅ shipped | weekly cron |
| Tool accuracy scoring | 🟡 partial | Hallucination guard exists; no accuracy benchmark |
| Knowledge currency | 🔴 queued | No mechanism to refresh Pax's grounded data |
| Per-org A/B | 🔴 queued | |
| Response quality dashboard | 🔴 queued | No surface that shows "is Pax's response quality dropping" |

**Highest remaining leverage:** Pax response-quality dashboard. Founder can't see today whether Pax is degrading without manually sampling.

---

## Pillar G — Offline + sync

| Item | Status | Notes |
|---|---|---|
| IndexedDB queue | ✅ shipped | |
| Offline indicator + queued-count UX | ✅ shipped earlier | |
| Force-sync UI | ✅ shipped | |
| Conflict resolution (3-way merge) | 🔴 queued | last-write-wins today; no UI for divergent edits |

**Highest remaining leverage:** conflict resolution. Today an edge case for solo operators; will bite teams once Maud's (Pillar M) operator-with-team workflow ships.

---

## Pillar H — Workflow templates + verticals

| Item | Status | Notes |
|---|---|---|
| Fix-and-flip workflow template | ✅ shipped earlier (rehab kickoff) + Pillar O (demo, listing-ready) | |
| Pax vocabulary swap (fix_flipper) | ✅ shipped earlier | |
| Persona vocabulary expansion | ✅ shipped Pillars K-P | All 9 personas have entries |
| Vertical-specific workflow templates | ✅ shipped Pillars K-P | 14 new templates across K-P |
| Templates Gallery UI | 🔴 queued | `/workflows` page doesn't list available templates with one-click install yet |
| Vertical maturity scorecard surface | 🔴 queued | Exists in backend; no customer surface |

**Highest remaining leverage:** Templates Gallery UI. The templates ship K-P but customers need a discovery surface (probably `/workflows/templates`) to install them with one click.

---

## Cross-pillar summary

| Bucket | Count |
|---|---|
| ✅ Fully shipped | 36 |
| 🟡 Partial | 11 |
| 🔴 Queued | 11 |

The next session should target the **🔴 queued** items by leverage:

1. **`founder-dashboard.tsx` monolith extraction** (Pillar A) — biggest dev-time tax in the codebase. CLAUDE.md guidance is to extract before adding ≥100 lines; we keep crossing that.

2. **`findComparables` AVM fix** (Pillar B) — silent product degradation; a real feature is non-functional.

3. **Templates Gallery UI** (Pillar H) — Pillars K-P shipped 14 templates that customers can't discover yet.

4. **Pax response-quality dashboard** (Pillar F) — founder blindness to product quality drift.

5. **Decision-log RAG** (Pillar Q) — reduces founder review load as agent proposals scale.

6. **Settings de-monolithing** (Pillar A) — `SettingsQuickFind` was a band-aid; the 3,078-line file is still painful.

7. **Conflict-resolution UI** (Pillar G) — bites once teams ship.

8. **`useDocumentTitle`-in-formatter ESLint rule** (Pillar I follow-up) — closes the 6-page React #310 bug class permanently.

The other queued items (E7 winback A/B, F per-org A/B, F knowledge currency, C7 decision-log RAG, C8 sim→live gate strictness, vertical maturity scorecard) are lower-leverage and stay deprioritized.
