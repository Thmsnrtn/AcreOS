# Resume — Production Port Phase B (continuation: B.3 onward)

**Last commit before this resume point:** to be filled by the B.1/B.2 commit
that lands alongside this doc. Phase B.3 starts from that state.

**Active directive:** Production port from prototype, replacing Gap 1.1.E/F.
Eight phases (A–H). See `_progress.md` for the full list.

---

## What's done

### Phase A — ✅ COMPLETE

`docs/exhaustive-completion/prototype-design-system.md` — token inventory,
type pairings, component mapping, density/motion/voice/autonomy/feature-flags.
Single source of truth.

### Phase B.1 — ✅ COMPLETE

CSS token rollout. `client/src/index.css` head replaced (lines 1-784):

- Theme-agnostic `:root` block — fonts, motion, z-index, `--radius`
- Theme-agnostic `:root` + `.dark` blocks for glass tokens + 4-level shadows
  (mode-only, not per-theme — deliberate compromise; document in
  PORT-AUDIT-PHASE-B.md)
- 10 theme blocks (5 themes × light + dark) — each containing **both**
  `--acr-*` hex tokens AND derived HSL parallel for shadcn primitives, kept
  visually adjacent with `/* HSL parallel — keep in sync with --acr-* above. */`
  comment as the divider
- Legacy theme system deleted — `[data-theme="midnight|forest|ocean|sunset|monochrome"]`
  + `[data-accent="..."]` blocks gone
- HSL conversion was scripted (`/tmp/port-phase-b/build-css.mjs`); rgba
  alpha tokens like `--acr-line` composite over `--acr-surface` for the HSL
  approximation since shadcn HSL is solid

`tailwind.config.ts` — added `rounded-card: ".875rem"` (14 px) per
design-system §0.2. `rounded-lg` left at 16 px untouched.

### Phase B.2 — ✅ COMPLETE (runtime layer)

`client/src/contexts/theme-context.tsx` — rewritten:

- New types: `ThemeId` (homestead | quarry | nocturne | meadow | slate),
  `ThemeMode` (light | dark | auto), `FontPairing` (editorial | modern |
  classic | native | refined)
- `THEME_IDS` and `FONT_PAIRINGS` arrays exported for picker UIs
- `themeConfig.theme` replaces `themeConfig.preset`; `accent` field deleted
- Apple-native auto: system pref listener only fires when `mode === "auto"`;
  manual pick wins until user explicitly chooses Auto
- `[data-theme="<id>"]` and `[data-font-pairing="<id>"]` applied to
  `<html>` reactively
- Legacy storage migration: old `acreos-theme-config` rows with `preset`
  / `accent` are read tolerantly; `mode === "system"` migrates to `"auto"`
- Legacy compat exports preserved: `theme` / `setTheme` / `toggleTheme` /
  `resolvedMode` (used by `theme-toggle.tsx`)

`client/src/components/theme-settings.tsx` — quick-picker dialog rewritten
to use the new theme IDs and 4-cell prototype-style swatch grid. Five
themes shown with `bg / brand / ink / dark-bg` swatches and tagline. Mode
segmented control uses `light | dark | auto`. Reset button targets
Homestead. Dev-mode warning if a `ThemeId` lacks a swatch.

`npm run check` passes. `npx tailwindcss build` produces clean CSS (only a
pre-existing unrelated `ease-[cubic-bezier(...)]` ambiguous-class warning).

### What still works after the refactor

- `theme-toggle.tsx` (top-bar light/dark toggle) — unchanged, uses legacy
  compat exports (`theme` + `toggleTheme`)
- `App.tsx` ThemeProvider mount — unchanged
- All shadcn components — pick up the per-theme HSL automatically via the
  parallel token block

---

## Phase B.3 — Self-host five free font pairings (NEXT)

Per `prototype-design-system.md` §4.1 (locked, free-only). Standing
constraint: **no paid design assets**.

### Files to add to `client/public/fonts/`

| Pairing | Faces needed | Source | License |
|---|---|---|---|
| editorial | Fraunces (variable) ✓ already present, Inter (variable) ✓ present | — | OFL |
| modern | Inter Tight (variable display cut) | Google Fonts / GitHub: rsms/inter | OFL |
| classic | Charter (regular + italic + bold) | Matthew Butterick redistribution (https://practicaltypography.com/charter.html) | Free for commercial use per Butterick |
| native | none — system fonts | — | system |
| refined | Newsreader (variable) | Google Fonts: Production Type | OFL |
| (all pairings except native) | JetBrains Mono (variable) | Google Fonts / GitHub: JetBrains/JetBrainsMono | OFL |

### Steps

1. **Download** the variable woff2 files. Latin-subset only (EN-only product
   per HANDOFF.md §13). Suggested sources:
   - Inter Tight: https://fonts.google.com/specimen/Inter+Tight (Variable)
   - Newsreader: https://fonts.google.com/specimen/Newsreader (Variable)
   - JetBrains Mono: https://fonts.google.com/specimen/JetBrains+Mono (Variable)
   - Charter: practicaltypography.com (4 static cuts: regular/italic/bold/bold-italic)

   Place in `client/public/fonts/`. Use the Google `?display=swap` API or
   the explicit Variable woff2 from each foundry's GitHub repo. Self-host —
   never link to a CDN at runtime (per §0.1).

   **Charter caveat.** If Butterick's redistribution license has any
   ambiguity at audit time, swap the `classic` pairing's display face to
   **Source Serif Pro** (Adobe, OFL — already free) or **EB Garamond**
   (Georg Duffner, OFL). Pairing ID stays `classic`. Document the
   substitution in PORT-AUDIT-PHASE-B.md and update
   `prototype-design-system.md` §4.1 inline.

2. **Update `client/src/fonts.css`**: keep the existing Fraunces + Inter
   `@font-face` blocks. Add new `@font-face` blocks for Inter Tight,
   Newsreader, Charter, JetBrains Mono. Use `font-display: swap` and the
   same latin-subset `unicode-range` already in use.

3. **Add per-pairing CSS variable overrides at the bottom of `fonts.css`**:

   ```css
   /* Pairing assignments — driven by [data-font-pairing] on <html> */
   :root,
   [data-font-pairing="editorial"]:root {
     --font-display: 'Fraunces', 'Times New Roman', serif;
     --font-sans:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
     --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
     --font-serif:   'Fraunces', 'Times New Roman', serif;
   }
   [data-font-pairing="modern"]:root {
     --font-display: 'Inter Tight', -apple-system, BlinkMacSystemFont, sans-serif;
     --font-sans:    'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
     --font-mono:    'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
     --font-serif:   'Inter', 'Times New Roman', serif;
   }
   /* …classic, native, refined… */
   ```

   `native` pairing uses no `@font-face` — pure system stack:
   `-apple-system, BlinkMacSystemFont, "SF Pro Display", "Segoe UI", Roboto,
   sans-serif` for display + sans, `ui-monospace, SFMono-Regular, Menlo,
   monospace` for mono. Zero font load.

4. **Lazy loading** (optional optimization, fine to skip for first ship):
   The naïve approach declares all `@font-face` blocks up-front; browsers
   only fetch faces actually referenced by an active selector. Since each
   pairing only references its own faces via the `[data-font-pairing]`
   ancestor, browsers should naturally skip inactive pairings. Verify via
   DevTools network tab during audit.

5. **Index.css cleanup**: the old top-of-file `:root` block at lines
   122–128 still hard-codes the editorial pairing as the default. That's
   already overridden by fonts.css, but to avoid duplication the lines that
   set `--font-sans` / `--font-display` / `--font-serif` in the
   theme-agnostic `:root` of index.css can be deleted once fonts.css owns
   all pairing assignments. Verify import order in `main.tsx`:
   `fonts.css` must import **before** `index.css` so that fonts.css's
   defaults exist before index.css's `:root` block. (Already true per
   `fonts.css` header comment, but re-verify.)

6. **No Google Fonts CDN at runtime.** Search and remove any
   `<link href="https://fonts.googleapis.com">` or
   `@import url("https://fonts.googleapis.com/...")` references that
   sneak in. Self-host only.

7. **Verification**: open the app in each pairing in DevTools, confirm
   only the active pairing's faces appear in Network → Fonts. Take a
   screenshot per pairing of the same surface (e.g. /today) for the
   audit.

---

## Phase B.4 — Settings → Appearance UI

Reference: `~/Desktop/acreos-design-export/acreos/settings.jsx` lines 102–159.

Build at `client/src/components/settings/appearance-panel.tsx`:

- 5-up theme grid (use the same swatch shape as
  `client/src/components/theme-settings.tsx`)
- 3-up mode segmented control (Light / Dark / Auto)
- 5-up font pairing cards — each previewing display + body in the actual
  pairing fonts at sample text "AcreOS · the work is its own reward"
- Density Select dropdown (Compact / Comfortable / Adaptive)
- Reduce-motion Toggle — initial state from `prefers-reduced-motion` if
  the user hasn't set anything

Wire into `client/src/pages/settings.tsx` — likely a new tab or section.
Read existing settings page first to understand the chrome.

The existing `theme-settings.tsx` quick-picker stays as the top-bar shortcut
— full panel in settings is the trust surface (§14 design-system doc),
the dialog is the fast path.

---

## Phase B.5 — Server-side preferences persistence

Per CLAUDE.md: use `AuthenticatedRequest`, `getUserId(req)`, `Errors.*`
helpers, structured `logger`.

### Schema

Extend the user model with a `preferences` JSONB column (or similar) holding:

```ts
{
  theme: 'homestead' | 'quarry' | 'nocturne' | 'meadow' | 'slate'
  mode: 'light' | 'dark' | 'auto'
  fontPairing: 'editorial' | 'modern' | 'classic' | 'native' | 'refined'
  density: 'compact' | 'comfortable' | 'adaptive'
  motion: 'full' | 'reduced'
  // Phase C will add: sidebarConfig, notifications, listViews, autonomy
}
```

Defaults: `homestead | auto | editorial | adaptive | full` (or `reduced`
if user has `prefers-reduced-motion`).

### Endpoints

- `GET /api/me/preferences` → returns the preferences blob with defaults
  filled in
- `PATCH /api/me/preferences` → accepts a partial update; validates each
  field against the canonical enum lists (use a Zod schema); returns the
  merged result

Validate aggressively — reject unknown values with `Errors.validationFailed`
not silent fall-through.

### Client wiring

Update `theme-context.tsx`:
- On mount, fetch `/api/me/preferences` and hydrate state (after the
  localStorage fallback, server wins if available)
- On `setThemeConfig`, debounce a `PATCH /api/me/preferences` (300 ms is
  fine; preferences aren't time-critical)
- Fail silently if PATCH errors — keep the local state, log via
  `console.warn`. Don't block UI on server errors.

### No-flash strategy

Server-side: render `<html data-theme="<theme>" class="<dark?>">` from the
session-loaded preferences before client hydration. If using
client-only rendering, fall through to the existing localStorage hydration
in `loadStoredConfig` — first paint is correct as long as we localStorage
on every change.

---

## Phase B.6 — Verification

Use existing bypass infrastructure. Capture sample surfaces per
`tests/e2e/capture-auth-surfaces.ts`.

Required artifacts in `docs/exhaustive-completion/auth-screenshots/`:
- `_port-phase-b-theme-{homestead,quarry,nocturne,meadow,slate}-{light,dark}-today.png` (10 shots)
- `_port-phase-b-pairing-{editorial,modern,classic,native,refined}-today.png` (5 shots)
- `_port-phase-b-persistence.png` (single before/after sign-out/in
  showing preferences hold)

Output `PORT-AUDIT-PHASE-B.md`:
- Per-theme + per-mode visual confirmation
- Per-pairing visual confirmation
- Persistence proof
- Any judgment calls made (e.g. Charter substitution, Modern's Inter Tight
  axis tuning, glass-token mode-only compromise)
- No regressions on `npm run check` / `npm test`

---

## Phase B.7 — Tracker + handoff

1. Update `_progress.md` Phase B → complete; Phase C → next.
2. Add Phase B summary section above the Phase A summary.
3. Write `_RESUME-PORT-PHASE-C.md` covering: sidebar configuration,
   notification preferences, list-view preferences, autonomy matrix UI.
4. Final commit: `port(phase-b): five themes + font pairings + appearance settings [exhaustive] [port-phase-b]`

---

## Phase B decisions (locked — copy from design-system §0.2)

1. **HSL parallel system** — derive HSL per theme. ✅ Done in B.1.
2. **Card border radius** — `rounded-card: 14px`. ✅ Done in B.1.
3. **Fonts** — five free pairings (Editorial / Modern with Inter Tight /
   Classic with Charter+fallback / Native / Refined with Newsreader). To
   ship in B.3.
4. **Auto mode** — Apple-native, manual wins until user picks Auto.
   ✅ Done in B.2.

Standing platform constraint: **no paid design assets** (fonts, icons,
illustrations, premium UI kits). Free / open-source / self-hostable only.

---

## Bar for Phase B complete

- [x] All 5 themes × light + dark active in production CSS (B.1)
- [x] Theme switching is live (no reload) across every surface (B.1+B.2)
- [x] `rounded-card` token added (B.1)
- [x] Theme-context hooks updated to new IDs + Apple-native auto (B.2)
- [ ] All 5 font pairings load efficiently from self-hosted files (B.3)
- [ ] Settings → Appearance surface built (B.4)
- [ ] User preferences persist server-side (B.5)
- [ ] No type-check or test regressions (verify each phase)
- [ ] PORT-AUDIT-PHASE-B.md complete with verification screenshots (B.6)
- [ ] Phase C resume doc written (B.7)

---

*Phase B is partway through. B.1 + B.2 landed clean; B.3 onward is queued.*
