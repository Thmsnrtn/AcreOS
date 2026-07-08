# Kade Marchetti — Motion & Interaction Audit

> Motion is meaning, not decoration. A spring tells you the thing you just did was real and reversible. A 200ms linear fade tells you nothing.

AcreOS has a real motion system underneath — five tokens, a primitives file, `MotionConfig reducedMotion="user"` at the root. The bones are good. The problem is that the motion vocabulary is *inconsistent*: a button taps with one curve, a modal opens with another, a page transitions with a third, and a list inserts with no curve at all. Apple's craft teams obsess over one thing — that *every* animation in the app pulls from the same physics. AcreOS pulls from five.

This is how to fix it in two weeks.

---

## 1. Motion vocabulary audit — what exists today

**CSS tokens** (`client/src/index.css:29-33`):

| Token | Value | Honest read |
| --- | --- | --- |
| `--acr-dur-fast` | 120ms | Good |
| `--acr-dur-normal` | 240ms | Good |
| `--acr-dur-slow` | 320ms | Good |
| `--acr-ease-spring` | `cubic-bezier(.22, 1, .36, 1)` | This is **not a spring** — it's a fast-out-slow-in tween. Spring physics requires stiffness/damping, not a bezier. The name is lying. |
| `--acr-ease-standard` | `cubic-bezier(0.25, 0.46, 0.45, 0.94)` | Standard ease-out. Fine. |

The reduced-motion override at `index.css:51-64` correctly collapses durations to 30/60ms and remaps spring → standard. That part is right.

**Framer primitives** (`client/src/lib/animations.ts`):

- `quickSpring` (line 3) — `stiffness: 500, damping: 30` — a real spring. Snappy.
- `smoothSpring` (line 9) — `stiffness: 300, damping: 25` — softer real spring.
- `fadeIn`, `fadeInUp`, `slideUp`, `scaleIn`, `staggerContainer`, `staggerItem`, `pageTransition`, `modalOverlay`, `modalContent`, `cardHover`, `buttonTap`, `dropdownStagger`, `collapsibleContent`, `pulseAnimation`.
- Of these, **only three** (`quickSpring`, `smoothSpring`, `cardHover`/`buttonTap`) actually use spring physics. The rest are duration+ease tweens. So the "spring" reputation of the system is mostly aspirational.

**The disconnect**: CSS tokens use one vocabulary (durations + cubic-beziers), Framer primitives use another (some springs, some tweens with their own hardcoded durations). Nothing references the CSS tokens from JS. A change to `--acr-dur-normal` does not propagate into Framer animations. **They are two separate systems pretending to be one.**

**Spring vs ease usage in app code:** 21 occurrences of `type: "spring"` vs 9 explicit `easeOut/In/InOut` strings, plus dozens of bare `duration: 0.X` calls with no curve specified (Framer defaults to its own tween). Examples of the latter: `command-palette.tsx:419`, `new-item-menu.tsx:107,121`, `getting-started-checklist.tsx:115`, `query-error-state.tsx:138`, `onboarding-wizard.tsx:826,848`, `founder/SwipeDecisionCard.tsx:136,247`. None of these go through the primitive layer.

**Verdict:** vocabulary exists on paper, is not enforced in practice. The system is a *suggestion box*, not a *constraint*.

---

## 2. Page transitions — kill the crossfade

Current state, `App.tsx:928-946`:

```tsx
<AnimatePresence mode="wait">
  <motion.div key={location} variants={pageTransition} initial="initial" animate="animate" exit="exit">
```

`pageTransition` (`animations.ts:89-101`) = opacity 0→1 + x: 8→0→-8 over 250/200ms easeOut. Every navigation:

1. Unmounts the entire route subtree.
2. Re-runs `React.lazy` Suspense fallback (the `Loader2` in `App.tsx:383-387`).
3. Re-fetches every TanStack Query that wasn't already cached.
4. Crossfades the result.

The audit finding is right: `key={location}` forces unmount on every nav. The 8px slide is invisible (literally — 8px on a 1440px viewport is 0.5% of width), so the user perceives **nothing but a flash**, which the brain reads as "the app reset."

**Recommendation: remove the page-level `motion.div` entirely.** Page transitions are the wrong place to spend motion budget for this app. Reasoning:

1. **Routes are heavy & query-driven.** Today, Pipeline, Deals — these are TanStack Query mosaics. The sub-200ms crossfade ends before the data arrives, so the user sees animation→spinner→content. That's three states for one navigation.
2. **The wins live one level down.** A list inserting a new lead, a card flipping to edit mode, a kanban column re-flowing — *those* are the moments worth animating, and they're currently raw.
3. **The page wrapper steals the ability to animate sub-regions.** Because the whole tree unmounts, you can't `layoutId` a card from /pipeline/:id back to the kanban card on /pipeline.

**Concrete plan:**

- **Remove** the `<PageWrapper>` in `App.tsx:1008-1010`. Render `<Router />` directly.
- **Replace** with a sub-route shared layout: each top-level page wraps its content in a `motion.main` with `staggerContainer` + `staggerItem` for the first-load reveal (300ms total, max 6 items staggered, then off). This gives the *sense* of arrival without the unmount cost.
- **Adopt `layoutId` for the cross-page hero handoff** — pipeline card → deal detail, parcel card → parcel detail. This is the Apple Music album-flip equivalent for a CRM.
- **Keep** `AnimatePresence` for *modal* and *drawer* mounts where it actually pays its weight (DealModalsHost, OnboardingWizard, command palette).

Net result: navigation feels instant (because it is), and motion budget gets spent where the user looks.

---

## 3. Microinteraction punch list (ranked)

| # | File:line | Change | Why |
|---|---|---|---|
| 1 | `App.tsx:928-946` | Delete `<PageWrapper>`, render `<Router/>` directly | Stops the false-flash on every nav (see §2). The single biggest perceived-quality win. |
| 2 | `client/src/components/ui/button.tsx:8` | Replace `transition-all duration-150 ease-out active:scale-[0.96]` with a Framer `motion.button` primitive whose `whileTap={buttonTap}` uses `quickSpring` | Today's button uses CSS tween only. A spring overshoot at scale 0.96 → 1.00 reads as physical. The CSS version reads as a flicker. Every button on the app benefits. |
| 3 | `command-palette.tsx:419` (`transition={{ duration: 0.18 }}`) | Replace with `quickSpring` | Command palette is the most-used surface for power users. It currently snaps in via Framer's default tween. A spring on result-list mount is 8px of polish on every ⌘K press. |
| 4 | `new-item-menu.tsx:107,121` | Replace bare durations with `dropdownStagger` + `dropdownItem` from `animations.ts:141-159` | Primitives already exist for exactly this case. Dead code in the system. Wire it up. |
| 5 | `pipeline.tsx` (whole kanban surface) | Wrap each column's deal list in `<AnimatePresence>` + `<motion.div layout>` with `key={deal.id}` and `quickSpring` | Today, when a deal moves stages, the DOM jumps. A `layout` animation + spring makes the move feel intentional and reversible. This is *the* core CRM gesture — it has to feel right. |
| 6 | `client/src/components/ui/toaster` (any toast surface) | Toast enter from bottom-right with `smoothSpring`, exit with shrink+fade | Toasts currently fade. A toast is a *new object entering the world* — it should arrive with mass. Apple's toasts always have spring. |
| 7 | `founder/SwipeDecisionCard.tsx:136,247` | Already uses motion but with `duration: 0.2` tween. Switch to `smoothSpring` for exit, and add `dragConstraints` + `dragElastic={0.2}` | This component is *literally a swipe card* — it's the spiritual heir to Tinder's pattern. Tweens here read as "computer," springs read as "card." Big affordance gain. |
| 8 | `getting-started-checklist.tsx:115` | Replace `duration: 0.3` with `smoothSpring` and add `staggerContainer` to parent so checklist items reveal sequentially on first paint | Checklist is the user's *first* impression of "AcreOS is alive." Stagger telegraphs care. |
| 9 | `client/src/components/ui/progress.tsx:21` (`transition-all duration-300 ease-out`) | Add `transform-gpu` to ensure compositor path; consider `will-change: transform` | Progress bars currently animate `width` which forces layout. On low-end Android (the actual mobile reality), this stutters. Cheap fix, big payoff during onboarding/import. |
| 10 | `dynamic-island.tsx:58,68,70` (cubic-beziers `[0.4,0,1,1]`, `[0.16,1,0.3,1]`, etc.) | Consolidate to `quickSpring` for state changes, `smoothSpring` for size morphs | Dynamic Island has 4 different curves in 100 lines. It's the most Apple-evocative surface in the app and currently the *least* consistent. One spring, two stiffness values, done. |
| 11 | `freedom-progress-card.tsx:52` and `portfolio-health-card.tsx:58,84`, `background-mode.tsx:106,165` (`transition-all duration-1000`) | These bars need a spring with 1.5–2s settle time, not linear width | A 1000ms linear width-tween reads as "loading"; a spring reads as "result." Different message entirely. |
| 12 | `MobileBottomNav.tsx` (whichever variant ships the active-tab indicator) | Use `layoutId` on the active-tab pill so it slides between tabs with `quickSpring` | This is iOS/Linear's mobile-tab-bar trick. Cheap to add, high-recognition for users coming from polished mobile apps. |
| 13 | All `EmptyState` components | Add a 400ms `slideUp` reveal on mount with `staggerItem` for headline/sub/CTA | Empty states are emotional — they're failure states the product is asking the user to accept. A subtle entrance dignifies the moment. |
| 14 | `comment-thread.tsx`, `ai-reasoning.tsx`, any list with insert/delete | Wrap items in `AnimatePresence` with `mode="popLayout"`, animate `layout` on the container | List inserts currently jump-cut. The `popLayout` mode lets neighbors slide aside springily. This *is* the gesture-meaning rule: where it came from, where it went. |
| 15 | Form inputs (`ui/input.tsx:12`, `ui/switch.tsx:12,20`) | Switch already has a nice cubic-bezier-with-overshoot at `[0.34,1.56,0.64,1]` — propagate that to checkboxes, radios, and the form-error shake | Single curve across all form elements = single instrument. Today's inconsistency reads as "different teams shipped this." |

---

## 4. Gesture support — what's missing on mobile

**What exists:**

- `useSwipeNavigation` (`hooks/use-swipe-gesture.tsx`) — mounted exactly once, in `App.tsx:952`. Swipes between hardcoded `defaultRoutes = ["/", "/leads", "/properties", "/deals", "/finance", "/settings"]`. That's it.
- `PullToRefresh` (`components/mobile/PullToRefresh.tsx`) — used in *one place*: `founder/MorningBriefing.tsx:154`. Has Capacitor haptics. Good component, dead-on-arrival in the customer surface.
- `MobileBottomNav` — exists, mounts on auth, hides on `/founder`.

**What's missing — and where it hurts:**

1. **Swipe-to-archive / swipe-to-action on list items.** Inbox messages, leads, tasks, decisions — all are list-shaped, none have swipe actions. Mail.app sets the bar; AcreOS's mobile inbox is just a vertical scroll with tap-to-open. *Add swipe-left = archive, swipe-right = mark-done* on `inbox.tsx`, `tasks.tsx`, and `DecisionQueuePage`.
2. **Pull-to-refresh on every queryable list.** `PullToRefresh` is in 1 of 50+ pages. Should be the wrapper around any `useQuery`-backed list on mobile: pipeline, leads, properties, deals, inbox, tasks, today, decisions. The component already exists. This is a 30-minute task to thread it through the standard list page wrapper.
3. **Long-press → context menu.** On a deal card, a long-press should open: Move stage / Add note / Convert / Archive. Currently long-press does nothing on mobile (the `onContextMenu` desktop handler doesn't fire from touch).
4. **Drag-to-reorder kanban columns and rearrange Today's priorities.** Framer's `<Reorder>` is purpose-built. Today list reorder = a 90-second power-user feature that screams "this app respects me."
5. **Edge-swipe back navigation.** The only swipe nav today is *between* siblings on a fixed list. Apple's iOS navigation grammar is *swipe-from-left-edge = back*. AcreOS doesn't have it. Add via Capacitor on native, via a left-edge `panResponder`-equivalent on web.
6. **Swipe-to-dismiss the PaxCopilotRail and ConversationTray on mobile.** Both are sheets; both should drag-close.

The `useSwipeNavigation` hook is also too zealous: `defaultRoutes` is six hardcoded paths, threshold 150px, no edge-detection. That means a fast horizontal scroll inside a wide table can navigate the user away. The threshold and the 3:1 horizontal:vertical ratio at lines 91-95 help, but the right architecture is **gesture-by-region**, not a global document-level handler. Per-page opt-in via `data-swipe-nav="left,right"` would be cleaner.

---

## 5. Skeleton + stagger choreography — pages that should adopt

20 pages already import `Skeleton` (good). The choreography problem is that they show as a *block* and replace as a *block* — no shape-match, no stagger settle.

**The pattern to standardize** (call it `<ContentReveal>`):

```tsx
<motion.div variants={staggerContainer} initial="hidden" animate="visible">
  {isLoading
    ? rows.map((_, i) => <motion.div key={`s${i}`} variants={staggerItem}><Skeleton className="..."/></motion.div>)
    : items.map(item => <motion.div key={item.id} variants={staggerItem} layout><Card {...}/></motion.div>)
  }
</motion.div>
```

Crucial: the **same `staggerItem` wraps both states**, and the skeleton row's height/shape matches the resulting card. When data arrives, items don't appear — they *replace* in place, with the surrounding stagger giving the eye somewhere to track.

**Pages to adopt first** (high-traffic, query-heavy):

1. `today.tsx` — first thing every user sees daily. Currently: Skeleton block → snap to content. Should: skeleton tiles → content tiles in same positions, 50ms stagger.
2. `pipeline.tsx` — kanban board. Each column independently staggers its skeletons.
3. `leads.tsx`, `properties.tsx`, `deals.tsx` — table-like surfaces. Row-height-matched skeletons.
4. `inbox.tsx` — mail-style list. Skeleton must match the avatar+two-line geometry.
5. `parcel-detail.tsx` (already imports Skeleton) — verify it stagger-reveals each section card.
6. `dashboard.tsx` and `executive-dashboard.tsx` — KPI tile grids. Each tile reveals on its own beat.

**Anti-pattern to kill:** the bare `<Loader2 className="animate-spin"/>` fallback in `App.tsx:325-330`, `App.tsx:351-356`, `App.tsx:383-387`. A spinning loader is a 1990s trope. Replace with the branded `<PageLoader>` everywhere it appears, and even that should only show after 200ms of waiting (use `useDelayedLoading`) — instant content beats any skeleton.

---

## 6. Three "hero moment" opportunities (no theatrics, brief §13 compliant)

Hero moments are not confetti. Apple's "your year in music" is a hero moment because it *reframes work the user has already done* into something emotionally resonant. AcreOS has three earned ones:

### Hero #1 — First Deal Closed

**Trigger:** a deal moves into `closed_won` for the first time in the org's history.

**Motion:** the kanban card itself becomes the hero. It detaches from the column with a `quickSpring` lift (scale 1.0→1.04, shadow-2→shadow-4), the deal title swaps to a typed-out `motion.span` of "Your first close: [property]", and a subtle gold ring (using existing `--acr-brand` token at 14% alpha) breathes once around the card for ~1.4s before settling into the closed-won column with a `smoothSpring`. **No particles, no overlay, no modal.**

**Why it works:** the user's *own card* is the celebration. The motion happens on the object they were already looking at. Brief §13 (no confetti) untouched.

### Hero #2 — Goal Achieved

**Trigger:** any goal in `/goals` reaches 100% (first time only — flag in localStorage and on `goals.completed_celebrated_at`).

**Motion:** the progress bar fills the last segment with a `smoothSpring` overshoot (1.0 → 1.02 → 1.0), the percentage number does a `<motion.span>` count-up via `useSpring` from the previous % to 100, and the goal card's border thickens by 1px and shifts to brand-color over 600ms. A single subtle haptic on mobile.

**Why it works:** the achievement happens *inside* the card the user is staring at. No interruption, but it's unmistakably different from the tick at 73% → 74%.

### Hero #3 — End of First Week

**Trigger:** `today.tsx` loads on day 7 of the org's life (compute from `organizations.createdAt`). One-time only.

**Motion:** the standard Today layout loads as normal, but the top banner-row slot reveals a `<motion.div>` that gently slides down from above with `smoothSpring` and reads: "Your first week. *N* leads. *M* offers. *P* deals." Numbers count up via spring. A "Keep going" link sits inline. After 8 seconds with no interaction, it auto-dismisses with a `slideUp`-exit. The user can dismiss earlier with `Esc` or X.

**Why it works:** it's a *summary*, not a celebration. It's a respectful "you did the thing." Founder/Land-Investor framing intact, no confetti, dignified.

(Notably *not* a hero: NPS prompt, command-palette discover, onboarding completion. Those are operational moments. Hero moments are reserved for *user-earned* milestones tied to outcomes — leads, deals, goals.)

---

## 7. Implementation sequence — two focused weeks

### Week 1 — Vocabulary unification (foundation)

**Day 1 — Token reconciliation.** Make Framer animations consume CSS tokens. Add a `getMotionTokens()` helper in `client/src/lib/animations.ts` that reads computed styles for `--acr-dur-fast/normal/slow` at module init and exposes them. Refactor `quickSpring`, `smoothSpring`, all variants to read from this single source. Result: changing `--acr-dur-normal` propagates everywhere.

**Day 2 — Spring-first Button.** Convert `client/src/components/ui/button.tsx` to a `motion.button` with `whileTap={buttonTap}` using `quickSpring`. Verify that the `asChild` Slot variant still works (Framer + Radix Slot needs `forwardRef` care). Ship behind a feature flag, dogfood for 24h, then default-on.

**Day 3 — Kill the page-level crossfade.** Remove `<PageWrapper>` from `App.tsx`. Add `<ContentReveal>` to today, pipeline, inbox. Measure perceived load latency (Lighthouse + RUM `hero-element-paint`). Expected: −150–250ms perceived, despite zero network change.

**Day 4 — List-aware AnimatePresence.** Add `popLayout` mode + `layout` to: pipeline kanban columns, inbox list, comment threads. This is the "where things came from" upgrade.

**Day 5 — Toast + dropdown polish.** Toast spring from corner. NewItemMenu and CommandPalette switched from bare durations to `quickSpring`. Dynamic Island consolidated to two stiffness values.

### Week 2 — Mobile gestures + hero moments

**Day 6 — PullToRefresh standardization.** Create `<ListPage>` wrapper that includes PullToRefresh on mobile, takes a `refetch` prop. Apply to today, pipeline, leads, properties, deals, inbox, tasks, decisions in one PR.

**Day 7 — Swipe actions on list items.** Build `<SwipeRow>` primitive with left-action and right-action slots, dragElastic 0.3, snap thresholds at 30%/70%. Wire into inbox first (archive ←, mark-read →), then tasks (complete ←, snooze →), then decision queue.

**Day 8 — Long-press context menu (mobile).** Build `<TouchContextMenu>` using `pointerdown` + 500ms timeout + haptic. Wire into deal card and parcel card.

**Day 9 — `layoutId` cross-page handoff.** Add `layoutId="parcel-${id}"` from parcel-card to parcel-detail header image. Same for pipeline-card → deal-detail. This is the showstopper interaction the audit will be remembered for.

**Day 10 — Hero #1 (first deal closed).** Detect, animate the card, ship behind a flag.

**Day 11 — Hero #2 (goal achieved).** Card-internal celebration, count-up, breathing ring.

**Day 12 — Hero #3 (end of first week).** Today-page banner slot, spring-counted summary, auto-dismiss.

**Day 13 — Reduced-motion audit.** Verify every new animation respects `MotionConfig reducedMotion="user"`. Add `useReducedMotion()` checks where Framer's automatic handling isn't enough (count-ups should snap to final value; springs should become instant). Today there is *zero* runtime use of `useReducedMotion()` outside the sound hook — that's a gap.

**Day 14 — Polish + telemetry.** Add `motion.frameRate` tracking. Anything below 50fps on a Pixel 4a-class device gets reverted. Document the rule.

---

## Closing — the philosophical bit

AcreOS is not undermotioned. AcreOS is *over*-motioned and *under*-curated. There are 21 spring usages, 9 ease usages, 30+ bare durations. The user can't tell which curve means "I confirmed your input" vs "the page is loading" vs "this thing was deleted" because the same fade-out appears under all three meanings.

Pick **two springs** (quick + smooth). Pick **two durations** (fast + normal). Use them everywhere. Reserve `slow` and easings for *one* meaning each (slow = arrival; ease-out = exit). When every motion in the app is one of four phrases, the user starts reading them as language — and *that's* what makes Apple feel like Apple.

— Kade
