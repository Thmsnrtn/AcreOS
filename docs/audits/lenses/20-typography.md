# Lens 20 -- Typography Specialist Audit

Auditor: Typography Specialist
Date: 2026-04-15
Scope: Type scale, font loading, line heights, readability, and typographic hierarchy

---

## Executive Summary

AcreOS has a promising typographic foundation -- system font stacks (`-apple-system`, `SF Pro Text/Display`) for body and headings, a `@tailwindcss/typography` plugin for prose content, and three CSS utility classes for structured type (`heading-display`, `heading-section`, `caption-label`). In practice, however, the typography system is severely undermined by four problems: (1) a render-blocking Google Fonts request that loads **25 font families** of which **22 are completely unused** anywhere in the application code, adding hundreds of KB of dead weight to every initial page load; (2) a failed `@import` for the proprietary SF Pro font from Google Fonts, which returns a 400 error on every CSS parse; (3) no formal type scale -- `h1` elements use 8 different sizes across the codebase and the custom heading utilities are defined but adopted by zero components; and (4) text as small as 8px and 9px used in production UI while `user-scalable=no` prevents users from zooming, creating a compounding readability barrier.

---

## Findings

### P1-01: Viewport meta blocks user text scaling (accessibility violation)

**Severity:** P1 -- Readability / Accessibility
**File:** `client/index.html:5`

```html
<meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1, user-scalable=no" />
```

`maximum-scale=1` and `user-scalable=no` prevent users from pinch-zooming to enlarge text. This is a WCAG 2.1 Level AA failure (Success Criterion 1.4.4 -- Resize Text). Users with low vision who rely on browser zoom are locked out. Combined with the sub-10px text sizes documented in P1-02, this creates a hard readability barrier.

**Impact:** All users on mobile and tablet. Disproportionately affects users with visual impairments.

---

### P1-02: Sub-10px text sizes used in production UI

**Severity:** P1 -- Readability
**Files:** 90+ files across `client/src/`

Arbitrary text sizes below the effective minimum readable threshold are used extensively:

| Class | Instances | Pixel size | Example locations |
|---|---|---|---|
| `text-[8px]` | 4 | 8px | `land-credit-badge.tsx` (grade labels) |
| `text-[9px]` | 23 | 9px | `pax-copilot-rail.tsx`, `property-map.tsx`, `pax-project-panel.tsx`, `sovereign-v13.tsx` |
| `text-[10px]` | 327 | 10px | 90 files -- maps, founder dashboard, today page, field scout, etc. |
| `text-[11px]` | 50 | 11px | Various components |

At default DPI, 8--9px text is illegible for many users. Even 10px is below the generally accepted 12px minimum for body-adjacent text. The `text-[10px]` class alone appears 327 times across 90 files, indicating this is a systemic pattern rather than isolated cases.

The CSS also defines a `.caption-label` utility at `0.6875rem` (11px) and `.data-label` at the same size, showing the intent to use 11px as a floor -- but the arbitrary values bypass this.

---

### P1-03: Failed @import for proprietary SF Pro font

**Severity:** P1 -- Readability (render-blocking error)
**File:** `client/src/index.css:1`

```css
@import url('https://fonts.googleapis.com/css2?family=SF+Pro+Display:wght@300;400;500;600;700&family=SF+Pro+Text:wght@400;500;600&display=swap');
```

SF Pro is an Apple proprietary font. Google Fonts does not serve it (returns HTTP 400). This `@import` is render-blocking -- the browser must resolve it before applying any styles. On every page load, the CSS parser stalls on a request that will always fail, adding latency to first contentful paint.

The font stack in `--font-sans` and `--font-display` already includes `-apple-system` and `BlinkMacSystemFont`, which resolve to SF Pro on Apple devices natively. The `@import` is both broken and unnecessary.

---

### P1-04: 25 Google Font families loaded, 22 unused

**Severity:** P1 -- Performance / Readability (FOUT risk)
**File:** `client/index.html:28`

A single render-blocking `<link>` tag loads 25 font families from Google Fonts in one 1,397-character URL. Cross-referencing every font name against all `.tsx`, `.ts`, and `.css` files in `client/src/`:

| Font family | Referenced in source? | Notes |
|---|---|---|
| Inter | Yes | Reseller white-label panel only (`reseller-dashboard.tsx`) |
| Roboto | Yes | Fallback in `--font-sans` stack + reseller panel |
| DM Sans | Yes | Reseller white-label panel only |
| Architects Daughter | **No** | |
| Fira Code | **No** | |
| Geist / Geist Mono | **No** | |
| IBM Plex Mono | **No** | |
| IBM Plex Sans | **No** | |
| JetBrains Mono | **No** | |
| Libre Baskerville | **No** | |
| Lora | **No** | |
| Merriweather | **No** | |
| Montserrat | **No** | |
| Open Sans | **No** | |
| Outfit | **No** | |
| Oxanium | **No** | |
| Playfair Display | **No** | |
| Plus Jakarta Sans | **No** | |
| Poppins | **No** | |
| Roboto Mono | **No** | |
| Source Code Pro | **No** | |
| Source Serif 4 | **No** | |
| Space Grotesk | **No** | |
| Space Mono | **No** | |

22 of 25 families are never referenced in application code. The 3 that are referenced (Inter, Roboto, DM Sans) are used **only** in the reseller white-label branding panel -- they are not part of the core UI font stack.

The request is render-blocking (no `media="print"` swap trick, no `<link rel="preload">` with font-display fallback). Full weight ranges are requested (e.g., Poppins loads all 18 weight/italic combinations). Conservative estimate: 500KB--1MB+ of font data downloaded on first visit that is never rendered.

---

### P2-01: No consistent type scale -- h1 uses 8+ different sizes

**Severity:** P2 -- Inconsistent scale
**Files:** Across all page files in `client/src/pages/`

`h1` elements use at least 8 distinct size classes with no correlation to page type or hierarchy level:

| h1 size class | Count |
|---|---|
| `text-2xl` (1.5rem / 24px) | 107 |
| `text-3xl` (1.875rem / 30px) | 72 |
| `text-xl` (1.25rem / 20px) | 9 |
| `text-2xl md:text-3xl` | responsive |
| `text-3xl md:text-4xl` | responsive |
| `text-4xl` | 3 |
| `text-5xl sm:text-6xl` | 1 (landing page) |
| `text-base` | 1 |
| `text-sm` | 1 |
| `text-lg` | 1 |

There is no `PageTitle` or `Heading` component to enforce consistency. Each page defines its own heading size inline. Navigating from a `text-2xl` page title to a `text-xl` page title creates a visual hierarchy inversion.

---

### P2-02: h2/h3 size overlap creates broken hierarchy

**Severity:** P2 -- Inconsistent scale
**Files:** Across all page and component files

The heading size distributions overlap, breaking the typographic hierarchy contract:

| Element | Most common sizes |
|---|---|
| h1 | `text-2xl` (107), `text-3xl` (72) |
| h2 | `text-xl` (68), `text-lg` (34), `text-2xl` (13), `text-3xl` (4) |
| h3 | `text-sm` (35), `text-lg` (29), `text-xl` (10) |

Some h3 elements are `text-xl` while h2 elements on the same page are `text-lg`. Some h1 elements are `text-xl` while h2 elements elsewhere are `text-2xl`. The semantic heading level and visual size are decoupled.

---

### P2-03: Custom heading utilities defined but never adopted

**Severity:** P2 -- Inconsistent scale
**File:** `client/src/index.css:395-397`

Three typographic utility classes are defined:

```css
.heading-display  { font-family: var(--font-display); font-weight: 700; letter-spacing: -0.025em; line-height: 1.1; }
.heading-section  { font-family: var(--font-display); font-weight: 600; letter-spacing: -0.015em; line-height: 1.25; }
.caption-label    { font-size: 0.6875rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; ... }
```

Zero components use `heading-display` or `heading-section`. Zero components use `caption-label`. These utilities represent an intended typographic system that was never rolled out. Meanwhile, the `@layer base` rule (line 281) applies `font-family: var(--font-display)` and `letter-spacing: -0.018em` to all headings globally -- a third letter-spacing value alongside the two in the utilities, fragmenting the intent further.

---

### P2-04: --font-serif and --font-mono CSS variables undefined

**Severity:** P2 -- Inconsistent scale
**File:** `tailwind.config.ts:95-97`, `client/src/index.css`

The Tailwind config maps `font-serif` and `font-mono` to CSS variables:

```ts
fontFamily: {
  sans: ["var(--font-sans)"],
  serif: ["var(--font-serif)"],
  mono: ["var(--font-mono)"],
},
```

Neither `--font-serif` nor `--font-mono` is defined anywhere in the CSS. Only `--font-sans` and `--font-display` are set in `:root`. Any use of `font-serif` or `font-mono` Tailwind classes resolves to an empty `var()`, falling back to the browser default (typically Times New Roman for serif, Courier New for mono).

The `font-mono` class is used in 100+ locations across the codebase (monospaced data displays, IDs, APNs, financial figures). All of these render in whatever the browser default monospace font is, with no guarantee of consistency cross-browser.

---

### P2-05: Line-height rarely specified explicitly

**Severity:** P2 -- Inconsistent scale
**Files:** 148 page files use `text-sm`; only 13 pair it with a `leading-*` class

Explicit line-height classes are rare across the codebase:

| Leading class | Instances |
|---|---|
| `leading-relaxed` | 88 |
| `leading-tight` | 21 |
| `leading-snug` | 21 |
| `leading-none` | 20 |
| **Total** | **150** |

Against 7,009 text-size class instances (`text-xs` through `text-5xl`), only 150 (~2%) have an explicit line-height override. The remaining 98% rely on Tailwind's default line-heights per size step.

This is acceptable when all text uses standard Tailwind sizes. However, the 405 arbitrary size values (`text-[10px]`, `text-[11px]`, `text-[9px]`, `text-[8px]`, `text-[13px]`, `text-[0.8rem]`) have **no** associated line-height and inherit from the parent or use the browser default (typically `normal` = ~1.2), which produces cramped vertical rhythm at small sizes.

---

### P2-06: Font weight distribution skews heavy

**Severity:** P2 -- Inconsistent scale
**Files:** Across all client source

Font weight class usage:

| Weight class | Count |
|---|---|
| `font-medium` (500) | 1,448 |
| `font-bold` (700) | 834 |
| `font-semibold` (600) | 638 |
| `font-normal` (400) | 24 |
| `font-black` (900) | 15 |

97.3% of explicit weight assignments are medium-or-heavier. Only 24 instances of `font-normal` appear in the entire codebase. This heavy-skewed distribution flattens the typographic hierarchy -- when nearly everything is bold, nothing stands out as bold. The base body weight of 400 (inherited from the system font default) provides some contrast, but within any given card or section, the weight uniformity reduces scanability.

---

### P2-07: Responsive typography applied inconsistently

**Severity:** P2 -- Inconsistent scale
**Files:** Across page files

Responsive text size breakpoints:

| Responsive class | Count |
|---|---|
| `md:text-base` | 43 |
| `md:text-3xl` | 42 |
| `sm:text-sm` | 23 |
| `md:text-sm` | 12 |
| `md:text-2xl` | 7 |
| `sm:text-lg` | 5 |
| `sm:text-2xl` | 2 |

Only ~135 responsive text classes total across 7,009 text-size instances. Most pages use the same text size at all breakpoints. On mobile (320--375px wide), `text-2xl` (24px) page titles consume disproportionate viewport width, while data-dense tables remain at `text-xs` (12px) with no bump for touch targets. The landing page (`text-5xl sm:text-6xl`) is one of the few places responsive type is applied thoughtfully.

---

### P2-08: No font preloading strategy

**Severity:** P2 -- Performance
**Files:** `client/index.html`

The `<link rel="preconnect">` hints for `fonts.googleapis.com` and `fonts.gstatic.com` are present, but there are no `<link rel="preload" as="font">` directives for any font files. Given the primary font stack is system fonts (which need no preload), and the Google Fonts are almost entirely unused (P1-04), this is currently moot. However, if the font loading is rationalized to actually use web fonts, preload hints should be added for the critical subset.

---

### P2-09: Duplicate font loading paths

**Severity:** P2 -- Inconsistent scale
**Files:** `client/index.html:28`, `client/src/index.css:1`

Fonts are loaded through two separate mechanisms:

1. **`client/index.html` line 28:** `<link>` tag loading 25 families from Google Fonts
2. **`client/src/index.css` line 1:** `@import` loading SF Pro Display/Text from Google Fonts (fails with 400)

Neither coordinates with the other. The `<link>` tag is render-blocking by default (no `media` swap). The `@import` is also render-blocking (CSS `@import` blocks rendering until resolved). Two independent blocking font requests on every page load, both loading fonts that are either unused or unavailable.

---

## Summary Statistics

| Metric | Value |
|---|---|
| Google Font families loaded | 25 |
| Google Font families actually used | 3 (white-label panel only) |
| Google Font families used in core UI | 0 |
| CSS custom font variables defined | 2 (`--font-sans`, `--font-display`) |
| CSS custom font variables referenced in Tailwind but undefined | 2 (`--font-serif`, `--font-mono`) |
| Custom heading utility classes defined | 3 |
| Custom heading utility classes adopted | 0 |
| Distinct h1 size classes | 8+ |
| Total text-size class instances | ~7,009 |
| Explicit line-height overrides | ~150 (2.1%) |
| Arbitrary sub-12px text sizes | 405 instances across 90+ files |
| Render-blocking font requests | 2 (both broken or wasteful) |

---

## Recommendations (not implemented -- documentation only)

1. Remove the `@import` for SF Pro from `index.css` (broken, render-blocking)
2. Strip the Google Fonts `<link>` down to only fonts actually needed (likely zero for core UI; Inter/DM Sans/Roboto only if white-label feature is kept)
3. Remove `maximum-scale=1` and `user-scalable=no` from viewport meta
4. Define `--font-mono` (e.g., `'SF Mono', 'Fira Code', ui-monospace, monospace`) and `--font-serif` CSS variables
5. Replace all `text-[8px]`, `text-[9px]` with `text-xs` minimum; audit `text-[10px]` for readability
6. Create a `PageTitle` / `SectionHeading` component that enforces a single type scale
7. Establish a type scale contract: h1 = `text-2xl md:text-3xl`, h2 = `text-xl`, h3 = `text-lg`, and enforce via shared components
8. Roll out the existing `heading-display` / `heading-section` / `caption-label` utilities or remove them
9. Add explicit `leading-*` classes to all arbitrary text sizes
10. Add responsive text scaling to data-dense pages for mobile readability
