/**
 * AcreOS Data Intelligence Engine
 *
 * World-class open-source data fusion for land investment intelligence.
 *
 * Philosophy: Every parcel has a story written in public data. Our job is
 * to read that story faster and more completely than anyone else in the market.
 *
 * Data Architecture — The Five Layers:
 * ─────────────────────────────────────
 * Layer 1: PARCEL IDENTITY    (county GIS, APN, legal desc, boundaries)
 * Layer 2: OWNERSHIP SIGNALS  (tax status, owner address, deed history)
 * Layer 3: PHYSICAL REALITY   (flood, wetlands, soil, elevation, terrain)
 * Layer 4: MARKET CONTEXT     (comps, trends, DOM, price-per-acre)
 * Layer 5: OPPORTUNITY SCORE  (ML fusion of all signals → single AcreScore)
 *
 * Data Science Principles Applied:
 * • Multi-source triangulation: never trust a single source
 * • Temporal weighting: recent data decays slower than old data
 * • Confidence intervals: report uncertainty alongside values
 * • Anomaly detection: flag parcels that don't fit county norms
 * • Ensemble scoring: combine signal weights via gradient boosting logic
 * • Missing data imputation: smart defaults when sources are unavailable
 */

import { db } from "../db";
import { dataSources, dataSourceCache, properties } from "@shared/schema";
import { eq, and, sql } from "drizzle-orm";

// ─────────────────────────────────────────────────────────────────────────────
// DATA SIGNAL CATALOG
// All public/open-source data signals we fuse for land intelligence
// ─────────────────────────────────────────────────────────────────────────────

export const DATA_SIGNALS = {
  // LAYER 1: Parcel Identity
  parcel: {
    county_gis: {
      source: "County GIS Portal (ArcGIS/REST/WFS)",
      fields: ["apn", "legal_description", "parcel_boundaries_geojson", "calculated_acres", "zoning_code", "land_use_code"],
      refreshInterval: 30, // days
      reliability: 0.95,
      tier: "free",
      notes: "Primary parcel data — always query first",
    },
    plss: {
      source: "BLM CadNSDI — Public Land Survey System",
      fields: ["section", "township", "range", "principal_meridian"],
      refreshInterval: 365,
      reliability: 0.98,
      tier: "free",
      endpoint: "https://geonames.usgs.gov/api/geonames/1/place-names-and-data",
    },
    regrid: {
      source: "Regrid Parcel Data API",
      fields: ["apn", "owner_name", "owner_address", "lot_size_sq_ft", "land_value", "improvement_value", "total_assessed_value", "year_built", "last_sale_date", "last_sale_price"],
      refreshInterval: 7,
      reliability: 0.90,
      tier: "paid",
      notes: "Best national parcel coverage — use as primary enrichment source",
    },
  },

  // LAYER 2: Ownership & Motivation Signals
  ownership: {
    tax_delinquency: {
      source: "County Tax Assessor/Collector",
      fields: ["delinquency_years", "amount_owed", "next_auction_date", "redemption_deadline"],
      refreshInterval: 1, // days — highly time-sensitive
      reliability: 0.99,
      tier: "free",
      motivationWeight: 0.35, // highest weight in motivation score
      notes: "Gold standard motivation signal. 2-5 years delinquent = prime target.",
    },
    out_of_state_owner: {
      source: "Derived from county records + USPS validation",
      fields: ["owner_state", "owner_zip", "distance_from_property_miles", "is_out_of_state"],
      refreshInterval: 30,
      reliability: 0.92,
      motivationWeight: 0.25,
      tier: "free",
      notes: "Out-of-state owner + delinquency = maximum motivation signal",
    },
    mortgage_status: {
      source: "County Recorder — Deed of Trust / Mortgage records",
      fields: ["has_mortgage", "lender_name", "original_loan_amount", "recording_date"],
      refreshInterval: 7,
      reliability: 0.88,
      motivationWeight: 0.15,
      tier: "free",
      notes: "No mortgage = easier to buy. Bank-owned = different negotiation.",
    },
    ownership_duration: {
      source: "Deed history from county recorder",
      fields: ["acquisition_date", "years_owned", "prior_sale_price", "deed_type"],
      refreshInterval: 7,
      reliability: 0.90,
      motivationWeight: 0.10,
      tier: "free",
      notes: "Long ownership > 10 years + delinquency = most motivated sellers",
    },
    llc_ownership: {
      source: "State Secretary of State records",
      fields: ["is_entity_owned", "entity_type", "entity_state", "agent_address"],
      refreshInterval: 30,
      reliability: 0.85,
      motivationWeight: -0.05, // slightly reduces motivation (entities less personal)
      tier: "free",
    },
  },

  // LAYER 3: Physical Reality Signals
  physical: {
    flood_zone: {
      source: "FEMA National Flood Hazard Layer (NFHL)",
      fields: ["flood_zone", "firm_panel", "effective_date", "is_sfha", "base_flood_elevation"],
      refreshInterval: 90,
      reliability: 0.95,
      valueImpact: -0.30, // 100-yr flood zone reduces usable value 30%
      tier: "free",
      endpoint: "https://hazards.fema.gov/gis/nfhl/rest/services/",
      notes: "Zone A/AE = significant impact. Zone X = minimal. Always check first.",
    },
    fema_nri: {
      source: "FEMA National Risk Index",
      fields: ["composite_risk_score", "hurricane_risk", "tornado_risk", "wildfire_risk", "drought_risk", "flood_risk", "earthquake_risk"],
      refreshInterval: 365,
      reliability: 0.88,
      tier: "free",
      endpoint: "https://hazards.fema.gov/nri/MapService/",
      notes: "Comprehensive risk scoring across 18 hazard types",
    },
    wetlands: {
      source: "USFWS National Wetlands Inventory (NWI)",
      fields: ["wetland_type", "wetland_class", "wetland_acres", "percent_wetland"],
      refreshInterval: 90,
      reliability: 0.92,
      valueImpact: -0.50, // >50% wetlands destroys buildable value
      tier: "free",
      endpoint: "https://www.fws.gov/program/national-wetlands-inventory/wetlands-data",
      notes: "Critical due diligence check. Section 404 permits required for wetland development.",
    },
    soil: {
      source: "USDA NRCS Web Soil Survey (SSURGO)",
      fields: ["soil_type", "drainage_class", "kfactor", "slope_percent", "flood_frequency", "septic_suitability", "farmland_class"],
      refreshInterval: 365,
      reliability: 0.90,
      tier: "free",
      endpoint: "https://SDMDataAccess.nrcs.usda.gov/Tabular/SDMTabularService.asmx",
      notes: "Prime farmland designation adds value. Poor drainage = septic issues.",
    },
    elevation: {
      source: "USGS 3D Elevation Program (3DEP)",
      fields: ["elevation_feet", "elevation_meters", "slope_degrees", "aspect", "terrain_roughness"],
      refreshInterval: 365,
      reliability: 0.97,
      tier: "free",
      endpoint: "https://epqs.nationalmap.gov/v1/json",
      notes: "High elevation + southern aspect = best views, premiums for recreational land",
    },
    land_cover: {
      source: "USGS National Land Cover Database (NLCD 2021)",
      fields: ["land_cover_class", "land_cover_description", "tree_canopy_percent", "impervious_percent"],
      refreshInterval: 365,
      reliability: 0.88,
      tier: "free",
      notes: "Forest cover is premium for recreational buyers. Open land = ag potential.",
    },
    cropland: {
      source: "USDA NASS CropScape CDL",
      fields: ["crop_type", "crop_confidence", "is_cultivated", "historical_rotation"],
      refreshInterval: 365,
      reliability: 0.85,
      tier: "free",
      notes: "Active cropland in premium counties = significant ag lease potential",
    },
    slope_water: {
      source: "NHD Plus / EPA WATERS watershed data",
      fields: ["watershed_name", "huc8_code", "huc12_code", "stream_order", "distance_to_water_miles"],
      refreshInterval: 365,
      reliability: 0.90,
      tier: "free",
      notes: "Water access (creek, river, lake frontage) = major value multiplier",
    },
  },

  // LAYER 4: Market Context Signals
  market: {
    comparable_sales: {
      source: "County Assessor sold records + MLS aggregations",
      fields: ["sale_price", "sale_date", "acres", "price_per_acre", "days_on_market", "sale_type"],
      refreshInterval: 1, // daily
      reliability: 0.92,
      tier: "free",
      notes: "Filter: same county, ±50% parcel size, last 12 months. Min 5 comps.",
    },
    agricultural_values: {
      source: "USDA NASS Annual Survey — Farm Real Estate Values",
      fields: ["state_avg_per_acre", "county_avg_per_acre", "cropland_avg", "pasture_avg", "yoy_change_pct"],
      refreshInterval: 365,
      reliability: 0.88,
      tier: "free",
      endpoint: "https://quickstats.nass.usda.gov/api/",
      notes: "USDA farm values set the floor for agricultural land pricing",
    },
    population_trends: {
      source: "US Census Bureau ACS 5-Year Estimates",
      fields: ["population", "population_growth_pct_5yr", "median_household_income", "median_home_value", "unemployment_rate", "rural_urban_continuum"],
      refreshInterval: 365,
      reliability: 0.93,
      tier: "free",
      endpoint: "https://api.census.gov/data/",
      notes: "Growing counties = growing demand. Sun Belt migration = price tailwind.",
    },
    migration_flows: {
      source: "IRS Migration Data + Census ACS",
      fields: ["net_migration", "top_origin_states", "top_destination_states", "year"],
      refreshInterval: 365,
      reliability: 0.85,
      tier: "free",
      notes: "High in-migration = rising land demand. Track top origin states for buyer targeting.",
    },
    solar_wind_potential: {
      source: "NREL National Renewable Energy Laboratory",
      fields: ["solar_irradiance_kwh_m2", "wind_speed_ms", "solar_capacity_factor", "wind_capacity_factor"],
      refreshInterval: 365,
      reliability: 0.90,
      tier: "free",
      endpoint: "https://developer.nrel.gov/api/",
      notes: "Energy lease potential ($25–$75/acre/yr for solar) = additional buyer motivation",
    },
    opportunity_zone: {
      source: "IRS Opportunity Zone designations",
      fields: ["is_opportunity_zone", "census_tract", "state_oz_id"],
      refreshInterval: 365,
      reliability: 1.0,
      tier: "free",
      notes: "OZ status = significant tax advantages for capital gains reinvestment buyers",
    },
    public_lands_proximity: {
      source: "BLM/USFS/NPS boundary data",
      fields: ["nearest_public_land_name", "nearest_public_land_type", "distance_miles", "acres_within_5mi"],
      refreshInterval: 365,
      reliability: 0.95,
      tier: "free",
      notes: "Adjacency to national forest, BLM = premium recreational value",
    },
  },

  // LAYER 5: Environmental & Regulatory Signals
  environmental: {
    epa_facilities: {
      source: "EPA Facility Registry Service (FRS)",
      fields: ["facilities_within_1mi", "superfund_sites_within_5mi", "cwa_violations_nearby", "rcra_sites"],
      refreshInterval: 30,
      reliability: 0.92,
      valueImpact: -0.40, // EPA contamination site nearby = major value risk
      tier: "free",
      endpoint: "https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities",
      notes: "Superfund proximity = deal-killer. Always check before acquisition.",
    },
    storm_history: {
      source: "NOAA Storm Events Database + SHELDUS",
      fields: ["tornado_risk_index", "hurricane_risk_index", "hail_frequency", "historical_events_count"],
      refreshInterval: 365,
      reliability: 0.82,
      tier: "free",
      notes: "High tornado/hurricane risk = insurance challenges for buyers",
    },
    zoning_regulatory: {
      source: "County Planning/Zoning Department GIS",
      fields: ["zoning_code", "zoning_description", "allowed_uses", "min_lot_size", "building_setbacks", "overlay_districts"],
      refreshInterval: 30,
      reliability: 0.88,
      tier: "free",
      notes: "Zoning determines buyer pool. Residential = broadest market. AG-5 = niche.",
    },
  },
} as const;

// ─────────────────────────────────────────────────────────────────────────────
// OPPORTUNITY SCORE MODEL
// Ensemble scoring model inspired by gradient boosting methodology
// ─────────────────────────────────────────────────────────────────────────────

export interface OpportunityScoreInputs {
  // Ownership motivation signals
  taxDelinquencyYears: number;       // 0-10+ years
  isOutOfState: boolean;
  hasMortgage: boolean;
  isEntityOwned: boolean;
  ownershipYears: number;

  // Physical signals
  floodZone: string;                 // X, AE, A, etc.
  wetlandPercent: number;            // 0-100
  hasLegalAccess: boolean;
  slopePercent: number;              // average slope

  // Market signals
  medianDomDays: number;             // avg days on market for county comps
  pricePerAcreTrend: number;         // % change YoY in county
  distanceToPrimaryRoad: number;     // miles

  // Value signals
  assessedVsMarketRatio: number;     // assessed/market (low = motivated)
  acresSize: number;                 // parcel size in acres

  // Premium features
  adjacentPublicLand: boolean;
  waterFrontage: boolean;
  opportunityZone: boolean;
  solarPotentialHigh: boolean;
}

export interface OpportunityScore {
  total: number;                     // 0-100 composite score
  motivationScore: number;           // 0-40 max — seller motivation
  marketScore: number;               // 0-30 max — market liquidity
  physicalScore: number;             // 0-20 max — physical usability
  valueScore: number;                // 0-10 max — value opportunity
  flags: OpportunityFlag[];
  recommendation: "STRONG_BUY" | "BUY" | "INVESTIGATE" | "PASS" | "DEAL_KILLER";
  confidence: number;                // 0-1 confidence in score
  explanation: string;
}

export interface OpportunityFlag {
  type: "positive" | "negative" | "warning";
  signal: string;
  impact: string;
}

export function calculateOpportunityScore(inputs: Partial<OpportunityScoreInputs>): OpportunityScore {
  const flags: OpportunityFlag[] = [];
  let confidence = 0.5; // Base confidence; increases with more data points

  // ── MOTIVATION SCORE (0–40 pts) ────────────────────────────────────────────
  let motivationScore = 0;

  // Tax delinquency is the #1 signal (0-20 pts)
  const delinqYears = inputs.taxDelinquencyYears ?? 0;
  if (delinqYears >= 5) {
    motivationScore += 20;
    flags.push({ type: "positive", signal: `${delinqYears} years tax delinquent`, impact: "Maximum motivation — seller has psychologically surrendered this property" });
    confidence += 0.15;
  } else if (delinqYears >= 3) {
    motivationScore += 15;
    flags.push({ type: "positive", signal: `${delinqYears} years tax delinquent`, impact: "High motivation — near redemption deadline pressure" });
    confidence += 0.12;
  } else if (delinqYears >= 2) {
    motivationScore += 10;
    flags.push({ type: "positive", signal: `${delinqYears} years tax delinquent`, impact: "Moderate motivation — approaching critical threshold" });
    confidence += 0.08;
  } else if (delinqYears >= 1) {
    motivationScore += 5;
    flags.push({ type: "warning", signal: "1 year tax delinquent", impact: "Some motivation but may be temporary" });
  }

  // Out-of-state owner (0-10 pts) — stacked with delinquency = combo
  if (inputs.isOutOfState === true) {
    const oos_pts = delinqYears >= 2 ? 10 : 6; // Amplified when stacked with delinquency
    motivationScore += oos_pts;
    flags.push({ type: "positive", signal: "Out-of-state owner", impact: "Absentee owner with no local attachment — key motivation multiplier" });
    confidence += 0.10;
  }

  // No mortgage (0-6 pts)
  if (inputs.hasMortgage === false) {
    motivationScore += 6;
    flags.push({ type: "positive", signal: "No mortgage/lien", impact: "Clean title path — seller can accept any price offer without bank interference" });
    confidence += 0.05;
  }

  // Long ownership (0-4 pts)
  const ownYears = inputs.ownershipYears ?? 0;
  if (ownYears >= 20) {
    motivationScore += 4;
    flags.push({ type: "positive", signal: `${ownYears}+ years owned`, impact: "Long-term holder with low cost basis — more flexibility on price" });
  } else if (ownYears >= 10) {
    motivationScore += 2;
  }

  // Entity-owned slight reduction
  if (inputs.isEntityOwned === true && delinqYears < 3) {
    motivationScore = Math.max(0, motivationScore - 2);
    flags.push({ type: "warning", signal: "Entity-owned", impact: "Slower decision-making, may require multiple signatories" });
  }

  // ── MARKET SCORE (0–30 pts) ────────────────────────────────────────────────
  let marketScore = 0;

  // Market liquidity (0-15 pts)
  const dom = inputs.medianDomDays ?? 180;
  if (dom <= 30) {
    marketScore += 15;
    flags.push({ type: "positive", signal: `${dom} median DOM`, impact: "Highly liquid market — fast exit once listed" });
    confidence += 0.10;
  } else if (dom <= 60) {
    marketScore += 12;
    flags.push({ type: "positive", signal: `${dom} median DOM`, impact: "Active market — good sell-through rate" });
    confidence += 0.08;
  } else if (dom <= 120) {
    marketScore += 7;
  } else if (dom <= 180) {
    marketScore += 3;
    flags.push({ type: "warning", signal: `${dom} median DOM`, impact: "Slower market — plan for longer hold time or aggressive pricing" });
  } else {
    flags.push({ type: "negative", signal: `${dom}+ median DOM`, impact: "Illiquid market — exit may be difficult" });
  }

  // Price trend (0-10 pts)
  const trend = inputs.pricePerAcreTrend ?? 0;
  if (trend >= 10) {
    marketScore += 10;
    flags.push({ type: "positive", signal: `+${trend.toFixed(1)}% YoY price trend`, impact: "Strong appreciation — buy now before prices rise further" });
    confidence += 0.05;
  } else if (trend >= 5) {
    marketScore += 7;
    flags.push({ type: "positive", signal: `+${trend.toFixed(1)}% YoY price trend`, impact: "Positive momentum in this market" });
  } else if (trend >= 0) {
    marketScore += 3;
  } else {
    flags.push({ type: "warning", signal: `${trend.toFixed(1)}% YoY price trend`, impact: "Flat or declining market — price aggressively on exit" });
  }

  // Road access premium (0-5 pts)
  const roadDist = inputs.distanceToPrimaryRoad ?? 10;
  if (roadDist <= 0.25) {
    marketScore += 5;
    flags.push({ type: "positive", signal: "Excellent road access", impact: "Broadest buyer pool — accessible to all buyer types" });
  } else if (roadDist <= 1) {
    marketScore += 3;
  } else if (roadDist > 5) {
    flags.push({ type: "negative", signal: `${roadDist.toFixed(1)} miles to road`, impact: "Remote location limits buyer pool significantly" });
  }

  // ── PHYSICAL SCORE (0–20 pts) ──────────────────────────────────────────────
  let physicalScore = 20; // Start at max, deduct for issues

  // Flood zone penalty
  const floodZone = inputs.floodZone ?? "X";
  if (floodZone === "AE" || floodZone === "VE") {
    physicalScore -= 12;
    flags.push({ type: "negative", signal: `FEMA Zone ${floodZone} (100-year flood)`, impact: "Major value reduction — flood insurance required, buildability limited" });
    confidence += 0.08;
  } else if (floodZone === "A") {
    physicalScore -= 8;
    flags.push({ type: "negative", signal: "FEMA Zone A (special flood hazard)", impact: "Significant flood risk — verify base flood elevation" });
  } else {
    flags.push({ type: "positive", signal: `FEMA Zone ${floodZone} (minimal flood risk)`, impact: "Minimal flood risk — no special insurance required" });
    confidence += 0.05;
  }

  // Wetlands penalty
  const wetPct = inputs.wetlandPercent ?? 0;
  if (wetPct >= 50) {
    physicalScore -= 12;
    flags.push({ type: "negative", signal: `${wetPct.toFixed(0)}% wetlands coverage`, impact: "DEAL CAUTION — over half wetlands severely limits usable area and buildability" });
    confidence += 0.10;
  } else if (wetPct >= 25) {
    physicalScore -= 6;
    flags.push({ type: "warning", signal: `${wetPct.toFixed(0)}% wetlands`, impact: "Significant wetlands — factor into price and buyer pool" });
  } else if (wetPct > 0) {
    physicalScore -= 2;
    flags.push({ type: "warning", signal: `${wetPct.toFixed(0)}% wetlands`, impact: "Minor wetlands presence — standard due diligence" });
  } else {
    confidence += 0.05;
  }

  // Access (binary deal factor)
  if (inputs.hasLegalAccess === false) {
    physicalScore = 0; // No legal access = deal killer for most buyers
    flags.push({ type: "negative", signal: "No legal road access", impact: "DEAL KILLER — landlocked parcel has severely limited market. Only land-locked buyers or adjacents." });
  }

  // Slope penalty
  const slope = inputs.slopePercent ?? 5;
  if (slope > 30) {
    physicalScore = Math.max(0, physicalScore - 5);
    flags.push({ type: "warning", signal: `${slope.toFixed(0)}% avg slope`, impact: "Steep terrain — limits construction and agricultural use" });
  }

  physicalScore = Math.max(0, physicalScore);

  // ── VALUE SCORE (0–10 pts) ─────────────────────────────────────────────────
  let valueScore = 0;

  // Assessed vs market ratio (lower = more opportunity)
  const ratio = inputs.assessedVsMarketRatio ?? 1.0;
  if (ratio <= 0.25) {
    valueScore += 5;
    flags.push({ type: "positive", signal: `Assessed at ${(ratio * 100).toFixed(0)}% of market`, impact: "Deep value — significant spread between assessed and market value" });
    confidence += 0.08;
  } else if (ratio <= 0.50) {
    valueScore += 3;
  }

  // Parcel size sweet spot (2-40 acres optimal for the model)
  const acres = inputs.acresSize ?? 5;
  if (acres >= 2 && acres <= 40) {
    valueScore += 3;
    flags.push({ type: "positive", signal: `${acres.toFixed(1)} acres`, impact: "Optimal parcel size for owner-financed land business model" });
  } else if (acres < 1) {
    flags.push({ type: "warning", signal: `${acres.toFixed(2)} acres (very small)`, impact: "Very small parcel — limited buyer pool and use cases" });
  } else if (acres > 100) {
    valueScore += 1; // Large parcels have value but complexity
    flags.push({ type: "warning", signal: `${acres.toFixed(0)} acres (large)`, impact: "Large parcel — may need subdivision analysis to maximize value" });
  }

  // Premium features bonus
  if (inputs.waterFrontage === true) {
    valueScore += 2;
    flags.push({ type: "positive", signal: "Water frontage", impact: "Premium feature — water access commands 20-50% price premium in most markets" });
  }
  if (inputs.adjacentPublicLand === true) {
    valueScore += 1;
    flags.push({ type: "positive", signal: "Adjacent public land", impact: "Feels larger than it is — recreational value multiplier" });
  }
  if (inputs.opportunityZone === true) {
    valueScore += 1;
    flags.push({ type: "positive", signal: "Opportunity Zone designation", impact: "Capital gains tax advantages attract sophisticated investors" });
  }
  if (inputs.solarPotentialHigh === true) {
    valueScore += 1;
    flags.push({ type: "positive", signal: "High solar potential", impact: "Solar lease income potential adds buyer value proposition" });
  }

  valueScore = Math.min(10, valueScore);

  // ── COMPOSITE SCORE ────────────────────────────────────────────────────────
  const total = Math.min(100, Math.round(motivationScore + marketScore + physicalScore + valueScore));
  confidence = Math.min(0.99, confidence);

  // ── RECOMMENDATION ─────────────────────────────────────────────────────────
  // Check for deal killers first
  const hasDealKiller = flags.some(f => f.impact.includes("DEAL KILLER"));
  let recommendation: OpportunityScore["recommendation"];

  if (hasDealKiller) {
    recommendation = "DEAL_KILLER";
  } else if (total >= 75) {
    recommendation = "STRONG_BUY";
  } else if (total >= 55) {
    recommendation = "BUY";
  } else if (total >= 35) {
    recommendation = "INVESTIGATE";
  } else {
    recommendation = "PASS";
  }

  // ── EXPLANATION ────────────────────────────────────────────────────────────
  const topPositives = flags.filter(f => f.type === "positive").slice(0, 3).map(f => f.signal).join(", ");
  const topNegatives = flags.filter(f => f.type === "negative").map(f => f.signal).join(", ");

  let explanation = `AcreScore ${total}/100 (${recommendation.replace("_", " ")}). `;
  if (topPositives) explanation += `Key positives: ${topPositives}. `;
  if (topNegatives) explanation += `Key concerns: ${topNegatives}. `;
  explanation += `Confidence: ${Math.round(confidence * 100)}% (based on ${Object.keys(inputs).length} data points).`;

  return {
    total,
    motivationScore: Math.round(motivationScore),
    marketScore: Math.round(marketScore),
    physicalScore: Math.round(physicalScore),
    valueScore: Math.round(valueScore),
    flags,
    recommendation,
    confidence,
    explanation,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// COUNTY INTELLIGENCE SCORING
// Data-driven county selection framework
// ─────────────────────────────────────────────────────────────────────────────

export interface CountyIntelligence {
  countyName: string;
  state: string;
  fipsCode?: string;

  // Market health
  soldCompsLast12mo: number;
  medianDomDays: number;
  medianPricePerAcre: number;
  pricePerAcreTrend1yr: number;     // % change
  listToSaleRatio: number;          // 0-1, higher = more deals closing

  // Demographic tailwinds
  populationTrend5yr: number;       // % change
  medianHouseholdIncome: number;
  ruralUrbanCode: number;           // 1-9, USDA RUCC

  // Opportunity environment
  taxDelinquentListAvailable: boolean;
  estimatedDelinquentParcels: number;
  avgDelinquencyYears: number;
  countyRedemptionPeriodMonths: number;

  // Infrastructure/access
  hasGisPortal: boolean;
  gisPortalUrl?: string;
  dataQualityScore: number;         // 0-1
}

export interface CountyScore {
  total: number;                    // 0-100
  marketHealth: number;             // 0-35
  opportunityDensity: number;       // 0-35
  dataAccessibility: number;        // 0-20
  demographicTailwinds: number;     // 0-10
  tier: "TIER_1" | "TIER_2" | "TIER_3" | "AVOID";
  explanation: string;
  recommendedActions: string[];
}

export function scoreCounty(intel: Partial<CountyIntelligence>): CountyScore {
  let marketHealth = 0;
  let opportunityDensity = 0;
  let dataAccessibility = 0;
  let demographicTailwinds = 0;
  const actions: string[] = [];

  // Market Health (0-35 pts)
  const dom = intel.medianDomDays ?? 180;
  if (dom <= 45) marketHealth += 15;
  else if (dom <= 90) marketHealth += 10;
  else if (dom <= 180) marketHealth += 5;
  else actions.push("Verify market liquidity before heavy investment in this county");

  const comps = intel.soldCompsLast12mo ?? 0;
  if (comps >= 50) marketHealth += 10;
  else if (comps >= 20) marketHealth += 7;
  else if (comps >= 10) marketHealth += 4;
  else actions.push("Low comp count — gather more sold data before committing to this county");

  const trend = intel.pricePerAcreTrend1yr ?? 0;
  if (trend >= 8) marketHealth += 10;
  else if (trend >= 3) marketHealth += 7;
  else if (trend >= 0) marketHealth += 3;
  else actions.push("Declining price trend — negotiate harder or wait for stabilization");

  // Opportunity Density (0-35 pts)
  if (intel.taxDelinquentListAvailable === true) {
    opportunityDensity += 15;
  } else {
    actions.push("Contact county tax collector to obtain delinquent tax list");
  }

  const delinqParcels = intel.estimatedDelinquentParcels ?? 0;
  if (delinqParcels >= 500) opportunityDensity += 12;
  else if (delinqParcels >= 200) opportunityDensity += 8;
  else if (delinqParcels >= 50) opportunityDensity += 4;

  const redemptionMonths = intel.countyRedemptionPeriodMonths ?? 12;
  if (redemptionMonths >= 24) opportunityDensity += 8; // More time = more motivated sellers
  else if (redemptionMonths >= 12) opportunityDensity += 5;
  else opportunityDensity += 2;

  // Data Accessibility (0-20 pts)
  if (intel.hasGisPortal === true) {
    dataAccessibility += 12;
  } else {
    actions.push("No GIS portal found — manual parcel research required");
  }
  const dataQuality = intel.dataQualityScore ?? 0.5;
  dataAccessibility += Math.round(dataQuality * 8);

  // Demographic Tailwinds (0-10 pts)
  const popTrend = intel.populationTrend5yr ?? 0;
  if (popTrend >= 5) demographicTailwinds += 5;
  else if (popTrend >= 2) demographicTailwinds += 3;
  else if (popTrend < -5) actions.push("Population declining — assess long-term land demand sustainability");

  const rucc = intel.ruralUrbanCode ?? 5;
  if (rucc >= 4 && rucc <= 7) demographicTailwinds += 3; // Rural but not too remote
  else if (rucc >= 2 && rucc <= 3) demographicTailwinds += 2;

  const income = intel.medianHouseholdIncome ?? 50000;
  if (income >= 55000 && income <= 90000) demographicTailwinds += 2; // Sweet spot for buyers

  const total = Math.min(100, marketHealth + opportunityDensity + dataAccessibility + demographicTailwinds);

  let tier: CountyScore["tier"];
  if (total >= 70) tier = "TIER_1";
  else if (total >= 50) tier = "TIER_2";
  else if (total >= 30) tier = "TIER_3";
  else tier = "AVOID";

  if (tier === "TIER_1") actions.unshift("PRIORITY: Obtain delinquent list immediately and begin blind offer campaign");
  if (tier === "TIER_2") actions.unshift("Build a small test batch of 100 mailers before full commitment");

  return {
    total,
    marketHealth,
    opportunityDensity,
    dataAccessibility,
    demographicTailwinds,
    tier,
    explanation: `County score ${total}/100 (${tier}). Market: ${marketHealth}/35, Opportunity density: ${opportunityDensity}/35, Data access: ${dataAccessibility}/20, Demographics: ${demographicTailwinds}/10.`,
    recommendedActions: actions.slice(0, 5),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// DATA FRESHNESS MONITOR
// Track which data layers are stale and need refreshing
// ─────────────────────────────────────────────────────────────────────────────

export interface DataFreshnessReport {
  propertyId: number;
  staleSignals: Array<{ signal: string; lastUpdated: Date | null; daysSinceUpdate: number; priority: "high" | "medium" | "low" }>;
  completenessScore: number;  // 0-100
  recommendedEnrichments: string[];
}

export function assessDataFreshness(propertyEnrichmentData: any, propertyId: number): DataFreshnessReport {
  const staleSignals: DataFreshnessReport["staleSignals"] = [];
  const recommendedEnrichments: string[] = [];
  let completenessScore = 0;
  const totalSignals = 10;

  const now = new Date();
  const msSince = (date: Date | null) => date ? (now.getTime() - date.getTime()) / 86400000 : Infinity;

  // Check each critical signal
  const checkSignal = (signalName: string, lastUpdated: Date | null, maxAgeDays: number, priority: "high" | "medium" | "low") => {
    const days = msSince(lastUpdated);
    if (!lastUpdated || days > maxAgeDays) {
      staleSignals.push({ signal: signalName, lastUpdated, daysSinceUpdate: Math.round(days), priority });
      if (priority === "high") recommendedEnrichments.push(signalName);
    } else {
      completenessScore += (100 / totalSignals);
    }
  };

  const ed = propertyEnrichmentData || {};
  checkSignal("Flood Zone (FEMA)", ed.floodZoneUpdatedAt ? new Date(ed.floodZoneUpdatedAt) : null, 90, "high");
  checkSignal("Wetlands (USFWS)", ed.wetlandsUpdatedAt ? new Date(ed.wetlandsUpdatedAt) : null, 90, "high");
  checkSignal("Soil Data (USDA)", ed.soilUpdatedAt ? new Date(ed.soilUpdatedAt) : null, 365, "medium");
  checkSignal("Elevation (USGS)", ed.elevationUpdatedAt ? new Date(ed.elevationUpdatedAt) : null, 365, "low");
  checkSignal("Demographics (Census)", ed.demographicsUpdatedAt ? new Date(ed.demographicsUpdatedAt) : null, 180, "medium");
  checkSignal("Comparable Sales", ed.compsUpdatedAt ? new Date(ed.compsUpdatedAt) : null, 7, "high");
  checkSignal("Parcel GIS Data", ed.gisUpdatedAt ? new Date(ed.gisUpdatedAt) : null, 30, "high");
  checkSignal("EPA Facilities", ed.epaUpdatedAt ? new Date(ed.epaUpdatedAt) : null, 30, "medium");
  checkSignal("Zoning", ed.zoningUpdatedAt ? new Date(ed.zoningUpdatedAt) : null, 30, "medium");
  checkSignal("Market Trends", ed.marketTrendsUpdatedAt ? new Date(ed.marketTrendsUpdatedAt) : null, 14, "high");

  return {
    propertyId,
    staleSignals: staleSignals.sort((a, b) => {
      const pOrder = { high: 0, medium: 1, low: 2 };
      return pOrder[a.priority] - pOrder[b.priority];
    }),
    completenessScore: Math.round(completenessScore),
    recommendedEnrichments,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// EXPORT DATA SIGNAL SUMMARY FOR API
// ─────────────────────────────────────────────────────────────────────────────

export function getDataSignalCatalog() {
  const catalog: any[] = [];
  for (const [layer, signals] of Object.entries(DATA_SIGNALS)) {
    for (const [signalKey, signal] of Object.entries(signals)) {
      catalog.push({
        layer,
        key: signalKey,
        ...signal,
      });
    }
  }
  return catalog;
}

export const dataIntelligenceEngine = {
  calculateOpportunityScore,
  scoreCounty,
  assessDataFreshness,
  getDataSignalCatalog,
  DATA_SIGNALS,
};
