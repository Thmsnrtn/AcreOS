# Cycle 3 Re-Run Progress

Previous cycles:
- Cycle 1 (2026-04-19 v1): 6 BLOCKED, 2 COMPLETED_UNSATISFIED, 0 recommend
- Cycle 2 (2026-04-19 v2): 1/8 executed (r1 BLOCKED on STR-011/026), 7 not run

Fixes applied before Cycle 3:
- STR-011 (partial): Clerk session hydration corrected for SDK 6.7.4 + Option B server-backed auth + JWT keep-alive via periodic touch every 45s. Verified at t=80s on `/api/auth/user` during smoke.
- STR-026: Canonical URL `https://acreos.io`; fly.dev 301-redirects.
- Plus all 16 prior fixes from the full-fix session.

Cycle 3 execution started: 2026-04-20
Canonical URL for runs: `https://acreos.io`

## Runs

- [x] r1 — Marcus × First Deal Evaluation (v3) — **BLOCKED** — `2026-04-19-r1-marcus-first-deal-v3`
  - **Root cause**: New STR-011 regression — `POST /api/properties/:id/analyze` returns 401 at t≈95s post-sign-in despite the keep-alive fix that was verified on `/api/auth/user` at t=80s.
  - **Positive finding**: Pax context-sidebar path produced a CREDIBLE (4.2/5) land-analysis output; the AI layer itself works on the happy path.
  - **5 findings**: 1 CRITICAL (STR-002 analyze 401), 2 HIGH (STR-001 Pax 2nd-msg error, STR-003 /land-credit 500), 2 MEDIUM (UX-001 Properties counter, UX-002 Pax-icon affordance).
- [ ] r2 — Dana × First Deal Evaluation (v3) — `2026-04-19-r2-dana-first-deal-v3` — **blocked on same root cause as r1** until `/analyze` auth is fixed
- [ ] r3 — Gabriel × Pax Conversation (v3) — `2026-04-19-r3-gabriel-pax-v3` — Pax side panel works; this run might still be executable since Pax path produced CREDIBLE output, BUT second-message failure (STR-001) may recur
- [ ] r4 — Wyatt × Mail Campaign (v3) — `2026-04-19-r4-wyatt-mail-v3` — likely blocked if campaigns endpoints share auth behavior with /analyze
- [ ] r5 — Eleanor × First Deal Evaluation (v3) — `2026-04-19-r5-eleanor-first-deal-v3` — blocked same as r2
- [ ] r6 — Tasha × First Deal Evaluation (v3) — `2026-04-19-r6-tasha-first-deal-v3` — blocked same as r2
- [ ] r7 — Ingrid × Distressed Parcel (v3) — `2026-04-19-r7-ingrid-distressed-v3` — blocked if /analyze required
- [ ] r8 — James × Note Servicing (v3) — `2026-04-19-r8-james-note-v3` — different flow; unknown coverage

## Assignment Matrix

| # | Persona File | Journey File | Run ID |
|---|---|---|---|
| 1 | 01-new-to-land-suburban | 01-first-deal-evaluation | 2026-04-19-r1-marcus-first-deal-v3 |
| 2 | 02-experienced-wholesaler-rural | 01-first-deal-evaluation | 2026-04-19-r2-dana-first-deal-v3 |
| 3 | 11-skeptical-of-ai | 07-pax-conversation-strategy | 2026-04-19-r3-gabriel-pax-v3 |
| 4 | 09-land-academy-style | 02-mail-campaign-to-county | 2026-04-19-r4-wyatt-mail-v3 |
| 5 | 08-retiree-small-budget | 01-first-deal-evaluation | 2026-04-19-r5-eleanor-first-deal-v3 |
| 6 | 10-mobile-only-driving-for-dollars | 01-first-deal-evaluation | 2026-04-19-r6-tasha-first-deal-v3 |
| 7 | 12-data-heavy-analyst | 03-analyze-distressed-parcel | 2026-04-19-r7-ingrid-distressed-v3 |
| 8 | 05-note-investor-seller-finance | 04-note-servicing-setup | 2026-04-19-r8-james-note-v3 |

## Recommended Next-Session Action

Fix the `/api/properties/:id/analyze` 401 regression BEFORE continuing r2-r8. If the same session-touch middleware applies uniformly, `r2`, `r5`, `r6` (all first-deal-evaluation) will block on the same cause. See findings.md in `2026-04-19-r1-marcus-first-deal-v3/` for evidence and repro.
