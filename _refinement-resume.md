# Elite-Team Refinement — Resume Point

**Last session:** 2026-04-23 (session 8 — `/documents`)
**Last completed refinement:** `client/src/pages/documents.tsx`
— full 9-lens pass on all three tabs (templates / generated
documents / packages) + 6 dialogs (create template, edit
template, generate document, preview, version history, create
package, package detail). Shared `safeFetch` returned `[]` on
!ok which silently masked transport failures on a legal/trust
surface — replaced with `strictFetch` that throws + `isError` →
destructive toast on all 5 list queries + `QueryErrorState` +
retry into three tabs. Destructive actions (delete template,
delete package, restore version) now gated by `ConfirmDialog`
with explicit scope-naming descriptions. 30+ decorative lucide
icons got `aria-hidden`. Filter-buttons row now `role="group"` +
`aria-pressed` + `min-h-11 sm:min-h-9` + `flex-wrap`. Package
card promoted to `role="button"` + Enter/Space handler per
clickable-div-row rule (slice 7). STATUS_BADGES labels
sentence-cased ("Pending signature", "Partially signed",
"Awaiting signatures"). Page subtitle + empty-state copy
benefit-led + Land-investor vocab ("closing packet"). New
`humanizeType()` helper capitalizes first letter of
`type.replace(/_/g, " ")` badges (5 spots). Deal-select +
property-select inside create dialogs honor prerequisite-select
3-state (loading/error/empty/populated). Form grids
`grid-cols-1 sm:grid-cols-2` for mobile. Version-history
loader gained SR-only label. Required asterisks gained
`aria-label="required"`.

**Phase 1 inventory:** ✅ committed at `11d0e8c`
**PropertyDetailDialog:** ✅ fully refined across all tabs.
**/deals kanban:** ✅ slice 5j complete (commit `f001623`).
**/deals list + filters:** ✅ slice 5k complete (commit `d157464`).
**/deals DealDetailDrawer (5 tabs):** ✅ slice 5l complete (`cc375b1`).
**/deals DealForm (create modal):** ✅ slice 5m complete (`0707ee4`).
**/campaigns list + create:** ✅ slice 6a complete (`ea096ec`).
**/campaigns detail drawer + OptimizerSuggestions + SendMailDialog:** ✅ slice 6b complete (`cf10579`).
**/campaigns A/B test manager + variants panel + analytics:** ⬜ slice 6c deferred — separate embedded components, not blocking /inbox walk
**/inbox:** ✅ slice 7 complete (commit `e052cf8`)
**/documents:** ✅ slice 8 complete (commit `234dafa`)
**/sign/:docId:** ⬜ slice 9 next — legal/trust surface, signer flow
**/portal/:accessToken:** ⬜ slice 10 — public borrower link, mobile critical at 320px

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
- 6a. `/campaigns` list + create modal (commit `ea096ec`)
- 6b. `/campaigns` CampaignDetailDrawer + SendMailDialog +
  OptimizerSuggestionsPanel (commit `cf10579`)

Session 7:
- `/inbox` full-surface (commit `e052cf8`)

Session 8:
- `/documents` — all 3 tabs + 6 dialogs — silent-query→toast
  extended to a legal/trust surface (5 queries), ConfirmDialog
  gates on 3 destructive actions (delete-template, delete-
  package, restore-version), aria-hidden sweep on 30+ icons,
  filter-group view-toggle pattern, package-card role=button
  keyboard a11y, humanizeType() helper for badge capitalization,
  sentence-case sweep across every dialog title + form label,
  prerequisite-select 3-state on deal/property selects inside
  creation dialogs, mobile stack on action rows + form grids,
  tabular-nums sweep on all counts/versions/dates, benefit-led
  page subtitle + Land-investor vocab ("closing packet"),
  required-asterisk aria-label sweep. (commit pending)

## Cross-cutting gains this pass

- **Single error-path pattern on list pages:** `QueryErrorState`
  remains the one surface for list fetch failures. /campaigns + /documents now conform.
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
- **Silent-query → toast pattern (extended 8, trust-surface amplifier):**
  on a legal/trust surface (documents, contracts, signatures,
  payments), silent-empty-on-!ok is doubly bad — the user may
  sign a deal assuming "no templates yet" when the service is
  actually down. When the surface is trust-critical, the pattern
  upgrades from "should fix" to "must fix at surface audit time."
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
- **Prerequisite-select three-state rule (new 5m, extended 8):**
  when a creation form depends on a prerequisite entity (deal →
  property, package → deal, etc.), the dependent `Select` must
  distinguish three states: **loading**, **empty** (explicit
  next-action message), **populated** — AND a fourth
  **unavailable** state when the underlying query is `isError`
  ("Deals unavailable" / "Properties unavailable"). A silently
  empty dropdown is indistinguishable from a failed query or a
  racing query.
- **Controlled-date-input rule (new 5m, extended 6a):** `<Input
  type="date">` must bind both `value` AND `onChange`. Bind:
  `value={date instanceof Date && !isNaN(date.getTime()) ? format(
  date,'yyyy-MM-dd') : ''}`. Change: `onChange={(e) =>
  field.onChange(e.target.value ? new Date(e.target.value) :
  undefined)}`.
- **Currency-adornment rule (new 5m, extended 6a):** `$` should be
  a visual prefix inside the input, not suffixed on the label.
- **Competitor-brand hygiene (new 6a):** when a user-facing label
  or help text names an external educational product or
  competitor brand (Land Academy, Land Geek, etc.), replace with
  a generic industry term.
- **Fabricated-price rule (new 6a):** any user-facing price range
  that isn't sourced from a live object is a trust bug.
- **Template/option-card radiogroup pattern (new 6a):** mutually-
  exclusive selection cards built as clickable `<div>`s must
  become `<button type="button" role="radio" aria-checked>` inside
  `role="radiogroup"` with `aria-labelledby={groupLabelId}`.
- **Clickable-div row rule (new 7):** any `<div onClick>` used as a
  selectable list row must also ship `role="button"`, `tabIndex={0}`,
  a keyboard handler for Enter/Space, `aria-label` that describes
  the row's content, `aria-current` for selection state, and a
  `focus-visible:ring` with `outline-none`. Extended 8: applies
  to `<Card onClick>` patterns used as clickable rows too
  (package cards in /documents).
- **Unread/count badge duplicate sweep (new 7):** when a stat is
  shown in a page header AND inside a filter tab, only show it in
  the place where the user can act on it.
- **`mailto:` / `tel:` affordance rule (new 7):** any rendered
  email address or phone number in a customer-facing surface
  should be a `mailto:` or `tel:` anchor on mobile.
- **SR-only direction prefix on chat bubbles (new 7):** color-
  coded bubble direction is visual-only; prefix timestamps with
  SR-only "Sent "/"Received ".
- **`role="log"` + `aria-live="polite"` on chat message lists
  (new 7):** new inbound messages should announce to SR users.
- **Silent-query→toast extended to sub-detail queries (new 7):**
  pattern applies to *any* query whose failure shows an empty
  view indistinguishable from "genuinely empty."
- **Humanized-type capitalization rule (new 8):** when rendering
  a snake_case `type` field as a badge (e.g. `quit_claim_deed`),
  use a `humanizeType()` helper that capitalizes the first
  letter of the humanized form. Raw `.replace(/_/g, " ")`
  produces lowercase badges that look broken next to Title-Case
  neighbors. Applies wherever `type.replace(/_/g, " ")` appears
  in rendered output — grep candidate across `/deals`, `/properties`,
  and any package/template/classification surface.
- **Restore-older-state ConfirmDialog rule (new 8):** any "restore
  previous version" / "revert" / "undo from trash" action that
  overwrites current state with older state must be gated by
  `ConfirmDialog`. The description must explicitly note whether
  current state is preserved in history or lost, so users
  understand reversibility. Unlike delete, this is not about
  preventing data loss — it's about communicating the swap.

## Next surface to refine

**Next slice: 9 — `/sign/:docId` (signer flow, public legal surface).**

After /sign, move per inventory to:
1. `/portal/:accessToken` — borrower portal; **public link, mobile
   critical** — no Clerk auth, must work at 320px (slice 10)
2. `/campaigns` 6c (AbTestManager + CampaignVariantsPanel +
   CampaignAnalytics sub-panels) — deferred, not blocking

## Deferred / flagged for owner decision

- **TemplateEditor internal surface** (slice 8): `<TemplateEditor>`
  runs inside Create + Edit template dialogs. Not audited in this
  slice — follow-up pass candidate.
- **Package-doc drag-to-reorder** (slice 8): `GripVertical` icon
  is visual-only in package detail; no drag handler. Either wire
  dnd-kit with 5j draggable-a11y rule, or remove the icon.
- **System-template read-only explanation** (slice 8): Edit +
  Delete buttons simply absent on system templates. No tooltip
  explaining *why*. Minor.
- **"Distress Score" filter mislabel** on `/properties` (prior).
- **Pursue/Pass irreversibility** on PropertyDetailDialog (prior).
- **Verdict `signalColors`** raw Tailwind traffic-light (prior).
- **`typeFilter` on `/deals`** has state but no visible UI control.
- **"Pipeline" summary on `/deals`** aggregates acquisition + disposition.
- **Drag-to-move kanban bypasses stage-gate checks.**
- **DealDetailDrawer / CampaignDetailDrawer focus trap + return**
  — deferred to cross-surface drawer-refactor pass.

## Session hygiene reminders

- Commit per surface (or tight batch).
- Re-run 9-lens after each edit.
- Large surfaces (>15k tokens): read in chunks, commit in slices;
  don't try to inhabit the whole thing in one session.
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

## Expected HEAD after session 8

One atomic commit `refine(documents): …` on top of `e052cf8`
(inbox). Session 8 shipped ~25 refinements across all 9 lenses
on a legal/trust surface, with the silent-query→toast pattern
now upgraded to a trust-surface amplifier cross-cutting rule.
