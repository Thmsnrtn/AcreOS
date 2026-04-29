# Gap 1.1.D — COMPLETE. Ready for founder (1.1.E).

**All 9 sub-phases of the founder directive are shipped, deployed, and verified end-to-end.**

Last commit at completion: `759138b` (after `954fa6f` deploy of vendor bundling).

---

## What the founder should expect

### Open the picker

1. Sign into https://acreos.io normally via Clerk (Google or whatever you use).
2. Then navigate to **https://acreos.io/__dev/picker/**.
3. The picker loads server-rendered same-origin to acreos.io so the production preview iframe carries your Clerk session cookies.

### Picker interface

- **Top bar** — AcreOS Picker title (Fraunces) · progress bar · filter chips (all/undecided/decided) · Export button.
- **Sidebar (left)** — 36 decisions across 3 categories:
  - Visual review (28) — per-surface fidelity vs prototype, options: accept / fix-needed / rebuild + free-form notes
  - Platform tweaks (4) — density / primary color / base font size / dark mode default
  - Build vs defer (4) — unimplemented founder sub-routes (/founder/revenue, /cost, /ops, /tenants)
- **Main panel** — decision card with editorial title, three-panel comparison (Prototype | Production | Preview) at selectable breakpoints (320 / 375 / 414 / 768 / 1024 / 1440), zoom slider, copy edit toggle, split-view toggle.
- **Bottom bar** — Previous/Next + keyboard hints.

### Capabilities

| Capability | How to use |
|---|---|
| **Copy editing** | Click "Edit copy" (top of decision card). Hover any text in the Preview panel — outline appears. Click to edit inline. Edits save automatically to your selection's `copyOverrides`. Reset individual edits via the "Copy edits" panel that appears below the comparison. |
| **Split view** | Click "Split view" toggle. Two rows of 3 panels appear; top row uses the breakpoint selector at the top, bottom row gets its own selector. Verify mobile and desktop coherence side by side. |
| **Density** | Open the "Platform density" decision (under Platform tweaks). Click Compact / Comfortable / Spacious for presets, or Custom to reveal 4 sliders (font-size scale, line-height, section padding, item spacing). Preview updates in real time. |
| **Color/token** | Open "Platform primary color". 3 swatches: default terracotta, deeper, warmer. Each updates `--acr-brand` plus `--acr-brand-soft`, `--acr-glow`, `--acr-ring`, `--acr-chart-a` together. Reset-to-default clears all overrides. |
| **Keyboard nav** | `j` / `k` (or arrow keys) move between decisions · `1` / `2` / `3` choose options · `a` / `u` / `d` set the filter (all/undecided/decided). |
| **Export** | Click Export. Server writes to `/tmp/founder-selections.json` on Fly + your browser downloads `founder-selections.json` immediately. |

### After Export — pulling the file back to the repo

The server-side write is on Fly's tmpfs. To copy into the repo:

```bash
fly ssh console -a acreos -C 'cat /tmp/founder-selections.json' \
  > docs/exhaustive-completion/founder-selections.json
git add docs/exhaustive-completion/founder-selections.json
git commit -m "feat(1.1.E): founder selections committed"
```

Or simply move the file your browser downloaded into `docs/exhaustive-completion/founder-selections.json`.

Either path triggers Gap 1.1.F (audit-after-fix loop).

---

## Time estimate

36 decisions. Visual-review at ~1-2 minutes per surface (28 × 1.5min ≈ 45 min). Tweaks ~5 min each. Build/defer ~3 min each. **Total: ~70-90 minutes** of focused work.

---

## Verification proof (so founder doesn't have to re-discover it)

End-to-end Playwright smoke at `tests/e2e/_picker-smoke.ts` — 22/22 checks pass:

- Sign-in via Clerk ticket
- Picker shell loaded
- Fraunces editorial font loaded
- Warm cream `--acr-*` palette in use
- Tier badges rendered (29 markers)
- Three-panel iframes mounted
- Prototype iframe bootstrapped (window.__nav callable, content rendered)
- Decision title is editorial (Fraunces)
- Breakpoint switch clickable
- Split view shows 6 iframes
- Option choice via keyboard/click
- Edit copy toggle activates
- Editable text spans injected (218 [data-copy-id] elements on /today)
- Platform density decision opens
- Density preset chosen (Spacious)
- Custom mode reveals 4 sliders
- Platform color decision opens
- Brand color swatch chosen
- Build/defer option chosen
- Server-side export endpoint returns 200
- Response includes server target path
- Response includes retrieval command for founder

Verification screenshots: `docs/exhaustive-completion/auth-screenshots/_picker-verification-{01-shell,02-three-panel,03-split-view,04-edit-mode,05-density-spacious,06-density-custom,07-color-deeper,08-export-result,99-final}.png`.

---

## Decisions made during D.6.4-9 implementation that aren't obvious from code

1. **Picker injector scripts served as same-origin static files.** Initial attempt used `script.textContent = SOURCE` (inline script). Production iframe CSP requires `script-src 'self' + nonce-only` for inline; rejected my injection. Fix: scripts at `acreos-picker/public/injectors/{copy-edit,density,tokens}.js` → vite copies to `dist/injectors/` → served at `/__dev/picker/injectors/<name>.js` → picker uses `script.src = URL` which passes `'self'` source.

2. **React/Babel bundled as same-origin vendor files in `acreos/vendor/`.** The prototype iframe's `<script src="https://unpkg.com/...">` tags fail with `net::ERR_FAILED` in Chrome (and Chromium) when loaded inside an iframe at acreos.io — even with permissive CSP, even with `crossorigin`/`integrity` removed, even with --disable-web-security. Top-level page loads work fine; iframe-context cross-origin script loading is broken (something in the Chrome iframe security model rejects them). Fix: download React 18.3.1 + Babel standalone 7.29.0 to `acreos/vendor/`, serve same-origin from `/__dev/prototype/vendor/`. The prototype now loads without external CDN dependency.

3. **Server export writes to /tmp on Fly, not /app/docs.** On Fly, `/app` was copied as root in the Dockerfile but the process runs as uid 1000 (`node` user). Writes to `/app/docs` get EACCES. `/tmp` is always writable (already used by the bypass audit log). Endpoint response carries a retrieval command so founder/Claude can pull the file back via `fly ssh console`.

4. **`@clerk/express` 2.x exposes `req.auth` as a function**, not an object. The handler invokes it: `typeof rawAuth === 'function' ? rawAuth().userId : rawAuth.userId`. The dev bypass middleware injects `req.auth = { userId }` as a plain object — handler accepts both shapes.

5. **Constrained color palette for `--acr-brand`.** No arbitrary hex picker. 3 founder-approved terracottas: #C2531C (current production), #A04316 (deeper), #E07749 (warmer). Each option also updates derived tokens (`--acr-brand-soft`, `--acr-glow`, `--acr-ring`, `--acr-chart-a`) computed via `hexToRgba()` so the brand cluster stays coherent.

6. **Density preview is "cosmetically demonstrative."** The injected stylesheet uses CSS custom properties (`--acreos-density-fs`, etc.) and applies them via broad-target selectors (`html`, `main`, `[class*="gap-"]`). It changes the visible feel of the surface so the founder can compare presets — but the saved values go to `selection.densityOverrides` for 1.1.F to apply properly (e.g., by retrofitting production CSS to consume the variables, or by editing components directly).

---

## Cleanup at 1.1.G (after 1.1.F audit-after-fix is approved)

In addition to the existing 1.1.A bypass cleanup checklist (`docs/exhaustive-completion/REMOVE-BEFORE-LAUNCH.md`):

- Delete `acreos-picker/` entire directory (Vite app + dist).
- Delete `acreos/vendor/` (React/Babel bundled scripts).
- Delete `acreos/acreos.html` and the `acreos/*.jsx` files (the prototype itself).
- Remove `/__dev/picker`, `/__dev/prototype`, `/__dev/injectors`, and `/api/__dev/founder-selections` route registrations from `server/routes.ts`.
- Revert CSP loosening in `server/middleware/security.ts` (the `/__dev/*` branch).
- Delete `tests/e2e/_picker-smoke.ts`.
- Delete this file.
- Search codebase: `grep -r "REMOVE_BEFORE_LAUNCH" --include="*.ts" --include="*.tsx"` should return 0; `grep -r "DEV_FOUNDER_BYPASS"` should return 0 (excluding the historical `_progress.md` references).

---

## Picker URL summary

- **Picker** — https://acreos.io/__dev/picker/
- **Prototype** (loaded as iframe inside picker) — https://acreos.io/__dev/prototype/acreos.html
- **Injectors** — https://acreos.io/__dev/picker/injectors/{copy-edit,density,tokens}.js
- **Export endpoint** — POST https://acreos.io/api/__dev/founder-selections (Clerk founder session OR bypass header)

All routes inert without `DEV_FOUNDER_BYPASS=true` env var on Fly. All planned for removal at 1.1.G.
