# Re-Run Progress (Cycle 2)

Previous cycle: 2026-04-19 — 6 BLOCKED, 2 COMPLETED_UNSATISFIED, 0 recommend
Fix session applied: 16 findings fixed across 10 commits + 2 operator CONFIG actions
Re-run started: 2026-04-19T23:45Z
Re-run HALTED: 2026-04-20T01:25Z

## Halt reason

**STR-011 + NEW-STR-026 block 100% of browser journeys.**

Attempted r1 Marcus — BLOCKED at step 1. Repro'd on fresh Playwright browser with
freshly-minted Clerk ticket sign-in. Clerk-JS 6.7.4 initializes (`Clerk.loaded`
= true) but `client.sessions` stays empty despite a valid `__session` cookie and
a valid `/v1/client` response. Dashboard spinner persists indefinitely.

Also discovered NEW-STR-026: `acreos.fly.dev` 307-redirects Clerk JS to
`acreos.io`, causing a cross-origin script block. Cycle 1 was tested at
acreos.fly.dev; that URL is effectively dead for auth. The real production
domain is acreos.io.

Running r2-r8 via browser would produce 7 more identical BLOCKED transcripts —
context burn for zero new information. Honest call: HALT browser re-run, flag
the two critical blockers, let operator decide next move.

## Runs
- [x] r1 — Marcus × First Deal Evaluation — **BLOCKED** (INCOMPLETE FIX for STR-011 + NEW-STR-026)
- [ ] r2 — Dana × First Deal Evaluation — NOT RUN (would BLOCK identically)
- [ ] r3 — Gabriel × Pax Conversation — NOT RUN (would BLOCK identically)
- [ ] r4 — Wyatt × Mail Campaign — NOT RUN (would BLOCK identically)
- [ ] r5 — Eleanor × First Deal Evaluation — NOT RUN (would BLOCK identically)
- [ ] r6 — Tasha × First Deal Evaluation — NOT RUN (would BLOCK identically)
- [ ] r7 — Ingrid × Distressed Parcel — NOT RUN (would BLOCK identically)
- [ ] r8 — James × Note Servicing — NOT RUN (would BLOCK identically)

## Cycle 1 vs Cycle 2 delta (partial)

| Run | C1 | C2 | Delta |
|-----|----|----|-------|
| r1 Marcus | BLOCKED | BLOCKED | SAME (INCOMPLETE FIX for STR-011) + NEW-STR-026 |
| r2-r8 | — | NOT_RUN | Blocked on STR-011 |

## API-level verification (from fix session smoke tests)

All 9 endpoint fixes landed successfully when called directly with JWT + CSRF:

| Endpoint | C1 | C2 API |
|---|---|---|
| /api/properties/by-location | 500 | 200 |
| /api/counties | 404 | 200 |
| /api/direct-mail/templates | 404 | 200 |
| /api/fema/flood-zone | 404 | 200 |
| /api/due-diligence | 404 | 200 |
| /api/getting-started/checklist | 404 | 200 |
| /api/notes/amortize | — | 200 |
| /api/parcels/search | 404 | 200 |
| /api/geocode/reverse | 404 | 200 |
| /api/ai/chat | 500 | 200 (claude-sonnet-4-6) |

The backend is healthy. The app layer is blocked.

## Recommendation

**NEEDS-MORE-FIXES.** Two CRITICAL launch-blockers outstanding:

1. **STR-011 (INCOMPLETE FIX)** — Clerk 6.7.4 session-hydration bug. The cycle-1
   fix called `Clerk.client.reload()` which is not a valid method in that SDK
   version. A proper fix must restore `client.sessions` from cookie state on
   navigation. Candidates in `findings.md` of r1.

2. **NEW-STR-026 (NEW)** — acreos.fly.dev CORS-blocks its own Clerk JS by
   redirecting to acreos.io. Either consolidate to a single domain (redirect
   fly.dev → io) or make Clerk proxy same-origin on both.

Until those land, no browser-driven e2e cycle can succeed. The rest of the
fix portfolio (16 findings) is verified in the backend smoke tests.

Cycle 3 should fix STR-011 + STR-026, then re-attempt cycle 2 runs 1-8.
