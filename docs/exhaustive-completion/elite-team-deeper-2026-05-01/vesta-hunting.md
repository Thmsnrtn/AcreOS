# Vesta Pemberton — Hunting-Land Specialist Audit

**Wave 3 · Elite-Team-Deeper · 2026-05-01**
*45, Birmingham AL. Twelve years buying 80–300 acre tracts across AL/MS/GA/AR for deer/turkey/waterfowl, then selling them to recreational hunters at premium. I've sold a 142-acre Choctaw County tract for $4,200/acre that I bought for $1,650/acre — and the difference was a single trail-cam SD card with eleven photos of a nine-point and a year of food-plot work. Hunting land is the only land vertical where the buyer's wife isn't on the closing call and the buyer is paying with feelings.*

---

## 1. One-line verdict

**D-plus for hunting-land operators.** AcreOS treats "hunting" as a dropdown value in two SelectItem lists (`marketplace.tsx:809`, with "recreational" in the zoning filter at `:793`) and a 7-character substring inside `recreationalDemand` on the market-intelligence radar. There is no game data, no lease ledger, no trail-cam first-class media type, no food-plot capex tracking, no recreational-use immunity surfacing, no club-LLC structure helper. It is land-investing software written for tax-sale flippers, retrofitted with the *word* "hunting" in two filters. For my workflow it's worse than a spreadsheet because the spreadsheet doesn't pretend.

The good news: every gap I found is additive. The bones (parcel data, GIS, photos with GPS, voice notes, owner-finance tooling) are already correct. Three deliberate features — game-data overlay, lease/capex ledger, trail-cam media type — would move this from D+ to A in one quarter and unlock a vertical (hunting tracts) that nobody else in the land-CRM space serves well.

---

## 2. Game-population data — what's missing

I searched the codebase for "DNR", "DCNR", "wildlife", "deer-density", "harvest", "WMA". **Zero hits in `server/services/providers/`.** The provider registry has Attom (assessor), BatchData (skip-trace), Regrid (parcels), and "open-data" — none of which carry game-management data.

What a hunting-land operator actually needs at the parcel level:

| Data layer | Source | Why I need it |
|---|---|---|
| **Deer Management Unit** | AL DCNR Zone (A/B/C/D), MS MDWFP regions, GA DNR zones, AR AGFC zones | Different bag limits + season dates by zone. Drives buyer demand. |
| **Harvest density (deer/sq-mi)** | AL Game-Check, MS Deer Mgmt Assistance Program (DMAP), GA Game Check, AR Game-Check | The single number a serious buyer asks. "How many deer/sq-mi taken in this county last season?" |
| **WMA proximity** | State WMA shapefiles (public-domain GIS) | Adjacency to a WMA is double-edged: free habitat overflow vs. public-hunter trespass risk. Both are pricing inputs. |
| **CWD zones** | USDA + state vet | CWD containment zones suppress prices 15–30%. AL's first case (Lauderdale, Jan 2022) crashed local comps. |
| **Waterfowl flyway** | USFWS Mississippi/Atlantic flyway boundaries | Determines if a tract has duck-hunting upside (which is a 3–5× pricing multiplier on flooded-timber acreage). |
| **Pine vs. hardwood mast** | USDA NLCD + state forestry | White-oak acorn dominance ≈ deer magnet. Loblolly monoculture ≈ deer desert. The radar shouldn't say "Recreation: 67"; it should say "62% hardwood mast cover, white-oak dominant." |
| **State-specific lease comps** | Hunting-lease marketplaces (Base Camp Leasing, HLRBO, IndianHead) — scrape or partner | Ground-truth of $/acre/yr for the county. |

**`market-intelligence.tsx:92`** displays `growth.recreationalDemand ?? 50` — a single fabricated 0–100 score. That's not a hunting-land signal; that's a placebo. A hunting-land operator looking at "Recreation: 67" with no underlying methodology will lose trust in the entire market-intelligence module within five minutes.

**Fix.** Add a `huntingProfile` provider category that pulls (a) state-zone polygon, (b) county harvest-density from state Game-Check APIs (AL has a public dashboard; MS/GA/AR data is FOIA-able and refreshes annually), (c) WMA-distance via a shapefile join, (d) CWD-zone flag, (e) flyway flag, (f) NLCD-derived hardwood-mast %. Cache annually except CWD which checks monthly. Expose as a card on the parcel detail page next to the existing parcel data.

---

## 3. Hunt-lease economics — the silent income stream

`pipelineIntelligence.ts:147` is the only acknowledgment in the entire codebase that hunting-land generates lease income, and it is wrong:

```ts
projectedProfit: Math.round(acres * 50 * 12), // rough annual lease income
```

That's `acres × $50 × 12 months = $600/acre/yr`. **It should be `acres × $/acre/yr`, not multiplied by 12.** Lease rates are quoted annually, not monthly. A 200-acre tract leased at $25/acre/yr yields $5,000/yr, not $60,000/yr. This bug renders any pipeline projection that includes a recreational property roughly **12× too optimistic**. If a user has shown this projection to a lender, that's a real-world embarrassment risk.

`landCredit.ts:917` mentions leasing in passing as a holding-cost reduction strategy. There is no ledger.

What I actually need:

### 3a. A `hunting_leases` table

```
hunting_leases
  id
  parcel_id (FK)
  organization_id
  lessee_name, lessee_email, lessee_phone
  lease_type: 'annual_full' | 'season_deer' | 'season_turkey' | 'season_duck' | 'day_lease'
  start_date, end_date
  rate_per_acre_per_year (cents)
  total_annual_cents
  hunters_allowed_count
  guest_policy: 'none' | 'with_member' | 'unlimited'
  weapon_restrictions: jsonb  // bow_only, primitive_weapons, etc.
  insurance_required: bool
  insurance_carrier, insurance_policy_number, insurance_expiration
  liability_release_signed: bool
  liability_release_doc_id (FK to documents)
  auto_renew: bool
  status: 'active' | 'expired' | 'terminated' | 'pending_signature'
```

### 3b. A lease-renewal calendar surface

90-day, 60-day, 30-day pre-expiration alerts. This is the bread-and-butter of operating hunting-land at scale; every one of my 14 leased tracts has a different renewal date and forgetting one is real money.

### 3c. Lease-vs-sell decision modeling

Hunting tracts are a hold-or-sell decision *every year*. For each leased parcel, model:

- IRR if held + leased for N more years before sale
- IRR if sold at current comp today
- Breakeven year given lease rate trajectory + property tax + ad valorem

`dispositionOptimizer.ts` already does sell-side timing. Extend it with `recreationalHold` strategy that incorporates lease-cashflow and capex-amortization (food plots = depreciable improvement under §1.263(a)).

### 3d. Tier lease economics by region

Black Belt (AL/MS) $25–40/ac/yr; piney woods (S. AL/MS/GA) $10–18; MS Delta waterfowl $35–80; Ozarks (N. AR) $8–15; coastal AL/MS turkey/deer $12–25. A user in Greene County, AL, entering a parcel should see "comparable hunting leases here run $25–40/ac/yr" inline with deal-underwriting. Today they see nothing.

---

## 4. Capex tracking — food plots, stands, roads, water

When I buy an 180-acre cutover for $1,400/acre, I'm not buying it as-is. I'm buying it because I will spend $18–30K over 18 months turning it into a property a Birmingham lawyer will pay $3,800/acre for. That capex is the deal. AcreOS has no concept of it.

### Capex categories every hunting operator tracks

| Item | Typical cost | Useful life | Tax treatment |
|---|---|---|---|
| Food plot establishment (lime, fertilizer, seed, equipment) | $200–400/acre, multi-acre plot | 1 yr per plot, multi-yr improvement | Sec 175 soil/water conservation deduction (key!) |
| Permanent food-plot conversion (stumping, leveling) | $500–1,200/acre | 15+ yrs | Capitalize, depreciate |
| Box blinds (8x8 elevated) | $1,500–3,500 each | 10 yrs | Depreciate (MACRS 7-yr) |
| Ladder/lock-on stands | $200–500 each | 5 yrs | Sec 179 expense if total <limit |
| Internal road clearing | $1,500–3,000/mile | 20 yrs | Capitalize, depreciate |
| Water hole / wallow / pond | $2,000–8,000 each | 20+ yrs | Sec 175 if conservation-plan documented |
| Trail-cam network (cell + SD) | $250–500 per cam, $30/mo per cell | 3 yrs | Expense / Sec 179 |
| Mineral sites / Trophy Rock | $30–80 each, recurring | 1 yr | Expense |
| Seedling / hard-mast tree planting | $400–800/acre | 15+ yrs | Sec 175 (huge — most operators miss this) |

**Section 175 of the IRC** lets a farmer/landowner deduct soil-and-water-conservation expenses up to 25% of gross farm income annually instead of capitalizing. For hunting-land operators who also run a small AG cover (timber, hay, pasture lease) on the same parcel, this is significant. AcreOS's tax-treatment surfaces (I checked `financialOSService.ts`) are silent on §175. They should not be.

### What I need

A `parcel_improvements` table linked to documents (receipts) and to a depreciation schedule. Roll up to a per-parcel "all-in basis" so when I list it for sale I see `purchase price + closing + holding + improvements + selling = total basis`, against which the comp-derived list price gives me a real ROI — not the fantasy ROI from `dealUnderwriting.ts` that ignores the $42K I spent on it.

This is also a buyer-trust artifact: a one-page improvement log printed from AcreOS with photo-dated receipts is **the single most powerful close-tool I own**. It justifies my premium and shortcuts the buyer's due-diligence anxiety.

---

## 5. Trail-cam evidence — first-class media, not afterthought photos

This is the feature gap that hurts most. AcreOS has photo capture (`field-scout.tsx`, `photo-gallery.tsx`) — well-built per Aurelio's audit. But hunting trail-cam evidence is a fundamentally different media object than a parcel photo:

| Property | Parcel photo | Trail-cam photo |
|---|---|---|
| Captured by | Human, present | Unattended motion-trigger, days/weeks later |
| GPS source | Device | Cam location (set once) |
| Time semantics | Capture moment | Trigger moment + retrieval moment |
| Volume | 4–20 per parcel | **400–2,000 per cam per month** |
| Curation | Keep all | Cull 95%+, keep antlered bucks + turkey strut + does-with-fawns |
| Buyer-facing? | Sometimes | **Always — this is the listing's hero asset** |
| Privacy | Mostly fine | Trespasser faces, neighbor kids — real liability |

### What I need

1. **A `trail_cams` entity** — name, parcel_id, lat/lng (separate from parcel centroid; cams are on funnels not centroids), brand/model, install_date, last_card_pull_date, sd_capacity_gb, cellular_carrier_account_id (for cell cams), battery_replacement_log.
2. **Bulk SD-card import** — drag a folder of 1,400 photos onto a parcel page; AcreOS reads EXIF for capture-time, runs an on-device or server-side classifier (deer/turkey/hog/raccoon/human/empty), tags antlered-vs-doe, and shows me a 12-tile cull view sorted by "interesting score." This is a 4-hour task today (my ritual every Sunday in November); it should be 15 minutes.
3. **Buck-tracking by individual** — once I tag a buck as "Tank" (every operator names them), the system clusters subsequent photos into a Tank gallery with sighting-frequency-by-time-of-day heatmap. This is not vanity; it is the *single asset I email to a hunter buyer* and it sells the parcel.
4. **Privacy filters before listing-export** — auto-blur human faces; remove trespasser photos from any export-to-marketplace bundle. Liability and decency.
5. **Cell-cam ingestion** — the Big Four (Spypoint, Tactacam, Moultrie, Reveal) all have email-image-on-trigger or REST APIs. AcreOS should pull these on a cron and dedupe. I currently manage 4 cell-cam accounts in 4 apps; consolidating would save me ~3 hours/week.

The codebase has zero trail-cam awareness. There's no entity, no media tag, no schema field. Meanwhile `attached_assets/` has random "Generated_Image*.png" files in the repo root — the platform is not at all set up for systematic media volumes at trail-cam scale.

---

## 6. Hunting-club legal structures + recreational-use immunity

### Club LLCs

Most of my buyers buy as a 4-to-12-member hunting-club LLC. The structure is unusual: members aren't equity holders the way real-estate-syndication members are; they're more like co-op shareholders with expulsion rights, prepaid annual dues, and a buyout-on-exit formula. AcreOS's entity-management surface (I checked `routes-platform-features.ts:1106` and the contract-template editor) treats LLCs as generic. It should offer a "Hunting Club LLC" template with:

- Operating agreement boilerplate (member admission/expulsion, dues, capital calls for capex, food-plot decisions, harvest rules, guest policy, exit valuation)
- Standard liability waiver/release for members and guests
- Predator/nuisance-animal harvest authorization
- Annual minutes template
- Member-equity ledger (this matters because food-plot capex over 5 years gets unevenly contributed and someone always wants out — without a ledger it's a fistfight)

### Recreational-use immunity statutes — vary by state, *materially*

This is the single biggest legal-risk delta between hunting-land and any other land vertical, and AcreOS is silent on it. Each state has a Recreational-Use statute that limits a landowner's liability to recreational users *if certain conditions are met* — typically: no fee charged (or fee below a threshold), no willful/wanton conduct, posted warnings of known hazards.

| State | Statute | Fee limit for immunity | Notable carve-outs |
|---|---|---|---|
| AL | §35-15-1 et seq. | $0 — any fee voids immunity for that user | Children, willful misconduct |
| MS | §89-2-1 et seq. | Higher of $35/person/yr or $250/group | Charge over → no immunity |
| GA | §51-3-20 et seq. | $0 (but lease income from a third party doesn't void) | Wilful/malicious only |
| AR | §18-11-301 et seq. | $0 to general public; lease OK if to specific persons | Fence/structure exceptions |

**Practical implication:** an AL operator who charges a $500/yr "membership fee" to hunting-club members has **voided** the recreational-use immunity for those members. They'd better be on a separate commercial-liability policy. A GA operator with the *same* setup — but structured as a *lease to a club LLC* rather than fees-to-members — keeps the immunity. **The platform should know this difference and warn the user before they generate the wrong document.**

Add: a state-aware compliance tile on every parcel labeled "Recreational-use immunity status" that reads, e.g., "AL: at risk — your current lease structure charges per-member fees, which voids §35-15-1 immunity. Consider restructuring as a single LLC lease, or maintain $1M general-liability coverage. [See template]." This is a real moat: no other land CRM has this. It is also genuinely useful — I have personally screwed up the AL fee-structure question and only learned about it from my insurance broker after I'd written an indemnity I shouldn't have.

---

## 7. The "hunting land sells on emotion" reality

Every other land vertical in AcreOS is sold to investors who want IRR. Hunting land is sold to a 52-year-old orthopedic surgeon in Mountain Brook whose son just turned eight and who wants a place to take him on opening day for the next twenty years. He is not running a DCF. He is buying *a memory he hasn't lived yet*.

The AcreOS marketplace listing template (`marketplace.tsx`) is structured for IRR buyers: acres, price, $/acre, comps, zoning, type. None of that is wrong. **All of it is insufficient.**

What a hunting-land listing actually needs as first-class fields:

- **Trail-cam highlight reel** (5–10 hand-picked images, 1–2 short videos) — auto-built from the cam library
- **A topographic personality** — "South-facing hardwood ridge with two creek bottoms; bedding cover on the west boundary; food plot at the saddle." Not a parcel APN. A *story* a hunter recognizes.
- **The walk-the-property video** — one-take phone walk-around (already supported by voice + photo), but presented as a single embed
- **Recent harvest history** — bucks taken, doe count, turkey limits, dates. With photo evidence.
- **Improvements gallery** — the food-plot satellite then-and-now, the new road, the box blinds going in
- **Adjacency map** — "1,400-acre WMA at south boundary; 600-acre managed timber to east; nearest residence 0.7 miles" — privacy and habitat both
- **Aspirational headline copy** — the system should prompt the listing assistant in *sportsman idiom*, not investor idiom. "1,200 acres of Black Belt deer dirt with two food plots, mature white-oak ridges, and a track record of 140-class bucks" beats "186-acre rural land tract, recreational zoning, $1,650/acre."

The Pax copilot should know this voice exists. A toggle: list-as-investor vs. list-as-sportsman. Same parcel, two stories, two buyer pools, two prices.

---

## 8. The 6-week hunting-land sprint

Sequenced by what unlocks revenue fastest.

### Week 1 — fix the embarrassments
- Patch `pipelineIntelligence.ts:147` lease-income bug (12× over-projection)
- Replace `recreationalDemand` placeholder with a methodology link that says "Coming Q3" rather than fabricating a score
- Surface `recreational` as a top-level land vertical in onboarding alongside flip/buy-hold

### Week 2 — schema for leases + capex
- Migrations: `hunting_leases`, `parcel_improvements` (with §175 flag), `trail_cams`, `trail_cam_photos`, `wildlife_sightings`
- Backfill from existing `notes` where text matches lease/food-plot/trail-cam patterns

### Week 3 — game-data provider
- `huntingProfile` provider category: AL/MS/GA/AR Game-Check + WMA shapefile join + NLCD hardwood %
- Cache annually; CWD monthly
- Parcel-detail card

### Week 4 — trail-cam ingestion
- Bulk-folder upload, EXIF-time clustering
- Wildlife classifier (lightweight CNN — can use a hosted call or onboard `deer-vit`)
- Privacy face-blur on export
- Cell-cam Spypoint/Tactacam/Moultrie/Reveal connectors (start with one)

### Week 5 — recreational-use immunity + club LLC
- State-aware compliance tile on parcel
- Hunting-club LLC operating-agreement template (4 states minimum: AL/MS/GA/AR)
- Liability-waiver template; auto-attach to every active lease

### Week 6 — sportsman-voice listing
- Marketplace listing template with trail-cam reel, topo-personality, harvest history, walk-the-property embed
- Pax voice toggle for sportsman-idiom listing copy
- Buyer-search facets: trophy-buck-evidence, food-plot-acres, WMA-adjacent, waterfowl-flyway, CWD-clear

---

## Appendix — files I read

- `/Users/user/AcreOS/AcreOS/shared/schema.ts` — `propertyType` includes "recreational" (`:8649`); `specialties` array allows it (`:9145`); no hunting-specific fields anywhere
- `/Users/user/AcreOS/AcreOS/client/src/pages/marketplace.tsx:793,809` — "recreational" + "hunting" as filter values, no schema behind them
- `/Users/user/AcreOS/AcreOS/client/src/pages/onboarding-wizard.tsx:34` — "Recreational/hunting properties" as a vertical option (good!) but nothing downstream tailors to it
- `/Users/user/AcreOS/AcreOS/client/src/pages/market-intelligence.tsx:92,115` — `recreationalDemand` as a 0–100 score with no methodology
- `/Users/user/AcreOS/AcreOS/server/services/pipelineIntelligence.ts:147` — **the 12× lease-income bug** — `acres * 50 * 12` should be `acres * RATE_PER_ACRE_PER_YEAR`
- `/Users/user/AcreOS/AcreOS/server/services/landCredit.ts:917` — sole mention of "leasing" as holding-cost mitigation, no ledger
- `/Users/user/AcreOS/AcreOS/server/services/providers/` — Attom, BatchData, Regrid, open-data; no game-data, no wildlife, no DNR
- `/Users/user/AcreOS/AcreOS/server/services/blindOfferCalculator.ts:604,607` — AL/MS/GA/AR are state-mapped but only for tax-sale rules, not for hunting-land economics
- `/Users/user/AcreOS/AcreOS/server/routes-platform-features.ts:1106` — disclosure-document templates (GA listed) but nothing for hunting-club operating agreements or recreational-use waivers
- `/Users/user/AcreOS/AcreOS/server/services/dispositionOptimizer.ts:587` — sell-timing model has no "hold + lease" branch
- `/Users/user/AcreOS/AcreOS/server/services/financialOSService.ts:400` — holding-cost categories include taxes but not §175 conservation deduction or capex amortization

---

*— Vesta Pemberton*
*Hunting land is the only deal where the buyer cries on the walkthrough. Build the platform that knows why.*
