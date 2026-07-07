# Priya Iyer — Settle Choreography Audit
**Wave 2 · 2026-05-01 · The frames between "loaded" and "settled"**

> Bavo plated the *first* frame after the click. I'm here for the *last* frame — the one where the rows finish landing and the user knows the system is done. AcreOS has no last frame. Things just stop moving. That's the difference between Apple Mail (rows slide in like cards being dealt) and a 2010 spinner (here, then suddenly there).

---

## 1. One-line verdict

AcreOS has the *primitives* for elite settle choreography (`staggerContainer`, `staggerItem`, `quickSpring`, `smoothSpring`, `AnimatePresence` with `popLayout`) — but on the five surfaces that matter (today, leads, properties, deals, inbox) **none of them are wired to data state-changes**, so every list reorder, filter change, optimistic write, and tab swap is a hard cut. Three (3) of ~677 mutations write through optimistically; the rest waste 200–500ms of dead air per gesture.

---

## 2. Optimistic-update inventory

### 2.1 Where it works (the gold standard)

| File:line | Verb | Quality |
|---|---|---|
| `client/src/components/focus-list.tsx:210-247` | `recordContactMutation` removes lead from focus list on click | **Reference quality.** `cancelQueries` → `setQueryData` snapshot → optimistic remove → rollback context → `invalidateQueries` on settle. This is the textbook TanStack pattern and the only one in the customer-facing app. |
| `client/src/components/founder/AgentTeamChat.tsx:175-184` | `sendMessage` appends user bubble before round-trip | Founder-only. Append-then-confirm. Right shape. |
| `client/src/components/settings/data-network-settings.tsx:46` | toggle | Trivial scope but the pattern is right. |

### 2.2 Where it's missing (the dead air)

These are the five most-frequent customer gestures. Each currently waits the full network round-trip before showing the result.

| Hook | File:line | Verb | Round-trip cost |
|---|---|---|---|
| `useCreateLead` | `client/src/hooks/use-leads.ts:75-113` | Create lead from form | ~300ms before row appears |
| `useUpdateLead` | `client/src/hooks/use-leads.ts:115+` | Edit lead status / assignment | ~300ms before list reflects |
| `useUpdateDeal` | `client/src/hooks/use-deals.ts:93-118` | **Kanban drag-drop** stage change | ~300ms — *user has already moved the card visually via dnd-kit transform, then it snaps back to origin and waits, then re-renders into new column.* This is the worst single gesture in the app. |
| `useCreateDeal` | `client/src/hooks/use-deals.ts:60-90` | Create deal | ~300ms |
| `completeMutation` | `client/src/pages/tasks.tsx:169-188` | Mark task complete | ~250ms — checkbox sits half-checked while server confirms |

**The kanban drag is special.** `client/src/pages/deals.tsx:164-195` — `handleDragEnd` calls `updateDealStage` with `onSuccess`/`onError` callbacks, but the mutation itself (`use-deals.ts:101-102`) just `invalidateQueries` after success. Combined with `<DragOverlay dropAnimation={null}>` at `deals.tsx:966`, the user's card has nowhere to land — the drag overlay vanishes, the source column still shows the card (until invalidation), then a refetch re-renders both columns. Three states for one drop.

**Other missing optimistic verbs** (sampling — total inventory ~150 useMutation call sites):

- `client/src/pages/tasks.tsx:153` — `updateMutation` (rename, reschedule)
- `client/src/pages/tasks.tsx:190` — `deleteMutation` (task disappears with no exit animation)
- `client/src/pages/leads.tsx:184, 371` — `rescoreMutation` (no UI state during 1-2s rescore)
- `client/src/pages/leads.tsx:504` — `consentMutation`
- `client/src/components/comment-thread.tsx` — comment post (per Kade §3 #14 — lists currently jump-cut)
- `client/src/components/sms-conversation.tsx` — message send (already streams scroll-to-bottom but bubble pops in)

**Inventory verdict:** 3 optimistic / ~677 useMutation occurrences = **0.4% adoption**. Bavo §2-F counted the same; I'm reading it as a choreography problem because optimism is *the only way to give the eye a settle frame to track*. Without `onMutate`, the response *is* the animation — and TanStack's default response is an unmount/remount, which has no choreography at all.

---

## 3. List-stagger audit — settle pattern by surface

The settle pattern I'm scoring against: **on data arrival, items appear in a 30–60ms stagger; on filter/sort change, items animate to new positions via `layout`; on insert, neighbors slide aside via `popLayout`.**

### 3.1 Pages with **zero** settle choreography (snap on every state change)

Verified by `grep -n "staggerItem\|staggerContainer\|layout\b\|AnimatePresence"` across each file — zero matches in any of:

| File | Lists involved | Current settle |
|---|---|---|
| `client/src/pages/leads.tsx` | 1 main table (`filteredLeads` map at line 951+, ~64px rows) | `useDelayedLoading` skeleton → snap to rows. Filter change at `leads.tsx:951-988` returns new array — rows jump-cut to new positions. |
| `client/src/pages/properties.tsx` | 1 grid (6 cards) + map | `<ListSkeleton count={6} variant="card"/>` (line 669) → snap. Filter change → snap. |
| `client/src/pages/deals.tsx` | 5 kanban columns × N cards | Per-column skeleton (line 1058) — already independently visible. But card insert/move = pop. |
| `client/src/pages/today.tsx` | 5 sections (lines 835/892/1120/1223/1276) | Each pops independently when its query lands. No global stagger, no shared rhythm. |
| `client/src/pages/inbox.tsx` | Mail list (line 1142) + thread pane (line 783) | List skeleton → snap. Detail pane: spinner → bubbles snap. |
| `client/src/pages/decision-queue.tsx` | Decision card stack | Full-page `Loader2` (line 234-247) → snap. |
| `client/src/pages/dashboard.tsx` | KPI tiles + intelligence | "—" placeholders (lines 245/257/268) → snap to numbers. |

### 3.2 Pages with **partial** settle (rare wins worth copying)

| File:line | Quality |
|---|---|
| `client/src/components/sms-conversation.tsx:159-163` | `staggerContainer` + `staggerItem` per bubble. ✓ |
| `client/src/components/team-general-channel.tsx:140-142` | Same. ✓ |
| `client/src/components/activity-timeline.tsx:299-306` | Same. ✓ |
| `client/src/components/cohort-retention-dashboard.tsx:166-256` | Per-block stagger. ✓ |
| `client/src/components/deal-feed/daily-deal-feed.tsx:663, 725` | **Two `AnimatePresence mode="popLayout"` blocks** — the only customer surface using popLayout. When a card is swiped/dismissed, neighbors slide. This is the only real settle in the app. |

### 3.3 The choreography deficit, by the numbers

- `AnimatePresence` instances: 21 — but all but two (`daily-deal-feed.tsx`) are `mode="wait"` for modal/wizard transitions, not list reorders.
- `mode="popLayout"`: **2 occurrences total**, both in one file.
- Framer `<Reorder.*>`: **0 occurrences.** No sortable list in the app uses Framer's purpose-built reorder primitive. Kade §4 #4 already flagged this for Today priorities.
- `layout` prop on `motion.div`: **0 occurrences in any list rendering.** (6 hits are all Recharts `BarChart layout="vertical"`, unrelated.)

### 3.4 Filter / sort re-orders — the silent jump-cut

`leads.tsx:951-988` recomputes `filteredLeads` via `useMemo` on every change to `search`, `stageFilter`, `assigneeFilter`, `gisFilters`. The DOM diff replaces rows in place; the user's eye loses the row they were tracking. Same pattern in:

- `properties.tsx` filter UI (search, stageFilter)
- `deals.tsx` view filter
- `tasks.tsx` filter dropdown
- `inbox.tsx` channel/folder filter

**The fix is the same in every file:** wrap the list in `<motion.div layout>` and each row in `<motion.div key={item.id} layout>`. Framer handles position diffs with FLIP. With `quickSpring` (stiffness 500, damping 30) the rows arrive in their new positions over ~280ms, and **the user can follow a single row across a sort.** That is the Apple Mail moment.

---

## 4. Tab-switch + scroll-restore behaviors

### 4.1 Tab switches

`client/src/components/ui/tabs.tsx` is a thin Radix wrapper. `TabsContent` (lines 38-51) has no enter/exit motion — Radix mounts the new pane synchronously when the trigger flips. The CSS-only `transition-all duration-200` on `TabsTrigger` (line 30) animates the *trigger pill*, not the content.

**Pipeline — the worst case** (`client/src/pages/pipeline.tsx:285+`):

1. User taps "Leads" tab.
2. `TabsContent value="leads"` mounts.
3. Inside, `<React.Suspense fallback={<TabFallback/>}>` shows the `animate-pulse "Loading…"` block (`pipeline.tsx:47-56`).
4. Lazy chunk arrives, mounts the leads page.
5. Leads page's *own* `useDelayedLoading` shows table skeleton.
6. Skeleton snaps to rows.

**Five distinct paint states for one tap.** Kade §2 calls this animation→spinner→content; in pipeline it's animation→spinner→spinner→skeleton→content.

**Other tab pages with the same disease:**
- `parcel-detail.tsx` (Tabs on detail surface)
- `settings.tsx`
- `agent-collaboration.tsx`
- `fee-dashboard.tsx`
- `land-credit.tsx`
- `queue-monitor.tsx`
- `conscious-organization.tsx`
- `team-dashboard-content.tsx`
- `ab-test-manager.tsx`, `ab-tests-content.tsx`
- `sequences-content.tsx`, `campaigns-content.tsx`
- `template-editor.tsx`
- `import-export.tsx`
- `signature-capture.tsx`
- `document-generator.tsx`, `content-generation.tsx`, `ai-offer-generator.tsx`
- `help/HelpPanel.tsx`

In *none* of these does the tab content cross-fade or slide. It pops.

### 4.2 Scroll restoration

`grep -rn "ScrollRestoration\|scroll-restoration"` returns **zero hits** across `client/src`.

`scrollTo`/`scrollIntoView` is used in 9 places, all for *intra-component auto-scroll-to-bottom* (chat panes, conversation tray, pax copilot rail, team channel, sms, support, agent-team-chat) — never for navigation restoration.

**What this means in practice:**

1. User scrolls 600px down the leads list.
2. Clicks a lead → `/leads/:id` (or opens detail drawer).
3. Hits browser back.
4. **Lands at scroll Y=0.** The previous reading position is gone.

The router is `wouter` (per `App.tsx` imports). Wouter does not include scroll restoration, and the project never wired `window.scrollRestoration = 'manual'` + a per-route position cache. This is *the* mobile-feel gap when someone uses the app on a phone with thumb-scroll — every back-tap drops them at the top of a fresh list, with the scroll fade and the skeleton firing all over again.

### 4.3 The page-transition unmount problem

`App.tsx:928-946` — every route nav unmounts the entire subtree (`key={location}` on the wrapping `motion.div`). This is the *root cause* of the missing scroll restoration: even if the user's previous scroll position were saved, the route's own internal state (filter, sort, scroll) is destroyed on every nav. Kade §2 already recommends deleting `<PageWrapper>`. I concur — scroll restoration is impossible until the route subtree persists across navigations.

---

## 5. The 5 highest-impact choreography upgrades

Ranked by `(daily occurrences) × (perceived-quality delta)`. Each is a *settle* fix, complementary to Kade's *vocabulary* fixes and Bavo's *loading* fixes.

### #1 — Optimistic kanban drag (the spec-defining gesture)

**File:** `client/src/hooks/use-deals.ts:93-118` (`useUpdateDeal`).

**Add `onMutate`:** snapshot deals list, optimistically remove from source column, insert at top of target column, rollback on error. **Add `<motion.div layout>` to `DealCard`** (`client/src/pages/deals.tsx:1091`) and **`<AnimatePresence mode="popLayout">`** wrapping the cards inside `KanbanColumn` (`deals.tsx:1066-1075`). With `quickSpring`, the dropped card lands and neighbors slide aside.

**Why #1:** the Land-Investor's most-touched gesture. Currently 3-state ugly (drag → snap-back → re-render). Becomes 1-state physical.

### #2 — `<motion.div layout>` on every filterable list row

**Files:** `leads.tsx:951+`, `properties.tsx`, `deals.tsx`, `tasks.tsx`, `inbox.tsx`.

Wrap each row/card in `<motion.div layout key={item.id}>` and the parent in `<AnimatePresence mode="popLayout">`. Framer's FLIP runtime handles every filter-change as a spring. This is the Apple Mail "the row I was looking at glides to its new position" moment — generally one PR, ~30 lines per file.

### #3 — Optimistic create-lead + slide-in from top

**File:** `client/src/hooks/use-leads.ts:75-113` (`useCreateLead`).

`onMutate`: prepend a temporary lead with `id: `temp-${Date.now()}`` and `pending: true` flag to the cached list. With #2 already shipped, the row springs in from y=-8 with `staggerItem`. On success, swap temp ID for real ID (use `useMutation`'s `context` pattern). On error, rollback + toast.

**Pair with:** the temporary row should render with 60% opacity until confirmed (a "this is provisional" affordance Stripe Dashboard uses). Bavo's note about "the response is the animation" applies here perfectly.

### #4 — Tab-content cross-fade with shared layout

**File:** `client/src/components/ui/tabs.tsx:38-51`.

Replace the `TabsPrimitive.Content` body with a `motion.div` that uses `key={value}` + `AnimatePresence mode="wait"` and a 180ms `fadeIn`. Critical: the *underlying tab pane data* should already be prefetched (TanStack `prefetchQuery` on hover of the tab trigger) so the cross-fade arrives at content, not at another spinner. Otherwise we're just animating the transition into a loading state.

For tabs whose content is heterogeneous heights (pipeline's board vs leads vs properties), use `LayoutGroup` so the height transitions instead of jump-cutting.

### #5 — Per-route scroll restoration via wouter + sessionStorage

**File:** new `client/src/lib/scroll-restoration.ts`.

```tsx
// Sketch
useScrollRestoration() {
  const [location] = useLocation();
  useEffect(() => {
    const saved = sessionStorage.getItem(`scroll:${location}`);
    if (saved) window.scrollTo(0, parseInt(saved, 10));
    return () => sessionStorage.setItem(`scroll:${location}`, String(window.scrollY));
  }, [location]);
}
```

**Wire at `App.tsx:948+` `AppContent`.** Pair with deletion of `<PageWrapper>` (Kade §2) so the route subtree survives long enough to *have* a scroll position to restore. Without that change, this hook restores scroll on a freshly-mounted tree where data hasn't loaded yet — and the restore lands at Y=600 of an empty page. Order matters: kill PageWrapper first, then add scroll-restore, then everything else.

---

## 6. Motion vocabulary recipe — for data, not chrome

Kade defined the language. Bavo defined when it speaks. This is *what* it says about data.

### 6.1 The four phrases (data dialect)

| Phrase | When | Spring | Stagger |
|---|---|---|---|
| **Arrival** — first paint after data lands | List mount, page mount | `smoothSpring` (stiffness 300, damping 25) on container; items use `staggerItem` with 8px y-offset | `staggerChildren: 0.04` (40ms), `delayChildren: 0.06` (60ms), max 8 items staggered then cap |
| **Insert** — optimistic create | New row from `onMutate` | `quickSpring` (stiffness 500, damping 30); row enters from `y: -16, opacity: 0` | None — single item |
| **Reorder** — filter / sort / drag | Filter change, kanban drop, table sort | `quickSpring` via Framer `layout` prop on each row | None — Framer FLIP handles each row independently |
| **Exit** — delete / archive | Optimistic remove | `quickSpring` to `opacity: 0, scale: 0.95, x: 12 (right) or x: -12 (left swipe)`; wrap parent in `mode="popLayout"` | Implicit — neighbors slide via parent's layout |

### 6.2 Timings

- **Arrival stagger window:** 40ms × min(items.length, 8) = 0–320ms total. Past 8 items, the eye stops perceiving stagger; cap and cut over.
- **Insert spring duration:** ~280ms to within 5% of resting (stiffness 500, damping 30).
- **Reorder spring duration:** ~280ms (same family) — keeps insert and reorder feeling like one instrument.
- **Exit duration:** 200ms — exits should be slightly faster than entrances (Apple's rule: things leave faster than they arrive, so the user knows they're gone before the next thing claims attention).

### 6.3 Easings (when not springing)

- `[0.25, 0.46, 0.45, 0.94]` — already in `slideUp` (`animations.ts:46`). Keep for *one* purpose: the page-mount blur-in (`page-enter` at `index.css:1214`). Don't reuse for data.
- `easeOut` — exits only.
- **Never `easeIn` for data.** It accelerates *into* the user's attention, which reads as "a thing is approaching" — wrong message for "a row has loaded."

### 6.4 Reduced-motion contract

`MotionConfig reducedMotion="user"` at root handles most of it. **Hand-wire** for:
- Optimistic-insert: snap to final position (no `y: -16` transit).
- Reorder: no spring; instant position swap.
- Stagger arrival: collapse to single 100ms fade-in for the whole container.

Use `useReducedMotion()` from `framer-motion` — currently called in **0** places outside the sound hook (Kade §7 Day 13). Add as part of the data-dialect rollout.

### 6.5 Concrete drop-in additions to `client/src/lib/animations.ts`

```tsx
// Append to animations.ts
export const listArrival: Variants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.04, delayChildren: 0.06 },
  },
};

export const listItemArrival: Variants = {
  hidden: { opacity: 0, y: 8 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 300, damping: 25 },
  },
};

export const listItemInsert: Variants = {
  hidden: { opacity: 0, y: -16 },
  visible: {
    opacity: 1,
    y: 0,
    transition: { type: "spring", stiffness: 500, damping: 30 },
  },
  exit: {
    opacity: 0,
    scale: 0.95,
    transition: { duration: 0.2, ease: "easeOut" },
  },
};
```

These are deliberately *separate* from `staggerContainer` / `staggerItem` so the "data dialect" can evolve without breaking chrome animations that already use the existing primitives.

---

## 7. Cross-references

### 7.1 To Kade (`kade-motion.md`)

- **§3 #5 (kanban `<motion.div layout>`):** my §5 #1 — same fix, different angle. Kade frames it as motion-vocabulary; I frame it as the optimistic-update cliff. Both must ship together or the layout animation runs *after* the network round-trip (worst of both worlds).
- **§2 (kill PageWrapper crossfade):** prerequisite to my §5 #5. Without route-subtree persistence, scroll restoration restores into a re-mounting tree.
- **§3 #14 (comment threads with popLayout):** same family as my §5 #2 — list-row layout. Same primitive (`mode="popLayout"`), different surface.
- **§4 #4 (Framer Reorder for Today priorities):** the only place in the app where `<Reorder.Group>` belongs. I confirm zero current usage.

### 7.2 To Bavo (`bavo-loading.md`)

- **§2-F (optimistic updates):** Bavo identified the gap (3 sites). I identify the *choreography* missing on top: even when optimistic writes happen, without `layout`/`popLayout` they snap. The `onMutate` is necessary but not sufficient.
- **§7 (`/parcel-detail` ships first):** I agree. Add to that recipe: when navigating *from* `/properties` to `/parcel-detail`, the source card uses `layoutId="property-${id}"` (Kade §3 #9) — which is *the* settle moment that ties Bavo's loading + Kade's transitions + my reorder dialect into one gesture.
- **Bavo §6 #8 (Pattern F adoption):** the verbs match my §2.2 inventory exactly (tasks complete, deal stage move, lead status change, comment post, message send). Bavo names the gap; I name the recipe (§6).

### 7.3 To Vesna (referenced by Bavo §4)

- 36 bare `Loading…` strings is a copy problem upstream of my settle problem. A skeleton that says "Loading your focus list…" while the items spring into place is the Apple-Music-tier composite. Without the noun, even perfect motion reads as anonymous.

---

## Closing

The diagnosis is simple: **AcreOS animates the chrome and snaps the data.** Buttons spring; lists pop. Modals slide; rows jump. The user reads the difference instantly — they don't articulate it, but they feel it as "this app cares about itself but doesn't care about my work."

The fix is also simple, and entirely additive: nine lines of `<motion.div layout>` in five files, two new variants in `animations.ts`, three `onMutate` blocks in three hooks, one scroll-restoration helper. No new components. No new vocabulary. Two days of work.

When data settles like the chrome already does, the app stops being a UI around a database and starts being one continuous thing — which is what "feels like Apple" actually means.

— Priya
