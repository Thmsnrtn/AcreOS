# /founder — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/founder
**Captured:** 2026-04-28T01:42:17.949Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/founder-1440.png` 
- Mobile (375):  `prototype-screenshots/founder-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/founder-1440.png`
- Mobile (375):  `auth-screenshots/founder-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 206KB | (no redirect) | 9 |
| 375 | 27KB | (no redirect) | 5 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: Cannot read properties of undefined (reading 'score')
    at we (https://acreos.io/assets/founder-home-Djc7LFMe.js:1:7301)
    at Uo (https://acreos.io/assets/vendor-clerk-Di
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340182497_tpqge5h1m, timestamp: 2026-04-28T01:36:22.497Z, error: Object, componentStack: 
    at we (https://acreos.io/assets/founder-h
console.error: TypeError: Cannot read properties of undefined (reading 'score')
    at ke (https://acreos.io/assets/founder-home-Djc7LFMe.js:1:7973)
    at Uo (https://acreos.io/assets/vendor-clerk-Di
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340182499_ql6x2719j, timestamp: 2026-04-28T01:36:22.499Z, error: Object, componentStack: 
    at ke (https://acreos.io/assets/founder-h
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
... and 1 more
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: [Query Error] Error: 429: 
    at Jw (https://acreos.io/assets/index-i4wXazLj.js:16:28456)
console.error: Failed to load resource: the server responded with a status of 429 ()
```

## Provisional verdict

**Classification:** CONFIDENT-FAIL

**Reasons:**
- desktop: 2 render-blocking JS error(s) — first: console.error: TypeError: Cannot read properties of undefined (reading 'score')
    at we (https://acreos.io/assets/foun
- mobile: screenshot only 27KB — likely blank/loading/error
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm

**Fix candidates (1.1.C):**
- fix JS error: console.error: TypeError: Cannot read properties of undefined (reading 'score')
    at we (https://acreos.io/assets/founder-home-Djc7LFMe.js
- fix JS error: console.error: TypeError: Cannot read properties of undefined (reading 'score')
    at ke (https://acreos.io/assets/founder-home-Djc7LFMe.js

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.
