# Phase 3.5 — Tier 1 Deploy + Smoke

## Pre-deploy state (2026-04-26 local end-of-session)

**Local commits queued for production (5 since `ad32cae`):**
- `705023f` chore(today): port homestead command-center CSS
- `ce57920` feat(today): homestead hero + metric strip
- `ff3bbb1` feat(pipeline): homestead editorial header
- `6bafba5` feat(properties,inbox): homestead editorial headers

**Quality gates:**
- ✅ `npm run check` clean (TypeScript)
- ✅ `npm run build` clean (vite + esbuild; same baseline warnings as 2A.5)
- (no test rerun this push — no test-affecting changes; CI will run on push)

## Deploy

GH Actions run `24962048731` triggered by push, completed green.

## Smoke results (2026-04-26 17:05 UTC)

**Public surface (unauthenticated):**
- ✅ `https://acreos.io/api/health` → 200
- ✅ Landing page (`/`) renders unchanged — Phase 2A nav, hero, all 11 sections intact (verified via Playwright accessibility snapshot)
- ✅ `/auth` route loads (Clerk sign-in)
- ✅ Main CSS bundle (`index-C12pYinP.css`) ships the `--acr-*` token system (30+ tokens verified)

**Auth-gated surfaces (deferred to manual operator pass):**
- ⚠️ `/today`, `/dashboard`, `/pipeline`, `/properties`, `/inbox` are gated behind Clerk sign-in. Playwright cannot smoke without operator-issued session cookie.
- The Tier 1 CSS chunk (`today.css` containing `.acr-cc-*` / `.acr-eyebrow` / `.acr-cc-metrics` rules) is code-split by Vite — confirmed not bundled into `index-C12pYinP.css`. Will hydrate when those routes load post-auth.

**Manual operator smoke checklist (sign in as founder):**
- [ ] `/today`: editorial header reads "Good morning/afternoon, {name}." in Fraunces; date eyebrow above; pending-decision soft clause if applicable; 5-column `.acr-cc-metrics` strip below (Active leads · Properties · Active notes · Open deals · Pending decisions)
- [ ] `/pipeline`: header reads "{n} active deals across leads, properties, and outreach." with brand-tinted soft clause
- [ ] `/properties`: header reads "{n} parcels across your portfolio." or empty-state "No parcels yet."
- [ ] `/inbox`: header reads "{n} unread messages" or empty-state "All caught up. Nothing waiting."
- [ ] Mobile (375px): editorial headers stack correctly; `.acr-cc-metrics` collapses to 2-column on `/today`
- [ ] No new console errors in the auth shell

## Verdict

Tier 1 first-pass shipped. No regressions in the public surface. Auth-gated visual changes require manual operator verification.

**Phase 3 status:** Headers shipped on all 4 surfaces. Body sections (deal tables, property grids, message threads, AI suggestion cards) remain at production's existing visual treatment — Per-Surface Fidelity passes for those bodies are tracked as Phase 3 follow-up sub-tasks (deferred to next session or follow-up commits).

## Known issues carried from Phase 2A.5

- Fraunces font ERR_FAILED in Playwright headless (verify in real browser; if reproducible, self-host)
- `/api/white-label/config` 401 for unauthenticated visitors

Both unchanged by this push.
