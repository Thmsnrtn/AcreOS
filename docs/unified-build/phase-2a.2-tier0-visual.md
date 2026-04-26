## Phase 2A.2 — Tier 0 visual application (palette + toaster)

Continues the Visual Application Mandate from Phase 2A.1. Applies prototype palette + visual treatments across the remaining Tier 0 surfaces.

### Command palette (commit `7309858`)

Prototype reference: `acreos/command-palette.jsx` lines 108-130 (CP_CSS).

**New `.palette-modal` class** in `client/src/index.css`:
- `var(--acr-surface)` flat background (replaces `glass-panel floating-window` for the palette only — other glass-panel surfaces unaffected)
- `0.5px solid var(--acr-line)` hairline border
- `border-radius: 14px`, `box-shadow: var(--acr-shadow-3)`
- `max-height: 70vh`

**Backdrop** updated to homestead warm-tinted scrim:
- Light: `rgba(241, 233, 214, 0.60)` — bg-sunken at 60%
- Dark: `rgba(18, 11, 5, 0.60)` — dark bg-sunken at 60%
- Blur: `10px` (was `20px` + `saturate(160%)`; prototype's value is gentler and warmer)

**Modal positioning + width:**
- Width: `max-w-[560px]` (was 640px)
- Top: `top-[14vh]` (was `top-[20%]`)

**Copy:**
- Placeholder: "Search or ask AcreOS…" / "Ask AcreOS anything…" (was "Search pages, actions, or type a question…")

**Footer hints** aligned to prototype's 3-item density on `var(--acr-bg-sunken)` with hairline top border. Hints now: navigate / open (or "ask" in AI mode) / close.

### Toaster (commit `8d6862e`)

No direct prototype toast reference. Synthesized per Per-Surface Fidelity Principle — closest analogs are `.cp-modal` (flat homestead surface, hairline, shadow) plus the semantic palette tokens (`--acr-pos`, `--acr-warn`, `--acr-neg`).

**New variants** in `client/src/components/ui/toast.tsx`:
- `success` — `var(--acr-pos-soft)` background, 4px `var(--acr-pos)` left border, `var(--acr-shadow-2)`
- `warning` — `var(--acr-warn-soft)` / `var(--acr-warn)` left border
- `destructive` — updated to `var(--acr-neg-soft)` / `var(--acr-neg)` left border (was shadcn HSL `bg-destructive/90`)
- `default` — keeps the `liquid-glass` treatment (no prototype conflict)

**Wire-up** in `client/src/lib/toast.ts`:
- `toast.success()` now uses `variant: "success"` (was using `default`)
- `toast.warning()` added (new, aligned with mega prompt's 4-kind toast spec)
- `toast.error()` continues using `destructive` (now homestead-tinted)

### Keyboard shortcuts modal — left as-is

Production's `KeyboardShortcutsModal` uses shadcn `<Dialog>` primitives that inherit homestead palette via the `--background` / `--foreground` HSL tokens. Visually acceptable — the `--background` HSL ≈ homestead cream, close enough to the prototype's flat surface treatment without explicit override. The modal's category headings (uppercase tracking-wide) already approximate the prototype's `cp-group` density. Phase 9 coherence pass can pick up any remaining drift.

### Verification

- `npm run check` clean
- `npm run build` — would be re-run before deploy in Phase 2A.5
- Two commits land: palette modal + toaster kinds
- Visual change (will be visible at acreos.io after Phase 2A.5 deploy):
  - Palette opens narrower (560 vs 640) and slightly higher (14vh)
  - Backdrop is warm cream instead of cool black
  - Modal is flat homestead surface instead of liquid-glass
  - Success toasts get a green left bar; warning amber; error terracotta-red

### Phase 2A progress

- [x] 2A.1 — sidebar visual treatment (commit `1bca3f3`)
- [x] 2A.2 — Tier 0 visual application (commits `7309858`, `8d6862e`)
- [ ] 2A.3 — public landing page (per `/acreos-landing/` prototype) — NEXT
- [ ] 2A.4 — public onboarding (per `/acreos-onboarding/` prototype)
- [ ] 2A.5 — fly deploy + Playwright MCP smoke test
