# /offers — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/offers
**Captured:** 2026-04-28T01:42:17.943Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/offers-1440.png` 
- Mobile (375):  `prototype-screenshots/offers-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/offers-1440.png`
- Mobile (375):  `auth-screenshots/offers-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 52KB | (no redirect) | 5 |
| 375 | 40KB | (no redirect) | 6 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: L.filter is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11554
    at Object.Ea [as useMemo] (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:21454
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340070719_wx7j6wfz5, timestamp: 2026-04-28T01:34:30.719Z, error: Object, componentStack: 
    at Yt (https://acreos.io/assets/offers-Cf
console.error: Failed to load resource: the server responded with a status of 415 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: B.map is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11636
    at Object.Ea [as useMemo] (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:21454)
 
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340305472_1klkdwuf8, timestamp: 2026-04-28T01:38:25.472Z, error: Object, componentStack: 
    at Yt (https://acreos.io/assets/offers-Cf
console.error: Failed to load resource: the server responded with a status of 415 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
```

## Provisional verdict

**Classification:** CONFIDENT-FAIL

**Reasons:**
- desktop: 1 render-blocking JS error(s) — first: console.error: TypeError: L.filter is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11554
    at O
- mobile: 1 render-blocking JS error(s) — first: console.error: TypeError: B.map is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11636
    at Obje
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm

**Fix candidates (1.1.C):**
- fix JS error: console.error: TypeError: L.filter is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11554
    at Object.Ea [as useMemo
- fix JS error: console.error: TypeError: B.map is not a function
    at https://acreos.io/assets/offers-CfkAD7gZ.js:1:11636
    at Object.Ea [as useMemo] (

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.
