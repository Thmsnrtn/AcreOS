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
