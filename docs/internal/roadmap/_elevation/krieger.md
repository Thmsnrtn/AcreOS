# Krieger — Customer-Surface UX: Elevation Roadmap

_Author: Krieger Voss, Customer-Surface UX (touch / pointer / keyboard parity)_
_Date: 2026-06-07 · Pre-first-customer · Lens: UX craft + polish, the five doors' feel, mobile↔desktop parity, motion, a11y depth, the parcel/map/Land-Snapshot experience._

## How I read the current state

The substrate is genuinely good. We have a real motion-token system (`client/src/lib/motion-tokens.ts` — Linear/Stripe curves, Apple-HIG springs, a `useReducedMotionPreference` hook + `respectReducedMotion`), a self-announcing `Skeleton` (`role="status"` baked in so all ~257 callers are a11y-correct), a haptics layer that respects reduced-motion (`client/src/lib/haptics.ts`), a provenance chip that is color-blind-safe and theme-token-driven (`client/src/components/data-provenance-chip.tsx`), and the Land Snapshot is the best surface we own (`client/src/components/parcels/land-snapshot.tsx` — honest gaps, "what we don't know yet," provenance per tile). The five-doors model is enforced cleanly in `MobileBottomNav.tsx` + `nav-items.ts`.

So this is not a gap-filling document. The infrastructure exists; **it's under-consumed**. We built premium primitives and then rendered with the plain ones. That's the theme of almost everything below: _wire the good thing we already have into the surface the customer actually touches._ And there is one real honesty regression hiding on the Map door that would embarrass us badly — that one is not polish, it's a correctness bug dressed as a chart.

---

## Top ideas (highest value first)

### 1. Kill the fabricated price-history sparkline on the Map door
- **kind:** refine · **side:** customer · **effort:** S
- **Why it matters / what "great" looks like:** `client/src/pages/maps.tsx` lines 97–132 has `generatePriceTrendData()` — a function that invents a 6-month price-per-acre curve from `Math.sin()` noise, renders it as an `AreaChart` (line 532), and exposes a **per-month dollar tooltip** (`usd(Number(payload[0].value))`, line 562) that reads as real historical pricing. The same file synthesizes a parcel `boundary` polygon at line 1019 (`syntheticBoundary`). This is the exact "trust bomb" the team explicitly killed everywhere else in the honest-data pass — and the radar chart 20 lines below it (line 583) even has a comment saying "A radar of invented scores is the exact trust bomb we're killing, so we render it only when ≥3 real dimensions exist." We held the line on the radar and then drew a fake price chart right above it. A sharp first customer who knows their county's comps will catch this in five seconds, and it poisons trust in every honest number on the page. "Great" = no fabricated series renders; if we have real `parcel_observations` price points, plot those; otherwise show the single honest figure with its provenance chip and no sparkline. Synthetic boundaries should render with a visible "approximate — not surveyed" treatment, never as a solid authoritative polygon.
- **First step:** Delete `generatePriceTrendData` + the `AreaChart` block (maps.tsx 531–579). Gate `syntheticBoundary` behind an explicit `isApproximate` flag and style it dashed/low-opacity with an aria-label calling it estimated. Add a `no-synthetic-series` contract to the mobile-feel CI gate so this can't regress.

### 2. Make the parcel-detail loading state shaped like the parcel, not grey boxes
- **kind:** improve · **side:** customer · **effort:** S
- **Why it matters:** The parcel page is our deepest customer surface and the data-aha destination, but its skeleton (`client/src/pages/parcel-detail.tsx` 201–208) is four generic rectangles (`h-8`, `h-32`, `h-24×3`, `h-96`). The Land Snapshot has its _own_ correctly-shaped skeleton (a 6-tile grid, land-snapshot.tsx 113–130) — but the page-level skeleton above it doesn't match the real layout, so on a cold parcel the screen reflows twice (generic boxes → real header → tiles). Linear/Stripe never reflow on load; the skeleton _is_ the layout. "Great" = the parcel skeleton mirrors the actual header + Snapshot grid + map, so the page paints once and settles.
- **First step:** Build a `ParcelDetailSkeleton` that reuses the Snapshot's tile-grid geometry; render it in the `isLoading` branch of parcel-detail.tsx and inside `MobilePropertyDetail.tsx`.

### 3. Wire the AnimatedCounter into the CashStrip and finance headline numbers
- **kind:** elevate · **side:** customer · **effort:** S
- **Why it matters:** We _have_ `client/src/components/ui/animated-counter.tsx` (with built-in reduced-motion respect), and the Today door's CashStrip (`client/src/components/today/CashStrip.tsx`) renders cash-on-hand, open-deal value, etc. as static `tabular-nums` — no count-up. Money settling into place is the single highest-emotion micro-interaction in a finance product; it's the moment that says "this is a real ledger, not a spreadsheet." This is the cheapest premium-feel win we have. "Great" = the four CashStrip figures and the Finance-door headline totals count up on first paint and re-animate on change, and collapse to instant under reduced-motion (the component already does this).
- **First step:** Swap the four `<p class="...tabular-nums">` values in CashStrip.tsx for `<AnimatedCounter>`; repeat for the Finance hero figures in `finance.tsx`.

### 4. Give the five doors a shared-element active indicator (the door "feels" continuous)
- **kind:** elevate · **side:** customer · **effort:** M
- **Why it matters:** The mobile bottom nav (`MobileBottomNav.tsx` 57–60) signals active state with a static `bg-primary/15` pill that pops in/out per item — no continuity. The premium pattern (Linear, Arc, iOS) is a single indicator that _slides_ between doors via `framer-motion` `layoutId`. We have framer-motion and the motion tokens; we're just not using them on the most-touched element in the entire app. Same opportunity on the desktop sidebar active state. "Great" = tapping Map→Deals slides one shared pill across; under reduced-motion it cross-fades. This is the kind of detail that makes someone say "this feels expensive" without knowing why.
- **First step:** Add a `motion.div` with `layoutId="door-indicator"` behind the active item in MobileBottomNav.tsx; gate the transition through `useReducedMotionPreference`. Mirror in `layout-sidebar.tsx`.

### 5. Adopt the View Transitions API for door-to-door and list→detail navigation
- **kind:** elevate · **side:** both · **effort:** M
- **Why it matters:** Zero usage of `startViewTransition` in the codebase (grep is empty). Right now route changes are a `variantPageFade` opacity swap — fine, but the parcel-list → parcel-detail and deal-list → deal-detail transitions are exactly where a shared-element morph (the card you tapped grows into the header) turns navigation from "a new page loaded" into "I zoomed into the thing." Supported in iOS Safari 18+ and Chrome; degrades to our existing fade where unsupported. This is the difference between "a good web app" and "feels native on a Tuesday morning train." "Great" = tapping a parcel card morphs it into the detail header; back gesture reverses it.
- **First step:** Add a `useViewTransitionNav()` wrapper around wouter navigation that calls `document.startViewTransition` when available; tag the parcel card + detail header with matching `view-transition-name`. Start with the parcel path (highest emotional payoff), then deals.

### 6. Bring optimistic UI to the high-frequency customer actions
- **kind:** improve · **side:** customer · **effort:** M
- **Why it matters:** `onMutate` (optimistic update) appears in only 5 files across the whole client; the other ~178 mutation sites wait on a network round-trip before the UI moves. On the doors a customer hits all day — dismissing a Today decision, marking an Inbox item read, advancing a deal stage, saving a filter — the right feel is: the UI commits _instantly_ with a light haptic, and silently reconciles/rolls back on failure. We have the haptics layer (`lightImpact`) and React Query's optimistic primitives; we're just not spending them. "Great" = no customer-initiated state change on the five doors feels like it's "thinking." Latency stops being visible.
- **First step:** Audit the daily-loop mutations (Today DecisionQueue dismiss, Inbox read/archive, Deals stage move) and add `onMutate`/`onError` rollback + a `lightImpact()` on commit. The Inbox already has the pattern (`inbox.tsx` uses `onMutate`) — generalize it.

### 7. Pull-to-refresh on the five mobile doors (the component exists, unused)
- **kind:** improve · **side:** customer · **effort:** M
- **Why it matters:** `client/src/components/mobile/PullToRefresh.tsx` is built (with haptics) but the only consumer is `_archived/dashboard.tsx.archived` — it ships to nobody. On a mobile-primary product, pull-to-refresh is the expected gesture for "is there anything new?" on Today and Inbox. Its absence makes the app feel like a website, not an app. "Great" = pull-down on Today/Map/Deals/Inbox triggers the same `refetch` the error-retry uses, with the rubber-band + haptic the component already implements, and respects reduced-motion. Bonus: it gives us a non-error refresh affordance we currently lack entirely.
- **First step:** Wrap the scroll container in `today.tsx` / `inbox.tsx` with `<PullToRefresh onRefresh={refetch}>`; verify it doesn't fight the native overscroll on iOS Safari and the bottom-nav safe-area.

---

## My single BOLDEST elevation bet

**A live, choreographed "Snapshot assembling" experience on the parcel/parcel-check surface — turn the data wait into the proof.**

Right now both the Land Snapshot (land-snapshot.tsx) and the public `/tools/parcel-check` (parcel-check.tsx) show the same flat grey skeleton while we fan out to FEMA, USDA SSURGO, USGS, USFWS, and Census. That wait is 1–3 seconds of our single most differentiating moment — assembling premium government data live, for free — and we're rendering it as "loading…". The bet: **stream each source in as it resolves**, each tile flipping from "Querying FEMA NFHL…" to its real value + provenance chip with a soft spring (we have `SPRINGS.smooth`) and a `lightImpact` haptic per arrival, with a running "5 federal sources · 1.2s" meter. The customer doesn't experience a wait — they _watch_ a black-box-beating diligence pull happen in front of them, source by named source. That is the felt embodiment of the entire honest-data thesis, and it is something a paid competitor's spinner-then-dump literally cannot reproduce.

This is bold because it touches the server (the public endpoint resolves all-then-returns; this wants per-source streaming via SSE or a staged response), the client choreography, and the motion budget. But it converts our biggest liability (latency on cold parcels) into our biggest demo asset, on the exact surface — the public widget — a sharp first customer hits before they ever sign up. Effort: L. Worth it.

---

## Small high-ROI polish refinements

- **Bottom-nav haptic.** Add `selection()`/`lightImpact()` on door tap in `MobileBottomNav.tsx` — currently `active:scale-95` only, no taptic. (S)
- **Sparkline `role="img"` aria-label still describes fabricated data** (maps.tsx 546) — dies with idea #1, but note it: we're announcing fake trends to screen readers too.
- **Provenance chip truncation** — the visible text in `data-provenance-chip.tsx` (115) is `truncate`; on a 360px tile a long source like "USDA SSURGO survey" clips silently. Add a `title`/tooltip so the pointer user can recover the full string, and verify the 2-line wrap at 360.
- **Land Snapshot "freshly pulled" vs "cached" copy** (land-snapshot.tsx 158) — good honesty, but "cached" reads slightly negative to a customer. Consider "from your saved snapshot · updated [asOf]" — same truth, warmer.
- **CashStrip empty/zero state** — when cash-on-hand is genuinely $0 it currently renders "$0" identically to a loading-failed 0. Distinguish real-zero from no-data (the honest-data principle applies to founder-facing money too).
- **Focus-ring audit on the Map filter Sheet** — the side Sheet (maps.tsx 1219+) and its slider/switch controls need a keyboard-only pass; sliders are the classic focus-trap miss.
- **Drive-Mode "Heading out?" card dismiss target** (today.tsx 459) — good 44px min, but verify the close X doesn't sit under the iOS reachability zone on a 430px Pro Max one-handed.
- **AnimatedCounter for the Land Snapshot completeness meter** ("5 of 6 fields") — tiny, but it makes the "we found more" moment land.
- **Skeleton shimmer direction** — `animate-pulse` is an opacity throb; a directional shimmer sweep (reduced-motion-gated) reads more premium for the same cost on the Snapshot tiles.

---

## The one thing that would most embarrass us if a sharp first customer (or I) noticed it unpolished

**The fabricated price-per-acre sparkline on the Map door (idea #1).** A land investor's entire job is knowing what dirt is worth over time. We render them a smooth, confident 6-month price-history chart — with a dollar value on every month's tooltip — that is `Math.sin()` noise built from a single estimate. It is the precise category of thing the team went to extraordinary lengths to eliminate everywhere else, with comments in the adjacent code _bragging_ about killing it. If our first customer cross-checks one month against a comp they know and sees it's invented, they will (correctly) assume every other number on the page is too, and the honest-data moat — our actual competitive advantage — evaporates in one glance. Everything else in this document is elevation. This one is a stain we have to remove before anyone walks in.
