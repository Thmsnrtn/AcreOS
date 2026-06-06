# Lens: Lena — CFO/CIO

**Author:** Lena Bjorndal (CFO/CIO)
**Date:** 2026-06-06
**Lens focus:** The economics of data. $0 free-tier COGS now vs. the real monthly cost of Regrid/Zamplo/PropGrid later; the MRR triggers that unlock paid data; per-lookup credit pricing; keeping overhead near-zero; the financial case for the phased path.

> I don't say "we should buy data." I say: at the current run-rate, the marginal dollar of paid parcel data returns roughly nothing because we have zero paying customers to amortize it across, and the free open-data stack already covers ~80% of the decision-relevant signal. So the recommendation is: **ship a premium-feeling free-data tier now, instrument the cost of every lookup, and arm an automatic MRR-triggered switch to paid data — but do not flip it until the unit economics clear the gate.** Three scenarios attached to every number below.

---

## The financial picture as it actually stands in the repo

What's already built (and it's good):

- **Provider registry** (`server/services/providers/provider-registry.ts`) does tier-filtered, cost-aware, circuit-broken, cached lookups. Free providers (`open-data-provider.ts`, `county-gis-provider.ts`, both `tierRequired: "free"`, `costPerLookupCents → 0`) are wired and return real FEMA/Census/USGS/USDA/county-GIS data at $0 COGS.
- **Paid providers exist but are gated**: `regrid-provider.ts` (3–8¢/lookup, tier `starter`), `attom-provider.ts` (tier `pro`), `batchdata-provider.ts` (skip-trace, tier `starter`). They're registered but only selected when an org's tier and credit balance allow.
- **Credit pool per tier** is defined in `shared/billing/tier-limits.ts`: free=50, starter=750, pro=2,500, scale=8,000, enterprise=25,000 credits (1 credit ≈ $0.01 of provider cost).
- **Credit weights** in `shared/billing/credit-weights.ts` price messaging + AI turns (sms=1, email=0.02, EDDM=31, skip_trace=30, ai_turn_avg=1.5).
- **Tier prices** in `shared/billing/tier-pricing.ts`: starter $20, pro $49, scale $79 + vertical packs ($100–$200/mo).

### The defect that will quietly eat margin the day we turn on paid data

**Paid data lookups are gated on `creditBalance` but are never deducted from it.** Read `provider-registry.ts:117-200`: the loop computes `costCents = provider.costPerLookupCents(category)`, *skips* a provider if `creditBalance < costCents`, records telemetry with `costCents`… and then never debits the pool on success. Meanwhile `credit-weights.ts` (`CreditAction` union) has **no `parcel_data` / `comps` / `valuation` / `owner_info` lookup action at all** — only messaging + AI. So the credit pool funds SMS/email/AI, but a Regrid lookup that costs us 3–8¢ real cash draws **zero** from any customer-paid pool.

Today that's harmless: every selected provider is free (cost 0). The moment Regrid/ATTOM is enabled for a paying org, **every paid lookup is pure uncompensated COGS** with no contribution-margin gate. At Regrid's documented ~$0.05–$0.25/parcel (`docs/OWNERS-MANUAL.md:1935`), a single power user doing 2,000 lookups/mo = $100–$500 of silent COGS against a $49 Pro subscription. That's a -200% to -1000% margin lane, exactly the failure mode the Pax `ai_requests` cap comment already calls out for AI turns. **This is my #1 item.** Fix it before paid data ships, not after.

---

## Top work items (priority order)

### 1. Meter paid data lookups against the credit pool (close the margin leak)
- **Goal:** rock-solid. **Phase:** 0. **Effort:** M. **Deps:** none (uses existing pool plumbing).
- **Why it matters to first customers:** It protects the price they pay. Without it, a single heavy user's data appetite forces us to either eat the loss (kills runway) or raise everyone's price (kills trust). Metering means the $20 Starter stays $20 and heavy users top up — fair and legible.
- **Concrete first step:** Add data-lookup actions to the `CreditAction` union and `CREDIT_WEIGHTS` in `shared/billing/credit-weights.ts` (`parcel_lookup_paid`, `comps_lookup`, `owner_lookup`, `valuation_lookup`, `skip_trace` already conceptually exists at 30). Then in `provider-registry.ts` after `recordSuccess`, debit the org's credit balance by `costCents` (free providers debit 0, so free-tier UX is untouched). Cached hits already cost 0 — keep that. Surface the running balance so the customer always sees it.
- **Cost note:** free lookups remain $0 to the customer and $0 to us. This only bites when a *paid* provider serves a *live* (non-cached) result — which is exactly when we incur real cash COGS.

### 2. Per-lookup cost telemetry → COGS dashboard on `/founder/cost`
- **Goal:** rock-solid / data. **Phase:** 0. **Effort:** S–M. **Deps:** `providerIntelligence.recordLookup` (already records `costCents`).
- **Why it matters:** I cannot make the paid-data go/no-go call without a real cost-per-active-customer number. `recordLookup` already captures `costCents` per provider/category/org. We just need to roll it up: blended COGS/customer/mo, cache-hit ratio (the single biggest lever on data COGS), and a free-vs-paid lookup split.
- **Concrete first step:** A weekly rollup query over the provider-intelligence telemetry table, surfaced as three numbers on the founder cost surface: (a) total data COGS MTD, (b) cache-hit rate, (c) most expensive org. Wire it into the Solene morning pulse so the envelope signal fires if data COGS crosses the $50 bootstrap floor.
- **Why now:** at zero customers this reads $0/$0/$0 — and that *is* the point. It's the instrument we watch fill up.

### 3. The MRR-triggered paid-data switch (the phased path, encoded)
- **Goal:** data / foundation. **Phase:** 1. **Effort:** M. **Deps:** #1, #2.
- **Why it matters:** This is the financial case made executable. We don't pay Regrid a monthly bill on faith; we pay it when the math clears. The switch should be a founder-settings flag (the registry already reads founder-calibrated weights via `getSetting`), not a deploy.
- **The gate (base case):** enable a paid provider for a category only when **(MRR from orgs that would use it) × (gross-margin floor 70%) > (projected monthly paid-data COGS for that category)**, with a hard minimum of **$200 sustained MRR (Phase 1)** before *any* paid data is purchasable, and a per-org credit-pool cap so one user can't blow the category budget.
- **Concrete first step:** Encode the trigger in `shared/billing/` next to `allocation-policy.ts` as a `data-procurement-policy.ts` with the three-scenario thresholds (below). Read it from a scheduled job (`server/jobs/runScheduledJobs.ts`) that flips the founder-setting flag automatically and pages Solene when a category crosses its gate.

### 4. Make the free-data tier *feel premium* (so we never need to rush paid data)
- **Goal:** happier-customers / flawless-ux. **Phase:** 0–1. **Effort:** M (UX-led; I own the framing/economics).
- **Why it matters:** Every month customers are delighted by free data is a month we don't pay a data vendor. The open stack (FEMA flood, SSURGO soils, USGS slope, USFWS wetlands, TIGER boundaries, county assessor GIS) is genuinely the *decision-relevant* layer for land — buildability, flood, soil, access. Regrid's marginal value over that is mostly owner-name + clean APN normalization. Frame the free tier as "every environmental and parcel signal that decides a deal," and the paid tier as "owner contact + skip-trace + national normalization" — a clear, honest upgrade reason rather than a crippled-free-tier coercion.
- **Concrete first step:** A confidence/provenance badge on each datum (the `LookupResult.confidence` field already exists, 0–100, with open-data at 60–80). Show source + freshness. "FEMA NFHL · updated 2024 · confidence 70" reads as premium, not as a free-tier apology.

### 5. Credit-pool sizing sanity-check once data is metered
- **Goal:** rock-solid / foundation. **Phase:** 1. **Effort:** S. **Deps:** #1.
- **Why it matters:** Once paid lookups draw from the pool, today's pool sizes (starter 750 ≈ $7.50 of COGS headroom on a $20 sub) need re-checking against the *combined* messaging + AI + data demand. 750 credits is fine for messaging-only; it may starve a user who also wants paid parcel data. Either size the pool for the blended workload or sell data credits as a separate, clearly-priced top-up.
- **Concrete first step:** Model blended COGS/customer at p50 and p90 usage once #1 ships real numbers; recommend pool sizes or a data-credit SKU. Single-number forecasts rejected — base/downside/upside only.

### 6. Vendor-cost guardrail on data providers (the 2%-of-revenue rule, automated)
- **Goal:** rock-solid. **Phase:** 1. **Effort:** S. **Deps:** #2.
- **Why it matters:** My constitutional decision authority caps recurring vendor onboarding at ≤2% of monthly revenue without Solene+Tom. A data vendor minimum-commit (Regrid/ATTOM/Batch all have monthly floors or volume tiers) can silently exceed that. The detector should refuse to enable a paid provider whose *minimum monthly commit* exceeds 2% of trailing MRR.
- **Concrete first step:** Add a `minMonthlyCommitCents` field to the provider interface (`types.ts`) and check it in the #3 switch. A pay-per-call vendor with no floor (good) passes; a $500/mo-minimum vendor (bad at our scale) is blocked until MRR supports it.

### 7. Cache-hit ratio as a first-class COGS lever
- **Goal:** data / rock-solid. **Phase:** 1. **Effort:** S. **Deps:** #2.
- **Why it matters:** The single cheapest paid-data dollar is the one we don't spend because `provider_cache` served it. At land-investing access patterns (the same hot counties, repeated parcels), cache hit rates of 40–70% are realistic, which roughly halves effective paid-data COGS. The `skip_trace` weight comment already assumes this ("~$0.30 BatchData… ~$0.05 effective" via cache sharing). We should *measure and defend* that ratio, and consider a longer TTL for slow-changing open data (parcel boundaries change rarely) vs. short TTL for owner/valuation.
- **Concrete first step:** Report cache-hit ratio per category in #2; set category-specific cache TTLs (boundaries: 90d; owner/valuation: 30d; flood: per FEMA effective date).

---

## The open-data theme, from the money lens

The open-source data stack isn't a budget compromise — at our stage it's the *correct* allocation. Three reasons, in dollars:

1. **COGS:** open data is $0 marginal cost. Regrid/ATTOM/Batch are 3–25¢/lookup *plus* likely monthly minimums. At 0 paying customers, paid data is a 100% loss with no amortization base. The free stack is gross-margin-perfect by construction.
2. **Coverage of decision-relevant signal:** for land specifically, the deal-killer signals (flood, wetlands, slope/buildability, soil, access, jurisdiction) all live in the *free* federal/state/county layers. Paid data's incremental value is concentrated in owner contact + skip-trace + national APN normalization — which is exactly the right thing to put *behind* the paywall as the legible upgrade reason.
3. **Optionality:** the registry already abstracts this perfectly. We owe future-us nothing by staying free now — flipping to paid is a settings flag + a credit-deduction line, both small. We preserve the option without paying the premium.

**The phased procurement path (`data-procurement-policy.ts`, three scenarios):**

| Phase | MRR gate | Data posture | Projected monthly data COGS |
|---|---|---|---|
| **0 (now)** | $0 | Free stack only. Paid providers registered but flag-disabled. | **$0** |
| **1** | $200 sustained 30d | Enable **pay-per-call skip-trace** (BatchData) — no monthly minimum, drawn from credit pool, cache-shared. No flat-fee vendors yet. | base $10 / down $25 / up $50 |
| **2** | $1,000 sustained 30d | Enable **Regrid pay-per-call** for owner_info/parcel normalization, metered + capped per org. Re-evaluate ATTOM. | base $60 / down $150 / up $300 |
| **3** | $5,000 sustained 30d | Consider a **Regrid/Zamplo/PropGrid bulk or subscription tier** *only if* (subscription cost < blended pay-per-call cost at current volume) AND it clears the 70% gross-margin floor. Bulk ETL already scaffolded (`etlHandlers.ts`, `regrid_parcels_v1`). | base $300 / down $600 / up $1,200 |

The rule on each step: **we never sign a flat monthly data commit while pay-per-call is cheaper at our volume.** The crossover point — where a $X/mo subscription beats N × per-call — is a clean arithmetic trigger, not a vibe. I'll compute it from #2's real volume before any subscription signs.

---

## Quick wins (days, not weeks)

- **Add the data-lookup credit actions + deduction line** (item #1 core) — the single highest-leverage fix; it's the difference between paid data being safe vs. silently insolvent.
- **Roll up `recordLookup.costCents` into three founder-cost numbers** (item #2) — instrument before we have anything to measure, so the first paid dollar is visible the instant it's spent.
- **Add `minMonthlyCommitCents` to the provider interface** (item #6) — one field; turns the 2%-of-revenue rule into code.
- **Confidence/provenance badge from the existing `LookupResult.confidence`** (item #4) — makes free data *read* as premium at near-zero cost.
- **Category-specific cache TTLs** (item #7) — boundaries change rarely; a longer TTL is free COGS reduction.

## Biggest risk if my area is ignored

**We turn on paid data (Regrid/Zamplo/PropGrid) to win or retain our first customers, and because lookups aren't metered against the credit pool, data COGS scales with usage while revenue is flat — converting our best, most-engaged customers into our biggest losses.** At $49 Pro with 2,000 uncompensated 5–25¢ lookups/mo, that's a $100–$500 hole per power user with no gate and no signal until I reconcile the month. For a self-funded, near-zero-overhead Phase 0 company, a handful of heavy users on un-metered paid data is a runway event. The fix is cheap and lives entirely in two files we already own (`credit-weights.ts`, `provider-registry.ts`). The risk is not the cost of the data — it's shipping paid data *before* the meter that makes it pay for itself.
