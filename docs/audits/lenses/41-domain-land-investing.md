# Lens 41 -- Land Investing Domain Expert Audit

**Auditor perspective:** Evaluates whether AcreOS correctly models the land investment workflow: lead sourcing, blind offers, due diligence, closing, seller financing, note servicing, and portfolio management.

**Date:** 2026-04-15
**Severity scale:** P0 = incorrect financial calculation, P1 = missing critical workflow step, P2 = domain depth improvement, P3 = nice-to-have

---

## Executive Summary

AcreOS demonstrates an unusually strong understanding of the Podolsky-style raw land investing methodology. The blind offer calculator, lead scoring system, due diligence engine, seller financing workflow, and freedom meter are all present and architecturally sound. The platform covers the full lead-to-passive-income lifecycle that no competitor currently offers in one product.

However, several financial calculations have edge-case errors or omissions that could cost users real money (P0), and some critical workflow steps that experienced land investors rely on are absent or incomplete (P1). The domain depth is impressive but has gaps that would surface the moment a user tries to scale past 10-20 notes.

**Findings:** 5 P0, 8 P1, 12 P2, 6 P3

---

## P0 -- Incorrect Financial Calculations

### P0-01: Blind offer calculator uses USDA NASS statewide pasture values as comps

**File:** `server/services/blindOfferCalculator.ts` (lines 277-306)

The `buildCompDataset()` function injects USDA NASS statewide pastureland values directly into the comp dataset. When no user-provided comps exist, these statewide averages become the *only* comps, and the lowest one becomes the basis for the "lowest comp / 4" formula.

**Problem:** USDA NASS publishes state-level averages that blend highly productive irrigated cropland with scrub desert. A statewide average for Texas ($2,300/acre) does not represent a specific county like Hudspeth ($200/acre) or Williamson ($15,000/acre). Using this value as a "comparable sale" fundamentally breaks the Podolsky formula, which requires *county-level actual sales* as comps.

**Impact:** Offers could be 5-50x too high or too low depending on the county. If the NASS value is $2,300 and local comps are $500, the user sends offers at $575/acre instead of $125/acre -- overpaying by 4.6x.

**Recommendation:** NASS data should be used as a *ceiling/floor validation anchor*, not as a comp. Display it alongside comps for context but exclude it from the lowest-comp calculation. When insufficient comps exist, the calculator correctly warns but should refuse to calculate an offer rather than silently use statewide data.

---

### P0-02: Amortization schedule does not handle balloon payments

**File:** `server/routes-finance.ts` (lines 300-325)

The amortization schedule generator (`POST /api/notes/:id/schedule/generate`) implements a standard fully-amortizing fixed-rate schedule. There is no support for:
- Balloon payments (common in land notes -- e.g., 7-year amortization with 5-year balloon)
- Interest-only periods
- Adjustable rates with step-ups

**Problem:** A significant portion of land seller-finance notes use a balloon structure. If a user creates a 7-year amortization with a 5-year balloon, the schedule will show 84 payments with no balloon. The borrower portal, dunning system, and freedom calculator will all display incorrect payoff dates and remaining balances.

**Impact:** Incorrect payment expectations for both seller and buyer. Potential legal exposure if the note instrument says "balloon at 60 months" but the system shows 84 months of payments.

---

### P0-03: Payment recording does not split principal vs. interest correctly for partial payments

**File:** `server/storage.ts` (lines 1844-1854)

When a payment is recorded, the balance update subtracts `payment.principalAmount` from `note.currentBalance`. However, the payment creation endpoint (`POST /api/payments`) accepts `principalAmount` and `interestAmount` as user-provided inputs with no server-side recalculation.

**Problem:** In standard amortization, the principal/interest split changes every month. A payment of $200 in month 1 might be $15 principal + $185 interest, while in month 60 it might be $150 principal + $50 interest. If the user (or a front-end bug) passes incorrect split values, the balance drifts from the amortization schedule silently. There is no server-side validation that `principalAmount + interestAmount = amount` or that the split matches the expected amortization row.

**Impact:** Over the life of a 7-year note, small drift errors compound. The note could show "paid off" while money is still owed, or show a balance when the note is actually satisfied. This has legal and financial consequences.

---

### P0-04: Monthly payment calculation inconsistency across test and integration files

**Files:**
- `server/storage.ts` line 258: uses `annualRate / 100 / 12` (rate as percentage, e.g., 9 = 9%)
- `tests/integration/noteLifecycle.test.ts` line 80: uses `annualRate / 12` (rate as decimal, e.g., 0.08 = 8%)
- `client/src/components/payment-calculator.tsx` line 26: uses `annualRate / 100 / 12` (rate as percentage)

**Problem:** The integration test uses a different convention for `annualRate` than the production code. Production storage treats `annualRate` as a whole number (9 = 9%), but the test treats it as a decimal (0.08 = 8%). This means the test is not actually validating the production calculation. A 9% note in the test would calculate as a 0.09% note, producing wildly incorrect monthly payments.

**Impact:** The test provides false confidence. Any regression in the amortization formula would go undetected.

---

### P0-05: Freedom calculator divides by active note count, producing misleading projections

**File:** `server/services/freedomCalculator.ts` (lines 84-91)

The freedom meter calculates `avgIncomePerNote = monthlyPassiveIncome / activeNoteCount` and then projects: "Assume ~2 notes acquired per month." This is a hardcoded assumption baked into the projection.

**Problem:** The "2 notes per month" assumption is arbitrary and has no basis in the user's actual acquisition rate. A new user with 1 note will see "2 notes/month" and a projected date that is wildly optimistic. A high-volume operator doing 8 notes/month will see a pessimistic projection. The projection should use the user's actual historical note acquisition rate (notes created per month over the last 6 months).

**Impact:** The freedom date -- the single most motivating metric in the product -- is inaccurate for every user.

---

## P1 -- Missing Critical Workflow Steps

### P1-01: No county validation / market research workflow

The competitive landscape document and blind offer calculator both reference "eBay validation" (Podolsky's method of checking eBay sold listings for land in a county to validate buyer demand). The calculator outputs warnings about it, but there is no structured county research workflow -- no way to record county research results, track validated counties, or compare counties systematically.

**Impact:** Users skip the most important step in the Podolsky method: picking the right county. The platform lets you calculate offers without ever validating that the county has demand.

---

### P1-02: No early payoff / payoff quote calculation

**Searched for:** `partial payment`, `early payoff`, `payoff quote`, `payoff amount` across all finance routes.

The note servicing system can record payments and track delinquency, but there is no payoff quote endpoint. When a borrower wants to pay off a note early, the seller needs to calculate: remaining principal + accrued interest to payoff date + any fees. This is a standard feature in every note servicing platform.

**Impact:** Users must calculate payoff amounts manually or in a spreadsheet, defeating the "one platform" value proposition.

---

### P1-03: No late fee calculation or tracking

The dunning system (`server/services/financeAgent.ts`, `server/services/dunning.ts`) tracks delinquency days and sends reminders, but there is no late fee calculation. Land notes typically charge 5-10% of the monthly payment as a late fee after a grace period (usually 10-15 days).

**Impact:** Lost revenue for every note in the portfolio. Users must track late fees outside the system.

---

### P1-04: Deal pipeline missing "under contract" / "due diligence" stages

**File:** `server/routes-deals.ts` (lines 189-197)

Deal status transitions: `negotiating -> offer_sent -> countered -> accepted -> in_escrow -> closed -> cancelled`

**Problem:** The pipeline skips the due diligence step between "accepted" and "in_escrow." In the land investing workflow, after an offer is accepted, the investor has a due diligence period (typically 10-30 days) during which they can back out. This is distinct from "in escrow" (which implies commitment to close). The current flow jumps from "accepted" directly to "in_escrow" with no "due_diligence" stage.

Additionally, there is no "disposition" side of the pipeline. When the investor is *selling* (listing on LandWatch, Facebook Marketplace, etc.), the stages are completely different: listed -> inquiry -> offer_received -> negotiating -> under_contract -> closed.

**Impact:** The pipeline does not match the actual workflow for either the acquisition or disposition side. Users cannot track where their deals actually are.

---

### P1-05: No 1098 / year-end tax document generation

The competitive landscape document lists "generate 1098s" as part of the full lifecycle. The schema has references to 1098 forms. However, there is no actual 1098 generation service. For seller-financed notes, the IRS requires Form 1098 (Mortgage Interest Statement) to be issued to the borrower if more than $600 of interest is received.

**Impact:** Users with any meaningful note portfolio must generate these forms manually or use a separate service, breaking the "one platform" promise.

---

### P1-06: No note sale / secondary market tracking

When a land investor wants to sell a note to a note buyer (common for liquidity), there is no workflow for:
- Calculating note sale price (based on yield, remaining payments, seasoning)
- Recording the note sale as a disposition
- Tracking the note buyer's information
- Marking the note as "sold" vs. "paid off"

The blind offer calculator correctly includes `noteValue` (75% of face value), but the actual note sale transaction cannot be recorded.

---

### P1-07: Lead scoring factors not wired to the AcreScore Pro signals

**File:** `server/services/leadScoring.ts`

The `calculateFactors()` method (line 254) uses 12 original signals. The file also contains 15 "EPIC C: AcreScore Pro" signals (lines 280-375) including distance-owner-to-property, BLM adjacency, wildfire risk, NCCPI soil score, etc. However, these 15 signals are defined as standalone methods that are **never called** from `calculateFactors()`.

**Impact:** The advertised "27-signal AcreScore" is actually a 12-signal score. The most land-specific and differentiating signals (BLM adjacency, soil quality, endangered species, owner age) are dead code.

---

### P1-08: Due diligence templates missing "land_flipper" and "note_investor" business types

**File:** `server/services/dueDiligenceEngine.ts` (lines 174-224)

The `businessTypeDDTemplates` object only contains templates for `fix_and_flip`, `buy_and_hold`, and `commercial`. The function `getDDTemplateForBusinessType()` explicitly documents: "Returns undefined for business types without a specific template (e.g., land_flipper, note_investor)."

**Problem:** The primary user base of AcreOS (land flippers and note investors) has no business-type-specific due diligence checklist. The existing templates are for residential real estate, not raw land. A land flipper's DD checklist should include: legal access verification, perc test, mineral rights check, timber cruise, zoning confirmation, county road maintenance status, HOA/POA restrictions, back tax verification, and chain of title review.

---

## P2 -- Domain Depth Improvements

### P2-01: Land Credit Score dimensions use excessive defaults

**File:** `server/services/landCredit.ts` (lines 244-500)

Multiple scoring dimensions fall back to hardcoded default values (50-70) when actual data is unavailable. For example, `scoreLocation()` assigns `growthRate: 80` for TX and FL with no actual census data lookup. The confidence interval system (lines 199-238) correctly identifies when dimensions are defaulted, but the score is still presented as a 300-850 number that looks authoritative.

**Recommendation:** When fewer than 4 of 6 dimensions have real data, display the score as "Insufficient Data" rather than a numeric value. A score of 620 based on 2 real dimensions and 4 defaults is misleading.

---

### P2-02: Blind offer calculator missing acreage-based comp filtering

**File:** `server/services/blindOfferCalculator.ts`

The comp analysis does not filter comps by acreage similarity. A 2-acre lot and a 200-acre ranch in the same county have very different per-acre values (small lots command a premium). The Podolsky method requires comps of similar size.

**Recommendation:** Filter comps to within +/- 50% of target acreage, or at minimum weight closer-acreage comps more heavily.

---

### P2-03: Usury checker should distinguish raw land from residential

**File:** `server/services/usury.ts`

The usury limit table applies general state usury caps. However, several states have different limits for real property seller financing vs. consumer loans. For example, California's 10% limit has exemptions for real property seller financing by non-lenders. The current implementation may block perfectly legal seller-finance rates.

**Recommendation:** Add a `propertyType` parameter ("raw_land" vs. "residential") and adjust limits accordingly. Include the raw-land exemption where applicable.

---

### P2-04: Closing checklist does not include land-specific items

**File:** `server/services/closingChecklistGenerator.ts`

The generated checklist is a generic real estate closing checklist (title search, deed preparation, recording). It is missing land-specific items:
- Verify legal access to public road (critical for raw land)
- Confirm property tax proration
- Verify no outstanding HOA/POA assessments
- Confirm mineral rights status in the deed
- Survey verification (or waiver acknowledgment)
- Well/septic requirements disclosure (where applicable)
- Endangered species / wetlands disclosure

---

### P2-05: Owner financing scenario assumes fixed 9% / 84 months

**File:** `server/services/blindOfferCalculator.ts` (lines 499-544)

The `buildOwnerFinanceScenario()` function hardcodes 9% interest and 84-month term. While these are Podolsky defaults, experienced investors adjust terms based on the deal. Some markets support 10.9% or 12.9%; some deals warrant 48 or 120 months.

**Recommendation:** Accept user-configurable rate and term parameters. Default to 9%/84mo but allow overrides.

---

### P2-06: Campaign sizing model uses a single response rate

**File:** `server/services/blindOfferCalculator.ts` (lines 675-699)

`sizeCampaign()` uses a hardcoded 4% response rate. In practice, response rates vary dramatically by list quality (3-8% for tax delinquent vs. 1-3% for general absentee), mailing format (yellow letter vs. postcard), and follow-up cadence.

**Recommendation:** Accept list type and mailing format as inputs to adjust the expected response rate.

---

### P2-07: Due diligence engine elevation check cannot determine slope

**File:** `server/services/dueDiligenceEngine.ts` (lines 542-580)

The USGS elevation API returns a single point elevation. The code correctly notes "We can't determine slope from a single point" (line 562). Slope is critical for land -- steep land is unbuildable and less desirable for recreation.

**Recommendation:** Query 4-5 points across the parcel boundary to estimate slope range.

---

### P2-08: Road access check uses a fixed 500m buffer regardless of parcel size

**File:** `server/services/dueDiligenceEngine.ts` (lines 455-535)

A 500m buffer is reasonable for a 5-acre parcel but inadequate for a 640-acre section. The check should scale the buffer based on parcel size, or at minimum query at the parcel centroid and boundary midpoints.

---

### P2-09: No subdivision / parcel splitting workflow

References to "subdivision" appear in quotes and comments but there is no structured workflow for:
- Analyzing a large parcel for subdivision potential
- Calculating the economics of splitting (total value of parts vs. whole)
- Tracking county subdivision requirements and timelines
- Managing multiple child parcels from a parent deal

Subdivision is a key profit multiplier in land investing ("one parcel becomes four").

---

### P2-10: Night cap / Evening Review freedom meter uses different calculation than freedomCalculator

**Files:** `server/routes-night-cap.ts` (lines 196-200) vs. `server/services/freedomCalculator.ts` (lines 59-62)

The night cap snapshot calculates freedom percentage as `monthlyPassiveIncome / monthlyExpenses`, sourced from `org.settings.monthlyExpenses || org.freedomNumber`. The freedom calculator uses `monthlyPassiveIncome / freedomTarget`, sourced from the `goals` table with type `revenue_earned`.

These are potentially different numbers from different sources, leading to inconsistent freedom percentages displayed in different parts of the app.

---

### P2-11: Lead scoring does not account for mortgage status

A property with no mortgage is a much stronger motivated-seller signal than one with a mortgage (the owner has no payoff obligation and can accept any offer). This is one of the "holy grail" criteria mentioned in the night cap quotes ("no mortgage") but is absent from the scoring factors.

---

### P2-12: Dodd-Frank checker correctly identifies raw land exemption but could be more granular

**File:** `server/services/doddFrankChecker.ts`

The checker correctly identifies that raw land without a dwelling is generally exempt from Dodd-Frank/TILA. However, it does not address:
- State-level contract-for-deed regulations (Texas Property Code Ch. 5, for example, has specific requirements)
- The distinction between "deed of trust + promissory note" vs. "contract for deed" financing structures
- State-specific land contract cancellation/forfeiture requirements

---

## P3 -- Nice-to-Have

### P3-01: Blind offer letter template does not include a response mechanism

The `letterVariables` output includes offer amount, county, and urgency language, but no call-to-action mechanism (dedicated phone number, QR code to respond online, pre-addressed reply envelope). Tracking which letters generate responses requires this.

---

### P3-02: No buyer list management for dispositions

The night cap quotes reference "your buyer list is worth more than your property list." There is no buyer list feature for managing repeat buyers, buyer preferences (acreage range, price range, state preferences), or buyer notification when new inventory matches their criteria.

---

### P3-03: No integration with county GIS for automated comp pulls

The blind offer calculator accepts manual comps but cannot auto-pull recent sales from county assessor GIS systems or from Regrid's sales data. The comps service (`server/services/comps.ts`) uses Regrid for nearby parcels but does not specifically filter for recent *sold* parcels with sale prices.

---

### P3-04: No tax lien / tax deed auction tracking

Tax delinquent properties that reach tax sale create a time-sensitive opportunity. There is no feature for tracking upcoming tax sales by county, watching specific parcels through the auction process, or alerting when a target property enters redemption.

---

### P3-05: Quote attributions in Evening Review

All 47 evening review quotes (lines 38-86 in `routes-night-cap.ts`) are attributed to "AcreOS." Several are direct paraphrases of Mark Podolsky, Seth Williams, and other known land investing educators. Using generic attribution is fine legally but a missed branding opportunity. Consider attributing to the original thought leaders (with permission) or to the platform's AI agents.

---

### P3-06: State document config missing several states

**File:** `server/services/stateDocumentConfig.ts`

The config maps to specific states but should be verified for completeness across all 50 states. Several less common land-investing states (e.g., HI, AK, DC) may be missing, causing fallback to the TX configuration.

---

## What AcreOS Gets Right (Domain Strengths)

1. **Podolsky formula implementation** -- The blind offer calculator correctly implements "lowest comp / 4" with three tiers (20%, 25%, 33%) and market-condition-based tier selection. The docstrings demonstrate genuine understanding of why this formula works.

2. **Seller financing as a first-class entity** -- Notes, amortization schedules, borrower portal, payment tracking, delinquency detection, dunning workflows, and usury compliance are all implemented. This is architecturally correct and ahead of every competitor.

3. **Due diligence automation** -- The DD engine queries 6+ free government APIs (FEMA, USFWS, EPA, OSM, USDA, USGS) in parallel with timeout handling and graceful degradation. The expanded checks (BLM adjacency, NLCD land cover, wildfire risk, SSURGO soil, endangered species) show genuine domain depth.

4. **State-specific document configurations** -- The `stateDocumentConfig.ts` correctly maps deed types, lien instruments, land contract names, notary/witness requirements, recording fees, transfer taxes, and attorney requirements by state. This is a significant data asset.

5. **Title chain service** -- Models deed transfers, liens, easements, probate, lis pendens, tax sales, and judgments. The comment block demonstrates expert-level knowledge of title due diligence for land.

6. **Usury compliance at the transaction level** -- Hard-blocking note creation when the interest rate exceeds state usury limits is the correct approach. Most platforms leave this to the user.

7. **Dodd-Frank checker** -- Correctly models the 3-property safe harbor, 1-property natural person exemption, and non-dwelling land exemption. This is a genuine differentiator.

8. **Closing cost estimator** -- Uses real recording fee and transfer tax data by state/county. Includes prorated tax calculation. Practical and accurate.

9. **Lead scoring signals** -- The 12 active signals (ownership duration, tax delinquency, absentee owner, property size, corporate owner, out-of-state, inheritance indicators, flood zone, response recency, email engagement, campaign touches, prior response history) are all legitimate motivated-seller indicators used by experienced land investors.

10. **Freedom meter concept** -- Tracking passive income from note payments against a freedom target is the core emotional driver of the land investing business model. Having this as a dashboard metric is strategically correct.

---

## Summary Recommendations (Priority Order)

1. **Fix NASS comp injection** (P0-01) -- Remove USDA NASS values from the comp calculation; use as validation only.
2. **Wire AcreScore Pro signals** (P1-07) -- The 15 new signals are already implemented; just call them from `calculateFactors()`.
3. **Add balloon payment support** (P0-02) -- Notes schema likely already supports `balloonAmount`; wire it into amortization generation.
4. **Add due diligence pipeline stage** (P1-04) -- Single status addition to the transition map.
5. **Add server-side payment split validation** (P0-03) -- Recalculate principal/interest split on the server when recording payments.
6. **Fix freedom projection** (P0-05) -- Use actual historical acquisition rate instead of hardcoded 2 notes/month.
7. **Create land-specific DD template** (P1-08) -- Template for the primary user persona.
8. **Add payoff quote endpoint** (P1-02) -- Standard note servicing operation.
9. **Add late fee tracking** (P1-03) -- Revenue impact for every note in the portfolio.
10. **Fix test rate convention** (P0-04) -- Ensure integration tests use the same rate format as production.
