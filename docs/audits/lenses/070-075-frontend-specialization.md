# Lenses 070-075: Frontend Specialization Audit

**Auditor:** Tier 2 Frontend Specialization
**Date:** 2026-04-18
**Scope:** Optimistic Updates, Error Boundary Coverage, Route Transitions/Loading, Image/Asset Optimization, Web Vitals, Progressive Enhancement
**Codebase snapshot:** 156 pages, 145 lazy-loaded routes, ~80K client LOC

---

## 070 -- Optimistic Updates

### Current State

Out of 80+ files containing `useMutation` hooks, only **3** implement optimistic updates with proper rollback:

1. **`client/src/components/focus-list.tsx`** -- `recordContactMutation` uses `onMutate` to optimistically remove a lead from the focus list, snapshots previous data, and rolls back in `onError`. Also calls `invalidateQueries` in `onSettled` for consistency. This is the gold-standard pattern in the codebase.

2. **`client/src/components/settings/data-network-settings.tsx`** -- Uses local `optimisticEnabled` state rather than cache manipulation. Reverts to `null` on error. Functionally correct but uses a different pattern (local state vs. `setQueryData`).

3. **`client/src/components/founder/AgentTeamChat.tsx`** -- Optimistically appends the user's message to local state in `onMutate`, then appends the agent response in `onSuccess`. On error, an error message is appended instead of removing the user's message -- the user's original message remains visible even on failure, which is a reasonable UX choice for chat.

### What Is Missing

The core CRUD hooks in `use-leads.ts`, `use-deals.ts`, and `use-properties.ts` all follow a simple pattern: fire the mutation, then `invalidateQueries` on success. None use `onMutate` for optimistic cache updates. This means:

- **Create/Update/Delete on leads, deals, and properties** all wait for server confirmation before the UI reflects the change. On slow connections, the user sees a brief freeze or loading state.
- **Bulk operations** (e.g., `useBulkStageUpdate` in `use-deals.ts`) also lack optimistic updates, which is especially noticeable when moving multiple deals through pipeline stages.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 070-A | P3 | Core entity mutations (lead/deal/property CRUD) lack optimistic updates; UI waits for server round-trip |
| 070-B | P3 | Only 3 of 80+ mutation sites implement optimistic updates; no shared helper or pattern exists |
| 070-C | P3 | `focus-list.tsx` rollback is correct; no bugs found in existing optimistic implementations |

### Recommendations

- Create a shared `useOptimisticMutation` wrapper that standardizes the snapshot/rollback/invalidate pattern.
- Prioritize optimistic updates on deal stage changes (pipeline drag-and-drop), lead status toggles, and task completion -- high-frequency user actions where perceived latency matters most.

---

## 071 -- Error Boundary Coverage

### Current State

**Root boundary:** `App.tsx` wraps the entire app in a single `<ErrorBoundary>` at the top level (line 854). This is the last-resort catch-all.

**Per-page boundary:** `PageShell` (used by 89 of 156 pages) wraps its children in an `<ErrorBoundary>`. This means ~57% of pages get a per-page error boundary that prevents a crash in one page from taking down the entire app.

**Custom boundary:** `team-inbox.tsx` wraps its content in its own `<ErrorBoundary>` directly (not through `PageShell`).

**Remaining 67 pages** (~43%) lack a per-page error boundary and rely solely on the root boundary. A crash in any of these pages (which include public pages like `landing`, `auth-page`, `pricing`, `terms`, `privacy`, plus several internal pages like `campaigns`, `inbox`, `command-center`, etc.) will show the full-page root error fallback, losing all navigation context.

### QueryErrorState Usage

The `QueryErrorState` component is well-designed (handles network, server, auth, notFound, and generic error types with appropriate icons and retry support). However, it is only used in **11 files** out of 156 pages:

- `leads.tsx`, `properties.tsx`, `deals.tsx`, `dashboard.tsx`, `finance.tsx` -- core CRM pages
- `executive-dashboard.tsx`, `founder-home.tsx`, `onboarding-v2.tsx`, `pax.tsx`
- `cohort-retention-dashboard.tsx`, `entity-portfolio-view.tsx`

The vast majority of pages either show nothing on query error (relying on the global `handleQueryError` toast from `queryClient.ts`) or return null/blank when data fails to load.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 071-A | P2 | 67 of 156 pages (~43%) lack per-page error boundaries; crashes show root fallback with no navigation |
| 071-B | P2 | Only 11 pages use `QueryErrorState` for data-fetch errors; most pages go blank or rely solely on toast notifications when API calls fail |
| 071-C | P3 | The `ErrorBoundary` component itself is well-implemented: Sentry integration, error IDs, retry/refresh/home actions |
| 071-D | P3 | `PageShell` provides a good pattern but adoption is incomplete |

### Recommendations

- Migrate all remaining authenticated pages to use `PageShell`, which provides error boundary, loading state, and consistent layout.
- Add `QueryErrorState` to any page that has a primary `useQuery` call -- at minimum, the core workflow pages (campaigns, inbox, marketplace, maps).

---

## 072 -- Route Transitions & Loading

### Current State

**Lazy loading:** 145 routes use `React.lazy()` for code splitting. Only 3 pages are eagerly loaded: `AuthPage`, `LandingPage`, and `NotFound`. This is a well-considered split.

**Suspense boundary:** A single `<React.Suspense>` wraps the entire `<Switch>` in `Router()` (App.tsx line 304), with a full-page centered `Loader2` spinner as the fallback. All lazy-loaded routes share this single boundary.

**Page transition animation:** `PageWrapper` uses `framer-motion` `AnimatePresence` with a subtle slide (`x: 8` -> `0` -> `-8`, 250ms). Every route change triggers this animation because the `key={location}` forces unmount/remount.

**Route prefetching:** `useNextRoutePrefetch` hook intelligently prefetches API data for likely next routes based on the current location. The sidebar also prefetches on hover via `prefetchRoute()`. The command palette prefetches on item hover. This is a strong pattern.

**Loading states within pages:** `PageShell` accepts `isLoading` prop and renders a `PageShellSkeleton` (header skeleton + grid of shimmer cards + content shimmer). Pages that use it get structured loading states. Pages that don't use `PageShell` typically show their own loading spinner or nothing.

### Issues

**No route-level loading indicator during chunk download:** When navigating to a lazy-loaded route for the first time, the Suspense fallback shows a generic full-page spinner. There is no top-of-page progress bar (like NProgress) that would indicate navigation is in progress while maintaining the previous page's content.

**AnimatePresence with key={location}** means React fully unmounts the old page and mounts the new one on every navigation. Combined with the 250ms exit + 250ms enter animations, this adds ~500ms of perceived transition time. For fast navigations (cached routes), this animation becomes the bottleneck.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 072-A | P3 | Suspense fallback is a full-page spinner rather than a top-bar progress indicator; previous page content disappears during chunk loading |
| 072-B | P3 | Route prefetching is well-implemented (sidebar hover, command palette hover, next-route prediction) |
| 072-C | P3 | AnimatePresence key={location} causes full unmount/remount on every navigation; adds ~500ms perceived latency |
| 072-D | P3 | 89 pages use PageShell with skeleton loading; 67 pages handle their own loading states inconsistently |

### Recommendations

- Consider adding a route-level progress bar (e.g., NProgress) that shows during chunk downloads, preserving the current page until the next is ready.
- Evaluate whether the exit/enter animation is worth the latency cost for same-section navigations.

---

## 073 -- Image & Asset Optimization

### Critical Findings

**Google Fonts: 25 font families loaded on every page.** `client/index.html` line 28 loads a single Google Fonts CSS URL that requests 25 distinct font families (Architects Daughter, DM Sans, Fira Code, Geist, Geist Mono, IBM Plex Mono, IBM Plex Sans, Inter, JetBrains Mono, Libre Baskerville, Lora, Merriweather, Montserrat, Open Sans, Outfit, Oxanium, Playfair Display, Plus Jakarta Sans, Poppins, Roboto, Roboto Mono, Source Code Pro, Source Serif 4, Space Grotesk, Space Mono). This is a render-blocking CSS request of ~1.4KB URL that triggers downloads of hundreds of font files. Most of these fonts appear to be for the theme customizer and are never used simultaneously.

**Aerial images: 100 JPG files totaling 39MB.** Located in `client/public/images/`, these are full-resolution aerial photography (average 402KB per image, largest at 766KB). None are in modern formats (WebP/AVIF). None have `srcset` or responsive sizing. `getRandomImage()` in `aerial-images.ts` is exported but never imported by any component -- these 100 images appear to be unused dead assets shipped in every deploy.

**No image optimization pipeline.** The `<img>` tags found in the codebase use raw URLs with no `loading="lazy"` (except 2 instances in `property-map.tsx`), no `srcset`, no `sizes`, no width/height attributes (causing CLS), and no WebP/AVIF formats. User-uploaded images (property photos, logos, signatures) are served as-is with no server-side optimization.

**PWA icons:** `favicon.png` (1.1KB), `apple-touch-icon.png` (1.2KB), `pwa-192x192.png` (1.2KB), `pwa-512x512.png` (1.2KB) -- appropriately sized.

**Bundle splitting:** Vite config has reasonable `manualChunks` splitting vendor-react, vendor-ui, vendor-charts, and vendor-map. The 500KB chunk warning limit is set. The orientation doc flags a 382KB founder-dashboard chunk as the largest.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 073-A | P1 | 25 Google Font families loaded in a single render-blocking CSS request; most are unused on any given page. Directly degrades LCP and FCP for every user on every page load. |
| 073-B | P2 | 100 aerial JPG images (39MB total) in `public/images/` appear entirely unused -- `getRandomImage()` is never called. Dead weight shipped on every deploy. |
| 073-C | P2 | No images use modern formats (WebP/AVIF), `srcset`, or responsive `sizes`. All `<img>` tags are raw URLs. |
| 073-D | P3 | Most `<img>` tags lack explicit `width`/`height` attributes, contributing to CLS during load |
| 073-E | P3 | Only 2 of ~12 `<img>` tags use `loading="lazy"` |

### Recommendations

- **Immediate (P1):** Replace the mega Google Fonts request with only the fonts actually used (likely Inter + 1 mono font). Load others dynamically via the theme customizer only when selected.
- **Short-term (P2):** Remove or relocate the unused `public/images/` directory. If images are needed, convert to WebP, resize to max needed dimensions, and implement responsive `<picture>` elements.
- **Medium-term:** Add an image optimization step to the build pipeline (e.g., `vite-imagetools` or a CDN with automatic format negotiation).

---

## 074 -- Web Vitals

### LCP (Largest Contentful Paint)

**Primary concern:** The 25-font Google Fonts CSS is render-blocking. The browser cannot paint meaningful content until this CSS is downloaded and parsed. Even with `display=swap`, the CSS file itself blocks rendering. This directly inflates LCP.

**Secondary concern:** The authenticated app requires a waterfall of: HTML -> JS bundle -> React hydration -> auth check (`/api/auth/user`) -> org resolution -> route data fetch -> render. There is no SSR, no streaming, and no HTML-level skeleton.

**Positive:** Route prefetching on sidebar hover and next-route prediction helps subsequent navigations. The `PageShell` skeleton provides visual content quickly once the JS is loaded.

### INP (Interaction to Next Paint)

**Primary concern:** `AnimatePresence` with `key={location}` triggers full component trees to unmount and remount on navigation. On pages with heavy component trees (founder-dashboard at 7286 LOC), this creates expensive React reconciliation.

**Secondary concern:** The `AppContent` component renders 14+ conditional floating components (`{user && <FloatingActionButton />}`, `{user && <CommandPalette />}`, etc.) that all re-render when `user` state changes.

**Positive:** `framer-motion` animations use `will-change` and spring-based transitions that offload to the compositor.

### CLS (Cumulative Layout Shift)

**Primary concern:** Images without `width`/`height` attributes cause layout shifts when they load.

**Secondary concern:** Multiple floating elements (`TrialBanner`, `FloatingActionButton`, `FloatingHelpButton`, `DynamicIsland`, `PaxCopilotRail`, `MobileBottomNav`) are conditionally rendered based on async data (`user` state). If auth resolves after initial paint, these elements pop in and shift content.

**Positive:** The dark-mode FOUC prevention script in `index.html` (applying `dark` class before React renders) prevents a theme-induced layout shift.

### No Web Vitals Monitoring

There is no `web-vitals` library integration. The `telemetry.ts` module tracks custom events (page views, feature usage, AI usage) but does not measure or report LCP, INP, CLS, FCP, or TTFB. There is no way to know how real users experience performance.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 074-A | P1 | No web-vitals measurement or reporting; performance is unmeasured in production (ref: 073-A font-blocking also directly impacts LCP) |
| 074-B | P2 | Auth waterfall (HTML -> JS -> auth check -> org -> data -> render) creates a multi-second LCP on first load with no HTML-level fallback |
| 074-C | P2 | Conditional rendering of 14+ floating components after auth resolution may cause CLS |
| 074-D | P3 | Full component tree unmount/remount on navigation may degrade INP on complex pages |

### Recommendations

- **Immediate (P1):** Add `web-vitals` library and report CWV to the existing telemetry endpoint. This takes ~10 lines of code and provides the data needed to prioritize all other performance work.
- **Short-term (P2):** Reduce the auth waterfall by embedding a minimal auth token in the HTML response (e.g., via a server middleware that checks the session cookie and injects a `<script>` with initial auth state).
- **Medium-term:** Reserve layout space for floating components with CSS (not conditional rendering) to eliminate CLS.

---

## 075 -- Progressive Enhancement

### Current State

AcreOS is a single-page application (React 19 + Vite) with no server-side rendering, no static site generation, and no HTML fallback. With JavaScript disabled, users see an empty `<div id="root"></div>` -- no content, no message, no redirect.

### Positive Patterns

1. **Service Worker with offline support:** `sw.js` implements a cache-first strategy for static assets and a network-first strategy with IndexedDB queueing for API requests. When offline, cached pages are served and writes are queued for background sync. This is genuine progressive enhancement.

2. **PWA manifest:** `manifest.json` is present with proper icons, enabling install-to-home-screen and standalone mode.

3. **Skip-to-content link:** `AppContent` renders a `.skip-to-content` anchor targeting `#main-content`. This degrades gracefully.

4. **Dark mode FOUC prevention:** The inline `<script>` in `index.html` applies the dark class before React renders, preventing a flash.

5. **`<noscript>` tag:** Not present. Users with JavaScript disabled get a blank page with no explanation.

### What Is Absent

- **No SSR/SSG:** Expected for this stack (React SPA on Express), but means no content is available without JavaScript. Search engines relying on HTML content (rather than JS rendering) see nothing.
- **No `<noscript>` fallback:** Not even a message telling users to enable JavaScript.
- **No critical CSS inlining:** All styles are in the JS bundle; there is no above-the-fold CSS extraction.
- **No HTML-level meta description per page:** Only the single `index.html` meta description exists. All 156 pages share the same SEO metadata.

### Findings

| ID | Severity | Finding |
|----|----------|---------|
| 075-A | P3 | No `<noscript>` tag; users with JS disabled see a blank page with no explanation |
| 075-B | P3 | No SSR/SSG; expected for this SPA architecture but limits SEO for public pages (landing, pricing, terms, privacy) |
| 075-C | P3 | Service worker provides genuine offline capability with IndexedDB queueing -- a strong progressive enhancement |
| 075-D | P3 | No per-page meta tags; all 156 routes share a single `<meta description>` and OG image |

### Recommendations

- Add a `<noscript>` tag to `index.html` with a message and link to enable JavaScript.
- For SEO-critical public pages (landing, pricing, terms), consider pre-rendering at build time (e.g., `vite-plugin-ssr` or a static HTML generation step).
- Add per-route `<title>` and `<meta description>` updates using `react-helmet` or a simple `useEffect` in `PageShell`.

---

## Summary

### P1 Findings (2)

| ID | Lens | Finding |
|----|------|---------|
| 073-A | Image/Asset | 25 Google Font families in a single render-blocking CSS request; directly degrades LCP/FCP for every user |
| 074-A | Web Vitals | No web-vitals measurement library; performance is entirely unmeasured in production |

### P2 Findings (6)

| ID | Lens | Finding |
|----|------|---------|
| 071-A | Error Boundary | 67 of 156 pages lack per-page error boundaries |
| 071-B | Error Boundary | Only 11 pages use `QueryErrorState`; most go blank on API failure |
| 073-B | Image/Asset | 100 unused aerial JPGs (39MB) shipped in every deploy |
| 073-C | Image/Asset | No modern image formats, srcset, or responsive sizing anywhere |
| 074-B | Web Vitals | Auth waterfall creates multi-second LCP on first load |
| 074-C | Web Vitals | 14+ conditionally-rendered floating components may cause CLS |

### P3 Findings (12)

| ID | Lens | Finding |
|----|------|---------|
| 070-A | Optimistic Updates | Core entity CRUD mutations lack optimistic updates |
| 070-B | Optimistic Updates | Only 3 of 80+ mutation sites use optimistic updates; no shared helper |
| 070-C | Optimistic Updates | Existing optimistic implementations are correctly implemented |
| 071-C | Error Boundary | ErrorBoundary component itself is well-designed |
| 071-D | Error Boundary | PageShell adoption is at 57% |
| 072-A | Route Transition | Suspense fallback is full-page spinner; no progress bar |
| 072-B | Route Transition | Route prefetching is well-implemented |
| 072-C | Route Transition | AnimatePresence causes full unmount/remount per navigation |
| 072-D | Route Transition | 67 pages handle loading states inconsistently |
| 073-D | Image/Asset | Most `<img>` tags lack width/height attributes (CLS) |
| 073-E | Image/Asset | Only 2 of ~12 `<img>` tags use `loading="lazy"` |
| 074-D | Web Vitals | Full tree unmount/remount on navigation may degrade INP |
| 075-A | Progressive Enhancement | No `<noscript>` tag for JS-disabled users |
| 075-B | Progressive Enhancement | No SSR/SSG for SEO-critical public pages |
| 075-C | Progressive Enhancement | Service worker + offline queueing is a strength |
| 075-D | Progressive Enhancement | All 156 routes share a single meta description |

### Top 3 Highest-Impact Fixes

1. **Trim Google Fonts to 2-3 families** (073-A). Replace the mega-request with only the active theme font + a mono font. Load others on demand. Estimated LCP improvement: 200-500ms.

2. **Add `web-vitals` reporting** (074-A). Ten lines of code to measure CWV in production. Without this, all other performance work is guesswork.

3. **Adopt `PageShell` on remaining 67 pages** (071-A, 071-B, 072-D). One-time migration that provides error boundaries, consistent loading skeletons, and `QueryErrorState` integration across the entire app.
