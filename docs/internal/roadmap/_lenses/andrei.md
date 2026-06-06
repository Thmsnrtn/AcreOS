# Andrei — AI/ML Engineer — First-Customer Roadmap Lens

> Role: Pax architecture, prompts, evaluation, hallucination mitigation, cost-aware model + data routing.
> Standard I enforce: eval-first, cost-aware-by-default, the number is the truth. No prompt or grounding change ships on vibes.
> Dated 2026-06-06. Phase 0 active, pre-first-customer.

## The one-sentence thesis

Free open-source land data (county GIS, SSURGO soils, FEMA NFHL, USGS, USFWS wetlands, TIGER) is already flowing into AcreOS through the provider registry and the enrichment service — **but Pax cannot yet cite it, date it, or be held to it.** The single highest-value AI move before first customers is to make Pax's data answers *attributable and falsifiable*: every flood/soil/acreage/zoning claim carries a source name, a vintage, and a confidence, and the hallucination guard actually fires on the main chat path (today it does not). Get that right and the free tier *feels* premium because Pax sounds like a careful analyst, not a confident guesser.

## What I found in the codebase (grounding for this plan)

- **Provider registry is solid** (`server/services/providers/provider-registry.ts`): tier-ordered, cost-aware, circuit-breaking, `provider_cache`-backed. `open-data` (cost 0) + `county-gis` (priority 5, free) are registered ahead of paid Regrid/ATTOM/BatchData. The phased free→paid upgrade path is *already encoded in the tier ordering* — paid providers only get tried when an org's tier allows and free ones miss. This is good architecture and I want to build on it, not replace it.
- **Pax has the right tools** (`server/ai/tools.ts`): `research_property` (line 1787) runs the full ~20-category enrichment via `propertyEnrichmentService.enrichByCoordinates`; `get_property_enrichment` (1819) reads the stored blob. `create_property` auto-fetches parcel boundary. So Pax *can* reach real data.
- **THE GAP #1 — no per-fact attribution into the prompt.** `research_property` returns the whole `enrichment` object plus a `completenessScore` to Pax. The enrichment service *does* track `source` per category (`server/services/propertyEnrichment.ts`, fields at lines 376–448) and the broker returns `source.title`, `fromCache`, `cachedAt`, `costCents` per `BrokerResult` (`server/services/data-source-broker.ts:51-64`) — but that provenance is flattened out before it reaches Pax. Pax sees `floodZone: "AE"` with no "(FEMA NFHL, effective 2021-09)" attached. So even when the data is real, Pax can't cite it, and can't distinguish a fresh county hit from a 30-day-stale cache.
- **THE GAP #2 — the hallucination guard is effectively dormant on the main path.** `guardPaxOutput` (`server/services/paxHallucinationGuard.ts`) is well-built: numeric/ARV detection + cross-org entity-existence checks. But in `server/ai/executive.ts:1753-1757` it is invoked with **only** `{ organizationId, output }` — no `sourceNumbers`, no `claimedPropertyIds`. Result: the entity-existence check never fires (no IDs passed), and the numeric check has no source set to compare against, so it falls back to the weak freeform heuristic. We have a safety net that's been folded up in the closet.
- **THE GAP #3 — no data-grounded eval coverage.** The eval harness exists and is real (`server/services/aiEvalHarness.ts` — `ai_test_cases`/`ai_test_runs`, contains-check v0, `EvalGateRejectedError` gate). But there are no test cases that assert "when the flood lookup returns AE, Pax says AE and cites FEMA" or "when soil data is missing, Pax says it's missing rather than inventing a soil class." We can't claim a hallucination rate we don't measure.
- **THE GAP #4 — anti-hallucination grounding language is one weak line.** `server/services/pax/verticalSystemPrompt.ts:120` has a single "don't over-claim expertise" sentence; `personas.ts` has zero instruction about *data* claims (never state a flood zone / soil class / acreage you didn't retrieve, always cite source + vintage, say "I don't have that" when a lookup missed).

## Top work items (priority order)

### 1. Wire the hallucination guard into the live Pax path with real source context
- **Why it matters to first customers:** This is the difference between "Pax told me it's not in a flood zone and it was" (a trust-ending, possibly liability-bearing error on a land deal) and a careful assistant. Right now the guard is built but blind. A flood-zone or acreage hallucination on a customer's first real deal is the worst possible first impression.
- **Goal served:** rock-solid + happier-customers.
- **Effort:** S (the guard exists; this is plumbing + extraction).
- **Phase:** 0.
- **Dependencies:** none — `guardPaxOutput` already accepts the fields.
- **First step:** In `server/ai/executive.ts` around line 1753, extract the numbers and property IDs that appeared in tool results during the turn (from `toolCallsExecuted`) and pass them as `sourceNumbers` + `claimedPropertyIds` to `guardPaxOutput`. Add `parcel_data` numeric facts (acreage, APN-derived) to `sourceNumbers`. Then make the result *advisory-rendered* (banner) for `warning` and *block-and-retry* for `error` severity, consistent with the guard's `safe` flag.

### 2. Structured data-provenance envelope from `research_property` → Pax
- **Why it matters:** Lets Pax cite. "This parcel is in FEMA Zone AE (FEMA NFHL, panel effective 2021-09-17; confidence high)" reads premium even on 100% free data. It also makes Gap #1 the *enabler* for #1's source-checking and #3's eval.
- **Goal served:** flawless-ux + data + rock-solid.
- **Effort:** M.
- **Phase:** 0→1.
- **Dependencies:** none structurally; touches enrichment service + tool return shape.
- **First step:** In `propertyEnrichment.ts`, stop discarding `source.title`, `cachedAt`, `costCents`, and a normalized `confidence` per category — bubble a `{ value, source, asOf, confidence, cached }` envelope up. In `tools.ts:research_property`, return that envelope instead of the flat blob. Add a short prompt rule (item #4) telling Pax to cite `source` + `asOf` whenever it states a data fact. Keep it compact — token budget matters; one provenance line per fact, not a JSON dump.

### 3. Data-grounded eval set + gate for parcel/flood/soil claims
- **Why it matters:** I can't tell Tom "Pax's data-hallucination rate is X%" without this. It's the regression net that lets us iterate prompts and swap models safely as we grow.
- **Goal served:** rock-solid + foundation.
- **Effort:** M.
- **Phase:** 1 (seed a v0 in Phase 0).
- **Dependencies:** #2 (provenance envelope makes assertions checkable).
- **First step:** Seed ~20 `ai_test_cases` rows for `surface=pax_inbox` covering: (a) lookup returns a value → Pax must state it + cite source; (b) lookup *misses* → Pax must say "I don't have that data" and must NOT name a flood zone/soil class (forbidden-trait check); (c) cross-org property ID → must refuse. Wire into the existing `runEvalGate`. These double as adversarial cases for the guard in #1.

### 4. Pax data-grounding system-prompt module (versioned)
- **Why it matters:** The behavioral spine for all of the above. Cheapest lever, highest reach — every Pax answer is shaped by it.
- **Goal served:** flawless-ux + rock-solid.
- **Effort:** S.
- **Phase:** 0.
- **Dependencies:** pairs with #2; must clear Beatrice (immutables #1 lying, #7 AI disclosure).
- **First step:** Add a `DATA_GROUNDING` block to the Pax system prompt (assembled near `personas.ts`/`verticalSystemPrompt.ts`): never assert a flood zone / soil class / acreage / zoning / owner you didn't retrieve this turn; always cite source + vintage; when a free source missed, say so plainly and offer the paid-tier upgrade path rather than guessing. Version it via `server/ai/paxPromptVersions.ts` with a changelog + an eval delta from #3. No merge without the eval number.

### 5. Cost-aware ingestion guardrails for the free open-data tier
- **Why it matters:** Free APIs aren't free of *cost* — they're rate-limited and slow (FEMA/USGS can be 2–12s). On the hot Pax path, an unbounded `enrichAll` across 20 categories is a latency and reliability liability. Customers feel slowness as "Pax is broken."
- **Goal served:** rock-solid + data.
- **Effort:** S–M.
- **Phase:** 1.
- **Dependencies:** registry already has circuit-breaking + `provider_cache`; this tunes it.
- **First step:** For interactive Pax turns, fetch only the 3–4 categories the question needs (parse intent) and serve the rest from the stored enrichment blob; push full 20-category enrichment to the background job (`research_property` with a "enriching in background" ack). Lengthen `provider_cache` TTL for slow-changing layers (SSURGO soils, TIGER boundaries change yearly — 24h default is wasteful) while keeping flood/ownership shorter. Surface a per-turn data-latency p95 so I can watch it.

### 6. Confidence-and-staleness surfacing in Pax answers
- **Why it matters:** A premium free tier is honest about its limits. "County last refreshed this parcel 14 months ago" turns a data weakness into a trust signal.
- **Goal served:** flawless-ux + happier-customers.
- **Effort:** S.
- **Phase:** 1→2.
- **Dependencies:** #2 (needs `asOf`/`confidence` in the envelope).
- **First step:** Map the broker's `confidence` + `cachedAt` to plain-language hedges in the grounding prompt ("high/likely/uncertain" + "as of <date>"). Add one eval case per band.

### 7. Model-routing for data-grounded synthesis (cost optimization)
- **Why it matters:** Data-grounded answers are mostly *extraction + careful restatement*, which a cheaper model does well once the provenance envelope is structured. Routing the data-summary turns to Sonnet/Haiku (with Opus reserved for multi-parcel reasoning) cuts token cost materially as volume grows — directly relevant while Tom self-funds.
- **Goal served:** foundation + data.
- **Effort:** M.
- **Phase:** 2 (my activation phase — flag now, build then).
- **Dependencies:** #3 eval set must be green first; cannot route customer-facing synthesis below Beatrice's safety bar without an eval supporting it.
- **First step:** Once #3 exists, run the data-grounding eval across Opus/Sonnet/Haiku, record pass-rate + cost-per-call + p95, and route the lowest-capable-that-passes per task type via `paxModelTier.ts`.

## The open-data theme, from my lens

The provider registry already *is* the phased free→paid path: free providers (`open-data`, `county-gis`) are priority-ahead and cost-0; paid ones (Regrid/ATTOM/BatchData) sit behind tier gates and only fire on miss or upgrade. I don't want to rebuild that — I want to make the **AI layer trustworthy on top of it.**

My recommendations, lowest-cost-first:
1. **Make free data *feel* premium through attribution, not volume.** A Pax answer that says "FEMA Zone X, USDA soil class IIe, ~9.3 ac per county GIS, effective dates cited" beats a paid-data dump with no provenance. Attribution is a prompt + plumbing cost, not a data-fee cost.
2. **Never let Pax launder a free-data *gap* into a confident answer.** The grounding prompt + the (now-live) guard + the eval forbidden-traits are the three locks. This is the single biggest hallucination risk on this product and it's addressable for ~free.
3. **Treat the paid upgrade as a Pax-surfaced moment, not a silent fallback.** When a free lookup misses, Pax should say "county GIS doesn't have this parcel's ownership; a paid lookup would — want me to use a credit?" That converts the free tier's honest limits into the upgrade narrative Lena/Soren want, with zero standing data cost.
4. **Cache aggressively, fetch lazily.** Soils and boundaries are effectively static; flood and ownership drift. Per-layer TTLs (item #5) keep the free APIs from being our reliability bottleneck.
5. **Defer paid embeddings/data spend until MRR justifies it** — consistent with my charter (embeddings go production at Phase 2). For now, ground on retrieved facts in-context; no vector spend needed for parcel attribution.

## Quick wins (days, not weeks)

- Pass `sourceNumbers` + `claimedPropertyIds` into `guardPaxOutput` in `executive.ts` — activates a guard that's already written (item #1, half a day).
- Add the `DATA_GROUNDING` prompt block (item #4) — biggest behavior change per line of code.
- Seed 5–10 data-grounding eval cases now (subset of #3) so the next prompt change has a number attached.
- Lengthen `provider_cache` TTL for SSURGO soils + TIGER boundaries (slow-changing) — free latency + reliability win.
- Log per-turn data-fetch latency + the data-hallucination warning rate so we have a baseline before first customers, not after.

## Biggest risk if my area is ignored

**A confident, wrong data claim on a customer's first real deal.** Pax says "not in a flood zone" or "9 buildable acres" or "no wetlands," the customer acts on it, and it's wrong because a free lookup missed and Pax filled the gap with a guess. On a *land-investing* product that's not a cosmetic bug — it's a trust-and-liability event that ends the relationship and the referral. The guard to prevent it already exists in the repo; it's just not wired in (`executive.ts:1753`). Shipping to first customers with a dormant hallucination guard and zero data-grounded eval coverage is the one thing in my domain I would not let happen.
