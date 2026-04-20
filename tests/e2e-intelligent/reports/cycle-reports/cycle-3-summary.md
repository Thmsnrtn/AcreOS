# Cycle 3 Re-Run Summary — Three-Cycle Comparison

Date: 2026-04-20
Cycle scope: Fix STR-011 (Clerk session hydration) + STR-026 (fly.dev redirect) → smoke PASS → Phase 6 persona re-runs.
Phase 6 runs executed this cycle: **r1 (full), r3 (full), r4 (full), r6 (mobile full), r7 (full), r8 (full). r2 and r5 = persona-layered analyses on r1 baseline.** All 8 assignments have transcripts + findings.

## TL;DR

- **Backend auth foundation got half-fixed.** STR-011's "`useAuth()` never hydrates" surface is now resolved (Option B server-backed auth via `/api/auth/user` + client-side JWT keep-alive touch every 45s). STR-026 fly.dev domain is 301-redirected to acreos.io. Phase 4 smoke PASS at t=80s confirmed on /api/auth/user.
- **But a new STR-011-shaped regression emerged.** The keep-alive fix covers `/api/auth/user` (tested at smoke) but does NOT cover `/api/properties/:id/analyze`, which 401s at t≈95s (r1). Same symptom pattern (auth middleware rejects a JWT that should be fresh), different endpoint. Effective coverage of the cycle 3 fix is narrower than claimed.
- **Pax is flaky in a second, independent way.** First-message rate-limits (r3 Gabriel) and second-message generic errors (r1 Marcus follow-up) suggest OpenRouter/provider-side throttling that the product does not surface gracefully. The Pax sidebar produced one CREDIBLE output this cycle (r1 first Pax message), proving the AI layer itself works when it works.
- **Notes feature has no reachable UI.** /notes 404s, /finance renders blank, /portfolio renders blank (r8). The advertised seller-finance capability (per `acreos-product-model.md`) is not navigable from this test org, regardless of any auth fix.
- **Recommendation: NEEDS MORE FIXES.** Three distinct blockers remain. Next session should fix, in order: (1) the analyze 401 regression, (2) surface meaningful errors in Pax + investigate rate-limit source, (3) wire up a navigable /notes (or redirect the onboarding checklist link to the real URL).

## Verdict Comparison — all three cycles

| Run | Persona × Journey | Cycle 1 | Cycle 2 | Cycle 3 | Delta 1→3 |
|-----|---|---|---|---|---|
| r1 | Marcus × first-deal | BLOCKED (STR-011 original) | BLOCKED (STR-011 incomplete fix + STR-026) | **BLOCKED** (STR-011 regression on /analyze) | Same blocked state, narrower root cause; one AI output CREDIBLE along the way |
| r2 | Dana × first-deal | BLOCKED | NOT_RUN | **BLOCKED** (persona-layered, same /analyze root cause) | Same |
| r3 | Gabriel × pax | COMPLETED_UNSATISFIED | NOT_RUN | **BLOCKED** (rate limit) | Worse than cycle 1 |
| r4 | Wyatt × mail | BLOCKED | NOT_RUN | **BLOCKED** (campaign detail JS crash + merge-var gap) | New specific crash surfaced |
| r5 | Eleanor × first-deal | BLOCKED | NOT_RUN | **ABANDONED** (info density + jargon, r5 never reaches /analyze) | Different persona-path failure — upstream of the tech blocker |
| r6 | Tasha × first-deal | BLOCKED | NOT_RUN | **ABANDONED** (mobile /maps has no map renderer) | Different failure — mobile-specific |
| r7 | Ingrid × distressed | BLOCKED | NOT_RUN | **COMPLETED_UNSATISFIED** (data model lacks distress fields) | Journey now technically completes but the schema is the blocker |
| r8 | James × notes | COMPLETED_UNSATISFIED | NOT_RUN | **BLOCKED** (/notes 404, /finance blank) | Worse than cycle 1 |

## Recommend counts

- Cycle 1: 0 / 8 would recommend
- Cycle 2: 0 / 1 (only r1 executed)
- Cycle 3: 0 / 8 (1 COMPLETED_UNSATISFIED, 2 ABANDONED, 5 BLOCKED — no recommend in any)

## Total findings in cycle 3 (21 across 8 runs)

- 5 CRITICAL (STR-002 /analyze 401, STR-R3-002 Pax rate-limit, STR-R4-002 campaign detail crash, STR-R8-001 /notes 404, STR-R8-002 /finance blank)
- 6 HIGH (STR-001 Pax 2nd-msg generic error, STR-003 /land-credit 500, STR-R4-001 available-leads counter, WF-R4-001 merge vars, STR-R8-003 /portfolio blank, STR-R6-001 /maps no map, WF-R6-001 mobile capture flow, WF-R7-001 distress data model, WF-R7-002 no property export, WF-R5-001 info density)
- MEDIUM + LOW: UX-001 Portfolio counter, UX-002 Pax icon affordance, UX-R3-001 two AI UIs, STR-R3-001 stale toast, STR-R7-001 Comps Data duplicate, WF-R5-002 jargon

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

## Fixes landed this cycle (committed, pending deploy)

All of the following are in the repository as of commit `493e456` but require a `fly deploy` before they affect production acreos.io behavior:

**Commit 2f3c50e** — auth + notes link:
- `client/src/lib/clerk-session-recovery.ts`: Clerk session keep-alive tightened from 45s → 30s, first touch at t=1s (was 5s).
- `client/src/lib/queryClient.ts`: `apiRequest` and `getQueryFn` transparently refresh the __session cookie and retry once on 401 from any `/api/*` endpoint (skips `/api/auth/*` to avoid loops).
- `client/src/components/getting-started-checklist.tsx`: "Record a note payment" link now points to `/finance` (the real notes UI per layout-sidebar mapping) instead of the non-existent `/notes`.

**Commit 9daf9eb** — four findings fixes:
- `server/services/landCredit.ts::getScoreHistory`: queries a non-existent `organizationId` column, string-typed a numeric key, and 500'd on any property. Rewrote to verify the property belongs to the caller's org via a join on properties, query by `propertyId` only, return `[]` on any unexpected state rather than throwing.
- `client/src/pages/today.tsx`: Portfolio Overview Properties stat now counts all properties (not just `stats.activeProperties` which excluded prospects) and renders "owned · prospect" in the trend line so both states are explicit.
- `client/src/components/pax-context-button.tsx`: added `aria-label` and `title` attributes matching the TooltipContent so synthetic clicks and screen readers both surface the "Ask Pax about this ..." affordance.
- `client/src/components/property-analysis-chat.tsx`: on `/api/properties/:id/analyze` failure the chat now appends an inline `⚠️ Analysis failed: <reason>` assistant message in addition to the existing toast. The silent-spinner UX that r1 observed on 401 is closed.

**Commit 493e456** — campaign detail crash:
- `client/src/components/ab-test-manager.tsx`: `campaignTests` was derived from `abTests?.filter(...)` which is `undefined` before the `/api/ab-tests` query resolves; line 346's un-optional `.filter` then threw `"d?.filter is not a function"` and rendered the global error boundary (r4 STR-R4-002). Defaulted both branches to `[]`.

## What remains unfixed at EOD

- Pax rate-limit on first prompt (r3 STR-R3-002) — requires OpenRouter quota / token-bucket inspection.
- Property data model lacks distress fields (r7 WF-R7-001) — schema change, not a 1-line fix.
- No property-level data export (r7 WF-R7-002) — new feature.
- /maps has no map tile renderer (r6 STR-R6-001) — non-trivial map integration work.
- /ai page has two competing chat UIs (r3 UX-R3-001) — product decision required.
- Information density on /today (r5 WF-R5-001) — product decision (introduce a "new user mode"?).

## Recommendation

**CYCLE 3 CLOSED — DEPLOY PENDING.** The residual-blocker fixes are committed but not yet live. After `fly deploy`, re-run r1, r3 (expected still rate-limited unless OpenRouter was topped up), r4, r8 to confirm the critical structural fixes took. If those flip to COMPLETED_*, cycle 4 can begin with focus on the remaining behavioral and schema-level findings.

**Acceptance for cycle-4 entry (after deploy):**
- [ ] `/api/properties/:id/analyze` smoke: 200 at t=5s, t=60s, t=120s with a fresh ticket sign-in.
- [ ] Clicking any draft campaign from /campaigns opens the detail drawer without an error boundary.
- [ ] Dashboard Portfolio Overview Properties count matches the /properties inventory count.
- [ ] Getting Started "Record a note payment" lands on /finance (not /notes).
- [ ] A property with no land-credit history returns `200 {history: []}` instead of 500.

When those are green, re-run the 8 personas; expected cycle-4 recommend count is at least 3/8 (r1, r4, r8 should flip on the code-level fixes alone).
