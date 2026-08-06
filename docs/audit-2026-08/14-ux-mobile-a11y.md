# 14 — UX / Mobile / Accessibility

*Slice 14. Read-only. Depth: medium (stratified).*

The mandated UI patterns exist and are widely used — `Skeleton` in 191/258 pages, `EmptyState` in 105, `QueryErrorState` in 100 — but **none of the three is enforced by any gate**, and the one that matters most (error states) is the most-skipped. The single defect class that survives every gate here: **a failed data fetch renders as an empty state** — "no tenants / no deals" shown when the load actually errored. That is the fabrication-from-empty-set class the constitution forbids, arriving through the front door. Secondary: the WCAG `jsx-a11y` ruleset is dead config (never ported to the active flat config), so a11y enforcement is exactly one custom rule. Capacitor is plausibly buildable; the Tauri v2 desktop app builds but is non-functional (no `capabilities/`).

---

### F-14-1 — Failed queries render as empty states ("no data" shown when the load errored)
**Severity:** P1 serious
**Surfaced by:** slice 14
**Survives which gates:** No lint references `QueryErrorState` (`grep -rln QueryErrorState scripts/` = 0 hits). `npm run check` has 18 lints, none enforce error-state coverage. `tests/unit/accessibility.test.ts` is string-grep only. The `acreos/*` ESLint rules don't cover query error branches. So a page that ships loading + populated states but omits the error branch passes everything.
**Evidence:** `client/src/pages/tenants.tsx:156-158` — `{list.isLoading ? <Skeleton/> : list.data && list.data.tenants.length > 0 ? <table> : <empty>}`. There is no `list.isError` branch: on a fetch failure `data` is `undefined`, `isLoading` is `false`, so control falls to the else branch and renders the **empty state**. 48 pages use `useQuery` with no `isError`/`QueryErrorState`/`.error` reference (measured: loop over `grep -rl useQuery client/src/pages`), e.g. `deals`-adjacent `notes-pipeline.tsx`, `tasks.tsx`, `founder-decisions.tsx`, `investor-directory.tsx`, `commissions.tsx`.
**What's wrong:** The three-state ternary collapses "error" into "empty." A 500 or a dropped connection is presented to the operator as an authoritative "you have zero tenants / zero tasks." That is invented state — the UI asserts emptiness it cannot know.
**Impact:** Burns trust after sale, and can burn it before: a demo where the API hiccups shows a confident empty CRM instead of a retry. The operator makes decisions on a fabricated zero.
**Fix:** Add the missing branch: `list.isError ? <QueryErrorState onRetry={list.refetch}/> : …` ahead of the empty check, in the 48 pages. `QueryErrorState` already exists at `client/src/components/query-error-state.tsx`.
**Gate it:** New `acreos/*` ESLint rule `query-must-handle-error`: flag a `useQuery` whose returned identifier is rendered without a reachable `.isError`/`QueryErrorState`. Wire through the existing eslint-ratchet (`scripts/lint-eslint-ratchet.mjs`, baseline in `scripts/eslint-rules-baseline.json`); seed baseline at the current count (~48) and drive down. Heuristic, so `warn`-then-ratchet like `use-mutation-must-invalidate`.
**Effort:** M (rule) + L (retrofit 48 pages)
**Blast radius:** 48 page files; 1 new lint rule.
**Confidence:** high — the tenants.tsx branch was read in full; the 48-file count is reproducible.

---

### F-14-2 — WCAG `jsx-a11y` ruleset is dead config; a11y enforcement is one custom rule
**Severity:** P2 real
**Surfaced by:** slice 14
**Survives which gates:** `.eslintrc.json:24` enables `plugin:jsx-a11y/recommended` plus explicit `aria-props`, `aria-proptypes`, `role-has-required-aria-props`, `alt-text` errors — but ESLint 9 ignores `.eslintrc.json` and uses the flat config. `eslint.config.js` (the active config, its own header says the legacy ruleset "is not yet ported here") registers only `acreos/*` rules — no jsx-a11y plugin at all. So every WCAG rule the team thinks it runs is inert. The eslint-ratchet runs `npx eslint client/src` against this flat config, so it enforces only the 5 `acreos/*` counts.
**Evidence:** `eslint.config.js:8-11` (comment: "existing legacy ruleset (eslint-plugin-react, jsx-a11y, ...) is not yet ported here"), `eslint.config.js:81-115` (rules block: only `acreos/*`). Contrast `.eslintrc.json:38-44`.
**What's wrong:** Only `acreos/icon-button-needs-aria-label` (baseline 0 in `scripts/eslint-rules-baseline.json`) guards accessibility. Bad ARIA roles, missing form labels, invalid `aria-*` props, unlabeled images — none are caught. `tests/unit/accessibility.test.ts` only greps for a skip link, `#main-content`, `MotionConfig`, and a zoomable viewport (85 lines, 4 assertions). pa11y (`.pa11yci.json`) covers 10 static URLs and needs a running server (not in `npm run check`).
**Impact:** Neither blocks the first sale directly, but a11y regressions ship silently — hurts keyboard/screen-reader operators and any accessibility-conscious buyer. The CLAUDE.md a11y contract ("every form input has an associated label") is unenforced.
**Fix:** Port `eslint-plugin-jsx-a11y` into `eslint.config.js` flat config; seed each rule's violation count into `eslint-rules-baseline.json` and ratchet down. Delete `.eslintrc.json` or mark it clearly non-executing.
**Gate it:** The eslint-ratchet already exists and would carry the ported rules automatically once registered — measured baseline today: 5 `acreos/*` rules all at 0.
**Effort:** M
**Blast radius:** `eslint.config.js`, `eslint-rules-baseline.json`; violation cleanup across `client/src`.
**Confidence:** high — read both configs and the ratchet script.

---

### F-14-3 — Tauri v2 desktop app builds but is non-functional: no `capabilities/` directory
**Severity:** P2 real
**Surfaced by:** slice 14
**Survives which gates:** No CI job builds Tauri (`tauri:build` is a manual npm script; not in `npm run check` or any lint). Nothing validates the Tauri permission model.
**Evidence:** `ls src-tauri/capabilities/` → "NO capabilities dir". `src-tauri/src/main.rs:14-18` registers `shell`, `notification`, `updater`, `deep-link` plugins. `src-tauri/tauri.conf.json` is v2 schema. In Tauri v2 every plugin command must be granted by a capability file in `src-tauri/capabilities/`; with none present, the webview is granted **no permissions**, so every plugin invocation from the frontend is denied at runtime.
**What's wrong:** `cargo tauri build` (beforeBuildCommand `npm run build` → `dist/public`) will compile and produce a bundle, but the shipped desktop app can't fire notifications, open deep links (`acreos://…`), self-update, or use the shell — the exact features `main.rs` wires up. It looks done; it is a shell.
**Impact:** Neither blocks the first sale (desktop is not the sales path) — but any effort spent shipping "the desktop app" ships a broken one. Wasted-effort / false-done risk.
**Fix:** Add `src-tauri/capabilities/default.json` granting `core:default`, `notification:default`, `deep-link:default`, `updater:default`, `shell:allow-open` to the `main` window; reference it (v2 auto-loads the dir). Then smoke-test a notification + deep link.
**Gate it:** A tiny check in `npm run check` (or a `mobile:*`/`tauri:*` CI lane) asserting `src-tauri/capabilities/` is non-empty whenever `main.rs` registers plugins. None today.
**Effort:** S
**Blast radius:** `src-tauri/`.
**Confidence:** high — verified missing dir + plugin registration; medium only on the exact grant list needed.

---

### F-14-4 — Tauri config: empty updater pubkey + v1-style plugin allowlist for plugins that aren't loaded
**Severity:** P3 minor
**Surfaced by:** slice 14
**Survives which gates:** Same as F-14-3 — no Tauri build/config validation in any gate.
**Evidence:** `src-tauri/tauri.conf.json` — `plugins.updater.pubkey: ""` with a live `endpoints` array; `plugins.fs` and `plugins.dialog` use v1 allowlist shape (`"all": false, "readFile": true, "scope": [...]`), but `fs`/`dialog` are **not** in `src-tauri/Cargo.toml` deps and **not** in `main.rs` — dead config. `Cargo.toml` lists only shell/notification/updater/deep-link.
**What's wrong:** An empty updater pubkey means update signatures can't be verified — the updater plugin errors at init or silently refuses updates; either way the self-update path is inoperative/insecure. The `fs`/`dialog` blocks are leftovers describing a permission model this app doesn't have.
**Impact:** Neither — desktop only, and gated behind F-14-3 anyway. Misleads a future maintainer into thinking fs sandboxing is configured.
**Fix:** Generate an updater keypair (`tauri signer generate`), set `pubkey`; or drop the updater plugin until releases exist. Delete the `fs`/`dialog` config blocks or add the plugins for real.
**Gate it:** none needed beyond F-14-3's config check; low value.
**Effort:** S
**Blast radius:** `src-tauri/tauri.conf.json`.
**Confidence:** high.

---

### F-14-5 — `page-shell.tsx` is globally excluded from ESLint via a parse-error ignore
**Severity:** P3 minor
**Surfaced by:** slice 14
**Survives which gates:** It's in the flat-config `ignores`, so the eslint-ratchet never sees it — including `acreos/icon-button-needs-aria-label` (the one live a11y rule) and the persona-codename rule.
**Evidence:** `eslint.config.js:59-62` ignores `client/src/components/page-shell.tsx` ("Pre-existing JSX parse error — a comment was placed at a position where the JSX grammar doesn't accept it"). File is 164 lines and still present.
**What's wrong:** A shared shell component every page composes is a permanent lint blind spot, justified by a one-line syntax quirk that has outlived its "un-ignore once that lands" note.
**Impact:** Neither — small surface. Precedent risk: the ignore list is where enforcement quietly erodes.
**Fix:** Move the offending comment out of the JSX position, delete the ignore entry.
**Gate it:** none possible cheaply — an ignore-list ratchet would over-fit. Track via the note being removed.
**Effort:** S
**Blast radius:** `eslint.config.js`, `page-shell.tsx`.
**Confidence:** high.

---

## Coverage ledger

**Examined exhaustively:** `capacitor.config.ts`, `src-tauri/tauri.conf.json`, `src-tauri/src/main.rs`, `src-tauri/Cargo.toml`, `src-tauri/build.rs`, `eslint.config.js`, `.eslintrc.json`, `.pa11yci.json`, `scripts/lint-eslint-ratchet.mjs`, `scripts/eslint-rules-baseline.json`, `tests/unit/accessibility.test.ts` (head), `package.json` scripts/deps, `client/src/pages/tenants.tsx` (full render), `client/src/components/ui/dialog.tsx` (head).

**Examined by sampling:** Skeleton/EmptyState/QueryErrorState coverage counts across all 258 pages (grep-level); the 48-page error-state gap (grep heuristic — a handful may handle errors via a shared wrapper I did not open per-file); `<div onClick>` without role (3 hits, low); mobile nav in `layout-sidebar.tsx` (2,259 lines — skimmed, not read in full).

**Did NOT examine:** live rendering at 375px (read-only audit; no browser) — mobile responsiveness asserted only from Tailwind class inspection, not visual; Capacitor native project build viability beyond config (did not open `android/`, `ios/App` Xcode/Gradle project files — assessed buildable from config + present dirs, not proven); focus-order and keyboard-trap behavior at runtime (static `<div onClick>` sample only); the `evals/` a11y coverage; individual ARIA correctness across custom components beyond the Radix-based dialog. I did not run any build, eslint, or pa11y (local node_modules lacks eslint/parser — a sandbox artifact, not a repo defect; CI `npm ci` would install them, so I did not report it).

## Constitution Collisions

None. All findings are enforcement/coverage gaps; F-14-1 (failed fetch shown as empty data) is *aligned with* the "fabrication is never acceptable" hard-stop — it is a place that rule is being violated in spirit and should be closed, not a collision with it. No finding proposes a new nav door, AI destination, marketplace/API surface, or money-custody change.
