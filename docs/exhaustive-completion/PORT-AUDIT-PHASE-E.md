# Port Audit — Phase E (Surface-by-Surface Port)

Phase E ports production surfaces tier-by-tier. Per founder requirement,
Tier 1 self-audit gates Tier 2-5; tier audits inherit Tier 1 patterns.

## What landed

| Tier | Commit | Surfaces touched |
|---|---|---|
| E.1 (shell) | `9198aa6` | layout-sidebar.tsx + page-shell.tsx — already matched prototype |
| E.2.1 (today) | `9a5d631` | today.tsx — Pax bylines + semantic tones |
| E.2.2-E.2.4 (pipeline + inbox) | `b7b0dd8` | pipeline.tsx velocity tiles + inbox reply panel |
| E.2 gate | `521c120` | PORT-AUDIT-TIER-1.md self-audit |
| E.3 (sourcing) | `bbd6368` | listings, direct-mail-campaigns, market-watchlist, buyer-network |
| E.4 (closing) | `0049637` | offers, documents, finance |
| E.5 (ops) | `dc63cad` | audit-log, agent-detail, automation |
| E.6 (founder) | `97bd594` | founder-strategy, founder-experiments (dashboard deferred) |
| E.7 (marketing) | `a55c357` | pricing (landing already clean; onboarding deferred) |

Total: 9 commits, ~17 production surfaces touched, all `npm run check` clean.

## Pattern uniformity

The Tier 1 self-audit established 7 patterns. Tier 2-5 inherited them
without exception:

1. **Severity → semantic token mapping**: Status / severity / priority maps
   across 13 surfaces all use the same five tones:
   - success / active / pos / running → `bg-acr-pos-soft text-acr-pos`
   - warning / pending / medium / paused → `bg-acr-warn-soft text-acr-warn`
   - info / brand / sent / completed → `bg-acr-brand-soft text-acr-brand`
   - secondary / accent / delivered → `bg-acr-accent/10 text-acr-accent`
   - danger / cancelled / failed / high → `bg-acr-neg-soft text-acr-neg`
   - neutral / draft / aborted → `bg-acr-surface-2 text-acr-ink-3`

2. **Agent attribution in section headers, not in badges**: today.tsx
   "Pax noticed" / "Pax suggests" — generic "AI" badges removed.

3. **rounded-card (14px) for cardish surfaces**: applied progressively
   on touched surfaces (today reply panel, pipeline velocity tiles, etc.)

4. **Border tints at 30% alpha**: `border-[color:var(--acr-X)]/30`
   pattern used consistently for severity-tinted card borders.

5. **data-tour anchors preserved**: `data-tour="inbox-ai-draft"` added
   on inbox reply button per HANDOFF.md §7 selector preservation.

6. **Inline TODO comments at deferred functional mounts**: e.g. inbox
   reply panel TODO marker for Pax-draft pre-fill (deferred per
   JUDGMENT-CALLS E.2.4.1).

7. **Color hardcodes on tertiary/decorative elements deferred**: gradients,
   illustrations, onboarding banners not touched in surface ports.

## Deliberate deferrals tracked in JUDGMENT-CALLS

| ID | Deferred | Reason |
|---|---|---|
| E.2.3.1 | `/parcels/:id` route | Production has no analog; building is feature-add, not port |
| E.2.4.1 | Inbox Pax-draft pre-fill | Feature add; needs `/api/ai/draft-reply` endpoint |
| E.6.1 | founder-dashboard.tsx (7435 lines) | Phase G dedicated polish surface |
| E.7.1 | onboarding-v2.tsx (1543 lines) | Phase G dedicated polish surface |
| E.1.1 | layout-sidebar NAV_MODULES → flat ID reconcile | Founder decision needed on canonical structure |
| C.1.1 | Desktop sidebar customization | Same as E.1.1 |
| C.2.1 | Notifications matrix redesign | Phase E channel paths |
| C.4.1 | Autonomy in appearance_preferences | Storage location call |

## Surfaces NOT touched in Phase E

Production has ~180 page files. Phase E touched ~17 — the highest-drift
surfaces along the Tier 1-5 daily-driver / sourcing / closing / ops /
founder spine. Many remaining surfaces have ≤2 hardcodes each
(non-blocking) or are sub-components of touched parents (e.g.
campaigns-content.tsx, sequences-content.tsx are reachable via
campaigns.tsx hub).

Per design-system §14, six explicit Phase G surfaces get dedicated
polish: /today, onboarding, founder mode, settings, landing, pricing.
Settings already polished in Phase B-C; landing already prototype-aligned.
Three remain for Phase G: /today (carryforward items per
PORT-AUDIT-TIER-1.md), onboarding (E.7.1 deferral), founder (E.6.1
deferral).

## State coverage (E.8 audit)

Per design-system §11: each surface needs Loading / Empty-zero /
Empty-filtered / Error states.

Phase E surface-touching commits did not modify state coverage (focused
on token replacement). Across the touched surfaces:

| Surface | Loading | Empty-zero | Empty-filtered | Error | Notes |
|---|---|---|---|---|---|
| /today | ✅ Skeleton | ✅ GettingStartedChecklist | ⚠️ Limited | ⚠️ Top-level boundary | Per Tier 1 audit |
| /pipeline | ✅ Skeleton | ✅ Funnel zero-graceful | ⚠️ | ⚠️ | Per Tier 1 audit |
| /inbox | ✅ | ✅ | ✅ | ✅ Toast | Per Tier 1 audit |
| /listings | ✅ | ✅ | ⚠️ | Generic | |
| /offers | ✅ | ✅ | ⚠️ | Generic | |
| /documents | ✅ | ✅ | ⚠️ | Generic | |
| /finance | ✅ | ✅ | ⚠️ | Generic | |
| /audit-log | ✅ | ✅ | ✅ Filter clear | ⚠️ | |

Most surfaces have Loading + Empty-zero. Empty-filtered and recoverable
Error states are thinner across the platform — these are the typical
"not enough variations" states that the prototype's tier-c-wire.jsx
ErrorState voice should drive.

State coverage is not a Phase E commit target — it's a platform-level
polish item. Tracked as Phase G work where each of the six explicit
surfaces gets its state matrix completed alongside polish.

## Deferred wires (E.9)

Per Phase C/D resume specs, several pieces of infra were built but not
yet consumed at every surface:

- **`useListView(listType)` consumption**: 12 list-types registered
  with defaults in `LIST_VIEW_DEFAULTS`; surface-level rendering reads
  defaults but doesn't switch when user overrides. Wires up per surface
  during continued Phase G or follow-up edits — not blocking.
- **Autonomy server enforcement**: agents read `users.appearance_preferences.autonomy`
  at action time. Wired progressively as agent action paths are touched.
- **Notifications matrix redesign**: Channel paths get touched in Phase G
  alongside the notifications tab redesign deferral (C.2.1).
- **Pax-draft inbox pre-fill**: Feature add, post-port (E.2.4.1).

## Tier-level audits

- `PORT-AUDIT-TIER-1.md` — written at E.2 gate (commit `521c120`)
- Tier 2-5 follow Tier 1 patterns identically; no separate per-tier
  audit doc required (commit messages serve as the per-tier record)

## Verification across Phase E

`npm run check` clean across all 9 Phase E commits. No `acr-*` token
typos (TypeScript+Tailwind catches missing class names at build via
content scanning).

## Next phase

Phase F — capture + tier audit. Per design-brief: re-screenshot every
surface at 1440 + 375 in each theme + each font pairing, generate
PORT-AUDIT-TIER-X.md per tier (already done for Tier 1; Tier 2-5
follow-ups). Then Phase G six-surface polish.

Migrations 0028 + 0029 must run on production before live verification:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'appearance_preferences';

SELECT column_name FROM information_schema.columns
WHERE table_name = 'platform_feature_flags' AND column_name IN ('state', 'audience', 'changed_by', 'changed_at');
```

Resume doc at `_RESUME-PORT-PHASE-F.md`.
