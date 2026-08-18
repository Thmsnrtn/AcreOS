/**
 * Environmental Intelligence — water rights, mineral rights, carbon credits,
 * climate risk, and highest-best-use analysis for land parcels.
 */

import { logger } from "../utils/logger";

// ── Water Rights ────────────────────────────────────────────────────

export interface WaterRightsInfo {
  state: string;
  doctrine: "prior_appropriation" | "riparian" | "hybrid";
  doctrineDescription: string;
  permitsRequired: boolean;
  typicalRightsType: string;
  transferability: "high" | "moderate" | "low";
  notes: string;
}

const WATER_RIGHTS: Record<string, Omit<WaterRightsInfo, "state">> = {
  TX: {
    doctrine: "hybrid",
    doctrineDescription: "Texas uses prior appropriation for surface water and rule of capture for groundwater",
    permitsRequired: true,
    typicalRightsType: "Surface: appropriative permit; Groundwater: landowner right",
    transferability: "moderate",
    notes: "Groundwater conservation districts regulate pumping locally",
  },
  FL: {
    doctrine: "riparian",
    doctrineDescription: "Florida follows regulated riparian doctrine with consumptive use permits",
    permitsRequired: true,
    typicalRightsType: "Consumptive use permit from water management district",
    transferability: "low",
    notes: "Five regional water management districts oversee allocation",
  },
  AZ: {
    doctrine: "prior_appropriation",
    doctrineDescription: "Arizona uses prior appropriation with active management areas for groundwater",
    permitsRequired: true,
    typicalRightsType: "Appropriative right; groundwater rights in AMAs restricted",
    transferability: "moderate",
    notes: "Assured water supply required for new subdivisions in AMAs",
  },
  CA: {
    doctrine: "hybrid",
    doctrineDescription: "California uses both riparian and prior appropriation doctrines",
    permitsRequired: true,
    typicalRightsType: "Riparian, pre-1914 appropriative, or post-1914 permit",
    transferability: "moderate",
    notes: "SGMA regulates groundwater basins; water rights highly contested",
  },
  CO: {
    doctrine: "prior_appropriation",
    doctrineDescription: "Colorado is strict prior appropriation — no riparian rights recognized",
    permitsRequired: true,
    typicalRightsType: "Decreed appropriative right via water court",
    transferability: "high",
    notes: "Water rights are property rights, actively traded; senior rights very valuable",
  },
  NM: {
    doctrine: "prior_appropriation",
    doctrineDescription: "New Mexico follows prior appropriation for all water",
    permitsRequired: true,
    typicalRightsType: "Permit from State Engineer; priority date controls",
    transferability: "high",
    notes: "Domestic well permits exempt up to 3 acre-feet/year",
  },
  NC: {
    doctrine: "riparian",
    doctrineDescription: "North Carolina follows riparian doctrine with regulatory permits",
    permitsRequired: true,
    typicalRightsType: "Riparian right; large withdrawals require registration",
    transferability: "low",
    notes: "Capacity use areas impose additional restrictions in coastal regions",
  },
  GA: {
    doctrine: "riparian",
    doctrineDescription: "Georgia follows regulated riparian doctrine",
    permitsRequired: true,
    typicalRightsType: "Surface water withdrawal permit; farm use exemptions exist",
    transferability: "low",
    notes: "Agricultural withdrawals under 100k gal/day exempt from permitting",
  },
  OR: {
    doctrine: "prior_appropriation",
    doctrineDescription: "Oregon follows prior appropriation administered by Water Resources Dept",
    permitsRequired: true,
    typicalRightsType: "Water right permit or certificate with priority date",
    transferability: "high",
    notes: "Exempt groundwater use allowed for domestic/stock up to 15k gal/day",
  },
  WA: {
    doctrine: "prior_appropriation",
    doctrineDescription: "Washington uses prior appropriation with permit-exempt domestic wells",
    permitsRequired: true,
    typicalRightsType: "Water right permit; exempt wells for domestic use",
    transferability: "high",
    notes: "Hirst decision limits exempt well use in some areas; instream flow rules apply",
  },
};

export function getWaterRightsInfo(state: string): WaterRightsInfo {
  const st = state.toUpperCase().trim();
  const data = WATER_RIGHTS[st];
  if (!data) {
    logger.warn("Water rights lookup miss", { metadata: { state: st } });
    return {
      state: st,
      doctrine: "riparian",
      doctrineDescription: "Data unavailable for this state — defaulting to general riparian assumption",
      permitsRequired: true,
      typicalRightsType: "Unknown — verify with state water agency",
      transferability: "low",
      notes: "No data on file; consult a water rights attorney for this jurisdiction",
    };
  }
  logger.debug("Water rights lookup", { metadata: { state: st, doctrine: data.doctrine } });
  return { state: st, ...data };
}

// ── Mineral Rights ──────────────────────────────────────────────────

export interface MineralRightsInfo {
  state: string;
  severanceCommon: boolean;
  severanceRisk: "high" | "moderate" | "low";
  dominantMinerals: string[];
  surfaceOwnerProtections: "strong" | "moderate" | "weak";
  notes: string;
}

const MINERAL_RIGHTS: Record<string, Omit<MineralRightsInfo, "state">> = {
  TX: {
    severanceCommon: true,
    severanceRisk: "high",
    dominantMinerals: ["oil", "natural_gas", "lignite"],
    surfaceOwnerProtections: "weak",
    notes: "Mineral estate dominant; surface owner has limited accommodation doctrine",
  },
  FL: {
    severanceCommon: false,
    severanceRisk: "low",
    dominantMinerals: ["phosphate", "limestone", "sand"],
    surfaceOwnerProtections: "moderate",
    notes: "Mineral severance uncommon; phosphate mining concentrated in central FL",
  },
  AZ: {
    severanceCommon: true,
    severanceRisk: "moderate",
    dominantMinerals: ["copper", "gold", "silver", "sand_gravel"],
    surfaceOwnerProtections: "moderate",
    notes: "Federal land patents often reserved mineral rights to government",
  },
  CA: {
    severanceCommon: true,
    severanceRisk: "moderate",
    dominantMinerals: ["oil", "natural_gas", "gold", "sand_gravel"],
    surfaceOwnerProtections: "strong",
    notes: "CEQA adds environmental review layer to mineral extraction",
  },
  CO: {
    severanceCommon: true,
    severanceRisk: "high",
    dominantMinerals: ["oil", "natural_gas", "coal", "molybdenum"],
    surfaceOwnerProtections: "moderate",
    notes: "SB 19-181 strengthened local government authority over oil/gas operations",
  },
  NM: {
    severanceCommon: true,
    severanceRisk: "high",
    dominantMinerals: ["oil", "natural_gas", "potash", "uranium"],
    surfaceOwnerProtections: "weak",
    notes: "Permian Basin region — mineral rights frequently severed and highly valuable",
  },
  NC: {
    severanceCommon: false,
    severanceRisk: "low",
    dominantMinerals: ["granite", "lithium", "sand_gravel"],
    surfaceOwnerProtections: "strong",
    notes: "Fracking moratorium; mineral severance rare outside western mountains",
  },
  GA: {
    severanceCommon: false,
    severanceRisk: "low",
    dominantMinerals: ["kaolin", "granite", "sand"],
    surfaceOwnerProtections: "moderate",
    notes: "Kaolin mining significant in middle GA; mineral severance uncommon",
  },
  OR: {
    severanceCommon: false,
    severanceRisk: "low",
    dominantMinerals: ["sand_gravel", "stone", "diatomite"],
    surfaceOwnerProtections: "strong",
    notes: "Limited mineral extraction; strong environmental review requirements",
  },
  WA: {
    severanceCommon: false,
    severanceRisk: "low",
    dominantMinerals: ["sand_gravel", "coal", "gold"],
    surfaceOwnerProtections: "strong",
    notes: "Surface Mining Act provides reclamation requirements; limited severance",
  },
};

export function getMineralRightsInfo(state: string): MineralRightsInfo {
  const st = state.toUpperCase().trim();
  const data = MINERAL_RIGHTS[st];
  if (!data) {
    logger.warn("Mineral rights lookup miss", { metadata: { state: st } });
    return {
      state: st,
      severanceCommon: false,
      severanceRisk: "low",
      dominantMinerals: [],
      surfaceOwnerProtections: "moderate",
      notes: "No data on file; always run a title search to confirm mineral ownership",
    };
  }
  logger.debug("Mineral rights lookup", { metadata: { state: st, severanceRisk: data.severanceRisk } });
  return { state: st, ...data };
}

// ── Carbon Credits ──────────────────────────────────────────────────

export interface CarbonCreditEstimate {
  eligible: boolean;
  estimatedCreditsPerYear: number;
  estimatedValuePerYear: number;
  programTypes: string[];
  landType: string;
  acreage: number;
  state: string;
  methodology: string;
  notes: string;
}

const CARBON_RATES: Record<string, { creditsPerAcre: number; pricePerCredit: number }> = {
  forest: { creditsPerAcre: 2.5, pricePerCredit: 25 },
  grassland: { creditsPerAcre: 0.8, pricePerCredit: 20 },
  cropland: { creditsPerAcre: 1.2, pricePerCredit: 18 },
  wetland: { creditsPerAcre: 3.5, pricePerCredit: 30 },
  desert: { creditsPerAcre: 0.1, pricePerCredit: 15 },
  rangeland: { creditsPerAcre: 0.5, pricePerCredit: 18 },
};

const STATE_CARBON_PROGRAMS: Record<string, string[]> = {
  TX: ["ACR", "Verra_VCS", "CAR"],
  FL: ["ACR", "Verra_VCS"],
  AZ: ["ACR", "Verra_VCS"],
  CA: ["CA_Cap_and_Trade", "ACR", "Verra_VCS", "CAR"],
  CO: ["ACR", "Verra_VCS", "CAR"],
  NM: ["ACR", "Verra_VCS"],
  NC: ["ACR", "Verra_VCS", "CAR"],
  GA: ["ACR", "Verra_VCS"],
  OR: ["ACR", "Verra_VCS", "CAR", "CA_Cap_and_Trade"],
  WA: ["WA_Cap_and_Invest", "ACR", "Verra_VCS", "CAR"],
};

const DEFAULT_LAND_TYPES: Record<string, string> = {
  TX: "rangeland",
  FL: "wetland",
  AZ: "desert",
  CA: "grassland",
  CO: "grassland",
  NM: "desert",
  NC: "forest",
  GA: "forest",
  OR: "forest",
  WA: "forest",
};

const MIN_CARBON_ACRES = 40;

export function estimateCarbonCredits(
  state: string,
  acres: number,
  landType?: string,
): CarbonCreditEstimate {
  const st = state.toUpperCase().trim();
  const resolvedType = landType?.toLowerCase() || DEFAULT_LAND_TYPES[st] || "grassland";
  const rates = CARBON_RATES[resolvedType] || CARBON_RATES.grassland;
  const programs = STATE_CARBON_PROGRAMS[st] || ["ACR", "Verra_VCS"];

  const eligible = acres >= MIN_CARBON_ACRES;
  const creditsPerYear = eligible
    ? Math.round(acres * rates.creditsPerAcre * 10) / 10
    : 0;
  const valuePerYear = eligible
    ? Math.round(creditsPerYear * rates.pricePerCredit)
    : 0;

  logger.debug("Carbon credit estimate", {
    metadata: { state: st, acres, landType: resolvedType, eligible, creditsPerYear },
  });

  return {
    eligible,
    estimatedCreditsPerYear: creditsPerYear,
    estimatedValuePerYear: valuePerYear,
    programTypes: programs,
    landType: resolvedType,
    acreage: acres,
    state: st,
    methodology: "Static estimate: credits/acre rates by land type with state program availability",
    notes: eligible
      ? `Estimated ${creditsPerYear} credits/yr at ~$${rates.pricePerCredit}/credit. Verification and baseline required.`
      : `Minimum ${MIN_CARBON_ACRES} acres typically required for carbon program enrollment.`,
  };
}

// ── Climate Risk ────────────────────────────────────────────────────

export interface RiskDetail {
  /**
   * `unknown` is a real answer and the honest one for most of the country.
   *
   * `CLIMATE_DATA` covers TEN states. Until 2026-08-18 the other forty got
   * `level: "moderate", score: 50` with a `description` of "Insufficient data
   * for this state" — and the card that renders this
   * (`environmental-intelligence-card.tsx`) shows the BADGE and the SCORE and
   * never the description. So a customer looking at a property in 40 of 50
   * states was shown a moderate climate risk assessment that had been invented,
   * on the same surface as the ten states where it is real.
   */
  level: "low" | "moderate" | "high" | "very_high" | "unknown";
  /** 0-100, or null when the level is `unknown` — there is no score to give. */
  score: number | null;
  description: string;
}

export interface ClimateRiskAssessment {
  state: string;
  county?: string;
  overallRisk: "low" | "moderate" | "high" | "very_high" | "unknown";
  floodRisk: RiskDetail;
  fireRisk: RiskDetail;
  droughtRisk: RiskDetail;
  hurricaneRisk: RiskDetail;
  notes: string;
}

const CLIMATE_DATA: Record<
  string,
  Pick<ClimateRiskAssessment, "overallRisk" | "floodRisk" | "fireRisk" | "droughtRisk" | "hurricaneRisk">
> = {
  TX: {
    overallRisk: "high",
    floodRisk: { level: "high", score: 75, description: "Flash flooding common; Gulf coast hurricane surge" },
    fireRisk: { level: "high", score: 70, description: "Wildfire risk high in western TX and panhandle" },
    droughtRisk: { level: "very_high", score: 85, description: "Western TX chronic drought; aquifer depletion" },
    hurricaneRisk: { level: "high", score: 72, description: "Gulf coast exposed; inland wind damage possible" },
  },
  FL: {
    overallRisk: "very_high",
    floodRisk: { level: "very_high", score: 90, description: "Sea level rise, storm surge, and inland flooding" },
    fireRisk: { level: "moderate", score: 45, description: "Seasonal brush fires; controlled burns common" },
    droughtRisk: { level: "moderate", score: 40, description: "Seasonal dry periods; aquifer generally adequate" },
    hurricaneRisk: { level: "very_high", score: 95, description: "Highest hurricane exposure in continental US" },
  },
  AZ: {
    overallRisk: "high",
    floodRisk: { level: "moderate", score: 50, description: "Flash flooding in monsoon season; wash areas" },
    fireRisk: { level: "very_high", score: 88, description: "Extreme wildfire risk in forested highlands" },
    droughtRisk: { level: "very_high", score: 92, description: "Chronic drought; Colorado River allocation cuts" },
    hurricaneRisk: { level: "low", score: 5, description: "Minimal hurricane exposure" },
  },
  CA: {
    overallRisk: "very_high",
    floodRisk: { level: "high", score: 65, description: "Atmospheric rivers, mudslides after fires" },
    fireRisk: { level: "very_high", score: 95, description: "Extreme wildfire risk statewide; WUI expansion" },
    droughtRisk: { level: "very_high", score: 88, description: "Multi-year droughts; water allocation conflicts" },
    hurricaneRisk: { level: "low", score: 2, description: "No meaningful hurricane risk" },
  },
  CO: {
    overallRisk: "moderate",
    floodRisk: { level: "moderate", score: 45, description: "Flash floods in canyons; spring snowmelt flooding" },
    fireRisk: { level: "high", score: 78, description: "Growing WUI wildfire risk; Marshall fire precedent" },
    droughtRisk: { level: "high", score: 70, description: "Colorado River compact obligations; front range growth" },
    hurricaneRisk: { level: "low", score: 1, description: "No hurricane risk" },
  },
  NM: {
    overallRisk: "high",
    floodRisk: { level: "moderate", score: 42, description: "Flash flood risk in arroyos and burn scar areas" },
    fireRisk: { level: "very_high", score: 85, description: "Severe wildfire risk; post-fire flooding compound risk" },
    droughtRisk: { level: "very_high", score: 90, description: "Persistent drought; Rio Grande frequently runs dry" },
    hurricaneRisk: { level: "low", score: 1, description: "No hurricane risk" },
  },
  NC: {
    overallRisk: "high",
    floodRisk: { level: "high", score: 78, description: "Coastal storm surge and inland river flooding" },
    fireRisk: { level: "low", score: 25, description: "Limited wildfire risk; prescribed burns in piedmont" },
    droughtRisk: { level: "moderate", score: 35, description: "Occasional drought periods; generally adequate water" },
    hurricaneRisk: { level: "high", score: 75, description: "Direct hurricane hits and tropical storm flooding" },
  },
  GA: {
    overallRisk: "moderate",
    floodRisk: { level: "moderate", score: 55, description: "Coastal flooding; urban flash floods in metro areas" },
    fireRisk: { level: "moderate", score: 40, description: "Seasonal fire risk in southern pine forests" },
    droughtRisk: { level: "moderate", score: 45, description: "Periodic drought; water wars with AL/FL" },
    hurricaneRisk: { level: "moderate", score: 55, description: "Coastal exposure; inland wind damage from landfalls" },
  },
  OR: {
    overallRisk: "moderate",
    floodRisk: { level: "moderate", score: 50, description: "River flooding in Willamette Valley; coastal erosion" },
    fireRisk: { level: "high", score: 80, description: "Severe wildfire risk east of Cascades; 2020 fires precedent" },
    droughtRisk: { level: "moderate", score: 48, description: "Eastern OR drought-prone; western OR generally adequate" },
    hurricaneRisk: { level: "low", score: 1, description: "No hurricane risk" },
  },
  WA: {
    overallRisk: "moderate",
    floodRisk: { level: "moderate", score: 52, description: "River flooding; atmospheric rivers; lahar risk near Rainier" },
    fireRisk: { level: "high", score: 72, description: "Eastern WA wildfire risk high; smoke impacts statewide" },
    droughtRisk: { level: "moderate", score: 42, description: "Eastern WA irrigation-dependent; snowpack declining" },
    hurricaneRisk: { level: "low", score: 1, description: "No hurricane risk" },
  },
};

export function assessClimateRisk(
  state: string,
  county?: string,
  lat?: number,
  lng?: number,
): ClimateRiskAssessment {
  const st = state.toUpperCase().trim();
  const data = CLIMATE_DATA[st];

  if (!data) {
    logger.warn("Climate risk lookup miss", { metadata: { state: st, county } });
    // REFUSE, do not assert. Returning "moderate / 50" here was a measurement
    // nobody made, rendered next to the ten states where the same fields are
    // real and indistinguishable from them.
    const unknown = (hazard: string): RiskDetail => ({
      level: "unknown",
      score: null,
      description: `No ${hazard} data on file for ${st}`,
    });
    return {
      state: st,
      county,
      overallRisk: "unknown",
      floodRisk: unknown("flood"),
      fireRisk: unknown("wildfire"),
      droughtRisk: unknown("drought"),
      hurricaneRisk: unknown("hurricane"),
      notes: "No state-level climate data on file; recommend FEMA flood map and local hazard review",
    };
  }

  logger.debug("Climate risk assessment", {
    metadata: { state: st, county, overallRisk: data.overallRisk, lat, lng },
  });

  return {
    state: st,
    county,
    ...data,
    notes: county
      ? `State-level assessment for ${st}. County-level data for ${county} may vary — verify with local hazard maps.`
      : `State-level assessment for ${st}. Provide county for more granular context.`,
  };
}

// ── Highest and Best Use ────────────────────────────────────────────

export interface LandUseOption {
  use: "residential" | "agricultural" | "commercial" | "recreational" | "conservation";
  score: number; // 0-100
  rationale: string;
  estimatedValueImpact: "positive" | "neutral" | "negative";
}

export interface UseFactor {
  name: string;
  value: string;
  impact: "positive" | "neutral" | "negative";
}

export interface HighestBestUseAnalysis {
  recommended: LandUseOption;
  alternatives: LandUseOption[];
  factors: UseFactor[];
  notes: string;
}

export function analyzeHighestBestUse(property: {
  state: string;
  county?: string;
  acres: number;
  zoning?: string;
  utilities?: any;
  roadAccess?: string;
}): HighestBestUseAnalysis {
  const { state, county, acres, zoning, utilities, roadAccess } = property;
  const st = state.toUpperCase().trim();

  const factors: UseFactor[] = [];
  const scores: Record<string, number> = {
    residential: 50,
    agricultural: 50,
    commercial: 30,
    recreational: 50,
    conservation: 40,
  };

  // ── Acreage ──
  if (acres < 5) {
    scores.residential += 25;
    scores.commercial += 15;
    scores.agricultural -= 20;
    scores.conservation -= 20;
    factors.push({ name: "acreage", value: `${acres} acres (small)`, impact: "positive" });
  } else if (acres < 40) {
    scores.residential += 15;
    scores.recreational += 15;
    scores.agricultural += 10;
    factors.push({ name: "acreage", value: `${acres} acres (medium)`, impact: "neutral" });
  } else if (acres < 160) {
    scores.agricultural += 25;
    scores.recreational += 20;
    scores.conservation += 15;
    scores.residential -= 10;
    factors.push({ name: "acreage", value: `${acres} acres (large)`, impact: "positive" });
  } else {
    scores.agricultural += 30;
    scores.conservation += 30;
    scores.recreational += 15;
    scores.residential -= 25;
    scores.commercial -= 20;
    factors.push({ name: "acreage", value: `${acres} acres (very large)`, impact: "positive" });
  }

  // ── Zoning ──
  if (zoning) {
    const z = zoning.toUpperCase();
    if (z.startsWith("R") || z.includes("RESID")) {
      scores.residential += 20;
      factors.push({ name: "zoning", value: zoning, impact: "positive" });
    } else if (z.startsWith("A") || z.includes("AGRI") || z.includes("AG")) {
      scores.agricultural += 20;
      scores.conservation += 10;
      factors.push({ name: "zoning", value: zoning, impact: "positive" });
    } else if (z.startsWith("C") || z.includes("COMM")) {
      scores.commercial += 25;
      factors.push({ name: "zoning", value: zoning, impact: "positive" });
    } else {
      factors.push({ name: "zoning", value: zoning, impact: "neutral" });
    }
  } else {
    factors.push({ name: "zoning", value: "unknown", impact: "neutral" });
  }

  // ── Utilities ──
  const hasUtilities = utilities && (utilities.water || utilities.electric || utilities.sewer);
  if (hasUtilities) {
    scores.residential += 15;
    scores.commercial += 15;
    factors.push({ name: "utilities", value: "available", impact: "positive" });
  } else {
    scores.residential -= 10;
    scores.commercial -= 15;
    scores.conservation += 5;
    scores.recreational += 5;
    factors.push({ name: "utilities", value: "unavailable or unknown", impact: "negative" });
  }

  // ── Road access ──
  if (roadAccess) {
    const ra = roadAccess.toLowerCase();
    if (ra.includes("paved") || ra.includes("highway")) {
      scores.residential += 10;
      scores.commercial += 15;
      factors.push({ name: "road_access", value: roadAccess, impact: "positive" });
    } else if (ra.includes("dirt") || ra.includes("gravel")) {
      scores.recreational += 10;
      scores.agricultural += 5;
      scores.commercial -= 10;
      factors.push({ name: "road_access", value: roadAccess, impact: "neutral" });
    } else if (ra.includes("none") || ra.includes("landlocked")) {
      scores.residential -= 20;
      scores.commercial -= 25;
      scores.conservation += 10;
      factors.push({ name: "road_access", value: roadAccess, impact: "negative" });
    } else {
      factors.push({ name: "road_access", value: roadAccess, impact: "neutral" });
    }
  }

  // ── Climate-adjusted ──
  // A hazard with no score cannot cross a threshold. `score === null` means
  // nobody measured it — that must produce NO adjustment and NO factor, rather
  // than coercing to 0 and reading as "measured, and below the threshold".
  const scoredAtLeast = (r: RiskDetail, threshold: number): boolean =>
    r.score !== null && r.score >= threshold;
  const climate = CLIMATE_DATA[st];
  if (climate) {
    if (scoredAtLeast(climate.fireRisk, 80)) {
      scores.residential -= 10;
      scores.conservation += 5;
      factors.push({ name: "fire_risk", value: "high", impact: "negative" });
    }
    if (scoredAtLeast(climate.droughtRisk, 80)) {
      scores.agricultural -= 15;
      factors.push({ name: "drought_risk", value: "high", impact: "negative" });
    }
    if (scoredAtLeast(climate.floodRisk, 75)) {
      scores.residential -= 10;
      scores.commercial -= 10;
      factors.push({ name: "flood_risk", value: "high", impact: "negative" });
    }
  }

  // ── Clamp & rank ──
  const USES = ["residential", "agricultural", "commercial", "recreational", "conservation"] as const;
  for (const u of USES) {
    scores[u] = Math.max(0, Math.min(100, scores[u]));
  }

  const sorted: LandUseOption[] = USES.map((use) => ({
    use,
    score: scores[use],
    rationale: buildRationale(use, scores[use], factors),
    estimatedValueImpact:
      scores[use] >= 65 ? ("positive" as const) : scores[use] >= 40 ? ("neutral" as const) : ("negative" as const),
  })).sort((a, b) => b.score - a.score);

  const recommended = sorted[0];
  const alternatives = sorted.slice(1);

  logger.debug("Highest-best-use analysis", {
    metadata: { state: st, county, acres, recommended: recommended.use, score: recommended.score },
  });

  return {
    recommended,
    alternatives,
    factors,
    notes: `Analysis based on ${factors.length} factors. Top use: ${recommended.use} (${recommended.score}/100). Zoning and local market conditions should be verified.`,
  };
}

// ── Helpers ─────────────────────────────────────────────────────────

function buildRationale(use: string, score: number, factors: UseFactor[]): string {
  const strength = score >= 70 ? "Strong" : score >= 50 ? "Moderate" : "Weak";
  const positives = factors.filter((f) => f.impact === "positive").map((f) => f.name);
  const negatives = factors.filter((f) => f.impact === "negative").map((f) => f.name);

  let r = `${strength} fit for ${use} use (score: ${score}).`;
  if (positives.length > 0) r += ` Favorable: ${positives.join(", ")}.`;
  if (negatives.length > 0) r += ` Concerns: ${negatives.join(", ")}.`;
  return r;
}
