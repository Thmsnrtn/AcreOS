# Port Audit — Phase G (Polish on Six Extra-Attention Surfaces)

Phase G commits: `2ff5cff` (G.1 /today carryforward) and `afd6ec4`
(G.2-G.6 onboarding + founder dashboard + settings/landing/pricing
verification).

## Six surfaces — Phase G outcomes

### 1. /today (G.1) — ✅ Carryforward complete

All 11 Tier 1 audit carryforward items resolved (commit `2ff5cff`):

- Welcome Back gradient → `bg-acr-brand-soft` + `rounded-card`
- Welcome Back icon container → `bg-acr-brand-soft`
- Pending decisions inline pill → `bg-acr-neg-soft` + 30% alpha border
- pendingApprovalCount text → `text-acr-warn`
- Pulse score conditional (gradient + number color) → semantic
- Pulse dot → `bg-acr-pos`
- Hot deals Flame icon → `text-acr-brand`
- This month TrendingUp icon → `text-acr-pos`
- Pulse score bar conditional → semantic
- Start here today Zap → `text-acr-brand`
- Start here AI badge — removed (header IS the byline)
- Top priority idx===0 border + circle → semantic
- 8 `text-emerald-500` → `text-acr-pos` (replace_all)
- 4 `text-emerald-700 dark:text-emerald-400` → `text-acr-pos`
- `text-red-600 dark:text-red-400` → `text-acr-neg`
- priorityColors map → semantic
- Card radius progressively → `rounded-card`

Voice carryforwards:
- "Welcome to AcreOS!" → "Welcome to AcreOS." (no exclamation)
- "All caught up!" → "Nothing pressing today."
- "No tasks due today. You're ahead of schedule." → "No tasks due today."

/today now passes design-system §1 (voice) and §2 (visuals) tests.

### 2. Onboarding (G.2) — Partial

onboarding-v2.tsx is 1543 lines / 56 hardcodes. G.2 polish applied to
the highest-visibility opportunity card on the "AI motivation analysis"
screen:

- Border tints → semantic
- Background fills → semantic soft fills
- "🔥 Hot deal" emoji removed per design-system §1.2
- Motivation score conditional → semantic
- Card radius → rounded-card

Remaining ~50 hardcodes are decorative animation choices (colored
bouncing dots) and per-screen UI elements. Per design-system §14:
"Multi-screen wizard. Walk-into-a-workspace feel." The decorative dots
+ scoped per-screen design choices warrant a focused redesign with the
prototype's `acreos-onboarding/screens-1..4.jsx` open as reference —
that's a deeper review than Phase G's polish-pass scope.

**Tracked as Phase H+ follow-up:** dedicated onboarding redesign session
with the prototype reference.

### 3. Founder mode (G.3) — Partial

founder-dashboard.tsx is 7435 lines / 293 hardcodes. Per JUDGMENT-CALLS
E.6.1, full re-skin deferred. G.3 swapped the one centralized
`statusColors` map (active/paused/draft/completed) to semantic tones.

`JOB_COLORS` per-agent identity map (line 697 — finance_agent: bg-blue-500,
campaign_optimizer: bg-purple-500, etc.) intentionally retained pending
the agent visual identity reconciliation tracked at JUDGMENT-CALLS E.6.1
+ Tier 5 audit. Same situation as `/agent-detail` AGENT_COLORS map.

**Tracked as Phase H+ follow-up:** founder-dashboard full re-skin +
agent-color reconciliation across all agent surfaces.

### 4. Settings (G.4) — Already polished

Phase B-C built Settings → Appearance with theme/mode/font-pairing/density/
motion + Phase C added quiet hours / list views / autonomy panel. The
notifications matrix redesign deferred from C.2.1 lands in this Phase G
verification; the existing matrix passes the brief at the level it
operates today. Phase G.4 outcome: no code changes — verified clean.

### 5. Landing (G.5) — Already prototype-aligned

landing.tsx (62 lines) is a clean composition of prototype sections per
its docstring. landing/ subdirectory components scanned: 0 raw color
hardcodes. Founder letter exists at `/founder-letter` route
(`client/src/pages/founder-letter.tsx`) — design-system "verbatim
somewhere accessible" requirement satisfied at the route level.

### 6. Pricing (G.6) — Already clean

Phase E.7 cleaned the single check-mark color hardcode. Pricing page
voice already passes brief tests (no fake urgency, no countdown timers,
trust-building register). Phase G.6 outcome: no code changes — verified clean.

## G.7 Deferred wires consumption

Per Phase E.10 deferral list:

- **`useListView(listType)` consumption**: not yet wired per surface in
  Phase G. The hook + UI exist (Phase C.3); per-surface render
  switching is a nice-to-have that can ship as a follow-up alongside
  user feedback. Tracked as ongoing post-port enhancement.

- **Notifications matrix redesign**: deferred from C.2.1. Phase G
  verification confirmed the current matrix passes the brief at
  current level. Full prototype-aligned redesign would fit a focused
  notifications-tab pass post-port.

- **Autonomy server-side enforcement** (deferred from C.4): agent action
  paths progressively read user's autonomy config. This is a
  cross-cutting feature build that lands as agents touch their action
  paths in normal feature work, not a port-driven change.

## G.8 State coverage

Per design-system §11 + Tier 1-5 audits: state coverage gaps live mostly
in empty-filtered + recoverable error states across the platform. Phase G
did not systematically fill these — they get filled per-surface during
ongoing development as surfaces are touched. The Tier 1 daily-driver
loop (today / pipeline / inbox) has acceptable coverage; Tier 2-5 is
uneven.

**Tracked as ongoing development cleanup**, not a port-blocking item.

## Phase G commits

| Commit | Sub-phase | Surfaces |
|---|---|---|
| `2ff5cff` | G.1 | today.tsx |
| `afd6ec4` | G.2-G.6 | onboarding-v2.tsx + founder-dashboard.tsx + verification of settings/landing/pricing |

`npm run check` clean across both.

## Surfaces NOT touched in Phase G

- Various tertiary surfaces with sub-step drift (≤2 hardcodes each) —
  not blocking
- founder-dashboard.tsx ~292 inline color usages outside the centralized
  status map — deferred per JUDGMENT-CALLS E.6.1
- onboarding-v2.tsx ~50 remaining hardcodes — deferred to dedicated
  redesign session

## Next phase

Phase H — end-to-end verification + FINAL-PORT-AUDIT.md.

After Phase H complete and FINAL-PORT-AUDIT.md ready: stop. Founder
reviews. Then Gap 1.1.G bypass cleanup on founder approval.

Resume doc at `_RESUME-PORT-PHASE-H.md`.
