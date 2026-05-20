# Founder redesign — route migration map

Per `/Users/user/.claude/plans/how-can-we-either-ticklish-ocean.md`, the founder
side consolidates 40+ routes into 4 canonical surfaces. This doc lists the
route-by-route mapping so the Phase F deprecation can happen incrementally.

## Canonical surfaces (already live)

| URL | Component | Phase |
|---|---|---|
| `/founder` | `pages/founder/now.tsx` (existing daily inbox) | E ✅ |
| `/founder/steering` | `pages/founder/cockpit.tsx` (existing monthly review) | E ✅ |
| `/founder/studio` | `pages/founder/studio.tsx` (new generic dials hub) | C ✅ |
| `/founder/inspector/agent/:codename`, `/founder/inspector/decision/:id`, `/founder/inspector/audit` | `pages/founder/inspector.tsx` (new provenance lens) | D ✅ |
| `/founder/cmo` | `pages/founder/cmo.tsx` (CMO ad engine, kept canonical) | — |

## Redirects already in place (Phase F-1)

| Old | New | Status |
|---|---|---|
| `/founder-home` | `/founder` | ✅ existing redirect |
| `/founder/now` | `/founder` | ✅ added Phase F-1 |
| `/founder/cockpit` | `/founder/steering` | ✅ added Phase F-1 |
| `/founder/feature-flags` | `/founder/features` | ✅ pre-existing |

## Pending consolidation (Phase F-2 — incremental)

These routes still serve unique pages. Before redirecting them, the destination canonical surface needs to absorb the data + UX they currently expose. Listed with the migration target.

### Into `/founder/studio` (settings + tunables)

| Old route | What it does today | Studio integration needed |
|---|---|---|
| `/founder/keys` | API key management + BYOK | Add a "Keys" tab to studio that surfaces the same management UI |
| `/founder/features` | Feature flag toggles | Add a "Features" tab; flags map to settings keys with `boolean` validRange |
| `/founder/prompt-versions` | Per-agent prompt version history + rollback | Add "Prompts" tab fed by `agent_prompt_evolutions` rows |
| `/founder/cost-optimizer` | AI cost budgets + per-org caps | Add "Costs" tab; the seeded `cost.*` keys already power this |
| `/founder/settings` | Live operational knobs | Already conceptually inside studio — confirm settings catalog covers it |
| `/founder/trust-graduation` | Per-(agent, category) tier admin | Add "Autonomy gates" tab (already on plan — see studio/autonomy) |

### Into `/founder/inspector` (provenance)

| Old route | What it does today | Inspector integration needed |
|---|---|---|
| `/founder/ai-observatory` | Per-agent LLM trace dashboard | Already covered by `/founder/inspector/agent/:codename` — add redirect once each agent has a deep link |
| `/founder/agent-queue` | Pending proposals + notifications + budget | Rolls into `/founder` (Now) for the pending items, `/founder/inspector/agent/:codename` for per-agent budget/budget detail |
| `/founder/decisions` | Decision audit log | Redirect to `/founder/inspector/audit?area=decisions` once the inspector audit filter supports it |
| `/founder/traces` | Raw LLM prompt + response feed | Inspector's per-agent traces section covers this; add direct route alias |

### Into `/founder/steering`

| Old route | What it does today | Steering integration needed |
|---|---|---|
| `/founder/letter` | Monthly chief-of-staff narrative | Add a "Letter" tab to steering |
| `/founder/strategy` | Strategic proposals (weekly + synthesis) | Add a "Strategy" tab to steering |
| `/founder/trends` | 90-day trust gauge | Add a "Trends" tab to steering |
| `/founder/recovery-console` | Last-resort account recovery | Add a "Recovery" tab to steering with the existing modals |

### Specialized (case-by-case)

| Old route | Disposition |
|---|---|
| `/founder-dashboard` | The 5,835-LOC monolith. Stays live until its remaining sub-panels (operations / growth / infrastructure tabs) are absorbed. Don't redirect yet — the data flows haven't moved. |
| `/founder-financials` | Keep as specialized view; surface link from steering |
| `/founder-compliance-ops` | Keep; surface link from steering |
| `/founder/dsar`, `/founder/legal-holds`, `/founder/sub-processors` | Keep as compliance-domain pages; link from studio under "Compliance" |
| `/founder/cmo` | Already canonical |

## 60-day deprecation window

Per the plan, every redirect should ship a "this view has moved" banner on the canonical surface noting where the old data went. After 60 days of redirect traffic (monitored via existing access logs), redirects flip to 404 and the legacy page components delete.

That work is its own Phase F-3 — needs a banner component + a small analytics surface to track which old URLs are still being hit before deletion. Not blocking; can ship when convenient.

## Files deleted at end of deprecation

(captured here for the future cleanup — see plan for the full list)

- `client/src/pages/founder-dashboard.tsx` (5,835 LOC)
- `client/src/pages/founder-home.tsx` (1,190 LOC)
- `client/src/pages/founder-settings.tsx`
- `client/src/pages/founder/now.tsx` (component folds into a new `/founder` index — or stays as the implementation behind the index route)
- `client/src/pages/founder/cockpit.tsx` (same; implementation lives behind `/founder/steering`)
- Plus 25+ specialized pages that become studio/inspector tabs
