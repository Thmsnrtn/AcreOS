# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 5c — third slice on /properties in one day)
**Last completed refinement:** `/properties` — PropertyDetailDialog
header + Quick Verdict + Overview tab. Commit forthcoming.
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

Session 5 (three slices):
- 5a. `/properties` — list slice (commit `b70c9d6`)
- 5b. `/properties` — PropertyCard + PropertyForm slice (commit
  `29bd33f`)
- 5c. `/properties` — PropertyDetailDialog header + Quick Verdict +
  Overview tab (commit TBD this session)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures.
- **View toggle pattern:** grouped buttons, 44px mobile, 36px
  desktop, `role="group"`, `aria-pressed`, lucide icons.
- **Silent-fetch → toast pattern:** any client `fetch`/`FormData`
  handler that catches to `console.error` should surface a
  destructive toast with specific recovery copy.
- **Silent-mutation → toast pattern (extended 5c):** mutations whose
  result UI *replaces* the trigger (e.g. Pursue/Pass buttons → decision
  badge) MUST surface both success and error toasts, because the
  replaced UI is no longer there to show a state change.
- **Silent-query → toast pattern (new 5c):** a background query with
  `staleTime: 0` that silently fails while showing cached data is a
  trust bug. Wire an `isError` → toast via `useEffect` so the operator
  knows they're viewing the last known version.
- **Filter-reset empty state:** reset the full filter set when a
  filter empties the list, not just one axis.
- **Form mobile-keyboard checklist:** APN → `inputMode="numeric"`;
  acreage → `inputMode="decimal"`; state codes → `maxLength=2` +
  `autoCapitalize="characters"` + `autoComplete="address-level1"`;
  money → `type="number"` + `inputMode="decimal"` + `min=0`.
- **Decorative-icon aria-hidden sweep:** any icon next to a text
  label is decorative. Grep for `<Lucide.*className=` without an
  `aria-` attribute on future surfaces. 5c: 16 more icons.
- **Collapsible proper-aria pattern:** every "▲/▼ toggle details"
  pattern needs lucide chevron + `aria-expanded` + `aria-controls`.
- **Create-mutation success+error toast pattern:** any form that
  mutates with `useCreateX` must surface both outcomes; silent
  mutations are a trust bug.
- **Tooltip-must-augment rule (new 5c):** if a tooltip only restates
  the trigger's visible label, delete or rewrite it. Tooltips are
  for the context the label can't hold.
- **Spinner-copy-vs-first-load rule (new 5c):** copy on a loading
  indicator cannot assume "updating" — if the same indicator appears
  on first open, use "Loading latest X…" which reads correctly for
  both initial load and background refetch.

## Next surface to refine

**`/properties` — continued.** Next slice picks up at the inner
tab components:

1. `PropertyIntelligenceTab` (`client/src/pages/properties.tsx`
   near end of file) — AI output grounding, lazy-load of heavy
   analytics, data provenance on scores.
2. `CompsAnalysis` (imported — likely own file) — LI-critical.
   Investors need sold-date, $/acre, distance. Verify those are
   front-and-center.
3. `AIOfferGenerator` (imported — likely own file) — AI grounding,
   cost controls, failure modes on slow LLM calls.
4. `DueDiligencePanel` / `DueDiligenceTab` — checklist a11y,
   progress bar contrast, print-mode.
5. `PropertyAnalysisChat` — AI chat surface, streaming states,
   error paths.

Suggested order for next session: do each tab as its own slice so
commits stay atomic. Start with `DueDiligenceTab` (lines 2138+ of
properties.tsx — it's inline in the file) because it's directly
visible and the a11y work is concrete. Then move to the imported
tab components.

### Likely 9-lens targets carrying into next slice

- [LI] Comps: sold date, $/acre, distance from subject — are these
  the three primary columns? Any investor-critical fields missing?
- [AI] AIOfferGenerator grounding: does the offer price cite comps
  and taxes? If the LLM hallucinates, is the output bounded?
- [I] Offer/chat API timeouts — 30s cap? fallback copy?
- [T] DueDiligence checklist: completing items = trust-critical
  claims. Any "mark complete" button should not be a single click
  if it implies legal responsibility (e.g. "title verified").
- [A] Checklist progress bar contrast in dark mode.
- [M] Print CSS on DD panel — window.print() is wired but the
  layout may reflow badly.

## Deferred / flagged for owner decision

- **"Distress Score" filter mislabel.** On `/properties` the filter
  control is labeled "Distress Score" but its source is
  `enrichment.scores.overallScore ?? investmentScore` — these are
  not the same concept. Either the label is wrong (should be
  "Investment Score"), the data source is wrong (should read a
  true distress signal), or both. Do not unilaterally rename;
  Thomas should decide which side is authoritative.
- **Pursue/Pass irreversibility (5c surfaced).** The Quick Verdict
  buttons write `status` + `dueDiligenceData.verdictDecision` and
  then permanently replace themselves with a "Pursuing" / "Passed"
  badge. There is no UI path in this dialog to revert. Success
  toast wording now implies reversibility ("You can still reopen
  this record — nothing is deleted"), but there is no actual undo
  control here. Owner decision needed: add explicit Revert button
  beside the decision badge, or leave reversal to the main status
  editor?
- **Verdict `signalColors` use raw Tailwind (green/yellow/red)**
  rather than design tokens. CLAUDE.md says never hardcode colors,
  but semantic traffic-light colors are the natural exception —
  green = Strong Buy, yellow = Investigate, red = Pass. Left as-is.
  Revisit if a design-system "signal" palette is formalized.

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

## Expected HEAD after session 5c deploy

New commit on top of `29bd33f` (card+form) → `b70c9d6` (list slice).
