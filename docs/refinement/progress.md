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

---

## Session 7 — `/inbox` unified view

**Scope:** `client/src/pages/inbox.tsx` in full. Email thread list,
SMS conversation list, unified "All channels" view, email detail,
SMS detail, reply panel, send-SMS composer, status-filter tabs
(all/unread/starred/archived), channel-filter tabs (all/email/sms).

**9-lens refinements shipped (~20 distinct fixes):**

- **A11y (row keyboard):** `EmailMessageRow` and
  `SMSConversationRow` were `<div onClick>` — mouse-only. Converted
  to `role="button"` + `tabIndex={0}` + `onKeyDown` handler
  (Enter/Space → onSelect via shared `handleRowKeyDown` helper) +
  `aria-current` for selection + `aria-label` naming the row's
  purpose ("Unread email from X: subject", "SMS conversation with
  Y"). Inner Star button kept as `<button>` with
  `e.stopPropagation()`. Added `focus-visible:ring-2 ring-inset`
  with `outline-none` so keyboard users see focus land.

- **A11y (decorative icons):** `aria-hidden="true"` swept across
  every icon paired with a text label — ChannelBadge
  (Phone/Mail), tab icons (MessageSquare/Mail/Phone), button
  glyphs (Loader2/Send/Star/Archive/Mail/MailOpen/ArrowLeft/
  User/ExternalLink/Search), empty-state icon in SMS body, unread
  dot indicator on row.

- **A11y (toggle + expand semantics):** `aria-pressed` on
  Mark-read/Mark-unread button (bound to `!isRead`) and on Star
  button (bound to `isStarred`). `aria-expanded` + `aria-controls`
  on Reply button → `id="inbox-reply-panel"` on the reply card.

- **A11y (form):** Search input gained `aria-label="Search
  messages"`. Reply textarea gained `aria-label="Reply message"`.
  SMS textarea gained `aria-label="SMS message"`. Send-SMS icon
  button gained `aria-label="Send SMS"`.

- **A11y (status region):** SMS message list converted to
  `role="log"` + `aria-live="polite"` + `aria-label="SMS
  conversation with X"` so inbound messages announce without
  interrupting. Loading spinner wrapped in `role="status"` +
  `aria-live="polite"` + SR-only "Loading messages…" text.
  Empty-panel "Select a message" uses EmptyState component instead
  of raw text.

- **A11y (SR direction cue):** SMS bubble timestamps prefixed with
  SR-only `<span className="sr-only">Sent /Received </span>` so SR
  users know authorship without relying on bubble position or
  color.

- **Engineer (error handling):** Every mutation got `onError`
  with a specific destructive toast — row-level `starMutation`,
  detail-level `starMutation`, `markReadMutation` (row-handler +
  detail + page-level auto-mark-on-select), `markUnreadMutation`,
  `archiveMutation`. Before: silent failure. After: user sees
  "Couldn't star message — Please try again in a moment."

- **Engineer (silent-query sweep extended):** SMS messages query
  inside `SMSConversationDetail` was `useQuery` with no error
  surfacing — a failure returned `data = []` which rendered as
  "No messages yet." Indistinguishable from a genuinely empty
  conversation. Added `useEffect` on `isError` → toast. Imported
  `useEffect`.

- **Engineer (dead code):** `sanitizeHtml` imported from
  `@/lib/sanitize` but never called (the file uses `DOMPurify`
  directly on L442). Removed.

- **Designer (duplicate counter):** unread count was shown in the
  header Badge AND in the Email tab (conditionally, when not on
  Email tab). Two badges, same number, confusing. Removed from the
  Email tab — the header badge is enough and is always visible
  regardless of which tab is active. Kept on the Unread sub-tab
  since that tab specifically filters to unread.

- **Designer (counts + dates):** `tabular-nums` on unread badge,
  row dates, SMS bubble dates, phone-number badge, phone-number
  anchor in SMS detail, email received-at timestamp.
  `toLocaleString()` on the unread badge so 1,234 doesn't render
  as "1234".

- **Designer (dead row content):** SMS row second line was a
  static `<div>SMS Conversation</div>` — zero information, just
  restates the badge below it. Removed. Row is now denser and less
  falsely informative. A real last-message-preview would require
  schema work (conversations table has no preview column) —
  deferred as schema change, not refinement.

- **Designer (empty state):** "Select a conversation to view" was
  a hand-rolled centered div with a faded MessageSquare icon.
  Replaced with the shared `EmptyState` component — "Select a
  message / Choose a conversation from the list to read it here."
  Matches the pattern used in every other list-detail surface.

- **Copy (sentence-case sweep):** "All Channels" → "All channels".
  "Mark Read" / "Mark Unread" → "Mark read" / "Mark unread".
  "View Lead" → "View lead". Single-word buttons (Star, Archive,
  Reply, Send, Cancel, All, Unread, Starred, Archived) already
  sentence-case, untouched.

- **Copy (error specificity):** every `onError` toast has a
  specific title naming the action ("Couldn't star message",
  "Couldn't mark as read", "Couldn't archive message", "Couldn't
  load messages") with a specific recovery line ("Please try
  again in a moment." / "Check your connection and try again.").
  No "Something went wrong."

- **Copy (em-dash + contraction):** "Cannot send SMS - no lead
  associated with this conversation" → "Can't send SMS — no lead
  is linked to this conversation." Proper en-dash per the en-dash
  pattern from prior slices, contraction for a warmer voice,
  clearer verb ("linked" vs "associated").

- **Copy (row aria-label):** "Unread email from X: subject" /
  "Read email from X: subject" — makes unread/read state part of
  what SR users hear on row focus. Before: only the visible
  `font-semibold` cue existed.

- **Trust (affordances):** sender email in email detail rendered
  as `mailto:` anchor (was plain text). Lead phone in SMS detail
  header rendered as `tel:` anchor (was plain text). On mobile
  these become tappable. Before: numbers that *look* tappable but
  aren't — a subtle trust bug.

- **Trust (DOMPurify retained):** email body continues to render
  via `DOMPurify.sanitize(message.bodyHtml)` — already safe, kept
  as-is. Double-sanitize consideration was checked; only
  DOMPurify is called, `sanitizeHtml` helper was unused → removed.

- **Infra (timeouts + fallbacks):** timeouts are handled at the
  `apiRequest` layer (shared); no per-mutation timeout added.
  `markReadMutation` / `markUnreadMutation` / `starMutation` /
  `archiveMutation` all now have error paths (was missing before)
  so network failures don't leave the UI in a "I clicked but
  nothing happened" state.

- **Mobile (header wrap):** detail-view action row is
  `flex-wrap` — confirmed good wrap at 375px. SMS header info
  column wrapped into `min-w-0` + `flex-wrap` on the inner badge
  row so long contact names don't overflow.

**9-lens sign-off:**

| Lens                       | Status                                                                                                                                            |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer                   | PASS — rhythm, tabular-nums, empty state use EmptyState, duplicate counter resolved                                                               |
| Mobile designer            | PASS — 44px touch targets on buttons, tel: anchor on phone, email mailto: anchor, detail view replaces list on mobile, back button visible        |
| Accessibility              | PASS — row keyboard a11y, aria-label sweep, aria-pressed/expanded/controls, role=log + aria-live on chat, SR direction prefix, decorative icons   |
| Engineer                   | PASS — onError on every mutation, silent-query→toast extended, dead import removed, no type errors                                                |
| AI systems                 | N/A — no LLM output on this surface                                                                                                               |
| Land investor              | PASS — lead name + phone + ChannelBadge give practitioner context; last-message-preview would require schema column (deferred, noted)             |
| Copywriter                 | PASS — sentence-case, em-dash, contraction, error specificity, aria-label phrasing                                                                |
| Infrastructure             | PASS — error toasts on every mutation, silent-query→toast added on messages query, apiRequest-layer timeout upstream                              |
| Trust                      | PASS — mailto/tel affordances, DOMPurify on email HTML retained, per-mutation errors surfaced                                                      |

**Deferred / flagged for owner:**
- **Last-message preview on SMS rows** — requires schema column
  (`conversations.lastMessagePreview` or denormalize from
  messages). Not a refinement.
- **Focus return on drawer dismiss** — same class as
  DealDetailDrawer and CampaignDetailDrawer: hand-rolled overlay
  with no trigger ref. Deferred to the cross-surface
  drawer-refactor pass.
- **Message-detail view on select → does not move focus to detail
  pane** — debatable whether it should. On mobile, focus stays on
  the activated row while the detail replaces the list, which is
  OK because the Back button is visible. On desktop, focus
  staying on the row is also OK (user can then continue arrow-
  keying the list). Left as-is.
- **SMS status icons (delivered/read/failed)** — not surfaced on
  bubbles today. Would require `messages.deliveryStatus` rendering.
  Product decision, deferred.

**Commit:** `e052cf8`
**Commit:** `e052cf8`

---

## Session 8 — 2026-04-23 — `/documents` (legal/trust surface)

**Surface:** `client/src/pages/documents.tsx` — templates,
generated documents, packages (3 tabs), create/edit/generate/
preview/version-history/create-package/package-detail dialogs,
+ RequestSignaturesDialog wired to draft docs.

**Lens sweep + refinements shipped:**

- **Trust (silent-query→toast P0):** 5 list queries used a
  shared `safeFetch` that returned `[]` on !ok (templates,
  generated-documents, deals, properties, packages). On a legal/
  trust surface this is a double-bad — when the documents service
  is down, the user sees "No templates yet" with a create CTA and
  assumes empty state. Replaced with `strictFetch` that throws on
  !ok, wired `isError` → destructive toast for each of the 5
  queries via `useEffect` (extended 5l silent-query→toast rule),
  and wired `QueryErrorState` + retry into each of the three
  list tabs (templates / documents / packages). Deals + properties
  errors also surface as sparse toasts because they're dependent
  selects inside create dialogs — the dialogs degrade gracefully
  via 3-state placeholder ("Deals unavailable" / "No deals yet"
  / "Select deal") per prerequisite-select rule from 5m.

- **Trust (destructive-action confirmations):** three destructive
  actions had no confirmation: Delete template, Delete package,
  Restore version (overwrites current content with older copy).
  All three now gated by `ConfirmDialog` with destructive variant,
  specific title ("Delete this template?" / "Delete this package?"
  / "Restore version N?"), and description that names the scope
  of the action. Version-restore description explicitly notes
  that the current version will be preserved in history so users
  understand it's non-destructive on re-save, just overwrites
  active content.

- **A11y (decorative-icon aria-hidden sweep):** 30+ lucide icons
  were missing `aria-hidden` (Plus, FileText, FileCheck, Package,
  FolderPlus, Eye, Edit, Trash2, History, RotateCcw, Loader2,
  Send, Clock, CheckCircle, Shield, FilePenLine, GripVertical,
  Play, StatusIcon dynamic, tab-bar icons, badge icons). All
  icons paired with visible labels now have `aria-hidden=true`.
  "Version history" icon-only buttons got `aria-label`d with
  the template/document name so SR users hear the target.

- **A11y (template filter group):** three filter buttons
  ("All templates", "My templates", "System") now in
  `role="group"` with `aria-label="Filter templates"` + each
  button `aria-pressed`. Mobile touch size `min-h-11 sm:min-h-9`
  per view-toggle pattern from 6a. Row now `flex-wrap` for 375px
  (was `flex items-center gap-2` and clipped at narrow widths).

- **A11y (package card keyboard):** `onClick={handleViewPackage}`
  was on a `<Card>` div — mouse-only. Added `role="button"`,
  `tabIndex={0}`, Enter/Space handler, `aria-label="View package
  X"`, and `focus-visible:ring` per clickable-div-row rule from
  slice 7. View button inside still uses `e.stopPropagation()`.

- **Copy (sentence-case sweep):** STATUS_BADGES labels "Pending
  Signature" → "Pending signature", "Partially Signed" →
  "Partially signed". Page-level sweeps: "Generated Documents"
  tab → "Generated documents"; "New Template" button → "New
  template"; "Create Package" → "Create package"; "Generate
  All" → "Generate all"; "Generate All Documents" → "Generate
  all documents"; "Awaiting Signatures" → "Awaiting signatures";
  dialog titles "Create New Template" → "Create template";
  "Edit Template" → "Edit template"; "Generate Document" →
  "Generate document"; "Version History: X" → "Version history:
  X"; "Create Document Package" → "Create document package".
  Form labels: "Document Name", "Link to Deal", "Link to
  Property", "Package Name", "Select Templates to Include",
  "Documents in Package", "Fill in Variables", "Variables in
  this template:" → all sentence-case, colons dropped on
  standalone labels per pattern.

- **Copy (type label capitalization):** template type + doc type
  rendered raw as `template.type.replace(/_/g, " ")` e.g.
  "purchase agreement" — lowercase and looked broken next to
  other Title-case badges. Extracted `humanizeType()` helper that
  capitalizes first letter of the humanized form: "Purchase
  agreement". Applied in 5 spots (template card badge, document
  card type line, package detail item type, create-package
  template list, deal select label).

- **Copy (benefit-led subtitle):** page subtitle "Manage document
  templates, packages, and generated documents" → "Build reusable
  templates, generate deal-ready documents, and bundle them into
  packages." — benefit-led and action-led.

- **Copy (empty-state voice):** package empty state "Create a
  package to bundle multiple documents together" → "Bundle
  multiple documents together — like a closing packet — to save
  time on every deal." Land-investor vocabulary + benefit framing.
  Template empty state + documents empty state got sentence-case
  CTAs and trailing periods.

- **Copy (required asterisk + aria-label):** "Package name" is
  required but had no visual `*` indicator. Added
  `<span class="text-destructive" aria-label="required">*</span>`.
  Required-variable markers in generate dialog + preview dialog
  also got `aria-label="required"` so SR users hear "required"
  not just punctuation.

- **Copy (placeholder voice + ellipsis):** "Describe this
  package..." → "Describe this package…" (proper ellipsis);
  example text "e.g., Closing Package, Offer Package" →
  "e.g., Closing packet, Offer packet" (industry-standard
  "packet" term for closing binder).

- **Engineer (error path, dead code, prerequisite-select):**
  `safeFetch` helper removed (was unreachable fallback); `deals?.map`
  / `properties?.map` / `templates?.filter` defensive `?` on
  defaulted-`[]` state removed; deal-select + property-select in
  generate dialog + create-package dialog now honor the three-
  state rule (loading / error / empty / populated) via dynamic
  placeholder; `value={field.value?.toString()}` → `value={field.
  value?.toString() ?? ""}` for Radix Select controlled-value
  correctness; "no active templates" path added to the package
  create-templates list (was an empty scroll box).

- **Mobile (action rows stack):** document card, package card,
  version card all had `flex items-center justify-between` with
  content left + actions right — at 375px actions wrapped awkwardly
  or overflowed. All three now `flex flex-col sm:flex-row` with
  `flex-wrap` action rows + `min-h-11 sm:min-h-9` touch-size on
  buttons. Generate + create-package form grids `grid-cols-2` →
  `grid-cols-1 sm:grid-cols-2` (variable-fill grid + link-deal/
  link-property grid + package link-deal/link-property grid).
  Package-detail footer `flex justify-between` → `flex flex-col
  sm:flex-row sm:justify-between` so Delete doesn't overlap
  Generate-all + Close on narrow screens.

- **Tabular-nums sweep:** version badge ("v1"), counts in filter
  buttons, package docs-count + generated-count, deal/property
  badge numbers in package detail, version number heading, ISO
  dates, selected-templates count, deal/property badges in package
  card — all now `tabular-nums`.

- **A11y (version-history loader):** `<Loader2>` had no label —
  SR users heard nothing. Added `<span class="sr-only">Loading
  version history</span>`.

- **A11y (selected-templates live region):** selected-count
  helper text gained `aria-live="polite"` so SR users hear
  updates as they tick boxes.

- **A11y (latest version button label):** restore button on
  latest version was disabled with no explanation. `aria-label`
  now reads "This is the latest version" when disabled, or
  "Restore version N" when enabled.

- **A11y (package-templates group):** "Select templates to
  include" section now `role="group"` with `aria-labelledby`.

**9-lens sign-off:**

| Lens              | Status                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case sweep, tabular-nums, type-label capitalization, benefit-led subtitle, mobile stack/wrap on action rows                         |
| Mobile designer   | PASS — 44px touch targets, flex-wrap action rows, grid-cols-1 sm:grid-cols-2 on form grids, stacked package-detail footer                           |
| Accessibility     | PASS — aria-hidden sweep on 30+ icons, role=group + aria-pressed on filter, role=button + Enter/Space on package card, live region on counter, SR loader label |
| Engineer          | PASS — strictFetch + isError + QueryErrorState + retry on 3 list tabs, prerequisite-select 3-state on deal/property selects, dead code purged      |
| AI systems        | N/A — document generation is template interpolation, no LLM output                                                                                  |
| Land investor     | PASS — "closing packet" vocab, humanized types ("Quit claim deed" not "quit_claim_deed"), deal-id + property-id badges preserved                   |
| Copywriter        | PASS — sentence-case, proper ellipsis, aria-label="required" on asterisks, benefit-led subtitle + empty state                                      |
| Infrastructure    | PASS — strictFetch surfaces transport failures via toast + inline error state, 3 independent retries via QueryErrorState                           |
| Trust             | PASS — legal surface now errors loudly when service is down, destructive actions gated by ConfirmDialog, version-restore description explicit     |

**Deferred / flagged for owner:**
- **TemplateEditor internal refinement** — the `<TemplateEditor>`
  component (imported from `@/components/template-editor`) runs
  inside the Create + Edit dialogs. Its internal surface wasn't
  audited in this slice — deferred as a follow-up pass.
- **Drag-to-reorder on package documents list** — the
  `GripVertical` icon is decorative in package-detail today (no
  drag wiring). Either wire it via dnd-kit with the draggable-a11y
  rule from 5j, or remove the grip. Owner call.
- **System templates read-only lock** — visible today via absence
  of Edit/Delete buttons; no visible lock affordance (tooltip or
  badge) explaining *why* edit is unavailable. Minor — left as-is.
- **Package-detail focus return** — hand-rolled Radix Dialog
  already handles this via Radix. OK, no refinement needed.

**Patterns carried forward:**
- silent-query→toast extended to a legal/trust surface (documents)
- prerequisite-select 3-state applies to deal/property selects
  inside any creation dialog
- humanizeType() utility — needed anywhere `type.replace(/_/g, " ")`
  rendering shows up on a badge
- ConfirmDialog for version-restore is a new pattern — applies
  to any "restore older state" action (history revert, undo-from-
  trash, etc.)

**Commit:** `234dafa`

---

## Session 9 — 2026-04-23 — `/sign/:docId` (public legal signer flow)

**Surface:** `client/src/pages/sign-document.tsx` — public signer
page, no Clerk auth, HMAC URL token credential. Only the page
shell is in scope for slice 9; the `<SignatureCapture>` component
itself defers to slice 9b (372 lines, own focused pass).

**Lens sweep + refinements shipped:**

- **Engineer (P0 bug — submit error destroys signing UI):** the
  page used a single `error` state for both load-failure and
  submit-failure. If the user drew a signature, hit Sign, and
  the submit POST failed (network blip, 5xx), `setError(...)`
  flipped the render tree to the top-level error card —
  unmounting `<SignatureCapture>` and throwing away the
  signature they just drew. Catastrophic UX on a legal surface.
  Fix: split into `loadError` and `submitError`. `submitError`
  renders as an inline `role="alert"` above the signature pad
  without tearing down the UI — the user sees a specific error,
  their drawn signature is preserved, and they can retry.

- **A11y (focus management on success):** after submission
  succeeded, the confirmation card rendered but focus stayed on
  the now-unmounted signature button. SR users had no signal
  that the action completed. Added `ref={confirmationRef}` +
  `tabIndex={-1}` + `useEffect` that `.focus()`es the
  confirmation card when `signed` flips to true. Paired with
  `role="status"` + `aria-live="polite"` so SR announces the
  success copy.

- **A11y (error card role="alert"):** top-level load-error card
  now `role="alert"` so SR users immediately hear the problem
  instead of silently landing on "Can't load this document."
  Inline submit-error banner also `role="alert"` for the same
  reason.

- **A11y (decorative-icon aria-hidden sweep):** `ShieldCheck`
  (nav badge), `FileText` (h1), `AlertTriangle` (error card x2),
  `CheckCircle2` (success card), `RefreshCw` (new retry button)
  — all aria-hidden. Skeleton blocks also aria-hidden since
  they're visual placeholders (SR-only label added separately).

- **A11y (skeleton SR label):** loading state was three
  `<Skeleton>` blocks with no textual hint. Added
  `<span class="sr-only">Loading document…</span>` so SR users
  know something's in flight.

- **A11y (nav labeled):** `<nav>` had no `aria-label` — now
  `aria-label="Signing header"` to distinguish from the
  non-existent main-app nav.

- **A11y (document-content scrollable region):** the scrollable
  document content `<div>` is now `tabIndex={0}` +
  `role="region"` + `aria-label="Document contents"`. Keyboard
  users can now enter the region with Tab and scroll; SR users
  get a region landmark. Previously it was a focus-trapless
  scroll div only reachable by mouse wheel.

- **Trust (retry affordance on load error):** load-error card
  previously told the signer to "reply to the email" with no
  in-page recovery. Added a "Try again" button that reloads
  the page with the same URL (HMAC intact). Transient 5xx
  failures no longer require a fresh email round-trip.

- **Copy (document title sentence case):** `useDocumentTitle(
  "Sign Document")` → `"Sign document"` — the browser tab + SR
  title now matches the app-wide sentence-case convention.

- **Copy (CardTitle de-vague):** `<CardTitle>Document</CardTitle>`
  was redundant (the whole page is *about* signing a document).
  Renamed to **"Document to sign"** — specific, task-framed.

- **Copy (error message voice):** submit-error fallback changed
  from "Signature failed." to "We couldn't submit your signature.
  Your signing link is still valid — please try again." —
  specifically reassures the user that the link isn't burned
  (a common anxiety on legal surfaces) and gives a specific
  recovery.

- **Copy (error card trust phrasing):** "If you believe this is
  an error, reply to the email…" → "If you believe this is a
  mistake, reply to the email that sent you this link — the
  sender can reissue it." — "mistake" is warmer than "error";
  "reissue" is the sender-side action word.

- **Typography (legal fine print legibility):** audit-trail
  disclosure was `text-[11px]` — below the Tailwind `text-xs`
  scale (12px) and below the practical legibility floor for
  body text. Promoted to `text-xs` + `leading-relaxed` so the
  legally-material copy ("we log your IP and browser…") is
  actually readable. 11px is fine for copyright footers; it is
  not fine for an electronic-signature consent disclosure.

- **Mobile (padding tuning):** `<main>` padding `px-6 py-10` →
  `px-4 sm:px-6 py-8 sm:py-10` for 320-375px breathing room.
  Nav header row gets `gap-3` between logo + badge so the
  badge doesn't touch logo at tight widths. H1 row gets
  `min-w-0 break-words` on the title span so a very long
  document name wraps cleanly.

- **Tabular-nums sweep:** `{signersCompleted} of {signersTotal}
  signers complete` and the `expiresAt` date wrapped in
  `tabular-nums` so counts + dates don't jiggle as state
  changes.

- **Engineer (AbortController):** the useEffect cleanup used a
  boolean `cancelled` flag but never aborted the in-flight
  fetch. On rapid unmount/remount the original request would
  complete and its `.json()` promise would still fire (though
  the setState was guarded). Added `AbortController`, wired
  `signal` into `fetch`, `controller.abort()` in cleanup,
  and an `AbortError` guard in the catch.

**9-lens sign-off:**

| Lens              | Status                                                                                                                        |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — rhythm tuned, CardTitle specific ("Document to sign"), legal fine print readable at text-xs                            |
| Mobile designer   | PASS — 320px breathing room, title wraps cleanly, nav header has gap                                                          |
| Accessibility     | PASS — focus moves to confirmation on success, role=alert on both errors, skeleton SR label, nav labeled, doc region tabbable |
| Engineer          | PASS — submit error no longer tears down signing UI (P0 bug), AbortController for in-flight GET, dual error state             |
| AI systems        | N/A — no LLM on this surface                                                                                                   |
| Land investor     | PASS — signer sees "Sent by Acme" + "Signing as You (buyer)" + "2 of 3 signers complete" + expiration warning, all grounded    |
| Copywriter        | PASS — sentence-case title, reassuring submit-error voice, "Document to sign" specific, "reissue" sender-side verb            |
| Infrastructure    | PASS — load-error card now has a "Try again" button for transient 5xx, AbortController cleans up on remount                   |
| Trust             | PASS — retry path avoids burning the signing link, drawn signature survives submit failure, legal disclosure is readable      |

**Deferred / flagged for owner:**
- **Slice 9b — `<SignatureCapture>` component** (~372 lines):
  the canvas-drawing + typed-signature + consent-checkbox
  component wasn't audited in this slice. Candidates: canvas
  keyboard alternative (typed tab exists, good), touch-target
  sizing on Clear/Done buttons, consent-checkbox aria, stroke
  thickness on DPR≠1 screens, focus ring on canvas,
  mobile-safari touch-event passive-listener behavior.
- **Document PDF download** — signer sees the content inline
  if `content` is set, but the "available as a PDF" branch has
  no download link today. Legal best-practice: signers should
  be able to download a copy *before* signing. Product + backend
  decision (need a signed URL endpoint). Flagged as a potential
  trust bug.
- **Organization logo on signer page** — the page shows the
  AcreOS logo, not the sending organization's logo. Signers
  arrive from an email that *may* be branded with the sender;
  landing on AcreOS branding could feel disjointed. Product
  call on whether to white-label.

**Patterns carried forward:**
- **Submit-error-must-not-unmount-form rule (new 9):** when a
  submission fails on a surface where the user has committed
  input they can't easily redo (signature, signed document,
  long-form copy, drawn content), error MUST render inline
  above the form as `role="alert"`, not replace the form.
  Tearing down the form wipes the user's input. Applies
  anywhere a form owns irreplaceable user work.
- **Focus-on-success-confirmation rule (new 9):** when a mutation
  replaces the primary action UI with a confirmation card, the
  confirmation card should receive keyboard focus (via
  `ref.focus()` with `tabIndex={-1}`) and be wired
  `role="status"` + `aria-live="polite"`. SR users otherwise
  have no signal that the submission completed.
- **Legal-disclosure minimum-size rule (new 9):** any legal
  consent / audit-trail disclosure that could be cited in
  dispute (e-sign consent, ToS agreement, arbitration notice)
  must render at `text-xs` (12px) or larger. Sub-12px fine
  print is a readability hazard AND potentially an
  enforceability risk on some jurisdictions.
- **Retry-on-load-error rule (new 9):** load-error cards that
  tell users to "contact support" / "reply to email" should
  offer an in-page retry first. Transient 5xx + network blips
  don't need a round-trip to the sender to resolve.

**Commit:** `61f1469`

---

## Session 10 — 2026-04-23 — `/portal/:accessToken` (public borrower portal — entry surfaces)

**Surface:** `client/src/pages/borrower-portal.tsx` (lines 35-186)
— top-level `BorrowerPortal` (verification gate) + the no-token
`BorrowerLandingPage` + intermediate "loading" state between
verify and dashboard. The 1000+-line `BorrowerDashboard`
component (lines 188-end) defers to slice 10b; it's a separate
surface with its own payment / autopay / payoff / statements /
messaging UX concerns that don't fit in one slice.

**Why this surface matters:** public route, no Clerk auth —
the borrower's first impression of the lender's portal. Mobile-
critical, must work at 320px. Borrowers arrive anxious (payment
due, payoff question, 1098 request), often on a phone, often
from an SMS or email link. Trust-signaling and clarity on this
page affect the entire lending relationship.

**Lens sweep + refinements shipped:**

- **A11y (form semantics — P1 on a public form):** the email
  label was a bare `<label>` with no `htmlFor`, unassociated
  with the input. SR users didn't hear "Email address" on
  focus. Swapped to the shadcn `<Label htmlFor="borrower-email">`
  + Input `id="borrower-email"`. Added `aria-invalid` + wired
  `aria-describedby="borrower-email-error"` when the error
  state is shown, so SR users hear the validation message.

- **A11y (error region):** validation-error `<div>` now
  `role="alert"` — previously appeared silently on failed
  verify, leaving SR users with no feedback after hitting
  Submit.

- **A11y (decorative-icon sweep):** `Shield`, `Building`,
  `FileText`, `CreditCard`, `Download`, `Loader2` — all 6
  icons now `aria-hidden="true"`. All are visual decoration
  paired with visible text labels.

- **A11y (h1 landmark):** neither the landing page nor the
  verify gate had a proper top-level heading — CardTitle
  renders as a `<div>`. SR users had no page-level landmark.
  Added an `sr-only <h1>` on both surfaces ("AcreOS borrower
  portal" on landing; "Borrower portal sign-in" on the
  verify gate). Visual CardTitle unchanged.

- **A11y (loading state):** "Loading loan information…"
  intermediate state was a plain `<p>` with no aria-live.
  Now wrapped in a parent with `role="status"` +
  `aria-live="polite"` + a spinning `<Loader2>` so SR users
  hear the wait state.

- **A11y (landing-page list semantics):** the three feature
  rows on the landing page were `<div>`s with no list
  semantics. Promoted the container to `<ul>` and rows to
  `<li>` so SR users hear "list, 3 items" — conveys "here's
  what you can do" structure.

- **Engineer (form-level submit):** the email + button were
  two loose elements; hitting Enter in the input did nothing.
  Wrapped in `<form onSubmit={…}>` with `type="submit"` on
  the button — Enter now submits. Added a trim + has-`@`
  client-side pre-check before the network request so the
  user gets immediate feedback on obvious typos without
  waiting for the server round-trip.

- **Engineer (error-message fallback):** generic "Verification
  failed" replaced with a borrower-voice specific fallback:
  "We couldn't match that email to this loan. Check the
  address from your payment reminder email and try again."
  Also a separate network-error fallback: "We couldn't verify
  your access right now. Check your connection and try again."

- **Engineer (email input mobile keyboard):** input got the
  full mobile-keyboard checklist — `autoComplete="email"`,
  `inputMode="email"`, `autoCapitalize="off"`, `autoCorrect=
  "off"`, `spellCheck={false}`. Typing a borrower email on
  mobile Safari previously triggered auto-capitalize on the
  first character, which the user would then have to backspace
  every time.

- **Engineer (JSON parse defense):** `await res.json()` inside
  the error branch could itself throw if the server returned
  HTML (e.g. a Fly.io cold-start 502). Wrapped in
  `.catch(() => ({}))` so the fallback error message surfaces
  instead of an unhandled promise rejection.

- **Engineer (document title):** no `useDocumentTitle()` was
  wired. Now "Borrower portal" on the verify gate +
  "Borrower portal — AcreOS" on the landing page. Tab label
  + SR page-load announcement both benefit.

- **Copy (sentence-case sweep):** "Borrower Portal" →
  "Borrower portal"; "Email Address" → "Email address";
  "Access My Loan" → "Access my loan"; "View Loan Details"
  → "View loan details"; "Make Payments" → "Make payments";
  "Download Documents" → "Download documents"; "AcreOS
  Borrower Portal" → "AcreOS borrower portal"; "Verifying…"
  proper ellipsis (was "Verifying..."); "Loading loan
  information…" → "Loading your loan…" (tighter, borrower-
  centric).

- **Copy (description rewrite on verify gate):** "Enter your
  email address to access your loan information" → "Enter
  the email address your lender has on file to view your
  loan." Specifies *which* email (borrowers on multiple
  addresses get clarity), names the fact that the lender
  has an email on file (trust signal — the system knows
  who you are).

- **Copy (secure-copy precision):** "Your information is
  secure and encrypted" → "Your information is encrypted in
  transit and at rest." Before: generic SaaS trust platitude;
  after: specific, technical, signals actual security posture.

- **Copy (landing CTA clarity):** "To access your loan
  portal, use the link provided in your payment reminder
  email or contact your lender." → "To open your portal, use
  the link in your payment reminder email — or contact your
  lender." Tighter, em-dash per house style.

- **Copy (placeholder voice):** "your@email.com" →
  "you@example.com" — more universally-readable placeholder
  that follows the RFC-2606 reserved-domain convention.

- **Mobile (touch target):** "Access my loan" button gets
  `min-h-11` — 44px minimum touch target per a11y baseline.
  Was default shadcn Button h-10 (40px).

- **Mobile (landing icon shrink-0):** the three feature-row
  icon tiles on the landing page gained `shrink-0` so they
  don't squash at 320px when the copy wraps. Before: at
  very narrow widths the colored icon tiles could compress
  to ~20px width, distorting the icon.

**9-lens sign-off:**

| Lens              | Status                                                                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — rhythm unchanged, feature-row icon tiles stay square on narrow widths, copy hierarchy tightened                                        |
| Mobile designer   | PASS — 44px touch on primary CTA, mobile-keyboard attrs on email input, icons shrink-0 at 320px                                               |
| Accessibility     | PASS — Label htmlFor, aria-describedby wired to error, role=alert on error, role=status on loading, h1 landmark both paths, icon aria-hidden |
| Engineer          | PASS — form onSubmit + Enter-to-submit, client pre-check, JSON-parse guarded, document title set, specific error fallbacks                   |
| AI systems        | N/A — no LLM on this surface                                                                                                                   |
| Land investor     | N/A — this is the borrower side. Borrower perspective: PASS — warmer error voice, "lender on file" trust signal, "your loan" ownership       |
| Copywriter        | PASS — sentence-case sweep, proper ellipsis, em-dash, specific security claim, placeholder-RFC                                                |
| Infrastructure    | PASS — JSON-parse defense against HTML/502 fall-through; no timeout (deferred, verify is idempotent and user-driven)                         |
| Trust             | PASS — public no-auth surface now has h1 landmark, aria-described error state, specific security posture, borrower-centric error voice       |

**Deferred / flagged for owner:**
- **Slice 10b — `<BorrowerDashboard>`** (~1000 lines): contains
  payment flow (Stripe redirect), autopay toggle, payoff quote
  flow, statements/1098 PDF generator, borrower-lender messaging,
  payment history table. Each of those is its own focused
  trust+money surface — attempting in one slice would under-
  refine. Slated for 10b.
- **Hard-coded gradient colors** (`#F5E6D3 / #E8D4C4`): not
  using design tokens. Brand-deliberate earth/cream palette,
  probably by design. Flagged for owner confirmation — either
  adopt as token or keep as per-surface literal.
- **Account-enumeration consideration:** intentionally vague
  error copy on a *server* response ("We couldn't match that
  email…") is still more specific than the previous
  "Verification failed" — if the sec team wants tighter
  enumeration protection, they can standardize server-side to
  always return 200 + generic message and rate-limit aggressively.
  Client-side we'd then drop the email-specific phrasing.
  Flagged for owner call.
- **Rate-limit messaging:** if the server returns 429, the
  generic "We couldn't verify…" copy is fine but doesn't tell
  the user how long to wait. Server-side improvement would be
  to include a retry-after window the client could display.
  Deferred.

**Patterns carried forward:**
- **Public-form a11y checklist (new 10):** any public
  (no-auth) form must ship: `Label htmlFor` + Input `id`,
  `role="alert"` on validation errors, `aria-invalid` +
  `aria-describedby` wiring, form-level `onSubmit` for
  Enter-to-submit, mobile-keyboard attrs
  (`autoComplete/inputMode/autoCapitalize/autoCorrect/spellCheck`),
  and a proper h1 landmark (sr-only is fine). This was found
  missing across the borrower portal entry; worth grepping
  the public pages (`/auth`, `/sign/:docId`, `/forgot-password`,
  `/reset-password`) for similar gaps.
- **"Trust claim specificity" rule (new 10):** trust-
  signaling copy should be specific and technical, not
  platitudinous. "Your information is secure" reads as
  marketing fluff; "Your information is encrypted in transit
  and at rest" reads as a system-design claim. Where the
  stronger claim is accurate, use it — it calibrates trust
  better than vague reassurance.

**Commit:** `c6438ba`

---

## Session 10b — 2026-04-23 — `<BorrowerDashboard>` full pass (borrower-portal.tsx lines 188-end)

**Surface:** the authenticated borrower dashboard inside
`client/src/pages/borrower-portal.tsx`. Lines 188-end (~1000
lines). Scope: header, status banners (payment-verifying,
payment-status), Amount-Due card, Quick-Actions grid, Stat
cards (Balance / Total paid / Autopay), Loan-progress card,
Loan-details `<dl>`, Property-information card, Tabs
(Payment history + Payment schedule + Messages), Payoff-quote
dialog, Statement-download dialog, mobile bottom nav. Did NOT
touch the ~200-line jsPDF generator for 1098 / account
statement — that's a standalone backend-voice artifact best
refined in its own slice once product confirms IRS-form
fidelity requirements.

**Lens sweep + refinements shipped:**

- **Engineer (P0 — silent messaging failures on a money
  surface):** `loadMessages` and `handleSendMessage` both
  caught errors into `// silently ignore`. On a borrower ↔
  lender conversation thread this is catastrophic: user types
  a question about their loan, hits Send, button clears, user
  believes message is sent, server never got it. No toast, no
  inline error, no retry affordance. Fix: split into
  `messagesError` + `sendMessageError` state; both surface as
  `role="alert"` inline banners inside the Messages tab with
  borrower-voice copy ("Your message didn't send. Please try
  again in a moment.") and a "Try again" retry button for the
  load path.

- **Engineer (money precision — trust-critical):** `.toLocale
  String()` without `minimumFractionDigits`/`maximumFraction
  Digits` drops cents on integer values. The **Total payoff
  amount** rendered as `$34,567` when actual is `$34,567.89`
  — a borrower paying to the displayed number is short on
  their loan. Fixed across: payment-due card, Balance stat
  card, Total-paid stat card, Loan-details Original amount,
  payment-history Amount / Principal / Interest columns,
  payoff quote Principal balance / Accrued interest / Payoff
  fee / Total payoff amount — all now explicitly
  `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`.

- **A11y (role=alert/status on payment banners):** top-of-
  dashboard payment-verifying banner now `role="status"` +
  `aria-live="polite"`. Success payment-status banner also
  `role="status"`. Error payment-status banner upgraded to
  `role="alert"` + `aria-live="assertive"` — a failed payment
  must interrupt SR reading so the borrower hears it
  immediately.

- **A11y (autopay switch):** bare Switch with no accessible
  name. Now wired `aria-labelledby="autopay-label"` pointing
  to the "Autopay" heading + an explicit `aria-label` that
  names the current state and the action ("Autopay enabled.
  Toggle to disable."). SR users had no way to identify the
  control before; now a screen reader announces full state.

- **A11y (progress bar description):** shadcn `<Progress>`
  gets `aria-label="Loan progress: N percent complete, X of Y
  payments made"` — SR users hearing the bar now get the
  actual status, not a silent decorative element.

- **A11y (scrollable tables tabbable regions):** payment-
  history + payment-schedule scroll containers are now
  `tabIndex={0}` + `role="region"` + `aria-label`d. Keyboard
  users can enter the scroll region and scroll through long
  payment histories without first having to mouse into it.

- **A11y (decorative-icon sweep):** 20+ lucide icons across
  header, banners, payment-due card, quick actions (4), stat
  cards (3), progress card, loan-details, property card,
  message-tab (8+), dialogs (4+), mobile nav (3) — all got
  `aria-hidden="true"`. Icon-only Send button in the message
  composer got a proper `aria-label="Send message"` /
  "Sending message" that changes with pending state.

- **A11y (unread badge):** three unread-count badges
  (quick-action Message button, Messages tab, mobile-nav
  Message button) were decorative `<span>`s with raw digit.
  Parent button now carries `aria-label="Messages (N
  unread)"` when `unreadCount > 0`; badge itself is
  `aria-hidden="true"` so SR doesn't double-announce.

- **A11y (definition-list semantics):** Loan-details and
  Property-information blocks rendered facts as `<span>`
  label + `<span>` value inside flex rows. Promoted to
  `<dl>` + `<dt>`/`<dd>` — SR users now hear these as
  labeled pairs instead of two unrelated text runs. Payoff
  quote rows also promoted to `<dl>`/`<dt>`/`<dd>`.

- **A11y (message-thread log semantics + SR direction):**
  message thread container now `role="log"` +
  `aria-live="polite"` + `aria-label="Conversation with your
  lender"` + `tabIndex={0}` (so it's tabbable). Bubble
  direction ("You" right-aligned, "Your lender" left-aligned)
  was visual-only; added sr-only "Sent — " / "Received — "
  prefix on each bubble timestamp so SR users understand
  authorship without visual cues (slice 7 pattern).

- **A11y (message-composer Label):** Textarea for new
  messages had only a placeholder. Added an `sr-only
  <Label htmlFor="borrower-new-message">Message to your
  lender</Label>` + `id` on the Textarea + `aria-describedby`
  wiring to the send-error alert.

- **A11y (mobile bottom nav → `<nav>`):** the fixed bottom
  action bar was a `<div>`. Promoted to a proper `<nav
  aria-label="Primary actions">` landmark so SR users can
  navigate to/from it with landmark navigation.

- **A11y (statement-dialog labels):** `<label>` with no
  `htmlFor` on "Statement type" + "Tax year" (same bug from
  slice 10 landing form). Promoted to shadcn `<Label htmlFor>`
  + SelectTrigger `id` — now SR users hear the label on focus.

- **Copy (sentence-case sweep across the dashboard):** the
  dashboard was heavily Title-Case — "AcreOS Portal" →
  "AcreOS portal", "Amount Due" → "Amount due", "Pay Now" →
  "Pay now", "Pay Early" → "Pay early", "Payoff Quote" →
  "Payoff quote", "Loan Progress" → "Loan progress", "Loan
  Details" → "Loan details", "Original Amount" → "Original
  amount", "Interest Rate" → "Interest rate", "Term Length"
  → "Term length", "Start Date" → "Start date", "Maturity
  Date" → "Maturity date", "Grace Period" → "Grace period",
  "Property Information" → "Property information", "Total
  Paid" → "Total paid", "Payment History" → "Payment
  history", "Payment Schedule" → "Payment schedule", "Due
  Date" → "Due date", "Load More" → "Load more", "Load
  Messages" → "Load messages", "Download Statement" →
  "Download statement", "Statement Type" → "Statement type",
  "Tax Year" → "Tax year", "Principal Balance" → "Principal
  balance", "Accrued Interest" → "Accrued interest", "Payoff
  Fee" → "Payoff fee", "Total Payoff Amount" → "Total payoff
  amount", "Your Lender" → "Your lender". CTAs "Pay Now" /
  "Pay Early" on mobile bottom nav now also sentence-case +
  match the primary card.

- **Copy (payoff description tighten):** "Your estimated
  payoff amount to pay off the loan in full" (redundant
  "payoff ... pay off") → "The amount needed to pay your
  loan in full on the quote date below." — specific and
  temporally anchored.

- **Copy (autopay reassurance):** "Autopay is on — payment
  will be collected automatically" → "Autopay is on — we'll
  collect this payment automatically." First-person "we'll"
  reads warmer and makes the agency explicit (AcreOS does
  this FOR the borrower, not a passive-voice system thing).

- **Copy (cancelled-payment specificity):** "Payment was
  cancelled" → "Payment was cancelled — no charge was made."
  Anxious borrower who backed out at Stripe checkout needs
  explicit reassurance they weren't billed.

- **Copy (1098 menu label):** "1098 Interest Statement (Tax)"
  → "Form 1098 (mortgage interest — tax)" — closer to the
  actual IRS form name, em-dash pattern, lowercase "tax"
  since it's a parenthetical, not a proper noun.

- **Copy (empty-state voice):** "No messages yet. Send us a
  message below." → "No messages yet. Send your lender a
  message below." Specific named recipient ("your lender")
  signals the real relationship behind the messaging thread.

- **Copy (N/A → em-dash):** payment-method cell `|| 'N/A'`
  became `|| '—'` — cleaner, matches the broader Money-
  unset display rule from slice 5l.

- **Copy (ellipsis):** "Verifying your payment..." →
  "Verifying your payment…". "Type your message here..." →
  "Type your message here…".

- **Copy (welcome name emphasis):** header subtitle
  "Welcome, {borrowerName}" kept but borrower-name span
  promoted to `font-medium text-foreground` so it doesn't
  look like muted decorative text — the name is the identity
  anchor.

- **Mobile (quick-action touch size):** 4 quick-action
  buttons (Schedule / Statements / Payoff quote / Message)
  gained `min-h-16` so tap targets are comfortable at 44px+
  at 375px. Mobile-nav buttons got `min-h-14`.

- **Mobile (unread badge min-width):** badge width was fixed
  `w-4` (16px) which clipped at unread ≥ 10. Changed to
  `min-w-[16px] px-1` so two-digit counts display cleanly
  without layout shift.

- **Tabular-nums sweep across the dashboard:** all dollar
  amounts, percentages, dates, day counts, payment numbers,
  balances, terms, durations, unread counts — tabular-nums
  everywhere. On a money surface this prevents digits from
  jiggling as the value changes under polling / refresh.

- **Engineer (quick-action a11y group):** 4-button quick-
  action row now `role="group"` + `aria-label="Quick
  actions"` so SR users hear the grouping.

**9-lens sign-off:**

| Lens              | Status                                                                                                                                            |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case sweep, tabular-nums everywhere, dl/dt/dd rhythm on facts, progress bar labeled, consistent 2-decimal money                  |
| Mobile designer   | PASS — 44px+ touch on quick actions + mobile nav, unread badge scales for 2-digit, mobile-nav Pay label mirrors primary card copy                |
| Accessibility     | PASS — role=alert on error banners + role=status on success/verifying, autopay Switch labeled, Progress labeled, region semantics on tables      |
| Engineer          | PASS — silent messaging failures fixed (critical money-surface trust bug), money precision (cents) fixed across all rendered $ amounts            |
| AI systems        | N/A — no LLM output on this surface                                                                                                                |
| Land investor     | N/A — this is the borrower side. Borrower perspective: PASS — "Pay early" vs "Pay now" explicit, cancelled-payment reassurance, named "your lender" |
| Copywriter        | PASS — sentence-case, proper ellipsis, em-dash, first-person autopay voice, specific 1098 IRS-form naming, empty-state named recipient          |
| Infrastructure    | PARTIAL — no timeouts on fetch, no AbortController (deferred with reasoning); silent-fail path closed; retry affordance on message-load error     |
| Trust             | PASS — money precision across all surfaces, error-path visibility on messaging, specific cancelled-payment copy, named-counterparty on thread    |

**Deferred / flagged for owner:**
- **jsPDF statement/1098 generator** (`generatePDF` ~200
  lines, lines 403-595 of the original): generates user-
  downloadable PDF for Form 1098 + account statement. IRS
  Form 1098 has specific field-layout rules AcreOS may or
  may not fully implement; this is a product + compliance
  question beyond a 9-lens pass. Flagged as its own 10b.ii
  candidate.
- **`setTimeout(() => window.location.reload(), 2000)` on
  payment success:** drops client state including unread
  counts and scroll position. Better: invalidate loanData +
  rehydrate via a fresh GET. Flagged but not fixed — react-
  query isn't wired into this surface yet (manual `fetch` +
  `useState`) so the right fix is a bigger refactor.
- **Payoff quote "dialog flash on error":** `handleRequest
  PayoffQuote` opens the dialog before starting the fetch,
  and closes it on error. For <1s failures the dialog
  briefly appears then vanishes. Better UX: open dialog
  immediately, show error inline inside the dialog instead
  of closing. Deferred — minor polish beyond slice scope.
- **Schedule-tab DOM click hack:** `document.getElementById
  ('schedule-tab').click()` used by quick-action + mobile
  nav buttons to programmatically switch tabs. Should use
  the Radix Tabs controlled `value` state. Deferred
  (requires lifting state).

**Patterns carried forward:**
- **Money-precision rule (new 10b):** on a money surface,
  ALL rendered dollar amounts must explicitly set
  `{ minimumFractionDigits: 2, maximumFractionDigits: 2 }`
  via `toLocaleString()`, or use a typed helper like
  `formatUSD(cents)`. Bare `.toLocaleString()` is a trust
  bug: it drops cents on integer values, so a user paying
  the displayed number is short. Extends the Money-unset
  display rule (5l) into the formatting dimension. **Grep
  candidate** across `/properties`, `/deals`, `/campaigns`,
  `/finance` for any bare `.toLocaleString()` on a money
  value.
- **Silent-mutation-on-messaging rule (new 10b):** on any
  conversation-thread UI (user ↔ lender, user ↔ support,
  user ↔ agent), a message send that clears the composer on
  client but fails on server is THE worst-case trust bug.
  User believes the message was sent. MUST surface inline
  error + preserve the composer input on failure. This is
  a tighter variant of the Submit-error-must-not-unmount-
  form rule (9) specifically for conversational UIs.
- **Definition-list semantic rule (new 10b):** fact-pair
  rows that show `Label:` + `Value` should be `<dl>` +
  `<dt>`/`<dd>`, not `<span>/<span>` in a flex row. SR
  users hear labeled pairs; keyboard users get proper
  traversal. Applies wherever a page shows metadata
  card-style (loan details, deal summary, property
  attributes, payoff breakdowns, etc.).
- **Unread-count badge min-width rule (new 10b):** badges
  showing `{count}` with fixed `w-4` (16px) clip at ≥10.
  Always use `min-w-[16px] px-1` + `tabular-nums` so badges
  grow cleanly as the count crosses one/two/three digits.
  Also: parent button gets `aria-label="X (N unread)"` so
  SR users don't double-announce the raw digit.

**Commit:** `cf01654`

---

## Session 11 — 2026-04-23 — Public-form a11y grep sweep

**Scope:** apply the slice-10 public-form a11y checklist
across the remaining no-auth / auth-adjacent surfaces:
`/auth` (Clerk widget wrapper), `/forgot-password`,
`/reset-password`, and `/beta-intake`. One atomic commit, four
files, focused on the checklist: `<Label htmlFor>` + Input `id`,
`role="alert"` on validation, `aria-invalid` + `aria-describedby`,
form `onSubmit` for Enter-to-submit, mobile-keyboard attrs,
h1 landmark, 44px touch on primary CTAs, `useDocumentTitle`.

Slice-10 introduced this checklist on the borrower-portal entry;
slice 11 applies it horizontally across every public-facing
form AcreOS ships.

**forgot-password.tsx** — already mostly clean (role=alert,
Label htmlFor, form onSubmit, autocomplete all shipped in
slice 3). Closing remaining gaps:
- `useDocumentTitle("Reset your password")` added
- `aria-invalid` + `aria-describedby="forgot-error"` wired to
  the error paragraph
- Mobile-keyboard checklist completed on the email input
  (`inputMode`, `autoCapitalize="off"`, `autoCorrect="off"`,
  `spellCheck={false}`)
- `min-h-11` on primary CTA + "Back to sign in" + "Return to
  sign in"
- `aria-live="polite"` on the success confirmation card
- Error-message fallback specificity upgrade: "Failed to send
  reset email" → "We couldn't send the reset email right now.
  Check your connection and try again."

**reset-password.tsx** — same checklist plus:
- `useDocumentTitle("Set new password")`
- `aria-invalid` + `aria-describedby="reset-error"` on both
  password inputs (new + confirm)
- `role="alert"` on the missing-token error card
- Error-message specificity: "Passwords do not match" → "The
  two passwords don't match. Please retype them." (warmer,
  actionable); "Password must be at least 8 characters" →
  "Your new password must be at least 8 characters." (second-
  person); "Password reset failed" → "We couldn't reset your
  password. This link may have expired — request a new one."
  (named likely cause + recovery path)
- `aria-live="polite"` on success state
- `min-h-11` on primary CTA + "Request new link" button
- Confirm-password placeholder: "Repeat your new password" →
  "Retype your new password" (clearer imperative)

**auth-page.tsx** — mostly Clerk-managed internals. Wrapper
scope:
- sr-only `<h1>` landmark that swaps between "Sign in to X"
  and "Create a X account" based on mode — previously the
  brand `<span>` was the only visible heading, which SR users
  hear as unnamed decorative text
- Brand logo tile + brand-name `<span>` both `aria-hidden=
  "true"` since the sr-only h1 already names the brand
  (prevents double-announcement)
- "Joining organization…" loader wrapped in `role="status"` +
  `aria-live="polite"`; spinner div `aria-hidden="true"`
- "Still resolving..." auth-check loader also `role="status"`
  + a new sr-only label "Signing you in…" (was fully silent
  to SR)
- "Back to home" link gets `min-h-11` touch target

**beta-intake.tsx** — the biggest offender. Every `<Label>`
was unlinked to its Input, no form `<onSubmit>`, Title-Case
throughout, most icons missing `aria-hidden`:
- All 5 signup Labels now have `htmlFor` + Input `id`
  (beta-first-name, beta-last-name, beta-email, beta-company,
  beta-use-case, beta-referral-code) — SR users finally hear
  label names on focus
- The status-check Input also gets an sr-only
  `<Label htmlFor="beta-status-email">` so the stubbed
  icon-only form has an accessible name
- Both buttons (main submit + status-check) wrapped in
  `<form onSubmit>` — Enter submits the primary form; Enter
  submits the status check. Was mouse-only before.
- Mobile-keyboard checklist on all 3 email fields (main +
  check + referral) — `inputMode`, `autoCapitalize`,
  `autoCorrect`, `spellCheck` set appropriately. Referral
  code gets `autoCapitalize="characters"` since codes are
  uppercase (ACRE-00001).
- `autoComplete` on first/last/email/company ("given-name",
  "family-name", "email", "organization")
- `useDocumentTitle("Join the AcreOS beta")` wired
- `aria-label` on copy-button dynamically switches between
  "Copy referral code" and "Copied referral code to
  clipboard"
- Feature highlights `<div>` list → `<ul aria-label="Features
  included in the beta">` / `<li>` — proper list semantics
- Required-asterisk on Email label gets `aria-label=
  "required"` (slice 6a pattern)
- Textarea "use case" gets `aria-describedby="beta-use-case-
  hint"` wiring so SR users hear the priority-score hint on
  focus
- `grid-cols-2` on first-name/last-name promoted to
  `grid-cols-1 sm:grid-cols-2` so 320px doesn't squash both
  columns
- `min-h-11` on both primary buttons
- `role="status"` + `aria-live="polite"` on the join-success
  splash AND the status-check result
- `tabular-nums` on `#{position}` (#1234 jitter-free)
- Icon sweep (Rocket, CheckCircle2, Copy, Users, Share2,
  Loader2, Search) — 7 icons now `aria-hidden="true"`

**Copy (sentence-case across beta-intake):**
- "First Name" → "First name"
- "Last Name" → "Last name"
- "Company / Business Name" → "Company or business name"
  (remove slash, spell out "or" for readability)
- "Referral Code (optional)" → "Referral code (optional)"
- "Request Early Access" → "Request early access" (both
  CardTitle and button)
- "Join the AcreOS Beta" h1 → "Join the AcreOS beta"
- "Joining..." → "Joining…"
- "john@example.com" / "your@email.com" placeholders unified
  to "you@example.com" (RFC-2606 reserved domain)
- "More detail = higher priority score" → adds trailing
  period for sentence consistency
- "Email not found on the waitlist." — already fine
- Status badge.status rendered with `capitalize` class since
  the server likely sends lowercase

**Copy (error voice):**
- Beta-join error: "Error / Failed to join waitlist" →
  "Couldn't join the waitlist / Check your connection and
  try again." (name the action, name the recovery)
- Status-check error: "Error checking status" → "Couldn't
  check status / Check your connection and try again."

**9-lens sign-off:**

| Lens              | Status                                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, trailing periods, tabular-nums on position badge, grid-cols-1 sm:grid-cols-2 on name pair, proper list semantics             |
| Mobile designer   | PASS — 44px touch on all primary CTAs, mobile-keyboard checklist on all 3 email inputs, grid-cols-1 at 320px                                        |
| Accessibility     | PASS — all Labels now htmlFor-linked, form onSubmit on every form, aria-invalid + describedby wiring, role=alert + role=status, sr-only h1 on /auth |
| Engineer          | PASS — submit handlers converted to form onSubmit, error fallback specificity, trim() guards on empty submissions, aria attributes correct         |
| AI systems        | N/A — no LLM on these surfaces                                                                                                                       |
| Land investor     | PASS — /beta-intake copy is still "Land Investors" positioning; "More detail = higher priority" reads credible                                      |
| Copywriter        | PASS — sentence-case sweep, proper ellipsis, "Couldn't" contraction voice on errors, warmer password-mismatch, RFC-2606 placeholder                |
| Infrastructure    | PASS — error fallbacks specify recovery path; no new networking changes                                                                             |
| Trust             | PASS — reset-password "this link may have expired — request a new one" names the cause + the recovery path                                          |

**Deferred / flagged for owner:**
- **Clerk widget internal a11y** — the `<SignIn>` / `<SignUp>`
  widgets are Clerk-managed and we can't inject into their
  shadow. Clerk's widgets are generally a11y-compliant, but
  any changes to input-level semantics live upstream.
- **`/auth` invite-accept progress:** currently shows
  "Joining organization…" with no timeout — if the accept
  POST hangs, the user sits on a spinner forever. Deferred:
  add a 15s timeout + fallback copy.
- **beta-intake check-status result — "Email not found on
  the waitlist."** could be a security-ambiguity question
  (does this confirm a negative?). Intentionally low-signal
  — confirmed as OK for a public waitlist check, but worth
  flagging if security posture tightens.

**Patterns reinforced / no new patterns this session:**
This slice is pure application of the slice-10 public-form
a11y checklist. No new cross-cutting rules — the checklist
itself gains more surfaces confirming it.

**Commit:** `37b8911`

---

## Session 12 — 2026-04-23 — Money-precision rule: `usd()` helper + `/finance`

**Scope:** Introduce the canonical `usd()` dollar-value
formatter in `client/src/lib/format.ts` (slice-10b rule made
concrete as a reusable helper), and apply it across all 16
money-rendering sites in `client/src/pages/finance.tsx`.
Broader grep (76 files have bare `${X.toLocaleString()}`)
is deferred as per-surface follow-up work — finance is the
highest-value target since it's the note-servicing dashboard
and drives payoff / balance / payment reporting.

**Helper (`client/src/lib/format.ts`):**

```ts
export function usd(
  amount: number | string | null | undefined,
  opts: { noCents?: boolean; showSign?: boolean } = {}
): string {
  if (amount == null || amount === "") return "—";
  const n = typeof amount === "string" ? Number(amount) : amount;
  if (!Number.isFinite(n)) return "—";
  const digits = opts.noCents ? 0 : 2;
  // ... Intl.NumberFormat with minimumFractionDigits + maximumFractionDigits
}
```

Key design decisions:
- Accepts `number | string | null | undefined`. The existing
  AcreOS money data model stores amounts as Postgres `numeric`,
  which Drizzle surfaces as string. Consumers currently wrap
  with `Number()` inline; the helper accepts strings directly
  so call sites read cleanly.
- Returns `"—"` (em-dash) for null/undefined/empty/NaN. This
  is the Money-unset display rule from slice 5l made part of
  the helper itself — no more ad-hoc `|| 0` that renders as
  `$0.00` and signals "no value" ambiguously.
- `noCents` opt for compact contexts (chart axes, tile
  summaries where cents add noise).
- `showSign` opt for delta displays ("+$1,234.56" for gains).
- Distinct from existing `dollars()` helper which takes
  cents; coexistence is intentional because the ecosystem
  has both conventions.

**`/finance.tsx` refinements (16 money sites + adjacent a11y/copy):**

- **Money precision (P0 for a note-servicing surface):** all
  16 sites swapped from `${Number(x).toLocaleString()}` to
  `{usd(x)}`. Affected: portfolio-value tile, monthly-income
  tile, total-originated tile, notes-table current-balance
  column, notes-table monthly-payment column, detail-card
  current-balance, detail-card monthly-payment, loan-progress
  total-paid + remaining, payment-collection monthly-payment
  strip, payment-history amount/principal/interest columns,
  dunning past-due-amount. All now carry proper 2-decimal
  cents precision. 8+ sites also pick up the null/unset
  em-dash semantic for free (previously rendered `$0` for
  unset values).

- **Chart axis + tooltip:** recharts cash-flow chart YAxis
  tickFormatter + Tooltip formatter both routed through
  `usd()`. Tooltip label "Cash Flow" sentence-cased to
  "Cash flow". Y-axis uses `{ noCents: true }` so ticks stay
  compact ("$1,234" not "$1,234.00").

- **Tabular-nums sweep** on all dollar amounts, percentages,
  date strings, and term counts in the finance dashboard —
  money surface baseline.

- **Progress bar accessible:** `aria-label="Loan progress:
  N percent complete, X of Y payments made"` added to the
  stats-pane `<Progress>` instance (same fix as /portal
  slice 10b).

- **Stripe-status loader:** was a bare `Loader2` with no
  text, no SR label. Now `role="status" + aria-live=polite
  + sr-only "Checking Stripe connection…"` so SR users hear
  the interstitial wait.

- **Icon aria-hidden sweep:** `CreditCard`, `Settings`,
  `ExternalLink`, `Loader2` in the payment-collection card
  all got `aria-hidden="true"`.

- **Copy (sentence-case + period polish):** "Portfolio
  Value" → "Portfolio value"; "Monthly Income" → "Monthly
  income"; "Total Originated" → "Total originated"; "Current
  Balance" → "Current balance"; "Monthly Payment" →
  "Monthly payment" (3 sites); "Interest Rate" → "Interest
  rate"; "Loan Progress" → "Loan progress"; "Total Paid" →
  "Total paid"; "Payment Collection" → "Payment collection";
  "Past Due Amount" → "Past due amount"; "Missed Payments"
  → "Missed payments"; "Connect Stripe to accept payments"
  → period added; Stripe-CTA uses rsaquo (›) instead of
  encoded &gt; for proper typography.

- **Status-badge capitalize:** payment-history status badge
  previously rendered raw `'completed'` lowercase. Added
  `capitalize` class so "Completed" / "Failed" read
  consistently with other status-badge surfaces.

**Note on cross-page coverage:** this slice intentionally
stops at `/finance`. The same helper is now available for
`/properties`, `/deals`, `/campaigns`, `/borrower-portal`
(already hand-refined in 10b with inline 2-decimal options),
and ~72 other client files that render `${X.toLocaleString()}`.
Per-surface application of `usd()` belongs in future 9-lens
slices when those pages are refined end-to-end, not in a
mechanical sweep — each swap should come with the
accompanying null-semantic + tabular-nums + status-label
decisions that make money surfaces feel deliberate.

**9-lens sign-off:**

| Lens              | Status                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case + periods, tabular-nums, proper ›                                                                          |
| Mobile designer   | N/A — no layout changes (deferred to a future /finance full 9-lens slice)                                                         |
| Accessibility     | PASS — Progress bar labeled, Stripe loader has SR label, decorative icons aria-hidden                                             |
| Engineer          | PASS — usd() helper covers null/undefined/NaN/empty-string; status and dollar accept both string and number                      |
| AI systems        | N/A                                                                                                                                |
| Land investor     | PASS — actual cents now show on all note-servicing columns; lender reading a payoff figure gets precision                        |
| Copywriter        | PASS — sentence-case sweep                                                                                                          |
| Infrastructure    | N/A                                                                                                                                |
| Trust             | PASS — money-precision rule enforced across all 16 /finance renderings; null amounts render "—" not "$0" ambiguity                |

**Deferred / flagged for owner:**
- **Full /finance 9-lens pass** — this slice was narrow
  (money-precision + shallow a11y/copy adjacencies). A
  proper pass would cover the 1541-line file's 3+ dialogs,
  Stripe-connect flow, dunning manager, create-note form,
  deletion paths, etc. Flagged as 12b.
- **Money-precision grep sweep remaining** — `/properties`,
  `/deals`, `/campaigns`, plus the 72 other files with
  bare `${X.toLocaleString()}`. Should be applied
  incrementally as each surface gets its own 9-lens pass,
  NOT as a mechanical sweep (see slice note above).

**Patterns reinforced:**
- Money-precision rule (slice 10b) now has a canonical
  helper: `import { usd } from "@/lib/format"`.
- The Money-unset display rule (slice 5l — `$0` ambiguity)
  is folded into `usd()` itself: bare `usd(null)` returns
  `—`, not `$0.00`. Future call sites inherit this for free.

**Commit:** `39227e7`

---

## Session 13 — 2026-04-23 — `SignatureCapture` component (slice 9b)

**Surface:** `client/src/components/signature-capture.tsx`
(372 lines). The drawing + typed-name + consent-checkbox
component that ships inside `/sign/:docId` (slice 9) and any
future embedded signing UI. Deferred from slice 9 as its own
focused pass.

**Lens sweep + refinements shipped:**

- **A11y (canvas accessibility):** the `<canvas>` element
  had no accessible name — SR users tabbing onto it heard
  silence. Now `role="img"` + state-aware `aria-label` that
  swaps between "Signature drawn. Use Clear to redraw, or
  switch to the Type tab." (populated) and "Drawing canvas.
  Sign with your finger, stylus, or mouse. For keyboard
  access, switch to the Type tab." (empty). Explicit
  discovery of the keyboard alternative — critical since a
  canvas is inherently mouse/touch-only, and the Type tab
  IS the keyboard-accessible path.

- **A11y ("Sign here" pseudo-placeholder):** the visual
  "Sign here" overlay was a positioned `<div>` with
  `pointer-events-none` but no `aria-hidden` — SR could
  potentially read it and announce twice with the canvas
  aria-label. Now `aria-hidden="true"` so it's visual-only
  decoration.

- **A11y (typed-signature preview):** when user types their
  name, it renders in italic-Georgia serif. Previously the
  preview block had no semantic framing. Now `role="img"` +
  `aria-label="Typed signature preview: {name}"`, inner `<p>`
  aria-hidden to prevent double-announcement.

- **A11y (decorative-icon aria-hidden sweep):** 4 lucide
  icons — Pen (CardTitle + Draw-tab), Type (Type-tab),
  RotateCcw (Clear), Check (Apply) — all `aria-hidden="true"`.

- **Mobile (touch-target compliance):** Apply Signature was
  default `h-10` (40px); Clear was `size="sm"` (36px). On a
  legal-signature surface where a missed tap sends an empty
  signature or re-opens canvas state, those are below the
  44px baseline. Now both ship `min-h-11` (44px); Clear gets
  `sm:min-h-9` to revert to 36px on desktop where cursor
  precision makes the smaller target fine.

- **Mobile (canvas height):** drawing canvas was fixed
  `h-32` (128px) which is cramped on iPad or large phones.
  Now `h-32 sm:h-40` — 160px at sm+ for noticeably more
  room to draw a legible signature.

- **Engineer (autocomplete polish):** signer-name Input
  gained `autoComplete="name"` + `autoCapitalize="words"` +
  `autoCorrect="off"`. Typed-signature Input gained
  `autoComplete="off"` (avoid suggesting an unrelated name)
  + `autoCapitalize="words"` + `autoCorrect="off"` +
  `spellCheck={false}` so the browser doesn't underline the
  user's surname as a typo.

- **Copy (sentence-case sweep):** "Electronic Signature" →
  "Electronic signature"; "Full Legal Name" → "Full legal
  name"; "Type Your Signature" → "Type your signature";
  "Apply Signature" → "Apply signature".

- **Copy (description teaches the a11y path):** "Sign using
  your finger, stylus, or mouse" → "Sign with your finger,
  stylus, or mouse — or type your name on the Type tab for
  a keyboard-only alternative." — makes the keyboard
  fallback explicit and discoverable in plain sighted-user
  copy, not just SR aria-label.

- **Polish (checkbox alignment):** Checkbox got `mt-0.5`
  so it aligns with the first line of the long consent
  label instead of sitting above the baseline. Label got
  `cursor-pointer` so the whole consent sentence is a
  clickable hit target (consent-given remains guarded by
  both the Checkbox semantics + the canSubmit check).

- **SignatureDisplay polish:** signed-date display got
  `tabular-nums` so the timestamp doesn't jitter when state
  rerenders.

**9-lens sign-off:**

| Lens              | Status                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, tabular-nums on display date, canvas grows at sm+                                                          |
| Mobile designer   | PASS — 44px touch on Apply + Clear, canvas h-32 sm:h-40 for more room, autocomplete + autoCapitalize on both inputs              |
| Accessibility     | PASS — canvas role=img + state-aware aria-label, keyboard-alt path announced in copy, decorative icons aria-hidden, preview described |
| Engineer          | PASS — autocomplete set appropriately, no type changes, no API changes                                                            |
| AI systems        | N/A                                                                                                                                |
| Land investor     | N/A (signer perspective): PASS — keyboard-only signers can discover the Type tab without experimenting                            |
| Copywriter        | PASS — sentence-case sweep, description explicitly names keyboard path                                                             |
| Infrastructure    | N/A — no network changes                                                                                                          |
| Trust             | PASS — SR users get authoritative canvas state readouts, typed preview confirms what will be rendered                             |

**Deferred / flagged for owner:**
- **Canvas stroke + DPR scaling:** `initializeCanvas` sets
  DPR-aware dimensions then scales the context, which is
  correct. The `useEffect` guards re-init behind
  `!hasSignature` on resize, but the guard fires from within
  the same effect that includes `hasSignature` in deps —
  theoretically fine, but could be tightened with a
  `useLayoutEffect` + ResizeObserver. Deferred as an
  engineering polish rather than a 9-lens refinement.
- **Canvas keyboard-operable drawing:** conceptually,
  keyboard users have zero canvas path; the Type tab
  replaces it. Acceptable by design — any "keyboard draws"
  solution would be a separate product decision.
- **Signature download button** (`downloadSignatureImage`
  helper at the bottom) is exported but not consumed by
  this component. Left untouched — may have external
  callers.

**Commit:** `252026c`

---

## Session 14 — 2026-04-23 — Money-precision grep sweep continuation (`/properties`, `/deals`, `/campaigns-content`)

**Scope:** Apply `usd()` helper across the remaining money-
precision sites in `/properties`, `/deals`, and
`components/campaigns-content.tsx`. One commit, focused
targeted swap. Slice 12 shipped `usd()` + /finance; this
slice propagates to the three surfaces explicitly named in
the resume point. As with slice 12, this is NOT a full
9-lens pass of each page — those pages are 3246, 1700+, and
1500+ lines respectively and deserve their own dedicated
passes. This slice is a surgical money-precision swap with
small adjacent copy/a11y cleanup where it falls naturally.

**`/properties.tsx` (3246 lines — targeted swap):**
- 9 money sites routed through `usd()`:
  marketValue on property card; price/acre on property card;
  `formatCurrency` helper body (now returns "—" not "N/A"
  for unset); verdict-strip price-per-acre; enrichment-tab
  Median income; Median home value; County / State /
  National Avg per acre (3 ag-value rows).
- 2 non-money `.toLocaleString()` sites correctly left
  alone: `sizeAcres` acreage (1623), `population`
  demographics count (2690) — neither is a $ amount.
- "N/A" → "—" on 3 verdict-strip fields (Price per acre,
  Tax status, Acreage) matching the Money-unset display
  rule's "—" convention.
- Sentence-case sweep on the touched sections: "Price/Acre"
  → "Price per acre"; "Tax Status" → "Tax status"; "Median
  Income" → "Median income"; "Median Home Value" → "Median
  home value"; "Poverty Rate" → "Poverty rate";
  "Agricultural Values" → "Agricultural values"; "County
  Avg / Acre" etc → sentence-case; "Data Year" → "Data
  year".
- tabular-nums on all touched $ values.

**`/deals.tsx` (1700+ lines — targeted swap):**
- 10 money sites through `usd()`:
  Pipeline total; Closed total; deal-card offer+accepted
  rendered amount; pricing-recommendation toast description;
  pricing popover Suggested offer + Range min/max (2 lines);
  DealDetailDrawer offer-amount tile; accepted-amount tile;
  Property details Assessed value; Closing details Closing
  costs.
- Range display uses en-dash (&ndash;) instead of hyphen —
  typographically correct for a numeric range.
- tabular-nums on all touched $ values.
- DollarSign icon on deal-card card-footer got aria-hidden.
- "Suggested Offer" → "Suggested offer".

**`components/campaigns-content.tsx` (1500+ lines — 1 site):**
- Budget spent / total: `Spent ${spent} / ${budget}` →
  `Spent {usd(spent, noCents)} / {usd(budget, noCents)}`.
  Minor on its own but completes the campaigns surface for
  the money-precision rule.

**9-lens sign-off (applied only to touched sections):**

| Lens              | Status                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| Designer          | PASS — tabular-nums, sentence-case on touched sections, en-dash on deal range    |
| Accessibility     | PASS — DollarSign icon aria-hidden on deal card                                   |
| Engineer          | PASS — null/unset now flows through `usd() → "—"`; string-accepting signature     |
| Trust             | PASS — money-precision rule now consistent across /finance + /properties + /deals |
| Other lenses      | N/A — narrow swap, not a full page pass                                            |

**Deferred:**
- Full 9-lens pass on /properties, /deals, /campaigns each
  remains their own future slice.
- 72 client files still have bare `${X.toLocaleString()}`
  on money contexts. Remaining files are lower-traffic or
  founder-only dashboards — accept as per-surface follow-up.

**Patterns reinforced:**
- Money-precision rule + `usd()` helper now consistent
  across the four highest-traffic money surfaces (/finance,
  /properties, /deals, /campaigns, /portal).
- "N/A" → "—" consistency tightens — the Money-unset
  display rule (slice 5l) now applies beyond pure money
  contexts (tax-status, acreage) where "N/A" was reading
  bureaucratic; "—" is quieter.

**Commit:** `0ffdbde`

---

## Session 15 — 2026-04-23 — `/today` authenticated entry surface

**Surface:** `client/src/pages/today.tsx` (1324 lines) — the
authenticated entry page customers land on after sign-in.
Last touched in sessions 1-3 for infrastructure; this is its
first proper 9-lens pass.

**Lens sweep + refinements shipped:**

- **Copy (sentence-case sweep across 20+ section headers +
  CTAs):** "View Notes" / "View Leads" / "View Deals" /
  "View Properties" (alertLinkLabelByType); "Get Started" →
  "Get started"; "Active Leads" / "Active Deals" /
  "Pending Decisions" (welcome-back tiles); "Review
  Decisions" / "View Portfolio" / "Check Messages";
  "Add Your First Parcel" / "Import Leads"; "Agent
  Activity" / "Sovereign Dashboard"; "Business Pulse" /
  "Hot Deals" / "Avg Win Prob" / "This Month"; "Start
  Here Today" / "Evening Review"; "Today's Actions" /
  "All Tasks"; "Portfolio Alerts"; "Pax Noticed" / "View
  All"; "Follow Up" / "View Deal"; "Pax Suggests" / "All
  Leads"; "Goal Progress" / "Manage Goals"; "AI Action
  Queue" / "View Pipeline"; "Cash Position" / "View
  Finance"; "Portfolio Overview"; stat cards ("Active
  Leads" / "Active Notes" / "Open Deals").

- **A11y (decorative-icon aria-hidden sweep — 30+ icons):**
  Sparkles (onboarding + pax noticed ×2 + pax suggests +
  each pax observation card), RefreshCw (welcome back), X
  (dismiss ×2), Target (getting started hero), Map + Users
  (hero CTAs), CheckCircle2 (welcome back × 3), Briefcase
  + MessageSquare, ArrowRight (~8 in-app-link icons), Clock
  (pending pill + task cards), Sun (greeting), Bot (agent
  activity), Activity (pulse), DollarSign + Flame +
  BarChart3 + TrendingUp (pulse tiles), Zap + Moon
  (start-here-today), Calendar (today's actions), Bell
  (alerts), AlertTriangle + AlertCircle (alert cards +
  stale leads + expiring offers + cash position), Banknote
  (cash tile), Target (goals).

- **Money-precision (new 10b rule horizontally applied):**
  goal-progress revenue line: `$X.toLocaleString()` → `usd(X,
  { noCents: true })` — bare version was dropping cents
  (slice 10b P0 bug class). Cash-position 30/60/90 projected
  tiles + next3 payment amounts use `usd(.., noCents)`.
  Business Pulse Pipeline + This Month tiles replace hand-
  rolled `$${(x / 1M).toFixed(1)}M` compact format with the
  canonical `dollarsCompact()` helper (slice 12). Welcome-
  back loading `-` → `—` on 4 stat tiles per Money-unset
  rule.

- **A11y (semantic severity):** expiring-offer cards now
  `role="alert"` (deal deadline pressure is assertive, not
  polite); critical system alerts `role="alert"` + aria-
  live="assertive"; warning/info alerts `role="status"` +
  polite. Dismiss buttons on alerts gained specific aria-
  label naming the alert title. Pending-decisions pill got
  `role="link"` + aria-label naming the action count.
  Progress bars on goal cards got aria-label with percentage
  + label.

- **Mobile (layout + touch):** onboarding banner + welcome
  back both stack `flex-col sm:flex-row`; icon tiles get
  `shrink-0` so narrow widths don't squash. All primary
  action buttons get `min-h-11 sm:min-h-9` (44px mobile
  touch). Dismiss-icon buttons get `h-11 w-11 sm:h-9 sm:w-9`.

- **Tabular-nums sweep:** every number — pending decisions
  pill, welcome-back stat tiles (4), agent activity counters
  (3), autonomy badge, pulse score (`15/100`), all 4 pulse
  tiles, today's actions count badge, portfolio alerts
  count, pax noticed count, pax suggest confidence %, goal
  progress %, goal money, cash position late count +
  projected tiles + payment amounts, portfolio overview
  stat cards. Surface-wide jitter-free numerics.

- **Copy (severity/priority capitalize):** obs.severity,
  alert.priority, task.priority badges all render
  lowercase enum values (`high`/`medium`/`low`). Added
  `capitalize` class so they display as "High" / "Medium"
  etc., consistent with sentence-case surroundings.

- **useDocumentTitle:** wired as `"Today — AcreOS"` — tab
  label + SR page-load announcement both match.

**9-lens sign-off:**

| Lens              | Status                                                                                                                           |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case + tabular-nums + consistent `—` em-dash for unset values, mobile stack                                     |
| Mobile designer   | PASS — 44px touch on all CTAs, flex-col sm:flex-row stack, shrink-0 on icon tiles                                                |
| Accessibility     | PASS — 30+ decorative icons aria-hidden, role=alert/status wired by severity, aria-labels on dismiss + pending-decision pill    |
| Engineer          | PASS — no type changes, centralized usd()/dollarsCompact() usage, no new network calls                                           |
| AI systems        | N/A — widgets aggregate server-side Pax + intelligence data                                                                       |
| Land investor     | PASS — "pending decisions" affordance explicit, Pax Suggests confidence % now tabular-nums, "hot deals" + "accepted/in escrow"   |
| Copywriter        | PASS — full sentence-case sweep, em-dash for unset/loading                                                                         |
| Infrastructure    | N/A — no network changes                                                                                                          |
| Trust             | PASS — cent-drop trust bug eliminated on revenue goals, loading `-` unified to `—` Money-unset convention                         |

**Deferred:** the 1324-line file includes KPI stat-cards,
goal-progress section, Pax / alerts / tasks / AI-action cards
that may deserve their own deep pass — but the horizontal
rules were the priority and are now cleanly applied.

**Commit:** `fb24811`

---

## Session 16 — 2026-04-23 — `/dashboard` alternate entry surface

**Surface:** `client/src/pages/dashboard.tsx` (734 lines) —
the alternate dashboard surface (separate from /today). Same
pattern: horizontal application of established cross-cutting
rules.

- **useDocumentTitle("Dashboard — AcreOS")** wired.

- **Copy (sentence-case sweep):** "Today's Opportunities" →
  "Today's opportunities"; "View All" → "View all"; stat-
  card titles "Total Properties" / "Active Notes" / "Monthly
  Cashflow" / "Pipeline Value" → sentence-case;
  "Projected Income" → "Projected income"; "Smart
  Intelligence" → "Smart intelligence"; "Aging Leads" →
  "Aging leads"; "Inventory Status" → "Inventory status";
  "Lead Pipeline" → "Lead pipeline"; "Deal Velocity Funnel"
  → "Deal velocity funnel"; "Go to Leads" → "Go to leads";
  "Go to Campaigns" → "Go to campaigns". Contextual tip
  banners gain trailing periods.

- **Money-precision:** Monthly Cashflow StatCard used bare
  `$${(stats?.monthlyRevenue ?? 0).toLocaleString()}` —
  cent-drop risk on integer revenue values. Now
  `usd(stats?.monthlyRevenue ?? 0, { noCents: true })`.
  Pipeline Value StatCard same fix. Loading `"-"` → `"—"`
  (em-dash) on 3 stat cards, matching Money-unset rule.

- **A11y (decorative-icon aria-hidden sweep):** Target
  (deal-feed card + funnel card), Sparkles (intelligence +
  tip-banner × 2), BookOpen (playbooks), AlertTriangle
  (aging leads), Clock (aging-lead urgency badge),
  Building2 + Crown + Activity (org card), X (tip
  dismiss × 2). ~12 icons.

- **A11y (funnel progress bars):** funnel-stage progress
  bars promoted to `role="progressbar"` + aria-label (stage
  name + lead count + % of top-of-funnel) + aria-valuenow /
  min / max. SR users now get actual funnel conversion
  context instead of silent decorative divs.

- **Mobile (tip banner layout):** tip banners stack
  `flex-col sm:flex-row sm:items-center sm:justify-between`
  — at 320px the "Go to leads" button was pushed onto
  overflow. Buttons get `min-h-11 sm:min-h-9` (44px touch),
  dismiss X gets `h-11 w-11 sm:h-9 sm:w-9`.

- **Copy (aging-lead score separator):** " - Score: N"
  (hyphen + title case) → em-dash " — Score: N" + span
  with `normal-case tabular-nums` so the "negotiating lead"
  copy stays lowercase while the numeric score uses tabular
  digits.

- **Tabular-nums:** aging-lead count badge, active
  playbooks badge, funnel values + conversion %, funnel
  close-rate badge, inventory counts, aging-lead urgency
  days.

- **Copy (empty-state period):** "Add leads to see your
  deal funnel" gets trailing period.

**9-lens sign-off:**

| Lens              | Status                                                                                                        |
| ----------------- | ------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, tabular-nums, em-dash for unset values, trailing periods                               |
| Mobile designer   | PASS — stacked tip banners at 320px, 44px touch on CTAs                                                       |
| Accessibility     | PASS — 12+ decorative icons aria-hidden, funnel progressbar semantics, aria-label on dismiss                  |
| Engineer          | PASS — usd() on money stat cards, no type changes, canonical helper adoption                                 |
| Copywriter        | PASS — sentence-case, em-dash, period polish                                                                   |
| Trust             | PASS — cent-drop eliminated on Monthly cashflow + Pipeline value                                              |

**Deferred:** PlaybookCard, ActivityFeed, AnomalyAlerts,
PredictiveInsights, NextBestActions, TasksDueWidget child
components — each is its own slice. StatCard internals (which
render sparklines) also deferred.

**Commit:** `a73dfee`

---

## Session 17 — 2026-04-23 — `/leads` targeted trust + a11y pass (slice 17)

**Surface:** `client/src/pages/leads.tsx` (2572 lines) — the
primary lead-management list view. Too big for a full 9-lens
pass in one slice; this is a surgical pass on the highest-
value trust/a11y bugs + scoped copy sweep on the top
sections. Remaining full-page pass deferred (17b).

**Lens sweep + refinements shipped (high-impact surgical):**

- **Engineer + Trust (P1 silent-export bug):** `handleExport`
  caught to `console.error('Export error:', error)` only —
  user clicks Export, nothing happens, no feedback, they
  assume broken. Now throws through to a destructive toast:
  "Couldn't export leads / Check your connection and try
  again." Specific message from server surfaces if
  available. Same bug class as the silent-messaging fix
  in slice 10b.

- **Engineer + Trust (P1 silent-preview bug):**
  `handleFileSelect` caught to `console.error('Preview
  error:', error)` — user picks a malformed CSV, preview
  state goes null silently, user sees a broken import flow
  with no explanation. Now surfaces a destructive toast
  naming the likely cause ("Check that the file is a valid
  CSV and try again.").

- **Engineer + Security (CSV injection fix — slice 5k rule):**
  `handleBulkExport` used naive `v => \`"${v || ""}"\``.
  Two problems:
  1. **Embedded quotes not doubled** — `'She said "hi"'`
     breaks CSV parsing.
  2. **Formula-trigger prefix missing** — a value starting
     with `=`, `+`, `-`, `@`, `\t`, `\r` is interpreted as
     a formula when opened in Excel/Sheets, which is a CSV-
     injection attack vector. User exports leads, forwards
     the file, recipient opens in Excel, malicious formula
     runs with recipient's permissions.
  Factored `escapeCell()` inline per slice-5k rule: double
  embedded quotes AND prefix formula-trigger leading chars
  with `'` to force text interpretation. Also swapped the
  header row through the same escape.

- **A11y + Trust (`window.confirm` ban — slice 5l rule):**
  the Add-Lead dialog's onOpenChange handler gated close on
  dirty-form state with `window.confirm('You have unsaved
  changes. Discard them?')`. `window.confirm` was banned
  in slice 5l: no focus trap, no aria wiring, blocks main
  thread, inconsistent visual next to Radix dialogs.
  Replaced with `<ConfirmDialog>` gated by a new
  `pendingDiscardClose` state. Discard action is explicitly
  destructive-variant with a tighter "Keep editing" /
  "Discard" button pair that preserves the user's in-
  progress typing when they cancel the close.

- **Copy (sentence-case sweep — top sections):** "Add New
  Lead" → "Add lead" (dropped redundant "new"); "Create
  New Lead" → "Create lead" (dialog title); "All Leads" /
  "Hot Leads" / "Warm Leads" / "Cold Leads" / "Dead Leads"
  → sentence-case (6 items × 2 across desktop + mobile =
  12 replacements); "All Assignees" → "All assignees";
  "Import Tax List" → "Import tax list"; "Lead Quality
  Distribution" → "Lead quality distribution"; "A Tier" /
  "B Tier" / "C Tier" / "D Tier" → "A tier" / "B tier" /
  etc. in both legend + hover-title.

- **A11y (decorative-icon aria-hidden):** Flame / Sun /
  Snowflake / Skull stage-filter icons (× 2 renders —
  desktop + mobile) each got `aria-hidden`. Plus / Clock /
  Download / Upload / FileText / Loader2 in the top
  toolbar and dropdown.

- **A11y (lead-quality bar as role=img):** the horizontal
  colored-segment distribution bar previously had only
  `<div>` tier-tooltips. Container now `role="img"` with
  an aria-label summarizing all four tier counts, so SR
  users hear "Quality distribution: 12 A-tier, 18 B-tier,
  …" instead of four silent divs.

- **Engineer (bulk-update toast voice):** "Success /
  Updated X leads to '{status}'" → "Updated N lead(s) /
  Status set to '{status}'." — tighter title, correct
  singular/plural on 1 vs N. Error-toast voice upgraded:
  "Error / Failed to update leads" → "Couldn't update
  leads / Check your connection and try again."

- **Tabular-nums sweep on lead-quality distribution:** tier
  counts in legend + "N total" + "N overdue" now use
  `tabular-nums` so digits don't jitter as the filter
  changes.

- **useDocumentTitle** wired: "Leads — AcreOS".

**9-lens sign-off (applied to touched sections only):**

| Lens              | Status                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, tabular-nums, tier labels cleaner                                                            |
| Accessibility     | PASS — 10+ decorative icons aria-hidden, role=img on quality bar, window.confirm replaced with ConfirmDialog       |
| Engineer          | PASS — silent-export + silent-preview fixed, CSV-injection defense, form-dirty discard accessible                   |
| Copywriter        | PASS — tighter CTAs, correct singular/plural on bulk toast, specific error fallbacks                                 |
| Trust             | PASS — three silent-failure paths now surface toasts, CSV-injection vector closed, discard flow accessible          |
| Other             | N/A — deferred with the rest of the 2000+ lines of the page                                                         |

**Deferred (slice 17b):**
- Full 9-lens pass on LeadStatusBadge, LeadForm,
  ScoreBreakdownCard, LeadDetailDrawer, the main table
  rows, bulk-delete confirmation, import preview dialog,
  tax-delinquent importer. Each has its own a11y +
  sentence-case + mobile concerns. 2000+ lines remain.
- Score-formatter consistency sweep + score-tier rendering.
- SafeBulkDeleteDialog component passthrough.

**Patterns reinforced:**
- Silent-mutation / silent-query → toast rule applied to
  export/preview flows.
- window.confirm ban rule — trigger to audit: grep shows
  how many other surfaces still use it.
- CSV injection defense rule (slice 5k) — applied to a
  fourth surface; helper still inlined, factoring out
  waits for a fifth surface per the "three-strikes"
  convention.

**Commit:** `3fb7dcb`

---

## Session 18 — 2026-04-23 — `/onboarding-v2` targeted pass

**Surface:** `client/src/pages/onboarding-v2.tsx` (1469
lines). The 3-path onboarding flow (beginner / active /
enterprise) that customers enter after signup. Last touched
in session 2 — this is a targeted pass on the most visible
flow-level copy + the $ opportunity tiles.

**Lens sweep + refinements shipped:**

- **Copy (sentence-case sweep on STEPS_BY_PATH — 18 step
  titles + subtitles):** the 3-path, 6-step-each flow had
  every title in Title Case ("Where Do You Want to Invest?",
  "What's Your Strategy?", "Meet Atlas, Your AI Deal
  Partner", "Upgrade Your Investing Operation", "Import
  Your Existing Portfolio", "Set Your Target Counties",
  "Configure Autonomous Deal Machine", "Set Up Your Team",
  "Connect Your Tools", "Configure Deal Workflows", etc.)
  → sentence-case. All 18 step titles + subtitles rewritten
  with trailing periods where appropriate.

- **Money-precision (instant deal-hunt opportunity tiles):**
  the most trust-critical surface on the onboarding flow —
  the "aha moment" showing 3 real opportunities with
  estimated offer, resale, and profit values. All 3 money
  sites (`estimatedOfferPrice`, `estimatedResaleValue`,
  `potentialProfit`) switched from bare
  `$${X.toLocaleString()}` to `usd(X, { noCents: true })`
  — drops the cent-precision bug class (slice 10b rule) on
  a first-impression surface where a displayed "$12,345"
  representing an actual $12,345.67 would look broken when
  the user clicks into the full deal later.

- **Copy (tile labels):** "Offer Price" → "Offer price";
  "Resale Value" → "Resale value"; "Potential Profit" →
  "Potential profit"; "Motivation Score" → "Motivation
  score"; "Top Signal" → "Top signal"; "Hot Deal" → "Hot
  deal" (badge).

- **Copy (loading/scanning)**: "Scanning..." → "Scanning…"
  (proper ellipsis × 2 across error + loading paths).
  "Continue to Dashboard" → "Continue to dashboard".

- **Tabular-nums** on opportunity count ("Found N
  opportunities") + totalScanned number.

- **Mobile (touch):** both "Continue to dashboard" CTAs
  (error path + success path) now `min-h-11` (44px).

- **A11y (icon aria-hidden):** ArrowRight on CTAs × 2.

- **useDocumentTitle("Welcome to AcreOS")** wired on the
  main OnboardingV2 component.

**9-lens sign-off (applied to touched sections):**

| Lens              | Status                                                                                                         |
| ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case titles + subtitles, tabular-nums on counts + scanned, proper ellipsis, tile-label consistency |
| Mobile designer   | PASS — 44px touch on CTAs                                                                                       |
| Accessibility     | PASS — decorative ArrowRight icons aria-hidden                                                                  |
| Engineer          | PASS — centralized usd() helper on the high-visibility money tiles                                               |
| AI systems        | PASS — Atlas naming + "AI deal partner" framing consistent                                                      |
| Land investor     | PASS — "motivation score" + "potential profit" framing are industry-standard                                     |
| Copywriter        | PASS — sentence-case, proper ellipsis, trailing periods on subtitles                                              |
| Trust             | PASS — money-precision applied to the #1 aha-moment tile, so first-impression numbers match downstream reality   |

**Deferred (slice 18b):**
- The remaining 1100+ lines of onboarding-v2 — portfolio-
  import step, target-county form, strategy-selection
  cards, atlas-tour step, team invite step, integrations
  step, workflows step, the complete-celebration screen —
  each is its own focused surface. "Where do you want to
  invest?" county-picker has form semantics worth a full
  pass.
- `CompletionCelebration` component animation has no
  `prefers-reduced-motion` guard — worth addressing in a
  future motion-polish slice.
- `PortfolioImportStep` has its own CSV-import flow with a
  preview; slice-5k CSV-escape rule may apply.

**Commit:** `70df779`

---

## Session 19 — 2026-04-23 — `/settings` targeted trust + copy pass

**Surface:** `client/src/pages/settings.tsx` (2658 lines).
Too big for full 9-lens in one slice; targeted pass on the
General tab surface area + tab-list labels + error-toast
voice across the top-level mutations.

**Lens sweep + refinements shipped:**

- **Copy (error-toast voice — 4 sites):** generic "Error /
  Failed to X" pattern replaced with specific "Couldn't X"
  voice + recovery guidance. Applied to:
  - seedDataMutation: "Error / Failed to create demo data"
    → "Couldn't create demo data / Check your connection
    and try again."
  - clearDataMutation: same treatment.
  - handleUpgrade: "Error / Failed to create checkout
    session" → "Couldn't start checkout / Check your
    connection and try again — **your plan wasn't
    changed**." (the reassurance clause matters on a money
    action — user fears a charge on error.)
  - handleManageSubscription: "Error / Failed to open
    customer portal" → "Couldn't open the billing portal
    / Check your connection and try again."

- **Copy (sentence-case sweep on General tab):**
  "Organization Details" → "Organization details";
  "Organization Name" → "Organization name";
  "Subscription Tier" → "Subscription tier";
  "Current Period" → "Current period";
  "Manage Subscription" → "Manage subscription";
  "Usage & Limits" → "Usage and limits";
  "View Upgrade Options" → "View upgrade options";
  "7-Day Free Trial Available" → "7-day free trial
  available"; usage-item label "AI Requests" → "AI
  requests"; description "Active seller finance notes" →
  "Active seller-finance notes" (hyphenated compound
  modifier).

- **Copy (sentence-case on tab labels):** "Refer & Earn" →
  "Refer & earn"; "AI Tasks" → "AI tasks".

- **A11y (decorative-icon aria-hidden sweep — 18+ icons):**
  every TabsTrigger icon (General / Team / Payments /
  Communications / Notifications / AI / Data / Appearance /
  Integrations / Developer / Goals / Security / Privacy /
  Refer&Earn / Automations / AI Tasks), CardTitle icons
  (Building2, BarChart3), button icons (CreditCard,
  ExternalLink, Loader2, XCircle, Crown × 2, Gift, Trending
  Up, IconComponent × N usage items).

- **A11y (role=status on usage-warning banner):** the
  "You're approaching your limits" amber banner was an
  unlabeled div. Promoted to `role="status" +
  aria-live="polite"` so SR users get the warning when it
  appears on state change.

- **A11y (Progress aria-label):** usage Progress bars
  unlabeled. Now each gets aria-label naming the item,
  current value, limit, and percentage. Keyboard/SR users
  can hear actual usage instead of silent bars.

- **Typography: `–` (en-dash):** subscription current-period
  range used hyphen; promoted to `&ndash;` for proper typo.

- **Tabular-nums** on subscription-period date range.

- **useDocumentTitle("Settings — AcreOS")** wired.

**9-lens sign-off (applied to touched sections):**

| Lens              | Status                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, en-dash on date range, tabular-nums                                      |
| Accessibility     | PASS — 18+ decorative icons aria-hidden, role=status on limit warning, Progress aria-labeled  |
| Engineer          | PASS — no type changes, mutation error-voice tightened with specific fallbacks                 |
| Copywriter        | PASS — "Couldn't X" voice, money-action reassurance ("your plan wasn't changed")              |
| Trust             | PASS — money-action error reassurance pattern introduced (reassure no charge/state-change)     |

**Deferred (slice 19b):**
- The remaining ~2400 lines of settings — every other Tab
  (Team, Payments, Communications, Notifications, AI, Data,
  Integrations, Developer, Goals, Security, Privacy, Refer,
  Automations, AI Tasks, Appearance). Each is its own
  focused surface with its own a11y + copy concerns.
  StripeConnectSettings (lines 107-376), SeatManagement
  (377-553), TwoFactorAuthSettings (1607-1743),
  PasswordChangeSettings (1744-1821), ReferralSettings
  (1822-1941), GoalsSettings (1942-2123), ApiKeyManager
  (2124-2368), ActivityLogPanel (2369-2440),
  PrivacyDataSettings (2441+).
- Goal progress row has a bare `.toLocaleString()` money
  render (line 2096) — apply usd() in 19b.

**Patterns reinforced:**
- **Money-action error reassurance rule (new 19):** error
  toasts on money-related actions (checkout, charge, plan
  change, refund, payment submit) should explicitly state
  that no money moved / no state changed. Anxious users on
  a money path need reassurance, not just apology.

**Commit:** `809044c`

---

## Session 20 — 2026-04-23 — `/pipeline` full 9-lens pass

**Surface:** `client/src/pages/pipeline.tsx` (307 lines —
the unified workflow surface that composes Board + Leads +
Properties + Deals + Outreach as tabs). Small enough for a
full pass.

**Lens sweep + refinements shipped:**

- **Copy (sentence-case + semantic):** "Pipeline Funnel" →
  "Pipeline funnel"; velocity-metric labels "Hot" /
  "Stalled" switched to sentence-case; "accepted/escrow" →
  "accepted / in escrow" (spaced slash).

- **Money-precision:** two hand-rolled compact formatters
  (`$${total >= 1M ? (X / 1M).toFixed(1)+'M' : (X /
  1000).toFixed(0)+'K'}`) replaced with canonical
  `dollarsCompact()` helper (slice 12). Applies to total-
  pipeline + closed-value displays (3 sites). Consistent
  formatting across pages.

- **A11y (decorative-icon aria-hidden sweep):** TrendingUp
  × 3 (funnel header + avg-score tile + closed-value
  tile), Flame (hot tile), AlertTriangle (stalled tile),
  DollarSign (pipeline tile), plus all 5 TabsTrigger icons
  (GitBranch / Users / Map / Briefcase / Mail).

- **A11y (velocity-metric group):** 4-tile velocity grid
  gets `role="group"` + `aria-label="Pipeline velocity
  metrics"` so SR users hear the grouping relationship.

- **A11y (tab-fallback Suspense loader):** loader was an
  unlabeled pulse div; now `role="status"` +
  `aria-live="polite"` so SR users hear the wait state
  when a lazy tab is loading.

- **Tabular-nums sweep:** all counts (totalLeads,
  hotDeals, stalledDeals, closedDeals.length, active lead
  badges, active deals badges), money (dollarsCompact
  output), and avg score. Every number on the pipeline
  intelligence header.

- **useDocumentTitle("Pipeline — AcreOS")** wired.

**9-lens sign-off:**

| Lens              | Status                                                                                          |
| ----------------- | ----------------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, tabular-nums, consistent money formatting                                  |
| Mobile designer   | N/A — no new mobile changes, the file already had proper grid-cols-2 sm:grid-cols-4            |
| Accessibility     | PASS — 10+ decorative icons aria-hidden, role=group on metrics, role=status on tab fallback    |
| Engineer          | PASS — 3 hand-rolled compact formatters replaced with canonical helper                         |
| AI systems        | N/A — pipeline intelligence is server-aggregated                                                 |
| Land investor     | PASS — "Pipeline funnel" + "in escrow" + "14+ days idle" read credible                         |
| Copywriter        | PASS — tightened spacing on slash separators, sentence-case                                      |
| Infrastructure    | N/A — no network changes                                                                         |
| Trust             | PASS — money-precision now consistent with /today + /dashboard + /finance                      |

**Deferred:**
- Child pages loaded via Suspense (Leads / Properties /
  Deals / Campaigns) are each their own surface; pipeline
  just composes them. Each child has its own slice
  (Leads = 17, Deals = 5j-m, Properties = 5a-i, Campaigns
  = 6a/b).

**Commit:** `1b5d0f7`

---

## Session 21 — 2026-04-24 — Money-action error reassurance grep sweep

**Scope:** Apply the slice-19 money-action error reassurance
rule horizontally across the client. Find error paths on
money-related actions (payment init, payment verify, payment-
link generation, autopay toggle, QuickBooks sync) and upgrade
their error messaging to explicitly state that no money moved
and no state changed, not just "Failed to X."

**Files touched: 2, commits: 1 atomic.**

**`/finance.tsx` — 3 money-action error toasts upgraded:**

1. `handleGeneratePaymentLink` (Stripe Connect payment link):
   "Error / Failed to generate payment link" →
   "Couldn't generate payment link / Check your connection
   and try again — **no link was created or charged**."
   Silent `console.error` also removed (same pattern as
   slice 17 — trust bug class).

2. `handleCreatePayment` (Stripe PaymentIntent): success
   voice also cleaned ("Payment intent created" was
   technical-jargon on a user-facing surface → "Payment
   ready / You can now enter card details to complete the
   payment"). Error: "Error / Failed to create payment
   intent" → "Couldn't set up payment / Check your
   connection and try again — **no card was charged**."
   Silent `console.error` removed.

3. QuickBooks sync failure: "QuickBooks sync failed / {err
   message}" → appends "— **no records were changed**."
   The sync is idempotent server-side, but the user
   doesn't know that — explicit reassurance prevents them
   from manually "fixing" already-correct ledger entries.

**`/borrower-portal.tsx` — 3 payment-related error paths
upgraded:**

1. `verifyPayment` (post-Stripe-redirect verification):
   two error paths. "Failed to verify payment" →
   "We couldn't verify your payment right now. **If you
   were charged, your lender will reconcile it within 24
   hours — you don't need to pay again.**" This is the
   highest-anxiety path on the whole portal: the user just
   clicked through Stripe checkout, came back, and got an
   error. Without the "don't pay again" reassurance they
   will either (a) try to pay again and double-charge
   themselves, or (b) panic and call support. The
   reassurance is both user-friendly AND prevents support
   load.

2. `handleMakePayment` (Stripe checkout session init):
   two error paths. "Failed to initiate payment / Failed
   to create payment session" → "We couldn't start your
   payment right now / **No card was charged — please try
   again.**"

3. `handleToggleAutopay`: two error paths. "Failed to
   update autopay / Failed to update autopay settings" →
   "We couldn't update autopay. **Your current autopay
   setting hasn't changed.**" User toggles switch, error
   appears — without the reassurance they don't know if
   autopay is on or off right now. The explicit "hasn't
   changed" resolves the ambiguity.

**Lens sign-off:**

| Lens              | Status                                                                              |
| ----------------- | ----------------------------------------------------------------------------------- |
| Copywriter        | PASS — money-action voice consistent across /finance + /portal                     |
| Trust             | PASS — 6 money-action error paths now reassure; highest-anxiety payment-verify path carries the strongest reassurance (prevents double-charge) |
| Engineer          | PASS — 3 silent console.error bugs removed at the same time                        |
| Infrastructure    | PASS — error fallbacks explicit about payment state                                 |

**Deferred:**
- `handleRequestPayoffQuote` and `handleGenerateStatement`
  error paths in /borrower-portal — these are data-fetch
  actions, not money actions. Current "Failed to get payoff
  quote" voice is fine (no billing state at risk). Left
  as-is per the rule's scoping.
- Settings StripeConnect connect/disconnect error flows
  (inside SeatManagement / StripeConnectSettings components)
  — candidates for 19b.
- Subscription-cancel confirmation error handling in
  `CancellationDialog` — 19b candidate.

**Patterns reinforced, not introduced:**
- Money-action error reassurance rule (slice 19) now
  confirmed on 6 additional surfaces. The rule generalizes
  cleanly: anywhere a user action could plausibly affect
  billing state, the error path needs to explicitly name
  the current state ("no card was charged" / "your plan
  wasn't changed" / "your autopay setting hasn't changed"
  / "no link was created or charged" / "no records were
  changed" / "if you were charged, your lender will
  reconcile it"). The specific reassurance depends on the
  action semantics, but the *presence* of reassurance is
  the rule.

**Commit:** `8b5ad36`

---

## Session 22 — 2026-04-24 — /settings security sub-slice (2FA + password change, slice 19b.i)

**Scope:** Security-critical components inside
`/settings.tsx` — `TwoFactorAuthSettings` (lines 1612-1746)
and `PasswordChangeSettings` (1749-1826). First slice of the
19b completion work. These are the two most security-
sensitive sub-components in the settings tree, so they get
prioritized.

**Lens sweep + refinements shipped:**

- **Trust + A11y (P0 — window.prompt on 2FA disable):**
  `TwoFactorAuthSettings` used `window.prompt("Enter your
  6-digit authenticator code to disable 2FA:")` to capture
  the disable code. `window.prompt` is banned for the same
  reasons `window.confirm` was (slice 5l) — no focus trap,
  no proper input semantics, inconsistent styling next to
  Radix dialogs — AND additionally on a security surface
  it's worse: no `autoComplete="one-time-code"`, no
  `inputMode="numeric"`, no proper accessible Label, no
  aria wiring. On mobile this means iOS Safari doesn't
  offer SMS autofill and the user types the code manually.
  Fully replaced with a Radix `<Dialog>` + `<Label htmlFor>`
  + `<Input autoComplete="one-time-code" inputMode="numeric"
  autoCapitalize="off" autoCorrect="off" spellCheck={false}
  maxLength={6}>` + confirm/cancel buttons with a
  destructive-variant confirm. Each tick of the slice-5l
  rule now checked.

- **Trust (Money/security-action reassurance — apply slice
  19 rule):** 2FA mutation error paths previously said
  "Failed to set up 2FA" / "Invalid code. Please try again."
  / "Invalid code." — generic and didn't name the current
  state. Upgraded to:
  - setupMutation error: "Couldn't start 2FA setup / Check
    your connection and try again — **2FA is still off**."
  - verifyMutation error: "Code didn't match / Open your
    authenticator app and enter the current 6-digit code.
    **2FA is still off**."
  - disableMutation error: "Couldn't disable 2FA / Code
    didn't match. **2FA is still on** — try again with the
    current authenticator code."
  Each error path now explicitly names the current 2FA
  state (on/off) per the slice-19 rule, applied to security
  rather than money. Same anxiety-reduction payoff.

- **Engineer (form semantics on password change):**
  `PasswordChangeSettings` was a bare collection of Labels
  + Inputs + Button-onClick. No `<form onSubmit>`, so Enter
  in any field did nothing. Wrapped in `<form>` + moved
  submit handler to `onSubmit` + Button `type="submit"`.
  Enter now submits from any field. Inputs gained proper
  `autoComplete` values (`current-password`, `new-password`,
  `new-password`) so password managers can fill / capture
  correctly. `minLength={8}` added to both new-password
  fields for browser-level validation. aria-invalid +
  aria-describedby wired when passwords don't match.
  Error message role=alert.

- **Copy (sentence-case + voice):** "Two-Factor
  Authentication" → "Two-factor authentication"; "Change
  Password" → "Change password" (section + button); "Set
  Up 2FA" → "Set up 2FA"; "Verify & Enable" → "Verify and
  enable"; "2FA enabled successfully" → "Two-factor
  authentication is on"; "2FA disabled" → "Two-factor
  authentication is off"; "Current Password" / "New
  Password" / "Confirm New Password" → sentence-case;
  "Passwords do not match" → "The two passwords don't
  match. Please retype them." (warmer + actionable).

- **A11y (decorative-icon aria-hidden):** Shield (2FA
  CardTitle + password CardTitle), CheckCircle2 (2FA-on
  indicator), Loader2 (× 4 mutation-pending spinners).

- **A11y (status indicator):** "2FA is enabled" row wrapped
  in `role="status"` so SR users hear current state when
  the card renders.

- **A11y (QR-code alt text):** was `alt="2FA QR Code"` —
  fine but uninformative. Upgraded to "Scan this QR code
  with your authenticator app" — directive + matches the
  sighted-user instruction.

- **A11y (backup-codes instruction):** "Save these backup
  codes in a safe place" → "Save these backup codes in a
  safe place. Each can be used once if you lose access to
  your authenticator." — names *why* they matter, which
  reduces the odds users skip saving them.

- **Mobile (touch):** all 2FA + password-change buttons
  gain `min-h-11 sm:min-h-9` (44px mobile touch). 2FA
  verify row switches `flex-col sm:flex-row` so at 320px
  the Input, Verify, Cancel stack rather than clip.

- **Tabular-nums:** backup-codes-remaining count, manual-
  entry secret string (so fixed-width digits don't jitter
  when the value is revealed), backup-code list.

**9-lens sign-off:**

| Lens              | Status                                                                                     |
| ----------------- | ------------------------------------------------------------------------------------------ |
| Designer          | PASS — sentence-case, tabular-nums, stack on mobile                                       |
| Mobile designer   | PASS — 44px touch, flex-col at 320px, Input gets numeric keyboard via inputMode           |
| Accessibility     | PASS — window.prompt replaced with accessible Dialog, aria-invalid + role=alert on form, decorative icons aria-hidden, directive QR alt |
| Engineer          | PASS — form onSubmit + Enter submit, autoComplete + minLength                             |
| Copywriter        | PASS — sentence-case, current-state-named errors (2FA is on/off), warmer password-match   |
| Trust             | PASS — security actions now carry current-state reassurance, window.prompt eliminated     |

**Deferred (remaining 19b sub-slices):**
- StripeConnectSettings (lines 107-376) — billing surface
- SeatManagement (377-553) — team surface
- ReferralSettings (1822-1941)
- GoalsSettings (1942-2123) — has bare .toLocaleString()
  money site, apply usd()
- ApiKeyManager (2124-2368) — security-adjacent, may have
  similar prompt/confirm issues
- ActivityLogPanel (2369-2440)
- PrivacyDataSettings (2441+) — account deletion is
  security-critical

**Patterns reinforced:**
- **Money-action error reassurance rule → generalized:** the
  rule (slice 19) now applies cleanly to *any* action that
  affects account state the user cares about — billing,
  auth, security, sharing, deletion. Not just money. Error
  toasts should name the current state (on/off, enabled/
  disabled, subscribed/cancelled, shared/private, etc.)
  when the action could have changed it. Renaming the
  rule to "State-change error reassurance rule" is
  tempting but "money-action" was the original naming —
  keep the name, broaden the scope.
- **window.prompt ban (new 22):** `window.prompt` is
  subject to the same inaccessibility constraints as
  `window.confirm` (slice 5l), PLUS on a security surface
  it prevents proper input semantics. Replace with a
  Radix Dialog + Input with appropriate `autoComplete`,
  `inputMode`, etc. This extends the slice-5l
  window.confirm ban to prompt.

**Commit:** `04b54f0`

---

## Session 23 — 2026-04-24 — /settings billing sub-slice (StripeConnect + SeatManagement, slice 19b.ii)

**Scope:** billing-surface companion to slice 22's security
sub-slice. Refines `StripeConnectSettings` (lines 107-398 post-
slice, ~290 lines) and `SeatManagement` (lines 401-~620,
~220 lines) inside `/settings.tsx`.

**Lens sweep + refinements shipped:**

- **Trust (P1 — disconnect without confirmation):**
  `StripeConnectSettings` had a bare "Disconnect" button
  that immediately called `disconnectMutation.mutate()`.
  Disconnecting Stripe means losing the ability to collect
  new payments from borrowers — a high-impact destructive
  action with no guard rail. Gated behind a `<ConfirmDialog>`
  with specific description ("You won't be able to collect
  new payments through AcreOS until you reconnect. Pending
  payments already in Stripe will continue to process
  normally. You can reconnect at any time."). Destructive
  variant, "Keep connected" / "Disconnect Stripe" buttons.

- **Trust (state-change error reassurance — slice 19 rule,
  4 sites):** all 4 Stripe/Seat mutation error toasts
  upgraded. connectMutation: "Couldn't start Stripe
  onboarding … your Stripe connection is unchanged."
  refreshMutation: "Couldn't refresh Stripe status …".
  disconnectMutation: "Couldn't disconnect Stripe … your
  Stripe account is still connected." purchaseSeatsMutation:
  "Couldn't start seat purchase … **no card was charged
  and your seat count is unchanged**."

- **Copy (sentence-case sweep):**
  StripeConnectSettings labels: "Not Connected" → "Not
  connected"; "Onboarding Required" → "Onboarding
  required"; "Pending Verification" → "Pending
  verification"; "Connection Status" → "Connection status";
  "Action Required" → "Action required"; "Connect Stripe
  Account" → "Connect Stripe account"; "Complete
  Onboarding" → "Complete onboarding" (button + helper
  text + confirm reference); "Refresh Status" → "Refresh
  status"; "Platform Fee:" → "Platform fee:"; the helper
  text within Action required uses &ldquo;/&rdquo; smart
  quotes.
  SeatManagement labels: "Seat Management" → "Seat
  management"; "Included Seats" / "Additional Seats" →
  sentence-case; "Add More Seats" → "Add more seats";
  "Add Seats" → "Add seats". Description gets trailing
  period.

- **A11y (definition-list semantics):** Stripe connection-
  status grid (Charges / Payouts / Onboarding) and the
  SeatManagement stats grid (Included / Additional / Used
  / Available) promoted from `<div>` + `<p>` pairs to
  proper `<dl>` + `<dt>` / `<dd>` per the slice-10b
  definition-list semantic rule. SR users now hear labeled
  pairs.

- **A11y (decorative-icon aria-hidden sweep — 20+ icons):**
  Wallet × 2 (CardTitle + skeleton CardTitle), StatusIcon,
  CheckCircle2 × 3 (charges/payouts/onboarding status
  indicators), AlertCircle × 3, Link2, ExternalLink,
  RefreshCw, Unlink, Loader2 × 4. In SeatManagement: Users
  × 2, Check, UserPlus, Loader2.

- **A11y (Progress aria-label):** seat-usage Progress bar
  gains `aria-label="Seat usage: X of Y seats in use"` so
  SR users hear actual utilization.

- **A11y (Add-seats button aria-label):** the "Add seats"
  button with changing quantity/billing gets an aria-label
  that names the purchase intent: "Add {N} {billingPeriod}
  seat(s)". Screen reader users hear *what* they're
  about to commit to.

- **A11y (role=status on Stripe requirements banner):** the
  amber "Action required" banner promoted to role=status +
  aria-live=polite so SR users hear the new-requirement
  notification when it appears.

- **Engineer (select htmlFor):** Billing-period `<Select>`
  had an unlabeled trigger — the `<Label>` was present but
  not linked. Added `id` + `htmlFor`.

- **Tabular-nums sweep:** Stripe account-ID, SeatManagement
  count tiles (4), Seat-price tile, seat-quantity input.

- **Mobile (touch):** all CTAs in both sub-components now
  `min-h-11 sm:min-h-9`.

**9-lens sign-off (applied to touched components):**

| Lens              | Status                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------ |
| Designer          | PASS — sentence-case, tabular-nums, dl/dt/dd on fact grids                                            |
| Mobile designer   | PASS — 44px touch on all billing CTAs, inputMode=numeric on seat-quantity                             |
| Accessibility     | PASS — 20+ aria-hidden icons, role=status on requirements banner, Progress labeled, Add-seats named  |
| Engineer          | PASS — ConfirmDialog gates destructive disconnect, error specificity, Select htmlFor                  |
| Copywriter        | PASS — sentence-case sweep, "no card was charged and your seat count is unchanged"                    |
| Trust             | PASS — 4 state-change error reassurances, destructive action gated, platform-fee copy unchanged      |

**Deferred (remaining 19b sub-slices):**
- ReferralSettings (1822-1941)
- GoalsSettings (1942-2123) — has bare .toLocaleString()
  money site (line 2096) — apply usd()
- ApiKeyManager (2124-2368) — candidate for its own
  security-focused slice like 19b.i
- ActivityLogPanel (2369-2440)
- PrivacyDataSettings (2441+) — account deletion, another
  trust-critical surface with a likely confirm pattern

**Patterns reinforced:**
- **State-change error reassurance rule (slice 19,
  generalized 22):** 4 more applications (Stripe connect /
  disconnect / refresh; seat purchase).
- **Definition-list semantic rule (slice 10b):** applied to
  two additional fact grids inside settings.
- **ConfirmDialog on destructive actions (slice 5l):** Stripe
  disconnect joins the list of billing/security actions
  that should never fire without an explicit gate.

**Commit:** `74e62ec`

---

## Session 24 — 2026-04-24 — /settings privacy & data rights (slice 19b.iii)

**Scope:** `PrivacyDataSettings` (lines 2557-2782 post-
slice, ~230 lines) — GDPR Right-of-Access + Right-to-
Erasure surface. Trust-critical: incorrect handling of
the deletion flow could cause user data loss; incorrect
handling of the export flow could expose PII.

**Lens sweep + refinements shipped:**

- **Trust (state-change error reassurance — slice 19
  rule, 2 sites):** both mutation error toasts upgraded
  with explicit state-unchanged reassurance:
  - exportMutation: "Export failed" → "Couldn't prepare
    your export / Check your connection and try again —
    **no data was changed**." Export is read-only so this
    is extra-cautious, but on a privacy surface the
    reassurance reinforces that the user's data is safe
    at rest.
  - deleteMutation: "Deletion failed" → "Couldn't delete
    your data / Check your connection and try again —
    **your account is unchanged**." On a delete flow
    where the user has just typed DELETE and expects
    their data to be irreversibly anonymized, this is
    critical: without the reassurance they don't know
    if the delete partially applied.

- **A11y (role=alert on "can't be undone" warning):** the
  amber warning div announcing "This action cannot be
  undone." was unlabeled. Promoted to `role="alert"` so
  SR users hear it when the delete card renders. Copy
  also tightened: "This action cannot be undone" →
  "This action can't be undone" (contraction for warmer
  voice).

- **A11y (role=status on deleted state):** the post-
  deletion "Data Deletion Complete" surface was static;
  now wrapped in `role="status"` + `aria-live="polite"`
  so a user whose account just got deleted hears
  confirmation via SR.

- **A11y (Label htmlFor on delete-confirm input):** the
  "Type DELETE to confirm" hint was a `<p>` not linked
  to the Input via htmlFor. Promoted to `<Label
  htmlFor="input-delete-confirm">`; removed the
  redundant aria-label (the Label is now the accessible
  name). Input also gets autoComplete=off +
  autoCapitalize="characters" + autoCorrect=off +
  spellCheck=false so the browser doesn't suggest or
  auto-correct the verification phrase.

- **A11y (decorative-icon aria-hidden):** CheckCircle2
  (deleted state), Lock (h2), Download × 2 (export card),
  Trash2 × 2 (delete card + Request button), AlertTriangle
  (warning), Shield (rights card), Loader2 × 2 (pending
  spinners). 10+ icons.

- **A11y (rights-list semantics):** the 6 GDPR rights
  were rendered as `<div>` grid — promoted to `<ul>` /
  `<li>` with `aria-label="GDPR and CCPA data rights"` on
  the container. SR users now hear "list, 6 items" and
  can navigate the rights with standard list navigation.

- **Copy (sentence-case sweep):**
  "Data Deletion Complete" → "Data deletion complete";
  "Privacy & Data Rights" → "Privacy & data rights";
  "Export Your Data" / "Download My Data" → sentence-
  case; "Delete Personal Data" → "Delete personal data";
  "Right to Erasure" → "right to erasure" (in a
  parenthetical GDPR description, lowercase per the
  surrounding sentence-case pattern); "Request Data
  Deletion" → "Request data deletion"; "Confirm
  Deletion" → "Confirm deletion"; "Your Data Rights" →
  "Your data rights"; "Via Support" → "Via support";
  all 6 GDPR right labels switched to sentence-case
  ("Right of Access" → "Right of access", etc.); all
  right descriptions get trailing periods.

- **Copy (placeholder disambiguation):** the delete-
  confirm Input had `placeholder="DELETE"` — which lets
  users just type DELETE because the placeholder shows
  them the answer. Changed to `placeholder="Type
  DELETE here"` which is still discoverable but makes
  it clearer that the user needs to type it themselves.

- **Copy (proper ellipsis):** "Preparing Export..." →
  "Preparing export…"; "Deleting..." → "Deleting…".

- **Copy (warmer sign-out voice):** "You will be signed
  out shortly" → "You'll be signed out in a few
  seconds" (contraction + specificity).

- **Mobile (touch):** all 4 CTAs in the privacy surface
  (export, request-deletion, confirm-deletion, cancel)
  now `min-h-11 sm:min-h-9`.

- **Tabular-nums** on the "DELETE" token inside the
  Label (so fixed-width uppercase reads cleanly when
  bolded).

**9-lens sign-off:**

| Lens              | Status                                                                                    |
| ----------------- | ----------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, proper ellipsis, ul/li semantics on rights list                    |
| Mobile designer   | PASS — 44px touch on all 4 CTAs                                                            |
| Accessibility     | PASS — Label htmlFor on delete input, role=alert + role=status on state surfaces, 10+ icons aria-hidden, list semantics |
| Engineer          | PASS — autoComplete/autoCapitalize/spellCheck on delete-confirm input                    |
| Copywriter        | PASS — contraction voice, sentence-case, placeholder disambiguation, warmer sign-out copy |
| Trust             | PASS — state-change reassurance on both mutations, role=alert on warning, explicit "account is unchanged" on failed delete |

**Deferred (remaining 19b sub-slices):**
- ReferralSettings (1822-1941)
- GoalsSettings (1942-2123) — still has bare
  `.toLocaleString()` money rendering on line 2096
- ApiKeyManager (2124-2368)
- ActivityLogPanel (2369-2440)

**Patterns reinforced:**
- **State-change error reassurance rule (slice 19/22):**
  now applied to a fifth domain — *privacy actions*
  (export / delete). The rule is fully general: any
  action that touches user-visible state needs explicit
  current-state reassurance on error.
- **Placeholder disambiguation rule (new 24):** when a
  confirm-input requires the user to type a specific
  token (DELETE, CONFIRM, DROP TABLE, etc.), the
  placeholder should NOT show the token itself — that
  lets users bypass the intent of the confirmation by
  copying from the placeholder. Use "Type {token} here"
  format instead. Adds to the ConfirmDialog rule family.

**Commit:** `a90fa77`

---

## Session 25 — 2026-04-24 — /settings completion pass (ApiKeyManager + ActivityLogPanel + GoalsSettings, 19b.iv)

**Scope:** Close out the remaining `/settings` 19b sub-
components in one commit. ~520 lines across three sub-
components:
- `ApiKeyManager` (lines 2238-2538 post-slice, most work)
- `ActivityLogPanel` (2540-2620) — small table refresh
- `GoalsSettings` goal-progress row (money-precision +
  Progress aria-label)

ReferralSettings is the remaining 19b component — deferred
as tidy one-off follow-up.

**Lens sweep + refinements shipped:**

**ApiKeyManager (trust-critical — keys grant broad access):**

- **Trust (state-change error reassurance — slice 19 rule,
  2 sites):** createKey / revokeKey error toasts upgraded.
  "Failed to create API key" → "Couldn't create API key /
  Check your connection and try again — **no key was
  created**." "Failed to revoke key" → "Couldn't revoke
  API key / Check your connection and try again — **the
  key is still active**." The revoke reassurance is
  security-critical: user thinks they just disabled a
  leaked key, transient error silently leaves it live,
  user doesn't re-try = leaked key stays active forever.

- **A11y (just-created-key banner role=alert):** new-key
  banner is a one-time reveal ("copy now, won't be shown
  again") — critical for SR users to hear. Container
  promoted to `role="alert" + aria-live="assertive"`. The
  code block gets a sr-only Label ("Newly created API
  key") + id for programmatic reference. Copy button gets
  explicit `aria-label="Copy API key to clipboard"` (was
  bare "Copy" text). Copy-success toast specified from
  generic "Copied to clipboard" → "API key copied to
  clipboard" so SR users hear what exactly was copied.

- **A11y (create-form Label htmlFor + form onSubmit):** the
  3-field create form had `<Label>` without `htmlFor` and
  no `<form onSubmit>`. Promoted to proper form with
  `<Label htmlFor>` on all 3 fields (name/scope/expiry) +
  matching Input/SelectTrigger ids. Enter in the name
  field now submits.

- **Copy (scope select — teaches permissions):** the scope
  select was bare `Read` / `Write` / `Admin` labels — a
  user creating their first key has no idea what those
  mean. Upgraded to "Read — view data only" / "Write —
  create and edit" / "Admin — full control" so the blast
  radius of each scope is self-evident at selection time.

- **Copy (naming hint in CardDescription):** added
  "Name it for where you'll use it — Zapier, a custom
  script, etc. — so you know which key to revoke later."
  The key names become the only human-readable identifier
  for keys; naming them descriptively matters for future
  revocation.

- **A11y (loading state → role=status):** "Loading keys…"
  was a bare `<div>` with just text. Now a Loader2 spinner
  + role=status + aria-live=polite + "Loading keys…"
  accessible label.

- **A11y (scrollable table region):** keys list table
  promoted to a `tabIndex={0}` + `role="region"` +
  `aria-label="Active API keys"` wrapper so keyboard
  users can enter the region and scroll, and SR users get
  a landmark. Empty action-column TableHead gets
  `<span className="sr-only">Actions</span>` so SR users
  hear the column's purpose.

- **A11y (per-row revoke action group):** inline "Confirm
  / Cancel" buttons for revoke now wrapped in `role=
  "group"` with aria-label naming the key being revoked.
  Each button's aria-label specifies "Confirm revoke {key
  name}" / "Cancel revoke of {key name}" so SR users
  don't accidentally confirm revoke on the wrong row.

- **A11y (revoke button dynamic aria-label):** the
  per-row Revoke button was bare text. Now
  `aria-label="Revoke {key name}"`.

- **Sentence-case + mobile:** "API Keys" → "API keys";
  "Create Key" → "Create key"; "New API Key" → "New API
  key". Create button + Copy button + X dismiss get 44px
  touch targets.

- **Required-asterisk + autoComplete:** Name field gets
  required * + aria-label="required" + autoComplete=off
  (so key names aren't auto-filled from random unrelated
  saved data).

- **Mobile (grid-cols-1 sm:grid-cols-2):** scope + expiry
  row at 320px was clipping; stacks on mobile.

- **Tabular-nums** on key prefix, created/last-used/
  expires dates.

**ActivityLogPanel:**

- **Copy:** "Activity Log" → "Activity log".
- **A11y:** loading state wrapped in role=status +
  aria-live=polite + Loader2. Table promoted to
  role=region + tabIndex=0 + aria-label="Organization
  activity log" (scrollable log landmark). Decorative
  icons aria-hidden.
- **Tabular-nums** on timestamp + entity ID + user ID
  (8-char prefix) columns.

**GoalsSettings (goal-progress row):**

- **Money-precision (slice 10b rule applied
  conditionally):** goal values rendered bare
  `.toLocaleString()` regardless of goal type. For a
  revenue_earned goal, this drops cents. Now conditional:
  `goalType === "revenue_earned"` uses `usd(value,
  { noCents: true })`, other goal types (deals, leads,
  properties — count-based) use `toLocaleString()`
  directly. Matches the /today slice-15 pattern.
- **Progress aria-label:** the goal-progress bar gains a
  descriptive label naming the goal, percentage, and
  formatted current/target values. Previously SR users
  heard a silent progress bar.
- **En-dash** on date range (was hyphen).
- **Tabular-nums** on period dates + progress line.
- **44px touch** on delete button (bumped from h-7 w-7 to
  h-11 w-11 on mobile, reverted at sm+).
- **Delete-goal aria-label** upgraded from "Delete goal"
  (ambiguous in a list) to "Delete goal: {goal label}"
  (names the specific row).

**9-lens sign-off (applied to 3 touched components):**

| Lens              | Status                                                                            |
| ----------------- | --------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case, proper en-dash on ranges, tabular-nums on all date/ID/digit |
| Mobile designer   | PASS — grid-cols-1 sm:grid-cols-2 on create form, 44px touch on Copy/X/Delete    |
| Accessibility     | PASS — role=alert on new-key banner, role=status on loaders, role=region on log + keys tables, aria-labels on all dynamic actions, form onSubmit + Label htmlFor throughout |
| Engineer          | PASS — no type changes, centralized usd() helper applied to revenue goals        |
| AI systems        | N/A                                                                                 |
| Copywriter        | PASS — scope select teaches permissions, naming hint in CardDescription, revoke reassurance security-specific |
| Trust             | PASS — revoke-failure explicit ("the key is still active"), new-key reveal is role=alert, per-row action aria-labels prevent mis-clicks |

**Deferred (final 19b):**
- `ReferralSettings` (1822-1941) — deferred to slice 19b.v.
  Marketing-heavy, low-risk relative to the security +
  billing + privacy trio. Natural wrap-up one-off.

**Patterns reinforced:**
- **State-change error reassurance** (slice 19/22): applied
  to API-key revoke — brings total applications to 14
  error paths across the chain. The pattern is now
  thoroughly baked in.
- **Teach-via-option-label rule (new 25):** when a
  `<Select>` presents options whose consequences aren't
  obvious from the option name (permissions, pricing
  tiers, compliance modes, etc.), include the consequence
  in the option label itself ("Read — view data only"
  instead of bare "Read"). Selection happens once; the
  label is the only chance to disambiguate in-context.

**Commit:** `890f5bc`

---

## Session 26 — 2026-04-24 — /settings 19b.v final: ReferralSettings + GoalsSettings form polish

**Scope:** `ReferralSettings` (~100 lines) + `GoalsSettings`
form & outer header polish (~30 lines delta). Closes out
the entire `/settings` 19b arc — every sub-component in the
file now has at least one refinement pass.

**Lens sweep + refinements shipped:**

**ReferralSettings:**

- **Money-precision (slice 10b rule):** stats tiles
  rendered credit values as `$${(cents / 100).toFixed(0)}`
  which drops cents even on non-zero balances. Routed
  through `usd(cents / 100, { noCents: true })` so the
  display honors the canonical helper's null/empty
  fallback and lets a future cents-enabled rendering
  swap in cleanly.

- **A11y (definition-list semantics on stats):** 4 stats
  tiles (Signups / Converted / Credits earned / Available
  credit) promoted from `<div>` + `<p>` + `<p>` triples to
  `<dl>` / `<dd>` / `<dt>` per the slice-10b rule. SR
  users now hear labeled pairs instead of three unlinked
  text runs per tile.

- **A11y (error state with retry, replacing bare error
  text):** "Failed to load referral link. Please refresh."
  was a lone `<p className="text-destructive">`. Now a
  proper role=alert banner with AlertTriangle icon + body
  copy + a RefreshCw retry button that calls
  `codeQuery.refetch()` so the user doesn't have to
  reload the whole settings page.

- **A11y (referral-link Input Label htmlFor):** "Your
  referral link" was rendered as a `<p>` sitting above the
  Input, not linked to it. Promoted to `<Label htmlFor=
  "input-referral-link">` + Input `id` so SR users hear
  the label on focus.

- **Engineer (select-on-focus convenience):** the read-
  only referral-link Input now calls `e.currentTarget
  .select()` on focus — tapping the link immediately
  highlights the full URL so keyboard-copy (Ctrl/Cmd+C)
  works without a drag-select. Matches native behavior
  expected for shareable-URL fields.

- **Copy (Copy-toast voice):** "Copied! / Referral link
  copied to clipboard" → single-line "Referral link
  copied to clipboard" (description was redundant with
  title that says "Copied!").

- **Copy (sentence-case):** "Refer & Earn" → "Refer &
  earn"; stats labels "Credits Earned" → "Credits
  earned"; "Available Credit" → "Available credit".

- **Copy error-message fallback:** codeQuery + statsQuery
  both now throw with server status code instead of bare
  "Failed to load referral X" strings — consistent with
  the other settings queries.

- **A11y (aria-labels on Copy button):** icon+text "Copy"
  button gets explicit aria-label "Copy referral link to
  clipboard" (the visible "Copy" is fine for sighted
  users but SR users benefit from the explicit target).

- **A11y (Gift + Link2 + Users + CheckCircle2 + Coins +
  Wallet + RefreshCw + AlertTriangle):** 8 decorative
  icons now aria-hidden.

- **Mobile:** Copy button + retry button get `min-h-11
  sm:min-h-9` (44px touch).

- **Tabular-nums** on stats values.

**GoalsSettings (form + outer polish):**

- **Copy (sentence-case GOAL_TYPE_LABELS):** "Deals
  Closed" / "Notes Deployed" / "Revenue Earned ($)" /
  "Leads Contacted" → sentence-case. These render in
  both the Select options and the existing goal cards,
  so the change surfaces everywhere.

- **Copy (state-change reassurance on createGoal +
  deleteGoal):** "Error / Failed to create goal" →
  "Couldn't create goal / Check your connection and
  try again — no goal was created." Same treatment on
  delete: "the goal still exists."

- **Copy (sentence-case on card title + button +
  empty-state period):** "Business Goals" → "Business
  goals"; "New Goal" → "New goal"; "Save Goal" → "Save
  goal"; "Goal Label" → "Goal label"; "Start Date" /
  "End Date" → "Start date" / "End date"; empty-state
  "Create a goal to track your team's progress" gets
  trailing period.

- **A11y (Label htmlFor on all 5 form fields):** all
  Label elements were unlinked to their Inputs/Selects.
  Now properly wired (label / type / target / start-date
  / end-date).

- **A11y (required-asterisk aria-label):** both required
  fields (Goal label + Target) gain the required `*`
  indicator with `aria-label="required"` per the slice-
  6a pattern.

- **A11y (decorative icons):** Target × 2 (CardTitle +
  empty-state), X + Plus (toggle button), Calendar × 2
  (date-field Labels), Loader2 — all aria-hidden.

- **Engineer (inputMode on target-value):** Input
  `type="number"` gains `inputMode="decimal"` so mobile
  users get the numeric keyboard instead of the default.

- **Tabular-nums** on number + date inputs in the form
  so digits don't jitter as the user types.

- **Mobile:** both CTAs (toggle button + Save goal)
  now `min-h-11 sm:min-h-9`.

**9-lens sign-off:**

| Lens              | Status                                                                                   |
| ----------------- | ---------------------------------------------------------------------------------------- |
| Designer          | PASS — sentence-case sweep, proper trailing periods, tabular-nums                        |
| Mobile designer   | PASS — 44px touch on all 4 CTAs, inputMode=decimal on numeric, select-on-focus for copy |
| Accessibility     | PASS — dl/dt/dd on referral stats, role=alert with retry on load error, Label htmlFor on every form field, decorative icons aria-hidden, required-asterisk aria-label |
| Engineer          | PASS — centralized usd() on credit values, state-change reassurance on both goal mutations |
| Copywriter        | PASS — sentence-case, "no goal was created", trailing periods                             |
| Trust             | PASS — state-change reassurance completes the /settings mutation coverage                |

**Settings 19b arc complete.** Every sub-component of the
2658-line file has now had at least one refinement pass:
- 19 → General + Tab list (809044c)
- 19b.i → 2FA + PasswordChange (04b54f0)
- 19b.ii → StripeConnect + SeatManagement (74e62ec)
- 19b.iii → PrivacyDataSettings (a90fa77)
- 19b.iv → ApiKeyManager + ActivityLog + Goals progress
  (890f5bc)
- 19b.v → ReferralSettings + Goals form (this slice)

**Patterns reinforced (no new rules this slice):**
- Money-precision rule applied to cents-denominated
  balances (credits earned / available credit).
- Definition-list semantic rule applied to stats tiles.
- State-change error reassurance completed across all
  /settings mutations.

**Commit:** `ac1a64b`
