# AcreOS v4 Convergence Sweep 06 Report

**Date:** 2026-04-18
**Counter:** 2/3 clean (if this sweep passes)
**Focus areas:** Frontend, Infrastructure, Accessibility

---

## 1. Route Dedup (`client/src/App.tsx`)

**Status: PASS**

- Total `<Route path=` instances: **140**
- Duplicate route paths found: **0**
- All 140 route paths are unique. Intentional aliases (e.g., `/pax` redirecting to `/ai`, `/evening-review` and `/night-cap` both rendering `EveningReviewPage`) use distinct paths and are not duplicates.

---

## 2. Query Error Handling (`client/src/lib/queryClient.ts`)

**Status: PASS**

- `QueryCache` is instantiated with `onError: handleQueryError` (line 177-179).
- `MutationCache` is instantiated with `onError: handleMutationError` (line 180-182).
- `handleQueryError` (line 59) correctly suppresses auth errors, toasts all others with a "Copy details" action, and logs to console.
- `handleMutationError` (line 89) handles auth errors with a session-expired toast, toasts all others with "Copy details" action.
- Retry logic correctly skips 401/403 errors.
- Cache times and stale times are well-defined constants.

---

## 3. Font Loading (`client/index.html`)

**Status: PASS**

- Only preconnect hints present (lines 27-28):
  - `<link rel="preconnect" href="https://fonts.googleapis.com">`
  - `<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>`
- No render-blocking `fonts.googleapis.com/css` stylesheet link found.
- Comment on line 29 confirms: "Core app uses system font stack; theme/white-label fonts are loaded dynamically."

---

## 4. Accessibility

**Status: PASS**

### Skip Link
- Skip-to-content link present at line 820 of `App.tsx`:
  `<a href="#main-content" className="skip-to-content" aria-label="Skip to main content">`
- Target `id="main-content"` exists on the `motion.div` wrapper at line 758.
- CSS in `index.css` (lines 439-446) correctly hides the link off-screen and reveals it on `:focus` via `translateY`.

### MotionConfig
- `<MotionConfig reducedMotion="user">` wraps the entire app at line 855, respecting `prefers-reduced-motion` at the OS level.

### Viewport Meta
- `<meta name="viewport" content="width=device-width, initial-scale=1.0" />` present on line 5 of `index.html`.

### Focus Rings
- Global `*:focus-visible` rule at line 449 of `index.css` applies `ring-2 ring-primary/40 ring-offset-2`.

---

## 5. CI/CD

**Status: PASS**

### `.github/workflows/ci.yml`
- **Jobs defined:** `lint-and-typecheck`, `security-scan`, `build`
- **`needs` references:**
  - `security-scan` needs `lint-and-typecheck` (line 59) -- valid
  - `build` needs `[lint-and-typecheck]` (line 94) -- valid
- All `needs` references point to actual job IDs. No dangling references.
- All jobs use `npm ci` for dependency installation.
- Node version consistently set to `22` across all jobs.

### `Dockerfile`
- Build stage uses `npm ci --include=dev --legacy-peer-deps` (line 22) -- correct.
- Production prune uses `npm prune --omit=dev` (line 26) -- correct.
- Multi-stage build with non-root `USER node` (line 48).
- Healthcheck configured (line 43).

---

## 6. Node Version Alignment

**Status: PASS**

- `.nvmrc`: `22`
- `package.json` engines field: `"node": ">=22"` (line 191-193)
- `Dockerfile` ARG: `NODE_VERSION=22.21.1` (line 7)
- CI workflow `node-version`: `22` in all jobs
- All four sources are aligned on Node 22.

---

## 7. Pre-commit Hook (`.githooks/pre-commit`)

**Status: PASS**

- Checks staged files only via `git diff --cached --name-only --diff-filter=ACM -- '*.ts' '*.tsx'` (line 17).
- Runs `npx tsc --noEmit --pretty false` on the full project (required for resolution) but filters output to only staged file paths (lines 33-43).
- Exits with code 1 when TypeScript errors are found in staged files (line 55).
- Skips check gracefully when no `.ts`/`.tsx` files are staged (line 20).
- `package.json` `prepare` script sets `core.hooksPath .githooks` (line 36).

---

## 8. Competitor References

**Status: PASS**

Searched for "Podolsky", "Land Geek", "GeekPay", and "LG Pass" (case-insensitive) across:
- `client/src/` -- **0 matches**
- `server/` -- **0 matches**

No competitor references found in the codebase.

---

## Summary

| # | Check | Result |
|---|-------|--------|
| 1 | Route dedup | PASS -- 140 routes, 0 duplicates |
| 2 | Query error handling | PASS -- QueryCache + MutationCache both wired |
| 3 | Font loading | PASS -- preconnect only, no render-blocking |
| 4 | Accessibility | PASS -- skip link, MotionConfig, viewport meta, focus rings |
| 5 | CI/CD | PASS -- needs refs valid, npm ci everywhere |
| 6 | Node version | PASS -- 22 aligned across nvmrc/package/Dockerfile/CI |
| 7 | Pre-commit hook | PASS -- staged-only, fails on TS errors |
| 8 | Competitor refs | PASS -- zero matches |

**New P0 findings: 0**
**New P1 findings: 0**

**Sweep 06 verdict: CLEAN**
**Counter: 2/3 clean**
