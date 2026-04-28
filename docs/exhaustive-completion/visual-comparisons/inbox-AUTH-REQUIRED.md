# /inbox — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/inbox
**Captured:** 2026-04-28T01:42:17.939Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/inbox-1440.png` 
- Mobile (375):  `prototype-screenshots/inbox-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/inbox-1440.png`
- Mobile (375):  `auth-screenshots/inbox-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 52KB | (no redirect) | 11 |
| 375 | 40KB | (no redirect) | 10 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at Object.Ea [as useMemo] (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:21454
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340002477_yg569ta8k, timestamp: 2026-04-28T01:33:22.477Z, error: Object, componentStack: 
    at ta (https://acreos.io/assets/inbox-CTg
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: [Query Error — suppressed toast] Error: 404: Not found
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 415 ()
... and 3 more
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: [Query Error — suppressed toast] Error: 404: Not found
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at Object.Ea [as useMemo] (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:21454
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340263816_ymvauxnj2, timestamp: 2026-04-28T01:37:43.816Z, error: Object, componentStack: 
    at ta (https://acreos.io/assets/inbox-CTg
console.error: Failed to load resource: the server responded with a status of 415 ()
... and 2 more
```

## Provisional verdict

**Classification:** CONFIDENT-FAIL

**Reasons:**
- desktop: 1 render-blocking JS error(s) — first: console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at O
- mobile: 1 render-blocking JS error(s) — first: console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at O
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm

**Fix candidates (1.1.C):**
- fix JS error: console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at Object.Ea [as useMemo
- fix JS error: console.error: TypeError: j.forEach is not a function
    at https://acreos.io/assets/inbox-CTgSdXKG.js:1:20729
    at Object.Ea [as useMemo

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.
