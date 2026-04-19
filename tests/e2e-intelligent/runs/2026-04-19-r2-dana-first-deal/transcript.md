# E2E Intelligent Test Transcript

- **Run ID**: 2026-04-19-r2-dana-first-deal
- **Persona**: 02-experienced-wholesaler-rural (Dana Cho, 41, Midland TX, 6yr wholesaler, 40-50 deals/yr, PropStream+Podio stack)
- **Journey**: 01-first-deal-evaluation
- **Date**: 2026-04-19T21:18:00Z
- **Target**: https://acreos.io
- **Steps**: 3

## Persona Summary

Dana Cho — 6yr experienced wholesaler, ~45 deals/year across TX/NM/AZ/CO. Uses PropStream + Podio + monster Google sheet. Skeptical of AI; actively tests it. 15-minute eval window. Zero tolerance for slow bulk ops or bad data. Evaluates tools the way she evaluates deals — fast.

## Journey Objective

Same as r1: locate a parcel, run AI Quick Analysis, arrive at go/no-go.

## Pre-run fixes (applied after r1)

Committed and deployed during the gap between r1 and r2:

- **STR-003 fix** (CSRF): `csrf_token` cookie now issued on every safe `/api/*` request. Client's `apiRequest` and a new global fetch interceptor (`client/src/lib/csrf-fetch.ts`) mirror the token into `x-csrf-token` for mutations. Verified: `POST /api/properties` went 403 → 400 (validation error, no longer CSRF-blocked).
- **STR-004 fix attempted** (Clerk setActive): added `client/src/lib/clerk-session-recovery.ts` which polls briefly after Clerk loads and promotes an inactive active session via `setActive`. Deployed but not fully resolving the navigation-level session loss (see below).

---

## Steps

### Step 1 — Fresh Clerk sign-in ticket, navigate to /auth?__clerk_ticket=...

- **URL**: /auth?__clerk_ticket=... → redirect → /today
- **Observation**: Dashboard reaches /today URL. Sessions initially empty (`Clerk.client.sessions.length === 0`). After 8–10s `setActive` promoted the existing session; dashboard rendered.
- **In-character thought**: _"Okay, I'm in. Shell rendered. Let me pull Reeves County."_

### Step 2 — Navigate to /properties

- **URL**: /properties
- **Observation**: Client-side navigation to `/properties` loses the Clerk session — `Clerk.client.sessions.length` drops back to 0 even though the `__session` cookie is still on the domain. The new `clerk-session-recovery` safety net couldn't recover because there were no sessions to recover. Dashboard reverts to "Loading page" spinner.
- **Friction event 1**: recurrent auth-state loss on route change.

### Step 3 — Sign in again with password-only (email→continue)

- **URL**: /auth
- **Action**: `type(email)` → `click(Continue)`
- **Observation**: Clerk accepted the email alone (no password prompt — previously-verified device). Redirected to /today immediately. But `Clerk.client.sessions.length === 0` again. SPA stuck on loading page.
- **Friction event 2**: Even a full re-sign-in doesn't populate Clerk's client-side session array on this environment.
- **In-character thought (paraphrased)**: _"I've now spent five minutes signing in twice and I'm not even looking at a parcel. I'd have had the list open in PropStream and be on call number three by now."_

---

## AI Output Evaluations

None — journey never reached a page with AI output.

---

## Journey Verdict

- **Outcome**: **BLOCKED** (infra)
- **Satisfaction**: 1/5
- **Would Recommend**: **no**
- **Reasoning**: Dana's journey could not proceed past the authenticated shell. The CSRF blocker from r1 IS fixed (major product improvement), but a separate auth-state persistence bug (STR-004, partially addressed) makes it impossible to navigate between pages without re-authenticating. For Dana's operation (pull Reeves list, filter, comp a parcel, done in 15 minutes) even the happy path would lose 3-4 minutes per navigation to auth re-hydration — an automatic abandonment for her patience profile.

### Top Issues

- Navigation between authenticated pages nullifies `Clerk.client.sessions` in the SPA, leaving the app permanently in "Loading page" state even when the session cookie is present and the server recognizes it.
- Same issues as r1: auth tagline drift, empty-state friction, 14 noisy console errors from non-critical endpoints.
- No list-builder or county-selector visible from empty state (Dana expected "pull Reeves County by acreage + last-sale" — no such flow reachable).

### Top fixes applied during this run (beyond r1)

1. `fix(csrf)` landed and verified — every new user can now call state-changing endpoints once authenticated.
2. `fix(auth)` Clerk session recovery — deployed. Handles the ticket-then-setActive case but does not cover the navigation-level session loss documented here.
