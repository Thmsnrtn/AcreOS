# Prototype Fidelity Audit

**Author:** Claude (research-only).  **Date:** 2026-04-29.

**Scope:** New gaps below the surface of the eleven items already tracked in
`JUDGMENT-CALL-RECOMMENDATIONS.md` (founder-dashboard re-skin, onboarding-v2
re-skin, /parcels/:id, sidebar registry, notifications matrix,
features/feature-flags consolidation, autonomy storage, AGENT_COLORS,
finance.tsx emerald/amber callouts, founder-letter accessibility, Pax inbox
prefill). Those are *not* restated below — every finding is structurally new.

**Method:** Paired prototype-reference reads (`acreos/`, `acreos-onboarding/`,
`acreos-landing/`) with production sources in `client/src/pages/` +
`client/src/components/`. Static reads only — I did not render the app
authenticated, so dynamic-state findings (loading skeletons, error tone,
in-flight motion) are inferred from source.

**Honesty caveat:** I cannot confirm runtime appearance — the live app may
look better or worse than the source suggests. Findings below are tied to
specific file:line evidence so a reviewer can verify each one.

---

## Summary

| Surface | Status | Top gap |
|---|---|---|
| /today | drift | Editorial hero is ported but body still composes generic-SaaS cards (Welcome-to / Welcome-back / Getting Started) above the prototype hero, breaking the "calm" first impression |
| /pipeline | drift | `FUNNEL_STAGES` uses raw hex (`#94a3b8 #f59e0b…`) — escapes the 5-theme system entirely |
| /inbox | drift | Two-tier Tabs (channel + status) replace prototype's single tab strip; inbox header sits in border-b strip not editorial pg-hd; reply textarea is blank-not-prefilled (JC#11 — known) |
| /properties | drift | 3,269 LOC, 45 raw-Tailwind tones, no `rounded-card`, no stagger motion |
| /deals | drift | 2,224 LOC, 43 raw tones, no `rounded-card`, no stagger motion |
| /onboarding-v2 | brief-violating debt | Confetti animation + 8-color burst + "Most Intelligent" hype copy. Direct §2.3/§2.4/§13 violations beyond JC#3's structural deferral |
| /auth | brief-violating | Tagline "The AI-powered platform for Land Investors" uses §1.2-forbidden buzzword |
| / (landing) | better-than-prototype | Hero copy improved over `acreos-landing/copy.jsx` to first-person founder voice |
| /settings | drift | 34 raw Tailwind tones, no `rounded-card`, hardcoded shadcn-card `rounded-2xl` (24px) defeats brief's 14px |
| /money | drift | Generic SaaS hero ("Money / Notes, portfolio, cash flow…"); tab labelled "Finance" loads `PortfolioPage` (label-route mismatch) |
| /finance | debt | 23 raw emerald/amber tones (JC#9 covers), confirms the pattern but at 1,824 LOC there is structural drift JC#9 doesn't address |
| /portfolio | drift | 35 raw tones, hardcoded recharts `fill="#3b82f6"` etc. (lines 705, 742-3, 883-93) — Atlas chart palette diverges from `--acr-chart-*` |
| /pax (AI surface) | persona-leak | "Agents" tab inside customer-facing /pax exposes Atlas/Sophie/Forge — violates persona-architecture rule (memory: customers see Pax only) |
| /atlas | stub | "Atlas is coming soon" placeholder. No prototype-aligned surface |
| Sidebar | drift | 58 nav items vs prototype's ~14; group labels ("AI Hub," "Intelligence," "AI Valuations") use forbidden buzzwords |
| Top bar | missing | `PageShell` has no top bar at all. Prototype has sticky backdrop-blur top bar with breadcrumbs, ambient AI, notifications, dark toggle |
| Command palette | not audited | 814-line component, no prototype diff performed in this pass |
| FAB | drift | Title-Case labels ("New Lead," "AI Assistant") — SaaS register; no prototype analog so judged against tone only |
| Pax rail | not audited | 1,765-line component; size precludes pair-read |

---

## Per-surface gaps

### /today (`client/src/pages/today.tsx` 1,391 LOC)

**Drift from prototype:**
- Three pre-hero cards (lines 487-516 onboarding banner, 519-599 welcome-back card, 602-631 Getting Started) sit ABOVE the editorial `acr-cc-hero` greeting (line 633). Prototype `command-center.jsx` opens with the greeting; everything else is below. Production buries the hero. · brief §1 (voice) + §14.1 (most-seen surface) · fix: move greeting to the top, demote banner/welcome-back to inline strips below the metric grid · M
- `welcome-back` card uses `bg-acr-brand-soft` + `bg-white/70` mix and `rounded-lg` not `rounded-card` (line 521, 550) · brief §3.7/§5.2 · S
- Greeting hero contains no metric strip equivalent to prototype's 5-column `.acr-cc-metrics` (line 256 in `acreos/command-center.jsx`). Production flattens. · brief §5.6 numerical data display · M
- No AI Suggestions grid (`acr-sugg-grid` of 3 cards) in production today. Prototype has it as the operator's first scroll-stop. · brief §1.3 (named-agent attribution) · M
- 14 raw Tailwind tones on /today (`text-amber-500`, etc. lines 198-310, 904, 957, 1075, 1338-1344) — these escape the 5-theme system · brief §2 tokens · S

**Copy/voice gaps:**
- Line 495 "Welcome to AcreOS." — generic SaaS register · prototype voice is editorial / specific · suggested rewrite: "Set up takes about four minutes." (mirrors `acreos-onboarding/screens-1.jsx` voice) · brief §1.1
- Line 530 "Welcome back, {name}!" — exclamation point + generic salutation. Prototype-equivalent would be "Quiet for {N} days. Here's what shifted." · brief §1.2 (cutesy)
- Line 609 "Ready to find your first deal?" — bro-adjacent / pep · prototype voice would be "No deals yet. Add your first parcel." (matches §11 empty-state spec verbatim) · brief §1.2

**Token/theme gaps:**
- Line 488 `bg-primary/5` and 491 `bg-primary/10` — bypass `--acr-brand-soft` · brief §2 · S
- Line 670 `bg-gradient-to-br from-primary/5 to-transparent` — gradient-as-design, brief §2.3 anti-pattern · S

**Component-bespoke-ness:**
- Line 549 hardcoded grid `grid-cols-2 sm:grid-cols-4` of "white/70" stat tiles inside welcome-back card duplicates the metric-strip pattern that should be a shared `Metric` component (per `acreos/command-center.jsx` line 3) · M

### /pipeline (`client/src/pages/pipeline.tsx` 333 LOC + `deals.tsx` 2,224 LOC)

**Drift from prototype:**
- `FUNNEL_STAGES` colors at lines 74-78 are raw hex (`#94a3b8`, `#f59e0b`, `#f97316`, `#3b82f6`, `#22c55e`). These render in the funnel chart at any theme — Quarry/Nocturne users see Tailwind defaults instead of `--acr-chart-*`. · brief §3.8 · S
- Prototype `pages-tier1.jsx::Pipeline` (line 4) has three views: list / kanban / map. Production mounts a Tabs wrapper with funnel + velocity cards but the 'board' tab loads `DealsPage` directly. Map view absent. · brief §10 · M
- Stage filter chips in prototype use the calm chip pattern (line 369 `chip-on { background: var(--ink); color: var(--bg) }` — strong inversion). Production uses default Tabs. · brief §5 · S

**Copy/voice gaps:**
- Velocity tiles "hot deals", "stalled deals" lean operator-speak which is fine — but the wrapper "Pipeline funnel" + "Stage" labels are SaaS-flat. Prototype eyebrow is `Pipeline · {N} active deals · ${total}K in flight` — quantitative, specific. · brief §1.1
- Pipeline hero header lacks a single-sentence specific subline like the prototype's. · brief §1.1

### /inbox (`client/src/pages/inbox.tsx` 1,126 LOC)

**Drift from prototype:**
- Prototype inbox is a single 380-px list + body grid (`tier1` line 426 `grid-template-columns: 380px 1fr; border: 0.5px solid var(--line); border-radius: 14px`). Production places list/body inside a sidebar-flanked main with two stacked Tabs strips (lines 985, 1014). The unified card-shell intimacy is gone. · brief §5.5/§5.2 · M
- `Tabs` at lines 985 (channel) and 1014 (status) duplicate filter machinery. Prototype uses one tab strip with channel filter + unread badge (line 293 `tier1`) — status is implicit. · brief §2.1 (density/calm) · M
- Reply Card (line 533) is `rounded-card` ✅ but the message header (line 386) and tabs strips above use `border-b` flat-utility chrome instead of the prototype's wrapped panel. · brief §5 · S
- Editorial header at line 944 ("acr-eyebrow / acr-cc-greeting style") is good — but it sits OUTSIDE the inbox card, not above it like the prototype's tier-c.jsx pattern. · §1 voice · S

**Copy/voice gaps:**
- "All caught up. Nothing waiting." — well-aligned with brief voice. KEEP. (Better than prototype's plainer "0 unread.")
- Line 922 SMS empty: "SMS conversations will appear here." — generic. Prototype voice would name what's missing: "No SMS yet. Pax sends from the deal page." · §11 empty-state spec
- Line 928 starred empty: "Star messages to find them quickly." — passable.
- Line 933 "Your inbox is empty." — flat. Better: "All quiet. Atlas will surface anything that needs you."

### /properties (3,269 LOC)

**Drift from prototype:**
- 45 raw Tailwind color tokens means properties is a heavily-non-tokenized page · brief §2 · M
- Zero `rounded-card` usage (default Cards render at 24px from `rounded-2xl`) · brief §3.7 · S
- Prototype has no /properties analog — closest is `Pipeline`'s map view + `ParcelDetail`. Production at 3,269 LOC is doing too much; the brief's "calm dominates" (§2) hard-fails on a page this complex. · brief §2.1 · L

**Copy/voice gaps:**
- Line 1200 error toast "Something went wrong saving this property. Your form values are still here — try again." — already specific (good); the lead-in "Something went wrong" should be "Couldn't save this property. Your form values are still here — try again." · brief §11
- Sidebar description "Properties you own or evaluate" — fine.

### /deals (2,224 LOC)

**Drift from prototype:**
- 43 raw Tailwind tones · brief §2 · M
- Zero `rounded-card` · brief §3.7 · S
- Prototype `Pipeline` table is dense, eyebrowed, font-mono parcel IDs (`tier1.jsx` line 47-70). Production deals.tsx has its own structure; cannot diff fully without rendering. · §5.5 · M

**Copy/voice gaps:**
- Lines 217, 240, 284 — three "Something went wrong" error strings · brief §11 explicitly forbids · S each

### /onboarding-v2 — direct brief violations (NOT covered by JC#3)

JC#3 calls for full structural redesign. The findings below are **anti-pattern
violations independent of the redesign**, surfaced because the codemod-only
alternative would still ship them.

**Brief-violating debt:**
- Line 53-99 `CompletionCelebration` component — confetti burst with 8 colored dots. Brief §13 lists "confetti, balloons, big emoji" as "Anti-pattern (never ship)." §2.4 lists same. · S to delete
- Line 42 `PartyPopper` icon imported from lucide. Brief §2.4: anti-pattern "excessive empty-state celebration… big emoji" · S
- Line 1088 "The Most Intelligent Land Investing Platform" — brief §1.2 forbids "intelligent" as product descriptor. Also self-superlative ("Most") is hype. · S
- Line 127 "Welcome back to AcreOS / Upgrade your investing operation" — "Upgrade your investing operation" is corporate-stiff; brief §1.2 · S
- 121 raw Tailwind color tokens (highest count of any page audited) — emerald/blue/purple/orange/pink/teal/red — all theme-blind · brief §2 · M

These should be ripped out *before* the JC#3 structural redesign — they are
pure anti-pattern, not structure questions.

### /auth (`auth-page.tsx` 163 LOC)

**Brief-violating debt:**
- Line 13 page meta description: "Sign in to AcreOS — the AI-powered platform land investors use to manage leads…" — "AI-powered" is brief §1.2 anti-pattern (verbatim). · S
- Line 135 visible tagline "The AI-powered platform for Land Investors" — same violation, visible to every signing-in user · S
- Line 127 hero logo uses `bg-gradient-to-br from-primary to-accent` — gradient-as-design (brief §2.3) · S
- Line 13 title also uses verbatim "AI-powered" — appears in `<title>` element · S

**Voice rewrite suggestion:** "AcreOS — the operating system for land investors." (matches `landing.tsx` line 40 voice; `landing.tsx` got it right, `auth-page.tsx` regressed.)

### / (landing) — better-than-prototype

`client/src/pages/landing/copy.ts` improves on `acreos-landing/copy.jsx`:
- Hero rewrite from "Find motivated sellers. Send mail. Close deals." → "I built this because I needed it. Maybe you do too." — first-person founder voice, brief §1 north-star aligned. KEEP.
- "I named them after people I trust." vs prototype's "Three coworkers who work while you sleep." — production is warmer + lower-key, more brief-aligned. KEEP.
- Pricing tagline "Honest pricing for honest work." vs "Pay for what you use." — production matches §1 letter voice better. KEEP.

These were intentional Phase improvements — flag in this audit so future rounds
don't "fix back" to the original prototype.

### /settings (`settings.tsx` 2,990 LOC)

**Drift from prototype:**
- 34 raw Tailwind tones across this page · brief §2 · M
- Zero `rounded-card` instances — all settings rows render at default Card 24px · brief §3.7 · S
- Lines 957-1075 contain `bg-emerald-500/10 border-emerald-500/20`, `text-amber-500`, gradient-Pro badge `from-amber-500 to-orange-500 text-white` — all theme-blind, gradient-as-design. · brief §2/§2.3 · S
- Line 904 "Unlimited" badge has `bg-gradient-to-r from-amber-500 to-orange-500 text-white` — direct §2.3 gradient violation · S
- Prototype `acreos/settings.jsx::SettingRow` uses `16 × 28 padding, line-soft divider` (lines 113-130 of HANDOFF mapping). Production settings rows use shadcn defaults. · brief §9.3 · M

**Copy/voice gaps:**
- Most labels are descriptive and OK; a few headlines like "Members & permissions" are SaaS-flat — brief voice would prefer "Who can do what." · §1.1 · S

### /money (135 LOC)

**Drift from prototype:**
- Lines 65-67 hero: "Money" + "Notes, portfolio, cash flow, and capital markets." — pure list-of-features SaaS register. No voice. · brief §1.1 · S
- Tab "Finance" (line 87) routes to `<PortfolioPage />` (line 111) — labels say one thing, content is another. Cognitive friction. · S
- This page is mostly a tab wrapper — but the wrapper itself is the worst-voice surface I read. ·

**Copy/voice rewrite:** "Money. Notes you hold, what's coming in, what to do next."

### /finance (1,824 LOC) — beyond JC#9

JC#9 covers the 32 inline emerald/amber callouts. Below are **other** finance gaps:
- Line 273 `bg-emerald-500/10` icon backgrounds (different from JC#9's text-color callouts) · brief §2 · S
- Line 904 status pill ladder (lines 1034-1037) uses `bg-emerald-100/dark:bg-emerald-900/30 …friendly_reminder→bg-amber-100`, etc. — five tone buckets × light-dark = 10 hex paths, all hardcoded · brief §3.3 · M
- Line 1338 success card `bg-emerald-50 dark:bg-emerald-900/30 border-emerald-200 dark:border-emerald-800` — duplicates the pattern. · brief §2 · S

### /portfolio (961 LOC)

**Drift from prototype:**
- 35 raw Tailwind tones · brief §2 · M
- `STATUS_COLORS` map (lines 151-154) uses raw hex `#10b981 #3b82f6 #ef4444 #f59e0b` — same shape as pipeline's funnel and JC#8's agent colors. · brief §3.8 · S
- Recharts components hardcode `fill="#3b82f6"` and `fill="#10b981"` at lines 705, 742, 743, 883, 884, 892, 893 — chart palette doesn't theme-switch. The `--acr-chart-a/b/c/d` variables exist; recharts isn't reading them. · brief §3.3 chart palette · M

### /pax — persona-architecture leak

- Lines 617-620 + 644-648: "Agents" tab inside customer-facing /pax loads `<AgentCommandCenterPage />` which surfaces Atlas/Sophie/Forge identities to non-founders.
- Memory rule: **"Persona architecture — Customers see Pax only; founder sees Sophie/Forge/Atlas/etc. Never mix them."**
- Line 597 sub-copy "AI assistant, agents, and automation for your land business." also exposes plural "agents" framing to customers.
- Fix: gate the "Agents" tab on `isFounder`; rewrite sub-copy to single-persona Pax framing. · brief §1.3 + persona memory · S

### /atlas — stub debt

- Page is 13 lines, just "Atlas is coming soon" placeholder.
- Brief §1.3 explicitly names Atlas as one of three coworkers; landing/Hero already has an Atlas card (Hero.tsx line 104).
- A signed-in user clicking "Atlas" from anywhere gets a dead end. · brief §14 · M

### Sidebar (`layout-sidebar.tsx` 1,459 LOC)

**Drift from prototype:**
- 58 nav items (counted via `label:`); prototype has ~14. Brief §2.1 + §6 personalization assumes a thoughtfully short default with optional expansion. · brief §2.1 · M (UX) / L (full restructure)
- Group labels: "CRM," "AI Hub," "Intelligence" — generic SaaS register. Prototype voice/data is operator-vocabulary ("Today, Pipeline, Inbox, Contacts, Calendar"). · brief §1.1 · M
- Item labels with brief-forbidden buzzwords: "AI Hub," "AI Valuations," "AI-powered property valuations" (description). · brief §1.2 · S
- "Marketplace" listed (line 354) but `feature.marketplace` flag is `off` per brief §8.4 — verify route is gated server-side, not just nav-hidden, per brief §8.3 ("not a hide-from-sidebar hack")

### Top bar — missing entirely

`PageShell` (page-shell.tsx) renders only `<Sidebar />` + `<main>`. No top bar.
Prototype `acreos/shell.jsx` line 93 `TopBar` carries:
- Breadcrumbs (line 102)
- Ambient AI button (line 115, ⌘J)
- Notifications bell (line 118)
- Dark-mode toggle (~150)
- Tweaks-panel trigger (founder)

Production scatters these — `theme-toggle.tsx` exists, command-palette is ⌘K
not a top-bar trigger, no breadcrumbs, no in-page notifications surface in the
top-of-frame slot. · brief §6 surface chrome · M

### FAB (`floating-action-button.tsx` 139 LOC)

- Title Case labels ("New Lead," "New Property," "AI Assistant") — SaaS register · brief §1 · S
- "AI Assistant" label is brief §1.2 buzzword + persona-leak (should be "Ask Pax") · S

---

## Cross-cutting patterns (3+ surfaces)

### CC-1 · Theme-blind raw Tailwind tones (high)
- Affected: onboarding-v2 (121), properties (45), deals (43), portfolio (35), settings (34), finance (23+), today (14), founder-dashboard (293, JC#2)
- Root cause: shadcn-default Tailwind palette was used during port; never migrated to `--acr-*` semantic tones
- Single-fix sketch: codemod `text-emerald-{n}/bg-emerald-{n}` → `text-acr-pos/bg-acr-pos-soft`; same for amber→warn, red→neg, blue→accent (or brand depending on usage). Bonus: `gray-{n}` → `--acr-ink-{n}`. Then forbid raw color tones with an ESLint rule. · L (codemod) + S (ESLint)

### CC-2 · Card default radius mismatch (high)
- Affected: every page using `<Card>` from `@/components/ui/card.tsx` — i.e., the entire app
- Root cause: `card.tsx` line 16 hardcodes `rounded-2xl` (24px). Brief §3.7 + §0.2 say card default is 14px (`rounded-card`). `tailwind.config.ts` exposes `rounded-card` but Card itself ignores it.
- Fix: change Card default from `rounded-2xl` → `rounded-card`; sweep callers that explicitly want 16px or 24px and add inline overrides
- · brief §3.7/§5.2 · S

### CC-3 · "Something went wrong" — generic error register (high)
- Affected: deals (3 strings), properties (1), founder-home, query-error-state, floating-assistant, pax-copilot-rail, campaigns-content
- Root cause: `query-error-state.tsx` line 77 default title is "Something went wrong"; pages copy that pattern
- Brief §11: "Specific blame, not 'Something went wrong.'" — explicit prohibition
- Fix: replace defaults with action-blame ("Couldn't load X. Retry."); audit toast titles · brief §1.1/§11 · S

### CC-4 · `desert-gradient` is theme-invariant
- Affected: every page (PageShell line 75 hardcodes `desert-gradient`)
- Root cause: `index.css` lines 1007-1018 use raw HSL values, not theme tokens. Switching to Quarry/Nocturne/Meadow/Slate still renders Homestead-tinted radial blooms.
- Brief §3.3 specifies per-theme `--acr-bg`, `--acr-bg-sunken`, etc.; gradient should compose from those.
- Fix: rewrite gradient to use `var(--acr-bg)` + `color-mix()` of `--acr-brand-soft`. Or move to per-theme blocks. · brief §3.3 · S

### CC-5 · Stagger motion missing on Tier-1 surfaces
- Affected: today, inbox, pipeline, deals, properties, portfolio, finance, settings — none import `staggerContainer`/`staggerItem` from `@/lib/animations.ts`
- Brief §7 specifies these as the canonical stagger primitives; they exist (181 LOC) but no Tier-1 page uses them
- Lines (or absence) — confirmed via `grep -L`
- Fix: wrap data lists with `motion.div` + stagger; respect `prefers-reduced-motion` already handled in animations.ts. · brief §7 · M

### CC-6 · Hardcoded chart colors bypass `--acr-chart-*`
- Affected: portfolio (recharts hex literals lines 705, 742-3, 883-93), pipeline (FUNNEL_STAGES lines 74-78)
- Brief §3.3 spec'd `--acr-chart-a/b/c/d` per-theme; charts should read from CSS variables, not hex
- Fix: introduce a `useChartPalette()` hook that reads from CSS vars at runtime, returns ordered array; pass into recharts `fill`/`stroke` props · brief §3.3 chart palette · M

### CC-7 · "AI/intelligent" buzzword leakage
- Affected: auth-page (tagline + meta), sidebar (AI Hub, AI Valuations, "AI-powered" descriptions), onboarding-v2 ("Most Intelligent"), FAB ("AI Assistant"), pax-page sub-copy
- Brief §1.2 forbids: "powered by AI, intelligent, smart (the product), magical"
- Fix: text-search and rewrite. Pax does the work; the platform doesn't need to brag. · brief §1.2 · S

---

## "Better than prototype" findings — preserve, don't revert

1. **Landing copy** (`client/src/pages/landing/copy.ts`) — first-person founder
   voice replaces prototype's third-person feature-list. Strictly more on-brief
   than `acreos-landing/copy.jsx`. KEEP.
2. **Inbox "All caught up. Nothing waiting."** (`inbox.tsx` line 960) — better
   than prototype's plain `0 unread` and aligns with brief §1 voice exemplar.
   KEEP.
3. **Today's `priorityColors` semantic-tone map** (today.tsx line 180) — uses
   `bg-acr-neg-soft text-acr-neg` instead of raw red/amber. Already
   token-driven. Reference for the codemod target shape (CC-1).
4. **Founder-letter route exists** (`/founder-letter`). JC#10 wants more
   accessibility surfaces — keep the existing route, don't restructure.
5. **Production tagline `"AcreOS — the operating system for land investors"`**
   in `landing.tsx` line 40 — exactly the brief register. The mismatch with
   `auth-page.tsx`'s "AI-powered platform" wording is the gap; keep landing
   wording, fix auth.
6. **Onboarding microcopy in moments — `screens-1.jsx::TONE_WELCOME.founder`**
   tone is good; the structural drift is real (JC#3) but voice itself is
   well-aligned where it lands.

---

## Voice/copy drift map

| Location | Current copy | Suggested rewrite | Brief ref |
|---|---|---|---|
| `pages/auth-page.tsx:13` | "the AI-powered platform land investors use to manage leads, properties, deals…" | "the operating system for land investors. AcreOS handles comping, replies, and loan servicing — you stay on the decisions." | §1.2 |
| `pages/auth-page.tsx:135` | "The AI-powered platform for Land Investors" | "The operating system for land investors." | §1.2 |
| `pages/onboarding-v2.tsx:1088` | "The Most Intelligent Land Investing Platform" | DELETE entire badge | §1.2/§13 |
| `pages/onboarding-v2.tsx:127` | "Welcome back to AcreOS / Upgrade your investing operation." | "Welcome back. / Pick up where you left off." | §1.1 |
| `pages/today.tsx:495` | "Welcome to AcreOS." | "Setup takes about four minutes." | §1.1 |
| `pages/today.tsx:530` | "Welcome back, {name}!" | "Quiet for {N} days. Here's what shifted." | §1.2 (no `!`) |
| `pages/today.tsx:609` | "Ready to find your first deal?" | "No deals yet. Add your first parcel." | §1.1 + §11 |
| `pages/today.tsx:611` | "Your AcreOS workspace is set up. Follow these steps to start evaluating parcels and closing deals." | "Your workspace is set up. Add a parcel to see Atlas comp it." | §1.1 |
| `pages/money.tsx:65-67` | "Money / Notes, portfolio, cash flow, and capital markets." | "Money. Notes you hold, what's coming in, what to do next." | §1.1 |
| `pages/inbox.tsx:933` | "Your inbox is empty." | "All quiet. Atlas will surface anything that needs you." | §11 |
| `pages/inbox.tsx:923` | "SMS conversations will appear here." | "No SMS yet. Pax sends from the deal page." | §11 |
| `pages/deals.tsx:217,240,284` | "Something went wrong while building the CSV. Try again." | "Couldn't build the CSV. Try again." | §11 |
| `pages/properties.tsx:1200` | "Something went wrong saving this property…" | "Couldn't save this property. Your form values are still here — try again." | §11 |
| `components/floating-action-button.tsx:48` | "AI Assistant" | "Ask Pax" | §1.2 + persona |
| `components/layout-sidebar.tsx:386-409` | "AI Hub" / "AI Valuations" / "AI-powered property valuations" | "Pax" / "Valuations" / "Comp-based valuation" | §1.2 |
| `components/query-error-state.tsx:77` | default title "Something went wrong" | per-context default; never this string | §11 |

---

## Recommended fidelity priority

Top 10 ranked by (visual-prominence × inverse-repair-effort).

1. **CC-7 buzzword strip** — text search + rewrite removes "AI-powered" /
   "intelligent" / "AI Hub" from auth, sidebar, FAB, onboarding-v2 hype badge.
   High visibility, low effort. **S**
2. **CC-3 "Something went wrong" sweep** — change `query-error-state.tsx`
   default + audit toasts. Low risk; brief explicitly forbids. **S**
3. **CC-2 Card default radius** — flip `card.tsx` from `rounded-2xl` to
   `rounded-card`; review 5-6 callers that need 24px elsewhere. Visual
   prominence: every card on every page. **S**
4. **/onboarding-v2 confetti+PartyPopper deletion** — delete
   `CompletionCelebration` + 8 raw color dots + "Most Intelligent" badge.
   Pre-empts the §13 anti-pattern *before* JC#3's structural redesign. **S**
5. **CC-4 `desert-gradient` theme migration** — rewrite to `var(--acr-bg)` +
   themed brand-soft. Otherwise four of five themes ship a Homestead haze. **S**
6. **/auth tagline + meta rewrite** — three lines in `auth-page.tsx`. First
   thing every signing-in user reads. **S**
7. **/pax persona-leak fix** — gate "Agents" tab + sub-copy on `isFounder`.
   Memory-rule violation; small change, high principle weight. **S**
8. **CC-1 codemod for raw Tailwind tones** — biggest debt by volume. Run a
   semantic-rename codemod + ESLint rule. Touches every page. **L** (with
   protective regression run)
9. **CC-6 chart palette via `--acr-chart-*`** — `useChartPalette()` hook;
   rewire portfolio/pipeline. Themes won't fully ship without this. **M**
10. **Top bar component** — production has none; building one unlocks
    breadcrumbs, ambient AI, notifications surface, dark toggle in their
    expected slot. Largest scope on this list, but fixes a structural §6
    chrome gap. **M**

---

## Surfaces I could not assess from source alone

- **`/founder-dashboard`** — JC#2 covers re-skin scope; I did not re-audit.
- **`/founder/*` family** (`founder-home.tsx`, `founder-ai-observatory.tsx`,
  CompanyChronicle, etc.) — large surface area, brief §14.3 calls out as
  one of six extra-attention surfaces; deserves a dedicated pass.
- **Command palette** (`command-palette.tsx` 814 LOC) — not paired with
  prototype's `command-palette.jsx` (132 LOC) in this audit. Likely drift.
- **Pax rail** (`pax-copilot-rail.tsx` 1,765 LOC) — far larger than any
  prototype Pax surface; structural review needed.
- **Mobile-only behaviors** — prototype `MobileInboxUpgrade` (round3-integrations-2
  line 191) shows a mobile inbox with Pax draft + voice affordance; production
  has no mobile-distinct inbox component.
- **Loading skeletons / error states / empty states at runtime** — source-only
  reads can't confirm these match brief §11 in motion + tone.

These are the honest gaps in the audit's coverage.
