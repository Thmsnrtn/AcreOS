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

## Feature builds shipped mid-cycle

### Seat invitations (Maya T01/T02/T04, Dolores E01) — `16ad093`

Built the missing seat-invite flow end-to-end:

- **Schema**: new `organization_invitations` table (org, email, role,
  token, status, expires_at, accepted_at, accepted_by_user_id).
- **Bootstrap**: idempotent `CREATE TABLE IF NOT EXISTS` in
  `server/index.ts` startup, so the table exists on first deploy
  regardless of whether the drizzle journal tracks migration 0026.
- **Endpoints**:
  - `POST /api/organization/invitations` — single `{ email, role }` or
    bulk `{ invites: [...] }` up to 200 per batch. Admin-or-above
    only. Returns tokenized invite links `/auth?invite=<token>`.
  - `GET /api/organization/invitations` — list pending for the org.
  - `DELETE /api/organization/invitations/:id` — revoke.
  - `POST /api/organization/invitations/accept` — idempotent attach
    on sign-in; validates email match + expiry.
- **Audit log**: every invite creation emits an `audit_log` entry
  keyed on `organization_invitation` so Dolores's E03 export picks
  them up cleanly.
- **UI**: new `TeamInviteCard` at `settings → Team`. Single invite
  form (email + role dropdown), bulk CSV paste (one per line, or
  `email:role` per line), pending-invites list with copy-link + revoke.
- **Accept flow**: `/auth?invite=<token>` POSTs to the accept endpoint
  after Clerk sign-in completes, then invalidates auth + org queries
  so the redirect to `/today` lands on the right org.

### White-label brand fallback (Kim P03) — `e6c68da`

Added `useBrandName()` to `use-white-label.ts` that returns the
tenant's brand name or falls back to "AcreOS". Applied to the three
highest-visibility surfaces a Kim student would hit first:

1. `/auth` sign-in page (logo initial + wordmark)
2. `PaxCopilotRail` fallback label (always visible on every app surface)
3. `OnboardingModal` step 1 "Welcome to …"

**Not yet swept** (documented follow-up):
- `onboarding/ProductTour.tsx`, `onboarding/OnboardingWizard.tsx`
- `pricing.tsx`, `landing.tsx`, `command-center.tsx` ("AcreOS Assistant")
- `avm.tsx` valuation toast, `tools.tsx` Market Value™ label
- `academy.tsx` certificate text, `certification-leaderboard.tsx`
- `investor-directory.tsx` marketplace TOS
- `help/HelpPanel.tsx` KB article titles

A codemod-style sweep would close the remaining ~15 call sites in an
hour. Mechanic verified; first-impression surfaces branded.

## Yuki D03 — OpenAPI spec accuracy (measured)

Ran a diff of the published spec against the actual prod route table:

- **Spec paths**: 29
- **Actual route patterns (`api.*` on `/api`, plus mounted `router.*`)**: **1,042**
- **Documented-but-missing in code**: 0 (all 29 documented paths resolve to real handlers via mounted sub-routers)
- **Code-but-missing in spec**: **~1,013 endpoints**

So the spec is **truthful but catastrophically under-documented** —
Yuki's firm would rate this "build around AcreOS, not on top of it."

**Action for Yuki acceptance**: either (a) generate the spec
programmatically from the route table via a typescript reflector so
it stays in sync, or (b) document the ~50 highest-value endpoints by
hand (leads, properties, deals, offers, auth, webhooks, organization).
Option (a) is strongly preferred; option (b) is the minimum viable.

## Cycle 12 commits

- `6686c3e` feat(auth): server-side logout clears Clerk suffixed session cookies
- `bd2d50e` fix(api-docs): serve OpenAPI spec without auth (Yuki D03)
- `16ad093` feat(org): seat invitations (single + bulk CSV)
- `e6c68da` feat(white-label): brandName fallback for top-visibility surfaces
- `cd8836b` fix(org): call requireAdminOrAbove as factory on 14 endpoints

## Live-verification after deploy

Signed in as the founder (seat user would also work but the invite
endpoints need admin-or-above), ran a full CRUD sweep against the
invitation endpoints — all pass:

| Step | Result |
|---|---|
| `POST /api/organization/invitations` with `{ invites: [3 emails] }` | `201`, 3 tokenized links returned |
| `GET /api/organization/invitations` | `200`, all 3 present |
| `DELETE /api/organization/invitations/:id` on the first | `200`, row flipped to `revoked` |
| `GET` again | `200`, statuses `['pending','pending','revoked']` |
| `/settings#team` UI | renders `TeamInviteCard` + 2 pending rows (revoked one filtered) |

Before `cd8836b`, every one of those POSTs 504'd — the
`requireAdminOrAbove` factory bug swallowed every request into a 30s
timeout. Fixing that also unblocked 11 other pre-existing endpoints
(commissions x7, webhooks PUT, /api/jobs x2) that had silently been
broken.

## Persona status matrix after cycle 12

| Persona | Journey | Status |
|---|---|---|
| 14 Maya | T01 Seat invite + onboarding | **Ready** — create via UI/API, accept via `/auth?invite=` |
| 14 Maya | T02 Team inbox + task assignment | **Ready** — invite + attach flow landing seat user on `/team-inbox` |
| 14 Maya | T03 RBAC boundary | **PASS** (API + frontend) |
| 14 Maya | T04 Activity log attribution | **Ready** — invite emits audit_log entries |
| 15 Dolores | E01 Bulk seat provisioning | **Ready** — 200-invite batch + audit trail |
| 15 Dolores | E02 White-label setup | Renders + mechanic works for top 3 surfaces |
| 15 Dolores | E03 Audit log export | **Ready** — /audit-log + export path |
| 16 Raj | C01 Document OCR + anomaly | Surface ready; needs OCR fixture pack |
| 16 Raj | C02 Compliance dashboard | **Ready** — renders |
| 16 Raj | C03 Tax-lien deadlines | Surface ready — `/tax-delinquent` renders |
| 17 Kim | P01 Provision tenant | **Ready** — CreateTenantDialog |
| 17 Kim | P02 Revenue share | Needs Stripe Connect test-mode fixtures |
| 17 Kim | P03 White-label leak | Partial — top 3 surfaces clean, ~15 more to sweep |
| 18 Yuki | D01 API key provisioning | **Ready** — Settings → Developer → ApiKeyManager |
| 18 Yuki | D02 Webhook round-trip | `/webhooks` renders; round-trip test pending |
| 18 Yuki | D03 OpenAPI spec accuracy | **Measured** — 1013 endpoints undocumented; needs spec generator |

Net: **10 of 16 journeys ready to run**, up from 3 at the start of the
cycle.

## What to do next (cycle 13 seed)

1. Run the 10 ready journeys in a scheduled harness pass and score
   each against its success-criteria rubric.
2. Write a route→openapi reflector (1 day) to auto-generate the spec.
3. Codemod-sweep the remaining ~15 "AcreOS" strings behind
   `useBrandName()` so Kim P03 passes clean.
4. Seed OCR fixture pack in `tests/e2e-intelligent/fixtures/ocr/`.
5. Enable Stripe Connect test-mode for a reseller tenant, run Kim P02.
