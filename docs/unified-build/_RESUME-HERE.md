# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity (rare — default to picking the recommended option, document in `phase-X.Y-decision-<topic>.md`, continue).

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.

## Where the build stands

Phase 0–2: ✅ deployed at https://acreos.io
Phase 2A.1 (sidebar visual): ✅ commit `1bca3f3` — homestead palette + brand-pip active state landed
Phase 2A.2 (palette + toaster): ✅ commits `7309858`, `8d6862e` — palette modal flat-surface treatment, warm-tinted backdrop, semantic toast kinds (success/warning/error tints)

## Next action: Phase 2A.3 — Public landing page

Source: `/acreos-landing/` (prototype, with `acreos-landing.html` entry point). Production landing lives at `client/src/pages/landing.tsx`.

This is the most visible surface on the platform — the one operators, beta users, investors, press see first. The current production landing is essentially unchanged from pre-build state; the prototype's distinctive identity has not landed.

**Before writing any code, read:**

1. Open `/acreos-landing/` directory and read every file. Note the .jsx component structure.
2. Open `acreos-landing.html` in a local browser tab to see the prototype rendered.
3. Read `client/src/pages/landing.tsx` (production current state) to understand what's there and what existing integrations to preserve (Clerk sign-in flow, analytics, etc.).
4. Note `handoff/screenshots/` for any landing-page comp screenshots if relevant.

**Distinctive prototype landing elements:**
- Cream backdrop `var(--acr-bg)` with terracotta accents
- **Large serif display headline** — "Find motivated sellers. / Send mail. Close deals. / All in one place." with the middle line in italic brand-color serif
- "For solo investors, partners, and small teams" pill above headline (with brand-color dot)
- Side cards animated in (Atlas, Pax, Sophie) showing live agent activity
- "Start free trial" + "See how it works" button pair
- "14 days free · no card · cancel anytime" microcopy
- "In private beta with 12 land investors. $1.4M closed in 90 days." trust pill
- Top nav: How it works · The agents · Pricing · Why we built it · Sign in · Start free trial
- Sections: How it works · The agents · Day in the life · Features grid · Quotes · Founder note · Pricing · FAQ

**Implementation approach:**

Build section by section, committing each as a logical unit. Match the prototype's copy voice exactly — the prototype copy IS the canonical voice (serious, considered, founder-written, not SaaS-cute).

Apply Per-Surface Fidelity Principle:
- Add prototype-reference header to `client/src/pages/landing.tsx` listing what was brought across
- Implement matching the prototype's layout grammar, hierarchy, density, voice, interaction patterns
- Mobile responsive (extrapolate consistently — the prototype is desktop-only)
- Side-by-side compare: open `acreos-landing.html` locally vs the production landing as you build

**Don't break:**
- Clerk sign-in flow (engineering refinement preserved)
- Existing analytics integrations
- Any A/B tests or feature flags currently wired
- SEO meta tags, structured data, OpenGraph

**Suggested commit cadence:**
- `feat(landing): hero + trust pills [unified-build]`
- `feat(landing): how it works section [unified-build]`
- `feat(landing): the agents section [unified-build]`
- `feat(landing): day in the life section [unified-build]`
- `feat(landing): features grid [unified-build]`
- `feat(landing): quotes + founder note [unified-build]`
- `feat(landing): pricing + FAQ + footer [unified-build]`

After 2A.3 lands, continue with 2A.4 (onboarding) then 2A.5 (deploy + smoke — auto-fire authorized).

## Loop guidance

After each commit:
- ScheduleWakeup 270s for in-cache iteration on the next section
- ScheduleWakeup 1200s if waiting on a deploy or external state
- End the loop ONLY at 85% context or unresolvable Gate B

When ending: write _RESUME-HERE.md with the exact next-section to implement, commit, end. Operator re-invokes /loop in fresh session and the build resumes.

## Hard reminders

- `[unified-build]` tag + Co-Authored-By trailer on every commit
- Visual Application Mandate: prototype wins on visual conflicts
- Per-Surface Fidelity Principle: read prototype before each surface, document reference in file header
- Pre-existing 10 test failures are baseline — don't block, don't add new
- Autonomous run: don't ask for operator confirmation on visual judgment, deploys, smoke, push — pick recommended option and continue
- Stash recovery SHA: `bd9d6af` (only relevant if operator asks)
