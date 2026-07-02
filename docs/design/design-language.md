# AcreOS Design Language

> **Canonical, code-synced source of truth for the AcreOS visual + interaction
> system.** This document supersedes `docs/design/SYSTEM-V1.md` (Kai Brennan,
> 2026-06-01) and `docs/unified-build/DESIGN-SYSTEM.md`. Those remain as history
> but are no longer authoritative — when they disagree with this file, this file
> wins.
>
> **Status:** Phase 2 (Tahoe elevation) — Wave F foundation. Strategic frame:
> AcreOS is "a Snow Leopard with a Tahoe-grade materials kit already installed."
> The kit (materials, motion, themes, type) is built; this document *consolidates*
> it into one switchable system, codifies the three green-field scales
> (spacing/grid, z-index, translucency), and points at the CI ratchets that
> enforce it. See `docs/internal/roadmap/elevation-arc-snow-leopard-tahoe.md`.
>
> **Code-synced contract:** every token table below names its source file. When
> the code changes, this doc changes in the same commit. NEW design-token drift
> fails `npm run check` (see §7 Enforcement). This is not aspirational — it is
> the ratchet-locked reality.

---

## 0. Founder decisions in force (2026-06-11)

These gate the Phase-2 elevation and are settled:

1. **Bold re-skin** on the existing kit — a deliberate new visual identity pass,
   not just consolidation. Sequencing: foundation (this doc + the 3 token scales
   + ratchets) → bold re-skin (Wave R) → signature moments (Wave S).
2. **Glass/depth is the systematic house language.** Liquid-glass + tokenized
   depth (z-index + translucency) is committed system-wide — AcreOS is a
   Tahoe-depth product. See §2 Materials.
3. **2–3 flagship themes** designed + QA'd to the full bar; the rest stay
   available but flagged experimental/extended. See §1.1.
4. **Default font pairing is `editorial`** (Fraunces display + Inter body) — the
   brand-preferred editorial-mechanical identity. Shipped Wave F (was `native`).
   See §1.2.
5. **CI-ratchet enforcement** (not Storybook) — the team's established pattern,
   no ongoing catalog cost. See §7.
6. **SYSTEM-V1 is blessed as canonical** and folded into this document; the stale
   DESIGN-SYSTEM.md is superseded.

---

## 1. Foundations

### 1.1 Color

#### Dual-token architecture

Two parallel token systems coexist **by design**:

- **System A — `--acr-*` raw tokens** (hex / rgba). Precise semantic color
  (brand, ink, surface, semantic states, heat, density, charts). Consumed via
  Tailwind's `acr.*` map: `bg-acr-brand`, `text-acr-ink-3`. Alpha modifiers
  (`bg-acr-brand/50`) resolve through CSS `color-mix` via the `acrToken`
  wrapper in `tailwind.config.ts` (before 2026-07-02 they silently compiled
  to NOTHING — ~650 authored washes rendered no color at all). Prefer the
  pre-computed `-soft` variants for the standard tinted surface; use a
  literal modifier only when a non-standard alpha is genuinely needed.
- **System B — shadcn HSL parallel** (`--background`, `--primary`, `--card` …,
  emitted as `H S% L%` triplets). Drives shadcn/ui defaults and Tailwind's
  `bg-background`, `text-foreground`, and **is** alpha-modifier compatible
  (`bg-primary/40` works).

Both systems must stay in sync. Each theme × mode block in
`client/src/index.css` defines **both**. Source: `client/src/index.css`
(per-theme `[data-theme="…"]:root` / `[data-theme="…"].dark` blocks) +
`tailwind.config.ts` (`theme.extend.colors`).

#### Semantic `--acr-*` token matrix

| Token | Role | When to use |
|---|---|---|
| `--acr-bg` | Page base | `<body>`, full-bleed pages |
| `--acr-bg-sunken` | Recessed wells | Inputs, `thead`, code blocks |
| `--acr-bg-raised` | Lifted page surface | Primary content surfaces |
| `--acr-surface` / `--acr-surface-2` | Card base / nested | Cards, modals; nested panels, sidebar sections |
| `--acr-ink` … `--acr-ink-4` | Text ramp, primary→ghost | H1–H6/body → disabled (`ink-4` reserved) |
| `--acr-line` / `--acr-line-soft` | Separators | Dividers, borders / inset hairlines |
| `--acr-brand` / `-ink` / `-soft` | Brand primary / on-brand text / tinted wash | CTAs, active states, focus; button labels; hover/selected bg |
| `--acr-accent` | Secondary accent | Charts, highlights, secondary CTAs |
| `--acr-pos` / `-soft`, `--acr-warn` / `-soft`, `--acr-neg` / `-soft` | Outcome **sentiment** | Gains/confirmations · overdue/pending · losses/errors |
| `--acr-glow` | Brand glow | Focus halos, spotlight effects |
| `--acr-ring` | Focus ring | `0 0 0 3px` brand-tinted, per-theme |
| `--acr-chart-a…d` | Chart series | Recharts series colors (never raw hex) |
| `--acr-bridge-accent` | `#FFB547` constant | Bridge "live/active/now" indicator only |
| `--acr-portal-from` / `-to` | Borrower-portal parchment gradient | Public portal surface only |

#### Semantic ramps most systems never make

These are **separate tiers** because they encode different meaning, and
conflating them (the old raw-hex approach) made the distinction invisible:

- **Heat = activity / demand intensity, NOT outcome sentiment.** A "hot" market
  is desirable; a "hot" error is bad. Tokens: `--acr-heat-cold` / `-warm` /
  `-hot` (+ `-soft` fills). Each theme maps these to its own warn/neg/ink-3 so
  the cold→hot gradient always coheres with the palette while preserving the
  intensity meaning. **Rule:** anything encoding demand/activity intensity (heat
  maps, acquisition-radar scores, deal temperature) MUST use `--acr-heat-*`.
- **Density = choropleth intensity**, sentiment-separated the same way.

#### The 6 themes — flagship vs extended

Six themes × light/dark (`ThemeId = bedrock | homestead | quarry | nocturne |
meadow | slate`, see `client/src/contexts/theme-context.tsx`). Per founder
decision, the re-skin designs + QAs **3 flagship themes** to the full bar; the
other three stay available but **flagged experimental/extended** (kept working,
not re-skin-QA'd across every component × 2 modes).

**★ FLAGSHIP (design + QA to the full bar):**

| Theme | Mode focus | Why flagship |
|---|---|---|
| **★ Bedrock** | light (brand default) | The brand default (`DEFAULT_CONFIG.theme = "bedrock"`); carries the global `:root` defaults. Rust/terracotta on cream — the editorial-mechanical identity the Fraunces default is built for. |
| **★ Nocturne** | dark | The strongest dark theme — warm-red brand on near-black, a purpose-built monochrome+accent dark identity that pairs naturally with the editorial re-skin. The flagship dark. |
| **★ Slate** | light + dark | The most differentiated non-terracotta palette (blue/teal, true-white surfaces). The "cool/professional" alternative that broadens appeal without exploding QA. |

**Extended / experimental (available, not re-skin-QA'd):** Homestead
(orange-terracotta + teal), Quarry (crimson monochrome + accent), Meadow (forest
green + gold).

Palette families (all six, `index.css`):

| Theme | Brand | Accent | Pos | Neg |
|---|---|---|---|---|
| ★ Bedrock | Rust/terracotta | Dust gold | Moss green | Dried blood |
| Homestead | Orange-terracotta | Teal | Forest green | Orange-red |
| Quarry | Crimson | Near-black/neutral | Emerald | Crimson (same) |
| ★ Nocturne | Warm red | Near-black/white | Forest green | Warm red (same) |
| Meadow | Forest green | Gold | Forest green (same) | Terracotta |
| ★ Slate | Blue | Teal | Teal-green | Rose-red |

Quarry + Nocturne intentionally share brand/neg hue (monochrome + accent) —
context disambiguates.

#### Residual hex debt → drive-to-zero

Two distinct debts, both tracked:

- **`lint:page-hex` baseline — 6 files / 6 sites** (the lint-guarded set):
  `reseller-dashboard.tsx` (×2), `founder/bridge.tsx`, landing `Hero.tsx`,
  `Agents.tsx`, `Features.tsx`. Bidirectional ratchet — can only move down.
- **Broader untokenized-hex debt — ~30 files** noted in the census (stale
  ledger; not all lint-guarded yet). Drive-to-zero as files are touched (the
  re-skin will sweep most). Known sites from SYSTEM-V1 §3.5: `land-credit.tsx`,
  `founder-trends.tsx`, `voice-analytics.tsx`, `negotiation-copilot.tsx`,
  `portfolio-optimizer.tsx`, `avm.tsx`, `borrower-portal.tsx` (now tokenized via
  `--acr-portal-*`). **Intentional, keep:** `.traffic-light-close: #FF5F57`
  (macOS system chrome).

### 1.2 Typography

#### Pairings + the editorial default

Five font pairings, switched via `[data-font-pairing]` on `<html>`
(`theme-context.tsx`), self-hosted latin-subset variable woff2 in
`client/public/fonts/`. Source: `client/src/fonts.css`.

| Pairing | Display | Body | Notes |
|---|---|---|---|
| **★ editorial (DEFAULT)** | **Fraunces** | Inter | Brand identity. `:root` resolves here. |
| modern | Inter Tight | Inter | All-sans, tighter display |
| classic | Source Serif 4 | Inter | Stronger serif voice |
| native | system stack | system stack | Zero font load (opt-in) |
| refined | Newsreader | Inter | Soft editorial register |

Mono is **JetBrains Mono** in every non-native pairing. All faces use
`font-display: swap` (Lexend, the dyslexia-friendly opt-in, uses
`font-display: optional` so it never costs CLS on the cold path).

**Editorial-as-default (Wave F, 2026-06-11):** the default flipped from `native`
to `editorial` so a fresh load shows the Fraunces display serif on headings. The
default is set in **three coherent places**, all now resolving to editorial:

1. `client/src/contexts/theme-context.tsx` — `DEFAULT_CONFIG.fontPairing`
   (runtime initial value).
2. `client/src/fonts.css` — the bare `:root` block (CSS fallback before the
   attribute is set; shares the selector with `[data-font-pairing="editorial"]`).
3. `server/routes-preferences.ts` — `DEFAULT_PREFERENCES.fontPairing`
   (server-synced accounts).

**CLS-safety:** Fraunces + Inter ship `font-display: swap` — text paints
immediately in the fallback stack (each `--font-*` var lists a system fallback
chain), then swaps to the loaded face. The cold path stays CLS-safe; zero CLS
budget is consumed by the editorial default.

#### h1–h6 display coupling (intentional)

Base rule, `index.css @layer base`: `h1–h6 { font-family: var(--font-display);
font-weight: 600; letter-spacing: -0.018em; }`. Under the editorial default this
renders headings in Fraunces. This coupling is deliberate — a named level class
(below) overrides only when explicitly applied.

#### Type scale (ported from SYSTEM-V1 §1.2)

| Level | Class / token | Font | Size / LH | Weight | Tracking | Use |
|---|---|---|---|---|---|---|
| display | `.heading-display` | display | ~36–48 / 1.1 | 700 | −0.025em | Landing hero only |
| hero | `.acr-cc-greeting` / `text-hero` | display | 32 / 1.15 | 600 | −0.03em | Page H1s |
| section | `.acr-section-h2` / `text-section-h2` | display | 18 / 1.2 | 500 | −0.015em | In-page section heads |
| subsection | `.heading-section` | display | ~20–24 / 1.25 | 600 | −0.015em | Card titles, panel headers |
| card-title | `text-2xl font-semibold` | display | 24 / tight | 600 | −0.018em | `CardTitle` default |
| label-sm | `.acr-section-title` | sans | 13 / 1 | 600 | −0.005em | Widget row labels |
| body | `text-sm` | sans | 14 / 1.43 | 400 | 0 | Prose, cells, list items |
| body-strong | `text-sm font-medium` | sans | 14 / 1.43 | 500 | 0 | Emphasized body |
| caption | `text-caption` / `.caption-label` | sans | 11 / 14 | 600 | +0.05 / +0.14em | Eyebrows, status |
| micro | `text-micro` | sans | 10 / 12 | varies | varies | Badge counts, versions |
| mono | `font-mono text-xs` | mono | 12 / relaxed | 400 | 0 | Code, coords, JSON |
| metric-value | `.acr-metric-value` | display | 22 / 1.1 | 600 | −0.02em | Dashboard KPIs |
| data-label | `.data-label` | sans | 11 / 1 | 500 | +0.04em caps | Column headers, stat labels |
| data-value | `.data-value` | sans | 13 / 1.4 | 600 | 0 | Emphasized cell values |

Tailwind aliases (`tailwind.config.ts theme.extend.fontSize`): `text-hero`,
`text-section-h2`, `text-caption`, `text-micro`. The `.acr-*` CSS classes remain
canonical (they also set family + tracking + color); the utilities cover
size/LH/weight for in-markup hierarchy. In new code prefer the utility.

**Sacred constraint:** the `font-italic` Fraunces hero on the landing page (`/`)
is untouchable — family, size, weight.

**Open warts (SYSTEM-V1 §1.4):** sub-`text-micro` ornamentation
(`text-[9px]`/`text-[8px]`); `.acr-metric-label` 11.5px → consolidate to
`text-caption`; `CardTitle` inline `tracking-tight` (−0.025em) conflicts with the
canonical −0.018em; no `text-display` Tailwind token (`.heading-display` is
CSS-only).

### 1.3 Spacing / grid / measure (F3 — codify the implicit rhythm)

There is no custom spacing scale; **the Tailwind default scale IS the system.**
This section codifies the 4pt rhythm that exists implicitly so it stops being a
green field. Source: Tailwind defaults + `tailwind.config.ts`.

- **4pt rhythm.** Tailwind's spacing unit is `0.25rem = 4px`. Every gap, pad,
  and margin is a multiple of 4 (`p-2`=8, `gap-3`=12, `p-4`=16, `gap-6`=24,
  `p-8`=32). Do not use `p-[Npx]` ad-hocs that break the 4pt grid; if a value
  isn't on the scale, it's almost always wrong.
- **Vertical rhythm.** Card interiors `p-4`/`p-6`; section stacks `space-y-4` /
  `space-y-6`; tight metadata rows `gap-1`/`gap-2`.
- **Container / measure.** Page chassis come from the layout shells (§4); prose
  measure caps via the `@tailwindcss/typography` `prose` plugin + explicit
  `max-w-*` on long-form text (target ~65ch for body). Full-bleed data surfaces
  (maps, tables) opt out of the measure cap deliberately.
- **Radius scale** (`tailwind.config.ts borderRadius`): `sm` 3px · `md` 8px ·
  **`card` 14px (locked, design-system §0.2)** · `lg` 16px · `xl` 20px ·
  `2xl` 24px · `full` capsule. **Use `rounded-card` on cardish surfaces** — do
  not approximate with `lg`. It sits intentionally between `md` and `lg`.
- **Pointer-density model (do-not-touch invariant).** Touch-target sizing
  follows **pointer type, not viewport width.** The `pointer-coarse:` /
  `pointer-fine:` variants (`tailwind.config.ts` plugin) gate the 44px
  Apple-HIG floor: a control stays dense for mouse users at any width
  (`pointer-fine:`) while holding `pointer-coarse:min-h-11` whenever the primary
  input is a finger. Keying density to `sm:` (≥640px) silently under-sized
  controls on touch tablets (a 768px iPad lands on the desktop arm with a finger)
  — that bug is why this model exists. The `sm:` arm compiles AFTER
  `pointer-coarse:` and wins for the mouse case; do not reorder.

### 1.4 Elevation + z-index + translucency (the unified depth layer)

Depth is now **one coherent, tokenized system** — the F1 + F2 foundation that
makes glass the house language (founder decision §0.2).

#### Z-index — semantic stacking scale (F1)

Before this, z-index was entirely ad-hoc (52× `z-50`, 44× `z-10`, plus
`z-[60]`/`z-[100]`/`z-[9999]`), and the same numbers were reused for unrelated
roles — causing stacking bugs (FAB-over-FAB; founder tab list over the settings
gear). The fix is a single **semantic** scale; the numbers are derived from the
existing anchors so the migration was a behavior-identical rename.

Source: `tailwind.config.ts` (`zIndex`) + CSS mirror `--z-*` in `index.css` +
runtime registry `client/src/lib/z-index.ts`. **Future code says `z-modal`, not
`z-50`.**

| Token | Value | Role |
|---|---|---|
| `z-base` | 0 | in-flow default content |
| `z-raised` | 1 | card hover-lift; thin in-flow raise |
| `z-docked` | 10 | sticky subheaders, table headers, raised cards |
| `z-dropdown` | 20 | in-page dropdowns / popper menus |
| `z-sticky` | 30 | page topbar |
| `z-overlay` | 40 | autopilot status bar, top notifications, cookie banner |
| `z-slot-help` / `z-slot-tray` | 48 / 49 | floating help / conversation-tray slots |
| `z-floating` | 50 | FAB, bottom nav, base dialogs/sheets, PWA prompt |
| `z-modal` | 60 | modal scrim, command palette, new-item menu, escalated dialogs/sheets |
| `z-toast` | 100 | toasts / transient banners above modals |
| `z-offline` | 110 | offline indicator above toasts |
| `z-tour` | 9990 | product-tour scrim |
| `z-island` | 9998 | dynamic island, tour/demo highlight rings |
| `z-spotlight` | 9999 | demo orb / highlight focus above the island |
| `z-max` | 10000 | absolute top — demo control panel |

#### Translucency — surface scale (F2)

Replaces 60+ untokenized `bg-*/95` ad-hocs. Glass chrome surfaces say
`bg-surface-chrome`, never `bg-background/95`. Source: `--surface-*` in
`index.css` + the `.bg-surface-*` utility classes.

| Utility / var | Value | Use |
|---|---|---|
| `bg-surface-chrome` | `hsl(bg / .95)` | glass chrome: topbars, navs |
| `bg-surface-haze` | `hsl(bg / .90)` | map/canvas overlay chrome |
| `bg-surface-veil` | `hsl(bg / .80)` | secondary / lighter sticky |
| `bg-surface-sheer` | `hsl(bg / .70)` | sheerest tinted veil: full-bleed |
| `bg-surface-scrim` | `rgba(0,0,0,.40)` | modal/dialog backdrop |
| `bg-surface-scrim-strong` | `rgba(0,0,0,.80)` | heavy backdrop |

Both scales are theme-aware (the `hsl(bg / …)` forms inherit each theme's
`--background`).

#### Shadow — two tracks (SYSTEM-V1 §3.4)

- **Track 1 — mode-independent** (`--shadow-1…4`, `index.css :root`, neutral
  rgba). Consumed by `.glass-panel` / `.liquid-glass*` / `.elevation-*` and the
  Tailwind `shadow-level-*` utilities. Use for **glass/overlay** surfaces that
  must be theme-neutral.
- **Track 2 — theme-aware** (`--acr-shadow-1…3`, per-theme, uses the theme's ink
  as shadow hue). Consumed by `shadow-acr-1/2/3`. Use for **content cards and
  surfaces.**

### 1.5 Motion (do-not-touch — systematic SoT)

`client/src/lib/motion-tokens.ts` is the single source of truth; `animations.ts`
is the variant library consuming it; `motion.ts` is a legacy shim (extend
motion-tokens, not the shim). **Do not touch this system** (census: 5/5).

- **Durations** (s): `instant` 0.08 · `fast` 0.15 · `normal` 0.25 · `slow` 0.35
  · `slower` 0.5. CSS mirror tokens (`--acr-dur-*` 120/240/320ms) are
  intentionally slightly faster — CSS lacks spring physics.
- **Exit-fast rule:** ALL exits run at `fast` (0.15s). An exit that outstays its
  welcome is a UX tax. Never exit at `slow`/`slower`.
- **Easings:** `linearExpo` (default, Linear's expo-out) · `stripeStandard`
  (symmetric, modals/drawers) · `smoothOut` (legacy) · `anticipate` (success
  overshoot only) · `out` / `inOut`.
- **Springs:** `snappy` (320/30, taps) · `smooth` (300/25, modal/sheet) ·
  `gentle` (200/22, accordions) · `bouncy` (400/12, **celebration** — deal
  closed, milestone) · `interactive` (220/26, control press) · `soft` (140/22,
  chat/artifacts).
- **Named variants** (import, don't inline): `staggerContainer`/`staggerItem`,
  `pageTransition`, `variantPageFade(Mobile)`, `modalContent`, `fadeIn`,
  `fadeInUp`, `slideUp`, `scaleIn`.
- **Reduced-motion (3 layers):** CSS `@media (prefers-reduced-motion)` collapses
  keyframes to 0.001ms; JS `useRespectfulTransition`/`useRespectfulVariants`
  collapse to noop; manual `[data-motion="reduced"]` collapses CSS duration
  tokens. Any component adding spatial movement MUST wrap its transition in the
  respectful hooks.

---

## 2. Materials — the Tahoe glass kit (house language)

Glass/depth is now the **systematic house material** (founder decision §0.2).
Source: `index.css` glass blocks. All four tiers implement the `::before` /
`::after` specular + cursor-reactive highlight; reduced-motion disables the
opacity transition.

| Material | Blur | Sat | When to use |
|---|---|---|---|
| `.glass-panel` | 32px | 190% | Full-page overlays, large panels |
| `.liquid-glass` | 32px | 190% | Cards / modals over blurred backgrounds |
| `.liquid-glass-sm` | 16px | 180% | Smaller elements (button `glass` variant) |
| `.liquid-glass-subtle` | 20px | 175% | Background hints, lightweight tints |

Plus `.floating-window` (macOS elevation) and the macOS traffic-light dialog
chrome (intentional `#FF5F57` system red). **Pairing rule:** glass surfaces use
the **translucency tokens** (§1.4) for their tint and **Track-1 shadows** for
elevation — never raw `bg-*/95` or theme-tinted shadows. Re-skin (Wave R) drives
glass adoption surface-by-surface against the flagship themes.

---

## 3. Components — primitive inventory (ported SYSTEM-V1 §4)

Canonical primitives and their open warts:

| Primitive | Status | Open wart |
|---|---|---|
| **Button** | Canonical | `outline` referenced undefined `--button-outline` → now `var(--acr-line)`; `glass` variant kept; all sizes hold 44px touch floor |
| **Card** | Canonical | `CardTitle` inline `tracking-tight` vs canonical −0.018em; both use `rounded-card` (14px) |
| Input / Textarea / Select | Canonical | none — shadcn defaults on `--acr-bg-sunken` + `--acr-ink` |
| **Dialog** | Canonical | macOS traffic-light close; `#FF5F57` intentional |
| Sheet / Drawer | Canonical | gesture support present |
| **ResponsiveModal** | Canonical | **default for all new overlays** (Dialog desktop / Sheet mobile); raw Dialog only for destructive confirmations |
| **Skeleton** (+ card/list/table) | Canonical | a11y-correct (`role=status`, `aria-busy/live`); **use always** |
| **EmptyState** | Was fragmented → consolidating | single system is `components/empty-state.tsx`; the plural file + variant dir are being retired (CLAUDE.md: single system, build-break-enforced) |
| **QueryErrorState** | Canonical | retry support; migrate inline `duration: 0.4` → `DURATIONS.slow` |
| Badge | Needs review | `hover-elevate` baked into base CVA — belongs on the filter-chip wrapper, not the primitive |
| Glass utilities | Canonical | see §2 |

**Hover-interaction split:** `hover-elevate` (CSS) = touch-safe highlight, no
transform; `cardHover` (Framer) = desktop-only lift, transform. Never combine
both on one element.

---

## 4. Patterns

- **Page shells.** `<PageShell>` — generic auth chassis (sidebar + topbar +
  main). `<FounderPageShell>` — wraps PageShell with the editorial header
  (required `eyebrow` + `title`; optional `titleSoft`/`actions`/`filters`); use
  for all `/founder/*`. `<CoveragePage>` — full-viewport chassis for 404/500/403/
  maintenance (brand-bg icon, italic Fraunces title, primary + secondary CTAs).
- **Editorial header.** The signature surface pattern (`.acr-cc-hero` >
  `.acr-eyebrow` + `.acr-cc-greeting` with a trailing `.acr-cc-greeting-soft` in
  muted ink). Empty-state variant leads "No X yet." + soft instruction.
- **ResponsiveModal.** Canonical form-overlay pattern (Dialog desktop / Sheet
  mobile). New modals wire through the Zustand `modal-store.ts` + `<DealModalsHost />`,
  never `window.*` globals.
- **Provenance.** Grounded data carries honest-null confidence + source
  attribution (grounding stack; do-not-touch kernel).
- **Loading / empty / error.** House primitives only: `Skeleton` (shape-matched,
  not spinners — `animate-spin` is for `mutation.isPending` button spinners
  only), `EmptyState` (purposeful CTA), `QueryErrorState` (retry). These are the
  CLAUDE.md-mandated states.

---

## 5. Motion grammar + signature interactions (Wave S targets)

The primitives exist (`anticipate` / `bouncy` / specular / shared-element); Wave
S composes them into crown-jewel beats — reimagined, not restyled:

- **Witnessed-send ceremony** — the approval-kernel send moment.
- **Today "you're done" beat** — the decision-queue payoff (the unused `bouncy`
  spring).
- **Parcel slide-over reveal** — the product's "Mission Control" moment.
- **Deal-closed celebration** — milestone payoff (`bouncy`).

---

## 6. Voice (ported DESIGN-SYSTEM §Voice)

- Short **imperative** phrases over feature copy. "Make the offer." not "Create
  an offer letter."
- **First-person founder** where it reads natural ("I built this because I needed
  it").
- Soft trailing clauses in muted ink (the `.acr-cc-greeting-soft` blend).
- **Specific over generic** — errors attribute blame correctly; never "Something
  went wrong."
- **Honest empty states** — "No leads yet. Import a CSV or add one by hand." not
  "Start your journey!"
- Founder surfaces are **terser** than customer pages — operating, not learning.

---

## 7. Enforcement — the ratchet layer IS the design-system gate

There is no Storybook. Enforcement is the CI ratchet chain (founder decision
§0.2), wired into `npm run check` (`package.json`). **NEW design-token drift
fails `check`.** Each ratchet is bidirectional with a frozen baseline — the only
way a number moves is DOWN, locked in by editing the baseline in the same commit.

| Lint | Script | Guards | Baseline (drive-to-zero) |
|---|---|---|---|
| `lint:page-hex` | `scripts/lint-page-hex.mjs` | raw hex in page tsx → use `--acr-*` | **6 files / 6 sites** |
| `lint:css-hover` | `scripts/lint-css-hover.mjs` | ungated `:hover` (iOS double-tap) | **3 files / 17 sites** |
| `lint:date-format` | `scripts/lint-date-format.mjs` | `toLocaleDate/TimeString` → `lib/format` | **30 files / 38 sites** |
| `lint:zindex` | `scripts/lint-zindex.mjs` | ad-hoc `z-[N]`/`z-50` → semantic `z-*` | **67 files / 109 sites** |
| `lint:translucency` | `scripts/lint-translucency.mjs` | raw `bg-*/95` → `bg-surface-*` | **23 files / 30 sites** |
| `lint:prefetch-authority` | `scripts/lint-prefetch-authority.mjs` | `prefetchRoute` is the only cache-warmer | enforced |
| `lint:no-fabrication` | `scripts/check-no-fabrication.mjs` | no fabricated/sample data | 0, enforced |
| `lint:boundaries` | `scripts/check-boundaries.mjs` | import/layer boundaries | enforced |
| `lint:contract-adoption` | `scripts/check-contract-adoption.mjs` | up-ratchet on contract adoption | enforced |
| `lint:ratchets` | `scripts/ratchet.mjs` | console/req-as-any/res-status-raw/storage-linecount | per-`scripts/ratchets/*.json` |

`check` also runs `tsc --noEmit` first. The hex (6), hover (17), date-format
(38), z-index (109), and translucency (30) baselines all carry a drive-to-zero
tail — tighten in-commit whenever a guarded file is touched; the re-skin (Wave R)
will retire most of the z-index/translucency tails by construction.

**Do-not-loosen invariant:** never raise a baseline. The ratchet idiom
(`scripts/ratchet.mjs` + the standalone lints) is itself a do-not-touch system.

---

## Provenance

- Folds in + supersedes: `docs/design/SYSTEM-V1.md` (Kai Brennan, 2026-06-01),
  `docs/unified-build/DESIGN-SYSTEM.md`.
- Authoritative code sources cited inline; the contract is one-commit code-sync.
- Roadmap context: `docs/internal/roadmap/elevation-arc-snow-leopard-tahoe.md`.
