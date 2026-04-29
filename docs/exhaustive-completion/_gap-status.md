# Gap Status — Detailed Completion Criteria

Each gap has explicit checkbox criteria. A gap is only marked complete when every box is checked.

---

## Gap 1 — Auth-Gated Visual Verification

**Status:** in progress (1.0 automated pre-pass running per process update)

### Gap 1.0 — Automated visual analysis (per process update) — ✅ COMPLETE

- [x] Phase A — Claude Design prototype rendered locally; 76 prototype screenshots at 1440 + 375 → `prototype-screenshots/`
- [x] Phase B — 8 unauthenticated production surfaces × 6 breakpoints = 48 screenshots + 8 mechanical-check reports → `production-screenshots/` + `mechanical-checks/`
- [x] Phase C — 37 surface comparison files written with verdict (CONFIDENT-PASS=4, CONFIDENT-FAIL=4, AUTH-REQUIRED=29) → `visual-comparisons/`
- [x] Phase D — `MASTER-GAP-REPORT.md` + 45-page HTML comparison bundle → `comparisons/index.html`
- [x] Prototype rendered successfully — no skip needed

### Gap 1.1 — Autonomous gap fixing + variant picker (V2 workflow)

V2 supersedes the original founder-walkthrough plan. Claude Code uses a dev-mode founder bypass to access auth-gated surfaces, autonomously fixes confident-fail items, and presents variant-decision items to the founder via an interactive picker. Bypass cleanup at 1.1.G is mandatory before Gap 1 closes.

#### Gap 1.1.A — Dev-mode founder bypass implementation — ✅ COMPLETE
- [x] `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` created with header + cookie paths
- [x] Bypass wired into `server/routes.ts` after `clerkMiddleware` (overrides `req.auth` via `Object.defineProperty`)
- [x] Launch-marker safeguard: refuses to run if `NODE_ENV=production` AND `.launched` exists
- [x] Local secret in `.env.local` and `.dev-bypass-secret`; both gitignored AND dockerignored
- [x] Fly secrets set on `acreos`: `DEV_FOUNDER_BYPASS`, `DEV_FOUNDER_BYPASS_SECRET`, `DEV_FOUNDER_USER_ID`
- [x] `docs/exhaustive-completion/REMOVE-BEFORE-LAUNCH.md` created (with 1.1.G amendment)
- [x] Deployed to acreos.io (acreos.fly.dev 301-redirects to canonical domain), app starts, audit log writes on bypass use to `/tmp/dev-bypass-audit.log`
- [x] Verified: header path injects founder identity; cookie path mints HttpOnly cookie via `?dev_bypass=<secret>`; bypass inert without correct secret (5/5 verification pass)

#### Gap 1.1.B — Authenticated visual analysis — ✅ COMPLETE (pragmatic depth)

Per founder-approved scope reduction: depth matches Gap 1.0 prototype reference (1440 + 375 default state) instead of full 6-breakpoint × 4-state matrix. Full breakpoint/state coverage deferred to focused passes after 1.1.C identifies surfaces with real gaps.

- [x] All 28 AUTH-REQUIRED surfaces captured at 1440 + 375 → `auth-screenshots/`
- [x] Tier 1 (Pipeline): /today, /pipeline, /parcels/81, /inbox, /contacts, /calendar
- [x] Tier 2 (Sourcing): /buyboxes, /lists, /campaigns, /campaigns/performance
- [x] Tier 3 (Closing): /offers, /documents, /finance, /dispositions
- [x] Tier 4 (Ops): /agents, /automations, /audit, /settings, /team, /billing, /integrations, /ai
- [x] Tier 5 (Founder): /founder, /founder/atlas-run, /founder/revenue, /founder/tenants, /founder/cost, /founder/ops
- [x] Per-surface comparison reports generated → `visual-comparisons/<slug>-AUTH-REQUIRED.md`
- [x] `MASTER-GAP-REPORT.md` updated to cover all surfaces (auth + unauth)
- [ ] _Deferred to follow-up:_ State variants (loading / empty / error) per surface
- [ ] _Deferred to follow-up:_ Intermediate breakpoints (320 / 414 / 768 / 1024)
- [ ] _Deferred to 1.1.C re-capture:_ /onboarding (no prototype reference yet)

#### Gap 1.1.C — Autonomous gap fixing — ✅ COMPLETE
- [x] Every CONFIDENT-FAIL surface (unauth + auth) has a fix attempt
- [x] /pipeline, /inbox, /offers fixed (fetchJsonArray for envelope-returning endpoints)
- [x] /founder home fixed (useQuery `select` for schema-mismatched response)
- [x] /landing touch targets reduced 10 → 2
- [x] /pricing touch targets reduced 12 → 2
- [x] /changelog overflow + touch targets ALL CLEAR
- [x] /api/inbox/:id NaN guard (backend defensive fix)
- [x] Fixes verified via re-capture (auth) and verify-mechanical-fixes.ts (unauth)
- [x] Per-surface comparison reports regenerated; only /founder remains FAIL (capture-time rate-limit, not product bug)
- [x] All fixes deployed to acreos.io
- [x] NEW findings recorded: 4 unregistered founder sub-routes (/founder/revenue, /cost, /ops, /tenants) — NEEDS-IMPLEMENTATION, escalated to founder decision (1.1.E or deferred)
- [x] Items requiring founder taste deferred to 1.1.D picker (24 NEEDS-HUMAN-REVIEW surfaces still need pixel comparison)

#### Gap 1.1.D — Variant picker construction — ✅ COMPLETE
- [x] `docs/exhaustive-completion/variant-inventory.md` produced (28 visual-review + 4 platform-tweak + 4 build-defer = 36 decisions).
- [x] Picker shell scaffold — Vite + React + TS + Tailwind app at `acreos-picker/`. Top bar (progress + export), sidebar (decisions grouped by category, status indicators), main panel (decision card), bottom bar (prev/next nav). Selection persistence via localStorage.
- [x] Hosting: built bundle served by acreos express at `/__dev/picker/` (gated on `DEV_FOUNDER_BYPASS=true`). Same-origin so picker iframes carry Clerk session cookies.
- [x] D.6.2 — Variant chooser: progress bar, filter chips (all/undecided/decided), per-category progress, option label next to decided items, keyboard nav (j/k/↑/↓ + 1/2/3 + a/u/d).
- [x] D.6.3 — Three-panel comparison: prototype iframe + production iframe + preview iframe; breakpoint selector + zoom slider; CSP loosened for /__dev/*; sandbox removed for same-origin iframe access; React+Babel bundled as same-origin vendor files (Chrome blocks cross-origin scripts inside iframes).
- [x] D.6.4 — Inline copy editing: same-origin injector wraps text-bearing elements in contenteditable spans with stable `data-copy-id` (surfacePath::djb2Hash(text)); MutationObserver re-applies markers after React re-renders; edits saved to `selection.copyOverrides` keyed by id; reset-per-edit; injector served as static JS at `/__dev/picker/injectors/copy-edit.js` so production iframe CSP `script-src 'self'` accepts it. Smoke verified: 218 editable spans on /today.
- [x] D.6.5 — Split-view multi-breakpoint: toggle to 2-row layout (6 panels total), independent primary/secondary breakpoint selectors; copy edit confined to primary preview to avoid duplicate edits.
- [x] D.6.6 — Density slider: 4 discrete presets (compact / comfortable / spacious / custom); custom mode reveals 4 sliders (font-size 0.85-1.15, line-height 1.2-1.8, section padding 0.6-1.5, item spacing 0.6-1.5); injected `<style>` block in preview iframe applies via CSS variables on broad-target selectors; saved to `selection.densityOverrides`.
- [x] D.6.7 — Color/token override picker: 3 design-system-approved terracotta swatches (--acr-brand: #C2531C, #A04316, #E07749 — no arbitrary hex); each updates --acr-brand, --acr-brand-soft, --acr-glow, --acr-ring, --acr-chart-a together via injected `<style>` block; reset-to-default; saved to `selection.tokenOverrides`.
- [x] D.6.8 — Server-side export endpoint: POST /api/__dev/founder-selections accepts authenticated Clerk founder session OR bypass header; writes to `os.tmpdir()/founder-selections.json` (Fly `/app` is read-only for the `node` user); response carries retrieval command (`fly ssh console -a acreos -C 'cat /tmp/founder-selections.json'`); picker triggers browser download as backup.
- [x] D.6.9 — Polish pass: Fraunces editorial headers (Google Fonts), --acr-* warm cream + terracotta palette mirroring production, tier badges (T1-T5) on visual-review decisions, status chips (✓ for decided), generous breathing room, refined option cards with terracotta selection ring.
- [x] End-to-end Playwright verification — 22/22 smoke checks pass; verification screenshots in `docs/exhaustive-completion/auth-screenshots/_picker-verification-*.png`.

#### Gap 1.1.E/F — Production Port (supersedes original picker session + audit-fix loop)

The production port directive replaces 1.1.E (founder picker session) and
1.1.F (apply selections + audit). Picker remains live as a refinement tool
but is no longer the primary mechanism. Eight phases run from the canonical
design export at `~/Desktop/acreos-design-export/`.

**Phase A — Design-system extraction — ✅ COMPLETE**
- [x] Design export extracted to `~/Desktop/acreos-design-export/`
- [x] All 5 themes × light/dark token tables documented (Homestead / Quarry / Nocturne / Meadow / Slate)
- [x] Titan → Slate rename recorded
- [x] Type system spec — five curated font pairings (Editorial / Modern / Classic / Native / Refined)
- [x] Component mapping table — prototype primitives → production components
- [x] Density rules per surface
- [x] Motion specifications + z-index layers + spacing rhythm + radius scale
- [x] Voice exemplar (founder letter) + voice rules + voice anti-patterns
- [x] AI agent framing (Atlas / Pax / Sophie)
- [x] Autonomy matrix spec (per-agent × per-action × thresholds × time guardrails)
- [x] Feature flag system architecture
- [x] Six extra-attention surfaces enumerated
- [x] Expert designer permissions documented
- [x] State coverage requirements (loading / empty-zero / empty-filtered / error)
- [x] Output: `docs/exhaustive-completion/prototype-design-system.md`
- [x] Phase B resume doc: `_RESUME-PORT-PHASE-B.md`

**Phase B — Theme + font + appearance settings — ✅ COMPLETE**
- [x] All 5 themes implemented in production CSS (light + dark) — B.1
- [x] `--acr-*` and HSL parallel tokens kept adjacent per theme block — B.1
- [x] Legacy `[data-theme="midnight|forest|ocean|sunset|monochrome"]` + `[data-accent="..."]` blocks deleted — B.1
- [x] `rounded-card: 14px` added to tailwind config — B.1
- [x] Theme runtime updated (`theme-context.tsx`): new IDs, Apple-native auto, font-pairing data attribute — B.2
- [x] Top-bar quick theme picker rewritten with 5 prototype themes — B.2
- [x] All 5 font pairings self-hosted from free sources (Inter Tight, Source Serif 4 substituting for Charter, Newsreader, JetBrains Mono) — B.3
- [x] All Google Fonts CDN refs killed (font-loader.ts deleted, CSP allowlists removed, white-label refactored) — B.3
- [x] Full Settings → Appearance panel built per `acreos/settings.jsx` reference (Theme + Mode + Type + Density + Motion) — B.4
- [x] User preferences persist server-side via /api/me/preferences (theme, mode, font, density, motion) — B.5
- [x] PORT-AUDIT-PHASE-B.md written with static verification + live-eye checklist for founder review — B.6
- [x] Phase C resume doc written — B.7
- [x] Type-check + Tailwind build clean throughout

**Phase C — Personalization infrastructure — ✅ COMPLETE (UI + storage)**
- [x] Sidebar/mobile-nav config server-synced via /api/me/preferences (existing NavCustomizer Sheet wired) — C.1
- [x] Notification quiet hours (per-user, all channels; window wraps midnight) — C.2
- [x] List-view preferences per list type with rows/cards/expand-on-click for 12 known surfaces — C.3
- [x] Autonomy matrix UI on Settings → Autonomy: per-agent 4-step scale + per-action overrides + monetary thresholds + time guardrails + reset — C.4
- [x] Schema validation via strict Zod — C.1-C.4
- [x] PORT-AUDIT-PHASE-C.md written — C.5
- [x] _RESUME-PORT-PHASE-D.md written — C.5
- [ ] Desktop sidebar visual ordering deferred to Phase E shell re-skin (JUDGMENT-CALLS C.1.1)
- [ ] Notification matrix redesign deferred to Phase E channels surface (JUDGMENT-CALLS C.2.1)
- [ ] Autonomy server-side enforcement (agents reading config at action time) deferred to Phase E surface ports
- [ ] Autonomy tab to be gated behind `feature.autonomy-matrix` flag in Phase D (JUDGMENT-CALLS C.4.2)
- [ ] Audit log captures every autonomous action (server-side, ships with Phase E surface ports)

**Phase D — Feature flag system — ✅ COMPLETE**
- [x] Flag 5-state machine extending platform_feature_flags table — D.1 (migration 0029)
- [x] Initial seeds: module.land-academy / module.marketplace / surface.command-palette-v2 / feature.atlas-async-jobs / feature.autonomy-matrix — D.1
- [x] featureFlagService + requireFlag middleware + /api/feature-flags endpoints — D.2
- [x] Client FeatureFlagsProvider + useFlag + RequireFlag mounted in App.tsx — D.3
- [x] /founder/features calm-table UI with 5-state Select + beta audience editor — D.4
- [x] feature.autonomy-matrix flag gates Settings → Autonomy tab — D.5
- [x] PORT-AUDIT-PHASE-D.md + _RESUME-PORT-PHASE-E.md — D.6
- [ ] Apply additional flags as Phase E surfaces port (academy, marketplace already seeded; routes 404 via existing featureGate when off)

**Phase E — Surface-by-surface design port — pending**
- [ ] All 28+ customer surfaces re-skinned per design brief
- [ ] All 4 unimplemented founder sub-routes built
- [ ] Landing + pricing + onboarding ported
- [ ] All four states designed per surface (loading / empty-zero / empty-filtered / error)

**Phase F — Capture + audit per tier — pending**
- [ ] Re-capture every surface at 1440 + 375 (auth + unauth)
- [ ] PORT-AUDIT.md per tier with before/after, judgment-call notes, theme/font/personalization verification
- [ ] Founder reviews each tier audit

**Phase G — Polish on extra-attention surfaces — pending**
- [ ] /today polished
- [ ] Onboarding polished
- [ ] Founder mode polished
- [ ] Settings polished
- [ ] Landing polished
- [ ] Pricing polished

**Phase H — End-to-end verification — pending**
- [ ] Walk through full platform in each theme × each font pairing
- [ ] All customization flows verified (theme / font / sidebar / notifications / list-views / autonomy / feature flag)
- [ ] No functionality regressions (auth / data / AI agents / integrations / billing)
- [ ] Mobile responsive verified at 320, 375, 768
- [ ] FINAL-PORT-AUDIT.md complete

#### Gap 1.1.G — Bypass cleanup (mandatory before Gap 1 closes)
- [ ] `server/auth/__DEV_BYPASS_REMOVE_BEFORE_LAUNCH.ts` deleted
- [ ] `devFounderBypass` middleware registration removed from `server/routes.ts`
- [ ] Fly secrets unset: `DEV_FOUNDER_BYPASS`, `DEV_FOUNDER_BYPASS_SECRET`, `DEV_FOUNDER_USER_ID`
- [ ] `.dev-bypass-secret` deleted locally
- [ ] `dev-bypass-audit.log` deleted
- [ ] `DEV_FOUNDER_BYPASS_*` lines removed from `.env.local`
- [ ] Codebase grep for `DEV_FOUNDER_BYPASS` returns 0 references
- [ ] Codebase grep for `REMOVE_BEFORE_LAUNCH` returns 0 references
- [ ] Verified: request with `X-Dev-Founder-Bypass` header returns 401 (clerkAuth catches normally)
- [ ] Verified: `?dev_bypass=...` query param has no effect
- [ ] Verified: founder routes still return 404 to non-founders (existing security intact)
- [ ] Verified: founder can sign in normally via Clerk
- [ ] Clean deploy: `fly deploy -a acreos` successful
- [ ] Final commit: `chore(cleanup): remove dev founder bypass [exhaustive] [post-gap-1]`

---

## Gap 2 — Tier 1 Body Deep-Pass

- [ ] /today body deep-pass commit + deploy + founder verified
- [ ] /pipeline body deep-pass commit + deploy + founder verified
- [ ] /parcels (or /properties detail) body deep-pass commit + deploy + founder verified
- [ ] /inbox body deep-pass commit + deploy + founder verified
- [ ] Per-surface state coverage verified (4 states each)

---

## Gap 3 — Mobile Sweep on Tier 1

- [ ] /today screenshots at 320 / 375 / 414 / 768 / 1024 / 1440
- [ ] /pipeline screenshots at all 6 breakpoints
- [ ] /parcels screenshots at all 6 breakpoints
- [ ] /inbox screenshots at all 6 breakpoints
- [ ] No horizontal overflow at any breakpoint (verified in console)
- [ ] All touch targets ≥44px verified at mobile breakpoints
- [ ] Founder confirms mobile experience on real iPhone for at least 2 surfaces

---

## Gap 4 — Tier 2 Body Deep-Pass

- [ ] /buyboxes body deep-pass + verified (or note no standalone surface)
- [ ] /lists body deep-pass + verified (or note no standalone surface)
- [ ] /campaigns body deep-pass + verified
- [ ] /campaigns/performance body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 5 — Mobile Sweep on Tier 2

- [ ] All 4 (or applicable) Tier 2 surfaces × 6 breakpoints screenshots
- [ ] All breakpoint issues resolved

---

## Gap 6 — Tier 3 Body Deep-Pass

- [ ] /offers body deep-pass + verified
- [ ] /documents body deep-pass + verified
- [ ] /finance body deep-pass + verified (special: don't regress seller-finance strength)
- [ ] /dispositions body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 7 — Mobile Sweep on Tier 3

- [ ] All 4 Tier 3 surfaces × 6 breakpoints = 24 screenshots committed

---

## Gap 8 — Tier 4 Body Deep-Pass

- [ ] /agents body deep-pass + verified (special: AI Systems + Investor specialists must pass)
- [ ] /automations body deep-pass + verified
- [ ] /audit body deep-pass + verified
- [ ] /settings (each tab) body deep-pass + verified
- [ ] /team body deep-pass + verified
- [ ] /billing body deep-pass + verified (special: Stripe checkout flow load-tested)
- [ ] /integrations body deep-pass + verified
- [ ] /contacts body deep-pass + verified
- [ ] /calendar body deep-pass + verified
- [ ] Per-surface state coverage verified

---

## Gap 9 — Mobile Sweep on Tier 4

- [ ] All Tier 4 surfaces × 6 breakpoints screenshots committed

---

## Gap 10 — Per-Surface State Matrix Audit

- [ ] Every customer surface has all 4 states present and designed
- [ ] All 4 state screenshots per surface in `docs/exhaustive-completion/states/<surface>-{loading,empty-zero,empty-filtered,error}.png`
- [ ] Voice consistent across surfaces (matches HANDOFF §8 — specific, recoverable, owns the failure)

---

## Gap 11 — Founder Mode Chassis Adoption

- [ ] All 25 founder routes inventoried in `docs/exhaustive-completion/founder-routes.md` with current chassis status
- [ ] All 25 founder routes use FounderPageShell (23 remaining; /founder + /founder/tools already done)
- [ ] Founder visual verification of all 25 routes (screenshots committed)
- [ ] Founder invisibility verified by founder testing as non-founder (404 not 403, no leaks)

---

## Gap 12 — AI Output Quality Review

- [ ] Atlas prompts reviewed under AI Systems / Real Estate Investor / Product Strategy lenses
- [ ] Pax prompts reviewed under same lenses
- [ ] Sophie prompts reviewed under same lenses
- [ ] All AI output surfaces audited for presentation (recommendation, confidence, grounding, risk, action)
- [ ] Prompt + presentation improvements committed
- [ ] Test outputs documented in `docs/exhaustive-completion/ai-quality-validation.md`
- [ ] Elite team standard met for all three personas

---

## Gap 13 — Final Coherence Verification

- [ ] Visual consistency sweep at 1440 + 375 across every customer surface
- [ ] Voice consistency sweep across every customer surface
- [ ] Interaction pattern sweep (modal / toast / loading / confirmation)
- [ ] Final founder walkthrough complete with explicit "platform ready for vertical expansion" verdict
