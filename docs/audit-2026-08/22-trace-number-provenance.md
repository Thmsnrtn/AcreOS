# T3 — Number Provenance Trace

*Slice T3. Read-only. Five prominent displayed numbers traced backward: render (client file:line) → API → service → query → source table → writer.*

**State of the region:** The number-honesty culture here is real and unusually strong. Occupancy (`routes-rentals.ts:279`), the founder monthly letter (`founderNarrative.ts` — "unmeasured" not a fake zero, refuses percentages under 10 scored outcomes), the autopilot forecast (`forecast.ts` — Laplace prior, `"none"` confidence at n=0, honestly refused in both server and client renderers), and every dollar tile I checked guards empty sets with `> 0 ? … : "—"`. The `lint:no-fabrication` regex is doing its job on literal fakes.

**The single defect class that survives every gate here:** **honestly-sourced numbers wearing a label that overstates what they measure** — a projection printed as realized cash, a model prediction printed as if computed from the operator's own parcel, an arithmetic index printed as a measured percentage, a decorative constant printed as a "confidence," and a cheap model's restatement printed as a grounded figure. The query is real, so the regex passes; the number answers a *different question* than the label asks. No gate in the repo compares a rendered label's claim to its query's actual semantics.

---

### F-22-1 — Today "Cash position" tile shows projected note income, and its own sparkline plots a different source
**Severity:** P2 real
**Surfaced by:** T3
**Survives which gates:** `lint:no-fabrication` (regex over string literals — cannot see that an aggregate answers a different question than its label); `npm run check` (types are correct — it *is* a number); no ratchet or test asserts label-vs-query semantics. The empty-state guard (`> 0 ? … : "—"`) is present and correct, so nothing fires on a zero account either.
**Evidence:**
- render: `client/src/components/today/CashStrip.tsx:85` header **"Cash position"**, `:89` value `cashOnHand`, `:96` sub-label **"90d projected receipts"**, `:93` sparkline label **"Cash position (90d completed payments per week)"**.
- API: `GET /api/today` → `server/routes-today.ts:1453` `cashOnHand: projected90`.
- service/query: `routes-today.ts:1319-1320` `projected90 = sumPayments(within(90))`; `:1310-1317` `within(90)` = active notes whose `nextPaymentDate` is 0–90 days out; `sumPayments` sums each note's `monthlyPayment` **once**.
- source table: `promissory_notes` (`allNotes`), columns `monthlyPayment` / `nextPaymentDate` / `status`.
- sparkline source (same tile): `routes-today.ts:1337-1363` `cashHistory` = SUM of `payments.amount` where `status='completed'` bucketed per week — a **different table and a different metric** from the headline.
**What's wrong:** The headline is not "cash position": it is the sum of a single month's scheduled payment for each active note that has a payment due within 90 days. A monthly note pays ~3× in 90 days, so the number *undercounts* recurring receipts while the "90d" label implies a 90-day total. Worse, the tile's trend line plots realized completed payments — a genuinely different quantity — under the same "Cash position" heading, so the number and its sparkline disagree by construction.
**Impact:** Burns trust after sale. A note investor (the persona this tile is tuned for) reconciles this against their servicer and finds it matches neither cash on hand nor 90-day receipts. First thing they see behind the Today door.
**Fix:** Rename the tile to what it computes ("Scheduled note income, next 90 days") OR make it a true 90-day projection (sum each note's payments that actually fall in the window, not one each). Make the sparkline plot the same quantity as the headline, or split into two labeled tiles.
**Gate it:** Add a `today.cash.test.ts` unit asserting `cashOnHand` for a fixture of 3 monthly notes ($500 each, all due in-window) equals the label's promise, and that headline metric === sparkline metric semantics. Baseline: currently 0 such assertions.
**Effort:** S
**Blast radius:** `CashStrip.tsx`, `routes-today.ts` cash block, one test.
**Confidence:** high — labels and query read directly.

---

### F-22-2 — AVM "trained model estimate" is computed over fabricated feature-default constants
**Severity:** P2 real
**Surfaced by:** T3
**Survives which gates:** `lint:no-fabrication` (the constants are ordinary numeric defaults inside a service, not a placeholder string in a rendered literal); no ratchet; no AVM eval. The methodology-label discipline (`routes-avm.ts:191-201`) was built precisely to prevent masquerading — but it labels *provenance of the method*, not *provenance of the inputs*, so a model run over invented inputs still earns the "trained model" label.
**Evidence:**
- render: `client/src/pages/avm.tsx` estimate card + confidence bar; methodology string rendered verbatim.
- API: `POST /api/avm/property/:id` → `server/routes-avm.ts:146` `acreOSValuation.generateValuation`.
- service: no comps → `acreOSValuation.ts:312 generateMarketEstimate` → `:539 gbmEstimatePricePerAcre(acres, 0, characteristics, {})`.
- the fabricated inputs: `acreOSValuation.ts:75` `pricePerAcreComps: … || 1000`, `:77` `distanceToHighwayMiles: 5`, `:78` `distanceToCityMiles: 20`, `:82` `soilQualityScore: 5`, `:85` `countyMedianIncomeK: 55`, `:86` `populationGrowthPct: 0`.
- label: `routes-avm.ts:193` `gbm_model → "AcreOS trained model estimate (no local comparables)"`.
- latent sibling: `avm.tsx:216-217` fabricates a ±15% band `estimatedValue * 0.85 / * 1.15` as fallback, rendered as "confidence-range band" (`:226`). Currently dead because `/history` always supplies `confidenceInterval` (`routes-avm.ts:233-236`), but it is one server change from shipping an invented CI branded as model confidence — and it is ungated.
**What's wrong:** When there are no comparables and a GBM artifact exists, the price-per-acre the operator sees for *their* parcel is a model prediction in which ≥5 of ~12 features are hardcoded national constants that describe no real parcel (5 miles to highway, 20 to a city, $55K county income, $1,000/acre comp seed). The output is then labeled a "trained model estimate," which reads as a data-driven valuation of that specific parcel.
**Impact:** Burns trust after sale; a wrong valuation can also drive a real offer. Reachable whenever a `gbm_valuation.json` artifact is mounted and the org has no local comps (the common early state).
**Fix:** Pass real per-parcel feature values (GIS enrichment already computes distance-to-road/city and soil; wire them in for the no-comps path) or degrade the label to "trained model estimate using regional defaults for N unmeasured features" and drop confidence accordingly. Delete the `avm.tsx:216` synthetic band; render the real zero-width band the server already sends.
**Gate it:** Unit test asserting `gbmEstimatePricePerAcre` throws/refuses (or lowers confidence + changes the label) when >2 features fall back to defaults. Add `avm.tsx` synthetic-band expression to the fabrication lint's AST denylist. Baseline: 0 assertions on input provenance today.
**Effort:** M
**Blast radius:** `acreOSValuation.ts`, `routes-avm.ts` labels, `avm.tsx` chart.
**Confidence:** high on the mechanism; medium on live reachability (depends on whether a GBM artifact is deployed — raise by checking `server/ml/artifacts/`).

---

### F-22-3 — "Portfolio cash flow health" is an arbitrary linear index rendered as a measured percentage
**Severity:** P3 minor
**Surfaced by:** T3
**Survives which gates:** `lint:no-fabrication` (it's live arithmetic over real ledger figures, not a literal); no test pins the scale's meaning. Contrast: occupancy (`routes-rentals.ts:279-321`) is the **clean control** — it explicitly refuses to print a percentage over zero rentable units, clamps >100%, and returns an `unmeasurable` reason rather than a fake 0% or 100%. The cash-flow health gauge got none of that discipline.
**Evidence:**
- render: `client/src/pages/cash-flow.tsx:236` "Portfolio cash flow health", `:254-261` a 0–100% bar with `aria-valuenow={Math.round(cashFlowHealthPct)}`.
- computation: `cash-flow.tsx:189-190` `coverageRatio = (net + obligations)/obligations`; `cashFlowHealthPct = Math.min(100, Math.max(0, (coverageRatio - 0.8) * 100))`.
- source: `GET /api/cash-flow/portfolio/summary` → `summary.totalMonthlyNet` / `totalMonthlyExpenses`.
**What's wrong:** `(coverageRatio − 0.8) × 100` is a made-up mapping: coverage 1.0 → "20% health", 1.8 → "100%", clamped both ends. The 0.8 offset and ×100 gain have no financial meaning; the number reads as a measured percentage (progress bar + `aria-valuenow`) but is a hand-tuned index. A prospect cannot reconstruct it and it does not equal any accounting quantity.
**Impact:** Neither blocks the sale nor clearly burns trust — it is decorative — but it is a screen-reader-announced "percentage" that means nothing, and it sits next to genuinely honest finance figures, lending them false company.
**Fix:** Either show the coverage ratio itself (a real, interpretable number: "1.4× obligations covered") or gate the gauge behind an explicit, documented rubric and label it "health index (not a measured %)". Mirror the occupancy `unmeasurable` pattern when obligations are 0.
**Gate it:** None cheap for "is this index meaningful" — but a test can pin the empty/zero-obligation case to render "—" not a bar. Baseline: `coverageRatio` is `null`-guarded (good) but the rendered % has no test.
**Effort:** S
**Blast radius:** `cash-flow.tsx` gauge only.
**Confidence:** high.

---

### F-22-4 — Founder MRR-trajectory forecast attaches a fabricated "confidence" constant and extrapolates milestones from ≤2 points
**Severity:** P2 real
**Surfaced by:** T3
**Survives which gates:** `lint:no-fabrication` (the confidence value is computed arithmetic, not a literal placeholder); `constitution.test.ts` (not a hard-stop); no calibration gate reaches this route. Ironic contrast: the founder *letter* on the very same surface refuses to quote percentages under 10 scored outcomes (`founderNarrative.ts:60-61`, `buildCalibrationParagraph`), but this MRR route hands the founder a "confidence" with zero relationship to sample size.
**Evidence:**
- render: `client/src/components/dashboard/MRRTrajectory.tsx:61` queries `/api/founder/intelligence/mrr`; `:100-111` prints "On track to hit $X/mo by MONTH" / "Projected $X/mo in 3 months" from the forecast line.
- API: `server/routes-founder-intelligence.ts:624` `forecast = forecastLinear(revenues, 3)`; `:636` `confidence: Math.max(0.3, 0.9 - i * 0.15)`.
- forecaster: `routes-founder-intelligence.ts:1098-1111` — ordinary least-squares slope over the monthly revenue array; `:1099` returns a flat fill when `< 2` points.
- source: `subscriptionEvents` / revenue aggregates per month.
**What's wrong:** The `confidence` field (0.9, 0.75, 0.6) is a decorative constant purely of the forecast horizon `i` — it does not depend on the number of data points, the regression residuals, or anything measurable. With exactly 2 revenue months (the state right after the first customer), OLS draws a straight line through 2 points and the milestone statement will assert "On track to hit $1,000/mo by [month]" as a confident extrapolation from a two-point slope, decorated with "90% confidence." The founder's own instrument overstates certainty about the founder's own revenue.
**Impact:** Burns the founder's trust in the dashboard, and could shape real spend/hire decisions off a two-point extrapolation. Founder-facing, active the moment revenue is non-flat.
**Fix:** Derive `confidence` from n and fit quality (or drop it); suppress the milestone/"on track" statement until ≥N (e.g. 4) revenue months exist, mirroring the letter's ≥10 discipline. Widen or hide the forecast band under small n.
**Gate it:** Unit test asserting `/mrr` returns `confidence: null` (or omits the forecast) for a <4-month revenue series, and that `confidence` moves with n. Baseline: `forecastLinear` has a `<2` guard but 0 tests on the confidence field.
**Effort:** S
**Blast radius:** `routes-founder-intelligence.ts` mrr handler, `MRRTrajectory.tsx` statement.
**Confidence:** high — read the constant directly.

---

### F-22-5 — Pax-composed morning brief emits customer-money numbers with only a prompt-level "do not invent" guard and no numeric validation
**Severity:** P2 real
**Surfaced by:** T3
**Survives which gates:** The eval matrix scores Pax on **tone only** (per `00-orientation.md`: one surface × one dimension × one Haiku judge) — factual/numeric grounding is unjudged. `lint:no-fabrication` cannot see model-generated text at runtime. No test asserts the composed sentence's numbers equal the inputs. The static template path (`composeBrief`) is deterministic and safe; the composed path is not.
**Evidence:**
- render: `MorningBrief` on Today (the sentence above the decision queue).
- API/service: `server/routes-today.ts:1440-1445` `composed = composeBriefWithPax(...)`, then `brief = composed ?? composeBrief(...)`.
- the only guard: `routes-today.ts:996` system prompt string **"Use only the numbers given — do not invent."** — a request to the model, not an enforced invariant. Model is the cheap tier (`:958-959` MODEL_SIMPLE/deepseek). No post-generation check that the emitted digits match `briefInputs`.
- inputs it may restate: `pipelineValue`, `netInflow30`, `lateNotes` (`routes-today.ts:1427-1436`).
- adjacent overstatement even in the *static* path: `routes-today.ts:923/929` "the tape still clears / cleared $X this month" prints scheduled note income (`projected30`) as realized cash; `:935` "$pipelineValue on the table this week" labels total active-deal value as a weekly figure.
**What's wrong:** When `PAX_COMPOSED_BRIEF` is enabled, the number-bearing sentence a customer reads is produced by an unverified cheap model whose only constraint against misstating their own money is a sentence in the prompt. Nothing compares output to source. The tone-only eval would pass a brief that says "$14,200 clears this month" when the input was $4,200.
**Impact:** Burns trust after sale; the failure is silent (no error, plausible text) and lands on the customer's own financial numbers on the first door. Gated behind a feature flag today, so latent — but the flag is the only thing between it and production.
**Fix:** Post-validate the composed sentence: extract numeric tokens and reject (fall back to the deterministic template) if any digit-group is not one of the supplied inputs. Also correct the static templates' "clears/cleared" and "this week" verbs to match the projection semantics.
**Gate it:** `composeBriefWithPax` unit test with a stub model returning an invented figure → assert the route falls back to `composeBrief`. Add a numeric-token validator between model output and return. Baseline: 0 numeric-grounding assertions on any Pax surface today.
**Effort:** M
**Blast radius:** `routes-today.ts` brief block; the numeric-validator helper is reusable for other Pax-cited figures.
**Confidence:** high on the missing-guard mechanism; medium on live impact (flag-gated — raise by checking `PAX_COMPOSED_BRIEF` in deployed env).

---

## Coverage ledger

**Examined exhaustively (read end-to-end, both ends of the chain):**
- Today cash strip: `client/src/components/today/CashStrip.tsx` (full) + `server/routes-today.ts` cash/receipts/progress/brief blocks (`:1230-1470`, `:892-1001`).
- AVM: `server/routes-avm.ts` (full, 354 lines) + `server/services/acreOSValuation.ts` GBM/market-estimate/residential/stats paths (`:28-97`, `:275-680`, `:1063-1131`).
- Occupancy (clean control): `server/routes-rentals.ts:270-342`.
- Cash-flow health: `client/src/pages/cash-flow.tsx:160-267`.
- Founder MRR forecast: `server/routes-founder-intelligence.ts:575-644`, `:1098-1116` + `client/src/components/dashboard/MRRTrajectory.tsx:61-135`.
- Autopilot forecast (verified honest, no finding): `server/services/autopilot/forecast.ts:40-80`, `client/src/pages/founder/autopilot-story.tsx:155-194`.
- Founder letter tick-metric/calibration (verified honest, no finding): `server/services/founderNarrative.ts:110-180`, `:483-526`.

**Examined by sampling:** unit-economics (`server/services/unitEconomics.ts:275-353` — noted a latent `fixedCostShareUsd = totalFixedMonthlyUsd()/activeCustomers` divide that is safe only because `isPaying` implies `activeCustomers ≥ 1`; not promoted to a finding); `getTrainingDataStats` reads `transactionTraining` globally across orgs by design (anonymized corpus) — flagged for T4 (tenant) as an aggregate-shown-per-org question, not fabrication.

**Did NOT examine:** Pax *chat* tool-call figures (portfolio summaries Pax quotes interactively) beyond the morning brief — T3's brief covers the cited-figure class; the chat-tool grounding belongs to slice 08 (AI systems). Map/parcel intel panel numbers beyond the free-read AVM path. Buyer/investor analytics dashboards. Commission/tax computed figures. Whether a GBM artifact is actually deployed (F-22-2 reachability). Whether `PAX_COMPOSED_BRIEF` is enabled in any live env (F-22-5 reachability).

## Constitution Collisions

None. Every finding is a labeling/provenance defect on an existing surface; none proposes a new nav entry, a new AI destination, a marketplace/API surface, or any money-custody change. The fixes (rename a tile, validate a number, drop a decorative constant) are all in-place corrections. F-22-2 and F-22-5 *strengthen* the standing "fabrication is never acceptable" hard-stop by extending it to input-provenance and model-restated numbers, which the current `lint:no-fabrication` regex cannot reach.
