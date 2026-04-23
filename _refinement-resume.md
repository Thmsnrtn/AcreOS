# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 5k — /deals list + bulk ops)
**Last completed refinement:** `/deals` list + bulk-actions —
bulk-stage-update onError + soft-fail toast, CSV escape/formula
injection guard, bulk-export success toast, decorative-icon
aria-hidden sweep (summary cards + header + bulk toolbar + mobile
stage nav), desktop clear-selection aria-label, mobile list-row
checkbox aria-label + 44px tap target, sentence-case copy sweep
("Deals updated", "Update stage").

**Phase 1 inventory:** ✅ committed at `11d0e8c`
**PropertyDetailDialog:** ✅ fully refined across all tabs.
**/deals kanban:** ✅ slice 5j complete (commit `f001623`).
**/deals list + filters:** ✅ slice 5k complete (commit `d157464`).
**/deals DealDetailDrawer (5 tabs):** ⬜ slice 5l next
**/deals DealForm:** ⬜ slice 5m

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

Session 5 (eleven slices so far — /properties and /deals):
- 5a–5i. `/properties` (list, card/form, detail dialog all tabs,
  research summary, comps, AI offer, chat, intelligence,
  cross-cutting status.replace sweep)
- 5j. `/deals` kanban slice — DndContext KeyboardSensor +
  announcements, column semantics, h3→h2, drag toasts, CSV toasts,
  bulk-copy sweep, dead-code removal, icon-label sr-only fallback
  (commit `f001623`)
- 5k. `/deals` list + bulk-actions slice — bulk-stage-update
  onError + soft-fail toast, CSV escape + formula-injection guard,
  bulk-export success toast, decorative-icon aria-hidden sweep
  (summary / header / bulk / mobile-nav), desktop clear-selection
  aria-label, mobile list-row checkbox aria-label + 44px tap
  target, sentence-case copy (commit `d157464`)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures.
- **View toggle pattern:** grouped buttons, 44px mobile, 36px
  desktop, `role="group"`, `aria-pressed`, lucide icons.
- **Silent-fetch → toast pattern:** any client `fetch`/`FormData`
  handler that catches to `console.error` should surface a
  destructive toast with specific recovery copy.
- **Silent-mutation → toast pattern (extended 5c):** mutations whose
  result UI *replaces* the trigger (e.g. Pursue/Pass buttons →
  decision badge) MUST surface both success and error toasts.
- **Silent-mutation → toast pattern (extended 5j):** drag-to-reorder
  or drag-to-change-state mutations must surface both outcomes —
  a react-query cache invalidate is not visible feedback, and on
  failure the card silently snaps back with no explanation.
- **Cross-cutting bug sweep trigger (5e):** when a refinement hits
  the *same* code-level bug in a fourth component, stop patching
  it locally; grep the client tree and fix everywhere in one sweep.
- **Silent-query → toast pattern (5c):** background query with
  `staleTime: 0` that silently fails while showing cached data is a
  trust bug. Wire `isError` → toast via `useEffect`.
- **Filter-reset empty state:** reset the full filter set when a
  filter empties the list.
- **Form mobile-keyboard checklist:** APN → `inputMode="numeric"`;
  acreage → `inputMode="decimal"`; state codes → `maxLength=2` +
  `autoCapitalize="characters"` + `autoComplete="address-level1"`;
  money → `type="number"` + `inputMode="decimal"` + `min=0`.
- **Decorative-icon aria-hidden sweep:** any icon next to a text
  label is decorative.
- **Collapsible proper-aria pattern:** `aria-expanded` +
  `aria-controls` + lucide chevron.
- **Tooltip-must-augment rule (5c):** delete tooltips that restate
  the visible label.
- **Spinner-copy-vs-first-load rule (5c):** "Loading latest X…"
  reads correctly for initial load AND background refetch.
- **Icon-only tab labels (new 5j):** the pattern
  `<span className="hidden sm:inline">Label</span>` hides the
  label entirely from SR on mobile (display:none removes from
  a11y tree). Convert to `sr-only sm:not-sr-only sm:inline`.
- **Draggable a11y (new 5j):** `useDraggable` + PointerSensor alone
  ships a mouse-only UX. Always add `KeyboardSensor` to the
  sensors list AND wire `accessibility.announcements` /
  `screenReaderInstructions` on DndContext. Draggable handle
  should be a real `<button>`, not an svg with listeners spread.
- **Droppable column semantics (new 5j):** droppable containers
  need aria-label that names the target state, not just the
  column heading. Screen reader hears "drop zone" once, not
  "{heading} {heading} {heading}" as they arrow through.

## Next surface to refine

**Next slice: `/deals` DealDetailDrawer — 5-tab surface (5l).**

Scope for 5l:
- Details tab: field ordering + currency formatting + status
  badge + stage-gate messaging. Stage-gate block copy + link to
  checklist.
- Documents tab: upload interaction (drag-drop + browse),
  per-file progress, OCR status chips, failure path.
- Timeline tab: ActivityTimeline a11y (role=list, item spacing,
  relative-time semantics).
- Checklist tab: template apply flow + item check/uncheck toast
  pattern + required vs optional visual distinction.
- ROI tab: number formatting, negative-ROI color semantics,
  DealCalculator embed responsive behavior.
- Drawer mechanics: focus trap, Esc to close, scrollable body at
  mobile, header safe-area on iOS, tab keyboard navigation.
- Delete flow from drawer → parent deletion dialog.

After 5l: slice 5m = DealForm (create / edit modal form).

Then move per inventory:
1. `/campaigns` — list + detail + create; AI-drafted letter copy
   is likely the AI/T hot spot
2. `/inbox` — message rendering + thread navigation a11y
3. `/documents` — upload + OCR trust signals
4. `/sign/:docId` — **legal/trust surface** — signer flow
5. `/portal/:accessToken` — borrower portal; **public link, mobile
   critical** — no Clerk auth, must work at 320px

## Deferred / flagged for owner decision

- **"Distress Score" filter mislabel** on `/properties` (see prior).
- **Pursue/Pass irreversibility** on PropertyDetailDialog (see prior).
- **Verdict `signalColors`** raw Tailwind traffic-light (see prior).
- **`typeFilter` on `/deals`** has state but no visible UI control
  to set it (only SavedViewsSelector can apply it indirectly).
  Either hidden feature or missing affordance — needs owner call.
- **"Pipeline" summary on `/deals`** aggregates acquisition-cost +
  disposition-revenue into one number, arguably misleading. Owner
  decision on whether to split.
- **Drag-to-move kanban bypasses stage-gate checks.** Drawer path
  respects `stageGate.canAdvance`; drag path does not. Intentional
  or gap?

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session. `/deals` is
  1991 lines — budgeted across 4 slices (5j–5m).
- Playwright Safari sessions die within ~5 minutes of a Clerk JWT
  refresh; fall back to code-only if cookies expire mid-audit.
- Stop at ~85% context; rewrite this file before ending.

## Known in-flight issues

- **Purple-on-Safari** — fixed at root and on every customer-visible
  site touched.
- **Red toast spam** — 404/403 globally suppressed.
- **Fly deploy leases** occasionally linger ~90s after a transient
  fail; retry.
- **Pre-existing server type errors** in `workflow-engine`,
  `storage`, `autonomousDealMachine`, `countyAssessorIngest`,
  `supportAgent`, etc. — not blocking client refinement work.

## Expected HEAD after session 5k

New commit on top of `f001623` (deals kanban) → `d157464`
(deals list + bulk-actions).
