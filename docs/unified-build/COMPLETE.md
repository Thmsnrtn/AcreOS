# Unified Build — Complete

> Phase 10 handoff document. The completion record for the v3 unified build,
> what shipped to production, what was deferred, and how to extend.

**Production URL:** https://acreos.io
**Build branch:** `main`
**Final phase deploy:** GH Actions run `24963944873` (post-Founder chassis)
**Total commits to this build:** 25+ tagged `[unified-build]` since `64312e2`
**Run mode:** Fully autonomous through Phase 10 (operator authorized).

---

## What shipped

### Phase 0 — Prerequisites ✅
- Rollback tag `pre-unified-build` at commit `2b8fe93` (pushed)
- Pre-flight extraction commit `8a55b3a` — `/acreos/`, `/acreos-landing/`, `/acreos-onboarding/`, `/handoff/` all in repo

### Phase 1 — Foundation ✅
- 41 namespaced `--acr-*` CSS tokens (homestead light/dark) in `client/src/index.css`
- Matching Tailwind utilities in `tailwind.config.ts`
- Globals architecture (Zustand modal store, sound hook, tour-state hook, toast lib)
- Founder mode server-side identity check (404, not 403, to non-founders)
- `useFlags` feature-flag infrastructure (audit-only at this build)

### Phase 2 — Tier 0 Shell ✅ (deployed)
- Sidebar tour anchors (`data-tour-nav` × 9 desktop + 10 mobile)
- Visible search trigger on 3 surfaces (desktop expanded/collapsed/mobile drawer), 44px touch targets
- `acreos:open-command-palette` CustomEvent listener
- Toast host audit + close
- Command palette audit + programmatic open
- Keyboard shortcuts audit + close
- Deploy + Playwright MCP smoke (live at acreos.io)

### Phase 2A — Visual Revisit + Public Surfaces ✅ (deployed)
- 2A.1 Sidebar visual treatment (commit `1bca3f3`) — left-pip active state per prototype
- 2A.2 Tier 0 visual: palette + toaster (commits `7309858`, `8d6862e`)
- 2A.3 Public landing — all 11 prototype sections + homestead nav (commits `fcb1143` through `8e53c1b`)
- 2A.4 Public onboarding — full-viewport `.ob` shell, all 5 production steps with editorial treatment (`379e3c2`, `79b2bdd`, `ebed41a`)
- 2A.5 Deploy + smoke (run `24961611010` green)

### Phase 3 — Tier 1 Pipeline Core ✅ first-pass deployed
- 3.1 Today (Command Center): editorial hero + 5-col `.acr-cc-metrics` strip (`705023f`, `ce57920`)
- 3.2 Pipeline: editorial header (`ff3bbb1`)
- 3.3 Properties (Parcel listing): editorial header (`6bafba5`)
- 3.4 Inbox: editorial header (`6bafba5`)
- 3.5 Deploy + smoke (run `24962048731` green)

### Phase 4 — Tier 2 Sourcing ✅ first-pass
- 4.1 Marketing hub (Campaigns) editorial header
- 4.2 Leads CRM editorial header
- (Buy Boxes / Campaign Performance — production has no standalone surfaces; concerns embedded in Campaigns + Leads + Analytics)

### Phase 5 — Tier 3 Closing ✅ first-pass + modals
- 5.1 Offers editorial header
- 5.2 Deals editorial header
- 5.3 Quick Offer modal + ⌘O keyboard shortcut + sidebar trigger with `data-tour="quick-offer"` (`3dd294d`)
- 5.4 Lost Reason modal — 8 canned reasons + free-text note
- 5.5 Deal Closed Celebration modal — italic Fraunces title, brand sparkle icon, ledger CTA

### Phase 6 — Tier 4 Ops ✅ first-pass + preferences
- 6.1 Finance editorial header
- 6.2 Settings editorial header
- 6.3 Settings → Appearance → Preferences card with sound-effects toggle (off by default, respects `prefers-reduced-motion`) and Replay-tour button (`7b0d070`)

### Phase 7 — Tier 5 Founder Mode ✅ chassis + canonical demo
- 7.1 `<FounderPageShell>` chassis component with editorial header + filters + actions slots
- 7.2 Applied to `/founder` (FounderHome) as canonical demonstration
- 7.3 25 founder routes inventoried; remaining 24 can adopt incrementally without phase blocking

### Phase 8 — Coverage Pass ✅ shared chassis + 4 pages
- `<CoveragePage>` shared chassis in `client/src/pages/coverage-page.tsx`
- NotFoundPage (404) — homestead-styled, replaces legacy not-found
- ServerErrorPage (500) — used by ErrorBoundary, voice per HANDOFF §8 (no "something went wrong")
- ForbiddenPage (403)
- MaintenancePage
- ErrorBoundary upgraded to render ServerErrorPage with quiet error-id debug strip (`a5c9dbc`)

### Phase 9 — Final Coherence ✅ key gaps reconciled
- 9.1 Fraunces + Inter self-hosted (`00ffbbe`) — fixes Phase 2A.5 smoke gap; Google Fonts ERR_FAILED no longer affects landing
- 9.2 Voice consistency — every editorial header across 10 surfaces follows the same eyebrow + Fraunces serif greeting + soft trailing clause pattern
- 9.3 Modal pattern consistency — all 3 modals reuse shadcn Dialog primitives + homestead palette tokens
- (See "Deferred" section below for remaining 9.x audit work)

### Phase 10 — Handoff ✅ this document
- `docs/unified-build/COMPLETE.md` (this file)
- `docs/unified-build/_progress.md` reflects shipped state
- `docs/unified-build/_RESUME-HERE.md` updated for any future continuation

---

## Architecture summary for new contributors

**Design tokens** live in `client/src/index.css` under `:root` and `.dark`. All 41 are namespaced `--acr-*` so they don't conflict with shadcn's HSL system. Tailwind utilities (`bg-acr-bg`, `text-acr-ink`, `border-acr-line`) are wired in `tailwind.config.ts`.

**Typography** is Fraunces (serif display, italic for editorial moments) + Inter (sans body) + JetBrains Mono (numerics). Self-hosted at `/fonts/*` — see `client/src/fonts.css`.

**Globals architecture** (replaced prototype `window.*`):
- `useModals()` — Zustand store at `client/src/stores/modal-store.ts` (Quick Offer, Lost Reason, Deal Closed)
- `useSound()` — `client/src/hooks/use-sound.ts` (off by default, respects reduce-motion)
- `useTour()` — `client/src/hooks/use-tour.ts` (7-step guided tour, localStorage persistence today, server-backed in future)
- `useToast()` — wraps Radix toast (existing infrastructure, kept)

**Page shells:**
- `<PageShell>` — generic auth shell with sidebar + topbar
- `<FounderPageShell>` — `<PageShell>` + editorial header for founder dashboards
- `<CoveragePage>` — full-viewport meta-page chassis (404/500/403/maintenance)

**Visual application pattern** (Visual Application Mandate, v3 §40):
1. Read prototype source `/acreos/<file>.jsx` or `/acreos-landing/` or `/acreos-onboarding/`
2. Translate `var(--brand)` → `var(--acr-brand)` (drop the prototype's leading `--`)
3. Port to colocated `.css` file (e.g. `client/src/pages/today.css`)
4. Refactor JSX in incremental commits
5. Add prototype-reference comment at top of file

**Editorial header pattern** (used on all 10 customer surfaces):
```tsx
<div className="acr-cc-hero">
  <div>
    <div className="acr-eyebrow">{section}</div>
    <h1 className="acr-cc-greeting">
      {datapoint}
      <span className="acr-cc-greeting-soft"> {soft trailing clause}.</span>
    </h1>
  </div>
</div>
```

---

## What was deferred (and why)

### Body-section deeper-pass styling on Tier 1–4 surfaces
The first-pass headers established the visual identity but the body sections (deal tables, AI suggestion cards, activity feeds, list rows, conversation panes) still use existing production styling. **Why deferred:** body work is per-surface and high-volume; the editorial-header pass was higher-leverage to ship first. **Next step:** pull from the deferred-list in `_RESUME-HERE.md` one section per commit.

### Per-surface mobile breakpoint testing at 320/375/414/768/1024/1440
Spot-checked at 375 only during smoke. **Next step:** Phase 9.1 visual consistency audit via Playwright MCP screenshot diffs at all 6 breakpoints.

### Founder dashboard adoption beyond /founder
The chassis is built and proven on /founder. Other 24 founder routes can adopt `<FounderPageShell>` incrementally. **Why deferred:** these are internal-only; not customer-facing.

### AI output quality review (Specialist #5 + #6)
HANDOFF §6 mentions Atlas/Pax draft quality as a bar but the model prompts live server-side and weren't touched in this visual-revisit build.

### Onboarding/tour state server persistence
`use-tour.ts` and `use-sound.ts` use localStorage today. The hook surface is locked, so the swap to `user.tourState` / `user.preferences` server endpoints can land later without consumer changes.

### Real Quick Offer wiring
The modal exists and `useModals().openQuickOffer()` opens it. Auto-opening from a deal's status-change is left as a separate enhancement when the deal-stage UI is being polished — generic auto-open from bulk-stage-update would surprise users.

### Demo click-through script (HANDOFF §12) automation
The 12-step demo script is a manual smoke aid. Automating it as a Playwright suite is a Phase 11 enhancement.

---

## How to extend

**Adding a new editorial-header surface:**
1. Add `import "./today.css";` to the page (today.css holds the `.acr-cc-hero` / `.acr-eyebrow` / `.acr-cc-greeting` rules)
2. Wrap the header section per the pattern above
3. Type-check + commit

**Adding a new modal:**
1. Add the open/close pair to `client/src/stores/modal-store.ts`
2. Build the modal component in `client/src/components/modals/`
3. Register it in `client/src/components/modals/index.ts` `<DealModalsHost />`

**Adding a new founder dashboard:**
1. Wrap the page in `<FounderPageShell eyebrow="..." title="..." titleSoft="..." />`
2. Compose body with Cards / tables / charts using shadcn primitives + `--acr-*` tokens

**Adding a new coverage / meta page (legal, etc.):**
1. Use `<CoveragePage>` from `client/src/pages/coverage-page.tsx`
2. Pass icon + eyebrow + title + description + primaryAction (+ optional secondaryAction)

---

## Vertical expansion readiness

Per v2/v3 vertical-expansion guidance (`UNIFIED-BUILD-PROMPT.md` §510):

- ✅ Design system is the contract — all surfaces use `--acr-*` tokens; no per-vertical token forks
- ✅ Components extend via props/variants — no `LandDealCard` vs `NoteDealCard` patterns introduced
- ✅ Vertical-specific surfaces use shared layout grammar (`<PageShell>`, `<FounderPageShell>`, editorial header)
- ✅ Voice is universal — homestead "letter" tone shipped across all 10 customer surfaces
- ⚠️  Mobile patterns: spot-checked, not fully audited at 6 breakpoints

**Vertical fit (carried from v2):**
- Strong fit: Wholesaling, Fix & Flip, Buy & Hold SFR, Note Investing
- Strain: Short-Term Rental, Multifamily/Commercial, Tax Deed/Tax Lien
- (See v2 for full details — vertical-specific work is the next handoff after this build.)

---

## Pinned facts (for future sessions)

- Production URL: https://acreos.io
- Founder Clerk user ID: `user_3CK2u6pGH7EYHgFyMS99fwhLSM7`
- Rollback tag: `pre-unified-build` at `2b8fe93` (pushed)
- Stash recovery SHA (one-time, only if operator asks): dangling commit `bd9d6af`
- Pre-existing 10 baseline test failures (calendar drift + DB-dependent + nested zod + leadScoring import) — exempt and documented in deploy gate annotations
- Onboarding state lives at `organizations.onboardingCompleted/Step/Data` (org-scoped, NOT `user.onboardedAt`)
- Canonical customer onboarding surface: `client/src/components/onboarding/OnboardingWizard.tsx`

---

## Commit log (sample, last 25)

Run `git log --oneline --grep "\[unified-build\]"` for the full set.

```
3626221 feat(founder): chassis + apply to founder home
a5c9dbc feat(coverage): homestead 404 / 500 / 403 / maintenance pages
7b0d070 feat(settings): sound effects toggle + replay-tour button
3dd294d feat(modals): Quick Offer + Lost Reason + Deal Closed
00ffbbe fix(typography): self-host Fraunces + Inter (Phase 9 fidelity gap)
cbe8588 chore(unified-build): tier 2/3/4 first-pass deployed
3adc075 feat(offers,finance,deals,settings): homestead editorial headers
522f2b2 feat(campaigns,leads): homestead editorial headers
2390c23 chore(unified-build): tier 1 first-pass deployed
6bafba5 feat(properties,inbox): homestead editorial headers
ff3bbb1 feat(pipeline): homestead editorial header
ce57920 feat(today): homestead hero + metric strip
705023f chore(today): port homestead command-center CSS
ad32cae chore(unified-build): phase 2a deployed; resume → phase 3
3de9356 chore(unified-build): 2A.4 closed locally; 2A.5 deploy gate doc
ebed41a feat(onboarding): per-step homestead treatment
79b2bdd feat(onboarding): homestead shell — Dialog → .ob layout
379e3c2 chore(onboarding): port homestead CSS shell + resume doc fix
7bfe711 chore(unified-build): nav landed; resume points at 2A.4 onboarding
8e53c1b feat(landing): homestead nav
fa37629 feat(landing): pricing + FAQ + final CTA + footer; legacy cleanup
9f1b8ab feat(landing): founder note section
a333639 feat(landing): quotes section
2c1ea95 feat(landing): features grid
e9dad98 feat(landing): day in the life section
```

---

## Final note

This build was scoped to land the Claude Design prototype's visual identity across the production codebase without sacrificing engineering refinement. The Visual Application Mandate (v3 §40) was the load-bearing principle: when prototype visual treatments conflicted with existing refined visuals, the prototype won; engineering refinement (a11y, mobile breakpoints, performance, code organization) was preserved everywhere it didn't conflict.

The result is a coherent visual identity across landing, onboarding, all four daily-driver surfaces (today / pipeline / properties / inbox), all four sourcing/closing surfaces (campaigns / leads / offers / deals), all two ops surfaces touched (finance / settings), the founder home, and the four coverage pages. Plus three deal-flow modals, a self-hosted typography stack, sound + tour preferences, and a founder chassis ready for the remaining 24 dashboards.

Anything left undone is documented above in **What was deferred (and why)** with a clear next step. The build is shippable as-is and extensible by the patterns in **How to extend**.

The next handoff is vertical expansion — see v2/v3 §510 for guidance, and the design system is ready for it.
