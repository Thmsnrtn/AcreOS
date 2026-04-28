# /pipeline — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/pipeline
**Captured:** 2026-04-28T01:42:17.937Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/pipeline-1440.png` 
- Mobile (375):  `prototype-screenshots/pipeline-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/pipeline-1440.png`
- Mobile (375):  `auth-screenshots/pipeline-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 52KB | (no redirect) | 7 |
| 375 | 40KB | (no redirect) | 7 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: m.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9697)
    at Uo (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:17071)
    at Ao (h
console.error: [ErrorBoundary] Error captured: {errorId: err_1777339983618_zmoizuw5q, timestamp: 2026-04-28T01:33:03.618Z, error: Object, componentStack: 
    at Ze (https://acreos.io/assets/pipeline-
console.error: Failed to load resource: the server responded with a status of 415 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
networkidle timeout (non-fatal)
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: TypeError: p.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9757)
    at Uo (https://acreos.io/assets/vendor-clerk-DiCNwVIv.js:6:17071)
    at Ao (h
console.error: [ErrorBoundary] Error captured: {errorId: err_1777340241849_4xcq0k3b9, timestamp: 2026-04-28T01:37:21.849Z, error: Object, componentStack: 
    at Ze (https://acreos.io/assets/pipeline-
console.error: Failed to load resource: the server responded with a status of 415 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
networkidle timeout (non-fatal)
```

## Provisional verdict

**Classification:** CONFIDENT-FAIL

**Reasons:**
- desktop: 1 render-blocking JS error(s) — first: console.error: TypeError: m.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9697)
  
- mobile: 1 render-blocking JS error(s) — first: console.error: TypeError: p.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9757)
  

**Fix candidates (1.1.C):**
- fix JS error: console.error: TypeError: m.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9697)
    at Uo (https://acr
- fix JS error: console.error: TypeError: p.filter is not a function
    at Ze (https://acreos.io/assets/pipeline-ScU16Kxc.js:2:9757)
    at Uo (https://acr

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.
