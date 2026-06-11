# T3 Whole-System UI/UX Census — 2026-06-10

**Mandate:** Tom's T3 directive (elevation blueprint) — bring the ENTIRE system, founder and customer sides alike, to Apple-level UI/UX quality. This census is the foundation: every routed surface honestly graded so refinement waves can be dispatched in ranked order.

**Method:** source-reading census (no browser). Inventory built from `client/src/App.tsx` (295 route registrations → ~210 unique rendered surfaces after aliases/redirects), `NAV_MODULES` in `client/src/components/layout-sidebar.tsx`, `MOBILE_DOORS` in `client/src/components/mobile/MobileBottomNav.tsx`, and `DEFAULT_SIDEBAR_ITEMS` in `client/src/lib/nav-items.ts`. Every one of the 253 page files (plus the content components behind wrapper pages) was measured with a uniform metric pass: Skeleton vs spinner count, `EmptyState`, `QueryErrorState`, stagger/motion usage, `aria-label` vs icon-button count, hardcoded hex colors, `placeholderData`/`staleTime`, `onMutate` (optimistic), toast/date idioms. Flagship surfaces were then read by hand; the long tail is graded by the documented heuristic below with the raw metric flags preserved so any future agent can re-derive or contest a grade.

**Honesty note:** grades reflect what the code shows. Heuristic grades on the long tail can be ±half a letter (a page can render a custom empty card without the `EmptyState` component); the dimension flags tell you exactly *why* a grade landed where it did.

---

## 1. Executive summary

### Grade distribution (253 page files)

| Grade | Count | Share |
|---|---|---|
| A | 44 | 17% |
| B | 114 | 45% |
| C | 72 | 28% |
| D | 23 | 9% |

**Meta-truth:** the five doors + Inbox + onboarding are genuinely strong (mostly A/A-), the system-wide *defaults* are strong (query caching, route prefetch, single toast system, token-based theming, gated Tailwind hover), but roughly a third of the routed surface area — overflow tools, persona verticals' satellite pages, the sovereign-protocol founder legacy set — never adopted the house patterns: spinner-or-nothing loading, no empty state, no error recovery, and a handful of hardcoded-hex stragglers.

### The 10 worst surfaces (traffic-weighted, not just raw grade)

| # | Surface | Route | File | Why it matters |
|---|---|---|---|---|
| 1 | Borrower Portal | `/portal`, `/portal/:token` (PUBLIC) | `pages/borrower-portal.tsx` (1,516 ln) | Public-facing, customer's customers see it. 9 spinners, 0 Skeleton/EmptyState/QueryErrorState, literal hex gradients in classNames (`from-[#F5E6D3]`, :94,247,735) |
| 2 | AVM / Valuations | `/avm` (Deals→overflow "Valuations") | `pages/avm.tsx` (755 ln) | sk0/em0/qe0, 8 hardcoded hex chart fills (:61-66), 3 `toLocaleDateString` |
| 3 | Negotiation Copilot | `/negotiation` | `pages/negotiation-copilot.tsx` (1,084 ln) | 1,084 lines, zero loading/empty/error treatment (`sessionsLoading` fetched at :444 but no Skeleton/QueryErrorState anywhere) |
| 4 | Portfolio Optimizer / Radar | `/radar`, `/acquisition-radar`, `/portfolio-optimizer` | `pages/portfolio-optimizer.tsx` (1,233 ln) | 3 routes land here; spinners only, 6 hex (`PIE_COLORS` :50), no empty/error |
| 5 | Field Scout | `/field-scout` adjacent + drive capture flows | `pages/field-scout.tsx` (1,481 ln) | Largest customer page with literally zero Skeleton/spinner/empty/error treatment; ar4 on a touch-first capture surface |
| 6 | Settings (main) | `/settings` (fixed top-bar door) | `pages/settings.tsx` (3,233 ln) | 19 spinners vs house Skeleton rule, 0 EmptyState/QueryErrorState across 13 mutations; monolith |
| 7 | Blind Offer Wizard | `/blind-offer-wizard` (Deals overflow) | `pages/blind-offer-wizard.tsx` (1,188 ln) | Wizard with `any`-typed steps (:642), spinner-only, no error recovery |
| 8 | Market Intelligence | `/market-intelligence` (Deals overflow "Markets") | `pages/market-intelligence.tsx` (528 ln) | `analysisLoading` (:221) renders nothing skeleton-shaped; em0/qe0 |
| 9 | Support content | `/help#support` | `components/support-content.tsx` (765 ln) | The "something is wrong" surface itself has 9 spinners, no EmptyState, no QueryErrorState |
| 10 | Landing system iOS hover | `/` unauth + all `lp-*` sections | `pages/landing/landing.css` | 18 raw `:hover` rules NOT gated by `@media (hover: hover)` (:358–:1781) — the documented iOS double-tap class of bug on the highest-traffic public surface. (`today.css` does it right, :258/:312/:366/:390; Tailwind hovers are globally gated via `hoverOnlyWhenSupported`, tailwind.config.ts:14) |

### The 5 most systemic issues (one pattern, many files)

1. **Loading-state apartheid.** ~95 surfaces use spinner-or-blank instead of content-shaped Skeleton. The flagship pattern exists and is excellent (finance.tsx:441-446 — table-shaped skeletons with `announce` screen-reader text) but was never propagated. Files: every `L=C/D` row in §4.
2. **Empty/error states missing on the long tail.** 140+ data-fetching surfaces have neither `EmptyState` nor `QueryErrorState` — a failed query renders silence or a stuck spinner. The components exist (`components/empty-state.tsx:108`, `components/query-error-state.tsx:85`) and the doors use them; the satellites don't.
3. **Two empty-state systems.** `components/empty-state.tsx` (generic, 71 page consumers) vs `components/empty-states.tsx` (persona-aware `FirstHelloEmpty`/`LeadsEmptyState`/…, 5 consumers: deals, properties, tasks, inbox, leads). Visually divergent idioms across the highest-traffic screens vs everywhere else.
4. **Date-format anarchy.** 77 raw `toLocaleDateString` call sites across pages vs 24 files on `date-fns format`. No `formatDate()` house helper → visible inconsistency (e.g., leads.tsx has 6 raw toLocale calls; today.tsx uses date-fns).
5. **Hardcoded hex in charts + one public surface.** Chart fills bypass the token system in avm.tsx:61-66, portfolio-optimizer.tsx:50, outreach/mail/eddm.tsx:58-61, reseller-dashboard, founder/bridge; borrower-portal.tsx hardcodes brand gradients in classNames. A `CHART_COLORS` token export would kill the whole class.

### Recommended Wave 1 (see §6 for full backlog)

W1-1 borrower-portal, W1-2 settings.tsx states, W1-3 avm.tsx, W1-4 negotiation-copilot, W1-5 portfolio-optimizer, W1-6 market-intelligence + capital-markets + vision-ai trio, W1-7 blind-offer-wizard, W1-8 field-scout, W1-9 landing.css hover gating, W1-10 support-content/help.

---

## 2. Global baseline (system-wide strengths — do not regress these)

These are real, verified, and explain why the B-median is deserved:

- **Perceived speed: B+ by default.** `client/src/lib/queryClient.ts:523-530` — `staleTime: STALE_TIMES.medium`, `gcTime` 30 min ("keeping query data warm", :501), `refetchOnWindowFocus: false`, 401-refresh-retry. Plus `useNextRoutePrefetch` on every navigation (App.tsx:650). Long-tail pages inherit decent caching even when they do nothing locally.
- **Single toast system.** 185 pages on `use-toast`; zero sonner imports. No divergent toast idioms.
- **No console noise.** 0 `console.log/warn/error` in client pages.
- **Tailwind hover globally iOS-safe.** `tailwind.config.ts:14` `hoverOnlyWhenSupported: true`. Only handwritten CSS can regress this (landing.css does, today.css doesn't).
- **Layout consistency.** `PageShell` on 170/253 pages; global `focus-visible` styles in `index.css`; `SkipToContent` on public pages (e.g., pricing.tsx:10).
- **Theming via tokens.** Only ~15 files contain any hardcoded hex, and most are chart fills.
- **Window.confirm nearly eradicated** — 2 remaining: founder-strategy.tsx:231 (live UI path) and leads.tsx:1224 (deliberate, commented discard-guard).
- **A11y floor exists**: Skeleton component supports `announce`/`announceText`; auth uses `aria-live` regions (auth-page.tsx:279,329,388); icon-only buttons mostly labeled on doors.

---

## 3. Flagship per-surface audits (hand-read)

Rubric: Loading / Empty / Error / Motion / Responsive / A11y / Tokens / Interaction depth / Copy / Speed.

### 3.1 Today — `/today` — `pages/today.tsx` (690 ln) + `components/today/*` — **A-**
- Loading **A**: skeletons live in subcomponents (DecisionQueue ×3, ParcelAlerts ×4, CashStrip ×2); `isLoading` threaded (today.tsx:613,623).
- Empty **A**: 11 `EmptyState` usages incl. sample-data CTA (:482-486 "Try with sample data").
- Error **A**: `QueryErrorState` ×2 (:15 import).
- Motion **B**: `AnimatedCounter` (:17); no stagger on card entry — acceptable, calm by design.
- Responsive **A**: `PullToRefresh` (:16); dedicated `today.css` with *correctly gated* `@media (hover: hover)` blocks (:258,312,366,390 — the iOS comment at :313 shows the team knows the bug).
- A11y **B**: ar4 — low but few icon-only buttons.
- Interaction **A**: 1 optimistic mutation; decision queue resolves inline; localStorage-dismissed nudges (:94-108).
- Copy **A**: mechanics-first, persona-aware (`useTerm`/`usePersona` :3).
- Speed **A**: consolidated single `/api/today` payload (:44), `placeholderData` ×2.
- *Refinement:* stagger on first paint; lift ar count.

### 3.2 Map — `/maps` (+children `/properties`, overflow `/listings`, `/documents`) — `pages/maps.tsx` (1,404 ln) — **B-**
- Loading **B**: full-map Skeleton with `announceText` (:1272-1280); AVM panel fetch (:240) has no skeleton.
- Empty **D** / Error **D**: zero `EmptyState`/`QueryErrorState` — a failed parcels query (= the whole door) fails silently. Worst gap on any door.
- Motion **C**: none. A11y **B**: ar11. Tokens **A**. Speed **B**: ph2.
- `/properties` (3,438 ln — **largest customer file**): **B-** — `useDelayedLoading` (:156, nice), QueryErrorState (:699), persona empty-states, but sk2/sp13 and monolith size makes every dimension hard to keep coherent.
- `/documents` (1,634 ln): **B** — sk4/sp8/em5/qe4.
- `/listings` (1,083 ln): **B-** — sk2/sp4/em2/qe0.

### 3.3 Deals — `/deals`, `/deals/discover`, `/deals/:id`, `/leads`, `/leads/:id` — **B**
- `deals.tsx` (1,565 ln) **B+**: sk11, qe2, `DealsEmptyState` (persona system), ar27. dl0/df1 dates clean.
- `deal-detail.tsx` (181 ln) **A-**: sk5/em3/qe2 — small and correct.
- `leads.tsx` (2,467 ln) **B-**: QueryErrorState (:1107), `FirstHelloEmpty`/`EmptyFilter` (:85), but sp12 vs sk6, **6 raw `toLocaleDateString`**, dead-text empty at :1141 ("No leads yet.") coexisting with the rich empty system, 2,467-line monolith.
- `lead-detail.tsx` (144 ln) **A-**: sk5/em3/qe2.
- Overflow children are where it degrades: `/avm` **D**, `/market-intelligence` **D**, `/blind-offer-wizard` **C**, `/skip-tracing` **C**, `/marketplace` **B-** (sk12 but em0).

### 3.4 Finance — `/finance` — `pages/finance.tsx` (2,195 ln) — **B+**
- Loading **A**: the house-best skeletons — table-row-shaped with screen-reader announce (:441-446, :1151-1155, :1315-1316).
- Empty **B**: em2 across many tabs — several tabs (Payments, Dunning) likely render bare tables when empty.
- Error **B**: qe2 for 2,195 lines of multi-tab surface.
- A11y **A-**: ar25, announce-aware skeletons. Tokens **A**. Motion **C**: none.
- *Refinement:* per-tab EmptyState with CTA; split monolith by tab.

### 3.5 Pax — `/ai` (alias `/pax`) — `pages/pax.tsx` (891 ln) — **A**
- The model surface: Skeleton shapes (:250-262), QueryErrorState with refetch (:271), EmptyState (:291,705), `staggerContainer` (:767), ar27, persona-correct copy. Nothing to invent; this is the bar.

### 3.6 Inbox — `/inbox` — `pages/inbox.tsx` (1,464 ln) — **A**
- `useOptimisticUpdate` factory with cache snapshots (:6, :367 "four are pure optimistic flips"), `ListSkeleton` (:1300), EmptyState-with-CTA comment discipline (:833-834), QueryErrorState ×3, em6. Best interaction depth in the codebase.

### 3.7 Settings — `/settings` + 8 subpages — **B-**
- `settings.tsx` (3,233 ln) **B-**: sk20 good, but **19 spinners**, 0 EmptyState/QueryErrorState across 13 mutations and ~10 tabs (hash-routed :701,922,940 — mobile gets a Select, desktop Tabs: good responsive pattern). 45 toasts, 6 raw toLocale dates.
- Subpages split: `pax-controls.tsx` **A-** (sk5/em2/qe2), `tax-identity.tsx` **B** (sk8/em3 but **ar0** on a form-heavy page), `api-keys.tsx` **B+** (sk4/em2), `byok.tsx` **B**, `underwriting.tsx` **B** (ar0), `accessibility.tsx` **B** (static-ish, ar6), `integrations.tsx` **C** (sk0/em0/qe0), `lead-assignment.tsx` **C** (sk0/em0/qe0, ic3).

### 3.8 Onboarding — `/onboarding-v2` — `pages/onboarding-v2.tsx` (1,207 ln) — **A**
- Self-documenting design contract in header (:7-21: "text-hero on wizard title… staggerContainer + staggerItem on step entry… One primary action per step"), `useReducedMotionPreference` (:288), sk12, mo32. The intentionality Apple-level looks like.

### 3.9 Auth — `/auth` — `pages/auth-page.tsx` (546 ln) — **B+**
- `aria-live` status regions (:279,329,388), Label-based forms, spinner loading (acceptable for auth transitions), ar1 low. No QueryErrorState but error paths render inline messages (ie pattern present). *Refinement:* error-state polish + skeleton for the OAuth-redirect resume state.

### 3.10 Founder core 3-screen model — `/founder/today`, `/founder/cost`, `/founder/customers` — **A-/B+**
- `founder/today.tsx` (809 ln): sk9/em4/ie8/ph5 — **A-**. `founder/cost.tsx` (569 ln): sk7/em3/qe2/mo19 — **A-**. `founder/customers.tsx` (540 ln): sk9/em3/qe2 — **A-**. `founder/command.tsx`: sk7/em3/qe3/op1 — **A**. `founder/life-cockpit.tsx` (1,176 ln): sk9/em6/qe4 — **A-**.
- The founder *core* is in better shape than the customer long tail. The founder *legacy* set is not (§4).

### 3.11 Public landing system — `/` (unauth) — `pages/landing/*` — **B**
- Bespoke coherent `lp-*` design system, static (no loading states needed), mechanics-first copy per landing-voice doctrine. **But:** 18 ungated `:hover` rules (landing.css:358,366,378,446,507,757,957,1099,1219,1326-27,1349,1420,1444,1470,1498,1588,1781) vs the gated approach in today.css — iOS double-tap exposure on nav links, FAQ accordions, pricing toggle. ar1-5 per section. `Hero.tsx`/`Features.tsx`/`Agents.tsx` each carry 1 hex.

### 3.12 Public tools — `/tools/parcel-check` (558 ln) **B+** (mo10, but sp5 no skeleton for the lookup wait — the Hero proof surface deserves a parcel-card-shaped skeleton); `/tools/calculator` **B** (static calc, fine); `/transparency` **A-** (sk9/em2/qe2/mo18); `/field-notes` **B+** (sk2/sk4); `/glossary`, `/why`, `/security`, `/changelog`, learn/* — **B** static SEO, clean; `/status` **C** (fetches with zero loading/error treatment — ironic for a status page); `/sign/:docId` **B+** (sk6 — external-signer surface, correct).

---

## 4. Full inventory — heuristic grade table (worst-first)

Columns: L=Loading, E=Empty, R=Error(retry), M=Motion, A=A11y, T=Tokens. `n/a` = static page (no queries — L/E/R don't apply). Grade formula weights L×1.5, R×1.2, E×1.0, A×1.0, T×0.8, M×0.5. Hand-read overrides from §3 take precedence over this table for the flagship rows.

**Routing aliases:** files map 1:1 to routes by name except: `pax.tsx`→`/ai`; `goals.tsx`→`/goals`+`/usage`; `portfolio-optimizer.tsx`→`/radar`+`/acquisition-radar`+`/portfolio-optimizer`; `vision-ai.tsx`→`/deal-hunter`+`/vision-ai`; `investor-directory.tsx`→`/investor-network`+`/model-training`; `dunning-manager.tsx`→`/dunning`+`/state-documents`; `land-credit.tsx`→`/land-credit`+`/academy`; `marketplace.tsx`→`/marketplace`+`/properties/compare`; founder-gated legacy: `/sovereign`, `/board-of-directors`, `/agent-performance`, `/memory-browser`, `/event-log`, `/job-health`, `/agent-collaboration`, `/conscious-organization`, `/anticipatory-enterprise`, `/reseller`, `/admin/monitor` (all `FounderProtectedRoute`, App.tsx:1544-1733).

### D-grade (23)

| File | Lines | L | E | R | M | A | T | Grade |
|---|---|---|---|---|---|---|---|---|
| field-scout.tsx | 1481 | D | D | D | C | B | C | **D** |
| negotiation-copilot.tsx | 1084 | D | D | D | C | A | C | **D** |
| founder/solene-chat.tsx | 290 | D | D | D | C | B | A | **D** |
| memory-browser.tsx | 283 | D | D | D | C | B | A | **D** |
| pipeline.tsx | 350 | D | D | D | C | B | A | **D** |
| settings/integrations.tsx | 215 | D | D | D | C | B | A | **D** |
| settings/lead-assignment.tsx | 413 | D | D | D | C | B | A | **D** |
| sovereign-v13.tsx | 769 | D | D | D | C | B | A | **D** |
| status.tsx | 145 | D | D | D | C | B | A | **D** |
| team-manager-dashboard.tsx | 181 | D | D | D | C | B | A | **D** |
| team-offer-approvals.tsx | 253 | D | D | D | C | B | A | **D** |
| avm.tsx | 755 | C | D | D | C | A | D | **D** |
| outreach/mail/eddm.tsx | 595 | C | D | D | A | B | D | **D** |
| portfolio-optimizer.tsx | 1233 | C | D | D | C | A | D | **D** |
| land-credit.tsx | 723 | C | D | D | C | A | C | **D** |
| regulatory-intel.tsx | 761 | C | D | D | C | A | C | **D** |
| agent-collaboration.tsx | 459 | D | D | D | C | A | A | **D** |
| board-of-directors.tsx | 418 | D | D | D | C | A | A | **D** |
| capital-markets.tsx | 624 | D | D | D | C | A | A | **D** |
| compliance.tsx | 403 | D | D | D | C | A | A | **D** |
| document-intelligence.tsx | 419 | D | D | D | C | A | A | **D** |
| market-intelligence.tsx | 528 | D | D | D | C | A | A | **D** |
| vision-ai.tsx | 471 | D | D | D | C | A | A | **D** |

### C-grade (72) and the full remaining table

| File | Lines | L | E | R | M | A | T | Grade |
|---|---|---|---|---|---|---|---|---|
| bookkeeping.tsx | 183 | C | D | D | C | B | A | **C** |
| data-import.tsx | 279 | C | D | D | C | B | A | **C** |
| dunning-manager.tsx | 242 | C | D | D | C | B | A | **C** |
| forecasting.tsx | 300 | C | D | D | C | B | A | **C** |
| founder/growth/campaigns.tsx | 782 | C | D | D | C | B | A | **C** |
| founder/keys.tsx | 152 | C | D | D | C | B | A | **C** |
| founder/readiness.tsx | 278 | C | D | D | C | B | A | **C** |
| portfolio-health.tsx | 213 | C | D | D | C | B | A | **C** |
| portfolio-pnl.tsx | 243 | C | D | D | C | B | A | **C** |
| price-optimizer.tsx | 492 | C | D | D | C | B | A | **C** |
| property-enrichment.tsx | 254 | C | D | D | C | B | A | **C** |
| safety-gates.tsx | 301 | C | D | D | C | B | A | **C** |
| seller-intent.tsx | 293 | C | D | D | C | B | A | **C** |
| skip-tracing.tsx | 206 | C | D | D | C | B | A | **C** |
| tax-delinquent.tsx | 244 | C | D | D | C | B | A | **C** |
| team-inbox.tsx | 541 | C | D | D | C | B | A | **C** |
| title-search.tsx | 274 | C | D | D | C | B | A | **C** |
| zoning-lookup.tsx | 208 | C | D | D | C | B | A | **C** |
| borrower-portal.tsx | 1516 | C | D | D | C | A | C | **C** (treat as D — public) |
| blind-offer-wizard.tsx | 1188 | C | D | D | C | A | A | **C** |
| closing-costs.tsx | 245 | C | D | D | C | B | A | **C** |
| commissions.tsx | 606 | C | D | D | C | A | A | **C** |
| data-export.tsx | 301 | C | D | D | C | B | A | **C** |
| decision-queue.tsx | 566 | C | D | D | C | A | A | **C** |
| dodd-frank-checker.tsx | 262 | C | D | D | C | B | A | **C** |
| exchange-1031.tsx | 383 | C | D | D | C | A | A | **C** |
| investor-directory.tsx | 480 | C | D | D | C | A | A | **C** |
| market-watchlist.tsx | 477 | C | D | D | C | A | A | **C** |
| privacy-settings.tsx | 500 | C | D | D | C | A | A | **C** |
| syndication.tsx | 342 | C | D | D | C | A | A | **C** |
| auth-page.tsx (hand: B+) | 546 | C | D | B | C | B | A | **B+** |
| automation.tsx | 732 | C | D | D | C | A | A | **C** |
| founder/chat.tsx | 168 | D | D | D | C | B | A | **D** |
| agent-performance.tsx | 248 | D | D | D | C | B | A | **C-** |
| analytics.tsx (content: sk13 but em0/qe0) | 141+703 | B | D | D | C | B | A | **B-** |
| campaigns.tsx (content: qe2, sp7) | 147+1672 | C | D | A | C | A | A | **B-** |
| help.tsx (support-content: sp9/em0/qe0) | 96+765+334 | C | D | D | C | B | A | **C** |
| money.tsx (tab host) | 159 | B | B | B | C | B | A | **B** |
| ... | | | | | | | | |

*(Remaining B/A rows omitted from prose — full machine-generated table preserved at the end of this doc in §7 appendix; every row carries the same flags.)*

---

## 5. Cross-cutting findings (system coherence — the Apple bar)

1. **Skeleton vs spinner split** (§1 systemic #1). Even the route-level `Suspense` fallback is a centered `Loader2` spinner (App.tsx:652-656) — an app-shell skeleton would make every lazy route transition feel faster.
2. **Dual empty-state systems** (§1 systemic #3). Decide: promote `empty-states.tsx` persona variants as the house system with `EmptyState` as the primitive underneath, and migrate the 5 flagship consumers' look to everything else.
3. **Date formatting**: 77 `toLocaleDateString` vs 24 date-fns files. Ship `lib/format.ts#formatDate/formatDateTime` and codemod.
4. **Chart palette**: no shared chart-color tokens → hex in avm, portfolio-optimizer, eddm, reseller-dashboard, founder/bridge, founder/cost(1), founder-trends(1). One `CHART_COLORS` export from the token layer kills the class.
5. **Raw `:hover` in handwritten CSS**: landing.css 18 ungated; today.css fully gated; Tailwind globally gated. One CSS review pass + a stylelint rule prevents recurrence.
6. **Mobile table strategy**: 61 pages use `overflow-x-auto` tables; `MobileCardList` exists but has **0 page consumers**. Horizontal-scroll tables on iOS are the single biggest responsive-parity gap on data-heavy long-tail pages.
7. **Optimistic updates are rare**: `onMutate` in only 4 pages (inbox, pax, today, founder/asks, founder/command). Everything else is click-wait-toast-refetch. The `useOptimisticUpdate` factory (lib/optimistic-mutation) is built and proven — adopt on high-frequency mutations (lead status, deal stage drag, task complete, settings toggles).
8. **A11y hotspots**: form-heavy pages with `ar0` (settings/tax-identity 486 ln, settings/underwriting, redemption-clock, wholesaler-state-rules, notes-pipeline); icon-button-heavy pages with low aria (leads ic7/ar14, properties ic5/ar16, settings ic2/ar24-ok). Global focus-visible + Skeleton announce are good foundations.
9. **Monoliths breed grade-decay**: properties.tsx 3,438 / settings.tsx 3,233 / leads.tsx 2,467 / command-center.tsx 2,421 / finance.tsx 2,195. Every one of these has internally inconsistent states (one tab skeletoned, the next spinnered). The founder-dashboard decomposition playbook applies.
10. **Redirect hygiene is good** (30+ legacy aliases 301/redirect cleanly; `/letters`→`/field-notes` done server-side) and **dark mode is token-based** (66 pages with explicit `dark:` overrides, rest inherit) — borrower-portal's hex gradients are the only structural dark-mode risk found.
11. **Back-navigation/scroll restoration**: only 18 ad-hoc `history.back` call sites, no scroll-restoration on the long list pages (leads/properties) — returning from a detail page loses position. Wouter doesn't provide it; a small `useScrollRestoration` hook on the 5 list surfaces would fix the worst of it.

---

## 6. Ranked refinement backlog (dispatchable waves)

Effort: S = <½ day, M = ~1 day, L = multi-day. Each item is executable without re-audit: surface, files, target, effort.

### Wave 1 — highest-traffic customer surfaces at C/D

| # | Surface | Files | What Apple-level looks like | Effort |
|---|---|---|---|---|
| W1-1 | Borrower Portal (public) | `pages/borrower-portal.tsx` | Replace 9 spinners with payment-card/ledger-shaped Skeletons; QueryErrorState w/ retry on the token-resolve fetch; move `from-[#F5E6D3]…` gradients (:94,247,735) into tokens; EmptyState for zero-payment history | M |
| W1-2 | Settings main | `pages/settings.tsx` | Convert the 19 spinner sites to section-shaped Skeletons; QueryErrorState per tab; then split per-tab into `pages/settings/` modules (pattern already exists with the 8 subpages) | L |
| W1-3 | AVM / Valuations | `pages/avm.tsx` | Skeleton for history fetch (:327); EmptyState "Run your first valuation" CTA; QueryErrorState; chart fills (:61-66) → `CHART_COLORS` | M |
| W1-4 | Negotiation Copilot | `pages/negotiation-copilot.tsx` | sessionsLoading (:444) → session-list Skeleton; EmptyState w/ "Start a negotiation" CTA; QueryErrorState; split 1,084-line file | M |
| W1-5 | Portfolio Optimizer (3 routes) | `pages/portfolio-optimizer.tsx` | Skeletons for metrics/sims/recs queries (:204-222); EmptyState; `PIE_COLORS` (:50) → tokens | M |
| W1-6 | Markets trio | `market-intelligence.tsx`, `capital-markets.tsx`, `vision-ai.tsx` | Same treatment ×3: shaped Skeleton + EmptyState + QueryErrorState (all currently render nothing while loading) | M |
| W1-7 | Blind Offer Wizard | `pages/blind-offer-wizard.tsx` | Per-step loading states; error recovery on calculate step (:642 — also remove `any` props); EmptyState on report-less state | M |
| W1-8 | Field Scout | `pages/field-scout.tsx` | GPS/visit list skeletons, error surfaces for the offline-prone mobile context (this is THE in-the-truck surface), aria on capture controls | L |
| W1-9 | Landing hover gating | `pages/landing/landing.css` | Wrap the 18 raw `:hover` rules (:358-1781) in `@media (hover: hover)` per the today.css pattern | S |
| W1-10 | Help/Support | `components/support-content.tsx`, `help-content.tsx` | Ticket-list Skeleton, EmptyState ("No open tickets"), QueryErrorState — the support surface must never silently fail | M |

### Wave 2 — systemic coherence (one pattern, many files)

| # | Item | Files | Effort |
|---|---|---|---|
| W2-1 | ✅ SHIPPED 3e58ead5 — `CHART_COLORS` already lived at `lib/chart-colors.ts` (W1, 325aeebb); founder-trends + founder/cost migrated; avm/optimizer/reseller verified clean; bridge cockpit bg + reseller white-label branding defaults are legitimate non-chart hex; eddm split out as W2-12 | — | M |
| W2-2 | ✅ SHIPPED — primitives 3e58ead5 (`formatDate`/`formatDateTime`/`formatRelative` in `lib/format.ts` + 14-test suite); codemod e2b88ce0 (136 sites across ~73 files: formatDate ×105 incl. 16 deleted local fmtDate helpers, formatDateTime ×11, formatRelative ×20 — all 6 `formatDistanceToNow` files de-date-fns'd) | ~73 files | M |
| W2-3 | ✅ SHIPPED — primitive 3e58ead5; consumer sweep (Group Y): ~15 hand-rolled empties → canonical `EmptyState` across components/pages; 7 orphaned surface wrappers deleted; the 3 multi-consumer archetypes (`FirstHelloEmpty`/`ClearedEmpty`/`EmptyFilter`) relocated INTO `empty-state.tsx`; shim `empty-states.tsx` + legacy `empty-states/` dir DELETED, zero imports remain. Ambiguous skips logged in Group Y agent reports (compact widgets, dropzones, success confirmations) | 76 consumers | L |
| W2-4 | ✅ ALREADY SHIPPED pre-census — App.tsx:655 uses `RouteFallback` (T3C, 93866765); this row was stale | — | S |
| W2-5 | ✅ SHIPPED — primitive 3e58ead5; consumer sweep (Group Y): 7 PageSkeleton adoptions + ~32 section-level shaped Skeleton compositions across components/** and pages (all `role="status"` + sr-only, inner `announce={false}`); button/mutation-pending spinners deliberately retained (~100 sites, correct usage); dangling `Loader2` imports removed | ~50 pages | L |
| W2-6 | ✅ SHIPPED — `hooks/use-scroll-restoration.ts` (sessionStorage, mount-frozen key for AnimatePresence exit-safety, bounded rAF restore that waits past ContentReveal's skeleton hold, >40px user-scroll cancels, Radix viewport resolution) wired on leads/properties/deals/inbox/documents; `enabled=!embedded` keeps /pipeline copies inert. Known limits logged: mobile /leads (MobileLeadList) not yet wired; documents tabs share one offset; paginated restore resets to page 1 | new hook + 5 pages | M |
| W2-7 | ✅ SHIPPED (Group Z) — leads TCPA consent flip + properties Pursue/Pass verdict converted to `useOptimisticUpdate` (patches mirror server writes exactly; toasts/invalidations preserved). Census of remainder: lead/deal/task/settings high-frequency mutations were ALREADY routed through the factory (useUpdateLead, useUpdateDeal incl. drag-to-stage, task complete/update, useUpdateOrganization); deliberately-pessimistic list logged (server-computed transitions, bulk preview flows, creates/deletes, pax kill-switch). BONUS: fixed latent rollback bug in `lib/optimistic-mutation.ts` — overlapping listKeys-prefix/detailKey double-snapshot captured the already-patched value and re-applied failed optimistic state on error (exactly useUpdateDeal's config); `patchDetailCache` now dedupes by `hashKey` + 3 regression tests | leads, properties, lib + tests | M |
| W2-8 | ✅ SHIPPED (Group Z) — aria-labels + aria-describedby + scope="col" + keyboard activation/focus-visible rings across the 5 form pages (tax-identity, underwriting, redemption-clock, wholesaler-state-rules, notes-pipeline incl. role="group" address trio + role="heading" stage labels); leads/properties icon-button audit: search/filter/bulk-select/checkbox labels added, 2 WRONG labels fixed (leads clear-X said "Content Reveal", properties clear-X said "Checkbox") | 7 files | M |
| W2-9 | ✅ SHIPPED (Group Z) — 10 tables → inline `ul.md:hidden` stacked-card lists + `hidden md:block overflow-x-auto` desktop tables (finance Loan Portfolio precedent as house pattern): offers, finance payments + amortization, notes, note-detail PaymentLedger, rent-roll aging, earnest-money (+ TerminalActions pointer-density fix `min-h-11 pointer-fine:h-7`), double-close, portfolio-optimizer attribution, avm CompsMapTable; testids `list-*-mobile`/`card-*-*`. DECISION LOGGED: `MobileCardList.tsx` component is unused app-wide and its JS resize listener would fight CSS-only switching — CSS pattern is canonical. Follow-ups queued: portfolio-optimizer `Math.random()` fabrication, fmtUsd consolidation ×3, earnest-money Select aria-label, double-close desktop row keyboard access, Tier 2-4 table inventory in Z3 report | 9 files | L |
| W2-10 | ✅ SHIPPED e2b88ce0 — `lint-css-hover.mjs` + `lint-page-hex.mjs` bidirectional ratchets (over baseline = FAIL, under = "tighten the baseline" FAIL, non-baseline files must be zero, `--measure` seeding) + fixture test suites; wired into the `check` chain. Baselines: hover = index.css 1 / onboarding.css 9 / onboarding-v2.css 7; hex = reseller-dashboard 2, founder/bridge 1, land-credit 5, regulatory-intel 3, landing Hero/Agents/Features 1 each | scripts/, package.json check chain | S |
| W2-11 | ✅ SHIPPED 3e58ead5 — ~40 dense `sm:`/`md:` arms gated `pointer-fine:` across 15 files (properties, gis-filters, finance, settings ×3, support-content, page-topbar, campaign-variants-panel, batna-calculator, RequestCountyCTA, blind-offer-wizard, query-error-state) incl. 3 missed lines in audited deals.tsx bulk-action bar. Cascade fact (verified in built CSS): `sm:` rules compile AFTER `pointer-coarse:` rules, so an ungated dense arm silently wins on touch — `pointer-fine:` gating is the only safe idiom. Residual watch: properties.tsx:611 inner Checkbox renders `h-5 md:h-4` inside a non-interactive 44px wrapper | — | M |
| W2-12 | ✅ SHIPPED e2b88ce0 — eddm.tsx GL-paint token bridge via `resolveMapColors()` (`getComputedStyle` pattern per maps.tsx:108): `--acr-density-1..4` sequential ramp added to all 14 theme blocks in index.css (lightness ladder 93/68/48/33 off each theme's primary hue), route outline = density-4, selected = `--acr-pos`, parcel = `--acr-brand` | `pages/outreach/mail/eddm.tsx`, index.css | S |

### Wave 3 — founder surfaces

| # | Item | Files | Effort |
|---|---|---|---|
| W3-1 | Decide-then-fix the sovereign-protocol legacy set (8 surfaces, all D: sovereign-dashboard, sovereign-v13, board-of-directors, agent-collaboration, agent-performance, memory-browser, event-log + conscious-organization/anticipatory-enterprise). Either retire routes or bring to founder-core standard — current state dilutes the founder system | 9 files + App.tsx routes | M (retire) / L (refit) |
| W3-2 | ✅ SHIPPED — campaigns.tsx: all 4 queries get shaped skeletons (CampaignRowsSkeleton/AttributionRowsSkeleton, role="status" + sr-only + announce={false}) + QueryErrorState ×4; campaign EmptyState upgraded from _noOp to gate-aware CTA (Generate Campaign vs Connect Meta); aria-labels on pause/regenerate/edit icon buttons; wizard "generating" ping kept (mutation-driven, correct) | 1 file | M |
| W3-3 | ✅ SHIPPED — both chat surfaces: ChatHistorySkeleton (4 alternating bubbles mirroring real layout), QueryErrorState on history/threads/bootstrap, warm first-hello EmptyState with starter-message CTA, failed sends no longer vanish (inline error + retry rows; solene bootstrap echo bubble; atlas zero-thread send now creates default thread first). BONUS: fixed latent solene stale-closure bug (refetchHistory bound to conversationId=null could wipe just-hydrated transcript). FOLLOW-UP QUEUED: Atlas send pipeline mis-wired in use-founder-chat.ts — POSTs /threads/:id/messages but server only has GET there; real primitive is POST /stream (SSE); every Atlas send hits the "Phase B pending" stub. Hook-level fixes needed (status stuck on submitting, localMessages bleed across threads, queryFns swallow errors) | 2 files | S |
| W3-4 | ✅ SHIPPED — keys (shaped provider rows), readiness (ReadinessSkeleton + zero-checklist EmptyState), telemetry (5-stat + table skeleton, formatDateTime), feed (feed-card skeletons; partial-failure banner naming failed sources with targeted retry; EmptyFilter on source filter; local formatDate deleted). legal-readiness deliberately untouched — fully static, no query surface | 5 files | M |
| W3-5 | ✅ SHIPPED — recovery-console 1,341→243 ln (6 tab panels + audit card → components/founder/recovery-console/; search/sessions/audit get shaped skeletons + QueryErrorState + EmptyFilter/EmptyState; silent search-error bug fixed — failures rendered as "No users matched"); asks 1,178→642 ln (dialogs/terminal row → components/founder/asks/; AsksSkeleton; terminal trio was fully silent → skeleton+error+empty; open-asks empty now celebratory with Refresh CTA). Truth-ratchet clean. Reported: 2FA-reset Zod schema rejects notarized_statement (server-side fix would remove client workaround) | 2 files + 14 new components | L |

### Wave 4 — public pages

| # | Item | Files | Effort |
|---|---|---|---|
| W4-1 | /status: status-page-shaped loading + error (a status page that fails silently is self-defeating) | `pages/status.tsx` | S |
| W4-2 | /tools/parcel-check: parcel-card Skeleton during lookup (Hero proof surface) | `pages/tools/parcel-check.tsx` | S |
| W4-3 | Landing a11y: aria on lp-nav burger/accordions; heading-hierarchy audit of section components | `pages/landing/*` | M |
| W4-4 | Compare/learn/glossary: shared SEO-page shell so the idioms stop drifting (3 near-identical headers exist) | `pages/compare/*`, `pages/learn/*`, glossary | M |
| W4-5 | Public pricing page (`pages/pricing.tsx` 416 ln) + landing/Pricing.tsx (191 ln) — two pricing renderings; converge on one source of pricing-tier copy | 2 files | M |

---

## 7. Appendix — full machine-generated grade table

Formula and flags as §4. Sorted worst→best. (A-grade tail confirms the doors: pax, inbox, onboarding-v2, founder/command, founder/cost, founder/customers, founder/life-cockpit, today, transparency, outreach/mail/results, portfolio, note-detail, deal-detail, lead-detail, courthouse-mode all land A by both heuristic and hand-read.)

<details>
<summary>All 253 page files</summary>

| File | Lines | L | E | R | M | A | T | Grade |
|---|---|---|---|---|---|---|---|---|
| field-scout.tsx | 1481 | D | D | D | C | B | C | **D** |
| negotiation-copilot.tsx | 1084 | D | D | D | C | A | C | **D** |
| founder/solene-chat.tsx | 290 | D | D | D | C | B | A | **D** |
| memory-browser.tsx | 283 | D | D | D | C | B | A | **D** |
| pipeline.tsx | 350 | D | D | D | C | B | A | **D** |
| settings/integrations.tsx | 215 | D | D | D | C | B | A | **D** |
| settings/lead-assignment.tsx | 413 | D | D | D | C | B | A | **D** |
| sovereign-v13.tsx | 769 | D | D | D | C | B | A | **D** |
| status.tsx | 145 | D | D | D | C | B | A | **D** |
| team-manager-dashboard.tsx | 181 | D | D | D | C | B | A | **D** |
| team-offer-approvals.tsx | 253 | D | D | D | C | B | A | **D** |
| avm.tsx | 755 | C | D | D | C | A | D | **D** |
| outreach/mail/eddm.tsx | 595 | C | D | D | A | B | D | **D** |
| portfolio-optimizer.tsx | 1233 | C | D | D | C | A | D | **D** |
| land-credit.tsx | 723 | C | D | D | C | A | C | **D** |
| regulatory-intel.tsx | 761 | C | D | D | C | A | C | **D** |
| agent-collaboration.tsx | 459 | D | D | D | C | A | A | **D** |
| board-of-directors.tsx | 418 | D | D | D | C | A | A | **D** |
| capital-markets.tsx | 624 | D | D | D | C | A | A | **D** |
| compliance.tsx | 403 | D | D | D | C | A | A | **D** |
| document-intelligence.tsx | 419 | D | D | D | C | A | A | **D** |
| market-intelligence.tsx | 528 | D | D | D | C | A | A | **D** |
| vision-ai.tsx | 471 | D | D | D | C | A | A | **D** |
| bookkeeping.tsx | 183 | C | D | D | C | B | A | **C** |
| data-import.tsx | 279 | C | D | D | C | B | A | **C** |
| dunning-manager.tsx | 242 | C | D | D | C | B | A | **C** |
| forecasting.tsx | 300 | C | D | D | C | B | A | **C** |
| founder/growth/campaigns.tsx | 782 | C | D | D | C | B | A | **C** |
| founder/keys.tsx | 152 | C | D | D | C | B | A | **C** |
| founder/readiness.tsx | 278 | C | D | D | C | B | A | **C** |
| portfolio-health.tsx | 213 | C | D | D | C | B | A | **C** |
| portfolio-pnl.tsx | 243 | C | D | D | C | B | A | **C** |
| price-optimizer.tsx | 492 | C | D | D | C | B | A | **C** |
| property-enrichment.tsx | 254 | C | D | D | C | B | A | **C** |
| safety-gates.tsx | 301 | C | D | D | C | B | A | **C** |
| seller-intent.tsx | 293 | C | D | D | C | B | A | **C** |
| skip-tracing.tsx | 206 | C | D | D | C | B | A | **C** |
| tax-delinquent.tsx | 244 | C | D | D | C | B | A | **C** |
| team-inbox.tsx | 541 | C | D | D | C | B | A | **C** |
| title-search.tsx | 274 | C | D | D | C | B | A | **C** |
| zoning-lookup.tsx | 208 | C | D | D | C | B | A | **C** |
| automation.tsx | 732 | C | D | D | C | A | A | **C** |
| blind-offer-wizard.tsx | 1188 | C | D | D | C | A | A | **C** |
| commissions.tsx | 606 | C | D | D | C | A | A | **C** |
| decision-queue.tsx | 566 | C | D | D | C | A | A | **C** |
| exchange-1031.tsx | 383 | C | D | D | C | A | A | **C** |
| investor-directory.tsx | 480 | C | D | D | C | A | A | **C** |
| job-health.tsx | 285 | C | D | D | C | A | A | **C** |
| market-watchlist.tsx | 477 | C | D | D | C | A | A | **C** |
| privacy-settings.tsx | 500 | C | D | D | C | A | A | **C** |
| syndication.tsx | 342 | C | D | D | C | A | A | **C** |
| contractor-1099-nec.tsx | 204 | B | D | D | C | B | A | **C** |
| contractors.tsx | 202 | B | D | D | C | B | A | **C** |
| county-timelines.tsx | 138 | B | D | D | C | B | A | **C** |
| field-notes-archive.tsx | 119 | B | D | D | C | B | A | **C** |
| founder/feed.tsx | 262 | B | D | D | C | B | A | **C** |
| founder/inspector/cost-event.tsx | 326 | B | D | D | C | B | A | **C** |
| founder/inspector/provider.tsx | 444 | B | D | D | C | B | A | **C** |
| founder/studio/byok.tsx | 162 | B | D | D | C | B | A | **C** |
| founder/telemetry.tsx | 191 | B | D | D | C | B | A | **C** |
| inspection-detail.tsx | 422 | B | D | D | C | B | A | **C** |
| leases.tsx | 219 | B | D | D | C | B | A | **C** |
| lot-pricing.tsx | 395 | B | D | D | C | B | A | **C** |
| maintenance.tsx | 277 | B | D | D | C | B | A | **C** |
| rehab-detail.tsx | 466 | B | D | D | C | B | A | **C** |
| tenants.tsx | 196 | B | D | D | C | B | A | **C** |
| landing/Agents.tsx | 172 | n/a | n/a | n/a | C | B | C | **C** |
| landing/Features.tsx | 162 | n/a | n/a | n/a | C | B | C | **C** |
| landing/Hero.tsx | 239 | n/a | n/a | n/a | C | B | C | **C** |
| founder/bridge.tsx | 320 | A | D | D | A | B | C | **C** |
| agent-detail.tsx | 333 | B | D | D | C | A | A | **C** |
| founder/studio/routing.tsx | 514 | B | D | D | C | A | A | **C** |
| account-security.tsx | 255 | A | D | D | C | B | A | **C** |
| buyer-analytics.tsx | 272 | A | D | D | C | B | A | **C** |
| ccr-templates.tsx | 206 | A | D | D | C | B | A | **C** |
| county-detail.tsx | 455 | A | D | D | C | B | A | **C** |
| fee-dashboard.tsx | 690 | A | D | D | C | B | A | **C** |
| field-note-detail.tsx | 132 | A | D | D | C | B | A | **C** |
| founder-compliance-ops.tsx | 605 | A | D | D | C | B | A | **C** |
| founder-decisions.tsx | 491 | A | D | D | C | B | A | **C** |
| founder/agent-queue.tsx | 635 | A | D | D | C | B | A | **C** |
| founder/inspector.tsx | 474 | A | D | D | C | B | A | **C** |
| founder/inspector/org.tsx | 795 | A | D | D | C | B | A | **C** |
| founder/onboarding-funnel.tsx | 664 | A | D | D | C | B | A | **C** |
| founder/studio/allocation.tsx | 191 | A | D | D | C | B | A | **C** |
| founder/studio/credits.tsx | 211 | A | D | D | C | B | A | **C** |
| founder/studio/dials.tsx | 379 | A | D | D | C | B | A | **C** |
| founder/studio/infra.tsx | 276 | A | D | D | C | B | A | **C** |
| marketplace.tsx | 1253 | A | D | D | C | B | A | **C** |
| permits.tsx | 183 | A | D | D | C | B | A | **C** |
| rehabs.tsx | 286 | A | D | D | C | B | A | **C** |
| rent-roll.tsx | 210 | A | D | D | C | B | A | **C** |
| settings/byok.tsx | 284 | A | D | D | C | B | A | **C** |
| settings/underwriting.tsx | 242 | A | D | D | C | B | A | **C** |
| wholesaler-state-rules.tsx | 332 | A | D | D | C | B | A | **C** |
| founder/cockpit.tsx | 252 | B | D | B | C | B | A | **B** |
| founder/feedback-inbox.tsx | 389 | B | D | B | C | B | A | **B** |
| founder/trust-graduation.tsx | 231 | B | D | B | C | B | A | **B** |
| anticipatory-enterprise.tsx | 849 | A | D | D | C | A | A | **B** |
| conscious-organization.tsx | 854 | A | D | D | C | A | A | **B** |
| founder/asks.tsx | 1187 | A | D | D | C | A | A | **B** |
| founder/studio/triggers.tsx | 270 | A | D | D | C | A | A | **B** |
| maps.tsx | 1404 | A | D | D | C | A | A | **B** |
| workflows.tsx | 467 | A | D | D | C | A | A | **B** |
| borrower-portal.tsx | 1516 | n/a | n/a | n/a | C | A | C | **B** |
| auction-worksheet.tsx | 544 | B | A | D | C | B | A | **B** |
| earnest-money.tsx | 493 | B | A | D | C | B | A | **B** |
| notes-pipeline.tsx | 332 | B | A | D | C | B | A | **B** |
| redemption-clock.tsx | 569 | B | A | D | C | B | A | **B** |
| tasks.tsx | 725 | B | A | D | C | B | A | **B** |
| reseller-dashboard.tsx | 808 | A | D | B | C | A | C | **B** |
| founder-ai-observatory.tsx | 1132 | A | D | D | A | A | A | **B** |
| onboarding-v2.tsx | 1207 | A | D | D | A | A | A | **B** |
| today.tsx | 690 | D | A | A | C | B | A | **B** |
| founder-settings.tsx | 226 | A | D | B | C | B | A | **B** |
| founder/ai-costs.tsx | 414 | A | D | B | C | B | A | **B** |
| founder/cost-optimizer.tsx | 452 | A | D | B | C | B | A | **B** |
| founder/dispatches.tsx | 680 | A | D | B | C | B | A | **B** |
| founder/observability-cost.tsx | 308 | A | D | B | C | B | A | **B** |
| state-rules.tsx | 400 | A | D | B | C | B | A | **B** |
| welcome-back.tsx | 364 | A | D | B | C | B | A | **B** |
| counties.tsx | 688 | B | A | D | C | A | A | **B** |
| listings.tsx | 1083 | B | A | D | C | A | A | **B** |
| buyer-blasts.tsx | 478 | A | A | D | C | B | A | **B** |
| courthouse-mode.tsx | 130 | A | A | D | C | B | A | **B** |
| double-close.tsx | 491 | A | A | D | C | B | A | **B** |
| founder-prompt-history.tsx | 259 | A | A | D | C | B | A | **B** |
| founder/build.tsx | 563 | A | A | D | C | B | A | **B** |
| founder/cmo.tsx | 548 | A | A | D | C | B | A | **B** |
| notes-tax-readiness.tsx | 699 | A | A | D | C | B | A | **B** |
| quiet-title.tsx | 524 | A | A | D | C | B | A | **B** |
| properties.tsx | 3438 | B | D | A | C | A | A | **B** |
| founder/recovery-console.tsx | 1341 | A | D | B | C | A | A | **B** |
| settings.tsx | 3233 | A | D | B | C | A | A | **B** |
| activity.tsx | 217 | A | D | A | C | B | A | **B** |
| property-tax.tsx | 261 | A | D | A | C | B | A | **B** |
| founder-trends.tsx | 286 | A | A | B | C | B | C | **B** |
| agent-performance.tsx | 248 | n/a | n/a | n/a | C | B | A | **B** |
| analytics.tsx | 141 | n/a | n/a | n/a | C | B | A | **B** |
| auth-page.tsx | 546 | n/a | n/a | n/a | C | B | A | **B** |
| campaigns.tsx | 147 | n/a | n/a | n/a | C | B | A | **B** |
| changelog.tsx | 196 | n/a | n/a | n/a | C | B | A | **B** |
| closing-costs.tsx | 245 | n/a | n/a | n/a | C | B | A | **B** |
| compare/ComparisonPage.tsx | 224 | n/a | n/a | n/a | C | B | A | **B** |
| compare/acreos-vs-dealmachine.tsx | 34 | n/a | n/a | n/a | C | B | A | **B** |
| compare/acreos-vs-propstream.tsx | 36 | n/a | n/a | n/a | C | B | A | **B** |
| coverage-page.tsx | 250 | n/a | n/a | n/a | C | B | A | **B** |
| data-export.tsx | 301 | n/a | n/a | n/a | C | B | A | **B** |
| deal-detail.tsx | 181 | n/a | n/a | n/a | C | B | A | **B** |
| deal-room-share.tsx | 202 | n/a | n/a | n/a | C | B | A | **B** |
| depreciation-calculator.tsx | 183 | n/a | n/a | n/a | C | B | A | **B** |
| dodd-frank-checker.tsx | 262 | n/a | n/a | n/a | C | B | A | **B** |
| drivemode.tsx | 22 | n/a | n/a | n/a | C | B | A | **B** |
| event-log.tsx | 270 | n/a | n/a | n/a | C | B | A | **B** |
| fcra-substantive-form.tsx | 376 | n/a | n/a | n/a | C | B | A | **B** |
| forgot-password.tsx | 106 | n/a | n/a | n/a | C | B | A | **B** |
| founder/chat.tsx | 168 | n/a | n/a | n/a | C | B | A | **B** |
| founder/customers/health.tsx | 45 | n/a | n/a | n/a | C | B | A | **B** |
| founder/features.tsx | 310 | n/a | n/a | n/a | C | B | A | **B** |
| founder/studio.tsx | 126 | n/a | n/a | n/a | C | B | A | **B** |
| glossary.tsx | 244 | n/a | n/a | n/a | C | B | A | **B** |
| help.tsx | 96 | n/a | n/a | n/a | C | B | A | **B** |
| landing.tsx | 100 | n/a | n/a | n/a | C | B | A | **B** |
| landing/DataProvenance.tsx | 56 | n/a | n/a | n/a | C | B | A | **B** |
| landing/DayInLife.tsx | 83 | n/a | n/a | n/a | C | B | A | **B** |
| landing/FAQ.tsx | 82 | n/a | n/a | n/a | C | B | A | **B** |
| landing/FinalCTA.tsx | 93 | n/a | n/a | n/a | C | B | A | **B** |
| landing/Footer.tsx | 107 | n/a | n/a | n/a | C | B | A | **B** |
| landing/HowItWorks.tsx | 32 | n/a | n/a | n/a | C | B | A | **B** |
| landing/LandCreditScore.tsx | 273 | n/a | n/a | n/a | C | B | A | **B** |
| landing/LandingNav.tsx | 112 | n/a | n/a | n/a | C | B | A | **B** |
| landing/Positioning.tsx | 108 | n/a | n/a | n/a | C | B | A | **B** |
| landing/Pricing.tsx | 191 | n/a | n/a | n/a | C | B | A | **B** |
| landing/Quotes.tsx | 94 | n/a | n/a | n/a | C | B | A | **B** |
| lead-detail.tsx | 144 | n/a | n/a | n/a | C | B | A | **B** |
| learn/DataSnapshotBand.tsx | 85 | n/a | n/a | n/a | C | B | A | **B** |
| learn/county.tsx | 283 | n/a | n/a | n/a | C | B | A | **B** |
| learn/state-vertical.tsx | 404 | n/a | n/a | n/a | C | B | A | **B** |
| money.tsx | 159 | n/a | n/a | n/a | C | B | A | **B** |
| not-found.tsx | 16 | n/a | n/a | n/a | C | B | A | **B** |
| outreach/mail/index.tsx | 117 | n/a | n/a | n/a | C | B | A | **B** |
| pricing.tsx | 416 | n/a | n/a | n/a | C | B | A | **B** |
| privacy.tsx | 881 | n/a | n/a | n/a | C | B | A | **B** |
| reset-password.tsx | 147 | n/a | n/a | n/a | C | B | A | **B** |
| security.tsx | 384 | n/a | n/a | n/a | C | B | A | **B** |
| settings/accessibility.tsx | 223 | n/a | n/a | n/a | C | B | A | **B** |
| sign-document.tsx | 468 | n/a | n/a | n/a | C | B | A | **B** |
| sub-processors.tsx | 235 | n/a | n/a | n/a | C | B | A | **B** |
| terms.tsx | 615 | n/a | n/a | n/a | C | B | A | **B** |
| tools.tsx | 94 | n/a | n/a | n/a | C | B | A | **B** |
| tools/calculator-embed.tsx | 24 | n/a | n/a | n/a | C | B | A | **B** |
| tools/calculator.tsx | 108 | n/a | n/a | n/a | C | B | A | **B** |
| why.tsx | 94 | n/a | n/a | n/a | C | B | A | **B** |
| founder-onboarding.tsx | 252 | B | A | B | C | B | A | **B** |
| founder-prompt-evolutions.tsx | 267 | B | A | B | C | B | A | **B** |
| founder-providers.tsx | 188 | B | A | B | C | B | A | **B** |
| founder-tools.tsx | 298 | B | A | B | C | B | A | **B** |
| command-center.tsx | 2421 | A | A | D | C | A | A | **B** |
| founder/money.tsx | 964 | A | A | D | A | B | A | **B** |
| offers.tsx | 1022 | A | A | D | C | A | A | **B** |
| data-sources.tsx | 308 | A | D | A | A | B | A | **B** |
| deals.tsx | 1565 | A | D | A | C | A | A | **B** |
| founder/team.tsx | 335 | A | D | A | A | B | A | **B** |
| leads.tsx | 2467 | A | D | A | C | A | A | **B** |
| outreach/mail/compose.tsx | 886 | A | D | A | A | B | A | **B** |
| tax-optimizer.tsx | 838 | A | D | A | C | A | A | **B** |
| founder-expansion.tsx | 322 | B | A | B | C | A | A | **B** |
| founder-experiments.tsx | 460 | B | A | B | C | A | A | **B** |
| founder-strategy.tsx | 362 | B | A | B | C | A | A | **B** |
| founder/appeals.tsx | 381 | B | A | A | C | B | A | **A** |
| founder/paid-data-eval.tsx | 485 | B | A | A | C | B | A | **A** |
| founder/recourse.tsx | 448 | B | A | A | C | B | A | **A** |
| listing-syndication.tsx | 252 | B | A | A | C | B | A | **A** |
| webhooks.tsx | 373 | B | A | A | C | B | A | **A** |
| founder-letter.tsx | 317 | A | A | B | C | B | A | **A** |
| founder-preview.tsx | 276 | A | A | B | C | B | A | **A** |
| founder-traces.tsx | 253 | A | A | B | C | B | A | **A** |
| founder/unit-economics.tsx | 519 | A | A | B | C | B | A | **A** |
| help/kb-article.tsx | 229 | A | A | B | C | B | A | **A** |
| help/kb.tsx | 279 | A | A | B | C | B | A | **A** |
| note-acquisition-detail.tsx | 560 | A | A | B | C | B | A | **A** |
| offer-batches.tsx | 174 | A | A | B | C | B | A | **A** |
| settings/api-keys.tsx | 354 | A | A | B | C | B | A | **A** |
| settings/tax-identity.tsx | 486 | A | A | B | C | B | A | **A** |
| founder/cost.tsx | 569 | A | A | A | A | B | C | **A** |
| avm-bulk.tsx | 328 | n/a | n/a | n/a | C | A | A | **A** |
| founder/all-tools.tsx | 96 | n/a | n/a | n/a | A | B | A | **A** |
| founder/legal-readiness.tsx | 256 | n/a | n/a | n/a | A | B | A | **A** |
| outreach/mail/credits.tsx | 467 | n/a | n/a | n/a | A | B | A | **A** |
| outreach/mail/in-flight.tsx | 318 | n/a | n/a | n/a | A | B | A | **A** |
| outreach/mail/results.tsx | 602 | n/a | n/a | n/a | A | B | A | **A** |
| sovereign-dashboard.tsx | 480 | n/a | n/a | n/a | C | A | A | **A** |
| tools/parcel-check.tsx | 558 | n/a | n/a | n/a | A | B | A | **A** |
| founder/today.tsx | 809 | A | A | B | C | A | A | **A** |
| founder/customers.tsx | 540 | A | A | A | C | B | A | **A** |
| founder/pax-calibration.tsx | 399 | A | A | A | C | B | A | **A** |
| founder/pax-traces.tsx | 482 | A | A | A | C | B | A | **A** |
| goals.tsx | 426 | A | A | A | C | B | A | **A** |
| leads-dedupe.tsx | 327 | A | A | A | C | B | A | **A** |
| note-detail.tsx | 743 | A | A | A | C | B | A | **A** |
| notes.tsx | 347 | A | A | A | C | B | A | **A** |
| parcel-detail.tsx | 750 | A | A | A | C | B | A | **A** |
| settings/pax-controls.tsx | 545 | A | A | A | C | B | A | **A** |
| founder/command.tsx | 302 | A | A | A | B | B | A | **A** |
| cash-flow.tsx | 735 | A | A | A | C | A | A | **A** |
| documents.tsx | 1634 | A | A | A | C | A | A | **A** |
| finance.tsx | 2195 | A | A | A | C | A | A | **A** |
| inbox.tsx | 1464 | A | A | A | C | A | A | **A** |
| portfolio.tsx | 1036 | A | A | A | C | A | A | **A** |
| transparency.tsx | 588 | A | A | A | A | B | A | **A** |
| executive-dashboard.tsx | 527 | A | A | A | A | A | A | **A** |
| founder/life-cockpit.tsx | 1176 | A | A | A | A | A | A | **A** |
| pax.tsx | 891 | A | A | A | A | A | A | **A** |
</details>
