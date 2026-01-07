/**
 * Due Diligence Report Generator Service
 * Generates comprehensive property research reports for land investments
 */

import { db } from "../db";
import { properties } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { lookupParcelByAPN, type ParcelLookupResult } from "./parcel";
import { getComparableProperties, calculateOfferPrices, type ComparableProperty, type OfferPrices } from "./comps";
import OpenAI from "openai";

// ============================================
// TYPES
// ============================================

export interface DueDiligenceReportSummary {
  generatedAt: string;
  propertyName: string;
  apn: string;
  address: string;
  county: string;
  state: string;
}

export interface ParcelInfo {
  apn: string;
  acres: number | null;
  legalDescription: string | null;
  zoning: string | null;
  landUse: string | null;
  propertyType: string | null;
  boundary: {
    type: "Polygon" | "MultiPolygon";
    coordinates: number[][][] | number[][][][];
  } | null;
  centroid: {
    lat: number;
    lng: number;
  } | null;
}

export interface OwnershipInfo {
  currentOwner: string | null;
  ownerAddress: string | null;
  mailingAddress: string | null;
  ownershipType: string | null;
}

export interface TaxInfo {
  assessedValue: number | null;
  taxAmount: number | null;
  taxYear: number | null;
  taxStatus: string | null;
}

export interface LocationInfo {
  county: string;
  state: string;
  nearestCity: string | null;
  distanceToCity: number | null;
  roadAccess: string | null;
  utilities: {
    electric?: boolean;
    water?: boolean;
    sewer?: boolean;
    gas?: boolean;
  } | null;
}

export interface MarketAnalysis {
  pricePerAcre: number | null;
  estimatedValue: number | null;
  marketTrend: "rising" | "stable" | "declining" | "unknown";
  comparables?: ComparableProperty[];
  offerPrices?: OfferPrices;
}

export interface RiskAssessment {
  floodZone: string | null;
  slope: string | null;
  accessIssues: string[];
  zoningRestrictions: string[];
}

export interface DueDiligenceReport {
  summary: DueDiligenceReportSummary;
  parcelInfo: ParcelInfo;
  ownership: OwnershipInfo;
  taxes: TaxInfo;
  location: LocationInfo;
  marketAnalysis: MarketAnalysis;
  risks: RiskAssessment;
  aiSummary?: string;
  dataSource: "cache" | "county_gis" | "regrid" | "property_record";
  errors?: string[];
}

export interface GenerateReportOptions {
  includeComps?: boolean;
  includeAI?: boolean;
}

// ============================================
// HELPER FUNCTIONS
// ============================================

function parseNumeric(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined || value === "") return null;
  const num = typeof value === "string" ? parseFloat(value) : value;
  return isNaN(num) ? null : num;
}

function formatAddress(property: typeof properties.$inferSelect): string {
  const parts = [property.address, property.city, property.state, property.zip].filter(Boolean);
  return parts.join(", ") || "Unknown Address";
}

function getPropertyName(property: typeof properties.$inferSelect): string {
  if (property.address) {
    return property.address;
  }
  return `${property.county} County Parcel ${property.apn}`;
}

function buildStateCountyPath(state: string, county: string): string {
  const normalizedState = state.toLowerCase();
  const normalizedCounty = county.toLowerCase().replace(/\s+/g, "-").replace(/ county$/i, "");
  return `/us/${normalizedState}/${normalizedCounty}`;
}

function assessRisks(property: typeof properties.$inferSelect): RiskAssessment {
  const accessIssues: string[] = [];
  const zoningRestrictions: string[] = [];

  // Check road access
  if (!property.roadAccess || property.roadAccess === "none") {
    accessIssues.push("No documented road access - verify legal access easements");
  } else if (property.roadAccess === "dirt") {
    accessIssues.push("Dirt road access - may be seasonal or unmaintained");
  }

  // Check utilities
  const utilities = property.utilities;
  if (!utilities?.electric) {
    accessIssues.push("No electric service available");
  }
  if (!utilities?.water) {
    accessIssues.push("No municipal water - well may be required");
  }
  if (!utilities?.sewer) {
    accessIssues.push("No sewer service - septic system may be required");
  }

  // Check zoning
  if (property.zoning) {
    const zoning = property.zoning.toLowerCase();
    if (zoning.includes("agriculture") || zoning.includes("ag")) {
      zoningRestrictions.push("Agricultural zoning may limit development options");
    }
    if (zoning.includes("conservation") || zoning.includes("open space")) {
      zoningRestrictions.push("Conservation/open space restrictions may apply");
    }
    if (zoning.includes("flood")) {
      zoningRestrictions.push("Located in or near flood zone");
    }
  }

  return {
    floodZone: null, // Would need FEMA API integration
    slope: property.terrain || null,
    accessIssues,
    zoningRestrictions,
  };
}

async function generateAISummary(report: Omit<DueDiligenceReport, "aiSummary">): Promise<string | undefined> {
  try {
    const openai = new OpenAI();
    
    const prompt = `You are a real estate due diligence expert. Analyze the following property data and provide a concise executive summary (2-3 paragraphs) highlighting key investment considerations, potential issues, and overall assessment.

Property Details:
- Location: ${report.summary.address}, ${report.summary.county} County, ${report.summary.state}
- APN: ${report.summary.apn}
- Size: ${report.parcelInfo.acres ?? "Unknown"} acres
- Zoning: ${report.parcelInfo.zoning ?? "Unknown"}
- Road Access: ${report.location.roadAccess ?? "Unknown"}
- Owner: ${report.ownership.currentOwner ?? "Unknown"}
- Assessed Value: ${report.taxes.assessedValue ? `$${report.taxes.assessedValue.toLocaleString()}` : "Unknown"}
- Tax Amount: ${report.taxes.taxAmount ? `$${report.taxes.taxAmount.toLocaleString()}` : "Unknown"}
- Estimated Market Value: ${report.marketAnalysis.estimatedValue ? `$${report.marketAnalysis.estimatedValue.toLocaleString()}` : "Unknown"}
- Price per Acre: ${report.marketAnalysis.pricePerAcre ? `$${report.marketAnalysis.pricePerAcre.toLocaleString()}` : "Unknown"}

Utilities:
- Electric: ${report.location.utilities?.electric ? "Yes" : "Unknown/No"}
- Water: ${report.location.utilities?.water ? "Yes" : "Unknown/No"}
- Sewer: ${report.location.utilities?.sewer ? "Yes" : "Unknown/No"}

Access Issues:
${report.risks.accessIssues.length > 0 ? report.risks.accessIssues.map(i => `- ${i}`).join("\n") : "- None identified"}

Zoning Restrictions:
${report.risks.zoningRestrictions.length > 0 ? report.risks.zoningRestrictions.map(r => `- ${r}`).join("\n") : "- None identified"}

Comparable Sales: ${report.marketAnalysis.comparables?.length ?? 0} properties analyzed

Provide a professional assessment focusing on:
1. Overall investment potential
2. Key risks and concerns
3. Recommended next steps for due diligence`;

    const response = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are a professional real estate analyst specializing in land investments." },
        { role: "user", content: prompt }
      ],
      max_tokens: 500,
      temperature: 0.7,
    });

    return response.choices[0]?.message?.content || undefined;
  } catch (error) {
    console.error("[DueDiligence] AI summary generation failed:", error);
    return undefined;
  }
}

// ============================================
// MAIN FUNCTION
// ============================================

/**
 * Generate a comprehensive Due Diligence Report for a property
 */
export async function generateDueDiligenceReport(
  organizationId: number,
  propertyId: number,
  options: GenerateReportOptions = {}
): Promise<DueDiligenceReport> {
  const { includeComps = false, includeAI = false } = options;
  const errors: string[] = [];
  
  // Fetch the property from database
  const [property] = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, organizationId)
      )
    );

  if (!property) {
    throw new Error(`Property not found: ${propertyId}`);
  }

  let dataSource: DueDiligenceReport["dataSource"] = "property_record";
  let parcelResult: ParcelLookupResult | null = null;

  // Check if we have cached parcel data
  const hasCachedParcelData = property.parcelData && 
    property.parcelData.lastUpdated && 
    property.parcelData.owner;

  if (hasCachedParcelData) {
    // Check if cache is fresh (less than 30 days old)
    const cacheAge = property.parcelData?.lastUpdated 
      ? Date.now() - new Date(property.parcelData.lastUpdated).getTime()
      : Infinity;
    const thirtyDaysMs = 30 * 24 * 60 * 60 * 1000;

    if (cacheAge < thirtyDaysMs) {
      dataSource = "cache";
      console.log(`[DueDiligence] Using cached parcel data for property ${propertyId}`);
    } else {
      // Cache is stale, refresh
      console.log(`[DueDiligence] Cache expired, refreshing parcel data for property ${propertyId}`);
    }
  }

  // Fetch fresh parcel data if not cached or stale
  if (dataSource !== "cache") {
    try {
      const stateCountyPath = buildStateCountyPath(property.state, property.county);
      parcelResult = await lookupParcelByAPN(property.apn, stateCountyPath);
      
      if (parcelResult.found && parcelResult.parcel) {
        dataSource = parcelResult.source || "regrid";
        
        // Update property with fresh parcel data
        await db
          .update(properties)
          .set({
            parcelBoundary: parcelResult.parcel.boundary,
            parcelCentroid: parcelResult.parcel.centroid,
            parcelData: {
              regridId: parcelResult.parcel.data.regridId,
              owner: parcelResult.parcel.data.owner,
              ownerAddress: parcelResult.parcel.data.ownerAddress,
              taxAmount: parcelResult.parcel.data.taxAmount,
              lastUpdated: parcelResult.parcel.data.lastUpdated,
            },
            updatedAt: new Date(),
          })
          .where(eq(properties.id, propertyId));
        
        console.log(`[DueDiligence] Updated parcel data from ${dataSource}`);
      } else if (parcelResult.error) {
        errors.push(`Parcel lookup: ${parcelResult.error}`);
      }
    } catch (error) {
      errors.push(`Parcel lookup failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Use fresh data if available, otherwise fall back to cached/property record
  const parcelData = parcelResult?.parcel?.data || property.parcelData;
  const boundary = parcelResult?.parcel?.boundary || property.parcelBoundary;
  const centroid = parcelResult?.parcel?.centroid || property.parcelCentroid;

  // Build report sections
  const summary: DueDiligenceReportSummary = {
    generatedAt: new Date().toISOString(),
    propertyName: getPropertyName(property),
    apn: property.apn,
    address: formatAddress(property),
    county: property.county,
    state: property.state,
  };

  // Get acres from parcel lookup or property record
  const acresFromParcel = parcelResult?.parcel?.data?.acres;
  const parcelInfo: ParcelInfo = {
    apn: property.apn,
    acres: parseNumeric(property.sizeAcres) || (acresFromParcel ? parseNumeric(acresFromParcel) : null),
    legalDescription: property.legalDescription,
    zoning: property.zoning,
    landUse: null, // Would need additional data source
    propertyType: property.terrain,
    boundary: boundary || null,
    centroid: centroid || null,
  };

  const ownership: OwnershipInfo = {
    currentOwner: parcelData?.owner || null,
    ownerAddress: parcelData?.ownerAddress || null,
    mailingAddress: parcelData?.ownerAddress || null,
    ownershipType: null, // Would need additional data source
  };

  const taxes: TaxInfo = {
    assessedValue: parseNumeric(property.assessedValue),
    taxAmount: parseNumeric(parcelData?.taxAmount),
    taxYear: new Date().getFullYear(),
    taxStatus: null, // Would need tax records API
  };

  const location: LocationInfo = {
    county: property.county,
    state: property.state,
    nearestCity: property.city,
    distanceToCity: null, // Would need geocoding
    roadAccess: property.roadAccess,
    utilities: property.utilities,
  };

  // Market Analysis
  let marketAnalysis: MarketAnalysis = {
    pricePerAcre: null,
    estimatedValue: parseNumeric(property.marketValue),
    marketTrend: "unknown",
    comparables: undefined,
    offerPrices: undefined,
  };

  // Fetch comparables if requested
  if (includeComps && centroid) {
    try {
      const compsResult = await getComparableProperties(
        centroid.lat,
        centroid.lng,
        5, // 5 mile radius
        {
          minAcreage: parcelInfo.acres ? parcelInfo.acres * 0.5 : 1,
          maxAcreage: parcelInfo.acres ? parcelInfo.acres * 2 : 100,
          maxResults: 10,
        },
        organizationId
      );

      if (compsResult.success && compsResult.comps.length > 0) {
        marketAnalysis.comparables = compsResult.comps;
        
        // Calculate average price per acre from comps
        const compsWithPricePerAcre = compsResult.comps.filter(c => c.pricePerAcre !== null);
        if (compsWithPricePerAcre.length > 0) {
          const avgPricePerAcre = compsWithPricePerAcre.reduce(
            (sum, c) => sum + (c.pricePerAcre || 0), 
            0
          ) / compsWithPricePerAcre.length;
          
          marketAnalysis.pricePerAcre = Math.round(avgPricePerAcre);
          
          if (parcelInfo.acres) {
            marketAnalysis.estimatedValue = Math.round(avgPricePerAcre * parcelInfo.acres);
          }
        }

        // Calculate offer prices if we have estimated value
        if (marketAnalysis.estimatedValue) {
          try {
            const offerPrices = calculateOfferPrices(marketAnalysis.estimatedValue);
            marketAnalysis.offerPrices = offerPrices;
          } catch (e) {
            // Offer price calculation failed, continue without it
          }
        }
      } else if (compsResult.error) {
        errors.push(`Comps analysis: ${compsResult.error}`);
      }
    } catch (error) {
      errors.push(`Comps analysis: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  // Risk Assessment
  const risks = assessRisks(property);

  // Build initial report without AI summary
  const report: Omit<DueDiligenceReport, "aiSummary"> = {
    summary,
    parcelInfo,
    ownership,
    taxes,
    location,
    marketAnalysis,
    risks,
    dataSource,
    errors: errors.length > 0 ? errors : undefined,
  };

  // Generate AI summary if requested
  let aiSummary: string | undefined;
  if (includeAI) {
    try {
      aiSummary = await generateAISummary(report);
    } catch (error) {
      errors.push(`AI summary: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  return {
    ...report,
    aiSummary,
    errors: errors.length > 0 ? errors : undefined,
  };
}

/**
 * Get a quick summary for a property without full parcel lookup
 */
export async function getQuickPropertySummary(
  organizationId: number,
  propertyId: number
): Promise<DueDiligenceReportSummary | null> {
  const [property] = await db
    .select()
    .from(properties)
    .where(
      and(
        eq(properties.id, propertyId),
        eq(properties.organizationId, organizationId)
      )
    );

  if (!property) {
    return null;
  }

  return {
    generatedAt: new Date().toISOString(),
    propertyName: getPropertyName(property),
    apn: property.apn,
    address: formatAddress(property),
    county: property.county,
    state: property.state,
  };
}
