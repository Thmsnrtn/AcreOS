# Burt Hennessey — Institutional-Timber (TIMO) Fit Audit, AcreOS

**Lens:** 32 yrs in Southern timberland. I run Hennessey Forestlands LLC out of Charleston, SC — a TIMO managing ~12,000 acres of pine plantation and mixed hardwood across SC, GA, AL, and MS for a state pension, two endowments, and a family office. Vintage-2019 fund, $148M committed, target net 7.5% IRR over a 10-year hold. I sit on the FIA committee and have evaluated every "land software" tool that's pitched the institutional space since 2008. Della Mae sent me the AcreOS link with "tell me if it's the same crowd." This is wave 3 of the AcreOS audit; my job is to answer *one* question — does AcreOS belong anywhere near a TIMO?

---

## 1. One-line verdict

**No, and it is not trying to.** AcreOS is a competently-built **small-tract-flipper SaaS** — Land Investors moving 5–80 acre rural parcels in 12-week cycles with seller-finance notes around $20k–$80k. The product surface (`pricing.tsx`, `client/src/pages/portfolio.tsx`, `server/services/dealUnderwriting.ts`) is honest about that. **It contains zero institutional-timberland primitives** — no cruise data, no stumpage tracking, no MBF inventory, no harvest plan, no carbon-registry integration, no LP capital-account ledger, no NAV computation, no Form ADV-relevant compliance scaffolding, no SOC 2 Type II posture worth showing a pension's diligence team. The Scale tier caps at 10 seats and $79/mo. **A TIMO running a $148M fund cannot use this**, and AcreOS is not pretending otherwise. The interesting question is not whether they should pivot up-market — they should not — but whether the *adjacent-verticals waitlist* (`shared/schema.ts:adjacentVerticalsWaitlist`) ever gets a "timber-institutional" entry. My recommendation: leave it off the roadmap.

---

## 2. What AcreOS is, in TIMO terms

A TIMO has four product needs Della Mae and I share, plus four she does not.

| Need | Della (small operator, 800 ac) | Me (TIMO, 12,000 ac) |
|---|---|---|
| Tract sourcing | 5–40 ac, county-sourced, $1k–$5k/ac | 500–4,000 ac, broker/auction, $1.4k–$3.2k/ac SE pine country |
| Title + closing | Same county-clerk flow | Same, but with Phase-I ESA, T-19.1 endorsement, 1031 timing on a $14M tract |
| Boundary survey + GIS | Plat, basic acreage | Cruise + GIS layered with stand-age, site index, soils, road network, hydrography |
| Hold period | 6–18 months (flip) | 7–12 yrs, harvest-driven |
| LP reporting | n/a | Quarterly NAV, IRR-since-inception, DPI, RVPI, TVPI, capital-call/distribution ledger |
| Inventory math | n/a | Tons-per-acre, MBF-per-acre, growth & yield projection (FVS-Southern), pre-merch vs merchantable basis |
| Revenue events | Cash sale or note | Thinning, final-harvest, hunt-lease, pine-straw, carbon-registry issuance, easement sale, recreation |
| Fund admin / SEC | n/a | Form ADV-2A annual, Custody Rule audit, Form PF if AUM>$150M, surprise audit |

**AcreOS implements column 1 well.** It implements **none of column 2.** This is not a gap to "fix" — this is a different product category. The Land Investor workflow (lead → offer → close → flip-or-finance) and the TIMO workflow (acquire → cruise → silvicultural plan → 7-yr hold → harvest → distribute) share only the words "land" and "acres."

---

## 3. The institutional-grade primitives AcreOS lacks

### 3.1 Inventory ledger — the foundation

A TIMO's balance sheet is **stand inventory**, not the deed. We track per-stand:

- Stand ID (polygon, geometry-bounded)
- Species composition (loblolly / longleaf / slash / mixed hardwood %)
- Establishment year, current age, planting density (TPA — trees per acre)
- Site index (base age 25 for loblolly in the South), measured at last cruise
- Basal area per acre, average DBH, dominant/codominant height
- Volume estimates: green tons/ac (pulpwood + CNS + sawtimber), MBF/ac (Doyle or Scribner), updated every 3–5 years from cruise
- Treatment history: site prep, plant year, herbicide, thinning rotations (with year + tons removed + price/ton)
- Growth-and-yield projection (FVS-Southern, FASTLOB, or proprietary) — annual tons added, year-of-merchantable-thin, year-of-final-harvest
- Casualty events: hurricane (2018 Michael, 2024 Helene), pine beetle, fire, ice damage

**AcreOS schema has none of this.** `parcels.sizeAcres` is a numeric, `landUse` is a free-text field, and the closest concession is `landscapeType: "forest, grassland, desert, mixed"` (`shared/schema.ts`). There is no notion of stand, age, volume, or treatment. **A TIMO's primary asset record does not exist in AcreOS's data model.**

The cost to add it is not "another table" — it is rebuilding the parcel as a *parent of stands*, with cruise events as immutable observations and growth as a function of time. That is a 9-month engineering effort by someone with both forestry and software domain expertise (a vanishingly rare hire). Not on AcreOS's roadmap, not should it be.

### 3.2 NAV and LP reporting

A TIMO marks-to-market every quarter. Methodology is typically one of three:

1. **DCF on stand inventory** — discount projected harvest cash flows at a published timberland discount rate (currently ~5.5–6.5% real, NCREIF Timberland Index)
2. **Comparable-sales** — median $/ac for sales of like stands in the region, adjusted for age/site
3. **Stumpage-based intrinsic value** — current stumpage prices × current inventory, plus land-only base

Output: a per-investor capital account with:

- Beginning NAV
- Capital calls (drawn from commitments)
- Investments (acquisitions at cost)
- Realized gains (harvest distributions, tract sales)
- Unrealized appreciation/depreciation (mark-to-market delta)
- Management fee (typically 95–125 bps on NAV)
- Carry distributions (if hurdle met — usually 8% pref, 80/20 carry)
- Ending NAV
- Quarterly IRR (since-inception, fund-level + investor-level), DPI, RVPI, TVPI

**AcreOS has nothing here.** `client/src/pages/portfolio.tsx` shows a portfolio P&L view sized for a Land Investor's 8–40 parcels in flight. There is no concept of capital commitment, no investor entity distinct from the operator's organization, no waterfall, no preferred return, no hurdle. `dealUnderwriting.ts` computes per-deal IRR on a single-asset cash flow — useful for a flipper, **wrong unit-of-analysis** for a fund. Hassiba's wave-2 audit flagged that AcreOS has no GAAP deferred-revenue ledger for its *own* SaaS revenue; layering ASC 820 fair-value-measurement and ASC 946 investment-company accounting on top is multiple orders of magnitude more work.

### 3.3 Cruise data + third-party verification

Every institutional acquisition gets an independent cruise. The deliverable: a stand table, volume table, location map, pricing letter. PDF + shapefile + CSV. Workflow:

1. Operator engages Mason Bruce & Girard / Forisk / regional cruiser
2. Cruiser returns deliverables 2–6 weeks post-fieldwork
3. NAV-grade inventory ingested into TIMO's system of record (most use Remsoft, SilviaTerra, ForestMetrix, or an in-house SQL+ArcGIS stack)
4. Independent appraisal layered on cruise (USPAP-compliant)
5. LP investment committee sees the cruise + appraisal + DCF before capital is called

**AcreOS has no ingest path for any of this.** No shapefile import beyond GeoJSON parcels, no cruiser-role permissioning, no `cruise_events` or `volume_observations` table, no chain-of-custody for inventory data (a Custody-Rule-relevant question, see §3.5). A Land Investor doesn't need this; a TIMO cannot operate without it.

### 3.4 Carbon-credit programs

Carbon is the genuinely interesting newer revenue stream for institutional timber and the one place a software vendor *could* differentiate — but it is a heavyweight integration:

- **Registry** — Verra (VCS), American Carbon Registry (ACR), Climate Action Reserve (CAR), Gold Standard. Each has its own API and project-listing JSON.
- **Methodology** — for IFM (Improved Forest Management) projects: VM0045, ACR IFM-on-non-Federal-Lands. For ARR (Afforestation/Reforestation): VM0047, AR-ACM0003.
- **Baseline + project scenario** — modeled growth & yield over 100-yr project life, validated by third-party DOE
- **Issuance ledger** — tCO2e issued per vintage, retired vs held, buffer-pool deductions
- **Beneficial-use accounting** — carbon revenue allocated to fund vs landowner under the LP agreement
- **Permanence + reversal risk** — buffer-pool contributions, insurance, monitoring obligations

**AcreOS has zero carbon scaffolding.** There is no registry integration, no project-vintage ledger, no IFM/ARR awareness, no buffer-pool concept. The closest is an "ESG" mention in solar-potential scoring, which is a different product. To even minimally serve a TIMO carbon program, AcreOS would need an entire sub-module that is more complex than its current core; this is the work of a dedicated SaaS company (NCX, SilviaTerra/Bayer, Pachama, Finite Carbon — all venture-funded and still struggling).

### 3.5 RIA / SEC compliance — the deal-killer

Most TIMOs of any meaningful size are **registered investment advisers** under the Investment Advisers Act of 1940 (the carve-out for "real-estate-only" advisers narrowed materially under Dodd-Frank; private-fund advisers managing >$150M file Form PF). Compliance overhead I'd need from any system-of-record:

- **Custody Rule (Rule 206(4)-2)** — surprise verification by independent CPA, or qualified-custodian arrangement. Inventory data integrity matters: if the cruise underlying NAV is mutable, my surprise-audit fails.
- **Books and Records Rule (Rule 204-2)** — 5-year retention for advisory records, with a write-once requirement for many. AcreOS's mutable-state pattern (Hassiba flagged that tier changes overwrite in place; same applies to most entities) **fails this on its face**.
- **Form ADV-2A annual update** — disclosure of material changes, conflicts, fee structure. Not a software problem directly, but the *AUM-roll-forward* derives from system-of-record NAV.
- **Form PF (if AUM>$150M)** — confidential filing with SEC; line-items include illiquid-asset valuation methodology, leverage, counterparty exposure.
- **Marketing Rule (Rule 206(4)-1, 2021 amendments)** — performance advertising must include net-of-fees, 1/5/10-yr or since-inception, and standardized presentation. Anything generated from AcreOS that ends up in a pitch deck triggers this — and AcreOS has no concept of fund-level vs gross-deal performance.
- **Annual SOC 2 Type II report** for any vendor in the system-of-record path. AcreOS does not have one (and at single-engineer team size, cannot have a defensible SOC 2 in <12 months).
- **Cybersecurity Rule (proposed Reg S-P/S-ID amendments)** — incident-reporting timelines, vendor-management diligence. AcreOS's privacy posture per Anouk's wave-2 audit (no signed sub-processor DPAs, PII-in-prompt to OpenAI/Anthropic without ZDR) **would not pass** my cybersecurity review.

**This is the hard stop.** Even if every other primitive were built, my CCO will not approve a system-of-record that cannot survive a Custody-Rule surprise audit and has zero SOC 2 history. AcreOS would need to invest **>$300k/yr in compliance ops** to be RIA-grade — a budget that does not pencil against the institutional-timber TAM.

### 3.6 Hold period and rotation modeling

A loblolly plantation in the South runs:

- Year 0: site prep + plant
- Year 0–4: herbaceous weed control, possibly mid-rotation fertilization
- Year 12–16: first thin (pre-commercial may occur earlier in dense stands)
- Year 18–22: second thin (sometimes skipped)
- Year 24–30: final harvest

A TIMO fund's **10-year hold straddles 1–2 thins and possibly a final harvest** depending on age at acquisition. Cash-flow modeling has to handle:

- Multi-decade biological growth (non-linear, sigmoid)
- Stumpage-price scenario analysis (pulpwood vs CNS vs sawtimber, mill-shed dependencies)
- Casualty scenarios with insurance recoveries
- Recreation lease income (hunt clubs, $8–$25/ac/yr)
- Pine-straw raking ($50–$200/ac on raked stands)
- Easement income (conservation, road, utility)
- Property-tax forms (current-use-valuation in most Southern states — Georgia CUVA, SC Ag-Use, AL Current Use)

**AcreOS's `dealUnderwriting.ts` notes "Extended hold period increases carrying cost risk" at >18 months** — a tell that the product is built around a 12-week-to-12-month flip horizon. The financial modeling is the wrong shape. Not "missing features" — wrong shape.

---

## 4. What AcreOS does that *would* still be useful to me

To be fair: there are three small surfaces I'd actually take, if priced right and available standalone.

1. **AVM + comp-sales surface** (`client/src/pages/avm.tsx`, `avm-bulk.tsx`) — for pre-cruise screening of inbound deals. I get a kit-bag of AVMs already (Lightbox, CoreLogic, Forisk for timber-specific) but a $79/mo screening tool is cheap. **Caveat: AcreOS's AVM is not timber-aware.** It's land-comp-driven, not stumpage+land-base. Useful for the *land* component, blind to the *timber* component, and the timber component is 60–80% of the value. So: marginal screening value, not core.
2. **Document generation** (purchase agreement, deed) — TIMO acquisitions use 40–80-page PSAs with reps & warranties our outside counsel drafts. AcreOS's doc gen is for 2-page seller-finance deeds. **Wrong document size.** Not useful.
3. **Lead/seller pipeline** — for *direct-sourced* family-tract acquisitions in the 200–800 ac band that come in by phone or referral. About 20% of our deal flow is direct; the rest is broker/auction. AcreOS's pipeline is sized for high-volume direct mail at the small-tract end. The *concept* fits; the *scale* and *workflow* don't.

Net: there is no module of AcreOS I would buy as a TIMO. The thesis "small operator tool vs institutional fit" — which Della Mae raised when she sent me the link — answers cleanly. **AcreOS is the right tool for Land Investors. It is not adjacent to my work.**

---

## 5. The honest competitive-landscape framing

The institutional-timber software market is small and well-served by purpose-built incumbents:

- **Remsoft** (Woodstock + Stanley) — strategic + tactical forest planning, used by every major US TIMO and Canadian forest-products company
- **SilviaTerra/NCX** — high-resolution forest inventory + carbon-program platform (Bayer-acquired SilviaTerra for the basemap)
- **ForestMetrix** — cruise data capture and analysis
- **FORSight** — Forisk's market-data + timberland-comps subscription
- **eLandFutures / TimberMart-South** — stumpage price reporting
- **Yardi / SS&C / Allvue** — fund-administration platforms (NAV, capital-account, LP reporting)
- **Custom in-house Postgres+ArcGIS+Tableau stacks** — most large TIMOs (Hancock, Manulife, RMS, Domain, FIA) run a hand-rolled core and integrate the above

**AcreOS does not compete with any of these and shouldn't try.** The wedge a horizontal SaaS could carve in this space is "the integration layer" — but that is a 3–5 year, $20M+ build with deep forestry domain hires, and the buyers (50–80 TIMOs in North America, ~30 with material AUM) are conservative on vendor adoption and resistant to startups without a 10-year track record. The TAM is real but slow; the unit economics suit a Forisk-style market-data subscription, not a per-seat SaaS.

---

## 6. Recommendation to Tom

1. **Do not add timber-institutional to the roadmap.** Not now, not in v2, not in the adjacent-verticals waitlist. The product distance is too large and the buyer cycle is too slow for a single-founder team.
2. **Position copy should make the floor visible.** AcreOS is for Land Investors moving rural parcels. State the upper bound — somewhere on `pricing.tsx` or `landing/Pricing.tsx` — that this is not a fund-administration tool, not a TIMO platform, not an RIA-grade system of record. Honest scope helps the right buyer self-select and protects the brand from the inevitable "I tried AcreOS for my $20M family-office tract program and it didn't fit" tweet.
3. **Stand-level inventory is interesting at the *small-timber* tier — Della Mae's tier — not at TIMO scale.** A 6-month investment in lightweight stand modeling (parent-of-parcels, age, species, last-cruise event, basic G&Y projection) extends AcreOS into the 200–2,000 acre family-timber operator band. That buyer overlaps Della's persona profile and is reachable through AcreOS's existing channels. **This is the right ceiling-stretch — not TIMO, not fund admin, but a "small forester's portfolio" mode**, sitting above current Scale and below institutional. Single SKU, $149/mo, gated on inventory volume.
4. **Carbon is interesting but gated behind §3.4's heavyweight integration cost.** Don't build it; if it ever comes, partner with NCX or a similar registry-aware vendor and consume their issuance feed. A "carbon-aware portfolio view" is a one-quarter integration if a partner exists; a "carbon-program platform" is a four-year company.
5. **Take Anouk's privacy posture and Hassiba's reporting plan seriously *regardless* of TIMO ambitions.** The single biggest barrier to AcreOS ever being institutionally credible is the SOC 2 / DPA / immutable-records gap — even if no TIMO ever buys, this gap blocks any $100M+ M&A exit (Harlowe-acquisition wave-2 audit confirms). Fix the foundation; don't chase the institutional dollar before the foundation holds.

---

## 7. The one thing I'd want AcreOS to put in writing

A sentence on the homepage or pricing page of the form:

> "AcreOS is built for Land Investors managing portfolios of rural parcels — typically 5–80 acres, $5k–$200k per tract. We are not a fund-administration platform, a TIMO system of record, or a registered-investment-adviser tool. If you are managing institutional timber capital, you want Remsoft, SilviaTerra, or a custom stack."

That sentence saves Tom a thousand support tickets, makes the product more buyable to the right segment, and prevents the "tried-and-failed" social proof that quietly damages a category-defining tool's reputation in adjacent segments. **Honest scope is the highest-leverage thing a small-team SaaS can ship.**

---

## 8. Verdict, restated

| Dimension | TIMO requirement | AcreOS today | Gap |
|---|---|---|---|
| Stand-level inventory | Cruise-grade | None | Architectural |
| NAV / LP reporting | ASC 820/946 quarterly | None | Architectural |
| Carbon program | Verra/ACR ledger | None | Architectural |
| RIA compliance | Books-and-records, Custody, SOC 2 | None | Compliance |
| Tract scale | 500–4,000 ac | Any (no upper limit but UI assumes small) | UX / scale |
| Hold-period modeling | 7–12 yr biological | <18 mo flip-shaped | Domain mismatch |
| Buyer cycle | 18 mo, CCO+IC approval | Self-serve credit card | Sales motion |
| Counterparty trust | Decade-track-record vendors | 1-yr SaaS, single founder | Reputational |

**Fit: 0/8.** This is not a "needs work" verdict — it is a *correctly scoped product* verdict. AcreOS is doing the right thing for its actual buyer. The TIMO segment is not its buyer and should not become its buyer. Della Mae's question is answered: yes, AcreOS is "the same crowd" as the small-tract Land Investors — and that's a feature, not a bug. Tell her to enjoy the tool. I'll keep my Postgres+ArcGIS+Excel+Yardi stack.

— Burt
