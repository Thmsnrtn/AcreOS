# Renske Vermeer — CSS as a Product

**Date:** 2026-05-01
**Scope:** `client/src/index.css` (1,619 lines) + the 4 satellite CSS files + JSX class-usage reality check
**Out of scope:** Tailwind config token surface (covered by Reza's bones audit), runtime theme switcher logic
**Approach:** Treat the stylesheet as a TypeScript module — does every export get imported, are types consistent across overloads, is there dead code?

---

## 1. One-line verdict

The token *system* is exemplary — 32 `--acr-*` tokens defined identically across all 10 theme×mode blocks, zero drift — but the rest of the file leaks: 4 chart tokens that nothing reads, ~16 declared classes nothing renders, three parallel color systems that never met, and 1,844 Tailwind color literals in JSX that quietly bypass every theme you so carefully built.

---

## 2. Theme-token completeness matrix

I diffed token names across all 10 blocks. Result: **perfectly consistent**. Every theme×mode block declares the same 32 `--acr-*` tokens plus the same 27 shadcn HSL parallels. No drift, no missing accents, no copy-paste skips. This is the strongest part of the file.

### 2a. The 32-token surface (per block, ×10 blocks)

| Family | Tokens | Notes |
|---|---|---|
| Surface | `bg`, `bg-sunken`, `bg-raised`, `surface`, `surface-2`, `sidebar-bg` | Six layers — generous; verify all six earn it |
| Ink | `ink`, `ink-2`, `ink-3`, `ink-4`, `sidebar-ink` | Five-rung text scale, clean |
| Lines | `line`, `line-soft` | Two — appropriate |
| Brand/state | `brand`, `brand-ink`, `brand-soft`, `accent`, `pos`, `pos-soft`, `warn`, `warn-soft`, `neg`, `neg-soft`, `glow` | 11 — complete |
| Effects | `shadow-1/2/3`, `ring` | 4 |
| Charts | `chart-a/b/c/d` | 4 — **defined in all 10 blocks, used in zero places** (see §6) |

### 2b. What's missing from the matrix

These tokens are *declared* in every block but referenced **inconsistently or not at all** by the CSS rules below them:

| Token | Defined in | Referenced in CSS | Issue |
|---|---|---|---|
| `--acr-chart-a/b/c/d` | 10 | 0 | Pure dead weight — see §6 |
| `--acr-ring` | 10 | 0 | `*:focus-visible` (line 998) uses Tailwind `ring-primary/40`; nav-active and the second focus rule (1346) use raw `hsl(var(--primary)/0.5)`. The carefully-tuned per-theme ring goes nowhere. |
| `--acr-glow` | 10 | 0 | Designed to be a brand specular highlight; never used |
| `--acr-line-soft` | 10 | 0 | Defined but no rule consumes it (everything uses `--acr-line`) |
| `--acr-ink-3`, `--acr-ink-4` | 10 | 0 in CSS | Maybe used inline; 0 occurrences in `index.css`. The text-ramp gradation collapses to 2 rungs in practice. |
| `--acr-surface-2` | 10 | 1 (`.desert-gradient`) | Five other surface tokens defined; `surface-2` only ever surfaces in one place |

### 2c. Tokens that should exist but don't

What you *don't* have a token for, but reference repeatedly with literals in CSS rules:

- **Focus-ring offset color** — `0 0 0 2px hsl(var(--background)), 0 0 0 4px hsl(var(--primary)/0.5)` at line 1354 hardcodes the ring composition; should be `--acr-ring-shadow`.
- **Backdrop scrim** — `command-backdrop` uses literal `rgba(241, 233, 214, 0.60)` which is **homestead-bg-sunken hardcoded**. Quarry/Nocturne/Meadow/Slate all get the same warm beige scrim that doesn't match their palette.
- **Sidebar vibrancy bg** — line 1114 `rgba(245, 240, 233, 0.82)` and line 1118 `rgba(22, 16, 10, 0.86)` are both literal hex values; same problem — homestead-only.
- **Vibrancy-sidebar** at line 964 — same disease, literal `rgba(241, 231, 208, 0.82)`.
- **Glass tints** (`--glass-bg-light/sm/subtle`) — defined globally, NOT per-theme. Glass panels in nocturne and slate render with homestead's warm haze, which is wrong.
- **Agent-identity tones** — Sophie/Forge/Atlas/Pax need 4 distinct chip tints; no tokens exist. Per the persona-architecture memory, the founder cluster sees these constantly.
- **Inset-input shadow** — `rgba(0,0,0,0.06)` and `rgba(0,0,0,0.2)` literals on lines 1063/1066. Should be `--acr-shadow-inset` per-mode.

---

## 3. @apply audit — 25 occurrences

Of the 25 `@apply` clusters, by my count **8 earn it, 12 are duplicating Tailwind without aggregating, and 5 are wrong-layer**.

### 3a. Earned `@apply` (keep)

| Line | Class | Why it earns |
|---|---|---|
| 805 | `* { @apply border-border }` | Tailwind base reset — canonical |
| 815 | `body` | Root cascade, font-family must be set imperatively next to `@apply bg-background text-foreground` |
| 988 | `.skip-to-content` | Aggregating 8 utilities into a semantic name; unambiguous win |
| 998 | `*:focus-visible` | Global focus declaration — needs imperative `outline-none` to avoid 1000-deep specificity wars |
| 1058 | `.pill-button` | Dense aggregation (5 utilities); semantically named — earns its keep, even though zero JSX usages today (§4) |
| 944 | `.floating-window` | Single-line, but composed with `box-shadow: var(--shadow-3)` which can't be a utility |
| 953 | `.card-hover:hover { @apply shadow-lg }` | Composed with a `transform` rule — needs CSS scope |
| 998 | focus ring | Same: wraps `outline-none` + ring composition |

### 3b. Cosmetic `@apply` (replace with utility-only)

These are single-utility wrappers with nothing else in the rule:

| Line | Rule | Problem |
|---|---|---|
| 837 | `::-webkit-scrollbar-track { @apply bg-transparent }` | `background: transparent` is shorter and avoids a layer hop |
| 1022 | `.hover-elevate:hover { @apply bg-foreground/5 }` | Single utility; declaring twice (light + dark) where dark uses raw `hsl()` is internally inconsistent |
| 1032 | `.active-elevate-2:active { @apply bg-foreground/10; transform: scale(0.98); }` | The `@apply` line could just be `background: hsl(var(--foreground)/0.10)` for consistency with the next line |
| 1041 | `.toggle-elevated { @apply bg-primary/10 }` | Single utility |
| 1044 | `.dark .toggle-elevated { @apply bg-primary/15 }` | Single utility |
| 1049 | `.no-default-hover-elevate:hover { @apply bg-transparent }` | Single utility |
| 1053 | `.no-default-active-elevate:active { @apply bg-transparent }` | Single utility |
| 1003 | `.page-transition { @apply transition-opacity duration-200 ease-out }` | Could be a Tailwind plugin component or a utility class on the consumer; class is unused (§4) |
| 1167, 1019, 1029, 1038, 1311, 1177 | various `@apply transition-*` | Six rules each compose 1–3 transition utilities; consider extracting a `transition-elev` Tailwind utility instead |

### 3c. Wrong-layer `@apply` (move into `@layer components`)

The base/utilities layer split is mostly fine but several component-shaped rules (`.pill-button`, `.card-hover`, `.btn-press`, `.skip-to-content`) live outside any `@layer` block. That makes them un-overridable by Tailwind's utility layer. **Wrap the components-shaped block in `@layer components { ... }`** — currently only `@layer base` is used (line 803).

---

## 4. Dead-CSS report — declared but unused

I cross-referenced every named class in `index.css` against `client/src/**/*.{tsx,ts,jsx,html}`. The following rules target classes that **appear zero times in JSX**:

| Class | Lines | Usages | Verdict |
|---|---|---|---|
| `.content-spring` | 1161 | 0 | Dead — sidebar collapse pair; only `.sidebar-spring` is wired |
| `.btn-press` + `:active` | 1175 | 0 | Dead — micro-interaction never adopted |
| `.sub-items-reveal` | 1262 | 0 | Dead keyframe — collapsible nav uses framer-motion instead |
| `.table-row-hover` | 1310, 1316 | 0 | Dead — DataTable variants use shadcn table classes |
| `.badge-pulse` | 1325 | 0 | Dead — `notification-dot::after` references the keyframe internally, but the class itself never appears |
| `.notification-dot` | 1330 | 0 | Dead |
| `.data-label`, `.data-value` | 1359, 1366 | 0 | Dead — components inline `text-xs uppercase tracking-wide text-muted-foreground` repeatedly instead |
| `.metric-card-gradient-1/2` | 1374, 1377 | 0 | Dead — metric cards use solid surfaces |
| `.sidebar-toggle-btn` | 1382 | 0 | Dead |
| `.scroll-fade*` (4 variants) | 1459–1473 | 0 | Dead — masked-fade utility never adopted; bare `overflow-y-auto` everywhere |
| `.toggle-elevate` | 1037 | 0 | Dead (toggle-*elevated* is also 0) |
| `.no-default-active-elevate` | 1051 | 0 | Dead |
| `.touch-target` | 1100 | 0 | Dead — touch-target sizing is inlined as `min-h-[44px]` |
| `.page-transition` | 1002 | 0 | Dead |
| `.pill-button` | 1057 | 0 | Dead — declared "macOS-style" sugar that never got picked up |
| `.heading-display`, `.heading-section`, `.caption-label` | 938–940 | 0 | Dead — typography sugar; components compose Tailwind directly instead |
| `.elevation-1`, `.elevation-3`, `.elevation-4`, `.capsule` | 931–935 | 0 each | Dead — only `.elevation-2` has 2 usages |
| `.animate-in` | 971 | 21 | **Confusion bomb** — Tailwind also ships an `animate-in` utility (`tailwindcss-animate`); the index.css definition shadows it. Two animations wear the same class name |

**Tally: ~21 named classes (≈90 lines of CSS) targeting classes nothing consumes.**

The Tailwind purge (`content: ["./client/index.html","./client/src/**/*.{js,jsx,ts,tsx}"]`) cannot purge these because they're in the source CSS, not generated utilities. They have to be deleted by hand. The fact that `tsx` files reference `.glass-panel` 81 times and `.notification-dot` 0 times is exactly the signal you need — but no tooling surfaces it.

### 4a. The `animate-in` collision

Line 971 defines `.animate-in` with a custom `fadeSlideIn` keyframe. `tailwindcss-animate` (which shadcn ships) defines `.animate-in` with its own enter-animation system. **21 `animate-in` usages in JSX are now ambiguous** — which CSS wins depends on layer order and source order, not author intent. Rename the custom one to `.acr-animate-in` or delete it (the tailwindcss-animate version is more flexible).

---

## 5. Three-system reconciliation: --acr-* vs HSL --foreground vs shadcn

You have three coexisting color systems:

1. **`--acr-*` hex tokens** — 32 per theme, lifted from prototype
2. **shadcn HSL tokens** — 27 per theme (`--background`, `--foreground`, `--primary`, etc.) declared as `H S% L%` triplets, consumed via `hsl(var(--token))`
3. **Tailwind color literals** — `text-red-500`, `bg-amber-100`, etc. — **1,844 occurrences in JSX**

These are not reconciled. They drift in three ways:

### 5a. Dual sources of truth, no test enforces parity

`--acr-brand: #C2531C` (homestead light) and `--primary: 20 74.8% 43.5%` (homestead light) are *manually* kept in sync via the comment "HSL parallel — keep in sync with `--acr-*` above." There is **no test, no script, no codemod** that enforces parity. If a designer tweaks `--acr-brand` in slate-dark, `--primary` quietly drifts and Tailwind utilities (`bg-primary`) will diverge from `var(--acr-brand)` references. Across 10 blocks and ~30 token pairs, that's 300 drift opportunities.

**Fix:** generate the HSL block from the hex block via a build step. `culori` or `chroma-js` can do it. Source of truth = the hex; the HSL becomes derived.

### 5b. Components pick a system at random

A spot check across `client/src/components`:

- `Card` / `Button` (shadcn-derived) → `bg-card`, `text-foreground` (HSL system) ✓
- `MetricStat`, custom dashboards → `bg-[var(--acr-surface)]` or inline `style={{background:"var(--acr-pos)"}}` (acr system) ✓
- Charts, status pills, alert chips → **`#22c55e`, `#ef4444`, `#3b82f6` literals** in JSX (zero theme awareness)
- `text-amber-600`, `bg-rose-50` etc. — 1,844 hits; Tailwind palette literals that don't migrate when the user picks Nocturne

The third bucket is the worst because it's invisible. The user switches to Nocturne and 60% of the chrome reskins; status badges, chart bars, and severity pills stay the same Tailwind beige-amber-rose they were in Homestead. The five-theme system exists in a parallel universe from the actual rendered UI for those surfaces.

### 5c. Recommended unification

Three layers, top to bottom:

1. **Hex source (`--acr-*`)** — designer-edited, 32 tokens × 10 blocks. Authoritative.
2. **HSL derived (`--background` etc.)** — generated at build by `scripts/derive-shadcn-hsl.mjs`, committed; CI fails if hand-edited and out of sync with hex.
3. **Tailwind palette (`text-amber-600`)** — banned in `client/src` via an ESLint rule (`no-restricted-syntax` matching color-literal classes), allowlist a handful of *neutral* greys for legacy use, force everything else to the token system.

Then collapse the chart literals to `var(--acr-chart-a/b/c/d)` (see §6).

---

## 6. The chart-token gap (the biggest live bug)

You have `--acr-chart-a/b/c/d` defined in **all 10 theme×mode blocks** with carefully chosen values:
- Homestead-light: brand orange, teal, ochre, forest green
- Nocturne: cooler blues
- etc.

**JSX usages of `--acr-chart-*`: 0.**
**Hardcoded `fill="#xxxxxx"` in JSX: 43.**
**Hardcoded `stroke="#xxxxxx"` in JSX: 50.**

Top hex literals: `#ef4444` (×6), `#d97541` (×6), `#6366f1` (×5), `#10b981` (×5), `#22c55e` (×4), `#f59e0b` (×3). None of these are theme-aware. Charts in `portfolio-pnl.tsx`, dashboard widgets, score gauges, agent-status spark-lines all render identical colors regardless of theme.

**The fix** is small and high-leverage:

1. Add `client/src/lib/chartColors.ts` reading computed style of `:root` for the four chart tokens (and re-reading on theme change via a tiny store).
2. Codemod: replace every `fill="#10b981"` etc. with `fill={chartColors.pos}` etc.
3. Add an eslint rule (`no-restricted-syntax` on `Literal[value=/^#[0-9A-Fa-f]{3,8}$/]` inside JSX attributes) to prevent regression.

Effort: ~6 hours. Payoff: 5 themes that *actually* re-skin charts.

---

## 7. Print-styles gap

The print block at lines 1563–1618 is **decent and functional**:
- Hides nav, sidebar, command palette, mobile bottom-nav, buttons, action links ✓
- Strips `box-shadow`, `text-shadow`, `background-image` (toner-friendly) ✓
- Expands `max-w-prose`/`max-w-2xl`/`max-w-3xl`/`max-w-4xl` to full width ✓
- Adds URL after links (`a[href^="http"]::after`) ✓
- Page-break-after on h1/h2/h3, orphans/widows protection ✓
- 0.75in margin via `@page` ✓

**However:** only **1 file** in the entire app (`portfolio-pnl.tsx` per my search of `window.print()`) actually triggers print. The print stylesheet is well-designed but used by exactly one surface.

### What would benefit from print-friendly rendering

| Surface | Why it should print well | Status |
|---|---|---|
| **P&L report** | Owners present these to accountants/CPAs, banks | Has `window.print()`; verify chart colors print legibly without `background-image` (chart bars rely on fill) |
| **Signed contracts (native e-sign output)** | Per memory, AcreOS ships its own e-sign — buyers, lenders, county recorders need printable PDFs *and* "print this confirmation page" affordances | No print path — currently rendered to PDF via jsPDF; HTML print would be a fallback |
| **Letters of intent, lender packages** | Lenders print these | No print path |
| **Monthly portfolio narrative** | Owners send PDFs to investors | No print path |
| **Parcel detail (`/parcels/:id`)** | Buyers and surveyors print property profiles in the field | No `data-print-hide` on map components — printing this page would render a blank tile area where the mapbox canvas would be |
| **Lead profile + activity timeline** | Used in litigation packets, lender exhibits | No print path |

### Print-system gaps even in the current block

- **No `font-family` override for print** — defaults inherit `var(--font-sans)`. P&L statements in particular read better in a serif body. Add `body { font-family: 'Times New Roman', Georgia, serif; }` inside `@media print` or expose `--font-print`.
- **No `<header>` / `<footer>` per page** — using `position: fixed` headers with the org name + report title + date + page X of Y. Trivial CSS, huge legitimacy bump on contracts.
- **No table-print refinement** — `tr { page-break-inside: avoid; }` and `thead { display: table-header-group; }` so multi-page tables repeat headers. Critical for P&L line items.
- **Map components / canvas elements** — no rule like `canvas, .mapboxgl-map { display: none !important; } .map-print-fallback { display: block !important; }` to swap a canvas for a printable static image when present.
- **Color-marked chart series** — when `background-image` is stripped, recharts SVG `<rect fill="...">` survives (good), but if ink ratios matter (red/green for pos/neg) you may want a `@media print` rule that converts to patterns / dashed strokes for B&W printers.

### Recommendation

Roadmap item #53 is acknowledged in the comment at line 1562. Promote it. Treat print as a Tier-1 surface for the financial documents and letters; the rest can stay screen-only.

---

## 8. CSS-in-JS leakage (inline styles)

**248 `style={{...}}` occurrences** across `client/src`. Most are *legitimate* (dynamic widths/heights, computed transforms, theme-token color references like `var(--acr-pos)`). Categorical breakdown:

| Pattern | Count | Verdict |
|---|---|---|
| Dynamic width/height (`width: ${pct}%`) | ~60 | Legitimate — can't be a class |
| `style={{ color: "var(--acr-pos)" }}` etc. | ~25 | **Should be a class** — `text-pos` utility (custom Tailwind plugin) |
| `style={{ background: "var(--acr-brand)" }}` | ~8 | **Should be `bg-primary` or a custom utility** |
| Computed `marginTop: 0` / `padding: 0` resets | ~5 | Should be Tailwind `mt-0` / `p-0` |
| Computed `paddingBottom: "env(safe-area-inset-bottom)"` | 2 | Already have `.safe-area-bottom` class — **use it** |
| Theme preview swatches (`backgroundColor: t.light.brand`) | ~10 | Legitimate — these *are* dynamic per theme being previewed |
| Hardcoded hex (`color: "#fff"`, etc.) | 3 | **Replace with Tailwind / token** |

**Ratio of fixable to total: roughly 50/248 = 20%.** Not a crisis, but consistent with the broader pattern: when in doubt, the codebase reaches for inline CSS rather than extending the design system.

The 25 `style={{ color: "var(--acr-pos)" }}` patterns scream for a Tailwind plugin that adds `text-acr-pos`, `bg-acr-pos-soft`, etc. — five minutes of plugin code, removes a category of inline-style entirely.

---

## 9. The CSS hygiene sprint — 3 days, one engineer

A surgical pass that brings the stylesheet to the same standard as the token block.

### Day 1 — Drain the dead code, fix the chart gap

1. Delete the 21 unused class definitions (§4). Run the grep audit afterward to confirm zero JSX references. Estimated removal: 90 lines.
2. Rename `.animate-in` → `.acr-animate-in` (or delete; tailwindcss-animate covers it) — fixes the silent collision.
3. Ship `client/src/lib/chartColors.ts` reading the four `--acr-chart-*` tokens; codemod the 43 `fill="#..."` and 50 `stroke="#..."` literals. (§6)
4. Add ESLint rule blocking literal hex in JSX attributes: `no-restricted-syntax` on `JSXAttribute > Literal[value=/#[0-9A-Fa-f]{3,8}/]`.

### Day 2 — Reconcile the three systems

1. Write `scripts/derive-shadcn-hsl.mjs`: read each `--acr-*` block, output the matching `--background` / `--foreground` / etc. HSL triplets. Diff against current values; commit corrections.
2. Add to CI: `npm run check:theme-parity` regenerates and `git diff --exit-code`s.
3. Per-theme `--glass-bg-light/sm/subtle` — move from `:root` (mode-only) into each theme's block, derive from `--acr-surface` + opacity. Same for the three vibrancy backgrounds (lines 964, 1114, 1118, 1288, 1291) which are homestead-locked.
4. Add the missing tokens: `--acr-ring-shadow`, `--acr-shadow-inset`, `--acr-scrim`, `--acr-agent-{sophie,forge,atlas,pax}`. (§2c)

### Day 3 — Print system + @apply discipline + Tailwind palette ban

1. Print: add `<header>`/`<footer>` print blocks, `thead { display: table-header-group; }`, serif `--font-print`, canvas/map fallbacks. Wire `window.print()` triggers on P&L, contracts, monthly narrative, lender package, parcel detail. (§7)
2. `@apply` cleanup: convert the 12 single-utility `@apply` rules to direct CSS or Tailwind utility on consumer (§3b). Wrap component-shaped classes in `@layer components { ... }`.
3. Tailwind palette ban: ESLint `no-restricted-syntax` rule banning `text-(red|amber|green|...)` literal classes outside an allowlist. Codemod the 1,844 hits in waves — start with status/severity (`-red-`, `-green-`, `-amber-`) which are highest-leverage for theme awareness.
4. Inline-style sweep: replace 25 `style={{color:"var(--acr-pos)"}}` patterns with `text-acr-pos` utility from a tiny new Tailwind plugin (`tailwind-plugin-acr.ts`).

### What's true after the sprint

- Stylesheet drops from 1,619 → ~1,500 lines (dead code removed)
- Single source of truth (hex), HSL is derived, CI enforces
- Charts re-skin per theme — five themes finally feel different on data viz
- Print is a Tier-1 deliverable for the 5 surfaces that need it
- Tailwind-palette literals can't sneak in unnoticed
- `@apply` count drops from 25 → ~12, all earning their place

The bones of the system are excellent. The gap is purely between "system designed" and "system enforced." Three days of discipline closes it.

— Renske
