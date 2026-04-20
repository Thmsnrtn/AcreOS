# r1 Marcus cycle 2 — Findings

## STR-011 (CRITICAL, INCOMPLETE FIX)

- **Severity**: CRITICAL
- **Verdict**: **INCOMPLETE FIX** vs cycle 1 — same symptoms reproduce 100%.
- **Step**: Step 3 (post-ticket sign-in, navigating to /today)
- **URL**: https://acreos.io/today
- **Evidence**:
  - `window.Clerk.loaded === true`
  - `window.Clerk.client.sessions.length === 0`
  - `window.Clerk.session === null`
  - `__session` cookie IS present, JWT valid
  - `fetch('/__clerk/v1/client')` → 200, body contains active session with user data
  - `Clerk.client.reload` is **not a function** in Clerk 6.7.4 (my cycle 1 fix called a non-existent method)
  - Full page reload does not recover
- **Root cause (hypothesis)**: Clerk-JS 6.7.4 initialization path doesn't hydrate its in-memory `Client.sessions` from the `/v1/client` response in this code path. The SDK returns `loaded: true` but with empty sessions.
- **Recommended action**:
  1. Inspect Clerk SDK 6.7.4 internals — look for `Client.__experimental_refresh` or similar.
  2. Consider upgrading to latest Clerk 6.x and re-testing.
  3. As a fallback, after ticket sign-in, POST to the server to mint a new __session token and reload — this worked in cycle 1's Option B testing.
  4. Confirm the Clerk proxy `/__clerk/v1/client` is not stripping any header the SDK uses to validate the response.

## NEW-STR-026 (CRITICAL, NEW FINDING)

- **Severity**: CRITICAL
- **Verdict**: NEW FINDING (not in cycle 1)
- **Step**: Step 2 (initial page load on acreos.fly.dev)
- **URL**: https://acreos.fly.dev/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js
- **Evidence**:
  - `curl -I` → `307 → https://acreos.io/__clerk/npm/@clerk/clerk-js@6.7.4/dist/clerk.browser.js`
  - Browser blocks cross-origin script load from fly.dev → io
  - Console: `Failed to load resource: net::ERR_FAILED` (repeated) and `Xf: Clerk: Failed to load Clerk JS`
  - Any user landing on acreos.fly.dev cannot authenticate — full app blank
- **Root cause**: `CLERK_PROXY_URL=https://acreos.io/__clerk` is set to absolute URL; acreos.fly.dev rewrites Clerk paths to acreos.io, which browsers block due to CORS/CORB for script resources.
- **Recommended action (pick one)**:
  1. Redirect the entire `acreos.fly.dev` host to `acreos.io` at the Fly proxy / Cloudflare level so users never land on fly.dev.
  2. Configure CLERK_PROXY_URL to be a relative-origin path (`/__clerk`) and ensure the Fly app proxies `/__clerk/*` → Clerk upstream directly rather than redirecting to acreos.io.
  3. Test at https://acreos.io from here on; treat acreos.fly.dev as internal-only.

## Cycle 2 finding — non-browser fixes DID land

API-first smoke tests (from the preceding fix session) confirm:
- `/api/properties/by-location` — 200
- `/api/counties` — 200
- `/api/direct-mail/templates` — 200
- `/api/fema/flood-zone` — 200
- `/api/due-diligence` — 200
- `/api/getting-started/checklist` — 200
- `/api/notes/amortize` — 200 (correct payment: $332.02/mo)
- `/api/parcels/search` — 200
- `/api/geocode/reverse` — 200 (real Mapbox address)
- `/api/ai/chat` — 200 (claude-sonnet-4-6, ~2.7s, full response)

These endpoints are HEALTHY. But they're invisible to real users until STR-011 + NEW-STR-026 unblock the client path.

## Delta Tag

**SAME (INCOMPLETE FIX)** for STR-011.
**NEW FINDING FROM FIX** for NEW-STR-026 (proxy redirect only surfaced because Clerk was the bottleneck; was hidden in cycle 1 by other bugs).
