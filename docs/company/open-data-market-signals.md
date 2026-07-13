# Free & Open US Data for a Land/Real-Estate SaaS: Parcels, Addresses, Market Context

_Research report 2026-07-13 (Open-Data Program, task stream 3 of 4). Companion to
`open-data-program.md`. Every claim cited; licenses marked "unclear" where unverifiable._

Research date: 2026-07-13. All claims cited; licenses marked "unclear" where not verifiable.

## 1. Statewide parcel programs (free polygons + attributes)

There is **no free national parcel database**. Cadastral data is an FGDC/NSDI framework theme, and a CRS report documented the long-standing national gap ([CRS R40717 via FGDC](https://www.fgdc.gov/resources/whitepapers-reports/CRS_Reports/CRS-R40717-Issues-Regarding-a-National-Land-Parcel.pdf)). The gap is filled commercially — [Regrid](https://regrid.com/nationwide-parcels) sells nationwide parcels starting around **$80K/yr** for enterprise licensing. Strategy implication: use free state programs where they exist; pay Regrid (or ReportAll etc.) only for the remaining states.

Verified free statewide programs:

| State | Program | Notes | Link |
|---|---|---|---|
| MT | Montana Cadastral (MSDI) | Statewide polygons + full DOR CAMA (Orion) attribute DB per county; free download | [msl.mt.gov](https://msl.mt.gov/geoinfo/msdi/cadastral/), [viewer](https://svc.mt.gov/msl/cadastral/) |
| NC | NC OneMap Parcels | All 100 counties, standardized schema, FGDB/GeoPackage/shapefile + services | [nconemap.gov/pages/parcels](https://www.nconemap.gov/pages/parcels) |
| NJ | NJGIN Parcels Composite | Statewide edge-matched composite, free download | [nj.gov/njgin](https://nj.gov/njgin/edata/parcels/) |
| NY | NYS Tax Parcels Public | Free, but only ~38 counties opted into the public download (statewide centroids exist); annual update | [gis.ny.gov/parcels](https://gis.ny.gov/parcels) |
| AR | Arkansas GIS Office | Statewide parcel polygons + centroids, ~74 of 75 counties, free | [gis.arkansas.gov](https://gis.arkansas.gov/product/parcel-polygon-county-assessor-mapping-program-polygon/) |
| TN | TN Property Boundaries Public Use | ~86 counties (4 large self-mapping counties separate via Comptroller) | [TNMap open data](https://tn-tnmap.opendata.arcgis.com/maps/53ee269639334ad8b70bfea77bde7333), [Comptroller](https://comptroller.tn.gov/office-functions/pa/gisredistricting/redistricting-and-land-use-maps/parcel-data.html) |
| FL | FL DOR Statewide Cadastral | All 67 counties, ~10.8M parcels, collected annually from appraisers, includes DOR use codes + NAL tax-roll attributes | [floridarevenue.com](https://floridarevenue.com/property/Pages/Cofficial_GIS.aspx), [Florida GIO](https://geodata.floridagio.gov/datasets/FGIO::florida-statewide-parcels/about) |
| WA | WA Current Parcels | Statewide composite w/ parcel ID, situs address, DOR land-use codes, land+improvement values; updated 2026 | [geo.wa.gov](https://geo.wa.gov/datasets/current-parcels) |
| OR | ORMAP + Statewide Parcels Initiative | ORMAP is the tax-map base; a statewide parcel GIS effort launched Sept 2023 — coverage still maturing | [geohub.oregon.gov](https://geohub.oregon.gov/pages/parcel-viewer), [data.oregon.gov](https://catalog.data.gov/dataset/ormap-the-oregon-property-tax-map) |
| KS | Kansas DASC | State GIS clearinghouse hosts county parcel data; statewide public bulk download terms **unclear** — verify before ingest | [kansasgis.org](https://kansasgis.org/) |

Also worth checking (not verified this pass): Wisconsin Statewide Parcel Map Initiative, Utah, Maryland, Vermont, Massachusetts — all have statewide programs of varying openness. Licenses on state parcel data are usually "public record / no explicit open license" — treat attribution-required and check per-state disclaimers (most disclaim survey accuracy).

## 2. Addresses

| Source | Detail |
|---|---|
| **DOT National Address Database (NAD)** | ~**80M+ address point records**, compiled from 30+ state/local/tribal partners; explicitly **public domain**; refreshed on a rolling release cycle (latest compile June 30, 2026). DOT publishes no official coverage %; coverage is partial and varies by state (~80M records vs. an estimated 150M+ national addresses — roughly half to two-thirds, uneven). [transportation.gov/gis/national-address-database](https://www.transportation.gov/gis/national-address-database), [data.gov entry](https://catalog.data.gov/dataset/national-address-database-nad-text-file) |
| **OpenAddresses** | Global repo of address/building/parcel sources. **No single license** — each source keeps its original license; most are attribution-only, a meaningful minority are share-alike; per-source license is documented in each source JSON. Compliance burden is real for a SaaS. [github.com/openaddresses](https://github.com/openaddresses/openaddresses), [attribution page](https://openaddresses.io/attribution/) |

## 3. Land values / ag

| Source | Detail |
|---|---|
| **USDA NASS Land Values + Cash Rents** | Annual Land Values Summary (farm real estate, cropland, pastureland $/acre by state/region) and **county-level Cash Rents survey** (annual, all states except AK, released August). Free via Quick Stats API with free key. [Quick Stats API](https://quickstats.nass.usda.gov/api), [Cash Rents survey](https://www.nass.usda.gov/Surveys/Guide_to_NASS_Surveys/Cash_Rents_by_County/), [Land Values charts](https://www.nass.usda.gov/Charts_and_Maps/Land_Values/index.php) |
| **USDA ERS Farmland Value** | Analysis layer on NASS data: trends, drivers (rates, soil, urban proximity), regional context. Free, public domain. 2025: US farmland avg $4,350/acre, +4.3% YoY. [ers.usda.gov farmland value](https://www.ers.usda.gov/topics/farm-economy/land-use-land-value-tenure/farmland-value) |

## 4. Migration / demand signals

| Source | Detail |
|---|---|
| **IRS SOI county-to-county migration** | Free CSV downloads, filing years 1991–2023, inflow/outflow with return counts, exemptions, and **AGI** — lets you see not just how many people move to a county but the income they bring. [IRS SOI migration](https://www.irs.gov/statistics/soi-tax-stats-county-to-county-migration-data-files), [downloads](https://www.irs.gov/statistics/soi-tax-stats-migration-data-downloads) |
| **HUD USPS vacancy (CoA-adjacent)** | Quarterly tract-level vacant/no-stat counts. Registration is free, **but access is restricted to governmental entities and non-profit organizations** under HUD's USPS sublicense — a for-profit SaaS is NOT eligible. This corrects the "requires registration but free" assumption: free, but not for commercial use. [huduser.gov USPS data](https://www.huduser.gov/portal/datasets/usps.html) |
| **U-Haul Growth Index** | Confirmed **NOT open**: rankings derive from U-Haul's proprietary one-way rental transactions; annual press-release rankings only, no licensed raw data. Same story for United Van Lines' Movers Study. [uhaul.com/About/Migration](https://www.uhaul.com/About/Migration/) |
| Free substitutes | Census county Population Estimates (components of change incl. net migration) and ACS county-to-county migration flows API — both free/public domain: [PEP](https://www.census.gov/data/tables/time-series/demo/popest/2020s-counties-total.html), [ACS flows API](https://www.census.gov/data/developers/data-sets/acs-migration-flows.html) |

## 5. Employment / economy

| Source | Detail |
|---|---|
| **BLS LAUS** | Monthly county-level unemployment/labor force. API v1 keyless; v2 free registration key with higher limits. US-government work = public domain. [LAUS](https://www.bls.gov/lau/), [API](https://www.bls.gov/developers/home.htm) |
| **BLS QCEW** | Quarterly county employment + wages by industry; bulk **open CSV files** (no key needed) for the last 5 years, plus API. [QCEW open data](https://www.bls.gov/cew/additional-resources/open-data/) |
| **BEA Regional** | County GDP and personal income (incl. rents/dividends components). Free key (email signup), 100 req/min limit, agree to published ToS; data itself public domain. [BEA regional](https://www.bea.gov/data/economic-accounts/regional), [API signup](https://apps.bea.gov/api/signup/) |

## 6. Building permits

**Census Building Permits Survey (BPS)** — monthly and annual housing-unit permit counts at national/state/CBSA/**county/place** level, free comma-delimited downloads, no key. Caveat: covers permit-issuing places; rural non-permitting areas are estimated/absent — relevant for rural land markets. [census.gov/permits](https://www.census.gov/permits), [current data](https://www.census.gov/construction/bps/current.html)

## 7. Foreclosure / pre-foreclosure

Confirmed: **no free national dataset exists.** The raw records (lis pendens, notices of default, trustee sales) are free **public records at the county recorder/court level**, retrievable one county at a time; paid aggregators (ATTOM/RealtyTrac, Foreclosure.com, PropertyRadar, BatchData) charge for aggregation, normalization, and skip-trace enrichment, not the underlying records ([LegalClarity overview](https://legalclarity.org/how-to-get-a-list-of-foreclosures-free-and-paid-sources/), [OffMarketLab on sourcing](https://offmarketlab.com/blog/where-pre-foreclosure-data-comes-from/)). Free but narrow: HUDHomeStore/HomePath REO listings; some county clerks publish searchable lis pendens (e.g., [Santa Rosa Co. FL](https://santarosaclerk.com/courts/foreclosures-tax-deeds/lis-pendens-foreclosures/)). Practical takeaway: free at scale only if you build per-county scrapers for target counties; otherwise this stays a paid category.

## 8. Owner contact / skip-trace adjacent

Confirmed: **nothing legitimate is free here.** DMV records are federally restricted under the **DPPA** — marketing use is a federal violation ([DPPA guide](https://terms.law/2023/08/01/drivers-privacy-protection-act-dppa/)); voter files are state-restricted, typically to electoral/legal purposes ([EAC state-by-state matrix](https://www.eac.gov/sites/default/files/voters/Available_Voter_File_Information.pdf)); phone/email append is entirely commercial PII-vendor territory ([skip-trace industry overview](https://legalclarity.org/what-is-skip-tracing-and-how-does-it-work/)). The platform should keep its paid per-lookup provider model — owner *names/mailing addresses* come free with parcel data, but contactability data does not.

## 9. School quality

| Source | Detail |
|---|---|
| **NCES / EDFacts / CCD** | Free raw federal data: school directory, enrollment, assessment proficiency (EDFacts), plus CRDC. Public domain but requires you to build your own rating methodology. [nces.ed.gov](https://nces.ed.gov/) (see also Urban Institute's free [Education Data Portal API](https://educationdata.urban.org/) which wraps CCD/EDFacts) |
| **GreatSchools** | Confirmed **not free for this use**: ratings are proprietary; commercial access (the real-estate-oriented NearbySchools API / data licensing) is a **paid partner license** ([licensing](https://www.greatschools.org/gk/licensing/), [NearbySchools API](https://www.greatschools.org/solutions/k12-data-solutions/nearbyschools-api), [API hub](https://www.greatschools.org/api)) |
| State report cards | Each state DOE publishes free report-card data (varied formats/licenses — per-state, mostly open; effort-heavy to normalize) |

## 10. Crime

**FBI Crime Data Explorer (CDE) API** — free via api.data.gov key; SRS + NIBRS data at the **agency level** ([cde.ucr.cjis.gov](https://cde.ucr.cjis.gov/), [API repo](https://github.com/fbi-cde/crime-data-api)). Limitations for property-level context: (1) agency ≠ geography — mapping sheriff/PD jurisdictions to parcels/counties is lossy; (2) participation gaps and the SRS→NIBRS transition break year-over-year comparability; (3) the FBI explicitly discourages location rankings ([UCR program](https://www.fbi.gov/how-we-can-help-you/more-fbi-services-and-information/ucr)). Usable as coarse county context only, never parcel-level.

---

## Master table

| # | Need | Source | Granularity | Access | License | Link |
|---|---|---|---|---|---|---|
| 1 | Parcels (10+ states) | State programs (MT, NC, NJ, NY, AR, TN, FL, WA, OR…) | Parcel polygon + attrs | Bulk download / services, free | Public record; per-state terms (KS unclear) | see §1 |
| 1 | Parcels (rest of US) | Regrid (paid) | Parcel, nationwide | Commercial license ~$80K+/yr | Proprietary | [regrid.com](https://regrid.com/nationwide-parcels) |
| 2 | Addresses | DOT NAD | Address point, ~80M records, partial US | Free bulk, no key | **Public domain** | [DOT NAD](https://www.transportation.gov/gis/national-address-database) |
| 2 | Addresses | OpenAddresses | Address point, per-source | Free bulk | **Per-source** (attribution/share-alike mix) | [github](https://github.com/openaddresses/openaddresses) |
| 3 | Land values / rents | USDA NASS Quick Stats | State (values), **county (cash rents)**, annual | Free API (free key) | Public domain | [API](https://quickstats.nass.usda.gov/api) |
| 3 | Farmland trends | USDA ERS | State/region, annual | Free download | Public domain | [ERS](https://www.ers.usda.gov/topics/farm-economy/land-use-land-value-tenure/farmland-value) |
| 4 | Migration + income | IRS SOI | County-to-county flows w/ AGI, annual | Free CSV | Public domain | [IRS](https://www.irs.gov/statistics/soi-tax-stats-county-to-county-migration-data-files) |
| 4 | Vacancy signal | HUD USPS | Census tract, quarterly | Free registration, **gov/nonprofit only** | Restricted sublicense — not for commercial SaaS | [HUD](https://www.huduser.gov/portal/datasets/usps.html) |
| 4 | Migration buzz | U-Haul / United Van Lines | State, annual PR | Press releases only | **Proprietary — not open** | [U-Haul](https://www.uhaul.com/About/Migration/) |
| 5 | Unemployment | BLS LAUS | County, monthly | Free API (free key for v2) | Public domain | [LAUS](https://www.bls.gov/lau/) |
| 5 | Jobs + wages | BLS QCEW | County × industry, quarterly | Free open CSVs, no key | Public domain | [QCEW](https://www.bls.gov/cew/additional-resources/open-data/) |
| 5 | GDP / income | BEA Regional | County, annual | Free API (free key) | Public domain, ToS | [BEA](https://apps.bea.gov/api/signup/) |
| 6 | Building permits | Census BPS | Place/county/CBSA, monthly+annual | Free CSV, no key | Public domain | [BPS](https://www.census.gov/permits) |
| 7 | Foreclosure | County recorders/courts | Per-county filings | Free but county-by-county | Public record | [overview](https://legalclarity.org/how-to-get-a-list-of-foreclosures-free-and-paid-sources/) |
| 8 | Skip-trace / contacts | None free | — | Paid vendors only (DPPA/voter restrictions) | Restricted | [DPPA](https://terms.law/2023/08/01/drivers-privacy-protection-act-dppa/) |
| 9 | School data (raw) | NCES/EDFacts/CCD | School/district | Free bulk + Urban Inst. API | Public domain | [NCES](https://nces.ed.gov/) |
| 9 | School ratings | GreatSchools | School | **Paid partner license** | Proprietary | [licensing](https://www.greatschools.org/gk/licensing/) |
| 10 | Crime | FBI CDE API | **Agency-level** (not parcel/county-native) | Free API key | Public domain, comparability caveats | [CDE](https://cde.ucr.cjis.gov/) |

## Top 5 by signal value for LAND deals specifically

Ranked for lead scoring + County Opportunity Score improvement, given NASS integration and the score already exist:

1. **State parcel programs (§1)** — the single biggest unlock. Free polygons + assessed values + land-use codes + owner mailing address in 10+ states directly replace per-parcel Regrid spend for lead gen in those states: acreage filters, out-of-state-owner flags, assessed-value-per-acre comps. Nothing else on this list touches deal-level data.
2. **IRS SOI county-to-county migration** — the best free *demand* signal for land: net inflow **weighted by AGI** identifies counties where buyer money is arriving 1–3 years before it shows in land prices. Direct multi-year time-series input to the County Opportunity Score.
3. **Census Building Permits Survey** — permits are the conversion event for land (land → lots → houses). Place/county-level permit acceleration is the leading indicator that raw land near a growth node is about to reprice; pairs naturally with parcel acreage data for "path of growth" scoring.
4. **NASS county cash rents** (deepen the existing integration) — county cash rent ÷ asking price per acre gives an income-yield floor on ag land, the closest thing to a free "cap rate" for land underwriting; combine with ERS trend context for hold-period appreciation assumptions.
5. **BLS QCEW + BEA county income** — the economic-durability leg of county scoring: employment/wage growth by industry and per-capita income trajectory separate structural growth counties from one-off migration blips, and both are keyless/free at county grain.

Notably excluded from top 5: HUD USPS vacancy (license bars commercial use), crime and schools (weak signals for rural/vacant land; agency-level crime doesn't map cleanly, school ratings matter for houses more than acreage), foreclosure (high value but not free at scale).
