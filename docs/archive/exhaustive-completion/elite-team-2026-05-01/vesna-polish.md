# Vesna Aalto — AcreOS Polish Audit
**2026-05-01 · Auditing for Apple-stock-app feel · No code changes, plan only**

---

## 1. Opening verdict

AcreOS is closer to Apple-stock than the founder thinks. The token system, editorial greetings (`acr-cc-greeting` / `acr-cc-greeting-soft`), themed `--acr-*` semantics, and the disciplined "Couldn't [verb] — your [thing] is unchanged" toast voice are already at a tier most B2B SaaS never reach. The gap is consistency under load: a few customer surfaces still leak founder-mode codenames (Atlas, Sovereign, Sophie holdovers), generic "Loading…" strings hide what's actually loading on ~30 components, and motion is decoration in too many places (every page fades/staggers identically regardless of intent). Closing that gap is two focused weeks of work, not a rebuild.

---

## 2. What's already great — protect these

1. **Editorial greeting pattern** (`client/src/pages/today.tsx:646-657`, `inbox.tsx:1037-1050`, `pipeline.tsx:262-278`) — the "headline + soft suffix" structure is exactly the Apple Music album-header voice. `acr-cc-greeting` + `acr-cc-greeting-soft` typographic split is a real design idea. **Do not let any future surface ship without it.**

2. **Toast microcopy discipline** (`client/src/pages/finance.tsx:103,484-485,529,552`, `settings.tsx:156,201,453,750`) — every error toast names the failed verb, includes a reassurance ("no card was charged", "your existing schedule is unchanged", "your seat count is unchanged"), and ends with what to do. This is Apple-Mail-tier copy. Codify the pattern in a CONTRIBUTING note before someone breaks it.

3. **Empty-state with tips array** (`client/src/components/empty-state.tsx:64-78`, `empty-states.tsx:18-49`) — every empty state has icon + title + description + 3 tips + optional action. Most apps ship `<p>No data</p>`. AcreOS ships brand voice. Protect.

4. **Skeleton-shape-matches-content** (`portfolio.tsx:311-378`, `parcel-detail.tsx:132-146`, `founder-home.tsx:556-571`) — the loading state mirrors the final layout (4 metric-card-shaped skeletons, not a generic spinner). This is the difference between "is it broken?" and "it's coming." Keep.

5. **Themed semantic tones** (`pipeline.tsx:80-86`, `today.tsx:181-185`) — `var(--acr-warn)` / `var(--acr-pos)` / `bg-acr-brand-soft` instead of Tailwind hexes means switching from Homestead to Nocturne re-skins the entire signaling system automatically. Almost nobody does this. Protect with lint.

6. **Motion preference respect** (`client/src/index.css:46-64`) — collapsing durations to 30/60ms when `data-motion="reduced"` OR `prefers-reduced-motion` (with manual override winning) is correctly designed. Most teams ship `prefers-reduced-motion` as an afterthought.

---

## 3. The polish punch list

### P0 — blocks the "feels like Apple" claim

**P0-1. Persona leak: Atlas in customer-facing TasksEmptyState**
- File: `client/src/components/empty-states.tsx:128`
- Wrong: `"Atlas AI suggests follow-up tasks automatically"` — Atlas is the founder-mode CTO codename. This empty state ships on every customer Tasks surface.
- Apple-grade: customer-facing strings should say "AcreOS suggests follow-up tasks automatically" or use `useTerm()` / brand name.
- Effort: 2 min (one-line fix + grep verify).

**P0-2. Persona leak: Sovereign dashboard CTA on /today**
- File: `client/src/pages/today.tsx:686-690`
- Wrong: `<Link href="/sovereign">Sovereign dashboard →</Link>` is rendered on /today (customer surface). `/sovereign` is `FounderProtectedRoute` (`App.tsx:875,900`), so customers see a CTA that 403s for them.
- Apple-grade: dead links on customer surfaces are unforgivable. Either gate the `<Link>` on `isFounder`, route customers to `/ai#agents` (which they already have), or remove.
- Effort: 5 min.

**P0-3. Generic "Loading…" string used in 30+ components**
- Files: `client/src/pages/pipeline.tsx:54`, `team-inbox.tsx:430`, `predictions.tsx:263`, `pax.tsx:474`, plus 26 components (`legal-intelligence-card.tsx:60`, `ai-cost-dashboard.tsx:56`, `closing-costs-card.tsx:66`, `cohort-analytics.tsx:120`, `attribution-analytics.tsx:143`, `system-health.tsx:152`, `portfolio-health-card.tsx:111`, etc.).
- Wrong: Apple Music never shows "Loading" — it shows "Loading library", "Searching Apple Music", "Restoring purchases". Without a noun, the user can't tell if it's the page, the data, or stuck.
- Apple-grade: every loading string says what is loading. `pipeline.tsx:54` should be "Loading pipeline…", `pax.tsx:474` "Waking Pax…" (which it already says elsewhere — inconsistent within the same file). Pass `label?: string` to `ListSkeleton` and use it.
- Effort: 1.5h to grep + audit + fix all 30. Add lint rule afterward.

### P1 — visible quality lift

**P1-4. Suspense fallbacks are bare spinners with no shape**
- Files: `pipeline.tsx:48-56` ("Loading…"), `pax.tsx:48-54` ("Waking Pax…"), `App.tsx` route-level Suspense fallbacks.
- Wrong: when a tab swap triggers the lazy chunk, user sees a 200ms blank then a centered "Loading…" — feels like a navigation glitch, not a deliberate transition.
- Apple-grade: `TabFallback` should render a skeleton matching the tab's shape (board grid skeleton for Board, list skeleton for Leads). Apple Music's tab swaps never go blank — they fade between the previous tab's frame and the next tab's frame.
- Effort: 2-3h (one skeleton per top-level surface, ~5 surfaces).

**P1-5. AnimatedCounter on /today fires on every refetch**
- File: `today.tsx:694,699,707` — `AnimatedCounter` re-counts up from 0 on every poll. Three counters animating simultaneously every 60s is decorative motion, not semantic motion.
- Apple-grade: motion on numeric change should only fire when the number *changed*. Apple's metric tiles don't re-roll their digits when you tab away and back.
- Effort: 30 min (memoize previous value; only animate on diff).

**P1-6. `/today` agent activity card has no resting state**
- File: `today.tsx:674-716`
- Wrong: the agent card only renders when `activeAgentCount > 0 || pendingApprovalCount > 0`. When both are zero, the entire section disappears — the page silently restructures. Apple keeps the section frame and shows "All agents quiet · 100% autonomy."
- Apple-grade: a card that exists conditionally is a card that doesn't exist. Either show it always with a calm zero state, or move agent-specific signal to /pax.
- Effort: 30 min.

**P1-7. `auth-page.tsx` still uses `min-h-screen` (3×)**
- File: `auth-page.tsx:66, 92, 106`
- Wrong: per the synthesis Wave B5, `min-h-screen` (=100vh) miscalculates iOS Safari address bar. Auth page is the **first impression**. If the centering is off by 56px on iPhone, the whole brand wobbles.
- Apple-grade: `min-h-dvh` everywhere on first-impression surfaces.
- Effort: 5 min, replace-all.

**P1-8. Two-state branching in `auth-page.tsx` shows raw spinner**
- File: `auth-page.tsx:70-77, 96-101`
- Wrong: invite-accept and SSO callback both render a Tailwind-only `animate-spin` border-circle with no brand. Customer's first authenticated moment is a generic loader.
- Apple-grade: even a 200ms loader should carry the wordmark / colorway. Use the same `<div w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-accent>` block from line 126 with a subtle pulse.
- Effort: 30 min.

**P1-9. Pipeline `/pipeline` double-shells when tabs are nested pages**
- File: `pipeline.tsx:316-343` lazy-loads `DealsPage`, `LeadsPage`, `PropertiesPage`, `CampaignsPage` — each renders its own `<PageShell>`. So /pipeline → Leads tab paints PageShell-inside-PageShell, with two greeting hero blocks stacking. Visible bug in the editorial header pattern that's otherwise great.
- Apple-grade: tabs render inner content, not full pages. Extract `LeadsListContent` / `PropertiesListContent` and have both `/leads` and `/pipeline#leads` consume them.
- Effort: medium — 1 day to refactor cleanly. Defer if needed but track.

**P1-10. Toast voice drift — three patterns coexist**
- Files: `today.tsx:303` ("Try again, or check the system status"), `portfolio.tsx:262-263` ("The alert is still active. Try again."), `leads.tsx:201` ("The existing score is unchanged. Try again.").
- Wrong: three error-recovery sentence shapes. Most pages have settled on `[reassurance] — try again`; the rest say `[reassurance]. Try again.` or `Try again, or [escape hatch].`
- Apple-grade: one shape. "[Verb] couldn't complete" / "[reassurance] — try again." Period.
- Effort: 1h, find/replace + voice review.

**P1-11. Inbox empty state lacks call-to-action**
- File: `inbox.tsx:1010-1015` — `getEmptyMessage()` returns `{title: "No messages", description: "Your inbox is empty."}` and that's it. No icon variation by status (it's always Mail or Phone), no tip, no nudge.
- Apple-grade: Apple Mail's "No mail" empty state shows the inbox icon, the title, and "Mail will appear here when it arrives." For starred: "Star important messages to find them later." AcreOS is closer than I expected — but `description` should each be a sentence with a job, not just a restatement of the title.
- Proposed: see §4 below.
- Effort: 20 min.

### P2 — polish, not blocking

**P2-12. Sidebar collapse animation is decoration**
- File: `inbox.tsx:1027` — `transition-all duration-200` on margin shift between `md:ml-[76px]` and `md:ml-[17rem]`. `transition-all` is the cheap option; it animates *every* property including layout-shifty ones.
- Apple-grade: `transition-[margin-left] duration-[var(--acr-dur-normal)] ease-[var(--acr-ease-spring)]` with the design-system spring. Use the tokens you already defined.
- Effort: 30 min globally (`grep -r "transition-all"`).

**P2-13. Back-link spacing inconsistency in parcel detail**
- File: `parcel-detail.tsx:174-179` — back link `inline-flex items-center gap-1.5` then header. Compare leads/deals drawers which have a different back-link treatment.
- Apple-grade: every back-affordance on detail pages is the same component. Extract `<DetailBackLink href="" label="" />` or audit the 5 places this pattern exists.
- Effort: 1h.

**P2-14. Discoverability — keyboard shortcuts are 3 taps deep**
- The ⌘K command palette is shipped, but the "?" shortcut to view bindings is in `KeyboardShortcutsModal` which is itself behind ⌘K → search "shortcuts".
- Apple-grade: a single "?" anywhere in the app shows the cheatsheet. Apple Mail does this. AcreOS already has the modal — wire one global keydown listener.
- Effort: 20 min.

**P2-15. `Sparkles` icon overuse**
- Files: `pax.tsx`, `today.tsx:32`, `properties.tsx`, `finance.tsx`, `parcel-detail.tsx:218`, `founder-home.tsx:553`. The Sparkles icon means "AI" in 60% of cases and "highlight metric" in the rest.
- Apple-grade: one icon = one meaning. Keep Sparkles for AI/Pax surfaces only; replace the metric-highlight uses with `Star` or a colored dot.
- Effort: 1h iconography pass.

---

## 4. Microcopy review — 5 lines to rewrite

| # | File:line | Current | Proposed | Why |
|---|-----------|---------|----------|-----|
| M1 | `inbox.tsx:1015` | `"No messages"` / `"Your inbox is empty."` | `"You're all caught up"` / `"New emails and SMS will appear here as they arrive."` | Restating the title isn't a description. Tell the user what fills the void. |
| M2 | `inbox.tsx:1011` | `"No starred messages"` / `"Star messages to find them quickly."` | `"Nothing starred yet"` / `"Tap the star on a message to keep it close. Starred items stay across email and SMS."` | "yet" is the Apple word — implies future, not absence. |
| M3 | `pipeline.tsx:54` | `"Loading…"` | `"Loading pipeline…"` (or skeleton) | Bare "Loading" is invisible weather. |
| M4 | `today.tsx:654` | `"Here's what's on the horizon."` | Keep — but pair with: when `pendingDecisionCount === 0` AND no agents AND no goals, today shows nothing actionable. Add a default state line: `"A quiet morning. Use ⌘K to add a lead."` | The current empty-zero state for a brand-new user reads as a glitch. |
| M5 | `auth-page.tsx:75` | `"Joining organization…"` | Keep — this one is good. **But** the parallel `auth-page.tsx:100` `<span className="sr-only">Signing you in…</span>` — sr-only means sighted users see no message. Promote to visible: `"Signing you in…"`. | A 1-2s loader with no visible message reads as broken. |

Voice principles AcreOS is enforcing well and should keep:
- Contractions ("you're", "we're"), never "you are"
- Reassurance after failures ("your X is unchanged")
- Sentence case in titles, period at end of descriptions
- "Couldn't [verb]" not "Failed to [verb]" or "Error: [thing]"

---

## 5. Empty-state audit — page by page severity

| Page | File | Severity | Note |
|------|------|----------|------|
| `/today` zero-data new-user | `today.tsx:646-671` | **Medium** — when no goals, no decisions, no agents, the page is a greeting and three blank metric cards. Needs a "first-day" composition. |
| `/inbox` | `inbox.tsx:1015` | **Low-Med** — descriptions restate titles. Quick fix in §4. |
| `/pipeline` board | `pipeline.tsx:117` | **Low** — `PipelineIntelligenceHeader` returns `null` when zero. The greeting "Your deal machine. Bring in your first lead to get going." (line 272-276) is good, but the rest of the page is a single empty board. Could surface `<PipelineEmptyState>` directly. |
| `/properties` | `properties.tsx:703-720` | **Good** — uses `PropertiesEmptyState` with tips. Protect. |
| `/leads` | `leads.tsx:1496,1656` | **Good** — same. |
| `/deals` | via `DealsEmptyState` | **Good** |
| `/finance` | `finance.tsx:361-368` | **Good** |
| `/portfolio` | `portfolio.tsx` | **Medium** — when summary is zero, the metric cards show `$0 / $0 / 0% / 0` instead of an empty state. Apple would show "Your portfolio starts here. Create a note to begin tracking value." |
| `/pax` | `pax.tsx:207` | **Medium** — error: "Couldn't load insights" exists, but the *empty* state when there are no observations isn't called out from the grep. Verify on a fresh org. |
| `/parcel-detail` | `parcel-detail.tsx:118-127` | **Good** — no-id case has a real EmptyState. |
| `/settings` | `settings.tsx` | **N/A** — settings is form-only; empty states don't apply. |
| `/founder-home` | `founder-home.tsx:434` | **Acceptable** — "No agents configured" is fine; founder context. |
| `/auth-page` | n/a | **N/A** |

**Verdict:** `/today` for a brand-new user (no goals, no decisions, no agents) and `/portfolio` zero-state are the two surfaces most likely to feel half-finished on first run. Everything else is at-or-near Apple-grade thanks to the `EmptyState` component design.

---

## 6. Recommended quarterly polish project — "Apple-grade pass"

Five items, ~2 weeks total, that move the entire app one tier:

### Week 1

**Day 1-2 — Microcopy single-voice sweep (8h)**
- Grep all `toast(` calls, all `EmptyState` strings, all `<span className="sr-only">Loading`, all `Skeleton` aria-labels.
- Enforce one toast shape. Eliminate bare "Loading…" — every loader names its noun.
- Add `docs/voice.md` with the rules, link from CLAUDE.md.
- Deliverable: every error message follows `[Couldn't verb noun] / [reassurance] — try again`. Every loader says what's loading.

**Day 3 — Persona-leak final sweep (4h)**
- Grep `Atlas|Sophie|Forge|Sovereign` in all customer-facing routes (everything except `founder-*`, `admin-*`, `ops-*`, `data-moat-*`, `agent-*`).
- Fix P0-1 and P0-2 above plus any other hits.
- Add an ESLint custom rule that flags founder-codename strings outside founder-protected files.

**Day 4-5 — Skeleton-shape-matches-content for tab fallbacks (12h)**
- Replace `TabFallback` "Loading…" centered text in `pipeline.tsx`, `pax.tsx`, `money.tsx`, and route-level Suspense in `App.tsx` with shape skeletons.
- Each top-level surface gets a dedicated `<XxxSkeleton />` component.

### Week 2

**Day 6-7 — Motion semantics audit (12h)**
- Walk every `<motion.*>` and `framer-motion` usage. For each, answer: does this motion *mean* something?
- Replace decorative fades with no motion. Keep semantic motion: optimistic mutations, list reorders, drag interactions, modal entrances.
- Enforce `--acr-dur-*` / `--acr-ease-spring` tokens; ban hardcoded durations.
- Fix `AnimatedCounter` to only animate on actual diff (P1-5).

**Day 8 — Empty-state second-pass (4h)**
- Fix `/today` first-day empty composition.
- Fix `/portfolio` zero-state.
- Verify `/pax` zero-observations state.
- Apply the §4 inbox copy rewrites.

**Day 9 — Discoverability one-tap rule (6h)**
- Audit any feature that's 3+ taps deep. Promote the most-used to ⌘K results, the rest to PageTopbar overflow menus.
- Wire global "?" → KeyboardShortcutsModal.
- Verify keyboard navigation on all top-level surfaces (Tab order; Esc closes drawers; Enter on focused row opens detail).

**Day 10 — Cross-surface consistency pass (6h)**
- Same-affordance same-word audit: "Add" vs "Create" vs "New" — pick one per noun.
- Detail-page back-link extraction (P2-13).
- Sparkles icon disambiguation (P2-15).
- One visual diff session at desk + iPhone, all five themes × light/dark, with a reviewer.

**Outcome:** Every surface reads as written by one designer. Every loading state is informative. Every motion has a reason. Every empty state earns its place. The persona architecture is enforced at lint, not vibes. AcreOS at the end of this two-week pass is what the founder thinks "Apple-stock-app feel" means.

---

*Vesna Aalto · 2026-05-01*
