/**
 * Automated Due Diligence Engine
 *
 * Runs parallel automated checks against free government APIs:
 * - FEMA NFHL: Flood zone designation
 * - USFWS NWI: Wetlands coverage percentage
 * - EPA FRS (SEMS) + Envirofacts RCRA: Superfund/environmental hazard proximity
 * - OpenStreetMap Overpass: Road access proximity
 * - USDA Web Soil Survey / SSURGO: Soil type, farmland classification
 * - USGS EPQS (3DEP): Elevation + real multi-point slope
 * - FEMA National Risk Index: wildfire + 18-hazard composite risk
 *
 * All APIs are free with no key required.
 * Results are cached 30 days in the database.
 */

import { db } from "../db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";

// ============================================
// TYPES
// ============================================

export type RiskLevel = "low" | "medium" | "high" | "critical" | "unknown";

export interface FloodZoneResult {
  status: "done" | "error";
  zone: string | null; // X, AE, VE, A, etc.
  zoneDescription: string | null;
  risk: RiskLevel;
  inFloodplain: boolean;
  floodInsuranceRequired: boolean;
}

export interface WetlandsResult {
  status: "done" | "error";
  hasWetlands: boolean;
  wetlandAcres: number;
  wetlandPercent: number; // % of parcel area
  wetlandTypes: string[];
  risk: RiskLevel;
  developmentImpact: string;
}

export interface EnvironmentalResult {
  status: "done" | "error";
  superfundSitesWithin1Mile: number;
  superfundSitesWithin5Miles: number;
  nearestHazardName: string | null;
  nearestHazardDistanceMiles: number | null;
  risk: RiskLevel;
}

export interface RoadAccessResult {
  status: "done" | "error";
  hasDirectRoadAccess: boolean;
  nearestRoadName: string | null;
  nearestRoadDistanceFeet: number | null;
  roadType: string | null; // residential, primary, secondary, track
  risk: RiskLevel;
  note: string;
}

export interface SoilResult {
  status: "done" | "error";
  dominantSoilName: string | null;
  farmlandClassification: string | null; // Prime, Statewide importance, Local importance, Not prime
  drainage: string | null;
  risk: RiskLevel;
}

export interface ElevationResult {
  status: "done" | "error";
  elevationFeet: number | null;
  slope: string | null; // flat (<3%), gentle (3-8%), moderate (8-15%), steep (>15%)
  risk: RiskLevel;
}

// ============================================
// NEW DATA TYPES (Epic B + Epic D)
// ============================================

export interface LandCoverResult {
  status: "done" | "error";
  forestPercent: number;
  farmlandPercent: number;
  wetlandPercent: number;
  developedPercent: number;
  grasslandPercent: number;
  dominantCover: string;
  recreationalPremium: boolean; // Forest >60%
  developedEncroachment: boolean; // Developed <1mi
  agriculturalValue: boolean; // Farmland >70%
}

export interface BLMAdjacencyResult {
  status: "done" | "error";
  isAdjacentToPublicLand: boolean;
  nearestPublicLandName: string | null;
  nearestPublicLandDistanceMiles: number | null;
  agencyType: "BLM" | "USFS" | "NPS" | "Other" | null;
  acreScoreBonus: number; // +150 if adjacent
}

export interface EndangeredSpeciesResult {
  status: "done" | "error";
  speciesCount: number;
  hasListedSpecies: boolean;
  speciesNames: string[];
  riskLevel: "none" | "low" | "moderate" | "high";
}

export interface WildfireRiskResult {
  status: "done" | "error";
  wildfireRisk: "low" | "moderate" | "high" | "very_high" | "unknown";
  fireBehaviorClass: number | null; // 1-5
  offerAdjustment: number; // -15% if very_high
}

export interface SoilSSURGOResult {
  status: "done" | "error";
  dominantSoilName: string | null;
  farmlandClassification: string | null;
  drainage: string | null;
  hydricPercent: number; // % hydric soils (wetland risk)
  nccpiScore: number | null; // 0-1 National Commodity Crop Productivity Index
  risk: RiskLevel;
  acreScoreImpact: number; // +100 if NCCPI>0.6; -100 if hydric>50%
}

export interface NationalRiskIndexResult {
  status: "done" | "error";
  county: string | null;
  state: string | null;
  compositeScore: number | null; // 0-100 national percentile
  compositeRating: string | null; // "Very Low" … "Very High"
  expectedAnnualLossRating: string | null;
  socialVulnerabilityRating: string | null;
  communityResilienceRating: string | null;
  // Hazards this county rates "Relatively High" or "Very High" on
  elevatedHazards: string[];
  risk: RiskLevel;
}

export interface AutoDDReport {
  propertyId: number;
  lat: number;
  lng: number;
  acreage: number | null;
  runAt: string;
  overallScore: number; // 0-100 (100 = best)
  overallRisk: RiskLevel;
  passedChecks: number;
  totalChecks: number;
  aiSummary: string;
  checks: {
    floodZone: FloodZoneResult;
    wetlands: WetlandsResult;
    environmental: EnvironmentalResult;
    roadAccess: RoadAccessResult;
    soil: SoilResult;
    elevation: ElevationResult;
    // Epic B + D additions
    landCover?: LandCoverResult;
    blmAdjacency?: BLMAdjacencyResult;
    endangeredSpecies?: EndangeredSpeciesResult;
    wildfireRisk?: WildfireRiskResult;
    soilSSURGO?: SoilSSURGOResult;
    nationalRisk?: NationalRiskIndexResult;
  };
  redFlags: string[];
  greenFlags: string[];
  recommendedOfferAdjustment: number; // % adjustment to recommended offer (negative = reduce)
}

// ============================================
// BUSINESS-TYPE-SPECIFIC DUE DILIGENCE TEMPLATES
// ============================================

export type BusinessDDType = "fix_and_flip" | "buy_and_hold" | "commercial";

export interface DDChecklistItem {
  category: string;
  item: string;
  description: string;
  priority: "required" | "recommended" | "optional";
}

export const businessTypeDDTemplates: Record<BusinessDDType, DDChecklistItem[]> = {
  fix_and_flip: [
    { category: "Structural", item: "Foundation inspection", description: "Check for cracks, settling, water intrusion, and structural integrity", priority: "required" },
    { category: "Structural", item: "Roof condition", description: "Age, material, leaks, remaining lifespan, and replacement cost estimate", priority: "required" },
    { category: "HVAC", item: "HVAC system evaluation", description: "Age, efficiency rating, repair vs. replace cost analysis", priority: "required" },
    { category: "Plumbing", item: "Plumbing inspection", description: "Pipe material (galvanized, PEX, copper), water heater age, sewer line scope", priority: "required" },
    { category: "Electrical", item: "Electrical panel and wiring", description: "Panel amperage, wiring type (knob-and-tube, aluminum, copper), code compliance", priority: "required" },
    { category: "Permits", item: "Open or unpulled permits", description: "Check county records for open permits or unpermitted work that must be resolved", priority: "required" },
    { category: "Permits", item: "Renovation permit requirements", description: "Determine which planned improvements require permits and estimated timeline", priority: "recommended" },
    { category: "Contractor", item: "Contractor bids (minimum 2)", description: "Get itemized bids for full rehab scope from licensed, insured contractors", priority: "required" },
    { category: "Contractor", item: "Rehab timeline estimate", description: "Realistic project timeline including permit approval, material lead times, and inspections", priority: "recommended" },
  ],

  buy_and_hold: [
    { category: "Rental Comps", item: "Rental comparable analysis", description: "Verify market rents for similar units within 1-mile radius using recent lease data", priority: "required" },
    { category: "Rental Comps", item: "Vacancy rate assessment", description: "Local vacancy trends and seasonal patterns for the submarket", priority: "recommended" },
    { category: "Property Management", item: "Property management plan", description: "Self-manage vs. PM company; typical fees (8-12%), maintenance reserves, turnover costs", priority: "required" },
    { category: "Insurance", item: "Landlord insurance quote", description: "Dwelling coverage, liability, loss-of-rent, and flood/wind riders as needed", priority: "required" },
    { category: "Insurance", item: "Umbrella policy review", description: "Consider umbrella policy if holding multiple rental units", priority: "optional" },
    { category: "Tenant Screening", item: "Tenant screening criteria", description: "Define income-to-rent ratio, credit score threshold, background check standards", priority: "required" },
    { category: "Tenant Screening", item: "Lease agreement review", description: "State-compliant lease with maintenance responsibilities, pet policy, late fees", priority: "recommended" },
    { category: "Cash Flow", item: "Cash flow projection (12-month)", description: "Gross rent minus PITI, vacancy, CapEx reserves, PM fees, maintenance, and utilities", priority: "required" },
    { category: "Cash Flow", item: "Cap rate and cash-on-cash return", description: "Calculate NOI / purchase price and annual cash flow / total cash invested", priority: "required" },
  ],

  commercial: [
    { category: "Environmental", item: "Phase 1 Environmental Site Assessment", description: "ASTM E1527 standard assessment for recognized environmental conditions (RECs)", priority: "required" },
    { category: "Environmental", item: "Phase 2 ESA (if triggered)", description: "Soil/groundwater sampling if Phase 1 identifies potential contamination", priority: "recommended" },
    { category: "Zoning", item: "Zoning verification and compliance", description: "Confirm permitted uses, FAR, setbacks, parking requirements, and variance history", priority: "required" },
    { category: "Zoning", item: "Conditional use or special permit status", description: "Identify if current use requires special permits and their transferability", priority: "recommended" },
    { category: "Leases", item: "Lease abstract review", description: "Summarize all leases: term, rent, escalations, options, CAM structure, tenant improvement allowances", priority: "required" },
    { category: "Leases", item: "Lease expiration schedule", description: "Staggered rollover risk assessment and market rent gap analysis", priority: "required" },
    { category: "Tenant Financials", item: "Tenant financial statements", description: "Request 2-3 years of financials from major tenants; assess creditworthiness and rent coverage ratio", priority: "required" },
    { category: "Tenant Financials", item: "Tenant concentration risk", description: "Flag if any single tenant represents >30% of gross revenue", priority: "recommended" },
    { category: "CAM", item: "CAM reconciliation audit", description: "Review 3 years of CAM budgets vs. actuals; identify pass-through gaps and landlord exposure", priority: "required" },
    { category: "CAM", item: "Operating expense history", description: "Verify trailing 12-month OpEx and compare to pro forma assumptions", priority: "required" },
  ],
};

/**
 * Returns the due diligence checklist template for a given business type.
 * Returns undefined for business types without a specific template (e.g., land_flipper, note_investor).
 */
export function getDDTemplateForBusinessType(
  businessType: string
): DDChecklistItem[] | undefined {
  if (businessType in businessTypeDDTemplates) {
    return businessTypeDDTemplates[businessType as BusinessDDType];
  }
  return undefined;
}

// ============================================
// FEMA FLOOD ZONE CHECK
// Uses FEMA's NFHL API (free, no key)
// ============================================

async function checkFloodZone(lat: number, lng: number): Promise<FloodZoneResult> {
  try {
    const url = `https://hazards.fema.gov/gis/nfhl/rest/services/public/NFHL/MapServer/28/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelIntersects&outFields=FLD_ZONE,ZONE_SUBTY,STUDY_TYP&f=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`FEMA API ${resp.status}`);

    const data = await resp.json();
    const features = data.features || [];

    if (features.length === 0) {
      return {
        status: "done",
        zone: "X",
        zoneDescription: "Minimal flood hazard (not in FEMA database — likely Zone X)",
        risk: "low",
        inFloodplain: false,
        floodInsuranceRequired: false,
      };
    }

    const zone = features[0]?.attributes?.FLD_ZONE || "X";
    const highRiskZones = ["A", "AE", "AH", "AO", "AR", "A99", "V", "VE"];
    const moderateZones = ["B", "X shaded"];

    const inFloodplain = highRiskZones.some((z) => zone.startsWith(z));
    const isModerate = moderateZones.some((z) => zone.includes(z));

    let risk: RiskLevel = "low";
    let zoneDescription = "";

    if (zone.startsWith("V")) {
      risk = "critical";
      zoneDescription = "Coastal High Hazard — storm wave action, highest flood risk";
    } else if (zone.startsWith("AE") || zone === "A") {
      risk = "high";
      zoneDescription = "High-risk flood zone — 1% annual chance of flooding (100-year flood)";
    } else if (zone.startsWith("A")) {
      risk = "high";
      zoneDescription = "Special Flood Hazard Area — mandatory flood insurance if mortgaged";
    } else if (isModerate) {
      risk = "medium";
      zoneDescription = "Moderate flood risk — 0.2% annual chance (500-year flood)";
    } else {
      zoneDescription = "Minimal flood hazard area — low flood risk";
    }

    return {
      status: "done",
      zone,
      zoneDescription,
      risk,
      inFloodplain,
      floodInsuranceRequired: inFloodplain,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { status: "error", zone: null, zoneDescription: "FEMA API timeout", risk: "unknown", inFloodplain: false, floodInsuranceRequired: false };
    }
    return { status: "error", zone: null, zoneDescription: String(err.message), risk: "unknown", inFloodplain: false, floodInsuranceRequired: false };
  }
}

// ============================================
// USFWS WETLANDS CHECK
// Uses National Wetlands Inventory REST API (free)
// ============================================

async function checkWetlands(lat: number, lng: number, acreage: number | null): Promise<WetlandsResult> {
  try {
    // 500m buffer around the point
    const bufferDeg = 0.005; // ~500m
    const envelope = `${lng - bufferDeg},${lat - bufferDeg},${lng + bufferDeg},${lat + bufferDeg}`;

    const url = `https://www.fws.gov/wetlands/arcgis/rest/services/Wetlands/MapServer/0/query?geometry=${envelope}&geometryType=esriGeometryEnvelope&spatialRel=esriSpatialRelIntersects&outFields=ATTRIBUTE,ACRES,WETLAND_TYPE&f=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`NWI API ${resp.status}`);

    const data = await resp.json();
    const features = data.features || [];

    if (features.length === 0) {
      return {
        status: "done",
        hasWetlands: false,
        wetlandAcres: 0,
        wetlandPercent: 0,
        wetlandTypes: [],
        risk: "low",
        developmentImpact: "No wetlands detected in or near the parcel.",
      };
    }

    const totalWetlandAcres = features.reduce(
      (sum: number, f: any) => sum + (f.attributes?.ACRES || 0),
      0
    );
    const wetlandTypes = Array.from(new Set(features.map((f: any) => f.attributes?.WETLAND_TYPE).filter(Boolean))) as string[];
    const wetlandPercent = acreage ? Math.min(100, (totalWetlandAcres / acreage) * 100) : 0;

    let risk: RiskLevel = "low";
    let developmentImpact = "";

    if (wetlandPercent > 50) {
      risk = "critical";
      developmentImpact = `${wetlandPercent.toFixed(0)}% of parcel is wetlands — major development restrictions, Section 404 permits required for any fill.`;
    } else if (wetlandPercent > 20) {
      risk = "high";
      developmentImpact = `${wetlandPercent.toFixed(0)}% wetlands coverage — significant development restrictions, Army Corps permits likely required.`;
    } else if (wetlandPercent > 5) {
      risk = "medium";
      developmentImpact = `${wetlandPercent.toFixed(0)}% wetlands — some development restrictions in wetland areas.`;
    } else if (totalWetlandAcres > 0) {
      risk = "low";
      developmentImpact = `Minor wetlands presence (${totalWetlandAcres.toFixed(2)} acres) — minimal impact on development.`;
    }

    return {
      status: "done",
      hasWetlands: totalWetlandAcres > 0,
      wetlandAcres: Math.round(totalWetlandAcres * 100) / 100,
      wetlandPercent: Math.round(wetlandPercent * 10) / 10,
      wetlandTypes,
      risk,
      developmentImpact,
    };
  } catch (err: any) {
    if (err.name === "AbortError") {
      return { status: "error", hasWetlands: false, wetlandAcres: 0, wetlandPercent: 0, wetlandTypes: [], risk: "unknown", developmentImpact: "NWI API timeout" };
    }
    return { status: "error", hasWetlands: false, wetlandAcres: 0, wetlandPercent: 0, wetlandTypes: [], risk: "unknown", developmentImpact: String(err.message) };
  }
}

/**
 * Coordinate sanitizer for URLs. Property lat/lng ultimately comes from
 * request bodies, so it must never reach a fetch URL as a raw string —
 * force it through numeric validation + fixed-precision formatting so the
 * interpolated value can only ever be a plain number.
 */
function safeCoord(value: number, kind: "lat" | "lng"): string {
  const n = Number(value);
  const limit = kind === "lat" ? 90 : 180;
  if (!Number.isFinite(n) || Math.abs(n) > limit) {
    throw new Error(`Invalid ${kind} coordinate`);
  }
  return n.toFixed(6);
}

// ============================================
// EPA ENVIRONMENTAL CHECK
// Superfund counts come from EPA FRS get_facilities filtered to the SEMS
// program (the actual Superfund enterprise system); RCRA hazardous-waste
// facilities from Envirofacts supplement the nearest-hazard signal.
// Both are free, no key.
// ============================================

async function checkEnvironmental(lat: number, lng: number): Promise<EnvironmentalResult> {
  const [superfund, rcra] = await Promise.allSettled([
    checkSuperfund(lat, lng),
    checkRcraFacilities(lat, lng),
  ]);

  const sems = superfund.status === "fulfilled" ? superfund.value : null;
  const rcraSite = rcra.status === "fulfilled" ? rcra.value : null;

  // Both sources unreachable → the check failed; never report "clean".
  if ((!sems || sems.status === "error") && !rcraSite) {
    return {
      status: "error",
      superfundSitesWithin1Mile: 0,
      superfundSitesWithin5Miles: 0,
      nearestHazardName: null,
      nearestHazardDistanceMiles: null,
      risk: "unknown",
    };
  }

  const result: EnvironmentalResult = sems && sems.status === "done"
    ? { ...sems }
    : {
        status: "done",
        superfundSitesWithin1Mile: 0,
        superfundSitesWithin5Miles: 0,
        nearestHazardName: null,
        nearestHazardDistanceMiles: null,
        risk: "low",
      };

  // Fold in the nearest RCRA facility if it is closer than the nearest
  // Superfund site (or the only hazard found).
  if (rcraSite && (result.nearestHazardDistanceMiles === null || rcraSite.distanceMiles < result.nearestHazardDistanceMiles)) {
    result.nearestHazardName = rcraSite.name;
    result.nearestHazardDistanceMiles = Math.round(rcraSite.distanceMiles * 10) / 10;
    if (rcraSite.distanceMiles <= 1 && result.risk === "low") result.risk = "medium";
  }

  return result;
}

interface NearestFacility {
  name: string;
  distanceMiles: number;
}

async function checkRcraFacilities(lat: number, lng: number): Promise<NearestFacility | null> {
  const la = Number(safeCoord(lat, "lat"));
  const lo = Number(safeCoord(lng, "lng"));
  const url = `https://data.epa.gov/efservice/RCRA_FACILITIES/LATITUDE82/${(la - 0.1).toFixed(6)}:${(la + 0.1).toFixed(6)}/LONGITUDE82/${(lo - 0.1).toFixed(6)}:${(lo + 0.1).toFixed(6)}/rows/0:20/JSON`;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);

  if (!resp.ok) throw new Error(`Envirofacts RCRA ${resp.status}`);
  const data = await resp.json();
  const sites = Array.isArray(data) ? data : [];

  let nearest: NearestFacility | null = null;
  for (const s of sites) {
    const siteLat = parseFloat(s.LATITUDE82 || "");
    const siteLng = parseFloat(s.LONGITUDE82 || "");
    if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) continue;
    const d = haversineDistanceMiles(lat, lng, siteLat, siteLng);
    if (!nearest || d < nearest.distanceMiles) {
      nearest = { name: s.FAC_NAME || "RCRA facility", distanceMiles: d };
    }
  }
  return nearest;
}

/**
 * Real Superfund proximity via EPA FRS `get_facilities` filtered to the
 * SEMS program (Superfund Enterprise Management System). Radius search in
 * miles; response shape is `Results.FRSFacility[]` with string
 * Latitude83/Longitude83. Verified live 2026-07-13.
 */
async function checkSuperfund(lat: number, lng: number): Promise<EnvironmentalResult> {
  try {
    const url = `https://ofmpub.epa.gov/frs_public2/frs_rest_services.get_facilities?latitude83=${safeCoord(lat, "lat")}&longitude83=${safeCoord(lng, "lng")}&search_radius=5&pgm_sys_acrnm=SEMS&output=JSON`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`EPA FRS ${resp.status}`);

    const data = await resp.json();
    const facilities: any[] = data?.Results?.FRSFacility || [];

    let within1Mile = 0;
    let within5Miles = 0;
    let nearest: NearestFacility | null = null;

    for (const f of facilities) {
      const siteLat = parseFloat(f.Latitude83 || "");
      const siteLng = parseFloat(f.Longitude83 || "");
      if (!Number.isFinite(siteLat) || !Number.isFinite(siteLng)) continue;
      const d = haversineDistanceMiles(lat, lng, siteLat, siteLng);
      if (d <= 1) within1Mile++;
      if (d <= 5) within5Miles++;
      if (!nearest || d < nearest.distanceMiles) {
        nearest = { name: f.FacilityName || "Superfund site", distanceMiles: d };
      }
    }

    let risk: RiskLevel = "low";
    if (within1Mile > 0) risk = "high";
    else if (within5Miles > 0) risk = "medium";

    return {
      status: "done",
      superfundSitesWithin1Mile: within1Mile,
      superfundSitesWithin5Miles: within5Miles,
      nearestHazardName: nearest?.name ?? null,
      nearestHazardDistanceMiles: nearest ? Math.round(nearest.distanceMiles * 10) / 10 : null,
      risk,
    };
  } catch {
    // Source unreachable — report the failure, never a clean result.
    return {
      status: "error",
      superfundSitesWithin1Mile: 0,
      superfundSitesWithin5Miles: 0,
      nearestHazardName: null,
      nearestHazardDistanceMiles: null,
      risk: "unknown",
    };
  }
}

// ============================================
// ROAD ACCESS CHECK
// Uses OpenStreetMap Overpass API (free)
// ============================================

async function checkRoadAccess(lat: number, lng: number): Promise<RoadAccessResult> {
  try {
    // Query for roads within 500m
    const radius = 500;
    const query = `[out:json][timeout:10];(way["highway"](around:${radius},${lat},${lng}););out body 5;`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);

    const resp = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`Overpass API ${resp.status}`);

    const data = await resp.json();
    const ways = data.elements || [];

    if (ways.length === 0) {
      return {
        status: "done",
        hasDirectRoadAccess: false,
        nearestRoadName: null,
        nearestRoadDistanceFeet: null,
        roadType: null,
        risk: "high",
        note: "No public roads found within 500m. Parcel may be landlocked — verify legal ingress/egress.",
      };
    }

    // Classify road type
    const roadHierarchy = ["motorway", "trunk", "primary", "secondary", "tertiary", "residential", "unclassified", "service", "track", "path"];
    const bestRoad = ways.sort((a: any, b: any) => {
      return roadHierarchy.indexOf(a.tags?.highway) - roadHierarchy.indexOf(b.tags?.highway);
    })[0];

    const roadType = bestRoad?.tags?.highway || "unknown";
    const roadName = bestRoad?.tags?.name || null;

    let risk: RiskLevel = "low";
    let note = "";

    if (["track", "path"].includes(roadType)) {
      risk = "medium";
      note = `Nearest road is a ${roadType} — not a maintained public road. Verify county road maintenance.`;
    } else if (["residential", "unclassified", "service"].includes(roadType)) {
      risk = "low";
      note = `${roadName || "Local road"} (${roadType}) within 500m — adequate access.`;
    } else if (["tertiary", "secondary", "primary"].includes(roadType)) {
      risk = "low";
      note = `Good access — ${roadName || roadType} road nearby.`;
    } else {
      risk = "low";
      note = `Road access confirmed.`;
    }

    return {
      status: "done",
      hasDirectRoadAccess: true,
      nearestRoadName: roadName,
      nearestRoadDistanceFeet: Math.round(500 * 3.281), // conservative max distance in feet
      roadType,
      risk,
      note,
    };
  } catch (err: any) {
    return {
      status: "error",
      hasDirectRoadAccess: false,
      nearestRoadName: null,
      nearestRoadDistanceFeet: null,
      roadType: null,
      risk: "unknown",
      note: `Road access check failed: ${err.message}`,
    };
  }
}

// ============================================
// USGS ELEVATION CHECK
// Uses USGS National Map Elevation Point Query Service (free)
// ============================================

async function queryElevationFeet(lat: number, lng: number): Promise<number | null> {
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${safeCoord(lng, "lng")}&y=${safeCoord(lat, "lat")}&wkid=4326&units=Feet&includeDate=false`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    if (!resp.ok) return null;
    const data = await resp.json();
    const v = data.value !== undefined && data.value !== null ? parseFloat(data.value) : NaN;
    return Number.isFinite(v) ? v : null;
  } catch {
    return null;
  }
}

/**
 * Real slope from 3DEP: sample the parcel center plus four points ~150 m
 * out (N/S/E/W) against the USGS Elevation Point Query Service (1 m DEM
 * under the hood) and take the steepest center-to-offset gradient.
 * Cross-parcel grade at 150 m spacing understates short micro-slopes but
 * honestly classifies buildability — which is what land buyers ask.
 * Falls back to "unknown" (never a guess) when fewer than two offsets
 * resolve.
 */
async function checkElevation(lat: number, lng: number): Promise<ElevationResult> {
  const SPACING_METERS = 150;
  const dLat = SPACING_METERS / 111_320; // meters → degrees latitude
  const dLng = SPACING_METERS / (111_320 * Math.max(0.2, Math.cos((lat * Math.PI) / 180)));

  const [center, north, south, east, west] = await Promise.all([
    queryElevationFeet(lat, lng),
    queryElevationFeet(lat + dLat, lng),
    queryElevationFeet(lat - dLat, lng),
    queryElevationFeet(lat, lng + dLng),
    queryElevationFeet(lat, lng - dLng),
  ]);

  if (center === null) {
    return { status: "error", elevationFeet: null, slope: "unknown", risk: "unknown" };
  }

  const runFeet = SPACING_METERS * 3.28084;
  const gradients = [north, south, east, west]
    .filter((v): v is number => v !== null)
    .map((v) => (Math.abs(v - center) / runFeet) * 100);

  let slope: string;
  let risk: RiskLevel;

  if (gradients.length >= 2) {
    const maxGradePercent = Math.max(...gradients);
    if (maxGradePercent < 3) {
      slope = "flat (<3%)";
      risk = "low";
    } else if (maxGradePercent < 8) {
      slope = "gentle (3-8%)";
      risk = "low";
    } else if (maxGradePercent < 15) {
      slope = "moderate (8-15%)";
      risk = "medium";
    } else {
      slope = "steep (>15%)";
      risk = "high";
    }
  } else {
    slope = "unknown";
    risk = "unknown";
  }

  // Extreme-elevation flags retain their old severity regardless of grade.
  if (center < 0) risk = "high";
  else if (center > 8000 && risk === "low") risk = "medium";

  return { status: "done", elevationFeet: Math.round(center), slope, risk };
}

// ============================================
// SOIL CHECK — USDA Web Soil Survey (free)
// ============================================

async function checkSoil(lat: number, lng: number): Promise<SoilResult> {
  try {
    const url = `https://SDMDataAccess.sc.egov.usda.gov/Tabular/SDMTabularService/post.rest`;
    const query = `SELECT TOP 1 mu.muname, mu.farmlndcl FROM mapunit AS mu INNER JOIN mupolygon AS mp ON mu.mukey = mp.mukey WHERE mp.mupolygonkey IN (SELECT mupolygonkey FROM mupolygon WHERE mupolygon.mukey IN (SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lng} ${lat})')))`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error("USDA API error");

    const data = await resp.json();
    const row = data?.Table?.[0];

    if (!row) {
      return { status: "done", dominantSoilName: null, farmlandClassification: null, drainage: null, risk: "low" };
    }

    const soilName = row[0] || null;
    const farmlandClass = row[1] || null;

    let risk: RiskLevel = "low";
    if (farmlandClass?.toLowerCase().includes("prime")) {
      risk = "low"; // Prime farmland = high value
    }

    return {
      status: "done",
      dominantSoilName: soilName,
      farmlandClassification: farmlandClass,
      drainage: null,
      risk,
    };
  } catch {
    return { status: "done", dominantSoilName: null, farmlandClassification: null, drainage: null, risk: "unknown" };
  }
}

// ============================================
// EPIC B1: NLCD LAND COVER CHECK
// MRLC WMS GetFeatureInfo (free, no key)
// ============================================

async function checkLandCover(lat: number, lng: number): Promise<LandCoverResult> {
  try {
    const bufferDeg = 0.01; // ~1km buffer
    const bbox = `${lng - bufferDeg},${lat - bufferDeg},${lng + bufferDeg},${lat + bufferDeg}`;
    const url = `https://www.mrlc.gov/geoserver/mrlc_display/NLCD_2021_Land_Cover_L48/wms?SERVICE=WMS&VERSION=1.1.1&REQUEST=GetFeatureInfo&FORMAT=image/png&TRANSPARENT=true&QUERY_LAYERS=NLCD_2021_Land_Cover_L48&LAYERS=NLCD_2021_Land_Cover_L48&INFO_FORMAT=application/json&FEATURE_COUNT=1&X=50&Y=50&SRS=EPSG:4326&WIDTH=101&HEIGHT=101&BBOX=${bbox}`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`NLCD WMS ${resp.status}`);
    const data = await resp.json();

    // NLCD land cover class values: 41-43 = forest, 81-82 = farmland, 90-95 = wetland, 21-24 = developed
    const features = data.features || [];
    const classValues: number[] = features.map((f: any) => Number(f.properties?.["NLCD_2021_Land_Cover_L48"] || f.properties?.value || 0));

    const total = classValues.length || 1;
    const forestPct = classValues.filter(v => v >= 41 && v <= 43).length / total * 100;
    const farmPct = classValues.filter(v => v >= 81 && v <= 82).length / total * 100;
    const wetlandPct = classValues.filter(v => v >= 90 && v <= 95).length / total * 100;
    const devPct = classValues.filter(v => v >= 21 && v <= 24).length / total * 100;
    const grassPct = classValues.filter(v => v >= 71 && v <= 74).length / total * 100;

    const dominant = [
      { name: "Forest", pct: forestPct },
      { name: "Farmland", pct: farmPct },
      { name: "Wetland", pct: wetlandPct },
      { name: "Developed", pct: devPct },
      { name: "Grassland", pct: grassPct },
    ].sort((a, b) => b.pct - a.pct)[0].name;

    return {
      status: "done",
      forestPercent: Math.round(forestPct),
      farmlandPercent: Math.round(farmPct),
      wetlandPercent: Math.round(wetlandPct),
      developedPercent: Math.round(devPct),
      grasslandPercent: Math.round(grassPct),
      dominantCover: dominant,
      recreationalPremium: forestPct > 60,
      developedEncroachment: devPct > 5,
      agriculturalValue: farmPct > 70,
    };
  } catch {
    // Return a neutral fallback on error
    return {
      status: "error",
      forestPercent: 0, farmlandPercent: 0, wetlandPercent: 0,
      developedPercent: 0, grasslandPercent: 0, dominantCover: "Unknown",
      recreationalPremium: false, developedEncroachment: false, agriculturalValue: false,
    };
  }
}

// ============================================
// EPIC B2: BLM PUBLIC LAND ADJACENCY
// BLM GIS REST API (free, no key)
// ============================================

async function checkBLMAdjacency(lat: number, lng: number, radiusMiles: number = 2): Promise<BLMAdjacencyResult> {
  try {
    const radiusMeters = radiusMiles * 1609;
    const url = `https://gis.blm.gov/arcgis/rest/services/lands_and_realty/BLM_Natl_SMA_Cached_21/MapServer/1/query?geometry=${lng},${lat}&geometryType=esriGeometryPoint&spatialRel=esriSpatialRelWithin&distance=${radiusMeters}&units=esriSRUnit_Meter&outFields=ADMIN_AGENCY_CODE,ORIG_NAME&returnGeometry=false&f=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`BLM GIS ${resp.status}`);
    const data = await resp.json();
    const features = data.features || [];

    if (features.length === 0) {
      return { status: "done", isAdjacentToPublicLand: false, nearestPublicLandName: null, nearestPublicLandDistanceMiles: null, agencyType: null, acreScoreBonus: 0 };
    }

    const first = features[0]?.attributes || {};
    const agency = first.ADMIN_AGENCY_CODE || "BLM";
    const name = first.ORIG_NAME || "Public Land";

    let agencyType: BLMAdjacencyResult["agencyType"] = "BLM";
    if (agency.includes("USFS") || agency.includes("FS")) agencyType = "USFS";
    else if (agency.includes("NPS")) agencyType = "NPS";
    else if (!agency.includes("BLM")) agencyType = "Other";

    return {
      status: "done",
      isAdjacentToPublicLand: true,
      nearestPublicLandName: name,
      nearestPublicLandDistanceMiles: 0, // within radius
      agencyType,
      acreScoreBonus: 150, // BLM/Forest adjacency = +150 AcreScore points
    };
  } catch {
    return { status: "error", isAdjacentToPublicLand: false, nearestPublicLandName: null, nearestPublicLandDistanceMiles: null, agencyType: null, acreScoreBonus: 0 };
  }
}

// ============================================
// EPIC B3: USFWS IPaC ENDANGERED SPECIES
// USFWS ServCAT API (free, no key)
// ============================================

async function checkEndangeredSpecies(lat: number, lng: number): Promise<EndangeredSpeciesResult> {
  try {
    const url = `https://ecos.fws.gov/ServCATServices/servcat/v4/rest/ByGeometry?geometry={"x":${lng},"y":${lat},"spatialReference":{"wkid":4326}}&geometryType=esriGeometryPoint&distance=1000&units=esriSRUnit_Meter&returnGeometry=false&f=json`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`USFWS IPaC ${resp.status}`);
    const data = await resp.json();
    const speciesList: string[] = (data.data || data.features || [])
      .map((s: any) => s.attributes?.commonName || s.commonName || s.name)
      .filter(Boolean);

    const hasListed = speciesList.length > 0;
    let riskLevel: EndangeredSpeciesResult["riskLevel"] = "none";
    if (speciesList.length > 5) riskLevel = "high";
    else if (speciesList.length > 2) riskLevel = "moderate";
    else if (speciesList.length > 0) riskLevel = "low";

    return { status: "done", speciesCount: speciesList.length, hasListedSpecies: hasListed, speciesNames: speciesList.slice(0, 10), riskLevel };
  } catch {
    return { status: "done", speciesCount: 0, hasListedSpecies: false, speciesNames: [], riskLevel: "none" };
  }
}

// ============================================
// EPIC B4: WILDFIRE RISK
// FEMA National Risk Index API (free, no key)
// ============================================

/**
 * FEMA NRI counties ArcGIS FeatureServer — point-in-polygon query.
 * The old `hazards.fema.gov/nri/api/county` endpoint is dead (redirects to
 * a fema.gov page, then 403s), which made this check silently return
 * "unknown" in production. This FeatureServer is the live NRI distribution
 * channel; verified 2026-07-13.
 */
const NRI_COUNTIES_QUERY_URL =
  "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/National_Risk_Index_Counties/FeatureServer/0/query";

async function queryNriCounty(lat: number, lng: number, outFields: string): Promise<Record<string, any> | null> {
  const url = `${NRI_COUNTIES_QUERY_URL}?geometry=${safeCoord(lng, "lng")},${safeCoord(lat, "lat")}&geometryType=esriGeometryPoint&inSR=4326&spatialRel=esriSpatialRelIntersects&outFields=${encodeURIComponent(outFields)}&returnGeometry=false&f=json`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);
  const resp = await fetch(url, { signal: controller.signal });
  clearTimeout(timeout);
  if (!resp.ok) throw new Error(`FEMA NRI ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(`FEMA NRI query error ${data.error.code ?? ""}`);
  return data?.features?.[0]?.attributes ?? null;
}

async function checkWildfireRisk(lat: number, lng: number, state: string): Promise<WildfireRiskResult> {
  try {
    const nriData = await queryNriCounty(lat, lng, "WFIR_RISKR,WFIR_RISKS");

    // WFIR_RISKR: Wildfire Risk Rating from FEMA NRI
    const riskRating = nriData?.WFIR_RISKR || "";
    const riskScore = Number(nriData?.WFIR_RISKS || 0);

    // NRI rating vocabulary: "Very Low" | "Relatively Low" |
    // "Relatively Moderate" | "Relatively High" | "Very High"
    // (plus "No Rating"/"Insufficient Data"). The old exact-match list
    // missed the "Relatively …" forms entirely.
    let wildfireRisk: WildfireRiskResult["wildfireRisk"] = "unknown";
    if (riskRating === "Very High") wildfireRisk = "very_high";
    else if (riskRating.includes("High")) wildfireRisk = "high";
    else if (riskRating.includes("Moderate") || riskRating.includes("Medium")) wildfireRisk = "moderate";
    else if (riskRating.includes("Low")) wildfireRisk = "low";

    const offerAdjustment = wildfireRisk === "very_high" ? -15 : wildfireRisk === "high" ? -8 : 0;

    return {
      status: "done",
      wildfireRisk,
      fireBehaviorClass: riskScore > 0 ? Math.min(5, Math.ceil(riskScore / 20)) : null,
      offerAdjustment,
    };
  } catch {
    return { status: "done", wildfireRisk: "unknown", fireBehaviorClass: null, offerAdjustment: 0 };
  }
}

// ============================================
// OPEN-DATA PHASE 1: FEMA NRI COMPOSITE RISK
// Same FeatureServer as wildfire; surfaces the full 18-hazard county
// profile (composite score/rating, expected annual loss, social
// vulnerability, community resilience, elevated hazards) instead of
// wildfire alone. Free, no key. See docs/company/open-data-program.md.
// ============================================

const NRI_HAZARD_FIELDS: Record<string, string> = {
  AVLN_RISKR: "Avalanche",
  CFLD_RISKR: "Coastal Flooding",
  CWAV_RISKR: "Cold Wave",
  DRGT_RISKR: "Drought",
  ERQK_RISKR: "Earthquake",
  HAIL_RISKR: "Hail",
  HWAV_RISKR: "Heat Wave",
  HRCN_RISKR: "Hurricane",
  ISTM_RISKR: "Ice Storm",
  LNDS_RISKR: "Landslide",
  LTNG_RISKR: "Lightning",
  RFLD_RISKR: "Riverine Flooding",
  SWND_RISKR: "Strong Wind",
  TRND_RISKR: "Tornado",
  TSUN_RISKR: "Tsunami",
  VLCN_RISKR: "Volcanic Activity",
  WFIR_RISKR: "Wildfire",
  WNTW_RISKR: "Winter Weather",
};

export async function checkNationalRisk(lat: number, lng: number): Promise<NationalRiskIndexResult> {
  try {
    const fields = [
      "COUNTY",
      "STATE",
      "RISK_SCORE",
      "RISK_RATNG",
      "EAL_RATNG",
      "SOVI_RATNG",
      "RESL_RATNG",
      ...Object.keys(NRI_HAZARD_FIELDS),
    ].join(",");

    const attrs = await queryNriCounty(lat, lng, fields);
    if (!attrs) {
      // Point outside NRI coverage (e.g. territories) — no data is not an error.
      return {
        status: "done",
        county: null,
        state: null,
        compositeScore: null,
        compositeRating: null,
        expectedAnnualLossRating: null,
        socialVulnerabilityRating: null,
        communityResilienceRating: null,
        elevatedHazards: [],
        risk: "unknown",
      };
    }

    const compositeRating: string = attrs.RISK_RATNG || "";
    const elevatedHazards = Object.entries(NRI_HAZARD_FIELDS)
      .filter(([field]) => {
        const r: string = attrs[field] || "";
        return r === "Very High" || r === "Relatively High";
      })
      .map(([, label]) => label);

    let risk: RiskLevel = "unknown";
    if (compositeRating === "Very High") risk = "critical";
    else if (compositeRating.includes("High")) risk = "high";
    else if (compositeRating.includes("Moderate")) risk = "medium";
    else if (compositeRating.includes("Low")) risk = "low";

    return {
      status: "done",
      county: attrs.COUNTY || null,
      state: attrs.STATE || null,
      compositeScore: Number.isFinite(Number(attrs.RISK_SCORE)) ? Math.round(Number(attrs.RISK_SCORE) * 10) / 10 : null,
      compositeRating: compositeRating || null,
      expectedAnnualLossRating: attrs.EAL_RATNG || null,
      socialVulnerabilityRating: attrs.SOVI_RATNG || null,
      communityResilienceRating: attrs.RESL_RATNG || null,
      elevatedHazards,
      risk,
    };
  } catch {
    return {
      status: "error",
      county: null,
      state: null,
      compositeScore: null,
      compositeRating: null,
      expectedAnnualLossRating: null,
      socialVulnerabilityRating: null,
      communityResilienceRating: null,
      elevatedHazards: [],
      risk: "unknown",
    };
  }
}

// ============================================
// EPIC D: SSURGO SOIL DATA ACCESS
// USDA Soil Data Access T-SQL REST endpoint (free)
// ============================================

export async function checkSoilSSURGO(lat: number, lng: number): Promise<SoilSSURGOResult> {
  try {
    const url = "https://sdmdataaccess.nrcs.usda.gov/tabular/post.rest";
    const query = `SELECT TOP 1 mu.muname, mu.farmlndcl, c.drainagecl,
      (SELECT AVG(ch.phdata) FROM chorizon AS ch WHERE ch.cokey = co.cokey) as ph,
      co.hydricrating,
      (SELECT AVG(coi.nccpi3all) FROM cointerp AS coi WHERE coi.cokey = co.cokey AND coi.mrulename = 'NCCPI-National Commodity Crop Productivity Index (Ver 3.0)') as nccpi
      FROM mapunit AS mu
      INNER JOIN component AS co ON mu.mukey = co.mukey AND co.majcompflag = 'Yes'
      LEFT JOIN chorizon AS c_top ON c_top.cokey = co.cokey AND c_top.hzdept_r = 0
      LEFT JOIN chorizon AS c ON c.cokey = co.cokey
      WHERE mu.mukey IN (
        SELECT mukey FROM SDA_Get_Mukey_from_intersection_with_WktWgs84('point(${lng} ${lat})')
      )`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const resp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query }),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error("SSURGO SDA error");
    const data = await resp.json();
    const row = data?.Table?.[0];

    if (!row) {
      return { status: "done", dominantSoilName: null, farmlandClassification: null, drainage: null, hydricPercent: 0, nccpiScore: null, risk: "low", acreScoreImpact: 0 };
    }

    const soilName = row[0] || null;
    const farmlandClass = row[1] || null;
    const drainage = row[2] || null;
    const hydricRating = (row[4] || "").toLowerCase();
    const nccpi = row[5] ? parseFloat(row[5]) : null;

    const hydricPercent = hydricRating === "yes" ? 80 : hydricRating === "partial" ? 40 : hydricRating === "no" ? 0 : 10;

    let risk: RiskLevel = "low";
    let acreScoreImpact = 0;

    if (hydricPercent > 50) {
      risk = "high";
      acreScoreImpact = -100; // Wetland risk
    } else if (nccpi !== null && nccpi > 0.6) {
      risk = "low";
      acreScoreImpact = 100; // Prime agricultural
    } else if (farmlandClass?.toLowerCase().includes("prime")) {
      acreScoreImpact = 75;
    }

    return {
      status: "done",
      dominantSoilName: soilName,
      farmlandClassification: farmlandClass,
      drainage,
      hydricPercent,
      nccpiScore: nccpi,
      risk,
      acreScoreImpact,
    };
  } catch {
    return { status: "done", dominantSoilName: null, farmlandClassification: null, drainage: null, hydricPercent: 0, nccpiScore: null, risk: "unknown", acreScoreImpact: 0 };
  }
}

// ============================================
// SCORING ENGINE
// ============================================

function scoreChecks(checks: AutoDDReport["checks"]): { score: number; risk: RiskLevel; redFlags: string[]; greenFlags: string[]; offerAdjustment: number } {
  let score = 100;
  const redFlags: string[] = [];
  const greenFlags: string[] = [];
  let offerAdjustment = 0;

  // Flood zone (max -40 points)
  if (checks.floodZone.risk === "critical") {
    score -= 40; offerAdjustment -= 30;
    redFlags.push(`Critical flood risk — Zone ${checks.floodZone.zone}: ${checks.floodZone.zoneDescription}`);
  } else if (checks.floodZone.risk === "high") {
    score -= 25; offerAdjustment -= 15;
    redFlags.push(`High flood risk — Zone ${checks.floodZone.zone}: mandatory flood insurance`);
  } else if (checks.floodZone.risk === "medium") {
    score -= 10; offerAdjustment -= 5;
  } else if (checks.floodZone.zone) {
    greenFlags.push(`Low flood risk — Zone ${checks.floodZone.zone}`);
  }

  // Wetlands (max -35 points)
  if (checks.wetlands.risk === "critical") {
    score -= 35; offerAdjustment -= 30;
    redFlags.push(`${checks.wetlands.wetlandPercent.toFixed(0)}% wetlands — major development restrictions`);
  } else if (checks.wetlands.risk === "high") {
    score -= 20; offerAdjustment -= 15;
    redFlags.push(`${checks.wetlands.wetlandPercent.toFixed(0)}% wetlands — significant restrictions`);
  } else if (checks.wetlands.risk === "medium") {
    score -= 8; offerAdjustment -= 5;
    redFlags.push(`Minor wetlands presence — ${checks.wetlands.wetlandAcres.toFixed(1)} acres`);
  } else {
    greenFlags.push("No wetlands detected");
  }

  // Environmental (max -20 points)
  if (checks.environmental.risk === "high") {
    score -= 20; offerAdjustment -= 15;
    redFlags.push(`Environmental hazard within 1 mile: ${checks.environmental.nearestHazardName}`);
  } else if (checks.environmental.risk === "medium") {
    score -= 8; offerAdjustment -= 5;
  } else if (checks.environmental.status === "done" && checks.environmental.risk === "low") {
    // Only claim a clean result when the sources actually answered.
    greenFlags.push("No environmental hazards nearby");
  }

  // Road access (max -20 points)
  if (checks.roadAccess.risk === "high") {
    score -= 20; offerAdjustment -= 20;
    redFlags.push("No public road access within 500m — possible landlocked parcel");
  } else if (checks.roadAccess.risk === "medium") {
    score -= 8; offerAdjustment -= 5;
    redFlags.push(checks.roadAccess.note);
  } else if (checks.roadAccess.hasDirectRoadAccess) {
    greenFlags.push(`Road access confirmed: ${checks.roadAccess.nearestRoadName || checks.roadAccess.roadType}`);
  }

  // Soil (informational, small adjustment)
  if (checks.soil.farmlandClassification?.toLowerCase().includes("prime")) {
    greenFlags.push(`Prime farmland soil: ${checks.soil.dominantSoilName}`);
    score += 5; offerAdjustment += 5;
  }

  score = Math.max(0, Math.min(100, score));
  offerAdjustment = Math.max(-60, Math.min(20, offerAdjustment));

  let risk: RiskLevel = "low";
  if (score < 40) risk = "critical";
  else if (score < 60) risk = "high";
  else if (score < 75) risk = "medium";

  return { score, risk, redFlags, greenFlags, offerAdjustment };
}

function buildAiSummary(report: Partial<AutoDDReport>): string {
  const { checks, overallScore, redFlags, greenFlags } = report;
  if (!checks) return "";

  const parts: string[] = [];

  if (overallScore && overallScore >= 80) {
    parts.push(`This parcel scores ${overallScore}/100 — strong fundamentals with minimal risk factors.`);
  } else if (overallScore && overallScore >= 60) {
    parts.push(`This parcel scores ${overallScore}/100 — acceptable risk profile with some concerns to factor into pricing.`);
  } else {
    parts.push(`This parcel scores ${overallScore}/100 — significant risk factors that should be reflected in the offer price.`);
  }

  if (redFlags && redFlags.length > 0) {
    parts.push(`Key risks: ${redFlags.join("; ")}.`);
  }
  if (greenFlags && greenFlags.length > 0) {
    parts.push(`Positives: ${greenFlags.join("; ")}.`);
  }

  if (report.recommendedOfferAdjustment && report.recommendedOfferAdjustment < 0) {
    parts.push(`Recommend reducing your standard offer by ${Math.abs(report.recommendedOfferAdjustment)}% to account for identified risks.`);
  } else if (report.recommendedOfferAdjustment && report.recommendedOfferAdjustment > 0) {
    parts.push(`Strong property characteristics support a ${report.recommendedOfferAdjustment}% premium on your standard offer.`);
  }

  return parts.join(" ");
}

// ============================================
// MAIN ORCHESTRATOR
// ============================================

export async function runAutoDueDiligence(
  propertyId: number,
  orgId: number,
  lat: number,
  lng: number,
  acreage?: number,
  state?: string
): Promise<AutoDDReport> {
  // Run all checks in parallel (core + Epic B/D additions)
  const [floodZone, wetlands, environmental, roadAccess, soil, elevation,
         landCover, blmAdjacency, endangeredSpecies, wildfireRisk, soilSSURGO, nationalRisk] = await Promise.allSettled([
    checkFloodZone(lat, lng),
    checkWetlands(lat, lng, acreage || null),
    checkEnvironmental(lat, lng),
    checkRoadAccess(lat, lng),
    checkSoil(lat, lng),
    checkElevation(lat, lng),
    // Epic B additions
    checkLandCover(lat, lng),
    checkBLMAdjacency(lat, lng, 2),
    checkEndangeredSpecies(lat, lng),
    checkWildfireRisk(lat, lng, state || ""),
    // Epic D: SSURGO replaces basic soil survey
    checkSoilSSURGO(lat, lng),
    // Open-Data Phase 1: FEMA NRI 18-hazard composite
    checkNationalRisk(lat, lng),
  ]);

  const resolve = <T>(r: PromiseSettledResult<T>, fallback: T): T =>
    r.status === "fulfilled" ? r.value : fallback;

  const checks = {
    floodZone: resolve(floodZone, { status: "error" as const, zone: null, zoneDescription: null, risk: "unknown" as RiskLevel, inFloodplain: false, floodInsuranceRequired: false }),
    wetlands: resolve(wetlands, { status: "error" as const, hasWetlands: false, wetlandAcres: 0, wetlandPercent: 0, wetlandTypes: [], risk: "unknown" as RiskLevel, developmentImpact: "Check failed" }),
    environmental: resolve(environmental, { status: "error" as const, superfundSitesWithin1Mile: 0, superfundSitesWithin5Miles: 0, nearestHazardName: null, nearestHazardDistanceMiles: null, risk: "unknown" as RiskLevel }),
    roadAccess: resolve(roadAccess, { status: "error" as const, hasDirectRoadAccess: false, nearestRoadName: null, nearestRoadDistanceFeet: null, roadType: null, risk: "unknown" as RiskLevel, note: "Check failed" }),
    soil: resolve(soil, { status: "error" as const, dominantSoilName: null, farmlandClassification: null, drainage: null, risk: "unknown" as RiskLevel }),
    elevation: resolve(elevation, { status: "error" as const, elevationFeet: null, slope: null, risk: "unknown" as RiskLevel }),
    landCover: resolve(landCover, { status: "error" as const, forestPercent: 0, farmlandPercent: 0, wetlandPercent: 0, developedPercent: 0, grasslandPercent: 0, dominantCover: "Unknown", recreationalPremium: false, developedEncroachment: false, agriculturalValue: false }),
    blmAdjacency: resolve(blmAdjacency, { status: "error" as const, isAdjacentToPublicLand: false, nearestPublicLandName: null, nearestPublicLandDistanceMiles: null, agencyType: null, acreScoreBonus: 0 }),
    endangeredSpecies: resolve(endangeredSpecies, { status: "error" as const, speciesCount: 0, hasListedSpecies: false, speciesNames: [], riskLevel: "none" as const }),
    wildfireRisk: resolve(wildfireRisk, { status: "error" as const, wildfireRisk: "unknown" as const, fireBehaviorClass: null, offerAdjustment: 0 }),
    soilSSURGO: resolve(soilSSURGO, { status: "error" as const, dominantSoilName: null, farmlandClassification: null, drainage: null, hydricPercent: 0, nccpiScore: null, risk: "unknown" as RiskLevel, acreScoreImpact: 0 }),
    nationalRisk: resolve(nationalRisk, { status: "error" as const, county: null, state: null, compositeScore: null, compositeRating: null, expectedAnnualLossRating: null, socialVulnerabilityRating: null, communityResilienceRating: null, elevatedHazards: [], risk: "unknown" as RiskLevel }),
  };
  const { score, risk, redFlags, greenFlags, offerAdjustment } = scoreChecks(checks);

  // Epic B/D: additional red/green flags
  if (checks.endangeredSpecies?.hasListedSpecies) {
    redFlags.push(`Endangered species detected (${checks.endangeredSpecies.speciesCount}): ${checks.endangeredSpecies.speciesNames.slice(0, 3).join(", ")} — development severely limited`);
  }
  if (checks.wildfireRisk?.wildfireRisk === "very_high") {
    redFlags.push("Very high wildfire hazard potential — -15% offer adjustment applied");
  } else if (checks.wildfireRisk?.wildfireRisk === "high") {
    redFlags.push("High wildfire hazard potential — verify insurance availability");
  }
  if (checks.blmAdjacency?.isAdjacentToPublicLand) {
    greenFlags.push(`Adjacent to ${checks.blmAdjacency.agencyType || "public"} land (${checks.blmAdjacency.nearestPublicLandName}) — recreational premium +150 AcreScore pts`);
  }
  if (checks.landCover?.recreationalPremium) {
    greenFlags.push(`Forest-dominant parcel (${checks.landCover.forestPercent}% forest) — recreational premium signal`);
  }
  if (checks.soilSSURGO?.nccpiScore && checks.soilSSURGO.nccpiScore > 0.6) {
    greenFlags.push(`Prime agricultural soil — NCCPI score ${checks.soilSSURGO.nccpiScore.toFixed(2)} (>0.6 = prime productivity)`);
  }
  if (checks.soilSSURGO?.hydricPercent && checks.soilSSURGO.hydricPercent > 50) {
    redFlags.push(`High hydric soil content (${checks.soilSSURGO.hydricPercent}%) — wetland risk, development limited`);
  }
  if (checks.nationalRisk?.status === "done" && checks.nationalRisk.compositeRating) {
    const nri = checks.nationalRisk;
    if (nri.risk === "critical" || nri.risk === "high") {
      const hazards = nri.elevatedHazards.length ? ` (elevated: ${nri.elevatedHazards.slice(0, 4).join(", ")})` : "";
      redFlags.push(`FEMA National Risk Index rates ${nri.county} County "${nri.compositeRating}" for natural hazards${hazards}`);
    } else if (nri.risk === "low" && nri.elevatedHazards.length === 0) {
      greenFlags.push(`FEMA National Risk Index rates ${nri.county} County "${nri.compositeRating}" — no elevated natural hazards`);
    } else if (nri.elevatedHazards.length > 0) {
      redFlags.push(`Elevated natural-hazard exposure per FEMA NRI: ${nri.elevatedHazards.slice(0, 4).join(", ")}`);
    }
  }

  const additionalOfferAdj = (checks.wildfireRisk?.offerAdjustment || 0);
  const finalOfferAdjustment = Math.max(-60, Math.min(20, offerAdjustment + additionalOfferAdj));

  const passedChecks = [
    checks.floodZone.risk === "low",
    checks.wetlands.risk === "low",
    checks.environmental.risk === "low",
    checks.roadAccess.risk === "low",
    !checks.endangeredSpecies?.hasListedSpecies,
  ].filter(Boolean).length;

  const partial: Partial<AutoDDReport> = {
    propertyId,
    lat,
    lng,
    acreage: acreage || null,
    runAt: new Date().toISOString(),
    overallScore: score,
    overallRisk: risk,
    passedChecks,
    totalChecks: 5,
    checks,
    redFlags,
    greenFlags,
    recommendedOfferAdjustment: finalOfferAdjustment,
  };

  const aiSummary = buildAiSummary(partial);

  return { ...partial, aiSummary } as AutoDDReport;
}

// ============================================
// UTILITY
// ============================================

function haversineDistanceMiles(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3958.8; // Earth radius in miles
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
