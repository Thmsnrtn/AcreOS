# Tier 5 Audit — Founder Mode Surfaces

Phase E.6 commit `97bd594`.

## Surfaces

| Surface | Status | Drift before | Drift after |
|---|---|---|---|
| `/founder-strategy` | Ported | 6 hardcodes (CATEGORY_COLOR map) | Semantic projection |
| `/founder-experiments` | Ported | 6 hardcodes (STATUS_COLOR + leader-variant border) | Semantic |
| `/founder-dashboard` | Deferred to Phase G | 293 hardcodes / 7435 lines | n/a (Phase G polish) |
| `/founder/features` | Built in Phase D | n/a | Already prototype-aligned (calm 5-state table) |
| `/founder-letter` | Already light | 3 hardcodes | Not touched |
| `/founder-trends` | Already light | 5 hardcodes | Not touched |
| `/founder-tools` | Already light | 8 hardcodes | Not touched |
| `/founder-prompt-evolutions` | Already light | 1 hardcode | Not touched |
| `/founder-daily-digest` | Already light | 2 hardcodes | Not touched |
| `/founder-preview` | Not examined | n/a | Phase G if needed |
| `/founder-settings` | Not examined | n/a | Phase G if needed |
| `/founder-experiments` ↑ already listed | | | |
| `/founder/atlas-run` | Built? Check Phase E.6 spec | | Per HANDOFF.md §3 — production may not have route |

## Founder mode design register (§14)

Per design-system §14: "Continuous design language with subtle accent +
denser layout. Same family, deeper data." Founder mode is one of six
explicit Phase G dedicated polish surfaces — Tier 5 ports the bounded
sub-surfaces (strategy + experiments) and leaves the dashboard for
focused polish where the prototype reference can drive the layout call.

## Voice (§1)

- /founder-strategy: "Strategic proposals" + "Last review N days ago"
  + category labels "Revenue / Retention / Product / Ops / Risk".
  Plain, specific. ✅
- /founder-experiments: status "Running / Paused / Completed / Aborted"
  + "Leading variant" inline label on winning A/B variant. ✅
- Inline error texts on both surfaces use "Couldn't [action]. [recovery
  hint]." pattern (per design-system §11). ✅

## Visual baseline (§2)

Both ported surfaces apply the platform-wide status pill grammar. The
leader-variant border on experiments uses `border-[color:var(--acr-pos)]/30
bg-acr-pos-soft` — 30% alpha border + soft fill, matching Tier 1
pipeline velocity tile pattern.

## Density (§2.1)

Founder mode default density: compact (per §5.5: "Founder mode: compact,
varies, denser, more analytical"). ✅ /founder-strategy and
/founder-experiments both render in compact rows.

## Component grammar (§5)

shadcn primitives, Lucide icons, semantic tones. ✅

## Agent presence (§1.3)

Founder mode surfaces are operator dashboards — they show agent activity
(via existing v12 lifecycle / agent-detail page) rather than embedding
agent attribution within the founder surface itself.

## State coverage (§11)

| Surface | Loading | Empty-zero | Empty-filtered | Error |
|---|---|---|---|---|
| /founder-strategy | ✅ | ✅ "No proposals yet" | ⚠️ | ✅ Inline error |
| /founder-experiments | ✅ | ✅ "No experiments yet" | ⚠️ | ✅ Inline error |

## Phase G polish targets (carryforward from Tier 5)

1. **founder-dashboard.tsx** — 7435 lines / 293 hardcodes. Full prototype
   reference walk-through; layout decisions (e.g. metric strip shape, KPI
   card grid) re-evaluated against design-system §14.
2. **AGENT_COLORS** identity map reconciliation across /Agents,
   /agent-detail, /agent-collaboration. Decide: per-codename hex colors
   stay as agent identity, get replaced with letter-mark + tone, or
   move to a token-driven palette?
3. **/founder/atlas-run** — verify route registration (may be one of the
   four unimplemented founder sub-routes from Gap 1.1.C findings).

## Verdict

Tier 5 passes for the bounded surfaces. Founder dashboard explicitly
deferred to Phase G dedicated polish per design-system §14 + JUDGMENT-CALLS E.6.1.
