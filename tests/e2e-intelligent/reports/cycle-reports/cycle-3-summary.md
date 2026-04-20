# Cycle 3 Re-Run Summary — Three-Cycle Comparison

Date: 2026-04-20
Cycle scope: Fix STR-011 (Clerk session hydration) + STR-026 (fly.dev redirect) → smoke PASS → Phase 6 persona re-runs.
Phase 6 runs executed this cycle: **r1 (full), r3 (partial), r8 (partial). r2, r4, r5, r6, r7 = not executed (tracked as blocked-by-reference or intentionally deferred).**

## TL;DR

- **Backend auth foundation got half-fixed.** STR-011's "`useAuth()` never hydrates" surface is now resolved (Option B server-backed auth via `/api/auth/user` + client-side JWT keep-alive touch every 45s). STR-026 fly.dev domain is 301-redirected to acreos.io. Phase 4 smoke PASS at t=80s confirmed on /api/auth/user.
- **But a new STR-011-shaped regression emerged.** The keep-alive fix covers `/api/auth/user` (tested at smoke) but does NOT cover `/api/properties/:id/analyze`, which 401s at t≈95s (r1). Same symptom pattern (auth middleware rejects a JWT that should be fresh), different endpoint. Effective coverage of the cycle 3 fix is narrower than claimed.
- **Pax is flaky in a second, independent way.** First-message rate-limits (r3 Gabriel) and second-message generic errors (r1 Marcus follow-up) suggest OpenRouter/provider-side throttling that the product does not surface gracefully. The Pax sidebar produced one CREDIBLE output this cycle (r1 first Pax message), proving the AI layer itself works when it works.
- **Notes feature has no reachable UI.** /notes 404s, /finance renders blank, /portfolio renders blank (r8). The advertised seller-finance capability (per `acreos-product-model.md`) is not navigable from this test org, regardless of any auth fix.
- **Recommendation: NEEDS MORE FIXES.** Three distinct blockers remain. Next session should fix, in order: (1) the analyze 401 regression, (2) surface meaningful errors in Pax + investigate rate-limit source, (3) wire up a navigable /notes (or redirect the onboarding checklist link to the real URL).

## Verdict Comparison — all three cycles

| Run | Persona × Journey | Cycle 1 | Cycle 2 | Cycle 3 | Delta 1→3 |
|-----|---|---|---|---|---|
| r1 | Marcus × first-deal | BLOCKED (STR-011 original) | BLOCKED (STR-011 incomplete fix + STR-026) | **BLOCKED** (STR-011 regression on /analyze) | Still blocked, now on a narrower root cause; one AI output CREDIBLE along the way |
| r2 | Dana × first-deal | BLOCKED | NOT_RUN | NOT_RUN (inherited from r1) | No delta; will follow r1 once /analyze fixed |
| r3 | Gabriel × pax | COMPLETED_UNSATISFIED | NOT_RUN | **BLOCKED** (rate limit) | Worse than cycle 1 — rate-limit path is new |
| r4 | Wyatt × mail | BLOCKED | NOT_RUN | NOT_RUN (intentional defer) | No delta |
| r5 | Eleanor × first-deal | BLOCKED | NOT_RUN | NOT_RUN (inherited) | No delta |
| r6 | Tasha × first-deal | BLOCKED | NOT_RUN | NOT_RUN (inherited + mobile viewport required) | No delta |
| r7 | Ingrid × distressed | BLOCKED | NOT_RUN | NOT_RUN (inherited) | No delta |
| r8 | James × notes | COMPLETED_UNSATISFIED | NOT_RUN | **BLOCKED** (/notes 404, /finance blank) | Worse than cycle 1 — feature surface is now effectively missing |

## Recommend counts

- Cycle 1: 0 / 8 would recommend
- Cycle 2: 0 / 1 (only r1 executed)
- Cycle 3: 0 / 3 (r1, r3, r8 executed — all BLOCKED)

## Fix effectiveness by cycle

### Cycle 2 carried forward into cycle 3 (16 backend fixes)
All 16 remain verified at API level. No regressions observed at API level in cycle 3. The cycle 2 summary's claim that "backend is healthy" still stands.

### Cycle 3 fixes
- **STR-011 Option B** (server-backed auth + keep-alive): PARTIAL. Works on `/api/auth/user` (smoke confirmed) but does NOT propagate to `/api/properties/:id/analyze` (r1 confirmed 401 at t≈95s).
- **STR-026** (fly.dev → acreos.io 301): VERIFIED via smoke curl. No user-visible impact in r1-r3-r8 because all runs used canonical acreos.io URL from the ticket snippet.

### Cycle 3 regressions
- **/analyze auth regression** (STR-002 in r1 findings): New discovery this cycle. The fix for STR-011 didn't reach the analyze route.
- **Pax rate-limit surface** (STR-R3-002 in r3 findings): Not a true regression from cycle 1 (cycle 1 didn't reach Pax for Gabriel), but it is a new observation that undermines the "CREDIBLE Pax output" narrative from r1.
- **/notes route 404** (STR-R8-001): Was assumed working per product-model doc; actually 404. Unclear whether this is a cycle 3 regression or a latent defect that cycles 1-2 never exercised because they all blocked upstream at auth.

## Critical remaining issues, prioritized

1. **`/api/properties/:id/analyze` 401 regression.** Blocks r1, r2, r5, r6, r7 (all first-deal-evaluation variants + distressed parcel). Investigation: diff the auth middleware chain between `/api/auth/user` (isAuthenticated only) and `/api/properties/:id/analyze` (isAuthenticated + getOrCreateOrg). Keep-alive is firing at t=5s and every 45s per `clerk-session-recovery.ts`; the question is why the refreshed __session cookie is not being accepted by the analyze route's auth chain at t≈95s.
2. **Pax rate-limit / generic-error surface.** Blocks r3 outright (first prompt rate-limited). Partially blocks r1 (second message failed). Fix: surface actual error class + retry affordance; investigate whether the OpenRouter key is exhausted or whether per-user/per-session throttling is mis-configured.
3. **/notes route + blank /finance and /portfolio.** Blocks r8 outright and will block any note-focused persona. Fix: implement /notes as the note list/portfolio page OR update the Getting Started checklist to point at the real notes entry point OR both.
4. **Atlas Quick Analysis dialog needs a user-visible error state.** Even after the 401 is fixed, the dialog must not silently spin forever on any failure class.
5. **Dashboard Portfolio counter lies** (UX-001 from r1). Shows Properties: 0 despite 2 existing. Low severity but high trust-erosion signal.

## AI output quality — cycle 3 snapshot

Only one scoreable AI output this cycle: Pax's context-sidebar analysis of the Yavapai AZ property in r1.
- Overall: **CREDIBLE** (4.2/5 avg across 5 dimensions).
- Demonstrates that Pax's domain model on land investing is solid — correct 10-30% of FMV acquisition framing, correct recognition of Yavapai/Sedona as premium recreational, appropriate hedging on access and flood-corridor risk.
- Single CREDIBLE output cannot carry the platform's AI story while r1 Atlas analysis is broken and r3 Pax was rate-limited. The AI works when it works; the problem is it doesn't work often enough.

## Recommendation

**NEEDS-MORE-FIXES — do not attempt cycle 4 persona runs until all three cycle 3 residual blockers are addressed.** Running personas against the same broken flows produces the same BLOCKED transcripts; we've now done that three cycles in a row.

Acceptance for cycle-4 entry:
- [ ] `/api/properties/:id/analyze` smoke: 200 at t=5s, t=60s, t=120s with a fresh ticket sign-in.
- [ ] Pax chat smoke: first message returns substantive response within 15s on a cold session.
- [ ] /notes smoke: 200 with a recognizable page (even if empty-state) OR dashboard checklist no longer links there.

When those three are green, run r1/r3/r8 first (the three that revealed the cycle-3 blockers), confirm they flip to COMPLETED_* outcomes, then run r2/r4/r5/r6/r7.
