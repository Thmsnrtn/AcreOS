# AcreOS — Performance Diagnostic

**Date:** 2026-05-04
**Symptom reported by founder:** "Even signing in or loading the URL takes forever — I'm not even sure it's functioning."
**Goal:** Identify root causes before attempting fixes.
**Authorization scope:** Mechanical, verifiable, risk-bounded fixes only. Architectural/UX decisions documented as "needs founder authorization."

---

## TL;DR — The smoking gun

**HTTP/2 + the `compression@1.8.1` middleware do not negotiate properly.** Every static asset on `acreos.io` is served **uncompressed** under HTTP/2 (which is what every modern browser uses). Cold-load delivers **~2.28 MB of raw JavaScript + CSS** that should be ~600 KB Brotli-compressed.

**Verified by switching protocol:**
- HTTP/2 (default): `content-encoding` header missing on `/assets/*.js`
- HTTP/1.1 (`curl --http1.1`): `content-encoding: gzip` ✅

This is the single biggest contributor to "loading forever." Fix is mechanical and ships today.

A secondary contributor: **`/sw.js` is served with `cache-control: public, max-age=31536000, immutable`** — service workers cached for a year. Users with stale SW state can serve stale chunks indefinitely.

A tertiary contributor: **`vendor-pdf` (387 KB) and `vendor-charts` (434 KB) are `<link rel="modulepreload">`-ed on every page load**, including the marketing landing — eating ~820 KB of bandwidth on the critical path for code that doesn't render anything visible.

---

## §1 · Cold-load timing

Measurements taken from local network (good connection) against `https://acreos.io/` and `/auth` and `/pricing`. Server-side timing is healthy.

| Metric | `/` | `/auth` | `/pricing` |
|---|---|---|---|
| DNS lookup | 74 ms | – | – |
| TCP connect | 96 ms | – | – |
| TLS handshake | 140 ms | – | – |
| Time-to-first-byte | **245 ms** | **182 ms** | **244 ms** |
| Total (HTML only) | 246 ms | 184 ms | 246 ms |
| HTML body size | 5,164 bytes | 5,164 bytes | 5,164 bytes |

**Observation:** Server returns the SPA shell in <250 ms. Server-side is **not** the bottleneck. The slowness happens after the HTML lands and the browser starts pulling JS.

---

## §2 · Bundle delivered on cold load

The HTML shell `<head>` preloads 7 vendor chunks + main:

| Chunk | Raw bytes | Encoded? |
|---|---|---|
| `index-FbTPfYiN.js` | **609,664** | ❌ none |
| `vendor-clerk-DiCNwVIv.js` | 219,017 | ❌ none |
| `vendor-pdf-D9qGPKOB.js` | **386,659** ⚠ | ❌ none |
| `vendor-react-CH3_SQvh.js` | 42,015 | ❌ none |
| `vendor-ui-C38LZCh8.js` | 159,348 | ❌ none |
| `vendor-charts-BSIVO73l.js` | **434,080** ⚠ | ❌ none |
| `vendor-date-Bf4Pw_5z.js` | 25,620 | ❌ none |
| `vendor-motion-B-IyVtMF.js` | 127,329 | ❌ none |
| `index-Dr8zSXBG.css` | 281,086 | ❌ none |
| **Total raw** | **~2,284,818 bytes (2.28 MB)** | |
| **Estimated Brotli** | **~570,000 bytes (~570 KB, 75% reduction)** | |
| **Estimated gzip** | **~700,000 bytes (~700 KB, 70% reduction)** | |

On a 50 Mbps connection (typical home cable), 2.28 MB takes ~3.6 seconds. On a 20 Mbps mobile connection, ~9 seconds. On a 5 Mbps congested connection, ~36 seconds. **And that's just before parsing/compiling JS.** For a frontend doing 600 KB of JS, parse+compile adds 1-3 seconds on a typical laptop, more on mobile.

This is exactly the "loading takes forever" symptom.

---

## §3 · Compression middleware investigation

`server/index.ts:236` mounts `compression@1.8.1`:

```ts
app.use(compression({
  threshold: 1024,
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    const ct = String(res.getHeader("Content-Type") ?? "");
    if (ct && SKIP_COMPRESS_TYPE.test(ct)) return false;
    return compression.filter(req, res);
  },
}));
```

The middleware is correctly mounted **before** `serveStatic(app)` (line 968). It SHOULD be wrapping the static-asset response. And in fact:

- Response headers include `Vary: Accept-Encoding` → middleware ran
- Response is missing `Content-Encoding` → middleware decided not to compress

### Why HTTP/2 trips it

Tested with `curl --http1.1`:
```
> GET /assets/index-FbTPfYiN.js
> Accept-Encoding: gzip
< vary: Accept-Encoding
< content-encoding: gzip   ✅
< content-length: <smaller>
```

Tested with HTTP/2 (default):
```
> GET /assets/index-FbTPfYiN.js
> accept-encoding: br, gzip
< vary: Accept-Encoding
< (no content-encoding)    ❌
< content-length: 609664
```

The `compression` package has a known issue with HTTP/2: under H2, Node's `http2` module emits headers via a different path than `http`. `compression` watches `res.write` to detect content type and Content-Length, but pseudo-headers (`:status`, `:scheme`) and the H2 send-headers timing interact poorly with its filter logic. The middleware sees an empty Content-Type at filter-decision time and skips compression.

**This is a known cluster of bugs across `expressjs/compression` and `nodejs/node` HTTP/2 issue trackers.** It is not unique to AcreOS.

### The fix (mechanical, ships today)

Two complementary changes:

1. **Pre-compress static assets at build time** with `vite-plugin-compression`. Generates `.gz` and `.br` files alongside every chunk during `npm run build`.
2. **Add a tiny static-serve middleware** that picks the pre-compressed file when the client supports it. This bypasses Node's HTTP/2 + compression middleware entirely — assets are served as opaque bytes with the correct `Content-Encoding` header.

Result: HTTP/2 works, compression works, ~75% bandwidth reduction on cold load.

This is in scope for autonomous fix per the directive criteria (mechanical, verifiable, risk-bounded).

---

## §4 · Service worker pathology

`/sw.js` returns:
```
content-type: text/javascript; charset=utf-8
content-length: 8775
cache-control: public, max-age=31536000, immutable
```

**A service worker cached for one year as `immutable` is a bug.** The browser registers the SW at first paint, then on every subsequent visit it checks `/sw.js` for updates. If the SW response is cached as `immutable max-age=31536000`, the browser will use the cached SW for **up to a year** without checking for updates.

Consequences:
- Users with stale SW that has cached now-deleted chunk hashes will see broken loading
- Bug fixes shipped in `sw.js` (cache invalidation logic, route handling) won't propagate
- Manual remediation: user must unregister the SW via DevTools

**The fix:** `cache-control: no-cache, no-store, must-revalidate` on `/sw.js` specifically. The SW file itself should always be re-fetched; the assets it caches keep their long-cache headers.

This is an `express.static` `setHeaders` override — single file change, ~5 lines, reversible.

This is in scope for autonomous fix.

---

## §5 · Critical-path bundle composition

The HTML shell preloads 7 vendor chunks. Two of them have no business being on the critical path:

### `vendor-pdf` (387 KB raw)
PDF generation library (likely jsPDF or pdf-lib). Used for:
- Document signing surfaces
- 1099-INT batch export
- General-ledger PDF export
- Wire instructions encrypted PDFs

**None of these run on the marketing landing or sign-in screens.** This chunk should be dynamically imported when first needed, not modulepreloaded.

### `vendor-charts` (434 KB raw)
Recharts. Used for:
- Founder home pulse charts
- Unit economics trend charts
- AI cost dashboard
- Vendor status trends

**None of these run before authentication.** This chunk should be dynamically imported per-route.

### Combined waste
**~820 KB of raw bytes (~205 KB Brotli) preloaded on every page load that may never be consumed.** Removing both from the preload list is a Vite config change.

**Risk note:** these chunks are presumably preloaded because some shared component (e.g., a chart used inside a topbar) imports them statically. If true, the *real* fix is converting those imports to lazy. The preload-list change alone is reversible; the static-import-to-lazy refactor is more substantial.

**My read:** the preload-list change is mechanical (Vite config, reversible). The static-to-lazy refactor needs founder authorization because it touches 5+ component boundaries.

---

## §6 · Server-side health check

Pulled `fly logs --no-tail` for the last 7 minutes:
- `/api/health/cached` returning in **0-1 ms** every 30 seconds (the Fly health check)
- Clerk session-touch + token requests every 30 seconds — likely the founder's open browser tab keeping a live session
- **No error-level log lines, no slow-query warnings, no rate-limit hits**

Two machines running, both `started`, both `passing`. Spec is `performance-2x` (2 CPU / 4 GB / `iad`). At zero customer load, machines are >95% idle.

**Server is not the bottleneck.** Worker process saturation is not visible in logs (worker is a separate Fly process group from Wave 10). Background-job density (27 self-rescheduling jobs) is a future scale concern, not a current cold-load concern.

---

## §7 · Frontend single-thread tasks

**Cannot directly measure without DevTools / Lighthouse against a logged-in session.** Recommendation: re-run with authenticated `storageState.json` after the bandwidth fixes ship. The bandwidth fix alone may resolve the symptom; if not, the next investigation step is "long task" tracing.

Static read of `client/src/main.tsx` shows:
- `Sentry.init` runs before React renders (post-cookie-consent)
- `serviceWorker.register('/sw.js')` runs at page load
- `Clerk` provider mounts in App.tsx — auth-state resolution can take 200-500 ms on first auth
- Theme context hydration runs synchronously from localStorage

These are all reasonable. **No obvious sync-block detected statically.**

---

## §8 · Findings summary — recommended fixes

### ✅ AUTHORIZED autonomous fixes (mechanical, verifiable, risk-bounded)

| ID | Fix | Effort | Expected impact |
|---|---|---|---|
| **F1** | Add `vite-plugin-compression` → emit `.gz` + `.br` at build time. Add static middleware that serves pre-compressed when Accept-Encoding allows. | 30-60 min | **70-75% bandwidth reduction on cold load.** Primary fix. |
| **F2** | Force `Cache-Control: no-cache, no-store, must-revalidate` on `/sw.js` specifically. | 5 min | Stale SW recovery. Defense against future-SW-bug-stuck users. |
| **F3** | Remove `vendor-pdf` and `vendor-charts` from `<link rel="modulepreload">` list (Vite manualChunks config). They'll still be loaded when needed via dynamic import. | 15 min | ~820 KB raw / ~205 KB Brotli saved on cold load — but only if no static import path forces inclusion. Verifiable via `npm run build` chunk listing. |

**Total time to ship F1-F3:** ~1-1.5 hours. **Each ships as a separate commit with before/after measurement.**

### ⚠ NEEDS FOUNDER AUTHORIZATION

| ID | Item | Reason |
|---|---|---|
| **N1** | Convert `vendor-pdf` and `vendor-charts` static imports to dynamic imports across 5+ component boundaries. Probable fix for any leftover preload-leak after F3. | Architectural — touches multiple components. UX impact possible (small loading spinner where chart was instant). |
| **N2** | Split the 27-job worker process into per-domain pools (recognition / 1099 / vision-AI / cost-optimizer / ETL / etc). | Architectural; not a current bottleneck but compounds with vertical expansion. |
| **N3** | Lazy-load Sentry initialization until after first interactive paint. | Subtle UX trade-off — delays error capture for the first ~2 seconds. |
| **N4** | Add `<link rel="dns-prefetch">` for clerk.acreos.io / api.mapbox.com / api.stripe.com / fonts host. | Simple but customer-facing; needs verify across CSP. |

### 📊 Verification plan

For each authorized fix:
1. Capture before-state: `curl -I` on key assets, raw byte count
2. Apply fix
3. Build (`npm run build`) — verify dist output
4. Deploy to staging if available, otherwise commit + verify locally with `npm run preview`
5. Re-run `curl` against deployed endpoint, confirm `content-encoding: br` (or `gzip`)
6. Document before/after in commit message
7. Stop and verify between fixes (don't bundle)

Target: **<3 second time-to-interactive on `/today` after cold load with authenticated session.**

---

## §9 · What this diagnostic cannot verify

| Item | Why | How to gain coverage |
|---|---|---|
| Authenticated route render time | No `storageState.json` available | Founder runs `Playwright codegen` once, saves state |
| Worker VM saturation under real load | Only zero-customer logs visible | Will need re-check after first 10 paying customers |
| Sign-in flow timing (post-credential-submit) | Requires real Clerk credentials | Same as authenticated routes |
| Slow-query baseline | No `pg_stat_statements` snapshot pulled | Run after first migration apply against staging |
| Per-route critical-path JS | Requires Lighthouse against authenticated session | Same as #1 |

These are runtime measurements that require live access. None of them are needed to ship F1-F3.

---

## §10 · Sequencing recommendation

1. **Now:** ship F2 (sw.js cache fix — 5 min, no build required)
2. **Now:** ship F1 (vite-plugin-compression + static-serve override — 60 min)
3. **After F1 deploys, re-measure:** if loading is acceptable, F3 may not be necessary today
4. **If still slow after F1+F2:** ship F3 (preload list trim)
5. **Stop, report timing improvement to founder, gate further work on response**

If F1 alone gets cold load to under 3 seconds, **N1-N4 stay deferred** and we move to Workstream B mechanical infra fixes.

---

## §11 · Confidence + scope notes

- **Confidence in root cause:** HIGH. Verified with two protocol-version curls. Reproducible.
- **Confidence in F1 fix:** HIGH. `vite-plugin-compression` is a 17k-weekly-download Vite plugin; the static-serve override is ~10 lines. Pattern is well-known.
- **Confidence in F2 fix:** HIGH. SW cache-control override is a 1-line `setHeaders` change.
- **Confidence in F3 fix:** MEDIUM. Removing from `manualChunks` may surface a static import that needs to be lazy-imported; that would be N1 (founder-authorization-needed).
- **Risk of regression:** LOW for F1 + F2. F1 just changes byte-encoding; if pre-compressed file isn't found, fallback to original works. F2 just changes a header. Both reversible in <5 min via `git revert`.

— Claude, autonomous run, 2026-05-04
