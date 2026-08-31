# iOS Safari Performance — first-principles reconnaissance (E-2)

Quality-program evidence item E-2 (master-directive amendment 2026-08-30).
Measured 2026-08-31 by a 4-lens read-only workflow: real production HTTP
probing of https://acreos.io (SHA d6d30d7d), fresh-build bundle dissection
(473 chunks, 63MB raw), client boot-waterfall census, and an iOS-hazard
sweep. Numbers below are measured, not estimated, except where marked.
Full structured lenses: workflow wf_144176b5-4f7 (session transcript).

## Why green e2e never covered this

e2e runs desktop Chromium against localhost with Clerk bypassed
(`E2E_TEST_AUTH`, client/src/main.tsx:149-157), warm caches, zero RTT.
By the third law, WebKit-on-cellular performance is outside both the
property and the population that gate reads.

## The measured causal chain — "slow first load"

TLS+HTML → **554,128 B br blocking download** → **2.42 MiB WebKit
parse/compile** → React boot → **2 serial API RTTs** → lazy route chunk →
**~14 queries (+1 duplicate)** → content.

1. **First paint is 100% JS-gated**: `<div id="root">` ships empty (no
   SSR/prerender). Blocking set: HTML 2,994 B + 7 JS chunks 521,014 B +
   CSS 30,120 B compressed, 9 blocking requests (+2 preloaded fonts,
   115,820 B).
2. **The entry chunk is the payload problem: 292,992 B br / 1,447,496 B
   raw — 53% of blocking bytes, larger than all six vendor chunks
   combined.** Root cause (sourcemap-verified): App.tsx (eager) →
   `@/components/mobile` barrel → MobileBottomNav → QuickAddSheet.tsx:57
   value-imports `createLeadContract` from `@shared/contracts` →
   shared/contracts/leads.ts:17 → **shared/schema.ts, the 18,007-line
   ORM barrel** — dragging schema (~1.3MB source) + zod (532KB) +
   drizzle-orm into first paint. Plus posthog-js 215KB and i18next 87KB
   eagerly in main.tsx.
3. **Parse/compile dominates on-device cost** (delivery itself is clean:
   HTTP/2, brotli 4.9:1, 1y-immutable assets, correct preconnects).
4. **Post-boot serial waterfall**: ProtectedRoute blocks on
   `/api/auth/user` → OnboardingGate blocks on `/api/me/needs-onboarding`
   (App.tsx:686-696, second full-screen loader) → lazy Today chunk →
   ~14 queries, including a DUPLICATE bare `GET /api/today`
   (CashStrip.tsx:47-50 keys unparametrized while today.tsx:185-189
   caches parametrized).
5. **Reload amplifiers**: version-check hard-reload on tab-return after
   any deploy (version-check.ts:133-141); SW controllerchange reload;
   iOS memory jettison (amplified by the unvirtualized, uncapped
   activity feed, activity-feed.tsx:255) — each replays the whole chain.
6. Minor: HTML can never 304 (CSP nonce rotates the ETag every
   response); sw.js/manifest.json lack cache-control.

## The measured causes — "glitchy"

1. **Signup shell height bug** (onboarding-v2.css:15-16: 100vh fallback
   declared AFTER 100dvh, so it won everywhere; bottom CTA under the iOS
   toolbar with overflow:hidden) — **FIXED 2026-08-31** with a pin in
   `anonymousSurfaceHygiene.test.ts`.
2. Chat surfaces: founder Dock `fixed h-[80vh]` + 14px composer
   (iOS zoom-on-focus, never reverts); team-inbox `h-screen
   overflow-hidden` composer-under-toolbar (inbox.tsx solved this;
   team-inbox never received the fix).
3. **All safe-area plumbing is dead code**: index.html lacks
   `viewport-fit=cover`, so every `env(safe-area-inset-*)` in the repo
   evaluates to 0. Enabling it requires a real-device eyeball pass —
   deferred to the program's device-verification step.
4. Tab-return burst: version-check reload + dashboard-stats focus
   refetch + 30s polls resuming.
5. Skeleton pulse is an infinite framer-motion JS loop (animations.ts:
   155-162) — 6-10 concurrent rAF loops exactly while ~15 queries are in
   flight; escapes both reduced-motion layers. 769 `motion.*` elements.
6. ~650 Tailwind `hover:` utilities sit OUTSIDE the css-hover gate's
   population (it scans 6 CSS files, not tsx) — two destructive buttons
   are group-hover-only, invisible to touch users.
7. Steady-state chatter: Clerk touch 30s incl. hidden tabs; trial-status
   60s on every route; Pax rail fetches while collapsed (no `enabled:`).

## Fixed immediately under standing law (2026-08-31)

- Signup shell height bug (above).
- **Anonymous /api/health + /api/health/live enumerated the vendor stack**
  (provider names, unconfigured states, live failure text — including a
  real regrid 401) — now status-only for anonymous callers; signed-in
  operators keep the detail; CI probes (status-code-only) unaffected.
- **Tenant data survived logout on shared devices**: the SW's API cache
  (last-seen leads/properties/deals/team-members responses) and the
  offline mutation queue were never cleared — logout now purges
  `acreos-*-api` caches and the `acreos-offline` IndexedDB.
- Regrid 401 recorded as owner action X-14 (credential; cannot be minted
  here).

## Architectural findings (the program's structural docket)

- **The client bundles the server's database schema** — wire contracts
  are owned by the ORM barrel. The fix is a boundary (standalone zod
  contracts with no `../schema` import), not an optimization. Same
  pathology as the founder-dashboard monolith.
- First-paint ownership is 100% client-side (prerender is a decision to
  take, not a tweak).
- Boot state has no single owner (auth + onboarding = 2 serial RTTs; a
  one-RTT bootstrap is a contract change).
- **Two GL map engines ship** (mapbox-gl + maplibre-gl in one 548,546 B
  br chunk; property-map.tsx uses both) — an undecided rail.
- Gate-population gaps (three-laws class): css-hover blind to tsx;
  safe-area code canonical-with-zero-adoption; **performance has no gate
  at all** (no bundle ratchet, no RUM).
- Every customer subscribes to a founder-named WS channel
  (notification-banner.tsx:64).
- 8 orphan polling components (built-but-unwired; deletion candidates).

## Experience budgets (measured baseline → budget)

| Flow | Baseline (measured) | Budget |
|---|---|---|
| Initial useful render | 554,128 B br blocking / 2.42 MiB parse; entry 292,992 B br; 9 blocking requests | blocking ≤ 300 KiB br; entry ≤ 120 KB br (ratchet); field FCP p75 ≤ 2.5s iOS/4G |
| Today usable | FCP + 2 serial RTTs + chunk + ~14 queries + 1 duplicate | ≤ 1 serial hop post-auth; ≤ 8 mount queries, 0 duplicates; p75 ≤ 4s cold / 1.5s warm |
| Route transition | chunk 1–94 KB br + stale refetch; full-screen loader possible | chunk ≤ 100 KB br; skeleton ≤ 200ms; p75 ≤ 800ms |
| Map interactive | vendor-map 548,546 B br (BOTH engines) | engine payload ≤ 280 KB br; p75 pan-ready ≤ 5s cold |

Enforce byte budgets as down-only ratchets in the house style once the
program opens.

## Top interventions by felt-impact per risk (program work)

1. Viewport/keyboard batch: `viewport-fit=cover` + composer `text-base`
   + dvh in Dock/team-inbox/property-map (~6 lines; needs one real-device
   eyeball for the never-live safe-area padding).
2. Sever QuickAddSheet → shared/schema (standalone contract shapes
   and/or lazy the sheet): entry −100+ KB br, −~1.3 MB parse. Verify by
   curling the new entry (< 190,000 B br vs 292,992) and asserting zero
   schema/zod/drizzle sources in its map; add the entry ratchet in the
   same commit.
3. Collapse the boot waterfall (fold needs-onboarding into the auth
   payload; fix the CashStrip duplicate key). Verify: 1 API hop between
   auth resolve and chunk fetch; bare-/api/today requests →~0 in logs.
4. Observability off the critical path + RUM ON (lazy posthog/i18next;
   CSS skeleton pulse; PostHog Web Vitals segmented iOS) — converts every
   budget above from projection to field measurement.
5. One map engine (or per-engine split): −~270 KB br on the Map door.

## What this container could not measure

Real WebKit parse/INP/jettison behavior; cellular RTT (all probes ran
through the container's TLS-intercepting proxy — relative orderings
hold, absolutes do not); authenticated /today query latencies and real
payload weights; field distributions. Strongest next evidence, in
order: (1) RUM via the PostHog already shipped; (2) one real-device
trace against production; (3) Server-Timing + a synthetic authed probe;
(4) CI ratchets on entry bytes and blocking-request count.
