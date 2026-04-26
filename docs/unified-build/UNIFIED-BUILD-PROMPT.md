# ACREOS UNIFIED BUILD — RESUME-CAPABLE MEGA PROMPT v3

This is the canonical build prompt. The /loop slash command runs a compact resume
body that points at this file. Fresh sessions can also re-paste this whole prompt
to bootstrap from scratch.

---

## Build Status (as of 2026-04-26)

**Run mode: fully autonomous through Phase 10 completion.** Operator has authorized auto-fire deploys, smoke tests, pushes, schema migrations. Loop ends only at 85% context (forces fresh session) or genuine unresolvable Gate B ambiguity. Default to picking the recommended option and continuing on visual judgment calls.

| Item | Status |
|---|---|
| Pre-flight extraction | ✅ commit `8a55b3a` (`/acreos/`, `/acreos-landing/`, `/acreos-onboarding/`, `/handoff/` all in repo) |
| Phase 0 — Prerequisites | ✅ rollback tag `pre-unified-build` at `2b8fe93` |
| Phase 1 — Foundation | ✅ tokens, globals, founder auth, flags |
| Phase 2 — Tier 0 Shell (structural) | ✅ deployed at https://acreos.io |
| Phase 2A.1 — Sidebar visual treatment | ✅ commit `1bca3f3` |
| Phase 2A.2-2A.5 — remaining visual revisit + public surfaces | ⏳ in progress |
| Phase 3+ | pending |
| Operator Gate A (FOUNDER_USER_IDS) | ✅ deployed (digest `890511d964d7abda`) |
| Production URL | https://acreos.io |
| Founder Clerk user ID | `user_3CK2u6pGH7EYHgFyMS99fwhLSM7` |
| Pre-existing user WIP recoverable from | dangling commit `bd9d6af` (`git stash apply bd9d6af`) |

---

## Course Correction (v2 → v3)

v2 produced commits that satisfied the structural intent of each phase but
**did not visibly land the prototype's design identity in production**. By the
end of Phase 2, the production app looked essentially identical to the
pre-build state.

Root cause: misreading "preserve all prior Claude Code refinement work" as
also preserving visual treatments. v3 corrects this with the Visual Application
Mandate below.

### Visual Application Mandate (CRITICAL)

The mega prompt's mission says BOTH:
1. Apply Claude Design's visual system (tokens, components, layouts, copy, interaction patterns)
2. Preserve all prior Claude Code refinement work (engineering quality, accessibility, performance, code organization)

These do not conflict. **"Preserve refinement work" applies to engineering quality, not visual treatment.** When the prototype's visual treatment conflicts with an existing refined visual treatment, **the prototype wins**.

What gets preserved (engineering refinement):
- Accessibility improvements (`aria-*` attributes, keyboard nav, focus management)
- Mobile responsiveness work (44px touch targets, responsive breakpoints)
- Performance optimizations (lazy loading, prefetch, query caching)
- Code organization (hooks, contexts, splitting)
- Test coverage
- Type safety
- Security patterns (auth gates, CSRF, etc.)

What gets replaced when the prototype specifies differently (visual treatment):
- Color palette application (use the homestead `--acr-*` tokens, not stale shadcn HSL)
- Active-state visual treatment (use prototype's left-pip on brand color, not Tahoe-capsule pill)
- Typography choices (display serif from prototype, not whatever the page header was using)
- Layout grammar and density
- Copy voice and tone
- Border, shadow, radius, spacing rhythm
- Motion durations and easing

**Concrete examples of corrections needed:**
- `client/src/index.css:704` `.nav-item-active` (rounded-full primary-tint pill) is engineering-quality work but visually wrong per prototype. Replace with the prototype's `acr-nav-item-active` (subtle background + 2px brand-color left pip).
- Sidebar background uses shadcn `--sidebar-background` HSL ≈ `#F4ECD9`; prototype specifies `--acr-sidebar-bg: #F1E7D0`. The two are close but not identical. Switch to the prototype value.
- Production landing page is unchanged from pre-build state. The prototype's landing in `/acreos-landing/` (large serif "Find motivated sellers. Send mail. Close deals.") has not landed. **This is the most visible surface — operators, beta users, investors see it first.** It must visibly look like the prototype.

---

## Per-Surface Fidelity Principle (unchanged from v2)

The Claude Design prototype is the authoritative visual specification for AcreOS. Not just a token source — the authoritative reference for layout grammar, information hierarchy, density, copy voice, and interaction patterns.

**Required workflow for every surface (Phases 2-8):**

1. Open the relevant prototype file(s) under `/acreos/`, `/acreos-landing/`, or `/acreos-onboarding/`
2. Read the prototype implementation completely (JSX structure + CSS strings)
3. Document the reference at the top of the production component file:
   ```tsx
   /**
    * Prototype reference: /acreos/<file>.jsx → <ComponentName>
    * Key patterns from prototype: <specific patterns>
    * Patterns extrapolated (not in prototype): <list any inventions>
    */
   ```
4. Implement matching the prototype's layout grammar, hierarchy, density, copy voice, interaction patterns, and mobile adaptation (extrapolated coherently)
5. Side-by-side compare to the prototype before commit

**Forbidden:**
- Building from extracted tokens only without reading the prototype file
- Generic shadcn defaults instead of prototype-specific styling
- Inventing patterns when the prototype has an answer
- Drift accumulation across surfaces

For surfaces without a direct prototype reference (Phase 8 Coverage Pass):
identify 2-3 closest analogs, read them completely, document the analogs in
the file comment, synthesize coherently.

---

## Loop Behavior (when invoked via /loop)

**Operator authorization (durable for this build):** the operator has explicitly authorized fully autonomous execution through Phase 10 completion. Do NOT pause for approval at phase boundaries, deploys, or Gate B visual ambiguity. The only legitimate end-loop conditions are context exhaustion (~85%) and Gate B ambiguity that genuinely cannot be resolved without operator input (rare — pick the recommended option, document the choice, and move on for everything reasonable).

The /loop fires self-paced. On each fire:

1. Read `docs/unified-build/_progress.md`
2. Read `docs/unified-build/_RESUME-HERE.md` if present
3. Continue from the documented next-action
4. After each meaningful unit of work, commit
5. ScheduleWakeup to keep going, unless one of the end conditions below is hit

**End the loop ONLY at:**
- 85% context approaching (mandatory — context exhaustion forces a fresh session)
- Genuine Gate B blocker: visual ambiguity or technical question where the prototype + handoff + reasonable defaults can't produce a confident choice. (Rare. Default behavior on ambiguity is: pick the recommended option, document in a `phase-X.Y-decision-<topic>.md` file, continue.)

**Auto-fire authorized (no operator pause):**
- `fly deploy -a acreos` after each phase's smoke test (mega-prompt mandates these; operator authorized them as part of the autonomous run)
- `git push origin main` to push commits
- Playwright MCP smoke tests against production after deploy
- npm install for dependencies the prototype requires
- Schema migrations via Drizzle when needed for new features
- Standard git operations: commit, branch, tag, push (NOT force-push or `reset --hard` to non-HEAD)

**Still requires explicit operator authorization (NOT auto-fire):**
- Force-push to main (rare; investigate root cause first)
- `git reset --hard` to a non-HEAD ref
- Deleting branches that contain unmerged work
- Modifying Fly secrets (operator manages these)
- Modifying Clerk dashboard config (operator manages)
- Deleting Stripe products/subscriptions (operator manages)
- External-account writes outside the AcreOS Fly app (Stripe live mode, Twilio, Lob — only via the app's own integrations, never directly to those accounts)
- Any git stash pop / apply unless the operator's stash is what's being recovered

**ScheduleWakeup delay:**
- 270s default for active mid-phase work (in-cache, fast iteration)
- 1200s if waiting for a deploy to fully propagate or an external state to settle
- 60s minimum (clamped by the runtime)

The 85% context guardrail is the build's natural break point. When that hits: commit, write `_RESUME-HERE.md` with the exact next action, end the loop. The operator re-invokes /loop in a fresh session and the build resumes.

---

## Resume Protocol

**On every fire, before doing any work:**

1. `git status` — must be clean. If not, investigate before any new commits.
2. `git log --oneline -5` — confirm the last commit is what `_progress.md` claims it is.
3. Read `docs/unified-build/_progress.md` for phase state.
4. Read `docs/unified-build/_RESUME-HERE.md` for the exact next action.
5. Skip phases marked `[x]`. Resume from the next `[ ]` or `[/]`.
6. If there's a Pre-flight extraction commit `8a55b3a` in `git log`, skip the entire pre-flight section.

**On significant progress, before ending or scheduling wakeup:**

1. Update `_progress.md` with what just landed and what's next.
2. Write `_RESUME-HERE.md` with detailed continuation instructions.
3. Commit progress files separately if needed.

---

## Operator Gates

### Gate A — FOUNDER_USER_IDS — ✅ CLEARED

`FOUNDER_USER_IDS=user_3CK2u6pGH7EYHgFyMS99fwhLSM7` is deployed on Fly.
No further action.

### Gate B — Critical visual ambiguity

If the prototype is genuinely ambiguous about a visual decision that meaningfully
affects platform feel:

```
⚠ VISUAL DECISION NEEDED

Context: <surface>
Ambiguity: <what's unclear>
Options:
A: ...
B: ...

Recommended: <option> because <reason>

Respond with: "Use option <X>" or "Different approach: <details>"
```

End the loop. Resume when operator responds.

---

## The Twelve Specialists (held continuously)

1. Senior Product Designer (Apple/Linear caliber)
2. Senior Mobile/Responsive Designer
3. Accessibility Engineer (WCAG 2.1 AA)
4. Senior Full-Stack Engineer (TypeScript, React, Vite, Tailwind, shadcn)
5. AI Systems Engineer
6. Multi-Vertical Real Estate Investor (20+ years, 3+ verticals)
7. Senior Copywriter (B2B SaaS specialty)
8. Infrastructure / SRE
9. Trust & Security Architect
10. Product Strategy Lead
11. Senior SaaS Pricing Analyst
12. AI Market Dynamics Analyst

Every commit must pass all twelve internally. Specialists #1 and #6 carry special weight on fidelity — they catch drift others miss.

---

## Founder Decisions (locked)

- **Mobile support at launch: YES** — full responsive 320–1440px, ≥44px touch targets
- **Founder mode: invisible to customers** — server-side identity check, 404 not 403
- **Sound effects: off by default** — toggle in Settings → Preferences; respect reduced-motion
- **Onboarding state: server-side via `user.onboardedAt`** — survives device switches
- **Tour state: server-side via `user.tourState`** — survives device switches

---

## Source Material — Read Fully Before Each Phase Touches a New Surface

The pre-flight already extracted everything. Open these as needed:

- `/handoff/HANDOFF.md` — Claude Design's complete handoff document; the spec source of truth
- `/handoff/GAPS.md` — known gaps and open questions
- `/acreos/theme.jsx` — design token literals (every token value)
- `/acreos/shell.jsx` — sidebar + topbar + frame + SHELL_CSS
- `/acreos/app.jsx` — switch statement and routing
- `/acreos/data.jsx` — frozen literals showing data shapes (replace with API)
- `/acreos/pages-tier1.jsx` — Command Center, Pipeline, Parcel Detail, Inbox
- `/acreos/pages-tier2345.jsx` — sourcing/closing/ops/founder pages
- `/acreos/onboarding.jsx`, `/acreos/guided-tour.jsx`
- `/acreos/command-center.jsx`, `/acreos/command-palette.jsx`
- `/acreos/settings.jsx`, `/acreos/pax.jsx`
- `/acreos/primitives.jsx`, `/acreos/round3-primitives.jsx`
- `/acreos/round3-css.jsx`, `/acreos/round3-integrations-css.jsx`
- `/acreos/tier-a.jsx`, `/acreos/tier-b.jsx`, `/acreos/tier-c.jsx`, `/acreos/tier-c-wire.jsx`
- `/acreos/v2.jsx`, `/acreos/round3-features.jsx`, `/acreos/round3-integrations.jsx`, `/acreos/round3-integrations-2.jsx`
- `/acreos-landing/` — full landing page prototype
- `/acreos-onboarding/` — full onboarding prototype
- `/handoff/recommended-tailwind.config.ts` — reference Tailwind config
- `/handoff/screenshots/` — visual comp screenshots

The supporting handoff docs referenced in HANDOFF.md (ROUTE_MAP, COMPONENT_MAP, TOKENS, GLOBALS_AUDIT, etc.) are NOT in the extraction — extract specifications from HANDOFF.md sections directly.

---

## Phase List

- [x] Pre-flight — extraction (`8a55b3a`)
- [x] Phase 0 — Prerequisites
- [x] Phase 1 — Foundation
- [x] Phase 2 — Tier 0 Shell (structural — anchors, search trigger, audit closes, deploy)
- [ ] **Phase 2A — Visual Revisit + Public Surfaces** ← NEXT
- [ ] Phase 3 — Tier 1 Pipeline Core (Command Center, Pipeline, Parcel Detail, Inbox)
- [ ] Phase 4 — Tier 2 Sourcing (Buy Boxes, Lists, Campaigns, Campaign Performance)
- [ ] Phase 5 — Tier 3 Closing (Offers, Documents, Seller Finance, Dispositions, Modals)
- [ ] Phase 6 — Tier 4 Ops (Agents, Automations, Audit, Settings, Team, Billing, Integrations, Contacts, Calendar)
- [ ] Phase 7 — Tier 5 Founder Mode (FounderHomeC, AtlasRunC, Tenants, Revenue, Cost, Ops, Vertical Control Plane)
- [ ] Phase 8 — Coverage Pass (404, 500, legal, password reset, etc.)
- [ ] Phase 9 — Final Coherence Pass (visual + voice + interaction audits)
- [ ] Phase 10 — Handoff Preparation (docs + vertical expansion readiness)

---

## Phase 2A — Visual Revisit + Public Surfaces (NEW in v3)

Course-corrects Phase 2's structural-only approach. Lands the prototype's
visual identity in the most-visible surfaces (sidebar shell + landing +
onboarding) before continuing into authenticated app surfaces.

### 2A.1 — Sidebar visual application (replace Tahoe-capsule with prototype treatment)

Read `/acreos/shell.jsx` Sidebar section + `SHELL_CSS` for `.acr-sidebar`,
`.acr-nav-item`, `.acr-nav-item-active`.

Apply to `client/src/components/layout-sidebar.tsx`:

- **Active state.** Replace `nav-item-active` (`client/src/index.css:704`) with the prototype's treatment: subtle `var(--acr-surface)` background, `box-shadow: var(--acr-shadow-1), inset 0 0 0 0.5px var(--acr-line)`, and a 2px-wide × 14px-tall brand-color pip positioned at left -10px via `::before`. Per prototype lines 195–203 of `acreos/shell.jsx`.
- **Sidebar background.** Switch from shadcn `bg-sidebar` to `bg-acr-sidebar-bg`. Keep the existing `--sidebar-*` shadcn tokens for any shadcn primitives that read them, but the sidebar component itself uses the homestead namespace.
- **Nav item type.** Match prototype: `font: 500 13px/1 var(--font-sans)`, `letter-spacing: -0.005em`. Currently `font-medium text-sm` (close but not identical).
- **Nav group title.** Match prototype's `font: 500 10.5px/1`, uppercase, `letter-spacing: 0.07em`, `color: var(--acr-ink-4)`.
- **Active item icon.** Per prototype, active items use brand color on the icon and the badge becomes brand-tinted (`var(--acr-brand-soft)` background, `var(--acr-brand)` text).
- **Spacing rhythm.** Sidebar padding `14px 10px` (currently `p-4 md:p-5` — adjust container).

Preserve (engineering refinement):
- All `aria-*` attributes
- `min-h-[44px]` mobile touch targets
- Mobile Sheet pattern
- White-label brand name resolution
- PaxNotificationBadge, NotificationCenter, ThemeToggle wiring
- Founder gating via `useAuth().isFounder`
- All `data-tour-nav` and `data-tour` anchors added in Phase 2.1/2.2
- The visible search trigger (Phase 2.2)

Update the prototype-reference comment in the file header to reflect what was changed.

Commit: `feat(shell): sidebar visual treatment per prototype [unified-build]`

### 2A.2 — Tier 0 visual application across remaining shell surfaces

Apply prototype palette and visual treatments to:
- `command-palette.tsx` — backdrop blur, `var(--acr-surface)` modal background, `var(--acr-shadow-3)`, group title styling per prototype's `.cp-group`, item active state per `.cp-item-active`. Add bottom keyboard-hint footer per prototype's `.cp-foot` (the fidelity gap logged in Phase 2.4).
- Toaster styling — semantic kinds use `var(--acr-pos)`, `var(--acr-warn)`, `var(--acr-neg)` tints
- `keyboard-shortcuts.tsx` modal — match prototype's typography density and serif headings

Each component keeps its prototype-reference header and lists what changed.

Commit: `feat(shell): visual application across tier 0 [unified-build]`

### 2A.3 — Public landing page (the most visible surface)

Source: `/acreos-landing/` — full prototype with `acreos-landing.html` entry.

Production landing lives at `client/src/pages/landing.tsx`. Read both fully
before starting.

The landing page's distinctive elements (per the prototype):
- Cream backdrop `var(--acr-bg)` with terracotta accents
- **Large serif display headline** — "Find motivated sellers. / Send mail. Close deals. / All in one place." with the middle line in italic brand-color serif
- "For solo investors, partners, and small teams" pill above headline (with brand-color dot)
- Side cards animated in (Atlas, Pax, Sophie) showing live agent activity
- "Start free trial" + "See how it works" button pair
- "14 days free · no card · cancel anytime" microcopy
- "In private beta with 12 land investors. $1.4M closed in 90 days." trust pill
- Top nav: How it works · The agents · Pricing · Why we built it · Sign in · Start free trial
- Sections: How it works · The agents · Day in the life · Features grid · Quotes · Founder note · Pricing · FAQ

Implement every visible section. Don't skip sections. Match copy voice exactly (the prototype copy is the canonical voice — it's the founder's voice).

Apply Per-Surface Fidelity Principle: open the prototype HTML in a browser
locally and compare side-by-side as you build.

Don't break the existing landing's working integrations (Clerk sign-in flow,
analytics, etc.). Preserve those as engineering refinement.

Commit per logical section:
- `feat(landing): hero + trust [unified-build]`
- `feat(landing): how it works section [unified-build]`
- `feat(landing): the agents section [unified-build]`
- `feat(landing): day in the life section [unified-build]`
- `feat(landing): features grid [unified-build]`
- `feat(landing): quotes + founder note [unified-build]`
- `feat(landing): pricing + FAQ + footer [unified-build]`

### 2A.4 — Public onboarding (the second most visible surface)

Source: `/acreos-onboarding/` — full prototype with `acreos-onboarding.html`
entry. Production onboarding lives at `client/src/components/onboarding/` and
`client/src/components/founder-setup-wizard.tsx`.

Per founder decisions, onboarding state is server-side via `user.onboardedAt`.
Verify this is wired (likely already is from Phase 1.3 plumbing).

Apply prototype visual identity to every onboarding step. Match the prototype's
step transitions, progress indicator style, illustrations/empty states, voice.

Commit per logical step or grouping.

### 2A.5 — Phase 2A deploy + smoke test

After 2A.1–2A.4 complete:

1. `npm run check` clean
2. `npm run build` succeeds
3. `npm test` — confirm no NEW regressions vs `pre-unified-build` baseline (10 known pre-existing failures: tax/cohort calendar drift, DB-required org-middleware/IDOR/stripe webhook, vitest picking up nested zod tests, leadScoring import error)
4. **Pause here for operator deploy authorization** — deploy is destructive shared infrastructure
5. After operator approval: `fly deploy -a acreos`
6. Playwright MCP smoke test against acreos.io:
   - Landing page renders with serif headline, cream backdrop, all sections
   - Sidebar (signed-in shell) shows new active-state treatment, homestead palette
   - Mobile (375px) renders landing + shell correctly
   - Console error scan
7. Update `_progress.md`, write Phase 2A close doc

Commit: `chore(unified-build): phase 2a visual revisit + public surfaces deployed [unified-build]`

---

## Phase 3 — Tier 1 Pipeline Core (with Per-Surface Fidelity)

The daily-driver loop. Apply Per-Surface Fidelity Principle to every surface.
Read prototype reference before each implementation. Document references in
file comments. Side-by-side verify before commit.

Per HANDOFF.md Section 2:
- Command Center (canonical: `CommandCenterC`)
- Pipeline (canonical: `Pipeline`)
- Parcel Detail (canonical: `ParcelDetailB`)
- Inbox (canonical: `InboxC`)

Each surface:
1. Implement with TypeScript, shadcn primitives, homestead Tailwind tokens
2. Replace data literals from `data.jsx` with Tanstack Query against real APIs
3. Implement all states: loading skeleton (matching final layout, not spinner), empty-zero (first-run with CTA), empty-filtered (explains the filter), error (recoverable with retry)
4. Build shared `<EmptyState>` and `<ErrorState>` design-system components on first need; reuse thereafter
5. Mobile responsive at 320/375/414/768/1024/1440 breakpoints
6. Tour anchors per HANDOFF.md Section 7
7. AI output quality (Atlas, Pax, draft replies) must pass Specialist #5 (AI Systems) + Specialist #6 (Real Estate Investor)

Commit per surface. Deploy + Playwright MCP smoke test at end of phase.

---

## Phase 4 — Tier 2 Sourcing

Buy Boxes (`BuyBoxes`), Lists, Campaigns, Campaign Performance (`CampaignPerf`).
Same workflow as Phase 3.

---

## Phase 5 — Tier 3 Closing

Offers, Documents, Seller Finance (note servicing — preserve as a strength),
Dispositions. Plus modals: Lost Reason, Deal Closed Celebration, Quick Offer.

The Quick Offer modal completes the ⌘N shortcut wiring deferred from Phase 2.5.
Add the visible Quick Offer trigger (with `data-tour="quick-offer"`) to the
sidebar header next to the search trigger from Phase 2.2 — same placement
treatment, same homestead palette.

---

## Phase 6 — Tier 4 Ops

Agents (`AgentWorkspace`), Automations, Audit Log, Settings (`SettingsC` —
includes the sound-effects toggle and Replay-tour button), Team, Billing
(extra verification — Stripe must not regress), Integrations, Contacts,
Calendar.

---

## Phase 7 — Tier 5 Founder Mode

`FounderHomeC`, `AtlasRunC`, `FounderTenants`, `FounderRevenueC`, `FounderCost`,
`FounderOps`, plus the Vertical Control Plane (Phase 1.4 founder dashboard
wired up fully).

After deploy, verify founder routes return 404 to non-founders, are not
mentioned in customer-visible navigation/search/command-palette, and work
correctly for the founder.

---

## Phase 8 — Coverage Pass

Walk every route in `client/src/`. Identify uncovered surfaces. Apply Per-Surface
Fidelity Principle for synthesized surfaces (2-3 closest prototype analogs,
documented in file comment).

Likely uncovered: legal pages, 404, 500, forbidden, maintenance, email
verification, password reset, niche empty/error states.

---

## Phase 9 — Final Coherence Pass

- 9.1 Visual consistency audit (Playwright MCP screenshot comparison desktop + mobile)
- 9.2 Voice consistency audit (read copy across surfaces, flag drift)
- 9.3 Interaction pattern audit (modals, toasts, loading, errors, focus on route change)
- 9.4 Final smoke test (every Tier 1-4 surface + founder routes + auth + AI surfaces)
- Reconcile fidelity gaps logged across earlier phases (e.g., Phase 2.4 palette gaps: placeholder copy, footer hints, max-width, chord shortcuts)

---

## Phase 10 — Handoff Preparation

- 10.1 Documentation (`docs/unified-build/COMPLETE.md`, README, component docs, design system docs, architecture docs)
- 10.2 Vertical expansion readiness check
- 10.3 Final handoff to operator

---

## Hard Scope Guardrails

Forbidden:
- Skipping testing gates
- Modifying engineering-quality refinement work (preserve)
- **Preserving visual treatments that conflict with the prototype** (NEW in v3 — the Visual Application Mandate overrides preservation)
- Building features not in the prototype or handoff (vertical-specific work waits for separate handoff)
- Compromising founder mode security (invisible to customers, identity-checked, 404 not 403)
- Skipping mobile verification per surface
- Single-commit application of multiple phases
- Deploying with NEW failing tests (the 10 baseline failures are exempt and documented)
- Pushing past 85% context without ending cleanly
- Building Phase 2-8 surfaces from extracted tokens only without reading the prototype file
- Generic shadcn defaults instead of prototype-specific styling decisions
- Inventing new patterns when the prototype has an answer
- Drift accumulation across surfaces
- Force-push to main, `reset --hard` to non-HEAD, deleting unmerged branches, modifying Fly secrets / Clerk / Stripe accounts directly (still require explicit operator authorization even under autonomous run)

Required:
- Atomic commits per logical unit
- `[unified-build]` tag on every commit
- Co-Authored-By trailer on every commit
- Update `_progress.md` after each phase
- Deploy and Playwright MCP smoke test after each major phase (with operator approval for the deploy step)
- Twelve-specialist internal review before each commit
- Mobile + desktop verification per surface
- Per-Surface Fidelity Principle applied for every surface in Phases 2-8
- Continuous reference back to the prototype source as the authoritative specification

---

## Coherent Design Adaptation Guidance (for future vertical expansion, not this build)

[Carried forward from v2 unchanged. Reference for the vertical expansion handoff after this build completes.]

1. The design system is the contract — every surface uses the same tokens. No vertical-specific token forks without explicit justification.
2. Components extend, they don't fork — use props/variants, not parallel `NoteDealCard` vs `LandDealCard`.
3. Vertical-specific surfaces use shared layout grammar.
4. Voice and tone are universal.
5. Mobile patterns are consistent across verticals.

Vertical fit evaluation (strong fit: Wholesaling, Fix & Flip, Buy & Hold SFR,
Note Investing; strain points: Short-Term Rental, Multifamily/Commercial,
Tax Deed/Tax Lien) — see v2 for full details.

This guidance is reference for the future vertical expansion handoff, not
the current unified build.

---

## Begin Resume

Read `docs/unified-build/_progress.md` and `docs/unified-build/_RESUME-HERE.md`,
then continue from the documented next-action.
