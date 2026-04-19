# Findings Report

- **Run ID**: 2026-04-19-r2-dana-first-deal
- **Persona**: 02-experienced-wholesaler-rural
- **Journey**: 01-first-deal-evaluation
- **Total Findings**: 2 (1 CRITICAL, 1 MEDIUM — plus existing r1 findings that still apply)

## CRITICAL

### STR-011: Clerk `client.sessions` empties on client-side navigation

- **Severity**: CRITICAL
- **Category**: structural
- **Step**: 2
- **URL**: any route change under `https://acreos.io/*`
- **Description**: After a successful sign-in (ticket or password), `Clerk.session` and `Clerk.user` populate correctly on the initial landing page. On any client-side navigation to another authenticated route, `Clerk.client.sessions` drops to an empty array. Since `useAuth.isSignedIn` depends on Clerk's client state, `ProtectedRoute` treats the user as not signed in and renders a loading spinner indefinitely. The server still accepts the `__session` cookie — `/api/auth/user` returns 200 — so this is a pure client-side state bug.
- **Evidence**: On /today after sign-in: `sessions: 1, session: 'sess_...', user: 'user_...'`. Immediately after `browser_navigate('/properties')`: `sessions: 0, session: null`. The `__session` cookie remains intact; the server continues to authenticate it.
- **Persona Impact**: Every persona in the 8-run cycle has to repeat the sign-in dance per page. For Dana (low patience, 15-min eval window) this alone is journey-ending.
- **Recommended Action**: Investigate why `ClerkProvider` (invoked in `client/src/main.tsx`) re-initializes its client state on route change when it shouldn't. Likely suspect: something is forcing a remount — possibly a React StrictMode double-invoke, a `key` change on ClerkProvider, or a dev-mode HMR artifact that shouldn't apply to prod. The `clerk-session-recovery` safety net I added polls only during Clerk loading, so it doesn't cover this navigation-time loss — a more durable fix is to observe `Clerk.addListener` and call `setActive` whenever `client.sessions` becomes non-empty with no `session` set.

## MEDIUM

### UX-003: List-builder / county-selector flow not discoverable from empty state

- **Severity**: MEDIUM
- **Category**: ux-coherence
- **Step**: N/A (inferred from /properties empty state observed in r1)
- **URL**: /properties, /leads
- **Description**: Dana's operation starts with "pull a list of 5-40 acre parcels in Reeves County that last sold 3+ years ago". The empty state on /properties offers "Add a Property" (one-at-a-time) and "Import CSV" (bring your own list). There's no visible flow that says "I have no list — help me build one from county data." The sidebar has `Counties`, `Markets`, `Acq. Radar` but none are introduced in the empty state.
- **Evidence**: /properties empty state only exposes Add Property and Import CSV. The product capability to pull county data exists (per acreos-product-model.md) but isn't routed from the empty state.
- **Persona Impact**: Dana would need to discover `Acq. Radar` or `Counties` on her own. In her 15-minute window, that's a finding-the-tool task rather than an evaluating-the-tool task.
- **Recommended Action**: Add a third empty-state CTA on /properties: "Build a list from county data" linking to `Acq. Radar` or the county-browse flow. Same treatment on /leads.

---

## Unresolved findings from r1 still applicable

- UX-001 (tagline drift) — observed again on /auth.
- STR-005 (migrations pipeline) — partially fixed (release_command wired), but local journal still out of sync with migrations folder.
- STR-007 (`/api/user` 404) — still fires on every authenticated page load.
- STR-008 (Pax endpoints 429 on warmup) — still fires.
- STR-009 (`/api/analytics/session/start` 403, `/api/telemetry` 403) — still fires.
- UX-002 (auto-named "E2E's Organization") — still displays.

## Fixes applied DURING or RESULTING FROM this run

1. **STR-003** (CSRF) — ✅ DEPLOYED. `server/middleware/csrf.ts` issues `csrf_token` on safe requests; client auto-attaches it on mutations via `apiRequest` and a global fetch interceptor. Verified 403→400 transition.
2. **STR-004** (Clerk `setActive` after ticket) — ✅ PARTIAL FIX DEPLOYED. `client/src/lib/clerk-session-recovery.ts` promotes an inactive session once after Clerk loads. Does NOT cover STR-011 (the navigation-time loss discovered here).
