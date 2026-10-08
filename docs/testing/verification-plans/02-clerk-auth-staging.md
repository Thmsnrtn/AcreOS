# Plan 2 — Clerk authentication on staging

**Status:** Not yet run · **Owner:** [OWNER] founder to assign · **Index:** [README](README.md)

## Goal

Establish that real authentication works end to end on a deployed staging
instance: sign-up, sign-in, multi-factor authentication, session expiry and
renewal, sign-out, and switching the active organization — with the tenant
boundary holding at every step.

## Why the campaign could not cover it

Every campaign request authenticated through the E2E test-auth bypass
(`E2E_TEST_AUTH=1`, `server/auth/testAuth.ts`): a fixed user id or a
persona cookie injected by `isAuthenticated`, with the `/__clerk` proxy
answering 404 so Clerk-JS never loads. Nothing in Clerk's flow ran. The
bypass is refused on any Fly machine (`assertTestAuthSafe()` hard-exits when
`E2E_TEST_AUTH` is seen alongside `FLY_APP_NAME`), so this plan cannot be
run with it, by design.

## What the code does today (context for the tester)

- Server verification lives in `server/auth/clerkAuth.ts` (Clerk SDK, with a
  manual `__session` JWT fallback using `CLERK_JWT_KEY`; its comments note
  that production cookies may carry a suffixed name, `__session_<hash>`).
- Active-organization switching is **AcreOS's own mechanism, not Clerk
  Organizations**: `GET /api/auth/organizations` lists memberships (owner or
  an active `team_members` row) and `POST /api/auth/switch-organization`
  (`server/auth/routes.ts`) stores the choice in a signed cookie that
  `server/middleware/getOrCreateOrg.ts` re-checks on every request. The UI is
  `client/src/components/org-switcher.tsx`.
- Existing Playwright Clerk set-ups: `tests/e2e/auth.setup.ts`
  (`E2E_USER_EMAIL` / `E2E_USER_PASSWORD`) and
  `tests/e2e/auth-clerk-ticket.setup.ts` (`CLERK_SIGN_IN_TICKET`, using
  `@clerk/testing`). The ticket set-up's header refers to
  `scripts/playwright-clerk-runner.sh`, which is not present in the repo —
  the ticket must be minted by hand or by a new script.
- Incident runbooks: `docs/runbooks/01-customer-cant-sign-in.md`,
  `docs/runbooks/clerk-incident-response.md`.

## Environment and prerequisites

- A deployed staging app. `.github/workflows/staging.yml` deploys only when
  the `FLY_STAGING_APP` repository variable names an existing Fly app — first
  confirm that it does.
- A **separate Clerk development or staging instance** (never the production
  instance) configured with the staging domain.
- Staging secrets set by name: `CLERK_SECRET_KEY`, `CLERK_PUBLISHABLE_KEY`,
  `VITE_CLERK_PUBLISHABLE_KEY` (build-time), `CLERK_JWT_KEY`, and
  `CLERK_FRONTEND_API` / `CLERK_FAPI_ORIGIN` if the proxy is used.
- `E2E_TEST_AUTH` must be **absent** from staging.
- Test mailboxes and a test phone (or an authenticator app) for MFA, owned by
  the tester. No customer addresses.
- Two test users (U1, U2) and three organizations: O1 owned by U1, O2 owned by
  U2, and O3 owned by U1 with U2 added as an active team member.

## Procedure

1. **Sign-up.** Create a new user through the public sign-up path with email
   verification. Confirm the app creates the user and their first
   organization exactly once (no duplicate org on reload or a double-clicked
   submit).
2. **Sign-in.** Sign in with password; with an email code/link if enabled;
   with each enabled social provider. Wrong password and unknown account must
   produce Clerk's error, not an AcreOS 500.
3. **MFA.** Enrol TOTP (and SMS if enabled), sign out, sign in and complete the
   second factor. Confirm that a session cannot reach `/api/*` before the
   second factor is complete. Exercise backup codes once.
4. **Session lifetime.** Leave a signed-in tab idle past the configured
   inactivity and maximum lifetimes (read both from the Clerk dashboard and
   record them). Confirm the next API call yields a clean 401 and the client
   returns to sign-in without a loop. Confirm a still-active tab keeps
   working across Clerk's short-lived token refreshes.
5. **Sign-out.** Sign out in one tab; confirm a second open tab loses access on
   its next request. Sign out on one device; record whether other devices'
   sessions end (expected behaviour per the Clerk instance setting — record
   it, the founder decides if it is acceptable).
6. **Revocation.** Revoke U1's session from the Clerk dashboard; confirm the
   next request is refused.
7. **Organization switch.** As U2: list organizations (expect O2 and O3 only);
   switch to O3; confirm data shown is O3's. Have U1 deactivate U2's
   membership in O3; confirm U2's next request in O3 is refused even though
   U2 still holds the switch cookie (the re-check in `getOrCreateOrg`).
   Request a switch to O1 (where U2 has no membership) and expect a refusal.
8. **Founder gate.** Confirm a non-founder staging user cannot reach any
   `/founder/*` surface or `/api/founder/*` endpoint after real sign-in.
9. **Browsers.** Repeat steps 2 and 4 on desktop Safari and iOS Safari (shared
   with plan 1), since cookie policy differs there.
10. **Automation (optional, after the manual pass).** Run the
    `desktop-chrome` project of `playwright.config.ts` against staging with
    `PLAYWRIGHT_BASE_URL` set and one of the two set-ups above.

## Pass criteria

- Each step's expected behaviour is observed on each listed browser.
- No step yields an HTTP 5xx, a redirect loop, or data from an organization
  the user is not an active member of.
- **Fail:** any cross-organization data after a switch or revocation; any API
  access before MFA completes; any duplicate organization from one sign-up;
  any session that outlives a revocation.

## Results

Not yet run.

## Still owed

- An owner and a date.
- Confirmation that a staging Fly app and a non-production Clerk instance
  exist.
- Founder decisions to record: session inactivity and maximum lifetime; which
  sign-in methods and MFA factors are enabled for launch.
- A replacement for the missing `scripts/playwright-clerk-runner.sh`, or an
  edit to the ticket set-up's header, so the automated path is runnable.

## Run log

_(empty — append entries per the format in [README](README.md))_
