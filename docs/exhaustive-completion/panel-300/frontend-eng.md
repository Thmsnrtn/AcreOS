# Frontend Software Engineering — 15 personas

## 31. Saoirse Murphy — Senior React engineer
**Lens:** Rendering correctness over cleverness
**Backstory:** 10 years React; obsessed with component semantics.
**What I see:** The `client/src/components/` has 150+ components. The `GettingStartedChecklist.tsx` (FW-YUNA-1) was duplicated before deletion—suggesting copy-paste architecture. The `OnboardingChecklist.tsx` uses `useState` to manage deal-creation state across a 5-step wizard, causing re-renders on every keystroke. The `PropertyMap.tsx` re-renders all 50K markers on pan/zoom (no windowing).
**Highest-leverage move:** Audit 5 hottest components (GettingStartedChecklist, PropertyMap, DealForm, LeadsTable, FinancialsChart). For each: (1) identify unnecessary re-renders with React DevTools Profiler, (2) extract data-fetching to custom hooks, (3) memoize expensive renders with useMemo/useCallback. Measure FCP + LCP before/after. Target: zero render on data unchanged. Effort: 1w.
**Biggest risk:** Aggressive memoization causes stale closures and UI doesn't update when data changes.

---

## 32. Kael Sutherland — RSC pioneer
**Lens:** Server/client boundary discipline
**Backstory:** Shipped Next.js 14 RSCs at scale; obsessed with "why is this client?"
**What I see:** The `client/src/pages/` structure suggests everything is client-side. Routes like `/properties` fetch parcel data client-side (useEffect → fetch(`/api/properties`)). The `/founder/financials` could be Server-Side Rendered (Marisol's data is static for 1 hour), but it's Client-Side. The page waterfalls: render → fetch → compute → render. No `getServerSideProps` or App Router RSC usage visible.
**Highest-leverage move:** Migrate 3 data-heavy pages to RSC: `/founder/financials` (fetch once per org, cache), `/properties` (fetch with RSC, paginate client-side). Move slow operations to server: expense calculations, NRR rollup, legal-hold scope expansion. Keep interactive pages client-side (lead detail, deal form). Document decision in design doc: "fetch on server if ≥1s latency, ≥5KB data, or zero interactivity during fetch." Effort: 1w per page.
**Biggest risk:** RSC content takes too long to stream and FCP gets worse.

---

## 33. Beatriz Carvalho — Accessibility engineer
**Lens:** Focus management and keyboard navigation
**Backstory:** Audited 50+ apps for WCAG 2.2; obsessed with blind-user workflows.
**What I see:** The `PropertyMap.tsx` has zero ARIA labels on markers. The modal system (`DialogBox.tsx`) doesn't trap focus (user tabs out of modal). The `/leads` table doesn't have row-selection keyboard support (only mouse). The form-validation errors don't announce to screen readers. The payment-failure toast appears but screen-reader users don't know why payment failed.
**Highest-leverage move:** Audit 5 highest-traffic pages for WCAG 2.2 AA compliance. Add `aria-label` on all map markers (e.g., "Property at 123 Main St, $250K"). Implement focus-trap in modals (FocusLock library). Add keyboard navigation to tables (arrow keys to select rows, Enter to action). Wire `aria-live=assertive` on form errors so screen readers announce validation failures. Test with NVDA (Windows) + VoiceOver (Mac). Effort: 2w.
**Biggest risk:** Over-labeling (aria-label on every button) makes screen-reader output too verbose.

---

## 34. Linus Andersson — Design system engineer
**Lens:** Composition vs configuration
**Backstory:** Owns Radix-shaped primitives; obsessed with component API surface.
**What I see:** The `shared/components/` has Button, Input, Select, Dialog (Radix-based, good). But every route route defines its own Button variants (primary, secondary, outline, ghost) via props. The TextField component has 12 optional props (`size`, `variant`, `icon`, `error`, `disabled`, `loading`, etc.), making it hard to reason about combinations. The `/founder/financials` page redefines a "summary card" component instead of using the system.
**Highest-leverage move:** Document composition-first API for the design system. Extract Button variants into separate components: PrimaryButton, SecondaryButton (not `<Button variant="secondary">`). Split TextField into InputField + SearchField + PasswordField. Create a "component kitchen sink" page at `/docs/components` showing every component + variants. Establish rule: "If prop combo isn't documented, it's not supported." Effort: 1w design + 1w codemod.
**Biggest risk:** Heavy composition means more files to import; bundle size bloat.

---

## 35. Yael Cohen — TypeScript types engineer
**Lens:** Type inference and conditional types
**Backstory:** Wrote conditional-types tutorial cited 100k times; obsessed with preventing `any` escapes.
**What I see:** The `client/src/lib/queryClient.ts` accepts `QueryFunctionContext` as `any`. The form-handling code uses React Hook Form + Zod, but there's no type narrowing between form data shape and API request shape. The `/api/leads` response is cast as `Lead[]` without narrowing. If Quentin (persona 16) adds a new optional field to Lead, the TypeScript compiler doesn't warn the UI.
**Highest-leverage move:** Wire Quentin's Zod schemas to the frontend via code-gen. Run `zod-to-ts` on build to export TypeScript types from schema.ts. Update react-hook-form field definitions to match. Add `QueryKey` type helper so react-query cache keys are type-safe. Add tests: "if schema changes, TS should error in client code." Effort: 2d setup + 1d ongoing.
**Biggest risk:** Code-gen breaks and client gets out-of-sync with schema.

---

## 36. Diego Almeida — Animation engineer
**Lens:** 60fps under load and smooth user perception
**Backstory:** Built Framer-Motion-quality micro-interactions; obsessed with jank detection.
**What I see:** The `/founder/home` dashboard shows 3 KPI cards that load sequentially (staggered fetch), and the page feels like it's loading forever. The `PropertyMap.tsx` pans smoothly on first load, but when 10,000 markers are visible, pans become janky (dropped frames). The deal-form wizard has no transition between steps.
**Highest-leverage move:** Add Framer Motion to 3 highest-traffic flows: (1) KPI-card reveal on `/founder/home` (stagger with 50ms between cards, animate opacity + slide-up), (2) step transition in deal-form wizard (fade out step-1, fade in step-2), (3) PropertyMap pan (use requestAnimationFrame, batch DOM reads/writes). Measure frame rate with DevTools; target 60fps. Effort: 1w.
**Biggest risk:** Animations cause layout thrashing; jank gets worse.

---

## 37. Marit Sørensen — Frontend performance engineer
**Lens:** Critical-path CSS and LCP optimization
**Backstory:** Cut LCP from 4.2s → 1.1s; obsessed with waterfall analysis.
**What I see:** The `/leads` page LCP is 3.2s. Waterfall: (1) HTML downloaded, (2) JS bundle 800KB, (3) CSS-in-JS runtime, (4) React hydration, (5) fetch `/api/leads`, (6) table render. The initial HTML has zero content (empty div, JS fills it). The critical CSS (page layout, above-the-fold styling) is bundled with non-critical CSS (modal styles, hidden components).
**Highest-leverage move:** Extract critical CSS (layout, heading, card borders) to separate stylesheet, inline in HTML. Defer non-critical CSS with `rel=preload` + `onload=media=all`. Move JS bundle parse to after FCP via dynamic imports (lazy-load table, modal, chart libraries). Pre-render `/leads` list shell (skeleton loaders) in HTML before JS runs. Measure LCP before/after. Target <2s. Effort: 2w.
**Biggest risk:** Pre-rendering stale data and serving outdated lead list until JS hydrates.

---

## 38. Adira Goldstein — Web vitals engineer
**Lens:** INP and FID (input delay)
**Backstory:** Owns CrUX dashboards at scale; obsessed with interaction response time.
**What I see:** The `/leads` table has 100 rows visible. Clicking a row should show detail in a slide-out panel. The click handler updates state, React re-renders 100 rows, and the detail panel appears 600ms later (bad INP). The search input (filter by lead name) waits for user to stop typing 300ms before fetching (debounce), but INP is still high because render takes 400ms.
**Highest-leverage move:** Move table filtering to useTransition (React 18+) so typing doesn't block input. Virtualize table rows (show 20 visible, cull rest). Add `startTransition` wrapper around data fetches so UI stays responsive during load. Measure INP with web-vitals library in production. Target <100ms INP. Effort: 1w.
**Biggest risk:** Virtualization breaks keyboard navigation (Beatriz's concern).

---

## 39. Kenji Watanabe — Mobile web engineer
**Lens:** iOS Safari quirks and touch UX
**Backstory:** Builds for Safari iOS; obsessed with viewport-fit and input behavior.
**What I see:** The `/leads` page on iPhone 14 has a fixed header that doesn't account for the notch (uses `position: fixed; top: 0` with zero `padding-top`). The text-input for "search leads" has font-size 12px (triggers auto-zoom on focus, shifts viewport). The "save deal" button is 30px tall (target size <44px by Apple guidelines). Zero testing on iOS.
**Highest-leverage move:** Test all pages on iPhone 14 (simulator or device). Add viewport-fit support for notch-aware layout. Set text-input font-size ≥16px to prevent auto-zoom. Increase button target size to ≥44x44px. Add `-webkit-appearance: none` to inputs so iOS doesn't apply default styles. Use `@supports (padding: max(0px))` for safe-area insets. Effort: 1w + ongoing (1d per new page).
**Biggest risk:** Safe-area CSS breaks on Android; you need vendor prefix fallbacks.

---

## 40. Olufemi Akande — PWA engineer
**Lens:** Service-worker correctness and offline-first sync
**Backstory:** Shipped offline-first apps; obsessed with sync queue invariants.
**What I see:** The `client/src/` has zero service-worker code. When an operator uses AcreOS on flaky WiFi, a lead update mid-flight disconnects and the update is lost. The app has no offline indicator. The `/properties` map could be cached so it works offline, but it's not. A deal saved offline on the plane is lost.
**Highest-leverage move:** Implement service-worker with offline queue: (1) create `sw-registration.ts` in client, register SW on app load, (2) intercept `POST /api/*` in SW, queue mutations if offline, (3) replay queue when online. Add offline indicator in app chrome ("You are offline"). Cache GET routes with Cache-First strategy. Measure adoption: log `navigator.onLine` on app load. Effort: 2w.
**Biggest risk:** Offline queue replays with stale data; the operator saved deal on plane, added data on phone, replays plane-version and loses phone changes.

---

## 41. Henrietta Bauer — CSP engineer
**Lens:** Nonce strategy and inline-script elimination
**Backstory:** Locked down SaaS to strict CSP; obsessed with `script-src 'none'`.
**What I see:** The `client/public/index.html` has no Content-Security-Policy header. The app likely uses inline scripts (e.g., Stripe's embed script, Google Analytics, Mapbox). Zero CSP report-only mode. An XSS vulnerability would allow attacker to inject arbitrary script. Compliance frameworks (SOC 2, HIPAA) require CSP.
**Highest-leverage move:** Add CSP header to server routes. Start with `Content-Security-Policy-Report-Only` (observe violations, don't block). Identify all inline scripts + external script sources. Move inline scripts to JS files. Generate nonce for each request, pass to React via context. Set `script-src 'nonce-{random}' https://cdn.jsdelivr.net` (for libraries). Test with CSP Evaluator. Move to `Content-Security-Policy` (enforce) once violations hit zero. Effort: 1w.
**Biggest risk:** Overly strict CSP breaks analytics, stripe, mapbox; you need exceptions.

---

## 42. Sasha Volkov — Bundling engineer
**Lens:** Tree-shake correctness and chunk strategy
**Backstory:** Vite + esbuild deep dives; obsessed with dead-code elimination.
**What I see:** The `client/src/pages/` has 20+ pages. Each page imports from `shared/schema.ts` (16K LOC, all schema types). When bundling, all schema code goes into every chunk (no tree-shaking). The final JS bundle is 800KB; 200KB is schema definitions that could be code-generated per-page. Zero code-splitting strategy per route.
**Highest-leverage move:** Split schema.ts into modules per vertical (schema-land.ts, schema-note.ts, schema-bh.ts, schema-ff.ts). Update imports. Configure Vite to code-split by route (automatic lazy-loading per route). Add bundle-analysis plugin (`vite-plugin-visualizer`) to visualize bundle. Identify unused imports and eliminate. Target bundle <500KB. Effort: 1w.
**Biggest risk:** Code-splitting increases HTTP requests; slower on slow networks.

---

## 43. Aurelia Ferraro — Hydration engineer
**Lens:** Hydration mismatch debugging
**Backstory:** Debugged React hydration mismatches at scale; obsessed with diff strategies.
**What I see:** No evidence of SSR/hydration in the codebase (everything client-side). But when Kael (persona 32) introduces RSCs on `/founder/financials`, hydration mismatches will emerge: server renders KPI cards with data from 09:00, client renders with data from 09:05 (stale), mismatch causes error. Zero hydration debugging tools in the UI.
**Highest-leverage move:** Add hydration-mismatch detection: wrap root component with `useLayoutEffect` that compares server-rendered DOM with client-rendered VDOM. If mismatch, log diff and reload page (1x, not infinite loop). Wire into error logging (Sentry). Also: ensure date/time never comes from `new Date()` at render-time (use props instead). Effort: 2d detection + 3d hunt + fix actual mismatches.
**Biggest risk:** False positives (normal differences, like timezone) cause thrashing reloads.

---

## 44. Tariq Mansour — Form engineer
**Lens:** Validation timing and error UX
**Backstory:** Built React Hook Form + Zod patterns at scale; obsessed with validation-timing discipline.
**What I see:** The lead-creation form validates on blur (better than on change, worse than on submit). The error messages appear below fields, but the field doesn't highlight red until blur. A user types an invalid email and keeps typing; no feedback until they leave the field. The address-validation field validates async (calls `/api/address-validate`), but there's no debounce; every keystroke triggers a request.
**Highest-leverage move:** Establish form validation rules: (1) instant sync validation on keystroke (email format via regex, required field check), (2) async validation debounced 300ms (address lookup, slug uniqueness), (3) full validation on submit. Use Zod for schema, React Hook Form for state. Add visual feedback: green checkmark on valid field (async), no error till blur (sync). Wire Yael's types (persona 35) so Zod schema = form types. Effort: 1w.
**Biggest risk:** Aggressive validation makes forms feel slow; debounce too high and it feels unresponsive.

---

## 45. Min-Jun Kim — Table-render engineer
**Lens:** Virtualization and windowing strategy
**Backstory:** Owned virtualized 100k-row tables; obsessed with off-screen-row culling.
**What I see:** The `/leads` table displays 100 rows per page. No virtualization; React renders all 100 rows even though only 20 are visible. Scrolling is janky (60 rows off-screen means 60 invisible React nodes being maintained). The `/properties` map (90-9 deferred) will have 50K markers—rendering all 50K at once will OOM the browser.
**Highest-leverage move:** Wire `react-window` (or TanStack Virtual) to `/leads` table: render only 20 visible rows + 5 buffer rows. Measure scroll performance before/after. For `/properties` map, use map clustering (cluster 100+ nearby parcel tiles into one icon) or lazy-load markers by viewport bounds (fetch markers in map bounds, not all 50K). Measure scroll FPS; target 60fps. Effort: 1w per component.
**Biggest risk:** Virtualization breaks keyboard selection (Min-Jun helps Adira here).

---

## Category synthesis — top 5 recommendations

1. **Component refactor for correctness + memoization (identify re-render bottlenecks, memoize expensive renders, extract data hooks)** — Saoirse + Adira + Linus converge: audit GettingStartedChecklist, PropertyMap, DealForm, LeadsTable with React DevTools Profiler. Extract data-fetching to hooks. Memoize renders. Remove duplicate components. Measure FCP before/after. Effort: 1w. · cited by: Saoirse, Adira, Linus, Diego, Tariq

2. **Virtualization + performance layering (lazy-load table rows, cluster map markers, code-split per route)** — Min-Jun + Marit + Sasha converge: use react-window for table, map clustering for property markers, code-split by route via Vite. Measure LCP <2s, INP <100ms. Effort: 2w. Unblocks `/properties` map launch (90-9). · cited by: Min-Jun, Marit, Sasha, Adira, Kenji

3. **Accessibility + mobile web foundation (WCAG 2.2 AA audit, iOS safe-area, focus management, 44px touch targets)** — Beatriz + Kenji + Olufemi converge: audit 5 pages for WCAG compliance, add focus-trap to modals, implement notch-safe layout, increase button targets to 44x44px. Test on iPhone 14 + NVDA. Effort: 2w. · cited by: Beatriz, Kenji, Olufemi, Henrietta, Linus

4. **Server-rendering + hydration safety (migrate data-heavy pages to RSCs, add hydration-mismatch detection, eliminate inline scripts)** — Kael + Aurelia + Henrietta + Yael converge: move `/founder/financials` to RSC, implement hydration-mismatch detector with automatic reload, add CSP header with strict nonce. Measure TTI before/after. Effort: 2w. · cited by: Kael, Aurelia, Henrietta, Yael, Tariq

5. **Form + input discipline (validation timing rules, async debounce 300ms, schema-driven types, error UX clarity)** — Tariq + Yael + Linus converge: establish validation rules in design doc, wire Zod schemas to React Hook Form, implement debounced async validation (address, slug), add visual feedback (green checkmark). Test form latency <100ms per keystroke. Effort: 1w. · cited by: Tariq, Yael, Linus, Diego, Beatriz

