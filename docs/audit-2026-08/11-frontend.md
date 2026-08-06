# 11 — Frontend (cache-invalidation correctness, dead code, deps)

*Slice 11. Read-only. Depth: medium (stratified). Region: `client/src` — the four big files plus the query-invalidation surface across mutation hooks.*

**State of the region:** The big files are large but not defect-dense; the map lazy-loading pattern (`property-map-lazy.tsx`) is correct. The one defect class that survives every gate here is **incomplete cache invalidation** — mutations that invalidate *a* key (satisfying `use-mutation-must-invalidate`, which only checks that *some* cache call exists) but not the *right* keys. The customer's primary door, `/api/today`, is invalidated by **zero** entity CRUD mutations, so create/delete/update leaves the Today screen stale for up to 2 minutes. The registry built to prevent exactly this (`lib/query-keys.ts`) has **zero adoption** — it is dead code and is itself already stale (it predates `/api/today`). Secondary: two full WebGL map engines ship in one chunk.

---

### F-11-1 — Entity CRUD mutations never invalidate `/api/today`; the customer's primary door goes stale for up to 2 min after any create/delete
**Severity:** P1 serious
**Surfaced by:** slice 11 (frontend)
**Survives which gates:** `use-mutation-must-invalidate` (eslint-rules/use-mutation-must-invalidate.cjs) only checks that a success callback contains *one* invalidating call from a fixed set — it is satisfied the moment a mutation invalidates `/api/leads` or `/api/dashboard/stats`. It has no model of *which* keys a given entity feeds, so it cannot see that the key the visible screen actually reads (`/api/today`) is missing.
**Evidence:** `/api/today` is the consolidated payload for the Today door, aggregating leads/deals/properties/notes/tasks/payments (`server/routes-today.ts:13,33`). It is read only via `["/api/today", "?since=…&tz=…"]` with `staleTime: 2*60*1000` (`client/src/pages/today.tsx:184-189,197-199`). Grep for who invalidates it: **only `today.tsx:273,304`** (its own internal queue mutations). The entity hooks invalidate the *legacy* granular keys instead — `use-leads.ts:272-276`, `use-deals.ts:166-169`, `use-properties.ts:137-140` all hit `/api/dashboard/stats|intelligence|today-priorities`, **never `/api/today`**.
**What's wrong:** The Today screen was consolidated onto one `/api/today` endpoint, but the CRUD mutation hooks were never updated to invalidate that key — they still target the pre-consolidation `/api/dashboard/*` keys that Today no longer reads. `today.tsx:186` even documents "prefix invalidation on ['/api/today'] keeps working" — the mechanism is intact, the callsites were never wired. Built-but-unwired, the repo's signature defect.
**Impact:** Burns trust after sale. A customer who adds a lead/deal/property (including the day-one "add your first property" moment) returns to Today and does not see it reflected for up to 2 minutes. The primary door feels dead exactly when the user is testing whether the product is alive.
**Fix:** Add `queryClient.invalidateQueries({ queryKey: ["/api/today"] })` to the `onSuccess` of every lead/deal/property/task create+update+delete hook (`use-leads.ts`, `use-deals.ts`, `use-properties.ts`, `use-tasks.ts`), and to the page-level mutations in `properties.tsx`. Better: route all of them through `invalidateRelated` (see F-11-3) after adding `/api/today` to every `RELATED` entry.
**Gate it:** Extend `use-mutation-must-invalidate.cjs`: when a mutation's `mutationFn` URL matches a known entity prefix (`/api/leads`, `/api/deals`, `/api/properties`, `/api/tasks`), require that its success callback invalidates the entity's full `RELATED` set (which must include `/api/today`) — i.e. assert the *specific* keys, not merely "some" key. Baseline: 0 entity mutations currently invalidate `/api/today`.
**Effort:** S
**Blast radius:** `use-leads.ts`, `use-deals.ts`, `use-properties.ts`, `use-tasks.ts`, `pages/properties.tsx`, `lib/query-keys.ts`.
**Confidence:** high — grep for `"/api/today"` + `invalidate` across `client/src` returns only the two self-invalidations in `today.tsx`; every entity hook's invalidation list is pasted above.

---

### F-11-2 — Create mutations skip `/api/dashboard/stats` that their own delete/update counterparts invalidate (asymmetry)
**Severity:** P2 real
**Surfaced by:** slice 11
**Survives which gates:** `use-mutation-must-invalidate` passes because create hooks *do* invalidate the list + onboarding checklist. The lint cannot compare a create against its sibling delete to notice the create invalidates a strictly smaller set.
**Evidence:** `use-properties.ts` — create (`:75,80`) invalidates `properties.list` + `onboarding/checklist-status` only; delete (`:137-139`) invalidates `properties.list` + `dashboard/stats` + `dashboard/today-priorities`. `use-deals.ts` — create (`:118-119`) invalidates `/api/deals` + `onboarding` only; update (`:166-169`) invalidates `/api/deals` + `dashboard/stats` + `dashboard/intelligence` + `dashboard/today-priorities`.
**What's wrong:** Deleting a property refreshes the dashboard KPI tiles; creating one does not. The counts increment only on the next unrelated invalidation or hard refresh. Same asymmetry for deals. The invalidation set was copied per-hook by hand, so each hook drifted independently.
**Impact:** Burns trust after sale (lesser than F-11-1 because these keys are the legacy dashboard, less prominent than Today). Whoever still reads `/api/dashboard/stats` sees a count that lags creates.
**Fix:** Make create invalidate the same set as delete/update for the same entity. Collapse all three to `invalidateRelated(entity, qc)` (F-11-3).
**Gate it:** Same extended lint as F-11-1 — assert the full `RELATED` set on every mutation for a known entity, which makes create/delete symmetric by construction. Baseline: property-create and deal-create both miss `dashboard/stats` today.
**Effort:** S
**Blast radius:** `use-properties.ts`, `use-deals.ts`.
**Confidence:** high — line-for-line invalidation lists pasted above.

---

### F-11-3 — The query-key registry built to prevent this staleness class has zero adoption and is itself already stale
**Severity:** P2 real
**Surfaced by:** slice 11
**Survives which gates:** Nothing gates *adoption* of `invalidateRelated`. `use-mutation-must-invalidate.cjs:36` lists `invalidateRelated` as an *accepted* call but never *requires* it. `lint:reachability` covers server exports, not client-side dead code.
**Evidence:** `client/src/lib/query-keys.ts` exports `QK`, `RELATED`, and `invalidateRelated` — its header docstring cites the exact bug it exists to kill ("deleted 17 sample leads still showed on dashboard", 2026-05-12). Importer count: `grep -rn "from.*query-keys" client/src --include=*.tsx --include=*.ts | grep -v query-keys.ts:` → **zero rows.** `grep "invalidateRelated"` outside the definition → **zero.** `grep "QK\."` outside the definition → **zero.** Additionally the map is already stale: `RELATED.lead` / `RELATED.property` (`query-keys.ts:88-113`) list `dashboard.stats` and `dashboard.todayPriorities` but **not** `/api/today` — so even if adopted verbatim it would not fix F-11-1.
**What's wrong:** The single-source-of-truth fan-out map was written and never wired; every mutation hook still hand-inlines its keys, which is why they drifted (F-11-1, F-11-2). Dead infrastructure that also encodes an out-of-date consumer list.
**Impact:** Neither blocks a sale nor directly burns trust on its own — but it is the *root cause* that lets F-11-1 and F-11-2 exist and recur. It is also ~140 lines of dead code in the middle of the shrink campaign.
**Fix:** Add `/api/today` (and `dashboard.intelligence` where missing) to each `RELATED` entry, then migrate the ~5 CRUD hooks to `onSuccess: () => invalidateRelated("<entity>", qc)`. Delete the per-hook inline key lists. One place to maintain thereafter.
**Gate it:** After migration, make the extended `use-mutation-must-invalidate` require `invalidateRelated` (not just any invalidator) for known-entity mutations. Add a trivial `queryKeysRegistryAdopted.test.ts` asserting importer count ≥ 5. Baseline today: 0 importers.
**Effort:** M
**Blast radius:** `lib/query-keys.ts` + the 5 entity hooks.
**Confidence:** high — zero-importer result is definitive; RELATED omission of `/api/today` read directly.

---

### F-11-4 — `properties.tsx` page-level bulk mutations invalidate only the list, not dashboard/today/onboarding
**Severity:** P2 real
**Surfaced by:** slice 11
**Survives which gates:** `use-mutation-must-invalidate` sees the `invalidateQueries(["/api/properties"])` call and is satisfied.
**Evidence:** `client/src/pages/properties.tsx` — bulk-delete `:297`, bulk-update-status `:315`, and CSV import `:429` each call `queryClient.invalidateQueries({ queryKey: ["/api/properties"] })` and nothing else.
**What's wrong:** Bulk-deleting or importing hundreds of properties updates the list but leaves `/api/today`, `/api/dashboard/stats`, and `/api/onboarding/checklist-status` stale — even though the single-property hook (`use-properties.ts`) knows to invalidate several of these. The page reimplemented the mutation instead of using the hook, and invalidated a narrower set. CSV import is the day-one bulk-load path, so this is the highest-volume staleness case.
**Impact:** Burns trust after sale; worst on the import path where a new customer loads their book of business and the dashboard/onboarding checklist don't move.
**Fix:** Replace these three inline `invalidateQueries` calls with `invalidateRelated("property", queryClient)` (post F-11-3), or minimally add `/api/today`, `/api/dashboard/stats`, `/api/onboarding/checklist-status`.
**Gate it:** Covered by the extended lint in F-11-1 once it inspects mutations in page files (currently they use `queryClient` directly rather than a hook — the lint already visits any `useMutation` callsite). Baseline: 3 offending callsites in properties.tsx.
**Effort:** S
**Blast radius:** `pages/properties.tsx`.
**Confidence:** high — three callsites pasted.

---

### F-11-5 — `property-map.tsx` statically bundles both mapbox-gl and maplibre-gl; only one runs
**Severity:** P3 minor
**Surfaced by:** slice 11
**Survives which gates:** No bundle-size ratchet exists. `lint:reachability` is server-only.
**Evidence:** `client/src/components/property-map.tsx:2-3` — `import mapboxgl from "mapbox-gl"` **and** `import maplibregl from "maplibre-gl"`, plus both CSS imports (`:24-25`). Runtime picks one via `VITE_MAP_ENGINE` (`:31-40`, default `"mapbox"` per `lib/map-engine.ts:34-39`). Both are top-level static imports, so both full WebGL engines land in the lazy chunk regardless of engine. Both are in `package.json` dependencies (`mapbox-gl`, `maplibre-gl`).
**What's wrong:** Two ~200KB-gzip (~2.4MB raw) map libraries ship in the same chunk though exactly one is ever constructed. In the default (mapbox) config, all of `maplibre-gl` is dead runtime weight; only the CSS/style differences are needed for the toggle.
**Impact:** Neither blocks a sale nor burns trust — it inflates the map chunk (~200KB gzip) on a mobile-first app. Real but low.
**Fix:** Make the alternate engine a dynamic `import()` gated on `VITE_MAP_ENGINE`, or pick one engine and drop the other dependency. If the maplibre path is not actually exercised, remove `maplibre-gl` + its CSS and the `map-engine.ts` toggle entirely (shrink-campaign win).
**Gate it:** A per-chunk size budget in the Vite build (`build.rollupOptions` + a size-limit check in CI). Baseline: measure current property-map chunk kB first. Alternatively a lint forbidding two named map engines imported in one module.
**Effort:** M
**Blast radius:** `property-map.tsx`, `lib/map-engine.ts`, `package.json`, `subdivision-plan-editor.tsx`, `eddm.tsx`.
**Confidence:** medium — the double static import is certain; exact kB impact not measured (would raise to high with a `vite build --report`).

---

## Coverage ledger

**Examined exhaustively:**
- The invalidation contract end-to-end: `lib/query-keys.ts` (all of it), `eslint-rules/use-mutation-must-invalidate.cjs` (all of it), `lib/queryClient.ts` (config/getQueryFn), the create/update/delete mutations in `hooks/use-leads.ts`, `hooks/use-deals.ts`, `hooks/use-properties.ts`, and `pages/today.tsx` query+key definition and its own mutations.
- Registry adoption (grep for every importer / `QK.` / `invalidateRelated` / `/api/today` invalidator across `client/src`).
- Map engine imports across `client/src` (mapbox-gl vs maplibre-gl callsites).

**Examined by sampling:**
- `pages/properties.tsx` (3,450 lines) — mutation + invalidation lines only, not the full render tree.
- `components/property-map.tsx` (3,824 lines) — imports, engine selection, mutation check (has none).
- The ~40 other hooks in `client/src/hooks/` — grepped for `invalidateQueries`/`useMutation`, spot-read the entity ones; did not line-audit each.

**Did NOT examine:**
- `App.tsx` routing tree for dead routes past a manifest — no route-manifest snapshot file exists in the repo to diff against, so dead-route detection would require a from-scratch reachability pass over 226 lazy imports / 306 `<Route>`s; out of scope for medium depth. Flag for a follow-on.
- `components/layout-sidebar.tsx` (2,259 lines) content — nav-doors discipline is slice-owned elsewhere; I only confirmed it is not a mutation surface.
- `pages/maps.tsx` (1,673 lines) render logic.
- Full 126-dependency unused-dep sweep — only the map-engine duplicate was pursued to ground; a `depcheck`-style pass on the other 120 deps was not run.
- Optimistic-update rollback correctness (the `onMutate`/`onError` restore paths in `use-properties.ts:116-140`, `today.tsx:239-259`) — read but not adversarially tested for lost-update races.

## Constitution Collisions

None. F-11-5's fix (drop a map engine) and F-11-3's fix (delete the dead registry or wire it) both *shrink* code, aligning with the halving campaign; neither touches nav doors, money custody, AI destinations, or any hard-stop.
