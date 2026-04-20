# Cycle 3 Smoke Test Status

**State: Option A tried + failed. STR-011 persists. Option B recommended next.**

## What Option A proved (deployed, ba25ra15g)

- Proxy now uses `.getSetCookie()` + logs cookie names relayed.
- Fly logs confirm: Clerk upstream only issues `__client_uat` (and the `_6kuUlVhz` suffix variant), plus Cloudflare cookies. **It never sends a `__client` cookie** in our proxy configuration.
- The browser's `__client_uat` stays STALE at `1776625592` (the timestamp from the original ticket sign-in 45 min ago). New ticket sign-ins don't update it — upstream keeps responding with the same value because the existing session is still considered active.
- `__session` cookie IS being refreshed (fresh JWT with current iat), but it's set by `@clerk/express` middleware on application routes, not by our `/__clerk` proxy.
- Final state: `Clerk.client.sessions.length === 0`, `Clerk.session === null` — same symptom as before.

## What we now know about STR-011

1. **The proxy is clean.** It forwards cookies to upstream and relays Set-Cookies back. `getSetCookie()` swap verified via logs.
2. **The upstream behavior is the actual issue.** On the SAME browser:
   - `POST /v1/client/sign_ins` returns `400 session_exists` with `meta.client.sessions=[active session]`.
   - `POST /v1/client/sessions/{sid}/touch` returns `200` with the full session + client with sessions populated.
   - `GET /v1/client` returns `200` with `response.sessions = []`, `response.last_active_session_id = null`.
3. Same client ID (`client_3CaUbCWBgKLFqbFiXj8bPww6Tpo`) in all three responses. Different "view" of it depending on endpoint.
4. Clerk-JS 6.7.4 populates `client.sessions` from the `GET /v1/client` path — so the empty response there directly causes `Clerk.session === null`, which fails ProtectedRoute.

This is a Clerk SDK + proxy-mode-upstream behavior mismatch we cannot fix via our proxy. It's possibly a Clerk bug, possibly a Clerk instance config issue (satellite domains, Proxy URL mismatch), possibly a known limitation of this SDK/proxy combo.

## Recommended next step: **Option B — server-backed auth**

The robust, fast path forward:

1. `@clerk/express` middleware on the server already reads the `__session` cookie correctly — every authenticated API endpoint works (STR-007 `/api/auth/user` verified healthy in cycle 2).
2. Replace `useAuth()` / `ProtectedRoute` client-side check: instead of polling Clerk-JS client state, query `/api/auth/user`. If 200 → authenticated. If 401 → redirect to `/auth`.
3. Keep Clerk-React for sign-in/sign-out UI components (they still work via direct ticket/sign_in_ins flow).
4. Accept that `Clerk.session`/`Clerk.user` in-memory state may remain empty — but the app routes authenticated users correctly because the server-truth auth endpoint does the right thing.

Estimated effort: 2–3 hours. Files to touch: `client/src/hooks/use-auth.ts`, `client/src/components/ProtectedRoute.tsx` (if it exists; else the gating logic), plus any component using `useUser()` that needs a server-fetched user instead.

## Lower-priority alternatives

- **Option C (Clerk upgrade)**: Worth trying if B is blocked, but if the root cause is Clerk proxy config rather than SDK version, upgrade won't help.
- **Option D (Clerk dashboard audit)**: Inspect the Clerk instance's Proxy URL setting. If dashboard has `https://clerk.acreos.io/` (a legacy subdomain that Cloudflare blocks per `server/routes.ts:217` comment) but the SDK is now configured for same-origin `/__clerk`, there's a dashboard drift that would cause exactly these cookie issues.

## Commits this session (all deployed, all correct fixes regardless)

```
001c8e9  fix(domain): canonical URL resolved — acreos.io [cycle3]
ab6f8a8  fix(auth): STR-011 + STR-026 — Clerk 6.7.4 hydration + fly.dev canonical redirect [cycle3]
5d03ef8  fix(auth): STR-011 real root cause — proxy cache served anon /v1/client to signed-in users [cycle3]
21de60c  docs(cycle3): STR-011 deeper root cause documented
<latest>  fix(auth): STR-011 Option A — Clerk proxy uses getSetCookie() + logs cookie names [cycle3]
```
