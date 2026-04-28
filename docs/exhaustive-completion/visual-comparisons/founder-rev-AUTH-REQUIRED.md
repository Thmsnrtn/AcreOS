# /founder/revenue — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/founder/revenue
**Captured:** 2026-04-28T01:42:17.950Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/founder-rev-1440.png` 
- Mobile (375):  `prototype-screenshots/founder-rev-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/founder-rev-1440.png`
- Mobile (375):  `auth-screenshots/founder-rev-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 53KB | (no redirect) | 1 |
| 375 | 42KB | (no redirect) | 1 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 429 ()
```

## Provisional verdict

**Classification:** NEEDS-HUMAN-REVIEW

**Reasons:**
- desktop: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm
- mobile: hit rate limit (429) during rapid capture sequence — likely transient, re-capture to confirm
- No render-blocking errors or auth redirects detected. Pixel-level comparison vs prototype required to classify pass/fail.

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.

No automatic fail signal detected. Open both shots side-by-side to verify visual fidelity vs prototype.
