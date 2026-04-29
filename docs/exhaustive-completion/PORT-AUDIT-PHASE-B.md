# Port Audit — Phase B (Theme + Font + Appearance)

Phase B sub-phases B.1 → B.5 landed across commits `e96ef89`, `50f3499`,
`77295f3`, `955d1c7` (plus `999d8b6` resume-doc tightening, `d530396`
Phase A). This audit records what passes static verification, what
requires live-eye checks, and what carries deliberate compromise.

## What landed

| Sub-phase | Deliverable | Commit |
|---|---|---|
| B.1 | 5 themes × light/dark in `client/src/index.css`; legacy theme blocks deleted; `rounded-card: 14px` in tailwind.config.ts | `e96ef89` |
| B.2 | `theme-context.tsx` with new ThemeId / ThemeMode / FontPairing types; Apple-native auto; quick-picker dialog updated | `e96ef89` |
| B.3 | 5 self-hosted free font pairings; Google Fonts CDN refs killed everywhere (font-loader.ts deleted, CSP allowlists cleaned) | `50f3499` |
| B.4 | Full Settings → Appearance panel with Theme / Mode / Type / Density / Motion sections; sample-text font previews | `77295f3` |
| B.5 | `users.appearance_preferences` JSONB column + GET/PATCH `/api/me/preferences`; debounced server sync from theme-context | `955d1c7` |

## Static verification — passes

All confirmed via `npm run check` and `npx tailwindcss build`:

- ✅ `npm run check` (full TypeScript) — 0 errors across all 5 commits
- ✅ Tailwind build — produces clean CSS (only pre-existing unrelated
  `ease-[cubic-bezier(...)]` warning carried over from before the port)
- ✅ 10 `[data-theme="..."]` selectors in `client/src/index.css` (5 themes
  × light + dark)
- ✅ 6 `@font-face` blocks in `client/src/fonts.css` (Fraunces, Inter,
  Inter Tight, Source Serif 4, Newsreader, JetBrains Mono)
- ✅ 5 `[data-font-pairing="..."]` selectors in `client/src/fonts.css`
- ✅ 6 woff2 files in `client/public/fonts/` (latin-subset variable):
  - Fraunces — 67 KB (pre-existing)
  - Inter — 48 KB (pre-existing)
  - Inter Tight — 45 KB (B.3)
  - JetBrains Mono — 40 KB (B.3)
  - Newsreader — 132 KB (B.3)
  - Source Serif 4 — 122 KB (B.3, substituted for Charter per JUDGMENT-CALLS B.3.1)
- ✅ Zero `fonts.googleapis.com` / `fonts.gstatic.com` references in
  `client/` and `server/` (was 4 before B.3)
- ✅ CSP allowlists for Google Fonts removed in both `security.ts` and
  `securityEnhancements.ts`
- ✅ Migration `0028_user_appearance_preferences.sql` adds nullable JSONB
  column on `users` — backwards-compatible with existing rows
- ✅ Server endpoint validates with Zod against canonical enums; rejects
  unknown values via `Errors.validationFailed`

## Live-eye verification — required from founder

Static checks confirm code shape; the following need a deployed build +
human eye:

### Theme cycling

Sign in to the deployed app, navigate to `/today`, open Settings →
Appearance, and click each theme card in turn. Confirm:

- [ ] Each of 5 themes (Homestead / Quarry / Nocturne / Meadow / Slate)
      switches the page colors live, no reload required
- [ ] Each theme × light AND dark mode looks correct (10 combinations)
- [ ] Sidebar background, top bar, cards, buttons, inputs all read as
      the active theme — no orphan elements stuck on Homestead colors
      (would indicate a shadcn primitive missing the HSL parallel)
- [ ] Borders look right per theme — alpha-on-bg lines were composited
      to solid HSL approximations; visual difference vs. true alpha
      should be subtle. Flag any theme where borders look wrong.
- [ ] Auto mode follows OS dark/light at first paint, then stays on the
      manual pick if the user explicitly chooses Light or Dark
- [ ] Toggle OS dark mode at the system level while on Auto — app flips;
      while on manual Light or Dark — app does NOT flip (Apple-native rule)

### Font pairings

In Settings → Appearance, click each of 5 pairing cards. Confirm:

- [ ] Sample text in each card renders in that pairing's actual fonts
      (visual difference between Editorial / Modern / Classic / Native
      / Refined should be obvious in the card itself)
- [ ] Switching pairing live updates body text and headings across the
      page
- [ ] Native pairing renders with system fonts (SF Pro on Mac) — no
      font load
- [ ] DevTools Network tab during pairing switch: only the active
      pairing's faces should fetch. If browsers prefetch all six
      `@font-face` declarations on first load, document the over-fetch
      and decide whether to lazy-load before launch (per resume-doc B.3
      constraint #3).

### Density + motion

- [ ] Density Select (Compact / Comfortable / Adaptive) sets `[data-density]`
      on `<html>` — verify in DevTools Elements panel. Surface-level
      density rules wire in Phase E; for now this just persists.
- [ ] Reduce Motion toggle sets `[data-motion="reduced"]` and collapses
      transition durations. Compare a hover-state animation before /
      after toggling.
- [ ] First load with no preference saved: motion follows OS
      `prefers-reduced-motion`. Manual toggle wins thereafter even if
      OS setting changes.

### Cross-device persistence

- [ ] Set theme to Quarry on device A, refresh — persists.
- [ ] Sign out, sign back in — Quarry restored from server.
- [ ] Sign in on device B — Quarry restored from server (cross-device
      consistency).
- [ ] Brief flicker possible on first paint of device B since
      localStorage is empty there → server fetch overrides defaults.
      Per JUDGMENT-CALLS B.5.1 this is acceptable; flag if it feels jarring.

## Deliberate compromises

Three deliberate compromises documented in JUDGMENT-CALLS.md should be
verified against design brief intent:

1. **Charter → Source Serif 4** (JUDGMENT-CALLS B.3.1) — license
   ambiguity bias-toward-swap. Compare visual register vs. Charter
   reference; if Source Serif feels too cool / too geometric for the
   "warm editorial with stronger serif voice" Classic pairing should
   carry, flag for swap to EB Garamond.
2. **Glass tokens + 4-level shadows mode-only, not per-theme** (B.1
   commit body) — `--glass-bg-light`, `--shadow-1..4` carry one set
   each for light + dark, ignoring theme. Glass effects should still
   read correctly across all 5 themes; if Quarry-light glass looks
   wrong against editorial paper backgrounds, theme glass too.
3. **No-flash via localStorage-first, not SSR** (JUDGMENT-CALLS B.5.1)
   — cross-device flicker possible on first paint of new device.
   Single-device repeat visits paint clean.

## Migration deployment note

`migrations/0028_user_appearance_preferences.sql` is **not yet applied**
in this commit chain. It runs at deploy time via the existing
`drizzle-kit migrate` pipeline. Verify the column exists on production
before live testing PATCH `/api/me/preferences`:

```sql
SELECT column_name FROM information_schema.columns
WHERE table_name = 'users' AND column_name = 'appearance_preferences';
```

Until the column exists, the GET endpoint will throw on production. The
client gracefully falls back to localStorage on PATCH/GET errors, so
users see no functional break — just no cross-device sync.

## Next phase

Phase C — personalization infrastructure (sidebar config, notification
preferences, list-view preferences, autonomy matrix). Resume doc:
`_RESUME-PORT-PHASE-C.md` (written at B.7).
