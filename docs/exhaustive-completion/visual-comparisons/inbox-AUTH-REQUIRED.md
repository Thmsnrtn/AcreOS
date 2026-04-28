# /inbox — Auth-gated visual comparison (1.1.B)

**Production URL:** https://acreos.io/inbox
**Captured:** 2026-04-28T11:27:57.635Z via Playwright + dev-bypass Clerk sign-in token

## Prototype reference

- Desktop (1440): `prototype-screenshots/inbox-1440.png` 
- Mobile (375):  `prototype-screenshots/inbox-375.png` 

## Production capture (this run)

- Desktop (1440): `auth-screenshots/inbox-1440.png`
- Mobile (375):  `auth-screenshots/inbox-375.png`

## Capture metadata

| Breakpoint | File size | Final URL | Issues |
|---|---|---|---|
| 1440 | 132KB | (no redirect) | 9 |
| 375 | 68KB | (no redirect) | 9 |

### Desktop (1440) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: [Query Error — suppressed toast] Error: 404: Message not found
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:7
console.error: [Query Error — suppressed toast] Error: 404: Not found
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:70242
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
... and 1 more
```

### Mobile (375) console issues

```
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: [Query Error — suppressed toast] Error: 404: Not found
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:70242
console.error: Failed to load resource: the server responded with a status of 404 ()
console.error: [Query Error — suppressed toast] Error: 404: Message not found
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:7
console.error: Failed to load resource: the server responded with a status of 500 ()
console.error: [Query Error] Error: 500: Internal server error
    at eu (https://acreos.io/assets/index-D183Bp82.js:2:67740)
    at async https://acreos.io/assets/index-D183Bp82.js:2:70242
console.error: Failed to load resource: the server responded with a status of 403 ()
... and 1 more
```

## Provisional verdict

**Classification:** NEEDS-HUMAN-REVIEW

**Reasons:**
- No render-blocking errors or auth redirects detected. Pixel-level comparison vs prototype required to classify pass/fail.

## Notes

Provisional verdict from automated capture analysis. Pixel-level comparison vs prototype happens in 1.1.D picker via three-panel view.

No automatic fail signal detected. Open both shots side-by-side to verify visual fidelity vs prototype.
