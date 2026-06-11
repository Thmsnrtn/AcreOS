# AcreOS Design System (post-unified-build)

> **⚠️ SUPERSEDED (2026-06-11) by [`docs/design/design-language.md`](../design/design-language.md).**
> That document is the single canonical, code-synced design source of truth. The
> Voice section here was ported into it (§6); its token tables are stale (theme
> count + hex values drifted from `index.css`) — use `design-language.md` and the
> live token files. Preserved as history; do not edit as authoritative.

> Quick-reference for engineers extending AcreOS surfaces. Tokens, components, patterns, voice. The detailed origin story is in `COMPLETE.md`.

---

## Tokens (in `client/src/index.css`)

All design tokens are namespaced `--acr-*` so they don't conflict with shadcn's HSL system.

### Color

| Token | Light | Dark | Use |
|-------|-------|------|-----|
| `--acr-bg` | `#FAF4E8` | `#1A1612` | Page background (cream) |
| `--acr-bg-sunken` | `#F1E9D6` | `#0F0C09` | Recessed surfaces |
| `--acr-bg-raised` | `#FFFBF1` | `#251F18` | Above-bg surfaces |
| `--acr-surface` | `#FFFBF1` | `#251F18` | Card backgrounds |
| `--acr-surface-2` | `#F3EAD4` | `#2D2620` | Secondary surfaces (hover, footer) |
| `--acr-sidebar-bg` | `#F1E7D0` | `#1F1B16` | Sidebar nav background |
| `--acr-ink` | `#241607` | `#F4ECDB` | Primary text |
| `--acr-ink-2` | `#5A4424` | `#C4B59A` | Secondary text |
| `--acr-ink-3` | `#8F7A52` | `#8D8275` | Tertiary text / muted |
| `--acr-ink-4` | `#BAAA85` | `#5C5448` | Quaternary / placeholder |
| `--acr-line` | `rgba(80, 40, 15, 0.14)` | etc | Borders |
| `--acr-line-soft` | `rgba(80, 40, 15, 0.07)` | etc | Subtle borders |
| `--acr-brand` | `#C2531C` | same | Terracotta brand primary |
| `--acr-brand-ink` | `#FFFBF1` | same | Text on brand |
| `--acr-brand-soft` | `rgba(194, 83, 28, 0.14)` | same | Brand-tinted bg |
| `--acr-accent` | `#4C7B80` | same | Desert sage (Pax) |
| `--acr-pos` | `#3B7C2E` | same | Positive (green) |
| `--acr-warn` | `#C48A1E` | same | Warning (amber) |
| `--acr-neg` | `#B33419` | same | Negative (red) |

Each `--acr-pos`, `--acr-warn`, `--acr-neg` has a matching `*-soft` variant for tinted backgrounds.

### Typography

```css
--font-display: "Fraunces", "Times New Roman", serif;  /* editorial headlines */
--font-sans:    "Inter", -apple-system, sans-serif;     /* body text */
--font-mono:    "JetBrains Mono", "SF Mono", monospace; /* numerics, IDs */
```

Self-hosted at `/fonts/Fraunces-VariableFont.woff2` and `/fonts/Inter-VariableFont.woff2`. See `client/src/fonts.css`.

**Display tip:** Fraunces has an `opsz` (optical size) axis from 9–144. For large editorial titles use `font-variation-settings: "opsz" 144;`. For body-sized serif (rare) use `"opsz" 24`.

### Effects

| Token | Use |
|-------|-----|
| `--acr-shadow-1` | Subtle (cards) |
| `--acr-shadow-2` | Mid (popovers) |
| `--acr-shadow-3` | Strong (modals) |
| `--acr-glow` | Brand glow (focus) |
| `--acr-ring` | `0 0 0 3px rgba(194, 83, 28, 0.28)` — focus rings |

---

## Voice

Per the prototype's "letter" tone.

- Short imperative phrases over feature copy. "Make the offer." not "Create an offer letter."
- Soft trailing clauses in muted ink. "{X count}{ acr-cc-greeting-soft: ` — soft context here.`}"
- First person where it reads natural ("I built this because I needed it"). Founder voice.
- Specific over generic. HANDOFF §8: "specific, attributes blame correctly, doesn't say 'Something went wrong.'"
- Honest empty states ("No leads yet. Import a CSV or add one by hand to get started.") not aspirational ("Start your journey!").
- Founder dashboards are terser than customer pages — operating, not learning.

---

## Layout primitives

### `<PageShell>` — generic auth shell
Mounts inside the auth-gated app layout. Provides sidebar + topbar + main content area. Use directly when the surface is simple data.

### `<FounderPageShell>` — founder dashboards
Wraps `<PageShell>` with the editorial header pattern. Required slots: `eyebrow`, `title`. Optional: `titleSoft`, `actions`, `filters`. Use for everything under `/founder/*`.

### `<CoveragePage>` — meta pages
Full-viewport chassis for 404 / 500 / 403 / maintenance / future error pages. Cream bg, brand-bg icon, italic Fraunces title, muted description, primary + secondary CTAs.

---

## Editorial header pattern

The signature pattern, used on all 10 customer-facing surfaces. Import `today.css`:

```tsx
import "./today.css";

<div className="acr-cc-hero">
  <div>
    <div className="acr-eyebrow">Inventory</div>
    <h1 className="acr-cc-greeting" data-testid="text-page-title">
      {plural(count, "parcel")}
      <span className="acr-cc-greeting-soft">
        {" "}across your portfolio.
      </span>
    </h1>
  </div>
  {/* optional right-aligned actions */}
</div>
```

`.acr-eyebrow` — uppercase 11px bold tracking, ink-3 color
`.acr-cc-greeting` — Fraunces 32px display, slight negative tracking
`.acr-cc-greeting-soft` — ink-3 color, font-weight 500, blends into the title

**Empty-state variant:** lead with "No X yet." + soft instruction.

---

## Modal pattern

Modals use the existing shadcn `<Dialog>` primitive + `useModals()` Zustand store.

```ts
// client/src/stores/modal-store.ts
useModals.getState().openQuickOffer(parcelId?);
useModals.getState().openLostReason(deal);
useModals.getState().openDealClosed(deal);
```

All three modals are mounted at app root via `<DealModalsHost />`. Add new modals by:

1. Adding open/close action pair to `modal-store.ts`
2. Building the component in `client/src/components/modals/`
3. Registering in `index.ts` `<DealModalsHost />`

---

## Onboarding wizard pattern

`client/src/components/onboarding/OnboardingWizard.tsx`. Replaces shadcn Dialog with a full-viewport `.ob` shell. Per-step layout uses `.ob-cards` grids of `.ob-card` action tiles + `.ob-eyebrow` + `.ob-title` headers.

The CSS lives at `client/src/components/onboarding/onboarding.css` (scoped under `.ob`). Welcome and reveal screens use italic `.ob-welcome-title` / `.ob-reveal-title` with Fraunces.

---

## Coverage / error pages

```tsx
import { ServerErrorPage } from "@/pages/coverage-page";
<ServerErrorPage onRetry={handleRetry} />
```

For new meta pages, compose with `<CoveragePage>` directly:

```tsx
import { CoveragePage } from "@/pages/coverage-page";
import { Wrench, RefreshCw, Home } from "lucide-react";

<CoveragePage
  icon={Wrench}
  eyebrow="503 · briefly down"
  title="Stripe is in a quiet hour."
  description={<>...</>}
  primaryAction={{ label: "Try again", icon: RefreshCw, onClick: () => location.reload() }}
  secondaryAction={{ href: "/today", label: "Back to AcreOS", icon: Home }}
  pageTitle="Service unavailable · AcreOS"
/>
```

---

## Animation

- Use `staggerContainer` + `staggerItem` from `client/src/lib/animations.ts` for lists fading in
- Respect `prefers-reduced-motion` — `<MotionConfig reducedMotion="user">` is mounted at app root
- Sounds: `useSound().play(kind)` — silent until user enables in Settings → Appearance → Preferences

---

## Accessibility checklist

Per HANDOFF §11 + production refinement standards (preserved):

- Every icon-only button has `aria-label`
- Every interactive element has visible focus state (`--acr-ring`)
- Every form input has an associated `<Label>`
- Modals trap focus (shadcn Dialog handles this)
- Toasts are `aria-live="polite"` (Radix toast handles this)
- 44px minimum touch targets on mobile (`min-h-[44px] md:min-h-9`)
- Reduce-motion respected via `MotionConfig` + `useSound`'s `prefersReducedMotion()` check

---

## Browser + device matrix

- Desktop: Chrome / Safari / Firefox / Edge (current 2 versions)
- Mobile: iOS Safari 15+, Chrome Android 100+
- Breakpoints: 320 (small phone), 375 (standard phone), 414 (large phone), 768 (tablet portrait), 1024 (tablet landscape / small laptop), 1440 (desktop). Tailwind aliases: `sm:` 640+, `md:` 768+, `lg:` 1024+, `xl:` 1280+.

---

## What NOT to do

- Don't use raw shadcn HSL tokens for AcreOS-specific surfaces (use `--acr-*`)
- Don't introduce `bg-yellow-500/20` style hardcoded color tints (use `--acr-warn-soft` etc.)
- Don't wire new modals via `window.*` globals — use the modal store
- Don't put `console.log` in production server code (use `logger` from `server/utils/logger.ts`)
- Don't skip the prototype reference comment when porting a new surface
- Don't break the founder-mode 404-not-403 invariant when adding routes
- Don't inline font URLs in components — fonts.css owns the @font-face declarations
- Don't ship "Something went wrong" copy — use the homestead voice (specific, owns the failure)

---

## Want more context?

- Build origin story: `docs/unified-build/UNIFIED-BUILD-PROMPT.md`
- Prototype source: `acreos/`, `acreos-landing/`, `acreos-onboarding/`
- HANDOFF spec: `handoff/HANDOFF.md`
- Known gaps in spec: `handoff/GAPS.md`
- Final completion record: `docs/unified-build/COMPLETE.md`
