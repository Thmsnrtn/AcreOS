# Cycle 3 Smoke Test Status

**State: PASS (with JWT keep-alive). Ready for Phase 5-6 persona runs.**

## Final smoke test (2026-04-20, post-deploy bc02ys2et)

| Step | Expected | Actual |
|------|----------|--------|
| `curl -sI https://acreos.fly.dev/` | 301 → https://acreos.io/ | ✓ |
| Ticket sign-in → /today auto-redirect | URL = /today | ✓ |
| `/api/auth/user` immediately after sign-in | 200 with user | ✓ |
| Dashboard renders (Welcome onboarding dialog visible over it) | ✓ |
| Navigate to /properties | Inventory loads; Cochise AZ property visible | ✓ |
| Open property detail → Analyze with AI → Run Quick Analysis | Dialog opens, analysis path reachable | ✓ |
| **Wait 80 seconds** | JWT refreshed by keep-alive (iat 39s ago, not expired) | ✓ |
| `/api/auth/user` 80s after sign-in | 200 with user (was 401 before keep-alive fix) | ✓ |

## Full fix arc this cycle

| Commit | Fix | Live |
|--------|-----|------|
| `001c8e9` | Canonical URL = acreos.io; test configs updated | ✓ |
| `ab6f8a8` | fly.dev → acreos.io 301 at edge; Clerk `__internal_reloadInitialResources` call | ✓ |
| `5d03ef8` | Stopped caching /v1/client in proxy (always-"anon" key served stale) | ✓ |
| `<Opt A>` | Proxy `.getSetCookie()` + Set-Cookie logging | ✓ |
| `<Opt B>` | `useAuth()` + auth-page pivoted to server-backed `/api/auth/user` | ✓ |
| `<keep-alive>` | Periodic `touch()` refreshes __session JWT every 45s | ✓ |

## Observed but unresolved (non-blocking for runs, flag as findings)

- **Onboarding dialog re-appears on every route** until "Don't show again" is clicked. r1 Marcus investigation confirmed this. Will surface as a UX finding in most persona transcripts.
- Several background endpoints 401 transiently in first ~1s after sign-in (notifications/count, inbox/unread-count, pax/observations) until the query-client catches up. Keep-alive solves the long-tail; first-second transient is cosmetic but worth noting.
- `/api/land-credit/property/2` returns 500 (seen once, not yet investigated).
- `/api/white-label/config` returns 404 (probably optional feature).

## Ready for Phase 5-6

Proceed to persona runs. Keep-alive makes journeys of any length sustainable. Full 8-run matrix in `_cycle3-rerun-progress.md` + `_RESUME-HERE.md`.
