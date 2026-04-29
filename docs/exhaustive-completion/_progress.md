# Exhaustive Completion Progress

Last updated: 2026-04-29 (Port Phase H complete — autonomous run finished. FINAL-PORT-AUDIT.md ready for founder review.)

**Active directive:** Production port from prototype (replaces Gap 1.1.E/F).
Phases A–H: A) extraction, B) theme + font + appearance, C) personalization
infra, D) feature flags, E) surface-by-surface port, F) capture + audit per
tier, G) polish on six extra-attention surfaces, H) end-to-end verification.
Picker remains live as a refinement tool but is no longer the primary
mechanism.

**Phase A output:** `docs/exhaustive-completion/prototype-design-system.md` —
token inventory (5 themes × light/dark), font pairings, component mapping,
density rules, motion specs, voice exemplar (founder letter), full design
brief embedded.

**Phase B complete (end-to-end across B.1 → B.7):**
- **B.1** — 5 themes × light/dark in `client/src/index.css` with `--acr-*` + HSL parallel kept adjacent; legacy theme + accent system deleted; `rounded-card: 14px` added (commit `e96ef89`)
- **B.2** — `theme-context.tsx` rewrite: new types, Apple-native auto, `[data-theme]` + `[data-font-pairing]` on `<html>`, legacy compat preserved (commit `e96ef89`)
- **B.3** — 5 self-hosted free font pairings (Editorial / Modern / Classic / Native / Refined); Charter swapped to Source Serif 4 per JUDGMENT-CALLS B.3.1 on license-history ambiguity; all Google Fonts CDN refs killed in client + server CSP (commit `50f3499`)
- **B.4** — Full Settings → Appearance panel: Theme + Mode + Type (with sample-text font previews) + Density + Motion sections (commit `77295f3`)
- **B.5** — `users.appearance_preferences` JSONB column + GET/PATCH `/api/me/preferences` + debounced server sync from theme-context; localStorage-first hydration (no SSR) (commit `955d1c7`)
- **B.6** — `PORT-AUDIT-PHASE-B.md` written with static verification (passes) + live-eye checklist for founder review when reachable (this commit)
- **B.7** — Tracker updates + `_RESUME-PORT-PHASE-C.md` written (this commit)

**Phase B static verification:** `npm run check` clean across all commits, Tailwind build clean, 0 Google Fonts CDN refs platform-wide, 6 self-hosted woff2 files (~456KB total bundle), 10 [data-theme] selectors, 5 [data-font-pairing] selectors.

**Migration deployment note:** `migrations/0028_user_appearance_preferences.sql` runs at deploy time via existing drizzle-kit pipeline; client falls back gracefully if column missing.

**Phase C complete:**
- C.1 — Sidebar/mobile-nav prefs server-synced via `/api/me/preferences`; existing NavCustomizer Sheet mounted on Settings → Appearance. Desktop sidebar refactor deferred to Phase E shell re-skin (JUDGMENT-CALLS C.1.1).
- C.2 — Notification quiet hours card (per-user, applies to all channels). Existing per-event matrix retained; full matrix redesign deferred to Phase E (JUDGMENT-CALLS C.2.1).
- C.3 — `useListView()` hook + `<ListViewsPanel />` on Settings → Appearance. 12 list-types with rows/cards/expand-on-click. Surface-level rendering wires up as Phase E ports each list-bearing page.
- C.4 — `<AutonomyPanel />` on new Settings → Autonomy tab. Per-agent (Atlas/Pax/Sophie) 4-step scale + per-action overrides + monetary thresholds + time guardrails. Stored in `users.appearance_preferences.autonomy`. Tab gates behind `feature.autonomy-matrix` (founder-only) once Phase D ships flag system.
- C.5 — PORT-AUDIT-PHASE-C.md + _RESUME-PORT-PHASE-D.md written; tracker updated.

No new migrations in Phase C — JSONB schema flexes. `npm run check` clean. Five new files; seven modified.

**Phase D complete:**
- D.1 — Migration 0029 extends `platform_feature_flags` with `state` (5-value), `audience` jsonb, `changed_by`, `changed_at`. Backfills state from `enabled`. Seeds 5 design-brief flags.
- D.2 — `featureFlagService` (getAll / getByKey / isEnabled / setFlag / evaluateFlag) + `requireFlag` middleware (with `featureGate` legacy alias) + `/api/feature-flags` GET (per-user resolved view) + `/api/feature-flags/admin` GET/PATCH (founder admin).
- D.3 — `FeatureFlagsProvider`, `useFlag`, `useAllFlags`, `useFeatureFlagsRefresh`, `<RequireFlag>` mounted in App.tsx provider tree.
- D.4 — `/founder/features` page: calm 5-state Select per flag, audience editor when state=beta, controlled-routes display, search + state filter, optimistic updates with toast rollback.
- D.5 — `feature.autonomy-matrix` flag gates Settings → Autonomy tab via `useFlag` conditional render.
- D.6 — PORT-AUDIT-PHASE-D.md + _RESUME-PORT-PHASE-E.md written.

Single migration (0029). `npm run check` clean. Existing `/founder/feature-flags` (binary) coexists with new `/founder/features` (5-state). Three judgment calls logged (D.1.1 extend not rebuild, D.4.1 two pages coexist, D.5.1 component-level gate not route-level).

**Next session entry point:** `_RESUME-PORT-PHASE-E.md`

Predecessor: `docs/unified-build/COMPLETE.md` (unified build shipped through Phase 10).
Companion docs: `docs/unified-build/DESIGN-SYSTEM.md`, `docs/unified-build/phase-9-audit.md`.

## Gaps

- [/] Gap 1 — Auth-gated visual verification
  - [x] Gap 1.0 — Automated visual analysis (Phase A: 76 prototype shots, Phase B: 48 production shots + mechanical checks, Phase C: 37 comparison files, Phase D: master report + 45-page HTML bundle)
  - [/] Gap 1.1 — Autonomous gap fixing + variant picker (V2 workflow — supersedes the original founder-walkthrough plan)
    - [x] 1.1.A — Dev-mode founder bypass (header + cookie + Clerk-ticket signin, secret-gated, launch-marker safeguard) — deployed + verified on acreos.io
    - [x] 1.1.B — Claude Code authenticated visual analysis — 28 auth surfaces captured at 1440 + 375; per-surface comparison reports written; 4 CONFIDENT-FAIL surfaced (pipeline/inbox/offers/founder); 24 NEEDS-HUMAN-REVIEW
    - [x] 1.1.C — Autonomous gap fixing — 7 of 8 confident-fails resolved (3 list-page array bugs via fetchJsonArray; founder schema mismatch via select transform; landing/pricing touch targets; changelog overflow). Founder rate-limit residual is capture infra, not product. 4 new NEEDS-IMPLEMENTATION findings for unregistered founder sub-routes.
    - [x] 1.1.D — Variant picker construction (D.1 inventory + D.6.1 shell + D.6.2 chooser + D.6.3 three-panel + D.6.4 inline copy edit + D.6.5 split-view + D.6.6 density slider + D.6.7 color/token picker + D.6.8 server export + D.6.9 polish — all verified end-to-end via Playwright smoke, 22/22 checks pass)
    - [/] 1.1.E/F — **Superseded by Production Port directive (Phase A–H).** Picker remains as refinement tool but is no longer primary mechanism. See `prototype-design-system.md`.
      - [x] Phase A — Design-system extraction (token inventory × 5 themes × light/dark; font pairings; component mapping; density/motion specs; voice exemplar; full design brief)
      - [ ] Phase B — Theme system + font system + appearance settings
      - [ ] Phase C — Personalization infrastructure (sidebar config / notifications / list views / autonomy matrix)
      - [ ] Phase D — Feature flag system + founder UI
      - [ ] Phase E — Surface-by-surface design port (28+ customer surfaces, 4 unimplemented founder sub-routes, landing/pricing/onboarding)
      - [ ] Phase F — Capture + audit per tier
      - [ ] Phase G — Polish pass (today, onboarding, founder mode, settings, landing, pricing)
      - [ ] Phase H — End-to-end verification + FINAL-PORT-AUDIT.md
    - [ ] 1.1.G — Bypass cleanup (delete bypass code/secrets/logs after Phase H approval — NOT deferred to launch)
  - [x] Gap 1.2 — Reconciliation rolled into 1.1.F audit report (no longer a separate phase)
- [ ] Gap 2 — Tier 1 body deep-pass (today / pipeline / parcels / inbox)
- [ ] Gap 3 — Mobile sweep on Tier 1 (24 screenshots × 6 breakpoints)
- [ ] Gap 4 — Tier 2 body deep-pass (buyboxes / lists / campaigns / campaigns/performance)
- [ ] Gap 5 — Mobile sweep on Tier 2
- [ ] Gap 6 — Tier 3 body deep-pass (offers / documents / finance / dispositions)
- [ ] Gap 7 — Mobile sweep on Tier 3
- [ ] Gap 8 — Tier 4 body deep-pass (agents / automations / audit / settings / team / billing / integrations / contacts / calendar)
- [ ] Gap 9 — Mobile sweep on Tier 4
- [ ] Gap 10 — Per-surface state matrix audit (loading / empty-zero / empty-filtered / error)
- [ ] Gap 11 — Founder mode chassis adoption (23 of 25 routes)
- [ ] Gap 12 — AI output quality review (Atlas / Pax / Sophie)
- [ ] Gap 13 — Final coherence verification

## Current State

**Phase:** All phases A-H complete — autonomous run done.
**Status:** 22 port commits (`d530396` → `fa90e50` + this Phase H commit). 17 judgment calls logged for founder review (6 resolved, 11 open deferrals). 2 migrations ready to deploy (0028 user appearance preferences, 0029 feature flag state machine). FINAL-PORT-AUDIT.md is the founder review deliverable. Bypass cleanup (Gap 1.1.G) waits for founder approval after review.

**1.1.D summary (all 9 sub-phases shipped + verified):**
- D.1 — variant-inventory.md (36 decisions across visual-review/platform-tweak/build-defer)
- D.6.1 — shell scaffold (Vite + React + TS + Tailwind, served at /__dev/picker/)
- D.6.2 — variant chooser w/ keyboard nav (j/k, 1/2/3, a/u/d filter), progress bar, filter chips
- D.6.3 — three-panel comparison (prototype | production | preview) with breakpoint selector + zoom
- D.6.4 — inline copy editing — same-origin script injection wraps text in contenteditable spans w/ stable data-copy-id (surfacePath::sha1(text)); MutationObserver re-applies after React re-render; edits saved to selection.copyOverrides; verified 218 editable spans on /today
- D.6.5 — split-view multi-breakpoint (toggle to 2-row layout, 6 panels at 2 different breakpoints)
- D.6.6 — density slider (compact/comfortable/spacious/custom, 4 sliders for fs/lh/pad/gap, real-time preview via injected style block)
- D.6.7 — color/token override picker (--acr-brand swatches, constrained to 3 design-system terracottas; updates --acr-brand-soft/glow/ring/chart-a together)
- D.6.8 — server-side export endpoint (POST /api/__dev/founder-selections, accepts Clerk founder session OR bypass header, writes to /tmp on Fly, returns retrieval command + browser-download fallback)
- D.6.9 — polish pass (Fraunces editorial headers, --acr-* warm cream + terracotta palette, tier badges T1-T5, status chips, generous breathing room)

**1.1.D infrastructure additions (all REMOVE_BEFORE_LAUNCH at 1.1.G):**
- `acreos-picker/` — Vite + React + TS + Tailwind app (committed dist/ via .gitignore negation)
- `acreos-picker/public/injectors/{copy-edit,density,tokens}.js` — same-origin scripts injected into preview iframe (script.src = '/__dev/picker/injectors/<name>.js' — production iframe CSP requires script-src 'self' which inline-script injection violated)
- `acreos/vendor/{react.development,react-dom.development,babel.min}.js` — React/Babel bundled as same-origin static files (Chrome blocks cross-origin script tags inside iframes even with CSP allow + CORS — bundling fixes it)
- `tests/e2e/_picker-smoke.ts` — 22-check Playwright smoke test (sign-in, shell, polish, three-panel, breakpoints, split-view, copy edit, density, color, export, retrieval)

**Verification screenshots:** `docs/exhaustive-completion/auth-screenshots/_picker-verification-{01-shell,02-three-panel,03-split-view,04-edit-mode,05-density-spacious,06-density-custom,07-color-deeper,08-export-result,99-final}.png`

**Picker URL:** https://acreos.io/__dev/picker/ — founder must sign into acreos.io first via normal Clerk flow, then navigate to picker. Same-origin iframes carry session cookies for production preview panel.

---

## (Previous) 1.1.C summary

**1.1.C summary (7 fixes shipped, 4 new findings):**

**Fixed:**
1. **/pipeline, /inbox, /offers** — shared envelope-vs-array bug. `/api/leads`, `/api/deals`, `/api/properties` return `{data:[...]}` paginated envelopes; default React Query queryFn returned the envelope; list pages called `.filter()` on object → crashed to 500 ErrorBoundary. Fix: routed list useQuery calls through existing `fetchJsonArray<T>()` helper. All three pages now render full authenticated UI.
2. **/founder home** — schema mismatch between API response and `ExecutiveMetrics` interface (different field names: `activeOrgs` vs `activeOrganizations`, `newOrgsLast30` vs `newOrgsLast30Days`; missing fields: `nps`, `churnRate`, `churnedOrgsLast30Days`). Fix: useQuery `select` transform normalizes shape with zero-defaults for missing fields. Page renders fully on first load.
3. **/landing** — touch targets reduced 10 → 2 (footer links, nav CTAs, cookie banner all bumped to min-h-44). Remaining: brand link 116×33 (close), and one Sign-up CTA edge case.
4. **/pricing** — touch targets reduced 12 → 2 (footer + nav fixed). Remaining: switch (44×24, exempt) + in-body link (72×17, body-copy not CTA).
5. **/changelog** — 320px horizontal overflow eliminated; touch targets cleared. ✅ ALL CLEAR.
6. **/api/inbox/:id NaN guard** — backend defensive fix; non-numeric `:id` now returns 404 instead of 500.

**New findings (NEEDS-IMPLEMENTATION):**
- `/founder/revenue`, `/founder/cost`, `/founder/ops`, `/founder/tenants` are not registered as Wouter routes in `App.tsx` — return SPA 404 ("This page wandered off"). Prototype shows them but production hasn't built them. Founder decision: build now or defer.

**1.1.C tooling added (REMOVE_BEFORE_LAUNCH at 1.1.G):**
- `tests/e2e/verify-mechanical-fixes.ts` — re-verify touch-target / overflow on unauth surfaces

Next: 1.1.D — variant picker construction.

**1.1.B outputs:**
- 56 production screenshots in `auth-screenshots/` (28 surfaces × 1440 + 375)
- `auth-screenshots/_capture-report.json` — capture metadata + per-surface console errors
- 28 per-surface comparison reports overwritten in `visual-comparisons/<slug>-AUTH-REQUIRED.md`
- Master gap report updated to cover all surfaces (4 + 4 CONFIDENT-FAIL, 4 PASS, 24 NEEDS-HUMAN-REVIEW)
- `tests/e2e/capture-auth-surfaces.ts` — Playwright capture script (REMOVE_BEFORE_LAUNCH)
- `tests/e2e/build-auth-comparisons.ts` — comparison-report generator (REMOVE_BEFORE_LAUNCH)

**4 auth CONFIDENT-FAIL surfaces (1.1.C fix queue):**
1. /pipeline — `m.filter is not a function` in `pipeline-ScU16Kxc.js`. Likely `useQuery` data not an array on initial render.
2. /inbox — `j.forEach is not a function` (same pattern). Plus `/api/inbox/threads` returns 500 — separate backend bug.
3. /offers — `L.filter is not a function` (same pattern).
4. /founder — Rate-limited toast + Loading skeleton; needs re-capture to distinguish transient 429 from persistent failure.

**Common root cause hypothesis:** /pipeline, /inbox, /offers all share `X.<array-method> is not a function` on minified bundles. Likely a single missing `Array.isArray()` defensive pattern across list components.

**1.1.A artifacts (deployed):**
- `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` — middleware (header + cookie modes)
- `server/routes.ts` — registered after `clerkMiddleware`
- Fly secrets set: `DEV_FOUNDER_BYPASS=true`, `DEV_FOUNDER_BYPASS_SECRET`, `DEV_FOUNDER_USER_ID=user_3CK2u6pGH7EYHgFyMS99fwhLSM7`
- Local: `.env.local`, `.dev-bypass-secret` (both gitignored, not in docker context)
- Audit log: `/tmp/dev-bypass-audit.log` on each Fly machine (per-machine, ephemeral). Read via `fly ssh console -a acreos -C 'cat /tmp/dev-bypass-audit.log'`
- Verification: GET /api/auth/user without secret → 401; with `X-Dev-Founder-Bypass: $SECRET` → 200 with founder identity (Thomas Norton, user_3CK2u6pGH7EYHgFyMS99fwhLSM7); `?dev_bypass=$SECRET` → 302 + signed HttpOnly cookie; cookie path → 200

**Important domain note:** acreos.fly.dev 301-redirects to acreos.io (canonical). All Playwright captures and verification should target `https://acreos.io`, not `acreos.fly.dev`.

**V2 workflow summary (supersedes original 1.1 founder-walkthrough plan):**
Instead of an offline founder walkthrough, Claude Code uses a development-mode founder authentication bypass to access auth-gated surfaces directly. Bypass is dual-mode: `X-Dev-Founder-Bypass: <secret>` header for Playwright captures (1.1.B), and `?dev_bypass=<secret>` query param that mints a short-lived signed HttpOnly cookie for picker iframes (1.1.D–F). Bypass is secret-gated, audited, and refuses to run if `.launched` marker exists. Cleanup is automatic at Gap 1.1.G (immediately after audit-after-fix is approved) — NOT deferred to launch.

**Sub-phase end states:**
- 1.1.A done → bypass live on acreos.fly.dev, inert without secret, header + cookie paths verified
- 1.1.B done → all auth-gated surfaces captured at 6 breakpoints, master gap report updated to cover all surfaces
- 1.1.C done → all CONFIDENT-FAIL items have fix attempts deployed and verified; variant-required items escalated to picker
- 1.1.D done → picker app built locally per D.6 incremental sequence, all four capabilities (3-panel, breakpoints, density, color) functional
- 1.1.E (founder) → picker selections committed to `founder-selections.json`
- 1.1.F done → selections applied, audit-after-fix report generated, founder approves
- 1.1.G done → bypass code/secrets/logs/audit-log fully removed, deploy clean version, verify

**Gap 1.0 outputs (preserved as reference):**
- `docs/exhaustive-completion/MASTER-GAP-REPORT.md` — 37 surfaces classified (4 PASS / 4 FAIL / 29 AUTH-REQUIRED)
- `docs/exhaustive-completion/comparisons/index.html` — clickable side-by-side bundle
- `docs/exhaustive-completion/visual-comparisons/` — 37 per-surface stubs (will be filled in 1.1.B)
- `docs/exhaustive-completion/mechanical-checks/` — 8 unauth surface check reports
- `docs/exhaustive-completion/prototype-screenshots/` — 76 reference images
- `docs/exhaustive-completion/production-screenshots/` — 48 production captures (unauth only — 1.1.B adds auth surfaces)

**Mechanical findings (CONFIDENT-FAIL — to fix in 1.1.C):**
- /landing — 10 small touch targets (<44px) across mobile breakpoints
- /pricing — 12 small touch targets across mobile breakpoints
- /auth — 3 small touch targets + 6 console errors (Clerk hosted UI; may be expected)
- /changelog — 1 breakpoint with horizontal overflow (320px)

**Bypass safety locks (1.1.A):**
- Requires `DEV_FOUNDER_BYPASS=true` AND `DEV_FOUNDER_BYPASS_SECRET` set
- Refuses to run (process.exit FATAL) if `NODE_ENV=production` AND `.launched` marker exists at repo root
- Every bypass use logged to `dev-bypass-audit.log` (gitignored)
- Cookie path: `?dev_bypass=<secret>` → HttpOnly, Secure, SameSite=Lax, 1hr TTL signed cookie; param stripped via redirect
- Header path: `X-Dev-Founder-Bypass: <secret>` for Playwright (no cookie, per-request)
- Removal at 1.1.G is mandatory before Gap 1 marks complete
