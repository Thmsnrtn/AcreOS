# Cycle 12 Summary — Operator persona runs with a real seat user

**Date:** 2026-04-20
**Scope:** With cycle 11 having verified every founder-protected route
renders for a founder user, cycle 12 builds the missing test
infrastructure needed to actually *exercise* the operator personas 14–18,
then runs each persona journey the infrastructure allows.

## Infrastructure built

### 1. Non-founder seat user

Created Clerk user `user_3Cdakne3QgThmrPTfnkoewIBwPo`
(`thmsnrtn+e2e-seat-20260420@gmail.com`). Fresh Clerk user, not in
`FOUNDER_EMAILS`, auto-gets a brand-new org on first
`getOrCreateOrg`. Used for Maya T03 (RBAC boundary) and Kim P03
(white-label leak preflight).

### 2. Server-side logout endpoint — `6686c3e`

Clerk stamps instance cookies as `__session_<hash>` and
`__client_uat_<hash>` (HttpOnly). The existing client logout was
clearing only the canonical non-suffixed names, so switching users in
the same browser session silently fell back to the previous account —
which is how the initial seat-user sign-in attempt appeared to succeed
but `/api/auth/user` kept returning the founder's email.

Added `POST /api/auth/logout` that `res.clearCookie()`s every
Clerk-prefixed cookie on the request, plus updated `use-auth.ts`
`logout()` to call it before Clerk's own `signOut()`. Now the
browser-side auth switch is deterministic.

### 3. OpenAPI spec unblocked — `bd2d50e`

`/api/docs/openapi.json` was 401-ing because a catch-all
`app.use('/api', isAuthenticated, …, epicServicesRouter)` on line 1099
ran its auth middleware before the docs router mounted at line 1516.
Moved the docs mount above the catch-all. Spec is now served without
auth (Stripe's pattern; Yuki D03 prerequisite).

## Persona journey results

### Maya T03 — RBAC boundary (PASS)

Signed in as the seat user, then exercised 10 founder-only API endpoints
and 8 founder-only route surfaces. Every one of them was blocked:

| Endpoint | Status |
|---|---|
| `/api/admin/dashboard` | `403` |
| `/api/admin/organizations` | `403` |
| `/api/admin/alerts` | `403` |
| `/api/admin/revenue` | `403` |
| `/api/admin/users` | `403` |
| `/api/founder/ai/telemetry` | `403` |
| `/api/founder/ai/stats` | `403` |
| `/api/founder/api-usage` | `403` |
| `/api/founder/executive-dashboard` | `403` |
| `/api/founder/beta-analytics` | `404` (likely typo / unregistered alias — still not a leak) |

Frontend surfaces `/admin/beta`, `/admin/ops`, `/admin/integrations-health`,
`/founder/ai-observatory`, `/founder/v13`, `/sovereign`, `/reseller`,
`/executive-dashboard` all rendered the **"404 — Page Not Found"**
fallback via `FounderProtectedRoute`. No crashes, no data leak, no
silent fall-through.

**Cross-org isolation check:** seat user's `/api/leads`, `/api/properties`,
`/api/deals`, `/api/notes` each returned `0` items. The founder org's
data (3 leads, 2 properties, 1 note) was not visible. `/api/organization`
returned only the seat user's auto-created org. ✅

### Yuki D01 — API key provisioning (partial)

`/settings → Developer` tab exists with the `ApiKeyManager` component
(create / rotate / revoke) + `ActivityLogPanel`. Browser-driven POST to
`/api/organization/api-keys` failed at CSRF/401 owing to the same
session-thrashing I hit throughout cycle 11 — the component works for a
real in-browser user flow but the programmatic sweep needs a
non-browser-session auth path (a preseeded API key or a CSRF-aware
client). Documented as next-cycle work.

### Yuki D03 — OpenAPI spec accuracy (unblocked, deferred)

Before this cycle, `/api/docs/openapi.json` was 401-ing so Yuki couldn't
even load the spec. After `bd2d50e` the spec is served. Diffing the
published spec against the actual route table (the core of D03) is a
>20-minute task against ~200 server routes and is queued for cycle 13.

## Feature gaps surfaced (product work, not bug fixes)

These are **missing features**, not broken ones. Each has an obvious
owner and shape but wasn't cheap enough to build mid-cycle.

### Dolores E01 — Bulk seat invite

The Team tab at `/settings → Team` lists existing members and lets an
owner change their role, but has **no invite UI** — not even for a
single seat — and there's **no `POST /api/organization/members` or
`/api/team/invite` endpoint** on the server. Org membership is only
populated by Clerk sign-up + `getOrCreateOrg`.

For the full Dolores journey we'd need:
- `POST /api/organization/invitations` — email + role, emits an invite
- Invite-accept flow that attaches the invitee to the inviting org
- A CSV bulk-upload variant with column mapping + preview

Estimated: 1–2 days of product work. Opens up Maya T01/T02/T04 runs at
the same time.

### Kim P03 — White-label leak audit

White-label mechanics exist (`useWhiteLabel` hook injects CSS vars,
swaps page title, swaps favicon). But a grep of `client/src` for the
string `"AcreOS"` used in user-visible copy (not import paths) finds
**20+ hardcoded references** — onboarding wizard, product tour, help
panel, pricing page, landing page, command-center, certification
leaderboard, AVM toast, marketplace TOS, academy certificate, etc.

A white-label tenant would still see "AcreOS" leak through those
surfaces. Fix: wrap each user-visible "AcreOS" in `useWhiteLabel()`'s
`brandName` (fall through to "AcreOS" when no tenant config). Needs a
codemod-style sweep; a few hours of work.

### Kim P02 — Stripe Connect reconciliation

Needs real Stripe Connect test-mode payouts to compare against the
reseller MRR dashboard. External fixture, not a code change. Deferred.

### Raj C01 — OCR anomaly fixtures

Document Intelligence page exists and renders; running the journey
requires a canonical stack of PDFs (scanned deeds, title commitments,
tax records) with known anomalies (mineral reservations, easements, HOA
liens) so the AI output can be diffed against expected flags. Fixture
curation work.

## Cycle 12 commits

- `6686c3e` feat(auth): server-side logout clears Clerk suffixed session cookies
- `bd2d50e` fix(api-docs): serve OpenAPI spec without auth (Yuki D03)

## What to do next

1. Build `POST /api/organization/invitations` + invite-accept flow →
   unblocks Maya T01/T02/T04 and Dolores E01 at the same time.
2. Codemod-sweep hardcoded "AcreOS" strings behind
   `useWhiteLabel().brandName` → unblocks Kim P03.
3. Seed an OCR fixture pack in `tests/e2e-intelligent/fixtures/ocr/` →
   unblocks Raj C01.
4. Diff the OpenAPI spec against the prod route table → closes Yuki D03.
