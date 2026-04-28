# /founder — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/founder
**Captured:** 2026-04-28T11:27:57.650Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/founder-1440.png` 
- Mobile (375):  `prototype-screenshots/founder-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/founder-1440.png`
- Mobile (375):  `auth-screenshots/founder-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 462KB | (no redirect) | 5 |
| 375 | 29KB | (no redirect) | 5 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
networkidle timeout (non-fatal)
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: [Query Error] Error: 429: 
    at Jw (https://acreos.io/assets/index-D183Bp82.js:16:28568)
console.error: Failed to load resource: the server responded with a status of 429 ()
```

## Provisional verdict

**Classification:** CONFIDENT-FAIL

**Reasons:**
- mobile: screenshot only 29KB — likely blank/loading/error
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.
