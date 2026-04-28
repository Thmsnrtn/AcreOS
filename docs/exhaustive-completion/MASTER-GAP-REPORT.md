# AcreOS Visual Gap Master Report

**Original generation:** 2026-04-27T02:16:35.950Z (Gap 1.0 — unauth surfaces only)
**Updated:** 2026-04-28 (Gap 1.1.B — auth surfaces added via dev-bypass Clerk sign-in)
**Method:** Playwright screenshot capture + mechanical-checks + structured comparison reports

## Executive Summary (post-1.1.B)

- Total surfaces: 37 (28 auth + 9 unauth)
- CONFIDENT-PASS: 4 (unauth: /terms, /privacy, /status, /404)
- CONFIDENT-FAIL: 8
  - Unauth (4): /landing, /auth, /pricing, /changelog
  - Auth (4): /pipeline, /inbox, /offers, /founder
- NEEDS-HUMAN-REVIEW: 24 (auth surfaces, captured but pixel comparison vs prototype required)
- AUTH-REQUIRED unverified: 1 (/onboarding — multi-step, no prototype reference)

## Critical Findings (CONFIDENT-FAIL)

### Unauth surfaces (from Gap 1.0)

#### /landing
- 10 small touch target(s) (<44px) across mobile breakpoints

#### /auth
- 3 small touch target(s) (<44px) across mobile breakpoints
- 6 console error(s) across breakpoints

#### /pricing
- 12 small touch target(s) (<44px) across mobile breakpoints

#### /changelog
- 1 breakpoint(s) with horizontal overflow

### Auth surfaces (new — from Gap 1.1.B)

#### /pipeline
- **Desktop + Mobile:** `TypeError: m.filter is not a function` (renders 500 ErrorBoundary page)
- Source: `assets/pipeline-ScU16Kxc.js:2:9697` — pipeline component receives non-array where array expected
- File size 52KB (desktop), 40KB (mobile) confirms blank/error rendering
- Fix: defensive default for source data; verify `useQuery` `data` is array before `.filter()`

#### /inbox
- **Desktop + Mobile:** `TypeError: j.forEach is not a function` (renders 500 ErrorBoundary page)
- Same pattern as /pipeline — non-array passed to `.forEach`
- /api/inbox/threads independently returns 500 (separate backend bug)

#### /offers
- **Desktop + Mobile:** `TypeError: L.filter is not a function` (renders 500 ErrorBoundary page)
- Same pattern; offers list component crashing on undefined data

#### /founder
- **Desktop + Mobile:** Captures show "Rate Limited" toast and "Loading..." skeleton, no founder dashboard render
- Possible causes: rate limit hit during rapid capture sequence, or `/api/founder/*` endpoints throttling
- Re-capture with delay between requests to confirm transient vs persistent

**Common root cause hypothesis:** all three list-rendering FAILs (/pipeline, /inbox, /offers) share `X.filter/forEach is not a function` minified errors. Likely same bug — list components don't defend against undefined data on initial render. Probably a single fix pattern (defensive `Array.isArray(data) ? data : []` or default `[]` in `useQuery`).

## Auth surfaces — NEEDS-HUMAN-REVIEW (24)

Captured authenticated via dev-bypass Clerk sign-in token; no render-blocking errors detected. Pixel-level comparison vs prototype required (planned for 1.1.D picker three-panel comparison).

| Surface | URL | Tier | Desktop size | Mobile size |
|---|---|---|---|---|
| home | /today | 1 | 1351KB ✓ | 675KB ✓ |
| parcels | /parcels/81 | 1 | (visual only) | (visual only) |
| contacts | /contacts | 1 | rendered | rendered |
| calendar | /calendar | 1 | rendered | rendered |
| buybox | /buyboxes | 2 | rendered | rendered |
| lists | /lists | 2 | rendered | rendered |
| campaigns | /campaigns | 2 | rendered | rendered |
| perf | /campaigns/performance | 2 | rendered | rendered |
| documents | /documents | 3 | rendered | rendered |
| finance | /finance | 3 | rendered | rendered |
| dispos | /dispositions | 3 | rendered | rendered |
| agents | /agents | 4 | 494KB | rendered |
| automation | /automations | 4 | rendered | rendered |
| audit | /audit | 4 | rendered | rendered |
| settings | /settings | 4 | 1097KB ✓ | rendered |
| team | /team | 4 | rendered | rendered |
| billing | /billing | 4 | rendered | rendered |
| integrations | /integrations | 4 | rendered | rendered |
| pax | /ai | 4 | 670KB ✓ | rendered |
| atlas-run | /founder/atlas-run | 5 | rendered | rendered |
| founder-rev | /founder/revenue | 5 | rendered | rendered |
| founder-tenants | /founder/tenants | 5 | rendered | rendered |
| founder-cost | /founder/cost | 5 | rendered | rendered |
| founder-ops | /founder/ops | 5 | rendered | rendered |

See per-surface reports in `visual-comparisons/<slug>-AUTH-REQUIRED.md` for capture metadata + console errors.

## Confident Passes (Spot-Check Recommended)

Production-only surfaces with no prototype to drift from + clean mechanical checks. Founder spot-checks 3-5 to validate calibration:

- /terms
- /privacy
- /status
- /404

## Auth-Required Unverified

- /onboarding (multi-step) — no prototype reference; founder review needed when onboarding flow stabilizes

## Per-Tier Summary

### Tier 1 — Pipeline Core (daily-driver loop)
- /today: rendered ✓ (NEEDS-HUMAN-REVIEW)
- /pipeline: **CONFIDENT-FAIL** — `m.filter is not a function`
- /parcels/81: rendered ✓
- /inbox: **CONFIDENT-FAIL** — `j.forEach is not a function`
- /contacts, /calendar: rendered ✓

### Tier 2 — Sourcing
All rendered without crash signal: /buyboxes, /lists, /campaigns, /campaigns/performance.

### Tier 3 — Closing
- /offers: **CONFIDENT-FAIL** — `L.filter is not a function`
- /documents, /finance, /dispositions: rendered ✓

### Tier 4 — Ops
All rendered: /agents, /automations, /audit, /settings, /team, /billing, /integrations, /ai (pax).

### Tier 5 — Founder Mode
- /founder: **CONFIDENT-FAIL** — rate-limited or rendering error (re-capture needed)
- /founder/atlas-run, /revenue, /tenants, /cost, /ops: rendered ✓

### Unauth (landing, auth flows, coverage)
Captured + mechanically checked in Gap 1.0. See per-surface comparison files.

## Recommended Next Actions

### 1.1.C — Autonomous fixes (next phase)

Priority 1 (real bugs surfacing in this run):
- Fix the `Array.is-not-a-function` pattern in pipeline / inbox / offers (likely shared root cause)
- Re-capture /founder to distinguish transient rate-limit from persistent failure

Priority 2 (Gap 1.0 mechanical findings):
- /landing, /pricing, /auth: small touch target audit + fix
- /changelog: horizontal overflow at 320px

### 1.1.D — Variant picker for 24 NEEDS-HUMAN-REVIEW surfaces

Auto-classification cannot judge prototype fidelity. The picker's three-panel
comparison (prototype | current | proposed) lets the founder visually classify
these in one pass with optional fix selections.

## 1.1.B Methodology Notes

- Bypass: `/api/__dev/signin-token` (header-gated) returns Clerk sign-in token; Playwright redeems via `window.Clerk.client.signIn.create({strategy:'ticket', ticket})`. Real Clerk session established.
- Per-breakpoint strategy: fresh BrowserContext + prime per breakpoint (Clerk's session was viewport-sensitive in unexpected ways).
- Wait pattern: `domcontentloaded` → `networkidle` (8s) → `wait until "Loading AcreOS" gone` (8s) → 1.5s settle.
- Rate limits: 28 surfaces × 2 breakpoints in rapid succession occasionally tripped 429s — flagged as transient capture artifact, not product bug. Re-capture would confirm.
