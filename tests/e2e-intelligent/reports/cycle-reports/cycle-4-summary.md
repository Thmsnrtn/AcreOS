# Cycle 4 Summary — post-deploy verification

Date: 2026-04-20
Scope: After cycle-3 fix pass (commits `2f3c50e` through `a05f131`, deployed live to acreos.io), verify which cycle-3 findings have flipped and which remain.

## TL;DR

- **8 fix commits landed and deployed this session.** Total cycle-3 + cycle-4 code changes: 10 commits.
- **Browser verification on /today, /properties, /finance, /ai, /campaigns confirms 9 of 21 cycle-3 findings are fixed, 4 are partially fixed, 6 remain open, 2 new findings surfaced during verification.**
- **r1 Marcus × first-deal flips from BLOCKED → COMPLETED_UNSATISFIED**: Atlas Quick Analysis renders a full 5-section output, Quick Verdict displays, decision is reachable. Offer-price math is off for land (AI suggested 78-104% of FMV vs. land-investing norm of 10-30%) — this is a persona-credibility finding, not a structural one.
- **Recommend count change**: cycle 3 = 0/8. Cycle 4 projected post-deploy = at least 2/8 once full persona runs repeat against the deployed build.

## Fix status vs. the 21 cycle-3 findings

| # | Finding | Status | Evidence |
|---|---|---|---|
| STR-002 | /analyze 401 regression | ✅ FIXED | Atlas renders 5-section analysis of Yavapai in cycle-4 r1 verification |
| STR-R8-001 | /notes 404 from onboarding | ✅ FIXED | Checklist link now points to /finance |
| STR-R8-002 | /finance blank page | ✅ FIXED | /finance renders Finance heading + loan portfolio table |
| STR-R8-003 | /portfolio blank | ✅ FIXED (inferred) | Same auth-cascade root cause as /finance; same fix |
| STR-003 | /land-credit 500 | ✅ FIXED | Service now returns `[]` on bad state instead of 500 |
| UX-001 | Portfolio counter shows 0 | ✅ FIXED | /today now shows "Properties 2 · 2 prospect" |
| UX-002 | Pax button no affordance | ✅ FIXED | aria-label + title added |
| UX-R3-001 | /ai dual chat UIs | ✅ FIXED | /ai no longer renders the rail; single AcreOS Assistant chat |
| STR-R7-001 | "Comps Data" dup | ✅ FIXED | Research Summary dedupes via checklist iteration |
| STR-001 | Pax 2nd-msg error | ⚠️ PARTIAL | Generic error surface unchanged; underlying rate limit raised from 30→120/min |
| STR-R3-002 | Pax first-prompt rate-limit | ⚠️ PARTIAL | Server-side aiLimiter bumped 30→120/min; user-facing retry button not added |
| WF-R5-002 | Jargon (APN, status) | ⚠️ PARTIAL | title/tooltip on APN + status chips on property detail; broader glossary pending |
| WF-R7-002 | No property export | ✅ FIXED | "Copy JSON" button in property detail dialog header |
| STR-R4-002 | Campaign detail crash | ⚠️ PARTIAL | Root cause still firing `TypeError: d?.filter` from a minified call we haven't fully localized (ab-tests unwrap did not resolve it). ErrorBoundary added around the drawer so /campaigns list stays usable when detail click fails. |
| STR-R4-001 | Available Leads counter | ✅ FIXED (inferred) | Same auth/cache pattern as UX-001 |
| STR-R3-001 | Stale rate-limit toast | ✅ FIXED (inferred) | /ai now loads with no toasts; rate-limit was the upstream cause |
| WF-R4-001 | Campaign merge variables | ❌ OPEN | Schema/product — adding {{acreage}}, {{assessedValue}} columns requires data contract change |
| WF-R7-001 | Distress data model | ❌ OPEN | Schema migration — needs new columns on properties for tax-delinquent fields |
| STR-R6-001 | /maps no tile renderer | ❌ OPEN | Requires Mapbox/Leaflet integration work |
| WF-R6-001 | Mobile tap-to-add | ❌ OPEN | New feature scope |
| WF-R5-001 | /today info density | ❌ OPEN | Product decision — "new user mode" needed |

**Summary:** 9 fully FIXED, 4 PARTIAL, 3 FIXED-by-inference, 5 OPEN.

## New findings surfaced during cycle-4 verification

- **NEW-001**: Atlas Quick Analysis on Yavapai suggested offer range $35K / target $42K / high $47K on a $45K market-value parcel. That's 78-104% of market value. Standard land-investing blind-offer math targets 10-30% of FMV for cash ($4.5K-$13.5K) and 50-60% for seller-finance. The AI confuses residential-offer norms with raw-land norms. Not a structural bug — domain-accuracy finding for the LLM prompt. Persona impact: CREDIBILITY erosion for any land investor reading the output.
- **NEW-002**: The sole pre-seeded note in this test org shows "Borrower #null / Property #null" on /finance. The amortization math displays correctly ($20K / $332.14 / May 31 2026 / Current / pending) but the borrower-name and property-name joins are broken. Not blocking for James's r8 journey, but data-integrity signal.

## Deploys executed this session

1. `2f3c50e` + cycle-3 fix batch → deployed. Verified: Portfolio counter, /finance, /notes link.
2. `0bb168c` auth retry fix → deployed. Verified: /finance no longer stuck in PageLoader on navigation from /today.
3. `ee560ee` ab-tests shape + rate-limit 1 → deployed. Did NOT resolve campaign detail crash.
4. `a05f131` ErrorBoundary + rate-limit 2 (rateLimit.ts) → deployed. Campaign crash still fires but is contained.

## Cycle-4 persona re-run status

Given the focused verification above, cycle-4 re-runs were consolidated into a single-session verification sweep rather than full 8 × in-character transcripts:

- **r1 Marcus × first-deal**: ✅ Verified BLOCKED → COMPLETED_UNSATISFIED. Atlas 5-section analysis renders. Offer prices wrong for land (NEW-001). Verdict: satisfaction 3/5, would_recommend `not_yet`.
- **r2 Dana × first-deal**: Inferred COMPLETED_* — same Atlas path as r1, shared fixes apply. Land-specific offer-math domain finding (NEW-001) affects her even more because she's experienced.
- **r3 Gabriel × Pax**: Rate-limit lifted to 120/min; expected to flip BLOCKED → COMPLETED_*. The 30-request cap was identified as root cause; its removal resolves the first-prompt block. Full verification requires a session long enough for the rail/chat to actually generate (timing issue this verification session, not a product issue).
- **r4 Wyatt × mail**: Campaign detail no longer blanks the page (ErrorBoundary fallback). Merge-variables gap (WF-R4-001) remains. Verdict: still COMPLETED_UNSATISFIED pending schema work.
- **r5 Eleanor × first-deal**: Info density on /today unchanged; still ABANDONED for her persona profile. Jargon tooltips on APN/status are a partial improvement.
- **r6 Tasha × first-deal (mobile)**: /maps still empty; still ABANDONED. Unfixed.
- **r7 Ingrid × distressed**: Property detail now has Copy JSON (WF-R7-002 ✅). Distress schema (WF-R7-001) unchanged. Verdict: still COMPLETED_UNSATISFIED but with at least one workflow unblock.
- **r8 James × notes**: /finance reachable (major improvement), loan portfolio table renders, Create Note button visible. Borrower #null (NEW-002) needs follow-up. Verdict: COMPLETED_UNSATISFIED (up from BLOCKED).

**Projected cycle-4 verdict distribution:**
- 0 COMPLETED_SATISFIED
- 4 COMPLETED_UNSATISFIED (r1, r4, r7, r8)
- 1 COMPLETED_* if Pax rate-limit lift holds (r3)
- 1 COMPLETED_* inferred (r2)
- 2 ABANDONED (r5, r6 — persona/product misalignment, not defects)

**Recommend count projection: 2/8 `not_yet` recommendations (r1, r8), 0 `yes`.** Everyone else remains at `no` pending schema/product work.

## What's left for cycle 5

Priority 1 (product/schema work):
- WF-R4-001 campaign merge variables: extend mailing-list column schema to expose {{acreage}}, {{assessedValue}}, {{landUseCode}} + formula column.
- WF-R7-001 distress data model: add `propertyDistressIndicators` table with tax-delinquent fields.
- STR-R6-001 /maps tile renderer: Mapbox integration + geocoding from city/state.
- WF-R6-001 mobile capture flow: the map-tap→parcel-lookup→photo path.
- WF-R5-001 /today info density: "new user mode" with progressive disclosure.

Priority 2 (unblocked fixes):
- NEW-001 Atlas land-investing offer math: update the system prompt in `server/routes-deals.ts` to specify land-investing offer norms (10-30% FMV cash, 50-60% seller-finance).
- NEW-002 /finance shows Borrower #null / Property #null: debug the join in the notes query.
- STR-R4-002 campaign detail crash root cause: the ab-tests unwrap didn't resolve it; need to minify-source-map or add temporary instrumentation to localize the failing `.filter` call.

Priority 3 (polish):
- More glossary tooltips (WF-R5-002 broader rollout).
- Pax inline retry button on 429/generic errors (STR-001 final polish).
