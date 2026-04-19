# Regional Variations: Land Markets Across the United States

This knowledge file equips the intelligent E2E test harness with domain awareness
of how land investing rules, conventions, and market dynamics differ by state and
region. Tests that generate fake parcels, simulate due diligence flows, or validate
offer-letter logic must respect these variations to produce realistic scenarios.

---

## Tax-Deed States vs Tax-Lien States

When a property owner fails to pay property taxes, the county eventually auctions
some interest in the property. The mechanism differs by state, and this distinction
matters because it affects the acquisition pipeline, timeline, and risk profile.

### Tax-Deed States

In a tax-deed state the county sells the actual deed to the property at auction.
The winning bidder receives ownership (subject to a possible redemption period).

| State | Redemption Period | Notes |
|-------|-------------------|-------|
| TX    | 25 months (rural) / 180 days (homestead) | "Strike-off" properties resold by county |
| FL    | None after sale | Clerk of Court conducts sale; "right of redemption" ends at auction |
| AZ    | None after sale | Treasurer's sale; 3-year delinquency before sale |
| CA    | None after sale | Power-to-sell via county tax collector |
| CO    | 3-year waiting period, then treasurer's deed | Hybrid behavior; lien sold first |
| NV    | None after sale | County treasurer auction |
| OR    | 2-year redemption pre-sale | Foreclosure-style process |

### Tax-Lien States

In a tax-lien state the county sells a lien certificate. The buyer earns interest
on the delinquent taxes and may eventually foreclose if the owner never pays.

| State | Interest Rate Cap | Redemption Period | Notes |
|-------|-------------------|-------------------|-------|
| NJ    | 18% | 2 years | Competitive bid-down on interest rate |
| IL    | 18% per 6 months | 2-3 years | "Penalty" model, not simple interest |
| IN    | 10-15% | 1 year (residential), 120 days (vacant) | Certificate of sale |
| IA    | 24% annually | ~1 year 9 months | Tax sale certificate |
| SC    | 3-12% | 1 year | Legal-process-heavy redemption |

### Why This Matters to AcreOS

The test harness must know whether a county in the test fixture sells deeds or
liens because:

- **Lead source fields**: A tax-deed lead has "auction_date" and "opening_bid."
  A tax-lien lead has "certificate_number," "interest_rate," and "redemption_deadline."
- **Offer-letter logic**: You do not send a blind offer on a tax-lien certificate;
  you send offers to delinquent owners *before* the sale or you bid at auction.
- **Pipeline stages**: Tax-deed acquisitions skip the "lien payoff" step in due diligence.

---

## Notable Land Investing Markets

### Texas (TX)

Texas is the largest land market by transaction volume for vacant-land investors.

- **Mineral rights separation**: In TX, surface rights and mineral rights are commonly
  severed. A parcel may have been conveyed with "minerals reserved." The test harness
  must model the `mineral_rights_status` field with values like `"intact"`, `"severed"`,
  `"partially_severed"`, and `"unknown"`.
- **Redemption period**: 25 months for non-homestead rural land (6 months for homestead).
  Tax-deed buyers must wait out this window.
- **No state income tax**: Relevant for seller-finance note servicing calculations --
  no state withholding for TX-based borrowers.
- **Key counties**: Hudspeth, Culberson, Jeff Davis (cheap desert), Liberty, Polk
  (timberland), Val Verde, Terrell (ranch country).
- **Pricing**: West TX desert parcels from $500-5,000/acre; Hill Country $5,000-30,000+/acre.

### Arizona (AZ)

A top market for raw-land flips, especially for investors targeting cash buyers
looking for homesite-ready lots.

- **Key counties**: Maricopa (Phoenix metro fringe), Pima (Tucson surrounds),
  Yavapai (Prescott/Verde Valley), Mohave (Kingman corridor), Cochise, Navajo.
- **Water rights**: Arizona follows the prior appropriation doctrine. Surface water
  is administered by the Arizona Department of Water Resources. Groundwater is
  regulated in Active Management Areas (AMAs) -- Maricopa and Pima counties fall
  inside AMAs, meaning well permits are restricted. Outside AMAs, wells are
  essentially unregulated.
- **Subdivision regulations**: Arizona's lot-split rules allow dividing a parcel into
  up to 5 lots without formal subdivision plat, but each lot must meet minimum size
  requirements and have legal access.
- **Tribal land**: Large portions of the state are reservation land -- not available
  for private sale. The harness must never generate test parcels on reservation land.

### Florida (FL)

High volume but fraught with environmental complexity.

- **Wetlands**: USACE (Army Corps of Engineers) wetland designations are extremely
  common across inland FL. A parcel flagged as wetland is essentially unbuildable
  without a costly mitigation permit. The harness should model `wetland_flag` and
  `wetland_percentage` fields.
- **Flood zones**: FEMA flood zones A, AE, V, VE are prevalent. Parcels in these
  zones require flood insurance for any financed structure. The `fema_flood_zone`
  field must be present in FL test fixtures.
- **HOA prevalence**: Many FL subdivisions (Lehigh Acres, Port Charlotte, Cape Coral,
  Poinciana) are platted communities with mandatory HOAs. HOA fees and restrictions
  directly affect resale value and buyer pool.
- **Key counties**: Charlotte, Lee (Lehigh Acres), Polk, Highlands, Hendry, Brevard.
- **Pricing**: Lehigh Acres quarter-acre lots $3,000-15,000; rural acreage varies widely.

### Colorado (CO)

Recreational land and mountain properties.

- **Water rights (Colorado Doctrine)**: Colorado is the strictest prior-appropriation
  state. Surface water rights are entirely separate from land ownership and are
  adjudicated by the state water court. Even collecting rainwater was historically
  restricted (now limited collection is permitted). Well permits for domestic use
  require an "exempt well" permit from the Division of Water Resources.
- **Mountain counties**: Park, Teller, Costilla, Huerfano, Saguache. Many subdivisions
  platted in the 1960s-70s with paper roads that were never built.
- **Access issues**: A significant portion of mountain parcels have no legal or
  physical access. The harness should model `legal_access` and `physical_access`
  as separate boolean fields.
- **Pricing**: San Luis Valley 5-acre parcels $2,000-8,000; Front Range foothill
  parcels $20,000-80,000+.

### New Mexico (NM)

Budget-friendly land with unique challenges.

- **Cheap land**: Among the lowest per-acre prices in the country. 1-5 acre parcels
  for $500-3,000 are common in Valencia, Torrance, Luna, and Sierra counties.
- **Limited access**: Many parcels rely on unimproved dirt roads maintained (loosely)
  by the county. No guaranteed year-round access.
- **BLM adjacency**: Large swaths of NM are Bureau of Land Management land. Parcels
  adjacent to BLM land are marketed as having "millions of acres of public land at
  your doorstep." The harness should model `blm_adjacent` as a boolean.
- **Water**: Prior appropriation state. Domestic wells require a permit from the
  Office of the State Engineer.

### California (CA)

Expensive overall but pockets of affordable land exist.

- **Strict zoning**: California's land-use regulations are among the nation's most
  stringent. CEQA (California Environmental Quality Act) can delay or block
  development of even small parcels.
- **Affordable mountain counties**: Kern (Tehachapi area), San Bernardino (high
  desert), Inyo, Mono. These areas trade at $1,000-10,000/acre for raw land.
- **Fire hazard zones**: Cal Fire maps "Very High Fire Hazard Severity Zones."
  Building permits in these zones require fire-resistant construction, defensible
  space, and sometimes dedicated water storage. Model as `fire_hazard_zone`.
- **Pricing disparity**: Coastal lots $100,000+; desert parcels $1,000-5,000.

### Nevada (NV)

- **BLM dominance**: Approximately 85% of NV land is federally owned (primarily BLM).
  Private land is relatively scarce and clusters near population centers and
  historical mining towns.
- **County-specific rules**: Nye County, Elko County, and Humboldt County each have
  distinct subdivision and building-permit requirements. The harness must not assume
  uniform rules across NV counties.
- **Water**: Highly regulated by the State Engineer. All water rights (surface and
  groundwater) require a permit.

### Oregon (OR)

- **Timber potential**: Western OR counties have significant timber value, sometimes
  exceeding the underlying land value. Timber cruises and stumpage values are part
  of due diligence.
- **Land-use planning (LCDC)**: Oregon's Land Conservation and Development Commission
  enforces some of the strictest land-use planning in the country. Urban Growth
  Boundaries (UGBs) limit where development can occur. Rural land is heavily
  restricted to farm and forest use. The harness should model `zoning_category` with
  values like `"EFU"` (exclusive farm use), `"F-1"` (forest), and `"RR"` (rural
  residential).
- **Key counties**: Klamath, Lake, Josephine, Douglas.

---

## Water Rights Systems

### Prior Appropriation (Western States)

Used in: AZ, CO, NV, NM, OR, CA (partially), TX (partially), and most states
west of the 100th meridian.

- "First in time, first in right" -- the first person to put water to "beneficial
  use" holds the senior right.
- Water rights are a property interest separate from the land.
- Rights can be lost through non-use ("use it or lose it").
- Administered by state engineers or water courts.
- Test fixtures for western parcels should include `water_rights_type`,
  `water_source`, and `well_permit_status`.

### Riparian Rights (Eastern States)

Used in: FL, NJ, IL, IN, and most states east of the 100th meridian.

- Landowners adjacent to a water body have the right to reasonable use.
- Rights are tied to land ownership and cannot be sold separately.
- Less complex for the harness to model -- typically no separate water-rights fields
  are needed.

---

## Mineral Rights Conventions by State

- **TX**: Mineral rights commonly severed. Always check. A conveyance "with all
  minerals" is notable; most chain-of-title transfers reserved some fraction.
- **CO, NM, NV**: Federal mineral reservations are common on former public domain land.
  The federal government retained mineral rights on many patents.
- **FL**: Mineral rights rarely an issue for vacant-land transactions (no significant
  subsurface resources in most areas).
- **AZ**: Some areas near historical mining districts have severed mineral rights.
  Less common than TX.
- **OR**: Timber rights may be severed from the surface estate, functioning similarly
  to mineral rights.

Test data should include `mineral_rights` as an enum: `"intact"`, `"severed"`,
`"federal_reservation"`, `"partial"`, `"unknown"`.

---

## HOA Prevalence and Implications

HOAs materially affect land investing because they impose:

- **Annual dues**: $50-500+/year. Delinquent dues create liens that must be cleared.
- **Building restrictions**: Minimum home size, setbacks, architectural review.
- **Use restrictions**: No RVs, no mobile homes, no commercial activity -- these
  restrictions eliminate a large segment of the buyer pool.
- **Enforcement risk**: Some HOAs aggressively fine vacant-lot owners for unmowed
  grass, debris, etc.

### HOA Density by Market

| Market | HOA Prevalence | Notes |
|--------|---------------|-------|
| FL (Lehigh Acres, Cape Coral) | Very high | Most platted subdivisions have HOAs |
| AZ (Maricopa fringe) | High | Master-planned communities |
| TX (rural) | Low | Deed restrictions more common than formal HOAs |
| CO (mountain subdivisions) | Moderate | Road-maintenance POAs common |
| NM | Very low | Rarely encountered |
| NV (Pahrump, Mesquite) | Moderate | Varies by subdivision |

The harness should model `hoa_status` (`"none"`, `"active"`, `"defunct"`,
`"unknown"`), `hoa_annual_fee`, and `hoa_restrictions` (array of restriction types).
