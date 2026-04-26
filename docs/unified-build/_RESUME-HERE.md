# RESUME HERE — Unified Build, autonomous run

**Run mode: fully autonomous through Phase 10.** Operator authorized auto-fire deploys, pushes, smoke tests, migrations. End the loop only at 85% context or genuinely unresolvable Gate B ambiguity.

The full canonical prompt lives at `docs/unified-build/UNIFIED-BUILD-PROMPT.md`.

## Where the build stands

Phase 0–2 deployed at https://acreos.io.

Phase 2A in progress:
- 2A.1 ✅ Sidebar visual treatment (commit `1bca3f3`)
- 2A.2 ✅ Palette modal + toaster kinds (commits `7309858`, `8d6862e`)
- 2A.3 in progress — public landing page:
  - ✅ Foundation: Fraunces + Inter from Google Fonts; `--font-serif` token (commit `fcb1143`)
  - ✅ Hero: serif headline, three floating agent cards, parcel-grid backdrop (commit `fcb1143`)
  - ✅ HowItWorks: 3-step grid replaces legacy 4-step icon section (commit `68dcbdd`)
  - ⏳ Agents (next) — tabbed section, 3 agent panels, sample data row
  - ⏳ DayInLife — two-column timeline (Before / With AcreOS)
  - ⏳ Features — 12-card grid with SVG glyphs, 5 categories
  - ⏳ Quotes — 6 testimonials in card grid
  - ⏳ FounderNote — portrait + serif body paragraphs + signature
  - ⏳ Pricing — 3 tiers with monthly/annual toggle
  - ⏳ FAQ — accordion, 8 items
  - ⏳ FinalCTA — email capture card
  - ⏳ Footer — homestead-styled with brand mark
  - ⏳ Top nav — replace existing nav with prototype-aligned anchored nav
  - ⏳ Drop legacy WaitlistSection / SOCIAL_PROOF / Features grid below
- 2A.4 — Onboarding (after landing complete)
- 2A.5 — fly deploy + Playwright MCP smoke (auto-fire authorized)

## Next action: Phase 2A.3.c — Agents section

Source: `/acreos-landing/sections-1.jsx` → `Agents` (lines 142-272). Tabbed UI with 3 agents (Atlas/Pax/Sophie). Each tab shows: avatar letter (brand-colored bg), name, role label. Clicking a tab swaps the panel below — left side shows tagline + bullet list with brand-color checkmarks; right side shows a "sample" card with the agent's recent activity (rows of label/value).

CSS source: `/acreos-landing/sections.css` lines 264 onward (find with `grep -n "lp-agents\|lp-agent-" acreos-landing/sections.css`).

Agent data (verbatim from prototype):
- Atlas — Analysis — `#C2531C` — "Pulls comps. Spots flaws. Prices parcels." — bullets + sample
- Pax — Communication — `#4C7B80` — "Drafts replies. Books calls. Handles objections."
- Sophie — Servicing — `#8B5A2B` — "Watches title. Services notes. Keeps the books."

Implementation:
1. Create `client/src/pages/landing/Agents.tsx` per the prototype JSX.
2. Add `.lp-agents-tabs`, `.lp-agent-tab`, `.lp-agent-tab-active`, `.lp-agent-panel`, `.lp-agent-sample`, etc. to `client/src/pages/landing/landing.css`. Use `--acr-*` tokens; the per-agent color (`#C2531C`, `#4C7B80`, `#8B5A2B`) stays as literal since these are agent identity colors not theme tokens. Atlas color = `--acr-brand`.
3. Wire `<Agents />` into `landing.tsx` after `<HowItWorks />`.
4. Commit: `feat(landing): the agents section [unified-build]`

After Agents, continue through DayInLife → Features → Quotes → FounderNote → Pricing → FAQ → FinalCTA → Footer → Top nav. Each section is a separate commit with `feat(landing): <section> [unified-build]`. The legacy inline sections in `landing.tsx` get removed in the same commit that introduces the prototype-aligned replacement.

## Loop guidance

After each section commit:
- ScheduleWakeup 270s if continuing in-cache
- ScheduleWakeup 1200s if waiting for deploy/external state
- End loop ONLY at 85% context or unresolvable Gate B

When ending: write `_RESUME-HERE.md` with exact next-section to implement, commit progress, end. Operator re-invokes /loop in fresh session.

## Hard reminders

- `[unified-build]` tag + Co-Authored-By trailer on every commit
- Visual Application Mandate: prototype wins on visual conflicts
- Per-Surface Fidelity Principle: read prototype before each section, document reference at top of file
- Pre-existing 10 test failures are baseline — don't block, don't add new
- Autonomous run: don't ask for operator confirmation on visual judgment, deploys, smoke, push
- Stash recovery SHA: `bd9d6af` (only if operator asks)
- Mobile responsive: each section needs <720px adaptation per the prototype's media queries
