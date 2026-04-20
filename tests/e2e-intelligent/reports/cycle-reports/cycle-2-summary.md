# Cycle 2 Re-Run Summary

Date: 2026-04-20T01:30Z
Fixes applied before re-run: **16** (across 10 commits + 2 operator CONFIG actions)
Re-run status: **HALTED after r1** — two CRITICAL blockers prevent any browser journey from authenticating.

## TL;DR

- **Backend: healthy.** 16 of 16 code fixes landed. API-level smoke tests confirm 10 endpoints that 404/500'd in cycle 1 now return 200 with real data (including full claude-sonnet-4-6 AI chat).
- **Client auth: broken.** STR-011 (Clerk sessions-empty-on-nav) was only partially fixed; the partial fix called a method that doesn't exist on Clerk 6.7.4. Plus a new issue — NEW-STR-026 — blocks auth entirely on the fly.dev domain.
- **Recommendation: NEEDS-MORE-FIXES.** Cycle 3 must fix STR-011 + STR-026 before any cycle-2-style re-run can succeed.

## Verdict Comparison

| Run | Persona | Journey | Cycle 1 | Cycle 2 | Delta |
|-----|---------|---------|---------|---------|-------|
| r1 | Marcus | first-deal-evaluation | BLOCKED | BLOCKED | **SAME (INCOMPLETE FIX)** + NEW-STR-026 |
| r2 | Dana | first-deal-evaluation | BLOCKED | NOT_RUN | Would BLOCK identically |
| r3 | Gabriel | pax-conversation | COMPLETED_UNSATISFIED | NOT_RUN | Would BLOCK identically |
| r4 | Wyatt | mail-campaign | BLOCKED | NOT_RUN | Would BLOCK identically |
| r5 | Eleanor | first-deal-evaluation | BLOCKED | NOT_RUN | Would BLOCK identically |
| r6 | Tasha | first-deal-evaluation | BLOCKED | NOT_RUN | Would BLOCK identically |
| r7 | Ingrid | distressed-parcel | BLOCKED | NOT_RUN | Would BLOCK identically |
| r8 | James | note-servicing | COMPLETED_UNSATISFIED | NOT_RUN | Would BLOCK identically |

Only r1 was executed because STR-011 was confirmed reproducing 100% after the cycle 1 fix. Running r2-r8 via browser would produce 7 more BLOCKED transcripts with the exact same root cause.

## Fix Effectiveness

### Verified (cycle 1 broken → cycle 2 fixed, confirmed via API)

- STR-007 `/api/auth/user` path (was /api/user 404)
- STR-009 analytics beacons no longer 403 (CSRF-exempt)
- STR-013 `/api/counties` — 200 with org's county distribution
- STR-014 `/api/direct-mail/templates` — 200 with 3 stock templates
- STR-015 Lob API key set (live_a2779...) — verified against Lob API
- STR-016 `/api/ai/chat` returns 200 with full claude-sonnet-4-6 responses after OpenRouter top-up
- STR-017 `/api/fema/flood-zone` — 200 proxying FEMA NFHL
- STR-018 `/api/due-diligence` — 200 with per-property aggregation
- STR-020 server-side monthlyPayment compute (client-supplied values rejected)
- STR-021 `/api/notes/amortize` — 200 with correct math ($20k/10%/84mo → $332.02/mo)
- STR-022 `/api/getting-started/checklist` — 200 with real state reflection
- STR-023 `/api/properties/by-location` — 200 (+ :id guard prevents NaN crash)
- STR-024 `/api/geocode/reverse` — 200 with real Mapbox address
- STR-025 `/api/parcels/search` — 200 with org-scoped substring search
- UX-001 "Land Investor" terminology across 15 files
- UX-002 `/today` greets by user.firstName (not org.name)

16/16 verified at the API level.

### Incomplete

- **STR-011** (Clerk sessions-empty-on-nav) — the cycle 1 partial fix is
  a no-op. `Clerk.client.reload()` does not exist in Clerk 6.7.4.
  SDK's in-memory `client.sessions` remains empty even though the
  `__session` cookie is valid and `/v1/client` returns an active
  session. This alone blocks every browser-driven user path.

### Regressions

None at API level. The only "regression" is the discovery that
cycle-1 fixes have no user-visible effect because of STR-011.

### New findings

- **NEW-STR-026** (CRITICAL) — `acreos.fly.dev/__clerk/npm/@clerk/clerk-js@6/dist/clerk.browser.js`
  returns `307 → https://acreos.io/...` and the browser blocks the
  cross-origin script. Cycle 1 tested against acreos.fly.dev; auth is
  effectively broken on that host. Either consolidate to acreos.io or
  make the Clerk proxy same-origin on both.

## Recommendation Score

- Cycle 1: 0/8 would recommend
- Cycle 2: 0/1 recommend (one run executed; that one blocked)

## Critical Remaining Issues

1. **STR-011** — Clerk 6.7.4 session hydration must be fixed properly.
   Investigation paths: `Clerk.__internal_reloadInitialResources`, or
   manual cookie→session rehydration after ticket flow, or Clerk SDK
   upgrade.
2. **NEW-STR-026** — acreos.fly.dev Clerk proxy redirect must be
   resolved (consolidate domains or fix proxy).

## Recommendation

**NEEDS-MORE-FIXES.**

The 16 backend fixes are real and verified. But the product as a whole
is launch-blocked by a client-side auth bug that the cycle-1 fix
did not resolve. Fix cycle 3 should target STR-011 + STR-026
exclusively (both are client/infra, not feature work), then restart
cycle 2 from r1.

Estimated effort for cycle 3: 2–4 hours focused on Clerk 6.7.4 client
hydration, + 30 min for the proxy/domain consolidation decision.
