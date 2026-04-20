# Cycle 3 Smoke Test Status

**State: PASS. STR-011 fixed via Option B. Ready for Phase 5-6 persona re-run.**

## Smoke results (2026-04-20, Option B deploy bng62m2nr)

| Step | Expected | Actual |
|------|----------|--------|
| `curl -sI https://acreos.fly.dev/` | 301 → https://acreos.io/ | ✓ |
| Mint Clerk ticket + nav to `https://acreos.io/auth?__clerk_ticket=...` | 200 page loads | ✓ |
| Auto-redirect to `/today` after sign-in | URL = /today | ✓ |
| `/api/auth/user` | 200 with user (id=4d66476d-c0e1-4fe6-acce-ea1a34b5d62e, firstName=E2E, email=thmsnrtn+e2e-persona-20260419@gmail.com) | ✓ |
| Dashboard renders on /today | Not stuck on "Loading", Welcome onboarding dialog visible | ✓ |
| Nav to `/properties` | Dashboard renders, no redirect to /auth | ✓ |
| Cross-route session persistence | `/properties` keeps session; content renders | ✓ |

## What fixed it

**Option B — server-backed auth via `/api/auth/user`.**

`client/src/hooks/use-auth.ts` no longer waits for `Clerk.isSignedIn === true` (which, in Clerk 6.7.4 with our proxy config, never becomes true after ticket sign-in because `GET /v1/client` returns empty sessions). Instead:

- If `__session` cookie is present on the domain → query `/api/auth/user`.
- 200 with user → authenticated.
- 401 → retry 2x then redirect to `/auth`.

`@clerk/express` on the server reads the `__session` JWT correctly, so the backend auth has always been healthy. Option B just makes the client trust the backend instead of waiting for broken Clerk-JS in-memory state.

`client/src/pages/auth-page.tsx` also pivoted off `useUser().isSignedIn` to `useAuth().user` for the post-sign-in redirect.

## Verdict

✅ **Phase 4 COMPLETE.** Ready to initialize Phase 5 (cycle 3 re-run of 8 personas v3).
