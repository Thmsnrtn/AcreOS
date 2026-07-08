# Lukas Albrecht — Shared-Element Transitions Audit

> Tapping a list row should *grow* into the detail view. Crossfading is what websites do. Apps morph.

## 1. Verdict

AcreOS has Framer Motion, has motion tokens, and has detail surfaces worth animating into — and not a single `layoutId` in the codebase. Every list-to-detail interaction is a hard cut wrapped in a 250ms opacity flicker. That is the gap between "feels like a website" and "feels like an iOS app," and it is closeable in a focused week.

---

## 2. The page-transition problem

**The bug, in two files:**

- `client/src/App.tsx:928-946` — `PageWrapper` renders `<motion.div key={location} ...>` inside `<AnimatePresence mode="wait">`. Every route change unmounts the entire route subtree.
- `client/src/lib/animations.ts` (referenced as `pageTransition` at `App.tsx:17`) — the variant being applied is opacity 0→1 + a near-invisible 8px x-slide.

Why this *kills* shared-element transitions, mechanically:

1. Framer's `layoutId` works by **registering a node id with a presence parent**, then — when a node with the same id mounts elsewhere within the same `AnimatePresence` boundary — interpolating size/position via FLIP between the two.
2. With `mode="wait"`, AnimatePresence holds the exit until `onExitComplete`, then mounts the new tree. But the source `motion.div` and the destination `motion.div` are *different children of the same key-switching parent*. By the time the destination mounts, the source has already been removed from the layout-id registry. **There is nothing to morph from.**
3. Even if both were alive simultaneously, the `key={location}` invalidates the React subtree — every descendant is a fresh React fiber. `layoutId` reconciliation across two unrelated fibers cannot find a match because the source's measurement is gone.
4. Net effect: any `<motion.img layoutId="parcel-123-hero">` inside `/properties` and a matching one inside `/parcels/:id` are **strangers**. They will never see each other.

This is also why Kade's audit could correctly flag the page wrapper as "false-flash": it isn't only that the crossfade is too short — it's that it *fundamentally precludes* the higher-tier interaction we'd otherwise want to layer on.

**Adjacent damage:**

- `App.tsx:383-387` (Suspense fallback) and `:325-330`, `:351-356` (auth/persona loading) all replace the tree with a spinner, which is another layoutId interruption. Even if we fixed `PageWrapper`, the Suspense boundary still wipes the source on a cold lazy-chunk load.
- The route-level `<React.Suspense>` is *inside* `Router()` (`App.tsx:383`), which is good — it means a warm chunk navigates without a fallback. But cold-chunk routes still blow away layoutId source nodes.

---

## 3. Per-surface shared-element proposals

Eight handoffs ranked by how often the user makes the gesture and how much polish-per-pixel each delivers.

### S1 — Parcel card → /parcels/:id hero

- **Source:** the property card on `/properties` (and on `/today` when shown). Each card has a thumbnail + acreage badge + address.
- **Destination:** `pages/parcel-detail.tsx` MetricCard row + Overview Card (`parcel-detail.tsx:208`+).
- **What flies:** the thumbnail image and the address text. The image scales from card-thumb (≈80×80) to detail-hero (≈full-width × 240). The address text translates from one-liner-truncated to full H1.
- **How:** wrap the card image in `<motion.img layoutId={`parcel-${id}-hero`} />` and the same prop on the detail page hero. Same for `layoutId={`parcel-${id}-title`}` on the address.
- **Curve:** `smoothSpring` (stiffness 300, damping 25) — a soft 320ms morph.
- **Tap-feedback while route loads:** the card itself gets `whileTap` scale 0.97 with `quickSpring`. So even if the chunk takes 300ms, the card visibly *commits* to opening before navigation fires.

### S2 — Lead row → LeadDetailDrawer

- **Source:** lead row in `pages/leads.tsx` table.
- **Destination:** `LeadDetailDrawer` at `pages/leads.tsx:2363`, opened from `:1817`.
- **What flies:** the avatar circle (or initials chip) and the lead name. The avatar grows from 32px to 56px in the drawer header. Name slides from row-x to drawer-header-x.
- **How:** drawer is already a sibling tree (drawer doesn't unmount the route), so `layoutId` works *today* without any App.tsx fix. This one is a freebie — same parent, no cross-route boundary.
- **Curve:** `quickSpring` for the drawer slide-in; the avatar morphs with `smoothSpring` on top.

### S3 — Deal card → DealDetailModal

- **Source:** deal card on `/deals` and `/pipeline` (kanban).
- **Destination:** `DealModalsHost` at `client/src/components/modals/index.tsx:16`.
- **What flies:** the deal **amount** (the `$X,XXX` token) and the deal title. Amount slides from bottom-right of card up to a hero position in modal header. Title morphs from card-h3 (16px) to modal-h2 (24px).
- **How:** `layoutId={`deal-${id}-amount`}`, `layoutId={`deal-${id}-title`}`. Kanban → modal is the same parent (`AppContent`), so this is also a freebie post-PageWrapper-removal.
- **Why amount specifically:** in a CRM, the dollar value *is* the news. Letting it physically travel into the modal header tells the user "yes, *this* deal, *that* amount — you're in the right place" without them re-reading.

### S4 — Pipeline kanban card → /deals/:id (when we add it)

- **Source:** `pages/pipeline.tsx` deal cards in column.
- **Destination:** future `/deals/:id` route (deals page currently uses modal-only; route version is on the roadmap per Kade §7).
- **What flies:** stage chip + amount + title. Stage chip is the most fun — it morphs from a 20px-tall column-color pill into a stage-progress dot at the top of the detail page.
- **How:** identical `layoutId` triple. Requires App.tsx fix (cross-route).

### S5 — Properties grid card → MapsPage pin focus

- **Source:** card on `/properties`.
- **Destination:** `pages/maps.tsx` with selected parcel.
- **What flies:** the thumbnail "shrinks" into the map pin via `layoutId`, and the map pin then expands its callout on settle.
- **How:** harder — the destination is a Mapbox/Leaflet canvas. The trick is to render the map pin as an **HTML overlay element** (already standard practice), give it a `motion.div` with the matching `layoutId`, and let Framer FLIP between DOM thumbnail and DOM pin. The map repositions independently after settle.
- **Payoff:** this is the Apple-Maps-find-on-map gesture. High polish, real "oh."

### S6 — Today's "Next decision" card → DecisionQueuePage row

- **Source:** card in `pages/today.tsx` ("Your next decision: …").
- **Destination:** highlighted row in `pages/decision-queue.tsx`.
- **What flies:** the decision title + the urgency dot. Title slides from card-position up into table-row-position.
- **How:** `layoutId={`decision-${id}-title`}`. Cross-route — needs App.tsx fix.

### S7 — Inbox row → InboxThread view

- **Source:** message row in `pages/inbox.tsx`.
- **Destination:** thread detail (split-pane on desktop, full-screen on mobile).
- **What flies:** sender avatar + subject. Subject morphs from one-line truncated to full multi-line h1.
- **How:** if the split-pane stays mounted (likely), this is same-parent like S2 — freebie.

### S8 — FAB → New-item form

- **Source:** `FloatingActionButton` (mobile-only, `App.tsx:1019`).
- **Destination:** the New-Item Sheet that opens from FAB tap.
- **What flies:** the FAB **itself** — the circular button morphs into the sheet's top icon. Apple's mail compose, Things 3 add-task, exactly this gesture.
- **How:** `layoutId="fab-shell"` on both. `quickSpring`. The FAB never disappears — it *becomes* the sheet.

---

## 4. Implementation pattern

### 4a. Replace PageWrapper with a route-aware AnimatePresence

```tsx
// client/src/App.tsx — replace PageWrapper

function PageWrapper({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  // No key change → no unmount. AnimatePresence keeps the layoutId
  // registry alive across route changes. Sub-pages opt into their own
  // entrance animations via a thin <RouteShell> wrapper (see 4b).
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      <div key="route-stable" className="min-h-screen" id="main-content">
        {children}
      </div>
    </AnimatePresence>
  );
}
```

The crucial diffs vs today:

- `mode="popLayout"` (not `"wait"`) — exiting nodes leave the layout immediately so neighbors don't jump while they fade. This is what keeps the layoutId source available *during* the destination mount, not after.
- The outer `<div>` no longer has `key={location}`, so the React subtree is stable. Routes still swap inside it because `wouter`'s `<Switch>` returns different components for different paths — but they mount as siblings of the *same parent fiber*, which is what `layoutId` needs.
- `initial={false}` so the very first paint doesn't animate everything from invisibility.

### 4b. Per-page entrance via RouteShell (replaces page-level crossfade)

```tsx
// client/src/components/route-shell.tsx — new

import { motion } from "framer-motion";
import { staggerContainer, staggerItem } from "@/lib/animations";

export function RouteShell({ children }: { children: React.ReactNode }) {
  return (
    <motion.main
      variants={staggerContainer}
      initial="hidden"
      animate="visible"
      className="min-h-screen"
    >
      {children}
    </motion.main>
  );
}

export function RouteSection({ children }: { children: React.ReactNode }) {
  return <motion.section variants={staggerItem}>{children}</motion.section>;
}
```

Pages opt in: `today.tsx`, `pipeline.tsx`, `parcel-detail.tsx` wrap their root in `<RouteShell>` and their major sections in `<RouteSection>`. Result: arrival feels staggered without the global crossfade unmounting everything.

### 4c. The shared-element wiring

```tsx
// pages/properties.tsx — source side

<Link href={`/parcels/${parcel.id}`}>
  <motion.article
    whileTap={{ scale: 0.97 }}
    transition={quickSpring}
    className="card"
  >
    <motion.img
      layoutId={`parcel-${parcel.id}-hero`}
      src={parcel.thumbnailUrl}
      transition={smoothSpring}
    />
    <motion.h3
      layoutId={`parcel-${parcel.id}-title`}
      transition={smoothSpring}
    >
      {parcel.address}
    </motion.h3>
  </motion.article>
</Link>

// pages/parcel-detail.tsx — destination side

<RouteShell>
  <motion.img
    layoutId={`parcel-${parcel.id}-hero`}
    src={parcel.heroUrl}
    transition={smoothSpring}
    className="w-full h-60 rounded-2xl object-cover"
  />
  <motion.h1
    layoutId={`parcel-${parcel.id}-title`}
    transition={smoothSpring}
    className="text-3xl font-semibold"
  >
    {parcel.address}
  </motion.h1>
  <RouteSection>{/* metric cards */}</RouteSection>
  <RouteSection>{/* due-diligence */}</RouteSection>
</RouteShell>
```

**Three rules I enforce when this lands:**

1. **The same `layoutId` must appear on the same element type** (img↔img, h3↔h1 both render text). Mixing img↔div causes Framer to morph as boxes and lose the image content — looks wrong.
2. **Use `transition={smoothSpring}` on both ends, not just one.** Mismatched curves cause visible "snap into place" at handoff.
3. **Suspense boundary on the destination must show the layoutId target, not a spinner.** Means: parcel-detail must render the hero image *before* the rest of the data resolves. Pull `parcel` (or even just `parcel.thumbnailUrl`) from a parent prefetch / route loader, so the hero can mount synchronously and morph immediately while the metric data streams in behind.

### 4d. Reduced-motion respect

`MotionConfig reducedMotion="user"` at `App.tsx:1077` already handles transform/opacity reduction. But `layoutId` morphs are *transforms*, so they'll snap to final position with reduced motion — which is correct. We don't need to special-case this; Framer does the right thing as long as we don't override `transition` with explicit non-spring durations on the layoutId nodes.

---

## 5. Top-5 shared-element transitions, ranked by impact

| # | Surface | Daily-use rank | Effort | "Oh wow" payoff |
|---|---|---|---|---|
| 1 | Parcel card → /parcels/:id hero (S1) | High — every property browse | M (cross-route, needs App.tsx fix) | Highest. This is the showpiece. The image *flies into* the page. |
| 2 | Deal card → DealDetailModal (S3) | High — pipeline workflow core | S (same-parent, just add layoutIds) | High. Amount-traveling-to-header is the single most "I get it now" moment. |
| 3 | Lead row → LeadDetailDrawer (S2) | High — daily CRM gesture | S (drawer is sibling) | Medium-high. Avatar grow is small but constant repetition makes it canonical. |
| 4 | Pipeline kanban card → /deals/:id (S4) | Daily once /deals/:id ships | M | High once the route exists; locks the pipeline gesture vocabulary. |
| 5 | FAB → New-item sheet (S8) | Mobile, dozens-per-day | S | Disproportionate polish-per-line on the most-touched mobile pixel. |

The tier below — properties→maps (S5), today→decisions (S6), inbox→thread (S7) — is worth doing in week 2 once the pattern is canon.

---

## 6. Cost vs payoff

**Cost — the motion vocabulary upgrade:**

- One `App.tsx` change (replace `PageWrapper`). 30 lines, isolated, reversible.
- One new primitive (`<RouteShell>` / `<RouteSection>`). ~40 LOC.
- Per-surface wiring: ~10 LOC of `layoutId` + `motion.*` per handoff. Top-5 = ~50 LOC total.
- One non-trivial pre-fetch refactor on parcel-detail so the hero image is available synchronously for the morph. ~half-day.
- Mental cost: contributors must learn that "list-to-detail goes through layoutId." That's it. Not a framework, a habit.

**Payoff — feels-like-iOS:**

When tapping a card causes that *exact pixel content* to grow into the next screen, the user's brain stops modeling the app as a sequence of pages and starts modeling it as a single space they're zooming through. That's the Things-3, Apple-Photos, Linear-issue-modal mental model. Once the user's spatial memory engages, navigation stops feeling like *cost* and starts feeling like *exploration*. Click latency stops mattering as much because the transition itself is reassuring feedback.

The "card click does nothing" anti-pattern dies. Today, on a slow chunk load, tapping a property card produces zero visual response for ~200ms — long enough that users tap twice. After this work: every tap *immediately* commits via `whileTap` scale, the card immediately *begins becoming* the next page, and the user knows the system heard them within 16ms. That single change reduces double-tap-induced double-navigation events to zero.

The page-level crossfade was costing us motion budget that bought nothing. Reclaiming it for shared elements — same total animation seconds per session, but spent on the moments where the user is *deciding what to do next* — is the upgrade from *competent web app* to *an app you reach for*.

— Lukas
