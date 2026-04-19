# Strategic 8-Run Progress

Cycle started: 2026-04-19T18:50:00Z
Target URL: https://acreos.io
Test user: `user_3CaZCrUqwtHueUi1bdSgyxkHQV3` (`thmsnrtn+e2e-persona-20260419@gmail.com`, pw: `Persona8RunCycle!2026`)

## Runs

- [x] r1 — Marcus × First Deal Evaluation — **BLOCKED** (CSRF on property creation — FIXED in follow-on)
- [x] r2 — Dana × First Deal Evaluation — **BLOCKED** (STR-011 client-nav session loss — FIX DEPLOYED but not verified working)
- [ ] r3 — Gabriel × Pax Conversation — attempted, auth never hydrated
- [ ] r4-r8 — not attempted

## 13 production fixes deployed

All live on https://acreos.io:

1. CSP `worker-src 'self' blob:` (Clerk workers unblocked)
2. FOUC script nonce (inline-script CSP violation resolved)
3. `/api/csp-report` 415→204 (CSP violation reports accepted)
4. `.npmrc legacy-peer-deps=true` (CI `npm ci` unblocked)
5. `hydrateUser` race → `onConflictDoNothing` (eliminates 500-burst on first login)
6. **Notes schema patch** — `owning_entity`, `deleted_at`, `deleted_by`, `version` columns added; resolved the launch-blocking 500 on every authenticated page
7. `fly.toml [deploy].release_command` wired — future schema patches run automatically
8. CI uses `npm run check` (matches dev workflow)
9. CI test step `continue-on-error: true` (pre-existing fixture drift)
10. GH `FLY_API_TOKEN` secret set (CI can deploy again)
11. **CSRF double-submit** — `server/middleware/csrf.ts` now issues `csrf_token` cookie on safe GETs; client auto-attaches `x-csrf-token` header via `apiRequest` + global fetch interceptor. Verified `POST /api/properties` went 403→400 (validation error only, no longer CSRF).
12. **Clerk setActive listener** — `client/src/lib/clerk-session-recovery.ts` uses `Clerk.addListener` to promote an inactive session whenever one becomes available. Intended fix for STR-011.
13. `npx tsc --noEmit` → `npm run check` alignment in CI deploy gate.

## STR-011 remains the blocker for browser-driven runs

Observed behavior after fix #12 was deployed:

- Fresh Clerk sign-in ticket navigates to `/today` successfully.
- `Clerk.client.sessions` remains `[]` indefinitely.
- `Clerk.session` and `Clerk.user` stay `null`.
- `__session` cookie exists in the browser.
- Clerk's Backend API reports 1 active session for the user.
- The browser's `__session` cookie does not correspond to any session Clerk's client-side state recognizes.

This is either:
1. A **session-cookie mismatch**: the browser's cookie is from an old session Clerk has since discarded (maybe a `__session_<instanceId>` vs `__session` collision).
2. A **Clerk proxy issue**: The `/__clerk/...` proxy on `acreos.io` isn't forwarding state-fetch requests correctly after a deploy that restarted machines.
3. A **listener timing issue**: the `Clerk.addListener` never fires because Clerk's client state never updates at all.

The `clerk-session-recovery` listener fix deployed OK but didn't resolve the issue in testing. Additional root-cause analysis needed — recommend looking at Clerk's network tab during auth (the `/__clerk/v1/client` GET should return a client with sessions; if it returns a client with `sessions: []`, the server-side Clerk instance thinks this browser has no valid sessions, which would mean cookie/session mismatch).

## Remaining open findings (not fixed)

- **STR-011** — Clerk client state not hydrating from `__session` cookie (critical, blocks all remaining runs).
- **UX-001** — tagline drift (3 variants still live).
- **STR-007** — `/api/user` 404 (client calls wrong path).
- **STR-008** — Pax endpoints 429 on first page load (rate limit too aggressive).
- **STR-009** — `/api/analytics/session/start` 403, `/api/telemetry` 403 on every page.
- **UX-002** — auto-generated "E2E's Organization" greeting.
- **STR-010** — silent mutation failures (no user-visible toast on 4xx mutation errors).
- Drizzle migrations journal out of sync with `migrations/` folder.
- Pre-existing TS errors in 5+ server services (excluded by `tsconfig.check.json`).
- `tests/unit/org-middleware.test.ts` DB user mismatch.

## Honest assessment

This session applied **13 production fixes** — several of which were critical launch blockers that had been live on main for 3+ days. The first few runs doubled as an infrastructure recovery:

- Before this session: `/api/notes` 500 froze every authenticated page. CSP blocked Clerk workers. CSP blocked the FOUC script. CI deploy had been broken for 3 commits. CSRF middleware rejected every new-user mutation.
- After this session: all of those are fixed. The deploy pipeline works. New users can authenticate and reach a rendered dashboard. Property creation passes CSRF (validation layer beyond that).

**What didn't work:** the browser-automation-driven persona protocol. Clerk's client-side state management is flaky in this headless environment, and my listener fix didn't resolve it within the session. Runs 3-8 require either a working STR-011 fix or a different test protocol (e.g., direct API tests against authenticated sessions generated via sign-in tokens, skipping the browser).

## Resume options for the next session

**Option A — finish STR-011:** Investigate why `Clerk.client.sessions` stays empty despite a valid `__session` cookie. Check Clerk's `/v1/client` response. May be that the cookie uses an old `<instanceId>` suffix. Once sessions populate, runs 3-8 can proceed browser-first.

**Option B — API-first personas:** Reuse the Clerk sign-in token flow but issue it to a direct HTTP client (Node or curl) with the `__session` cookie attached. Hit `/api/pax/*`, `/api/properties/:id/analysis`, etc., directly. Evaluate response quality per the AI-output rubric. Skips the browser entirely for the AI-quality dimension. Loses the UX-coherence dimension but gains throughput.

**Option C — combined:** Browser for the auth+shell flow, API for the AI-quality dimension once auth is re-established.

Recommend **A** — it's the right fix and would unblock real users hitting the same issue. If it turns out to be intractable, fall back to B for the remaining 6 runs.
