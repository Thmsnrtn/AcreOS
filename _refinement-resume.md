# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 5 of N)
**Last completed refinement:** `/properties` — list header / view
toggle / toolbar / error path / filtered-empty state / export+import
error UX (partial — subcomponents deferred)
**Phase 1 inventory:** ✅ committed at `11d0e8c`

## How to continue

Paste the original Elite-Team prompt into a fresh Claude Code session.
The next session will:

1. Read `docs/refinement/surface-inventory.md`
2. Read `docs/refinement/progress.md` (newest entries at bottom)
3. Read this file for the next surface
4. Continue the walk

## Progress summary

### Surfaces refined to date (all 9 specialists sign-off)

Session 1:
- `/` landing
- `/not-found`
- `/auth` (widget colorPrimary)

Session 2:
- `/auth` (backdrop + a11y)
- `/onboarding-v2`
- `PageLoader` (cross-cutting)
- `ThemeSettings` (cross-cutting)
- `QueryErrorState` (cross-cutting)
- `EmptyState` (cross-cutting)

Session 3:
- `/leads` (mobile checkbox tap targets)
- `/properties` + `/finance` (responsive grid pass — partial,
  grid only)
- `/settings` (tier badges)
- `/forgot-password` + `/reset-password`
- `/pipeline`, `/tools`, `/goals` (violet sweep)

Session 4:
- `/leads/dedupe` — confirm-before-merge + a11y radiogroup + error
  state conformance + mobile action-row stack + source badge
  promotion + token-based visuals

Session 5 (this one):
- `/properties` (list header slice) — dead error-path collapse;
  view toggle icon + 44px targets + focus ring; "Add Property"
  full label at all widths; export/import silent-failure toasts;
  filtered-empty state → shared EmptyState + reset CTA

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures — duplicated
  early-return blocks should be hunted down on any remaining list
  pages.
- **View toggle pattern** (grouped buttons, 44px mobile, 36px
  desktop, `role="group"`, `aria-pressed`, lucide icons): reusable
  on any page offering list/map/kanban toggles.
- **Silent-fetch → toast pattern:** any client-side
  `fetch`/`FormData` handler that catches to `console.error`
  should surface a destructive toast with specific recovery copy
  ("Your existing X weren't changed").
- **Filter-reset empty state:** when a filter empties the list,
  reset the *full* filter set (status + distress + GIS), not just
  one axis — users don't remember which filter hid things.

## Next surface to refine

**`/properties` — continued.** Pick up at `PropertyCard`
(lines ~886-1117 of `client/src/pages/properties.tsx`).

The rest of `properties.tsx`, in order:
1. `PropertyCard` (886-1117) — list-item density, metadata
   hierarchy, inline delete affordance, icon aria.
2. `PropertyForm` (1120-1333) — validation surfacing, mobile
   keyboard types (inputMode="decimal" on price/acreage), county
   autocomplete trust.
3. `PropertyDetailDialog` (1334-2102) — largest seam; tabs
   rhythm, comps analysis, AI offer generator grounding.
4. `DueDiligenceTab` (2103-2465) — checklist a11y
   (role="checkbox" semantics), progress bar contrast.
5. `PropertyIntelligenceTab` (2490-end) — AI output structure,
   lazy-load of heavy analytics.

Then:
6. `/deals` (kanban UX on 375px — earlier pass only touched colors)
7. `/campaigns`
8. `/inbox`
9. `/documents`
10. `/sign/:docId` — legal/trust surface; verify signer flow
11. `/portal/:accessToken` — borrower portal; public link, mobile-
    critical
12. `/ai`, `/atlas`, `/pax` — AI chat surfaces (AI-lens critical)

## Deferred / flagged for owner decision

- **"Distress Score" filter mislabel.** On `/properties` the filter
  control is labeled "Distress Score" but its source is
  `enrichment.scores.overallScore ?? investmentScore` — these are
  not the same concept. Either the label is wrong (should be
  "Investment Score"), the data source is wrong (should read a
  true distress signal), or both. Do not unilaterally rename;
  Thomas should decide which side is authoritative.

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session.
- Playwright Safari sessions die within ~5 minutes of a Clerk JWT
  refresh; fall back to code-only if cookies expire mid-audit.
- Stop at ~85% context; rewrite this file before ending.

## Known in-flight issues

- **Purple-on-Safari** — fixed at root (Clerk colorPrimary) and on
  every customer-visible site touched.
- **Red toast spam** — 404/403 globally suppressed.
- **Fly deploy leases** occasionally linger ~90s after a transient
  fail; retry.
- **Pre-existing server type errors** in `workflow-engine`,
  `storage`, `autonomousDealMachine`, `countyAssessorIngest`,
  `supportAgent`, etc. — not blocking client refinement work;
  out of scope for this pass.

## Expected HEAD after session 5 deploy

One commit above `26fd606` (the session-4 surface commit).
