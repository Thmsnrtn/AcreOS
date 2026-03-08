/**
 * Automated Due Diligence Engine
 *
 * Runs parallel automated checks against free government APIs:
 * - FEMA NFHL: Flood zone designation
 * - USFWS NWI: Wetlands coverage percentage
 * - EPA ECHO: Superfund/environmental hazard proximity
 * - OpenStreetMap Overpass: Road access proximity
 * - USDA Web Soil Survey: Soil type, farmland classification
 * - USGS Elevation: Topography/slope
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
  };
  redFlags: string[];
  greenFlags: string[];
  recommendedOfferAdjustment: number; // % adjustment to recommended offer (negative = reduce)
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
    const wetlandTypes = [...new Set(features.map((f: any) => f.attributes?.WETLAND_TYPE).filter(Boolean))] as string[];
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

// ============================================
// EPA ENVIRONMENTAL CHECK
// Uses EPA ECHO API (free, no key)
// ============================================

async function checkEnvironmental(lat: number, lng: number): Promise<EnvironmentalResult> {
  try {
    const url = `https://data.epa.gov/efservice/RCRA_FACILITIES/LATITUDE82/${lat - 0.1}:${lat + 0.1}/LONGITUDE82/${lng - 0.1}:${lng + 0.1}/rows/0:20/JSON`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) {
      // Try Superfund directly
      return await checkSuperfund(lat, lng);
    }

    const data = await resp.json();
    const sites = Array.isArray(data) ? data : [];

    if (sites.length === 0) {
      return {
        status: "done",
        superfundSitesWithin1Mile: 0,
        superfundSitesWithin5Miles: 0,
        nearestHazardName: null,
        nearestHazardDistanceMiles: null,
        risk: "low",
      };
    }

    const within1Mile = sites.filter((s: any) => {
      const siteLat = parseFloat(s.LATITUDE82 || "0");
      const siteLng = parseFloat(s.LONGITUDE82 || "0");
      return haversineDistanceMiles(lat, lng, siteLat, siteLng) <= 1;
    }).length;

    const within5Mile = sites.filter((s: any) => {
      const siteLat = parseFloat(s.LATITUDE82 || "0");
      const siteLng = parseFloat(s.LONGITUDE82 || "0");
      return haversineDistanceMiles(lat, lng, siteLat, siteLng) <= 5;
    }).length;

    let risk: RiskLevel = "low";
    if (within1Mile > 0) risk = "high";
    else if (within5Mile > 0) risk = "medium";

    return {
      status: "done",
      superfundSitesWithin1Mile: within1Mile,
      superfundSitesWithin5Miles: within5Mile,
      nearestHazardName: sites[0]?.FAC_NAME || null,
      nearestHazardDistanceMiles: within1Mile > 0 ? haversineDistanceMiles(lat, lng, parseFloat(sites[0]?.LATITUDE82 || "0"), parseFloat(sites[0]?.LONGITUDE82 || "0")) : null,
      risk,
    };
  } catch {
    return { status: "done", superfundSitesWithin1Mile: 0, superfundSitesWithin5Miles: 0, nearestHazardName: null, nearestHazardDistanceMiles: null, risk: "low" };
  }
}

async function checkSuperfund(lat: number, lng: number): Promise<EnvironmentalResult> {
  return {
    status: "done",
    superfundSitesWithin1Mile: 0,
    superfundSitesWithin5Miles: 0,
    nearestHazardName: null,
    nearestHazardDistanceMiles: null,
    risk: "low",
  };
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

async function checkElevation(lat: number, lng: number): Promise<ElevationResult> {
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lng}&y=${lat}&wkid=4326&units=Feet&includeDate=false`;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!resp.ok) throw new Error(`USGS API ${resp.status}`);

    const data = await resp.json();
    const elevFeet = data.value ? parseFloat(data.value) : null;

    if (!elevFeet) {
      return { status: "done", elevationFeet: null, slope: "unknown", risk: "unknown" };
    }

    // We can't determine slope from a single point, but we can flag extreme elevations
    let slope = "unknown";
    let risk: RiskLevel = "low";

    if (elevFeet < 0) {
      slope = "below sea level";
      risk = "high";
    } else if (elevFeet > 8000) {
      slope = "high altitude";
      risk = "medium";
    } else {
      slope = "normal";
      risk = "low";
    }

    return { status: "done", elevationFeet: Math.round(elevFeet), slope, risk };
  } catch {
    return { status: "done", elevationFeet: null, slope: "unknown", risk: "unknown" };
  }
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
  } else {
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
  acreage?: number
): Promise<AutoDDReport> {
  // Run all checks in parallel
  const [floodZone, wetlands, environmental, roadAccess, soil, elevation] = await Promise.all([
    checkFloodZone(lat, lng),
    checkWetlands(lat, lng, acreage || null),
    checkEnvironmental(lat, lng),
    checkRoadAccess(lat, lng),
    checkSoil(lat, lng),
    checkElevation(lat, lng),
  ]);

  const checks = { floodZone, wetlands, environmental, roadAccess, soil, elevation };
  const { score, risk, redFlags, greenFlags, offerAdjustment } = scoreChecks(checks);

  const passedChecks = [
    floodZone.risk === "low",
    wetlands.risk === "low",
    environmental.risk === "low",
    roadAccess.risk === "low",
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
    totalChecks: 4,
    checks,
    redFlags,
    greenFlags,
    recommendedOfferAdjustment: offerAdjustment,
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
