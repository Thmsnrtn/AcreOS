# Magnus Henningsen — ML / Recommendations Audit, AcreOS

**Lens:** 43, ex-Spotify (Discover Weekly era — content-based + collaborative ensemble) and ex-LinkedIn (Jobs You May Be Interested In — late-stage feature store + ranking infra). I have shipped recommenders against ten-figure user counts, owned offline-eval pipelines, and lost three months to a feedback loop bug that an ablation would have caught in a day. I was asked to look at AcreOS through an ML-recommendations engineer's lens — buyer-matching, deal scoring, blind-offer/MAO, lead scoring. The promise of those features sounds ML-shaped. The implementation is something else, and the gap matters less than you'd think — but where it matters, it matters a lot.

---

## 1. One-line verdict

**There is no ML in AcreOS today.** Every "AI" feature in the matching/scoring/pricing surface is a hand-tuned weighted heuristic with hard-coded thresholds, plus an LLM (gpt-4o) for prose generation on top. That is **the correct call for the current data regime** — AcreOS has no labelled outcomes at the volume needed to train a model, no feature store, no offline eval harness, and a long-tail catalog (parcels) where collaborative filtering would cold-start into uselessness. **The dishonesty is in the naming** (`buyerMatchingAIService`, `leadIntelligenceEngine`, "AI insights") — none of it is AI in the model-trained-on-data sense. The roadmap question is not "when do we add ML" but "are we capturing the labels and feature snapshots today that would let us train a model in 18 months." On that axis the system is **partially instrumented and silently leaking the most valuable signal.**

---

## 2. The four ML-shaped surfaces — what they actually are

| Surface | File | What it claims | What it is |
|---|---|---|---|
| Buyer ↔ Property matching | `server/services/buyerMatchingAI.ts` (1,080 LOC) | "AI matching" | 6-factor weighted sum (price 25%, location 20%, size 15%, zoning 15%, financing 15%, features 10%) with hard-coded score buckets (`>=40` = match) |
| Lead intelligence / scoring | `server/services/leadIntelligenceEngine.ts`, `sellerMotivationEngine.ts` (812 LOC) | "Lead Intelligence Score" | Categorical rule engine: financial(0–35) + emotional(0–30) + tenure(0–20) + behavioral(0–15) → letter-grade |
| Blind offer / MAO | `server/services/blindOfferCalculator.ts` (699 LOC) | "industry-standard formula" | `lowestComp ÷ 4`, with three discrete tiers (20% / 25% / 33%) selected by `if/else` over `marketCondition` and `sellerProfile` |
| Deal underwriting / exit choice | `server/services/dealUnderwriting.ts` (369 LOC) | "scenario analysis" | DCF math (correctly implemented, including Newton's-method IRR) over three fixed scenarios; exit strategy chosen by `argmax(riskAdjProfit)` |

**None of these touch a model.** There are no `.pkl`, no ONNX, no `tfjs`, no `onnxruntime` import, no embedding column in the schema. The only learned component anywhere in the recommendation path is **gpt-4o called for prose** — `generateMatchPitch` (line 687, `buyerMatchingAI.ts`) and `analyzeBuyerPreferences` (line 1017). Those are stylistic wrappers, not ranking signals.

---

## 3. Heuristic vs ML — case-by-case principled call

### 3.1 Blind offer / MAO — **heuristic is correct, possibly forever**

`Offer = lowestComp ÷ 4` (`blindOfferCalculator.ts:202`) is not an estimator that improves with data — it is a **margin-of-safety policy**. The right object to learn would be *acceptance probability given offer ratio, seller profile, market condition*, which would let you optimize expected profit instead of conservatively flooring at 25%. AcreOS has the labels for this in principle (`buyerPropertyMatches.status` transitions, deal acceptance) but the volume per `(county × seller-archetype × offer-tier)` cell will be tiny for years. **Stay heuristic.** If you ever ML-ify this, the right model is a **two-stage propensity-score** (acceptance | offer-ratio, seller-features) calibrated by Platt scaling, and you train it from `agentEvents` once you have ~5k accepted/rejected pairs per archetype. You are years away. Don't pretend otherwise.

### 3.2 Buyer-property matching — **heuristic is wrong long-term, right today**

This is the surface that *should* eventually be ML, and isn't being instrumented for it. The current weighted sum (`buyerMatchingAI.ts:367–374`) is a **content-based recommender with no learned weights**. The 25/20/15/15/15/10 split is asserted, never validated. Three structural problems:

1. **Weights are constants, not parameters.** A real recommender learns weights from `(buyer, property, presented, status)` tuples. `buyerPropertyMatches.status` (`pending|presented|interested|not_interested|purchased`) is exactly the click/save/purchase ladder I had at Spotify. You have the schema. You have no training loop.
2. **No collaborative signal.** A buyer who liked properties 17, 42, 88 should pull weight toward what *similar buyers* liked. There is no buyer-buyer similarity, no item-item co-occurrence, no embedding. For a long-tail catalog (most parcels are seen by few buyers) this would matter — pure CF would cold-start, but a **hybrid (content features + CF residual)** is the textbook play. AcreOS has only the content half.
3. **Score threshold is hard-coded at 40** (`buyerMatchingAI.ts:185, :279`). No calibration. No precision/recall curve. No A/B test infrastructure.

**Recommendation:** keep the heuristic in production, add an offline pipeline that *would* re-fit the weights from `buyerPropertyMatches.status='purchased'` outcomes the moment you have 200+ purchases per organization (or 2k cross-org if you are willing to share-train). Until then, the heuristic is fine — but the **`paxMemory` write on positive response** (line 832) is doing accidental implicit-feedback collection in an unstructured JSON blob. That is data debt. Move it to a typed `buyer_feedback_events` table with `(buyerProfileId, propertyId, factorScores, outcome, ts)` so it is trainable later.

The other smell in this file is `calculateZoningMatch:548` — the `zoningToUseMap` is a hard-coded substring lookup table (`"residential": ["residential", "r-1", "r-2", ...]`). That is a **vocabulary-collision waiting to happen**: every county has its own zoning code conventions, and a one-table-fits-all matcher will silently misclassify "RA-2" (rural-agricultural in some states, residential-agricultural in others) without telling anyone. The right object here is a per-county zoning normalization dictionary, ideally seeded from county GIS portals, ideally validated by a closed-loop on actual deal closes. None of that exists. The current code will look fine in dev and produce subtle ranking errors per-jurisdiction in production.

### 3.3 Lead scoring — **heuristic, but the decay function is principled**

`leadScoreDecay.ts` is the cleanest piece of work in the directory. 5%/week decay, +10/+15/+8 on interaction, drop-of-20 cold alert. This is **explicitly a Hawkes-process-flavored intensity decay**, just without the math. The choice to make it a heuristic instead of learned is correct — you would need ten thousand contact-outcome pairs to fit a meaningful temporal-decay model and it would not beat 5%/week by enough to matter. Leave it. The score-decay job (`processLeadScoreDecay`, line 161) is the right shape.

What is missing: **score history is stored** (`leadScoreHistory` table, written line 85) but no one is using it as a feature for downstream models, no one is computing per-org calibration (a score of 80 in Org A may correlate to a 20% close rate, in Org B to 5%), and no one is using it to validate the heuristic. Build the validation report. It is a SQL query, not an ML project.

A second concern in this file: the `applyScoreRecovery` constants (`+15` for call, `+8` for email, `+10` default — line 129) are asserted, never measured. At LinkedIn we ran a one-month interleaving experiment to learn that an InMail reply was worth ~3.4× a profile view in downstream conversion. The same calibration question applies here: **is a logged call really worth ~2× an email?** It might be worth more. It might be worth less. There is no feedback path that would ever tell you. Add an outcome attribution column on `leadScoreHistory` (`led_to_close BOOL DEFAULT NULL`) that gets backfilled when the lead transitions to `won` or `lost`, and you have the join key for a calibration query that takes a quarter to accumulate but pays for itself indefinitely.

### 3.4 Deal underwriting — **heuristic AND the right tool**

`dealUnderwriting.ts` is finance, not ML. IRR via Newton's method (line 62), DCF over three scenarios, argmax over wholesale/owner-finance/retail risk-adjusted profit. **Do not ML this.** The deterministic math is auditable, defensible, and what an investor reviewing a deal expects to see. The ML version of this would be a value-of-information disaster — you would replace a transparent calculation with a black box that the user cannot challenge. Hard-coded scenario triple (`base 3% / bull 7% / bear -2%` at line 245–249) should be **per-county**, not global, but that's a config change, not a model.

---

## 4. The data substrate — would ML even work here today?

The honest audit. Per-org data volume (extrapolating from schema cardinality and product stage):

| Signal | Likely volume per org / year | ML-ready? |
|---|---|---|
| `buyerPropertyMatches.status='purchased'` | 5–50 | No — too few for any per-org model |
| `leads` with outcome label | 500–5,000 | Borderline — usable for org-pooled logistic regression |
| Direct mail send→response pairs | 5,000–50,000 | Yes — usable for response-rate modeling |
| Property comp transactions | 10–500 | No — sparse, leaning on USDA NASS aggregates |
| Buyer profile preference vectors | 50–500 | No — embedding space too small to be useful alone |

**The only label-rich signal at AcreOS's stage is direct-mail response rate**, and *that* is not currently surfaced as a learnable target — `signals.touchCount`, `signals.hasResponded`, `signals.lastContactDaysAgo` (`leadIntelligenceEngine.ts:160`) are read into a rules engine, never aggregated as `(seller_features → response_rate)` training pairs. **This is the single most valuable ML opportunity on the platform** and it is invisible in the current code.

The right first model to ship is a **mailing response-rate predictor**: features = (county_validation_signal, taxDelinquentYears, isOutOfState, yearsOwned, isInherited, isCorporate, touch_number, message_angle), label = `responded ∈ {0,1}` from the next 30 days. Logistic regression with org-level random effects. Would beat the rules engine on test for response-rate prediction, would let you optimize letter sequencing, and would not require a feature store — it could be a nightly Python job writing a `predicted_response_rate` column. That is the ML beachhead.

A second-tier candidate is **county-validation classification** — given USDA NASS pasture-value trend, comp count, comp variance, days-on-market dispersion, predict whether a county will hit the "3 of 5 acceptance" threshold at the standard 25% offer ratio. AcreOS asserts this threshold (`blindOfferCalculator.ts:344`, `compCount >= 10` flips `isCountyValidated`). That is a single hand-picked feature with a single hand-picked threshold. The actual relationship between comp density and acceptance rate is empirical and almost certainly non-linear — and once you have one quarter of multi-county campaign outcomes you can fit a much better classifier. Same modeling toolkit (logistic regression), same nightly batch, no feature-store dependency. That is the second model you ship, six months after the first.

---

## 5. MLOps maturity — score 0.5 / 5

What I look for, what AcreOS has:

| Capability | Industry baseline | AcreOS today |
|---|---|---|
| Feature store (online + offline parity) | Feast / Tecton / in-house | None. Features re-computed inline per request in `extractSignals()` |
| Offline eval harness | Held-out replay, NDCG/MAP/precision-at-k | None. No regression test on score quality. |
| Model registry / versioning | MLflow / Vertex / SageMaker | N/A — no models |
| A/B / interleaving infra | Treatment buckets in request middleware | None visible. No experiment framework. |
| Telemetry of recommendations shown | Impression logging, position bias correction | `match_presented_to_buyer` event exists (`buyerMatchingAI.ts:795`) — good. Position rank not logged — bad. |
| Outcome labels closed-loop | Click/conversion → label store | Partial. `recordBuyerResponse` writes to `paxMemory` (line 858) and updates `buyerPropertyMatches.status`. Trainable but unstructured. |
| Drift / staleness monitoring | PSI, KL on feature dist, score dist | None. |
| Cold-start strategy | Explicit handling for new users / new items | Implicit — `null` preferences fall through to default scores (60–70). Not principled. |

The 0.5 is for `leadScoreHistory` and the `match_presented_to_buyer` agent event — those are seeds of an outcome-labels-closed-loop. Everything else is missing. Calling this MLOps is generous; it is **observability of a rules engine**, which is what you should have at this stage, but should not be confused with infrastructure you can build a model on top of.

---

## 6. Cold-start — handled implicitly, badly

A new buyer profile with empty `preferences` will return score 60–70 on most factors (`calculateLocationMatch:483`, `calculateZoningMatch:527`, `calculateFeatureMatch:580`). That means **a buyer who told you nothing gets nearly the same matches as a buyer who specified everything**. The 60–70 default is high enough to clear the 40 threshold, so a fresh buyer will be matched against the entire inventory, ranked essentially by price-fit alone.

This is the classic cold-start anti-pattern. The right pattern: **explicitly mark uncertainty**. Every factor score should carry a `confidence ∈ [0,1]` that downweights its contribution, plus a separate `informationGain` metric that surfaces "ask the buyer about zoning preference — it would change ranking by 23 percentile points." The `dataCompleteness` field on `LeadIntelligenceProfile` (line 117, set at line 397–404) is the right idea — but it is **reported, not used**. It does not feed back into ranking, it does not gate which leads get auto-matched, it does not flag low-completeness leads for human review. Wire it up.

For new properties (item cold-start) it is worse — there is no "newly listed" lift, no diversity term in ranking, no exploration. A property added today will be ranked identically to one that's been sitting for 90 days, with no attempt to gather feedback signal on the new item. At Spotify we ran a 10% exploration slot on every recommendation list. AcreOS runs zero. For a small inventory (< 1k properties per org) this is fine. The day a customer crosses 5k properties, the lack of exploration will silently kill matching quality on new listings.

---

## 6.5 Evaluation — the missing harness

Even before any model exists, the recommendation system has zero evaluation. There is no offline replay, no held-out validation, no "if I had ranked yesterday's matches with weights X vs weights Y, which would have predicted today's `purchased` outcomes better." That is the table-stakes harness for any ranking system, and AcreOS would benefit from it **today, against the current heuristic**, because right now no one can answer the question "would shifting the price weight from 25% to 30% improve match outcomes?" The answer is unknown and unknowable. With six lines of SQL and one Jupyter notebook you could compute NDCG@5 for the current weighting against historical `buyerPropertyMatches` outcomes, vary the weights on a grid, and surface the empirical optimum. That is not ML. It is grid search over a closed-form scoring function. It would still be a 10× upgrade over the current "weights chosen because they sum to 100" methodology.

The same evaluation gap exists for `motivationGrade`. The grade is a categorical bucket (A+, A, B+, B, C, D — `sellerMotivationEngine.ts`) and presented to users as if it carries semantic meaning. Whether an A+ lead actually closes more often than a B is an empirical question that is **never asked anywhere in the codebase**. Confusion-matrix-style validation against `deal.status='won'` would tell you in one query whether the grade buckets are predictive, monotonic, or noise. My prior, having looked at how the buckets are constructed: they are mostly capturing tax-delinquency-presence, and the rest of the signal is decorative. That is fine if true, but you should know.

## 7. Feedback loops — the Spotify lesson

The thing that lost me three months at Spotify: **if your recommender ranks based on engagement, and engagement depends on what the recommender shows, you are training on a non-stationary distribution shaped by your own past biases**. The fix is impression-weighted training, propensity scoring, and at least 5% randomized exposure.

AcreOS's loop today:

1. `matchPropertyToBuyers` ranks by hand-tuned weights → top matches presented.
2. `recordBuyerResponse` logs interest/purchase → `paxMemory` writes "buyer prefers X" inferred from the shown property's attributes.
3. Future matches lean toward X.

**Step 2 is the leak.** "Buyer marked interested" in a property they were *shown* is not the same signal as "buyer prefers properties like this in general." If you only show them 5-acre Texas parcels, they will only mark interest in 5-acre Texas parcels, and `paxMemory` will harden that preference, and the next match round will doubly favor 5-acre Texas. Without exploration this is a positive-feedback collapse. Today the system is small enough that it doesn't matter. At scale it will, and the rules-engine origin will mask it (you will look at the weights and they'll all be sensible, and the system will still be wrong).

**Mitigation that costs nothing today:** when writing the `paxMemory` fingerprint (`buyerMatchingAI.ts:858`), record *not just the matched property's attributes* but the **full set of properties the buyer was shown and rejected**. That is the contrast that lets a future model learn what they *actually* prefer vs what they happened to be offered. Right now you write only the positive signal. Capture the negatives.

---

## 8. The LLM-as-recommender anti-pattern (not yet, but watch for it)

`generateMatchPitch` (line 687) and `analyzeBuyerPreferences` (line 1017) use gpt-4o for **prose generation downstream of the ranking**. That is fine. The temptation, which I have seen at three companies, is to creep this into the ranker — "ask gpt-4o to rank these 50 properties for this buyer." **Do not.** It is unauditable, non-deterministic, expensive at high cardinality, and gives you a recommender you cannot debug or A/B against. Today AcreOS has not made this mistake. The architecture is the sober one — heuristic ranking, LLM for explanation. Keep it.

---

## 9. Concrete recommendations, ranked by ROI

1. **Build the mail response-rate predictor** (logistic regression, nightly batch). Highest-volume label, clear business value, no feature store needed. ETA: 2 weeks of one engineer.
2. **Capture negatives in `paxMemory`** — every property shown and not engaged with, alongside the engaged ones. Cost: schema change + one hook in `presentMatchToBuyer`. Pays off the day you train any matching model.
3. **Add per-org calibration of `motivationGrade` → close-rate.** Pure SQL/dbt query against `leadScoreHistory` and deal outcomes. Tells you whether a "B+" means the same thing in Org 12 as Org 47. Likely answer: it doesn't, and you have a leak.
4. **Replace the hard-coded match threshold (40) with a per-org learned cutoff** that targets a precision goal (e.g. "show buyers matches such that 60% are 'interested' or better"). Online estimator, no model. Two days of work.
5. **Promote `dataCompleteness` from reported to used** — gate auto-matching on completeness > 50, surface "fill these fields to improve match quality" as a UX prompt with quantified lift. One day.
6. **Stop calling it "AI matching" / "AI service"** in code identifiers. `buyerMatchingService` (without the AI) is honest and removes the upgrade-path tax of having to either ship real ML or rename later. Cosmetic but matters for technical credibility.
7. **Build the offline replay harness** described in §6.5. NDCG@5 over historical `buyerPropertyMatches` against gridded weight variants. Two days of work, one notebook, recurring value. The output is also the first thing a future ML model has to beat, which sets the bar for whether any model is worth deploying.
8. **Per-county zoning normalization dictionary** seeded from county GIS portals, replacing the substring-collision hash table at `buyerMatchingAI.ts:548`. Boring infrastructure. Quietly fixes a class of silent ranking errors that no test will ever catch.

---

## 10. Final read

AcreOS made the right call by not shipping ML. The data isn't there, the team to operate it isn't there, and a rules engine you can read in an afternoon is more debuggable than a model you can't. The **risk is sleepwalking** — keeping the rules engine in production for three more years while the data accumulates and never building the offline eval harness, label store, or feedback-loop hygiene that would let you switch on ML the day it actually starts to win. The work to *prepare* for ML — typed event capture, negative-feedback logging, per-org calibration reports — is cheap *now* and impossibly expensive to retrofit *later* against a million-row unstructured `paxMemory` blob. Do it now. Don't ship a model. Ship the substrate.
