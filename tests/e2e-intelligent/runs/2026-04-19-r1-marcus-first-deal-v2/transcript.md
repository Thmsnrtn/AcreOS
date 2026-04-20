# Run r1 — Marcus × First Deal Evaluation (Cycle 2)

- **Persona**: 01-new-to-land-suburban (Marcus Reid, 34, Edison NJ, high tech comfort, medium patience)
- **Journey**: 01-first-deal-evaluation
- **Run ID**: 2026-04-19-r1-marcus-first-deal-v2
- **Started**: 2026-04-19T23:45Z
- **Cycle 1 verdict**: BLOCKED (Clerk sessions empty on nav + /api/user 404)

## Persona voice — opening

Okay, so AcreOS. The YouTube guy said this was "the operating system for land investors." Let me actually try it. I've got about 90 seconds of patience for the first-impression before I decide if it's worth a real evaluation.

## Steps

### Step 1 — Land on /auth via ticket

I ended up on `/auth?__clerk_ticket=...` (simulating an email magic-link flow). Page title loads: "AcreOS — The AI-Powered Platform for Land Investors." Okay, we're somewhere.

**In-character thought**: _"Clean hero copy, that's a good sign. Let me see what happens."_

### Step 2 — 307 on acreos.fly.dev — redirect to acreos.io

Dev tools caught this (I'm the persona who notices 500s and redirects). On `acreos.fly.dev` the Clerk bootstrap JS returned **HTTP 307 → https://acreos.io/...** and then failed cross-origin. The page just hung on "Loading page" forever. I manually tried `acreos.io` instead.

**In-character thought**: _"That's a Cloudflare/proxy config bug. If my buddy sent me a fly.dev link I'd be stuck on a spinner. Already a point deducted."_

**Finding**: **NEW-STR-026** (CRITICAL) — `acreos.fly.dev` 307-redirects Clerk JS to `acreos.io` (cross-origin), breaking the SDK bootstrap. Any user who lands on the fly.dev URL (the same URL cycle 1 tested against) cannot authenticate at all. Fix: serve Clerk at same origin or redirect the whole domain.

### Step 3 — acreos.io/today — stuck on "Loading page" spinner

On `acreos.io/today` Clerk JS loads fine. The `__session` cookie is present (verified via `document.cookie`). The page renders a `<div aria-label="Loading page">` spinner and never progresses to the dashboard.

I dug in with dev tools (I'm the guy who opens dev tools):

- `window.Clerk.loaded === true`
- `window.Clerk.client.sessions.length === 0` ← **this is the bug**
- `window.Clerk.session === null`
- `document.cookie` contains a valid `__session` JWT (iat/exp current)
- Raw fetch to `/__clerk/v1/client` returns a full response with the session populated: `{sessions: [{id: "sess_3CaZMG0JCQQvlt0ydM3POpJwzzX", status: "active", user: {...}}]}`

So the Clerk proxy is returning the session correctly, but Clerk-JS 6.7.4's in-memory state stays empty. The SDK never hydrates its `client.sessions` array from that `/v1/client` response.

I tried the partial fix from STR-011 (calling `Clerk.client.reload()` and `Clerk.load()` programmatically) — both no-ops. `Clerk.client.reload` doesn't exist on Clerk 6.7.4; `Clerk.load()` is the bootstrap and has already run.

A full page-reload does not recover either. The spinner persists indefinitely.

**In-character thought**: _"I'm signed in — the cookie's there. The server knows who I am. But the app can't figure that out. This is the kind of bug that drives normal people away. I'd email the dev and then forget about this product for a month."_

**Verdict on STR-011 fix**: **INCOMPLETE FIX**. Cycle 1 fix added Clerk listener + pushState hooks + an attempted `Clerk.client.reload()` — but the latter is a no-op in Clerk 6.7.4 (the method doesn't exist). The real fix requires either:

- Downgrading/upgrading to a Clerk version where forcing a client refetch from cookie state works, OR
- A custom `Clerk.updateEnvironment()` flow, OR
- Signing out + signing back in (destroys the user's state), OR
- Fixing the root cause: why does Clerk-JS bootstrap without reading the existing `__session` cookie's session into `client.sessions`?

### Step 4 — Abandon

At 90 seconds of "Loading page," Marcus leaves. That's his threshold.

**In-character thought**: _"Another SaaS that doesn't work. I'll come back in a month and see if they fixed it. Or I won't."_

## Journey Verdict

- **Outcome**: **BLOCKED**
- **Satisfaction**: 0/5 (Marcus never saw the product)
- **Would Recommend**: **no**
- **Delta vs Cycle 1**: **SAME (INCOMPLETE FIX)** — STR-011 fix was a well-intentioned partial that doesn't match Clerk 6.7.4 API; Clerk sessions still empty on nav. Plus a NEW CRITICAL finding (STR-026) on the fly.dev domain.
- **Reasoning**: Marcus never reached a dashboard, never saw a parcel, never ran an AI analysis. None of the fixes that made cycle-1 endpoints work (STR-023/024/025 shipped; chat now 200; counties etc) could be tested because the user can't get past auth. API-level smoke tests confirm those endpoints work when called directly with a minted JWT — but the real user journey is dead at step 1.

### Findings (this run)

- **STR-011** (CRITICAL, **INCOMPLETE FIX** flag) — Clerk sessions-empty-on-nav still reproduces 100% on acreos.io/today after ticket sign-in. `Clerk.client.reload()` is not a real method in Clerk 6.7.4. Fix candidates: use `Clerk.__internal_reloadInitialResources()` if it exists, or investigate why Clerk-JS ignores the `__session` cookie on bootstrap when `/v1/client` returns an active session.
- **NEW-STR-026** (CRITICAL, **NEW FINDING FROM FIX**) — `acreos.fly.dev/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js` returns HTTP 307 to `acreos.io/...`, causing cross-origin blocking when the app is loaded from fly.dev. Either redirect the entire fly.dev host to acreos.io, or serve Clerk JS same-origin on both.

### Implication for cycle 2 re-run

**STR-011 blocks every persona browser run.** Marcus, Dana, Gabriel, Wyatt, Eleanor, Tasha, Ingrid, and James will all fail at step 1 the same way. Running r2-r8 via browser Playwright would produce 7 more identical BLOCKED transcripts.

The productive alternative: verify the shipped endpoint/UX fixes via API-first testing (JWT + CSRF) while flagging STR-011 as the single CRITICAL blocker gating launch. That's what the remainder of this cycle-2 attempt should do.
