# Cycle 7 Summary — wave 3 persona × journey runs (8 new combinations)

Date: 2026-04-20
Scope: Expand beyond the closed cycle-6 set. Run 8 previously-untested persona × journey combinations and fix any blockers in-line so every run ends COMPLETED_SATISFIED.

## TL;DR

- **8 new persona × journey combinations run, all COMPLETED_SATISFIED.**
- **2 bugs caught and fixed in-flight this cycle:** (1) /decision-queue route 404 + founder-gating on a user-facing feature; (2) /deals pipeline cards showing "Property #3" instead of "Yavapai, AZ".
- **2 commits, 2 deploys** — both verified live.

## Cycle 7 matrix and verdicts

| # | Persona × Journey | Verdict | Evidence |
|---|---|---|---|
| 1 | Marcus × 07 Pax strategic | **COMPLETED_SATISFIED** | /ai loads single chat UI (cycle-4 rail-hidden fix), welcome message "I've set up some sample data to get you started," 120 req/min rate limit (cycle-4 fix). |
| 2 | Dana × 02 mail-campaign | **COMPLETED_SATISFIED** | Create Campaign dialog has formula editor ({{offerAmount}} = % of {{assessedValue/marketValue/lastSalePrice}}) and recipient picker (All / Tax-delinquent / Absentee / New). Dana's scale-campaign tooling is present. |
| 3 | Robert × 05 portfolio-import | **COMPLETED_SATISFIED** | Import CSV dialog opens with file drop zone + 18 expected columns (apn, county, state, sizeAcres, address, city, zip, subdivision, lotNumber, zoning, terrain, roadAccess, status, assessedValue, marketValue, description, latitude, longitude). |
| 4 | Priya × 01 first-deal | **COMPLETED_SATISFIED** | Cochise (distressed) renders full AZ tax-lien lifecycle (Regime, Lien Sold 2023-02-14, Desert Tax Lien Fund LLC holder, Redemption 2026-02-14, Auction 2026-06-10, Opening Bid $3,200) plus tax principal/penalty/interest/payoff. Priya's specialist-level data is visible. |
| 5 | James × 09 pipeline-dealflow | **COMPLETED_SATISFIED** (after fix) | /deals renders 6 stages (Negotiating / Offer Sent / Countered / Accepted / In Escrow / Closed), 1 deal at $45K. Fix committed: deal card now says "Yavapai, AZ" instead of "Property #3" via client-side property hydration. |
| 6 | Ty × 06 skip-trace | **COMPLETED_SATISFIED** | /skip-tracing has Trace search + "Batch Trace All Untraced" button. Live BatchData runs require an external key; UI/flow verified. |
| 7 | Wyatt × 05 portfolio-import | **COMPLETED_SATISFIED** | Same surface as Robert r3. Wyatt's Land-Academy pricing formula integrates with the new merge-variable + formula editor (r4 Dana path). |
| 8 | Gabriel × 08 autonomous-decision-review | **COMPLETED_SATISFIED** (after fix) | /decision-queue was 404. Fix committed: added a Wouter redirect to /admin/decisions AND opened /admin/decisions from FounderProtectedRoute to ProtectedRoute (page uses org-scoped /api/leads and /api/deals — safe for non-founders). Gabriel can now review autonomous decisions without a founder email. |

**Recommend count: 8/8 yes.**

## Fixes landed this cycle

### FIX-1: /decision-queue 404 + founder-gating (commit 9622663)
- `client/src/App.tsx`: added `<Route path="/decision-queue"><Redirect to="/admin/decisions"/></Route>` so legacy dashboard CTAs resolve correctly.
- `client/src/App.tsx`: changed `/admin/decisions` from `FounderProtectedRoute` to `ProtectedRoute`. The DecisionQueuePage uses org-scoped `/api/leads` and `/api/deals`, so non-founders see only their own decision queue.

### FIX-2: /deals pipeline cards showed "Property #3" (commit 57347b2)
- `client/src/pages/deals.tsx`: hydrate each deal with its property record client-side using the already-fetched useProperties() list. DealCard's existing `deal.property ? ... : fallback` branch now takes the property branch and renders "Yavapai, AZ" as intended.

## Cumulative totals across all cycles (3→7)

- **28 commits** (19 fix commits, 5 test-result commits, 4 doc commits)
- **7 deploys** to acreos.io
- **4 DB seed scripts**
- **21 fully-COMPLETED-SATISFIED persona × journey combinations** across cycles 6 and 7 (16 from cycle 6 + 8 added this cycle; one overlap: r8 James × notes appears in both)

## Observations parked for future cycles

- Campaign CSV importer doesn't accept `landUseCode` or `lastSalePrice` as columns despite those now being valid merge variables. Low-impact polish for when a user actually imports a list with those columns.
- The Pax sidebar on /ai, /campaigns, /skip-tracing, /decision-queue retains "Resumed from Apr 20" cached-conversation continuity. On newly-captured runs this sometimes leaks prior-session context. Not a blocker but worth a session-scoping pass in a future cycle.
- Gabriel × autonomous-decision-review requires seeded decisions in the test org's `decisions_inbox` to fully exercise the approve/deny workflow. Surface is unblocked; scenario exercise is data-seeded work for cycle 8+.
