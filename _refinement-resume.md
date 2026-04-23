# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 5l — DealDetailDrawer)
**Last completed refinement:** `DealDetailDrawer` (5-tab surface in
`deals.tsx`) — drawer role=dialog + Esc key, pricing/negotiate
buttons 44px + aria-label, decorative icon aria-hidden sweep,
checklist checkbox → role=checkbox/aria-checked/44px, window.confirm
→ ConfirmDialog for template replace, money unset → em-dash,
dealPackages silent failure → toast, dead "Generate Documents" /
"View Property" stub buttons removed, loading spinners → skeletons,
sentence-case copy sweep, shadowed `statusColors` renamed,
DialogDescription for a11y.

**Phase 1 inventory:** ✅ committed at `11d0e8c`
**PropertyDetailDialog:** ✅ fully refined across all tabs.
**/deals kanban:** ✅ slice 5j complete (commit `f001623`).
**/deals list + filters:** ✅ slice 5k complete (commit `d157464`).
**/deals DealDetailDrawer (5 tabs):** ✅ slice 5l complete.
**/deals DealForm:** ⬜ slice 5m next

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

Session 5 (twelve slices so far — /properties and /deals):
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
- 5l. `/deals` DealDetailDrawer — drawer role=dialog + Esc, AI
  button a11y + 44px targets, checklist checkbox role=checkbox /
  aria-checked / 44px, window.confirm → ConfirmDialog, dead-stub
  button removal, money-unset → em-dash, silent fetch → toast,
  DialogDescription binding, skeleton loading states,
  decorative-icon aria-hidden sweep, sentence-case copy, shadow
  rename (pkgStatusColors)

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
- **Silent-query → toast pattern (extended 5l):** a `queryFn` that
  returns `[]` on `!response.ok` is also a trust bug — the user
  sees an empty state indistinguishable from "genuinely empty."
  Throw on !ok and surface via `isError` → toast.
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
- **Icon-only tab labels (5j):** the pattern
  `<span className="hidden sm:inline">Label</span>` hides the
  label entirely from SR on mobile (display:none removes from
  a11y tree). Convert to `sr-only sm:not-sr-only sm:inline`.
- **Draggable a11y (5j):** `useDraggable` + PointerSensor alone
  ships a mouse-only UX. Always add `KeyboardSensor` to the
  sensors list AND wire `accessibility.announcements` /
  `screenReaderInstructions` on DndContext. Draggable handle
  should be a real `<button>`, not an svg with listeners spread.
- **Droppable column semantics (5j):** droppable containers
  need aria-label that names the target state, not just the
  column heading.
- **CSV export escape rule (5k):** double embedded quotes AND
  neutralize formula-trigger leading characters (`=`, `+`, `-`,
  `@`, `\t`, `\r`) with a `'` prefix. Factor `escapeCell` out if
  a third surface needs CSV.
- **Bulk-mutation triple-path rule (5k):** handle `success=true`,
  `success=false` (soft-fail), and `onError` — independently. Any
  bulk mutation that toasts only on one path leaves silent-failure
  holes on the other two.
- **Dead-stub rule (new 5l):** a button with no `onClick` and no
  `type="submit"` is a broken UI promise, not a visual
  placeholder. Wire it in the same commit or remove it — never
  ship a "future feature" button.
- **Money-unset display rule (new 5l):** `$0` rendered from a
  nullable amount reads as "this deal is worth nothing." Render
  "—" (muted) when the value is `null`/`undefined`/`""`; reserve
  `$0.00` for deals where zero is the captured amount.
- **Radix DialogDescription rule (new 5l):** subtitle paragraphs
  inside `DialogHeader` should be `<DialogDescription>` so Radix
  wires `aria-describedby`. Raw `<p>` loses that binding.
- **Dialog Esc key rule (new 5l):** a hand-rolled drawer/overlay
  without Radix Dialog/Sheet backing must ship at minimum:
  `role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}`,
  and a `useEffect` that listens for `Escape`. Better: convert to
  Radix Sheet/Dialog.
- **Checklist-checkbox role rule (new 5l):** toggle buttons that
  semantically check/uncheck a list item should be
  `role="checkbox"` + `aria-checked={bool}` + named
  `aria-label`. Not a bare `<button>` with an icon.
- **Window.confirm ban (new 5l):** native `confirm()` is
  inaccessible (no focus trap with surrounding Radix UI, no
  aria wiring, inconsistent styling, blocks main thread). Always
  use `ConfirmDialog` — it's already in the tree.

## Next surface to refine

**Next slice: `/deals` DealForm — create/edit modal form (5m).**

Scope for 5m:
- Field ordering: type → property → offer → dates → title → notes.
- Form mobile-keyboard checklist applied (offer amount numeric /
  decimal inputMode, close date proper native date picker).
- Currency inputs: leading `$` adornment + right-align digits.
- Validation states: visible error copy; aria-invalid wired.
- Property combobox: confirm "searchable" + keyboard nav; loading
  state while useProperties() is pending.
- Submit button: disabled while `isPending`, 44px target, loading
  indicator copy ("Saving…" not "Loading…").
- Dialog-close focus restoration back to the triggering button.
- Error recovery: server validation error surfaces which field
  failed, not just a generic toast.

After 5m: move per inventory to:
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
- **DealDetailDrawer focus restoration (new 5l):** drawer does not
  return focus to the row/card that opened it. Proper fix = parent
  hands a `triggerRef`/`returnFocusTo` prop in, or convert overlay
  to Radix Sheet. Deferred as bigger refactor.
- **DealDetailDrawer focus trap (new 5l):** hand-rolled overlay
  has no focus trap. Tab escapes to underlying page. Bigger refactor
  = convert to Radix Sheet/Dialog. Deferred.

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session. `/deals` is
  now >2000 lines — DealForm is ~170 lines, self-contained slice.
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

## Expected HEAD after session 5l

New commit on top of `d157464` (deals list + bulk-actions).
