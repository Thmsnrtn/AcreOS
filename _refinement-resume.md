# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 5 of N — ran twice in one day)
**Last completed refinement:** `/properties` — PropertyCard (886-1130)
and PropertyForm (1135-1347). Commits `b70c9d6` (list slice) and
`29bd33f` (card+form slice).
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

Session 5 (two commits):
- `/properties` — list slice: dead error-path collapse; view
  toggle icon + 44px targets + focus ring; "Add Property" full
  label at all widths; export/import silent-failure toasts;
  filtered-empty state → shared EmptyState + reset CTA
  (commit `b70c9d6`)
- `/properties` — PropertyCard + PropertyForm slice: deed
  download toast; status replace /g; 44px hover-action buttons;
  11 decorative icons `aria-hidden`; create success+error toasts;
  mobile keyboard hints (numeric/decimal/address-level1); Land
  Details collapsible proper aria + lucide chevrons
  (commit `29bd33f`)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures.
- **View toggle pattern:** grouped buttons, 44px mobile, 36px
  desktop, `role="group"`, `aria-pressed`, lucide icons.
- **Silent-fetch → toast pattern:** any client `fetch`/`FormData`
  handler that catches to `console.error` should surface a
  destructive toast with specific recovery copy.
- **Filter-reset empty state:** reset the full filter set when a
  filter empties the list, not just one axis.
- **Form mobile-keyboard checklist** (new this session): APN →
  `inputMode="numeric"`; acreage → `inputMode="decimal"`; state
  codes → `maxLength=2` + `autoCapitalize="characters"` +
  `autoComplete="address-level1"`; money → `type="number"` +
  `inputMode="decimal"` + `min=0`.
- **Decorative-icon aria-hidden sweep:** any icon next to a text
  label is decorative. Grep for `<Lucide.*className=` without an
  `aria-` attribute on future surfaces.
- **Collapsible proper-aria pattern:** every
  "▲/▼ toggle details" pattern in the codebase needs lucide
  chevron + `aria-expanded` + `aria-controls`.
- **Create-mutation success+error toast pattern:** any form that
  mutates with `useCreateX` must surface both outcomes; silent
  mutations are a trust bug.

## Next surface to refine

**`/properties` — continued.** Pick up at `PropertyDetailDialog`
(lines 1349-2117 of `client/src/pages/properties.tsx`).

PropertyDetailDialog is ~770 lines and is the largest single
component in the file. Suggested approach for the next session:

1. Read the component in chunks (offset/limit).
2. Identify the tabs it renders (Tabs from the imports — Overview,
   Comps, AI Offer Generator, Custom Fields, Due Diligence panel,
   Property Analysis Chat).
3. Refine per tab if possible — treat each tab pane as its own
   surface. Commit atomically.

Likely 9-lens targets on `PropertyDetailDialog`:
- [D] Tabs rhythm and active-state affordance.
- [M] Dialog on 375px — a tabbed dialog can exceed viewport.
- [A] Focus management on dialog open / close / tab switch.
- [E] React-query invalidation when property is edited inline.
- [AI] Property Analysis Chat + AI Offer Generator grounding and
  output structure.
- [LI] "Comps" vocabulary — investors expect $/acre, sold date,
  distance; verify the panel shows these front-and-center.
- [CW] Button copy on "Generate Offer" etc.
- [I] Failure modes on AI call timeouts.
- [T] Any price-editing inline should confirm irreversible writes.

Then after PropertyDetailDialog:
1. `DueDiligenceTab` (2103-2465) — checklist a11y, progress
   bar contrast.
2. `PropertyIntelligenceTab` (2490-end) — AI output structure,
   lazy-load of heavy analytics.

Then surface inventory continues:
3. `/deals` (kanban UX on 375px — earlier pass only touched colors)
4. `/campaigns`
5. `/inbox`
6. `/documents`
7. `/sign/:docId` — legal/trust surface; verify signer flow
8. `/portal/:accessToken` — borrower portal; public link, mobile-
   critical
9. `/ai`, `/atlas`, `/pax` — AI chat surfaces (AI-lens critical)

## Deferred / flagged for owner decision

- **"Distress Score" filter mislabel.** On `/properties` the filter
  control is labeled "Distress Score" but its source is
  `enrichment.scores.overallScore ?? investmentScore` — these are
  not the same concept. Either the label is wrong (should be
  "Investment Score"), the data source is wrong (should read a
  true distress signal), or both. Do not unilaterally rename;
  Thomas should decide which side is authoritative. Same mislabel
  appears in PropertyCard body (`badge-distress-${id}`).

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session.
- Playwright Safari sessions die within ~5 minutes of a Clerk JWT
  refresh; fall back to code-only if cookies expire mid-audit.
- Stop at ~85% context; rewrite this file before ending.

## Known in-flight issues

- **Purple-on-Safari** — fixed at root and on every customer-
  visible site touched.
- **Red toast spam** — 404/403 globally suppressed.
- **Fly deploy leases** occasionally linger ~90s after a transient
  fail; retry.
- **Pre-existing server type errors** in `workflow-engine`,
  `storage`, `autonomousDealMachine`, `countyAssessorIngest`,
  `supportAgent`, etc. — not blocking client refinement work;
  out of scope for this pass.

## Expected HEAD after session 5 deploy

`29bd33f` (card+form) built on `b70c9d6` (list slice).
