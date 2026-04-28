# /team — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/team
**Captured:** 2026-04-28T01:42:17.947Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/team-1440.png` 
- Mobile (375):  `prototype-screenshots/team-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/team-1440.png`
- Mobile (375):  `auth-screenshots/team-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 103KB | (no redirect) | 6 |
| 375 | 32KB | (no redirect) | 5 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-i4wXazLj.js:2:67740)
    at async https://acreos.io/assets/index-i4wXazLj.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
networkidle timeout (non-fatal)
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: Failed to load resource: the server responded with a status of 429 ()
console.error: [Query Error] Error: 429: 
    at Jw (https://acreos.io/assets/index-i4wXazLj.js:16:28456)
loading-state-stuck (non-fatal)
```

## Provisional verdict

**Classification:** NEEDS-HUMAN-REVIEW

**Reasons:**
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm
- No render-blocking errors or auth redirects detected. Pixel-level comparison vs prototype required to classify pass/fail.

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.

No automatic fail signal detected. Open both shots side-by-side to verify visual fidelity vs prototype.
