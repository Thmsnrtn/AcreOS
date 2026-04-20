# Cycle 3 Smoke Test Status

**State: AWAITING DEPLOY** (code fixes committed, deploy requires operator action)

## Committed Fixes

| Commit | Scope |
|--------|-------|
| 001c8e9 | `fix(domain): canonical URL resolved — acreos.io [cycle3]` |
| ab6f8a8 | `fix(auth): STR-011 + STR-026 — Clerk 6.7.4 hydration + fly.dev canonical redirect [cycle3]` |

## Deploy Blocker

`flyctl` is installed but no access token is available (`fly status -a acreos` → "no access token"). Deploy cannot proceed from this session without the operator.

## Operator Actions Required

Either:

**(A) Provide the token to this session:**
```
export FLY_API_TOKEN="<token>"
```
Then I will run `fly deploy -a acreos` and continue to Phase 4 smoke test.

**(B) Deploy yourself:**
```
fly deploy -a acreos
```
Once it reports success, say "deployed" and I will resume at Phase 4 smoke test.

## Smoke Test Plan (Phase 4, post-deploy)

1. `mcp__playwright__browser_navigate` → `https://acreos.fly.dev/` — assert 301 to `https://acreos.io/` (STR-026 verification).
2. Mint Clerk ticket via API for `user_3CaZCrUqwtHueUi1bdSgyxkHQV3`.
3. `browser_navigate` → `https://acreos.io/auth?__clerk_ticket=<TICKET>`.
4. Wait up to 10s. `browser_evaluate` → assert `window.Clerk.client.sessions.length > 0` AND `window.Clerk.session !== null`.
5. `browser_navigate` → `https://acreos.io/today` — assert dashboard renders (not stuck on "Loading page").
6. `browser_navigate` → `https://acreos.io/properties` — assert session persists (no re-auth).
7. `browser_navigate` → `https://acreos.io/today` — assert still authenticated.

All must PASS before proceeding to Phase 5 (Cycle 3 re-run).
