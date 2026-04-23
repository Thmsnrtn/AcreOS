# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (sessions 6a + 6b — `/campaigns` full
surface minus embedded AbTest/Variants/Analytics sub-panels)
**Last completed refinement:** `CampaignDetailDrawer` +
`SendMailDialog` + `OptimizerSuggestionsPanel` in
`components/campaigns-content.tsx` — hand-rolled overlay got
role=dialog + aria-modal + aria-labelledby + Esc handler (5l rule),
close button aria-label, sentence-case sweep on drawer headers +
sections + buttons + toasts, tabular-nums across all counters /
percentages / currency, `toLocaleString()` on stat counters,
send-confirmation banner now names recipient count alongside
estimated cost, credit-balance copy uses en-dash + tabular-nums
currency, estimate-error card gets role=alert with specific
recovery copy, optimizer collapse toggle gets aria-expanded +
aria-controls, status-badge capitalize extended to drawer header,
header wraps cleanly at 375px via gap-4 flex-wrap, decorative-icon
aria-hidden sweep across drawer + send dialog + optimizer.

**Phase 1 inventory:** ✅ committed at `11d0e8c`
**PropertyDetailDialog:** ✅ fully refined across all tabs.
**/deals kanban:** ✅ slice 5j complete (commit `f001623`).
**/deals list + filters:** ✅ slice 5k complete (commit `d157464`).
**/deals DealDetailDrawer (5 tabs):** ✅ slice 5l complete (`cc375b1`).
**/deals DealForm (create modal):** ✅ slice 5m complete (`0707ee4`).
**/campaigns list + create:** ✅ slice 6a complete (`ea096ec`).
**/campaigns detail drawer + OptimizerSuggestions + SendMailDialog:** ✅ slice 6b complete (`cf10579`).
**/campaigns A/B test manager + variants panel + analytics:** ⬜ slice 6c next (or defer — these are separate embedded components)
**/inbox:** ⬜ slice 7 — message rendering + thread navigation a11y

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

Session 5 (thirteen slices — /properties and /deals):
- 5a–5i. `/properties` (list, card/form, detail dialog all tabs,
  research summary, comps, AI offer, chat, intelligence,
  cross-cutting status.replace sweep)
- 5j. `/deals` kanban slice (commit `f001623`)
- 5k. `/deals` list + bulk-actions slice (commit `d157464`)
- 5l. `/deals` DealDetailDrawer slice (commit `cc375b1`)
- 5m. `/deals` DealForm create modal (commit `0707ee4`)

Session 6:
- 6a. `/campaigns` list + create modal — QueryErrorState, sentence-
  case sweep, tabular-nums, required asterisks, controlled date
  input w/ Invalid-Date guard, currency adornment, template
  radiogroup a11y, SparklineTrend role=img, $0.75–$1.25 range fix,
  Land Academy brand scrub (commit `ea096ec`)
- 6b. `/campaigns` CampaignDetailDrawer + SendMailDialog +
  OptimizerSuggestionsPanel — role=dialog + aria-modal +
  aria-labelledby + Esc handler (5l rule), sentence-case sweep,
  tabular-nums across all counters/%/currency, send-confirmation
  names recipient count alongside cost, aria-expanded/controls on
  optimizer collapse, role=alert on estimate error, decorative-
  icon aria-hidden sweep (commit `cf10579`)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures. /campaigns now
  conforms.
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
  Radix Sheet/Dialog. **/campaigns CampaignDetailDrawer next
  candidate (6b).**
- **Checklist-checkbox role rule (new 5l):** toggle buttons that
  semantically check/uncheck a list item should be
  `role="checkbox"` + `aria-checked={bool}` + named
  `aria-label`. Not a bare `<button>` with an icon.
- **Window.confirm ban (new 5l):** native `confirm()` is
  inaccessible (no focus trap with surrounding Radix UI, no
  aria wiring, inconsistent styling, blocks main thread). Always
  use `ConfirmDialog` — it's already in the tree.
- **Prerequisite-select three-state rule (new 5m):** when a
  creation form depends on a prerequisite entity (deal → property,
  package → deal, etc.), the dependent `Select` must distinguish
  three states: **loading**, **empty** (explicit next-action
  message), **populated**. A silently empty dropdown is
  indistinguishable from a failed query or a racing query.
- **Controlled-date-input rule (new 5m, extended 6a):** `<Input
  type="date">` must bind both `value` AND `onChange`. Bind:
  `value={date instanceof Date && !isNaN(date.getTime()) ? format(
  date,'yyyy-MM-dd') : ''}`. Change: `onChange={(e) =>
  field.onChange(e.target.value ? new Date(e.target.value) :
  undefined)}`. Bare `new Date(e.target.value)` silently produces
  `Invalid Date` when the user clears the field, which then
  serializes to null/NaN downstream. Now applied to
  DealForm.closingDate AND CampaignForm.scheduledDate. Grep
  candidate across remaining forms.
- **Currency-adornment rule (new 5m, extended 6a):** `$` should be
  a visual prefix inside the input (relative wrapper + absolute-
  positioned span + `pl-7`), not suffixed on the label as "Amount
  ($)" / "Budget ($)". Combine with `text-right tabular-nums` for
  money readability and `inputMode="decimal"` + `min={0}` +
  `step="any"` for mobile. Now applied to DealForm offer amount
  AND CampaignForm budget.
- **Competitor-brand hygiene (new 6a):** when a user-facing label
  or help text names an external educational product or
  competitor brand (Land Academy, Land Geek, etc.), replace with
  a generic industry term. "Blind offer" is a standard industry
  term; "Land-Academy-style blind offer" is brand-coupled.
  Applies to all customer-facing copy — AcreOS stands on its own.
- **Fabricated-price rule (new 6a):** any user-facing price range
  that isn't sourced from a live object (pieceTypes,
  provider.costCents, etc.) is a trust bug — practitioners cross-
  check numbers against their own invoices. Either compute the
  range from the source or remove the line. The "$0.75-$1.45"
  line on CampaignForm was 20c over the actual max.
- **Template/option-card radiogroup pattern (new 6a):** mutually-
  exclusive selection cards built as clickable `<div>`s must
  become `<button type="button" role="radio" aria-checked>` inside
  `role="radiogroup"` with `aria-labelledby={groupLabelId}`. Add
  `focus-visible:ring` so keyboard users see focus; make the
  decorative radio-dot `aria-hidden="true"` so SR users hear one
  selection state not two.

## Next surface to refine

**Next slice: either `/campaigns` 6c (embedded AbTestManager +
CampaignVariantsPanel + CampaignAnalytics sub-panels) OR skip ahead
to `/inbox` — a natural pause in the campaigns walk.**

Scope for 6c (if chosen):
- `components/ab-test-manager.tsx` — A/B test create + stats +
  winner declaration. Likely the same hand-rolled-dialog + sentence-
  case + tabular-nums pattern as the drawer.
- `components/campaign-variants-panel.tsx` — variant list + create
  flow.
- `components/campaign-analytics.tsx` — response analytics chart +
  cohort breakdown.
- If each file is <200 lines, group them into one commit; otherwise
  split.

Scope for 7 (skip ahead, recommended — campaigns is the longest
single surface in the inventory and the big usability wins have
shipped in 6a/6b):
- `/inbox` — message rendering, thread navigation, SR
  announcements, unread badges, sentence-case, decorative icons.
- Then `/documents`, `/sign/:docId` (legal/trust surface), and the
  mobile-critical public `/portal/:accessToken` borrower flow.

After that: move per inventory to:
1. `/documents` — upload + OCR trust signals
2. `/sign/:docId` — **legal/trust surface** — signer flow
3. `/portal/:accessToken` — borrower portal; **public link, mobile
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
- **CampaignDetailDrawer focus trap + focus restoration (6b):** same
  larger-refactor decision as DealDetailDrawer from 5l. Min-viable
  dialog a11y (role/aria-modal/labelledby/Esc) shipped in 6b; full
  focus trap + return-focus-to-trigger needs a dedicated drawer-
  refactor pass that converts both Deal + Campaign drawers to Radix
  Sheet/Dialog in one commit.

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session.
  `campaigns-content.tsx` is ~1500 lines — drawer is ~270 lines,
  a reasonable 6b slice.
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

## Expected HEAD after session 6a+6b

`cf10579 refine(campaigns/drawer+send+optimizer): …` on top of
`ea096ec` (campaigns list + create). Both commits shipped in a
single elite-refinement session (6a+6b).
