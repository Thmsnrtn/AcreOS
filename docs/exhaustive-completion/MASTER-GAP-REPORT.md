# AcreOS Visual Gap Master Report

Generated: 2026-04-27T02:16:35.950Z
Method: Playwright screenshot capture + mechanical-checks + structured comparison stubs

## Executive Summary

- Total surfaces: 37
- CONFIDENT-PASS: 4
- CONFIDENT-FAIL: 4
- NEEDS-HUMAN-REVIEW: 0
- AUTH-REQUIRED: 29 (must be founder-verified)

## Critical Findings (CONFIDENT-FAIL)

### /landing
- 10 small touch target(s) (<44px) across mobile breakpoints

### /auth
- 3 small touch target(s) (<44px) across mobile breakpoints
- 6 console error(s) across breakpoints

### /pricing
- 12 small touch target(s) (<44px) across mobile breakpoints

### /changelog
- 1 breakpoint(s) with horizontal overflow

## Surfaces Requiring Founder Review (AUTH-REQUIRED)

These cannot be auto-verified — Playwright cannot drive Clerk sign-in:

- /home
- /inbox
- /pipeline
- /parcels
- /contacts
- /calendar
- /buybox
- /lists
- /campaigns
- /perf
- /offers
- /documents
- /finance
- /dispos
- /agents
- /automation
- /audit
- /settings
- /team
- /billing
- /integrations
- /pax
- /founder
- /atlas-run
- /founder-rev
- /founder-tenants
- /founder-cost
- /founder-ops
- /onboarding (multi-step)

## Low-Confidence (NEEDS-HUMAN-REVIEW)


## Confident Passes (Spot-Check Recommended)

Production-only surfaces with no prototype to drift from + clean mechanical checks. Founder spot-checks 3-5 to validate calibration:

- /terms
- /privacy
- /status
- /404

## Per-Tier Summary

### Tier 1 — Pipeline Core (daily-driver loop)
All AUTH-REQUIRED — founder must walk: /today, /pipeline, /parcels, /inbox, /contacts, /calendar.

### Tier 2 — Sourcing
All AUTH-REQUIRED: /buyboxes (or embedded), /lists, /campaigns, /campaigns/performance.

### Tier 3 — Closing
All AUTH-REQUIRED: /offers, /documents, /finance, /dispositions.

### Tier 4 — Ops
All AUTH-REQUIRED: /agents, /automations, /audit, /settings, /team, /billing, /integrations, /pax.

### Tier 5 — Founder Mode
All AUTH-REQUIRED + founder-only gate: /founder, /founder/atlas-run, /founder/revenue, /founder/tenants, /founder/cost, /founder/ops.

### Unauth (landing, auth flows, coverage)
Captured + mechanically checked. See per-surface comparison files.

## Recommended Founder Walkthrough Priority

1. **AUTH-REQUIRED surfaces** (~29 surfaces) — only humans can do this. Sign in, walk every customer + founder route on desktop AND mobile.
2. **NEEDS-HUMAN-REVIEW surfaces** (0) — open the comparison file, make the visual judgment call automation can't.
3. **CONFIDENT-FAIL surfaces** (4) — verify automation's findings before they get fixed.
4. **Spot-check 3-5 CONFIDENT-PASS surfaces** — validate automation calibration. If a spot-check reveals issues, broaden the review.

**Estimated founder time:** 45-75 minutes (down from 90+ thanks to mechanical pre-pass).
