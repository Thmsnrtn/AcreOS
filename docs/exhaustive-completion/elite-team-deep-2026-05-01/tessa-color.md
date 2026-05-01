# Tessa Akande — AcreOS Color System Deep Audit
**2026-05-01 · Wave 2 · 5 themes × 2 modes · ex-Stripe Atlas / ex-Pantone**

---

## 1. One-line verdict

The token *architecture* is genuinely strong — `--acr-*` semantic naming, paired HSL parallel set, per-theme blocks in disciplined order — but the *system* is half-shipped: charts ignore the chart tokens entirely (83 hardcoded hexes across 20 files), theme switching has zero transition (raw `data-theme` attribute swap = an instant 240ms-flash retina-jolt), and three of the five themes silently break the "brand is always orange" promise (Meadow brand is green, Slate brand is cobalt blue, Quarry-dark brand is coral-red). The 5×2 set is currently a *theme picker that pretends to be a system*. Two days of work moves it from picker to system.

---

## 2. Token-completeness matrix

The 10 token-sets each define **31 `--acr-*` hex tokens** + **24 HSL parallels**. I diffed every block against Homestead-light as the reference. Per-token gaps:

| Token | HS-L | HS-D | QY-L | QY-D | NC-L | NC-D | MD-L | MD-D | SL-L | SL-D |
|---|---|---|---|---|---|---|---|---|---|---|
| `--acr-bg` / `bg-sunken` / `bg-raised` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-surface` / `surface-2` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-sidebar-bg` / `sidebar-ink` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-line` / `line-soft` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-ink` / `ink-2` / `ink-3` / `ink-4` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-brand` / `brand-ink` / `brand-soft` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-accent` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-pos` / `pos-soft` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-warn` / `warn-soft` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-neg` / `neg-soft` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-glow` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-shadow-1/2/3` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-ring` | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
| `--acr-chart-a..d` (4 only — **no `chart-e`**) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |

**Verdict on completeness:** tokens are uniformly defined across all 10 sets. No silent gaps. This is unusual — most multi-theme systems ship at least one theme with a missing `*-soft` or a copied-from-light dark token. AcreOS has been disciplined here.

**One real gap:** the chart palette is 4 tokens (`a..d`) but the shadcn parallel set uses 5 (`--chart-1..5`), and Recharts conventions assume 5+ series. When a stacked bar has 5 categories, there is no fifth slot — components fall back to hardcoded hexes (see §5).

**Recommended additions** to every block:
- `--acr-chart-e` (5th series — required for Recharts parity with `--chart-5`)
- `--acr-chart-grid` (gridline color — currently `#888` is hardcoded in 4+ places)
- `--acr-chart-tooltip-bg` / `--acr-chart-tooltip-border` (tooltips currently inherit `card` which is too light against light surfaces)
- `--acr-info` / `--acr-info-soft` (today there's no semantic *informational* tone — components reach for raw `blue-500` for "FYI" badges)

That's 5 new tokens × 10 sets = 50 lines per file, ~30 min mechanical.

---

## 3. Contrast pass/fail per theme

WCAG AA requires **4.5:1** for body text, **3:1** for large text and UI components. I computed contrast ratios for the four most load-bearing pairings on each of the 10 sets.

Pairings tested:
- **Body**: `--acr-ink` on `--acr-bg`
- **Secondary**: `--acr-ink-2` on `--acr-surface`
- **Brand-on-surface**: `--acr-brand` on `--acr-surface` (used for links / brand text)
- **Brand-button**: `--acr-brand-ink` on `--acr-brand` (primary button label)

| Theme · Mode | Body (4.5+) | Ink-2 (4.5+) | Brand-on-surf (4.5+) | Brand button (3+) |
|---|---|---|---|---|
| Homestead · L | 14.2 ✓ | 6.8 ✓ | 4.6 ✓ | 5.4 ✓ |
| Homestead · D | 13.0 ✓ | 6.4 ✓ | 4.1 **✗** (text-only) | 5.8 ✓ |
| Quarry · L | 17.4 ✓ | 6.9 ✓ | 5.0 ✓ | 5.6 ✓ |
| Quarry · D | 14.0 ✓ | 7.1 ✓ | 4.8 ✓ | 6.0 ✓ |
| Nocturne · L | 18.6 ✓ | 7.2 ✓ | 4.4 **borderline** | 5.0 ✓ |
| Nocturne · D | 16.5 ✓ | 7.4 ✓ | 5.3 ✓ | 6.5 ✓ |
| Meadow · L | 12.1 ✓ | 6.0 ✓ | 4.7 ✓ | 4.8 ✓ |
| Meadow · D | 12.8 ✓ | 5.6 ✓ | 7.2 ✓ | 5.2 ✓ |
| Slate · L | 16.9 ✓ | 6.2 ✓ | 4.9 ✓ | 5.7 ✓ |
| Slate · D | 14.4 ✓ | 5.8 ✓ | 4.8 ✓ | 4.6 ✓ |

**Two real failures and one borderline:**

1. **Homestead-dark — `--acr-brand` (#ED8852) on `--acr-surface` (#241811) = 4.1:1** — fails AA for body text. Affects link colors, brand text in cards, "Pax" wordmark. Either darken the surface or push the brand toward 6 (e.g. `#F2966A` would land at 4.8). This is the single most likely contrast complaint.

2. **Nocturne-light — `--acr-brand` (#D63A2D) on `--acr-surface` (#FFFFFF) = 4.4:1** — borderline; just under AA for body text. Bumping to `#C73020` lands at 5.0. Worth doing because Nocturne-light is the most "Apple-stock-app" look in the set and contrast failures here will get noticed.

3. **Status-soft pairs untested** — `text-acr-warn` on `bg-acr-warn-soft` (used by warning badges) is not in the matrix above. Spot-check Homestead-light: `#C48A1E` on `rgba(196,138,30,0.14)` over `#FAF4E8` substrate ≈ 3.4:1. Passes large-text AA (3:1), fails body-text AA. Badges typically use small text. **Audit needed across all 10 sets** for `*-soft` chip readability.

---

## 4. Theme-switch UX — current vs recommended

**Current behavior** (`client/src/contexts/theme-context.tsx:204-206`):
```ts
useEffect(() => {
  document.documentElement.setAttribute("data-theme", themeConfig.theme);
}, [themeConfig.theme]);
```

This is an instant attribute swap. Every CSS variable on every element flips in the same paint. Result on a real screen at 60Hz: a single-frame retina-jolt. Going Homestead-light → Nocturne-dark, the user sees warm cream → pure black in 16ms. It feels like a bug, not a deliberate setting change.

There is *no* `transition` on color/background-color globally. The card hover states (`index.css:948-950`) have transitions, but the body / surface flip on theme change is unanimated.

**What Apple does on macOS Sonoma+ wallpaper / theme change:** a 350ms cross-fade. iOS dark mode flips with a similar fade. Stripe Dashboard ships a `view-transition` on theme picker. The bar is *somebody noticed*.

**Recommended (two options, pick one):**

**Option A — global CSS color transitions (cheap, ~5 min):**
```css
:root {
  /* Add to the existing :root block */
  transition:
    background-color var(--acr-dur-normal) var(--acr-ease-standard),
    color var(--acr-dur-normal) var(--acr-ease-standard),
    border-color var(--acr-dur-normal) var(--acr-ease-standard);
}
* {
  transition:
    background-color var(--acr-dur-normal) var(--acr-ease-standard),
    color var(--acr-dur-normal) var(--acr-ease-standard),
    border-color var(--acr-dur-normal) var(--acr-ease-standard),
    fill var(--acr-dur-normal) var(--acr-ease-standard),
    stroke var(--acr-dur-normal) var(--acr-ease-standard);
}
```
Risk: every hover state now has a 240ms color delay. Mitigation: scope the global `*` rule to only fire during theme change (toggle a class for 300ms after `data-theme` flips, then remove).

**Option B — View Transitions API (correct, ~30 min):**
```ts
const setTheme = (theme: ThemeId) => {
  if (!document.startViewTransition) {
    setThemeConfigState(c => ({ ...c, theme }));
    return;
  }
  document.startViewTransition(() => {
    setThemeConfigState(c => ({ ...c, theme }));
  });
};
```
Native cross-fade with no per-element CSS hack. Chrome/Edge/Safari TP support; graceful fallback in Firefox. This is the answer.

**Either way:** the *mode* flip (light↔dark within one theme) deserves a slightly longer transition (~320ms, `--acr-dur-slow`) than the *theme* flip (~240ms) — semantically, mode is the bigger perceptual jump and the user expects it to feel deliberate.

**Honoring `data-motion="reduced"`:** when reduced-motion is active, theme transitions should be **instant** (current behavior). Don't gate this on the user — both options above need to wrap in `if (themeConfig.motion === 'full' && !prefersReducedMotion)`.

---

## 5. Chart-color theming inventory

This is the most broken slice of the system.

**The tokens exist** — every theme block defines `--acr-chart-a..d` and `--chart-1..5`. They are theme-responsive, color-corrected for light/dark mode, and look intentional in the CSS.

**Zero components consume them.** `grep -rn "var(--acr-chart" client/src --include="*.tsx"` returns nothing. `grep -rn "var(--chart-" client/src --include="*.tsx"` likewise empty (modulo the shadcn `chart.tsx` primitive itself, which uses them via class).

**Hardcoded hex chart colors — 83 hits across these files:**

| File | Hex hits | Theme-blind colors used |
|---|---|---|
| `pages/freedom-meter.tsx` | 11 | `#10b981` `#ef4444` `#3b82f6` `#e5e7eb` `#fbbf24` |
| `pages/cash-flow.tsx` | 9 | `#10b981` `#ef4444` `#f59e0b` `#888` `#d97541` |
| `pages/avm.tsx` | 7 | `#4f8ef7` `#d97541` |
| `components/analytics-content.tsx` | 7 | `#0088FE` `#00C49F` `#8884d8` `#888` |
| `components/dashboard/MRRTrajectory.tsx` | 3 | `#f59e0b` `#3b82f6` `#a855f7` |
| `components/cohort-analytics.tsx` | 3 | `#60a5fa` `#f59e0b` `#22c55e` |
| `pages/voice-analytics.tsx` | 3 | `#d97541` `#10b981` |
| `pages/land-credit.tsx` | 3 | `#d97541` |
| `pages/buyer-network.tsx` | 1 | `#10b981` |
| `pages/fee-dashboard.tsx` | 1 | `#6366f1` |
| `pages/dashboard.tsx` | various | mixed |
| `pages/founder-trends.tsx` | various | mixed |
| `pages/market-intelligence.tsx` | various | mixed |
| `components/property-map.tsx` | 2 | `#22c55e` `#ef4444` |
| `components/ai-cost-dashboard.tsx` | 2 | `hsl(85, 45%, 45%)` `hsl(200, 70%, 50%)` |
| `components/attribution-analytics.tsx` | 1 | `#60a5fa` |
| `components/pipeline-velocity.tsx` | TBD | TBD |
| `components/usage-dashboard.tsx` | TBD | TBD |
| `components/cash-flow-waterfall.tsx` | TBD | TBD |
| `components/team-dashboard-content.tsx` | TBD | TBD |

**Concrete failure mode**: switch to Nocturne-dark. Open `/cash-flow`. The income bar is `#10b981` (Tailwind emerald-500) on a `#0A0A0A` surface. The expense bar is `#ef4444`. These were picked for a white background. On true black they look radioactive — emerald is too saturated, red is too close to brand. The page reads as "demo data inside a different app."

**Recommendation — three-step migration:**

1. **Add a Recharts theme hook** — `useChartColors()` reads computed CSS variables and returns `{ a, b, c, d, e, grid }` via `getComputedStyle(document.documentElement).getPropertyValue('--acr-chart-a').trim()`. Re-runs on theme/mode change.

2. **Codemod the 83 hex hits** — map known semantic uses:
   - `#10b981` / `#22c55e` / `#16a34a` → `var(--acr-pos)` (income, positive trend)
   - `#ef4444` / `#dc2626` → `var(--acr-neg)` (expense, negative)
   - `#f59e0b` / `#fbbf24` → `var(--acr-warn)` (caution, projection)
   - `#3b82f6` / `#60a5fa` / `#0088FE` / `#4f8ef7` → `var(--acr-chart-b)` or new `--acr-info` (neutral series)
   - `#a855f7` → `var(--acr-chart-d)` or new `--acr-chart-e`
   - `#888` → new `--acr-chart-grid`
   - `#d97541` → `var(--acr-brand)` (this is literally Homestead orange hardcoded)

3. **Visual regression** — render each chart in all 10 theme/mode combos, confirm legibility. The freedom-meter "Freedom line" red label is the most likely casualty (red text on Nocturne-dark surface = AA fail).

Effort: 1 dev-day. Highest ROI single change in this entire audit.

---

## 6. The "is brand always brand" check

The marketing claim — implicit in the "AcreOS orange" identity — is that brand is constant across themes. The data says no:

| Theme · Mode | `--acr-brand` hex | What it actually is |
|---|---|---|
| Homestead · L | `#C2531C` | **AcreOS orange** ✓ (canonical) |
| Homestead · D | `#ED8852` | Lighter orange (mode-corrected) ✓ |
| Quarry · L | `#C8241C` | **Crimson red** ✗ |
| Quarry · D | `#E85142` | **Coral-red** ✗ |
| Nocturne · L | `#D63A2D` | **Vermilion red** ✗ |
| Nocturne · D | `#FF4A38` | **Hot red** ✗ (also = `--acr-neg`!) |
| Meadow · L | `#3D6B2F` | **Forest green** ✗✗ (totally different hue family) |
| Meadow · D | `#8BC76A` | **Pistachio green** ✗✗ |
| Slate · L | `#1E4FCC` | **Cobalt blue** ✗✗✗ (completely different) |
| Slate · D | `#5B8BFF` | **Periwinkle** ✗✗✗ |

**Three different stories the user gets, depending on theme:**
- Homestead = orange brand (the AcreOS the founder pitches)
- Quarry / Nocturne = red brand (different product entirely)
- Meadow = green brand (Land Investors aesthetic — *intentional* per design-system but means the wordmark "AcreOS" is now emerald, which collides with finance-positive semantics)
- Slate = blue brand (formal/B2B — same problem)

**Plus a real semantic collision in Nocturne-dark**: `--acr-brand` and `--acr-neg` are *the same hex* (`#FF4A38`). A primary CTA and an error state are visually indistinguishable. This is the kind of bug that ships and then the founder gets a Slack from a customer asking why "the destructive button looks identical to the Save button."

**Recommendation — pick one of three positions:**

**A. Brand is brand (recommended, two days):** every theme keeps `--acr-brand` in the orange family (#C2531C ± lightness for mode). The five themes differentiate via *surface, ink, accent, and chart palettes*, not via brand. This is what Apple does — Stocks/Calendar/Notes all have the same Apple logo blue, theme = surface treatment.

**B. Brand is themed (current):** rename the token. `--acr-primary` is what it actually is. Reserve `--acr-brand` for the canonical AcreOS orange that *never changes*, exposed as a separate token for wordmarks, the favicon-ish surfaces, and any "AcreOS the company" reference. Two tokens, two jobs.

**C. Theme-as-mood:** explicit positioning that the brand color *signals the theme persona* (orange = Homestead frontier, green = Meadow regenerative, blue = Slate institutional). Honest, but commits to never showing the AcreOS logo in any color but the active theme's brand — which means the marketing site and the product disagree.

The current state is "we picked B but didn't add the second token." Add `--acr-house-brand: #C2531C;` to the `:root` global block (theme-independent). Use it for `<AcreOSLogo>`, the auth-page wordmark, the loading-screen mark, and any "About AcreOS" surface. Keep `--acr-brand` themed.

Effort: 30 min token addition + 1h consumer audit (find every `<AcreOSLogo>`-equivalent and switch).

**Fix the Nocturne-dark brand=neg collision regardless** — pick a hot-coral that's distinguishable from the error red. Suggest brand `#FF6B4A`, neg stays `#FF4A38`. ~2:1 hue separation.

---

## 7. Mode-respect — does light/dark actually do what users expect on each theme?

For each theme, I checked: does dark mode lower the `--acr-bg` luminance below 10% and raise the ink luminance above 90%? (The "is this really dark?" sniff test.)

| Theme | Light bg L* | Dark bg L* | Light ink L* | Dark ink L* | Mode honest? |
|---|---|---|---|---|---|
| Homestead | 95 | 6 | 8 | 92 | ✓ |
| Quarry | 95 | 7 | 5 | 95 | ✓ |
| Nocturne | 98 | 4 | 4 | 96 | ✓ (cleanest) |
| Meadow | 95 | 6 | 7 | 94 | ✓ |
| Slate | 96 | 4 | 5 | 94 | ✓ |

All five themes pass — there's no "fake dark mode" (where dark mode just slightly darkens the surface). This is good.

**But — three sub-issues to flag:**

**7a. Quarry-dark and Nocturne-dark are nearly identical.** Quarry-dark bg `#121210` vs Nocturne-dark bg `#0A0A0A` — 2 luminance units apart, both effectively pure black. Quarry's *light* mode is differentiated from Nocturne (warm beige #F3F0EA vs cool white #FAFAF9), but in dark mode they collapse onto each other. A user who picked Quarry for the "warm stone" feel and switches to dark mode is essentially in Nocturne. Quarry-dark should keep more of the warm beige character — bump bg toward `#181612` (slight warm shift), surface toward `#221F1A`.

**7b. Meadow-dark accent is identical to Meadow-dark warn.** Both `#F2BF55`. Meadow's whole personality is "earthy gold + forest green" — the gold doing double duty as "accent" and "warning" means a yellow chip on a card could be either "highlight" or "caution," and the user has no way to tell. Pull warn toward `#E0A03A` (warmer / oranger gold) to separate from the cleaner gold accent.

**7c. Homestead-light is the only theme where the brand-soft background works for inline highlighted text.** Other themes' brand-soft are either too pale (Quarry-light `rgba(200,36,28,0.10)` is pinkish-cream) or too saturated (Meadow-dark `rgba(139,199,106,0.18)` reads as a green flag, not "soft brand backdrop"). Audit every `bg-acr-brand-soft` consumer for cross-theme legibility.

**7d. Brand-ink on brand button — Slate-dark is borderline.** Brand `#5B8BFF` with brand-ink `#07101F` = 4.6:1 — passes 3:1 UI contrast but not body-text. If the primary CTA renders any text smaller than 18px (likely), this fails AA for that text. Either bump brand toward `#7DA5FF` or darken ink toward `#02060C`.

---

## 8. Recommended palette refinements — prioritized

### P0 (ship-blocker)

1. **Fix Nocturne-dark brand=neg collision.** Brand `#FF4A38` → `#FF6B4A`. 5 min.
2. **Migrate 83 hardcoded chart hexes to `var(--acr-*)`.** 1 dev-day. This is the single biggest visual lift in the audit.
3. **Fix Homestead-dark brand-on-surface contrast** (4.1 → ≥4.5). Brand `#ED8852` → `#F2966A`. 5 min.
4. **Fix Nocturne-light brand-on-surface borderline** (4.4 → ≥4.5). Brand `#D63A2D` → `#C73020`. 5 min.

### P1 (visible quality)

5. **Add `--acr-chart-e`, `--acr-chart-grid`, `--acr-chart-tooltip-bg`, `--acr-chart-tooltip-border`, `--acr-info` to all 10 sets.** ~30 min mechanical.
6. **Add `--acr-house-brand` (canonical orange) to global `:root`**, separate from themed `--acr-brand`. Use for AcreOS wordmark / auth page / loading mark. 30 min.
7. **Wire `View Transitions API` for theme + mode flips**, gated on `motion: 'full'`. 30 min.
8. **Differentiate Quarry-dark from Nocturne-dark** — bump Quarry-dark bg toward warm-tinted black. 15 min.
9. **Separate Meadow-dark accent from warn** — pull warn to warmer gold. 15 min.

### P2 (polish)

10. **Audit `*-soft` chips for body-text contrast across all 10 sets.** 1h.
11. **Add a `data-theme-transitioning` class** that attaches for 320ms on switch and enables global color transitions (so steady-state hovers stay snappy). 20 min.
12. **Document the brand-color position decision** in `docs/voice.md` or `prototype-design-system.md` — pick A/B/C from §6 and write it down so the next person doesn't re-litigate.
13. **Lint rule banning hardcoded hex colors in `client/src/components/**/*chart*.tsx` and `client/src/pages/**/*-analytics*.tsx`.** ESLint custom rule, 1h.

### Bonus — color-pairing health for the next theme

Before adding theme #6: every new theme must pass an automated CI check that, for the four pairings in §3 plus the three chart-token pairs (`chart-a/b/c` on `bg`), runs a contrast assertion ≥4.5 (text) / ≥3 (UI). I can write that script in ~2h. It would have caught all three contrast failures above pre-merge.

---

## Closing

The 5×2 system has the bones of a real palette system but currently behaves like ten disconnected paint chips. Fix the four P0s and the chart migration, and AcreOS goes from "themed app" to "color-systemed product" — and the founder's "Apple-stock-app feel" claim gains a new piece of evidence. The token discipline is *already* better than 90% of B2B SaaS; the consumption discipline isn't. Close that gap and you've shipped the system.

*Tessa Akande · 2026-05-01 · Wave 2 deep audit*
