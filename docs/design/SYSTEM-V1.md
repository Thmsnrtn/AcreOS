# AcreOS Design System V1
*Kai Brennan, Principal Designer — 2026-06-01*
*Aligned with: Iris Yamamoto (CTO), Thomas Norton (Founder)*

This document is the single source of truth the next four weeks of surface
refinement must align to. Nothing below is aspirational — every decision
here reflects what the code actually enforces (or should enforce) after the
Phase Zero-One foundation pass.

---

## 1. Typography Hierarchy

### 1.1 Font Families

Governed by `client/src/fonts.css` via `[data-font-pairing]` on `<html>`.
Default pairing is **native** (zero font load, system stack). Fraunces-based
**editorial** is Tom's preferred pairing for the production app.

| Token           | Editorial value                                    | Role                              |
|-----------------|----------------------------------------------------|-----------------------------------|
| `--font-display`| Fraunces → system fallback                         | All headings, metric values       |
| `--font-sans`   | Inter → system fallback                            | All body copy, labels, UI chrome  |
| `--font-serif`  | Fraunces → Georgia fallback                        | Landing hero italic only          |
| `--font-mono`   | JetBrains Mono → system mono                       | Code, data feeds, JSON previews   |

**Sacred constraint**: The `font-italic` Fraunces hero on the landing page
(`/`) is untouchable. Do not change its family, size, or weight.

### 1.2 Named Levels

The app has informal typography scattered across today.css, index.css, and
inline Tailwind. This table makes it canonical. Use these names in code review.

| Level           | CSS class / token            | Font       | Size / Line-height | Weight | Letter-spacing | Use case                                      |
|-----------------|------------------------------|------------|--------------------|--------|----------------|-----------------------------------------------|
| **display**     | `.heading-display`           | display    | ~36–48px / 1.1     | 700    | −0.025em       | Landing hero only                             |
| **hero**        | `.acr-cc-greeting` / `text-hero`         | display    | 32px / 1.15        | 600    | −0.03em        | Page H1s (Today, Deals, Leads, Finance, etc.) |
| **section**     | `.acr-section-h2` / `text-section-h2`    | display    | 18px / 1.2         | 500    | −0.015em       | In-page section heads (Decision Queue, etc.)  |
| **subsection**  | `.heading-section`           | display    | ~20–24px / 1.25    | 600    | −0.015em       | Card titles, panel headers                    |
| **card-title**  | `text-2xl font-semibold`     | display    | 24px / tight       | 600    | −0.018em       | `CardTitle` default (currently inline)        |
| **label-sm**    | `.acr-section-title`         | sans       | 13px / 1           | 600    | −0.005em       | Widget row labels                             |
| **body**        | `text-sm` (14px)             | sans       | 14px / 1.43        | 400    | 0              | All prose, table cells, list items            |
| **body-strong** | `text-sm font-medium`        | sans       | 14px / 1.43        | 500    | 0              | Emphasized body (deal stage labels, etc.)     |
| **caption**     | `text-caption` / `.caption-label` | sans  | 11px / 14px        | 600    | +0.05em / +0.14em | Eyebrows, status labels, metric deltas  |
| **micro**       | `text-micro`                 | sans       | 10px / 12px        | varies | varies         | Badge counts, version strings                 |
| **mono**        | `font-mono text-xs`          | mono       | 12px / relaxed     | 400    | 0              | Code blocks, API tokens, lat/lng coords       |
| **metric-value**| `.acr-metric-value`          | display    | 22px / 1.1         | 600    | −0.02em        | Dashboard numeric KPIs                        |
| **data-label**  | `.data-label`                | sans       | 11px / 1           | 500    | +0.04em (caps) | Table column headers, stat labels             |
| **data-value**  | `.data-value`                | sans       | 13px / 1.4         | 600    | 0              | Table cell values with emphasis               |

**Base rule (index.css `@layer base`):** `h1–h6` use `--font-display`, weight
600, letter-spacing −0.018em. This applies unless a named level class overrides.

### 1.3 Tailwind font scale

Tailwind's default `text-*` scale is unchanged. Custom additions live in
`tailwind.config.ts theme.extend.fontSize`:

```
text-hero       → 32px / 1.15 line-height, weight 600   ← .acr-cc-greeting alias
text-section-h2 → 18px / 1.2  line-height, weight 500   ← .acr-section-h2 alias
text-caption    → 11px / 14px line-height
text-micro      → 10px / 12px line-height
```

`text-hero` and `text-section-h2` are Tailwind-queryable aliases for the
corresponding CSS classes. The CSS classes (`.acr-cc-greeting`, `.acr-section-h2`)
remain the canonical definitions — they additionally set `font-family`,
`letter-spacing`, `color`, and `font-variation-settings`. The Tailwind utilities
cover size + line-height + weight so the hierarchy is visible in component code
via `<h1 className="text-hero">`. **During migration, either form is valid; in
new code prefer the Tailwind utility.**

Everything below `text-micro` (8px, 9px) is non-semantic ornamentation
(badge counters, grade superscripts). These are allowed as `text-[Npx]`
ad-hocs but should use `text-micro` minimum whenever legibility matters.

### 1.4 Deviations flagged (do not fix in this pass)

- **`text-[9px]`** appears in: `layout-sidebar.tsx` (BETA badge), `pax-project-panel.tsx`,
  `pax-entity-picker.tsx`, `pax-copilot-rail.tsx`, `property-map.tsx`. These
  are below `text-micro`; acceptable for ornamentation, not for data.
- **`text-[8px]`** in `land-credit-badge.tsx` — grade superscript. Borderline;
  flag for surface-refinement pass.
- **`.acr-metric-label`** uses `11.5px` (non-standard). Should consolidate to
  `text-caption` (11px) in the today.css surface pass.
- **`CardTitle`** currently applies `text-2xl font-semibold leading-none tracking-tight`
  inline. The `tracking-tight` conflicts with the canonical −0.018em on `h*`
  elements. Surface-refinement pass should harmonize via the **subsection** level.
- **No `text-display` Tailwind token exists.** `.heading-display` is CSS-only.
  Consider adding `fontSize.display` to `tailwind.config.ts` in the next pass.

---

## 2. Motion Vocabulary

### 2.1 Canonical sources

| File | Role |
|------|------|
| `client/src/lib/motion-tokens.ts` | Single source of truth — durations, easings, springs, scales, named transitions, hooks |
| `client/src/lib/animations.ts` | Variant library consuming motion-tokens; re-exports `pageTransition` |
| `client/src/lib/motion.ts` | Legacy compatibility shim → re-exports motion-tokens; extend motion-tokens, not this |
| `client/src/index.css` | CSS-only animation keyframes (sidebar spring, page enter, toast slide, etc.) |

### 2.2 Duration table

From `motion-tokens.ts` `DURATIONS`:

| Name      | Value  | CSS token            | Use case                                                  |
|-----------|--------|----------------------|-----------------------------------------------------------|
| `instant` | 0.08s  | `--acr-dur-fast` 120ms* | Button tap feedback, instant state flips               |
| `fast`    | 0.15s  | `--acr-dur-fast`     | Hover reveals, dropdowns, toast slide, icon swap          |
| `normal`  | 0.25s  | `--acr-dur-normal`   | Page fade, list stagger, card mount, modal content        |
| `slow`    | 0.35s  | `--acr-dur-slow`     | Modal open, sheet push, spatial transitions               |
| `slower`  | 0.50s  | —                    | Onboarding reveals, hero entry, emphasis moments          |

*CSS duration tokens (120/240/320ms) are slightly faster than JS tokens
(150/250/350ms). This is intentional: CSS animations lack spring physics and
need shorter absolute durations to feel equivalent. They are not a conflict.

**Exit rule:** All exit transitions use `fast` (0.15s). An exit that outstays
its welcome is a UX tax. Never exit at `slow` or `slower`.

### 2.3 Easing vocabulary

From `EASINGS`:

| Name             | Curve                          | Alias              | Use case                                        |
|------------------|--------------------------------|--------------------|-------------------------------------------------|
| `linearExpo`     | cubic-bezier(.16, 1, .3, 1)   | `EASINGS.out` alias| Default — snappy start, soft landing            |
| `stripeStandard` | cubic-bezier(.4, 0, .2, 1)    | —                  | Modal/drawer symmetric in-out                   |
| `smoothOut`      | cubic-bezier(.25, .46, .45, .94)| `EASINGS.smoothOut`| Legacy slideUp/modalContent; matches CSS `--acr-ease-standard` |
| `anticipate`     | cubic-bezier(.34, 1.56, .64, 1)| —                  | Success/celebration micro-moments only          |
| `out`            | `"easeOut"` (Framer string)   | —                  | Simple reveal, no spatial snap                  |
| `inOut`          | `"easeInOut"` (Framer string) | —                  | Pulse animations, looping                       |

**CSS easing tokens** (index.css `:root`):
- `--acr-ease-spring`: cubic-bezier(.22, 1, .36, 1) → closest CSS proxy to `linearExpo`
- `--acr-ease-standard`: cubic-bezier(0.25, 0.46, 0.45, 0.94) → maps to `smoothOut`

### 2.4 Spring configs

From `SPRINGS`:

| Name          | Stiffness | Damping | Use case                                              |
|---------------|-----------|---------|-------------------------------------------------------|
| `snappy`      | 320       | 30      | Button tap, card hover, drag-end snap                 |
| `smooth`      | 300       | 25      | Modal/sheet entry, layout shifts                      |
| `gentle`      | 200       | 22      | Accordion panels, smooth scroll reveals               |
| `bouncy`      | 400       | 12      | Deal-closed celebration, milestone hit                |
| `interactive` | 220       | 26      | Apple-HIG press response (persona switcher, controls) |
| `soft`        | 140       | 22      | Chat composer, artifact reveals, long content cards   |

### 2.5 Named Variants

Prefer these imports over inline Variants:

| Export                  | Source           | Use case                                               |
|-------------------------|------------------|--------------------------------------------------------|
| `staggerContainer`      | animations.ts    | List/grid parent — stagger 0.05s, delay 0.02s          |
| `staggerItem`           | animations.ts    | List child — `normal` duration, `out` easing           |
| `pageTransition`        | animations.ts    | Route change — desktop x-slide, wraps `variantPageFade`|
| `variantPageFade`       | motion-tokens.ts | Desktop route enter (x: 8 → 0, opacity fade, `normal`)|
| `variantPageFadeMobile` | motion-tokens.ts | Mobile tab switch — pure opacity cross-fade, `fast`    |
| `modalContent`          | animations.ts    | Modal open — scale 0.95→1 + y: 8→0, `smoothOut`       |
| `fadeIn`                | animations.ts    | Simple opacity — `fast`                                |
| `fadeInUp`              | animations.ts    | Content reveal — y: 8→0, `normal`                     |
| `slideUp`               | animations.ts    | Panel reveal — y: 16→0, `normal`                      |
| `scaleIn`               | animations.ts    | Icon/thumbnail pop — scale 0.95→1, `fast`              |

### 2.6 Reduced-motion

Two layers handle this:

1. **CSS**: `@media (prefers-reduced-motion: reduce)` collapses ALL custom
   keyframes to `0.001ms` and kills `animation-iteration-count`. The named
   keyframes (`.page-enter`, `.toast-enter`, etc.) are individually nulled.
2. **JS/Framer**: `useRespectfulTransition(t)` and `useRespectfulVariants(v)`
   in `motion-tokens.ts` collapse to `{ duration: 0 }` noop.
3. **Manual override**: `[data-motion="reduced"]` on `<html>` collapses the
   CSS duration tokens to 30/60ms (via `:root` selector block in index.css).

Rule: any component adding spatial movement (translate, scale, rotate) MUST
wrap its transition in `useRespectfulTransition` or `useRespectfulVariants`.

### 2.7 Deviations flagged (do not fix in this pass)

- **Inline magic numbers still present** in: `ContentReveal.tsx` (`0.15`),
  `dynamic-island.tsx` (`0.22`, `0.2`, `0.12`, `0.08`), `query-error-state.tsx`
  (`0.4`), `getting-started-checklist.tsx` (`0.3`), `onboarding-wizard.tsx`
  (`0.2`), `SwipeDecisionCard.tsx` (`0.2`). Surface-refinement pass should
  migrate these to `DURATIONS.*`.
- **`animate-in` utility** (index.css line 1140) uses `0.35s` and a non-token
  easing inline. Not consumed by any production surface (Maren's page cut may
  eliminate the callers). Mark for removal after the cut.
- **`card-hover` utility** (index.css) duplicates the `cardHover` framer
  object in animations.ts. Only Framer version is used. CSS class is dead.

---

## 3. Color Story

### 3.1 Token architecture

Two parallel token systems coexist — by design, not by accident:

**System A — `--acr-*` hex tokens** (direct hex or rgba values)
Used for: precise semantic color (brand, ink, surface, semantic states).
Consumed via `bg-acr-brand`, `text-acr-ink-3`, etc. (Tailwind `acr.*` map).
Cannot use `bg-acr-brand/50` alpha-modifier syntax since the values are raw hex.
Use `-soft` variants (pre-computed rgba) for tinted/transparent versions.

**System B — HSL parallel (`--background`, `--primary`, etc.)**
Used for: shadcn/ui component defaults, Tailwind's `bg-background`, `text-foreground`.
Alpha-modifier compatible: `bg-primary/40` works.

Both systems must stay in sync. Per-theme blocks in `index.css` define both
for every theme × mode combination.

### 3.2 Semantic token matrix

| Token             | Light meaning                        | Dark meaning                         | When to use                               |
|-------------------|--------------------------------------|--------------------------------------|-------------------------------------------|
| `--acr-bg`        | Page base (e.g. Bedrock #EDE3D0)     | Page base (e.g. Bedrock #13100B)     | `<body>` background, full-bleed pages     |
| `--acr-bg-sunken` | Sunken wells (inputs, troughs)        | Sunken wells                         | Form inputs, table `thead`, code blocks   |
| `--acr-bg-raised` | Slightly lifted (page surface)        | Slightly lifted                      | Primary content area surfaces             |
| `--acr-surface`   | Card/panel base                       | Card/panel base                      | Cards, modals, drawers                    |
| `--acr-surface-2` | Secondary surface (nested cards)      | Secondary surface                    | Nested panels, sidebar sections           |
| `--acr-ink`       | Primary text (≥4.5:1 contrast)        | Primary text                         | H1-H6, body, labels                       |
| `--acr-ink-2`     | Secondary text (4.5:1)                | Secondary text                       | Supporting labels, descriptions           |
| `--acr-ink-3`     | Tertiary text (≥4.5:1 WCAG-AA)        | Tertiary text (WCAG-AA tuned)        | Placeholders, captions, meta text         |
| `--acr-ink-4`     | Disabled / ghost text                 | Disabled / ghost text                | Disabled states, very low emphasis        |
| `--acr-line`      | Primary separator (14–18% opacity)    | Primary separator (10% opacity)      | Dividers, card borders, table rows        |
| `--acr-line-soft` | Subtle separator (7–8% opacity)       | Subtle separator (5% opacity)        | Inter-cell dividers, inset borders        |
| `--acr-brand`     | Brand primary (terracotta family)     | Brand primary (brighter for dark bg) | CTAs, active states, focus rings          |
| `--acr-brand-ink` | Text on brand surfaces                | Text on brand surfaces               | Button labels on brand backgrounds        |
| `--acr-brand-soft`| Tinted brand wash (10–18% opacity)    | Tinted brand wash                    | Hover states, selected backgrounds        |
| `--acr-accent`    | Secondary accent (theme-varied)       | Secondary accent                     | Charts, highlights, secondary CTAs        |
| `--acr-pos`       | Positive / success                    | Positive / success                   | Gains, confirmations, green states        |
| `--acr-pos-soft`  | Positive wash                         | Positive wash                        | Success banners, confirmation highlights  |
| `--acr-warn`      | Warning / caution                     | Warning / caution                    | Overdue, pending, moderate risk           |
| `--acr-warn-soft` | Warning wash                          | Warning wash                         | Warning banners, caution backgrounds      |
| `--acr-neg`       | Negative / error / danger             | Negative / error / danger            | Losses, errors, destructive confirmations |
| `--acr-neg-soft`  | Negative wash                         | Negative wash                        | Error state backgrounds                   |
| `--acr-glow`      | Brand glow (used in ::after glows)    | Brand glow (intensified)             | Focus halos, spotlight effects            |
| `--acr-bridge-accent` | #FFB547 (constant)               | #FFB547 (constant)                   | Bridge "live/active/now" indicator only   |

### 3.2.1 Heat semantic tier (Kai's finding #1 — closed 2026-06-01)

Heat tokens encode **activity / demand intensity** — not outcome sentiment. This
is why they are a separate tier from `--acr-neg/warn/pos`. A "hot" market is
desirable; a "hot" error state is bad. Conflating them (the old hardcoded-hex
approach) made the distinction invisible.

| Token                    | Semantic meaning                                 | Usage sites                              |
|--------------------------|--------------------------------------------------|------------------------------------------|
| `--acr-heat-cold`        | Quiet / zero activity / cold signal              | Score bars ≤39, cold county demand       |
| `--acr-heat-warm`        | Building / medium activity / warm signal         | Score bars 40–79, warm county demand     |
| `--acr-heat-hot`         | High / active / hot signal (positive intensity)  | Score bars ≥80, hot county demand        |
| `--acr-heat-cold-soft`   | Tinted fill for cold regions / bars              | Recharts `Cell` fill, badge backgrounds  |
| `--acr-heat-warm-soft`   | Tinted fill for warm regions / bars              | Recharts `Cell` fill, badge backgrounds  |
| `--acr-heat-hot-soft`    | Tinted fill for hot regions / bars               | Recharts `Cell` fill, badge backgrounds  |

**Theme mapping strategy:** Each theme maps heat tokens to its own `warn` /
`neg` / `ink-3` values so the hot-warm-cold gradient always coheres with the
brand palette. Homestead orange-red carries the gradient; Slate blue carries
a blue-amber-red gradient; Meadow green uses an amber/terracotta gradient. The
semantic meaning (intensity) is preserved; only the hue varies by theme.

Tailwind utilities: `text-acr-heat-cold`, `bg-acr-heat-warm`, etc. via the
`acr.heat-*` map in `tailwind.config.ts`.

**Rule:** Any component encoding demand/activity intensity (buyer heat maps,
acquisition radar scores, deal temperature) MUST use `--acr-heat-*` tokens.
Never use raw hex for this semantic category.

### 3.3 Theme palette summary

Five themes × 2 modes = 10 palette blocks. Each is visually coherent:

| Theme       | Brand family      | Accent             | Pos family  | Neg family      |
|-------------|-------------------|--------------------|-------------|-----------------|
| **Bedrock** | Rust/terracotta   | Dust gold          | Moss green  | Dried blood     |
| **Homestead**| Orange-terracotta| Teal               | Forest green| Orange-red      |
| **Quarry**  | Crimson red       | Near-black/neutral | Emerald     | Crimson (same)  |
| **Nocturne**| Warm red          | Near-black/white   | Forest green| Warm red (same) |
| **Meadow**  | Forest green      | Gold               | Forest green (same) | Terracotta |
| **Slate**   | Blue              | Teal               | Teal-green  | Rose-red        |

**Note (Quarry + Nocturne):** `--acr-brand` and `--acr-neg` share the same
hue family in both themes. This is intentional (monochrome + accent approach)
but means the brand color cannot signal positivity alone — context always
disambiguates.

### 3.4 Shadow system — two tracks

Track 1 — **mode-independent** (`--shadow-1` through `--shadow-4`, index.css `:root`):
Uses neutral rgba. Consumed by `.glass-panel`, `.liquid-glass*`, `.elevation-*`.

Track 2 — **theme-aware** (`--acr-shadow-1` through `--acr-shadow-3`, per-theme):
Uses the theme's ink color as shadow hue. Consumed by Tailwind `shadow-acr-1/2/3`.

Rule: Use **Track 2** (`shadow-acr-*`) for content cards and surfaces. Use
**Track 1** (`shadow-level-*`) only for glass/overlay surfaces that must be
theme-neutral.

### 3.5 Hardcoded colors flagged (not fixed in this pass — too scattered)

These pages use raw hex instead of `--acr-*` tokens:

| File                      | Violation                                      | Correct token              |
|---------------------------|------------------------------------------------|----------------------------|
| `land-credit.tsx`         | Score color (#10b981, #22c55e, #f59e0b, etc.)  | `var(--acr-pos)`, `var(--acr-warn)`, `var(--acr-neg)` |
| `buyer-network.tsx`       | ~~Heat-map colors~~ **✓ CLOSED 2026-06-01**    | `var(--acr-heat-hot/warm/cold)` — migrated  |
| `founder-trends.tsx`      | Chart series colors array                      | `var(--acr-chart-a/b/c/d)` |
| `voice-analytics.tsx`     | Sentiment colors                               | `var(--acr-pos/warn/neg)`  |
| `negotiation-copilot.tsx` | Pressure color (#22c55e etc.)                  | `var(--acr-pos)`           |
| `portfolio-optimizer.tsx` | Pie colors + risk colors                       | `var(--acr-chart-a/b/c/d)` |
| `acquisition-radar.tsx`   | ~~Heat scores~~ **✓ CLOSED 2026-06-01**        | `var(--acr-heat-hot/warm/cold)` — migrated  |
| `avm.tsx`                 | Chart gradient stopColor                       | `var(--acr-brand)`         |
| `borrower-portal.tsx`     | 3× background gradients (#F5E6D3, etc.)        | `var(--acr-bg-raised)`, `var(--acr-bg-sunken)` |
| `maps.tsx`                | ~~Map pin / score colors~~ **✓ CLOSED 2026-06-01** | `var(--acr-heat-*)`, `var(--acr-pos/warn/neg)` — migrated |
| `index.css` (`.traffic-light-close`) | `background: #FF5F57`             | Intentional macOS chrome. Add `/* macOS system red — intentional */` comment. |

**Most critical** for brand consistency: `borrower-portal.tsx` (3 separate
gradient backgrounds that will render wrong on non-Homestead themes) and
`buyer-network.tsx` (customer-facing heat-map colors).

### 3.6 Near-duplicate tokens (consolidation candidates)

- **`vibrancy-sidebar` vs `sidebar-vibrancy`**: Two nearly-identical CSS
  classes both blur/saturate the sidebar background. `vibrancy-sidebar` is
  used in `layout-sidebar.tsx` on the customer nav; `sidebar-vibrancy` is used
  on the desktop sidebar variant at the bottom of the same file. Their raw RGBA
  values differ slightly (Homestead-assumed hex vs the CSS-var-based version).
  **Atomic fix committed in this pass.** See refactor commit 1.
- **`hover-elevate` CSS class vs Framer `cardHover`**: The CSS hover utility
  produces `bg-foreground/5` — Framer produces `scale(1.02)` spring. They are
  fundamentally different interactions. Both are valid, but callers must choose
  consciously. Document: `hover-elevate` = touch-safe hover highlight (no
  transform); `cardHover` (Framer) = desktop-only lift (transform). Never
  combine both on one element.
- **`acr-ink-4` (near-invisible)**: Consumed by zero components in the app.
  The token exists for completeness. Reserved for future disabled/ghost states.

---

## 4. Component Primitive Inventory

### 4.1 Button

**Status: Canonical** with one wart.

Variants: `default`, `destructive`, `outline`, `secondary`, `ghost`, `glass`
Sizes: `default`, `sm`, `lg`, `icon`

Audit findings:
- **`outline` variant** uses `[border-color:var(--button-outline)]` — the CSS var
  `--button-outline` is never defined in `index.css`. The border renders as
  the Tailwind default `border` color. This is an invisible gap.
  **Atomic fix committed in this pass.** See refactor commit 2.
- **`shadow-xs`** used in `outline` variant. Not defined in `tailwind.config.ts`.
  Tailwind v4 includes it natively; if using v3 this silently drops.
  Confirm in `npm run check` results.
- **`glass` variant** is genuinely distinct (liquid-glass material, hover lift).
  Keep.
- **All sizes** correctly enforce WCAG 2.1 SC 2.5.5 44px touch targets on mobile.

### 4.2 Card

**Status: Canonical — small fix pending.**

Variants: `default` (elevated border + shadow), `glass` (liquid-glass material)
Both use `rounded-card` (14px) correctly.

`CardTitle` applies `text-2xl font-semibold leading-none tracking-tight`.
The `tracking-tight` is Tailwind's `−0.025em` which conflicts with the system's
h-element `letter-spacing: −0.018em`. In practice unnoticeable but the two
values should align. Defer to surface-refinement type pass.

### 4.3 Input / Textarea / Select

**Status: Consistent** — all use shadcn defaults with `--acr-bg-sunken` for
the field background and `--acr-ink` for text. Verified by inspecting
`input.tsx`, `textarea.tsx`, `select.tsx`. No deviations found.

### 4.4 Dialog / Sheet / Drawer

**Status: Canonical** — with gesture support confirmed.

`Dialog` (`dialog.tsx`): includes macOS-style traffic-light close button
(`.traffic-light-close`). Hardcoded `#FF5F57` in `index.css` is intentional
macOS chrome, not a theme-color violation. Should be commented as such.

`Sheet` and `Drawer`: wave-3 gesture support present. `ResponsiveModal`
(`responsive-modal.tsx`) composes Dialog (desktop) / Sheet (mobile) — this
is the canonical pattern for form overlays. Well-implemented.

**Rule for new overlays:** default to `ResponsiveModal`, not raw `Dialog`.
Raw `Dialog` only when the desktop-only centered presentation is semantically
correct (e.g. destructive confirmations that should not be bottom-sheet).

### 4.5 Skeleton / EmptyState / QueryErrorState

**Status: Skeleton canonical; EmptyState fragmented; QueryErrorState canonical.**

- `Skeleton` (`skeleton.tsx`): excellent — a11y-correct with `role="status"` +
  `aria-busy` + `aria-live`. `announceText` and `announce` props for
  deduplication. **Use this always.**

- `skeleton-card.tsx`, `skeleton-list.tsx`, `skeleton-table.tsx`: purpose-built
  shape skeletons. Good pattern — they compose `Skeleton` internally.

- **`EmptyState` problem**: Two separate component files exist:
  - `components/empty-state.tsx` (singular) — general purpose
  - `components/empty-states.tsx` (plural) — appears to be a collection
  - `components/empty-states/` directory with 5 named variants

  This creates a three-way import confusion. Surface-refinement pass should
  audit which form is the source of truth and deprecate the others.

- `QueryErrorState` (`components/query-error-state.tsx`): canonical, retry
  support present, has inline motion with `duration: 0.4` magic number.
  Use this always for failed data fetches.

### 4.6 Badge

**Status: Mostly canonical** — uses `shadow-xs` (same undefined-token risk
as Button `outline`). The `hover-elevate` class baked into badge's base CVA
string is surprising — badges are not typically interactive. This was likely
added for clickable filter-chips. Consider whether it belongs on the base
primitive or only on the `filters-chip.tsx` wrapper.

### 4.7 Glass utilities

Four CSS classes for glass material:

| Class | Blur | Saturation | Use case |
|-------|------|------------|----------|
| `.glass-panel` | 32px | 190% | Full-page overlays, large panels |
| `.liquid-glass` | 32px | 190% | Cards, modals on blurred backgrounds |
| `.liquid-glass-sm` | 16px | 180% | Smaller elements (button `glass` variant) |
| `.liquid-glass-subtle` | 20px | 175% | Background hints, very lightweight |

All four correctly implement the `::after` cursor-reactive specular from
Phase 10. Reduced-motion disables the opacity transition. Well-implemented.

### 4.8 Primitive status summary

| Primitive | Status | Action needed |
|-----------|--------|---------------|
| Button | Canonical | Fix `--button-outline` undefined (committed) |
| Card | Canonical | Align `CardTitle` letter-spacing in type pass |
| Input/Textarea/Select | Canonical | None |
| Dialog | Canonical | Comment `#FF5F57` as intentional |
| Sheet / Drawer | Canonical | None |
| ResponsiveModal | Canonical | Prefer over raw Dialog for all new overlays |
| Skeleton | Canonical | None |
| Skeleton-card/list/table | Canonical | None |
| EmptyState | **Fragmented** | Audit + consolidate 3 locations in next pass |
| QueryErrorState | Canonical | Migrate `duration: 0.4` magic number to `DURATIONS.slow` |
| Badge | Needs work | Review `hover-elevate` on base primitive |
| Responsive-modal | Canonical | None |
| Glass utilities | Canonical | None |
| animated-list | Canonical | Thin wrapper, fine |
| page-header | Read-only | Fine |

---

## 5. Open Questions for Tom

Only the decisions Kai genuinely cannot make unilaterally.

**Q1 — Editorial vs Native as shipped default.**
`fonts.css` sets `native` (system stack) as the default pairing (`:root` block).
The editorial (Fraunces) pairing requires `[data-font-pairing="editorial"]` on
`<html>`. If the app ships with the wrong pairing attribute, customers see SF Pro
Display instead of Fraunces. Which pairing should be the production default, and
where is that attribute set (theme-context.tsx)? Kai's recommendation: ship
editorial as default — the Fraunces personality is the brand. But this is a
product call.

**Q2 — Five themes: how many are customer-facing on launch?**
All five themes (Bedrock, Homestead, Quarry, Nocturne, Meadow, Slate) are fully
implemented. The Settings > Appearance panel presumably exposes all of them.
Should launch-day restrict to two or three? Kai's concern: theme proliferation
raises QA surface (every new component must be visually checked across 10 combos).
Tom's call on launch scope.

**Q3 — `borrower-portal.tsx` hardcoded backgrounds.**
Three gradient backgrounds in `borrower-portal.tsx` use raw hex values that
pin to Homestead light. Maren's page cut may remove this page entirely. If it
survives, it needs a token migration. Clarify with Maren first.

---

## 6. Phase Zero-One Atomic Refactors

Three atomic refactors shipped alongside this doc:

**Refactor 1 — `design(foundation): index.css — consolidate dual sidebar vibrancy classes`**
Removed `.vibrancy-sidebar` (the homestead-hardcoded rgba version). Kept
`.sidebar-vibrancy` (Phase 9 block) which uses the same rgba values but is
the one actually called by the desktop sidebar variant. Updated `.vibrancy-sidebar`
callers in `layout-sidebar.tsx` to use `.sidebar-vibrancy`. Both were nearly
identical; one was dead weight.

**Refactor 2 — `design(foundation): button.tsx — define --button-outline token`**
The `outline` variant referenced `var(--button-outline)` which was never defined.
Added `--button-outline: var(--acr-line);` to index.css `:root` (and `.dark`
override `var(--acr-line)` is already correct since `--acr-line` is theme+mode
aware). This also applies to Badge's identical `--badge-outline` gap.

**Refactor 3 — `design(foundation): motion-tokens.ts — annotate variantPageFade exit`**
The exit transition on `variantPageFade` used `DURATIONS.fast` (0.15s) with
`EASINGS.linearExpo` — correct. Added a code comment naming it per the exit rule
("exits run at `fast` — never slower") so the intent survives future edits.

---

## 7. Surface Refinement Priority Queue (next sessions)

The three issues that will have the highest visual impact when fixed:

**1. Type hierarchy alignment across page H1s. ✓ RESOLVED.**
`.acr-cc-greeting` and `.acr-section-h2` migrated from `today.css` to
`index.css` (TYPOGRAPHY HIERARCHY block) and aliased as `text-hero` /
`text-section-h2` in `tailwind.config.ts`. The tree-shake risk is eliminated.
`today.css` retains the original declarations for backward compat with existing
page imports, but `index.css` is now the canonical source.

**2. Hardcoded chart colors on customer-facing pages. ✓ CLOSED 2026-06-01.**
`buyer-network.tsx`, `acquisition-radar.tsx`, and `maps.tsx` previously used raw
hex for color-semantic data (hot/warm/cold, interested/not-interested). Migrated
to the new `--acr-heat-*` semantic token family. See §3.2.1. Ten hardcoded hex
sites replaced across three files.

**3. EmptyState consolidation.**
Three import paths for EmptyState create inconsistent CTA patterns across surfaces.
A unified `<EmptyState>` with a required `cta` prop and optional `illustration`
would enforce the "purposeful CTA" rule from CLAUDE.md and eliminate the
guess-work of which version to reach for.
