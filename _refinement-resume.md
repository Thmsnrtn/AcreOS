# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 4 of N)
**Last completed refinement:** `/leads/dedupe` cluster review / merge flow,
commit `26fd606`
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

Session 4 (this one):
- `/leads/dedupe` — confirm-before-merge + a11y radiogroup + error
  state conformance + mobile action-row stack + source badge
  promotion + token-based visuals

## Cross-cutting gains this pass

- **Destructive-merge confirmation pattern** established via
  `ConfirmDialog` — reuse on any future bulk-archive / bulk-delete
  surface (leads, properties, campaigns).
- **QueryErrorState now load-bearing** on a real data page —
  precedent for replacing any remaining raw `res.status/text-red`
  error blobs in customer-facing views.
- **Radiogroup-on-card** pattern (div with role="radio" + roving
  tabIndex) proven out on dedupe — can be reused wherever we ask
  an operator to pick one of N options presented as rich cards.

## Next surface to refine

**`/properties`** — full walk.

⚠️ This file is ~55k tokens. Strategy for the next session:

1. Start by reading `client/src/pages/properties.tsx` in chunks
   (offset/limit) — don't Read the whole file at once.
2. Consider splitting into multiple commits along natural seams:
   list view, detail view, create modal, filters, empty state.
3. If the page is already componentized, refine each subcomponent
   file separately rather than the monolith.
4. Prior session 3 pass only touched a responsive grid cell —
   almost everything else on this surface is still untouched.

Likely nine-lens targets on /properties:
- [D] Information hierarchy on list cards; rhythm between filters,
  list, and detail pane.
- [M] 375px layout — properties are data-dense; likely needs
  columnar collapse or card view on mobile.
- [A] Filter controls keyboard operability; detail pane focus
  management when a row is selected.
- [E] React-query staleness / invalidation on create/edit/delete.
- [AI] Any embedded AI evaluation / motivation-score outputs —
  grounding + structure.
- [LI] Vocabulary: "APN," "acreage," "frontage," "ingress/egress"
  — confirm they appear where an investor would expect.
- [CW] Empty state ("No properties yet — import a list") copy.
- [I] Timeout/error behavior on provider-enriched fields.
- [T] Delete confirmation and any irreversible field changes.

## Queue after `/properties`

In inventory order:
1. `/deals` (kanban UX on 375px — earlier pass only touched colors)
2. `/campaigns`
3. `/inbox`
4. `/documents`
5. `/sign/:docId` — legal/trust surface; verify signer flow
6. `/portal/:accessToken` — borrower portal; public link, mobile-
   critical
7. `/ai`, `/atlas`, `/pax` — AI chat surfaces (AI-lens critical)

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
  every customer-visible site touched. Users still on a `midnight`
  preset can one-tap fix via "Reset to Desert" link in
  Settings → Theme.
- **Red toast spam** — 404/403 globally suppressed.
- **Fly deploy leases** occasionally linger ~90s after a transient
  fail; retry.
- **Pre-existing server type errors** in `autonomousDealMachine`,
  `countyAssessorIngest`, `supportAgent`, etc. — not blocking
  client refinement work; out of scope for this pass.

## Expected HEAD after session 4 deploy

`26fd606` or later.
