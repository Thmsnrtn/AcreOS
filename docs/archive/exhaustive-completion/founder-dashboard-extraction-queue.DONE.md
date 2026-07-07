# Founder-Dashboard Extraction Queue
2026-05-01. Per the founder-side UX audit (`ux-audit-2026-05-01/founder-audit.md`),
the legacy `client/src/pages/founder-dashboard.tsx` (7,400+ lines) should
shed sub-features into focused routes incrementally rather than rebuild
all at once. This doc lists the top-5 extractions in priority order with
ready-to-paste agent prompts.

The 2026-05-01 banner already routes daily founder use to `/founder-home`,
so these extractions are about cleanup discipline, not blocking
customer launch.

---

## Extraction priority (effort × value)

| # | What extracts | New route | Effort | Value | Why |
|---|---------------|-----------|--------|-------|-----|
| 1 | API keys + system keys section | `/founder/keys` | 0.5d | High | Self-contained; no cross-section state; founder visits monthly to rotate keys |
| 2 | LaunchReadiness checklist | `/founder/readiness` | 0.5d | High | Already a discrete component; daily-during-launch surface that earns its own route |
| 3 | ActionQueuePanel | merge into `/founder/todo` | 0.5d | High | Duplicate work surface — todo is the canonical action list; ActionQueue should fold in |
| 4 | OrgHealth + ChurnRisk + MRRTrajectory | `/founder/customers/health` | 1.5d | High | Three related panels that always read together; single dedicated route makes the customer-health story scannable |
| 5 | GrowthSection (~2,000-line wizard) | `/founder/growth/campaigns` | 3-5d | Med | Largest extraction; biggest cleanup; lowest urgency since founder runs growth experiments rarely |

After all 5: founder-dashboard.tsx drops from ~7,400 lines to ~2,500 lines, and each extracted surface gets its own focused page that can be redesigned without dashboard surgery.

---

## Extraction #1 — API keys → `/founder/keys`

```
Read docs/exhaustive-completion/founder-dashboard-extraction-queue.md
section "Extraction #1" for context. Then:

1. Find the AI keys + system API keys sections inside
   client/src/pages/founder-dashboard.tsx (likely near "section-config" id;
   grep for `ApiKeysSection` / `KeysManager` / `BYOK` / `system_api_keys`).
2. Extract the JSX + supporting hooks into client/src/pages/founder/keys.tsx
   as a default-exported FounderPageShell-wrapped component.
3. Add the route in client/src/App.tsx using the FounderProtectedRoute
   pattern: <Route path="/founder/keys"> wrapping the lazy import.
4. Add nav entry in client/src/components/layout-sidebar.tsx founder
   module overflow array — the surface is monthly-touch, fits overflow.
5. Replace the in-dashboard rendering with an inline link card pointing to
   /founder/keys (preserves discoverability for founders who scroll the
   dashboard).
6. Run npm run check; commit with message
   "feat(founder/keys): extract API + system keys into focused route".
7. Open a single PR.

Constraints:
- Don't change behavior. Pure extraction.
- Preserve all data-testid attributes.
- Keep the existing query keys + mutation paths (don't rename or
  re-namespace endpoints).
- Branch: founder-extract-keys-YYYY-MM-DD.
```

---

## Extraction #2 — LaunchReadiness → `/founder/readiness`

```
Same pattern as Extraction #1. Specifics:

- Source: section-readiness inside founder-dashboard.tsx; component is
  likely LaunchReadiness or LaunchReadinessChecklist.
- Target: client/src/pages/founder/readiness.tsx
- Sidebar: add to founder module's PRIMARY children (not overflow) —
  this is the daily-during-launch surface
- The checklist may persist its state to localStorage; preserve that key
- Branch: founder-extract-readiness-YYYY-MM-DD
```

---

## Extraction #3 — ActionQueuePanel → merge into `/founder/todo`

```
Read docs/exhaustive-completion/founder-dashboard-extraction-queue.md
section "Extraction #3". This one is a MERGE, not an extract.

Context: /founder/todo exists as the canonical "What needs you" surface.
ActionQueuePanel inside founder-dashboard.tsx solves the same problem
with a different data source. Both should converge on /founder/todo;
ActionQueuePanel goes away.

Steps:
1. Find ActionQueuePanel inside founder-dashboard.tsx. Note the API
   endpoints it calls (likely /api/founder/action-queue).
2. Open client/src/pages/founder/todo.tsx (or /pages/founder-home.tsx
   WhatNeedsYouCard) and confirm it uses /api/founder/intelligence/todo.
3. Server-side: in server/routes-founder-* or server/services/founderTodo.ts,
   find the two endpoints. If their shapes differ, write a server-side
   adapter so /founder/intelligence/todo also surfaces ActionQueue items.
   Tag each item with `source: 'action-queue' | 'todo'` so the merged
   list keeps provenance.
4. Update WhatNeedsYouCard / FounderTodoPage to render the merged feed.
5. Remove ActionQueuePanel from founder-dashboard.tsx (replace with a
   small "see /founder/todo" link card).
6. Delete the now-unused /api/founder/action-queue endpoint OR keep it
   live-but-deprecated for one release — note your call in the PR.
7. Branch: founder-merge-actionqueue-YYYY-MM-DD.

Constraints:
- Don't lose any item types. The two systems may surface different
  signals (cascade hints, churn interventions, etc).
- Preserve unread-counts / badge state.
```

---

## Extraction #4 — OrgHealth + ChurnRisk + MRRTrajectory → `/founder/customers/health`

```
Larger extraction (1.5d). Three related panels become one focused route.

1. Find OrgHealthMonitor, ChurnRiskPanel (or similar), MRRTrajectoryChart
   inside founder-dashboard.tsx. They likely live near section-org-health
   and section-revenue.
2. Target: client/src/pages/founder/customers/health.tsx
3. Layout: three cards stacked vertically on mobile, 2-up + 1-full grid
   on desktop. Use the calm-matrix grid pattern from JC#11.
4. Keep all existing API endpoints + query keys. The new page is a
   composition of existing fetchers, not a new server endpoint.
5. Sidebar: add to founder module overflow (weekly-touch).
6. Replace dashboard sections with inline link cards.
7. Add a subtitle on the new page: "Forward-looking customer signal —
   churn risk, revenue trajectory, org engagement. The /founder-home
   churn risk card is the headline; this is the deep dive."
8. Branch: founder-extract-customers-health-YYYY-MM-DD.

Constraints:
- This is the highest-information-density founder surface — don't
  re-skin during the extraction. Pure move + minor layout.
- A redesign session can come after.
```

---

## Extraction #5 — GrowthSection wizard → `/founder/growth/campaigns`

```
LARGEST extraction (3-5d). The growth section is a ~2,000-line wizard
embedded inside founder-dashboard.tsx that runs founder-side experiments.

DO NOT attempt this in a single session. Breakdown:

Phase A (1d): identify the wizard's scope. Read everything that imports
from or references "growth" / "GrowthSection" / "growth_experiment" /
"campaign_optimizer". Map data flows in/out. Write a phase-A.md with
the scope before touching any code.

Phase B (1-2d): extract to client/src/pages/founder/growth/campaigns.tsx
keeping ALL behavior. No redesign. Pure move. Test every tab + step.

Phase C (1d): redesign the wizard against the prototype reference if one
exists (acreos/round3-integrations-2.jsx may have a growth surface;
check). Otherwise design from scratch with the brief §14 founder-mode
density treatment.

Phase D (0.5d): wire sidebar + remove dashboard rendering.

Each phase ships its own PR. Branch: founder-extract-growth-phase-X.
```

---

## How to schedule one of these

The autonomous-run summary prompt (in `_AUTONOMOUS-RUN-SUMMARY.md`)
should be the entry point. To run an extraction:

1. Pick the extraction number above.
2. Open a fresh Claude Code session in /Users/user/AcreOS/AcreOS.
3. Paste the prompt from the matching section.
4. The agent will branch, extract, type-check, and open a PR.

For recurring extraction automation, schedule via /schedule with the
prompt as the cron-fired body. Recommended cadence: monthly (one
extraction per month). This naturally orders them 1 → 5 over five
months while leaving most engineering time for new product work.

---

## After all five extract

- founder-dashboard.tsx becomes ~2,500 lines (down from 7,400)
- The remaining content is the operational cluster:
  feature-flags + ab-tests + data-source admin + endpoint manager +
  agent-traces + LLM-cost dashboard. This cluster legitimately reads
  together; it's the operations control room.
- Consider then re-skinning the *remaining* dashboard against the
  brief's "founder mode = subtle accent + denser layout" guidance.
  That re-skin is the L-effort rebuild the audit recommended; with
  the noise extracted, it's a half-day instead of two weeks.
