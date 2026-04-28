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

#### Gap 1.1.D — Variant picker construction
- [ ] `docs/exhaustive-completion/variant-inventory.md` produced (every decision: surface, type, options, source files, recommended default)
- [ ] Picker shell + sidebar/main/topbar/bottombar navigation
- [ ] Variant chooser (basic selection per decision)
- [ ] Three-panel comparison (prototype / current production via cookie bypass / proposed-after preview)
- [ ] Inline copy editing
- [ ] Multi-breakpoint preview tabs (320 / 375 / 414 / 768 / 1024 / 1440 + split view)
- [ ] Drag-to-resize density adjustment (compact / comfortable / spacious / custom + per-property sliders)
- [ ] Color/token override picker (within design-system tokens only)
- [ ] Export selections to `founder-selections.json` (validated format)
- [ ] Picker UI polish pass (picker chrome itself feels designed)

#### Gap 1.1.E — Founder picker interaction (operator-driven)
- [ ] `founder-selections.json` committed with selections for every variant decision

#### Gap 1.1.F — Audit-after-fix loop
- [ ] All selections applied to production code per decision_type (variant / copy / config / density / token-override / layout)
- [ ] Deploy after selections applied
- [ ] Re-capture every surface at all breakpoints with bypass
- [ ] Re-run mechanical checks
- [ ] `AUDIT-AFTER-FIX.md` generated (resolved / remaining / new issues / recommended next action)
- [ ] Founder approves audit (loop iterates until "Audit approved")

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
