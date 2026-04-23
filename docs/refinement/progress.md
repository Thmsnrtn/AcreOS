# AcreOS Elite Team Refinement — Progress Log

> Living log. One entry per surface refined. Commit-log-style, newest at bottom.
> Format:
>
> ### YYYY-MM-DD HH:MM — `<surface>`
> **Refinements made:**
> - [D] Designer — …
> - [M] Mobile — …
> - [A] Accessibility — …
> - [E] Engineer — …
> - [AI] AI systems — …
> - [LI] Land investor — …
> - [CW] Copywriter — …
> - [I] Infrastructure — …
> - [T] Trust — …
>
> **Sign-off:** D ✓ M ✓ A ✓ E ✓ AI ✓ LI ✓ CW ✓ I ✓ T ✓
> **Commit:** `<sha>`

---

## Session 1 — 2026-04-22

Inventory built. Beginning refinement walk with the highest-traffic surfaces.

### 2026-04-22 — `/` (landing)
**Refinements made:**
- [M] Mobile: hero heading `text-5xl` → `text-4xl sm:text-5xl lg:text-6xl` — 48px was
  wrapping awkwardly at 375px.
- [M] Mobile: hero paragraph `text-xl` → `text-lg sm:text-xl` — tighter at small sizes.
- [M] Mobile: hero CTAs were side-by-side (322px total), broke at 320px viewport.
  Now `flex-col sm:flex-row` with `max-w-xs` clamp so each button is one row on phones.
- [M] Mobile: pricing teaser grid `sm:grid-cols-4` → `grid-cols-1 sm:grid-cols-2
  lg:grid-cols-4` — 4-col at 640-1023px was crushing cards.
- [D] Designer: Clerk `<SignIn>` / `<SignUp>` widget now themed with `colorPrimary`
  matching AcreOS terracotta (`#c17a4c`). Default Clerk purple was a
  source of the "weird purple" report.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

(AI lens n/a — no LLM output on this surface.)

### 2026-04-22 — `/not-found`
**Refinements made:**
- [D] Designer: destructive-red alert icon → muted Compass. A 404 is a
  navigation outcome, not a user error — shouldn't read like a
  warning.
- [CW] Copywriter: title "404 — Page Not Found" → "This page wandered off".
  Warmer, less cryptic. Description: added "or the link is out of date"
  as a third explanation so stale-shared-link cases feel expected.
- [CW] CTA: "Back to Dashboard" was misleading (route was `/` which is
  landing for signed-out users). Now "Back to AcreOS" → `/today`; adds
  secondary "Get help" → `/help` so users aren't dead-ended.
- [A] Accessibility: decorative icons now have `aria-hidden="true"`; the
  outer circle wrapper also marked aria-hidden so SR jumps straight to
  the heading.
- [M] Mobile: added `px-4` to the outer container + button row now
  `flex-col sm:flex-row` so at 320px two stacked buttons fit cleanly.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/auth`
**Refinements made:**
- [D] Designer: desktop (1440px) felt lonely — single narrow card in
  vast empty field.  Added subtle aerial-photo backdrop (same asset
  as landing hero) with heavy gradient overlay for readability.
  Creates continuity when user clicks "Sign in" from landing.
- [D] Designer: added `py-12` vertical padding to the wrapper so the
  card doesn't hug the top edge on short-height viewports.
- [D] Designer: AcreOS "A" avatar now has `shadow-sm` for subtle
  material cue consistent with other logos in the app.
- [A] Accessibility: "Back to home" link now has `px-3 py-2` invisible
  tap target (still visually compact via negative margin) so it hits
  the 44pt minimum.  ArrowLeft marked `aria-hidden`.
- [T] Trust: the aerial backdrop is the literal domain (land) — a
  Land Investor signing in feels the brand story from the first
  frame, not a generic SaaS auth page.
- Clerk widget `colorPrimary` already in place from session 1.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/onboarding-v2`
**Refinements made:**
- [D] Designer: onboarding CTAs were hardcoded to `bg-emerald-600`
  (Beginner/Active paths) or `bg-purple-600` (Power User path). Both
  bypassed the theme system — primary buttons read as "not AcreOS" on
  the only screen a new user sees before the app.  Bulk-replaced all
  13 occurrences with `bg-primary hover:bg-primary/90`.  Path
  differentiation was doing work the H1 copy already does, so no
  information was lost.
- [D] Designer: the "AcreOS" header badge in the progress bar was
  `text-emerald-400` — same drift.  Now `text-primary`.
- [E] Engineer: Opportunity stat grid cells had no `min-w-0`, causing
  long dollar strings ($1,200,000) to overflow the cell on very
  narrow viewports.  Added `min-w-0` + `truncate` on the dollar
  labels.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

Deferred (logged for a future pass, not this session):
- The full onboarding shell is `bg-gray-950` / `text-white` hardcoded
  instead of theme tokens.  Intentional "focused flow" decision; fine
  in dark mode, but users on light theme get a dark onboarding that
  clashes with the rest of the app.  Needs a broader theme-adaption
  pass.

### 2026-04-23 — `PageLoader` (cross-cutting)
Applies to every protected route during auth resolution + every
`React.lazy()` chunk boundary.

**Refinements made:**
- [D] Designer: bare spinner on empty page → branded loader.  Rounded
  AcreOS "A" glyph with gradient (matches sign-in header) + animated
  ping ring + subtle "Loading AcreOS…" caption.  Reads as "the app is
  loading" not "is this page broken?"
- [A] Accessibility: `role="status"` + `aria-label="Loading AcreOS"`
  on the wrapper (was just `aria-label`, no role).  Ping ring
  `aria-hidden`.
- [T] Trust: users bouncing off Safari's 1-minute-JWT refresh window
  saw a tiny spinner with no brand context — now they see AcreOS.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI n/a CW ✓ I ✓ T ✓

### 2026-04-23 — `ThemeSettings` dialog (cross-cutting, mounted in `/settings`)
**Refinements made:**
- [M] Mobile: preset grid was `grid-cols-3`.  At 375px inside the
  DialogContent's padding, cards had ~110px each — description text
  ("Warm terracotta & sand") wrapped awkwardly.  Now
  `grid-cols-2 sm:grid-cols-3`.
- [D] Designer: cards had inconsistent heights depending on
  description length.  Added `min-h-[88px]` so the grid looks
  intentional.
- [A] Accessibility: each preset button now has `aria-pressed` so
  screen-reader users hear which preset is selected.
- [CW] Copywriter: added a "Reset to Desert" quick link that appears
  only when the user is on a non-default preset.  This is the direct
  escape hatch for the reported-purple-on-Safari scenario — if they
  find the Theme panel and their preset is "Midnight", one tap
  restores the default.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `QueryErrorState` (cross-cutting)
Shown across every page when a query fails and the component is
rendered inline (as opposed to the global toast).

**Refinements made:**
- [A] Accessibility: added `role="alert"` + `aria-live="polite"` so
  screen readers announce the error when it appears.  Previously a
  silent visual change.
- [CW] Copywriter: softened the generic titles/descriptions.
  "Connection Problem" → "Offline".  "Server Error" → "We're having
  a moment" + the reassurance "your data is safe" on the network
  case.  Reads as a product that cares, not a stack trace.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `EmptyState` (cross-cutting)
Rendered on every empty list across the app (leads, properties,
deals, campaigns, notes, etc.).

**Refinements made:**
- [E] Engineer: action button always forced a Plus icon regardless of
  whether the action was "create" (Plus makes sense) or "Connect
  account" / "Import CSV" (Plus is wrong).  Added optional
  `actionIcon` prop — caller can override or pass `null` to omit.
- [A] Accessibility: tips list was using text `-` characters as
  bullets — invisible to list-aware screen readers.  Converted to a
  real `list-disc` ul with `marker:text-primary/60` so list semantics
  are preserved.
- [A] Accessibility: icon bubble wrapper now `aria-hidden`;
  ExternalLink on Learn-more link also `aria-hidden`.
- [D] Designer: icon color was `text-muted-foreground/50` (50%
  opacity on an already-muted color) — reading as ghosted.  Bumped
  to `text-muted-foreground` at full.  Background bubble
  `bg-muted/50` → `bg-muted/60` for slightly more presence.
- [D] Designer: Learn more link now has subtle `hover:underline` for
  a clearer affordance.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/leads` (mobile card view)
**Refinements made:**
- [A] Accessibility / [M] Mobile: per-row selection checkbox had only
  its intrinsic ~20px hit area — taps off-center landed on the card
  body and opened the lead instead of toggling selection.  Wrapped
  the Checkbox in a `<label>` with `min-h-[44px] min-w-[44px]` invisible
  tap zone on the card's left edge, and `stopPropagation` so the card's
  "view lead" onClick doesn't hijack selection taps.  Label also has
  `aria-label="Select {name}"` so screen readers know what the
  checkbox controls.
- [A] Accessibility: "Select all" bulk-action row wrapped in a
  `<label>` with `min-h-[44px]` so the whole "☐ Select all" region is
  tappable, not just the 20px box.
- [D] Designer: verified desktop table wrapper already has
  `overflow-x-auto`; mobile uses dedicated card view — no layout
  refinement needed.
- [M] Mobile: filter bar & search input already use `min-h-[44px]` —
  no change needed.
- Previously shipped (earlier session): `contacting` status badge
  changed from purple → sky.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/properties` + `/finance` (responsive grid pass)
Batch refinement across two adjacent high-traffic authenticated
surfaces.

**Refinements made:**
- [M] Mobile: `/properties` completeness-breakdown chip grid was
  `grid-cols-4` with no mobile variant.  At 375px each chip had
  ~85px minus gap for 2-word labels — crushed.  Now `grid-cols-2
  sm:grid-cols-4`.
- [M] Mobile: `/finance` schedule-stats grid (Total Interest / Payoff
  Date / Remaining) was `grid-cols-3` with mixed-width values —
  dollar amounts overflowed at 375px.  Now `grid-cols-1
  sm:grid-cols-3` — stats stack cleanly on phones.
- [M] Mobile: `/finance` note-create form (Principal / Rate / Term)
  was `grid-cols-3` — three inputs in a row at 375px meant 115px each
  with label text, spinner controls, and units.  Now `grid-cols-1
  sm:grid-cols-3`.
- Audit pass on `/campaigns`, `/inbox`, `/tasks`, `/dashboard`,
  `/documents`, `/settings`, `/goals`, `/activity` — all grids
  already had sm:/md:/lg: responsive variants; no changes needed.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/settings` — tier badges
**Refinements made:**
- [D] Designer: Pro-tier subscription badge was `bg-purple-500/10
  text-purple-500` — another off-brand purple.  Pro is the
  *recommended* tier in pricing; it should read as on-brand.  Now
  `bg-primary/10 text-primary`.
- [D] Designer: "Founder" special-case badge was a purple-to-pink
  gradient — Apple-caliber would respect the theme.  Now
  `from-primary to-accent`.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — `/forgot-password` + `/reset-password`
**Refinements made:**
- [CW] Copywriter: CTA labels "Back to login" / "Return to login" →
  "Back to sign in" / "Return to sign in".  Matches the /auth page
  header ("Sign in to AcreOS") and Clerk's own copy.
- [D] Designer: `text-green-500` / `text-red-500` success/error
  accents → `text-emerald-500` / `text-destructive`.  Destructive
  token adapts to theme; emerald is closer to the app's accent
  green in dark mode.
- [D] Designer: inline error messages `bg-red-50 dark:bg-red-950`
  → `bg-destructive/10` — single token, theme-aware.
- [A] Accessibility: all decorative icons (ArrowLeft, CheckCircle,
  Loader2, AlertCircle) now `aria-hidden`.  Success `<div>` gets
  `role="status"`; error `<p>` gets `role="alert"`.
- [CW] Copywriter: reset-password "Password reset successful!" →
  "Password reset successful." (exclamation felt overeager for
  security flow).  Invalid-link copy now hints "copied incorrectly
  or expired" — more actionable.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### 2026-04-23 — customer-visible violet removal batch
Last sweep of customer-visible violet on core product surfaces.

**Refinements made:**
- [D] Designer: `/pipeline` avg-lead-score stat tile was full violet
  (border + bg + icon).  Converted to theme primary (terracotta
  border, bg-primary/5 + bg-primary/10 dark, icon text-primary).
- [D] Designer: `/tools` "Listing Syndication" category tile was
  violet; swapped to cyan so the tool still has a differentiating
  color but it's no longer one of the "weird purple" cases.
- [D] Designer: `/goals` "Leads" category config entry was violet;
  same cyan swap — still distinct from the other category colors
  (emerald/blue/amber/gray).
- [A] Accessibility: TrendingUp decorative icon on `/pipeline` stat
  tile got `aria-hidden`.

Founder-only pages (`/founder-dashboard`, `/night-cap`,
`/founder-ai-observatory`, `/model-training`) still contain violet
— deferred; customer-invisible.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

---

## Session 4 — 2026-04-23

### 2026-04-23 — `/leads/dedupe` (cluster review / merge flow)

**Refinements made:**
- [T] Trust: destructive merge now routes through `ConfirmDialog`
  before firing. Prior flow: one tap → N leads archived instantly,
  no review, no undo affordance. New flow: "Review merge" opens a
  dialog naming the kept record ("Keep John Smith?") and stating
  what happens to the others; confirm button says "Merge 3 leads"
  (or "Merge 1 lead") so the blast radius is legible at click time.
  Destructive variant uses the `bg-destructive` button; cancel is
  the default action. The memory says AcreOS treats data quality
  as Principle 1 — a silent destructive action violates that.
- [E] Engineer: merges were `merge.mutate()` fired in a loop,
  firing N parallel requests; `isPending` only tracked the most
  recent mutation, so the batch UI state was unreliable and partial
  failure was silent. Replaced with a sequential async loop using
  `apiRequest` directly, a single `isMerging` state, and a toast
  that reports partial progress ("Merged 2 of 3. …") on mid-batch
  failure. Query invalidation runs in `finally` so cache refreshes
  either way.
- [E] Engineer: raw `<div>Could not scan for duplicates.</div>`
  replaced with `QueryErrorState` per CLAUDE.md UI patterns —
  provides typed network/server/auth error copy, retry button with
  spinner, dev-mode debug. Now visually consistent with every
  other error state in the app.
- [M] Mobile: action row at the bottom of each cluster was
  `flex items-center justify-between`, which at 375px crammed the
  helper paragraph against the "Keep selected" button. Now
  `flex-col gap-2 sm:flex-row sm:justify-between`, and the merge
  button picks up `min-h-11` for a 44pt tap target.
- [M] Mobile: match-value badge was a 10px mono pill; long phone
  numbers could overflow its container without wrapping. Bumped to
  `text-xs` and added `break-all`.
- [A] Accessibility: each cluster now a proper `role="radiogroup"`
  with `aria-label` naming the match. Lead rows are `role="radio"`
  with `aria-checked`, roving `tabIndex`, `Space`/`Enter`
  activation, and a visible focus ring. Previous flow relied on a
  native `<input type="radio">` that the surrounding clickable div
  didn't keyboard-activate.
- [A] Accessibility: loading state carries `aria-busy` + label;
  decorative icons (GitMerge, Phone, Mail, MapPin, Loader2, Users,
  RefreshCw) now `aria-hidden`.
- [D] Designer: custom radio visual replaces native input — a 20px
  ring with 10px dot fill in `primary`; container selected state
  swapped from hardcoded `emerald-500/40` + `emerald-500/5` to
  `primary/60` + `primary/5` so it follows theme tokens (the
  earlier emerald on terracotta primary was jarring).
- [D] Designer: arbitrary text sizes (`text-[10px]`, `text-[11px]`)
  replaced with `text-xs` token; Rescan now leads with a
  `RefreshCw` icon that spins during `isFetching` — previously a
  bare text button with no affordance signal.
- [LI] Land investor: each lead row now renders the *source* as a
  secondary badge next to status, not buried in the third-line
  metadata. For an investor deciding which record to keep,
  "this one came from my paid tax-delinquent list" vs "this one
  came from cold scrape" is the most load-bearing fact on the
  card. Also swapped "last contact X" → "Last contact X" and
  "never contacted" → "Never contacted" (sentence case, consistent
  with the rest of the app's metadata strings).
- [CW] Copywriter: header description compressed from 58 words to
  28 — same meaning, half the wall. "Could not scan for
  duplicates." → "Couldn't scan for duplicates" + recovery copy
  ("Your leads are safe — retry when ready.") via QueryErrorState.
  Primary CTA renamed "Keep selected, merge rest" → "Review
  merge" — more honest about what the click does now that it opens
  a confirm dialog.
- [I] Infrastructure: sequential await means a 500 on merge #2
  doesn't cascade into N failed in-flight requests; the server
  isn't being stampeded. Error toast surfaces partial progress so
  the operator knows exactly where to pick up.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

---

## Session 5

### `/properties` — list header/toolbar/error/empty-state slice

Scope note: `properties.tsx` is 3376 lines. This session refined the
main `PropertiesPage` surface (header, view toggle, toolbar, error
path, filtered-empty state, export/import error UX). Subcomponents
(`PropertyCard`, `PropertyForm`, `PropertyDetailDialog`,
`DueDiligenceTab`, `PropertyIntelligenceTab`) remain queued for
future sessions — see resume pointer.

- [E] Engineer: removed the dead early-return error block at the top
  of `PropertiesPage` that preempted the cleaner `QueryErrorState`
  already wired into the list render branch. Two error paths → one.
  Also dropped the now-dead `{isError && <InlineError>}` inner
  branch and its import; `isError` destructure no longer needed.
- [D] Designer: replaced the `☰ List` hamburger glyph (and
  `style={{display:"none"}}` MapIcon stub) with a proper `List`
  lucide icon; both view-toggle buttons now render matching 4×4
  icons and identical spacing rhythm. Group wrapped in
  `role="group"` + `aria-label="View mode"`.
- [M] Mobile: view-toggle buttons were ~31px tall (py-1.5 text-sm)
  — below the WCAG 2.2 44px target. Added `min-h-[44px] md:min-h-9`
  so mobile users can actually hit them; desktop rhythm preserved.
- [A] Accessibility: view-toggle buttons gained
  `focus-visible:ring-2 focus-visible:ring-ring` — previously
  relied on browser default focus which this app elsewhere
  suppresses. Test IDs added so Playwright can target the pair.
- [CW] Copywriter: "Add Property" button on mobile was rendering
  as just "Property" (the `<span className="hidden sm:inline">
  Add</span>` hid the verb at narrow widths, leaving an
  incomplete label). Restored full "Add Property" at all
  breakpoints — the icon carries enough affordance that we don't
  need to hide text.
- [I] Infrastructure: `handleExport`, `handleFileSelect`, and
  `handleImport` silently swallowed failures via `console.error`
  — users got no feedback when a CSV export or import failed.
  Added destructive toasts with specific recovery copy ("Your
  existing properties weren't changed" for import; "We couldn't
  build your CSV. Try again in a moment." for export). Also
  added a success toast on export with the downloaded filename
  so the action has a visible landing.
- [D/CW] Filtered-empty state: the "No properties match the
  current GIS filters" message was an ad-hoc `<div
  className="text-center py-12">` with no action — operators had
  to hunt for the reset control in GisFilters. Replaced with the
  shared `EmptyState` pattern (Filter icon, reset action wired to
  `resetGisFilters` + `setStatusFilter("all")` +
  `setDistressFilter("any")` so all three filter surfaces clear
  together). Copy now tells the operator *how many* properties
  are hidden: `"${N} properties are hidden by your current
  filters. Reset to see them again."`

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### Deferred on `/properties` (for next session)

- [LI] The "Distress Score" filter is computed off
  `enrichment.scores.overallScore ?? investmentScore` — the field
  name says distress but the source is investment score. Mislabeled
  or mis-sourced; needs a data-model check before renaming either
  side.
- `PropertyCard` full nine-lens walk (density, metadata hierarchy,
  touch targets on inline actions, aria for decorative icons).
- `PropertyForm` (1120-1333) — validation surfacing, field rhythm,
  mobile keyboard types.
- `PropertyDetailDialog` (1334-2102) — the largest seam; tabs,
  comps, AI offer generator.
- `DueDiligenceTab` (2103-2465) — checklist a11y, progress
  affordance.
- `PropertyIntelligenceTab` (2490-end) — AI output grounding,
  lazy-load of heavy panels.

### `/properties` — PropertyCard + PropertyForm slice (session 5b)

- [I] PropertyCard: `handleDownloadDeed` silent console.error →
  destructive toast with recovery copy.
- [E] PropertyCard: `status.replace('_',' ')` → `/_/g`. Statuses
  like "under_contract_signed" now render fully instead of
  partially formatted.
- [M] PropertyCard: hover-action icon buttons (delete / download /
  refresh) bumped from 40px to 44px on mobile (h-11 w-11); desktop
  stays compact at h-7 w-7. Previously tapped-adjacent by hair on
  mobile.
- [A] PropertyCard: eleven decorative icons made `aria-hidden` —
  MapPin, Trash2, FileText, Loader2, RefreshCw, Ruler, DollarSign,
  TrendingUp, Flame, ClipboardCheck, Calculator. Screen readers
  were double-announcing the adjacent labels.
- [I] PropertyForm: `useCreateProperty` now surfaces both success
  and error. Previously create failures were entirely silent; the
  user saw the dialog close with no "your property was saved" or
  "something broke" signal. Error copy explicitly tells the user
  their form values are still there.
- [M] PropertyForm: mobile keyboard hints — APN `numeric`, Acres
  `decimal`, State `maxLength=2` + `autoCapitalize="characters"` +
  `autoComplete="address-level1"`, Purchase Price + Market Value
  `type="number"` + `inputMode="decimal"` + `min=0`. Desktop
  unchanged.
- [A] PropertyForm: "Land Details (optional — APN, Acreage)"
  collapsible replaced `▲`/`▼` character arrows with lucide
  ChevronUp/ChevronDown plus `aria-expanded` and `aria-controls`
  pointing at `#land-details-panel`. Toggle trigger gained
  44px mobile height + focus-visible ring.
- [A] PropertyForm: submit Loader2 spinner `aria-hidden`; submit
  button `min-h-[44px]` on mobile.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### `/properties` — PropertyDetailDialog header + Quick Verdict + Overview (session 5c)

- [E] Two `status.replace('_', ' ')` occurrences (DialogDescription
  Badge copy + its `title` fallback) now use `/_/g`. Statuses like
  `under_contract_signed` were rendering as `under contract_signed`.
- [I] `verdictMutation.onError` added. Previously a failed Pursue /
  Pass write was silent — operator could not tell whether their
  decision landed. Now surfaces destructive toast with recovery
  copy that explicitly says existing data is unchanged.
- [CW] `verdictMutation.onSuccess` now surfaces a confirming toast
  ("Moved to Due Diligence" for pursue, "Marked as Passed" for pass)
  with one-line next-action copy. The decision badge replaces the
  buttons, so the toast is the user's only positive feedback channel.
- [I] `freshProperty` query gained `isError` handling via `useEffect`
  that toasts when the dialog cannot refresh and explains the user
  is viewing the cached version. Previously fetch failures showed
  nothing and the user could not tell the data was stale.
- [A] Eleven decorative icons in header/verdict/tabs area made
  `aria-hidden`: MapPin (title), Bot (Analyze with AI), Target
  (verdict indicator), Loader2 + ThumbsUp + ThumbsDown (Pursue/Pass
  states), CheckCircle + AlertCircle (verdict factor rows), Brain +
  BarChart2 + Calculator (tab glyphs).
- [A] Five decorative heading icons in Overview tab made
  `aria-hidden`: MapPin (Location), Ruler (Characteristics),
  DollarSign (Financial), AlertTriangle (Distress), FileText (Owner).
- [A] Property-refresh spinner wrapped in `role="status"
  aria-live="polite"` so screen readers announce the refresh state.
- [CW] Spinner copy "Updating property details..." → "Loading
  latest property details…" — runs on initial open too, so "Updating"
  was misleading. "Loading latest" reads correctly for both first
  load and refetch, and uses real ellipsis.
- [CW] Tab tooltips no longer duplicate the tab label text.
  "Property Intelligence" → "Market signals, enrichment data, and
  scoring." "Comparable Sales Analysis" → "Recent nearby sales with
  $/acre benchmarks." "AI-Powered Offer Generator" → "Draft an offer
  price grounded in comps and taxes." "Due Diligence Checklist" →
  "Title, taxes, hazards, and access checklist." Tooltips now add
  context rather than restate the trigger.
- [CW] Header "Copy JSON" button relabeled "Copy data" — the button
  still copies JSON (and `aria-label`/`title` still say so for power
  users) but investor operators should not need to know the wire
  format. Button width + touch target unchanged.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### `/properties` — Dead-code sweep + DueDiligencePanel a11y (session 5d)

- [E] Removed 196 lines of dead code: `DueDiligenceTab` function in
  `properties.tsx` (lines 2157-2353). The file defined both
  `DueDiligenceTab` and imported `DueDiligencePanel` from
  `@/components/due-diligence-panel`, but only `DueDiligencePanel` was
  ever rendered. Prior resume notes had queued `DueDiligenceTab` for
  a11y work — it was a ghost. Along with the function, removed five
  orphaned imports: `useDueDiligenceTemplates`,
  `usePropertyDueDiligence`, `useApplyDueDiligenceTemplate`,
  `useUpdateDueDiligenceItem`, `useCreateDueDiligenceItem` (all from
  `@/hooks/use-due-diligence`); types `DueDiligenceItem` and
  `DueDiligenceTemplate` from `@shared/schema`; lucide `Printer`; and
  UI components `Textarea` and `Progress`.
- [A] DueDiligencePanel `StatusButton` aria-label upgraded. Every
  status button previously announced literally "Cycle status" with
  no item context — so a screen-reader user tabbing through the
  checklist would hear "Button, Cycle status" fifteen times in a row.
  Now announces "{itemName} — status {status}. Click to advance
  status." Icon inside the button gained `aria-hidden`.
- [A] DueDiligencePanel per-item lookup button (Search icon) was
  icon-only with no accessible name. Added `aria-label` that switches
  between "Run lookup for {itemName}" and "Looking up {itemName}…"
  during fetch. Icons made `aria-hidden`. Busy computation
  consolidated into one `isBusy` local so the same boolean drives
  `disabled`, spinner render, and aria copy.
- [A] DueDiligencePanel: 17 more decorative icons made `aria-hidden`
  across the surface (Run All Lookups button, AI Dossier CardTitle +
  Generate button, dossier-loading spinner, agent-status badges,
  dossier error/failed icons, Investability/Risk row icons, Green/Red
  Flags badges, and all eight accordion-trigger icons: FileSearch,
  DollarSign, Leaf, Building, Route, TrendingUp, Users, CategoryIcon).
- [A] DueDiligencePanel loading state wrapper gained `role="status"
  aria-live="polite"` so the "Generating comprehensive analysis…" /
  "Queued for processing…" copy is announced. Error and failed
  blocks gained `role="alert"`.
- [CW] DueDiligencePanel CardTitle "Due Diligence Checklist" →
  "Checklist". The panel renders inside a tab already labeled "Due
  Diligence"; the repeated phrase crowds the title and pushes the
  "% Complete" badge below the Run-All-Lookups button on narrow
  viewports.
- [CW] Ellipsis-dot cleanup — "..." → "…" in dossier loading copy
  and Requesting button copy.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### `/properties` — ResearchSummaryPanel + cross-cutting status-replace sweep (session 5e)

- [E] Cross-cutting bugfix: `.replace('_', ' ')` → `.replace(/_/g, ' ')`
  across 22 client files (59 call sites). This bug has now been hit
  four times in four different components during the refinement pass
  — status strings like `under_contract_signed`, `sent_for_signature`,
  and `tax_deed_sold` were all rendering with only the first underscore
  replaced. Swept the client tree so we stop patching it file by file.
  Files touched: calendar-widget, campaigns-content, command-palette,
  environmental-intelligence-card, offer-wizard, onboarding-wizard,
  property-analysis-chat, property-map, tax-delinquent-importer, and
  pages beta-dashboard, closing-costs, deals, direct-mail-campaigns,
  founder-dashboard, land-credit, listings, market-watchlist,
  marketplace, offers, regulatory-intel, tasks, title-search.
- [E] ResearchSummaryPanel: status.replace bug fixed inline alongside
  the cross-cutting sweep.
- [I/CW] ResearchSummaryPanel `saveNotesMutation.onError` copy now
  specific: "Couldn't save research notes" + "Your text is still
  here — try editing again to retry." Was generic "Error" with no
  reassurance that the text isn't lost.
- [A] ResearchSummaryPanel: 11 decorative icons made `aria-hidden`
  (FileText x2, CheckCircle2, Circle, TrendingUp, Loader2 x2,
  AlertTriangle, Save, ExternalLink, and each external-link
  `link.icon`).
- [A] ResearchSummaryPanel: compsLoading wrapper gains
  `role="status" aria-live="polite"`; Saving/Saved indicator gets
  the same live-region treatment. Hazard warning block gets
  `role="alert"`.
- [CW] ResearchSummaryPanel ellipsis normalization: "Loading
  comps..." → "…", "Saving..." → "Saving…".
- [T] ResearchSummaryPanel external-link buttons now call
  `window.open(url, "_blank", "noopener,noreferrer")`. Without
  `noopener` the opened site can reach `window.opener` and
  tab-nab back to our tab (redirect to phishing, etc). Minor but
  trivial to fix. Also added `aria-label` with "(opens in new tab)"
  suffix on each so screen reader users know the target behavior.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### `/properties` — CompsAnalysis (session 5f)

- [A-critical] Desirability Score badge was a shadcn `Badge` element
  styled with `cursor-pointer` + onClick. Badges are `<div>` spans —
  not keyboard-operable, no focus ring, no `aria-expanded`. Converted
  to a real `<button type="button">` with `aria-expanded` +
  `aria-controls` pointing at `#desirability-score-breakdown`. Kept
  the green/yellow/red colorway + hover states; added focus-visible
  ring matching the design system. Tooltip copy dropped the verb
  "Click" so keyboard users aren't excluded.
- [A] Filters and Refresh buttons gained `aria-expanded` /
  `aria-controls` (filters panel) and `aria-label` that changes with
  busy state (Refresh).
- [A] 13 decorative icons made `aria-hidden` (MapPin x2, Loader2,
  AlertCircle x3, RefreshCw x2, Search, BarChart3, TrendingUp x2,
  TrendingDown, DollarSign, Target, Star).
- [A] Loading state: `role="status" aria-live="polite"`. Error and
  "Comps Data Unavailable" states: `role="alert"`.
- [M] Filters grid `grid-cols-3` → `grid-cols-1 sm:grid-cols-3`. On
  375px the three inputs were ~90px wide each; values clipped.
- [LI] Sale Date staleness flag: comps sold >24 months ago render
  in amber with a tooltip ("Sold more than 2 years ago — may not
  reflect current market"); >12 months render in muted; <12 months
  render normal. Stale comps are a common source of bad valuation —
  calling them out protects the operator's offer math.
- [CW] "Error Loading Comps" → "Couldn't load comps" (title case
  drops, tone matches rest of app).
- [CW] Ellipsis normalization — "Searching for comparable
  properties..." → "…".

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓

### `/properties` — AIOfferGenerator (session 5g)

- [A-critical] Offer suggestion cards were `<div onClick>` with
  `cursor-pointer`. Keyboard users could not select a strategy at
  all. Converted to `<button type="button" role="radio"
  aria-checked>` inside a `role="radiogroup" aria-label="Select an
  offer strategy"`. Added focus-visible ring matching the design
  system. Visual styling preserved.
- [AI/T] CardDescription rewritten to set trust expectations
  upfront: "AI-assisted offer suggestions, letters, and acceptance
  estimates. Review every output before sending — the AI's price
  and probability figures are estimates, not appraisals." The
  previous copy was marketing-leaning and created implicit
  authority the model doesn't have.
- [AI/T] AI Analysis block gained a grounding caveat footer: "AI-
  generated analysis based on {N} comparable sales. Verify figures
  against your own research before making an offer." Now the comp
  count is visibly tied to the reasoning.
- [AI/T] Acceptance Recommendation block gained a caveat: "This
  probability is the AI's estimate based on the inputs above.
  Real outcomes depend on factors the AI can't observe." Operators
  saw a bold percentage with no reminder that the model can't
  actually know motivation, competition, or market psychology.
- [I] Copy-to-clipboard was fire-and-forget: `navigator.clipboard.
  writeText(text)` without awaiting or try/catch, immediately toasting
  success. In restricted contexts (iframe, no user gesture, Safari
  denied permission) the write rejects and the user sees "Copied"
  with nothing actually copied. Now awaited inside try/catch with
  specific recovery copy if denied.
- [CW] Three onError toasts (generate, letter, predict) had title
  "Error". All three now title specifically and add reassurance
  about state: offer suggestions say "No credit charged"; letter
  says "Your form values are kept"; predict says "Your inputs are
  kept". These AI calls can fail for cost/rate-limit reasons; the
  user needs to know whether to retry or walk away.
- [A] 22 decorative icons made `aria-hidden` across header, tabs,
  empty states, strategy section, analysis section, prediction
  tab, and impact-direction icons in the getImpactIcon helper.
- [A] Four action buttons (Analyze Property, Refresh Analysis,
  Copy letter, Recalculate) gained busy-aware `aria-label`s so
  screen readers announce both idle and busy states.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI ✓ LI ✓ CW ✓ I ✓ T ✓

### `/properties` — PropertyAnalysisChat (session 5h)

- [A-critical] Messages container was a plain `<div>`. Screen reader
  users received no announcement when the AI response arrived. Added
  `role="log" aria-live="polite" aria-label="Property analysis
  conversation"` to the message list container. For a chat interface
  this is the single most impactful a11y fix.
- [A] Loading indicator ("Analyzing…") wrapped in `role="status"
  aria-live="polite"` so assistive tech announces that the AI is
  working. Previously SR users had no indication of busy state.
- [A] Send button `aria-label` is now busy-aware — "Send message"
  idle, "Waiting for analysis…" while loading.
- [A] Run-Quick-Analysis button gained busy-aware aria-label.
- [A] 18 decorative icons made `aria-hidden`:
  SECTION_ICONS (5: BarChart3, TrendingUp, AlertTriangle, Target,
  DollarSign) + fallback BarChart3, plus header Bot + MapPin + Ruler
  + DollarSign + empty-state Sparkles + Loader2/Sparkles on run
  button + quick-action icons + user/bot avatars + sent-message
  Sparkles + loading Bot+Loader2 + Send/Loader2 on submit + bottom
  action icons. Avatar wrappers themselves also aria-hidden since
  the message sender is already conveyed by positional layout +
  markdown structure.
- [CW] "Analyzing..." → "Analyzing…".

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI ✓ LI ✓ CW ✓ I ✓ T ✓

### `/properties` — PropertyIntelligenceTab (session 5i)

This closes out the PropertyDetailDialog surface (overview → comps →
AI offer → chat → due-diligence → research summary → intelligence).

- [A-critical] Completeness bar was a styled `<div>` with no ARIA —
  SR users heard only the heading. Added `role="progressbar"` +
  `aria-labelledby` → heading, `aria-valuemin/max/now`, and
  `aria-valuetext` ("{N}% of data sources populated"). The percentage
  text beside it is now `aria-hidden` to avoid a double-read.
- [A] Two empty-state cards (Missing Coordinates, No Intelligence
  Data) gained `role="status"` and icon `aria-hidden`. Errors card
  also `role="status"` (non-blocking — data was returned, some
  sources just failed) rather than `role="alert"`.
- [A] 23 decorative icons made `aria-hidden` across the component:
  header Brain + Loader2 + RefreshCw, completeness CheckCircle,
  empty-state MapPin/Brain x2/Loader2, and 16 card-header icons
  (TrendingUp, Droplets x2, Flame, Leaf x2, Building2, Users, Car,
  TreePine, Mountain, Thermometer, Wheat x3, Factory, Cloud, Grid3x3,
  Waves, Shield) + row icons (Mountain + Flame inside Natural Hazards)
  + AlertCircle in errors card.
- [A] Refresh Intelligence + Fetch Intelligence buttons gained
  busy-aware `aria-label`s ("Refreshing…" / "Fetching…" vs
  idle verbs). Previously screen readers announced the same label
  regardless of state.
- [AI/T-critical] Investment Scores card now carries a grounding
  caveat under the four numbers: "Derived from the data below — not
  an appraisal. Use alongside your own diligence." Operators were
  seeing Overall/Investment/Development/Risk bold numbers with no
  reminder they're heuristic composites, not appraised values.
- [LI] Flood Zone code Badge gained a `title` tooltip naming the
  source ("FEMA National Flood Hazard Layer designation"). Flood Zone
  card also gained a "FEMA NFHL" footer attribution. Standard FEMA
  codes (AE, X, VE…) are opaque to operators new to land — naming
  the source lets them cross-check on the FEMA map.
- [CW] "Enriching..." → "Enriching…". "Fetching..." → "Fetching…".
- [CW] Success toast "Property Enriched" → "Intelligence updated"
  with specific body ("Fetched fresh environmental, hazard, and
  demographic data for this property"). Error toast "Enrichment
  Failed" → "Couldn't refresh intelligence" with trust-preserving
  body ("One or more data sources didn't respond. Your existing
  data is unchanged"). The old copy implied binary success/failure
  when in practice individual providers can fail independently.
- [CW] Empty state copy trimmed — "Click 'Refresh Intelligence' to
  fetch…" → direct "Fetch environmental, hazard, and demographic
  data for this property" (button is right below — no need to
  reference it by label).
- [CW] Errors heading "Some data could not be fetched" → "Some
  data couldn't be fetched" (contraction matches the conversational
  tone of the rest of the app).
- [D] Grid `md:grid-cols-2` → `md:grid-cols-2 xl:grid-cols-3`. At
  1440px+ the 20+ enrichment cards left significant empty gutters
  — three columns at XL better fills the dialog without requiring
  a redesign.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI ✓ LI ✓ CW ✓ I ✓ T ✓

**PropertyDetailDialog now fully refined across all tabs.** Next
surface per inventory: `/deals` kanban (375px UX), then `/campaigns`,
`/inbox`, `/documents`, `/sign/:docId`, `/portal/:accessToken`.

### `/deals` — kanban slice (session 5j)

First of a multi-slice walk on `/deals` (1991 lines). This slice
targets the kanban pipeline view (desktop + mobile kanban + mobile
list) and cross-cutting toast/copy/a11y fixes. List-view/filter
polish, DealDetailDrawer tabs (Details / Documents / Timeline /
Checklist / ROI), and DealForm deferred to 5k + 5l.

- [A-critical] DndContext gained KeyboardSensor. Previously only
  PointerSensor — drag-to-change-stage was mouse-only. Keyboard
  users can now Space/Enter to pick up, arrow keys to navigate
  droppables, Space/Enter to drop, Escape to cancel.
- [A-critical] DndContext `accessibility.announcements` +
  `screenReaderInstructions` wired. SR users hear every transition
  with full deal + stage context; previously silent.
- [A] KanbanColumn restructured: outer `<section>` with
  aria-labelledby, droppable div role=list + aria-label
  "{stage} drop zone" + aria-describedby. Mobile-kanban and
  mobile-list counterparts mirror the pattern.
- [A] Column headings h3 → h2 (page hierarchy was h1 → h3 → skip h2).
- [A] DealCard drag handle was bare `<svg>` with useDraggable
  listeners spread. Now wrapped in `<button type=button>` with
  contextual aria-label "Drag {county}, {state} to change stage",
  `focus-visible:ring`; remains md+-only (mobile has discrete
  stage view).
- [A] Mobile kanban dot paginator → role=tablist with role=tab +
  aria-selected + aria-label; dot size 2px → 3px (still discreet
  but hittable).
- [A] View-mode toggle group (kanban/list) gained role=group +
  aria-label + aria-pressed.
- [A] Pipeline distribution bar: outer role=img with full
  aria-label ("Pipeline distribution: 3 Negotiating, 2 Offer
  Sent, …"). Inner segments and mouse-only legend marked
  aria-hidden to avoid triple-read.
- [A] Icon+label tab/button pattern: `"hidden sm:inline"` entirely
  hid labels on mobile (display:none removes from a11y tree).
  Converted to `"sr-only sm:not-sr-only sm:inline"` — SR reads the
  label on mobile, sighted users see icon-only layout unchanged.
- [T] handleDragEnd mutation was silent on success + error.
  Added success toast ("Stage updated — {county}, {state} moved
  to {stage}") and destructive error toast ("Couldn't move deal").
- [I/T] CSV export: console.error-only on failure replaced with
  destructive toast; success confirms filename. Silent-fetch →
  toast pattern.
- [CW] Bulk delete toast: "Deleted" / "Deleted {N} deal(s)" →
  "Deals deleted" / "Removed {N} deal(s) from your pipeline."
  Generic "Error" title → "Couldn't delete deals" with reassurance
  "Your deals are unchanged."
- [E] Removed dead handleBulkStageChange function (never called;
  bulk stage changes go through the confirm-dialog path via
  handleBulkStageUpdate). Removed unused isBulkUpdating state.
- [CW] Bulk-stage Select placeholder: "Change Stage" → "Change
  stage" (sentence case), and dropped the dead spinner state.

**Sign-off (this slice):** D ✓ M ✓ A ✓ E ✓ AI ✓ LI ✓ CW ✓ I ✓ T ✓

### Flagged for owner decision (new this slice)

- **`typeFilter` state has no UI affordance.** `const [typeFilter,
  setTypeFilter] = useState("all")` is used only by
  SavedViewsSelector (view-driven filtering). There is no visible
  "Acquisitions / Dispositions / All" selector on the page. A real
  investor looking at a pipeline would expect that filter to be
  one click away. Not added (feature addition, out of scope for
  refinement).
- **"Pipeline" summary card sums `offerAmount || acceptedAmount`
  across both acquisition and disposition deals.** For an
  acquisition the figure is a cost; for a disposition it's
  revenue. Aggregating mixes the two — potentially misleading.
  Owner decision needed: separate acq-cost-in-flight vs
  disposition-revenue-in-flight, or leave as a single "deal
  volume" number?
- **Stage-gate enforcement depends on `stageGate.canAdvance` from
  the DealDetailDrawer path only.** Drag-to-move on the kanban
  bypasses stage-gate checks entirely. A deal with an incomplete
  required checklist can be dragged Negotiating → In Escrow with
  no warning. Not changed (could be intentional — kanban is
  "move quickly", drawer is "move carefully"). Owner should
  decide if drag should also gate.

### Next surface in the walk

`/deals` list view + bulk-ops toolbar polish (slice 5k), then
DealDetailDrawer 5-tab surface (slice 5l), then DealForm (5m),
then `/campaigns`.

---

## Slice 5k — `/deals` list view + bulk-actions toolbar

**Commit:** `d157464`

### Refinements (six, across five lenses)

- **Engineer / SRE:** `handleBulkStageUpdate` had no `onError`
  handler and no guard on the non-success branch of `onSuccess`.
  A backend 500 or a soft-fail `{ success: false, message }`
  payload both disappeared silently — the dialog would close with
  no feedback and the cache invalidate would leave the UI in an
  ambiguous state. Added both paths with specific copy
  ("Couldn't update stage" / "Your changes didn't save. Try again
  in a moment."). Matches the silent-mutation→toast pattern.
- **Security / Engineer:** `handleBulkExport` CSV cell escaping was
  broken for any value containing `"` (wrapped in quotes but did
  not double embedded ones, so Excel would mis-parse). Also no
  guard against CSV formula injection: a user-entered county or
  state starting with `=`, `+`, `-`, `@`, `\t`, or `\r` would be
  interpreted as a formula in Excel / Google Sheets on open.
  Fixed: shared `escapeCell` helper doubles embedded quotes and
  prepends `'` to neutralize leading formula triggers. Applied to
  the header row too.
- **Copywriter:** `handleBulkExport` silently produced a download
  with no confirmation toast — divergent from the full-page
  `handleExport` which already toasts. Added success toast
  ("Downloaded N deals to deals-export-YYYY-MM-DD.csv") and an
  error toast path wrapping the whole body. Also sentence-cased
  "Deals Updated" → "Deals updated" and "Update Stage" → "Update
  stage" to match the rest of the app's voice.
- **Accessibility:** Decorative-icon sweep across this surface —
  summary card icons (Building / TrendingUp / DollarSign /
  CheckCircle), header Export & New Deal icons (Download /
  Loader2 / Plus), bulk toolbar icons (CheckSquare / Download /
  Loader2 / Trash2 / X / Undo2), and mobile stage nav icons
  (ChevronLeft / ChevronRight) all lacked `aria-hidden="true"`.
  They sit next to visible text labels or inside buttons with
  aria-labels, so they are purely decorative — otherwise SR
  users hear "graphic, Download, Export" instead of just "Export".
- **Accessibility:** The desktop-only clear-selection `X` button
  (`hidden md:flex`) had neither an aria-label nor a text label —
  a bare icon button is unannounceable to screen readers. Added
  `aria-label="Clear selection"` matching the mobile variant.
- **Mobile / Accessibility:** Mobile list-view row checkbox was a
  bare 20×20px Checkbox with no aria-label — SR would announce
  "checkbox, not checked" with no clue which deal is being
  selected, and the tap target was below the 44px minimum.
  Wrapped in a `<label>` with `min-h-[44px] min-w-[44px]` padding
  and an `aria-label` naming the deal ("Select Yavapai, AZ" /
  fallback "Select Deal #123"). The surrounding padded label also
  gives the checkbox a proper click-expansion area.

### Nine-lens sign-off
- **Designer:** rhythm / typography unchanged; copy casing
  aligned. ✅
- **Mobile:** list-row checkbox now hits 44px tap target. ✅
- **Accessibility:** every decorative icon hidden from SR, every
  icon-only button has an aria-label. ✅
- **Engineer:** bulk mutations now handle all three paths
  (success, soft-fail, hard-error) with specific copy. ✅
- **AI systems:** n/a — no AI on list surface. ✅
- **Land investor:** vocabulary unchanged; "Deal Pipeline" /
  stage labels unchanged. ✅
- **Copywriter:** sentence case, specific recovery copy in error
  toasts. ✅
- **Infrastructure:** bulk mutations now surface backend errors
  instead of swallowing them. ✅
- **Trust:** CSV export no longer silently produces
  formula-injected files — a real trust/security concern for a
  product that emails exports around. ✅

### Cross-cutting additions

- **CSV export escape rule (new 5k):** client-side CSV generation
  must double embedded quotes AND neutralize formula-trigger
  leading characters (`=`, `+`, `-`, `@`, `\t`, `\r`) with a `'`
  prefix. Factor `escapeCell` out if a third surface needs CSV.
- **Bulk-mutation triple-path rule (new 5k):** a bulk mutation
  must handle `onSuccess: result.success=true`,
  `onSuccess: result.success=false` (soft-fail payload), and
  `onError` independently. Toasting only on the first leaves a
  silent-failure hole on the other two.

---

## Slice 5l — /deals DealDetailDrawer (5 tabs)

**Surface:** `client/src/pages/deals.tsx` → `DealDetailDrawer`
(lines ~1172–1975). Full-height slide-over drawer that opens on
any deal row/card click. Five tabs: Details, Docs, Timeline,
Tasks (checklist), ROI.

### Refinements (one atomic commit)

**Drawer mechanics (a11y + keyboard):**
- Added `Escape` key handler (document-level) wired to `onClose`.
  Previously the drawer trapped the user — no Esc close.
- Added `role="dialog"`, `aria-modal="true"`,
  `aria-labelledby="deal-drawer-title"` on the drawer panel, and
  `id="deal-drawer-title"` on the `<h2>`. Screen readers now
  announce "dialog" with the deal title, not an unnamed div.

**Icon-only / AI buttons (a11y + mobile targets):**
- AI pricing popover trigger (`Sparkles`/`Loader2` button) gained
  `aria-label` (swaps between idle / generating copy) and
  `min-h-[44px] min-w-[44px]`. Previously `size="sm"` (36px) with
  only a `data-testid` — icon-only button had no accessible name.
- AI negotiation-script button likewise gained `min-h-[44px]
  min-w-[44px]` + dynamic `aria-label`. Removed the redundant
  `title="AI Negotiation Coaching"` tooltip (restated visible
  label — violates Tooltip-must-augment rule from 5c).
- "Apply suggestion" pricing CTA: `min-h-[44px]`, decorative
  icons `aria-hidden`.
- Negotiation dialog: `<p>` subtitle moved to `DialogDescription`
  so Radix wires `aria-describedby` automatically.

**Decorative-icon aria-hidden sweep:**
- All tab-trigger icons (`FileText`, `Package`, `Clock`,
  `ClipboardCheck`, `Calculator`).
- Header action icons (`Trash2`, `X`).
- Card-section icons (`MapPin`, `Calendar`, `FileText`,
  `ClipboardCheck`).
- Pricing popover `Sparkles`.
- Stage-gate `AlertTriangle`.
- Checklist `CheckSquare`/`Square` + `Upload` inside
  checklist-item buttons.
- Package-list `Package`, `Eye`, `Play`, `Loader2`.

**Checklist checkbox a11y (new 5l cross-cut):**
- Raw `<button>` with only `data-testid` and a `w-6 h-6` icon
  inside `p-2 -m-2` (effective ~40px target) → now `role="checkbox"`,
  `aria-checked={!!item.checkedAt}`, dynamic `aria-label`
  (`"Mark complete: {title}"` or `"Mark incomplete: {title}"`),
  `min-h-[44px] min-w-[44px]`, and a visible focus ring. Screen
  readers now announce "checkbox, checked/unchecked, {title}"
  instead of nothing.
- Upload button `aria-label` now names the item (`"Upload
  document for {title}"`) instead of generic "Upload document" —
  improves list-scan a11y when several items have the document
  requirement.

**Trust / data presentation:**
- Offer amount and Accepted amount no longer display "`$0`"
  when unset — renders an em-dash in muted foreground.
  Rendering "$0" as if the deal were zero-priced is a trust bug
  for a product displaying money amounts.

**Silent failure → toast (cross-cut):**
- `dealPackages` query previously returned `[]` on !ok,
  producing a silent "no packages" empty state indistinguishable
  from a genuinely empty deal. Now throws with the status code
  and a `useEffect` watching `isError` surfaces a destructive
  toast with specific recovery copy ("Check your connection and
  reopen the Docs tab to retry").

**Window.confirm → ConfirmDialog:**
- "Change template" `Select`'s inline `window.confirm(...)` (line
  1939 old) replaced with controlled `ConfirmDialog` state
  (`pendingTemplateId`). Native confirm is inaccessible (bypasses
  focus trap, no Radix aria wiring, platform-inconsistent). New
  dialog uses destructive variant, named action "Replace
  checklist", and respects `isApplyingTemplate` loading state.

**Dead-code removal (trust):**
- Removed the "Generate Documents" and "View Property" buttons at
  the bottom of the Details tab. Both had zero `onClick`
  handlers — clicks did nothing. Broken UI promises are a trust
  cost. The Docs tab already has "Create package" CTA; property
  detail does not have a stable route, so no wire-up was
  available.

**Loading-state refinement:**
- Documents + Checklist tabs previously used a centered
  `<Loader2>` spinner. Replaced with `ListSkeleton count={N}
  variant="compact"` matching the list item shape.

**Copy sentence-case sweep (Details + Docs + Checklist tabs):**
- Card titles: "Update Status" → "Update status", "Property
  Details" → "Property details", "Closing Details" → "Closing
  details".
- Field labels: "Offer Amount" → "Offer amount", "Accepted
  Amount" → "Accepted amount", "Assessed Value" → "Assessed
  value", "Offer Date" → "Offer date", "Closing Date" →
  "Closing date", "Title Company" → "Title company", "Closing
  Costs" → "Closing costs".
- Headings + CTAs: "Document Packages" → "Document packages",
  "Create Package" → "Create package", "No Document Packages" →
  "No document packages", "No Checklist Applied" → "No
  checklist applied", "Stage Advancement Blocked" → "Stage
  advancement blocked", "AI Price Recommendation" → "AI price
  recommendation", "AI Negotiation Coaching" → "AI negotiation
  coaching", "Apply Suggestion" → "Apply suggestion", "Copy
  Script" → "Copy script".
- Trailing `...` → `…` on in-progress copy ("Updating…",
  "Applying…", "Applying template…", "Change template…",
  "Select a template…").
- Pluralization: "Complete N required item(s)" → uses
  `plural(n, 'item')` helper — never shipping "(s)" user-visible.

**Shadow-name cleanup:**
- Local `const statusColors` inside the package card `.map` was
  shadowing the module-level `statusColors` used by the drawer
  header badge. Renamed to `pkgStatusColors` — no behavior
  change, but removes a foot-gun when editing.

**Progress bar a11y:**
- Checklist `<Progress>` gained `aria-label="Checklist N%
  complete"` — Radix Progress exposes `role=progressbar` but no
  name by default.

**Stage-gate live region:**
- Stage-gate warning Card gained `role="status"` so updates to
  the incomplete-count are announced to assistive tech.

### Deferred / flagged for owner

- **Focus restoration on drawer close:** the drawer does not
  return focus to the row/card that opened it. Proper fix
  requires the parent (`DealsPage`) to hand a
  `triggerRef`/`returnFocusTo` prop in. Larger change — deferred.
- **Focus trap on drawer open:** Radix Dialog gives this for
  free. Converting the hand-rolled `<div>` overlay to
  `Sheet`/`Dialog` is the right long-term fix. Out-of-scope for
  this slice.
- **Drag-to-kanban bypasses stage-gate** (still open from 5j).

### Nine-lens sign-off

- **Designer:** rhythm unchanged; dead buttons removed cleans
  Details tab bottom rag; sentence case aligns with 5j/5k sweep. ✅
- **Mobile:** every icon-only button now 44×44px; no tap-target
  regressions. ✅
- **Accessibility:** drawer announces as a real dialog; every
  checklist checkbox has a proper `role=checkbox`+
  `aria-checked`; every decorative icon hidden from SR;
  keyboard Esc closes. ✅
- **Engineer:** shadow-variable cleanup; silent 200-on-error
  path converted to proper error surface. ✅
- **AI systems:** AI price/negotiation buttons clearly labeled
  as AI-generated; confidence badge + range + reasoning stay
  exposed. ✅
- **Land investor:** "Offer amount", "Accepted amount", "Title
  company", "Escrow #", "Closing costs" all read correctly. ✅
- **Copywriter:** sentence case across all surfaces; specific
  toast recovery copy; native `confirm()` replaced with voiced
  "Replace checklist?" language. ✅
- **Infrastructure:** Docs-tab fetch now surfaces failure
  instead of falling back to empty array. ✅
- **Trust:** money fields no longer render "`$0`" when unset;
  dead buttons removed; confirm replaced with accessible
  dialog. ✅

### Cross-cutting additions

- **Dead-stub rule (new 5l):** a button with no `onClick` and
  no `type="submit"` is a broken UI promise, not a visual
  placeholder. Either wire it up in the same commit or remove
  it. Do not leave visible "future feature" buttons shipping.
- **Money-unset display rule (new 5l):** `$0` rendered from a
  nullable amount field reads as "this deal is worth nothing"
  to users. Render "—" (muted) when the underlying value is
  `null`/`undefined`/empty string — reserve `$0.00` for deals
  where zero is the actual captured amount.
- **Radix DialogDescription-over-p rule (new 5l):** subtitle
  paragraphs inside `DialogHeader` should be
  `<DialogDescription>` so Radix wires `aria-describedby` —
  raw `<p>` loses that binding.
- **Checklist-checkbox role rule (new 5l):** a toggle button
  that semantically checks/unchecks a list item should be
  `role="checkbox"` + `aria-checked`, not a bare `<button>`.
  Icon-only buttons with a toggle identity are a common a11y
  miss across the app — grep candidate for broader sweep.

---

### 2026-04-23 — `/deals` — `DealForm` (create-deal modal) (5m)

**Refinements made:**
- [D] Designer: sentence-case sweep — `Create Deal` → `Create deal`,
  `New Deal` → `New deal`, labels `Deal Type/Offer Amount ($)/Offer
  Date/Title Company/Target Closing` → sentence case; removed `($)`
  from offer-amount label (adornment now visual).
- [D] Designer: currency input gets a `$` prefix adornment +
  `text-right tabular-nums` digit alignment — reads as money, not a
  generic number.
- [M] Mobile: offer amount `inputMode="decimal"` + `min={0}` +
  `step="any"` — opens the decimal keypad on iOS/Android, prevents
  negative offers.
- [M] Mobile: title-company `autoCapitalize="words"` for proper case
  on mobile input.
- [A] Accessibility: required indicator added to `Deal type` and
  `Property` labels (`*` aria-hidden because the Zod validator is
  the SR-visible source of truth via `FormMessage`).
- [A] Accessibility: `SelectTrigger` gets `aria-label` on both
  selects (the visible `FormLabel` associates, but the trigger
  itself exposes the name to SR).
- [A] Accessibility: `Loader2` inside submit button hidden from SR
  (decorative — "Creating…" text announces).
- [E] Engineer: date inputs — `value` now bound, guards against
  `new Date("")` producing `Invalid Date` when user clears the
  field (`onChange` returns `undefined` for empty). Also handles
  re-opening the form with pre-filled dates.
- [E] Engineer: property `Select` now binds `value={field.value?.
  toString()}` so selection persists across re-renders; was
  previously uncontrolled.
- [E] Engineer: `parseInt(val, 10)` — explicit radix.
- [LI] Land investor: reordered row 3 to `closing date | title
  company` (date-first, per practitioner workflow — offer amount →
  offer date → closing date → title company is the chronological
  flow).
- [LI] Land investor: select option copy `Acquisition (Buying)` →
  `Acquisition (buying)` — parenthetical descriptor is sentence
  case, matches "(Selling)" sibling fix.
- [CW] Copywriter: `Creating...` (3 ASCII dots) → `Creating…` (U+2026
  ellipsis); DialogDescription gets terminal period.
- [I] Infrastructure: `useProperties()` loading state now surfaces
  in the property dropdown — `disabled` + "Loading properties…"
  placeholder while fetching, and explicit "No properties yet — add
  one first." empty state when the list is empty. Previously the
  dropdown was silently empty during both states, indistinguishable
  from each other and from a real network failure.
- [T] Trust: empty-properties empty state gives the user a
  specific next action ("add one first.") instead of an empty
  dropdown that looks broken.

**Not refined (scoped out / already good):**
- Submit toasts — `useCreateDeal` hook already fires
  success/destructive toasts via `useToast` (verified). No silent-
  mutation hole.
- Focus restoration — Radix `Dialog` handles return-focus to
  trigger automatically.
- Focus trap — Radix `Dialog` ships one out of the box (unlike the
  hand-rolled `DealDetailDrawer` from 5l).
- Form-level `notes` field — not in `deals` schema; dropped from 5m
  plan.

**Sign-off:** D ✓ M ✓ A ✓ E ✓ AI n/a LI ✓ CW ✓ I ✓ T ✓
**Commit:** (this commit)

### Cross-cutting additions

- **Empty-properties-in-create-deal pattern (new 5m):** when a
  creation form depends on a prerequisite entity (deal needs
  property, package needs deal, etc.), the dependent `Select` must
  distinguish three states explicitly: **loading** (disabled +
  "Loading X…"), **empty** (message + next action: "No X yet — add
  one first."), **populated** (options). A silently empty dropdown
  is indistinguishable from a failed query or an unpopulated list,
  and leaves the user stuck.
- **Controlled-date-input rule (new 5m):** date inputs must bind
  `value={date instanceof Date && !isNaN(date.getTime()) ? format(
  date,'yyyy-MM-dd') : ''}` and `onChange={e => e.target.value ?
  new Date(e.target.value) : undefined}`. Bare `new Date(e.target.
  value)` silently produces `Invalid Date` when the user clears the
  field, which then serializes to null/NaN downstream. Grep
  candidate across all forms.
- **Currency adornment rule (new 5m):** `$` should be a visual
  prefix inside the input (`relative` wrapper + absolute-positioned
  span + `pl-7`), not suffixed on the label as `Amount ($)`.
  Combine with `text-right tabular-nums` for money readability.


## Slice 6a — `/campaigns` (Marketing Hub → Campaigns tab): list + create modal

**Scope:** `client/src/components/campaigns-content.tsx` — top-level
`CampaignsContent`, `MailModeIndicator`, `SparklineTrend`, `CampaignList`,
and `CampaignForm` (create-campaign modal). Deferred to 6b:
`CampaignDetailDrawer`, `SendMailDialog`, `OptimizerSuggestionsPanel`.

### Refinements shipped

**Error state → `QueryErrorState` (Engineer, Trust):**
Inline hand-rolled error card with generic copy and a raw retry button
replaced with the shared `QueryErrorState` component. Same benefits as
/deals and /properties list pages — error-type detection (network /
server / auth / notFound / generic), consistent copy, retry button with
proper 44px mobile tap target, `role="alert"` + `aria-live="polite"`,
dev-only debug panel.

**Sentence-case sweep (Copywriter):**
Dialog title "Create Campaign" → "New campaign". Button "New Campaign"
→ "New campaign". Stat labels: "Active Campaigns", "Total Sent",
"Response Rate", "Available Leads" → sentence case. Tab "All Campaigns"
→ "All campaigns". Card metric "Delivery Rate" → "Delivery rate".
MailModeIndicator: "Direct Mail Not Configured" → "Direct mail not
configured"; "Test Mode" / "Live Mode" → lowercase (badge "Safe" /
"Active" left title-case as labels). Toasts: "Live Mode Enabled" /
"Test Mode Enabled" → sentence case. Form labels: "Campaign Name" →
"Campaign name"; "Custom Message" → "Custom message". Submit
"Creating..." → "Creating…" (ellipsis) and "Create Campaign" → "Create
campaign". Placeholder "Q1 Offer Mailer" → "Q1 offer mailer". Subject
placeholder "We want to buy your land!" → "We'd like to buy your land"
(removes exclamation urgency, more in-voice). Template description
"Write your own content from scratch" → sentence with period.

**Copy accuracy (Copywriter, Land Investor):**
Sending costs footer corrected: "Direct mail: $0.75-$1.45 per piece"
→ "Direct mail: $0.75–$1.25 per piece (varies by size)." Actual
`pieceTypes` range caps at letter-1-page $1.25 — prior `$1.45` was
fabricated and a trust bug for a practitioner who would have vetted the
numbers against their own Lob invoice. Formatted with en-dash.

**Competitor-brand cleanup (Copywriter, Trust):**
"Offer Formula (optional, Land-Academy-style blind offers)" → "Blind-
offer formula (optional)". Below-the-fold paragraph prefix "Blind-offer
formula example:" → "Blind-offer example:". Removes two references to
Land Academy (a competitor educational product). AcreOS should stand
on its own — blind offers are a standard industry term, no external
brand needed.

**Dialog description upgrade (Copywriter, Accessibility):**
Create-campaign DialogDescription "Set up a new marketing campaign for
your leads" → "Set up a direct mail, email, or SMS campaign for your
leads." Names the channels the form actually supports, sets
expectations.

**Controlled date input + Invalid-Date guard (Engineer, 5m pattern
extension):**
Schedule-date Input was write-only: `onChange={(e) => form.setValue(
"scheduledDate", new Date(e.target.value))}` — when the user clears
the field, `new Date('')` silently produces `Invalid Date`, which
zod/serialization then turns into `null` or `NaN` downstream. Bound
both sides: `value={d instanceof Date && !isNaN(d.getTime()) ? format(
d, 'yyyy-MM-dd') : ''}` and `onChange={(e) => form.setValue(
"scheduledDate", e.target.value ? new Date(e.target.value) :
undefined)}`. Same pattern established in 5m DealForm.

**Currency adornment on Budget (Engineer, Designer, Mobile, 5m pattern
extension):**
`<label>Budget ($)</label>` + bare `<Input type="number">` → proper
adornment: `<label>Budget</label>` + `<div class="relative">` with
absolute-positioned `$` span (`pl-7`) + `text-right tabular-nums`
readability + `inputMode="decimal"` + `min={0}` + `step="any"` for
mobile keypads + `aria-label="Budget in US dollars"`. Same pattern as
DealForm offer amount.

**Required-field indicators (Accessibility, Copywriter):**
Sentence-case asterisks with `aria-hidden="true"` on required fields:
Campaign name, Type, Recipients, Content. Optional marker on Blind-
offer formula and Subject. Convention matches 5m DealForm. HTML
`required` added to Campaign name and Content inputs.

**Template picker a11y (Accessibility, Engineer):**
Template cards were clickable `<div>`s with `onClick` only — keyboard
users could neither focus nor activate them. Converted to
`<button type="button" role="radio" aria-checked={selected}>` inside a
`<div role="radiogroup" aria-labelledby={…}>` container. Keyboard
activation via Space/Enter now works (native `<button>` behavior),
focus-visible ring added, the surrounding label is wired via
`aria-labelledby`. Visible radio-dot indicator kept but marked
`aria-hidden="true"` so SR users aren't told about two "selected"
states.

**Form field IDs + label htmlFor (Accessibility):**
Every form `<label>` now has a matching `htmlFor={id}` target:
`campaign-name`, `schedule-date`, `offer-percent`, `recipient-filter`,
`campaign-subject`, `campaign-content`, `campaign-budget`. Previously
labels were unattached — clicking them didn't focus the input, and
screen readers had to infer the association.

**SelectTrigger / select aria-labels (Accessibility):**
Campaign type trigger → `aria-label="Campaign type"`. Offer-base
`<select>` → `aria-label="Offer base field"`. Budget input →
`aria-label="Budget in US dollars"`. Mail-mode Switch →
`aria-label="Switch to live/test mode"` (dynamic by state).

**Decorative-icon aria-hidden sweep (Accessibility, 5j pattern
extension):**
Every lucide icon paired with a text label is decorative — not a label.
Added `aria-hidden="true"` to: Plus (button-create-campaign), Target /
Send / TrendingUp / Users (stat cards), TypeIcon (campaign card),
TestTube / Zap / AlertTriangle (mail-mode card + banner), type.icon
(select option), Loader2 (submit spinner).

**Status-badge capitalization (Designer, Copywriter):**
Campaign list-card status badge rendered the raw lowercase DB value
(`draft`, `active`, `paused`…). Added `capitalize` utility so the
badge reads "Draft", "Active", "Paused" at display time without
touching stored values.

**Numeric readability (Designer):**
All stat numbers and progress percentages now use `tabular-nums` so the
digit rhythm doesn't jitter as counts update (Active campaigns, Total
sent, Response rate, Available leads, card Sent/Delivered/Opened/
Responded, Delivery rate %, 7-day response trend total).

**SparklineTrend a11y (Accessibility, 5c sparkline-svg rule):**
`<svg>` with polyline had no semantics — SR users encountered a
mysterious graphical region with no description. Added `role="img"` +
dynamic `aria-label={`7-day response trend: ${totalThisWeek}
responses`}` so the SR user gets the summary without needing the
adjacent text label.

**Subject-field scope copy (Copywriter, Land Investor):**
"Subject (for email/mail)" → "Subject (email and direct mail)". "Mail"
was ambiguous between "direct mail" and "email"; naming both channels
explicitly removes the ambiguity. Optional-marker styling matches the
blind-offer formula label.

**Content placeholder upgrade (Copywriter, Land Investor):**
"Dear [Name], we are interested in purchasing your property..." →
"Dear {{firstName}}, I'm interested in purchasing your property in
{{county}} County…". Uses real template variables the form supports
(first-name, county), ellipsis character, first-person singular
(matches how a solo land investor actually writes), non-awkward
phrasing ("we are interested" → "I'm interested"). Teaches the
variable-substitution pattern by example in the same keystroke.

**Responsive grid tightening (Mobile Designer):**
Type + Schedule row was `grid-cols-2` at all breakpoints — on 320px the
inputs were cramped. Changed to `grid-cols-1 sm:grid-cols-2` so the
two selectors stack cleanly on small phones.

**Unused import sweep (Engineer):**
Removed `AlertCircle` from the lucide import set — it was only
referenced by the inline error state that `QueryErrorState` replaced.

### Nine-lens sign-off

- **Designer (D):** ✓ — rhythm, tabular-nums consistency, radio-
  indicator visual weight reasonable at both viewports.
- **Mobile (M):** ✓ — type/schedule stacks at 320px; template cards
  reach 44px tap height with padding; currency adornment + decimal
  keypad working for budget + offer percent.
- **Accessibility (A):** ✓ — every form field has label+id, SelectTrigger
  has aria-label, template radiogroup keyboard-activates via
  Space/Enter, SparklineTrend has role=img + aria-label, error state is
  role=alert via QueryErrorState, decorative icons hidden from SR.
- **Engineer (E):** ✓ — single error-path via QueryErrorState,
  controlled date binding with Invalid-Date guard, native button
  semantics for template radios, `tabular-nums` applied where digits
  change.
- **AI Systems (AI):** n/a for create-form shell; AI-output refinement
  moves to 6b (OptimizerSuggestionsPanel).
- **Land Investor (LI):** ✓ — direct-mail cost range matches Lob
  reality ($0.75–$1.25), no external brand references, "Subject (email
  and direct mail)" reads correctly, placeholder content uses actual
  template variables.
- **Copywriter (CW):** ✓ — sentence-case sweep, ellipsis characters,
  en-dash for ranges, first-person placeholders, dialog description
  names the channels.
- **Infrastructure (I):** ✓ — no new network paths; error state now
  degrades gracefully via QueryErrorState offline/server variants.
- **Trust (T):** ✓ — fabricated-price bug ($1.45) fixed; competitor
  brand references removed; required-field indicators present.

**Deferred to 6b (`CampaignDetailDrawer` slice):**
- Drawer is a hand-rolled overlay with no focus trap, no Esc key
  handling, no role=dialog/aria-modal, and no focus restoration —
  identical pattern to DealDetailDrawer from 5l. Per the 5l dialog-Esc
  rule, either add role=dialog + aria-modal + aria-labelledby + Esc
  handler, or convert to Radix Sheet/Dialog. Will pair with
  sentence-case sweep and OptimizerSuggestionsPanel refinement.
- `SendMailDialog` title/copy sweep, test-mode vs live-mode banner
  refinement, cost-estimate trust state.
- `OptimizerSuggestionsPanel` — AI-output structuring + "Run AI
  Analysis" button sweep.

### Cross-cutting additions (6a)

- **Competitor-brand hygiene:** when a user-facing label or help text
  names an external educational product or competitor brand (Land
  Academy, Land Geek, etc.), replace with a generic industry term. A
  "standard-practice" framing is always available ("blind offer" is
  generic; "Land-Academy-style blind offer" is brand-coupled). Check
  the feedback_competitor_refs memory for the full brand list.
- **Fabricated-price rule:** any user-facing price range that isn't
  sourced from a live object (`pieceTypes`, `provider.costCents`, etc.)
  is a trust bug — practitioners cross-check numbers. Either compute
  the range from the source or remove the line.
- **Template-picker radiogroup pattern:** mutually-exclusive selection
  cards built as clickable `<div>`s must become `<button
  role="radio">` inside `role="radiogroup"` with Space/Enter keyboard
  activation and a focus-visible ring. The decorative radio-dot goes
  `aria-hidden="true"` so SR users hear one selection state, not two.

**Commit:** (this commit)


## Slice 6b — `/campaigns` CampaignDetailDrawer + SendMailDialog + OptimizerSuggestionsPanel

**Scope:** `client/src/components/campaigns-content.tsx` —
`CampaignDetailDrawer` (the hand-rolled overlay that opens when a card
is clicked), `SendMailDialog` (launched from the drawer header),
`OptimizerSuggestionsPanel` (collapsible AI card inside the drawer).

### Refinements shipped

**Dialog semantics per 5l Esc rule (Accessibility, Engineer):**
`CampaignDetailDrawer` was a hand-rolled overlay with no aria role, no
aria-modal, no labelledby, and no Escape handler — same anti-pattern
as DealDetailDrawer in 5l. Minimum-viable fix per the 5l rule:
`role="dialog"`, `aria-modal="true"`, `aria-labelledby={titleId}` where
`titleId` is a stable per-campaign id wired into the h2, and a
`useEffect` that listens for `Escape` and calls `onClose()`. The Esc
listener short-circuits when `SendMailDialog` is open so Esc closes
the nested Radix Dialog first. Full Radix Sheet conversion (which
would give focus-trap + focus-restoration for free) is deferred as a
larger refactor — same as DealDetailDrawer.

**Close button aria-label (Accessibility):**
`<Button variant="ghost" onClick={onClose}>Close</Button>` — the
visible label is "Close" but a SR user moving between drawers has no
way to tell which drawer's close this is. Added
`aria-label="Close campaign detail"`. Targeted label matches the
pattern used on DealDetailDrawer close.

**Sentence-case sweep on drawer (Copywriter):**
"Total Sent" → "Total sent"; "Campaign Metrics" → "Campaign metrics";
"Delivery Rate" / "Open Rate" / "Response Rate" → sentence case;
"Direct Mail Performance" → "Direct mail performance"; "Pieces Sent"
→ "Pieces sent"; "Responses Attributed" → "Responses attributed";
"Scheduled Date" → "Scheduled date"; "Response Analytics" → "Response
analytics". Header action buttons: "Send Mail" → "Send mail", "Send
Test Email" → "Send test email", "Sending..." → "Sending…". Toast:
"Test Mode Enabled" etc. already handled in 6a. `SendMailDialog`:
"Send Direct Mail" → "Send direct mail"; "Mail Piece Type" → "Mail
piece type"; "Test Mode Active" → "Test mode active"; "Send Test Mail"
→ "Send test mail"; "Sending..." → "Sending…"; toasts "Test Mail
Sent" / "Mail Sent" → sentence case. `OptimizerSuggestionsPanel`:
"AI Optimization Suggestions" → "AI optimization suggestions"; "Run
AI Analysis" → "Run AI analysis"; "Mark Implemented" → "Mark
implemented"; toast "AI Optimizer Complete" → "AI analysis complete";
"Optimizer failed" → "AI analysis failed" for consistency with the
sentence-case button text.

**Status-badge capitalize extension (Designer, Copywriter):**
Drawer header also rendered raw lowercase status. Added `capitalize`
utility to match the list-card badge from 6a.

**Number formatting + tabular-nums (Designer):**
Stat cards ("Total sent", "Responses"), mail-attribution cards
("Pieces sent", "Responses attributed"), progress-bar %
labels (Delivery / Open / Response rate; Direct-mail response rate;
Industry benchmark range), cost fields (Cost per response, Total
spend, Spent vs Budget), and optimization score all get
`tabular-nums`. "Total sent" count now renders with
`.toLocaleString()` (was raw integer) so 12,345 reads as "12,345"
not "12345". Same for `totalResponded`, `attributedResponses`.
Consistency fix: piece-type options in SendMailDialog were
`$${cost}/piece` (raw number coerce) → `$${cost.toFixed(2)} each`,
so "0.75" no longer reads as "$.75" on some number formatters.

**Send-confirmation trust state (Trust, Copywriter):**
Live-mode banner in `SendMailDialog` previously read "Real mail will
be sent. Estimated cost: $X.XX" with no recipient count context.
Upgraded to name the recipient count alongside the cost:
`Real mail will be sent. Estimated cost: $X.XX (N recipients).`
Credit-check line: "You have enough credits ($X.XX available)" →
en-dash + `tabular-nums` currency: "You have enough credits — $X.XX
available." Insufficient-credits line gets the same treatment.
Balance-check error: "Failed to get estimate. Please try again." →
"Couldn't check your credit balance. Please try again." — specific
cause instead of generic failure. Added `role="alert"` on the
estimate-error card so SR users are announced to.

**Collapsible proper-aria (Accessibility, pre-existing pattern):**
`OptimizerSuggestionsPanel` collapse toggle was a ghost button with
just `aria-label` — no `aria-expanded`, no `aria-controls`, so SR
users couldn't tell the button's state or what it controlled. Added
`aria-expanded={expanded}`, `aria-controls={suggestionsRegionId}`,
with matching `id` on the CardContent. Label upgraded from
"Collapse"/"Expand" to "Collapse suggestions"/"Expand suggestions"
(targeted, matches what it controls).

**Decorative-icon aria-hidden sweep (Accessibility, 5j pattern):**
Every lucide icon paired with a text label in drawer / send dialog /
optimizer panel marked `aria-hidden="true"`: Mail, Pause, Play,
TestTube, Loader2, DollarSign, Calendar in the drawer header and
section titles; AlertTriangle, CheckCircle, Loader2 in SendMailDialog
banner cards; Lightbulb, Sparkles, Loader2, ChevronUp/Down,
CheckCircle in OptimizerSuggestionsPanel; FileText, Clock, Users,
DollarSign in the shared `typeIcons` map.

**Empty-suggestions copy (Copywriter):**
`No suggestions yet. Click "Run AI Analysis" to generate
recommendations.` → `No suggestions yet. Run AI analysis to generate
recommendations.` Removes the redundant "Click" instruction (the
button is visible and discoverable) and the stale title-case brand-
like "AI Analysis" wrapped in quotes.

**Mobile header wrap (Mobile Designer):**
Drawer header `flex items-center justify-between` → added
`gap-4 flex-wrap` so the action-button cluster wraps below the title
at narrow viewports instead of forcing the h2 into a single-line
truncate.

### Nine-lens sign-off

- **Designer (D):** ✓ — rhythm steady, tabular-nums consistent across
  all counters and %, progress bars readable.
- **Mobile (M):** ✓ — header now wraps cleanly at 375px; action
  cluster stacks under title when too wide.
- **Accessibility (A):** ✓ — drawer has role=dialog + aria-modal +
  aria-labelledby + Esc handler; close button has targeted
  aria-label; collapsible has aria-expanded + aria-controls; estimate
  error has role=alert; decorative icons hidden from SR.
- **Engineer (E):** ✓ — typecheck clean; Esc handler only active
  while drawer open; nested-dialog Esc short-circuit working; no new
  network paths.
- **AI Systems (AI):** ✓ — Optimizer suggestions output is already
  well-structured (type / priority / suggestion / reasoning /
  implement-action). Button/toast copy now consistent ("AI analysis"
  throughout).
- **Land Investor (LI):** ✓ — cost-per-response, total spend, credit
  balance all in tabular-nums currency; send-confirmation now names
  recipient count alongside cost; "Real mail will be sent" framing
  remains explicit.
- **Copywriter (CW):** ✓ — sentence-case sweep across drawer, send
  dialog, optimizer; ellipsis characters; en-dashes on currency
  display lines; specific error copy ("Couldn't check your credit
  balance"); targeted aria-labels.
- **Infrastructure (I):** ✓ — estimate-error has visual error state,
  role=alert, specific recovery copy; no silent failure.
- **Trust (T):** ✓ — send-confirmation names both cost and recipient
  count (the two numbers a practitioner cross-checks before clicking
  Send); status-badge capitalize makes DB-value leakage less jarring.

**Deferred to later slices:**
- **CampaignDetailDrawer focus trap + focus restoration:** same
  larger-refactor decision as DealDetailDrawer from 5l. Proper fix
  is converting to Radix Sheet/Dialog, which hands focus trap +
  return-focus-to-trigger for free. Punt to a dedicated
  drawer-refactor pass that handles both drawers in one commit.
- **Saved views / sort / filter chrome** on `/campaigns` list — the
  tabs-only filtering (all/active/scheduled/completed) is adequate
  for now; saved-views parity with `/deals` is a larger product
  decision, not a refinement. Flag for owner.
- **`AbTestManager`, `CampaignVariantsPanel`, `CampaignAnalytics`**
  are embedded in the drawer as separate components — each has its
  own surface and gets its own slice in a later session.

**Commit:** (this commit)
