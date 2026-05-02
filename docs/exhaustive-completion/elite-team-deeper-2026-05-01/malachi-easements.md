# Malachi Booker — Conservation Easement Audit

**Role:** Conservation easement specialist, 22 years (Bozeman MT). I work with Land Investors across MT/WY/CO/ID who hold acreage with ecological, agricultural, or scenic value and want to monetize the conservation value via §170(h) charitable deduction or sale to a land trust.
**Wave:** 3 of the AcreOS audit — the "deeper" pass, looking past the obvious workflows.
**Reviewing:** parcel data model (`shared/schema.ts` deedRestrictions/access), investor-directory `FOCUS_OPTIONS`, due-diligence checklist (`storage.ts:5033`, `schema.ts:2787`), exit-strategy paths in `priceOptimizer.ts` / `buyerMatchingAI.ts`, content surfaces (Academy, Features, Agents).
**Date:** 2026-05-01.

---

## 1. One-line verdict

**AcreOS treats easements as a title defect — something to flag in due diligence and route around — when for a meaningful subset of Land Investors the easement IS the exit, and the platform is invisible to that workflow.**

The word "easement" appears in AcreOS exactly the way a title company sees it: a finding to disclose on a checklist. The word "conservation" appears once, in `zoningService.ts`, as a synonym for "open space — don't bother trying to develop." There is one shred of recognition that easements are a strategy: the string `"Conservation easements"` in `investor-directory.tsx:50`, sitting in a list of focus tags next to "Mineral rights." That's the entire surface. No easement-creation playbook, no land-trust directory, no §170(h) checklist, no Form 8283 reminder, no baseline-documentation field, no stewardship-endowment line item in the deal economics. For a Land Investor with 600 acres of riparian Montana ranchland, the highest-IRR exit is often a bargain sale to a land trust — and AcreOS has no idea that path exists.

---

## 2. Why this matters — the dollar size of the gap

A typical conservation easement on intermountain west ranchland follows one of three economic patterns. AcreOS supports zero of them:

| Pattern | How it works | Land Investor's economics | Where AcreOS fails |
|---|---|---|---|
| **Donated easement** | Owner extinguishes development rights, donates to a qualified land trust. Deduction = (FMV before) − (FMV after). | $400/ac × 500ac = $200K deduction, no cash. Carries forward 15 years against 50% AGI. | No "donation" exit in `buyerMatchingAI`; price optimizer assumes sale. |
| **Bargain sale** | Land trust pays below FMV; owner deducts the discount. | $1.5M cash + $1.5M deduction on a $3M FMV easement. | No way to model dual-component returns. Comp engine doesn't price the easement value. |
| **Federal/state purchase program** | NRCS ACEP, USFWS, state programs (MT FWP, CO Great Outdoors). | Cash purchase at appraised value, often 50/50 federal/state cost-share. | No surfacing of these programs anywhere. |

A 500-acre Park County MT ranch is worth ~$2.5M-$5M as ranch, ~$8M-$15M with subdivision potential, and the development-rights spread (the easement value) is ~$1.5M-$5M. Saying nothing about that $1.5-5M to a Land Investor sitting on the parcel is malpractice for a platform that calls itself "AcreOS."

---

## 3. The seven things missing — gap inventory

### 3.1 Easement viability flag on parcel

The `parcels` table has `deedRestrictions.easements: string[]` (existing easements). It has no field for **easement potential**. Every parcel intel run should answer:

- Is this in a **county with active land-trust activity** (Gallatin Valley Land Trust, Vital Ground, Montana Land Reliance)?
- Does it have a **conservation purpose under §170(h)(4)**: (a) public recreation/education access, (b) habitat protection, (c) open space (scenic/ag) per government policy, (d) historic preservation?
- **Acreage threshold** — most trusts won't take under 40 acres in the West unless it's habitat-critical.
- **Riparian / wetland / sage-grouse / elk-corridor overlap** — habitat scoring drives appraisal value.
- **Adjacent to public land or existing easement** (the "buffer effect" multiplier).

**Add to `shared/schema.ts` parcels:**

```ts
conservationProfile: jsonb("conservation_profile").$type<{
  eligible?: boolean;
  conservationPurposes?: ("recreation"|"habitat"|"openSpace"|"historic")[];
  habitatScore?: number; // 0-100 from USFWS IPaC + state heritage
  riparianFeet?: number;
  adjacentProtectedAcres?: number;
  estimatedEasementValue?: { low: number; mid: number; high: number };
  qualifiedTrusts?: string[]; // trust IDs from a registry
  flaggedAsSyndicationRisk?: boolean;
}>(),
```

### 3.2 Land-trust registry — the "couldConnect" opportunity

There are roughly **1,300 accredited land trusts** in the US (Land Trust Alliance accredited list — public, free, scrapeable). Of those, ~150 operate in MT/WY/CO/ID. AcreOS could ingest this list once, surface the 3-5 trusts that match a parcel's geography + conservation profile, and **broker the introduction**.

This is the "AcreOS could connect Land Investors to land trusts" play in the brief — and it's the single highest-leverage product opportunity I see for the conservation-aware Land Investor segment. Land trusts are **chronically deal-starved** in places they want to expand (low-priority counties); they're **drowning in low-quality offers** in trophy areas. A platform that pre-qualifies parcels (acreage + purpose + clean title + motivated owner) is something every trust executive director would take a meeting on.

**Build:**
- Table `land_trusts` (id, name, accreditation_status, service_area geo, focus categories, contact, intake URL, current pipeline capacity flag).
- Table `easement_introductions` (parcel_id, trust_id, status, founder_owner_user_id, created_at).
- Provider in `server/services/providers/conservation/landTrustMatcher.ts` registered alongside zoning/regulatory.
- A "Find a land trust" CTA on parcel detail when `conservationProfile.eligible === true`.

This is also a **revenue surface**: a placement fee from the trust on closed easements (typical 1-3% of project value, or a flat $5K-$25K facilitation fee, paid by the trust out of stewardship endowment) is conventional and IRS-safe (the trust pays AcreOS, not the donor — no §170 conflict).

### 3.3 §170(h) compliance checklist

The due-diligence checklist (`schema.ts:2787`) has "Easements identified" as a defensive item. It needs a parallel offensive workflow: **the §170(h) compliance pre-flight** that runs when a Land Investor selects "Conservation easement" as exit strategy.

Required elements (every one of these has been the subject of an IRS challenge that killed a deduction):

1. **Qualified organization** — recipient is 501(c)(3) AND meets §170(h)(3) (publicly supported OR controlled by publicly-supported org). Not every nonprofit qualifies. Flag with the trust's Pub 78 status.
2. **Qualified real property interest** — easement must be **perpetual** (in perpetuity, not 30-year, not "until repurchased"). The deed has to say "in perpetuity." Sounds trivial; isn't.
3. **Conservation purpose** — one of the four §170(h)(4) purposes, documented in the deed and the baseline.
4. **Exclusively for conservation purposes** — enforceability clause, no inconsistent uses retained, restrictions on subdivision and commercial use.
5. **Mortgage subordination** — if the parcel is mortgaged, the lender MUST subordinate to the easement before recording. The IRS will deny the entire deduction otherwise (Mitchell v. Commissioner, 138 T.C. 16). This is the single most common technical-foot-fault.
6. **Baseline documentation report** — a record of the property's condition at the time of easement, signed by both parties, with photos, maps, species inventory. Required by §1.170A-14(g)(5).
7. **Form 8283 Section B** — for noncash contributions over $5,000, signed by appraiser AND donee organization. For easements over $500K, Section B AND a copy of the qualified appraisal must be attached to the return.
8. **Qualified appraisal by a qualified appraiser** — done no earlier than 60 days before contribution, no later than the return due date. Appraiser must meet §170(f)(11)(E) requirements (relevant credential, regular appraisal practice).
9. **Stewardship endowment funded** — most trusts require the donor contribute $20K-$100K to fund perpetual monitoring. Deduction-eligible separately.

AcreOS should encode this as a 9-item checklist with linked artifacts (subordination doc, baseline PDF, appraisal PDF, 8283, deed). Until all 9 are green, the deduction is at risk. This is exactly the kind of compliance scaffolding `complianceAI.ts` already does for zoning — extend the pattern.

### 3.4 The syndicated-easement landmine

The IRS has been on a multi-year warpath against **syndicated conservation easements** — partnerships that buy land cheap, get an inflated appraisal, and sell deductions to investors at 4-5x return. These were Listed Transactions starting in 2017 (Notice 2017-10), formally banned for new transactions in the SECURE 2.0 Act (Dec 2022, §605), and the IRS is still litigating thousands of pre-2023 deals. The **Senate Finance Committee report (2020)** is required reading; conviction rates in tax court are above 90% for the syndicates.

AcreOS has Land Investor users. Some of those users will encounter syndicated easement promoters — the marketing is aggressive and the pitch ("turn $25K into $125K of deductions") is hard to resist. **AcreOS has a duty to warn.**

**Build:**
- An "Easement Risk" content card in Academy — what makes an easement a syndicate (multiple unrelated investors via a partnership, deduction ratio >2.5x cash invested, "promoter" rather than direct land-trust transaction).
- A red-flag detector on the conservation profile: `flaggedAsSyndicationRisk = true` if (a) parcel acquired <36 months prior, (b) appraised easement value >2.5× recent acquisition cost, (c) ownership structure is multi-member LLC with >5 unrelated members.
- A blocking warning before any "find a land trust" CTA fires for a flagged parcel: "This deal pattern matches the IRS syndication risk profile. AcreOS will not facilitate introductions for transactions of this shape."

This protects the platform from being a tool of fraud and protects the user from a 90%-loss-rate tax-court fight. Both matter.

### 3.5 Baseline documentation as a first-class artifact

The baseline is the single most important document in an easement file, and it's the most under-built. It must include:

- Property boundary map with USGS quad overlay
- Aerial photography (date-stamped)
- Soil maps (NRCS Web Soil Survey)
- Vegetation/habitat inventory
- Existing structures and improvements (with photos, GPS-tagged)
- Roads, fences, utilities
- Hydrology — streams, ponds, wetlands (NWI overlay)
- Cultural / historic features
- Signed acknowledgment by donor and trust

Half of this is already in AcreOS as parcel intel — `parcelIntelligenceFusion.ts`, `environmentalIntelligence.ts`, `regulatoryIntelligence.ts`. **The platform could generate a draft baseline PDF in 90 seconds** that today costs a Land Investor $3K-$8K from a consultant. That's a feature so obviously good I'd argue it before "find a land trust" is even built.

Stub: `server/services/conservation/baselineGenerator.ts` — composes existing intel sources, adds GPS-tagged photo upload UI, outputs PDF via the existing report pipeline. Sell as a $499 deliverable; trust review still required, but the 80% draft is real.

### 3.6 Tax economics modeling — the price optimizer is wrong about easements

`priceOptimizer.ts` and the comp engine assume "exit = sale to private buyer at FMV." For a conservation-eligible parcel, that's the wrong question. The Land Investor's actual decision is between:

- **Sell whole** → cash now, capital gains tax (LTCG 23.8% federal + state).
- **Develop / subdivide** → cash later, ordinary or 1231, plus development risk.
- **Donate easement, hold land** → no cash, $X deduction, carry-forward 15yr × 50% AGI cap, retain land value (post-easement FMV ~30-60% of pre).
- **Bargain sale** → partial cash, partial deduction, partial retention.

Each path has dramatically different after-tax IRR depending on the investor's marginal rate, AGI, and state of residence (CO and NM offer **transferable state credits** — easement deductions can be SOLD on a market for ~$0.85/$1, a feature unique to a handful of states). AcreOS has none of this modeling.

**Build:** an `exitStrategyComparator` that takes a parcel + an investor profile (AGI band, state, holding period, basis) and returns after-tax NPV across the four paths. This is a 2-week build using existing tax-bracket data; it's the single most differentiated feature for the conservation-aware Land Investor.

### 3.7 Stewardship endowment — line-item it in deal economics

When a Land Investor sees "donate the easement and get a deduction," the platform should immediately model the **all-in cost**:

- Survey: $5K-$15K
- Baseline documentation: $3K-$8K (or AcreOS-generated draft + $1K trust review)
- Qualified appraisal: $8K-$25K (perpetuity easements require sophisticated before/after analysis)
- Legal (deed drafting + review): $3K-$10K
- Title work / mortgage subordination: $2K-$5K
- Stewardship endowment: $20K-$100K
- Recording: <$1K

Total often runs $50K-$150K out of pocket. Against a $1.5M deduction that's a great trade for a high-AGI investor; against a $200K deduction for a smaller parcel, the math is marginal. **AcreOS should never let a user click "Donate easement" without seeing this cost stack.** Today it does worse than that — it doesn't surface the option at all.

---

## 4. Regional notes — MT/WY/CO/ID specifics

I work in these states. Each has quirks AcreOS should encode:

- **Montana** — Montana Land Reliance is the largest by acreage (>1M acres protected). State has no income tax credit but federal deduction is generous given typical AGI of agricultural landowners. Watch for **stream access** — MT's stream access law (MCA 23-2-302) interacts with easement public-access provisions in ways that can defeat the "recreation" conservation purpose if drafted wrong.
- **Wyoming** — small population, low real estate transaction volume, **no state income tax** so the deduction is federal-only. Wyoming Stock Growers Land Trust is the dominant working-ranch trust. Sage-grouse Core Area mapping (state EO) is a major appraisal driver.
- **Colorado** — the **transferable state tax credit** is the killer feature. CRS 39-22-522 gives a 90% credit for easement value, capped, transferable on the open market at ~$0.83-$0.88/$1. AcreOS in Colorado without this in the model is unusable.
- **Idaho** — smaller trust ecosystem (Lemhi Regional, Wood River, Idaho Foundation for Parks and Lands). State conformity to federal §170(h) is clean. Wolf/grizzly recovery zones drive habitat valuation.

`landTrustMatcher` should default these state-by-state quirks; a national one-size-fits-all surface will undersell or mislead.

---

## 5. The "no syndication" pledge — a brand asset

AcreOS is a young brand. Land trust executive directors will not introduce their organizations to a platform that smells like a syndicate-promoter funnel. **A public, durable "AcreOS does not facilitate syndicated conservation easements" pledge** — backed by the §3.4 detector — is a 1-day write that becomes a competitive moat for the next decade. Land Trust Alliance's Standards & Practices is hostile to syndicates; alignment with Standard 10 (Tax Benefits) is table stakes for the introduction-broker pitch.

---

## 6. What I'd ship in the next 30 days

| # | Effort | Outcome |
|---|---|---|
| 1 | 2 days | Add `conservationProfile` to parcels schema; populate from existing intel sources. |
| 2 | 1 day | "Easement Risk: Syndication" content card in Academy + landing copy alignment. |
| 3 | 3 days | Land Trust Alliance accredited-trust import → `land_trusts` table, MT/WY/CO/ID first. |
| 4 | 5 days | §170(h) 9-item checklist as a playbook template; wire artifact uploads. |
| 5 | 5 days | `baselineGenerator.ts` v0 — composes existing intel into a draft baseline PDF. |
| 6 | 4 days | `exitStrategyComparator` — 4-path after-tax NPV with CO transferable-credit support. |
| 7 | 2 days | Syndication red-flag detector + blocking warning on facilitation flow. |
| 8 | 3 days | "Find a land trust" CTA + introduction record + intake email template. |

Total: ~25 engineering days, one specialist (me) advising 4 hours/week. Net effect: AcreOS moves from "doesn't see the easement option" to "the best platform in the country for a Land Investor evaluating an easement exit."

---

## Bottom line

The platform's mental model of land is "buy, hold, sell." That model misses a path that, for the right parcel, is the highest after-tax return available — and the path on which the Land Investor is most exposed to bad actors and bad paperwork. Closing that gap is mostly composition of existing AcreOS intel sources plus one new external dataset (the LTA registry). The introduction-broker layer on top is genuine net-new revenue with clean IRS optics. Don't build it as a vertical; build it as a **fifth exit strategy** in the existing exit-comparator surface, and the conservation-aware Land Investor segment becomes accessible without a separate product.

— Malachi
