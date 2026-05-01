# Bavo Janssen — Loading-State Choreography Audit
**Wave 2 · 2026-05-01 · Apple-Music-grade settle-in for AcreOS**

> Loading is not a placeholder. It's the first frame of the answer. The user has already started looking — your job is to give them somewhere to put their eyes that becomes the content.

---

## 1. One-line verdict

AcreOS has the bones (a `Skeleton` primitive, a `ListSkeleton` library with three variants, a `useDelayedLoading` hook, `staggerContainer`/`staggerItem` Framer variants, a CSS `skeleton-shimmer` keyframe, and a `page-enter` blur-in) — but it never strings them together: **skeletons appear instantly, snap-replace as a block, and never stagger into content.** The ingredients of an Apple-grade settle are all in the kitchen; nothing has been plated.

---

## 2. Loading pattern inventory — by surface

Six distinct patterns coexist. They are not a vocabulary; they are a junk drawer.

### Pattern A — Full-page `Loader2` spinner (1990s)
| File:line | What |
|---|---|
| `client/src/App.tsx:325-330` | `FlaggedRoute` auth+flags loader: bare `<Loader2 w-8 h-8 animate-spin>` centered on `min-h-screen` |
| `client/src/App.tsx:351-356` | `PersonaRoute` auth gate — same shape |
| `client/src/App.tsx:383-387` | **Route-level Suspense fallback** for every lazy chunk — same shape |
| `client/src/pages/auth-page.tsx:70-77, 96-101` | Two loaders during invite-accept and SSO callback (Vesna §P1-8) |
| `client/src/pages/decision-queue.tsx:234-247` | `<Loader2/>` + bare "Loading queue…" full-PageShell |
| `client/src/pages/pipeline.tsx:47-56` (`TabFallback`) | `<div className="animate-pulse text-muted-foreground text-sm">Loading…</div>` — Wave-D9 style block |
| `client/src/components/ab-test-manager.tsx:233,658`; `safe-bulk-delete-dialog.tsx:196`; `cost-confirmation-modal.tsx:72`; `skip-trace-panel.tsx:98,138` | Centered spinners inside cards — no shape match |

### Pattern B — Shape-matched `Skeleton` blocks (good)
| File:line | What |
|---|---|
| `client/src/pages/parcel-detail.tsx:132-146` | 4 stat tiles + header + 96-tall main — matches final layout. **Reference quality.** |
| `client/src/pages/today.tsx:835, 892, 1120, 1223, 1276` | 5 inline `Skeleton`-mapped lists (3×16h tasks, 2×14h, 3×16h alerts, etc.) — heights match content |
| `client/src/pages/properties.tsx:669-672` | `<ListSkeleton count={6} variant="card"/>` for the grid view — only routed through `useDelayedLoading(200)` |
| `client/src/pages/leads.tsx:1457-1458` | Same delayed pattern, table variant |
| `client/src/pages/deals.tsx:1058-1061` | Per-kanban-column `<ListSkeleton count={2} variant="compact"/>` — actually staggers per column visually |
| `client/src/pages/inbox.tsx:1142-1143` | `<ListSkeleton count={5}/>` for the message list |
| `client/src/pages/tasks.tsx:560-563` | `<ListSkeleton count={4}/>` |
| `client/src/components/page-shell.tsx:113-126` | `PageShellSkeleton` — header + 4 metric tiles + 64h block. Used wherever `PageShell isLoading={true}` |

### Pattern C — Inline button/CTA spinner (`isPending`)
Hundreds of these. Representative:
- `client/src/components/document-generator.tsx:459, 529, 784, 967, 1138`
- `client/src/components/ai-offer-generator.tsx:339, 614, 703`
- `client/src/components/confirm-dialog.tsx:63`
- `client/src/components/credit-purchase-modal.tsx:128`
- `client/src/components/compliance-settings.tsx:629`
- `client/src/pages/webhooks.tsx:332`; `tax-optimizer.tsx:169`; `zoning-lookup.tsx:108`; `land-credit.tsx:287, 334, 669`; `fee-dashboard.tsx:477, 564`; `settings.tsx:346, 362`

These are *fine* — Apple does the same. The bug is that the icon is always `Loader2` regardless of verb, and the label often becomes a bare ellipsis (`"Saving…"`, `"Processing…"`) without a noun.

### Pattern D — Bare `animate-pulse` blocks (silent skeleton)
| File:line | What |
|---|---|
| `client/src/components/founder/CustomerHealthPanel.tsx:19` | 3× h-10 gray boxes |
| `client/src/components/founder/ForecastPanel.tsx:22` | 3× h-12 gray boxes |
| `client/src/components/founder/TrendCards.tsx:49` | 5× h-20 w-36 gray cards |
| `client/src/components/founder/ActivityTimeline.tsx:76` | h-16 lines |
| `client/src/components/dashboard/ThePulse.tsx:45` | flex gap-3 animate-pulse |
| `client/src/components/dashboard/MRRTrajectory.tsx:74` | h-44 gray rect |
| `client/src/components/dashboard/JobQueueHealth.tsx:76`, `GrowthEngine.tsx:43`, `BusinessIntelligence.tsx:64`, `DecisionsInbox.tsx:149` | Animated grid blocks |
| `client/src/pages/fee-dashboard.tsx:96` | `bg-muted/50 rounded animate-pulse` helper component |
| `client/src/components/offer-wizard.tsx:134` | `<Card className="animate-pulse">` |

These bypass the `<Skeleton>` primitive and the `skeleton-shimmer` class — so they never get the gradient sweep, only Tailwind's flat opacity blink. They should be migrated.

### Pattern E — Indeterminate progress bar (`<Progress />`)
| File:line | What |
|---|---|
| `client/src/components/tax-delinquent-importer.tsx:362` | `<Progress value={undefined}/>` — indeterminate import bar |
| `client/src/components/research-summary-panel.tsx:273` | Determinate completeness bar |
| `client/src/components/getting-started-checklist.tsx:139` | Determinate onboarding bar |
| `client/src/components/offer-preflight-checklist.tsx:257` | Determinate score bar |
| `client/src/components/campaign-variants-panel.tsx:385`; `provider-settings-cards.tsx:294`; `ai-offer-generator.tsx:447`; `ab-test-manager.tsx:584`; `campaign-analytics.tsx:217` | Determinate confidence/usage bars |

All currently use the shadcn linear `transition-all duration-300` — they tell the user *something is happening* but Kade §3 #9 already flagged the layout-thrash issue. Bavo concurs: these need spring physics or they read as "loading," not "result."

### Pattern F — Optimistic update (the gold standard, almost absent)
Only **three** verified call sites use TanStack `onMutate` to write through:
- `client/src/components/focus-list.tsx:210`
- `client/src/components/founder/AgentTeamChat.tsx:175`
- `client/src/components/settings/data-network-settings.tsx:46`

Everywhere else — task complete, lead status change, deal stage move, comment post, message send — the user clicks, the button spins, the request returns, the row mutates. **Three to four hundred ms of dead air per gesture, every gesture.** This is the single biggest perceived-quality gap in the app, larger than any skeleton issue.

---

## 3. Choreography gap — pages where settle-in motion is missing

The pattern that's missing app-wide: **same `staggerItem` wrapping skeleton AND content, with `staggerContainer` parent, so when data lands the skeletons cross-fade in place into cards and surrounding siblings stagger 50ms apart.** Today, every loaded page does:

1. `isLoading === true` → render Skeleton block (no stagger).
2. Data arrives → `isLoading === false`.
3. React unmounts skeleton subtree, mounts content subtree.
4. Content appears with no entrance — pop-in.

The CSS `page-enter` (`index.css:1214`) gives the *whole page* a blur+lift on first mount, but it does not re-fire when content swaps inside an already-mounted PageShell. So the post-skeleton content arrives with zero motion.

**Pages with the worst pop-in:**

| Page | Where the snap happens |
|---|---|
| `today.tsx` | 5 distinct sections (lines 835/892/1120/1223/1276) each pop independently as their queries resolve. No ordering, no stagger. |
| `pipeline.tsx` | TabFallback unmounts → tab content mounts → tab's own `isLoading` skeleton shows → kanban pops. **Three states for one tap.** |
| `dashboard.tsx` | Stats tiles each show `"—"` while loading (line 245-268), then snap to numbers. No `AnimatedCounter` on the count-up — instantaneous swap. |
| `decision-queue.tsx:234-247` | Full-PageShell spinner → full content. Hard cut. |
| `inbox.tsx:1142, 783` | List skeleton → list content snap. Email-thread spinner → messages snap. |
| `tasks.tsx:560` | ListSkeleton → tasks `<ul>` snap. |
| `agent-collaboration.tsx`, `sovereign-dashboard.tsx`, `board-of-directors.tsx`, `agent-performance.tsx`, `job-health.tsx`, `event-log.tsx`, `memory-browser.tsx` | All use `<PageShell isLoading={isLoading}>` → entire `PageShellSkeleton` is replaced wholesale by the page's content. The most jarring possible transition. |

**Where content correctly settles in:**
- `client/src/components/sms-conversation.tsx:159-163` — staggerContainer + staggerItem wrap each bubble. ✓
- `client/src/components/team-general-channel.tsx:140-142` — same. ✓
- `client/src/components/activity-timeline.tsx:299-306` — same. ✓
- `client/src/components/cohort-retention-dashboard.tsx:166-256` — staggers each metric block. ✓
- `client/src/components/source-attribution-panel.tsx:166-179`, `user-morning-briefing.tsx:71-98`, `data-confidence-badge.tsx:129-231`, `achievement-progress.tsx:112-120`, `field-scanner.tsx:324`. ✓

So the *technique* exists in the codebase. It's used on roughly 8 components. Nothing on the customer-critical pages.

---

## 4. The "Loading…" sin — every bare loader with no noun

These tell the user *that* something is loading, never *what*. Apple's never-without-a-noun rule:

### Visible to the user (worst)
| File:line | Current text |
|---|---|
| `client/src/pages/pipeline.tsx:54` | `Loading…` (TabFallback) |
| `client/src/pages/predictions.tsx:263` | `Loading…` (button while submitting analysis) |
| `client/src/pages/team-inbox.tsx:430` | `Loader2 + "Loading…"` |
| `client/src/pages/buyer-qualification.tsx:272, 288` | `Loading…` (2 places) |
| `client/src/pages/team-dashboard.tsx:187` | `Loading…` |
| `client/src/pages/ops-dashboard.tsx:79` | `Loading…` |
| `client/src/pages/price-optimizer.tsx:477` | `Loading…` |
| `client/src/pages/decision-queue.tsx:243` | `Loading queue…` ← **good**, the only one that names its noun |
| `client/src/components/founder/CustomerHealthPanel.tsx:29` | Fallback string `"Loading…"` rendered as visible `<p>` text |

### `sr-only` (invisible to sighted users — nothing in viewport while query runs)
These are accessibility-correct but the visual layer has no caption. Sighted users see only a Skeleton block:
- `client/src/components/list-skeleton.tsx:13, 37, 54` — three variants, all `<span className="sr-only">Loading…</span>`
- `client/src/components/legal-intelligence-card.tsx:60`
- `client/src/components/pax-copilot-rail.tsx:1422`
- `client/src/components/conversation-tray.tsx:113, 524`
- `client/src/components/system-health.tsx:152`
- `client/src/components/attribution-analytics.tsx:143`
- `client/src/components/closing-costs-card.tsx:66`
- `client/src/components/call-log.tsx:279`
- `client/src/components/cohort-analytics.tsx:120`
- `client/src/components/pax-connector-panel.tsx:249`
- `client/src/components/due-diligence-panel.tsx:158`
- `client/src/components/property-map.tsx:3284`
- `client/src/components/deal-inbox.tsx:111`
- `client/src/components/deal-feed/daily-deal-feed.tsx:589`
- `client/src/components/cash-flow-waterfall.tsx:53`
- `client/src/components/calendar-widget.tsx:85`
- `client/src/components/founder/AgentDebatePanel.tsx:171`
- `client/src/components/integrations-settings.tsx:468`
- `client/src/components/sequences-content.tsx:210`
- `client/src/components/founder/ForecastPanel.tsx:23`
- `client/src/components/sms-conversation.tsx:109`
- `client/src/components/team-general-channel.tsx:124`
- `client/src/components/activity-timeline.tsx:284`
- `client/src/components/ai-cost-dashboard.tsx:56`
- `client/src/components/portfolio-health-card.tsx:111`
- `client/src/components/focus-list.tsx:306`
- `client/src/components/comment-thread.tsx:250`
- `client/src/pages/founder-dashboard.tsx:671, 811`
- `client/src/pages/pax.tsx:474`
- `client/src/components/page-shell.tsx:116` — `Loading page…` (one of the few with a noun, kept by accident)

**Total: 36 distinct `"Loading…"` strings across the app.** Vesna §P0-3 flagged 30. The real number is 36. Each one should name the noun:

| Component | Should say |
|---|---|
| `legal-intelligence-card` | `Reading legal intelligence…` |
| `closing-costs-card` | `Estimating closing costs…` |
| `attribution-analytics` | `Building attribution model…` |
| `cohort-analytics` | `Computing cohorts…` |
| `cash-flow-waterfall` | `Tracing cash flow…` |
| `portfolio-health-card` | `Reading your portfolio…` |
| `system-health` | `Checking system health…` |
| `due-diligence-panel` | `Running due diligence…` |
| `comment-thread` | `Loading comments…` |
| `activity-timeline` | `Loading activity…` |
| `calendar-widget` | `Loading calendar…` |
| `sms-conversation` | `Loading messages…` |
| `forecast-panel` | `Computing forecast…` |
| `customer-health-panel` | `Reading customer health…` |
| `focus-list` | `Loading your focus list…` |
| `daily-deal-feed` | `Building today's deal feed…` |
| `pax-copilot-rail` | `Waking Pax…` (already exists elsewhere — make it consistent) |
| `pipeline.tsx:54` (TabFallback) | Replace text with a proper kanban-shaped skeleton |

The fix is a one-prop addition to `ListSkeleton({ label?: string })` plus a 2-hour grep pass.

---

## 5. Per-surface recommended pattern — 12 customer surfaces

Each pattern is a *recipe*: skeleton geometry + stagger + replacement choreography.

### 5.1 `/today` — `today.tsx`
**Today**: 5 independent islands each pop separately at unpredictable times.
**Recipe**: One `staggerContainer` parent wrapping each section. Each section is a `staggerItem` with its OWN internal `<TodaySectionSkeleton>` whose height matches the loaded section to within 4px. Sections appear bottom-up in canonical order: greeting (always immediate, no skeleton) → Pulse → Focus list → Tasks → Alerts → Notes. 50ms `staggerChildren`, 80ms `delayChildren`. When a section's query resolves, its skeleton crossfades to content with `fadeIn` (no layout shift — heights are matched).

### 5.2 `/pipeline` — `pipeline.tsx`
**Today**: TabFallback "Loading…" on tab swap (line 54), then per-tab skeleton.
**Recipe**: Each tab's content is preserved on swap (`AnimatePresence mode="popLayout"`). For the kanban Board: 5 columns each render `<ListSkeleton count={2} variant="compact"/>` simultaneously (already does this at `deals.tsx:1058`) but with `<motion.div variants={staggerItem} layout>` so when deals land they slide into place with `quickSpring` instead of pop. Funnel intelligence header skeleton: 4 metric tiles (`<StatCardSkeleton/>` ×4) at the right heights.

### 5.3 `/leads` — `leads.tsx`
**Today**: `useDelayedLoading(isLoading, 200)` → table skeleton → snap to rows.
**Recipe**: Keep the 200ms delay (instant content beats any skeleton). When skeleton renders, wrap each row in `staggerItem`. When data arrives, `AnimatePresence mode="popLayout"` swaps skeleton rows for real rows with `layout` so reorders animate. **Row height must match exactly** — currently skeleton is `h-4` lines inside a `p-3` row; lead rows are `~64px`; mismatch causes a layout jump even though shapes look right.

### 5.4 `/properties` — `properties.tsx`
**Today**: `<ListSkeleton count={6} variant="card"/>` (`properties.tsx:669-672`) — best-in-class shape match.
**Recipe**: Add `staggerContainer`/`staggerItem` so the 6 card skeletons appear in 30ms beats and the 6 real cards crossfade *into the same positions* with `layout`. Bonus: `layoutId="property-${id}"` on each card → handoff to `/parcel-detail` (Kade §3 #9).

### 5.5 `/deals` — `deals.tsx`
**Today**: Per-column `ListSkeleton count={2}` (line 1058) — already independently loading.
**Recipe**: Keep per-column skeletons. Add `<motion.div layout>` on each card. When user drags a deal, `quickSpring` settles it into the new column. Right now the move is instant (no animation) — Kade §3 #5.

### 5.6 `/inbox` — `inbox.tsx`
**Today**: `<ListSkeleton count={5}/>` (line 1142) → snap to threaded list. Detail-pane: bare `<Loader2>` (line 783-787) "Loading messages…" — at least it has a noun.
**Recipe**: Mail-row skeleton with avatar circle (40×40) + 2-line right column (h-4 w-3/4 + h-3 w-1/2). When messages arrive, stagger them top-down, 30ms apart. The detail pane should show a thread skeleton (alternating left-right bubbles) not a centered spinner.

### 5.7 `/tasks` — `tasks.tsx`
**Today**: `<ListSkeleton count={4}/>` (line 560).
**Recipe**: Row height must match the actual task row (~80px with checkbox + 2-line text + actions). Wrap each in `staggerItem`. When user completes a task, `<motion.li layout>` lets the rest of the list slide up — **and the completed task should optimistically check immediately** (Pattern F gap; right now `completeMutation.isPending` blocks the checkbox).

### 5.8 `/decision-queue` — `decision-queue.tsx`
**Today**: Bare `<Loader2/>` + "Loading queue…" — Pattern A, full-page spinner.
**Recipe**: Replace entirely. Decision queue items have a known card shape (~120px, header + body + 2 action buttons). Render 3 of those skeletons, stagger them in 60ms apart. When real cards arrive, they crossfade in place. **This is the page customers see when they need clarity — it should feel calm, not anxious.**

### 5.9 `/parcel-detail` — `parcel-detail.tsx`
**Today**: 132-146 — already a beautiful shape skeleton (header + 4 stats + 96-tall main).
**Recipe**: Keep the shape. Add `staggerContainer` parent and stagger reveal so the 4 stat tiles cascade in 50ms apart instead of all-at-once. With `layoutId="property-${id}"` from `/properties`, the hero image flies in from the source card. **This is the showstopper interaction.** (Kade §3 §6 hero handoff.)

### 5.10 `/dashboard` — `dashboard.tsx`
**Today**: KPI tiles render `"—"` while loading (lines 245, 257, 268), then snap to numbers. No skeletons; the dash *literally pretends to have data*.
**Recipe**: Each KPI tile uses `<StatCardSkeleton/>` (already exists, `list-skeleton.tsx:85`). When values arrive, swap skeleton → tile, then run `<AnimatedCounter>` from 0 to value over 600ms. **Stagger 4 tiles 80ms apart.** `intelligence` panel below uses `staggerContainer` for its own subsections.

### 5.11 `/pax` — `pax.tsx`
**Today**: `AiChatGuard` shows `<Skeleton h-64/>` + `sr-only "Loading…"` (line 470-476).
**Recipe**: Skeleton should match the chat interface — message-bubble alternating left/right (3 of each), at the right widths (60-80% of column). When Pax responds, bubbles stream in (the existing streaming UI). The 64h flat block is wrong shape.

### 5.12 `/finance` — `finance.tsx`
**Today**: `isLoading` ternary at line 349 (loading state) — not currently a skeleton.
**Recipe**: Notes-list skeleton (similar to leads but with monetary right-aligned numbers). Each row staggered. When values arrive, the dollar columns count up via `AnimatedCounter`.

---

## 6. Top-10 highest-impact upgrades

Ranked by **(daily occurrences) × (perceived-quality delta)**.

| # | File:line | Change | Why it matters |
|---|---|---|---|
| **1** | `client/src/App.tsx:383-387` (Suspense) and `App.tsx:325-330, 351-356` (auth gates) | Replace centered `Loader2` with the route's matching skeleton — at minimum, render `<PageShellSkeleton/>` on lazy-chunk fallback | This fires on **every** lazy-loaded route. The biggest single quality lever in the app. |
| **2** | `client/src/pages/pipeline.tsx:47-56` (`TabFallback`) | Replace `"Loading…"` block with a kanban-shaped skeleton (5 columns × 2 compact-row skeletons) | Most-used surface. Currently the worst transition: animation→spinner→content (Kade §2). |
| **3** | All 36 bare `Loading…` strings (§4 above) | Add a noun to each. `ListSkeleton` accepts `label?: string` prop. | Vesna's P0-3 — the single most-cited polish gap. 1.5h grep pass. |
| **4** | `client/src/components/list-skeleton.tsx` | Wrap each `Array.from({length})` in `<motion.div variants={staggerItem}>` and the parent in `<motion.div variants={staggerContainer}>`. Same change in `<ListSkeleton/>`, `<TableRowSkeleton/>`, `<PageShellSkeleton/>`. | One file change → every consumer gets settle-in for free. |
| **5** | `client/src/components/page-shell.tsx:101-103` | When `isLoading` flips false, fade the skeleton out (200ms) and fade content in (300ms) with 80ms overlap, instead of unmount/mount. | Today the swap is instant. The crossfade is the moment the user feels the system "settle." |
| **6** | Migrate Pattern D (15 sites: founder/CustomerHealthPanel, ForecastPanel, TrendCards, ActivityTimeline, dashboard/ThePulse, MRRTrajectory, JobQueueHealth, GrowthEngine, BusinessIntelligence, DecisionsInbox, fee-dashboard:96, offer-wizard:134) | Replace bare `animate-pulse` divs with the proper `<Skeleton/>` primitive (gets `skeleton-shimmer` gradient sweep instead of opacity blink) | Founder surfaces especially: TrendCards' 5 gray rectangles read as "broken" today. The shimmer reads as "thinking." |
| **7** | `client/src/pages/today.tsx:835, 892, 1120, 1223, 1276` (5 islands) | Wrap each section in `staggerItem`, parent in `staggerContainer`. Match section heights *exactly* so loaded content drops in without shift. | First page every user sees. Currently 5 independent pop-ins; should be one waterfall. |
| **8** | Pattern F adoption: tasks complete, deal stage move, lead status change, comment post, message send | Add `onMutate` optimistic writes for all 5 verbs. Roll back on error. | The biggest perceived-latency win in the app. Transforms 300-400ms gestures into instant ones. |
| **9** | `client/src/pages/dashboard.tsx:245, 257, 268` | Replace `"—"` placeholders with `<StatCardSkeleton/>`. Pipe through `<AnimatedCounter>` so values count up from 0. | Stats currently lie (show "—") instead of communicating they're loading. Counter on resolve = Apple-stocks tier. |
| **10** | `client/src/components/ui/animated-counter.tsx:37-46` | Counter currently re-fires on every refetch (Vesna P1-5). Memoize previous *value*, only animate when value diff exceeds 0. | 60s polls cause numbers to re-roll on every poll. Tells the user "the page is loading" when it isn't. |

Honorable mentions (not top-10 but cheap): wire `useDelayedLoading(200)` into `<PageShell isLoading/>` (right now properties+leads use it, the other 7 PageShell-isLoading pages do not — so brief flickers show full skeletons unnecessarily); replace `<Progress className="transition-all duration-300"/>` with a spring-based variant for `Pattern E`.

---

## 7. The one page that should ship the gold-standard first

**`/parcel-detail`** (`client/src/pages/parcel-detail.tsx`).

Three reasons:

1. **It already has the best skeleton in the app** (lines 132-146). The shape is right. Wrap it in `staggerContainer` and the 4 stat tiles will cascade. Half the work is done.
2. **It is reached from `/properties`**, where `layoutId="property-${id}"` can ship the hero image handoff (Kade §3 #9). When the user taps a card on the grid, the card *is* the parcel-detail header — the skeleton crossfades around the already-flown-in hero. That's the Apple Music album-flip moment AcreOS has earned.
3. **It is high-touch and low-traffic** — every Land Investor opens it many times per day, but the page is small enough to ship perfectly without a 2-week project. The choreography there sets the bar; once it lands, you copy the pattern to `/today`, `/pipeline`, `/inbox`.

**The recipe to ship Tuesday:**

```tsx
<PageShell label={property?.address}>
  <motion.div
    variants={staggerContainer}
    initial="hidden"
    animate="visible"
    className="space-y-6"
  >
    {/* Hero — uses layoutId for cross-page handoff */}
    <motion.div layoutId={`property-${id}`} variants={staggerItem}>
      {isLoading ? <Skeleton className="h-48 w-full" /> : <ParcelHero property={property}/>}
    </motion.div>

    {/* Stat tiles — 4 stagger one beat at a time */}
    <motion.div variants={staggerItem} className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {stats.map((stat, i) => (
        <motion.div key={stat.key} variants={staggerItem}>
          {isLoading ? <StatCardSkeleton/> : <StatTile {...stat}/>}
        </motion.div>
      ))}
    </motion.div>

    {/* Main panel — fades in last */}
    <motion.div variants={staggerItem}>
      {isLoading ? <Skeleton className="h-96"/> : <ParcelDetailMain property={property}/>}
    </motion.div>
  </motion.div>
</PageShell>
```

Six lines of `motion.div` over the existing structure. No new components. No risk. Ships in two hours and looks like a different app.

Then the team has a working reference. The same pattern propagates to `/today`, `/pipeline`, `/dashboard`, `/inbox` over the following week — using exactly the same primitives.

---

## Closing

AcreOS does not lack loading states. AcreOS lacks a **point of view** about what loading means. Apple Music's point of view is: *the artwork is the thing; the rest is plumbing that quietly settles around it.* AcreOS should have a point of view too — *the property/lead/deal is the thing; the chrome arranges itself around it as data arrives.* Once that's the rule, every loading state becomes a small instance of one large idea, and the app starts to feel like one app.

The ingredients are in the kitchen. Plate them.

— Bavo
