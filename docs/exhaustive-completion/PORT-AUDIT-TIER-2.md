# Tier 2 Audit — Sourcing Surfaces

Phase E.3 commit `bbd6368`. Tier 2 inherits all 7 patterns established in
PORT-AUDIT-TIER-1.md (no separate gate; Tier 1 was the gate).

## Surfaces

| Surface | Status | Drift before | Drift after |
|---|---|---|---|
| `/listings` | Ported | 8 hardcodes (status badges) | Semantic tones |
| `/direct-mail-campaigns` | Ported | 8 hardcodes (status badges) | Semantic tones |
| `/market-watchlist` | Ported | 6 hardcodes (severity borders) | Semantic tones |
| `/buyer-network` | Ported | 8 hardcodes (analytics tile icons + match bar) | Semantic tones |
| `/campaigns` | Already clean | 0 hardcodes | n/a |
| Prototype's `/buyboxes`, `/lists`, `/campaigns/performance` | n/a | No production analog | Skipped per E.2.3.1 pattern |

## Pattern application

All four touched surfaces apply the same status → semantic tone map:
- success / active / sent / running → `bg-acr-pos-soft text-acr-pos`
- warning / pending / sending / scheduled → `bg-acr-warn-soft text-acr-warn`
  (or `bg-acr-brand-soft text-acr-brand` for "info" rather than "warn"
  semantics)
- info / brand / queued / paid_off → `bg-acr-brand-soft text-acr-brand`
- danger / cancelled / withdrawn → `bg-acr-neg-soft text-acr-neg`
- neutral / draft → `bg-acr-surface-2 text-acr-ink-3`

## Voice (§1)

- /listings — "Mark active / pending sale / sold / withdrawn" plain
  language. ✅
- /buyer-network — "Active buyers / Hot markets / Avg match score /
  Active alerts" specific over vague. ✅
- /direct-mail-campaigns — "Draft / Scheduled / Sending / Sent" plain. ✅

No cutesy / hype residuals on the touched Tier 2 surfaces.

## Visual baseline (§2)

All status pills now use `bg-acr-X-soft` + `text-acr-X` + `border-transparent`
— matches Tier 1 listings.tsx structure. Tiles in /buyer-network use
the same alpha-on-bg pattern as Tier 1 /pipeline velocity tiles.

## Density (§2.1)

Per design-system §5.5:
- /listings: rows default ✅
- /buyer-network: cards (row-of-cards layout for analytics + matches) ✅
- /direct-mail-campaigns: rows ✅
- /market-watchlist: rows ✅
- /campaigns: hub with tabs (Tabs primitive) ✅

Per-list-type useListView consumption deferred to Phase G alongside
ports of the touched surfaces.

## Component grammar (§5)

shadcn primitives throughout. Lucide icons. No icon-family mix.
`rounded-card` applied progressively where new card-style surfaces were
introduced.

## Agent presence (§1.3)

No direct agent attribution surfaces in Tier 2 (these are sourcing /
data surfaces; Pax / Atlas / Sophie attribution lives in /today,
/inbox, and parcel detail per the prototype).

## State coverage (§11)

| Surface | Loading | Empty-zero | Empty-filtered | Error |
|---|---|---|---|---|
| /listings | ✅ | ✅ | ⚠️ | Generic |
| /buyer-network | ✅ | ✅ | ⚠️ | Generic |
| /direct-mail-campaigns | ✅ | ✅ | ⚠️ | Generic |
| /market-watchlist | ✅ | ✅ | ⚠️ | Generic |

Per-surface state coverage gaps tracked at Phase G.

## Verdict

Tier 2 passes. Patterns inherited cleanly from Tier 1.
