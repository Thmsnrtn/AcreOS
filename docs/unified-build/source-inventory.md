# AcreOS Unified Build — Source Inventory

Compiled 2026-04-25 by the unified build (Phase 1.1) from the prototype at `/acreos/*.jsx` and the master spec at `handoff/HANDOFF.md`. The 12 supporting handoff docs (`ROUTE_MAP.md`, `COMPONENT_MAP.md`, `TOKENS.md`, `GLOBALS_AUDIT.md`, `DATA_SHAPES.md`, `STATES_CHECKLIST.md`, `ONBOARDING_API.md`, `TWEAKS_DECISIONS.md`, `RESPONSIVE.md`, `A11Y_CHECKLIST.md`, `DEMO_SCRIPT.md`, `walkthrough.html`) referenced by `handoff/README.md` are **not present** in the zip. Their content has been reconstructed from `HANDOFF.md` body sections and the prototype source directly. Where reconstruction is uncertain, sections below say so.

## 0. Production-side reality — load-bearing context

The prototype is ~30 routes. Production is **164 routes** (`grep -c "<Route" client/src/App.tsx`). The mega prompt's framing is "rebuild from prototype" but in context the prototype is a *visual specification layered onto the existing functional codebase*, not a wholesale replacement.

**Refinement work to preserve.** The repo has **394 slices** of `[elite-refinement]` commits ending at slice 394 (2026-04-25). Every refinement adds detailed accessibility (`ul/li` semantics, `aria-label`, `aria-busy`, `role=radiogroup`, `section` landmarks, sentence-case copy, keyboard tooltips, `tabular-nums`, etc.) to specific components by name. The mega prompt's hard guardrail "Modifying refinement work" forbids undoing this. Therefore the build **applies design tokens and visual treatment to existing production components** — it does not paste prototype JSX into `client/src/pages/`.

**Existing production assets relevant to this build:**
- `client/src/components/ui/` — 60+ shadcn primitives (accordion, alert-dialog, button, card, command, dialog, drawer, form, input, etc.). Plus app-specific (animated-counter, conversion-funnel, deal-journey).
- `client/src/hooks/` — `use-feature-flags.ts` already exists; `use-keyboard-shortcuts.tsx` exists. **Phase 1.5 should extend the existing flag hook, not create a parallel one.**
- `client/src/stores/` — does **not** exist yet. Zustand modal store will be the first occupant.
- Stack: Vite 7.3, React 18.3, TS 6.0.2, Tailwind 3.4.19, Radix (27 packages, the shadcn base), framer-motion 12.38, Tanstack Query 5.95, wouter 3.9.
- **Missing dependencies:** `zustand`, `sonner` — install in Phase 1.3.
- Tailwind config exists at repo root: `tailwind.config.ts`. Extend, do not replace.

**Production-only routes the prototype never addresses** are inventoried in `handoff/GAPS.md` (Tier 0–3). The unified build's Phase 8 Coverage Pass applies the design system to those uncovered surfaces; the build does not redesign them.

---

## 1. Tokens — exact values to lift

All color tokens are defined per theme in `acreos/theme.jsx`. Five themes exist (homestead, quarry, nocturne, meadow, titan) with light and dark variants. **Homestead light is the canonical brand** (verified — `#C2531C` brand, `#FAF4E8` bg both confirmed in `acreos/theme.jsx`). The full set of theme color values is in `theme.jsx`; this inventory lists homestead light.

### COLORS — homestead light

| Token | Value | Role |
|---|---|---|
| `--bg` | `#FAF4E8` | page background |
| `--bg-sunken` | `#F1E9D6` | inset/recessed surface |
| `--bg-raised` | `#FFFBF1` | elevated surface |
| `--surface` | `#FFFBF1` | card surface |
| `--surface-2` | `#F3EAD4` | secondary card surface |
| `--sidebar-bg` | `#F1E7D0` | sidebar fill |
| `--sidebar-ink` | `#2B1B0A` | sidebar text |
| `--ink` | `#241607` | primary text |
| `--ink-2` | `#5A4424` | secondary text |
| `--ink-3` | `#8F7A52` | tertiary text |
| `--ink-4` | `#BAAA85` | disabled / muted text |
| `--line` | `rgba(80, 40, 15, 0.14)` | normal border |
| `--line-soft` | `rgba(80, 40, 15, 0.07)` | subtle border |
| `--brand` | `#C2531C` | primary brand (terracotta) |
| `--brand-ink` | `#FFFBF1` | text on brand fill |
| `--brand-soft` | `rgba(194, 83, 28, 0.14)` | brand-tinted background |
| `--accent` | `#4C7B80` | secondary accent (teal) |
| `--pos` | `#3B7C2E` | positive / success |
| `--pos-soft` | `rgba(59, 124, 46, 0.14)` | positive-tinted |
| `--warn` | `#C48A1E` | warning (amber) |
| `--warn-soft` | `rgba(196, 138, 30, 0.14)` | warning-tinted |
| `--neg` | `#B33419` | negative / error |
| `--neg-soft` | `rgba(179, 52, 25, 0.14)` | negative-tinted |
| `--ring` | `0 0 0 3px rgba(194, 83, 28, 0.28)` | focus-visible outline |
| `--glow` | `rgba(194, 83, 28, 0.35)` | backdrop emphasis |
| `--chart-a` | `#C2531C` | chart color 1 |
| `--chart-b` | `#4C7B80` | chart color 2 |
| `--chart-c` | `#C48A1E` | chart color 3 |
| `--chart-d` | `#3B7C2E` | chart color 4 |

**Founder-purple:** Per HANDOFF.md §5, founder mode uses a deep purple. Specific value not located in `theme.jsx` excerpt — extract from `pages-tier2345.jsx` or `app.jsx` founder branch at extraction time.

### SPACING — `acr-` scale

From `acreos/shell.jsx` SHELL_CSS. 4px-grid based.

| Token | Value |
|---|---|
| `acr-4` | 4px |
| `acr-8` | 8px |
| `acr-12` | 12px |
| `acr-16` | 16px |
| `acr-24` | 24px |
| `acr-28` | 28px |
| `acr-32` | 32px |
| `acr-48` | 48px |

Sidebar widths: `--sidebar-width: 240px` expanded, `--sidebar-width-collapsed: 60px`.

### BORDER RADIUS

| Token | Value | Usage |
|---|---|---|
| `acr-r-sm` | 6px | button, input, kbd |
| `acr-r-md` | 8px | nav item, modal, search |
| `acr-r-lg` | 12px | cards |
| `acr-r-xl` | 14px | large cards, modals |
| `acr-r-full` | 999px | pills |

### SHADOW — homestead light

| Token | Value | Usage |
|---|---|---|
| `--shadow-1` | `0 1px 2px rgba(60,30,8,0.06)` | cards at rest |
| `--shadow-2` | `0 1px 2px rgba(60,30,8,0.06), 0 8px 22px -6px rgba(60,30,8,0.16)` | hover, dropdown |
| `--shadow-3` | `0 2px 4px rgba(60,30,8,0.08), 0 22px 50px -12px rgba(60,30,8,0.22)` | modal, overlay |

### TYPE — scale

Font families per HANDOFF.md §5: display, body, mono. Specific font-family declarations not extracted into single source; pull from `theme.jsx` and `round3-css.jsx` at Phase 1.2.

| Role | Size | Weight | Line-height | Letter-spacing |
|---|---|---|---|---|
| display | 44px | 600 | 1 | -0.03em |
| h1 | 38px | 500 | 1.1 | -0.02em |
| h2 | 22px | 500 | 1.2 | -0.015em |
| h3 | 18px | 600 | 1.2 | -0.02em |
| body | 13px | 400 | 1.5 | normal |
| small | 12px | 400 | 1.4 | normal |
| mono | 11.5px | 600 | 1.3 | 0.02em |

### MOTION

Durations and easings from `acreos/round3-css.jsx`:

| Token | Value | Usage |
|---|---|---|
| `--fast` | 120ms | hover, state change |
| `--normal` | 240ms | modal in, transition |
| `--slow` | 320ms | layout shift, page enter |

Easings: `cubic-bezier(0.25, 0.46, 0.45, 0.94)` standard; `cubic-bezier(.22, 1, .36, 1)` spring-like (modals, reveals); `ease-in-out` for fades.

### Z-INDEX

| Layer | Value |
|---|---|
| sidebar | 10 |
| topbar | 20 |
| drawer (mobile sidebar) | 30 |
| modal / dialog | 9100 |
| toast host | 9999 (conventional) |
| tour overlay | follows modal stack |

---

## 2. Canonical components — port targets

From `acreos/app.jsx` switch (lines 122–173). Highest letter wins per HANDOFF.md §3. Confirmed by direct read.

| Route key | Canonical | File | Older versions to ignore |
|---|---|---|---|
| `home` | `CommandCenterC` | pages-tier1.jsx | CommandCenter, CommandCenterB |
| `inbox` | `InboxC` | pages-tier1.jsx | Inbox, InboxB |
| `pipeline` | `Pipeline` | pages-tier1.jsx | — |
| `parcels` | `ParcelDetailB` | pages-tier1.jsx | ParcelDetail |
| `contacts` | `Contacts` | pages-tier1.jsx | — |
| `calendar` | `CalendarPage` | pages-tier1.jsx | — |
| `buybox` | `BuyBoxes` | pages-tier2345.jsx | — |
| `lists` | `Lists` | pages-tier2345.jsx | — |
| `campaigns` | `Campaigns` | pages-tier2345.jsx | — |
| `perf` | `CampaignPerf` | pages-tier2345.jsx | — |
| `offers` | `Offers` | pages-tier2345.jsx | — |
| `documents` | `Documents` | pages-tier2345.jsx | — |
| `finance` | `SellerFinance` | pages-tier2345.jsx | — |
| `dispos` | `Dispositions` | pages-tier2345.jsx | — |
| `pax` | `Pax` | pax.jsx | — |
| `agents` | `AgentWorkspace` | pages-tier2345.jsx | — |
| `automation` | `Automations` | pages-tier2345.jsx | — |
| `audit` | `AuditLog` | pages-tier2345.jsx | — |
| `team` | `Team` | pages-tier2345.jsx | — |
| `billing` | `Billing` | pages-tier2345.jsx | — |
| `integrations` | `Integrations` | pages-tier2345.jsx | — |
| `settings` | `SettingsC` | settings.jsx | Settings |
| `founder` | `FounderHomeC` | (in founder pages — grep at port time) | FounderHome, FounderHomeB |
| `founder-rev` | `FounderRevenueC` | (founder pages) | FounderRevenue |
| `founder-tenants` | `FounderTenants` | (founder pages) | — |
| `founder-cost` | `FounderCost` | (founder pages) | — |
| `founder-ops` | `FounderOps` | (founder pages) | — |
| `atlas-run` | `AtlasRunC` | (founder pages) | AtlasRun |
| `digest` | `WeeklyDigestEmail` | round3-integrations-css.jsx | — |

**Procedure when porting a surface:** open `acreos/app.jsx` switch, find the case key, follow the `window.X ? <X /> : ...` ladder, take the highest-letter component that exists. Then `grep "ComponentNameC ="` to find its definition. Older versions stay in the prototype but **do not get ported** — they were design alternates.

---

## 3. Globals — every `window.*` and its replacement

| Global | Prototype role | Production replacement | Fate |
|---|---|---|---|
| `window.__nav(id)` | navigate to page id | `useLocation()` from wouter, `<Link>` | Replace |
| `window.__acr.openLost(deal)` | open lost-reason modal | `useModals().openLostReason(deal)` (Zustand) | Replace |
| `window.__acr.openClosed(deal)` | open deal-closed celebration | `useModals().openDealClosed(deal)` | Replace |
| `window.__acr.openQuickOffer()` | open ⌘N quick-offer modal | `useModals().openQuickOffer()` | Replace |
| `window.__founderMode` | sidebar shows founder routes | `useIsFounder()` (server-checked) | Replace |
| `window.__r3SoundOn` | ambient sound on/off | `useSettings().soundEnabled` | Replace |
| `window.__playSound(kind)` | play tick/chime | `useSound()` hook | Replace |
| `window.__pageState` + `acr-state` event | force empty/loading/error overlay | **Delete.** Tanstack Query handles this | Remove |
| `window.__acrLaunchTour()` | replay tour | `useTour().restart()` | Replace |
| `window.toast({label,kind})` | toast notification | `sonner`: `toast.success(label)` etc. | Replace |
| `window.ToastHost` | toast container | `<Toaster />` from sonner at app root | Replace |
| `window.PageTransition` | route fade | Framer Motion `<AnimatePresence>` keyed on location | Replace |
| `window.StateOverlay`, `StatesController`, `PageStateListener` | Tweaks state preview | **Delete entirely** | Remove |
| `window.GuidedTour` | tour overlay | replaced by real tour | Delete |
| `window.__regenIndex` | cycle AI draft variants | real model call or deterministic dev stub | Replace |
| `window.CommandCenterC`, `InboxC`, etc. | version override pattern | **Delete pattern.** Import canonical name directly | Remove |
| `window.TIER_B_CSS`, `TIER_C_CSS`, etc. | CSS-string accumulation | Tailwind utilities | Delete |
| `window.AudioContext` / `webkitAudioContext` | sound effects | Web Audio API via `useSound()` | Native API |
| `window.THEMES` / `window.useTheme` | theme registry / applier | app context, `useTheme()` hook | Move to context |

**Every `window.*` reference in the prototype must result in either (a) a hook call, (b) a router action, or (c) a delete. None survive the port.**

---

## 4. Data shapes — production API contract

From `acreos/data.jsx`. All listed as TypeScript interfaces.

```typescript
interface Deal {
  id: string;                // "D-2201"
  parcel: string;            // APN "37-091-014"
  county: string;            // "Costilla, CO"
  acres: number;
  owner: string;
  askingK: number;           // thousands
  atlasScore: number;        // 0-100
  stage: string;             // "Offer Sent", etc.
  intent: "high" | "medium" | "low";
  lastTouchH: number;
  mailSent: number;
  temp: "hot" | "warm" | "cold";
}

interface Task {
  id: string;
  title: string;
  due: string;               // "Today · 2:30 PM" formatted
  dealId?: string;
  priority: "high" | "medium" | "low";
  agent?: "atlas" | "pax" | "sophie";
}

interface Activity {
  id: string;
  t: string;                 // "8m", "1h", "1d"
  who: string;
  msg: string;
  kind: "atlas" | "pax" | "inbound" | "sophie" | "system";
}

interface Metrics {
  pipelineValue: number;     // cents
  pipelineDeltaPct: number;
  dealsInFlight: number;
  mailSent7d: number;
  mailDelta7d: number;
  repliesRate: number;
  repliesDelta: number;
  closedMTD: number;         // cents
  closedDelta: number;
}

interface InboxMessage {
  id: string;
  channel: "email" | "sms" | "mail" | "call";
  from: string;
  subj: string;              // empty for SMS
  preview: string;
  time: string;
  dealId?: string;
  unread: boolean;
  tone: "inbound" | "internal" | "system";
}

interface BuyBox {
  id: string;
  name: string;
  states: string[];
  acres: string;             // range string for display
  priceMax: number;          // cents
  score: number;
  active: boolean;
  matches: number;
}

interface List {
  id: string;
  name: string;
  source: string;
  count: number;
  enriched: number;
  cost: number;              // dollars
  created: string;
  status: "ready" | "enriching" | "error";
}

interface Campaign {
  id: string;
  name: string;
  channel: "mail" | "sms" | "email" | "phone";
  status: "active" | "paused" | "scheduled";
  sent: number;
  replies: number;
  offers: number;
  deals: number;
  spend: number;             // dollars
  roi: number;               // 4.2 = 4.2x
  start: string;
}

interface AgentRun {
  id: string;
  agent: "Atlas" | "Pax" | "Sophie";
  task: string;
  status: "running" | "review" | "completed" | "failed";
  progress: number;          // 0-1
  started: string;
  cost: number;              // dollars
}

interface Automation {
  id: string;
  name: string;
  trigger: string;
  status: "active" | "paused" | "error";
  runs7d: number;
  successRate: number;       // 0-100
}

interface FounderMetrics {
  mrr: number; mrrDelta: number;
  arr: number; arrDelta: number;
  activeTenants: number; tenantsDelta: number;
  trials: number; trialsDelta: number;
  netRev30d: number; netRev30dDelta: number;
  agentCost30d: number; agentCost30dDelta: number;
  grossMargin: number;       // 0.806 = 80.6%
  grossMarginDelta: number;
  nps: number; npsDelta: number;
}

interface FounderTenant {
  id: string;                // "T-0042"
  name: string;
  plan: "Starter" | "Growth" | "Scale";
  mrr: number;
  seats: number;
  health: number;            // 0-100
  lastActive: string;
  signups: string;
  owner: string;
}

interface TeamMember {
  id: string;
  name: string;
  email: string;
  role: "Owner" | "Acquisitions" | "Dispositions" | "Analyst";
  lastActive: string;
  dealsTouched: number;
}
```

**Note on prototype data export pattern:** `data.jsx` does not use ES module exports. The prototype attaches data to `window.*` globals (`window.DEALS`, `window.PARCELS`, etc.). In production, replace each global with a Tanstack Query call against the matching API endpoint per HANDOFF.md §6.

---

## 5. Tour anchors — `data-tour` selectors

From `acreos/guided-tour.jsx` and shell nav items:

| Selector | Component file | Purpose |
|---|---|---|
| `[data-tour-nav="home"]` | shell.jsx nav item | sidebar Command Center |
| `[data-tour-nav="inbox"]` | shell.jsx nav item | sidebar Inbox |
| `[data-tour-nav="pipeline"]` | shell.jsx nav item | sidebar Pipeline |
| `[data-tour-nav="parcels"]` | shell.jsx nav item | sidebar Parcels |
| `[data-tour-nav="pax"]` | shell.jsx nav item | sidebar Pax |
| `[data-tour-nav="settings"]` | shell.jsx nav footer | Settings (also reveals ⌘K palette) |

Tour step titles per HANDOFF.md §7 (verified in `guided-tour.jsx` TOUR_STEPS):
0. "This is your Command Center"
1. "Inbox · seller conversations"
2. "Your deal pipeline"
3. "Parcel records"
4. "Ask AcreOS — your copilot"
5. "Press ⌘K from anywhere"
6. "That's the tour"

HANDOFF.md §7 also references `data-tour="cmd-palette-trigger"`, `data-tour="hot-deals"`, `data-tour="quick-offer"`, `data-tour="parcel-atlas"`, `data-tour="inbox-ai-draft"`. Verify which are present and add missing ones at port time.

---

## 6. Onboarding spec

From `acreos/onboarding.jsx`. Triggered today by `localStorage['acr-onb-done']` being null. **Production: trigger from `user.onboardedAt == null` on the user record (per HANDOFF.md §7). Persist completion server-side.**

5 steps:

1. **Welcome** — AcreOS gradient logo (64×64 SVG), heading "Your land business, one system.", three pillars (intelligence, data unification, autonomy).
2. **Buy-box** ("Step 2 of 5") — heading "What are you looking for?". Inputs: range slider for acreage (default 5–40), multi-select chip group for states (CO, NM, AZ, TX, NV, UT, WY, OK, MT, ID, KS, NE), strategy selector (3 buttons: Buy & resell, Seller finance, Long-term hold).
3. **Autonomy** ("Step 3 of 5") — heading "How autonomously should AcreOS run?". Four levels (Observe, Draft, **Execute** [recommended], Autonomous).
4. **Connect** ("Step 4 of 5") — connect required tools (Regrid, BatchData, Lob) and optional (Stripe, Twilio).
5. **Ready** ("Step 5 of 5") — confirmation, CTA into app.

State persistence today: localStorage key `acr-onb-done` and per-step `acr-fr-<id>`. Move both to server: `user.onboardedAt: timestamp` and `user.tourState: { stepsSeen: string[], dismissed: boolean }`.

---

## 7. Tweaks panel — fate of each toggle

Per HANDOFF.md §9 and `acreos/app.jsx` Tweaks panel:

| Tweak | Fate |
|---|---|
| Theme dropdown | **Ship** — Settings → Appearance → Theme |
| Dark mode toggle | **Ship** — Settings → Appearance → Dark mode |
| Collapsed sidebar | **Ship** — persisted user pref; ⌘B hotkey |
| Founder mode toggle | **Ship** as flag — server-side identity check (NOT a user-toggleable preference; only founders see it active) |
| Show onboarding | Delete — fires from server flag `user.onboardedAt == null` |
| Open ⌘K palette | Delete — real keybind already does this |
| Replay guided tour | **Ship** — Settings → Help → "Replay guided tour" |
| Sound on/off | **Ship** — Settings → Preferences → Sound effects |
| Day-1 empty Command Center | Delete — real first-run state |
| Show "without AcreOS" faded | Delete — marketing-only artifact |
| Trigger lost / Quick offer / Reset tooltips | Delete |
| Page state (loading/empty/error/normal) | Delete — Tanstack Query handles |
| Show copy voice card | Delete — designer-internal |

**Tweaks panel infrastructure (`tweaks-panel.jsx`, `TweakToggle`, `TweakSelect`, `TweakButton`, `TweakSection`) does not ship. Delete all of it.**

---

## 8. AI surfaces inventory

### Atlas Run

Location: `acreos/pax.jsx` `AtlasAnalysisCard()`; standalone `AtlasRunC` page.
Input: `{ parcelId, county, acres, address, ownerInfo, ... }`.
Output (mocked `ATLAS_VARIANTS`): `{ pill, tone, body, rec, primary }`.
API: `POST /api/atlas/analyze { parcelId }` → `{ recommendation, confidence, comps[], riskFactors, suggestedOffer }`.
Surface: card with stat grid (Est. value, Comp spread, Days absentee, Flood risk), narrative body, "Send offer" button, "Regenerate" button.

### Pax (ambient chat)

Location: `acreos/pax.jsx` `Pax()`.
Modes: Operate / Analyze / Support (pill tabs).
Input: `{ mode, userText, context: { dealId?, parcelId?, ... } }`.
Output: `{ role: "user"|"agent", mode, text?, rich?: "atlas-analysis"|"pax-draft" }`.
APIs: `POST /api/pax/message`; sub-calls to `POST /api/atlas/analyze` and `POST /api/ai/draft-reply`.
Surface: chat bubbles, color-coded per mode, rich-card renders, regenerate button.

### AI draft replies (Inbox)

Location: `acreos/pages-tier1.jsx` Inbox + `PAX_DRAFT_VARIANTS` mock.
Input: `{ threadId, messageBody, recipientName, dealContext? }`.
Output: `{ pill, body }` (term variant + draft text).
API: `POST /api/ai/draft-reply { threadId, intent? }` → `{ text, sources[] }`.
Surface: collapsible card in inbox thread detail, cycle variants, buttons "Send as-is" / "Edit terms" / "Regenerate".

---

## 9. Prototype vs. production scope mismatch

Prototype switch covers ~30 routes. Production has 164. The prototype-only routes are itemized in §2. The production-only routes the prototype does not address are inventoried in `handoff/GAPS.md` Tier 0–3:

- **Tier 0 (high-value, design before porting):** notarization & e-signing, MCP/integrations ecosystem, maps & geographic, money/finance suite (14 routes), today/tasks/goals hub, AI Intelligence pages (16 routes), onboarding V2.
- **Tier 1 (mock-ship and iterate):** help/support/status/changelog, marketing/auth, mobile bottom nav, floating UI hierarchy, team/collaboration, compliance, settings IA, pricing/billing/trial/quota, marketplace.
- **Tier 2 (founder-only, port last):** ai-observatory, feature-flags, agents/agent-detail, daily-digest/letter/strategy/trends, prompt-evolutions/history/traces, expansion/experiments, providers/todo, sovereign/v13, board-of-directors, data-moat, executive-dashboard, anticipatory-enterprise, conscious-organization, real-runtime, admin/safety-gates, etc.

**Build approach:** Phase 2–7 ports each canonical surface with the design system applied. Phase 8 sweeps uncovered surfaces with the same design tokens and components. Vertical-specific surface design is out of scope for this build (separate handoff).

---

## 10. Open questions and assumptions

These are flagged for operator resolution. Some are pre-locked per the mega prompt; restating for completeness.

1. **Mobile support:** locked YES per founder decisions.
2. **Founder mode scope:** locked internal-only invisible-to-customers per founder decisions.
3. **Atlas Run sync vs. async:** unresolved. Prototype suggests synchronous return; production may need async with job ID. **Assumption: synchronous unless backend indicates otherwise.**
4. **Sound default:** locked off per founder decisions.
5. **Onboarding skippable:** unresolved. **Assumption: skippable on first login; revisit via Settings.**
6. **Tour state cross-device sync:** locked server-side via `user.tourState` per founder decisions.
7. **CSV / bulk operations:** unresolved. **Assumption: out of scope for this build; tracked separately.**
8. **Offline support:** unresolved. **Assumption: online-first for v1.**
9. **WCAG 2.1 AA:** the 394-slice refinement run already covers a large surface. Phase 9 coherence pass verifies parity; new components match prototype's visual style with refinement-grade a11y.
10. **Theme customization (white-label):** `useWhiteLabel` exists in code per GAPS.md. **Assumption: not surfaced in this build; deferred to vertical expansion.**
11. **Real-time collaboration:** unresolved. **Assumption: out of scope for this build.**
12. **Founder-purple specific hex:** not in `theme.jsx` excerpt. Extract at Phase 1.2 token application from `pages-tier2345.jsx` founder branches.

If any of these "assumption" calls are wrong, the build will surface the ambiguity at Operator Gate B and pause for direction.

---

## Source files read for this inventory

- `handoff/HANDOFF.md`, `handoff/GAPS.md`, `handoff/README.md`
- `acreos/app.jsx`, `acreos/theme.jsx`, `acreos/shell.jsx`, `acreos/data.jsx`
- `acreos/pages-tier1.jsx`, `acreos/pages-tier2345.jsx`
- `acreos/pax.jsx`, `acreos/onboarding.jsx`, `acreos/guided-tour.jsx`
- `acreos/settings.jsx`, `acreos/command-center.jsx`, `acreos/command-palette.jsx`
- `acreos/primitives.jsx`, `acreos/round3-primitives.jsx`
- `acreos/round3-css.jsx`, `acreos/round3-integrations-css.jsx`
- Production: `client/src/App.tsx` (route count), `client/src/components/ui/`, `client/src/hooks/`, `package.json`, `tailwind.config.ts`
- `git log` for refinement commits (slices 1–394)
