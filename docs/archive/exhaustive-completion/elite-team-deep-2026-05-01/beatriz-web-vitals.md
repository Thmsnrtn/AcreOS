# Beatriz Otero — Web Vitals Audit

**Date:** 2026-05-01
**Scope:** LCP / CLS / INP / TTFB on the five surfaces a Land Investor lives in (`/today`, `/pipeline`, `/properties`, `/deals`, `/pax`), plus the absent web-vitals reporter and a CI gating proposal.
**Wave:** 2 of 87. Built on Reza's bones audit (`elite-team-2026-05-01/reza-bones.md`) — specifically §4b ("Web Vitals (LCP/CLS/INP)… Not visible") and §5 ("Per-page OG tags ✗").

I read `client/index.html`, `main.tsx`, `App.tsx`, `lib/sentry.ts`, the five target page files, `components/page-shell.tsx`, and the recharts/dialog touchpoints. Sentry is wired (`@sentry/react`, consent-gated, `tracesSampleRate` defaults to 0.1) but **not** wired with `browserTracingIntegration` and there is no `web-vitals` package in deps. So the product is genuinely flying blind on field RUM — Reza is right.

---

## 1. Verdict

The bones are good (lazy routes, consent-gated Sentry, fonts preloaded, source maps emitted). The blind spots are: **no `web-vitals` shipping**, **no field LCP/CLS/INP for any of the five core surfaces**, **Suspense fallbacks that change content-shape and shift layout**, and **filter/tab handlers that re-derive thousands of rows synchronously on every keystroke**. None of this is hard. It just isn't measured.

---

## 2. Per-surface LCP analysis

For each surface I identify the LCP element, the biggest risk to its p75, and what to do. p75 estimates are coarse — gathered without RUM, anchored to chunk sizes Reza measured (`index` 592 KB, `vendor-charts` 424 KB, `schema` 480 KB) on a mid-tier phone over 4G.

### 2a. `/today` (`client/src/pages/today.tsx`)

- **LCP element:** the `<h1 class="acr-cc-greeting">` greeting at line 646 — *"Good morning, Thomas. 3 deals need your attention today."* This is text inside `acr-cc-hero`, server-side cheap, but it only paints **after** `TodayPage` chunk hydrates, after `PageShell` resolves persona term, after `useDashboardStats`/`useLeads`/`useProperties` settle to compute `pendingDecisionCount`. The greeting line literally branches on `pendingDecisionCount > 0` (line 648), so it can't render until those queries return.
- **Estimated p75 LCP:** 2.6–3.2 s (4G mid-tier). Driven by: 592 KB entry → 412 KB lazy chunk hydrate → seven parallel `/api/*` waterfall (tasks, alerts, goals, intelligence, paxInsights, paxSuggestions, deals, notes — actually nine queries on this page).
- **Fixes (p75 budget 2.5s):**
  1. **Decouple LCP text from data.** Render `greeting()` immediately with a static "Here's what's on the horizon." tail; swap in the `pendingDecisionCount` clause when ready. This moves LCP forward by ~400–800 ms because the h1 paints on hydration, not on the longest-running query.
  2. **Preload the `today` chunk.** Add `<link rel="modulepreload">` for the today chunk in `index.html` for authenticated users (server-rendered nonce — the infra is already there at `server/middleware/security.ts`).
  3. **Pre-hint `/api/dashboard/stats`** with a `<link rel="preload" as="fetch" crossorigin>` injected at SSR time, since stats is on the LCP critical path via `statsLoading` checks scattered through the hero.

### 2b. `/pipeline` (`client/src/pages/pipeline.tsx`)

- **LCP element:** the `<ConversionFunnel>` SVG inside `PipelineIntelligenceHeader`. Funnel is the largest above-the-fold paint after the title. **It's a recharts/SVG render that depends on `/api/leads` + `/api/deals` resolving before it can compute `stageCounts`** (lines 89–94). Until then, `PipelineIntelligenceHeader` renders … nothing useful.
- **Estimated p75 LCP:** 2.8–3.4 s. The funnel waits on two API calls and the `vendor-charts` chunk (424 KB) gets pulled because of `pipeline-velocity.tsx` even though that component lives below in a tab. The chunk lands eagerly because pipeline.tsx imports `ConversionFunnel`, and on this page recharts is on the critical path.
- **Fixes:**
  1. **Render the funnel skeleton at the funnel's exact dimensions** (currently I see no funnel-shaped skeleton — it just pops in). Reserve the full SVG bounding box height (the funnel is ~180 px) so paint shifts don't recompute.
  2. **Defer `vendor-charts` until tab "board" is active.** ConversionFunnel is a thin SVG; if it's truly the LCP element, give it its *own* tiny SVG implementation rather than dragging recharts into the entry path. That alone would shave ~150–250 KB off the pipeline first-paint.
  3. **Suspense boundary at the tab level only** — the page itself should not block on lazy children. Currently `lazy(() => import("@/pages/deals"))` etc. is fine because they live inside `<TabsContent>`, but verify by inspecting the network waterfall on a cold load.

### 2c. `/properties` (`client/src/pages/properties.tsx`, 3,280 LOC)

- **LCP element:** depends on `viewMode`. Default is `"list"` (line 164), so LCP is the **first row of the property table** — text, but inside a virtualized/non-virtualized data grid. In `"map"` mode it's the **mapbox canvas tile** with `vendor-map` 1.6 MB.
- **Estimated p75 LCP:**
  - List mode: 3.0–3.8 s. Table renders after `useProperties()` resolves; rows include images at lines 3253 and 3287 with **no width/height attributes and no `loading="lazy"`** (I checked — they're decorative thumbnails dropped into `<img>` raw).
  - Map mode: 4.5–6.5 s. mapbox-gl is enormous and synchronous on init.
- **Fixes:**
  1. **Add `width`/`height` to every `<img>`** in `properties.tsx` (and put `loading="lazy"` + `decoding="async"` on anything below the fold). Two violations confirmed at lines 3253, 3287.
  2. **Render the first 10 rows in a fixed-height container** so paint is stable and LCP doesn't snap when rows arrive. Use `min-h-[640px]` on the table wrapper.
  3. **For map mode, lazy-load mapbox-gl on tab activation only** (defer-import the module). Currently it lives in a separate chunk but is pulled when `viewMode === "map"` is read from localStorage on mount — change initial `viewMode` to `"list"` for first-paint and let the user opt into map.

### 2d. `/deals` (`client/src/pages/deals.tsx`, 2,234 LOC)

- **LCP element:** the **stage distribution bar** (lines 600–629) or the first deal card in the kanban — depends on viewport. On desktop the stage distribution row paints first; on mobile it's the first deal card.
- **Estimated p75 LCP:** 2.8–3.5 s. The page imports `ResponsiveModal*` (6 named imports), `ConfirmDialog`, and computes `enrichedDeals.filter(...)` **eight times** on every render (lines 261, 301, 331, 332, 335, 339, 342, 343, 349, 381, 600, 629). On a 200-deal account this is fine; on a 5,000-deal account it's not.
- **Fixes:**
  1. **Memoize all `enrichedDeals.filter(...)` derivations** in a single `useMemo` returning `{acquisitions, dispositions, activePipeline, stalled, warning, byStage}`. Currently every filter is computed inline on each render — and the page re-renders on every state change (28 `useState` calls).
  2. **Skeleton-match the stage strip** at its real width.
  3. **Lazy-load `ResponsiveModal*`** — it pulls dialog primitives that aren't needed until the user clicks "New deal."

### 2e. `/pax` (`client/src/pages/pax.tsx`)

- **LCP element:** the active tab's first content card. Default tab is `"chat"` (line 46) — so LCP = the chat thread's first message bubble.
- **Estimated p75 LCP:** 3.5–4.5 s. **Worst of the five.** Reasons: every tab is `React.lazy` (good for *not-active* tabs), but the **active** tab also lazy-loads, so the page renders the `TabFallback` "Waking Pax…" pulse first, then the tab chunk arrives, then the chat hydrates, then messages load. That's three sequential blocking events.
- **Fixes:**
  1. **Eager-import the default tab.** `command-center` (chat) is the landing tab — import it directly, not via `lazy()`. The other four tabs stay lazy. This shaves ~600–900 ms off LCP because the chat shell renders synchronously.
  2. **Skeleton the chat thread shape** (avatar circle + message bubble rectangles) — currently it shows "Waking Pax…" centered text, then snaps to the full UI. Big CLS (see §3).
  3. **Audit `getTabFromHash()`** (line 40): if the URL is `/pax#agents`, we'd want `agents` to be the eager tab. Read the hash *before* deciding which import is lazy. Either pre-bundle all five tabs (simplest) or use Vite's `import.meta.glob` with eager: false and an entry-point switcher.

---

## 3. CLS hotspots

Cumulative Layout Shift is what makes the app feel "jerky" even when LCP is fine. Top offenders:

| File:line | What shifts | Fix |
|---|---|---|
| `client/src/pages/pax.tsx:48-54` | `TabFallback` is a tiny centered "Waking Pax…" line; when the tab chunk arrives, content snaps in at full height. CLS likely 0.15+ on first paint. | Match content-shape: a chat skeleton (3 message rows of varying height + composer) with `min-h-[600px]` so the swap is invisible. |
| `client/src/pages/today.tsx:1221-1224` | `intelligenceLoading` shows three `Skeleton h-16`. Real cards are `~80 px` (CardContent p-4 + 2 lines of text + button). Close, but the height delta on viewport ≤ 640 forces a 12 px shift. | Use `h-[80px]` to match exact rendered height. |
| `client/src/pages/today.tsx:1276` | Cash position skeleton is `h-28`, but the rendered grid is `~140 px` plus 3 note cards ≈ `~210 px`. Shift on data arrival. | Use a grid skeleton matching the 30/60/90 columns + 3 row stubs. |
| `client/src/components/dashboard/MRRTrajectory.tsx:166` | `<ResponsiveContainer width="100%" height={180}>` — height is set, good, but the **legend** above swaps text on data, causing micro-shift. | Reserve legend height with `min-h-[24px]`. |
| `client/src/components/dashboard/PredictiveInsights.tsx:106` | `ResponsiveContainer width="100%" height="100%"` — **percentage height is the classic recharts CLS bug**. Until the parent has explicit height, the chart paints at 0 then expands. | Set explicit pixel height on the container or wrap in a fixed-height div. |
| `client/src/pages/properties.tsx:3253,3287` | `<img>` with no width/height. Browser reflows when image header arrives. | Set explicit `width=` / `height=` attributes (HTML attrs, not CSS). |
| `client/src/components/page-shell.tsx:113-126` | `PageShellSkeleton` renders 4 stat cards + 1 large block. Reasonable shape, but it's used as the *only* fallback for any page — so for `/properties` (a table), the skeleton shape doesn't match, causing a full reflow on hydration. | Per-route `loadingFallback` prop. Already accepted by `PageShell` — wire it on every route. |
| `client/src/pages/deals.tsx` (modal opens) | `ResponsiveModal` opens are dialogs without `<DialogOverlay>` height pre-reserved on mobile, causing the page behind to scroll-jump. | Verify `body { overflow: hidden }` is applied on dialog open and that the scroll-bar gutter compensation is on. |

A blanket recommendation: **the same skeleton-shaped pattern Reza pointed out (page-shell-skeleton) is an anti-pattern when reused across pages with very different shapes**. Every lazy route should ship its own `loadingFallback`.

---

## 4. INP hotspots

Interaction to Next Paint — the new responsiveness metric (replaced FID in 2024). Anything > 200 ms p75 fails the "good" bar.

### 4a. Filter changes on `/deals`

`pages/deals.tsx` recomputes `enrichedDeals.filter(...)` **at minimum 12 times per render** (see lines 261, 301, 331, 332, 335, 339, 342, 343, 349, 381, 600, 629). Every `setStatusFilter`, `setTypeFilter`, `setSelectedDealIds` triggers a full re-render and a full pipeline recomputation. On a 5k-deal org the filter onChange is going to spend 80–150 ms in JS before paint.

**Fix:** wrap the derivations in one `useMemo` keyed on `[enrichedDeals, statusFilter, typeFilter, selectedDealIds]`, return all twelve slices.

### 4b. Tab switches on `/pipeline` and `/pax`

Both pages use `Tabs` with lazy children. Switching tabs triggers (a) a Suspense fallback flash, (b) chunk fetch (if not cached), (c) hydration. INP on a cold tab switch will show as 400–900 ms. There's no warm-up.

**Fix:** `<link rel="modulepreload">` injected via a small "tab prefetch on hover/focus" hook. When the user hovers the tab trigger for >100 ms, fire the dynamic import. Pattern is straightforward with `import()` returning a cached promise.

### 4c. Form submissions

`pages/properties.tsx:1197 onSubmit` — invokes `form.handleSubmit(onSubmit)` which internally validates a Zod schema with ~30 fields. Synchronous. On mid-tier hardware this is 30–60 ms. Acceptable but borderline.

**Fix:** lower priority — move to an async transition with `startTransition` if the user reports lag.

### 4d. The 28 `useState` problem in `/deals`

Every state setter cascades through the entire 2,234-LOC component. React dev tools will show "wasted renders." This is an INP killer for any user that types in a search filter (no debounce found in pages — only in `pax-entity-picker.tsx:26`).

**Fix:** introduce `useDebounce` for filter inputs. 250 ms debounce on text-search filter onChange. The hook doesn't even exist yet at `client/src/hooks/`; it needs to be created.

### 4e. `/today` re-render on every welcome-back-card mount

`today.tsx:470-476` writes `localStorage` in a `useEffect` on every mount (no early-return on `lastVisitTs` already being today). Cheap, but it runs after first paint and contributes to TBT. Not LCP-critical.

---

## 5. The web-vitals reporter — implementation recipe

**Status:** absent. `package.json` has no `web-vitals` dep. Sentry's `@sentry/react` is wired but `browserTracingIntegration` is not present in `lib/sentry.ts:17-33`, so Sentry isn't auto-collecting LCP/CLS/INP either.

### Recipe (45 minutes, one engineer)

**Step 1.** Add the dep:

```bash
npm install web-vitals
```

It's ~3 KB gzipped. Tree-shakable.

**Step 2.** Create `client/src/lib/web-vitals-reporter.ts`:

```ts
import { onCLS, onINP, onLCP, onFCP, onTTFB, type Metric } from "web-vitals";
import { Sentry } from "./sentry";

type Reporter = (metric: Metric) => void;

const COOKIE_CONSENT_KEY = "acreos_cookie_consent";

const sentryReporter: Reporter = (metric) => {
  // Sentry's measurement API stamps the active transaction.
  Sentry.setMeasurement(metric.name, metric.value, metric.name === "CLS" ? "" : "millisecond");
  // Also send as a breadcrumb so it's visible per session.
  Sentry.addBreadcrumb({
    category: "web-vitals",
    level: metric.rating === "poor" ? "warning" : "info",
    message: `${metric.name}: ${metric.value.toFixed(2)}`,
    data: { id: metric.id, rating: metric.rating, navigationType: metric.navigationType },
  });
};

const beaconReporter: Reporter = (metric) => {
  // Backup: POST to /api/metrics/web-vitals so we have raw data even if
  // Sentry sampling drops the transaction.
  const body = JSON.stringify({
    name: metric.name,
    value: metric.value,
    rating: metric.rating,
    id: metric.id,
    path: window.location.pathname,
    nav: metric.navigationType,
    ts: Date.now(),
  });
  // sendBeacon survives page unload — critical for LCP on bounce.
  if (navigator.sendBeacon) {
    navigator.sendBeacon("/api/metrics/web-vitals", new Blob([body], { type: "application/json" }));
  } else {
    fetch("/api/metrics/web-vitals", { method: "POST", body, keepalive: true });
  }
};

export function initWebVitalsReporter(): void {
  if (localStorage.getItem(COOKIE_CONSENT_KEY) !== "accepted") return;
  const report: Reporter = (metric) => { sentryReporter(metric); beaconReporter(metric); };
  onLCP(report);
  onCLS(report);
  onINP(report);
  onFCP(report);
  onTTFB(report);
}
```

**Step 3.** Call `initWebVitalsReporter()` in `main.tsx` right after `initClientSentry()`. Both are consent-gated against the same cookie key.

**Step 4.** Add `browserTracingIntegration` to `lib/sentry.ts`:

```ts
Sentry.init({
  // ...existing
  integrations: [Sentry.browserTracingIntegration()],
  // existing tracesSampleRate stays
});
```

This auto-creates a transaction per pageview that the web-vitals measurements stamp onto.

**Step 5.** Server endpoint `server/routes/metrics.ts`:

```ts
router.post("/api/metrics/web-vitals", express.json(), (req: AuthenticatedRequest, res) => {
  const { name, value, rating, path, nav } = req.body ?? {};
  if (!name || typeof value !== "number") return Errors.badRequest(res, "Invalid metric");
  logger.info("web_vital", {
    name, value, rating, path, nav,
    orgId: req.organizationId, userId: req.user?.id,
  });
  res.status(204).end();
});
```

The structured-log line is grep-able and can be forwarded to Datadog/Honeycomb. No rate-limit needed beyond the standard chain — but add `express.json({ limit: "1kb" })` and `correlationId` middleware so dashboards can join.

**Step 6 (optional, week 2).** Aggregate in a daily cron: scan logs, compute p50/p75/p95 per route, write to `web_vitals_daily` table, expose at `/founder/perf`. Founder-only surface.

### What you get

- Per-route LCP/CLS/INP/TTFB in Sentry transactions, with `urlPath` tag for slicing.
- Raw beacon stream in `logger.info("web_vital", …)` survives Sentry sampling.
- `metric.rating` ("good"|"needs-improvement"|"poor") gives instant traffic-light dashboards.

### Cost

`web-vitals` is 3 KB. The beacon is 1 POST per metric × 5 metrics = 5 sendBeacon calls per session, each ~200 bytes. At 100 customers averaging 20 sessions/day = 10k beacons/day = 2 MB/day of payload. Negligible.

---

## 6. CI gating proposal

Reza recommended wiring `npm run test:bundle-size` into CI. I'm proposing a complementary **field-data gate** plus a **synthetic gate** for PR-time signal.

### 6a. Synthetic gate (PR blocker)

Add a Lighthouse CI step to `ci.yml` that runs against the preview deploy on every PR. Targets (mobile, slow-4G):

| Metric | Budget | Failure mode |
|---|---|---|
| LCP | < 2.5 s p75 | Fail PR if regression > 200 ms vs main baseline |
| CLS | < 0.1 | Fail PR if any single page > 0.15 |
| INP | < 200 ms | Fail PR if any tracked interaction > 300 ms |
| TBT | < 200 ms | Warn (not block) — TBT is a synthetic-only proxy |
| Total JS | < 600 KB on entry path | Fail PR if entry chunk > budget (replaces vite's 500 KB warning) |

LH-CI runs against five canonical URLs: `/`, `/today`, `/pipeline`, `/properties`, `/pax`. Authenticated ones use a CI-provisioned test org (this exists — Reza mentioned `staging.yml`).

### 6b. Field-data gate (deploy decision)

Field RUM lags 24–72 hours so it can't gate a PR. But it can gate a **promotion from staging → production** via a daily cron job that:

1. Reads the last 24 hours of `web_vital` log events from staging.
2. Computes p75 LCP per surface.
3. If any surface regressed > 15% vs. the previous 7-day rolling p75, opens a Linear/GH issue auto-tagged `perf-regression` and pings `#perf` in Slack.

Hard-blocking deploys on field data is a recipe for stale builds — recommend **alert, don't block**.

### 6c. Budgets per surface (the targets)

| Surface | LCP p75 | CLS | INP p75 |
|---|---|---|---|
| `/today` | 2.0 s | 0.05 | 150 ms |
| `/pipeline` | 2.5 s | 0.10 | 200 ms |
| `/properties` (list) | 2.5 s | 0.05 | 200 ms |
| `/properties` (map) | 4.0 s | 0.10 | 300 ms |
| `/deals` | 2.5 s | 0.05 | 250 ms (filter-heavy) |
| `/pax` (chat) | 2.5 s | 0.10 | 200 ms |

These are stricter than Google's blanket "good" thresholds for `/today` because it's the home surface and 100 customers will judge speed there first.

---

## 7. Quick wins ranked (highest p75 improvement per hour)

| # | Win | Hours | Estimated p75 LCP impact | Notes |
|---|---|---|---|---|
| 1 | Eager-import the default Pax tab (`pax.tsx:33`) | 0.5h | −600 to −900 ms on `/pax` | Remove `lazy()` from `command-center`; keep the others lazy. Nothing else needed. |
| 2 | Decouple `/today` h1 from `pendingDecisionCount` | 0.5h | −400 to −800 ms on `/today` | Render greeting immediately, swap in count tail when ready. |
| 3 | Add `web-vitals` reporter (§5) | 1h | 0 ms direct, but unblocks every other improvement being measured | Without this, every other change is a guess. |
| 4 | Add `width`/`height` + `loading="lazy"` to `properties.tsx:3253,3287` `<img>` | 0.25h | −80 to −120 ms CLS-attributable LCP shift | Trivial. |
| 5 | Memoize the 12 `enrichedDeals.filter(...)` derivations in deals.tsx | 1.5h | Drops INP p75 on filter change from ~150 ms to ~40 ms on 5k-deal accounts | Single `useMemo`. |
| 6 | Per-route `loadingFallback` on PageShell instead of generic skeleton | 2h | Cuts CLS on every lazy route by 0.05–0.10 | Already supported by the prop. |
| 7 | Sentry `browserTracingIntegration` | 0.25h | Free per-route LCP/CLS/INP in Sentry transactions | One-line add. |
| 8 | Defer `vendor-charts` until tab "board" active on `/pipeline` | 2h | −150 to −250 KB off entry; −300 ms LCP on pipeline | Replace ConversionFunnel with hand-rolled SVG OR move it behind tab activation. |
| 9 | Lighthouse CI on PRs targeting preview deploy | 3h | Prevents future regressions | Use `@lhci/cli`. Wire to `ci.yml` after Reza's `test:bundle-size` lands. |
| 10 | `useDebounce` hook + apply to deals/properties/leads search filters | 2h | Drops INP p75 on text-search from 200+ ms to 30 ms | Hook doesn't exist yet at `client/src/hooks/`. |
| 11 | Initial `viewMode` always `"list"` on `/properties` first paint, even if localStorage said `"map"` | 0.5h | −1500 to −3000 ms on returning map-mode users (1.6 MB mapbox chunk no longer blocks) | Read localStorage in `useEffect`, switch after hydration. |
| 12 | Per-page OG tags (Reza §5) — wire `react-helmet-async` and set per-route title/og:image | 4h | 0 LCP impact, but fixes lead-share previews | Tangential to web-vitals but overlaps the head-management story. |

**If you do only three things in May:** #1, #2, #3. That's two hours total and you'll reclaim ~1.2 s of LCP across two top surfaces *and* you'll start measuring everything else.

---

## 8. Risks and what I didn't measure

- **No real RUM yet.** Every p75 estimate above is anchored to chunk weights Reza measured + standard 4G mid-tier device assumptions. The first job is shipping the reporter (§5) and re-anchoring these numbers in two weeks.
- **I didn't audit the founder/* routes.** Different audience, lower stakes, separate budget conversation.
- **I didn't measure server TTFB per `/api/*` endpoint.** That's an Ines/Reliability question (she has `ines-reliability.md`) — but the LCP work above assumes typical /api/* TTFB of 100–250 ms; if any of `/api/dashboard/intelligence`, `/api/pax/insights`, `/api/dashboard/today-priorities` exceeds 500 ms p75, the `/today` LCP fix #2 above gains an additional 200–400 ms because the h1 stops waiting on the slow query.
- **Service worker caching.** `dist/public/sw.js` exists (per Reza) but I didn't audit its strategy. If it's stale-while-revalidate on the entry chunk, repeat visits should be much faster than the cold-load numbers above. The web-vitals reporter will tell us whether `navigationType === "reload"` LCPs differ from `"navigate"`.

---

That's the picture. Sentry's wired but blind on Vitals. Five surfaces, five different LCP elements, five different fixes — but the unifying gap is the absent web-vitals beacon. Ship it first; the rest become ranked, not guessed.

— Beatriz
