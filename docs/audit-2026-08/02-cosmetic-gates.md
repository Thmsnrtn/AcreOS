# 02 — Cosmetic Gate Table (quick slice)

The six cosmetic lints are all real, all bidirectional-ratchet-shaped, and all wired into `npm run check` (verified in `package.json` `scripts.check`). They are honest about their own scope in their header comments. The single defect class that survives here: **each lint scans a narrow syntactic form in a narrow directory, so the same cosmetic defect expressed in a sibling idiom or a sibling folder passes untouched** — most consequentially `lint:css-hover`, which guards `.css` files but ignores the Tailwind `hover:` utility that is the app's dominant hover idiom, and `lint:page-hex`, which guards `pages/` but not `components/`.

| Lint | What it matches (from the script) | What a reader would assume it covers that it does NOT | In `npm run check`? | Miss severity |
|---|---|---|---|---|
| **lint:zindex** (`lint-zindex.mjs`) | In `client/src/**/*.tsx`: arbitrary `z-[…]` (baseline 0) and raw numeric `z-{0,1,10,20,30,40,50,60}` Tailwind classes (per-file baseline, drive-to-zero). | Only `.tsx` class strings. Misses `.ts` files, `.css` `z-index:` declarations, and inline `style={{ zIndex: 50 }}` numeric literals — a raw stacking value in any of those three forms is unguarded. | yes | P3 |
| **lint:translucency** (`lint-translucency.mjs`) | In `client/src/**/*.tsx`: raw opacity-modifier surface classes `bg-(background\|card\|…\|black\|white)/(7x\|8x\|9x)` (per-file baseline). | Only the `bg-token/NN` class form in `.tsx`. Misses inline/arbitrary `bg-[rgba(…)]`, raw `rgba()`/`hsla()` in `.css`, and non-listed color roles. Same translucency in a `.css` file or arbitrary-value class passes. | yes | P3 |
| **lint:css-hover** (`lint-css-hover.mjs`) | Brace-depth-aware scan of `client/src/**/*.css`: a `:hover` block not enclosed by an `@media (hover: hover)` query. Baseline now empty (0). | Only `.css` files. Misses the Tailwind `hover:` utility in `.tsx` — the app's *dominant* hover idiom — plus inline handlers. The iOS double-tap bug the lint exists to prevent recurs freely in JSX, where most hovers live. | yes | **P2** |
| **lint:page-hex** (`lint-page-hex.mjs`) | Comment-masked scan of `client/src/pages/**/*.tsx` for hex color literals (`#abc`/`#aabbcc`/8-digit), entity/ticket guarded (per-file baseline). | Only `pages/`. Misses `client/src/components/**` — the bulk of UI — so a hardcoded hex breaking dark-mode/white-label in a component is unguarded. Also self-admits a miss on mixed-digit-only hex like `#112233`. | yes | **P2** |
| **lint:date-format** (`lint-date-format.mjs`) | `client/src/**` (excl. tests): `.toLocaleDateString(` / `.toLocaleTimeString(` outside `lib/format.ts` (per-file baseline, drive-to-zero). | Only those two method names. Intentionally skips bare `.toLocaleString()`, but also misses `Intl.DateTimeFormat`, `new Date().toString()`, and date-fns/dayjs raw formatting — other paths to the same per-locale date drift. Client-only; server date rendering unscanned. | yes | P3 |
| **lint:prefetch-authority** (`lint-prefetch-authority.mjs`) | `client/src/**/*.tsx?` (excl. tests): any `.prefetchQuery(` / `.prefetchInfiniteQuery(` call outside `lib/queryClient.ts` → fail (zero tolerance). | Bans the direct-call *symptom* only. It does not verify that warm paths actually route through `prefetchRoute`, nor that new array-contract keys are added to its normalizer — a consumer can still be poisoned by a key the authority doesn't normalize. | yes | P3 |

## Summary

All six lints are wired into `npm run check` and are well-documented, correctly-shaped bidirectional ratchets — this tier is in good health and not the place to spend audit budget. The consolidated weakness is scope narrowness: each lint pins one syntactic form in one folder, so the `css-hover` guard (`.css` only, blind to Tailwind `hover:` in JSX) and the `page-hex` guard (`pages/` only, blind to `components/`) leave their stated harms — iOS double-tap and un-themeable hardcoded color — reachable through the more common idiom. These are cosmetic/trust-after-sale issues (P2 at worst), not first-sale blockers, and each is closable by widening the existing scan rather than writing a new gate.

## Coverage ledger

- **Examined exhaustively:** header/contract comments and scope constants (`SCAN_DIR`/`DEFAULT_SCOPE`, match regexes, baselines) of all six scripts; `package.json` `scripts.check` wiring for all six.
- **Examined by sampling:** the walk/matcher bodies (read enough to confirm `.tsx`-only vs `.css`-only scope and the exclusion of test files); did not re-run each lint's `--measure`.
- **Did NOT examine:** actual current offender counts at HEAD (no `--measure` run); the fixture tests backing each lint; whether `client/src/components/**` in fact contains un-themeable hex (asserted as a scope gap, not a counted violation); server-side date rendering.

## Constitution Collisions

None. These are cosmetic lints; none touch nav doors, money custody, marketplace/API ladders, AI destinations, fabrication, or founder-only hard-stops.
