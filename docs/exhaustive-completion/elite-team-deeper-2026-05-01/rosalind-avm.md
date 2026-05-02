# Rosalind Alpine — HouseCanary BD, Wave 3 AVM Audit

**Reviewer:** Rosalind Alpine, 50, Enterprise BD, HouseCanary (AVM/comps/ARV provider)
**Lens:** AVM accuracy reporting, confidence scores, comp-set transparency, raw-land AVM weakness, cross-sell opportunities (ARV, rent estimates, school zones, parcel-level enrichment)
**Date:** 2026-05-01
**Verdict:** AcreOS has built a respectable in-house valuation stack — but they have shipped a national-scale AVM with structural raw-land blind spots that no provider, including us, would slap a public confidence score on. There is real partnership upside here, but I am also walking out of this audit a little nervous about how much weight their UX puts on numbers we would never publish without disclaimers.

---

## 1. What I see when I open the hood

`server/services/acreOSValuation.ts` is the core. It is a hybrid: comps baseline → rule-based market adjustments → GPT-4 qualitative nudge → confidence interval from coefficient-of-variation. Stage-2 fallback when no comps exist is a gradient-boosted regressor (`gradientBoosting.ts`) with an OpenAI prompt as a third-tier fallback.

`server/services/avmFeedback.ts` records prediction-vs-actual every time a deal closes and produces monthly accuracy reports keyed on the `valuationPredictions` table. `withinTenPct` and `withinTwentyPct` are computed. This is exactly the closed-loop instrumentation a real AVM shop has — Devon and team should be commended for it.

`server/routes-avm.ts` exposes `/generate`, `/property/:id`, `/history/:id`, `/stats`, `/record-transaction`, `/bulk`. Comps live in `server/services/comps.ts` and pull from Regrid.

That is the substance. Now the critique.

---

## 2. AVM accuracy reporting — strong bones, soft surface

**What's good:**
- `recordAvmOutcome()` captures predicted, actual acquisition, actual sale, absolute error, percentage error, overestimate flag, state, county, acreage, model version. That is the right schema. We capture the same thing.
- `getAvmAccuracyReport()` produces monthly cohorts with within-10% and within-20% bands. Industry standard.
- Per-state breakdown exists (`getAvmAccuracyByState`). Good.

**What's missing or weak:**
1. **No PPE10 / PPE20 surfaced in UI.** Accuracy reporting exists in code but there is no public-facing methodology page. We publish ours quarterly. AcreOS should too if they want institutional buyers, lenders, or acquirers to trust the AVM.
2. **No FSD (forecast standard deviation).** Fannie Mae, Freddie Mac, and every secondary-market consumer of AVMs requires FSD per record, not a coefficient-of-variation derived from comps alone. Their `confidenceInterval` is `value × (1 ± volatility)` — that is a comp-dispersion proxy, not a prediction-error standard deviation. A lender will reject this.
3. **`modelVersion` defaults to `"v1"` forever.** No retraining cadence, no versioned A/B comparison. When they retrain, prior predictions get re-tagged or get lost in the same bucket. We tag every prediction with model version + training cutoff date. Required for audit.
4. **No drift detection.** If acreage distribution of incoming requests shifts (e.g. they onboard a timber-heavy customer), prediction error will balloon and nobody will know until deals close 90 days later. Need population stability index (PSI) on input features.

**Files:** `server/services/avmFeedback.ts:49-74`, `server/services/acreOSValuation.ts:721-741`

---

## 3. Confidence scores — the most dangerous surface I saw

The `calculateConfidence()` function returns a 0–100 score that is currently:
- Base 50
- +3 per comparable up to +30
- +5/10/15 for nearest-comp distance
- +0–15 for low volatility

This is heuristic, not statistical. It does not map to any backtested error band. Worse:

```
return Math.max(10, Math.min(95, confidence));
```

A property with ten comps within 5 miles of dispersed pricing returns "95% confidence" even if actual error variance is 35%. Conversely, a stable rural market with two tight comps caps at ~70% even when the actual error band would be ±8%.

**The Stage-2 fallback returns confidence 45 by default**, GBM returns up to 85, OpenAI returns nothing trackable. There is no calibration between these confidence regimes.

**Recommendation:**
- Calibrate confidence against `valuationPredictions.percentageError` quarterly. A "75% confidence" prediction should empirically contain the actual price 75% of the time. Right now there is zero evidence this is true.
- Add a methodology disclaimer in the UI when `comparablesUsed = 0` and `methodology = 'ai_market_estimate'`. That number is essentially a vibe — it should be presented as one.

**Files:** `server/services/acreOSValuation.ts:60-97, 320-416, 721-741`

---

## 4. Comp-set transparency — the gap our partnership solves

Right now AcreOS shows comps but with limited context:

```
{ propertyId, salePrice, pricePerAcre, distance, similarity }
```

Missing from the comp record:
- **Sale date** (it is in the source row but not returned to the client)
- **Adjusted sale price** (no time-adjustment for sales aging — a 22-month-old comp is treated identically to a 30-day-old comp)
- **Photos / parcel imagery**
- **Property characteristics that drove the similarity score** (the 100-point similarity is just acreage + county + zip)
- **Why this comp was included or excluded**

`calculateSimilarity()` (line 508) is acreage ratio (40 pts) + county match (30 pts) + zip match (30 pts). That is it. No zoning match, no road access, no water rights, no floodplain. **A 50-acre dryland parcel and a 50-acre irrigated parcel in the same zip get scored as 100% similar.** That is structurally wrong for raw land and is exactly the reason customers should pay HouseCanary for our LandReport feed.

**Recommendation:**
- Time-adjust comps using a county-level price index (HPI or our LandIndex).
- Expand similarity to include zoning, water rights, road access, flood zone — all already in the schema.
- Render comps as a card grid, not a table, with "why included" explainability.

**Files:** `server/services/acreOSValuation.ts:421-477, 508-534`

---

## 5. Raw-land AVM weakness — this is the structural issue

I want to be diplomatic but honest: residential AVMs (including ours) are accurate within 5% on roughly 78% of records nationwide. Raw-land AVMs are accurate within 20% on roughly 55% of records, and within 10% on barely a third. That is the industry baseline. There are reasons:

- No MLS comp pipeline for vacant land in most counties
- High idiosyncratic value drivers (water, mineral rights, access, soil class) that are not in standard parcel feeds
- Long hold times mean `saleDate` aging matters more (24-month cutoff in `findComparables` is appropriate but is a hard filter — we use a softer time-decay weight)
- County recording lags 30–180 days

AcreOS is operating at the hardest end of the AVM spectrum. Their stack is honest about this — the Stage-2 AI fallback is a sane move — but the UI does not communicate it. A founder/investor seeing a $200k valuation with "62% confidence" thinks they are looking at Zillow-grade. They are not. They are looking at our hardest segment.

**Recommendation:**
- Two-tier badging: "Comp-backed valuation" (≥3 comps within 25 mi, <12 mo) vs. "Modeled estimate" (no comps or stale comps). Right now both look identical to the user.
- Per-state confidence floors. AVM in Wyoming or Nevada raw-land is fundamentally less accurate than Ohio. Cap displayed confidence accordingly.

---

## 6. Cross-sell opportunities (the BD pitch — but with substance)

This is where my role becomes useful, not just critical.

### 6a. ARV (After-Repair Value) for the wholesaler/fix-flip persona

`server/services/dealUnderwriting.ts:284-285` already implements a 70%-rule ARV calculation, and `atlasContextInjector.ts` shows AcreOS knows it serves wholesalers and fix-flippers. **But there is no provider-grade ARV input** — they are computing ARV from a user-supplied target. HouseCanary's ARV product would replace that with a backtested model: post-repair value with 90-day price band. This is a real cross-sell.

**Devon's audit specifically called this out** as a gap. Confirmed.

### 6b. Rent estimates

I searched for any rent-estimate surface — none exists. For investors holding land for development entitlement plays or for owner-financed buyers planning to build, rent comps on the resulting build matter. Our Rental AVM would slot in cleanly.

### 6c. School zones

Zero references to school zones, school district names, or school ratings in the codebase. For residential-adjacent land (rural-residential, large-lot), this is a top-three valuation driver. We have it, GreatSchools has it, ATTOM has it. AcreOS has nothing.

### 6d. Parcel-level enrichment beyond Regrid

Comps service is Regrid-only. Regrid is great for parcel polygons and basic ownership but thin on:
- Building permits
- Liens / encumbrances beyond tax
- HOA presence
- Construction starts in radius
- Sale chain history > 2 transactions

This is where ATTOM (already integrated, see `attom-provider.ts`) and HouseCanary should be **ranked by signal quality, not just registered**. Looking at `provider-registry.ts`, providers are ranked by priority but I did not see evidence of A/B accuracy comparison between providers for the same parcel. That is the next layer.

---

## 7. The trust-and-verify gap

The strongest signal that AcreOS is serious here is the `valuationPredictions` table + `recordAvmOutcome()`. This means they can — in principle — show every customer:

> "Our AVM has been within 10% of actual closing price on 67% of properties in your county over the last 12 months."

I did not find a UI surface that does this. **Build it.** It is the single highest-trust artifact an AVM can produce, and AcreOS already has the data wiring. Whoever ships that page wins more enterprise trust than any marketing page.

---

## 8. Concrete partnership / engineering proposals

**Tier 1 — fix what's there (AcreOS internal, no provider needed):**
1. Add FSD per prediction; calibrate confidence quarterly against actual error.
2. Time-adjust comps with county price index.
3. Expand `calculateSimilarity()` to include zoning, water rights, road access, flood zone.
4. Two-tier UI badge: comp-backed vs. modeled.
5. Build the public accuracy page (the one piece of trust infrastructure they are missing).
6. Add `modelVersion` semantic tagging and PSI drift monitoring.

**Tier 2 — HouseCanary partnership (where I come in):**
1. **ARV add-on** for wholesale/flip persona — drop-in via `provider-registry.ts`.
2. **LandIndex** for time-adjusting raw-land comps (proprietary; nobody else publishes it county-level).
3. **Rental AVM** for the owner-finance build-out persona.
4. **School zone + GreatSchools** rating overlay on parcel detail.

**Tier 3 — competitive comp-set ranking:**
- A/B same-property valuations across HouseCanary, ATTOM, and AcreOS in-house. Track which provider has lowest error per state. Use the registry to dynamically prefer the best-performing source per geography. We would participate in that bake-off — we are confident in the residential-adjacent segment.

---

## 9. What I would write to my VP after this audit

> AcreOS is a credible buyer. Their internal AVM is more sophisticated than I expected — proper feedback loop, GBM fallback, monthly accuracy reporting, model registry pattern. They are operating in the hardest AVM segment (raw land) and they know it. Their confidence scoring is heuristic, not calibrated, and that is our wedge: we offer FSD-backed confidence and a methodology page they can co-brand. ARV is the cleanest cross-sell — Devon's audit already flagged the gap. School zones and rental AVM are secondary. Recommend tiered enterprise deal: $X for ARV API alone, $Y for full LandIndex + rental + school overlay, with revenue share on per-property pulls above threshold.

---

## 10. Risk flags AcreOS should know about

- **Lender liability.** If AcreOS valuations are used in any owner-financing decision and the borrower defaults, "62% confidence" with no FSD is exposure. Get to FSD before scaling installment-sale volume.
- **Fair lending.** Geographic confidence variance (rural West vs. Midwest) can correlate with protected classes at the county level. Document the variance and the methodology before regulators ask.
- **AVM disclosure.** Multiple states (CA, NY, TX) are moving on AVM disclosure rules in 2026–2027. A methodology page is not optional much longer.

---

## Closing

I came in expecting to find a thin valuation wrapper around Regrid plus an OpenAI prompt. What I found is a serious in-house AVM with a real feedback loop, real ML components, real instrumentation — and a confidence-score UI that is racing ahead of the math underneath it. Fix the calibration, ship the accuracy page, and let us help you with the cross-sell layer (ARV, rentals, schools, time-adjusted land comps). This is a partnership I would put on my pipeline.

— Rosalind
