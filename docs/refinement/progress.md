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
