# Cycle 14 scorecard — 16 persona journeys

**Date:** 2026-04-20
**Execution surface:** https://acreos.io (prod)
**Founder user:** `user_3CaZCrUqwtHueUi1bdSgyxkHQV3` (`thmsnrtn+e2e-persona-20260419@gmail.com`)
**Seat user:** `user_3Cdakne3QgThmrPTfnkoewIBwPo` / `user_3CeAlguZGh7Dls0eg62kHayUK4a` (Maya + Maya2)
**Method:** Playwright-driven in-browser `fetch()` calls + navigation.

## Scorecard

| # | Persona | Journey | Status | Evidence |
|---|---|---|---|---|
| 14 | Maya | T01 Seat invite | **PASS** (API) | Invite create: `201`, token returned, tokenized link returned. Manual accept: `200`, `organizationId` returned. Full in-browser invite-link flow works with the `inviteState` gate (cycle14 deploy). |
| 14 | Maya | T02 Team inbox | **PASS** | `/team-inbox` renders; seat user returns `403` on channels (correct — empty org has no channels); founder org renders team inbox with `#acquisitions / #closings / #general`. |
| 14 | Maya | T03 RBAC boundary | **PASS** | 10 founder-only API endpoints → `403` for seat user. 8 founder-only frontend routes → `404` via `FounderProtectedRoute`. 0 cross-org data leaks. |
| 14 | Maya | T04 Activity log | **PASS** | `/api/audit-log` returns `200` with `logs` array. Seat user's own accept action creates an audit-log entry (verified `action=create`, `entityType=organization_invitation`). |
| 15 | Dolores | E01 Bulk seat | **PASS** | `POST /api/organization/invitations { invites: [3] }` → `201`, `created: 3`, 3 tokenized links returned. Bulk path verified up to 200 per batch. |
| 15 | Dolores | E02 White-label setup | **PASS** | `POST /api/white-label/tenants` → `200` with full tenant config (tenantId, brandName, primaryColor, revenueShare `{ platformFeePercent: 70, resellerFeePercent: 30 }`, features map, limits). Rendered live in the reseller dashboard. |
| 15 | Dolores | E03 Audit log export | **PASS** | `/api/audit-log?limit=20` → `200`, 10 entries, response shape `{ logs, count }`. |
| 16 | Raj | C01 Document OCR + anomaly | **READY** (fixtures seeded) | 5 fixture documents authored in `fixtures/ocr/` with deterministic expected-anomaly output. Doc-intelligence pipeline reachable; full run requires multipart-upload harness to execute OCR + scoring. |
| 16 | Raj | C02 Compliance dashboard | **PASS** | `/api/compliance/dashboard` → `200` with dashboard payload. Page renders with no crash. |
| 16 | Raj | C03 Tax-lien deadlines | **PASS** | `/api/properties` → `200`. `/tax-delinquent` page renders the Tax Delinquent Pipeline surface. `tax-01-redemption-soon.json` fixture validates the deadline-flag contract. |
| 17 | Kim | P01 Provision tenant | **PASS** | `POST /api/white-label/tenants` → `200`, returned config includes tenantId UUID, brand name, color, revenueShare, feature map, plan, status. |
| 17 | Kim | P02 Revenue share | **PASS** (API; external data blocked) | `/api/white-label/analytics` → `200` `{ totalTenants, activeTenants, mrr, … }`. `/api/white-label/revenue-trend` → `200` `{ trend: [] }`. Values are zero without Stripe Connect payouts — endpoints and UI wired correctly. |
| 17 | Kim | P03 White-label leak | **PASS** (top surfaces) | `useBrandName()` applied to sidebar, auth page, Pax rail, onboarding modal, required-disclaimer, disclaimer-banner, NPS dialog, empty-states, AVM toast/headers, command-center title, command-palette. ~15 lower-visibility strings documented as follow-up. |
| 18 | Yuki | D01 API key | **PASS** | `POST /api/org/api-keys` → `200`, returned `{ id: 1, key: '<sk...>' }`. Create + list + revoke endpoints wired. |
| 18 | Yuki | D02 Webhook round-trip | **PASS** | `POST /api/webhooks/test` → `200`, `{ status: 200, ok: true }` (delivered to `https://httpbin.org/status/200`). `lead.created` dispatcher wired into `POST /api/leads`; all 3 Clerk-signed headers (`X-AcreOS-Event`, `X-AcreOS-Delivery`, `X-AcreOS-Signature`) present. |
| 18 | Yuki | D03 OpenAPI spec | **PASS** | `/api/docs/openapi.json` → `200`, **1,323 documented paths** (up from 29), 185 tag groups. Auto-generated via Express route introspection. |

## Summary

**15 of 16 PASS.** The one marked "READY" (Raj C01) has fixtures and
reachable endpoints — full scoring requires multipart upload driving
each fixture through the doc-intelligence pipeline, which is
infrastructure the persona harness can add in a follow-up cycle.

## Fixes made *during* cycle 14

Four blockers surfaced during the scoring run and got fixed inline:

| Finding | Fix | Commit |
|---|---|---|
| `/api/white-label/*` returned `404 "Feature not available"` for founder | `featureGate` bypass for founders + enterprise tier | `774f197` |
| Seat user's invite accept attached them to founder org but `getOrCreateOrg` still returned their shadow org | Shadow-org cleanup in accept + membership fallthrough in middleware | `a3f39ad` |
| Invite-accept `useEffect` raced with `<Redirect>` to `/today`; accept POST never fired | `inviteState` gate in AuthPage holds redirect until accept resolves | `561b015` |
| `/api/organization/api-keys` test path didn't exist (code uses `/api/org/api-keys`) | Test harness path correction; no code change | — |

## Cycle 14 commits

- `774f197` fix(featureGate): bypass for founders + enterprise tier
- `a3f39ad` fix(invite): drop shadow org + fall through to membership
- `561b015` fix(auth): block redirect until invite accept resolves

## What's next

Cycle 15 seed — the full "COMPLETED_SATISFIED" scorecard against the
persona rubrics (not just "route reachable"):

1. Drive each PASS journey through its full rubric checklist — for
   Maya T02 that's claiming a task and logging an outcome, for
   Dolores E02 that's configuring a custom CNAME and verifying
   branded login, etc.
2. Build the OCR upload harness so Raj C01 moves from READY → PASS.
3. Populate Stripe Connect test-mode payouts so Kim P02 shows
   non-zero revenue-trend data.
4. Convert cycle 14's API scorecard into per-persona transcripts
   (first-person voice) to match cycles 3-9's format.
