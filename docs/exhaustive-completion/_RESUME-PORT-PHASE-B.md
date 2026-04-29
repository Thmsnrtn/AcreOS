# Resume — Production Port Phase B

**Last commit before Phase B starts:** `d39c761` (HEAD as of Phase A close).
Phase A's commit will land on top of this with the design-system doc + tracker
updates.

**Active directive:** Production port from prototype, replacing Gap 1.1.E/F.
Eight phases (A–H). See `_progress.md` for the full phase list.

---

## What Phase A delivered

`docs/exhaustive-completion/prototype-design-system.md` — single source of
truth for the port:

- §1 voice exemplar (founder letter) + voice rules + AI agent framing
- §2 visual baseline + density + motion + anti-patterns
- §3 token inventory: **all five themes × light/dark** with full per-token
  tables (Homestead, Quarry, Nocturne, Meadow, Slate — renamed from `titan`).
  Motion tokens, z-index layers, spacing rhythm, radius scale.
- §4 type system — five curated pairings (Editorial / Modern / Classic /
  Native / Refined) + load strategy + scale
- §5 component grammar — buttons, cards, pills, icons, hierarchy
- §6 density / motion / personalization surfaces
- §7 autonomy matrix (per-agent × per-action × thresholds × time guardrails)
- §8 feature flag system architecture
- §9 component mapping table — prototype → production
- §10–14 density per surface, state coverage, a11y floor, acknowledgment
  moments, six extra-attention surfaces
- §15 expert designer permissions + the test for every surface
- §16 export file map (do not modify)

Tracker updates landed in `_progress.md` (Phase A complete; Phase B–H
enumerated; current-state section refreshed).

---

## Phase B objective

Implement the 5-theme × light/dark system + the 4–5 font pairings + the
Settings → Appearance surface that drives theme switching live (no reload).
Persist user preferences server-side.

---

## Phase B steps (in order)

### B.1 — Theme tokens in CSS

1. **Read** `client/src/index.css` lines 1–500 (current state: Homestead
   `--acr-*` already lifted at lines 12–120; legacy `data-theme="midnight"`
   etc. system at lines ~260–390).
2. **Replace the legacy theme system.** The five `data-theme` blocks
   (`midnight`, `forest`, `ocean`, `sunset`, `monochrome`) and the
   `data-accent` overrides do not match the prototype's five-theme spec.
   Strategy:
   - Keep the existing `:root` + `.dark` Homestead block (it's correct).
   - Wrap it as the `[data-theme="homestead"]` default.
   - Add four new `[data-theme="quarry|nocturne|meadow|slate"]` blocks, each
     with `:root`-style light values + a paired `[data-theme="X"].dark` block.
   - Per-theme value source: `prototype-design-system.md` §3.3.{1..5} OR
     `~/Desktop/acreos-design-export/acreos/theme.jsx` directly. **Do not
     approximate.**
   - Delete the legacy theme blocks + `data-accent` blocks. Anything
     referencing them (grep `data-theme=` and `data-accent=`) must migrate to
     the new IDs.
3. **HSL parallel system.** The shadcn-style HSL tokens (`--primary`,
   `--background`, etc.) currently encode a single Homestead palette per mode.
   Decision needed: derive HSL tokens per theme so shadcn primitives switch
   with theme, OR keep shadcn HSL fixed to Homestead and lean on `--acr-*`
   for theme switching. Recommend **derive HSL per theme** — converting each
   theme's hex tokens to HSL — so existing shadcn components don't drift from
   the active theme. Document the decision in PORT-AUDIT-PHASE-B.md.

### B.2 — Theme + mode runtime

Production currently has `useTheme` / dark-mode logic somewhere in
`client/src/`. Audit:

```bash
grep -rn "data-theme=" /Users/user/AcreOS/AcreOS/client/src
grep -rn "useTheme\|setTheme\|theme:" /Users/user/AcreOS/AcreOS/client/src/hooks /Users/user/AcreOS/AcreOS/client/src/contexts 2>/dev/null
```

Build (or refactor):

- Hook `useTheme()` — reads/writes `user.preferences.theme` (one of
  `homestead | quarry | nocturne | meadow | slate`) and `user.preferences.mode`
  (`light | dark | auto`). Updates `<html data-theme="X">` + toggles
  `.dark` class. Persists to server on change (debounced).
- Hook `useFontPairing()` — analogous, drives `--font-sans` / `--font-serif` /
  `--font-mono` CSS variables on `:root`. Lazy-loads non-active pairing fonts
  on switch.
- Apply `<html data-theme="X">` from server-rendered preference (or first
  paint fallback to localStorage cached value to prevent flash).

### B.3 — Self-host fonts

Currently `client/src/fonts.css` self-hosts Fraunces + Inter. Add:

- **Editorial pairing** (default): already has Fraunces + Inter. Add
  JetBrains Mono (variable, weight 100–800).
- **Modern**: drop in Inter Tight as Söhne fallback if licensing not in place.
- **Classic**: Charter or Iowan Old Style web faces (verify license; fall back
  to a self-hostable serif).
- **Native**: zero load — uses `-apple-system, BlinkMacSystemFont, ...`.
- **Refined**: Fraunces (already loaded) with axes tuned softer; pair with
  Söhne if available, else Inter.

Each pairing's fonts go in `client/public/fonts/` with a corresponding
`@font-face` block (or grouped in `fonts.css`). Latin subset only (per
HANDOFF.md §13).

### B.4 — Settings → Appearance UI

Reference: `~/Desktop/acreos-design-export/acreos/settings.jsx` lines 102–159
(`AppearancePanel`).

Build at `client/src/components/settings/appearance-panel.tsx`:

- Direction picker — 5 theme cards. Each card: 4-cell swatch grid (light bg,
  light brand, light ink, dark bg) + theme name + tagline. Active theme
  highlighted with `--acr-ring` and brand border. Click sets theme live.
- Mode picker — 3-button segmented control (Light / Dark / Auto). Auto
  follows `prefers-color-scheme`.
- Density picker — Select dropdown (Compact / Comfortable / Adaptive).
- Reduce-motion Toggle — initial state from `prefers-reduced-motion`.
- Font pairing picker — 4–5 pairing cards each previewing display + body in
  the pairing.

Wire into existing settings page at `client/src/pages/settings.tsx`.

### B.5 — Server-side persistence

User preferences shape (extend existing user model):

```ts
preferences: {
  theme: 'homestead' | 'quarry' | 'nocturne' | 'meadow' | 'slate'
  mode: 'light' | 'dark' | 'auto'
  fontPairing: 'editorial' | 'modern' | 'classic' | 'native' | 'refined'
  density: 'compact' | 'comfortable' | 'adaptive'
  motion: 'full' | 'reduced'
  // (Phase C will add sidebar / notifications / list-views / autonomy)
}
```

Endpoints:
- `GET /api/me/preferences` (existing or new)
- `PATCH /api/me/preferences` (debounced from client on change)

Migration: add columns or JSONB `preferences` column on the user table if not
present. Default values: `homestead`, `auto`, `editorial`, `adaptive`,
`full` (or `reduced` if `prefers-reduced-motion`).

Use `AuthenticatedRequest` + `getUserId(req)` per CLAUDE.md. Use
`Errors.*` helpers for error responses.

### B.6 — Verification

Use the existing bypass + capture infrastructure:

```bash
# Capture sample surfaces in each theme + mode, both at 1440 + 375
# Existing tooling: tests/e2e/capture-auth-surfaces.ts
# Bypass: dev founder bypass at acreos.io
```

Verify:
- Theme switches live across all surfaces (no reload), every theme.
- Light → dark → auto modes work per theme.
- Font pairing switches load only the active pairing's fonts.
- Density + motion preferences persist.
- No regressions on existing pages (run `npm run check`, `npm test`).

Output `PORT-AUDIT-PHASE-B.md`:
- Token table verification — sample surface (e.g. /today) screenshot in each
  of 5 themes × 2 modes = 10 screenshots
- Font pairing screenshots (4–5 of /today with different pairings)
- Personalization persistence proof (preferences saved + restored across
  sign-out/sign-in)

### B.7 — Tracker + handoff

1. Update `_progress.md` Phase B → complete; Phase C → next.
2. Add Phase B summary section above the Phase A summary.
3. Write `_RESUME-PORT-PHASE-C.md` with last commit SHA + Phase C objective +
   steps. Phase C covers: sidebar config, notification preferences, list-view
   preferences, autonomy matrix UI.
4. Commit Phase B work as `port(phase-b): five themes + font pairings + appearance settings [exhaustive] [port-phase-b]`.

---

## Tracker conventions

- Commit prefix: `port(phase-X): summary [exhaustive] [port-phase-X]`
- Capture artifacts go in `docs/exhaustive-completion/auth-screenshots/`
  prefixed `_port-phase-X-…`
- Bypass infra (Gap 1.1.A) is still load-bearing — do not touch until Phase H
  passes and Gap 1.1.G runs.

---

## Bar for Phase B complete

- [ ] All five themes × light + dark active in production CSS
- [ ] Theme switching is live (no reload) across every surface
- [ ] All 4–5 font pairings load efficiently (lazy on demand)
- [ ] Settings → Appearance surface built per `acreos/settings.jsx` reference
- [ ] User preferences persist server-side (theme, mode, font, density, motion)
- [ ] No type-check or test regressions
- [ ] PORT-AUDIT-PHASE-B.md complete with verification screenshots
- [ ] Phase C resume doc written

---

## Open questions for Phase B

These came up during Phase A; resolve at Phase B start or document the call:

1. **HSL parallel system (B.1.3)** — derive shadcn HSL tokens per theme, or
   keep them fixed to Homestead? Recommendation: derive per theme.
2. **Card border radius (§3.7 of design-system doc)** — prototype default is
   14 px, sits between Tailwind `lg` (16) and `md` (8). Add a Tailwind
   custom `rounded-card: 14px`, or use `rounded-[14px]` inline?
3. **Font pairings with paid licenses** (Söhne, New Spirit) — confirm
   licensing or substitute with parenthetical fallback (Inter Tight, Fraunces
   Extra Soft) on first ship.
4. **Auto mode + manual override interaction** — when user has explicit
   light/dark, should `prefers-color-scheme` change update them? Standard
   Apple behavior says no (manual wins until user picks Auto).

Take these to the founder if uncertain; do not let them ship as developer
judgment calls.

---

*Phase B begins from this resume doc. Phase A's commit lands first.*
