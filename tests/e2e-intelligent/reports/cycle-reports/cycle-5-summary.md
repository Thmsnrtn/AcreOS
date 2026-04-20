# Cycle 5 Summary — next 8 personas against the cycle-4 deployed product

Date: 2026-04-20
Scope: After cycle-4 fix deploy (commits `2f3c50e` through `c0f3741`, 10 total), run 4 new personas and 4 new journeys to verify fixes and surface net-new findings.

## TL;DR

- **First COMPLETED_SATISFIED outcome across all cycles (r1 Robert × distressed).** Distress schema + inline UI shipped and rendered live — 4 years delinquent / $3,200 total payoff / Cochise County Treasurer source displayed correctly.
- **1 regression caught and hotfixed live** (`AlertTriangle` missing import after the distress-section addition crashed /properties initially; commit `c0f3741`).
- **Merge variable expansion verified live** on /campaigns (all 12 variables + formula example visible).
- **3 fully new persona-journey verdicts, 5 partial/inferred.** Some deep-flow journeys (portfolio import at 500-row scale, skip-trace at 100-record batch, pipeline drag-drop, Stripe checkout) deferred to cycle 6 — they need seeded test data or live provider credentials that weren't set up for cycle 5.

## Cycle-5 verdicts

| # | Run | Journey | Verdict | Notes |
|---|---|---|---|---|
| 1 | Robert × distressed | 03 | **COMPLETED_SATISFIED** (4/5) | First "yes" recommend across all cycles |
| 2 | Priya × distressed | 03 | COMPLETED_UNSATISFIED (3/5) | Distress base is great; missing AZ lien lifecycle fields |
| 3 | Sofia × distressed | 03 | COMPLETED_UNSATISFIED (3/5) | International buyer: needs state-by-state legal primer from Atlas |
| 4 | Ty × mail | 02 | COMPLETED_UNSATISFIED (3/5) | Up from BLOCKED in cycle 3; merge vars unlocked; formula editor + list picker still gaps |
| 5 | Ty × portfolio-import | 05 | Unverified partial | Foundation exists; 500-row exercise parked for cycle 6 |
| 6 | Priya × skip-trace | 06 | Unverified | Needs live BatchData credentials |
| 7 | Marcus × pipeline | 09 | Unverified partial | /deals reachable post-auth-fix; drag-drop not exercised |
| 8 | Sofia × settings | 10 | Unverified | Stripe live actions not in test scope |

**Recommend count (cycle 5): 1 yes, 3 not_yet, 4 unverified.**

Across cycles: cycle 1 = 0/8, cycle 2 = 0/1, cycle 3 = 0/8, cycle 4 = 2/8 (projected), **cycle 5 = 1/3 explicit COMPLETED_* (first "yes" ever).**

## Net-new findings this cycle

- **WF-R2-CYC5-001 MEDIUM**: Distress schema lacks AZ lien lifecycle (lien-sold-date, lien-holder, redemption-deadline) and tax-deed auction fields. Matters for tax-delinquent-specialist personas.
- **WF-R3-CYC5-002 MEDIUM**: Atlas system prompt doesn't include state-by-state tax-lien/tax-deed lifecycle summary (AZ has 3yr redemption, TX has tax-deed auction, etc.). Extension of cycle-4 prompt work.
- **WF-R3-CYC5-001 LOW**: No currency/FX toggle for non-USD buyers (Sofia).
- **WF-R4-CYC5-001 MEDIUM**: Campaign merge-variable set is documented (12 fields) but no UI-level formula editor to compute {{offerAmount}} per-row at upload time. Users must bake it into their CSV.
- **WF-R4-CYC5-002 MEDIUM**: Create Campaign still lacks an inline list/recipient picker. Ty had to import leads via /leads first.
- **WF-R8-CYC5-001 LOW**: No VAT/FX display on Stripe billing surface.
- **Regression caught in-session**: `c0f3741` hotfix for AlertTriangle import.

## Fixes verified live in this cycle

- Distress Indicators section on property detail (WF-R7-001) — rendered with full data
- Copy JSON button (WF-R7-002) — present
- Portfolio counter (UX-001) — accurate
- Low-balance banner suppression (r4 observation) — verified absent
- Campaign detail no longer crashes /campaigns (STR-R4-002) — contained by ErrorBoundary; detail drawer works
- Merge variable expansion (WF-R4-001) — all 12 visible
- `$0` → `—` display on property cards (r5 WF-R5-002) — verified
- Jargon tooltips (WF-R5-002) — on APN + status
- /ai dual UI consolidation (UX-R3-001) — rail hidden on /ai
- AI rate limit 30 → 120/min (STR-R3-002) — code change verified
- `/api/auth/user` 401 retry (cycle-4 post-deploy issue) — route changes no longer 401-stall

## Open for cycle 6

Priority 1 (persona unblock):
- Distress lien/auction lifecycle fields (WF-R2-CYC5-001)
- State-by-state legal primer in Atlas prompt (WF-R3-CYC5-002)

Priority 2 (scale flow):
- Seed a 500-row CSV in the test org; run r5 Ty portfolio import end-to-end
- Seed a 100-record tax-delinquent cohort; run r6 Priya skip-trace
- Exercise r7 Marcus pipeline drag-drop with a seeded deal

Priority 3 (feature depth):
- Formula editor UI for merge variables (WF-R4-CYC5-001)
- Inline list picker in Create Campaign dialog (WF-R4-CYC5-002)
- FX/VAT display for international billing (WF-R3/R8-CYC5-001)

Priority 4 (still open from earlier cycles):
- /maps tile renderer (STR-R6-001)
- /today info density / new-user mode (WF-R5-001)
- Mobile capture flow (WF-R6-001)
- Free-text description → structured fields (r7 schema)
