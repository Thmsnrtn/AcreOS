# Lens 25 -- Theme Specialist

Auditor: Theme / Dark Mode Quality
Date: 2026-04-15
Scope: Theme architecture, dark mode quality, color contrast, chart/visualization theming, per-page dark mode coverage

---

## Executive Summary

AcreOS has a **mature theme infrastructure** -- a `ThemeProvider` with system/light/dark modes, six named presets, six accent overrides, and full CSS custom property plumbing through Tailwind. The core shell (sidebar, cards, backgrounds, popovers) adapts well. However, **dark mode is not a first-class experience** across the entire surface area. At least four full pages are permanently dark-themed (force-dark, ignoring system preference), over 50 pages contain hardcoded Tailwind color utilities without `dark:` counterparts, every Recharts chart uses hardcoded hex colors with no theme adaptation, and the Mapbox map has no dark style. The result is a visually inconsistent experience that ranges from polished (Today, Leads) to broken (Onboarding V2 in light mode, NightCap in light mode).

**Issue count: 14 findings (3 P1, 7 P2, 4 P3)**

---

## Architecture Assessment

### What exists (good)

| Layer | Implementation | Notes |
|-------|----------------|-------|
| Context | `client/src/contexts/theme-context.tsx` | `ThemeMode` (light/dark/system), `ThemeAccent` (6), `ThemePreset` (6). Legacy compat via `theme`/`setTheme`/`toggleTheme`. |
| Toggle | `client/src/components/theme-toggle.tsx` | Icon-only button with proper `aria-label`. |
| Settings UI | `client/src/components/theme-settings.tsx` | Modal with mode, preset, and accent selectors. Live preview indicator. |
| CSS tokens | `client/src/index.css` (:root / .dark) | 30+ CSS custom properties per mode. HSL-based. Glass, shadow, sidebar tokens all have dark variants. |
| Preset overrides | `index.css` [data-theme="X"] | Midnight, Forest, Ocean, Sunset, Monochrome -- each with `.dark` background/card/sidebar overrides. |
| Tailwind config | `tailwind.config.ts` | `darkMode: ["class"]`. All semantic colors reference CSS vars via `hsl(var(--X))`. |
| Application | Class-based | `.dark` class on `<html>`. Applied via `useEffect` in ThemeProvider. |

### What is missing (systemic)

1. **No FOUC prevention** -- dark class is applied in a React `useEffect`, not in an inline `<script>` in `<head>`. Users on dark mode see a white flash on every page load.
2. **No `--chart-*` CSS custom properties** -- `tailwind.config.ts` references `--chart-1` through `--chart-5` but they are never defined in `index.css`. All chart colors are hardcoded hex.
3. **Accent overrides lack dark variants** -- The five accent overrides (forest, ocean, amber, rose, slate) only define `:root` selectors; the same lightness values are used in dark mode, potentially producing poor contrast.
4. **`<meta name="theme-color">` is static** -- Hardcoded to `#8B4513` in `client/index.html`. Never updated when theme changes, so the browser chrome stays brown regardless of mode.

---

## Findings

### F-25-01 | P1 | Force-dark pages are unreadable in light mode

**Pages:** `onboarding-v2.tsx`, `field-scout.tsx`, `night-cap.tsx`

These pages set their own dark background (`bg-gray-950`, `from-slate-950 via-indigo-950 to-slate-900`) and use `text-white`, `text-gray-300`, `text-gray-400`, etc. throughout. They ignore the theme context entirely.

- `onboarding-v2.tsx`: **103** hardcoded gray/white/black Tailwind classes, **0** `dark:` variants.
- `field-scout.tsx`: **67** hardcoded gray/white/black classes, **0** `dark:` variants.
- `night-cap.tsx`: Force-dark gradient background, `text-white` on everything, glass panels with `bg-white/5`.

When the user is in light mode, these pages appear as a dark island within a light shell -- jarring visual discontinuity. The sidebar and header remain light while the page content is dark.

**Files:**
- `client/src/pages/onboarding-v2.tsx`
- `client/src/pages/field-scout.tsx`
- `client/src/pages/night-cap.tsx`

---

### F-25-02 | P1 | Dark-mode flash (FOUC) on every page load

The dark class is applied in a React `useEffect` inside `ThemeProvider`. There is no blocking inline `<script>` in `client/index.html` `<head>` to read `localStorage` and apply the `.dark` class before first paint.

Users with dark mode enabled see a white flash on every navigation and hard refresh. This is the most commonly reported dark-mode UX defect across SPA frameworks.

**File:** `client/index.html` (missing blocking script), `client/src/contexts/theme-context.tsx` (line 70-77)

---

### F-25-03 | P1 | All Recharts visualizations use hardcoded hex colors

Across **53 pages** that use Recharts (`BarChart`, `LineChart`, `AreaChart`, `PieChart`, `ResponsiveContainer`), chart colors are hardcoded hex values like `#22c55e`, `#ef4444`, `#3b82f6`, `#f59e0b`, `#6366f1`, etc.

Specific issues in dark mode:
- `CartesianGrid stroke="#f0f0f0"` in `forecasting.tsx` -- near-white grid lines become invisible on dark backgrounds.
- `ReferenceLine stroke="#888"` in `cash-flow.tsx` -- poor contrast in both modes.
- No chart uses `hsl(var(--chart-N))` tokens (which are referenced in `tailwind.config.ts` but never defined).
- Recharts `<Tooltip>` components use no `contentStyle` override, so they render with Recharts' default white background -- fine in light mode, but a glaring white box in dark mode.
- Only 2 pages (`dashboard.tsx`, `market-intelligence.tsx`) use theme-aware `hsl(var(--*))` values for chart colors. The other 51 do not.

**Impact:** Charts are the primary data visualization surface. In dark mode they appear as bright neon colors on dark cards with invisible grid lines and white tooltip popups.

**Representative files:**
- `client/src/pages/forecasting.tsx` (line 189: `stroke="#f0f0f0"`)
- `client/src/pages/cash-flow.tsx` (lines 346-406)
- `client/src/pages/portfolio-optimizer.tsx` (lines 548-552, 738, 974-975)
- `client/src/pages/freedom-meter.tsx` (lines 468-555)
- `client/src/pages/tax-optimization.tsx` (lines 348-511)

---

### F-25-04 | P2 | ~76 badge/status color instances lack dark mode variants

Across 85 files, there are **420 instances** of semantic-color badge patterns (`bg-red-100 text-red-700`, `bg-green-100 text-green-800`, etc.). Of these, roughly **344** have paired `dark:bg-*` overrides, leaving about **76 instances in ~19 files** without dark variants.

In dark mode, light-background badges (`bg-red-100`, `bg-blue-100`, `bg-gray-100`) appear as bright rectangles on dark cards -- poor contrast and visual noise.

**Worst offenders (0 dark: variants for badge colors):**
- `client/src/pages/agent-command-center.tsx` (lines 133-137)
- `client/src/pages/deal-hunter.tsx` (lines 70-84)
- `client/src/pages/fee-dashboard.tsx` (line 84)
- `client/src/pages/document-intelligence.tsx` (line 20)
- `client/src/pages/capital-markets.tsx` (line 18, 372)
- `client/src/pages/vision-ai.tsx` (line 123)
- `client/src/pages/tax-optimization.tsx` (line 97, 374)

---

### F-25-05 | P2 | Mapbox map has no dark mode style

`client/src/components/property-map.tsx` defines three map styles (satellite, terrain, streets) but none is a dark-mode style. The map does not react to the app's dark mode toggle. In dark mode, the streets/terrain styles present a bright white map surface surrounded by dark UI -- a significant visual jarring.

No code reads the theme context to switch to `mapbox://styles/mapbox/dark-v11` or `navigation-night-v1`.

**File:** `client/src/components/property-map.tsx` (lines 28-33)

---

### F-25-06 | P2 | Mapbox popup HTML uses hardcoded light-mode colors

Map popups are constructed via `setHTML()` with inline styles: `color: #22c55e`, `color: #6b7280`. These are hardcoded and not theme-aware. In dark mode (if a dark map style were added), popups would still render with light-mode text colors on a default white popup background.

**File:** `client/src/components/property-map.tsx` (lines 1331-1341)

---

### F-25-07 | P2 | Accent color overrides have no dark-mode lightness adjustment

The five accent overrides in `index.css` (forest, ocean, amber, rose, slate) only define values for `:root`. The default theme's `.dark` block bumps terracotta from `18 48% 52%` to `18 55% 58%` for better dark-mode visibility, but the accent overrides use the same lightness in both modes.

For example, `[data-accent="slate"]` sets `--primary: 215 20% 48%` -- a medium gray that may lack sufficient contrast against the dark mode background (`20 30% 8%`, approximately `hsl(20, 30%, 8%)` = very dark brown). The WCAG contrast ratio is likely below 4.5:1 for body text.

**File:** `client/src/index.css` (lines 250-269)

---

### F-25-08 | P2 | Reseller dashboard brand preview is hardcoded light

The reseller dashboard's brand preview card uses `bg-white` and `text-gray-*` classes with no dark variants. This creates a permanently light-themed preview island.

**File:** `client/src/pages/reseller-dashboard.tsx` (lines 552-578)

---

### F-25-09 | P2 | NPS dialog score buttons use hardcoded Tailwind colors

The NPS rating buttons (0-10) use hardcoded `bg-red-600`, `bg-orange-500`, `bg-yellow-400`, `bg-green-500`, etc. with `text-white`/`text-black`. While visually acceptable, they don't adapt to theme and their saturation levels may conflict with the muted desert aesthetic.

**File:** `client/src/components/nps-dialog.tsx` (lines 22-32)

---

### F-25-10 | P2 | Semantic status colors in `tailwind.config.ts` are hardcoded RGB

The `status` color group in the Tailwind config uses raw RGB values (`rgb(34 197 94)`, `rgb(245 158 11)`, etc.) instead of CSS custom properties. These do not adapt between light and dark modes.

**File:** `tailwind.config.ts` (lines 88-93)

---

### F-25-11 | P3 | `<meta name="theme-color">` never updates for dark mode

The browser chrome color is set to `#8B4513` (a brown) in the static HTML and is never dynamically updated. In dark mode, the status bar/address bar should reflect the dark background color. The ThemeProvider should update this meta tag when the resolved mode changes.

**File:** `client/index.html` (line 6)

---

### F-25-12 | P3 | Theme preset selector has no live dark-mode preview

The `ThemeSettings` dialog shows preset cards with static color swatches (lightBg, darkBg, accent hex values). The swatches are always the same regardless of current mode. Users cannot preview how a preset will look in their current mode without selecting it.

**File:** `client/src/components/theme-settings.tsx` (lines 7-14, 86-99)

---

### F-25-13 | P3 | System mode listener does not update `resolvedMode` reactively

When `themeConfig.mode === "system"`, the ThemeProvider listens for `(prefers-color-scheme: dark)` changes, but the handler triggers a re-render by spreading the same state object (`{...c}`). While functional, this is fragile -- the state object identity changes but no values change, which could be optimized away by future React versions.

**File:** `client/src/contexts/theme-context.tsx` (lines 58-67)

---

### F-25-14 | P3 | `--chart-1` through `--chart-5` referenced but undefined

`tailwind.config.ts` maps `chart.1` through `chart.5` to `hsl(var(--chart-1))` etc., but these custom properties are never defined in `index.css` or any other stylesheet. Any component using `text-chart-1` or `bg-chart-1` will render transparent/invisible.

**File:** `tailwind.config.ts` (lines 64-70), `client/src/index.css` (missing definitions)

---

## Coverage Matrix -- Key Pages

| Page | Uses theme tokens | `dark:` count | Hardcoded colors | Force-dark | Verdict |
|------|-------------------|---------------|------------------|------------|---------|
| Today | Yes | 36 | 4 | No | Good -- minor badge gaps |
| Leads | Yes | 49 | 2 | No | Good |
| Deals | Yes | 20 | 1 | No | Good -- some badges lack dark variants |
| Founder Dashboard | Yes | 26 | 9 | No | Fair -- 150 Tailwind color classes, 9 hardcoded |
| Maps | Yes | 5 | 1 | No | Fair -- map itself not theme-aware |
| Settings | Yes | 2 | 3 | No | Good |
| Pipeline | Yes | 5 | 1 | No | Good -- stage colors hardcoded |
| Onboarding V2 | No | 0 | 103 | Yes (bg-gray-950) | **Broken** in light mode |
| Field Scout | No | 0 | 67 | Yes (bg-gray-950) | **Broken** in light mode |
| Night Cap | No | 0 | 7 | Yes (gradient) | **Broken** in light mode |
| Agent Command Center | Partial | 0 | 3 | No | Badges unthemed in dark |
| Deal Hunter | Partial | 1 | 7 | No | Badges unthemed in dark |
| Forecasting | Partial | 0 | charts | No | Chart grid invisible in dark |

---

## Recommended Priority Order

1. **F-25-02** -- Add blocking `<script>` in `<head>` to prevent dark mode FOUC (5 min fix, massive UX win).
2. **F-25-01** -- Refactor force-dark pages to use theme tokens or wrap in a scoped dark container.
3. **F-25-14 / F-25-03** -- Define `--chart-1` through `--chart-5` with light/dark variants; migrate charts to use them.
4. **F-25-04** -- Audit and add `dark:` variants to remaining ~76 badge instances.
5. **F-25-07** -- Add `.dark` variants to accent color overrides with increased lightness.
6. **F-25-05** -- Add dark map style to Mapbox and switch based on `resolvedMode`.
7. Remaining P2/P3 items.
