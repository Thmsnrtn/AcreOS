# Reza Behrouzi — Frontend Bones Audit
**Date:** 2026-05-01
**Scope:** Engineering hygiene below the perf-audit waterline (deps, build, TS, observability, prod-readiness, DX)
**Out of scope:** Bundle splits, queryClient timing, lazy boundaries — covered in `ux-audit-2026-05-01/perf-audit.md`

I read the package.json, the vite config, the workflows, the CSS, the tsconfigs, and the dist/ output. This is the picture. I'm going to be direct because Thomas asked for this and the scaffolding is mostly good — the gaps are specific and surgical, not architectural.

---

## 1. Dependency audit

The `dependencies` block has **117 prod entries**. That's not catastrophic for a Vite app but it's loose. A few things stand out:

### 1a. Things that almost certainly shouldn't be in `dependencies`

These are dev-only or wrong-section. They ship to no client, but they pollute install times and `npm audit` surface area:

| Package | Issue | Fix |
|---|---|---|
| `@types/cookie-parser`, `@types/multer`, `@types/pdfkit`, `@types/puppeteer-core`, `@types/mapbox-gl` | All `@types/*` are dev-only by definition | Move to `devDependencies` |
| `@capacitor/cli` | CLI tooling, not runtime | Move to `devDependencies` |
| `@tailwindcss/postcss` | Build-time only | Move to `devDependencies` |
| `drizzle-zod`, `drizzle-kit` (kit is dev, good) | drizzle-zod is fine; flagging because shared dep boundaries are blurred | Audit |

Net: ~7 dependency entries in the wrong section. Cosmetic but the dependency graph in `npm ls` is harder to read than it needs to be.

### 1b. Likely unused / underused

| Package | Evidence | Action |
|---|---|---|
| `mammoth` (DOCX parsing, ~700KB) | Zero imports in `client/src` — likely server-only | Confirm server use; if absent, remove |
| `react-icons` (~5MB install) | Used in exactly **one** file: `client/src/components/integrations-settings.tsx` for `SiSendgrid`/`SiTwilio` | Replace those 2 icons with inline SVG or lucide equivalents; drop the dep |
| `html2canvas` (200KB chunk in dist) | Pulled transitively by `jspdf`. Only one direct `jspdf` usage (`pages/borrower-portal.tsx`). | Lazy-import jsPDF inside the borrower portal handler so neither it nor html2canvas land in vendor chunks elsewhere |
| `@jridgewell/trace-mapping` | Listed at top-level but normally a transitive of source-map tooling | Check if any direct import; otherwise remove |
| `react-is@19.2.5` (pinned exact) | Strange to pin at 19 when react is 18 | Investigate why; React 19 mismatch can break peer deps |
| `vite-plugin-pwa` + `workbox-window` | No `VitePWA(...)` plugin in `vite.config.ts`, no `registerSW` call in `client/src/**` | The PWA stack is installed but not wired. Either wire it or remove both — `dist/public/sw.js` exists statically, suggesting hand-rolled SW |

### 1c. Duplicate-domain candidates

| Domain | Lib | Verdict |
|---|---|---|
| Date | only `date-fns` ✓ | Clean |
| Forms | only `react-hook-form` ✓ | Clean |
| Icons | `lucide-react` (439 files) + `react-icons` (1 file) | Drop `react-icons` |
| Charts | only `recharts` ✓ | Clean |
| Routing | only `wouter` (100 files) ✓ | Clean — no react-router leakage |
| State | `zustand` + `@tanstack/react-query` | Different concerns; both warranted |

### 1d. Top-level versioning oddities

- `typescript@6.0.2` — TS 6 is bleeding edge; combined with `"ignoreDeprecations": "6.0"` in tsconfig it's clearly intentional, but worth a comment in tsconfig explaining why
- `react-is@19.2.5` while `react@18.3.1` — peer-dep conflict risk
- `vite@7`, `vitest@4`, `eslint@9`, `@vitest/coverage-v8@4` — all current ✓

---

## 2. Build + CI timing

### 2a. Build output (measured)

- Total `dist/` weight: **85 MB** (includes server bundle + assets)
- Total client JS shipped: **~8.5 MB** across **290 JS chunks** in `dist/public/assets`
- 8 chunks above 200 KB; the worst:
  - `vendor-map` 1.6 MB (mapbox-gl, only used in `property-map.tsx`)
  - `index` 592 KB (entry — too fat; breakpoint hunt warranted)
  - `schema` 480 KB (Drizzle/Zod schemas being imported into client?)
  - `vendor-charts` 424 KB
  - `founder-dashboard` 412 KB
  - `vendor-pdf` 380 KB

The `schema-DV1vCZAN.js` at 480 KB is the smell I'd chase first. Drizzle schemas are server-canonical; if they're hitting the client bundle, something in `@shared` is dragging server types or reflective metadata into the browser. See `shared/schema*.ts` imports from `client/src`.

### 2b. CI shape

Three workflows touch the main path: `ci.yml`, `test.yml`, `staging.yml`. Issues:

1. **`ci.yml` runs `npm run lint` with `continue-on-error: true`** — lint is decorative. Either fix the failures or stop running it. Right now the 0-warning policy in `package.json` (`--max-warnings 0`) is contradicted by the workflow letting it pass.
2. **`ci.yml` runs E2E Playwright after build** with no service container, no DB, no health-check wait. Either the suite is mostly green-by-skip or this leg is flaky.
3. **`test.yml` and `staging.yml` both spin up postgres-16 services and run `npx tsc --noEmit`** — same step in three workflows. Extract into a reusable composite action; you're paying ~3× setup time per push.
4. **No build-time budget assertion in CI.** `scripts/check-bundle-size.js` exists in `package.json` (`test:bundle-size`) but is not called from any workflow. Wire it. The `chunkSizeWarningLimit: 500` in vite.config is build-time only and easy to ignore.
5. **No caching of Playwright browsers.** Every CI run downloads them fresh. ~30s recovered per run by caching `~/.cache/ms-playwright`.

### 2c. Local dev feel (estimated, not measured)

- 613 `.ts/.tsx` files in `client/src` — Vite cold start is probably 3–5 s, HMR < 200ms. That's fine.
- `tsc --noEmit` on full project with 1,410 `as any` and 18 `@ts-ignore` — anywhere from 15–40 s, given the source size. The `tsBuildInfoFile` is set so incremental works.

---

## 3. TypeScript health

### 3a. Strict mode? Yes.

`tsconfig.json` has `"strict": true`. Good.

### 3b. The `as any` problem

**1,410 occurrences of `as any` across `client/src` + `server`.** That's not a typo. The pre-commit hook (`/Users/user/AcreOS/AcreOS/.githooks/pre-commit`) explicitly acknowledges this:

> The full codebase has legacy type errors (~3000) that cannot all be fixed at once.

So the strategy is: tsc runs full-project but only NEW errors in staged files block. That's a pragmatic ratchet. The risks:

- ESLint rule is `@typescript-eslint/no-explicit-any: warn` — should be `error` going forward, with an eslint-disable comment per legacy site, so the count is forced downward. Current rule lets new `any` slip in unnoticed.
- `tsconfig.check.json` excludes `client/src/components/onboarding/**`, `activity-*`, `ab-tests*`, and `__tests__/**` — meaning these never type-check. Two of those directories are critical user-facing surface (onboarding, activity feed). Type-check exclusions on customer-facing code are debt that compounds.

### 3c. `@ts-ignore` count

**18.** Manageable. Sweep them in a single PR, replace with `@ts-expect-error` so they self-revert when the underlying issue is fixed.

### 3d. The staged-only pre-commit ratchet

The hook works but it shells out to `npx tsc --noEmit` on the **full project** for every commit. On a 613-file frontend that's 15–40 s. Suggest:

```sh
npx tsc -p tsconfig.check.json --noEmit --pretty false 2>&1
```

— same project but skipping the excluded dirs cuts ~30%. Also look at `tsc --build` mode for incremental, since `tsBuildInfoFile` is configured but not used by the hook.

---

## 4. Frontend observability gap

### 4a. What's wired

- **Sentry**: `@sentry/react` is in deps; `client/src/lib/sentry.ts` exists; init is in `main.tsx` and consent-gated through `cookie-consent-banner.tsx`. Source maps are emitted in production (`sourcemap: "hidden"`). ✓
- **CSP report endpoint**: `server/index.ts` has `/api/csp-report` accepting browser reports. ✓
- **Per-request CSP nonce**: `server/middleware/security.ts`. ✓

This is genuinely good — Reza-grade good.

### 4b. What's missing for 100 customers

| Capability | Status | Gap |
|---|---|---|
| Sentry frontend errors | Wired (consent-gated) | No `tracesSampleRate`/`replaysSessionSampleRate` audit visible without reading sentry.ts; confirm production sampling isn't 100% (cost) or 0% (useless) |
| Sentry release tagging | Unknown | If `SENTRY_RELEASE` isn't set in CI, errors aren't tied to git SHAs — debugging painful |
| Source-map upload to Sentry | Unknown | Hidden source maps without Sentry CLI upload = symbolicated stacks won't work |
| Web Vitals (LCP/CLS/INP) | Not visible | No `web-vitals` package in deps; Sentry can collect these but needs `browserTracingIntegration` |
| RUM / page-level perf | Not visible | Add a tiny `web-vitals` reporter (~3KB) sending to Sentry or a `/api/metrics` endpoint |
| Frontend feature flags / experiments | Not visible | No PostHog/LaunchDarkly/Unleash. At 100 customers you need this for safe rollouts |
| Session replay | Wired via Sentry consent gate | Confirm sample rate is sane (1–5% on hits, 100% on errors) |
| Frontend logging discipline | **Broken** — see §5 | 71 `console.*` calls in 34 client files |

### 4c. Console discipline

**71 `console.*` calls in 34 client files.** Heaviest offenders:
- `client/src/hooks/usePushNotifications.ts` — 7
- `client/src/components/property-map.tsx` — 5
- `client/src/hooks/useOfflineSync.ts` — 4
- `client/src/hooks/use-native-geolocation.ts` — 4
- `client/src/components/onboarding/OnboardingWizard.tsx` — 4
- `client/src/components/help/HelpPanel.tsx` — 4

Eslint has `"no-console": "warn"` but `--max-warnings 0` is bypassed because CI lint is `continue-on-error`. The rule is unenforced.

Action: introduce `client/src/lib/clientLogger.ts` (parallel to `server/utils/logger.ts`), forbid `console.*` via `"no-console": "error"`, allow only `clientLogger.{debug,info,warn,error}` which routes to Sentry breadcrumbs in prod and `console` in dev.

---

## 5. Production-readiness checklist

| Item | Status | Note |
|---|---|---|
| HTTPS / HSTS | ✓ assumed via Fly | Not visible in repo, but standard |
| Content-Security-Policy | ✓ | Per-request nonce, server/middleware/security.ts |
| CSP report endpoint | ✓ | /api/csp-report |
| COOP / COEP / CORP | unknown | Check security.ts for these headers; needed for SharedArrayBuffer / cross-origin isolation |
| X-Frame-Options / X-Content-Type-Options | likely ✓ | Confirm in security.ts |
| robots.txt | ✓ | dist/public/robots.txt exists |
| sitemap.xml | ✓ | dist/public/sitemap.xml exists |
| favicon set | ✓ | favicon.png, .svg, apple-touch, pwa-* all present |
| OG tags (root) | ✓ | client/index.html has og:type, site_name, url, title, description, image, twitter:card |
| **Per-page OG tags** | ✗ | Single set in index.html; no react-helmet/Head wrapper visible. Lead share previews all look identical |
| manifest.json (PWA) | ✓ | Present, with maskable icon |
| Service worker | ✓ static | dist/public/sw.js exists, but `vite-plugin-pwa` is installed and unwired — pick a strategy |
| Source maps in prod | ✓ hidden | Confirm Sentry CLI upload step |
| 404 page | unknown | Check `pages/not-found.tsx` |
| Error boundary at app root | likely ✓ | Confirm in `App.tsx` |
| Sentry DSN | ✓ env-gated | VITE_SENTRY_DSN |
| Cookie consent banner | ✓ | components/cookie-consent-banner.tsx |
| Privacy policy / Terms | unknown | Not audited |

---

## 6. Top 10 engineering quality wins (effort × payoff)

Ranked by ROI. (E)ffort is rough hours; (P)ayoff is qualitative.

| # | Win | E | P | Why |
|---|---|---|---|---|
| 1 | Drop `react-icons` (1-file usage); replace with 2 inline SVGs | 0.5h | M | Removes ~5MB install + lighter `npm ls`. Trivial. |
| 2 | Wire `npm run test:bundle-size` into `ci.yml` | 1h | H | Bundle drift never caught silently; the script already exists |
| 3 | Replace `console.*` with `clientLogger`, set eslint `no-console: error` | 6h | H | Stops PII leaks to devtools, structured frontend logs, fewer nasty surprises in prod |
| 4 | Investigate the 480 KB `schema` chunk reaching the client | 3h | H | Likely server schemas leaking through `@shared`; could shave 200–400 KB off entry path |
| 5 | Fix CI lint enforcement (remove `continue-on-error: true`); fix the lint failures it surfaces | 4h | M | Right now the eslint config is theatre — payoff is that the rules start meaning something |
| 6 | Move `@types/*` and `@capacitor/cli` to `devDependencies` | 0.5h | L | Cleanliness; faster `npm audit` |
| 7 | Decide PWA strategy: wire `vite-plugin-pwa` properly OR remove it + workbox-window | 3h | M | Right now it's installed-but-dead. Pick one |
| 8 | Replace `// @ts-ignore` (18 sites) with `// @ts-expect-error` | 1h | M | Self-clearing technical debt |
| 9 | Verify Sentry release + source-map upload in deploy workflow | 2h | H | Without this, prod stacktraces are unsymbolicated; debugging is guesswork |
| 10 | Lazy-import `jsPDF` in `borrower-portal.tsx` so html2canvas doesn't ship to other pages | 1h | M | Removes ~580 KB from anyone who never visits the borrower portal |

---

## 7. The one project that would change daily DX most: **The Type Ratchet**

Pick this. Six personas already touched the surface; nobody's going to fix it incrementally without a forcing function.

### The pitch

You have ~3,000 legacy TypeScript errors and 1,410 `as any`. The pre-commit hook is a ratchet that prevents new errors but does nothing to drain the old ones. Engineers learn very quickly to add `as any` because it's locally fine and there's no signal it's bad. The number grows.

**The sprint (1 week, one engineer):**

1. **Day 1 — Visibility.** Add `script/typecheck-stats.ts` that produces a CSV: file, error count, `as any` count, `@ts-ignore` count. Commit a baseline `_typecheck-baseline.csv`. Wire it into CI: a workflow that re-generates the file and fails if any number went up. Now the count can only decrease.

2. **Day 2 — Re-include the excluded.** Remove `client/src/components/activity-*`, `onboarding/**`, `ab-tests*` from `tsconfig.check.json` exclusions. Capture the new baseline. These are customer-facing — they need types.

3. **Day 3 — Lint upgrade.** Change `@typescript-eslint/no-explicit-any` from `warn` to `error`, with `// eslint-disable-next-line` per legacy site. Forces every new `any` to be deliberate and visible in code review.

4. **Day 4 — Logger introduction.** Ship `client/src/lib/clientLogger.ts`. Replace all 71 `console.*` calls (one big PR, mostly mechanical). Flip `no-console` to `error`.

5. **Day 5 — Hook tuning.** Switch pre-commit to use `tsconfig.check.json` (or `tsc --build`), measure the speedup, and enforce. Bonus: pre-push hook running `npm run lint --max-warnings 0` so lint actually blocks.

### What changes after

- New `any`s require an eslint-disable — visible in PR review
- Type-error count is in CI on every push — it can only fall
- Frontend log volume in production becomes searchable in Sentry breadcrumbs
- Onboarding + activity components stop being type-blind
- Pre-commit goes from 30 s to ~10 s — engineers stop using `--no-verify`

That's the bones. Strict-mode is on, Sentry is wired, CSP nonces work, source maps emit. The deep gaps are: (a) the type-safety ratchet doesn't drain, (b) console is unpoliced, (c) one-file deps are fat, (d) CI lint is theatre. None of these are hard. They just need a pass.

— Reza
