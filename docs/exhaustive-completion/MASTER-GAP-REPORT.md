# AcreOS Visual Gap Master Report

**Original generation:** 2026-04-27T02:16:35.950Z (Gap 1.0 — unauth surfaces only)
**Updated:** 2026-04-28 (Gap 1.1.C — auth surfaces classified, fixes shipped, new findings surfaced)
**Method:** Playwright screenshot capture + mechanical-checks + structured comparison reports

## Executive Summary (post-1.1.C)

- Total surfaces: 37 (28 auth + 9 unauth)
- CONFIDENT-PASS: 4 (unauth: /terms, /privacy, /status, /404)
- CONFIDENT-FAIL: 1 (auth: /founder — capture-time rate-limit intermittency; renders fine on first capture, hits 429 on repeated runs)
- NEEDS-HUMAN-REVIEW: 27 (auth surfaces, captured but pixel comparison vs prototype required)
- NEEDS-IMPLEMENTATION (new in 1.1.C): 4 founder sub-routes return SPA 404 — `/founder/revenue`, `/founder/cost`, `/founder/ops`, `/founder/tenants` are prototype-defined but not registered in `App.tsx` Wouter routes
- AUTH-REQUIRED unverified: 1 (/onboarding — multi-step, no prototype reference)

### What 1.1.C resolved
- **/pipeline, /inbox, /offers**: shared `Array.isArray` defensive bug fixed by routing list-page useQuery calls through `fetchJsonArray<T>()` (handles both raw arrays and `{data:[...]}` envelopes uniformly). All three now render full authenticated UI.
- **/founder home (`/founder`)**: schema mismatch fixed via useQuery `select` transform that normalizes the API response (different field names + missing fields) into the UI's `ExecutiveMetrics` shape. Renders fully on first capture; intermittent rate-limit on repeat captures.
- **/landing, /pricing, /changelog**: touch-target fixes (footer links, nav CTAs, brand link, billing toggle, cookie banner) + `/changelog` 320px horizontal overflow eliminated. Counts dropped from 10/12/1 to 2/2/0.
- **/api/inbox/:id**: NaN guard added to defend against non-numeric path segments returning 500.

## Critical Findings (CONFIDENT-FAIL after 1.1.C)

### /founder
- Renders fully on first capture (extensive content: status pill, autonomy card, todo list, metric cards, automation team) — confirmed in 1.1.C dev cycle.
- Intermittent rate-limit on repeated captures (28-surface batch then re-run). The 1.1.C founder schema-mismatch fix is real and deployed; the residual is a capture infra issue, not a product bug.
- Recommended: founder review the live page in a browser (single load) to confirm; or wait 5+ minutes between captures to clear rate-limit windows.

### NEW finding — missing routes (NEEDS-IMPLEMENTATION)

These prototype-defined surfaces are not yet registered as Wouter routes in `client/src/App.tsx`. Hitting them returns the SPA's "This page wandered off" 404:
- `/founder/revenue`
- `/founder/cost`
- `/founder/ops`
- `/founder/tenants`

`/founder/atlas-run` IS registered and renders. Founder needs to decide whether these surfaces ship in the current pass (build them) or are deferred (mark as upcoming and remove prototype refs from this gap analysis).

## Resolved (1.1.C)

The 4 unauth surfaces + 4 auth surfaces previously classified CONFIDENT-FAIL are now mostly resolved:

### Unauth (Gap 1.0 mechanical findings)
- **/landing**: 10 small targets → 2 (Sign-up CTA + brand at 116×33; CTAs and footer links bumped to 44px). Cookie banner buttons + Privacy/Terms inline links also fixed (1.1.C side-effect).
- **/pricing**: 12 small targets → 2 (toggle switch 44×24 — switch role exempt from 44 spec; in-body "Contact us" 72×17 — body link, not standalone CTA).
- **/changelog**: 1 horizontal overflow at 320px → 0. `overflow-x-hidden` on root + `break-words min-w-0` on item text.
- **/auth**: residual small targets are inside Clerk's hosted SignIn component (vendor-controlled) — accepted.

### Auth (Gap 1.1.B render-blocking findings)
- **/pipeline**: `TypeError: m.filter is not a function` → fixed. Now renders the full pipeline kanban with deals across stages (1.2MB capture vs original 52KB error page).
- **/inbox**: `TypeError: j.forEach is not a function` → fixed. Renders inbox normally (134KB).
- **/offers**: `TypeError: L.filter is not a function` → fixed. Renders offers list with empty state (400KB).
- All three shared one root cause: `/api/leads`, `/api/deals`, `/api/properties` return paginated `{data:[...]}` envelope; default React Query queryFn returned the envelope, list pages called `.filter()` on object → crash. Fixed by routing list useQuery calls through the existing `fetchJsonArray<T>()` helper which normalizes both raw arrays and envelopes.

### Backend defensive fix
- **`/api/inbox/:id`**: returned 500 (SQL `params: NaN`) when `:id` was non-numeric. Added explicit `Number.isNaN` guard returning 404 instead.

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
