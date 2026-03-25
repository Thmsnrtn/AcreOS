# 18 Free Data Sources Every Land Investor Should Know

Most land investors make buying decisions based on price, acreage, and a gut feeling about the county. That's leaving money on the table — or worse, buying problems you didn't know existed.

The US government publishes an enormous amount of geospatial and environmental data through free APIs. If you know where to look, you can run due diligence on any parcel in the country without paying for a data subscription.

Here are the 18 free data sources I use for every deal, what they tell you, and why they matter.

## 1. FEMA National Flood Hazard Layer (NFHL)

**What it tells you:** Whether the parcel is in a flood zone and which zone (A, AE, X, etc.).

**How to access it:** [msc.fema.gov/portal/search](https://msc.fema.gov/portal/search) — enter an address or coordinates.

**Why it matters:** A parcel in Zone A or AE is virtually unsellable to most retail buyers without flood insurance. This is the single most important data point for land investing. Check it first, before anything else.

## 2. USGS 3D Elevation Program (3DEP)

**What it tells you:** Elevation, slope, and terrain profile for any location in the US.

**How to access it:** [nationalmap.gov/epqs](https://nationalmap.gov/epqs/) — point query service with REST API.

**Why it matters:** Steep slopes increase development costs. Low-lying areas may have drainage issues even outside official flood zones. Elevation data helps you understand the buildability of a parcel without visiting it.

## 3. USDA National Agricultural Statistics Service (NASS)

**What it tells you:** Average agricultural land values by county, crop production data, and farmland rental rates.

**How to access it:** [quickstats.nass.usda.gov](https://quickstats.nass.usda.gov/) — query tool with CSV export.

**Why it matters:** County-level land values give you a baseline for pricing. If you're buying at 30% of the USDA-reported average value per acre, you know you're in a reasonable range. Also useful for identifying counties where land values are trending up.

## 4. USDA Web Soil Survey

**What it tells you:** Soil composition, drainage class, and agricultural capability for any location.

**How to access it:** [websoilsurvey.nrcs.usda.gov](https://websoilsurvey.nrcs.usda.gov/) — interactive map with detailed soil reports.

**Why it matters:** Soil type determines what can be built on the land. Sandy soil with poor drainage means expensive septic systems. Clay soil may have foundation issues. For agricultural buyers, soil capability class directly affects the land's productive value.

## 5. Census American Community Survey (ACS)

**What it tells you:** Demographics, median household income, population density, housing characteristics by census tract.

**How to access it:** [data.census.gov](https://data.census.gov/) — tables and maps.

**Why it matters:** Demographics tell you who your buyer is. High median income + low population density = potential for recreational/ranch buyers willing to pay premium prices. Growing population = appreciation potential. Declining population = be cautious about holding.

## 6. Census Population Estimates Program (PEP)

**What it tells you:** Annual population estimates and growth rates by county.

**How to access it:** [census.gov/programs-surveys/popest](https://www.census.gov/programs-surveys/popest.html)

**Why it matters:** Population growth is the strongest predictor of land value appreciation. Counties growing 2%+ annually are where you want to buy and hold. Counties losing population are where you want to flip fast.

## 7. EPA Enforcement and Compliance History (ECHO)

**What it tells you:** Environmental compliance violations, enforcement actions, and permit information for facilities near your parcel.

**How to access it:** [echo.epa.gov](https://echo.epa.gov/) — search by location.

**Why it matters:** A Superfund site or facility with compliance violations within a mile of your parcel is a deal-killer for most buyers. Check this before you spend time on other due diligence.

## 8. EPA Facility Registry Service (FRS)

**What it tells you:** Location of all EPA-regulated facilities — treatment plants, waste sites, industrial facilities.

**How to access it:** [epa.gov/frs](https://www.epa.gov/frs) — facility search and mapping.

**Why it matters:** Proximity to regulated facilities affects property values and buyer perception. Even a permitted facility in good compliance can spook retail buyers. Know what's nearby.

## 9. USFWS National Wetlands Inventory (NWI)

**What it tells you:** Mapped wetland boundaries on or near your parcel.

**How to access it:** [fws.gov/program/national-wetlands-inventory/wetlands-mapper](https://www.fws.gov/program/national-wetlands-inventory/wetlands-mapper)

**Why it matters:** Wetlands are protected under the Clean Water Act. Building on or filling wetlands requires Army Corps of Engineers permits that can take years and cost tens of thousands. If a parcel has significant wetland coverage, the developable acreage is much less than the total acreage.

## 10. Bureau of Land Management (BLM)

**What it tells you:** Location of federal public lands, mining claims, and land patents.

**How to access it:** [blm.gov/maps](https://www.blm.gov/maps)

**Why it matters:** Adjacency to BLM land can be a selling point (recreation access, no future development on that side) or a complication (access easements, mineral rights). Also useful for verifying that the parcel you're buying isn't actually public land.

## 11. National Land Cover Database (NLCD)

**What it tells you:** Land cover classification — forest, grassland, developed, wetland, cropland, barren.

**How to access it:** [mrlc.gov/viewer](https://www.mrlc.gov/viewer/)

**Why it matters:** Land cover tells you the current state of the parcel without visiting it. Dense forest = clearing costs. Existing development nearby = infrastructure access. Cropland = potential agricultural income. Barren = check for environmental issues.

## 12. USGS Earthquake Hazards Program

**What it tells you:** Seismic hazard levels, historical earthquake data, and fault line proximity.

**How to access it:** [earthquake.usgs.gov/hazards](https://earthquake.usgs.gov/hazards/)

**Why it matters:** Primarily relevant for western states. High seismic hazard zones have stricter building codes and higher insurance costs. Buyers building homes will factor this in.

## 13. NOAA Climate Data

**What it tells you:** Historical weather patterns, precipitation, temperature extremes, and climate normals.

**How to access it:** [ncdc.noaa.gov/cdo-web](https://www.ncdc.noaa.gov/cdo-web/)

**Why it matters:** Climate affects what the land can be used for and how desirable it is. Extreme heat, heavy precipitation, or drought patterns all affect land values. Recreational land in a region trending hotter and drier is worth less than the comps suggest.

## 14. OpenStreetMap (OSM)

**What it tells you:** Road networks, infrastructure proximity, points of interest, and accessibility.

**How to access it:** [openstreetmap.org](https://www.openstreetmap.org/) — free with API access.

**Why it matters:** Road access is one of the top three factors in land value. A 40-acre parcel with paved road frontage is worth 3-5x more than the same parcel with no legal access. OSM data lets you verify road proximity and type (paved, gravel, dirt, 4WD) without visiting.

## 15. NREL National Solar Radiation Database (NSRDB)

**What it tells you:** Solar irradiance levels and photovoltaic potential for any location.

**How to access it:** [nsrdb.nrel.gov](https://nsrdb.nrel.gov/)

**Why it matters:** Solar potential is increasingly relevant as energy companies lease land for solar farms. High-irradiance parcels in utility-accessible areas can command premium lease rates. Even for residential buyers, good solar potential is a selling point.

## 16. US Forest Service (USFS) — Wildfire Risk

**What it tells you:** Wildfire risk ratings, historical burn areas, and fire probability.

**How to access it:** [wildfirerisk.org](https://wildfirerisk.org/)

**Why it matters:** High wildfire risk zones have expensive insurance, building restrictions, and disclosure requirements. In California, Colorado, and other fire-prone states, this data can make or break a deal.

## 17. US Fish and Wildlife Service — Endangered Species

**What it tells you:** Critical habitat designations and endangered species ranges that overlap with your parcel.

**How to access it:** [ecos.fws.gov/ecp/report/critical-habitat](https://ecos.fws.gov/ecp/report/critical-habitat)

**Why it matters:** Critical habitat designation severely restricts development. The Endangered Species Act can block construction, require environmental impact studies, and add years to any development timeline. Check before you buy.

## 18. SSURGO — Detailed Soil Data

**What it tells you:** Highly detailed soil survey data including percolation rates, shrink-swell potential, and engineering properties.

**How to access it:** [sdmdataaccess.nrcs.usda.gov](https://sdmdataaccess.nrcs.usda.gov/)

**Why it matters:** This is the engineering-grade soil data. Percolation rates determine septic system feasibility. Shrink-swell potential affects foundation design. If your buyer plans to build, these details matter more than generic soil classification.

---

## The Bottom Line

Each of these sources gives you a piece of the puzzle. Together, they give you a comprehensive picture of any parcel's investment quality — flood risk, buildability, environmental issues, market dynamics, and access.

I built a platform called AcreOS that queries all 18 of these automatically and produces a one-click due diligence report with a Land Credit Score (300-850) for every parcel. It's in beta right now.

Want to try it? DM me.
