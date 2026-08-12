/**
 * Comparable Properties (Comps) Analysis Service
 * Uses Regrid API to find nearby parcels and calculate market value estimates
 */

import { storage } from '../storage';
import { readIntegrationCredentials } from './integrationCredentials';
import { logger } from "../utils/logger";

async function logRegridApiUsage(
  orgId: number | undefined,
  action: string,
  metadata?: Record<string, any>
) {
  try {
    await storage.logApiUsage({
      organizationId: orgId || null,
      service: 'regrid',
      action,
      count: 1,
      estimatedCostCents: 2, // ~$0.02 per call
      metadata,
    });
  } catch (error) {
    logger.error('[CompsService] Failed to log API usage', error);
  }
}

interface RegridParcel {
  type: "Feature";
  geometry: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  };
  properties: {
    ll_uuid: string;
    parcelnumb: string;
    owner: string;
    saddno?: string;
    saddpref?: string;
    saddstr?: string;
    saddsttyp?: string;
    scity?: string;
    szip?: string;
    state2?: string;
    county?: string;
    ll_gisacre?: number;
    ll_stable_id?: string;
    lat?: number;
    lon?: number;
    saession?: string;
    saleamt?: string;
    saession2?: string;
    saledt?: string;
    saledt2?: string;
    saleval?: string;
    landval?: string;
    improvval?: string;
    taxamt?: string;
    usedesc?: string;
    zoning?: string;
    zoning_description?: string;
    [key: string]: unknown;
  };
}

interface RegridResponse {
  results: RegridParcel[];
}

export interface ComparableProperty {
  id: string;
  apn: string;
  address: string;
  city: string;
  state: string;
  county: string;
  acreage: number;
  saleDate: string | null;
  salePrice: number | null;
  pricePerAcre: number | null;
  assessedValue: number | null;
  landValue: number | null;
  propertyType: string;
  zoning: string;
  distance: number;
  coordinates: {
    lat: number;
    lng: number;
  };
  // ── Residential (house) comp fields — wave V3, founder ruling #11 ──
  // Present only on comps served by the residential seam (ATTOM). House
  // comps are valued per sale / per sqft, never per acre: the seam sets
  // pricePerAcre to null on them, which keeps every land $/acre model
  // (calculateMarketValue, the price/disposition optimizers) structurally
  // inert on house data.
  sqft?: number | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
}

export interface CompsFilters {
  minAcreage?: number;
  maxAcreage?: number;
  propertyType?: string;
  minSaleDate?: string;
  maxSaleDate?: string;
  maxResults?: number;
}

export interface OfferPrices {
  conservative: { min: number; max: number; label: string };
  standard: { min: number; max: number; label: string };
  aggressive: { min: number; max: number; label: string };
  estimatedMarketValue: number;
}

export interface DesirabilityScoreFactor {
  name: string;
  score: number;
  maxScore: number;
  description: string;
}

export interface DesirabilityScore {
  totalScore: number;
  grade: "A" | "B" | "C" | "D" | "F";
  factors: DesirabilityScoreFactor[];
}

export interface PropertyAttributes {
  roadAccess?: string | null;
  utilities?: { electric?: boolean; water?: boolean; sewer?: boolean; gas?: boolean } | null;
  terrain?: string | null;
  zoning?: string | null;
  sizeAcres?: number | null;
  city?: string | null;
}

export interface CompsSearchResult {
  success: boolean;
  comps: ComparableProperty[];
  marketAnalysis?: {
    averagePricePerAcre: number;
    medianPricePerAcre: number;
    highPricePerAcre: number;
    lowPricePerAcre: number;
    sampleSize: number;
    estimatedValue: number | null;
    subjectAcreage: number | null;
  };
  offerPrices?: OfferPrices;
  desirabilityScore?: DesirabilityScore;
  error?: string;
  limitedData?: boolean;
  message?: string;
  credentialSource?: 'organization' | 'platform';
  /**
   * True when this result came from the RESIDENTIAL seam (ATTOM house
   * comps) rather than the land-parcel path. Consumers must not run land
   * math (price-per-acre market analysis, land desirability scoring) on a
   * residential result — getPropertyComps already skips both.
   */
  residential?: boolean;
}

interface RegridCredentials {
  apiKey: string;
  source: 'organization' | 'platform';
}

const compsCache = new Map<string, { data: CompsSearchResult; timestamp: number }>();
const CACHE_TTL = 1000 * 60 * 60;

async function getRegridCredentials(orgId?: number): Promise<RegridCredentials | null> {
  if (orgId) {
    try {
      const integration = await storage.getOrganizationIntegration(orgId, 'regrid');
      
      const decrypted = readIntegrationCredentials<{ apiKey?: string }>(
        integration,
        orgId,
        'regrid (comps)',
      );
      if (integration && integration.isEnabled && decrypted) {
        if (decrypted.apiKey) {
          logger.info(`[CompsService] Using organization Regrid credentials for org ${orgId}`);
          return {
            apiKey: decrypted.apiKey,
            source: 'organization',
          };
        }
      }
    } catch (error) {
      logger.error(`[CompsService] Failed to get org Regrid credentials for org ${orgId}`, error);
    }
  }
  
  const platformKey = process.env.REGRID_API_KEY;
  if (platformKey) {
    logger.info(`[CompsService] Using platform Regrid credentials${orgId ? ` for org ${orgId}` : ''}`);
    return {
      apiKey: platformKey,
      source: 'platform',
    };
  }
  
  return null;
}

function formatAddress(props: RegridParcel["properties"]): string {
  const parts = [
    props.saddno,
    props.saddpref,
    props.saddstr,
    props.saddsttyp,
  ].filter(Boolean).join(" ");
  
  return parts || "Unknown Address";
}

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 3959;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

function parseSalePrice(props: RegridParcel["properties"]): number | null {
  const saleAmt = props.saleamt || props.saleval;
  if (!saleAmt) return null;
  
  const cleaned = String(saleAmt).replace(/[^0-9.]/g, "");
  const parsed = parseFloat(cleaned);
  
  return isNaN(parsed) || parsed <= 0 ? null : parsed;
}

function parseSaleDate(props: RegridParcel["properties"]): string | null {
  const dateStr = props.saledt || props.saledt2;
  if (!dateStr) return null;
  
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) return null;
  
  return date.toISOString().split("T")[0];
}

function getCacheKey(lat: number, lng: number, radius: number, filters: CompsFilters): string {
  return `${lat.toFixed(4)}_${lng.toFixed(4)}_${radius}_${JSON.stringify(filters)}`;
}

// ─── Residential fork (wave V3, founder ruling #11) ─────────────────────────
//
// The 2026-07-11 fix_and_flip demotion root cause: every consumer of this
// module (property comps endpoints, due diligence, Pax tools, agent skills,
// the offer/price/disposition engines) got LAND parcel comps regardless of
// the org's vertical, because the investorType fork maps the residential
// businessTypes to "land". The fork below routes RESIDENTIAL orgs through
// the residential seam (server/services/residentialComps.ts → provider
// registry → ATTOM) BEFORE any Regrid/land code runs — including before the
// shared compsCache, which is keyed by coordinates only and must never serve
// a land result to a flip org (or vice versa).
//
// Honest degradation: no ATTOM key (platform or BYOK) → an explicit
// unavailable error, never a land comp under a house label.

async function getResidentialSearchResult(
  lat: number,
  lng: number,
  filters: CompsFilters,
  orgId: number,
): Promise<CompsSearchResult> {
  const { getResidentialComps, extractResidentialComps } = await import("./residentialComps");
  const outcome = await getResidentialComps(orgId, { kind: "coordinates", latitude: lat, longitude: lng });

  if (outcome.status === "unavailable") {
    return {
      success: false,
      comps: [],
      error: outcome.message,
      limitedData: true,
      residential: true,
    };
  }

  if (outcome.status === "no_data") {
    return {
      success: true,
      comps: [],
      limitedData: true,
      message: outcome.message,
      residential: true,
    };
  }

  const parsed = extractResidentialComps(outcome.result.data);

  let comps: ComparableProperty[] = parsed.map((c, i) => ({
    id: `attom-comp-${i + 1}`,
    apn: "",
    address: c.address ?? "Unknown Address",
    city: c.city ?? "",
    state: c.state ?? "",
    county: "",
    acreage: c.lotAcres ?? 0,
    saleDate: c.saleDate,
    salePrice: c.salePrice,
    // House comps are never priced per acre — null keeps land $/acre math
    // structurally inert on residential results (see ComparableProperty).
    pricePerAcre: null,
    assessedValue: null,
    landValue: null,
    propertyType: c.propertyType ?? "Residential",
    zoning: "",
    distance: c.distanceMiles ?? 0,
    coordinates: {
      lat: c.latitude ?? lat,
      lng: c.longitude ?? lng,
    },
    sqft: c.sqft,
    bedrooms: c.bedrooms,
    bathrooms: c.bathrooms,
  }));

  // Sale-date recency filters translate directly; the acreage filters are
  // land semantics and deliberately do not apply to house comps.
  if (filters.minSaleDate) {
    const minDate = new Date(filters.minSaleDate);
    comps = comps.filter((c) => c.saleDate != null && new Date(c.saleDate) >= minDate);
  }
  if (filters.maxSaleDate) {
    const maxDate = new Date(filters.maxSaleDate);
    comps = comps.filter((c) => c.saleDate != null && new Date(c.saleDate) <= maxDate);
  }
  if (filters.maxResults && comps.length > filters.maxResults) {
    comps = comps.slice(0, filters.maxResults);
  }
  comps.sort((a, b) => a.distance - b.distance);

  const pricedCount = comps.filter((c) => c.salePrice && c.salePrice > 0).length;
  return {
    success: true,
    comps,
    limitedData: pricedCount < 3,
    message:
      comps.length > 0
        ? "Residential comps: ATTOM Data (house sales — valued per sale, not per acre)."
        : "ATTOM returned no residential comparables for this property.",
    credentialSource: outcome.byok ? "organization" : "platform",
    residential: true,
  };
}

/**
 * Get comparable properties within a radius
 */
export async function getComparableProperties(
  lat: number,
  lng: number,
  radiusMiles: number = 5,
  filters: CompsFilters = {},
  orgId?: number
): Promise<CompsSearchResult> {
  // Residential verticals never touch the land path (see fork note above).
  if (orgId) {
    const { getOrgBusinessType } = await import("./residentialComps");
    const { isResidentialBusinessType } = await import("@shared/models/persona-mapping");
    const businessType = await getOrgBusinessType(orgId);
    if (isResidentialBusinessType(businessType)) {
      return getResidentialSearchResult(lat, lng, filters, orgId);
    }
  }

  const credentials = await getRegridCredentials(orgId);
  
  if (!credentials) {
    return {
      success: false,
      comps: [],
      error: "Regrid API key not configured. Please add REGRID_API_KEY to secrets or configure your own in Integrations settings.",
    };
  }
  
  const { apiKey: token, source } = credentials;

  const cacheKey = getCacheKey(lat, lng, radiusMiles, filters);
  const cached = compsCache.get(cacheKey);
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    return { ...cached.data, credentialSource: source };
  }

  try {
    const radiusMeters = radiusMiles * 1609.34;
    // Tier 1E credential hygiene: the API key travels in the Authorization
    // header (Regrid supports Bearer auth — same scheme as
    // regrid-provider.ts), never in the URL where it would leak into logs,
    // caches, and proxy access lines.
    const url = `https://app.regrid.com/api/v2/parcels/radius?lat=${lat}&lon=${lng}&radius=${Math.min(radiusMeters, 8046)}&return_geometry=false&limit=${filters.maxResults || 50}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    
    if (!response.ok) {
      if (response.status === 404) {
        return {
          success: true,
          comps: [],
          limitedData: true,
          message: "No comparable properties found in this area.",
          credentialSource: source,
        };
      }
      if (response.status === 403 || response.status === 402) {
        return {
          success: false,
          comps: [],
          error: "Regrid API access limited. Radius search may require a higher tier subscription.",
          limitedData: true,
          credentialSource: source,
        };
      }
      throw new Error(`Regrid API error: ${response.status}`);
    }
    
    const data = await response.json() as RegridResponse;
    
    logRegridApiUsage(orgId, 'parcel_lookup', { resultCount: data.results?.length || 0 });
    
    if (!data.results || data.results.length === 0) {
      return {
        success: true,
        comps: [],
        limitedData: true,
        message: "No comparable properties found within the search radius.",
        credentialSource: source,
      };
    }

    let comps: ComparableProperty[] = data.results.map((parcel) => {
      const props = parcel.properties;
      const parcelLat = props.lat || lat;
      const parcelLng = props.lon || lng;
      const acreage = props.ll_gisacre || 0;
      const salePrice = parseSalePrice(props);
      
      return {
        id: props.ll_uuid || props.ll_stable_id || props.parcelnumb || "",
        apn: props.parcelnumb || "",
        address: formatAddress(props),
        city: props.scity || "",
        state: props.state2 || "",
        county: props.county || "",
        acreage,
        saleDate: parseSaleDate(props),
        salePrice,
        pricePerAcre: salePrice && acreage > 0 ? salePrice / acreage : null,
        assessedValue: props.landval ? parseFloat(String(props.landval).replace(/[^0-9.]/g, "")) || null : null,
        landValue: props.landval ? parseFloat(String(props.landval).replace(/[^0-9.]/g, "")) || null : null,
        propertyType: props.usedesc || "Unknown",
        zoning: props.zoning || props.zoning_description || "",
        distance: calculateDistance(lat, lng, parcelLat, parcelLng),
        coordinates: {
          lat: parcelLat,
          lng: parcelLng,
        },
      };
    });

    if (filters.minAcreage !== undefined) {
      comps = comps.filter(c => c.acreage >= filters.minAcreage!);
    }
    if (filters.maxAcreage !== undefined) {
      comps = comps.filter(c => c.acreage <= filters.maxAcreage!);
    }
    if (filters.propertyType) {
      comps = comps.filter(c => 
        c.propertyType.toLowerCase().includes(filters.propertyType!.toLowerCase())
      );
    }
    if (filters.minSaleDate) {
      const minDate = new Date(filters.minSaleDate);
      comps = comps.filter(c => {
        if (!c.saleDate) return false;
        return new Date(c.saleDate) >= minDate;
      });
    }
    if (filters.maxSaleDate) {
      const maxDate = new Date(filters.maxSaleDate);
      comps = comps.filter(c => {
        if (!c.saleDate) return false;
        return new Date(c.saleDate) <= maxDate;
      });
    }

    // W3.2 comps discipline — assessor last-sale records ≠ arm's-length
    // recent sales. Two default screens on PRICED comps (parcels without a
    // recorded sale carry context and are kept):
    //  1. Nominal-price transfers ($1/$10 family deeds, quitclaims) are not
    //     market evidence — drop the sale from the comp set.
    //  2. When the caller supplied no recency floor, priced sales older
    //     than 36 months (or undatable) don't count as "recent sales".
    // The dropped count is surfaced so callers can tell "no market" from
    // "we screened junk out".
    const RECENCY_FLOOR_MONTHS = 36;
    const NOMINAL_SALE_FLOOR_DOLLARS = 1000;
    const before = comps.length;
    comps = comps.filter(c => {
      if (!c.salePrice || c.salePrice <= 0) return true; // unpriced parcel context
      if (c.salePrice < NOMINAL_SALE_FLOOR_DOLLARS) return false; // non-market transfer
      if (!filters.minSaleDate) {
        if (!c.saleDate) return false; // priced but undatable — unverifiable recency
        const floor = new Date();
        floor.setMonth(floor.getMonth() - RECENCY_FLOOR_MONTHS);
        if (new Date(c.saleDate) < floor) return false; // stale sale
      }
      return true;
    });
    const screenedOut = before - comps.length;

    comps.sort((a, b) => a.distance - b.distance);

    const result: CompsSearchResult = {
      success: true,
      comps,
      limitedData: comps.filter(c => c.salePrice).length < 3,
      credentialSource: source,
    };

    if (result.limitedData) {
      result.message = screenedOut > 0
        ? `Limited sales data available (${screenedOut} non-market or stale record${screenedOut === 1 ? "" : "s"} screened out). Market analysis may be less accurate.`
        : "Limited sales data available. Market analysis may be less accurate.";
    }

    compsCache.set(cacheKey, { data: result, timestamp: Date.now() });

    return result;
  } catch (error) {
    logger.error("Comps search error", error);
    return {
      success: false,
      comps: [],
      error: error instanceof Error ? error.message : "Unknown error fetching comparables",
      credentialSource: source,
    };
  }
}

/**
 * Calculate estimated market value based on comps
 */
export function calculateMarketValue(
  subjectAcreage: number,
  comps: ComparableProperty[]
): CompsSearchResult["marketAnalysis"] {
  const compsWithPrices = comps.filter(c => c.pricePerAcre !== null && c.pricePerAcre > 0);
  
  if (compsWithPrices.length === 0) {
    return {
      averagePricePerAcre: 0,
      medianPricePerAcre: 0,
      highPricePerAcre: 0,
      lowPricePerAcre: 0,
      sampleSize: 0,
      estimatedValue: null,
      subjectAcreage,
    };
  }

  const prices = compsWithPrices.map(c => c.pricePerAcre!);
  prices.sort((a, b) => a - b);

  const sum = prices.reduce((acc, p) => acc + p, 0);
  const average = sum / prices.length;

  const mid = Math.floor(prices.length / 2);
  const median = prices.length % 2 === 0 
    ? (prices[mid - 1] + prices[mid]) / 2 
    : prices[mid];

  const low = prices[0];
  const high = prices[prices.length - 1];

  const weightedSum = compsWithPrices.reduce((acc, c) => {
    const weight = 1 / (c.distance + 0.1);
    return acc + (c.pricePerAcre! * weight);
  }, 0);
  const totalWeight = compsWithPrices.reduce((acc, c) => acc + 1 / (c.distance + 0.1), 0);
  const weightedAverage = weightedSum / totalWeight;

  const estimatedValue = subjectAcreage > 0 ? Math.round(weightedAverage * subjectAcreage) : null;

  return {
    averagePricePerAcre: Math.round(average),
    medianPricePerAcre: Math.round(median),
    highPricePerAcre: Math.round(high),
    lowPricePerAcre: Math.round(low),
    sampleSize: compsWithPrices.length,
    estimatedValue,
    subjectAcreage,
  };
}

/**
 * Calculate offer prices based on estimated market value
 * Conservative: 40-50%, Standard: 50-65%, Aggressive: 65-80%
 */
export function calculateOfferPrices(estimatedValue: number): OfferPrices {
  return {
    conservative: {
      min: Math.round(estimatedValue * 0.40),
      max: Math.round(estimatedValue * 0.50),
      label: "Conservative (40-50%)",
    },
    standard: {
      min: Math.round(estimatedValue * 0.50),
      max: Math.round(estimatedValue * 0.65),
      label: "Standard (50-65%)",
    },
    aggressive: {
      min: Math.round(estimatedValue * 0.65),
      max: Math.round(estimatedValue * 0.80),
      label: "Aggressive (65-80%)",
    },
    estimatedMarketValue: estimatedValue,
  };
}

/**
 * Calculate desirability score (0-100) based on property attributes
 */
export function calculateDesirabilityScore(attributes: PropertyAttributes): DesirabilityScore {
  const factors: DesirabilityScoreFactor[] = [];

  // Road Access (max 20 points)
  let roadScore = 10;
  const roadAccess = (attributes.roadAccess || "").toLowerCase();
  if (roadAccess.includes("paved") || roadAccess.includes("asphalt") || roadAccess.includes("concrete")) {
    roadScore = 20;
  } else if (roadAccess.includes("gravel") || roadAccess.includes("improved")) {
    roadScore = 15;
  } else if (roadAccess.includes("dirt") || roadAccess.includes("unimproved")) {
    roadScore = 8;
  } else if (roadAccess.includes("none") || roadAccess.includes("no access") || roadAccess === "") {
    roadScore = 2;
  }
  factors.push({
    name: "Road Access",
    score: roadScore,
    maxScore: 20,
    description: roadAccess || "Unknown",
  });

  // Utilities (max 25 points)
  let utilitiesScore = 0;
  const utils = attributes.utilities || {};
  const utilDescParts: string[] = [];
  if (utils.electric) { utilitiesScore += 8; utilDescParts.push("Electric"); }
  if (utils.water) { utilitiesScore += 8; utilDescParts.push("Water"); }
  if (utils.sewer) { utilitiesScore += 6; utilDescParts.push("Sewer"); }
  if (utils.gas) { utilitiesScore += 3; utilDescParts.push("Gas"); }
  if (utilitiesScore === 0) utilitiesScore = 3; // Base points for rural viability
  factors.push({
    name: "Utilities",
    score: Math.min(utilitiesScore, 25),
    maxScore: 25,
    description: utilDescParts.length > 0 ? utilDescParts.join(", ") : "None/Unknown",
  });

  // Terrain (max 15 points)
  let terrainScore = 8;
  const terrain = (attributes.terrain || "").toLowerCase();
  if (terrain.includes("flat") || terrain.includes("level")) {
    terrainScore = 15;
  } else if (terrain.includes("rolling") || terrain.includes("gentle")) {
    terrainScore = 12;
  } else if (terrain.includes("hilly") || terrain.includes("moderate")) {
    terrainScore = 8;
  } else if (terrain.includes("steep") || terrain.includes("mountain")) {
    terrainScore = 4;
  }
  factors.push({
    name: "Terrain",
    score: terrainScore,
    maxScore: 15,
    description: terrain || "Unknown",
  });

  // Zoning Compatibility (max 20 points)
  let zoningScore = 10;
  const zoning = (attributes.zoning || "").toLowerCase();
  if (zoning.includes("residential") || zoning.includes("r-1") || zoning.includes("r1")) {
    zoningScore = 20;
  } else if (zoning.includes("agricultural") || zoning.includes("ag") || zoning.includes("farm") || zoning.includes("rural")) {
    zoningScore = 18;
  } else if (zoning.includes("mixed") || zoning.includes("general")) {
    zoningScore = 15;
  } else if (zoning.includes("commercial") || zoning.includes("industrial")) {
    zoningScore = 10;
  } else if (zoning.includes("conservation") || zoning.includes("preserve")) {
    zoningScore = 5;
  }
  factors.push({
    name: "Zoning",
    score: zoningScore,
    maxScore: 20,
    description: zoning || "Unknown",
  });

  // Acreage Size - Sweet spot between 1-20 acres (max 20 points)
  let acreageScore = 10;
  const acres = attributes.sizeAcres || 0;
  if (acres >= 2 && acres <= 10) {
    acreageScore = 20; // Sweet spot for most markets
  } else if (acres > 10 && acres <= 20) {
    acreageScore = 18;
  } else if (acres > 0.5 && acres < 2) {
    acreageScore = 15;
  } else if (acres > 20 && acres <= 50) {
    acreageScore = 14;
  } else if (acres > 50 && acres <= 100) {
    acreageScore = 12;
  } else if (acres > 100) {
    acreageScore = 8; // Harder to sell large parcels
  } else if (acres <= 0.5) {
    acreageScore = 10; // Small lots can be limiting
  }
  factors.push({
    name: "Acreage Size",
    score: acreageScore,
    maxScore: 20,
    description: acres > 0 ? `${acres.toFixed(2)} acres` : "Unknown",
  });

  // Calculate total score
  const totalScore = factors.reduce((sum, f) => sum + f.score, 0);

  // Determine grade
  let grade: "A" | "B" | "C" | "D" | "F";
  if (totalScore >= 80) grade = "A";
  else if (totalScore >= 70) grade = "B";
  else if (totalScore >= 55) grade = "C";
  else if (totalScore >= 40) grade = "D";
  else grade = "F";

  return {
    totalScore,
    grade,
    factors,
  };
}

/**
 * Get comps for a property with market analysis
 */
export async function getPropertyComps(
  lat: number,
  lng: number,
  subjectAcreage: number,
  radiusMiles: number = 5,
  filters: CompsFilters = {},
  propertyAttributes?: PropertyAttributes,
  orgId?: number
): Promise<CompsSearchResult> {
  const result = await getComparableProperties(lat, lng, radiusMiles, filters, orgId);

  // Land math stays OFF residential results (wave V3): price-per-acre market
  // analysis, acreage-band offer prices, and the land desirability score are
  // land-domain models — running them on house comps would present land math
  // under house labels. Residential consumers get the raw ATTOM comps (or
  // the honest unavailable state) and the AVM seam for valuation.
  if (result.residential) {
    return result;
  }

  if (result.success && result.comps.length > 0) {
    const marketAnalysis = calculateMarketValue(subjectAcreage, result.comps)!;
    result.marketAnalysis = marketAnalysis;

    // Calculate offer prices if we have estimated value
    if (marketAnalysis.estimatedValue) {
      result.offerPrices = calculateOfferPrices(marketAnalysis.estimatedValue);
    }
  }

  // Calculate desirability score if property attributes provided
  if (propertyAttributes) {
    result.desirabilityScore = calculateDesirabilityScore(propertyAttributes);
  }

  return result;
}
