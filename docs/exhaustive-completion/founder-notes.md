# Founder Visual Verification Notes (Gap 1)

> Take notes per surface as you walk through. Use the format below for each.
> Be specific — "looks off" alone won't tell Claude Code what to fix.

**Verification session date:** _<fill in when you start>_
**Browser:** _<e.g. Chrome 130 on macOS>_
**Desktop viewport:** 1440px
**Mobile viewport:** 375px (iPhone SE size)

---

## How to use this template

Copy the per-surface block below for each surface. Fill in your honest read.

```
## /<surface-slug>

**Desktop:** <looks right / looks off — specifics>
**Mobile:** <looks right / looks off — specifics>
**Body content quality:** <header looks designed but body still feels old / fully designed / specific complaints>
**Per-state quality (try filtering, try empty, try with network throttled):**
  - Loading: <skeleton or spinner? matches final layout?>
  - Empty (zero data): <designed first-run? generic message?>
  - Empty (filtered): <explains the filter? generic?>
  - Error: <recoverable retry? prototype voice or generic?>
**Concerns:** <list>
**Specific quotes / drift / weirdness:** <screenshot caption-style observations>
```

---

## Surfaces to verify

Tier 1 — daily-driver loop:
- /today
- /pipeline
- /parcels (or first parcel detail page)
- /inbox

Tier 2 — sourcing:
- /buyboxes (if exists in production)
- /lists (if exists)
- /campaigns
- /campaigns/performance (if exists)

Tier 3 — closing:
- /offers
- /documents (if exists)
- /finance (seller finance / note servicing)
- /dispositions (if exists)

Tier 4 — ops:
- /agents
- /automations
- /audit
- /settings (each tab — paste each tab's notes separately)
- /team
- /billing
- /integrations
- /contacts
- /calendar

---

## Notes (fill in below)

<!-- Add per-surface blocks here. Example: -->

<!--
## /today

**Desktop:** Editorial header reads correctly ("Good morning, Thomas"), Fraunces serif renders, metric strip shows 5 columns. But the body feels like two designs — header is editorial homestead, "Today's actions" cards below feel like generic shadcn.
**Mobile:** Metric strip collapses to 2-col cleanly. The "Pending decisions" pill wraps onto two lines awkwardly.
**Body content quality:** Header designed, body still feels old.
**Per-state quality:**
  - Loading: skeleton present but feels generic — doesn't match final card shape
  - Empty (zero data): goes straight to "Welcome to AcreOS" banner, never shows zero-state
  - Empty (filtered): N/A on this surface
  - Error: hits ErrorBoundary global which now shows ServerErrorPage — looks great
**Concerns:** Body cards need the .acr-* treatment. Activity feed is missing entirely vs prototype.
**Specific quotes:** Hero "Good morning" needs the Friday/weekend-aware variant per prototype.
-->
