/**
 * Environmental Intelligence — water rights, mineral rights, carbon credits,
 * climate risk, and highest-best-use analysis for land parcels.
 */

import { logger } from "../utils/logger";

// ── Water Rights ────────────────────────────────────────────────────

export interface WaterRightsInfo {
  state: string;
  doctrine: "prior_appropriation" | "riparian" | "hybrid";
  summary: string;
  considerations: string[];
  requiresPermit: boolean;
}

const WATER_RIGHTS: Record<string, Omit<WaterRightsInfo, "state">> = {
  TX: { doctrine: "hybrid", summary: "Texas uses a hybrid system — surface water is state-owned (prior appropriation), groundwater follows the rule of capture.", considerations: ["Surface water requires a permit from TCEQ", "Groundwater rights are property rights in TX", "Check local GCD (Groundwater Conservation District) rules"], requiresPermit: true },
  FL: { doctrine: "riparian", summary: "Florida follows the riparian doctrine with a consumptive use permit system.", considerations: ["Water Management Districts regulate usage", "Riparian owners have reasonable use rights", "Permits required for significant withdrawals"], requiresPermit: true },
  AZ: { doctrine: "prior_appropriation", summary: "Arizona uses prior appropriation — first in time, first in right.", considerations: ["Groundwater is heavily regulated in Active Management Areas", "Surface water rights must be adjudicated", "Water is a critical factor in AZ land value"], requiresPermit: true },
  CA: { doctrine: "hybrid", summary: "California uses a hybrid system — riparian and appropriative rights coexist.", considerations: ["State Water Resources Control Board oversees rights", "Drought restrictions can limit usage", "Water rights significantly impact land value in CA"], requiresPermit: true },
  CO: { doctrine: "prior_appropriation", summary: "Colorado is strictly prior appropriation — no riparian rights.", considerations: ["Water rights are separate from land ownership", "Must verify what water rights convey with the land", "Augmentation plans may be required for wells"], requiresPermit: true },
  NM: { doctrine: "prior_appropriation", summary: "New Mexico follows prior appropriation for both surface and groundwater.", considerations: ["Office of the State Engineer administers water rights", "Well permits required statewide", "Water rights are valuable and separately transferable"], requiresPermit: true },
  NC: { doctrine: "riparian", summary: "North Carolina follows riparian rights with a registration system.", considerations: ["Large withdrawals require registration", "Riparian owners can make reasonable use of adjacent waters", "Relatively water-abundant state"], requiresPermit: false },
  GA: { doctrine: "riparian", summary: "Georgia uses regulated riparian system.", considerations: ["Permits required for withdrawals >100,000 gallons/day", "Reasonable use standard applies", "Water availability varies significantly by region"], requiresPermit: true },
  OR: { doctrine: "prior_appropriation", summary: "Oregon uses prior appropriation with some limited riparian elements.", considerations: ["Water Resources Department issues permits", "Exempt uses include domestic and stock watering", "Instream water rights recognized"], requiresPermit: true },
  WA: { doctrine: "prior_appropriation", summary: "Washington uses prior appropriation — first in time, first in right.", considerations: ["Dept of Ecology issues water right permits", "Permit-exempt wells limited to 5,000 gallons/day", "Tribal treaty rights can affect water availability"], requiresPermit: true },
};

export function getWaterRightsInfo(state: string): WaterRightsInfo {
  const data = WATER_RIGHTS[state.toUpperCase()];
  if (!data) {
    return { state: state.toUpperCase(), doctrine: "riparian", summary: `Water rights data not available for ${state}. Consult state water authority.`, considerations: ["Research local water regulations before purchasing"], requiresPermit: false };
  }
  return { state: state.toUpperCase(), ...data };
}

// ── Mineral Rights ──────────────────────────────────────────────────

export interface MineralRightsInfo {
  state: string;
  commonlySevered: boolean;
  dominantEstate: boolean;
  notes: string;
  considerations: string[];
}

const MINERAL_RIGHTS: Record<string, Omit<MineralRightsInfo, "state">> = {
  TX: { commonlySevered: true, dominantEstate: true, notes: "Texas has extensive mineral severance. Mineral estate is dominant — surface owner must accommodate reasonable access.", considerations: ["Always run mineral rights search before purchase", "Oil/gas leases may restrict surface use", "Mineral rights can be fractionated across many owners"] },
  CO: { commonlySevered: true, dominantEstate: true, notes: "Colorado has significant mineral severance, especially in western counties.", considerations: ["Surface Use Agreements recommended", "Coal, gas, and oil rights commonly severed", "Federal mineral reservations are common"] },
  NM: { commonlySevered: true, dominantEstate: true, notes: "New Mexico has widespread mineral severance with federal mineral reservations.", considerations: ["BLM manages extensive federal mineral rights", "Oil/gas activity can affect surface use", "Check for existing leases and permits"] },
  CA: { commonlySevered: true, dominantEstate: true, notes: "Mineral rights commonly severed in oil-producing regions.", considerations: ["Particularly common in Kern, Los Angeles, and Ventura counties", "Environmental regulations may limit extraction", "Always verify mineral conveyance in deed"] },
  FL: { commonlySevered: false, dominantEstate: false, notes: "Florida mineral severance is uncommon. Phosphate mining is the main mineral activity.", considerations: ["Mineral rights generally convey with surface rights", "Phosphate companies may hold subsurface rights in central FL", "Check for any phosphate reservations"], },
  NC: { commonlySevered: false, dominantEstate: false, notes: "Mineral severance is rare in North Carolina.", considerations: ["Mineral rights typically convey with the land", "Fracking moratorium has limited oil/gas severance", "Clay and aggregate operations may have separate rights"] },
  GA: { commonlySevered: false, dominantEstate: false, notes: "Mineral severance is uncommon in Georgia.", considerations: ["Kaolin clay rights may be separately held in middle GA", "Generally minerals convey with surface", "Title search should still verify mineral status"] },
  OR: { commonlySevered: false, dominantEstate: false, notes: "Oregon has limited mineral severance.", considerations: ["Federal mineral reservations exist in some areas", "Timber rights more commonly severed than minerals", "Check for any US Forest Service reservations"] },
  WA: { commonlySevered: false, dominantEstate: false, notes: "Washington has limited mineral severance outside mining districts.", considerations: ["Check for historical mining claims", "Timber rights may be separately held", "Federal mineral reservations in some areas"] },
  AZ: { commonlySevered: true, dominantEstate: true, notes: "Arizona has mineral severance particularly on former railroad and mining lands.", considerations: ["Railroad grants often reserved mineral rights", "Copper and gold mining areas may have complex severance", "State trust lands have separate mineral leasing"] },
};

export function getMineralRightsInfo(state: string): MineralRightsInfo {
  const data = MINERAL_RIGHTS[state.toUpperCase()];
  if (!data) {
    return { state: state.toUpperCase(), commonlySevered: false, dominantEstate: false, notes: `Mineral rights data not available for ${state}.`, considerations: ["Verify mineral ownership through title search"] };
  }
  return { state: state.toUpperCase(), ...data };
}

// ── Carbon Credits ──────────────────────────────────────────────────

export interface CarbonCreditEstimate {
  eligible: boolean;
  estimatedCreditsPerYear: number;
  estimatedValuePerYear: number;
  creditPriceRange: { low: number; high: number };
  programTypes: string[];
  requirements: string[];
}

export function estimateCarbonCredits(state: string, acres: number, landType?: string): CarbonCreditEstimate {
  if (acres < 40) {
    return { eligible: false, estimatedCreditsPerYear: 0, estimatedValuePerYear: 0, creditPriceRange: { low: 0, high: 0 }, programTypes: [], requirements: ["Minimum 40 acres typically required for carbon credit programs"] };
  }

  // Credits per acre per year (rough estimates by land type)
  const creditsPerAcre: Record<string, number> = {
    forest: 3.0,
    grassland: 0.8,
    agricultural: 0.5,
    wetland: 2.5,
    rangeland: 0.4,
    default: 0.6,
  };

  const type = (landType || "default").toLowerCase();
  const perAcre = creditsPerAcre[type] || creditsPerAcre.default;
  const totalCredits = Math.round(acres * perAcre);
  const priceRange = { low: 15, high: 50 }; // $/ton CO2e

  return {
    eligible: true,
    estimatedCreditsPerYear: totalCredits,
    estimatedValuePerYear: Math.round(totalCredits * (priceRange.low + priceRange.high) / 2),
    creditPriceRange: priceRange,
    programTypes: [
      "Improved Forest Management (IFM)",
      acres >= 100 ? "Agricultural Land Management (ALM)" : "",
      type === "grassland" || type === "rangeland" ? "Grassland Conservation" : "",
      "Avoided Conversion",
    ].filter(Boolean),
    requirements: [
      "Permanence commitment (typically 40-100 years)",
      "Third-party verification (Verra, Gold Standard, or ACR)",
      "Additionality — must demonstrate carbon would not have been sequestered otherwise",
      "Baseline measurement and monitoring plan",
      acres < 100 ? "Small acreage may need to aggregate with neighbors for viability" : "",
    ].filter(Boolean),
  };
}

// ── Climate Risk ────────────────────────────────────────────────────

export interface ClimateRiskAssessment {
  overallRisk: "low" | "moderate" | "elevated" | "high";
  floodRisk: { level: string; description: string };
  fireRisk: { level: string; description: string };
  droughtRisk: { level: string; description: string };
  recommendations: string[];
}

const STATE_CLIMATE: Record<string, { flood: string; fire: string; drought: string }> = {
  TX: { flood: "moderate", fire: "moderate", drought: "elevated" },
  FL: { flood: "high", fire: "low", drought: "low" },
  AZ: { flood: "moderate", fire: "elevated", drought: "high" },
  CA: { flood: "moderate", fire: "high", drought: "high" },
  CO: { flood: "low", fire: "elevated", drought: "moderate" },
  NM: { flood: "moderate", fire: "elevated", drought: "elevated" },
  NC: { flood: "moderate", fire: "low", drought: "low" },
  GA: { flood: "moderate", fire: "low", drought: "low" },
  OR: { flood: "moderate", fire: "elevated", drought: "moderate" },
  WA: { flood: "moderate", fire: "moderate", drought: "low" },
};

export function assessClimateRisk(state: string, county?: string): ClimateRiskAssessment {
  const data = STATE_CLIMATE[state.toUpperCase()] || { flood: "moderate", fire: "moderate", drought: "moderate" };

  const riskLevels = [data.flood, data.fire, data.drought];
  const highCount = riskLevels.filter(r => r === "high").length;
  const elevatedCount = riskLevels.filter(r => r === "elevated").length;
  const overallRisk = highCount >= 2 ? "high" : highCount >= 1 || elevatedCount >= 2 ? "elevated" : elevatedCount >= 1 ? "moderate" : "low";

  const recommendations: string[] = [];
  if (data.flood === "high" || data.flood === "elevated") recommendations.push("Check FEMA flood maps for specific parcel flood zone designation");
  if (data.fire === "high" || data.fire === "elevated") recommendations.push("Review state wildfire risk maps and defensible space requirements");
  if (data.drought === "high" || data.drought === "elevated") recommendations.push("Verify water availability and well depth data for the area");
  recommendations.push("Consider climate risk in long-term hold value projections");

  return {
    overallRisk,
    floodRisk: { level: data.flood, description: getClimateDescription("flood", data.flood) },
    fireRisk: { level: data.fire, description: getClimateDescription("fire", data.fire) },
    droughtRisk: { level: data.drought, description: getClimateDescription("drought", data.drought) },
    recommendations,
  };
}

function getClimateDescription(type: string, level: string): string {
  const descriptions: Record<string, Record<string, string>> = {
    flood: { low: "Minimal flood risk", moderate: "Some flood risk — check specific parcel", elevated: "Notable flood risk in many areas", high: "Significant flood risk — FEMA mapping essential" },
    fire: { low: "Minimal wildfire risk", moderate: "Some wildfire risk in rural areas", elevated: "Notable wildfire risk — check WUI proximity", high: "High wildfire risk — defensible space required" },
    drought: { low: "Adequate rainfall and water availability", moderate: "Occasional drought conditions", elevated: "Frequent drought — water rights important", high: "Chronic drought — water is a critical factor" },
  };
  return descriptions[type]?.[level] || "Risk assessment unavailable";
}

// ── Highest and Best Use ────────────────────────────────────────────

export interface HighestBestUseAnalysis {
  recommendedUse: string;
  scores: { use: string; score: number; reasoning: string }[];
  constraints: string[];
  opportunities: string[];
}

export function analyzeHighestBestUse(property: {
  state: string; county?: string; acres: number;
  zoning?: string; utilities?: any; roadAccess?: string;
}): HighestBestUseAnalysis {
  const uses: { use: string; score: number; reasoning: string }[] = [];
  const constraints: string[] = [];
  const opportunities: string[] = [];

  // Residential
  let residentialScore = 50;
  if (property.utilities?.electric) residentialScore += 15;
  if (property.utilities?.water) residentialScore += 10;
  if (property.roadAccess === "paved") residentialScore += 10;
  if (property.acres < 5) residentialScore += 10;
  if (property.acres > 50) residentialScore -= 20;
  if (property.zoning?.toLowerCase().includes("residential")) residentialScore += 15;
  uses.push({ use: "Residential", score: Math.max(0, Math.min(100, residentialScore)), reasoning: "Based on utilities, access, and parcel size" });

  // Agricultural
  let agScore = 40;
  if (property.acres >= 10) agScore += 15;
  if (property.acres >= 50) agScore += 10;
  if (property.utilities?.water) agScore += 10;
  if (property.zoning?.toLowerCase().includes("ag")) agScore += 15;
  uses.push({ use: "Agricultural", score: Math.max(0, Math.min(100, agScore)), reasoning: "Based on acreage, water access, and zoning" });

  // Recreational
  let recScore = 45;
  if (property.acres >= 5) recScore += 10;
  if (property.acres >= 20) recScore += 10;
  if (property.roadAccess) recScore += 5;
  uses.push({ use: "Recreational", score: Math.max(0, Math.min(100, recScore)), reasoning: "Based on acreage and accessibility" });

  // Commercial
  let commScore = 30;
  if (property.roadAccess === "paved") commScore += 15;
  if (property.utilities?.electric && property.utilities?.water) commScore += 15;
  if (property.acres < 20) commScore += 10;
  if (property.zoning?.toLowerCase().includes("commercial")) commScore += 20;
  uses.push({ use: "Commercial", score: Math.max(0, Math.min(100, commScore)), reasoning: "Based on infrastructure, access, and zoning" });

  // Conservation
  let consScore = 30;
  if (property.acres >= 40) consScore += 15;
  if (property.acres >= 100) consScore += 10;
  uses.push({ use: "Conservation", score: Math.max(0, Math.min(100, consScore)), reasoning: "Based on acreage and conservation program eligibility" });

  uses.sort((a, b) => b.score - a.score);

  if (!property.utilities?.electric) constraints.push("No electric utility — limits residential/commercial use");
  if (!property.roadAccess || property.roadAccess === "none") constraints.push("No road access — significant development constraint");
  if (property.zoning) constraints.push(`Current zoning: ${property.zoning}`);

  if (property.acres >= 40) opportunities.push("Carbon credit eligibility (40+ acres)");
  if (property.acres >= 10) opportunities.push("Agricultural exemption may reduce property taxes");
  if (uses[0].score >= 70) opportunities.push(`Strong ${uses[0].use.toLowerCase()} potential`);

  return { recommendedUse: uses[0].use, scores: uses, constraints, opportunities };
}
