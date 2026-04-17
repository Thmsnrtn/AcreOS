# Lens 19 -- Design System Architect Audit

Auditor: Design System Architect
Date: 2026-04-15
Scope: Design tokens, Tailwind config, CSS variables, theme system, UI primitives, color/typography/spacing consistency

---

## Executive Summary

AcreOS has a well-conceived design system foundation: a "Liquid Glass" visual language inspired by macOS Tahoe, a proper HSL-based CSS variable token layer, a multi-preset/multi-accent theme system, and 54 shadcn/ui primitives. The architecture is sound. However, execution has diverged significantly from the system. Nine CSS custom properties are referenced but never defined (broken borders across core primitives), accent color overrides are incomplete (no dark mode support), and 3,581 instances of raw Tailwind palette colors across 300+ files bypass the token system entirely. The design system enables rapid development in theory, but in practice most page-level code ignores it.

---

## 1. Token Architecture

### 1.1 CSS Variable Layer

**File:** `client/src/index.css`

The token layer uses HSL triplets without the `hsl()` wrapper (e.g., `--primary: 18 48% 52%`), consumed in Tailwind via `hsl(var(--primary) / <alpha-value>)`. This is the standard shadcn pattern and works correctly for alpha compositing.

Tokens defined in `:root` (light) and `.dark` (dark):
- Core: `--background`, `--foreground`, `--border`, `--input`, `--ring`
- Semantic: `--primary`, `--secondary`, `--muted`, `--accent`, `--destructive` (each with `-foreground`)
- Surface: `--card`, `--popover` (each with `-foreground`)
- Sidebar: `--sidebar-background`, `--sidebar-foreground`, `--sidebar-primary`, `--sidebar-accent`, `--sidebar-border`, `--sidebar-ring` (each with `-foreground`)
- Glass: `--glass-bg-light`, `--glass-bg-subtle`, `--glass-bg-sm`, `--glass-border`, `--glass-border-sm`, `--glass-specular`
- Elevation: `--shadow-1` through `--shadow-4`
- Font: `--font-sans`, `--font-display`

### P1-01: Nine border CSS variables referenced but never defined

**Severity:** P1

The Tailwind config (`tailwind.config.ts`) maps the following color tokens to CSS variables that do not exist in any `.css` file:

| Token in config | CSS variable | Used in |
|---|---|---|
| `card.border` | `--card-border` | `card.tsx`, `skeleton-card.tsx`, `skeleton-table.tsx` |
| `popover.border` | `--popover-border` | (available but unused in components) |
| `primary.border` | `--primary-border` | `button.tsx` default variant |
| `secondary.border` | `--secondary-border` | `button.tsx` secondary variant |
| `muted.border` | `--muted-border` | (available) |
| `accent.border` | `--accent-border` | (available) |
| `destructive.border` | `--destructive-border` | `button.tsx` destructive variant |
| `sidebar-primary.border` | `--sidebar-primary-border` | (available) |
| `sidebar-accent.border` | `--sidebar-accent-border` | (available) |

Additionally, `badge.tsx` references `var(--badge-outline)` and `button.tsx` references `var(--button-outline)` -- neither is defined.

**Impact:** `border-card-border`, `border-primary-border`, `border-secondary-border`, and `border-destructive-border` resolve to empty strings. Buttons and cards that rely on these get invisible or absent borders. Because the `border` base class still applies (via the global `@apply border-border` reset), the fallback may mask this in some cases, but the intent of per-component border tokens is entirely defeated.

### P1-02: `--sidebar` variable name mismatch

**Severity:** P1

Tailwind config maps `sidebar.DEFAULT` to `hsl(var(--sidebar) / <alpha-value>)`, but the CSS defines `--sidebar-background` (not `--sidebar`). The `bg-sidebar` utility class will resolve to an invalid HSL value. Code that uses `bg-sidebar` gets no background color.

### P1-03: Chart color tokens defined in config but never in CSS

**Severity:** P1

`tailwind.config.ts` defines `chart.1` through `chart.5` mapping to `--chart-1` through `--chart-5`. These CSS variables are never defined in `index.css` or any other stylesheet. Only one file (`cash-flow-waterfall.tsx`) references a `chart-*` class. All chart colors are effectively broken unless hardcoded inline.

### P1-04: `--font-serif` and `--font-mono` variables never defined

**Severity:** P1

The Tailwind config maps `fontFamily.serif` to `var(--font-serif)` and `fontFamily.mono` to `var(--font-mono)`. Neither variable is defined in `index.css`. The `font-serif` and `font-mono` utility classes resolve to the browser default. There are ~20 uses of `font-mono` across components which all fall back to the browser monospace default rather than a deliberate design choice.

---

## 2. Theme System

### Architecture

**File:** `client/src/contexts/theme-context.tsx`

The theme system supports three axes:
- **Mode:** light / dark / system (via `prefers-color-scheme` media query)
- **Preset:** default, midnight, forest, ocean, sunset, monochrome (sets `data-theme` attribute)
- **Accent:** terracotta, forest, ocean, amber, rose, slate (sets `data-accent` attribute)

This is a well-designed three-axis theme system. Presets override core surface and primary colors. Accents override just `--primary` / `--ring` / `--sidebar-primary`.

### P1-05: Accent overrides only work on default preset in light mode

**Severity:** P1

Accent overrides in CSS are scoped to `[data-theme="default"][data-accent="..."]`:root`. There are:
- No dark-mode accent overrides (no `[data-theme="default"][data-accent="forest"].dark` selectors)
- No accent overrides for non-default presets (midnight + forest accent = no accent applied)

**Impact:** Selecting any non-terracotta accent in dark mode has zero effect. Selecting any accent while using a non-default preset has zero effect. The theme settings UI (`theme-settings.tsx`) still shows all accent options as selectable, giving users a broken control.

### P1-06: Theme presets do not override foreground/text colors for light mode

**Severity:** P1

Theme presets (midnight, forest, ocean, sunset, monochrome) only override `--primary`, `--accent`, `--ring`, and sidebar tokens for light mode. They do not touch `--background`, `--card`, `--foreground`, `--secondary`, `--muted`, or `--border` in light mode. Only the dark-mode variants get surface color overrides. This means in light mode, all presets share the same warm desert cream background and only the accent hue changes -- the "midnight" preset in light mode still looks like the desert theme with a navy accent.

### P2-01: ThemePreset and ThemeAccent types are only used in 2 files

**Severity:** P2

The theme types are only imported in `theme-context.tsx` and `theme-settings.tsx`. No other component consumes the `themeConfig.preset` or `themeConfig.accent` values programmatically, which is fine for CSS-driven theming. However, this means there is no programmatic access to the current theme color values for components that need to pass colors to non-CSS APIs (e.g., chart libraries, canvas rendering, map styling).

---

## 3. Color Usage Discipline

### P2-02: 3,581 raw Tailwind palette color occurrences across 300+ files

**Severity:** P2

A search for raw Tailwind palette colors (`text-red-500`, `bg-green-100`, `border-amber-200`, etc.) found 3,581 occurrences across 300+ files. The worst offenders:

| File | Count |
|---|---|
| `pages/founder-dashboard.tsx` | 309 |
| `pages/onboarding-v2.tsx` | 150 |
| `pages/field-scout.tsx` | 105 |
| `pages/today.tsx` | 60 |
| `pages/founder-setup-wizard.tsx` | 59 |
| `pages/properties.tsx` | 54 |
| `pages/night-cap.tsx` | 54 |
| `pages/leads.tsx` | 59 |
| `pages/deals.tsx` | 49 |
| `pages/sovereign-v13.tsx` | 46 |
| `pages/portfolio-optimizer.tsx` | 45 |
| `pages/agent-command-center.tsx` | 40 |

These colors bypass the design token system entirely. When a user switches to the "midnight" or "monochrome" preset, all these hardcoded `green-500`, `red-600`, `amber-100` colors remain unchanged, breaking visual cohesion. Many of these are semantic status colors (success/warning/error) that should be token-driven.

### P2-03: No semantic status/feedback color tokens

**Severity:** P2

The system defines `--destructive` for error states but lacks tokens for:
- Success (currently hardcoded as `green-500`, `green-600`, `emerald-500`, `emerald-600` -- at least 4 different greens)
- Warning (currently `amber-500`, `amber-600`, `yellow-500`, `yellow-600` -- at least 4 different yellows)
- Info (currently `blue-500`, `blue-600`, `sky-500` -- at least 3 different blues)

The `status` color group in `tailwind.config.ts` (`status.online`, `status.away`, `status.busy`, `status.offline`) is defined with hardcoded RGB values rather than CSS variables and is never actually used in any component (0 occurrences of `status-online`, `status-away`, etc.).

### P2-04: Hardcoded arbitrary font sizes via Tailwind brackets

**Severity:** P2

169 occurrences of `text-[Npx]` or `text-[Nrem]` across 30+ files bypass the Tailwind type scale. Most are `text-[10px]`, `text-[11px]`, or `text-[13px]` -- sizes between standard Tailwind stops. This indicates a need for additional type scale tokens rather than ad-hoc overrides.

---

## 4. Elevation System

### P2-05: Custom elevation system defined but barely adopted

**Severity:** P2

A 4-level elevation system is defined (`--shadow-1` through `--shadow-4`) and mapped to Tailwind as `shadow-level-1` through `shadow-level-4`. Usage:

| System | Occurrences | Where |
|---|---|---|
| `shadow-level-*` | 2 | `button.tsx`, `card.tsx` only |
| `elevation-*` CSS classes | 2 | `switch.tsx`, `slider.tsx` only |
| Default Tailwind shadows (`shadow-sm/md/lg`) | ~35 | Spread across 20+ page files |

The custom elevation system is well-designed (with proper dark-mode adjustments) but page-level code consistently uses default Tailwind shadows instead, defeating the purpose of the elevation hierarchy.

---

## 5. Typography System

### P2-06: Typography utility classes defined but never used

**Severity:** P2

`index.css` defines five typography utility classes:
- `.heading-display` -- 0 usages in `.tsx` files
- `.heading-section` -- 0 usages in `.tsx` files
- `.caption-label` -- 0 usages in `.tsx` files
- `.data-label` -- 0 usages in `.tsx` files
- `.data-value` -- 0 usages in `.tsx` files

These are effectively dead CSS. Pages use ad-hoc Tailwind classes like `text-2xl font-semibold`, `text-sm font-medium`, `text-xs font-semibold uppercase tracking-wider` instead.

### P2-07: Heading typography declared in `@layer base` but `--font-display` unused outside CSS

**Severity:** P2

The base layer sets all headings to use `--font-display` with `font-weight: 600` and `letter-spacing: -0.018em`. This is good. However, `--font-display` resolves to the same system font stack as `--font-sans` (both are `-apple-system, BlinkMacSystemFont, 'SF Pro ...'`). The Google Fonts `@import` at the top of `index.css` attempts to load 'SF Pro Display' and 'SF Pro Text', but these are Apple-proprietary fonts that are not available on Google Fonts and will fail to load on all platforms, making the import a wasted network request.

---

## 6. Spacing Patterns

### P3-01: No standardized spacing scale documentation

**Severity:** P3

No custom spacing tokens beyond Tailwind's default scale. Spacing is applied consistently within UI primitives (e.g., `p-6` for CardHeader/CardContent, `gap-2` for button icon spacing) but page-level code uses the full Tailwind spacing scale without constraints. This is not a bug -- Tailwind's default 4px grid is reasonable -- but there is no documented spacing convention for consistent page layout (e.g., page padding, section gaps, card grid gaps).

### P3-02: Arbitrary dimension values in page code

**Severity:** P3

98 occurrences of arbitrary width/height (`w-[Npx]`, `h-[Npx]`) across 20+ files. Most are in complex layout components (`deals.tsx`: 33, `properties.tsx`: 29) for table column widths and fixed-height containers. These should ideally use Tailwind scale values or be consolidated into layout tokens.

---

## 7. Component Primitive Quality

### 7.1 Strengths

- **54 primitives** covering accordion through tooltip -- comprehensive coverage
- **CVA (class-variance-authority)** used consistently for variant management in `button.tsx`, `badge.tsx`, `toast.tsx`
- **Radix UI** underpins all interactive primitives (dialog, popover, select, tabs, etc.) -- good accessibility foundation
- **`cn()` utility** (clsx + twMerge) used consistently for class composition
- **Glass variants** elegantly added to existing primitives (`Card` has `variant="glass"`, `Button` has `variant="glass"`)
- **Shape-matching skeleton components** (`SkeletonCard`, `SkeletonList`, `SkeletonTable`) use framer-motion for smooth loading states
- **`filters-chip.tsx`** is a well-composed higher-order component built on Button
- **Focus states** applied globally via `*:focus-visible` in CSS with proper ring styling

### 7.2 Issues

### P2-08: Glass material CSS is tripled with near-identical code

**Severity:** P2

Three glass material classes are defined with almost identical structure:
- `.glass-panel` -- blur(32px), `--glass-bg-light`, `--shadow-3`
- `.liquid-glass` -- blur(32px), `--glass-bg-light`, `--shadow-2`
- `.liquid-glass-sm` -- blur(16px), `--glass-bg-sm`, `--shadow-1`
- `.liquid-glass-subtle` -- blur(20px), `--glass-bg-subtle`, `--shadow-1`

Each includes an identical `::before` pseudo-element for specular highlight and an identical `::after` for cursor-tracking. That is 4 classes x 3 selectors = 12 blocks of largely duplicated CSS. This should be refactored into a parametric approach (e.g., a single `.glass` base with modifier classes for blur/opacity levels).

### P2-09: Duplicate sidebar vibrancy classes

**Severity:** P2

Two essentially identical sidebar vibrancy classes exist:
- `.vibrancy-sidebar` (line ~415)
- `.sidebar-vibrancy` (line ~555)

Both have the same blur, saturate, and background values. `.sidebar-vibrancy` adds a border-right. Only `layout-sidebar.tsx` uses one of them.

### P2-10: CSS `.animate-in` class conflicts with tailwindcss-animate

**Severity:** P2

`index.css` defines a custom `.animate-in` class (line 425) with a `fadeSlideIn` keyframe, but the `tailwindcss-animate` plugin (loaded in `tailwind.config.ts`) also generates an `.animate-in` class. The CSS cascade order determines which wins, leading to unpredictable behavior depending on class ordering and specificity.

### P3-03: Button outline and badge outline variants reference undefined CSS variables

**Severity:** P3 (partially overlaps P1-01)

The button `outline` variant uses `[border-color:var(--button-outline)]` and badge `outline` variant uses `[border-color:var(--badge-outline)]`. These variables are never defined, so the border color defaults to `initial` (the inherited border color from `@apply border-border`), which happens to work as a reasonable fallback. But this is accidental correctness -- the intent was clearly to have distinct outline colors.

---

## 8. Animation System

### P3-04: Dual animation systems (CSS keyframes + framer-motion)

**Severity:** P3

Two parallel animation systems coexist:
1. **CSS keyframes** in `index.css`: `fadeSlideIn`, `pageEnter`, `toastSlideIn`, `popoverOpen`, `subItemsReveal`, `commandOpen`, `shimmer`, `badgePulse`, `islandBounce`, `meshShift1-3`
2. **framer-motion variants** in `lib/animations.ts`: `fadeIn`, `fadeInUp`, `slideUp`, `scaleIn`, `staggerContainer`, `staggerItem`, `pageTransition`, `modalOverlay`, `modalContent`, `cardHover`, `buttonTap`, `dropdownStagger`, `collapsibleContent`, `pulseAnimation`

Both are well-written. However, there is no guidance on when to use which. The skeleton components use framer-motion, the dialog uses CSS animations, and the tabs use CSS transitions via Tailwind. A unified convention would reduce bundle size and improve consistency.

### P3-05: `prefers-reduced-motion` coverage is incomplete

**Severity:** P3

The `@media (prefers-reduced-motion: reduce)` block in `index.css` disables CSS animations but does not affect framer-motion animations. The `lib/animations.ts` file has no reduced-motion handling. Components using framer-motion (`SkeletonCard`, `SkeletonList`, `SkeletonTable`, any page using `staggerContainer`/`staggerItem`) will still animate for users who prefer reduced motion.

---

## 9. Border Radius Consistency

### P3-06: Custom border-radius scale overrides Tailwind defaults with unusual values

**Severity:** P3

The tailwind config redefines the radius scale:
- `sm`: 3px (Tailwind default: 2px)
- `md`: 8px (Tailwind default: 6px)
- `lg`: 16px (Tailwind default: 8px)
- `xl`: 20px (Tailwind default: 12px)
- `2xl`: 24px (Tailwind default: 16px)

This is intentional (the "Liquid Glass" aesthetic favors larger radii), but the component library is inconsistent:
- Card uses `rounded-2xl` (24px)
- Dialog uses `rounded-2xl` (24px)
- Button default uses `rounded-lg` (16px)
- Button small uses `rounded-md` (8px)
- Button large uses `rounded-full`
- Input uses `rounded-lg` (16px)
- Badge uses `rounded-full`
- Select content uses `rounded-xl` (20px)

This is not necessarily wrong but there is no documented rationale for which radius level applies to which component category.

---

## Summary of Findings

| ID | Severity | Finding |
|---|---|---|
| P1-01 | P1 | 9 border CSS variables referenced in config but never defined |
| P1-02 | P1 | `--sidebar` variable name mismatch (config says `--sidebar`, CSS says `--sidebar-background`) |
| P1-03 | P1 | Chart color tokens (`--chart-1` through `--chart-5`) never defined in CSS |
| P1-04 | P1 | `--font-serif` and `--font-mono` variables never defined |
| P1-05 | P1 | Accent color overrides only work in light mode on default preset |
| P1-06 | P1 | Theme presets do not override surface colors in light mode |
| P2-01 | P2 | Theme config not programmatically accessible for non-CSS consumers |
| P2-02 | P2 | 3,581 raw Tailwind palette colors across 300+ files bypass token system |
| P2-03 | P2 | No semantic success/warning/info color tokens |
| P2-04 | P2 | 169 arbitrary font sizes via bracket notation |
| P2-05 | P2 | Custom elevation system defined but only used in 4 primitives |
| P2-06 | P2 | 5 typography utility classes defined, zero usages |
| P2-07 | P2 | Google Fonts import for non-available Apple fonts (wasted request) |
| P2-08 | P2 | Glass material CSS tripled with near-identical code |
| P2-09 | P2 | Duplicate sidebar vibrancy classes |
| P2-10 | P2 | `.animate-in` class conflicts with tailwindcss-animate plugin |
| P3-01 | P3 | No documented spacing conventions |
| P3-02 | P3 | 98 arbitrary dimension values in page code |
| P3-03 | P3 | Button/badge outline variants rely on undefined CSS variables (accidental fallback works) |
| P3-04 | P3 | Dual animation systems (CSS + framer-motion) with no usage guidance |
| P3-05 | P3 | `prefers-reduced-motion` does not cover framer-motion animations |
| P3-06 | P3 | Border radius scale overridden but no documented component-category mapping |

**P1 count:** 6
**P2 count:** 10
**P3 count:** 6
**Total findings:** 22

---

## Recommended Priority Order

1. **Define the 9+ missing CSS variables** (P1-01, P1-03, P1-04) -- immediate, small effort, high impact
2. **Fix `--sidebar` naming** (P1-02) -- one-line fix in either config or CSS
3. **Add dark-mode + cross-preset accent overrides** (P1-05) -- medium effort, completes the theme system
4. **Introduce semantic status tokens** (P2-03) -- success, warning, info -- and migrate the 3,581 hardcoded colors incrementally (P2-02)
5. **Consolidate glass material CSS** (P2-08, P2-09) -- reduce duplication
6. **Remove dead Google Fonts import** (P2-07) and dead typography classes (P2-06)
7. **Resolve `.animate-in` conflict** (P2-10)
8. **Adopt elevation system in page code** (P2-05) or remove it
