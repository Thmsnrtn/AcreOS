# Cycle 3 Smoke Test Status

**State: FAILED — STR-011 is deeper than the proxy cache.** Smoke test cannot pass; persona re-run blocked until a design call is made.

## What was deployed this cycle

| Commit | Scope | Verified |
|--------|-------|----------|
| 001c8e9 | Canonical URL = acreos.io; test configs updated | ✓ |
| ab6f8a8 | fly.dev → acreos.io 301 edge redirect; clerk-session-recovery calls `__internal_reloadInitialResources` | ✓ redirect via curl; `__internal_reloadInitialResources` function exists on window.Clerk |
| 5d03ef8 | Proxy stopped caching /v1/client across users | ✓ `x-clerk-cache` header absent; cache no longer serves stale |

## STR-026 — FIXED

- `curl -sI https://acreos.fly.dev/` → `301 → https://acreos.io/` ✓
- `curl -sI https://acreos.fly.dev/auth` → `301 → https://acreos.io/auth` ✓
- Clerk JS no longer cross-origin blocked.

## STR-011 — NOT FIXED. New root cause exposed.

### Smoke test empirical behavior (post-deploy, fresh cookies, fresh ticket)

After navigating to `https://acreos.io/auth?__clerk_ticket=<fresh>` and auto-redirect to `/today`:
- `window.Clerk.loaded === true`
- `window.Clerk.client.sessions.length === 0`
- `window.Clerk.session === null`
- `document.cookie` contains `__session=<valid JWT>`, `__session_6kuUlVhz=<same>`, `__client_uat=<stale timestamp 1776625592>`
- No `__client` cookie present — which matters, see below.

### The diagnostic divergence

The same signed-in browser calling different endpoints gets **contradictory** answers from Clerk upstream (via our proxy):

| Endpoint | Returns |
|----------|---------|
| `POST /__clerk/v1/client/sign_ins` (retry ticket) | 400 `session_exists` with `meta.client.sessions[0]` containing the active session (sess_3CaZMG0JCQQvlt0ydM3POpJwzzX, user E2E Persona) |
| `POST /__clerk/v1/client/sessions/{sid}/touch` | 200 with the full session object AND `client` top-level key listing the session |
| `GET /__clerk/v1/client` | 200 but `response.sessions = []`, `response.last_active_session_id = null`, `client: null` |

The same `client_3CaUbCWBgKLFqbFiXj8bPww6Tpo` ID appears in all three, so we're talking to the same client record. But GET returns empty sessions.

### Hypothesis (requires verification)

Clerk upstream's `GET /v1/client` identifies the requesting client via a `__client` token cookie, which our cookie jar **does not contain**. We only have `__client_uat` (the user-activity timestamp). Without the opaque client token, Clerk responds with an empty client snapshot even though the `__session` JWT is valid for the touch/sign_ins endpoints (which use different auth paths — session-id-in-URL or ticket-in-body).

If true, the fix requires ensuring the upstream `__client` cookie is **Set**-back to the browser and persisted. This likely means our proxy's Set-Cookie handling is dropping the multi-value Set-Cookie header:

```ts
clerkRes.headers.forEach((value, key) => {
  if (key === "set-cookie") res.appendHeader(key, value.replace(/domain=.../, "..."));
});
```

`headers.forEach` in Node undici may merge multiple Set-Cookie values into one comma-separated string. `getSetCookie()` would return them as an array. If upstream sets one cookie per directive (e.g., `__client`, `__client_uat`, `__session`) as separate Set-Cookie headers, we may be dropping all but one.

### Why the cache-removal didn't suffice

The proxy-cache bug WAS real (always-"anon" cache key served stale sessions across users for 60s). Removing it was correct. But the underlying "`GET /v1/client` returns empty sessions for this browser" is a separate, deeper issue that persists with the cache off.

### Session already exists

Ticket sign-in returns `session_exists`, meaning the active session from ~45 min earlier is still alive at Clerk upstream. It's reachable via touch but invisible to GET /v1/client. Clerk-JS never sees it, so `Clerk.session`/`Clerk.user` stay null, ProtectedRoute hangs.

## Options for operator decision

**Option A — Fix proxy Set-Cookie handling** (~1–2h)
- Change `server/routes.ts` to use `clerkRes.headers.getSetCookie()` (Node undici 5.7+ / Node 19.7+) and re-emit each Set-Cookie separately.
- Redeploy, verify `__client` cookie lands in browser, re-test smoke.
- Risk: may also need Cloudflare / Fly proxy inspection; Cloudflare can strip Set-Cookie headers under some configurations.

**Option B — Bypass Clerk-JS client state; use server-backed auth** (~3–4h, architectural)
- Rewrite `useAuth()` / `ProtectedRoute` to poll `/api/auth/user` (which is already healthy — STR-007 fix verified in cycle 2) and treat the app as authenticated when that endpoint returns a user.
- The `__session` cookie IS valid (clerk-express backend reads it fine), so this is reliable.
- Trade-off: diverges from Clerk-React hook idiom; breaks some Clerk components that depend on `useUser()`.

**Option C — Upgrade Clerk SDK** (~1–2h + risk)
- `@clerk/react 6.1.3` is installed; latest is 6.x. Upgrade, re-test.
- Won't help if the issue is our proxy's cookie handling (it'd be broken on new SDK too).

**Option D — Investigate Clerk dashboard / proxy config** (~1h)
- The `Clerk-Proxy-Url: https://acreos.io/__clerk` may need corresponding "Satellite domains" or "Proxy URL" configured in the Clerk dashboard. If dashboard config doesn't match, upstream may issue `__client` cookies for the wrong domain and they never reach us.

## Recommendation to operator

Start with **Option A** — it's the smallest change, targets the most specific hypothesis, and would be reversible. If 2h of investigation shows the Set-Cookie is actually making it through fine, escalate to Option B. Option C is worth attempting only if A and B don't work.

Do NOT run the 8-persona re-run until smoke passes — every persona would BLOCK identically. That would waste 8 browser sessions and produce no new signal.

## Commits left in this session

```
001c8e9  fix(domain): canonical URL resolved — acreos.io [cycle3]
ab6f8a8  fix(auth): STR-011 + STR-026 — Clerk 6.7.4 hydration + fly.dev canonical redirect [cycle3]
0c07a5a  docs(cycle3): checkpoint — phases 1-3 complete, awaiting deploy [cycle3]
5d03ef8  fix(auth): STR-011 real root cause — proxy cache served anon /v1/client to signed-in users [cycle3]
```

All deployed. fly.dev → acreos.io 301 and proxy-cache bypass ARE fixes regardless of what comes next.
