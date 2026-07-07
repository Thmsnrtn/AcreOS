# Founder-mode UX audit — 2026-05-01

Two-persona deep audit of every founder-facing surface.

- **Persona A** — Senior staff engineer reviewing a 7,400-line monolith.
- **Persona B** — Operations-focused UX lead asking "is this where I'd spend 1 hour a week running an autonomous business, or is it a chore?"

Scope: `client/src/pages/founder-home.tsx`, `client/src/pages/founder-dashboard.tsx`, `client/src/pages/founder-*.tsx` (20 files), `client/src/pages/founder/*` (4 files), `client/src/components/founder/*` (32 files), `client/src/components/dashboard/DecisionsInbox.tsx`.

---

## 1. Executive summary — fit-for-purpose verdict

**`/founder-home` is the right product. `/founder-dashboard` is a museum.** The new home is well-composed: status pill, autonomy health card, ranked todo, four-card metric grid, agent grid. It loads in five `useQuery` calls, is 576 lines, uses `FounderPageShell`'s editorial header, and tells a story top-to-bottom. The legacy 7,452-line `founder-dashboard.tsx` mostly contributes operational debt — it banner-marks itself legacy but still hard-codes 173 hooks, mounts 22 inline sub-components, defines duplicate `AGENT_COLORS`/`AGENT_ICONS`/`AGENT_AVATARS` lookup tables, and loads 22 named sub-features via tabs that mostly do not need to be co-located. The home page actually does its job in five sentences; the dashboard wants to do everyone's job and so does none of them well. The most urgent UX risk isn't inside founder mode — it's that customer-facing onboarding still references "Atlas" (the founder-mode CTO codename) at `client/src/components/onboarding/ProductTour.tsx:73-78`, violating the persona-architecture invariant. Fix that before any extraction work.

---

## 2. Persona A — architecture findings

### A1. `useId` is imported but never used. Dead import.
`client/src/pages/founder-dashboard.tsx:1` imports `useId` from React. Zero call sites. Same line: `useEffect`/`useRef`/`useCallback` are used (3 callbacks, one effect for keybindings). **Quick win.**

### A2. `lazy` is imported but never used. Dead import.
`client/src/pages/founder-dashboard.tsx:115` — `import { Suspense, lazy } from "react"`. Only `Suspense` is consumed (one wrapper at line 2120). The whole file does zero `React.lazy(...)` calls — `App.tsx` already lazies `FounderDashboard` itself, but the inline sub-features (MorningBriefing, AgentTeamChat, WarRoom, …) all import eagerly at the top, even when their tab is inactive. **A lazy-load pass on each tab's leaf components is the single biggest perf win available.**

### A3. `FounderNavBar` is defined but never rendered.
`client/src/pages/founder-dashboard.tsx:6577-6634`. Sets up an `IntersectionObserver` over `NAV_ITEMS` ids and hands back a sticky nav. Search in the file: zero render sites. The IDs it observes (`section-overview`, `section-features`, `section-pricing`, `section-growth`, `section-org-health`, `section-users`) still exist in the JSX as scroll anchors (line 2280, 2767, 4705, 4708, 4711, 4714) but the nav that consumes them isn't mounted. ~60 lines of dead code plus its `NAV_ITEMS` constant at line 6559. **Quick win — delete.**

### A4. `MonthlyCheckin` renders unconditionally outside any tab.
`client/src/pages/founder-dashboard.tsx:4721`. The whole legacy dashboard is wrapped in tab guards (`activeTab === "operations"` etc.), but a handful of sections sit outside the tab switch and always mount: `OrgHealthMonitor` (4714), `AIModelsSection` (4717), `SystemApiKeysSection` (4718), `MonthlyCheckin` (4721), `AutopilotStatusBar` (4724). When the user is on the "Growth" tab they're paying the cost of the org-health monitor's polled query and a full monthly check-in render. Either move them into the appropriate tab or unmount them when not active.

### A5. Three concurrent agent-identity registries still exist after the consolidation.
The recent commit `81dccec` introduced `client/src/lib/agent-identity.ts` (letter mark + 4 acr-* tones) and converted the dashboard's `AGENT_COLORS` to a Proxy that delegates (`founder-dashboard.tsx:6906-6908`). But:
- `client/src/lib/trust-language.ts:11-50` still owns `AGENT_FRIENDLY_NAMES`, `AGENT_ROLES`, `AGENT_AVATARS` (emoji), and a separate `AGENT_COLORS` (tailwind color names).
- Eight founder components still import `AGENT_COLORS`/`AGENT_AVATARS`/`AGENT_ROLES` from `trust-language.ts`: `WarRoom.tsx:22`, `MorningBriefing.tsx:22`, `AgentTeamChat.tsx:17`, `PerformanceReviews.tsx:17`, `WorkflowMonitor.tsx:18`, `AgentGrowth.tsx:15`, `SwipeDecisionCard.tsx:19`, `SynergyMap.tsx:11`.
- `client/src/components/founder/DelegationManager.tsx:12` defines yet another mini-`AGENT_NAMES` map.
- `client/src/pages/founder-home.tsx:84` defines yet another `AGENT_NAMES` for *background-job* names (`customer_success`, `growth`, `revenue`, `operations`, `digest`) — different namespace than agent codenames; this one is legitimate but should be co-located with the JOB_TONE table that already lives in `agent-identity.ts`.

The registry in `agent-identity.ts` already has `friendlyName`, `letter`, `tone`, `role`. **Migration target: every consumer reads from `getAgentIdentity()` and derives presentation via `agentTextClass`/`agentBgClass`.**

### A6. Customer-side leak of "Atlas" — persona invariant violation.
`client/src/components/onboarding/ProductTour.tsx:73-78` ships a tour step titled "Ask Atlas Anything" with an Open-Atlas button pointing to `/atlas`. `client/src/components/onboarding-checklist.tsx:56` does the same. `client/src/pages/atlas.tsx` is a stub ("Atlas is coming soon."), and `atlas_cto` is the founder-mode CTO codename (`agent-identity.ts:36`). Memory says: customers see Pax only. This is the single biggest persona-architecture bug currently shipping.

### A7. The dashboard renders Dialog + AlertDialog modals but founder-home and customer side use ResponsiveModal.
`founder-dashboard.tsx` opens 11 `<Dialog>` instances (lines 1944, 1969, 3390, 3802, 3839, 4206, 4590, 4640, 5567, 7321, 7357) — keyboard shortcuts, MRR goal, bulk import, notes, scan, expanded tile, diagnosis, prompt, wizard, agent goal, agent chat. None use ResponsiveModal. On a phone the chat dialog (line 7357) fills the screen with a non-bottom-sheet panel. ResponsiveModal exists in the customer side and is the right primitive for the goal/shortcuts pop-overs at minimum.

### A8. State management — useState soup.
`FounderDashboard()` body (line 1081-1166) declares **23 individual `useState` slots** before the queries even start. Categories blur together: form drafts (`notesValue`, `goalInputValue`, `bulkImportJson`), tracking sets (`testingEndpoints`, `selectedEndpoints`, `selectedEscalations`), modal flags (8 boolean opens), in-flight tracking (`testingDataSources`, `diagnosingEndpoint`), persisted prefs (`activeTab`, `goalCents`). The localStorage reads run inline in `useState` initializers (lines 1085, 1115-1117), which is fine but brittle (no zod parsing). A reducer-per-section split would reduce this to 4-5 reducers (tab/prefs, escalations, scan-flow, goal-flow, agent-team-chat) and cut churn-y re-renders. Current structure also forces every keystroke in any modal to re-render the whole 7K-line tree.

### A9. Heavy lucide imports — 60+ icons in one file.
`founder-dashboard.tsx:21-107` imports 60 lucide icons. Vite tree-shakes per-import so the bundle isn't the killer (each icon is its own chunk), but visually the import block alone is 86 lines and several icons are unused. A grep against the file shows `Building2`, `UserPlus`, `Eye`, `Check`, `MapIcon`, `MapPin`, `HandHelping`, `Search`, `Tag`, `Percent`, `Radio`, `MousePointerClick`, `BarChart`, `Pause`, `ChevronRight`, `ChevronLeft`, `RotateCcw`, `Layers`, `Users2`, `HelpCircle`, `CircleCheck`, `CircleX`, `Minus`, `CalendarCheck` may be unreferenced or only-once-referenced. **Worth a sweep when extracting.**

### A10. Polling cascade.
The dashboard tab fires **17 distinct polled queries** at minimum once a tab is opened (intervals from 3s to 60min). On the Operations tab alone: action-queue (5min), org-health-monitor (10min), customer-health, escalations, support-analytics. None are gated on `document.visibilityState`. On a long-lived founder session the network panel never goes quiet. `useQuery({ refetchIntervalInBackground: false })` was set on `SophieActivityPreview` (line 612) — it should be the default for everything in this dashboard.

### A11. Per-tab `enabled:` guards do not match the JSX.
Lines 1174-1471 set `enabled: activeTab === "operations"` etc. on each query. But the legacy "always on" sections (4714-4724) mount queries inside their own components without that guard. Net effect: switching tabs disables some queries but leaves the org-health and pricing queries hot regardless. Either drop the `enabled` guards (and accept the cost), or move every query into its tab.

### A12. Trend annotations lie about direction.
`MetricCards` in `founder-home.tsx:382-384` flags an "Active customers" trend with `up: true` whenever `newOrgsLast30Days > 0`. There's no "down" path even when net-new is negative (the data only carries `newOrgsLast30Days`, not net change). Either compute net or drop the up arrow when there's no signed delta to back it. Same shape: `nps` trend at line 389 sets `up: nps >= 0` — for an NPS of -100 to -1 this still draws TrendingDown, but for NPS of 0 it draws TrendingUp, which is wrong-side-of-zero behaviour. Cap NPS at "≥30" for up, "≤-30" for down, otherwise neutral.

### A13. `AGENT_ICONS` is defined inside `founder-dashboard.tsx` (line 6889).
Ten entries, used twice (lines 7019, 7234). Belongs in `agent-identity.ts` next to the registry — or kill it and use the letter mark (which is the whole point of the consolidated registry).

### A14. `Crown` icon for the greeting and `Flame` for focus mode.
`founder-dashboard.tsx:536, 2041`. Per memory the founder shell wants "considered, not loud" — Crown + Flame is the opposite. The new `/founder-home` correctly uses Sun/Moon/Sunset for greeting time and a `ShieldCheck`/`ShieldAlert` for autonomy. Old dashboard's iconography is louder than its purpose.

### A15. `briefingRef` never used.
`founder-dashboard.tsx:1121` declares `useRef<HTMLDivElement>(null)` and attaches it at line 2116 to wrap `<MorningBriefing />`. No `briefingRef.current` reads anywhere in the file. **Quick win — delete.**

---

## 3. Persona B — operational findings

### B1. /founder-home metric cards — 3 of 4 are right; the fourth wobbles.
MRR + Active customers + Customer satisfaction + Churn risk is a defensible four. The churn-risk card is the strongest of the bunch — it switches between forward-looking "X at risk · Y% projected" and backward-looking "N churned (30d)" with the right precedence. **However**, "Customer satisfaction" labelled NPS without showing scale (-100 to 100) is confusing the first time someone sees a -40 there. Either label "NPS" or include a scale tooltip. The 0-response state ("No responses yet") is honest — keep it.

### B2. The metric grid lacks a primary "what changed since last visit" beat.
You see four current values, no Δ-since-last-week. The agent grid says "Last ran 2 hours ago" but the executive metrics don't say "+$340 MRR / -2 NPS / -1 customer this week". The first 5 seconds of a daily check should answer "what moved overnight?" — the current metric cards answer "what is the level today?". Recommend a "vs. last week" row under each card.

### B3. WhatNeedsYouCard top-5 — surfaces are right, cascade annotation is missing.
`founder-home.tsx:159-229`. The card shows urgency tint, type, badge, impact, and links to `/founder/todo`. **It does not surface `autoResolveCandidate` or `cascadeHints`** — `founder-todo.tsx:111-150` has an `AutoResolveReviewPanel` that reads `autoResolveCandidate`. The home preview ignores this signal. So a founder reading the home page sees five items as equally founder-required when 1-2 might already be auto-resolvable. Easy fix: dim or hide auto-resolve candidates in the top-5 (or surface them with a "cascade may resolve" badge).

### B4. AutonomyHealthCard — clear top, buried bottom.
`founder-home.tsx:231-285`. The verdict + recommended action read well. The 5-dimension grid below uses 11px font, dot colors, and `title=` tooltips — on hover-only mediums (mobile, keyboard nav) the `note` is unreachable except via `aria-label`. Make `note` visible on focus, not just hover/title.

### B5. Agent status grid — useful but low signal.
`founder-home.tsx:416-491`. Five generic agents (`customer_success`, `growth`, `revenue`, `operations`, `digest`) — note these are *job names*, not the founder roster from `agent-identity.ts` (Atlas/Sophie/Forge/etc). The card says "Last ran 2 minutes ago", "Paused by you", "Has not run yet", "Error: …". That's exactly the right level. **What's missing:** counts. "Sophie ran 12 times today, no errors" tells me more than "ran 2 minutes ago". And the toggle-pause AlertDialog at line 454-480 is appropriate friction.

### B6. Trust score is correctly hidden — verify across surfaces.
`founder-home.tsx` does not show a numeric trust score; agent rows just show status. Per memory: "trust score is a relationship description, not a metric". Spot-check `trust-language.ts:81-99` — `describeTrust()` and `trustLabel()` return strings like "Highly trusted". But `trustBadgeColor()` (105) is still colour-coded by score-band, and `founder-dashboard.tsx:150` imports `trustLabel, trustBadgeColor`. Acceptable — labels stay non-numeric.

### B7. /founder-dashboard tabs by visit-frequency.
Group as the brief asks:
- **Daily-driver work** (should mostly be on /founder-home now): Overview tab (MorningBriefing, TrendCards, SwipeDecisions, FocusCard), Operations tab top half (ActionQueuePanel, CustomerHealthPanel).
- **Weekly:** Operations tab middle (DelegationManager, OutcomeFeedback, WarRoom, WorkflowMonitor, InitiativeBoard), Agents tab top half (AgentTeamChat, ActivityTimeline, CompanyBriefingPanel, AgentTeamPanel), Growth tab (MRRTrajectory, ForecastPanel, ChurnIntelligence, GrowthEngine, NewSubscriberFeed).
- **Monthly or once:** Operations tab bottom (PlaybookManager, DecisionQuality, ScenarioEngine, StrategicCompass, FounderWellbeingCard, CompanyChronicle), Agents tab bottom (DecisionAutopilot, AgentGrowth, FounderTwin, AgentDebatePanel, PerformanceReviews, SynergyMap, InstitutionalMemory), Infrastructure tab in full.
- **Configuration / one-time:** AbsenceMode (line 2191), AIModelsSection (4717), SystemApiKeysSection (4718), FeatureFlagsSection (in /founder/features now), PricingSection (5046), LaunchReadinessSection (6688).

The Agents tab is a graveyard — 10 components stacked. Real founder behaviour: 80% of trips to Agents = "talk to my team" (AgentTeamChat) + "what did they do" (ActivityTimeline). The other 8 are research surfaces.

### B8. Visual differentiation — partial.
Brief asks for "subtle accent + denser layout" on founder mode. `FounderPageShell` (`components/founder/founder-page-shell.tsx:40-65`) reuses the same `acr-cc-hero` pattern as customer mode — same eyebrow class, same greeting class, same hero spacing. There is no visible accent stripe, no monospace tabular density tweak, no different background tint. The legacy dashboard does *more* differentiation than the new shell: Crown icon, gradient hero, MRR goal progress bar — but in a kitchen-sink way. The new shell errs on the other side: identical to customer. **Recommend: a single accent (left-edge stripe in `var(--acr-brand)` on every FounderPageShell, OR an "FOUNDER MODE" eyebrow always-visible) so the founder always knows which side they're on.**

### B9. FounderPageShell adoption is thin.
Only 2 of 22 founder pages use it: `/founder-home` and `/founder-tools`. The other 20 (`founder-letter`, `founder-strategy`, `founder-decisions`, `founder-todo`, `founder-trends`, `founder-experiments`, etc.) still call plain `PageShell`. So today, navigating `/founder-home` → `/founder/decisions` is a literal hard-stop in chrome — eyebrow disappears, layout changes, page title comes from `useDocumentTitle` only. Migrate all `/founder/*` pages to `FounderPageShell` before adding the accent in B8.

### B10. Mobile bottom nav renders on founder pages too.
`App.tsx:1021` mounts `MobileBottomNav` for any signed-in user. `MobileBottomNav.tsx` reads `mobileItems` from `useNavPreferences()` — which is the customer-side mobile pinning. So a founder on a phone sees four customer nav items + "More". There's no founder-specific bottom nav. Either (a) suppress on `isFounder` routes (so the founder uses sidebar only), or (b) ship a founder-specific bottom nav with `/founder-home`, `/founder/todo`, `/founder/decisions`, `/founder-letter` + More.

### B11. Keyboard shortcuts (R/F/G/?) are discoverable on /founder-dashboard but not /founder-home.
`founder-dashboard.tsx:1147-1165` registers R/F/G/?. The `?` modal lists them. **`/founder-home` registers no shortcuts at all** — no refresh, no help, no jump-to-todo. If founder-home is the daily driver, `R` (refresh-all) and `J` (jump to todo) and `?` should at minimum work there too. The current state is backwards: the legacy page has the affordances, the new page has none.

### B12. `MorningBriefing` (component) and `WhatNeedsYouCard` (home) overlap.
`MorningBriefing` (component used inside the dashboard's Overview tab) renders agent updates, trust updates, pending decisions, headline. `WhatNeedsYouCard` renders the top-5 todo. Founder reads two separate "here's what's happening" surfaces depending on which page. The home wins on density and ranking; MorningBriefing wins on agent voice ("Sophie checked in", "Forge closed two deals"). **Recommend folding the agent-voice updates into a collapsed "what your team did overnight" section on /founder-home, then deleting MorningBriefing's standalone card.**

### B13. AgentTeamChat is buried inside the dashboard's Agents tab in a 360px-fixed scrollable card.
`founder-dashboard.tsx:2137`. A chat surface that's 360px tall on a 14" laptop is a chore. Promote AgentTeamChat to a side rail (similar to PaxRail on customer side) or a dedicated `/founder/team-chat` route.

### B14. The legacy dashboard's "Focus mode" toggle is unfinished.
`founder-dashboard.tsx:1156-1158`, `2038-2048`. Pressing F toasts and renders an amber banner saying "showing critical sections only" — but the JSX never actually conditionally hides anything based on `focusMode`. The banner is the only visible effect. **Either implement the hide-non-critical filter, or remove F.** (Persona B note: "focus mode" with no actual filtering is worse than no focus mode — it lies.)

### B15. The "Email Digest" button in GreetingHeader has no preview.
`founder-dashboard.tsx:584-583` (button) → `digestMutation.mutate()`. A digest email is an outbound action with content the founder hasn't seen. No preview, no "send to me as a test" affordance. The brief calls founder mode taste-defining — sending blind email is the opposite.

---

## 4. Top-5 extractions from /founder-dashboard, ordered

Effort = days of work. Value = how often the extraction unblocks daily-check, mobile, or refactor velocity. Score = value / effort.

| # | Sub-feature (current location) | New route | Effort | Value | Why |
|---|---|---|---|---|---|
| 1 | `AIModelsSection` + `SystemApiKeysSection` (lines 4732, 4843) → `/founder/keys` | 0.5d | High | These are config surfaces visited maybe twice ever per founder — they should not be in the daily-check page. Both already self-contained query+mutation flows. Fastest extraction. |
| 2 | `LaunchReadinessSection` (6688) → `/founder/readiness` | 0.5d | High | One-time pre-launch checklist that today renders on the Infrastructure tab. Keep the API call, move the surface. |
| 3 | `OrgHealthMonitor` (6351) + `ChurnRiskPanel` (839) + `MRRTrajectory` (imported at 112) → `/founder/customers/health` | 1.5d | High | The single most useful "weekly review" surface — currently scattered across Operations and Growth tabs. A dedicated route with a polled tile grid is exactly the once-a-week-deep-dive shape the brief calls for. |
| 4 | `GrowthSection` (5312) — full ad-account + creative-bundle + campaign wizard → `/founder/growth/campaigns` | 3-5d | Med | This thing is **2,000 lines** inside the dashboard (5312 → ~6000). It contains a 4-step wizard, ad-account form, attribution feed, creative bundle UI, ANGLE_ICONS/ANGLE_COLORS lookup tables. It does not belong on the daily dashboard. Extracting unblocks the rest of the file. |
| 5 | `ActionQueuePanel` (6111) — already overlaps `/founder/todo` | merge into `/founder/todo` (0.5d) | High | The same 7-source ranking lives in two places (server: `/api/founder/intelligence/todo` for the home + `/api/founder/action-queue` for the dashboard panel). Pick one server endpoint and one client surface. |

Honorable mentions for later: the entire Infrastructure tab → already partly at `/founder/integrations` and `/founder-traces` — the rest (`SystemActivityPanel`, `JobHealthPanel`, `JobQueueHealth`, `ThePulse`) wants `/founder/observability`. The whole "Agents tab graveyard" → split into `/founder/agents/team` (chat + activity), `/founder/agents/performance` (PerformanceReviews + AgentGrowth + DecisionQuality), `/founder/agents/research` (FounderTwin + AgentDebatePanel + SynergyMap + InstitutionalMemory).

---

## 5. Quick wins (under 30 minutes each)

1. **Delete dead imports** — `useId` (`founder-dashboard.tsx:1`), `lazy` (115). [5 min]
2. **Delete `FounderNavBar`** (6577-6634) and `NAV_ITEMS` (6559) — never rendered. [10 min]
3. **Delete `briefingRef`** — declared at 1121, unused. [2 min]
4. **Fix Atlas-leak in customer onboarding** — replace "Atlas" with "Pax" in `client/src/components/onboarding/ProductTour.tsx:73-78` and in `client/src/components/onboarding-checklist.tsx:56`. Per persona-memory. [15 min]
5. **Hide `MobileBottomNav` on founder routes** — wrap the mount in `App.tsx:1021` with `!isFounderPath || …`. Until a founder bottom-nav ships, sidebar is the right primitive. [10 min]
6. **Register R / ? keyboard shortcuts on /founder-home** — copy the handler shape from `founder-dashboard.tsx:1147-1165`, drop F and G (the goal/focus features don't exist on the new page). [25 min]
7. **Surface `autoResolveCandidate` in WhatNeedsYouCard** — dim or "auto-resolving" badge on the top-5 list (`founder-home.tsx:197-223`). The data is already on the response (per `founder-todo.tsx:55-59`). [25 min]
8. **Remove "Focus mode" toggle** until it does something — `founder-dashboard.tsx:1156-1158`, `2038-2048`. Banner-without-filter is worse than nothing. [10 min]
9. **Drop `Crown` icon from greeting** — it's the louder-is-not-better pattern. Replace with the time-of-day icon (Sun/Moon/Sunset) the new home already uses. `founder-dashboard.tsx:536`. [5 min]
10. **Add `refetchIntervalInBackground: false` as a dashboard default** — wrap or extend the QueryClient defaults for the founder side. Stops 17 polls per tab while the tab is hidden. [25 min]
11. **Inline the `AGENT_NAMES` map in /founder-home** into `agent-identity.ts` as a `JOB_NAMES` constant — colocates with `JOB_TONE`. [15 min]
12. **Delete `AGENT_AVATARS` (emoji map) from `trust-language.ts`** if every consumer can switch to the letter-mark+tone pattern; defer until next surfaces are touched. (longer than 30min in practice — moved to §6).

---

## 6. Multi-day projects to schedule

### M1. Migrate every `/founder/*` page to `FounderPageShell` (1-2 days)
Today only 2 of 22 use it. After migration, founder mode has one consistent header pattern and the (B8) accent stripe lands once.

### M2. Founder-mode visual differentiation pass (1 day)
Once M1 is in place: add a single accent (left-edge `var(--acr-brand)` stripe on the hero, or an always-visible "FOUNDER MODE" eyebrow tag with a subtle rule line). One PR, one design call. Everything inherits.

### M3. Consolidate three agent-identity registries → one (1.5 days)
Migrate the eight components (`WarRoom`, `MorningBriefing`, `AgentTeamChat`, `PerformanceReviews`, `WorkflowMonitor`, `AgentGrowth`, `SwipeDecisionCard`, `SynergyMap`) off `AGENT_AVATARS`/`AGENT_ROLES`/`AGENT_COLORS` from `trust-language.ts`. Replace with `getAgentIdentity()`/`agentTextClass()`/`agentBgClass()` and the letter-mark in place of emoji. Delete `AGENT_AVATARS`/`AGENT_ROLES`/`AGENT_COLORS` from `trust-language.ts`. Per JC product-call #11.

### M4. Extract the top-5 sub-features from §4 (5-7 days, sequenced)
In order: keys → readiness → customers/health → todo-merge → growth/campaigns. After this the legacy file should be ~3,500 lines and `founder-dashboard.tsx` becomes the "ops research" tab — daily check is fully owned by `/founder-home`.

### M5. Founder-side bottom nav for mobile (1 day)
Either (a) suppress `MobileBottomNav` on founder routes and ensure sidebar Drawer works one-handed, or (b) introduce `FounderMobileBottomNav` with `/founder-home`, `/founder/todo`, `/founder/decisions`, `/founder-letter`. Pick one before launch.

### M6. Reducer-based state for the legacy dashboard's surviving form/scan flows (1 day)
Once §4 extractions land, the remaining flows (escalation scan, bulk import, prompt generation, agent chat) are well-bounded. Replace the 23 `useState` slots with 4 reducers — kills re-render thrash on keystrokes.

### M7. Server-side: pick one between `/api/founder/intelligence/todo` and `/api/founder/action-queue` (0.5d server, 0.5d client)
Currently both endpoints return overlapping ranked-action data. Standardise on the cascade-aware `intelligence/todo` shape. Delete `action-queue` once `ActionQueuePanel` is folded in.

### M8. Performance review of polling (1 day)
Audit every `refetchInterval` on the founder side. Default `refetchIntervalInBackground: false`. Convert hour+ intervals (`CompanyBriefingPanel` at 60min/30min) to manual refresh + a "last refreshed" timestamp. Aim: a paused founder tab should fire zero requests per minute.

### M9. Native chat surface for AgentTeamChat (2-3d)
Promote out of the 360px-fixed dashboard card. Either side rail (`PaxRail`-style on the founder side), or a `/founder/team-chat` page with proper history pane.

---

## 7. What I'd ignore

A few things called out in the brief that I think are noise:

- **Modal scrutiny** on the dashboard — yes, it's all `Dialog` not `ResponsiveModal`, but the modals (keyboard-shortcuts help, MRR goal entry, scan dialog, prompt dialog) are configuration/edge surfaces. Not worth changing until those features themselves move (see §6 M4). The two that *do* matter on mobile (chat, agent goal) extract anyway in M9.
- **"Are the right four metric cards on /founder-home"** — yes, they are. Don't redesign the four. Add a Δ row (B2) and ship.
- **`/founder/feature-flags` exists alongside `/founder/features`** — already a `Redirect` at `App.tsx:557-559`. Solved.
- **Suspense fallback inside the dashboard** (line 2120) — `<div className="animate-pulse h-32 rounded-xl bg-muted" />`. Should be a proper Skeleton, but the parent will be deleted in M4 anyway. Skip.

---

## 8. Cross-cutting risks

- **Persona leak (Atlas in customer onboarding)** is the only cross-cutting risk that's launch-blocking. §5 Quick win 4 — fix today.
- **No founder-specific mobile pattern.** A founder demoing on phone is currently in customer chrome. §6 M5 — fix before launch.
- **Polling never quiets.** §6 M8 — pre-launch, but not blocking.
- **Three agent registries** — internal-quality issue, not user-visible. Schedule M3.

---

End of audit.
