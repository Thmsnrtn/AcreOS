# Imani Conteh — Bundle Deep-Dive (Wave 2)
**Date:** 2026-05-01
**Scope:** Every byte the browser pays for. Where it's coming from, why it's there, and what to delete.
**Standing on:** Reza's bones audit (8.5MB / 290 chunks / vendor-map 1.6MB / schema 480KB / mammoth flag).

I'm at Cloudflare scale. I've shipped Workers where 1KB extra meant a measurable p99 hit. I've watched Vercel customers ship Drizzle to the browser by accident, and it's almost always the same shape. Reza was right that the schema chunk was the smell. He was generous about why. The truth is worse — and the fixes are concrete.

---

## 1. Verdict (one line)

The browser is downloading the **server ORM and 26 zod locales** every time someone logs in; killing that one mistake reclaims ~470KB gzipped before any other change.

---

## 2. Top-15 chunks by size (raw, not gzipped)

Source: `dist/public/assets/*.js`. First-paint = loaded by the entry HTML or static-imported from the entry. Deferred = behind a `React.lazy()` or a route boundary.

| # | Chunk | Size | First-paint? | Contains |
|---|---|---:|:--:|---|
| 1 | `vendor-map-Cb93B-Ox.js` | **1,703 KB** | NO (route /maps, /properties via dynamic) | `mapbox-gl` 3.20 — full WebGL renderer, vector-tile parser, draw, geocoder hooks |
| 2 | `index-D183Bp82.js` | **602 KB** | YES (entry) | App.tsx, router, queryClient, Sentry init, all eager-imported components, all 23 lucide icons in `founder-dashboard` (transitively if not split — see §5), `@shared/schema` runtime values (insertX, ACTIVITY_EVENT_TYPES) |
| 3 | `schema-DV1vCZAN.js` | **489 KB** | YES (eagerly imported by ~9 client modules with non-type imports) | **Drizzle ORM runtime** + `drizzle-zod` + `zod` + zod-mini + 25 zod locales (`Xt`, `Ks`, `Bs`, `Js`, `jc`, `t_`, `a_`...) — see §3 |
| 4 | `vendor-charts-BSIVO73l.js` | **434 KB** | NO (lazy-pulled by any page importing recharts) | `recharts` 3.8 — d3-scale, d3-shape, d3-array, d3-time, recharts internals; one monolithic chunk for ALL 16+ chart-using pages |
| 5 | `founder-dashboard-DvvylRG5.js` | **421 KB** | NO (lazy route) | Founder dashboard page + every panel component (PaxPulse, MRRTrajectory, ChurnIntelligence, GrowthEngine, AnomalyAlerts, JobQueueHealth, DecisionsInbox, NextBestActions, ThePulse, BusinessIntelligence, PlatformPassiveScore, PredictiveInsights, TasksDueWidget) merged into one route chunk |
| 6 | `vendor-pdf-D9qGPKOB.js` | **387 KB** | NO (used only by /borrower-portal) | `jspdf` 4.2 — Adler32, deflate, font munging, all 14 stdlib fonts |
| 7 | `settings-C_9Jirbz.js` | **228 KB** | NO (lazy /settings) | settings page + `integrations-settings.tsx` (the lone `react-icons` import lives here) |
| 8 | `vendor-clerk-DiCNwVIv.js` | **219 KB** | YES on auth routes | `@clerk/react` 6.1 — full SDK including UI primitives even though we use Clerk Elements selectively |
| 9 | `html2canvas.esm-DXEQVQnt.js` | **201 KB** | NO (transitive of jspdf, only loads when /borrower-portal opens) | DOM-to-canvas rasterizer pulled in by jspdf for image embedding |
| 10 | `properties-DLubEIkB.js` | **189 KB** | NO (lazy /properties route) | properties page + child panels; **statically imports `property-map`** so the 1.7MB map chunk is hot-tied to /properties as well as /maps |
| 11 | `vendor-ui-Apjm0kUT.js` | **159 KB** | YES | 12 of 28 used Radix surfaces (the dozen listed in vite.config). The other **16 Radix packages** (alert-dialog, avatar, collapsible, context-menu, hover-card, label, menubar, navigation-menu, progress, radio-group, separator, slot, toggle, toggle-group, visually-hidden, aspect-ratio) leak into route chunks individually, duplicating React-context plumbing |
| 12 | `index.es-Ba0qLk51.js` | **159 KB** | NO | Looks like a jspdf-related ES module (font registration / unicode tables) — orphan, no source-map name |
| 13 | `vendor-motion-B-IyVtMF.js` | **127 KB** | YES (52 client files import framer-motion; many eagerly via shell components like `PageTopbar`, `PaxPulse`) | `framer-motion` 12.38 — full motion + AnimatePresence + LazyMotion not used (see §4) |
| 14 | `campaigns-jQnfGame.js` | **120 KB** | NO (lazy /campaigns) | campaigns page + ab-test-manager + sequence-builder, three large surfaces glued |
| 15 | `schemas-BpCwBYBn.js` | **110 KB** | YES (entry, separate from #3) | A SECOND schema chunk — likely zod-only validators duplicated from `@shared/schema` (insertX schemas re-imported as runtime values from pages/leads.tsx, pages/deals.tsx, pages/properties.tsx, pages/finance.tsx, pages/counties.tsx, components/campaigns-content.tsx, components/workflow-builder.tsx). Drizzle is in #3, the standalone Zod copy is here |

**First-paint waterline (what loads BEFORE any user action):**
`index` (602KB) + `schema` (489KB) + `schemas` (110KB) + `vendor-ui` (159KB) + `vendor-react` (42KB) + `vendor-motion` (127KB) + `vendor-clerk` (219KB on auth) + `index-DylaTHkH.css` (266KB) ≈ **2.0MB raw / ~580KB gzipped**.

That's the cold-cache cost on first visit. The Lighthouse mobile budget (≤500KB JS gzipped on 3G) is busted by 16%, almost entirely because of #3.

---

## 3. The schema-leak diagnosis — confirmed, and worse than Reza estimated

`shared/schema.ts` is 15,387 lines. Line 1:

```ts
import { pgTable, text, serial, integer, boolean, timestamp, numeric, varchar, jsonb, ... } from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
```

This is the canonical server schema — **700 occurrences of `pgTable` / `createInsertSchema` / `drizzle:*`**. The file is meant for the server only.

Now look at what the client imports as **values** (not type-only):

```
client/src/components/activity-feed.tsx:26:        import { ACTIVITY_EVENT_TYPES }  from "@shared/schema";
client/src/components/activity-timeline.tsx:29:    import { ACTIVITY_EVENT_TYPES }  from "@shared/schema";
client/src/components/workflow-builder.tsx:38:    import { ... }                    from "@shared/schema";
client/src/components/campaigns-content.tsx:10:   import { insertCampaignSchema, ...} from "@shared/schema";
client/src/pages/deals.tsx:34:                    import { insertDealSchema, ... }   from "@shared/schema";
client/src/pages/properties.tsx:19:               import { insertPropertySchema, ... } from "@shared/schema";
client/src/pages/counties.tsx:7:                  import { ..., insertTargetCountySchema } from "@shared/schema";
client/src/pages/leads.tsx:21:                    import { insertLeadSchema, ... }   from "@shared/schema";
client/src/pages/finance.tsx:11:                  import { insertNoteSchema, ... }   from "@shared/schema";
```

Each of these is a **runtime value import**. Tree-shaking does not save us, because `shared/schema.ts` has top-level `pgTable(...)` and `createInsertSchema(...)` calls — those side-effects pull the entire Drizzle entity-class machinery into whatever chunk references the file. I confirmed by `strings`-ing `schema-DV1vCZAN.js`:

```
Symbol.for("drizzle:entityKind")
Symbol.for("drizzle:isPgEnum")
Symbol.for("drizzle:Schema")
Symbol.for("drizzle:Columns")
Symbol.for("drizzle:IsDrizzleTable")
Symbol.for("drizzle:IsDrizzleView")
class fp extends P { static[$]="PgJsonBuilder" }
class Np extends P { static[$]="PgJsonbBuilder" }
```

**The browser is shipping `pg-core`. That is server-only code. The Postgres column-type builder classes are running in the user's React app for no reason.**

It also ships **25 zod locale dictionaries** (`Xt:en, Ks:de, Bs:es, Js:fr, t_:zhCN, a_:zhTW, jc:ru, ...`) — zod 4.x lazy-locales would let us ship `en` only. We ship them all because `drizzle-zod`'s entry point eagerly references the zod locale registry.

**Verdict:** YES, server schemas are leaking to the client. ~470KB raw, ~110KB gzipped, on every page. This is the single biggest single-fix shed in the bundle.

**Fix (3-step, ~3h):**
1. Split `shared/schema.ts` into:
   - `shared/schema/db.ts` — pgTable/relations/sql, server-only.
   - `shared/schema/types.ts` — pure TS types (`Property`, `Lead`, `Deal`, `User`, etc.) inferred via `InferSelectModel<typeof leads>` re-exported as bare types only.
   - `shared/schema/forms.ts` — hand-written zod schemas for client form validation (`insertLeadSchema`, etc.), NOT generated from drizzle-zod.
2. Update the 9 client imports above to pull from `@shared/schema/forms` and `@shared/schema/types`.
3. Verify the resulting `schema-*.js` chunk is empty or under 30KB; the new `forms` chunk should be ~40KB (zod core + ~25 small schemas).

**Expected shed:** 489KB → ~50KB. Net **−440KB raw, −100KB gzipped first-paint.**

---

## 4. Per-vendor analysis

### 4a. Mapbox (1,703KB raw / ~470KB gzipped)

`property-map.tsx` line 2: `import mapboxgl from "mapbox-gl"`. Static. The route chunks `properties` and `maps` both statically import `<PropertyMap>`, so once a user hits /properties, mapbox is hot. The vite manualChunk DOES split it into `vendor-map`, but it doesn't make it lazy.

**Consumers:** /maps (intentional), /properties (split-view + single-property modal + static fallback), and that's it. 95% of the customer surface (today, pipeline, money, deals, finance, leads, campaigns, settings) doesn't need it.

**Fix:** wrap the three exports of `property-map.tsx` (`PropertyMap`, `SinglePropertyMap`, `StaticPropertyMap`) in a `React.lazy()` boundary at the page level, and don't `import` from `@/components/property-map` at the top of `properties.tsx` — instead lazy it. Suspense fallback: a 480x320 skeleton matching the map aspect.

**Expected shed:** /properties first-paint drops from ~190KB to ~10KB; mapbox only downloads when the user clicks the map tab. Net **−180KB raw on /properties cold load.**

Optional: replace `mapbox-gl` with `maplibre-gl` (fork, MIT, ~1.4MB). Not worth it — Mapbox tile cost is what it is, the split is the win.

### 4b. Recharts (434KB raw / ~120KB gzipped)

16 pages import `from "recharts"` at module top level. With `vendor-charts: ['recharts']` in manualChunks, they share one chunk (good). But recharts 3.x ships every chart type — BarChart, LineChart, AreaChart, PieChart, RadarChart, ScatterChart, ComposedChart, FunnelChart, Treemap, Sankey, RadialBar — even if a page only uses `<BarChart>`.

We use:
- BarChart (8 surfaces)
- AreaChart (5 surfaces, including `stat-card.tsx` which is everywhere)
- LineChart (3 surfaces)
- PieChart (1 surface, dashboard.tsx)
- ResponsiveContainer (universal)

Splitting by chart type with custom `manualChunks` doesn't actually save much because recharts internally shares CartesianAxis/scale/shape across chart types. The realistic win:

**Fix:** Replace `<AreaChart>` in `stat-card.tsx` (the universal sparkline) with a **15-line inline SVG sparkline** drawing a path from points. `stat-card` is rendered ~12 times on the founder dashboard alone. Right now it pulls recharts onto pages that wouldn't otherwise need it. That single change demotes recharts from "pulled by founder-dashboard" to "pulled by analytics-only routes."

**Expected shed:** Founder-dashboard route chunk drops by ~50KB; recharts becomes pure on-demand for /analytics, /forecasting, /freedom-meter, /founder-trends. Net **−50KB on first-paint of the most-visited route.**

### 4c. Framer-motion (127KB raw / ~40KB gzipped)

52 files import `framer-motion`. Many are page-level shells (PageTopbar, PaxCopilotRail) that the user sees on every paint. The current vendor-motion split is correct — but framer-motion offers **`LazyMotion` + `domAnimation`** which lets you import a stripped 4.6KB core and load the full feature set on demand.

**Fix:**
```tsx
// client/src/lib/motion.tsx
import { LazyMotion, domAnimation, m } from "framer-motion";
export const MotionRoot = ({ children }) => (
  <LazyMotion features={domAnimation} strict>{children}</LazyMotion>
);
export { m as motion };
```

Then codemod `import { motion } from "framer-motion"` → `import { motion } from "@/lib/motion"` everywhere.

**Expected shed:** vendor-motion 127KB → ~20KB on first paint, full features lazy-loaded after hydration. Net **−100KB raw first-paint.**

### 4d. Lucide-react (transitive, not its own chunk)

283 imports across the client. **No `import * as Icons` patterns** — every site does named imports like `import { ChevronRight, Sparkles } from "lucide-react"`. Tree-shaking works.

But: lucide-react 1.7 (the version in package.json) is **suspicious** — current upstream is `0.4xx.x`. Either this is a pin to an internal fork or a typo. `^1.7.0` does not match any published version of `lucide-react` on npm. Verify with `npm ls lucide-react`. If it's resolving to something exotic, ESM tree-shaking might silently fail and we'd be shipping the entire icon set.

**Action:** verify the resolved version and the chunk graph. If lucide is being inlined into `index.js`, ~80KB is hiding there.

### 4e. Date libs

Only `date-fns` (47 imports). No moment, no dayjs, no luxon. Clean. The `vendor-date` manual chunk is correct. **No action.**

### 4f. Form libs

Only `react-hook-form` (14 imports) + `zod` (14 imports, plus the leaked drizzle-zod copy). No formik, no react-final-form. Clean once §3 is fixed.

### 4g. Clerk (219KB raw / ~70KB gzipped)

`@clerk/react` 6.1 is the full SDK. We use Clerk Elements for sign-in/sign-up, plus `useUser`/`useOrganization`. The bigger SDK pulls UI primitives (UserButton, UserProfile, OrganizationSwitcher) we don't render. There's a leaner `@clerk/clerk-react` core path.

**Action:** confirm we actually need `@clerk/react` (the React-Router-aware build) vs `@clerk/clerk-react` (framework-agnostic). Wouter is our router; Clerk's React-Router integration is dead weight. Switching to `@clerk/clerk-react` typically sheds 60-90KB.

---

## 5. Tree-shaking gaps

I grep'd for `import * as` across the client. Findings:

| Pattern | Count | Risk |
|---|---:|---|
| `import * as React from "react"` | many | Standard. React's ESM build has the side-effect-free flag; tree-shaken correctly. **No action.** |
| `import * as <Primitive>Primitive from "@radix-ui/react-*"` | 16 | Standard shadcn pattern. Radix packages ARE side-effect-free; tree-shakes. **No action.** |
| `import * as RechartsPrimitive from "recharts"` in `client/src/components/ui/chart.tsx` | 1 | **Real risk.** Recharts has historically been side-effecty. This namespace import in `ui/chart.tsx` (the shadcn chart wrapper) likely defeats tree-shaking inside this file, dragging unused chart types into anything that imports `<ChartContainer>`. |

**Action on the recharts namespace import:** rewrite `ui/chart.tsx` to import only the `<ResponsiveContainer>`, `<Tooltip>`, `<Legend>` primitives it actually re-exports as its public surface, plus accept `children` so callers bring their own `<BarChart>` etc.

No `import * as Icons from "lucide-react"`. No `import * as _ from "lodash"` (no lodash at all — good). No `import * as moment` (no moment — good).

---

## 6. Removable libraries (concrete shed)

| Library | Why | Shed (install / runtime) | Effort |
|---|---|---|---|
| `react-icons` | One file, two icons (`SiSendgrid`, `SiTwilio`) — both available as inline SVGs from upstream brand kits, and the file is `integrations-settings.tsx` (lazy-only). | ~5MB install, ~12KB runtime | 30 min |
| `mammoth` (move out of root deps?) | Confirmed: `import mammoth from "mammoth"` exists ONLY in `server/ai/executive.ts`. **Does not ship to client** (correct). But it IS in the top-level `dependencies` array. Server bundles via `tsx`/`esbuild` should be fine; if Vite ever picks it up via a misrouted import we'd ship 700KB. | 0 runtime today, but a landmine. | Move-only check: confirm no client import path can accidentally `import "mammoth"`. |
| `vite-plugin-pwa` + `workbox-window` | Reza's flag stands. Installed, not wired. | ~500KB install | 15 min (delete from package.json) |
| `@types/*` in `dependencies` | Reza: 5 entries. Pure cosmetic, no runtime cost, but cleaner deps tree. | 0 runtime | 15 min |
| `@jridgewell/trace-mapping` | Top-level pin, normally transitive. | 0 runtime | 5 min |
| `react-is@19.2.5` while `react@18.3.1` | Peer-dep risk. May be transitive of recharts; unpin. | 0 runtime | 10 min |

**Conditional removals (need runtime audit):**

- `html2canvas` — pulled transitively by `jspdf`. Only used in `borrower-portal.tsx` which is its own lazy route. The chunk (#9, 201KB) is correctly deferred. **No action** (chunk is deferred), but if you ever tree-shake jspdf to drop image-embedding, html2canvas falls out automatically.

---

## 7. The 1-week bundle sprint — measurable kg-shed targets

Targets are **raw bytes, first-paint route only** (`/today` for an authenticated user). Currently ~2.0MB raw / 580KB gzipped.

| Day | Task | Owner | Expected shed (raw / gzipped) | Verify |
|---|---|---|---|---|
| **Mon** | Split `shared/schema.ts` into `db.ts` + `types.ts` + `forms.ts`. Re-route 9 client value-imports to `forms.ts`. | Backend + frontend duo | **−440KB / −100KB** | `dist/public/assets/schema-*.js` < 30KB |
| **Tue AM** | Lazy-wrap `<PropertyMap>` consumers in `properties.tsx` and `maps.tsx`. Use Suspense + map-skeleton fallback. | Frontend | −180KB on /properties cold (not first-paint, but properties is high-traffic) | Network tab: vendor-map only loads after map tab click |
| **Tue PM** | Replace recharts `<AreaChart>` in `stat-card.tsx` with inline SVG sparkline. | Frontend | −50KB on founder-dashboard | `vendor-charts` no longer in founder-dashboard waterfall |
| **Wed AM** | Add `client/src/lib/motion.tsx` LazyMotion shim. Codemod 52 framer-motion call sites. | Frontend | **−100KB / −25KB** first-paint | `vendor-motion` ≤ 25KB |
| **Wed PM** | Audit Clerk: switch from `@clerk/react` to `@clerk/clerk-react` (we use wouter, not RR). | Auth-aware engineer | **−70KB / −20KB** on auth routes | `vendor-clerk` ≤ 150KB |
| **Thu AM** | Rewrite `client/src/components/ui/chart.tsx` to drop `import * as RechartsPrimitive`. | Frontend | −10–30KB depending on which chart types currently leak | `vendor-charts` reduces or stays equal but no longer drags into surfaces using `<ChartContainer>` for layout-only |
| **Thu PM** | Drop `react-icons`. Inline two SVGs in `integrations-settings.tsx`. | Frontend | −5MB install, −12KB runtime on /settings | `npm ls` shows no `react-icons` |
| **Thu PM** | Move `@types/*`, `@capacitor/cli`, `@tailwindcss/postcss` to devDependencies. Drop `vite-plugin-pwa` + `workbox-window` (PWA is hand-rolled). Unpin `react-is`. | Anyone | 0 runtime, ~6MB install, cleaner peer deps | `npm ls` clean |
| **Fri AM** | Wire `npm run test:bundle-size` into `ci.yml`. Set the budget for entry+vendor first-paint at **≤ 1.0MB raw / ≤ 300KB gzipped** so future drift is caught. | DevOps | Drift ratchet | CI fails on regression |
| **Fri PM** | Verify in production build. Run Lighthouse on Fly preview. Capture before/after waterfall. | Anyone | Confirms shed | Lighthouse Performance ≥ 85 mobile |

### Aggregate first-paint shed

| Lever | Raw | Gzipped |
|---|---:|---:|
| Schema leak fix | −440KB | −100KB |
| Framer LazyMotion | −100KB | −25KB |
| Clerk core swap | −70KB | −20KB |
| Recharts off stat-card | −50KB | −12KB |
| ChartContainer namespace fix | −20KB | −5KB |
| **Total first-paint shed** | **−680KB** | **−162KB** |

Plus deferred-route shed (mapbox lazy-on-properties, react-icons drop) and ~5MB install reduction.

**Net first-paint after sprint:** ~1.3MB raw / ~420KB gzipped — comfortably inside Lighthouse mobile budget, with headroom for next quarter's features.

---

## 8. What I'm NOT recommending (and why)

- **Don't migrate off recharts to visx/uplot.** Migration cost dwarfs the shed. The recharts chunk is 434KB but it's deferred behind analytics routes; only stat-card pulls it onto hot paths and that's a 1-component fix.
- **Don't migrate off mapbox to maplibre.** API surface drift, tile cost is the real cost. The lazy-load fix gets us 95% of the win.
- **Don't replace framer-motion wholesale.** LazyMotion is the right tool; rewrites are a tar pit.
- **Don't manually code-split @radix-ui packages.** Radix is correctly tree-shaking; the 16-package leak into route chunks is by design (each route gets its primitives) and total Radix weight is < 80KB.

---

## 9. The one rule I want adopted

> **No runtime imports from `@shared/schema`. Type-only imports only. Form validators live in `@shared/forms`.**

Add an eslint rule: `no-restricted-imports` blocking `@shared/schema` for value imports. The next time someone writes `import { insertLeadSchema } from "@shared/schema"` the build fails and they're forced into the right path.

That single rule, enforced in CI, prevents this regression from ever recurring. Everything else in this report is one-time work.

— Imani
