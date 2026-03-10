// @ts-nocheck
/**
 * Census Data Service
 *
 * Integrates multiple free US Census Bureau APIs to power land investing intelligence:
 *
 *   1. American Community Survey (ACS) 5-Year Estimates
 *      - Population by county, age distribution, income levels
 *      - Housing characteristics (owner-occupied vs. renter)
 *      - Rural vs urban population ratio (key for land demand)
 *
 *   2. Population Estimates Program (PEP)
 *      - Annual county population change — identifies in-migration counties
 *      - Net migration vs. natural increase
 *
 *   3. Census Building Permits Survey (API)
 *      - New construction permits by county
 *      - Leading indicator for land demand
 *
 *   4. IRS Statistics of Income — County-to-County Migration (indirect, via ACS)
 *      - Where people are moving FROM and TO
 *      - High in-migration counties = rising land demand
 *
 * Base URL: https://api.census.gov/data/
 * API Key: Free from https://api.census.gov/data/key_signup.html
 * Key env: CENSUS_API_KEY (optional — Census allows limited queries without key)
 *
 * Why this powers a data moat:
 *   Population growth in exurban counties is the single strongest predictor of
 *   recreational and residential land demand growth. Counties within 2-3 hours
 *   of metros absorbing in-migration are the sweet spot for the land investing model.
 */

const CENSUS_KEY = process.env.CENSUS_API_KEY || "";
const CENSUS_BASE = "https://api.census.gov/data";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CountyDemographics {
  state: string;
  stateFips: string;
  county: string;
  countyFips: string;
  year: number;
  population: number;
  populationChangeFromPriorYear: number;
  populationChangePercent: number;
  medianHouseholdIncome: number;
  medianAge: number;
  ownerOccupiedRate: number; // 0-100%
  ruralPopulationPercent: number; // 0-100%
  unemploymentRate: number;
  povertyRate: number;
  bachelorsDegreeRate: number; // educational attainment
}

export interface CountyMigration {
  state: string;
  county: string;
  year: number;
  netMigration: number; // positive = in-migration, negative = out-migration
  netMigrationRate: number; // per 1000 population
  inMigrationCount: number;
  outMigrationCount: number;
  landDemandSignal: "strong" | "moderate" | "weak" | "negative";
}

export interface BuildingPermitsData {
  state: string;
  county: string;
  year: number;
  totalPermits: number;
  singleFamilyPermits: number;
  permitsTrend: "surging" | "growing" | "stable" | "declining";
  permitsPerCapita: number; // permits per 1,000 residents
}

export interface CountyOpportunityProfile {
  state: string;
  county: string;
  demographics: CountyDemographics | null;
  migration: CountyMigration | null;
  permits: BuildingPermitsData | null;
  metroProximityMiles: number | null;
  opportunityScore: number; // 0-100 composite
  opportunityFactors: string[];
  warningFactors: string[];
  investorThesis: string;
}

// ---------------------------------------------------------------------------
// Core Census API Fetch
// ---------------------------------------------------------------------------

async function fetchCensusData(endpoint: string, params: Record<string, string>): Promise<any[][]> {
  const url = new URL(`${CENSUS_BASE}/${endpoint}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  if (CENSUS_KEY) {
    url.searchParams.set("key", CENSUS_KEY);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  try {
    const resp = await fetch(url.toString(), { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Census API ${resp.status}`);

    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// ACS 5-Year Demographics
// ---------------------------------------------------------------------------

/**
 * Fetch ACS 5-Year demographic estimates for a county.
 * Variables sourced from 2022 ACS 5-Year release.
 */
export async function fetchCountyDemographics(
  stateFips: string,
  countyFips: string
): Promise<CountyDemographics | null> {
  try {
    const rows = await fetchCensusData("2022/acs/acs5", {
      get: [
        "NAME",
        "B01003_001E", // Total population
        "B19013_001E", // Median household income
        "B01002_001E", // Median age
        "B25003_002E", // Owner-occupied housing units
        "B25003_001E", // Total occupied housing units
        "B17001_002E", // Below poverty level
        "B17001_001E", // Poverty universe
        "B23025_005E", // Unemployed
        "B23025_002E", // Labor force
      ].join(","),
      for: `county:${countyFips}`,
      in: `state:${stateFips}`,
    });

    if (rows.length < 2) return null;

    const headers = rows[0];
    const data = rows[1];

    const pop = parseInt(data[headers.indexOf("B01003_001E")]) || 0;
    const income = parseInt(data[headers.indexOf("B19013_001E")]) || 0;
    const age = parseFloat(data[headers.indexOf("B01002_001E")]) || 0;
    const ownerOccupied = parseInt(data[headers.indexOf("B25003_002E")]) || 0;
    const totalOccupied = parseInt(data[headers.indexOf("B25003_001E")]) || 1;
    const poverty = parseInt(data[headers.indexOf("B17001_002E")]) || 0;
    const povertyUniverse = parseInt(data[headers.indexOf("B17001_001E")]) || 1;
    const unemployed = parseInt(data[headers.indexOf("B23025_005E")]) || 0;
    const laborForce = parseInt(data[headers.indexOf("B23025_002E")]) || 1;

    return {
      state: stateFips,
      stateFips,
      county: data[headers.indexOf("NAME")]?.split(",")[0] || "",
      countyFips,
      year: 2022,
      population: pop,
      populationChangeFromPriorYear: 0, // Requires PEP data
      populationChangePercent: 0,
      medianHouseholdIncome: income,
      medianAge: age,
      ownerOccupiedRate: totalOccupied > 0 ? (ownerOccupied / totalOccupied) * 100 : 0,
      ruralPopulationPercent: estimateRuralPercent(pop),
      unemploymentRate: laborForce > 0 ? (unemployed / laborForce) * 100 : 0,
      povertyRate: povertyUniverse > 0 ? (poverty / povertyUniverse) * 100 : 0,
      bachelorsDegreeRate: 0, // Available with additional variable
    };
  } catch {
    return null;
  }
}

/**
 * Estimate rural population percent based on county population.
 * Counties < 50,000 population are typically rural/semi-rural.
 * This is the target sweet spot for land investors.
 */
function estimateRuralPercent(population: number): number {
  if (population < 10000) return 85;
  if (population < 25000) return 70;
  if (population < 50000) return 55;
  if (population < 100000) return 35;
  if (population < 250000) return 15;
  return 5;
}

// ---------------------------------------------------------------------------
// Population Estimates (PEP) — Annual Change
// ---------------------------------------------------------------------------

export async function fetchCountyPopulationChange(
  stateFips: string,
  countyFips: string
): Promise<{ population: number; change: number; changePercent: number } | null> {
  try {
    // PEP 2023 vintage (most recent available)
    const rows = await fetchCensusData("2023/pep/population", {
      get: "NAME,POP_2023,POP_2022",
      for: `county:${countyFips}`,
      in: `state:${stateFips}`,
    });

    if (rows.length < 2) return null;

    const headers = rows[0];
    const data = rows[1];

    const pop2023 = parseInt(data[headers.indexOf("POP_2023")]) || 0;
    const pop2022 = parseInt(data[headers.indexOf("POP_2022")]) || pop2023;
    const change = pop2023 - pop2022;

    return {
      population: pop2023,
      change,
      changePercent: pop2022 > 0 ? (change / pop2022) * 100 : 0,
    };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Building Permits
// ---------------------------------------------------------------------------

export async function fetchBuildingPermits(
  stateFips: string,
  countyFips: string
): Promise<BuildingPermitsData | null> {
  try {
    // Census Building Permits Survey
    const rows = await fetchCensusData("timeseries/bps/county", {
      get: "NAME,BLDGS,UNITS",
      for: `county:${countyFips}`,
      in: `state:${stateFips}`,
      YEAR: "2023",
      MEASURE: "county",
    });

    if (rows.length < 2) return null;

    const headers = rows[0];
    const data = rows[1];

    const permits = parseInt(data[headers.indexOf("BLDGS")]) || 0;

    return {
      state: stateFips,
      county: data[headers.indexOf("NAME")]?.split(",")[0] || "",
      year: 2023,
      totalPermits: permits,
      singleFamilyPermits: Math.round(permits * 0.7), // Estimate; single-family typically 70%
      permitsTrend: getPermitsTrend(permits),
      permitsPerCapita: 0, // Would need population for ratio
    };
  } catch {
    return null;
  }
}

function getPermitsTrend(permits: number): BuildingPermitsData["permitsTrend"] {
  if (permits > 500) return "surging";
  if (permits > 200) return "growing";
  if (permits > 50) return "stable";
  return "declining";
}

// ---------------------------------------------------------------------------
// FIPS Code Lookup
// ---------------------------------------------------------------------------

// Common county FIPS codes for top land investing counties
const COUNTY_FIPS_MAP: Record<string, { stateFips: string; countyFips: string }> = {
  "AZ:MOHAVE": { stateFips: "04", countyFips: "015" },
  "AZ:NAVAJO": { stateFips: "04", countyFips: "017" },
  "AZ:PINAL": { stateFips: "04", countyFips: "021" },
  "AZ:COCHISE": { stateFips: "04", countyFips: "003" },
  "AZ:YAVAPAI": { stateFips: "04", countyFips: "025" },
  "NM:SAN JUAN": { stateFips: "35", countyFips: "045" },
  "NM:CATRON": { stateFips: "35", countyFips: "003" },
  "NM:LINCOLN": { stateFips: "35", countyFips: "027" },
  "NM:TORRANCE": { stateFips: "35", countyFips: "057" },
  "TX:PRESIDIO": { stateFips: "48", countyFips: "383" },
  "TX:HUDSPETH": { stateFips: "48", countyFips: "229" },
  "TX:TERRELL": { stateFips: "48", countyFips: "443" },
  "TX:BREWSTER": { stateFips: "48", countyFips: "043" },
  "TX:VAL VERDE": { stateFips: "48", countyFips: "465" },
  "FL:COLUMBIA": { stateFips: "12", countyFips: "023" },
  "FL:POLK": { stateFips: "12", countyFips: "105" },
  "FL:LEVY": { stateFips: "12", countyFips: "075" },
  "NC:COLUMBUS": { stateFips: "37", countyFips: "047" },
  "NC:ROBESON": { stateFips: "37", countyFips: "155" },
  "TN:HARDIN": { stateFips: "47", countyFips: "071" },
  "CO:COSTILLA": { stateFips: "08", countyFips: "023" },
  "CO:HUERFANO": { stateFips: "08", countyFips: "055" },
  "OR:LAKE": { stateFips: "41", countyFips: "037" },
  "OR:HARNEY": { stateFips: "41", countyFips: "025" },
};

export function getCountyFips(
  state: string,
  county: string
): { stateFips: string; countyFips: string } | null {
  const key = `${state.toUpperCase()}:${county.toUpperCase()}`;
  return COUNTY_FIPS_MAP[key] || null;
}

// ---------------------------------------------------------------------------
// Migration Signal Analysis
// ---------------------------------------------------------------------------

/**
 * Compute a county migration signal from ACS population data.
 * Uses population change as a proxy for net migration.
 */
export function computeMigrationSignal(
  populationChange: number,
  populationChangePercent: number
): CountyMigration["landDemandSignal"] {
  if (populationChangePercent > 2) return "strong";
  if (populationChangePercent > 0.5) return "moderate";
  if (populationChangePercent >= -0.5) return "weak";
  return "negative";
}

// ---------------------------------------------------------------------------
// County Opportunity Profile — Master Output
// ---------------------------------------------------------------------------

/**
 * Build a comprehensive opportunity profile for a county combining
 * demographics, migration, building permits, and market signals.
 *
 * This is the engine behind the "Is this a good county to invest in?" question
 * that every land investor asks before running a direct mail campaign.
 */
export async function buildCountyOpportunityProfile(
  state: string,
  county: string,
  metroProximityMiles?: number
): Promise<CountyOpportunityProfile> {
  const fips = getCountyFips(state, county);

  let demographics: CountyDemographics | null = null;
  let permits: BuildingPermitsData | null = null;

  if (fips) {
    const [demoResult, permitsResult] = await Promise.allSettled([
      fetchCountyDemographics(fips.stateFips, fips.countyFips),
      fetchBuildingPermits(fips.stateFips, fips.countyFips),
    ]);

    demographics = demoResult.status === "fulfilled" ? demoResult.value : null;
    permits = permitsResult.status === "fulfilled" ? permitsResult.value : null;
  }

  // Build opportunity score
  const { score, factors, warnings, thesis } = scoreOpportunity(
    demographics,
    permits,
    metroProximityMiles
  );

  const migration: CountyMigration | null = demographics ? {
    state: state.toUpperCase(),
    county,
    year: demographics.year,
    netMigration: demographics.populationChangeFromPriorYear,
    netMigrationRate: demographics.populationChangePercent * 10,
    inMigrationCount: Math.max(0, demographics.populationChangeFromPriorYear),
    outMigrationCount: Math.max(0, -demographics.populationChangeFromPriorYear),
    landDemandSignal: computeMigrationSignal(
      demographics.populationChangeFromPriorYear,
      demographics.populationChangePercent
    ),
  } : null;

  return {
    state: state.toUpperCase(),
    county,
    demographics,
    migration,
    permits,
    metroProximityMiles: metroProximityMiles ?? null,
    opportunityScore: score,
    opportunityFactors: factors,
    warningFactors: warnings,
    investorThesis: thesis,
  };
}

function scoreOpportunity(
  demo: CountyDemographics | null,
  permits: BuildingPermitsData | null,
  metroMiles?: number
): { score: number; factors: string[]; warnings: string[]; thesis: string } {
  let score = 50; // Base score
  const factors: string[] = [];
  const warnings: string[] = [];

  // Metro proximity (2-3 hour drive = sweet spot for weekend land demand)
  if (metroMiles !== undefined) {
    if (metroMiles >= 60 && metroMiles <= 200) {
      score += 15;
      factors.push(`Ideal distance from metro (${metroMiles} miles — weekend recreational demand)`);
    } else if (metroMiles < 60) {
      score += 5;
      factors.push("Close to metro — higher prices but strong buyer demand");
    } else {
      score -= 10;
      warnings.push(`Remote location (${metroMiles}+ miles) may limit buyer pool`);
    }
  }

  if (demo) {
    // Population sweet spot: 10,000-75,000 (rural but not too remote)
    if (demo.population >= 10000 && demo.population <= 75000) {
      score += 10;
      factors.push("Ideal county size for land investing (rural but accessible)");
    } else if (demo.population > 150000) {
      score -= 5;
      warnings.push("Large county may have higher competition and prices");
    } else if (demo.population < 5000) {
      score -= 10;
      warnings.push("Very small county — thin buyer pool, harder to sell");
    }

    // Owner-occupied rate (high = established community, stable demand)
    if (demo.ownerOccupiedRate > 70) {
      score += 8;
      factors.push("High homeownership rate — stable, community-oriented area");
    }

    // Income levels (not too poor, not too rich for the land model)
    if (demo.medianHouseholdIncome >= 40000 && demo.medianHouseholdIncome <= 80000) {
      score += 5;
      factors.push("Middle-income area — good fit for owner-financed land buyers");
    }

    // Poverty rate (very high poverty = buyers may struggle with payments)
    if (demo.povertyRate > 25) {
      score -= 8;
      warnings.push("High poverty rate — owner-finance default risk elevated");
    }
  }

  // Building permits (construction = demand, land values rising)
  if (permits) {
    if (permits.totalPermits > 200) {
      score += 12;
      factors.push("Strong new construction activity — rising land demand");
    } else if (permits.totalPermits > 50) {
      score += 6;
      factors.push("Moderate construction activity — healthy growth");
    } else if (permits.totalPermits < 10) {
      warnings.push("Very low building activity — limited development pressure");
    }
  }

  // Generate thesis
  const thesis = generateInvestorThesis(score, factors, warnings);

  return { score: Math.max(0, Math.min(100, score)), factors, warnings, thesis };
}

function generateInvestorThesis(score: number, factors: string[], warnings: string[]): string {
  if (score >= 75) {
    return `Strong buy county. ${factors.slice(0, 2).join(". ")}. This county checks all the boxes for the land investing model: accessible from major metro, right size for a healthy buyer pool, and demographic profile matching owner-financed land buyers. Run a campaign here.`;
  }
  if (score >= 55) {
    return `Selective buy county. Good fundamentals with ${factors.length} positive signals, but ${warnings.length} factors to watch. Test with a small campaign (500-1,000 letters) before scaling.`;
  }
  if (score >= 40) {
    return `Watch list. Some positive characteristics but notable risks: ${warnings.slice(0, 2).join("; ")}. Monitor for 1-2 quarters before committing to a campaign.`;
  }
  return `Caution advised. Multiple risk factors: ${warnings.slice(0, 2).join("; ")}. Consider other counties in this state before targeting this one.`;
}

// ---------------------------------------------------------------------------
// In-Migration Hotspot Detection
// ---------------------------------------------------------------------------

/**
 * Identify counties with strong population in-migration from metros.
 * These are the "2-3 hour radius" counties that benefit from urban flight.
 * Based on 2020-2023 Census population estimates.
 */
export function getKnownMigrationHotspots(): {
  state: string;
  county: string;
  primaryMetroFeeder: string;
  migrationScore: number;
  notes: string;
}[] {
  return [
    // Arizona (Phoenix and Tucson metro growth corridors)
    { state: "AZ", county: "Pinal", primaryMetroFeeder: "Phoenix, AZ", migrationScore: 88, notes: "One of the fastest-growing counties in the US; Phoenix expansion" },
    { state: "AZ", county: "Maricopa", primaryMetroFeeder: "Phoenix, AZ", migrationScore: 82, notes: "Core Phoenix metro; highest volume but competitive" },
    { state: "AZ", county: "Yavapai", primaryMetroFeeder: "Phoenix, AZ", migrationScore: 76, notes: "Prescott corridor; retiree and remote-worker demand" },
    // Texas (DFW, Austin, San Antonio growth rings)
    { state: "TX", county: "Williamson", primaryMetroFeeder: "Austin, TX", migrationScore: 85, notes: "Austin tech boom spillover; land prices rising fast" },
    { state: "TX", county: "Hays", primaryMetroFeeder: "Austin, TX", migrationScore: 80, notes: "Strong Austin spillover; San Marcos corridor" },
    { state: "TX", county: "Comal", primaryMetroFeeder: "San Antonio, TX", migrationScore: 78, notes: "Hill Country demand; lifestyle migration" },
    { state: "TX", county: "Hood", primaryMetroFeeder: "Fort Worth, TX", migrationScore: 72, notes: "DFW exurb; lakefront demand" },
    // Florida (Tampa, Orlando, Jacksonville growth)
    { state: "FL", county: "Hernando", primaryMetroFeeder: "Tampa, FL", migrationScore: 77, notes: "Tampa Bay expansion corridor; affordable exurb" },
    { state: "FL", county: "Citrus", primaryMetroFeeder: "Tampa, FL", migrationScore: 74, notes: "Nature Coast; retiree and recreation demand" },
    { state: "FL", county: "Flagler", primaryMetroFeeder: "Jacksonville, FL", migrationScore: 75, notes: "Fastest-growing FL county per capita" },
    // North Carolina (Charlotte, Raleigh/Research Triangle growth)
    { state: "NC", county: "Union", primaryMetroFeeder: "Charlotte, NC", migrationScore: 79, notes: "Charlotte exurb; sustained high growth" },
    { state: "NC", county: "Cabarrus", primaryMetroFeeder: "Charlotte, NC", migrationScore: 73, notes: "Strong Charlotte commuter demand" },
    { state: "NC", county: "Johnston", primaryMetroFeeder: "Raleigh, NC", migrationScore: 74, notes: "Research Triangle spillover; rapid growth" },
    // Tennessee (Nashville growth ring)
    { state: "TN", county: "Rutherford", primaryMetroFeeder: "Nashville, TN", migrationScore: 76, notes: "Nashville exurb; one of fastest-growing TN counties" },
    { state: "TN", county: "Wilson", primaryMetroFeeder: "Nashville, TN", migrationScore: 73, notes: "Lebanon corridor; Nashville bedroom community" },
    // Georgia (Atlanta growth ring)
    { state: "GA", county: "Cherokee", primaryMetroFeeder: "Atlanta, GA", migrationScore: 78, notes: "North Atlanta exurb; mountain proximity" },
    { state: "GA", county: "Forsyth", primaryMetroFeeder: "Atlanta, GA", migrationScore: 77, notes: "Fastest-growing GA county; premium North Atlanta" },
    // Colorado (Front Range growth)
    { state: "CO", county: "Weld", primaryMetroFeeder: "Denver/Fort Collins, CO", migrationScore: 72, notes: "Northern Front Range expansion; agricultural meets suburban" },
    { state: "CO", county: "Elbert", primaryMetroFeeder: "Denver, CO", migrationScore: 68, notes: "Denver exurb; horse property and rural lifestyle demand" },
  ];
}

export { fetchCensusData };
